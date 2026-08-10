'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmberMark, buttonPrimaryClass, inputClass, panelClass } from '@/components/ControlPlaneUI';
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
    <main className="ember-hearth grid min-h-screen place-items-center px-4" data-testid="login-page">
      <form
        onSubmit={submit}
        className={`${panelClass} w-full max-w-md space-y-4 p-6 shadow-ember`}
        data-testid={setup ? 'setup-form' : 'login-form'}
      >
        <div className="flex items-start gap-3">
          <EmberMark className="h-10 w-10 text-base" />
          <div>
            <div className="text-xs uppercase tracking-[0.14em] text-ember-500/80">Control plane</div>
            <h1
              className="mt-1 text-2xl font-semibold tracking-tight text-orange-50"
              data-testid="auth-heading"
            >
              {setup
                ? 'Light the first fire'
                : mfaStep
                  ? 'Prove the spark'
                  : 'Sign in to Ember'}
            </h1>
          </div>
        </div>
        <p className="text-sm text-orange-200/45">
          {setup
            ? 'This is the first user for this control plane. The account will receive the owner role.'
            : mfaStep
              ? 'Enter the 6-digit code from your authenticator app, or a recovery code.'
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
                data-testid="setup-name"
                name="name"
                autoComplete="name"
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
                data-testid="setup-tenant"
                name="tenant_name"
              />
            </label>
          </div>
        )}
        {!mfaStep && (
          <>
            <label className="block">
              <span className="text-xs uppercase tracking-wider text-zinc-500">Email</span>
              <input
                type="email"
                autoFocus={!setup}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`${inputClass} mt-1 py-2`}
                data-testid="auth-email"
                name="email"
                autoComplete="email"
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
                data-testid="auth-password"
                name="password"
                autoComplete={setup ? 'new-password' : 'current-password'}
              />
            </label>
          </>
        )}
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
              data-testid="setup-confirm-password"
              name="confirm_password"
              autoComplete="new-password"
            />
          </label>
        )}
        {mfaStep && (
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-zinc-500">Authenticator code</span>
            <input
              autoFocus
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              className={`${inputClass} mt-1 py-2`}
              data-testid="auth-totp"
              name="totp_code"
              placeholder="123456"
            />
          </label>
        )}
        {setup && (
          <div className="rounded border border-orange-950/60 bg-coal-950/50 p-3 text-sm text-orange-200/45">
            Owner can manage users, roles, MFA policy, hosts, workloads, volumes, and enrollment tokens.
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
          {busy ? 'Please wait...' : setup ? 'Create account' : mfaStep ? 'Verify and sign in' : 'Sign in'}
        </button>
        {mfaStep && (
          <button
            type="button"
            className="w-full text-center text-xs text-orange-200/40 hover:text-ember-300"
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
