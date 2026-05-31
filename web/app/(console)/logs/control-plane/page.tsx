'use client';

import { useEffect, useRef, useState } from 'react';
import {
  EmptyState,
  PageHeader,
  buttonSecondaryClass,
  formatRelative,
  inputClass,
  panelClass,
} from '@/components/ControlPlaneUI';
import { api } from '@/lib/api';
import type { ControlPlaneLogLine } from '@/lib/types/ControlPlaneLogLine';
import type { ControlPlaneLogsResponse } from '@/lib/types/ControlPlaneLogsResponse';

const LEVEL_TONE: Record<string, string> = {
  ERROR: 'text-red-300',
  WARN: 'text-amber-300',
  INFO: 'text-sky-300',
  DEBUG: 'text-zinc-400',
  TRACE: 'text-zinc-500',
};

export default function ControlPlaneLogsPage() {
  return <ControlPlaneLogs />;
}

function ControlPlaneLogs() {
  const [response, setResponse] = useState<ControlPlaneLogsResponse | null>(null);
  const [level, setLevel] = useState<string>('');
  const [source, setSource] = useState<'memory' | 'stored'>('memory');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [query, setQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function reload() {
    const params = new URLSearchParams();
    params.set('limit', '1000');
    if (level) params.set('level', level);
    params.set('source', source);
    if (source === 'stored') {
      if (since) params.set('since', new Date(since).toISOString());
      if (until) params.set('until', new Date(until).toISOString());
      if (query) params.set('search', query);
    }
    api
      .get<ControlPlaneLogsResponse>(`/api/control-plane/logs?${params.toString()}`)
      .then((data) => {
        setResponse(data);
        setLoadError(null);
      })
      .catch((err) => setLoadError(String(err)));
  }

  useEffect(() => {
    reload();
    if (!autoRefresh) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [autoRefresh, level, source, since, until]);

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [response, autoScroll]);

  const lines: ControlPlaneLogLine[] = response?.lines ?? [];
  const filtered = query
    ? lines.filter((l) => `${l.target} ${l.message}`.toLowerCase().includes(query.toLowerCase()))
    : lines;

  return (
    <div className="space-y-6">
      <PageHeader title="Control plane logs" eyebrow="Observability">
        <button
          type="button"
          onClick={() => setAutoRefresh((value) => !value)}
          className={buttonSecondaryClass}
        >
          {autoRefresh ? 'Pause' : 'Resume'}
        </button>
        <button type="button" onClick={reload} className={buttonSecondaryClass}>
          Refresh
        </button>
      </PageHeader>

      <div className={`${panelClass}`}>
        <div className="grid gap-3 border-b border-zinc-800 p-3 lg:grid-cols-[1fr_10rem_11rem_11rem_auto]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by target or message..."
            className={inputClass}
          />
          <select value={level} onChange={(e) => setLevel(e.target.value)} className={inputClass}>
            <option value="">All levels</option>
            <option value="ERROR">Error</option>
            <option value="WARN">Warn and above</option>
            <option value="INFO">Info and above</option>
            <option value="DEBUG">Debug and above</option>
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value as 'memory' | 'stored')} className={inputClass}>
            <option value="memory">Memory</option>
            <option value="stored">Stored</option>
          </select>
          <input
            type="datetime-local"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            disabled={source !== 'stored'}
            className={inputClass}
            aria-label="Stored logs from"
          />
          <input
            type="datetime-local"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            disabled={source !== 'stored'}
            className={inputClass}
            aria-label="Stored logs until"
          />
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

        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2 text-xs text-zinc-500">
          <span>
            Showing {filtered.length} of {lines.length} lines
            {response ? ` (buffer cap ${response.capacity})` : ''}
          </span>
          {response && response.lines.length > 0 && (
            <span>most recent {formatRelative(response.lines[response.lines.length - 1].ts)}</span>
          )}
        </div>

        {loadError && (
          <div className="border-b border-red-900/40 bg-red-500/5 px-4 py-2 text-xs text-red-300">
            {loadError}
          </div>
        )}

        <div
          ref={scrollRef}
          className="max-h-[60vh] min-h-[20rem] overflow-y-auto bg-zinc-950/60 font-mono text-xs"
        >
          {filtered.length === 0 ? (
            <EmptyState
              title="No log lines yet"
              body="Control plane logs accumulate as the server processes requests."
            />
          ) : (
            <table className="w-full">
              <tbody>
                {filtered.map((line, idx) => (
                  <tr key={idx} className="border-b border-zinc-900/60">
                    <td className="whitespace-nowrap px-3 py-1 text-zinc-600" title={line.ts}>
                      {formatTime(line.ts)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <span className={`${LEVEL_TONE[line.level] ?? 'text-zinc-400'} font-semibold`}>
                        {line.level}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-zinc-500">{line.target}</td>
                    <td className="px-3 py-1 text-zinc-100">
                      <span className="whitespace-pre-wrap break-words">{line.message}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTime(value: string) {
  try {
    return new Date(value).toLocaleTimeString(undefined, { hour12: false });
  } catch {
    return value;
  }
}
