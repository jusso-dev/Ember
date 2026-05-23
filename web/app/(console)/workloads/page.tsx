'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  EmptyState,
  PageHeader,
  StatusBadge,
  buttonPrimaryClass,
  formatRelative,
  inputClass,
  panelClass,
} from '@/components/ControlPlaneUI';
import { api } from '@/lib/api';
import type { WorkloadSummary } from '@/lib/types/WorkloadSummary';

export default function WorkloadsPage() {
  return <Workloads />;
}

function Workloads() {
  const [items, setItems] = useState<WorkloadSummary[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  function reload() {
    api.get<WorkloadSummary[]>('/api/workloads').then(setItems).catch(() => {});
  }
  useEffect(() => {
    reload();
    const t = setInterval(reload, 2000);
    return () => clearInterval(t);
  }, []);

  async function action(id: string, verb: 'start' | 'stop') {
    try {
      await api.post(`/api/workloads/${id}/${verb}`);
      reload();
    } catch (e) {
      alert(String(e));
    }
  }
  async function remove(id: string) {
    if (!confirm('Delete this workload?')) return;
    try {
      await api.del(`/api/workloads/${id}`);
      reload();
    } catch (e) {
      alert(String(e));
    }
  }

  const visibleItems = items.filter((w) => {
    const matchesFilter = filter === 'all' || w.observed_state === filter || w.desired_state === filter;
    const text = `${w.name} ${w.host_name} ${w.image} ${w.observed_state}`.toLowerCase();
    return matchesFilter && text.includes(query.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Workloads" eyebrow="Container services">
        <Link
          href="/workloads/new"
          className={buttonPrimaryClass}
        >
          New workload
        </Link>
      </PageHeader>
      <div className="grid gap-3 sm:grid-cols-4">
        <MiniStat label="Running" value={items.filter((w) => w.observed_state === 'running').length} />
        <MiniStat label="Desired running" value={items.filter((w) => w.desired_state === 'running').length} />
        <MiniStat label="Converging" value={items.filter((w) => w.desired_state !== w.observed_state).length} />
        <MiniStat label="Errors" value={items.filter((w) => w.last_error || w.observed_state === 'error').length} />
      </div>
      <div className={`${panelClass} overflow-hidden`}>
        <div className="flex flex-col gap-3 border-b border-zinc-800 p-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workloads..."
            className={`${inputClass} w-full sm:w-80`}
          />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className={inputClass}>
            <option value="all">All states</option>
            <option value="running">Running</option>
            <option value="pending">Pending</option>
            <option value="stopped">Stopped</option>
            <option value="error">Error</option>
          </select>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Host</th>
              <th className="px-4 py-2">Image</th>
              <th className="px-4 py-2">Desired</th>
              <th className="px-4 py-2">Observed</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {items.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState
                    title="No workloads deployed"
                    body="Create a workload to run a Docker image on one enrolled host."
                    href="/workloads/new"
                    action="New workload"
                  />
                </td>
              </tr>
            )}
            {items.length > 0 && visibleItems.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-sm text-zinc-500" colSpan={6}>
                  No workloads match the current filters.
                </td>
              </tr>
            )}
            {visibleItems.map((w) => (
              <tr key={w.id} className="align-top hover:bg-zinc-900/30">
                <td className="px-4 py-2">
                  <Link href={`/workloads/${w.id}`} className="font-mono text-sky-300 hover:underline">
                    {w.name}
                  </Link>
                  <div className="mt-1 text-xs text-zinc-500">{formatRelative(w.created_at)}</div>
                </td>
                <td className="px-4 py-2 text-zinc-400">{w.host_name}</td>
                <td className="px-4 py-2 font-mono text-xs text-zinc-300">{w.image}</td>
                <td className="px-4 py-2">
                  <StatusBadge state={w.desired_state} />
                </td>
                <td className="px-4 py-2">
                  <StatusBadge state={w.observed_state} />
                  {w.last_error && (
                    <div className="mt-1 max-w-md truncate text-xs text-red-400" title={w.last_error}>
                      {w.last_error}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-3">
                    <Link
                      href={`/workloads/${w.id}`}
                      className="text-xs text-sky-300 hover:text-sky-200"
                    >
                      Logs
                    </Link>
                    {w.desired_state !== 'running' && (
                      <button
                        onClick={() => action(w.id, 'start')}
                        className="text-xs text-emerald-400 hover:text-emerald-300"
                      >
                        Start
                      </button>
                    )}
                    {w.desired_state === 'running' && (
                      <button
                        onClick={() => action(w.id, 'stop')}
                        className="text-xs text-amber-400 hover:text-amber-300"
                      >
                        Stop
                      </button>
                    )}
                    <button
                      onClick={() => remove(w.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
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
