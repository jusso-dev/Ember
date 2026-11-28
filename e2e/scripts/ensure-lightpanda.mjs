#!/usr/bin/env node
/**
 * Install a pinned Lightpanda release so `lightpanda.serve()` works offline.
 *
 * The @lightpanda/browser postinstall always downloads the moving `nightly`
 * build, so e2e results could change with no change in this repo. Its build
 * script is not allowed in package.json; this script downloads a fixed
 * release to the same path the package reads from, and verifies its SHA-256.
 *
 * To upgrade: bump LIGHTPANDA_VERSION and copy the digests from
 * https://api.github.com/repos/lightpanda-io/browser/releases/tags/<version>
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LIGHTPANDA_VERSION = '1.0.6';
const SHA256 = {
  'x86_64-linux': 'a9bff4c0b8498433cd16d8165a5e5b47181e5690d4c8e1f011d601f1f2e8a467',
  'aarch64-linux': '26e0042a52f493d8cc1b04faef42aea9b46bef9ccfcc86170098bd330c19a890',
  'x86_64-macos': 'd2bb233b444a075057cd48a1da88d45c640e292a9de85ceff026793b091e126d',
  'aarch64-macos': '1a27a8692bc0e3821fbcbd5108608ef5233d2d64097ff0cf7837d1be9fe3f03b',
};
const TARGETS = {
  linux: { x64: 'x86_64-linux', arm64: 'aarch64-linux' },
  darwin: { x64: 'x86_64-macos', arm64: 'aarch64-macos' },
};

const warn = (msg) =>
  console.warn(`[ember-e2e] ${msg} Browser tests need a local Lightpanda binary or LPD_TOKEN/CDP_WS_URL.`);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function main() {
  if (process.env.LIGHTPANDA_EXECUTABLE_PATH) {
    console.info('[ember-e2e] LIGHTPANDA_EXECUTABLE_PATH set, skipping Lightpanda download.');
    return;
  }
  const target = TARGETS[process.platform]?.[process.arch];
  if (!target) {
    warn(`No Lightpanda build for ${process.platform}/${process.arch}.`);
    return;
  }
  // Same location @lightpanda/browser uses when LIGHTPANDA_EXECUTABLE_PATH is unset.
  const dir = path.join(os.homedir(), '.cache', 'lightpanda-node');
  const bin = path.join(dir, 'lightpanda');
  if (existsSync(bin) && sha256(readFileSync(bin)) === SHA256[target]) {
    console.info(`[ember-e2e] Lightpanda ${LIGHTPANDA_VERSION} already installed.`);
    return;
  }

  const url = `https://github.com/lightpanda-io/browser/releases/download/${LIGHTPANDA_VERSION}/lightpanda-${target}`;
  console.info(`[ember-e2e] Downloading Lightpanda ${LIGHTPANDA_VERSION} (${target})...`);
  const res = await fetch(url);
  if (!res.ok) {
    warn(`Lightpanda download failed: HTTP ${res.status} for ${url}.`);
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== SHA256[target]) {
    warn(`Lightpanda ${LIGHTPANDA_VERSION} checksum mismatch, refusing to install.`);
    return;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(bin, buf);
  chmodSync(bin, 0o755);
  console.info(`[ember-e2e] Lightpanda ${LIGHTPANDA_VERSION} installed at ${bin}.`);
}

main().catch((err) => warn(`Lightpanda install failed: ${err instanceof Error ? err.message : err}.`));
