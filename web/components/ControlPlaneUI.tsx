import Link from 'next/link';

export const panelClass =
  'rounded-lg border border-orange-950/60 bg-coal-900/70 shadow-sm shadow-black/30 backdrop-blur-sm';
export const inputClass =
  'w-full rounded border border-orange-950/70 bg-coal-950 px-3 py-1.5 text-sm text-orange-50 outline-none transition placeholder:text-orange-200/25 focus:border-ember-500/50 focus:ring-2 focus:ring-ember-500/20 disabled:cursor-not-allowed disabled:opacity-60';
export const buttonPrimaryClass =
  'rounded bg-gradient-to-b from-ember-400 to-ember-600 px-3 py-1.5 text-sm font-medium text-coal-950 shadow-ember-sm transition hover:from-ember-300 hover:to-ember-500 disabled:cursor-not-allowed disabled:opacity-50';
export const buttonSecondaryClass =
  'rounded border border-orange-900/70 px-3 py-1.5 text-sm text-orange-100/80 transition hover:border-ember-600/50 hover:bg-ember-950/40 hover:text-orange-50 disabled:cursor-not-allowed disabled:opacity-50';

const stateTone: Record<string, string> = {
  online: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  running: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  ready: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  ok: 'border-ember-500/30 bg-ember-500/10 text-ember-300',
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  queued: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  deleting: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  error: 'border-red-500/30 bg-red-500/10 text-red-300',
  denied: 'border-red-500/30 bg-red-500/10 text-red-300',
  failure: 'border-red-500/30 bg-red-500/10 text-red-300',
  offline: 'border-zinc-600 bg-zinc-900/60 text-zinc-400',
  stopped: 'border-zinc-600 bg-zinc-900/60 text-zinc-400',
  owner: 'border-ember-500/30 bg-ember-500/10 text-ember-300',
  admin: 'border-orange-400/30 bg-orange-500/10 text-orange-300',
  operator: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  viewer: 'border-zinc-600 bg-zinc-900/60 text-zinc-400',
  auditor: 'border-amber-600/30 bg-amber-700/15 text-amber-300',
};

export function EmberMark({
  className = 'h-8 w-8 text-sm',
  title = 'Ember',
}: {
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={`ember-mark grid shrink-0 place-items-center rounded-md font-bold tracking-tight ${className}`}
      title={title}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-[1.1em] w-[1.1em]" fill="currentColor" aria-hidden>
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
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <div className="text-xs uppercase tracking-[0.14em] text-ember-500/80">{eyebrow}</div>
        )}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-orange-50">{title}</h1>
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
      <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_6px_currentColor]" />
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
    <div className="px-6 py-10 text-center">
      <div className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-full border border-ember-800/50 bg-ember-950/40 text-ember-400">
        <EmberMark className="h-7 w-7 text-[10px]" />
      </div>
      <div className="text-sm font-medium text-orange-100">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-sm text-orange-200/40">{body}</p>
      {action && href && (
        <Link href={href} className={`${buttonPrimaryClass} mt-4 inline-flex`}>
          {action}
        </Link>
      )}
      {action && !href && onAction && (
        <button type="button" onClick={onAction} className={`${buttonPrimaryClass} mt-4 inline-flex`}>
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
