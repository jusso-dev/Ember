import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(__dirname, '../..');
export const E2E_ROOT = path.resolve(__dirname, '..');
export const STACK_STATE_PATH = path.join(E2E_ROOT, '.stack-state.json');
export const AUTH_STATE_PATH = path.join(E2E_ROOT, '.auth/owner.json');

export const OWNER = {
  name: 'E2E Owner',
  email: 'owner@ember.e2e',
  password: 'ember-e2e-password-1',
  tenant: 'E2E Homelab',
} as const;

export function ports() {
  return {
    controlPlane: Number(process.env.E2E_CP_PORT || 18080),
    web: Number(process.env.E2E_WEB_PORT || 13000),
    cdp: Number(process.env.E2E_CDP_PORT || 19222),
  };
}

export function baseUrl() {
  return process.env.E2E_BASE_URL || `http://127.0.0.1:${ports().web}`;
}

export function controlPlaneUrl() {
  return process.env.E2E_CP_URL || `http://127.0.0.1:${ports().controlPlane}`;
}

export function cdpWsUrl() {
  if (process.env.CDP_WS_URL) return process.env.CDP_WS_URL;
  if (process.env.LPD_TOKEN) {
    const region = process.env.LPD_REGION || 'euwest';
    return `wss://${region}.cloud.lightpanda.io/ws?token=${process.env.LPD_TOKEN}`;
  }
  return `ws://127.0.0.1:${ports().cdp}`;
}

export function useExternalStack() {
  return process.env.E2E_EXTERNAL_STACK === '1' || process.env.E2E_EXTERNAL_STACK === 'true';
}

export function useLightpandaCloud() {
  return Boolean(process.env.LPD_TOKEN || process.env.CDP_WS_URL?.startsWith('wss://'));
}
