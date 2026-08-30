import { Resolver } from 'node:dns/promises';
import { Agent as HttpsAgent, request as defaultHttpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

const UNSAFE_HOST_SUFFIXES = Object.freeze([
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.invalid',
  '.test',
  '.onion',
]);
const DEFAULT_PINNED_HTTPS_ERROR_CODES = Object.freeze({
  authorityMismatch: 'PUBLIC_HTTPS_PINNED_AUTHORITY_MISMATCH',
  lookupMismatch: 'PUBLIC_HTTPS_PINNED_LOOKUP_MISMATCH',
  lookupEmpty: 'PUBLIC_HTTPS_PINNED_LOOKUP_EMPTY',
});

export class PublicAddressPinnedHttpsError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PublicAddressPinnedHttpsError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new PublicAddressPinnedHttpsError(code, message, details);
}

function ipv4Octets(address) {
  if (isIP(address) !== 4 || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return null;
  const octets = address.split('.').map((part) => Number.parseInt(part, 10));
  return octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
    ? null
    : octets;
}

function ipv4PrefixMatches(octets, prefix, prefixLength) {
  const wholeOctets = Math.floor(prefixLength / 8);
  const remainingBits = prefixLength % 8;
  return octets.slice(0, wholeOctets).every((octet, index) => octet === prefix[index])
    && (remainingBits === 0
      || (octets[wholeOctets] & (0xff << (8 - remainingBits)))
        === (prefix[wholeOctets] & (0xff << (8 - remainingBits))));
}

function ipv6Hextets(address) {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(normalized) !== 6) return null;

  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const parseHalf = (half) => (half === '' ? [] : half.split(':').map((part) => {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    return Number.parseInt(part, 16);
  }));
  const left = parseHalf(halves[0]);
  const right = halves.length === 2 ? parseHalf(halves[1]) : [];
  if (left.includes(null) || right.includes(null)) return null;

  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) return null;
  return [...left, ...Array(omitted).fill(0), ...right];
}

function ipv6PrefixMatches(hextets, prefix, prefixLength) {
  const wholeHextets = Math.floor(prefixLength / 16);
  const remainingBits = prefixLength % 16;
  return hextets.slice(0, wholeHextets).every((hextet, index) => hextet === prefix[index])
    && (remainingBits === 0
      || (hextets[wholeHextets] & (0xffff << (16 - remainingBits)))
        === (prefix[wholeHextets] & (0xffff << (16 - remainingBits))));
}

export function isPublicIpv4Address(address) {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const [first, second, third] = octets;
  return first !== 0
    && first !== 10
    && first !== 127
    && first < 224
    && !(first === 100 && second >= 64 && second <= 127)
    && !(first === 169 && second === 254)
    && !(first === 172 && second >= 16 && second <= 31)
    && !(first === 192 && second === 0 && third === 0)
    && !(first === 192 && second === 0 && third === 2)
    && !(first === 192 && second === 168)
    && !(first === 198 && (second === 18 || second === 19))
    && !(first === 198 && second === 51 && third === 100)
    && !(first === 203 && second === 0 && third === 113)
    && !ipv4PrefixMatches(octets, [192, 88, 99, 0], 24);
}

export function isPublicIpv6Address(address) {
  const hextets = ipv6Hextets(address);
  if (!hextets) return false;
  const globalUnicast = ipv6PrefixMatches(hextets, [0x2000], 3);
  return globalUnicast
    && !ipv6PrefixMatches(hextets, [0x2001, 0x0db8], 32)
    && !ipv6PrefixMatches(hextets, [0x2001], 23)
    && !ipv6PrefixMatches(hextets, [0x2002], 16)
    && !ipv6PrefixMatches(hextets, [0x3fff], 20);
}

export function isPublicHttpsHostname(hostname) {
  const normalized = hostname.replace(/\.$/, '').toLowerCase();
  const unbracketed = normalized.replace(/^\[|\]$/g, '');
  const ipVersion = isIP(unbracketed);
  if (ipVersion === 4) return isPublicIpv4Address(unbracketed);
  if (ipVersion === 6) return isPublicIpv6Address(unbracketed);
  return normalized.includes('.')
    && normalized !== 'localhost'
    && !UNSAFE_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function dnsNoRecords(error) {
  return ['ENODATA', 'ENOTFOUND'].includes(error?.code);
}

/**
 * Creates a cancelable resolver that returns both DNS families as typed address
 * records. Callers can inject the Node-like resolver factory in tests.
 */
export function createPublicAddressResolver({
  resolverFactory = () => new Resolver(),
} = {}) {
  const resolver = resolverFactory();
  if (!resolver
    || typeof resolver.resolve4 !== 'function'
    || typeof resolver.resolve6 !== 'function'
    || typeof resolver.cancel !== 'function') {
    throw new TypeError('Evidence resolver must expose resolve4, resolve6, and cancel.');
  }
  return Object.freeze({
    async resolve(hostname) {
      const results = await Promise.allSettled([
        resolver.resolve4(hostname),
        resolver.resolve6(hostname),
      ]);
      const addresses = [];
      for (const [index, result] of results.entries()) {
        if (result.status === 'rejected') {
          if (dnsNoRecords(result.reason)) continue;
          throw result.reason;
        }
        if (!Array.isArray(result.value)) {
          throw new TypeError('DNS resolver returned an invalid address list.');
        }
        const family = index === 0 ? 4 : 6;
        addresses.push(...result.value.map((address) => ({ address, family })));
      }
      return addresses;
    },
    cancel() {
      resolver.cancel();
    },
  });
}

export function createInjectedAddressResolver(resolveHostname) {
  const controller = new AbortController();
  return Object.freeze({
    resolve(hostname) {
      return resolveHostname(hostname, { signal: controller.signal });
    },
    cancel() {
      controller.abort();
    },
  });
}

export function normalizePinnedHostname(url) {
  return url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

/**
 * Resolves a hostname once, cancels the resolver in all cases, and only
 * returns global unicast addresses suitable for a pinned HTTPS lookup.
 */
export async function resolvePublicPinnedAuthorityAddresses(hostname, createResolver, timeoutMs) {
  if (typeof createResolver !== 'function') {
    fail(
      'PUBLIC_HTTPS_RESOLVER_UNAVAILABLE',
      'Published evidence requires a hostname resolver before artifact fetches.',
    );
  }
  let resolver;
  try {
    resolver = createResolver();
  } catch (error) {
    fail(
      'PUBLIC_HTTPS_RESOLVER_UNAVAILABLE',
      'Published evidence requires a valid cancelable hostname resolver.',
      { hostname, cause: error?.message || 'unknown' },
    );
  }
  if (!resolver || typeof resolver.resolve !== 'function' || typeof resolver.cancel !== 'function') {
    fail(
      'PUBLIC_HTTPS_RESOLVER_UNAVAILABLE',
      'Published evidence requires a valid cancelable hostname resolver.',
      { hostname },
    );
  }
  let timedOut = false;
  let resolverCancelled = false;
  let timeoutHandle;
  let resolved;
  const cancelResolver = () => {
    if (resolverCancelled) return;
    resolverCancelled = true;
    try {
      resolver.cancel();
    } catch {
      // Cancellation is cleanup and must not replace the authoritative result.
    }
  };
  try {
    const timeout = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        cancelResolver();
        reject(new PublicAddressPinnedHttpsError(
          'PUBLIC_HTTPS_RESOLUTION_TIMEOUT',
          'The published-evidence authority resolution exceeded the smoke timeout.',
          { hostname, timeoutMs },
        ));
      }, timeoutMs);
    });
    const operation = Promise.resolve().then(() => resolver.resolve(hostname));
    resolved = await Promise.race([operation, timeout]);
  } catch (error) {
    if (timedOut) {
      fail(
        'PUBLIC_HTTPS_RESOLUTION_TIMEOUT',
        'The published-evidence authority resolution exceeded the smoke timeout.',
        { hostname, timeoutMs },
      );
    }
    if (error instanceof PublicAddressPinnedHttpsError) throw error;
    fail(
      'PUBLIC_HTTPS_RESOLUTION_FAILED',
      'The published-evidence authority could not be resolved before artifact fetches.',
      { hostname, cause: error?.code || error?.message || 'unknown' },
    );
  } finally {
    clearTimeout(timeoutHandle);
    cancelResolver();
  }
  if (!Array.isArray(resolved) || resolved.length === 0) {
    fail(
      'PUBLIC_HTTPS_RESOLUTION_INVALID',
      'The published-evidence resolver did not return any valid A or AAAA addresses.',
      { hostname },
    );
  }
  const addresses = [];
  for (const entry of resolved) {
    const address = typeof entry === 'string' ? entry : entry?.address;
    const family = isIP(address || '');
    const declaredFamily = typeof entry === 'string' ? family : entry?.family;
    if (!family || declaredFamily !== family) {
      fail(
        'PUBLIC_HTTPS_RESOLUTION_INVALID',
        'The published-evidence resolver returned an invalid A or AAAA address.',
        { hostname },
      );
    }
    if ((family === 4 && !isPublicIpv4Address(address))
      || (family === 6 && !isPublicIpv6Address(address))) {
      fail(
        'PUBLIC_HTTPS_RESOLUTION_UNSAFE',
        'The published-evidence authority resolves to a non-global address.',
        { hostname, address },
      );
    }
    addresses.push({ address, family });
  }
  return [...new Map(
    addresses.map((entry) => [`${entry.family}:${entry.address}`, entry]),
  ).values()].sort((left, right) => (
    left.family - right.family || left.address.localeCompare(right.address)
  ));
}

function transportError(code, message) {
  return Object.assign(new Error(message), { code });
}

function createPinnedLookup(authority, errorCodes) {
  const addresses = authority.addresses.map((entry) => ({ ...entry }));
  return (requestedHostname, options, callback) => {
    const hostname = String(requestedHostname || '')
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '')
      .toLowerCase();
    if (hostname !== authority.hostname) {
      callback(transportError(
        errorCodes.lookupMismatch,
        'Pinned HTTPS lookup was asked to resolve an unexpected hostname.',
      ));
      return;
    }
    const requestedFamily = Number(options?.family || 0);
    const candidates = requestedFamily === 4 || requestedFamily === 6
      ? addresses.filter((entry) => entry.family === requestedFamily)
      : addresses;
    if (candidates.length === 0) {
      callback(transportError(
        errorCodes.lookupEmpty,
        'Pinned HTTPS lookup has no approved address for the requested DNS family.',
      ));
      return;
    }
    if (options?.all) {
      callback(null, candidates.map((entry) => ({ address: entry.address, family: entry.family })));
      return;
    }
    callback(null, candidates[0].address, candidates[0].family);
  };
}

function responseHeadersFromIncoming(response) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers || {})) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, String(value));
    }
  }
  return headers;
}

function abortError(reason) {
  if (reason instanceof Error) return reason;
  const error = new Error('The pinned HTTPS request was aborted.');
  error.name = 'AbortError';
  return error;
}

function validPinnedAuthorityAddress(entry) {
  const family = isIP(entry?.address || '');
  return (family === 4 || family === 6)
    && entry.family === family
    && (family === 4 ? isPublicIpv4Address(entry.address) : isPublicIpv6Address(entry.address));
}

/**
 * Fetches an HTTPS URL while keeping the hostname intact for Host, certificate
 * validation, and SNI. Only the socket lookup is pinned to validated IPs.
 */
export function createPinnedPublicHttpsFetch(authority, {
  httpsRequestImpl = defaultHttpsRequest,
  agentFactory = (options) => new HttpsAgent(options),
  errorCodes = DEFAULT_PINNED_HTTPS_ERROR_CODES,
} = {}) {
  if (!authority || typeof authority !== 'object'
    || typeof authority.authorityOrigin !== 'string'
    || typeof authority.hostname !== 'string'
    || !Array.isArray(authority.addresses)
    || authority.addresses.length === 0
    || authority.addresses.some((entry) => !validPinnedAuthorityAddress(entry))
    || typeof httpsRequestImpl !== 'function'
    || typeof agentFactory !== 'function') {
    throw new TypeError('Pinned HTTPS fetch requires an authority, approved addresses, and HTTPS request primitives.');
  }
  return async function pinnedHttpsFetch(input, options = {}) {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.origin !== authority.authorityOrigin) {
      throw transportError(
        errorCodes.authorityMismatch,
        'Pinned HTTPS fetch was asked to fetch outside its approved authority.',
      );
    }
    const lookup = createPinnedLookup(authority, errorCodes);
    const agent = agentFactory({
      keepAlive: false,
      maxFreeSockets: 0,
      maxSockets: 1,
      lookup,
    });
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      agent.destroy();
    };

    return new Promise((resolve, reject) => {
      let settled = false;
      let request;
      const settleReject = (error) => {
        cleanup();
        if (settled) return;
        settled = true;
        reject(error);
      };
      const signal = options.signal;
      const abortRequest = () => {
        request?.destroy?.(abortError(signal?.reason));
        cleanup();
      };
      const requestOptions = {
        method: String(options.method || 'GET').toUpperCase(),
        protocol: 'https:',
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(new Headers(options.headers || {})),
        servername: normalizePinnedHostname(url),
        agent,
        lookup,
      };

      try {
        request = httpsRequestImpl(url, requestOptions, (incoming) => {
          incoming.once?.('end', cleanup);
          incoming.once?.('close', cleanup);
          incoming.once?.('error', cleanup);
          const body = requestOptions.method === 'HEAD' ? null : Readable.toWeb(incoming);
          const response = new Response(body, {
            status: incoming.statusCode || 599,
            headers: responseHeadersFromIncoming(incoming),
          });
          Object.defineProperty(response, 'url', { value: url.href, configurable: true });
          if (requestOptions.method === 'HEAD') cleanup();
          if (settled) return;
          settled = true;
          resolve(response);
        });
      } catch (error) {
        settleReject(error);
        return;
      }

      request.once?.('error', settleReject);
      if (signal?.aborted) {
        abortRequest();
        return;
      }
      signal?.addEventListener('abort', abortRequest, { once: true });
      request.once?.('close', () => {
        signal?.removeEventListener('abort', abortRequest);
      });
      request.end();
    });
  };
}
