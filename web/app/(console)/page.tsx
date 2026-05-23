'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  EmptyState,
  PageHeader,
  StatusBadge,
  buttonPrimaryClass,
  buttonSecondaryClass,
  formatRelative,
  formatSize,
  panelClass,
} from '@/components/ControlPlaneUI';
import { api } from '@/lib/api';
import type { HostSummary } from '@/lib/types/HostSummary';
import type { WorkloadSummary } from '@/lib/types/WorkloadSummary';
import type { VolumeSummary } from '@/lib/types/VolumeSummary';
import type { EventRow } from '@/lib/types/EventRow';
import type { Health } from '@/lib/types/Health';

export default function DashboardPage() {
  return <Dashboard />;
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
  const offlineHosts = hosts.filter((h) => h.status === 'offline').length;
  const runningWorkloads = workloads.filter((w) => w.observed_state === 'running').length;
  const workloadErrors = workloads.filter((w) => w.observed_state === 'error' || w.last_error).length;
  const readyVolumes = volumes.filter((v) => v.status === 'ready').length;
  const totalVolumeMb = volumes.reduce((sum, v) => sum + Number(v.size_mb), 0);
  const newestHost = hosts
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  const recentFailures = events.filter((e) => e.kind.includes('fail') || e.kind.includes('error')).length;

  return (
    <div className="space-y-8">
      <PageHeader title="Fleet overview" eyebrow="Control plane">
        <Link href="/hosts" className={buttonSecondaryClass}>
          Add host
        </Link>
        <Link href="/workloads/new" className={buttonPrimaryClass}>
          New workload
        </Link>
      </PageHeader>

      <section className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <div className={`${panelClass} p-5`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-zinc-500">Region health</div>
              <div className="mt-2 flex items-center gap-3">
                <div className="text-3xl font-semibold text-zinc-50">
                  {onlineHosts}/{hosts.length || 0}
                </div>
                <StatusBadge state={offlineHosts || workloadErrors ? 'pending' : health?.status ?? 'ok'} />
              </div>
              <p className="mt-2 max-w-2xl text-sm text-zinc-500">
                Local agents reconcile Docker workloads through the control plane. Queued work is replayed
                when a host reconnects.
              </p>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-right">
              <div className="text-xs text-zinc-500">control-plane</div>
              <div className="text-sm font-medium text-zinc-200">
                {health ? `v${health.version}` : 'checking...'}
              </div>
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Signal label="Hosts online" value={onlineHosts} total={hosts.length} />
            <Signal label="Workloads running" value={runningWorkloads} total={workloads.length} />
            <Signal label="Volumes ready" value={readyVolumes} total={volumes.length} />
          </div>
        </div>

        <div className={`${panelClass} p-5`}>
          <div className="text-xs uppercase tracking-wider text-zinc-500">Provisioning queue</div>
          <div className="mt-4 space-y-3">
            <QueueRow label="Hosts pending" value={hosts.filter((h) => h.status === 'pending').length} />
            <QueueRow
              label="Workloads converging"
              value={workloads.filter((w) => w.desired_state !== w.observed_state).length}
            />
            <QueueRow label="Volumes pending" value={volumes.filter((v) => v.status === 'pending').length} />
            <QueueRow label="Recent failures" value={recentFailures} tone={recentFailures ? 'bad' : 'muted'} />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Hosts" value={hosts.length} sub={`${onlineHosts} online`} href="/hosts" />
        <Stat
          label="Workloads"
          value={workloads.length}
          sub={`${runningWorkloads} running, ${workloadErrors} attention`}
          href="/workloads"
        />
        <Stat
          label="Storage"
          value={formatSize(totalVolumeMb)}
          sub={`${readyVolumes} ready volumes`}
          href="/volumes"
        />
      </div>

      <section className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className={`${panelClass} p-5`}>
          <div className="text-xs uppercase tracking-wider text-zinc-500">Launchpad</div>
          <div className="mt-4 space-y-3">
            <LaunchLink href="/hosts" title="Enroll a host" body="Mint an agent token and attach a machine." />
            <LaunchLink href="/volumes/new" title="Create storage" body="Prepare host-local bind or loopback storage." />
            <LaunchLink href="/workloads/new" title="Deploy container" body="Run an image with ports, env, and mounts." />
          </div>
          <div className="mt-5 border-t border-zinc-800 pt-4 text-sm text-zinc-500">
            Newest host:{' '}
            <span className="font-medium text-zinc-300">{newestHost ? newestHost.name : 'none enrolled'}</span>
          </div>
        </div>

        <div className={panelClass}>
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <h2 className="text-xs uppercase tracking-wider text-zinc-500">Recent activity</h2>
            <span className="text-xs text-zinc-600">last {events.length} events</span>
          </div>
          {events.length === 0 ? (
            <EmptyState
              title="No activity yet"
              body="Enroll a host or create a workload to populate the event stream."
            />
          ) : (
            <ul className="divide-y divide-zinc-800">
              {events.map((e) => (
                <li key={e.id} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[7rem_9rem_1fr]">
                  <span className="text-zinc-500">{formatRelative(e.ts)}</span>
                  <span className="truncate text-zinc-400">{e.kind}</span>
                  <span className="min-w-0 truncate text-zinc-100" title={e.message}>
                    {e.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
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
  value: number | string;
  sub: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`${panelClass} block p-4 transition hover:border-zinc-700 hover:bg-zinc-900/70`}
    >
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
      <div className="mt-1 text-sm text-zinc-500">{sub}</div>
    </Link>
  );
}

function Signal({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-500">{label}</span>
        <span className="text-zinc-300">{pct}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function QueueRow({ label, value, tone = 'muted' }: { label: string; value: number; tone?: 'muted' | 'bad' }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-zinc-400">{label}</span>
      <span className={tone === 'bad' ? 'font-medium text-red-300' : 'font-medium text-zinc-200'}>
        {value}
      </span>
    </div>
  );
}

function LaunchLink({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="block rounded border border-zinc-800 bg-zinc-950/40 p-3 transition hover:border-zinc-700 hover:bg-zinc-900"
    >
      <div className="text-sm font-medium text-zinc-100">{title}</div>
      <div className="mt-1 text-xs text-zinc-500">{body}</div>
    </Link>
  );
}
