#!/usr/bin/env node
/**
 * pnpm may skip dependency postinstall scripts unless approved.
 * Re-run Lightpanda's binary download so `lightpanda.serve()` works offline.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);

try {
  const pkgDir = path.dirname(require.resolve('@lightpanda/browser/package.json'));
  const postinstall = path.join(pkgDir, 'dist/scripts/postinstall.js');
  const result = spawnSync(process.execPath, [postinstall], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.warn(
      '[ember-e2e] Lightpanda binary install failed. Browser tests need @lightpanda/browser postinstall or LPD_TOKEN/CDP_WS_URL.',
    );
  }
} catch (err) {
  console.warn('[ember-e2e] ensure-lightpanda skipped:', err instanceof Error ? err.message : err);
}
