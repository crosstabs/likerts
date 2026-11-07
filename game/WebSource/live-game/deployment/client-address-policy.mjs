import { isIP } from 'node:net';
import { fail } from '../server/errors.mjs';

function canonical(value) {
  if (typeof value !== 'string' || value.length > 64 || value.includes('%') || !isIP(value)) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1];
  if (isIP(value) === 4) return value;
  const normalized = new URL(`http://[${value}]`).hostname.slice(1, -1);
  const hexMapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(normalized);
  if (!hexMapped) return normalized;
  const number = parseInt(hexMapped[1], 16) * 65536 + parseInt(hexMapped[2], 16);
  return [24, 16, 8, 0].map(shift => (number >>> shift) & 255).join('.');
}

/** Disabled by default. The operator must verify an append-only, one-hop ingress first.
 * No CIDR/wildcard trust, leftmost-header trust, or automatic Render/Vercel trust exists.
 */
export function createClientAddressResolver(environment = process.env) {
  const text = environment.LIKERTS_LIVE_TRUSTED_PROXY_ADDRESSES ?? '';
  if (typeof text !== 'string' || text.length > 2048) throw new Error('Use a bounded explicit trusted-proxy address list.');
  const parts = text.split(',').map(value => value.trim()).filter(Boolean);
  const addresses = parts.map(canonical);
  if (parts.length > 32 || addresses.some(value => value === null)) throw new Error('Trusted proxies must be exact IPv4 or IPv6 addresses.');
  const trusted = new Set(addresses);
  return request => {
    const peer = canonical(request.socket?.remoteAddress) ?? 'unknown';
    if (!trusted.has(peer)) return peer;
    const forwarded = request.headers?.['x-forwarded-for'];
    // Health checks or direct provider traffic may have no forwarding header.
    // Keeping the actual TCP peer is conservative; it never grants a new identity.
    if (forwarded === undefined) return peer;
    if (typeof forwarded !== 'string' || forwarded.length > 512) fail('invalid_forwarded_address', 'This connection could not be identified safely.');
    const hops = forwarded.split(',');
    const address = hops.length <= 16 ? canonical(hops.at(-1).trim()) : null;
    if (!address) fail('invalid_forwarded_address', 'This connection could not be identified safely.');
    return address;
  };
}
