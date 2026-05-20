'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { api } from '@/lib/api';
import type { HostSummary } from '@/lib/types/HostSummary';
import type { WorkloadSummary } from '@/lib/types/WorkloadSummary';
import type { VolumeSummary } from '@/lib/types/VolumeSummary';
import type { EventRow } from '@/lib/types/EventRow';
import type { Health } from '@/lib/types/Health';

export default function DashboardPage() {
  return (
    <Shell>
      <Dashboard />
    </Shell>
  );
}

function Dashboard() {
  const [hosts, setHosts] = useState<HostSummary[]>([]);
  const [workloads, setWorkloads] = useState<WorkloadSummary[]>([]);
  const [volumes, setVolumes] = useState<VolumeSummary[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    const load = () => {
      Promise.all([
        api.get<HostSummary[]>('/api/hosts'),
        api.get<WorkloadSummary[]>('/api/workloads'),
        api.get<VolumeSummary[]>('/api/volumes'),
        api.get<EventRow[]>('/api/events?limit=20'),
        api.get<Health>('/api/health'),
      ])
        .then(([h, w, v, e, hl]) => {
          setHosts(h);
          setWorkloads(w);
          setVolumes(v);
          setEvents(e);
          setHealth(hl);
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const onlineHosts = hosts.filter((h) => h.status === 'online').length;
  const runningWorkloads = workloads.filter((w) => w.observed_state === 'running').length;
  const readyVolumes = volumes.filter((v) => v.status === 'ready').length;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Hosts" value={hosts.length} sub={`${onlineHosts} online`} href="/hosts" />
        <Stat
          label="Workloads"
          value={workloads.length}
          sub={`${runningWorkloads} running`}
          href="/workloads"
        />
        <Stat
          label="Volumes"
          value={volumes.length}
          sub={`${readyVolumes} ready`}
          href="/volumes"
        />
      </div>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
          <h2 className="text-xs uppercase tracking-wider text-zinc-500">Recent activity</h2>
          <span className="text-xs text-zinc-600">
            control-plane{' '}
            <span className="text-emerald-400">{health?.status ?? 'checking…'}</span>
            {health && <span className="text-zinc-600"> · v{health.version}</span>}
          </span>
        </div>
        <ul className="divide-y divide-zinc-800">
          {events.length === 0 && (
            <li className="px-4 py-3 text-sm text-zinc-500">No events yet.</li>
          )}
          {events.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="w-44 truncate text-zinc-500">{e.ts}</span>
              <span className="w-40 truncate text-zinc-400">{e.kind}</span>
              <span className="flex-1 truncate text-zinc-100">{e.message}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: number;
  sub: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 hover:border-zinc-700"
    >
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
      <div className="mt-1 text-sm text-zinc-500">{sub}</div>
    </Link>
  );
}
