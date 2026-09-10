// Only these public, operator-owned endpoints are probed. Request input never
// becomes a URL, and no account/session credentials accompany a probe.
export const components = Object.freeze([
  { id: 'collection', name: 'Collection API and database', url: 'https://likerts-api.onrender.com/health', kind: 'api' },
  { id: 'agents', name: 'MCP gateway', url: 'https://likerts-mcp.onrender.com/health', kind: 'mcp' },
  { id: 'identity', name: 'Identity key service', url: 'https://clerk.likerts.com/.well-known/jwks.json', kind: 'identity' },
]);

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32768) throw new Error('oversized');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

export async function collectStatus({ fetcher = fetch, timeoutMs = 4000, now = () => new Date() } = {}) {
  const checkedAt = now().toISOString();
  const results = await Promise.all(components.map(async (component) => {
    const started = performance.now();
    try {
      const response = await fetcher(component.url, {
        method: 'GET', headers: { accept: 'application/json' },
        redirect: 'manual', credentials: 'omit', cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status !== 200) throw new Error('http');
      const body = await boundedJson(response);
      const valid = component.kind === 'identity'
        ? Array.isArray(body.keys) && body.keys.some(key => key.kty === 'RSA' && typeof key.n === 'string' && typeof key.e === 'string')
        : component.kind === 'api' ? body.status === 'ok' && body.storage === 'postgresql'
          : body.status === 'ok' && body.service === 'likerts-mcp';
      if (!valid) throw new Error('body');
      return { id: component.id, name: component.name, status: 'reachable', latencyMs: Math.round(performance.now() - started) };
    } catch {
      // Public output deliberately omits upstream bodies, URLs and exceptions.
      return { id: component.id, name: component.name, status: 'unavailable', latencyMs: Math.round(performance.now() - started) };
    }
  }));
  return {
    service: 'likerts', status: results.every(result => result.status === 'reachable') ? 'reachable' : 'degraded',
    checkedAt, components: results,
    scope: 'Current reachability checks. Identity checks key delivery, not email OTP. Payments, workers, response acceptance and historical uptime are not measured here.',
  };
}
