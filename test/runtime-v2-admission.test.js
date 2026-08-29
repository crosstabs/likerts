import assert from 'node:assert/strict';
import test from 'node:test';

import { createAnonymousStudyAdmission } from '../server/mcp-abuse-controls.js';
import { admissionUnitsForResearchMode } from '../server/synthetic-study-pipeline.js';

test('DEEP admission costs more quota than QUICK with safe bounded configuration', () => {
  assert.equal(admissionUnitsForResearchMode('QUICK', {}), 1);
  assert.ok(admissionUnitsForResearchMode('DEEP', {}) > admissionUnitsForResearchMode('QUICK', {}));
  assert.equal(admissionUnitsForResearchMode('DEEP', { DEEP_ADMISSION_UNITS: '999' }), 10);
});

test('optional durable admission adapter receives weighted requests and local protection is labeled fallback', async () => {
  const calls = [];
  let durableReleases = 0;
  const admission = createAnonymousStudyAdmission({
    durableAdapter: {
      async acquire(request) {
        calls.push(request);
        return { allowed: true, release: () => { durableReleases += 1; } };
      },
    },
  });

  const release = await admission.acquire({ clientKey: 'client', estimatedUnits: 3 });
  assert.deepEqual(calls, [{ clientKey: 'client', estimatedUnits: 3 }]);
  assert.equal(admission.protection.durability, 'durable-adapter-plus-process-local-fallback');
  assert.equal(admission.protection.processLocalFallback, true);
  release();
  assert.equal(durableReleases, 1);

  const fallback = createAnonymousStudyAdmission();
  assert.equal(fallback.protection.durability, 'process-local-fallback');
  assert.equal(fallback.protection.globallyDurable, false);
});
