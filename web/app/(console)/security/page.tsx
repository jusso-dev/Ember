'use client';

import { useEffect, useState } from 'react';
import {
  EmptyState,
  PageHeader,
  buttonPrimaryClass,
  buttonSecondaryClass,
  formatRelative,
  inputClass,
  panelClass,
} from '@/components/ControlPlaneUI';
import { api, ApiError } from '@/lib/api';
import type { ApiTokenSummary } from '@/lib/types/ApiTokenSummary';
import type { MfaSetupResponse } from '@/lib/types/MfaSetupResponse';
import type { MfaStatus } from '@/lib/types/MfaStatus';
import type { RegistryCredentialSummary } from '@/lib/types/RegistryCredentialSummary';
import type { SecretSummary } from '@/lib/types/SecretSummary';
import type { TenantPolicy } from '@/lib/types/TenantPolicy';

export default function SecurityPage() {
  return <Security />;
}

function Security() {
  const [mfa, setMfa] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [totp, setTotp] = useState('');
  const [policy, setPolicy] = useState<TenantPolicy | null>(null);
  const [allowlistText, setAllowlistText] = useState('');
  const [portsText, setPortsText] = useState('');
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [tokenName, setTokenName] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [secretName, setSecretName] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [regs, setRegs] = useState<RegistryCredentialSummary[]>([]);
  const [regHost, setRegHost] = useState('');
  const [regUser, setRegUser] = useState('');
  const [regPass, setRegPass] = useState('');
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    api.get<MfaStatus>('/api/auth/mfa').then(setMfa).catch(() => {});
    api.get<TenantPolicy>('/api/tenants/current/policy').then((p) => {
      setPolicy(p);
      setAllowlistText(p.image_allowlist.join('\n'));
      setPortsText(p.allowed_host_ports.join(', '));
    }).catch(() => {});
    api.get<ApiTokenSummary[]>('/api/tenants/current/tokens').then(setTokens).catch(() => {});
    api.get<SecretSummary[]>('/api/tenants/current/secrets').then(setSecrets).catch(() => {});
    api
      .get<RegistryCredentialSummary[]>('/api/tenants/current/registry-credentials')
      .then(setRegs)
      .catch(() => {});
  }

  useEffect(() => {
    reload();
  }, []);

  async function beginMfa() {
    setErr(null);
    setBusy(true);
    try {
      const res = await api.post<MfaSetupResponse>('/api/auth/mfa/setup');
      setSetup(res);
    } catch (e) {
      setErr(readError(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmMfa(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.post('/api/auth/mfa/confirm', { totp_code: totp });
      setSetup(null);
      setTotp('');
      reload();
    } catch (e) {
      setErr(readError(e));
    } finally {
      setBusy(false);
    }
  }

  async function disableMfa() {
    const code = prompt('Enter current TOTP to disable MFA');
    if (!code) return;
    try {
      await api.post('/api/auth/mfa/disable', { totp_code: code });
      reload();
    } catch (e) {
      alert(readError(e));
    }
  }

  async function savePolicy(e: React.FormEvent) {
    e.preventDefault();
    if (!policy) return;
    setBusy(true);
    setErr(null);
    try {
      const image_allowlist = allowlistText
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const allowed_host_ports = portsText
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => !Number.isNaN(n) && n > 0 && n < 65536);
      const next = await api.put<TenantPolicy>('/api/tenants/current/policy', {
        ...policy,
        image_allowlist,
        allowed_host_ports,
      });
      setPolicy(next);
    } catch (e) {
      setErr(readError(e));
    } finally {
      setBusy(false);
    }
  }

  async function createToken(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setCreatedToken(null);
    try {
      const t = await api.post<ApiTokenSummary>('/api/tenants/current/tokens', {
        name: tokenName,
        role: 'operator',
        expires_days: 90,
      });
      setCreatedToken(t.token_once);
      setTokenName('');
      reload();
    } catch (e) {
      setErr(readError(e));
    } finally {
      setBusy(false);
    }
  }

  async function createSecret(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/tenants/current/secrets', { name: secretName, value: secretValue });
      setSecretName('');
      setSecretValue('');
      reload();
    } catch (e) {
      setErr(readError(e));
    } finally {
      setBusy(false);
    }
  }

  async function createReg(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/tenants/current/registry-credentials', {
        registry: regHost,
        username: regUser,
        password: regPass,
      });
      setRegHost('');
      setRegUser('');
      setRegPass('');
      reload();
    } catch (e) {
      setErr(readError(e));
    } finally {
      setBusy(false);
    }
  }

  async function runBackup() {
    setBackupMsg(null);
    try {
      const res = await api.post<{ path: string; bytes: number; created_at: string }>('/api/admin/backup');
      setBackupMsg(`Saved ${res.bytes} bytes → ${res.path}`);
    } catch (e) {
      setErr(readError(e));
    }
  }

  return (
    <div className="space-y-8" data-testid="security-page">
      <PageHeader title="Security & policy" eyebrow="Tenant controls" />
      {err && (
        <p className="text-sm text-red-400" role="alert">
          {err}
        </p>
      )}

      <section className={`${panelClass} space-y-4 p-5`} data-testid="security-mfa">
        <h2 className="text-sm font-medium text-zinc-100">Multi-factor authentication</h2>
        <p className="text-sm text-zinc-500">
          Status:{' '}
          <span className="text-zinc-200" data-testid="mfa-status">
            {mfa?.enabled ? 'enabled' : 'disabled'}
          </span>
        </p>
        {!mfa?.enabled && !setup && (
          <button type="button" className={buttonPrimaryClass} onClick={beginMfa} disabled={busy} data-testid="mfa-setup">
            Set up TOTP
          </button>
        )}
        {setup && (
          <form onSubmit={confirmMfa} className="space-y-3">
            <p className="text-sm text-zinc-400">
              Scan or enter secret <code className="text-zinc-200">{setup.secret}</code>
            </p>
            <div className="break-all font-mono text-xs text-zinc-500">{setup.otpauth_url}</div>
            <div>
              <div className="text-xs uppercase tracking-wider text-amber-300">Recovery codes (save now)</div>
              <ul className="mt-1 grid grid-cols-2 gap-1 font-mono text-xs text-zinc-300">
                {setup.recovery_codes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <input
              required
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              placeholder="6-digit code"
              className={inputClass}
              data-testid="mfa-confirm-code"
            />
            <button type="submit" className={buttonPrimaryClass} disabled={busy} data-testid="mfa-confirm">
              Confirm MFA
            </button>
          </form>
        )}
        {mfa?.enabled && (
          <button type="button" className={buttonSecondaryClass} onClick={disableMfa} data-testid="mfa-disable">
            Disable MFA
          </button>
        )}
      </section>

      {policy && (
        <form onSubmit={savePolicy} className={`${panelClass} space-y-4 p-5`} data-testid="security-policy">
          <h2 className="text-sm font-medium text-zinc-100">Admission policy</h2>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={policy.deny_latest_tag}
              onChange={(e) => setPolicy({ ...policy, deny_latest_tag: e.target.checked })}
              data-testid="policy-deny-latest"
            />
            Deny <code>:latest</code> image tags
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={policy.require_mfa_admins}
              onChange={(e) => setPolicy({ ...policy, require_mfa_admins: e.target.checked })}
            />
            Require MFA for owner/admin (enforced at login when enabled on account)
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-zinc-500">Image allowlist (one prefix per line; empty = any)</span>
            <textarea
              value={allowlistText}
              onChange={(e) => setAllowlistText(e.target.value)}
              rows={3}
              className={`${inputClass} mt-1 font-mono`}
              data-testid="policy-allowlist"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-zinc-500">Allowed host ports (comma-separated; empty = any)</span>
            <input
              value={portsText}
              onChange={(e) => setPortsText(e.target.value)}
              className={`${inputClass} mt-1`}
              data-testid="policy-ports"
              placeholder="80, 443, 8080"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumField
              label="Max workloads"
              value={policy.max_workloads}
              onChange={(v) => setPolicy({ ...policy, max_workloads: v })}
            />
            <NumField
              label="Max volumes"
              value={policy.max_volumes}
              onChange={(v) => setPolicy({ ...policy, max_volumes: v })}
            />
            <NumField
              label="Max volume MB total"
              value={policy.max_volume_mb_total}
              onChange={(v) => setPolicy({ ...policy, max_volume_mb_total: v })}
            />
          </div>
          <button type="submit" className={buttonPrimaryClass} disabled={busy} data-testid="policy-save">
            Save policy
          </button>
        </form>
      )}

      <section className={`${panelClass} space-y-4 p-5`} data-testid="security-tokens">
        <h2 className="text-sm font-medium text-zinc-100">API tokens</h2>
        <form onSubmit={createToken} className="flex flex-wrap items-end gap-2">
          <label className="block min-w-[12rem] flex-1">
            <span className="text-xs uppercase tracking-wider text-zinc-500">Name</span>
            <input
              required
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              className={`${inputClass} mt-1`}
              data-testid="token-name"
            />
          </label>
          <button type="submit" className={buttonPrimaryClass} disabled={busy} data-testid="token-create">
            Create token
          </button>
        </form>
        {createdToken && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm" data-testid="token-once">
            <div className="text-xs uppercase tracking-wider text-amber-300">Copy now — shown once</div>
            <code className="mt-1 block break-all text-zinc-100">{createdToken}</code>
          </div>
        )}
        {tokens.length === 0 ? (
          <EmptyState title="No API tokens" body="Create a token for CI deploys without a browser session." />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Prefix</th>
                <th className="px-2 py-2">Role</th>
                <th className="px-2 py-2">Created</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className="border-t border-zinc-800">
                  <td className="px-2 py-2 text-zinc-200">{t.name}</td>
                  <td className="px-2 py-2 font-mono text-xs text-zinc-400">{t.token_prefix}…</td>
                  <td className="px-2 py-2 capitalize text-zinc-300">{t.role}</td>
                  <td className="px-2 py-2 text-zinc-500">{formatRelative(t.created_at)}</td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      className="text-xs text-red-400"
                      onClick={async () => {
                        await api.del(`/api/tenants/current/tokens/${t.id}`);
                        reload();
                      }}
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

      <section className={`${panelClass} space-y-4 p-5`} data-testid="security-secrets">
        <h2 className="text-sm font-medium text-zinc-100">Secrets vault</h2>
        <p className="text-xs text-zinc-500">
          Reference in workload env as <code className="text-zinc-300">secret:NAME</code>. Values encrypted at rest.
        </p>
        <form onSubmit={createSecret} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            required
            placeholder="NAME"
            value={secretName}
            onChange={(e) => setSecretName(e.target.value)}
            className={inputClass}
            data-testid="secret-name"
          />
          <input
            required
            type="password"
            placeholder="value"
            value={secretValue}
            onChange={(e) => setSecretValue(e.target.value)}
            className={inputClass}
            data-testid="secret-value"
          />
          <button type="submit" className={buttonPrimaryClass} disabled={busy} data-testid="secret-create">
            Store
          </button>
        </form>
        <ul className="space-y-1 text-sm">
          {secrets.map((s) => (
            <li key={s.id} className="flex items-center justify-between border-t border-zinc-800 py-2">
              <span className="font-mono text-zinc-200">{s.name}</span>
              <button
                type="button"
                className="text-xs text-red-400"
                onClick={async () => {
                  await api.del(`/api/tenants/current/secrets/${s.id}`);
                  reload();
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${panelClass} space-y-4 p-5`} data-testid="security-registry">
        <h2 className="text-sm font-medium text-zinc-100">Registry credentials</h2>
        <form onSubmit={createReg} className="grid gap-2 sm:grid-cols-4">
          <input
            required
            placeholder="ghcr.io"
            value={regHost}
            onChange={(e) => setRegHost(e.target.value)}
            className={inputClass}
          />
          <input
            required
            placeholder="username"
            value={regUser}
            onChange={(e) => setRegUser(e.target.value)}
            className={inputClass}
          />
          <input
            required
            type="password"
            placeholder="password / token"
            value={regPass}
            onChange={(e) => setRegPass(e.target.value)}
            className={inputClass}
          />
          <button type="submit" className={buttonPrimaryClass} disabled={busy}>
            Add
          </button>
        </form>
        <ul className="space-y-1 text-sm">
          {regs.map((r) => (
            <li key={r.id} className="flex items-center justify-between border-t border-zinc-800 py-2">
              <span className="text-zinc-200">
                {r.registry} <span className="text-zinc-500">as {r.username}</span>
              </span>
              <button
                type="button"
                className="text-xs text-red-400"
                onClick={async () => {
                  await api.del(`/api/tenants/current/registry-credentials/${r.id}`);
                  reload();
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${panelClass} space-y-3 p-5`} data-testid="security-backup">
        <h2 className="text-sm font-medium text-zinc-100">Control plane backup</h2>
        <p className="text-sm text-zinc-500">Snapshot SQLite to EMBER_BACKUP_DIR (default ./backups).</p>
        <button type="button" className={buttonSecondaryClass} onClick={runBackup} data-testid="backup-run">
          Create backup now
        </button>
        {backupMsg && <p className="text-sm text-emerald-300">{backupMsg}</p>}
      </section>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-zinc-500">{label}</span>
      <input
        type="number"
        min={0}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={`${inputClass} mt-1`}
      />
    </label>
  );
}

function readError(e: unknown) {
  if (e instanceof ApiError) {
    try {
      const p = JSON.parse(e.body) as { error?: string };
      return p.error || e.body || e.message;
    } catch {
      return e.body || e.message;
    }
  }
  return String(e);
}
