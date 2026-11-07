import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { localTestDatabaseURL } from '../deployment/local-test-database.mjs';

test('Dedicated numeric loopback targets preserve their actual pg destination', () => {
  for (const host of ['127.0.0.1', '[::1]']) {
    const target = localTestDatabaseURL(`postgresql://synthetic:fixture-only@${host}:54329/likerts_live_test`);
    const actual = new pg.Client({ connectionString: target.href }).connectionParameters;
    assert.equal(actual.host, host === '[::1]' ? '::1' : host);
    assert.equal(actual.port, 54329); assert.equal(actual.database, 'likerts_live_test');
  }
});

test('Local-only experiments reject driver destination, schema, credential and TLS overrides before connecting', () => {
  const base = 'postgresql://synthetic:fixture-only@127.0.0.1:54329/likerts_live_test';
  for (const option of ['host=example.invalid', 'port=1', 'database=unrelated', 'user=other', 'password=other',
    'options=-csearch_path%3Dpublic', 'sslmode=verify-full', 'host=127.0.0.1&host=example.invalid']) {
    assert.throws(() => localTestDatabaseURL(base + '?' + option));
  }
  assert.throws(() => localTestDatabaseURL(base + '#fragment'));
});

test('Local-only experiments reject missing, named, hosted and unrelated database targets with a redacted error', () => {
  for (const input of [undefined, '', 'not-a-url', 'postgresql://localhost/likerts_live_test',
    'postgresql://fixture-only@example.invalid/likerts_live_test', 'postgresql://127.0.0.1/another_database',
    'https://127.0.0.1/likerts_live_test']) {
    assert.throws(() => localTestDatabaseURL(input), error => !error.message.includes('fixture-only'));
  }
});
