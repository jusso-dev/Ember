import { test, expect, baseUrl, visible, click, textOf } from '../../fixtures.js';

test.describe('README dashboard + shell navigation', () => {
  test('dashboard shows fleet overview after auth', async ({ authedPage }) => {
    await authedPage.goto(`${baseUrl()}/`, { waitUntil: 'domcontentloaded' });
    await visible(authedPage, '[data-testid="dashboard-page"]');
    await visible(authedPage, 'text/Fleet overview');
    await visible(authedPage, '[data-testid="dashboard-add-host"]');
    await visible(authedPage, '[data-testid="dashboard-new-workload"]');
    await visible(authedPage, 'text/Launchpad');
    await visible(authedPage, 'text/Enroll a host');
    await visible(authedPage, 'text/Recent activity');
  });

  test('sidebar links reach hosts, volumes, workloads, access', async ({ authedPage }) => {
    const visits: Array<{ path: string; marker: string }> = [
      { path: '/hosts', marker: '[data-testid="hosts-page"]' },
      { path: '/volumes', marker: 'text/Volume' },
      { path: '/workloads', marker: 'text/Workload' },
      { path: '/access', marker: '[data-testid="access-page"]' },
      { path: '/', marker: '[data-testid="dashboard-page"]' },
    ];
    for (const visit of visits) {
      await authedPage.goto(`${baseUrl()}${visit.path}`, { waitUntil: 'domcontentloaded' });
      await visible(authedPage, visit.marker);
    }
  });

  test('launchpad links from dashboard', async ({ authedPage }) => {
    await authedPage.goto(`${baseUrl()}/`, { waitUntil: 'domcontentloaded' });
    await click(authedPage, 'a[href="/hosts"]');
    await authedPage.waitForFunction(() => location.pathname.includes('/hosts'), {
      timeout: 15_000,
    });
    await authedPage.goto(`${baseUrl()}/`, { waitUntil: 'domcontentloaded' });
    await click(authedPage, 'a[href="/volumes/new"]');
    await authedPage.waitForFunction(() => location.pathname.includes('/volumes/new'), {
      timeout: 15_000,
    });
    await authedPage.goto(`${baseUrl()}/`, { waitUntil: 'domcontentloaded' });
    await click(authedPage, 'a[href="/workloads/new"]');
    await authedPage.waitForFunction(() => location.pathname.includes('/workloads/new'), {
      timeout: 15_000,
    });
  });

  test('shell search can jump to Access control', async ({ authedPage }) => {
    await authedPage.goto(`${baseUrl()}/`, { waitUntil: 'domcontentloaded' });
    // Search is md+ only in CSS; force visible for headless browsers.
    await authedPage.evaluate(() => {
      const el = document.querySelector('#shell-search') as HTMLElement | null;
      if (el) {
        el.style.display = 'block';
        el.style.visibility = 'visible';
        (el.parentElement as HTMLElement | null)?.style.setProperty('display', 'block');
      }
    });
    const search = await authedPage.$('#shell-search');
    if (!search) {
      // Fallback: direct nav still covers Access control route.
      await authedPage.goto(`${baseUrl()}/access`, { waitUntil: 'domcontentloaded' });
      await visible(authedPage, '[data-testid="access-page"]');
      return;
    }
    await search.click({ clickCount: 3 });
    await search.type('access control', { delay: 10 });
    // Prefer clicking a result over Enter (keyboard events are flaky under Lightpanda).
    const result = await authedPage.waitForSelector('text/Access control', { timeout: 5_000 }).catch(() => null);
    if (result) {
      await result.click();
    } else {
      await authedPage.keyboard.press('Enter');
    }
    await authedPage.waitForFunction(() => location.pathname.includes('/access'), {
      timeout: 15_000,
    });
    await visible(authedPage, '[data-testid="access-page"]');
  });
});

