import { test, expect } from '@playwright/test';
import { cpFetch, setupOwnerViaApi } from '../../helpers/api.js';

test.describe('P1 policy admission', () => {
  test('deny :latest and port policy', async () => {
    const { cookie } = await setupOwnerViaApi();

    const put = await cpFetch('/api/tenants/current/policy', {
      method: 'PUT',
      cookie,
      body: JSON.stringify({
        deny_latest_tag: true,
        image_allowlist: [],
        max_workloads: null,
        max_volumes: null,
        max_volume_mb_total: null,
        allowed_host_ports: [8080],
        require_mfa_admins: false,
      }),
    });
    expect(put.ok).toBeTruthy();

    const hosts = await cpFetch('/api/hosts', { cookie });
    const hostList = await hosts.json();
    const hostId = hostList[0]?.id ?? null;

    // Even without hosts, image policy should fire first
    const latest = await cpFetch('/api/workloads', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        host_id: hostId,
        name: `deny-latest-${Date.now()}`,
        image: 'nginx:latest',
        env: [],
        ports: [],
        volumes: [],
        command: null,
        labels: [],
        placement_labels: [],
      }),
    });
    expect(latest.status).toBe(400);
    expect((await latest.json()).error).toMatch(/latest/i);

    const badPort = await cpFetch('/api/workloads', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        host_id: hostId,
        name: `deny-port-${Date.now()}`,
        image: 'nginx:1.27-alpine',
        env: [],
        ports: [{ host_port: 9999, container_port: 80, protocol: 'tcp' }],
        volumes: [],
        command: null,
        labels: [],
        placement_labels: [],
      }),
    });
    expect(badPort.status).toBe(400);
    const portErr = await badPort.json();
    expect(portErr.error).toMatch(/port/i);

    // Reset open policy for other tests
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
  });
});
