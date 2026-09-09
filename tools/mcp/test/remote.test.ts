import assert from 'node:assert/strict';
import {once} from 'node:events';
import {afterEach, test} from 'node:test';
import type {AddressInfo} from 'node:net';
import type {Server} from 'node:http';
import {createRemoteMcpHttpServer, remoteConfigFromEnvironment} from '../src/remote.js';

const open: Server[] = [];
afterEach(async () => Promise.all(open.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))));

async function fixture(upstream: typeof fetch = fetch) {
  const server = createRemoteMcpHttpServer({
    apiUrl: 'https://api.example.com',
    publicOrigin: 'https://mcp.example.com',
    authorizationServer: 'https://issuer.example.com',
    allowedOrigins: new Set(['https://app.example.com']),
    fetch: upstream
  });
  open.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function rpc(response: Response): Promise<{result:{tools:unknown[]}}> {
  const text = await response.text();
  const data = response.headers.get('content-type')?.includes('text/event-stream')
    ? text.split('\n').find(line => line.startsWith('data: '))?.slice(6)
    : text;
  if (!data) throw new Error('MCP response did not contain a message');
  return JSON.parse(data);
}

test('publishes OAuth resource metadata and browser preflight without wildcard CORS', async () => {
  const base = await fixture();
  const response = await fetch(`${base}/.well-known/oauth-protected-resource`, {headers: {origin: 'https://app.example.com'}});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example.com');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.deepEqual(await response.json(), {
    resource: 'https://mcp.example.com',
    authorization_servers: ['https://issuer.example.com'],
    bearer_methods_supported: ['header'],
    scopes_supported: ['surveys:read','surveys:write','collections:write','responses:read','responses:write','usage:read','exports:read','exports:write','identity:write','billing:write','webhooks:read','webhooks:write']
  });
  const preflight = await fetch(`${base}/mcp/workspace_1`, {method: 'OPTIONS', headers: {origin: 'https://app.example.com'}});
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /Authorization/);
  const denied = await fetch(`${base}/mcp/workspace_1`, {method: 'OPTIONS', headers: {origin: 'https://evil.example'}});
  assert.equal(denied.status, 403);
});

test('exposes a minimal health check only after configuration validates', async () => {
  const base = await fixture();
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {service: 'likerts-mcp', status: 'ok'});
  assert.equal((await fetch(`${base}/health`, {method: 'POST'})).status, 405);
});

test('challenges missing bearer credentials and rejects ambiguous workspaces', async () => {
  const base = await fixture();
  const response = await fetch(`${base}/mcp/workspace_1`, {method: 'POST', body: '{}'});
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('www-authenticate'), 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"');
  assert.equal((await fetch(`${base}/mcp/a%2Fb`, {method: 'POST', headers: {authorization: 'Bearer token'}, body: '{}'})).status, 404);
  assert.equal((await fetch(`${base}/mcp/workspace_1/extra`, {method: 'POST', headers: {authorization: 'Bearer token'}, body: '{}'})).status, 404);
});

test('runs the existing registry over stateless Streamable HTTP with exact workspace binding', async () => {
  const calls: Array<{url: string; authorization: string|null; workspace: string|null}> = [];
  const base = await fixture(async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({url: String(input), authorization: headers.get('authorization'), workspace: headers.get('x-likerts-workspace')});
    return Response.json({items: []});
  });
  const headers = {'authorization': 'Bearer oauth-access-token', 'content-type': 'application/json', 'accept': 'application/json, text/event-stream'};
  const initialize = await fetch(`${base}/mcp/bank_sg`, {method: 'POST', headers, body: JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}})});
  assert.equal(initialize.status, 200);
  const listed = await fetch(`${base}/mcp/bank_sg`, {method: 'POST', headers, body: JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})});
  assert.equal(listed.status, 200);
  const payload = await rpc(listed);
  assert.equal(payload.result.tools.length, 39);
  const invoked = await fetch(`${base}/mcp/bank_sg`, {method: 'POST', headers, body: JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'surveys_list',arguments:{}}})});
  assert.equal(invoked.status, 200);
  assert.deepEqual(calls, [{url:'https://api.example.com/v1/surveys',authorization:'Bearer oauth-access-token',workspace:'bank_sg'}]);
});

test('remote configuration fails closed', () => {
  assert.throws(() => remoteConfigFromEnvironment({}), /LIKERTS_API_URL/);
  assert.throws(() => remoteConfigFromEnvironment({LIKERTS_API_URL:'https://api.example.com',LIKERTS_MCP_PUBLIC_ORIGIN:'https://mcp.example.com',LIKERTS_OIDC_ISSUER:'https://issuer.example.com'}), /ALLOWED_ORIGINS/);
  assert.throws(() => remoteConfigFromEnvironment({LIKERTS_API_URL:'https://api.example.com',LIKERTS_MCP_PUBLIC_ORIGIN:'https://mcp.example.com',LIKERTS_OIDC_ISSUER:'https://issuer.example.com',LIKERTS_MCP_ALLOWED_ORIGINS:'*'}), /valid origin/);
});
