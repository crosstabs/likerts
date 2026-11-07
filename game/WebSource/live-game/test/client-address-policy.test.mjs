import assert from 'node:assert/strict';
import test from 'node:test';
import { createClientAddressResolver } from '../deployment/client-address-policy.mjs';

test('Forwarded identities cannot be spoofed through the default or an untrusted peer', () => {
  for (const environment of [{}, { LIKERTS_LIVE_TRUSTED_PROXY_ADDRESSES: '192.0.2.1' }]) {
    const resolve = createClientAddressResolver(environment);
    assert.equal(resolve({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.99' } }), '127.0.0.1');
    assert.equal(resolve({ socket: {}, headers: { 'x-forwarded-for': '203.0.113.99' } }), 'unknown');
  }
});

test('An explicitly trusted append-only hop uses the actual appended rightmost address', () => {
  const resolve = createClientAddressResolver({ LIKERTS_LIVE_TRUSTED_PROXY_ADDRESSES: '127.0.0.1,2001:0db8:0:0:0:0:0:1' });
  assert.equal(resolve({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'x-forwarded-for': 'spoofed-by-caller, 203.0.113.7' } }), '203.0.113.7');
  assert.equal(resolve({ socket: { remoteAddress: '2001:db8::1' }, headers: { 'x-forwarded-for': '203.0.113.99, 2001:db8::9' } }), '2001:db8::9');
  assert.equal(resolve({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }), '127.0.0.1');
});

test('Ambiguous or oversized trusted-header data fails closed without echoing it', () => {
  const resolve = createClientAddressResolver({ LIKERTS_LIVE_TRUSTED_PROXY_ADDRESSES: '127.0.0.1' });
  for (const value of ['', '203.0.113.7,', '203.0.113.7, bad-secret-marker', ['203.0.113.7'], 'x'.repeat(513), Array(17).fill('203.0.113.7').join(',')]) {
    assert.throws(() => resolve({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': value } }), error => error.code === 'invalid_forwarded_address' && !error.message.includes('marker'));
  }
});

test('Proxy configuration rejects wildcard, CIDR and noncanonical IPv4 alternatives', () => {
  for (const value of ['*', '0.0.0.0/0', '127.0.0.1/32', '127.1', '0177.0.0.1', 'localhost', '203.0.113.1:443']) {
    assert.throws(() => createClientAddressResolver({ LIKERTS_LIVE_TRUSTED_PROXY_ADDRESSES: value }));
  }
});
