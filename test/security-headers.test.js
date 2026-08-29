import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Vercel applies baseline security headers without blocking future ad resources', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const globalHeaders = config.headers?.find((entry) => entry.source === '/(.*)')?.headers || [];
  const headers = Object.fromEntries(globalHeaders.map(({ key, value }) => [key.toLowerCase(), value]));

  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.match(headers['strict-transport-security'], /max-age=\d+/);
  assert.match(headers['permissions-policy'], /camera=\(\)/);
  assert.match(headers['content-security-policy'], /object-src 'none'/);
  assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.doesNotMatch(headers['content-security-policy'], /default-src/);
});
