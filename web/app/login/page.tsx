'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { SessionInfo } from '@/lib/types/SessionInfo';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.post<SessionInfo>('/api/auth/login', { password });
      router.replace('/');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setErr('Wrong password.');
      } else if (e instanceof ApiError && e.status === 400) {
        setErr('Admin password is not configured on the server.');
      } else {
        setErr(String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-6"
      >
        <h1 className="text-2xl font-semibold tracking-tight">Ember</h1>
        <p className="text-sm text-zinc-500">Sign in to the control plane.</p>
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-zinc-500">Admin password</span>
          <input
            type="password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-zinc-500"
          />
        </label>
        {err && <p className="text-sm text-red-400">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
