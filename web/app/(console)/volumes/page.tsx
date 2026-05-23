'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  EmptyState,
  PageHeader,
  StatusBadge,
  buttonPrimaryClass,
  formatRelative,
  formatSize,
  inputClass,
  panelClass,
} from '@/components/ControlPlaneUI';
import { api, ApiError } from '@/lib/api';
import type { VolumeSummary } from '@/lib/types/VolumeSummary';

export default function VolumesPage() {
  return <Volumes />;
}

function Volumes() {
  const [items, setItems] = useState<VolumeSummary[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  function reload() {
    api.get<VolumeSummary[]>('/api/volumes').then(setItems).catch(() => {});
  }
  useEffect(() => {
    reload();
    const t = setInterval(reload, 2000);
    return () => clearInterval(t);
  }, []);

  async function remove(id: string) {
    if (!confirm('Delete this volume?')) return;
    try {
      await api.del(`/api/volumes/${id}`);
      reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        alert('Volume is attached to a workload.');
      } else {
        alert(String(e));
      }
    }
  }

  const visibleItems = items.filter((v) => {
    const matchesFilter = filter === 'all' || v.status === filter || v.backend === filter;
    const text = `${v.name} ${v.host_name} ${v.backend} ${v.status} ${v.host_path ?? ''}`.toLowerCase();
    return matchesFilter && text.includes(query.toLowerCase());
  });
  const totalMb = items.reduce((sum, v) => sum + Number(v.size_mb), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Volumes" eyebrow="Host-local storage">
        <Link
          href="/volumes/new"
          className={buttonPrimaryClass}
        >
          New volume
        </Link>
      </PageHeader>
      <div className="grid gap-3 sm:grid-cols-4">
        <MiniStat label="Provisioned" value={formatSize(totalMb)} />
        <MiniStat label="Ready" value={items.filter((v) => v.status === 'ready').length} />
        <MiniStat label="Pending" value={items.filter((v) => v.status === 'pending').length} />
        <MiniStat label="Backends" value={new Set(items.map((v) => v.backend)).size} />
      </div>
      <div className={`${panelClass} overflow-hidden`}>
        <div className="flex flex-col gap-3 border-b border-zinc-800 p-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search volumes..."
            className={`${inputClass} w-full sm:w-80`}
          />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className={inputClass}>
            <option value="all">All volumes</option>
            <option value="ready">Ready</option>
            <option value="pending">Pending</option>
            <option value="error">Error</option>
            <option value="hostdir">hostdir</option>
            <option value="loopback_ext4">loopback_ext4</option>
          </select>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Host</th>
              <th className="px-4 py-2">Backend</th>
              <th className="px-4 py-2">Size</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Host path</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {items.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    title="No volumes created"
                    body="Create host-local storage before mounting durable paths into workloads."
                    href="/volumes/new"
                    action="New volume"
                  />
                </td>
              </tr>
            )}
            {items.length > 0 && visibleItems.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-sm text-zinc-500" colSpan={7}>
                  No volumes match the current filters.
                </td>
              </tr>
            )}
            {visibleItems.map((v) => (
              <tr key={v.id} className="hover:bg-zinc-900/30">
                <td className="px-4 py-2">
                  <div className="font-mono">{v.name}</div>
                  <div className="mt-1 text-xs text-zinc-500">{formatRelative(v.created_at)}</div>
                </td>
                <td className="px-4 py-2 text-zinc-400">{v.host_name}</td>
                <td className="px-4 py-2 text-zinc-400">{v.backend}</td>
                <td className="px-4 py-2 text-zinc-400">{formatSize(Number(v.size_mb))}</td>
                <td className="px-4 py-2">
                  <StatusBadge state={v.status} />
                </td>
                <td className="max-w-xs truncate px-4 py-2 font-mono text-xs text-zinc-400">
                  {v.host_path ?? '-'}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => remove(v.id)}
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

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className={`${panelClass} px-4 py-3`}>
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-50">{value}</div>
    </div>
  );
}
