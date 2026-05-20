'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { SessionInfo } from '@/lib/types/SessionInfo';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/hosts', label: 'Hosts' },
  { href: '/workloads', label: 'Workloads' },
  { href: '/volumes', label: 'Volumes' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<'loading' | 'ok' | 'redirecting'>('loading');

  useEffect(() => {
    let cancelled = false;
    api
      .get<SessionInfo>('/api/auth/session')
      .then((s) => {
        if (cancelled) return;
        if (s.authenticated) {
          setStatus('ok');
        } else {
          setStatus('redirecting');
          router.replace('/login');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('redirecting');
        router.replace('/login');
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function logout() {
    try {
      await api.post('/api/auth/logout');
    } finally {
      router.replace('/login');
    }
  }

  if (status !== 'ok') {
    return <div className="p-8 text-zinc-500">loading…</div>;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-800 bg-zinc-900/50">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Ember
          </Link>
          <nav className="flex gap-1">
            {NAV.map((n) => {
              const active = n.href === '/' ? pathname === '/' : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded px-3 py-1 text-sm ${
                    active
                      ? 'bg-zinc-800 text-zinc-50'
                      : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100'
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto">
            <button
              onClick={logout}
              className="text-sm text-zinc-400 hover:text-zinc-100"
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
