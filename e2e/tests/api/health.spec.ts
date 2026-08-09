import { test, expect } from '@playwright/test';
import { controlPlaneUrl, baseUrl } from '../../helpers/runtime.js';

test.describe('README health surface', () => {
  test('control plane GET /api/health returns ok + version', async ({ request }) => {
    const res = await request.get(`${controlPlaneUrl()}/api/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
  });

  test('web proxy rewrites /api/health to control plane', async ({ request }) => {
    const res = await request.get(`${baseUrl()}/api/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('installer script is served by the web app', async ({ request }) => {
    const res = await request.get(`${baseUrl()}/install.sh`);
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    expect(text).toContain('ember-agent');
    expect(text).toContain('enroll');
  });
});
