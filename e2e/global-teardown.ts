import { stopStack } from './helpers/stack.js';

async function globalTeardown() {
  await stopStack();
  console.log('[e2e] stack stopped');
}

export default globalTeardown;
