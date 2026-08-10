'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmberMark, buttonPrimaryClass, inputClass, labelClass, panelClass } from '@/components/ControlPlaneUI';
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
  const [totpCode, setTotpCode] = useState('');
  const [mfaStep, setMfaStep] = useState(false);
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
        const body: LoginRequest = {
          email,
          password,
          totp_code: mfaStep && totpCode.trim() ? totpCode.trim() : null,
        };
        await api.post<SessionInfo>('/api/auth/login', body);
      }
      router.replace('/');
    } catch (e) {
      if (e instanceof ApiError && e.body && readApiError(e.body) === 'mfa_required') {
        setMfaStep(true);
        setErr(null);
      } else if (e instanceof ApiError && e.status === 401) {
        setErr(mfaStep ? 'Invalid MFA code.' : 'Email or password is incorrect.');
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
    <main className="ember-auth-stage grid min-h-screen place-items-center px-4" data-testid="login-page">
      <form
        onSubmit={submit}
        className={`${panelClass} w-full max-w-md space-y-4 p-6`}
        data-testid={setup ? 'setup-form' : 'login-form'}
      >
        <div className="flex items-start gap-3">
          <EmberMark className="h-9 w-9 text-sm" />
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-zinc-500">
              Control plane
            </div>
            <h1
              className="mt-0.5 text-xl font-semibold tracking-tight text-zinc-50"
              data-testid="auth-heading"
            >
              {setup ? 'Create owner account' : mfaStep ? 'Multi-factor authentication' : 'Sign in to Ember'}
            </h1>
          </div>
        </div>
        <p className="text-sm text-zinc-500">
          {setup
            ? 'First user on this control plane receives the owner role for the initial tenant.'
            : mfaStep
              ? 'Enter the 6-digit authenticator code, or a recovery code.'
              : 'Sign in with your Ember account credentials.'}
        </p>
        {setup && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}>Name</span>
              <input
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`${inputClass} py-2`}
                data-testid="setup-name"
                name="name"
                autoComplete="name"
              />
            </label>
            <label className="block">
              <span className={labelClass}>Tenant name</span>
              <input
                required
                placeholder="Homelab"
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                className={`${inputClass} py-2`}
                data-testid="setup-tenant"
                name="tenant_name"
              />
            </label>
          </div>
        )}
        {!mfaStep && (
          <>
            <label className="block">
              <span className={labelClass}>Email</span>
              <input
                type="email"
                autoFocus={!setup}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`${inputClass} py-2`}
                data-testid="auth-email"
                name="email"
                autoComplete="email"
              />
            </label>
            <label className="block">
              <span className={labelClass}>Password</span>
              <input
                type="password"
                required
                minLength={setup ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass} py-2`}
                data-testid="auth-password"
                name="password"
                autoComplete={setup ? 'new-password' : 'current-password'}
              />
            </label>
          </>
        )}
        {setup && (
          <label className="block">
            <span className={labelClass}>Confirm password</span>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={`${inputClass} py-2`}
              data-testid="setup-confirm-password"
              name="confirm_password"
              autoComplete="new-password"
            />
          </label>
        )}
        {mfaStep && (
          <label className="block">
            <span className={labelClass}>Authenticator code</span>
            <input
              autoFocus
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              className={`${inputClass} py-2 font-mono tracking-widest`}
              data-testid="auth-totp"
              name="totp_code"
              placeholder="123456"
            />
          </label>
        )}
        {setup && (
          <div className="rounded-control border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-500">
            Owner can manage users, roles, MFA, hosts, workloads, volumes, and enrollment tokens.
          </div>
        )}
        {err && (
          <p className="text-sm text-red-400" data-testid="auth-error" role="alert">
            {err}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className={`${buttonPrimaryClass} w-full py-2`}
          data-testid="auth-submit"
        >
          {busy ? 'Please wait…' : setup ? 'Create account' : mfaStep ? 'Verify and sign in' : 'Sign in'}
        </button>
        {mfaStep && (
          <button
            type="button"
            className="w-full text-center text-xs text-zinc-500 transition-colors duration-short hover:text-zinc-300"
            onClick={() => {
              setMfaStep(false);
              setTotpCode('');
            }}
          >
            Back to email and password
          </button>
        )}
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
