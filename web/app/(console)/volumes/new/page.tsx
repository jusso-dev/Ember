'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  PageHeader,
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  panelClass,
} from '@/components/ControlPlaneUI';
import { api } from '@/lib/api';
import type { HostSummary } from '@/lib/types/HostSummary';

export default function NewVolumePage() {
  return <NewVolume />;
}

function NewVolume() {
  const router = useRouter();
  const [hosts, setHosts] = useState<HostSummary[]>([]);
  const [hostId, setHostId] = useState('');
  const [name, setName] = useState('');
  const [sizeMb, setSizeMb] = useState('1024');
  const [backend, setBackend] = useState('hostdir');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<HostSummary[]>('/api/hosts')
      .then((h) => {
        setHosts(h);
        if (h.length && !hostId) setHostId(h[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/api/volumes', {
        host_id: hostId,
        name,
        size_mb: Number(sizeMb),
        backend,
      });
      router.push('/volumes');
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="New volume" eyebrow="Provision storage" />

      <div className={`${panelClass} space-y-5 p-5`}>
        <Field label="Host">
          <select required value={hostId} onChange={(e) => setHostId(e.target.value)} className={inputClass}>
            <option value="">Choose host...</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} ({h.status})
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>

          <Field label="Size (MB)">
            <input
              required
              inputMode="numeric"
              value={sizeMb}
              onChange={(e) => setSizeMb(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Backend">
          <select value={backend} onChange={(e) => setBackend(e.target.value)} className={inputClass}>
            <option value="hostdir">hostdir (bind-mount a directory)</option>
            <option value="loopback_ext4">loopback_ext4 (requires root on agent)</option>
          </select>
        </Field>

        <div className="rounded border border-zinc-800 bg-zinc-950/50 p-3 text-sm text-zinc-500">
          The control plane records the requested quota. `hostdir` creates a directory under the
          agent volume root; `loopback_ext4` needs elevated agent privileges.
        </div>
      </div>

      {err && <p className="text-sm text-red-400">{err}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={busy || !hosts.length} className={buttonPrimaryClass}>
          {busy ? 'Creating...' : 'Create volume'}
        </button>
        <button type="button" onClick={() => router.back()} className={buttonSecondaryClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-zinc-500">{label}</span>
      {children}
    </label>
  );
}
