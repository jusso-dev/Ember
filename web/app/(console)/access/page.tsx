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
import type { AuditWebhookSummary } from '@/lib/types/AuditWebhookSummary';
import type { CreateAuditWebhookRequest } from '@/lib/types/CreateAuditWebhookRequest';
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
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookFilter, setWebhookFilter] = useState('auth.login,host.delete,audit.verify');
  const [createdWebhook, setCreatedWebhook] = useState<AuditWebhookSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [webhookBusy, setWebhookBusy] = useState(false);
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

  async function createWebhook(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setCreatedWebhook(null);
    setWebhookBusy(true);
    try {
      const body: CreateAuditWebhookRequest = {
        url: webhookUrl,
        event_filter: webhookFilter
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      };
      const next = await api.post<AuditWebhookSummary>('/api/tenants/current/audit-webhooks', body);
      setCreatedWebhook(next);
      setWebhookUrl('');
      reload();
    } catch (e) {
      setErr(readError(e));
    } finally {
      setWebhookBusy(false);
    }
  }

  async function deleteWebhook(id: string) {
    if (!confirm('Remove this audit webhook?')) return;
    try {
      await api.del(`/api/tenants/current/audit-webhooks/${id}`);
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

          <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <form onSubmit={createWebhook} className={`${panelClass} p-5`}>
              <div className="text-xs uppercase tracking-wider text-zinc-500">Audit webhooks</div>
              <p className="mt-2 text-sm text-zinc-500">
                Send high-signal security events to SIEM, SOAR, or incident workflows with signed JSON payloads.
              </p>
              <div className="mt-4 space-y-3">
                <input
                  type="url"
                  required
                  placeholder="https://hooks.example.com/ember-audit"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className={inputClass}
                />
                <input
                  value={webhookFilter}
                  onChange={(e) => setWebhookFilter(e.target.value)}
                  placeholder="auth.login,host.delete,audit.verify"
                  className={inputClass}
                />
                <button type="submit" disabled={webhookBusy} className={buttonPrimaryClass}>
                  {webhookBusy ? 'Creating...' : 'Create webhook'}
                </button>
              </div>
              {createdWebhook?.secret_once && (
                <div className="mt-4 rounded border border-amber-700/40 bg-amber-500/5 p-3">
                  <div className="text-xs uppercase tracking-wider text-amber-300">Signing secret</div>
                  <div className="mt-2 break-all font-mono text-xs text-amber-100">
                    {createdWebhook.secret_once}
                  </div>
                </div>
              )}
            </form>

            <div className={`${panelClass} overflow-hidden`}>
              <div className="border-b border-zinc-800 px-4 py-3">
                <h2 className="text-xs uppercase tracking-wider text-zinc-500">Configured destinations</h2>
              </div>
              {access.audit_webhooks.length === 0 ? (
                <EmptyState
                  title="No audit webhooks"
                  body="Security event delivery destinations appear here after creation."
                />
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-500">
                    <tr>
                      <th className="px-4 py-2">Destination</th>
                      <th className="px-4 py-2">Events</th>
                      <th className="px-4 py-2">Health</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {access.audit_webhooks.map((webhook) => (
                      <tr key={webhook.id} className="align-top hover:bg-zinc-900/30">
                        <td className="max-w-xs px-4 py-3">
                          <div className="truncate font-mono text-xs text-zinc-200" title={webhook.url}>
                            {webhook.url}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">
                            created {formatRelative(webhook.created_at)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-400">
                          {webhook.event_filter.length ? webhook.event_filter.join(', ') : 'all audit actions'}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge state={webhook.failure_count ? 'error' : 'ok'} />
                          {webhook.last_error && (
                            <div className="mt-1 max-w-xs truncate text-xs text-red-300" title={webhook.last_error}>
                              {webhook.last_error}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => deleteWebhook(webhook.id)}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
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
