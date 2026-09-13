import 'server-only';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('Local feedback configuration is incomplete.');
  return value;
}

// This sample has no operator login. Fail closed outside the configured loopback host.
export function assertLocalRequest(request: Request) {
  if (process.env.LIKERTS_EXAMPLE_LOCAL_OPERATOR !== '1') throw new Error('Local operator example is disabled.');
  const expected = new URL(required('LIKERTS_EXAMPLE_ORIGIN'));
  if (expected.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(expected.hostname)
      || expected.pathname !== '/' || expected.search || expected.hash || expected.username || expected.password
      || request.headers.get('host') !== expected.host
      || (request.headers.get('origin') && request.headers.get('origin') !== expected.origin)
      || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new Error('Use the configured loopback example origin.');
  }
}

export function collectionConfig() {
  const api = new URL(required('LIKERTS_API_URL'));
  if ((api.protocol !== 'https:' && !(api.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(api.hostname)))
      || api.username || api.password || api.pathname !== '/' || api.search || api.hash) {
    throw new Error('API origin is invalid.');
  }
  return { apiOrigin: api.origin, collectionId: required('LIKERTS_COLLECTION_ID'),
    collectionToken: required('LIKERTS_COLLECTION_TOKEN') };
}

export async function findResponse(responseId: string) {
  const config = collectionConfig();
  const query = new URLSearchParams({ collectionId: config.collectionId, limit: '100' });
  const response = await fetch(`${config.apiOrigin}/v1/responses?${query}`, {
    headers: { Authorization: `Bearer ${required('LIKERTS_TOKEN')}` },
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('The API could not retrieve the response.');
  const body = await response.json();
  const item = body.items.find((value: { receipt: { responseId: string } }) => value.receipt.responseId === responseId);
  return item ?? null;
}
