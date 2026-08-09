import { test, expect } from '@playwright/test';
import { setupOwnerViaApi, cpFetch } from '../../helpers/api.js';

test.describe('README host enrollment + access APIs', () => {
  test('mint one-shot host enrollment token', async () => {
    const { cookie } = await setupOwnerViaApi();
    const res = await cpFetch('/api/hosts/enroll-token', { method: 'POST', cookie });
    expect(res.ok).toBeTruthy();
    const body = await res.json();
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(10);
    expect(typeof body.expires_at).toBe('string');
    expect(typeof body.install_command).toBe('string');
    expect(body.install_command).toContain('install.sh');
    expect(body.install_command).toContain(body.token);
  });

  test('tenant access summary includes owner membership and role matrix', async () => {
    const { cookie } = await setupOwnerViaApi();
    const res = await cpFetch('/api/tenants/current', { cookie });
    expect(res.ok).toBeTruthy();
    const body = await res.json();
    expect(body.tenant.role).toBe('owner');
    expect(Array.isArray(body.members)).toBe(true);
    expect(body.members.length).toBeGreaterThanOrEqual(1);
    expect(body.members.some((m: { role: string }) => m.role === 'owner')).toBe(true);
    expect(Array.isArray(body.role_matrix)).toBe(true);
    expect(body.role_matrix.length).toBeGreaterThan(0);
  });

  test('create and revoke tenant invitation', async () => {
    const { cookie } = await setupOwnerViaApi();
    const email = `invitee+${Date.now()}@ember.e2e`;
    const create = await cpFetch('/api/tenants/current/invitations', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ email, role: 'viewer' }),
    });
    expect(create.ok).toBeTruthy();
    const invite = await create.json();
    expect(invite.email).toBe(email);
    expect(invite.role).toBe('viewer');
    expect(invite.id).toBeTruthy();

    const list = await cpFetch('/api/tenants/current', { cookie });
    const access = await list.json();
    expect(access.invitations.some((i: { id: string }) => i.id === invite.id)).toBe(true);

    const del = await cpFetch(`/api/tenants/current/invitations/${invite.id}`, {
      method: 'DELETE',
      cookie,
    });
    expect(del.ok || del.status === 204).toBeTruthy();
  });

  test('events, workloads, volumes list endpoints respond', async () => {
    const { cookie } = await setupOwnerViaApi();
    for (const path of ['/api/events?limit=20', '/api/workloads', '/api/volumes']) {
      const res = await cpFetch(path, { cookie });
      expect(res.ok, path).toBeTruthy();
      const body = await res.json();
      expect(Array.isArray(body), path).toBe(true);
    }
  });

  test('volume create without host fails cleanly', async () => {
    const { cookie } = await setupOwnerViaApi();
    const res = await cpFetch('/api/volumes', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        host_id: '00000000-0000-7000-8000-000000000000',
        name: 'orphan',
        size_mb: 100,
        backend: 'hostdir',
      }),
    });
    expect(res.ok).toBeFalsy();
    expect([400, 404, 409]).toContain(res.status);
  });

  test('workload create without host fails cleanly', async () => {
    const { cookie } = await setupOwnerViaApi();
    const res = await cpFetch('/api/workloads', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        host_id: '00000000-0000-7000-8000-000000000000',
        name: 'ghost',
        image: 'nginx:alpine',
        env: [],
        ports: [{ host_port: 8081, container_port: 80, protocol: 'tcp' }],
        volumes: [],
        command: null,
      }),
    });
    expect(res.ok).toBeFalsy();
    expect([400, 404, 409]).toContain(res.status);
  });
});
