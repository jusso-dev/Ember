import { test, expect } from '@playwright/test';
import { cpFetch, setupOwnerViaApi } from '../../helpers/api.js';

test.describe('P1 placement', () => {
  test('auto-placement fails cleanly without online host', async () => {
    const { cookie } = await setupOwnerViaApi();

    // Ensure policy allows pinned tags
    await cpFetch('/api/tenants/current/policy', {
      method: 'PUT',
      cookie,
      body: JSON.stringify({
        deny_latest_tag: false,
        image_allowlist: [],
        max_workloads: null,
        max_volumes: null,
        max_volume_mb_total: null,
        allowed_host_ports: [],
        require_mfa_admins: false,
      }),
    });

    const hostsRes = await cpFetch('/api/hosts', { cookie });
    const hosts = await hostsRes.json();
    const online = hosts.filter((h: { status: string; cordoned?: boolean }) => h.status === 'online' && !h.cordoned);

    if (online.length === 0) {
      const res = await cpFetch('/api/workloads', {
        method: 'POST',
        cookie,
        body: JSON.stringify({
          host_id: null,
          name: `place-${Date.now()}`,
          image: 'nginx:1.27-alpine',
          env: [],
          ports: [],
          volumes: [],
          command: null,
          labels: [],
          placement_labels: [],
        }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/no online host/i);
    } else {
      const res = await cpFetch('/api/workloads', {
        method: 'POST',
        cookie,
        body: JSON.stringify({
          host_id: null,
          name: `place-${Date.now()}`,
          image: 'nginx:1.27-alpine',
          env: [],
          ports: [],
          volumes: [],
          command: null,
          labels: [],
          placement_labels: [],
        }),
      });
      expect(res.ok).toBeTruthy();
      const wl = await res.json();
      expect(wl.host_id).toBeTruthy();
      // cleanup
      await cpFetch(`/api/workloads/${wl.id}`, { method: 'DELETE', cookie });
    }
  });

  test('cordon host rejects explicit placement', async () => {
    const { cookie } = await setupOwnerViaApi();
    const hostsRes = await cpFetch('/api/hosts', { cookie });
    const hosts = await hostsRes.json();
    if (!hosts.length) {
      test.skip();
      return;
    }
    const h = hosts[0];
    await cpFetch(`/api/hosts/${h.id}`, {
      method: 'PUT',
      cookie,
      body: JSON.stringify({ cordoned: true, labels: null }),
    });
    const res = await cpFetch('/api/workloads', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        host_id: h.id,
        name: `cordon-${Date.now()}`,
        image: 'nginx:1.27-alpine',
        env: [],
        ports: [],
        volumes: [],
        command: null,
        labels: [],
        placement_labels: [],
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cordon/i);
    await cpFetch(`/api/hosts/${h.id}`, {
      method: 'PUT',
      cookie,
      body: JSON.stringify({ cordoned: false, labels: null }),
    });
  });
});
