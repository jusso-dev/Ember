import fs from 'node:fs';
import { STACK_STATE_PATH, baseUrl as envBaseUrl, cdpWsUrl as envCdp, controlPlaneUrl as envCp } from './env.js';
import type { StackState } from './stack.js';

export function readStateSafe(): StackState | null {
  if (!fs.existsSync(STACK_STATE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(STACK_STATE_PATH, 'utf8')) as StackState;
  } catch {
    return null;
  }
}

export function baseUrl() {
  return readStateSafe()?.baseUrl || envBaseUrl();
}

export function controlPlaneUrl() {
  return readStateSafe()?.controlPlaneUrl || envCp();
}

export function cdpWsUrl() {
  return readStateSafe()?.cdpWsUrl || envCdp();
}
