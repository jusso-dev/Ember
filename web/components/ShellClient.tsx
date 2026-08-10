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
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
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

  return (
    <div className="min-h-screen bg-zinc-950" data-testid="app-shell">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950">
        <div className="flex h-12 items-center gap-3 px-3 sm:px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5" data-testid="shell-brand">
            <EmberMark className="h-7 w-7 text-xs" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-4 tracking-tight text-zinc-50">
                Ember
              </span>
              <span className="block truncate text-[11px] leading-3 text-zinc-500">Control plane</span>
            </span>
          </Link>

          <div ref={searchRef} className="relative hidden w-full max-w-md flex-1 md:block lg:max-w-lg">
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
              placeholder="Search resources and pages"
              className={`${inputClass} h-8 text-xs`}
              autoComplete="off"
              data-testid="shell-search"
            />
            {searchOpen && (
              <div className="absolute left-0 right-0 top-9 z-30 overflow-hidden rounded-panel border border-zinc-700 bg-zinc-900 shadow-lg shadow-black/40">
                <div className="border-b border-zinc-800 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-zinc-500">
                  {search.trim() ? 'Results' : 'Quick links'}
                </div>
                <div className="max-h-80 overflow-y-auto p-1">
                  {searchResults.length === 0 ? (
                    <div className="px-3 py-6 text-center text-sm text-zinc-500">No matches.</div>
                  ) : (
                    searchResults.map((item) => (
                      <button
                        key={item.href}
                        type="button"
                        onClick={() => goToSearchResult(item.href)}
                        className="flex w-full items-start gap-3 rounded-control px-3 py-2 text-left transition-colors duration-short hover:bg-zinc-800"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-zinc-100">
                            {item.label}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-zinc-500">
                            {item.group}
                            {item.description ? ` · ${item.description}` : ''}
                          </span>
                        </span>
                        <span className="mt-1 font-mono text-[10px] text-zinc-600">↵</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span
              className="hidden rounded-control border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-400 md:inline"
              data-testid="shell-tenant"
              title="Active tenant"
            >
              {sessionState?.active_tenant?.name ?? 'No tenant'}
            </span>
            <span
              className="hidden max-w-[12rem] truncate rounded-control border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-400 sm:inline"
              data-testid="shell-user"
              title={sessionState?.user?.email ?? undefined}
            >
              {sessionState?.user
                ? `${sessionState.user.name} · ${sessionState.user.role}`
                : 'signed in'}
            </span>
            <button
              onClick={logout}
              className="rounded-control px-2 py-1 text-sm text-zinc-400 transition-colors duration-short hover:bg-zinc-900 hover:text-zinc-100"
              data-testid="shell-logout"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside
          className={`sticky top-12 hidden h-[calc(100vh-3rem)] shrink-0 border-r border-zinc-800 bg-zinc-950 transition-[width] duration-short sm:block ${
            collapsed ? 'w-14' : 'w-60'
          }`}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-end border-b border-zinc-800 px-2 py-2">
              <button
                type="button"
                onClick={() => setCollapsed((value) => !value)}
                className="grid h-7 w-7 place-items-center rounded-control border border-zinc-800 text-xs text-zinc-400 transition-colors duration-short hover:bg-zinc-900 hover:text-zinc-100"
                aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
                title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              >
                {collapsed ? '›' : '‹'}
              </button>
            </div>

            <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2" data-testid="shell-nav">
              {NAV_GROUPS.map((group) => (
                <div key={group.id} className="mb-3" data-testid={`nav-group-${group.id}`}>
                  {!collapsed && (
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.id)}
                      className="mb-1 flex w-full items-center gap-1 px-2 py-1 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-zinc-500 transition-colors duration-short hover:text-zinc-300"
                      aria-expanded={openGroups[group.id]}
                      data-testid={`nav-group-toggle-${group.id}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{group.label}</span>
                      <span className="text-zinc-600">{openGroups[group.id] ? '−' : '+'}</span>
                    </button>
                  )}

                  {collapsed && (
                    <div className="mb-1 px-1 text-center text-[9px] font-medium uppercase tracking-wide text-zinc-600">
                      {group.label.slice(0, 1)}
                    </div>
                  )}

                  {(!collapsed ? openGroups[group.id] : true) && (
                    <div className="space-y-0.5">
                      {group.items.map((item) => {
                        const active = isActive(pathname, item.href);
                        if (collapsed) {
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              className={`grid h-9 place-items-center rounded-control text-xs font-medium transition-colors duration-short ${
                                active
                                  ? 'bg-ember-500/15 text-ember-300'
                                  : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'
                              }`}
                              title={item.label}
                            >
                              {item.short}
                            </Link>
                          );
                        }
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            className={`block rounded-control px-2.5 py-1.5 text-sm transition-colors duration-short ${
                              active
                                ? 'bg-zinc-800 text-zinc-50'
                                : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
                            }`}
                            data-testid={`nav-link-${item.href.replace(/\//g, '-').replace(/^-/, '') || 'dashboard'}`}
                          >
                            <span className="block truncate">{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </nav>

            <div className="border-t border-zinc-800 p-2">
              {collapsed ? (
                <div
                  className="grid h-8 place-items-center rounded-control border border-zinc-800 text-zinc-500"
                  title="Environment"
                >
                  <span className="font-mono text-[10px]">ENV</span>
                </div>
              ) : (
                <div className="rounded-control border border-zinc-800 bg-zinc-900/50 px-2.5 py-2">
                  <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-zinc-500">
                    Environment
                  </div>
                  <div className="mt-0.5 truncate text-xs text-zinc-300">Homelab sandbox</div>
                  <div className="mt-0.5 font-mono text-[10px] text-zinc-600">SQLite</div>
                </div>
              )}
            </div>
          </div>
        </aside>

        <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-zinc-800 bg-zinc-950 px-1 py-1.5 sm:hidden">
          {NAV_GROUPS.flatMap((group) => group.items)
            .filter((item) => ['/', '/control-plane', '/hosts', '/workloads', '/volumes'].includes(item.href))
            .map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex-1 rounded-control px-1 py-1.5 text-center text-[11px] ${
                    active ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-500'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
        </nav>

        <main className="min-w-0 flex-1 bg-zinc-950 px-4 py-5 pb-20 sm:px-6 sm:pb-8 lg:px-8">
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
