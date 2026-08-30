import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CURRENT_INPUT_HASH_VERSION,
  LEGACY_UNVERSIONED_INPUT_HASH,
  resolveInputHashLineage,
  withInputHashLineage,
} from '../src/lib/inputHashLineage.js';

test('current versioned input hashes retain their exact version', () => {
  const hash = 'a'.repeat(64);
  assert.deepEqual(resolveInputHashLineage({ hash, version: CURRENT_INPUT_HASH_VERSION }), {
    hash,
    version: CURRENT_INPUT_HASH_VERSION,
    status: 'CURRENT_VERSIONED',
    crossVersionComparable: false,
  });
});

test('legacy unversioned hashes remain exact and are never assigned a guessed algorithm', () => {
  const hash = 'b'.repeat(64);
  assert.deepEqual(resolveInputHashLineage({ hash }), {
    hash,
    version: LEGACY_UNVERSIONED_INPUT_HASH,
    status: 'LEGACY_UNVERSIONED',
    crossVersionComparable: false,
  });
});

test('missing and malformed legacy values do not acquire fabricated provenance', () => {
  assert.equal(resolveInputHashLineage({}).status, 'NOT_RECORDED');
  assert.deepEqual(resolveInputHashLineage({ hash: 'not-a-digest', version: 'study-input-v2' }), {
    hash: 'not-a-digest',
    version: null,
    status: 'MALFORMED',
    crossVersionComparable: false,
  });
});

test('current pipeline metadata is propagated into visible and exportable result lineage', () => {
  const hash = 'c'.repeat(64);
  const result = withInputHashLineage({
    meta: {
      inputHash: hash,
      reproducibility: { inputHash: hash, inputHashVersion: CURRENT_INPUT_HASH_VERSION },
    },
  });
  assert.equal(result.meta.inputHash, hash);
  assert.equal(result.meta.inputHashVersion, CURRENT_INPUT_HASH_VERSION);
  assert.equal(result.meta.hashes.input, hash);
  assert.equal(result.meta.hashes.inputVersion, CURRENT_INPUT_HASH_VERSION);
  assert.deepEqual(result.meta.inputHashLineage, {
    hash,
    version: CURRENT_INPUT_HASH_VERSION,
    status: 'CURRENT_VERSIONED',
    crossVersionComparable: false,
  });
});

test('restored unversioned results retain their exact digest and receive explicit legacy lineage', () => {
  const hash = 'd'.repeat(64);
  const result = withInputHashLineage({ meta: { inputHash: hash } });
  assert.equal(result.meta.inputHash, hash);
  assert.equal(result.meta.inputHashVersion, LEGACY_UNVERSIONED_INPUT_HASH);
  assert.equal(result.meta.hashes.input, hash);
  assert.equal(result.meta.hashes.inputVersion, LEGACY_UNVERSIONED_INPUT_HASH);
  assert.equal(result.meta.inputHashLineage.status, 'LEGACY_UNVERSIONED');
  assert.equal(result.meta.inputHashLineage.crossVersionComparable, false);
  assert.deepEqual(withInputHashLineage(result).meta.inputHashLineage, result.meta.inputHashLineage);
});
