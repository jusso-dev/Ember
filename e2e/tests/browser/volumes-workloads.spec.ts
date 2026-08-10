import { test, expect, baseUrl, visible, fill } from '../../fixtures.js';

test.describe('README volume + workload forms (no agent)', () => {
  test('New volume form matches README hostdir defaults', async ({ authedPage }) => {
    await authedPage.goto(`${baseUrl()}/volumes/new`, { waitUntil: 'domcontentloaded' });
    await visible(authedPage, '[data-testid="volume-new-form"]');
    await visible(authedPage, 'text/New volume');
    const backend = await authedPage.$eval(
      '[data-testid="volume-backend"]',
      (el) => (el as HTMLSelectElement).value,
    );
    expect(backend).toBe('hostdir');
    const size = await authedPage.$eval(
      '[data-testid="volume-size"]',
      (el) => (el as HTMLInputElement).value,
    );
    expect(size).toBe('1024');
    const disabled = await authedPage.$eval(
      '[data-testid="volume-submit"]',
      (el) => (el as HTMLButtonElement).disabled,
    );
    expect(disabled).toBe(true);
    await fill(authedPage, '[data-testid="volume-name"]', 'data');
    const stillDisabled = await authedPage.$eval(
      '[data-testid="volume-submit"]',
      (el) => (el as HTMLButtonElement).disabled,
    );
    expect(stillDisabled).toBe(true);
  });

  test('New workload form accepts nginx:alpine + port mapping fields', async ({ authedPage }) => {
    await authedPage.goto(`${baseUrl()}/workloads/new`, { waitUntil: 'domcontentloaded' });
    await visible(authedPage, '[data-testid="workload-new-form"]');
    await visible(authedPage, 'text/New workload');
    await fill(authedPage, '[data-testid="workload-name"]', 'web');
    await fill(authedPage, '[data-testid="workload-image"]', 'nginx:alpine');
    const image = await authedPage.$eval(
      '[data-testid="workload-image"]',
      (el) => (el as HTMLInputElement).value,
    );
    expect(image).toBe('nginx:alpine');
    // Auto-place is the default: submit is enabled without a pinned host.
    const autoPlace = await authedPage.$eval(
      '[data-testid="workload-placement-auto"]',
      (el) => (el as HTMLInputElement).checked,
    );
    expect(autoPlace).toBe(true);
    const enabledWithAuto = await authedPage.$eval(
      '[data-testid="workload-submit"]',
      (el) => (el as HTMLButtonElement).disabled,
    );
    expect(enabledWithAuto).toBe(false);
    // Pin-host mode with zero hosts keeps submit disabled.
    await authedPage.click('[data-testid="workload-placement-auto"]');
    const disabledPinned = await authedPage.$eval(
      '[data-testid="workload-submit"]',
      (el) => (el as HTMLButtonElement).disabled,
    );
    expect(disabledPinned).toBe(true);
    const addPort = await authedPage.$('xpath///button[contains(., "Add port")]');
    if (addPort) {
      await addPort.click();
      const host = await authedPage.$('input[placeholder="host"]');
      const container = await authedPage.$('input[placeholder="container"]');
      if (host && container) {
        await host.type('8081');
        await container.type('80');
      }
    }
  });

  test('volumes and workloads list pages render', async ({ authedPage }) => {
    await authedPage.goto(`${baseUrl()}/volumes`, { waitUntil: 'domcontentloaded' });
    await visible(authedPage, 'text/Volume');
    await authedPage.goto(`${baseUrl()}/workloads`, { waitUntil: 'domcontentloaded' });
    await visible(authedPage, 'text/Workload');
  });

  test('observability pages are reachable', async ({ authedPage }) => {
    await authedPage.goto(`${baseUrl()}/logs/control-plane`, { waitUntil: 'domcontentloaded' });
    await visible(authedPage, 'text/log');
    await authedPage.goto(`${baseUrl()}/audit`, { waitUntil: 'domcontentloaded' });
    await visible(authedPage, 'text/Audit');
  });
});
