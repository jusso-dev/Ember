'use client';

import { useEffect, useState } from 'react';
import {
  EmptyState,
  PageHeader,
  StatusBadge,
  buttonPrimaryClass,
  buttonSecondaryClass,
  formatRelative,
  inputClass,
  panelClass,
} from '@/components/ControlPlaneUI';
import { api, ApiError } from '@/lib/api';
import type { HostSummary } from '@/lib/types/HostSummary';
import type { EnrollTokenResponse } from '@/lib/types/EnrollTokenResponse';

export default function HostsPage() {
  return <Hosts />;
}

function Hosts() {
  const [hosts, setHosts] = useState<HostSummary[]>([]);
  const [adding, setAdding] = useState(false);
  const [token, setToken] = useState<EnrollTokenResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

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

  const visibleHosts = hosts.filter((h) => {
    const matchesFilter = filter === 'all' || h.status === filter;
    const text = `${h.name} ${h.os ?? ''} ${h.arch ?? ''} ${h.agent_version ?? ''}`.toLowerCase();
    return matchesFilter && text.includes(query.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Hosts" eyebrow="Compute fleet">
        <button
          onClick={() => {
            setAdding(true);
            setToken(null);
            mint();
          }}
          className={buttonPrimaryClass}
        >
          Add host
        </button>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat label="Online" value={hosts.filter((h) => h.status === 'online').length} />
        <MiniStat label="Pending" value={hosts.filter((h) => h.status === 'pending').length} />
        <MiniStat label="Offline" value={hosts.filter((h) => h.status === 'offline').length} />
      </div>

      {adding && (
        <div className={`${panelClass} p-4`}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Enroll a new host</h2>
            <button
              onClick={() => setAdding(false)}
              className="text-xs text-zinc-400 hover:text-zinc-100"
            >
              Close
            </button>
          </div>
          {busy && <p className="text-sm text-zinc-500">Minting token...</p>}
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
                className={`${buttonSecondaryClass} mt-2`}
              >
                Copy token
              </button>
            </>
          )}
        </div>
      )}

      <div className={`${panelClass} overflow-hidden`}>
        <div className="flex flex-col gap-3 border-b border-zinc-800 p-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search hosts..."
            className={`${inputClass} w-full sm:w-72`}
          />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className={inputClass}>
            <option value="all">All statuses</option>
            <option value="online">Online</option>
            <option value="pending">Pending</option>
            <option value="offline">Offline</option>
          </select>
        </div>
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
                <td colSpan={6}>
                  <EmptyState
                    title="No hosts enrolled"
                    body="Add a host to give Ember somewhere to place workloads and create volumes."
                  />
                </td>
              </tr>
            )}
            {hosts.length > 0 && visibleHosts.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-sm text-zinc-500" colSpan={6}>
                  No hosts match the current filters.
                </td>
              </tr>
            )}
            {visibleHosts.map((h) => (
              <tr key={h.id} className="hover:bg-zinc-900/30">
                <td className="px-4 py-2 font-mono">{h.name}</td>
                <td className="px-4 py-2">
                  <StatusBadge state={h.status} />
                </td>
                <td className="px-4 py-2 text-zinc-400">
                  {h.os ?? '-'} / {h.arch ?? '-'}
                </td>
                <td className="px-4 py-2 text-zinc-400">{h.agent_version ?? '-'}</td>
                <td className="px-4 py-2 text-zinc-400">
                  <span title={h.last_seen_at ?? undefined}>{formatRelative(h.last_seen_at)}</span>
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

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className={`${panelClass} px-4 py-3`}>
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-50">{value}</div>
    </div>
  );
}
