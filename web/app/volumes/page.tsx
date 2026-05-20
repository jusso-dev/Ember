'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { api, ApiError } from '@/lib/api';
import type { VolumeSummary } from '@/lib/types/VolumeSummary';

export default function VolumesPage() {
  return (
    <Shell>
      <Volumes />
    </Shell>
  );
}

function Volumes() {
  const [items, setItems] = useState<VolumeSummary[]>([]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Volumes</h1>
        <Link
          href="/volumes/new"
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          New volume
        </Link>
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-800">
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
                <td className="px-4 py-6 text-center text-zinc-500" colSpan={7}>
                  No volumes yet.
                </td>
              </tr>
            )}
            {items.map((v) => (
              <tr key={v.id} className="hover:bg-zinc-900/30">
                <td className="px-4 py-2 font-mono">{v.name}</td>
                <td className="px-4 py-2 text-zinc-400">{v.host_name}</td>
                <td className="px-4 py-2 text-zinc-400">{v.backend}</td>
                <td className="px-4 py-2 text-zinc-400">{v.size_mb} MB</td>
                <td className="px-4 py-2 text-zinc-300">{v.status}</td>
                <td className="px-4 py-2 font-mono text-xs text-zinc-400">{v.host_path ?? '—'}</td>
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
