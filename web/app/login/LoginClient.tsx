'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonPrimaryClass, inputClass, panelClass } from '@/components/ControlPlaneUI';
import { api, ApiError } from '@/lib/api';
import type { SessionInfo } from '@/lib/types/SessionInfo';
import type { CreateFirstUserRequest } from '@/lib/types/CreateFirstUserRequest';
import type { LoginRequest } from '@/lib/types/LoginRequest';

export default function LoginClient({ initialMode }: { initialMode: 'setup' | 'login' }) {
  const router = useRouter();
  const mode = initialMode;
  const [name, setName] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (mode === 'setup' && password !== confirmPassword) {
      setErr('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'setup') {
        const body: CreateFirstUserRequest = { name, email, password, tenant_name: tenantName };
        await api.post<SessionInfo>('/api/auth/setup', body);
      } else {
        const body: LoginRequest = { email, password };
        await api.post<SessionInfo>('/api/auth/login', body);
      }
      router.replace('/');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setErr('Email or password is incorrect.');
      } else if (e instanceof ApiError && e.body) {
        setErr(readApiError(e.body));
      } else {
        setErr(String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  const setup = mode === 'setup';

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form
        onSubmit={submit}
        className={`${panelClass} w-full max-w-md space-y-4 p-6`}
      >
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500">Control plane</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {setup ? 'Create owner account' : 'Sign in to Ember'}
          </h1>
        </div>
        <p className="text-sm text-zinc-500">
          {setup
            ? 'This is the first user for this control plane. The account will receive the owner role.'
            : 'Use your Ember user account to access this control plane.'}
        </p>
        {setup && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs uppercase tracking-wider text-zinc-500">Name</span>
              <input
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`${inputClass} mt-1 py-2`}
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wider text-zinc-500">Tenant name</span>
              <input
                required
                placeholder="Homelab"
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                className={`${inputClass} mt-1 py-2`}
              />
            </label>
          </div>
        )}
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-zinc-500">Email</span>
          <input
            type="email"
            autoFocus={!setup}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${inputClass} mt-1 py-2`}
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-zinc-500">Password</span>
          <input
            type="password"
            required
            minLength={setup ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} mt-1 py-2`}
          />
        </label>
        {setup && (
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-zinc-500">Confirm password</span>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={`${inputClass} mt-1 py-2`}
            />
          </label>
        )}
        {setup && (
          <div className="rounded border border-zinc-800 bg-zinc-950/50 p-3 text-sm text-zinc-500">
            Owner can manage users, roles, MFA policy, hosts, workloads, volumes, and enrollment tokens.
          </div>
        )}
        {err && <p className="text-sm text-red-400">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className={`${buttonPrimaryClass} w-full py-2`}
        >
          {busy ? 'Please wait...' : setup ? 'Create account' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

function readApiError(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: string };
    return parsed.error || body;
  } catch {
    return body;
  }
}
