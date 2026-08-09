/**
 * Optional full README agent flow.
 * Requires Docker + built ember-agent binary.
 * Enable with: E2E_AGENT_FLOW=1
 */
import { test, expect, baseUrl, visible } from '../../fixtures.js';
import { setupOwnerViaApi, cpFetch } from '../../helpers/api.js';
import { controlPlaneUrl } from '../../helpers/runtime.js';
import { REPO_ROOT } from '../../helpers/env.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const enabled = process.env.E2E_AGENT_FLOW === '1' || process.env.E2E_AGENT_FLOW === 'true';

test.describe('README agent + volume + workload flow (optional)', () => {
  test.skip(!enabled, 'Set E2E_AGENT_FLOW=1 to run Docker-backed agent flow');

  test('enroll agent, create hostdir volume, deploy nginx:alpine', async ({ authedPage }) => {
    const agentBin = [
      path.join(REPO_ROOT, 'target/release/ember-agent'),
      path.join(REPO_ROOT, 'target/debug/ember-agent'),
    ].find((p) => fs.existsSync(p));
    expect(agentBin, 'ember-agent binary missing; cargo build -p ember-agent').toBeTruthy();

    const { cookie } = await setupOwnerViaApi();
    const tokenRes = await cpFetch('/api/hosts/enroll-token', { method: 'POST', cookie });
    expect(tokenRes.ok).toBeTruthy();
    const { token } = await tokenRes.json();

    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-agent-e2e-'));
    const volumesDir = path.join(stateDir, 'volumes');
    fs.mkdirSync(volumesDir, { recursive: true });

    const enroll = spawn(
      agentBin!,
      ['enroll', '--server', controlPlaneUrl(), '--token', token, '--name', 'e2e-host-1'],
      {
        env: {
          ...process.env,
          EMBER_AGENT_STATE_DIR: stateDir,
          EMBER_VOLUMES_DIR: volumesDir,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const enrollCode = await new Promise<number>((resolve) =>
      enroll.on('exit', (c) => resolve(c ?? 1)),
    );
    expect(enrollCode).toBe(0);

    const agent = spawn(agentBin!, ['run'], {
      env: {
        ...process.env,
        EMBER_AGENT_STATE_DIR: stateDir,
        EMBER_VOLUMES_DIR: volumesDir,
        RUST_LOG: 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    try {
      let hostId = '';
      for (let i = 0; i < 40; i++) {
        const hosts = await (await cpFetch('/api/hosts', { cookie })).json();
        const online = hosts.find(
          (h: { status: string; name: string }) => h.name === 'e2e-host-1',
        );
        if (online?.status === 'online') {
          hostId = online.id;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(hostId).toBeTruthy();

      await authedPage.goto(`${baseUrl()}/hosts`, { waitUntil: 'domcontentloaded' });
      await visible(authedPage, 'text/e2e-host-1');

      const volRes = await cpFetch('/api/volumes', {
        method: 'POST',
        cookie,
        body: JSON.stringify({
          host_id: hostId,
          name: 'data',
          size_mb: 64,
          backend: 'hostdir',
        }),
      });
      expect(volRes.ok).toBeTruthy();
      const volume = await volRes.json();

      for (let i = 0; i < 40; i++) {
        const vols = await (await cpFetch('/api/volumes', { cookie })).json();
        const row = vols.find((v: { id: string }) => v.id === volume.id);
        if (row?.status === 'ready') break;
        await new Promise((r) => setTimeout(r, 500));
      }

      const wlRes = await cpFetch('/api/workloads', {
        method: 'POST',
        cookie,
        body: JSON.stringify({
          host_id: hostId,
          name: 'nginx-e2e',
          image: 'nginx:alpine',
          env: [],
          ports: [{ host_port: 18081, container_port: 80, protocol: 'tcp' }],
          volumes: [
            { volume_id: volume.id, mount_path: '/usr/share/nginx/html', read_only: false },
          ],
          command: null,
        }),
      });
      expect(wlRes.ok).toBeTruthy();
      const workload = await wlRes.json();

      let running = false;
      for (let i = 0; i < 120; i++) {
        const list = await (await cpFetch('/api/workloads', { cookie })).json();
        const row = list.find((w: { id: string }) => w.id === workload.id);
        if (row?.observed_state === 'running') {
          running = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      expect(running).toBe(true);

      await cpFetch(`/api/workloads/${workload.id}`, { method: 'DELETE', cookie });
    } finally {
      try {
        if (agent.pid) process.kill(-agent.pid, 'SIGTERM');
      } catch {
        try {
          agent.kill('SIGTERM');
        } catch {
          // ignore
        }
      }
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
