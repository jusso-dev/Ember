import fs from 'node:fs';
import path from 'node:path';
import { applyStateEnv, startStack } from './helpers/stack.js';
import { AUTH_STATE_PATH } from './helpers/env.js';

async function globalSetup() {
  fs.mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true });
  const state = await startStack();
  applyStateEnv(state);
  // Persist for workers / teardown
  process.env.E2E_BASE_URL = state.baseUrl;
  process.env.E2E_CP_URL = state.controlPlaneUrl;
  process.env.CDP_WS_URL = state.cdpWsUrl;
  console.log(`[e2e] stack ready base=${state.baseUrl} cp=${state.controlPlaneUrl}`);
}

export default globalSetup;
