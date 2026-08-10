'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { EmberMark, inputClass } from '@/components/ControlPlaneUI';
import type { SessionInfo } from '@/lib/types/SessionInfo';

type NavItem = {
  href: string;
  label: string;
  short: string;
  description?: string;
  keywords?: string[];
};

type NavGroup = {
  id: string;
  label: string;
  short: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    short: 'O',
    items: [
      {
        href: '/',
        label: 'Dashboard',
        short: 'D',
        description: 'Fleet health and activity',
        keywords: ['overview', 'home', 'activity', 'events'],
      },
      {
        href: '/control-plane',
        label: 'Cloud foundation',
        short: 'F',
        description: 'Landing zone and guardrails',
        keywords: ['cloud', 'foundation', 'landing zone', 'guardrails', 'control plane'],
      },
    ],
  },
  {
    id: 'compute',
    label: 'Compute',
    short: 'C',
    items: [
      { href: '/hosts', label: 'Hosts', short: 'H', description: 'Agent nodes', keywords: ['nodes', 'agents', 'machines'] },
      {
        href: '/workloads',
        label: 'Workloads',
        short: 'W',
        description: 'Containers and desired state',
        keywords: ['containers', 'apps', 'services', 'docker'],
      },
      {
        href: '/workloads/new',
        label: 'Create workload',
        short: '+',
        description: 'Deploy an image',
        keywords: ['new workload', 'deploy', 'run container', 'create container'],
      },
    ],
  },
  {
    id: 'storage',
    label: 'Storage',
    short: 'S',
    items: [
      {
        href: '/volumes',
        label: 'Volumes',
        short: 'V',
        description: 'Host-local storage',
        keywords: ['storage', 'disks', 'mounts'],
      },
      {
        href: '/volumes/new',
        label: 'Create volume',
        short: '+',
        description: 'Provision storage',
        keywords: ['new volume', 'create storage', 'provision disk'],
      },
    ],
  },
  {
    id: 'observability',
    label: 'Observability',
    short: 'L',
    items: [
      {
        href: '/logs/control-plane',
        label: 'Control plane logs',
        short: 'L',
        description: 'Server tracing output',
        keywords: ['logs', 'tracing', 'errors', 'server', 'control plane'],
      },
      {
        href: '/audit',
        label: 'Audit log',
        short: 'U',
        description: 'Who did what, and when',
        keywords: ['audit', 'security', 'compliance', 'history', 'login'],
      },
    ],
  },
  {
    id: 'manage',
    label: 'Manage',
    short: 'M',
    items: [
      {
        href: '/access',
        label: 'Access control',
        short: 'A',
        description: 'Tenants, users, roles, and invites',
        keywords: ['users', 'roles', 'tenant', 'invitations', 'members', 'rbac'],
      },
      {
        href: '/security',
        label: 'Security & policy',
        short: 'S',
        description: 'MFA, secrets, API tokens, admission policy',
        keywords: ['mfa', 'totp', 'secrets', 'tokens', 'policy', 'backup', 'registry'],
      },
    ],
  },
];

const SEARCH_ITEMS = NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => ({
    ...item,
    group: group.label,
    haystack: [item.label, item.description, group.label, ...(item.keywords ?? [])]
      .join(' ')
      .toLowerCase(),
  })),
);

export function ShellClient({
  children,
  session,
}: {
  children: React.ReactNode;
  session: SessionInfo;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [sessionState] = useState<SessionInfo>(session);
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    overview: true,
    compute: true,
    storage: true,
  });
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!searchRef.current?.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  async function logout() {
    try {
      await api.post('/api/auth/logout');
    } finally {
      router.replace('/login');
    }
  }

  function toggleGroup(id: string) {
    setOpenGroups((current) => ({ ...current, [id]: !current[id] }));
  }

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SEARCH_ITEMS.slice(0, 6);
    return SEARCH_ITEMS.filter((item) => item.haystack.includes(q)).slice(0, 8);
  }, [search]);

  function goToSearchResult(href: string) {
    setSearch('');
    setSearchOpen(false);
    router.push(href);
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setSearch('');
      setSearchOpen(false);
      return;
    }

    if (event.key === 'Enter' && searchResults[0]) {
      event.preventDefault();
      goToSearchResult(searchResults[0].href);
    }
  }

  const activeGroup = NAV_GROUPS.find((group) => group.items.some((item) => isActive(pathname, item.href)));

  return (
    <div className="min-h-screen" data-testid="app-shell">
      <header className="sticky top-0 z-20 border-b border-orange-950/70 bg-coal-950/85 shadow-ember-sm backdrop-blur-md">
        <div className="flex h-14 items-center gap-3 px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5" data-testid="shell-brand">
            <EmberMark />
            <span className="min-w-0">
              <span className="ember-glow-text block text-sm font-semibold leading-4 tracking-tight">
                Ember
              </span>
              <span className="block truncate text-[11px] leading-3 text-orange-200/35">
                Keep the fire lit
              </span>
            </span>
          </Link>

          <div ref={searchRef} className="relative hidden w-full max-w-xl md:block">
            <label className="sr-only" htmlFor="shell-search">
              Search
            </label>
            <input
              id="shell-search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search resources, services, and commands"
              className={`${inputClass} h-8 text-xs`}
              autoComplete="off"
              data-testid="shell-search"
            />
            {searchOpen && (
              <div className="absolute left-0 right-0 top-10 z-30 overflow-hidden rounded-lg border border-orange-950/70 bg-coal-950 shadow-2xl shadow-black/50 shadow-ember">
                <div className="border-b border-orange-950/60 px-3 py-2 text-xs uppercase tracking-wider text-ember-500/70">
                  {search.trim() ? 'Search results' : 'Common commands'}
                </div>
                <div className="max-h-80 overflow-y-auto p-1">
                  {searchResults.length === 0 ? (
                    <div className="px-3 py-6 text-center text-sm text-orange-200/40">
                      No matching services or commands.
                    </div>
                  ) : (
                    searchResults.map((item) => (
                      <button
                        key={item.href}
                        type="button"
                        onClick={() => goToSearchResult(item.href)}
                        className="flex w-full items-start gap-3 rounded px-3 py-2 text-left hover:bg-ember-950/50"
                      >
                        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded border border-orange-900/50 bg-coal-900 text-xs text-ember-400">
                          {item.short}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-orange-50">
                            {item.label}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-orange-200/40">
                            {item.group} / {item.description}
                          </span>
                        </span>
                        <span className="mt-1 text-xs text-orange-200/25">Enter</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span
              className="hidden rounded border border-orange-950/60 bg-coal-900/80 px-2 py-1 text-xs text-orange-200/50 md:inline"
              data-testid="shell-tenant"
              title="Active tenant"
            >
              {sessionState?.active_tenant?.name ?? 'No tenant'}
            </span>
            <span
              className="hidden rounded border border-orange-950/60 bg-coal-900/80 px-2 py-1 text-xs text-orange-200/60 sm:inline"
              data-testid="shell-user"
              title={sessionState?.user?.email ?? undefined}
            >
              {sessionState?.user
                ? `${sessionState.user.name} · ${sessionState.user.role}`
                : 'signed in'}
            </span>
            <button
              onClick={logout}
              className="rounded px-2 py-1 text-sm text-orange-200/50 hover:bg-ember-950/50 hover:text-ember-300"
              data-testid="shell-logout"
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <div className="flex">
        <aside
          className={`sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 border-r border-orange-950/60 bg-coal-950/70 transition-[width] duration-200 sm:block ${
            collapsed ? 'w-[4.25rem]' : 'w-72'
          }`}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-orange-950/60 px-3 py-3">
              {!collapsed && (
                <div className="min-w-0">
                  <div className="truncate text-xs uppercase tracking-[0.14em] text-ember-500/70">
                    Navigation
                  </div>
                  <div className="truncate text-sm font-medium text-orange-100">
                    {activeGroup?.label ?? 'Services'}
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => setCollapsed((value) => !value)}
                className="ml-auto grid h-8 w-8 place-items-center rounded border border-orange-950/60 text-sm text-orange-200/50 hover:bg-ember-950/40 hover:text-ember-300"
                aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
                title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              >
                {collapsed ? '>' : '<'}
              </button>
            </div>

            <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" data-testid="shell-nav">
              {NAV_GROUPS.map((group) => (
                <div key={group.id} className="mb-2" data-testid={`nav-group-${group.id}`}>
                  <button
                    type="button"
                    onClick={() => (collapsed ? setCollapsed(false) : toggleGroup(group.id))}
                    className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs font-medium uppercase tracking-wider transition ${
                      activeGroup?.id === group.id
                        ? 'bg-ember-500/10 text-ember-300'
                        : 'text-orange-200/40 hover:bg-coal-900 hover:text-orange-100/80'
                    }`}
                    title={group.label}
                    aria-expanded={!collapsed && openGroups[group.id]}
                    data-testid={`nav-group-toggle-${group.id}`}
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded border border-orange-950/60 bg-coal-900 text-[11px] normal-case tracking-normal text-orange-200/70">
                      {group.short}
                    </span>
                    {!collapsed && (
                      <>
                        <span className="min-w-0 flex-1 truncate">{group.label}</span>
                        <span className="text-orange-200/30">{openGroups[group.id] ? 'v' : '>'}</span>
                      </>
                    )}
                  </button>

                  {!collapsed && openGroups[group.id] && (
                    <div className="mt-1 space-y-1 pl-9">
                      {group.items.map((item) => {
                        const active = isActive(pathname, item.href);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            className={`block rounded px-3 py-2 text-sm transition ${
                              active
                                ? 'bg-ember-500/15 text-ember-200 shadow-ember-sm'
                                : 'text-orange-200/50 hover:bg-coal-900 hover:text-orange-50'
                            }`}
                            data-testid={`nav-link-${item.href.replace(/\//g, '-').replace(/^-/, '') || 'dashboard'}`}
                          >
                            <span className="block truncate">{item.label}</span>
                            {item.description && (
                              <span className="mt-0.5 block truncate text-xs text-orange-200/30">
                                {item.description}
                              </span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  )}

                  {collapsed && (
                    <div className="mt-1 space-y-1">
                      {group.items.map((item) => {
                        const active = isActive(pathname, item.href);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            className={`grid h-9 place-items-center rounded text-sm transition ${
                              active
                                ? 'bg-ember-500/15 text-ember-200'
                                : 'text-orange-200/40 hover:bg-coal-900 hover:text-orange-50'
                            }`}
                            title={item.label}
                          >
                            {item.short}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </nav>

            <div className="border-t border-orange-950/60 p-3">
              {collapsed ? (
                <div
                  className="grid h-8 place-items-center rounded border border-orange-950/60 text-xs text-ember-500/70"
                  title="Hearth"
                >
                  <EmberMark className="h-6 w-6 text-[9px]" />
                </div>
              ) : (
                <div className="rounded border border-orange-950/60 bg-gradient-to-br from-ember-950/40 to-coal-900/80 p-3">
                  <div className="text-xs uppercase tracking-[0.14em] text-ember-500/70">Hearth</div>
                  <div className="mt-1 truncate text-sm font-medium text-orange-100">Homelab sandbox</div>
                  <div className="mt-1 text-xs text-orange-200/35">SQLite control plane</div>
                </div>
              )}
            </div>
          </div>
        </aside>

        <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-orange-950/70 bg-coal-950/95 px-2 py-2 backdrop-blur sm:hidden">
          {NAV_GROUPS.flatMap((group) => group.items)
            .filter((item) => ['/', '/control-plane', '/hosts', '/workloads', '/volumes'].includes(item.href))
            .map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex-1 rounded px-2 py-1.5 text-center text-xs ${
                    active ? 'bg-ember-500/15 text-ember-200' : 'text-orange-200/40'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
        </nav>

        <main className="min-w-0 flex-1 px-4 py-6 pb-20 sm:px-6 sm:pb-8 lg:px-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
