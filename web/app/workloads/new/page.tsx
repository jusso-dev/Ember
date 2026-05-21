'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { api } from '@/lib/api';
import type { HostSummary } from '@/lib/types/HostSummary';
import type { VolumeSummary } from '@/lib/types/VolumeSummary';

type EnvKV = { key: string; value: string };
type Port = { host_port: string; container_port: string; protocol: string };
type Mount = { volume_id: string; mount_path: string; read_only: boolean };

export default function NewWorkloadPage() {
  return (
    <Shell>
      <NewWorkload />
    </Shell>
  );
}

function NewWorkload() {
  const router = useRouter();
  const [hosts, setHosts] = useState<HostSummary[]>([]);
  const [volumes, setVolumes] = useState<VolumeSummary[]>([]);
  const [hostId, setHostId] = useState('');
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [command, setCommand] = useState('');
  const [env, setEnv] = useState<EnvKV[]>([]);
  const [ports, setPorts] = useState<Port[]>([]);
  const [mounts, setMounts] = useState<Mount[]>([]);
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
    api.get<VolumeSummary[]>('/api/volumes').then(setVolumes).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const eligibleVolumes = volumes.filter((v) => v.host_id === hostId && v.status === 'ready');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = {
        host_id: hostId,
        name,
        image,
        env: env.filter((e) => e.key).map((e) => [e.key, e.value]),
        ports: ports.map((p) => ({
          host_port: Number(p.host_port),
          container_port: Number(p.container_port),
          protocol: p.protocol,
        })),
        volumes: mounts
          .filter((m) => m.volume_id && m.mount_path)
          .map((m) => ({ volume_id: m.volume_id, mount_path: m.mount_path, read_only: m.read_only })),
        command: command.trim() ? command.trim().split(/\s+/) : null,
      };
      await api.post('/api/workloads', body);
      router.push('/workloads');
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">New workload</h1>

      <Field label="Host">
        <select
          required
          value={hostId}
          onChange={(e) => setHostId(e.target.value)}
          className={inputClass}
        >
          <option value="">Choose host…</option>
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name} ({h.status})
            </option>
          ))}
        </select>
      </Field>

      <Field label="Name">
        <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>

      <Field label="Image">
        <input
          required
          placeholder="e.g. nginx:alpine"
          value={image}
          onChange={(e) => setImage(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="Command (optional, space-separated)">
        <input
          value={command}
          placeholder="(leave blank for image default)"
          onChange={(e) => setCommand(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="Environment variables">
        <DynamicList
          items={env}
          onChange={setEnv}
          empty={() => ({ key: '', value: '' })}
          render={(item, set) => (
            <>
              <input
                placeholder="KEY"
                value={item.key}
                onChange={(e) => set({ ...item, key: e.target.value })}
                className={`${inputClass} w-40`}
              />
              <input
                placeholder="value"
                value={item.value}
                onChange={(e) => set({ ...item, value: e.target.value })}
                className={`${inputClass} flex-1`}
              />
            </>
          )}
          addLabel="+ env"
        />
      </Field>

      <Field label="Port mappings">
        <DynamicList
          items={ports}
          onChange={setPorts}
          empty={() => ({ host_port: '', container_port: '', protocol: 'tcp' })}
          render={(p, set) => (
            <>
              <input
                placeholder="host"
                inputMode="numeric"
                value={p.host_port}
                onChange={(e) => set({ ...p, host_port: e.target.value })}
                className={`${inputClass} w-24`}
              />
              <span className="text-zinc-500">→</span>
              <input
                placeholder="container"
                inputMode="numeric"
                value={p.container_port}
                onChange={(e) => set({ ...p, container_port: e.target.value })}
                className={`${inputClass} w-24`}
              />
              <select
                value={p.protocol}
                onChange={(e) => set({ ...p, protocol: e.target.value })}
                className={`${inputClass} w-24`}
              >
                <option value="tcp">tcp</option>
                <option value="udp">udp</option>
              </select>
            </>
          )}
          addLabel="+ port"
        />
      </Field>

      <Field label="Volume mounts">
        <DynamicList
          items={mounts}
          onChange={setMounts}
          empty={() => ({ volume_id: eligibleVolumes[0]?.id ?? '', mount_path: '', read_only: false })}
          render={(m, set) => (
            <>
              <select
                value={m.volume_id}
                onChange={(e) => set({ ...m, volume_id: e.target.value })}
                className={`${inputClass} w-48`}
              >
                <option value="">Choose volume…</option>
                {eligibleVolumes.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="/mnt/data"
                value={m.mount_path}
                onChange={(e) => set({ ...m, mount_path: e.target.value })}
                className={`${inputClass} flex-1`}
              />
              <label className="flex items-center gap-1 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={m.read_only}
                  onChange={(e) => set({ ...m, read_only: e.target.checked })}
                />
                ro
              </label>
            </>
          )}
          addLabel="+ mount"
        />
        {hostId && eligibleVolumes.length === 0 && (
          <p className="mt-1 text-xs text-zinc-500">No ready volumes on this host.</p>
        )}
      </Field>

      {err && <p className="text-sm text-red-400">{err}</p>}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create workload'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const inputClass =
  'rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function DynamicList<T>({
  items,
  onChange,
  empty,
  render,
  addLabel,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  empty: () => T;
  render: (item: T, set: (next: T) => void) => React.ReactNode;
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          {render(item, (next) => {
            const copy = items.slice();
            copy[i] = next;
            onChange(copy);
          })}
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="text-xs text-red-400 hover:text-red-300"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, empty()])}
        className="text-xs text-zinc-400 hover:text-zinc-100"
      >
        {addLabel}
      </button>
    </div>
  );
}
