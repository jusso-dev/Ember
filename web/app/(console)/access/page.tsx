'use client';

import { useEffect, useState } from 'react';
import {
  EmptyState,
  PageHeader,
  StatusBadge,
  buttonPrimaryClass,
  buttonSecondaryClass,
  formatRelative,
  inputClass,
  panelClass,
} from '@/components/ControlPlaneUI';
import { api, ApiError } from '@/lib/api';
import type { CreateTenantInvitationRequest } from '@/lib/types/CreateTenantInvitationRequest';
import type { TenantAccessSummary } from '@/lib/types/TenantAccessSummary';
import type { TenantInvitationSummary } from '@/lib/types/TenantInvitationSummary';

export default function AccessPage() {
  return <Access />;
}

function Access() {
  const [access, setAccess] = useState<TenantAccessSummary | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [createdInvite, setCreatedInvite] = useState<TenantInvitationSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reload() {
    api.get<TenantAccessSummary>('/api/tenants/current').then(setAccess).catch(() => {});
  }

  useEffect(() => {
    reload();
  }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setCreatedInvite(null);
    setBusy(true);
    try {
      const body: CreateTenantInvitationRequest = { email, role };
      const next = await api.post<TenantInvitationSummary>('/api/tenants/current/invitations', body);
      setCreatedInvite(next);
      setEmail('');
      setRole('viewer');
      reload();
    } catch (e) {
      setErr(readError(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteInvitation(id: string) {
    try {
      await api.del(`/api/tenants/current/invitations/${id}`);
      reload();
    } catch (e) {
      alert(readError(e));
    }
  }

  async function removeMember(userId: string) {
    if (!confirm('Remove this user from the tenant?')) return;
    try {
      await api.del(`/api/tenants/current/members/${userId}`);
      reload();
    } catch (e) {
      alert(readError(e));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Access control" eyebrow="Tenant administration" />

      {!access ? (
        <div className={`${panelClass} p-5 text-sm text-zinc-500`}>Loading access state...</div>
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className={`${panelClass} p-5`}>
              <div className="text-xs uppercase tracking-wider text-zinc-500">Current tenant</div>
              <div className="mt-2 text-2xl font-semibold text-zinc-50">{access.tenant.name}</div>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge state={access.tenant.role} />
                <span className="text-sm text-zinc-500">{access.tenant.slug}</span>
              </div>
              <p className="mt-4 text-sm text-zinc-500">
                Tenant roles scope what a user can do in this control plane. Infrastructure
                resources will be enforced against this active tenant.
              </p>
            </div>

            <form onSubmit={invite} className={`${panelClass} p-5`}>
              <div className="text-xs uppercase tracking-wider text-zinc-500">Invite user</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
                <input
                  type="email"
                  required
                  placeholder="person@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                />
                <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
                  <option value="admin">admin</option>
                  <option value="operator">operator</option>
                  <option value="viewer">viewer</option>
                  <option value="auditor">auditor</option>
                </select>
                <button type="submit" disabled={busy} className={buttonPrimaryClass}>
                  {busy ? 'Inviting...' : 'Invite'}
                </button>
              </div>
              {err && <p className="mt-3 text-sm text-red-400">{err}</p>}
              {createdInvite?.invite_url && (
                <div className="mt-4 rounded border border-zinc-800 bg-zinc-950/60 p-3">
                  <div className="text-xs uppercase tracking-wider text-zinc-500">Invite link</div>
                  <div className="mt-2 break-all font-mono text-xs text-zinc-300">
                    {createdInvite.invite_url}
                  </div>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(createdInvite.invite_url || '')}
                    className={`${buttonSecondaryClass} mt-3`}
                  >
                    Copy link
                  </button>
                </div>
              )}
            </form>
          </section>

          <section className={`${panelClass} overflow-hidden`}>
            <div className="border-b border-zinc-800 px-4 py-3">
              <h2 className="text-xs uppercase tracking-wider text-zinc-500">Members</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-2">User</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Joined</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {access.members.map((member) => (
                  <tr key={member.user_id} className="hover:bg-zinc-900/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-100">{member.name}</div>
                      <div className="text-xs text-zinc-500">{member.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge state={member.role} />
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{formatRelative(member.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => removeMember(member.user_id)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className={`${panelClass} overflow-hidden`}>
            <div className="border-b border-zinc-800 px-4 py-3">
              <h2 className="text-xs uppercase tracking-wider text-zinc-500">Pending invitations</h2>
            </div>
            {access.invitations.length === 0 ? (
              <EmptyState title="No pending invitations" body="Invite links appear here until they are accepted or expire." />
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-4 py-2">Email</th>
                    <th className="px-4 py-2">Role</th>
                    <th className="px-4 py-2">Expires</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {access.invitations.map((invite) => (
                    <tr key={invite.id} className="hover:bg-zinc-900/30">
                      <td className="px-4 py-3 text-zinc-200">{invite.email}</td>
                      <td className="px-4 py-3">
                        <StatusBadge state={invite.role} />
                      </td>
                      <td className="px-4 py-3 text-zinc-500">{formatRelative(invite.expires_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => deleteInvitation(invite.id)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className={`${panelClass} p-5`}>
            <div className="text-xs uppercase tracking-wider text-zinc-500">Role matrix</div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {access.role_matrix.map((role) => (
                <div key={role.role} className="rounded border border-zinc-800 bg-zinc-950/50 p-4">
                  <div className="flex items-center gap-2">
                    <StatusBadge state={role.role} />
                    <div className="text-sm text-zinc-500">{role.description}</div>
                  </div>
                  <ul className="mt-3 space-y-1 text-sm text-zinc-400">
                    {role.permissions.map((permission) => (
                      <li key={permission}>{permission}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function readError(e: unknown) {
  if (e instanceof ApiError) {
    try {
      return JSON.parse(e.body).error || e.body;
    } catch {
      return e.body;
    }
  }
  return String(e);
}
