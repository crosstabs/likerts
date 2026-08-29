import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { MAX_MCP_BODY_BYTES, createMcpApiHandler } from '../api/mcp.js';

function request(extra = {}) {
  return {
    method: 'POST',
    url: '/api/mcp',
    headers: { host: 'likerts.example', 'content-type': 'application/json' },
    body: { jsonrpc: '2.0', id: 1, method: 'ping' },
    async *[Symbol.asyncIterator]() {},
    ...extra,
  };
}

function response() {
  const headers = new Map();
  return {
    statusCode: 200,
    headers,
    body: '',
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(chunk = '') { this.body += Buffer.from(chunk).toString(); this.ended = true; },
  };
}

function allowLimiter() {
  return { check: () => ({ allowed: true, limit: 10, remaining: 9, retryAfterSeconds: 60 }) };
}

function apiWithSpy(calls = []) {
  return createMcpApiHandler({
    requestLimiter: allowLimiter(),
    nodeHandler: async (req, res, parsedBody) => {
      calls.push({ req, parsedBody });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    },
  });
}

test('MCP HTTP boundary accepts absent/same-host Origins and rejects other browser Origins', async () => {
  const calls = [];
  const handler = apiWithSpy(calls);
  const nativeResponse = response();
  await handler(request(), nativeResponse);
  assert.equal(nativeResponse.statusCode, 200);

  const browserResponse = response();
  await handler(request({ headers: { host: 'likerts.example', origin: 'https://likerts.example', 'content-type': 'application/json' } }), browserResponse);
  assert.equal(browserResponse.statusCode, 200);
  assert.equal(browserResponse.headers.get('access-control-allow-origin'), 'https://likerts.example');

  const rejected = response();
  await handler(request({ headers: { host: 'likerts.example', origin: 'https://evil.example', 'content-type': 'application/json' } }), rejected);
  assert.equal(rejected.statusCode, 403);
  assert.equal(JSON.parse(rejected.body).error.data.code, 'ORIGIN_NOT_ALLOWED');
  assert.equal(calls.length, 2);
});

test('MCP HTTP boundary validates methods, media type, JSON, and body size before dispatch', async () => {
  const calls = [];
  const handler = apiWithSpy(calls);

  const wrongMethod = response();
  await handler(request({ method: 'PATCH' }), wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);

  const wrongType = response();
  await handler(request({ headers: { host: 'likerts.example', 'content-type': 'text/plain' } }), wrongType);
  assert.equal(wrongType.statusCode, 415);

  const invalidJson = response();
  await handler(request({ body: '{broken' }), invalidJson);
  assert.equal(invalidJson.statusCode, 400);

  const oversized = response();
  await handler(request({ body: 'x'.repeat(MAX_MCP_BODY_BYTES + 1) }), oversized);
  assert.equal(oversized.statusCode, 413);

  const declaredOversized = response();
  await handler(request({ headers: { host: 'likerts.example', 'content-type': 'application/json', 'content-length': String(MAX_MCP_BODY_BYTES + 1) } }), declaredOversized);
  assert.equal(declaredOversized.statusCode, 413);
  assert.equal(calls.length, 0);
});

test('MCP HTTP boundary parses a valid body, handles preflight, and applies anonymous request limiting', async () => {
  const calls = [];
  const handler = apiWithSpy(calls);
  const accepted = response();
  await handler(request({ body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' }) }), accepted);
  assert.deepEqual(calls[0].parsedBody, { jsonrpc: '2.0', id: 7, method: 'ping' });

  const preflight = response();
  await handler(request({ method: 'OPTIONS', headers: { host: 'likerts.example', origin: 'https://likerts.example' }, body: undefined }), preflight);
  assert.equal(preflight.statusCode, 204);

  const limitedHandler = createMcpApiHandler({
    nodeHandler: async () => { throw new Error('must not dispatch'); },
    requestLimiter: { check: () => ({ allowed: false, limit: 1, remaining: 0, retryAfterSeconds: 45 }) },
  });
  const limited = response();
  await limitedHandler(request(), limited);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers.get('retry-after'), '45');
});

test('Vercel-style Node handler serves the current Streamable HTTP protocol end to end', async () => {
  const apiHandler = createMcpApiHandler();
  const httpServer = createServer((req, res) => { void apiHandler(req, res); });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const client = new Client(
    { name: 'likerts-http-boundary-test', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  );
  try {
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/api/mcp`));
    await client.connect(transport);
    assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
    const { tools } = await client.listTools();
    assert.ok(tools.some((tool) => tool.name === 'validate_research_brief'));
    const result = await client.callTool({
      name: 'validate_research_brief',
      arguments: { brief: { prompt: 'Would people use this synthetic concept?', audience: 'Product teams', panelSize: 100 } },
    });
    assert.equal(result.structuredContent.validation.valid, true);
  } finally {
    await client.close();
    await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  }
});
