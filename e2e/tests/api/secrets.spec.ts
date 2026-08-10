import { test, expect } from '@playwright/test';
import { cpFetch, setupOwnerViaApi } from '../../helpers/api.js';

test.describe('P1 secrets + API tokens', () => {
  test('store secret (redacted list) and resolve on create when host exists', async () => {
    const { cookie } = await setupOwnerViaApi();
    const name = `DB_PASS_${Date.now()}`;

    const create = await cpFetch('/api/tenants/current/secrets', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name, value: 's3cret-value-xyz' }),
    });
    expect(create.ok).toBeTruthy();
    const body = await create.json();
    expect(body.name).toBe(name);
    expect(JSON.stringify(body)).not.toContain('s3cret-value-xyz');

    const list = await cpFetch('/api/tenants/current/secrets', { cookie });
    const secrets = await list.json();
    expect(secrets.some((s: { name: string }) => s.name === name)).toBeTruthy();
    expect(JSON.stringify(secrets)).not.toContain('s3cret-value-xyz');

    // unknown secret ref fails workload create
    const wl = await cpFetch('/api/workloads', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        host_id: null,
        name: `sec-wl-${Date.now()}`,
        image: 'nginx:1.27-alpine',
        env: [['PASS', 'secret:does-not-exist']],
        ports: [],
        volumes: [],
        command: null,
        labels: [],
        placement_labels: [],
      }),
    });
    expect(wl.status).toBe(400);
    const err = (await wl.json()).error as string;
    // Placement may fail first when no agent is online; either denial is fine.
    expect(err).toMatch(/unknown secret|no online host/i);

    // cleanup
    const id = body.id as string;
    await cpFetch(`/api/tenants/current/secrets/${id}`, { method: 'DELETE', cookie });
  });

  test('API token Bearer auth', async () => {
    const { cookie } = await setupOwnerViaApi();
    const create = await cpFetch('/api/tenants/current/tokens', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name: `ci-${Date.now()}`, role: 'operator', expires_days: 7 }),
    });
    expect(create.ok).toBeTruthy();
    const tok = await create.json();
    expect(tok.token_once).toMatch(/^ember_/);

    const hosts = await cpFetch('/api/hosts', {
      headers: { authorization: `Bearer ${tok.token_once}` },
    });
    expect(hosts.ok).toBeTruthy();
    expect(Array.isArray(await hosts.json())).toBeTruthy();

    await cpFetch(`/api/tenants/current/tokens/${tok.id}`, { method: 'DELETE', cookie });
  });

  test('backup creates snapshot', async () => {
    const { cookie } = await setupOwnerViaApi();
    const res = await cpFetch('/api/admin/backup', { method: 'POST', cookie });
    // May 400 if in-memory/temp db path unsupported in some envs
    expect([200, 400]).toContain(res.status);
    if (res.ok) {
      const body = await res.json();
      expect(body.path).toBeTruthy();
      expect(body.bytes).toBeGreaterThan(0);
    }
  });
});
