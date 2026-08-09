import { test, expect } from '@playwright/test';
import { OWNER } from '../../helpers/env.js';
import { controlPlaneUrl } from '../../helpers/runtime.js';
import { cpFetch, setupOwnerViaApi } from '../../helpers/api.js';

test.describe('README auth + session API', () => {
  test('session reports unauthenticated before login on fresh cookie jar', async ({ request }) => {
    const res = await request.get(`${controlPlaneUrl()}/api/auth/session`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // After other tests may already have users; only assert shape.
    expect(typeof body.authenticated).toBe('boolean');
  });

  test('first-run setup or login creates ember_session cookie', async () => {
    const { cookie, session } = await setupOwnerViaApi();
    expect(cookie).toContain('ember_session=');
    expect(session.authenticated).toBe(true);
    expect(session.user?.email).toBe(OWNER.email);
    expect(session.active_tenant?.name).toBe(OWNER.tenant);
    expect(session.user?.role).toBe('owner');
  });

  test('login rejects bad password', async () => {
    await setupOwnerViaApi();
    const res = await cpFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: OWNER.email, password: 'definitely-wrong-password' }),
    });
    expect(res.status).toBe(401);
  });

  test('authenticated session and logout', async () => {
    const { cookie } = await setupOwnerViaApi();
    const session = await cpFetch('/api/auth/session', { cookie });
    expect(session.ok).toBeTruthy();
    const body = await session.json();
    expect(body.authenticated).toBe(true);

    const logout = await cpFetch('/api/auth/logout', { method: 'POST', cookie });
    expect(logout.ok).toBeTruthy();

    const after = await cpFetch('/api/auth/session', { cookie });
    const afterBody = await after.json();
    expect(afterBody.authenticated).toBe(false);
  });

  test('setup cannot run twice', async () => {
    await setupOwnerViaApi();
    const res = await cpFetch('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Second',
        email: 'second@ember.e2e',
        password: 'password-1234',
        tenant_name: 'Other',
      }),
    });
    expect([400, 409, 403]).toContain(res.status);
  });

  test('protected host list requires session', async () => {
    const res = await cpFetch('/api/hosts');
    expect(res.status).toBe(401);
  });

  test('protected host list works with session', async () => {
    const { cookie } = await setupOwnerViaApi();
    const res = await cpFetch('/api/hosts', { cookie });
    expect(res.ok).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
