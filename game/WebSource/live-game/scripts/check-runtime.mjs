import { assertProductionRuntime, runtimePolicy } from '../deployment/runtime-policy.mjs';

try {
  assertProductionRuntime(true);
  console.log(JSON.stringify({ runtime: process.versions.node, policy: runtimePolicy, passed: true }));
} catch {
  console.error(JSON.stringify({ runtime: process.versions.node, minimum: runtimePolicy.minimum, passed: false,
    reason: 'Use the reviewed patched Node.js 22 runtime; no software or security setting was changed.' }));
  process.exitCode = 1;
}
