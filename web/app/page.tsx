'use client';

import { useEffect, useState } from 'react';
import type { Health } from '@/lib/types/Health';
import { api } from '@/lib/api';

export default function Page() {
  const [data, setData] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<Health>('/api/health')
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <main className="mx-auto max-w-2xl p-8 font-mono">
      <h1 className="text-3xl font-semibold tracking-tight">Ember</h1>
      <p className="mt-2 text-zinc-400">mini-cloud control plane</p>

      <section className="mt-8 rounded-lg border border-zinc-800 p-4">
        <h2 className="text-xs uppercase tracking-wider text-zinc-500">Control plane</h2>
        {err && <p className="mt-2 text-red-400">error: {err}</p>}
        {!err && !data && <p className="mt-2 text-zinc-500">checking…</p>}
        {data && (
          <p className="mt-2">
            status: <span className="text-emerald-400">{data.status}</span>{' '}
            <span className="text-zinc-500">(v{data.version})</span>
          </p>
        )}
      </section>
    </main>
  );
}
