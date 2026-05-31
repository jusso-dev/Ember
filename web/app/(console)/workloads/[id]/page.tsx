'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  EmptyState,
  PageHeader,
  StatusBadge,
  buttonPrimaryClass,
  buttonSecondaryClass,
  formatDate,
  formatRelative,
  inputClass,
  panelClass,
} from '@/components/ControlPlaneUI';
import { api } from '@/lib/api';
import type { EventRow } from '@/lib/types/EventRow';
import type { LogLine } from '@/lib/types/LogLine';
import type { WorkloadLogsResponse } from '@/lib/types/WorkloadLogsResponse';
import type { WorkloadSummary } from '@/lib/types/WorkloadSummary';

export default function WorkloadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <WorkloadDetail id={id} />;
}

function WorkloadDetail({ id }: { id: string }) {
  const [workload, setWorkload] = useState<WorkloadSummary | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [logs, setLogs] = useState<WorkloadLogsResponse | null>(null);
  const [tail, setTail] = useState(200);
  const [source, setSource] = useState<'live' | 'stored'>('live');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [query, setQuery] = useState('');
  const [streamFilter, setStreamFilter] = useState<'all' | 'stdout' | 'stderr'>('all');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [follow, setFollow] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [logError, setLogError] = useState<string | null>(null);
  const [workloadError, setWorkloadError] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  function reloadWorkload() {
    api
      .get<WorkloadSummary>(`/api/workloads/${id}`)
      .then((w) => {
        setWorkload(w);
        setWorkloadError(null);
      })
      .catch((err) => setWorkloadError(String(err)));
    api
      .get<EventRow[]>(`/api/events?workload_id=${id}&limit=50`)
      .then(setEvents)
      .catch(() => {});
  }

  function reloadLogs() {
    setLoadingLogs(true);
    const params = new URLSearchParams();
    params.set('tail', String(tail));
    params.set('source', source);
    if (source === 'stored') {
      if (since) params.set('since', new Date(since).toISOString());
      if (until) params.set('until', new Date(until).toISOString());
      if (query) params.set('search', query);
    }
    api
      .get<WorkloadLogsResponse>(`/api/workloads/${id}/logs?${params.toString()}`)
      .then((data) => {
        setLogs(data);
        setLogError(data.error ?? null);
      })
      .catch((err) => setLogError(String(err)))
      .finally(() => setLoadingLogs(false));
  }

  useEffect(() => {
    reloadWorkload();
    reloadLogs();
    if (!autoRefresh) return;
    const t = setInterval(() => {
      reloadWorkload();
      reloadLogs();
    }, 5000);
    return () => clearInterval(t);
  }, [id, autoRefresh, tail, source, since, until]);

  useEffect(() => {
    if (!follow || source !== 'live') return;
    setAutoRefresh(false);
    const es = new EventSource(`/api/workloads/${id}/logs/stream`, { withCredentials: true });
    es.addEventListener('log', (event) => {
      try {
        const next = JSON.parse((event as MessageEvent).data) as LogLine[];
        setLogs((current) => {
          const base = current ?? {
            workload_id: id,
            host_id: workload?.host_id ?? '',
            fetched_at: new Date().toISOString(),
            lines: [],
            truncated: false,
            error: null,
          };
          return {
            ...base,
            fetched_at: new Date().toISOString(),
            lines: [...base.lines, ...next].slice(-5000),
          };
        });
        setLogError(null);
      } catch (err) {
        setLogError(String(err));
      }
    });
    es.addEventListener('end', (event) => {
      setLogError((event as MessageEvent).data || 'log stream ended');
      setFollow(false);
    });
    es.onerror = () => {
      setLogError('live log stream disconnected');
      setFollow(false);
    };
    return () => es.close();
  }, [follow, source, id, workload?.host_id]);

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs, autoScroll]);

  async function action(verb: 'start' | 'stop') {
    try {
      await api.post(`/api/workloads/${id}/${verb}`);
      reloadWorkload();
    } catch (e) {
      alert(String(e));
    }
  }

  async function remove() {
    if (!confirm('Delete this workload?')) return;
    try {
      await api.del(`/api/workloads/${id}`);
      window.location.href = '/workloads';
    } catch (e) {
      alert(String(e));
    }
  }

  if (workloadError) {
    return (
      <div className="space-y-4">
        <PageHeader title="Workload" eyebrow="Container service">
          <Link href="/workloads" className={buttonSecondaryClass}>
            Back
          </Link>
        </PageHeader>
        <div className={`${panelClass} p-6 text-sm text-red-300`}>{workloadError}</div>
      </div>
    );
  }

  const filteredLines: LogLine[] = (logs?.lines ?? []).filter((line) => {
    if (streamFilter !== 'all' && line.stream !== streamFilter) return false;
    if (!query) return true;
    return line.message.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <PageHeader title={workload ? workload.name : 'Loading…'} eyebrow="Workload">
        <Link href="/workloads" className={buttonSecondaryClass}>
          Back to workloads
        </Link>
        {workload && workload.desired_state !== 'running' && (
          <button onClick={() => action('start')} className={buttonPrimaryClass}>
            Start
          </button>
        )}
        {workload && workload.desired_state === 'running' && (
          <button onClick={() => action('stop')} className={buttonSecondaryClass}>
            Stop
          </button>
        )}
        {workload && (
          <button onClick={remove} className={`${buttonSecondaryClass} text-red-300`}>
            Delete
          </button>
        )}
      </PageHeader>

      {workload && (
        <section className={`${panelClass} p-5`}>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <Field label="Host">
              <Link href={`/hosts`} className="text-sky-300 hover:underline">
                {workload.host_name}
              </Link>
            </Field>
            <Field label="Image">
              <span className="font-mono text-xs">{workload.image}</span>
            </Field>
            <Field label="Container ID">
              <span className="font-mono text-xs text-zinc-400" title={workload.container_id ?? ''}>
                {workload.container_id ? workload.container_id.slice(0, 12) : '—'}
              </span>
            </Field>
            <Field label="Desired state">
              <StatusBadge state={workload.desired_state} />
            </Field>
            <Field label="Observed state">
              <StatusBadge state={workload.observed_state} />
            </Field>
            <Field label="Created">
              <span title={formatDate(workload.created_at)}>{formatRelative(workload.created_at)}</span>
            </Field>
          </dl>
          {workload.last_error && (
            <div className="mt-4 rounded border border-red-900/40 bg-red-500/5 p-3 text-sm text-red-300">
              <div className="text-xs uppercase tracking-wider text-red-400">Last error</div>
              <div className="mt-1">{workload.last_error}</div>
            </div>
          )}
        </section>
      )}

      <section className={panelClass}>
        <div className="flex flex-col gap-3 border-b border-zinc-800 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-medium text-zinc-100">Container logs</h2>
            <p className="text-xs text-zinc-500">
              Live output streams through the agent; stored output survives restarts until retention expires.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as 'live' | 'stored')}
              className={inputClass}
            >
              <option value="live">Live pull</option>
              <option value="stored">Stored</option>
            </select>
            <select
              value={tail}
              onChange={(e) => setTail(Number(e.target.value))}
              className={inputClass}
            >
              <option value={50}>Last 50</option>
              <option value={200}>Last 200</option>
              <option value={500}>Last 500</option>
              <option value={1000}>Last 1000</option>
              <option value={5000}>Last 5000</option>
            </select>
            <select
              value={streamFilter}
              onChange={(e) => setStreamFilter(e.target.value as 'all' | 'stdout' | 'stderr')}
              className={inputClass}
            >
              <option value="all">Both streams</option>
              <option value="stdout">stdout only</option>
              <option value="stderr">stderr only</option>
            </select>
            <button
              type="button"
              onClick={() => setAutoRefresh((value) => !value)}
              className={buttonSecondaryClass}
            >
              {autoRefresh ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              onClick={() => setFollow((value) => !value)}
              disabled={source !== 'live'}
              className={follow ? buttonPrimaryClass : buttonSecondaryClass}
            >
              {follow ? 'Following' : 'Follow'}
            </button>
            <button type="button" onClick={reloadLogs} className={buttonSecondaryClass}>
              {loadingLogs ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-2 border-b border-zinc-800 p-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter log lines..."
            className={`${inputClass} sm:max-w-md`}
          />
          {source === 'stored' && (
            <div className="grid flex-1 gap-2 sm:grid-cols-2">
              <input
                type="datetime-local"
                value={since}
                onChange={(e) => setSince(e.target.value)}
                className={inputClass}
                aria-label="Stored logs from"
              />
              <input
                type="datetime-local"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                className={inputClass}
                aria-label="Stored logs until"
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-sky-500"
            />
            Auto-scroll
          </label>
        </div>

        {logError && (
          <div className="border-b border-amber-900/40 bg-amber-500/5 px-4 py-2 text-xs text-amber-200">
            {logError}
          </div>
        )}

        <div
          ref={scrollRef}
          className="max-h-[60vh] min-h-[16rem] overflow-y-auto bg-zinc-950/60 font-mono text-xs"
        >
          {filteredLines.length === 0 ? (
            <EmptyState
              title="No log lines"
              body={
                logs
                  ? 'The container has not produced any output, or it is not running.'
                  : 'Fetching container output from the host agent…'
              }
            />
          ) : (
            <table className="w-full">
              <tbody>
                {filteredLines.map((line, idx) => (
                  <tr key={idx} className="border-b border-zinc-900/40">
                    <td className="whitespace-nowrap px-3 py-1 text-zinc-600" title={line.timestamp ?? ''}>
                      {line.timestamp ? formatLogTime(line.timestamp) : '—'}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <span
                        className={
                          line.stream === 'stderr'
                            ? 'text-red-300 font-semibold'
                            : 'text-emerald-300 font-semibold'
                        }
                      >
                        {line.stream}
                      </span>
                    </td>
                    <td className="px-3 py-1 text-zinc-100">
                      <span className="whitespace-pre-wrap break-words">{line.message}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {logs?.truncated && (
          <div className="border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">
            Output truncated to the most recent {tail} lines. Increase the tail size to see more.
          </div>
        )}
      </section>

      <section className={panelClass}>
        <div className="border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-medium text-zinc-100">Recent events</h2>
        </div>
        {events.length === 0 ? (
          <EmptyState title="No recent events" body="State changes for this workload will appear here." />
        ) : (
          <ul className="divide-y divide-zinc-800">
            {events.map((e) => (
              <li key={e.id.toString()} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[7rem_9rem_1fr]">
                <span className="text-zinc-500">{formatRelative(e.ts)}</span>
                <span className="truncate text-zinc-400">{e.kind}</span>
                <span className="min-w-0 truncate text-zinc-100" title={e.message}>
                  {e.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-zinc-500">{label}</dt>
      <dd className="mt-1 text-zinc-100">{children}</dd>
    </div>
  );
}

function formatLogTime(value: string) {
  try {
    return new Date(value).toLocaleTimeString(undefined, { hour12: false });
  } catch {
    return value;
  }
}
