'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EmberMark, buttonPrimaryClass, inputClass, labelClass, panelClass } from '@/components/ControlPlaneUI';
import { api, ApiError } from '@/lib/api';
import type { AcceptInvitationRequest } from '@/lib/types/AcceptInvitationRequest';
import type { InvitationPreview } from '@/lib/types/InvitationPreview';
import type { SessionInfo } from '@/lib/types/SessionInfo';

export default function InviteClient() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoadErr('Missing invitation token.');
      return;
    }
    api
      .get<InvitationPreview>(`/api/invitations/preview?token=${encodeURIComponent(token)}`)
      .then(setPreview)
      .catch((e) => setLoadErr(e instanceof ApiError ? e.body || String(e) : String(e)));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== confirm) {
      setErr('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setErr('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      const body: AcceptInvitationRequest = { token, name, password };
      await api.post<SessionInfo>('/api/invitations/accept', body);
      router.replace('/');
    } catch (e) {
      setErr(e instanceof ApiError ? e.body || String(e) : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadErr) {
    return (
      <main className="ember-auth-stage grid min-h-screen place-items-center px-4" data-testid="invite-page">
        <div className={`${panelClass} w-full max-w-md p-6`}>
          <h1 className="text-lg font-semibold text-zinc-50">Invitation unavailable</h1>
          <p className="mt-2 text-sm text-red-400" data-testid="invite-error">
            {loadErr}
          </p>
        </div>
      </main>
    );
  }

  if (!preview) {
    return (
      <main
        className="ember-auth-stage grid min-h-screen place-items-center text-zinc-500"
        data-testid="invite-page"
      >
        Loading invitation…
      </main>
    );
  }

  return (
    <main className="ember-auth-stage grid min-h-screen place-items-center px-4" data-testid="invite-page">
      <form
        onSubmit={submit}
        className={`${panelClass} w-full max-w-md space-y-4 p-6`}
        data-testid="invite-form"
      >
        <div className="flex items-start gap-3">
          <EmberMark className="h-9 w-9 text-sm" />
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-zinc-500">
              Invitation
            </div>
            <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-zinc-50">Accept invitation</h1>
          </div>
        </div>
        <dl className="rounded-control border border-zinc-800 bg-zinc-950/60 p-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-500">Tenant</dt>
            <dd className="font-medium text-zinc-100">{preview.tenant_name}</dd>
          </div>
          <div className="mt-2 flex justify-between gap-3">
            <dt className="text-zinc-500">Email</dt>
            <dd className="font-medium text-zinc-100">{preview.email}</dd>
          </div>
          <div className="mt-2 flex justify-between gap-3">
            <dt className="text-zinc-500">Role</dt>
            <dd className="font-medium capitalize text-zinc-100">{preview.role}</dd>
          </div>
        </dl>
        <label className="block">
          <span className={labelClass}>Your name</span>
          <input
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${inputClass} py-2`}
            data-testid="invite-name"
          />
        </label>
        <label className="block">
          <span className={labelClass}>Password</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} py-2`}
            data-testid="invite-password"
            autoComplete="new-password"
          />
        </label>
        <label className="block">
          <span className={labelClass}>Confirm password</span>
          <input
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={`${inputClass} py-2`}
            data-testid="invite-confirm"
            autoComplete="new-password"
          />
        </label>
        {err && (
          <p className="text-sm text-red-400" role="alert" data-testid="invite-error">
            {err}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className={`${buttonPrimaryClass} w-full py-2`}
          data-testid="invite-submit"
        >
          {busy ? 'Joining…' : 'Join tenant'}
        </button>
      </form>
    </main>
  );
}
