'use client';

import { useEffect, useMemo, useState } from 'react';
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
import type { AuditLogRow } from '@/lib/types/AuditLogRow';

export default function AuditLogPage() {
  return <AuditLog />;
}

function AuditLog() {
  const [items, setItems] = useState<AuditLogRow[]>([]);
  const [query, setQuery] = useState('');
  const [resultFilter, setResultFilter] = useState<'all' | 'success' | 'failure'>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  function reload() {
    api
      .get<AuditLogRow[]>('/api/audit-logs?limit=500')
      .then((rows) => {
        setItems(rows);
        setLoadError(null);
      })
      .catch((err) => setLoadError(String(err)));
  }

  useEffect(() => {
    reload();
    if (!autoRefresh) return;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [autoRefresh]);

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
  const failureCount = items.length - successCount;
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
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-4">
        <MiniStat label="Records" value={items.length} />
        <MiniStat label="Successes" value={successCount} />
        <MiniStat label="Failures" value={failureCount} tone={failureCount > 0 ? 'bad' : 'muted'} />
        <MiniStat label="Distinct actors" value={distinctActors} />
      </div>

      <div className={`${panelClass} overflow-hidden`}>
        <div className="grid gap-3 border-b border-zinc-800 p-3 sm:grid-cols-[1fr_auto_auto]">
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
            onChange={(e) => setResultFilter(e.target.value as 'all' | 'success' | 'failure')}
            className={inputClass}
          >
            <option value="all">Any result</option>
            <option value="success">Success only</option>
            <option value="failure">Failures only</option>
          </select>
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
                  <StatusBadge state={row.result === 'success' ? 'ok' : 'error'} />
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
      </div>
    </div>
  );
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
