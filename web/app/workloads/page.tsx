'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { api } from '@/lib/api';
import type { WorkloadSummary } from '@/lib/types/WorkloadSummary';

export default function WorkloadsPage() {
  return (
    <Shell>
      <Workloads />
    </Shell>
  );
}

function Workloads() {
  const [items, setItems] = useState<WorkloadSummary[]>([]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Workloads</h1>
        <Link
          href="/workloads/new"
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          New workload
        </Link>
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-800">
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
                <td className="px-4 py-6 text-center text-zinc-500" colSpan={6}>
                  No workloads yet.
                </td>
              </tr>
            )}
            {items.map((w) => (
              <tr key={w.id} className="align-top hover:bg-zinc-900/30">
                <td className="px-4 py-2 font-mono">{w.name}</td>
                <td className="px-4 py-2 text-zinc-400">{w.host_name}</td>
                <td className="px-4 py-2 font-mono text-xs text-zinc-300">{w.image}</td>
                <td className="px-4 py-2 text-zinc-400">{w.desired_state}</td>
                <td className="px-4 py-2">
                  <StateBadge state={w.observed_state} />
                  {w.last_error && (
                    <div className="mt-1 max-w-md truncate text-xs text-red-400" title={w.last_error}>
                      {w.last_error}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-3">
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

function StateBadge({ state }: { state: string }) {
  const color =
    state === 'running'
      ? 'text-emerald-400'
      : state === 'pending'
        ? 'text-amber-400'
        : state === 'error'
          ? 'text-red-400'
          : 'text-zinc-400';
  return <span className={`text-sm ${color}`}>{state}</span>;
}
