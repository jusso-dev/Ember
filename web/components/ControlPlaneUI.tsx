import Link from 'next/link';

/* Hallmark · genre: modern-minimal · design-system: design.md · designed-as-app
 * shared control-plane primitives — flat, border-first, accent ≤ 5%
 */

export const panelClass =
  'rounded-panel border border-zinc-800 bg-zinc-900/80';
export const inputClass =
  'w-full rounded-control border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 outline-none transition-colors duration-short placeholder:text-zinc-500 focus:border-ember-500 focus:ring-1 focus:ring-ember-500/40 disabled:cursor-not-allowed disabled:opacity-50';
export const buttonPrimaryClass =
  'inline-flex items-center justify-center rounded-control bg-ember-500 px-3 py-1.5 text-sm font-medium text-zinc-950 transition-colors duration-short hover:bg-ember-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 disabled:cursor-not-allowed disabled:opacity-50';
export const buttonSecondaryClass =
  'inline-flex items-center justify-center rounded-control border border-zinc-700 bg-transparent px-3 py-1.5 text-sm font-medium text-zinc-200 transition-colors duration-short hover:border-zinc-500 hover:bg-zinc-900 hover:text-zinc-50 disabled:cursor-not-allowed disabled:opacity-50';
export const labelClass = 'mb-1 block text-xs font-medium text-zinc-400';
export const mutedClass = 'text-sm text-zinc-500';

const stateTone: Record<string, string> = {
  online: 'border-emerald-800/80 bg-emerald-950/40 text-emerald-300',
  running: 'border-emerald-800/80 bg-emerald-950/40 text-emerald-300',
  ready: 'border-emerald-800/80 bg-emerald-950/40 text-emerald-300',
  ok: 'border-zinc-700 bg-zinc-900 text-zinc-300',
  pending: 'border-amber-800/80 bg-amber-950/40 text-amber-200',
  queued: 'border-amber-800/80 bg-amber-950/40 text-amber-200',
  deleting: 'border-amber-800/80 bg-amber-950/40 text-amber-200',
  error: 'border-red-800/80 bg-red-950/40 text-red-300',
  denied: 'border-red-800/80 bg-red-950/40 text-red-300',
  failure: 'border-red-800/80 bg-red-950/40 text-red-300',
  offline: 'border-zinc-700 bg-zinc-900 text-zinc-400',
  stopped: 'border-zinc-700 bg-zinc-900 text-zinc-400',
  owner: 'border-ember-800/60 bg-ember-950/30 text-ember-300',
  admin: 'border-zinc-600 bg-zinc-900 text-zinc-200',
  operator: 'border-zinc-700 bg-zinc-900 text-zinc-300',
  viewer: 'border-zinc-700 bg-zinc-900 text-zinc-400',
  auditor: 'border-zinc-700 bg-zinc-900 text-zinc-300',
};

export function EmberMark({
  className = 'h-7 w-7 text-sm',
  title = 'Ember',
}: {
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={`ember-mark grid shrink-0 place-items-center rounded-control font-semibold tracking-tight ${className}`}
      title={title}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-[1em] w-[1em]" fill="currentColor" aria-hidden>
        <path d="M12 2c.4 3.2-1.2 5.4-3.2 7.2C6.6 11.2 5 13.4 5 16.2 5 19.5 7.7 22 12 22s7-2.5 7-5.8c0-2.2-1-4-2.5-5.5C14.8 9 13.6 7.2 13.2 5.2 12.9 3.8 12.5 2.8 12 2z" />
      </svg>
    </span>
  );
}

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
    <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-zinc-500">
            {eyebrow}
          </div>
        )}
        <h1 className="mt-0.5 text-[1.375rem] font-semibold tracking-tight text-zinc-50">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function StatusBadge({ state }: { state: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-control border px-2 py-0.5 text-[11px] font-medium capitalize ${
        stateTone[state] ?? 'border-zinc-700 bg-zinc-900 text-zinc-300'
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {state}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  href,
  action,
  onAction,
}: {
  title: string;
  body: string;
  href?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="text-sm font-medium text-zinc-200">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">{body}</p>
      {action && href && (
        <Link href={href} className={`${buttonPrimaryClass} mt-5 inline-flex`}>
          {action}
        </Link>
      )}
      {action && !href && onAction && (
        <button type="button" onClick={onAction} className={`${buttonPrimaryClass} mt-5 inline-flex`}>
          {action}
        </button>
      )}
    </div>
  );
}

/** Prefer the public base URL embedded in the install command over window.origin. */
export function serverUrlFromInstallCommand(installCommand: string, fallback?: string) {
  const match = installCommand.match(/--server\s+(\S+)/);
  return match?.[1] || fallback || (typeof window !== 'undefined' ? window.location.origin : '');
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
