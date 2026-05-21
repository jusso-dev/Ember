'use client';

import { useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { api, ApiError } from '@/lib/api';
import type { HostSummary } from '@/lib/types/HostSummary';
import type { EnrollTokenResponse } from '@/lib/types/EnrollTokenResponse';

export default function HostsPage() {
  return (
    <Shell>
      <Hosts />
    </Shell>
  );
}

function Hosts() {
  const [hosts, setHosts] = useState<HostSummary[]>([]);
  const [adding, setAdding] = useState(false);
  const [token, setToken] = useState<EnrollTokenResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reload() {
    api.get<HostSummary[]>('/api/hosts').then(setHosts).catch(() => {});
  }

  useEffect(() => {
    reload();
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, []);

  async function mint() {
    setBusy(true);
    setErr(null);
    try {
      const t = await api.post<EnrollTokenResponse>('/api/hosts/enroll-token');
      setToken(t);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this host?')) return;
    try {
      await api.del(`/api/hosts/${id}`);
      reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        alert('Host still has workloads or volumes.');
      } else {
        alert(String(e));
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Hosts</h1>
        <button
          onClick={() => {
            setAdding(true);
            setToken(null);
            mint();
          }}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Add host
        </button>
      </div>

      {adding && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Enroll a new host</h2>
            <button
              onClick={() => setAdding(false)}
              className="text-xs text-zinc-400 hover:text-zinc-100"
            >
              Close
            </button>
          </div>
          {busy && <p className="text-sm text-zinc-500">Minting token…</p>}
          {err && <p className="text-sm text-red-400">{err}</p>}
          {token && (
            <>
              <p className="text-sm text-zinc-400">
                On the target Linux host, run the agent binary like so (token expires{' '}
                {new Date(token.expires_at).toLocaleString()}):
              </p>
              <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-3 text-xs text-zinc-200">
{`ember-agent enroll \\
  --server ${(typeof window !== 'undefined' && window.location.origin) || '<control-plane-url>'} \\
  --token ${token.token} \\
  --name <hostname>
ember-agent run`}
              </pre>
              <p className="mt-3 text-xs text-zinc-500">Or, if you have an installer hosted:</p>
              <pre className="mt-1 overflow-x-auto rounded bg-black/40 p-3 text-xs text-zinc-200">
                {token.install_command}
              </pre>
              <button
                onClick={() => navigator.clipboard.writeText(token.token)}
                className="mt-2 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Copy token
              </button>
            </>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">OS / arch</th>
              <th className="px-4 py-2">Agent</th>
              <th className="px-4 py-2">Last seen</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {hosts.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-zinc-500" colSpan={6}>
                  No hosts yet.
                </td>
              </tr>
            )}
            {hosts.map((h) => (
              <tr key={h.id} className="hover:bg-zinc-900/30">
                <td className="px-4 py-2 font-mono">{h.name}</td>
                <td className="px-4 py-2">
                  <StatusDot status={h.status} />
                </td>
                <td className="px-4 py-2 text-zinc-400">
                  {h.os ?? '—'} / {h.arch ?? '—'}
                </td>
                <td className="px-4 py-2 text-zinc-400">{h.agent_version ?? '—'}</td>
                <td className="px-4 py-2 text-zinc-400">
                  {h.last_seen_at ? new Date(h.last_seen_at).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => remove(h.id)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'online' ? 'bg-emerald-500' : status === 'pending' ? 'bg-amber-500' : 'bg-zinc-600';
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      <span className="capitalize text-zinc-300">{status}</span>
    </span>
  );
}
