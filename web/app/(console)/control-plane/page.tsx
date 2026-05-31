'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  PageHeader,
  StatusBadge,
  buttonPrimaryClass,
  buttonSecondaryClass,
  formatRelative,
  formatSize,
  panelClass,
} from '@/components/ControlPlaneUI';
import { api } from '@/lib/api';
import type { AuditVerifyResponse } from '@/lib/types/AuditVerifyResponse';
import type { ControlPlaneLogsResponse } from '@/lib/types/ControlPlaneLogsResponse';
import type { HostSummary } from '@/lib/types/HostSummary';
import type { TenantAccessSummary } from '@/lib/types/TenantAccessSummary';
import type { VolumeSummary } from '@/lib/types/VolumeSummary';
import type { WorkloadSummary } from '@/lib/types/WorkloadSummary';

type Lane = {
  name: string;
  state: 'ready' | 'pending' | 'blocked';
  owner: string;
  checks: string[];
};

const LANES: Lane[] = [
  {
    name: 'Account factory',
    state: 'ready',
    owner: 'Tenant admins',
    checks: ['tenant membership', 'enrollment token TTL', 'agent attestation'],
  },
  {
    name: 'Workload vending',
    state: 'ready',
    owner: 'Operators',
    checks: ['host placement', 'volume readiness', 'audit diff'],
  },
  {
    name: 'Evidence export',
    state: 'ready',
    owner: 'Auditors',
    checks: ['hash chain', 'CSV/JSONL', 'webhook delivery'],
  },
  {
    name: 'Policy guardrails',
    state: 'pending',
    owner: 'Owners',
    checks: ['role gates', 'tenant joins', 'log scopes'],
  },
];

export default function ControlPlanePage() {
  return <ControlPlane />;
}

function ControlPlane() {
  const [hosts, setHosts] = useState<HostSummary[]>([]);
  const [workloads, setWorkloads] = useState<WorkloadSummary[]>([]);
  const [volumes, setVolumes] = useState<VolumeSummary[]>([]);
  const [access, setAccess] = useState<TenantAccessSummary | null>(null);
  const [verify, setVerify] = useState<AuditVerifyResponse | null>(null);
  const [logs, setLogs] = useState<ControlPlaneLogsResponse | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<HostSummary[]>('/api/hosts'),
      api.get<WorkloadSummary[]>('/api/workloads'),
      api.get<VolumeSummary[]>('/api/volumes'),
      api.get<TenantAccessSummary>('/api/tenants/current'),
      api.get<ControlPlaneLogsResponse>('/api/control-plane/logs?source=stored&limit=200'),
      api.get<AuditVerifyResponse>('/api/audit-logs/verify').catch(() => null),
    ])
      .then(([hosts, workloads, volumes, access, logs, verify]) => {
        setHosts(hosts);
        setWorkloads(workloads);
        setVolumes(volumes);
        setAccess(access);
        setLogs(logs);
        setVerify(verify);
      })
      .catch(() => {});
  }, []);

  const running = workloads.filter((workload) => workload.observed_state === 'running').length;
  const online = hosts.filter((host) => host.status === 'online').length;
  const storageMb = volumes.reduce((sum, volume) => sum + Number(volume.size_mb), 0);
  const newestLog = logs?.lines.at(-1);
  const posture = useMemo(
    () => [
      {
        label: 'Tenant isolation',
        state: 'ok',
        detail: `${access?.tenant.name ?? 'current tenant'} scoped across resources`,
      },
      {
        label: 'Audit integrity',
        state: verify?.verified === false ? 'error' : 'ok',
        detail: verify ? `last verified row ${verify.last_verified_id ?? 'none'}` : 'verification pending',
      },
      {
        label: 'Log durability',
        state: logs?.lines.length ? 'ok' : 'pending',
        detail: logs?.lines.length ? `${logs.lines.length} stored lines indexed` : 'waiting for stored entries',
      },
      {
        label: 'Event delivery',
        state: access?.audit_webhooks.some((hook) => hook.failure_count > 0) ? 'error' : 'ok',
        detail: `${access?.audit_webhooks.length ?? 0} audit destinations`,
      },
    ],
    [access, logs, verify],
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Cloud foundation" eyebrow="Public cloud control plane">
        <Link href="/hosts" className={buttonSecondaryClass}>
          Enroll host
        </Link>
        <Link href="/workloads/new" className={buttonPrimaryClass}>
          Launch workload
        </Link>
      </PageHeader>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className={`${panelClass} overflow-hidden`}>
          <div className="border-b border-zinc-800 px-5 py-4">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Landing zone</div>
            <div className="mt-2 grid gap-3 md:grid-cols-4">
              <FoundationMetric label="Hosts" value={`${online}/${hosts.length}`} sub="online" />
              <FoundationMetric label="Workloads" value={running} sub={`${workloads.length} total`} />
              <FoundationMetric label="Storage" value={formatSize(storageMb)} sub={`${volumes.length} volumes`} />
              <FoundationMetric label="Members" value={access?.members.length ?? 0} sub={access?.tenant.role ?? 'role'} />
            </div>
          </div>

          <div className="grid gap-4 p-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3">
              <HierarchyRow level="Organization" name="Ember" meta="single control plane" active />
              <HierarchyRow level="Tenant" name={access?.tenant.name ?? 'Loading tenant'} meta={access?.tenant.slug ?? '...'} active />
              <HierarchyRow level="Region" name="local-region-1" meta={`${hosts.length} enrolled hosts`} active={hosts.length > 0} />
              <HierarchyRow level="Compute cells" name={`${workloads.length} workloads`} meta={`${running} running`} active={running > 0} />
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="text-xs uppercase tracking-wider text-zinc-500">Resource graph</div>
              <div className="mt-4 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 text-xs">
                <GraphNode label="Tenant" value={access?.tenant.name ?? 'tenant'} tone="sky" />
                <GraphEdge />
                <GraphNode label="Hosts" value={hosts.length.toString()} tone="emerald" />
                <GraphEdge />
                <GraphNode label="Workloads" value={workloads.length.toString()} tone="amber" />
              </div>
              <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs">
                <GraphNode label="Audit" value={verify?.verified ? 'verified' : 'tracked'} tone="violet" />
                <GraphEdge />
                <GraphNode label="Sinks" value={`${access?.audit_webhooks.length ?? 0}`} tone="red" />
              </div>
            </div>
          </div>
        </div>

        <div className={`${panelClass} p-5`}>
          <div className="text-xs uppercase tracking-wider text-zinc-500">Control posture</div>
          <div className="mt-4 space-y-3">
            {posture.map((item) => (
              <div key={item.label} className="flex items-start justify-between gap-3 rounded border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="min-w-0">
                  <div className="font-medium text-zinc-100">{item.label}</div>
                  <div className="mt-1 truncate text-xs text-zinc-500">{item.detail}</div>
                </div>
                <StatusBadge state={item.state} />
              </div>
            ))}
          </div>
          <div className="mt-5 rounded border border-zinc-800 bg-zinc-950/40 p-3 text-sm">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Newest stored log</div>
            <div className="mt-2 min-h-10 text-zinc-300">
              {newestLog ? (
                <>
                  <span className="font-mono text-xs text-zinc-500">{formatRelative(newestLog.ts)}</span>
                  <span className="ml-2 text-zinc-200">{newestLog.message}</span>
                </>
              ) : (
                <span className="text-zinc-600">No stored control-plane log lines yet.</span>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className={`${panelClass} overflow-hidden`}>
          <div className="border-b border-zinc-800 px-5 py-4">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Provisioning lanes</div>
          </div>
          <div className="divide-y divide-zinc-800">
            {LANES.map((lane) => (
              <div key={lane.name} className="grid gap-3 px-5 py-4 md:grid-cols-[11rem_1fr_auto]">
                <div>
                  <div className="font-medium text-zinc-100">{lane.name}</div>
                  <div className="mt-1 text-xs text-zinc-500">{lane.owner}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {lane.checks.map((check) => (
                    <span key={check} className="rounded-full border border-zinc-800 px-2 py-1 text-xs text-zinc-400">
                      {check}
                    </span>
                  ))}
                </div>
                <StatusBadge state={lane.state === 'ready' ? 'ok' : lane.state} />
              </div>
            ))}
          </div>
        </div>

        <div className={`${panelClass} overflow-hidden`}>
          <div className="border-b border-zinc-800 px-5 py-4">
            <div className="text-xs uppercase tracking-wider text-zinc-500">Evidence plane</div>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            <EvidenceLink href="/audit" title="Audit trail" value={verify?.verified ? 'hash verified' : 'verify'} />
            <EvidenceLink href="/logs/control-plane" title="Control-plane logs" value={`${logs?.lines.length ?? 0} stored`} />
            <EvidenceLink href="/access" title="Security webhooks" value={`${access?.audit_webhooks.length ?? 0} destinations`} />
            <EvidenceLink href="/workloads" title="Workload logs" value="live + stored" />
          </div>
        </div>
      </section>
    </div>
  );
}

function FoundationMetric({ label, value, sub }: { label: string; value: number | string; sub: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-zinc-50">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{sub}</div>
    </div>
  );
}

function HierarchyRow({ level, name, meta, active }: { level: string; name: string; meta: string; active?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`h-3 w-3 rounded-full ${active ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
      <div className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2">
        <div className="text-xs uppercase tracking-wider text-zinc-500">{level}</div>
        <div className="mt-1 truncate text-sm font-medium text-zinc-100">{name}</div>
      </div>
      <div className="hidden w-32 truncate text-right text-xs text-zinc-500 sm:block">{meta}</div>
    </div>
  );
}

function GraphNode({ label, value, tone }: { label: string; value: string; tone: 'sky' | 'emerald' | 'amber' | 'violet' | 'red' }) {
  const tones = {
    sky: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    violet: 'border-violet-500/30 bg-violet-500/10 text-violet-200',
    red: 'border-red-500/30 bg-red-500/10 text-red-200',
  };
  return (
    <div className={`min-w-0 rounded border p-3 ${tones[tone]}`}>
      <div className="truncate text-[11px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function GraphEdge() {
  return <div className="h-px w-6 bg-zinc-700" />;
}

function EvidenceLink({ href, title, value }: { href: string; title: string; value: string }) {
  return (
    <Link href={href} className="rounded border border-zinc-800 bg-zinc-950/40 p-4 transition hover:border-zinc-700 hover:bg-zinc-900/60">
      <div className="text-sm font-medium text-zinc-100">{title}</div>
      <div className="mt-2 text-xs uppercase tracking-wider text-zinc-500">{value}</div>
    </Link>
  );
}
