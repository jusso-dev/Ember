#!/usr/bin/env tsx
import { applyStateEnv, readState, startStack, stopStack } from '../helpers/stack.js';

const cmd = process.argv[2] || 'status';

async function main() {
  if (cmd === 'start') {
    const state = await startStack();
    applyStateEnv(state);
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  if (cmd === 'stop') {
    await stopStack();
    console.log('stack stopped');
    return;
  }
  if (cmd === 'status') {
    const state = readState();
    console.log(state ? JSON.stringify(state, null, 2) : 'no stack running');
    return;
  }
  console.error(`unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
