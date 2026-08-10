import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  AUTH_STATE_PATH,
  REPO_ROOT,
  STACK_STATE_PATH,
  baseUrl,
  controlPlaneUrl,
  ports,
  useExternalStack,
  useLightpandaCloud,
  cdpWsUrl,
} from './env.js';

export type StackState = {
  startedAt: string;
  baseUrl: string;
  controlPlaneUrl: string;
  cdpWsUrl: string;
  dbPath: string;
  workDir: string;
  pids: {
    controlPlane?: number;
    web?: number;
    lightpanda?: number;
  };
};

const children = new Set<ChildProcess>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUrl(url: string, timeoutMs = 120_000) {
  const start = Date.now();
  let lastError = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok || res.status === 401 || res.status === 403) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

function spawnLogged(
  command: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    logPath: string;
  },
): ChildProcess {
  fs.mkdirSync(path.dirname(opts.logPath), { recursive: true });
  const out = fs.openSync(opts.logPath, 'a');
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['ignore', out, out],
    detached: process.platform !== 'win32',
  });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

function resolveControlPlaneBinary(): string {
  const candidates = [
    path.join(REPO_ROOT, 'target/release/ember-control-plane'),
    path.join(REPO_ROOT, 'target/debug/ember-control-plane'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'ember-control-plane binary not found. Build with: cargo build -p ember-control-plane',
  );
}

export async function startStack(): Promise<StackState> {
  if (useExternalStack()) {
    const state: StackState = {
      startedAt: new Date().toISOString(),
      baseUrl: baseUrl(),
      controlPlaneUrl: controlPlaneUrl(),
      cdpWsUrl: process.env.CDP_WS_URL || `ws://127.0.0.1:${ports().cdp}`,
      dbPath: '',
      workDir: '',
      pids: {},
    };
    await waitForUrl(`${state.controlPlaneUrl}/api/health`);
    // Browser projects need the web app; API-only can skip (E2E_SKIP_WEB=1 or base==cp).
    const skipWeb =
      process.env.E2E_SKIP_WEB === '1' ||
      process.env.E2E_SKIP_WEB === 'true' ||
      state.baseUrl.replace(/\/$/, '') === state.controlPlaneUrl.replace(/\/$/, '');
    if (!skipWeb) {
      await waitForUrl(state.baseUrl);
    }
    writeState(state);
    return state;
  }

  const p = ports();
  const workDir = fs.mkdtempSync(path.join(path.resolve(REPO_ROOT, 'e2e'), '.run-'));
  const dbPath = path.join(workDir, 'ember-e2e.db');
  const logDir = path.join(workDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true });

  const cpUrl = `http://127.0.0.1:${p.controlPlane}`;
  const webUrl = `http://127.0.0.1:${p.web}`;
  const cdpWs = `ws://127.0.0.1:${p.cdp}`;

  const state: StackState = {
    startedAt: new Date().toISOString(),
    baseUrl: webUrl,
    controlPlaneUrl: cpUrl,
    cdpWsUrl: cdpWs,
    dbPath,
    workDir,
    pids: {},
  };

  // Lightpanda is started in the Playwright worker (same process as Puppeteer).
  // Starting it in globalSetup and then exiting that process leaves a half-dead
  // CDP server that accepts connections but cannot navigate.
  if (useLightpandaCloud()) {
    state.cdpWsUrl = cdpWsUrl();
  } else {
    state.cdpWsUrl = `ws://127.0.0.1:${p.cdp}`;
  }

  // Control plane
  const binary = resolveControlPlaneBinary();
  const cp = spawnLogged(binary, [], {
    cwd: REPO_ROOT,
    logPath: path.join(logDir, 'control-plane.log'),
    env: {
      ...process.env,
      EMBER_BIND_ADDR: `127.0.0.1:${p.controlPlane}`,
      EMBER_DB_URL: `sqlite://${dbPath}?mode=rwc`,
      EMBER_PUBLIC_BASE_URL: webUrl,
      RUST_LOG: process.env.E2E_RUST_LOG || 'info,sqlx=warn,tower_http=info',
    },
  });
  state.pids.controlPlane = cp.pid;
  await waitForUrl(`${cpUrl}/api/health`);

  // Web (prefer production server when build exists)
  const webDir = path.join(REPO_ROOT, 'web');
  const hasBuild = fs.existsSync(path.join(webDir, '.next/BUILD_ID'));
  const preferProd = process.env.E2E_WEB_MODE === 'prod' || (process.env.CI && hasBuild);
  const useProd = preferProd && hasBuild;

  const web = spawnLogged(
    'pnpm',
    useProd
      ? ['exec', 'next', 'start', '-H', '127.0.0.1', '-p', String(p.web)]
      : ['exec', 'next', 'dev', '-H', '127.0.0.1', '-p', String(p.web)],
    {
      cwd: webDir,
      logPath: path.join(logDir, 'web.log'),
      env: {
        ...process.env,
        CONTROL_PLANE_URL: cpUrl,
        PORT: String(p.web),
        HOSTNAME: '127.0.0.1',
      },
    },
  );
  state.pids.web = web.pid;
  await waitForUrl(webUrl);

  writeState(state);
  return state;
}

export async function stopStack(state?: StackState | null) {
  const current = state ?? readState();
  if (!current || useExternalStack()) {
    if (fs.existsSync(STACK_STATE_PATH)) fs.unlinkSync(STACK_STATE_PATH);
    return;
  }

  for (const pid of Object.values(current.pids)) {
    if (!pid) continue;
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  }

  // Detached children may linger briefly
  await sleep(300);
  for (const pid of Object.values(current.pids)) {
    if (!pid) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }

  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  children.clear();

  if (current.workDir && fs.existsSync(current.workDir) && process.env.E2E_KEEP_RUN !== '1') {
    fs.rmSync(current.workDir, { recursive: true, force: true });
  }
  if (fs.existsSync(STACK_STATE_PATH)) fs.unlinkSync(STACK_STATE_PATH);
}

export function writeState(state: StackState) {
  fs.writeFileSync(STACK_STATE_PATH, JSON.stringify(state, null, 2));
}

export function readState(): StackState | null {
  if (!fs.existsSync(STACK_STATE_PATH)) return null;
  return JSON.parse(fs.readFileSync(STACK_STATE_PATH, 'utf8')) as StackState;
}

export function applyStateEnv(state: StackState) {
  process.env.E2E_BASE_URL = state.baseUrl;
  process.env.E2E_CP_URL = state.controlPlaneUrl;
  process.env.CDP_WS_URL = state.cdpWsUrl;
}
