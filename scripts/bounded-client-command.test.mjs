import test from 'node:test';
import assert from 'node:assert/strict';
import { runBoundedClient } from './bounded-client-command.mjs';

test('a client reading stdin receives EOF without waiting for the deadline', async () => {
  const result = await runBoundedClient(process.execPath, ['-e', 'console.log(require("node:fs").readFileSync(0).length)'], { timeout: 2000 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), '0');
  assert.equal(result.timedOut, false);
});

test('timeout remains a timeout when a child handles SIGTERM with exit zero', async () => {
  const result = await runBoundedClient(process.execPath, ['-e', 'process.on("SIGTERM",()=>process.exit(0)); setInterval(()=>{},1000)'], { timeout: 300 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, true);
});
