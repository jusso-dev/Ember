/**
 * Browser fixtures: Lightpanda CDP + Puppeteer (Playwright Test runner).
 *
 * Lightpanda must be started in this worker process. Global-setup-spawned
 * Lightpanda accepts CDP but cannot navigate after the setup process exits.
 */
import { test as base, expect } from '@playwright/test';
import { lightpanda } from '@lightpanda/browser';
import puppeteer, { type Browser, type Page, type Cookie } from 'puppeteer-core';
import { execSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { cdpWsUrl, baseUrl, controlPlaneUrl } from './helpers/runtime.js';
import { OWNER, ports, useLightpandaCloud } from './helpers/env.js';
import { ensureOwnerSession } from './helpers/api.js';

function freePort(port: number) {
  try {
    execSync(`lsof -ti tcp:${port} | xargs kill -9`, { stdio: 'ignore' });
  } catch {
    // nothing listening
  }
}

async function waitPortFree(port: number, timeoutMs = 5_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      execSync(`lsof -ti tcp:${port}`, { stdio: 'ignore' });
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      return;
    }
  }
}

type EmberFixtures = {
  browser: Browser;
  page: Page;
  authedPage: Page;
};

async function waitHealthy(url: string, timeoutMs = 30_000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok || res.status === 307 || res.status === 308 || res.status === 401) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`service not healthy at ${url}: ${last}`);
}

async function freshPage(browser: Browser): Promise<Page> {
  // Prefer a brand-new page; reusing a stuck about:blank can refuse navigation.
  const page = await browser.newPage();
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(30_000);
  return page;
}

async function injectSession(page: Page, cookieHeader: string) {
  const match = cookieHeader.match(/ember_session=([^;]+)/);
  if (!match) throw new Error(`invalid session cookie: ${cookieHeader}`);
  const url = new URL(baseUrl());
  const cookie: Cookie = {
    name: 'ember_session',
    value: match[1],
    domain: url.hostname,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  };
  await page.setCookie(cookie);
}

async function loginAsOwner(page: Page) {
  await page.goto(`${baseUrl()}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="auth-heading"]');
  const text = await page.$eval('[data-testid="auth-heading"]', (el) => el.textContent || '');
  if (text.includes('Create owner account')) {
    await page.type('[data-testid="setup-name"]', OWNER.name);
    await page.type('[data-testid="setup-tenant"]', OWNER.tenant);
    await page.type('[data-testid="auth-email"]', OWNER.email);
    await page.type('[data-testid="auth-password"]', OWNER.password);
    await page.type('[data-testid="setup-confirm-password"]', OWNER.password);
  } else {
    await page.type('[data-testid="auth-email"]', OWNER.email);
    await page.type('[data-testid="auth-password"]', OWNER.password);
  }
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => undefined),
    page.click('[data-testid="auth-submit"]'),
  ]);
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30_000 });
}

// Lightpanda degrades after many navigations in one long-lived CDP session.
// Start a fresh browser process per test for isolation (still ~1s).
export const test = base.extend<EmberFixtures>({
  browser: async ({}, use) => {
    await waitHealthy(`${controlPlaneUrl()}/api/health`);
    await waitHealthy(baseUrl());

    let proc: ChildProcess | null = null;
    let endpoint = cdpWsUrl();
    if (!useLightpandaCloud()) {
      const p = ports();
      // Unique port per test avoids races when prior Lightpanda is still dying.
      const cdpPort = p.cdp + (process.pid % 50) + Math.floor(Math.random() * 40);
      freePort(cdpPort);
      await waitPortFree(cdpPort);
      proc = await lightpanda.serve({
        host: '127.0.0.1',
        port: cdpPort,
      });
      endpoint = `ws://127.0.0.1:${cdpPort}`;
      await new Promise((r) => setTimeout(r, 500));
    }

    const browser = await puppeteer.connect({
      browserWSEndpoint: endpoint,
      defaultViewport: { width: 1280, height: 800 },
      protocolTimeout: 60_000,
    });

    await use(browser);

    try {
      await browser.disconnect();
    } catch {
      // ignore
    }
    if (proc) {
      try {
        proc.stdout?.destroy();
        proc.stderr?.destroy();
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  },

  page: async ({ browser }, use) => {
    const page = await freshPage(browser);
    await use(page);
    await page.close().catch(() => undefined);
  },

  authedPage: async ({ browser }, use) => {
    const page = await freshPage(browser);
    try {
      const cookie = await ensureOwnerSession();
      await injectSession(page, cookie);
      await page.goto(`${baseUrl()}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30_000 });
    } catch {
      await loginAsOwner(page);
    }
    await use(page);
    await page.close().catch(() => undefined);
  },
});

export { expect, baseUrl, OWNER };

export async function textOf(page: Page, selector: string) {
  await page.waitForSelector(selector, { visible: true });
  return page.$eval(selector, (el) => (el.textContent || '').trim());
}

export async function visible(page: Page, selector: string) {
  await page.waitForSelector(selector, { visible: true, timeout: 15_000 });
}

export async function click(page: Page, selector: string) {
  await page.waitForSelector(selector, { visible: true });
  await page.click(selector);
}

export async function fill(page: Page, selector: string, value: string) {
  await page.waitForSelector(selector, { visible: true });
  // Prefer React-friendly value setting; keystrokes can desync under Lightpanda.
  await page.$eval(
    selector,
    (el, next) => {
      const input = el as HTMLInputElement;
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      proto?.set?.call(input, next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    value,
  );
}
