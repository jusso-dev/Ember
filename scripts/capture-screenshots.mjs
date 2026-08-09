#!/usr/bin/env node
/**
 * Capture README product screenshots against a running Ember stack.
 *
 *   BASE_URL=http://192.168.1.19:3200 \
 *   EMBER_EMAIL=owner@ember.e2e EMBER_PASSWORD=ember-e2e-password-1 \
 *   node scripts/capture-screenshots.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// Resolve playwright-core from e2e/ when run from repo root.
const require = createRequire(path.join(ROOT, 'e2e', 'package.json'));
const { chromium } = require('playwright-core');

const OUT = path.join(ROOT, 'docs', 'screenshots');
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3200').replace(/\/$/, '');
const EMAIL = process.env.EMBER_EMAIL || 'owner@ember.e2e';
const PASSWORD = process.env.EMBER_PASSWORD || 'ember-e2e-password-1';

fs.mkdirSync(OUT, { recursive: true });

const shots = [];

async function shot(page, name, fullPage = false) {
  const file = path.join(OUT, `${name}.png`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: file, fullPage, type: 'png' });
  shots.push({ name, file: path.relative(ROOT, file) });
  console.log('shot', name, '->', file);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="login-page"]');
  await shot(page, '01-login');

  const heading = await page.locator('[data-testid="auth-heading"]').textContent();
  if (heading?.includes('Create owner')) {
    await page.locator('[data-testid="setup-name"]').fill('E2E Owner');
    await page.locator('[data-testid="setup-tenant"]').fill('E2E Homelab');
    await page.locator('[data-testid="auth-email"]').fill(EMAIL);
    await page.locator('[data-testid="auth-password"]').fill(PASSWORD);
    await page.locator('[data-testid="setup-confirm-password"]').fill(PASSWORD);
    await shot(page, '01b-first-run-setup');
    await page.locator('[data-testid="auth-submit"]').click();
  } else {
    await page.locator('[data-testid="auth-email"]').fill(EMAIL);
    await page.locator('[data-testid="auth-password"]').fill(PASSWORD);
    await page.locator('[data-testid="auth-submit"]').click();
  }
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30_000 });

  const pages = [
    ['/', '02-dashboard', '[data-testid="dashboard-page"]'],
    ['/hosts', '03-hosts', '[data-testid="hosts-page"]'],
    ['/workloads', '05-workloads', null],
    ['/workloads/new', '06-workload-new', '[data-testid="workload-new-form"]'],
    ['/volumes', '07-volumes', null],
    ['/volumes/new', '08-volume-new', '[data-testid="volume-new-form"]'],
    ['/access', '09-access', '[data-testid="access-page"]'],
    ['/audit', '10-audit', null],
    ['/logs/control-plane', '11-control-plane-logs', null],
    ['/control-plane', '12-cloud-foundation', null],
  ];
  for (const [route, name, sel] of pages) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    if (sel) await page.waitForSelector(sel, { timeout: 15_000 }).catch(() => undefined);
    await shot(page, name);
  }

  await page.goto(`${BASE}/hosts`, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="hosts-add"]').click();
  await page.waitForSelector('[data-testid="hosts-enroll-token"]', { timeout: 15_000 });
  await page.waitForTimeout(800);
  await shot(page, '04-hosts-enroll');

  await browser.close();
  fs.writeFileSync(
    path.join(OUT, 'manifest.json'),
    JSON.stringify({ base: BASE, capturedAt: new Date().toISOString(), shots }, null, 2),
  );
  console.log('captured', shots.length, 'screenshots into', OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
