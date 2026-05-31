import Link from 'next/link';

export const panelClass = 'rounded-lg border border-zinc-800 bg-zinc-900/40 shadow-sm shadow-black/10';
export const inputClass =
  'w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-700/40 disabled:cursor-not-allowed disabled:opacity-60';
export const buttonPrimaryClass =
  'rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-zinc-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50';
export const buttonSecondaryClass =
  'rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50';

const stateTone: Record<string, string> = {
  online: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  running: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  ready: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  ok: 'border-sky-500/25 bg-sky-500/10 text-sky-300',
  pending: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  queued: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  deleting: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  error: 'border-red-500/25 bg-red-500/10 text-red-300',
  denied: 'border-red-500/25 bg-red-500/10 text-red-300',
  failure: 'border-red-500/25 bg-red-500/10 text-red-300',
  offline: 'border-zinc-600 bg-zinc-800/60 text-zinc-300',
  stopped: 'border-zinc-600 bg-zinc-800/60 text-zinc-300',
  owner: 'border-sky-500/25 bg-sky-500/10 text-sky-300',
  admin: 'border-violet-500/25 bg-violet-500/10 text-violet-300',
  operator: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  viewer: 'border-zinc-600 bg-zinc-800/60 text-zinc-300',
  auditor: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
};

export function PageHeader({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="text-xs uppercase tracking-wider text-zinc-500">{eyebrow}</div>}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function StatusBadge({ state }: { state: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${
        stateTone[state] ?? 'border-zinc-700 bg-zinc-900 text-zinc-300'
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {state}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  href,
  action,
}: {
  title: string;
  body: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-500">
        +
      </div>
      <div className="text-sm font-medium text-zinc-200">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">{body}</p>
      {href && action && (
        <Link href={href} className={`${buttonSecondaryClass} mt-4 inline-flex`}>
          {action}
        </Link>
      )}
    </div>
  );
}

export function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

export function formatRelative(value?: string | null) {
  if (!value) return 'never';
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return formatDate(value);
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatSize(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;
  return `${mb.toLocaleString()} MB`;
}
