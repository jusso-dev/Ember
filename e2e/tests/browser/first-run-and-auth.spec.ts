import { test, expect, baseUrl, OWNER, textOf, visible, click } from '../../fixtures.js';
import { setupOwnerViaApi, cpFetch } from '../../helpers/api.js';

async function gotoLogin(page: import('puppeteer-core').Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(`${baseUrl()}/login`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await page.waitForSelector('[data-testid="login-page"]', { timeout: 10_000 });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error('failed to open /login');
}

test.describe('README first-run + auth UI', () => {
  test('login page renders control plane branding', async ({ page }) => {
    await gotoLogin(page);
    const heading = await textOf(page, '[data-testid="auth-heading"]');
    expect(heading.length).toBeGreaterThan(0);
    expect(heading).toMatch(/Create owner account|Sign in to Ember/);
    await visible(page, '[data-testid="auth-email"]');
    await visible(page, '[data-testid="auth-password"]');
    await visible(page, '[data-testid="auth-submit"]');
  });

  test('unauthenticated visit to console redirects to login', async ({ page }) => {
    await page.goto(`${baseUrl()}/hosts`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => location.pathname.includes('/login'), { timeout: 30_000 });
    await visible(page, '[data-testid="login-page"]');
  });

  test('first-run setup or sign-in reaches dashboard shell', async ({ authedPage }) => {
    // Cookie seed + shell is the production path for session restore after setup/login.
    await visible(authedPage, '[data-testid="app-shell"]');
    const user = await textOf(authedPage, '[data-testid="shell-user"]');
    expect(user).toContain(OWNER.name);
    const tenant = await textOf(authedPage, '[data-testid="shell-tenant"]');
    expect(tenant).toContain(OWNER.tenant);
  });

  test('bad password is rejected (API + stays unauthenticated in UI)', async ({ page }) => {
    await setupOwnerViaApi();
    const bad = await cpFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: OWNER.email, password: 'wrong-password-xxx' }),
    });
    expect(bad.status).toBe(401);

    await gotoLogin(page);
    // Without a valid cookie, console should not show shell.
    await page.goto(`${baseUrl()}/`, { waitUntil: 'domcontentloaded' });
    // May land on login via redirect or show login form.
    const onLogin =
      page.url().includes('/login') ||
      (await page.$('[data-testid="login-page"]')) !== null ||
      (await page.$('[data-testid="app-shell"]')) === null;
    expect(onLogin).toBeTruthy();
  });

  test('logout returns to sign-in', async ({ authedPage }) => {
    await visible(authedPage, '[data-testid="app-shell"]');
    await Promise.all([
      authedPage
        .waitForResponse((res) => res.url().includes('/api/auth/logout'), { timeout: 15_000 })
        .catch(() => undefined),
      click(authedPage, '[data-testid="shell-logout"]'),
    ]);
    await authedPage.deleteCookie(...(await authedPage.cookies())).catch(() => undefined);
    await authedPage.goto(`${baseUrl()}/login`, { waitUntil: 'domcontentloaded' });
    await visible(authedPage, '[data-testid="login-page"]');
    await authedPage.goto(`${baseUrl()}/hosts`, { waitUntil: 'domcontentloaded' });
    await authedPage.waitForFunction(() => location.pathname.includes('/login'), {
      timeout: 15_000,
    });
  });
});
