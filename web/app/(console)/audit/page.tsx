'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  EmptyState,
  PageHeader,
  StatusBadge,
  buttonSecondaryClass,
  formatDate,
  formatRelative,
  inputClass,
  panelClass,
} from '@/components/ControlPlaneUI';
import { api } from '@/lib/api';
import type { AuditLogListResponse } from '@/lib/types/AuditLogListResponse';
import type { AuditLogRow } from '@/lib/types/AuditLogRow';
import type { AuditVerifyResponse } from '@/lib/types/AuditVerifyResponse';

export default function AuditLogPage() {
  return <AuditLog />;
}

function AuditLog() {
  const [items, setItems] = useState<AuditLogRow[]>([]);
  const [query, setQuery] = useState('');
  const [resultFilter, setResultFilter] = useState<'all' | 'success' | 'failure' | 'denied'>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState('');
  const [nextCursor, setNextCursor] = useState<bigint | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [verify, setVerify] = useState<AuditVerifyResponse | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const downloadRef = useRef<HTMLAnchorElement>(null);

  function params(cursor?: bigint | null) {
    const params = new URLSearchParams();
    params.set('limit', '200');
    if (resultFilter !== 'all') params.set('result', resultFilter);
    if (actionFilter !== 'all') params.set('action', actionFilter);
    if (from) params.set('since', new Date(from).toISOString());
    if (to) params.set('until', new Date(to).toISOString());
    if (cursor) params.set('before_id', String(cursor));
    return params;
  }

  function reload() {
    api
      .get<AuditLogListResponse>(`/api/audit-logs?${params().toString()}`)
      .then((response) => {
        setItems(response.rows);
        setNextCursor(response.next_cursor);
        setLoadError(null);
      })
      .catch((err) => setLoadError(String(err)));
  }

  function loadOlder() {
    if (!nextCursor) return;
    setLoadingOlder(true);
    api
      .get<AuditLogListResponse>(`/api/audit-logs?${params(nextCursor).toString()}`)
      .then((response) => {
        setItems((current) => [...current, ...response.rows]);
        setNextCursor(response.next_cursor);
      })
      .catch((err) => setLoadError(String(err)))
      .finally(() => setLoadingOlder(false));
  }

  useEffect(() => {
    reload();
    if (!autoRefresh) return;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [autoRefresh, resultFilter, actionFilter, from, to]);

  function exportRows(format: 'csv' | 'jsonl') {
    const exportParams = params();
    exportParams.delete('limit');
    exportParams.delete('before_id');
    exportParams.set('format', format);
    const href = `/api/audit-logs/export?${exportParams.toString()}`;
    if (downloadRef.current) {
      downloadRef.current.href = href;
      downloadRef.current.download = format === 'csv' ? 'ember-audit.csv' : 'ember-audit.jsonl';
      downloadRef.current.click();
    }
  }

  function verifyChain() {
    api
      .get<AuditVerifyResponse>('/api/audit-logs/verify')
      .then(setVerify)
      .catch((err) => setLoadError(String(err)));
  }

  const actions = useMemo(() => {
    const seen = new Set<string>();
    items.forEach((row) => seen.add(row.action));
    return Array.from(seen).sort();
  }, [items]);

  const visibleItems = items.filter((row) => {
    if (resultFilter !== 'all' && row.result !== resultFilter) return false;
    if (actionFilter !== 'all' && row.action !== actionFilter) return false;
    if (!query) return true;
    const haystack = [
      row.action,
      row.actor_email,
      row.actor_user_id,
      row.resource_type,
      row.resource_id,
      row.ip_address,
      row.user_agent,
      row.details,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const successCount = items.filter((row) => row.result === 'success').length;
  const deniedCount = items.filter((row) => row.result === 'denied').length;
  const failureCount = items.filter((row) => row.result === 'failure').length;
  const distinctActors = new Set(items.map((row) => row.actor_user_id ?? row.actor_email).filter(Boolean)).size;

  return (
    <div className="space-y-6">
      <PageHeader title="Audit log" eyebrow="Security">
        <button
          type="button"
          onClick={() => setAutoRefresh((value) => !value)}
          className={buttonSecondaryClass}
        >
          {autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
        </button>
        <button type="button" onClick={reload} className={buttonSecondaryClass}>
          Refresh
        </button>
        <button type="button" onClick={verifyChain} className={buttonSecondaryClass}>
          Verify chain
        </button>
        <button type="button" onClick={() => exportRows('csv')} className={buttonSecondaryClass}>
          Export CSV
        </button>
        <button type="button" onClick={() => exportRows('jsonl')} className={buttonSecondaryClass}>
          Export JSONL
        </button>
        <a ref={downloadRef} className="hidden" />
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-4">
        <MiniStat label="Records" value={items.length} />
        <MiniStat label="Successes" value={successCount} />
        <MiniStat label="Failures" value={failureCount} tone={failureCount > 0 ? 'bad' : 'muted'} />
        <MiniStat label="Denied" value={deniedCount} tone={deniedCount > 0 ? 'bad' : 'muted'} />
      </div>

      {verify && (
        <div
          className={`${panelClass} flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-center sm:justify-between`}
        >
          <div>
            <div className="font-medium text-zinc-100">
              Audit chain {verify.verified ? 'verified' : 'failed verification'}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              Last verified row {verify.last_verified_id ?? 'none'}
              {verify.first_bad_id ? `, first bad row ${verify.first_bad_id}` : ''}
            </div>
          </div>
          <StatusBadge state={verify.verified ? 'ok' : 'error'} />
        </div>
      )}

      <div className={`${panelClass} overflow-hidden`}>
        <div className="grid gap-3 border-b border-zinc-800 p-3 lg:grid-cols-[1fr_11rem_11rem_12rem_12rem]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by actor, resource, IP, or details..."
            className={inputClass}
          />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className={inputClass}
          >
            <option value="all">All actions</option>
            {actions.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
          <select
            value={resultFilter}
            onChange={(e) => setResultFilter(e.target.value as 'all' | 'success' | 'failure' | 'denied')}
            className={inputClass}
          >
            <option value="all">Any result</option>
            <option value="success">Success only</option>
            <option value="failure">Failures only</option>
            <option value="denied">Denied only</option>
          </select>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={inputClass}
            aria-label="From"
          />
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={inputClass}
            aria-label="Until"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
          {(['all', 'success', 'failure', 'denied'] as const).map((result) => (
            <button
              key={result}
              type="button"
              onClick={() => setResultFilter(result)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                resultFilter === result
                  ? 'border-sky-500/40 bg-sky-500/10 text-sky-200'
                  : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
              }`}
            >
              {result === 'all' ? 'All' : result}
            </button>
          ))}
          <span className="ml-auto text-xs text-zinc-600">{distinctActors} distinct actors</span>
        </div>

        {loadError && (
          <div className="border-b border-red-900/40 bg-red-500/5 px-4 py-2 text-xs text-red-300">
            {loadError}
          </div>
        )}

        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">Actor</th>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Resource</th>
              <th className="px-4 py-2">Result</th>
              <th className="px-4 py-2">From</th>
              <th className="px-4 py-2">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {items.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    title="No audit activity yet"
                    body="Sign in, deploy a workload, or invite a teammate to populate the audit log."
                  />
                </td>
              </tr>
            )}
            {items.length > 0 && visibleItems.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-sm text-zinc-500" colSpan={7}>
                  No audit records match the current filters.
                </td>
              </tr>
            )}
            {visibleItems.map((row) => (
              <tr key={row.id.toString()} className="align-top hover:bg-zinc-900/30">
                <td className="px-4 py-2 text-xs text-zinc-400" title={formatDate(row.ts)}>
                  <div className="font-medium text-zinc-200">{formatRelative(row.ts)}</div>
                  <div className="mt-0.5 text-zinc-600">{formatDate(row.ts)}</div>
                </td>
                <td className="px-4 py-2">
                  <div className="font-medium text-zinc-100">{row.actor_email ?? '—'}</div>
                  {row.actor_user_id && (
                    <div className="mt-0.5 truncate font-mono text-xs text-zinc-500" title={row.actor_user_id}>
                      {row.actor_user_id.slice(0, 8)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-zinc-200">{row.action}</td>
                <td className="px-4 py-2 text-xs">
                  {row.resource_type ? (
                    <>
                      <div className="text-zinc-400">{row.resource_type}</div>
                      {row.resource_id && (
                        <div className="mt-0.5 truncate font-mono text-zinc-500" title={row.resource_id}>
                          {row.resource_id.slice(0, 12)}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <StatusBadge state={row.result === 'success' ? 'ok' : row.result} />
                </td>
                <td className="px-4 py-2 text-xs text-zinc-400">
                  <div className="font-mono">{row.ip_address ?? '—'}</div>
                  {row.user_agent && (
                    <div className="mt-0.5 max-w-xs truncate text-zinc-600" title={row.user_agent}>
                      {row.user_agent}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 align-top">
                  {row.details ? (
                    <details className="text-xs text-zinc-400">
                      <summary className="cursor-pointer text-zinc-300 hover:text-zinc-100">view</summary>
                      <pre className="mt-2 max-w-md overflow-x-auto whitespace-pre-wrap break-words rounded bg-zinc-950/60 p-2 font-mono text-[11px] text-zinc-300">
                        {prettifyJson(row.details)}
                      </pre>
                    </details>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {nextCursor && (
          <div className="border-t border-zinc-800 p-3 text-center">
            <button type="button" onClick={loadOlder} disabled={loadingOlder} className={buttonSecondaryClass}>
              {loadingOlder ? 'Loading older...' : 'Load older'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function defaultFrom() {
  const value = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  value.setSeconds(0, 0);
  return value.toISOString().slice(0, 16);
}

function prettifyJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function MiniStat({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: number;
  tone?: 'muted' | 'bad';
}) {
  return (
    <div className={`${panelClass} px-4 py-3`}>
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === 'bad' ? 'text-red-300' : 'text-zinc-50'}`}>
        {value}
      </div>
    </div>
  );
}
