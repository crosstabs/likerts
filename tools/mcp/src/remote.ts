import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {LikertsClient} from './client.js';
import {createServer as createLikertsServer} from './server.js';

const WORKSPACE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_BODY_BYTES = 64 * 1024;

export interface RemoteMcpConfig {
  apiUrl: string;
  publicOrigin: string;
  authorizationServer: string;
  allowedOrigins: ReadonlySet<string>;
  fetch?: typeof fetch;
}

export function parseOrigin(value: string, name: string, allowLoopback = false): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a valid origin`); }
  const loopback = allowLoopback && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!loopback && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS origin without credentials, path, query or fragment`);
  }
  return url;
}

export function remoteConfigFromEnvironment(env: NodeJS.ProcessEnv = process.env): RemoteMcpConfig {
  const apiUrl = parseOrigin(env.LIKERTS_API_URL ?? '', 'LIKERTS_API_URL', true).origin;
  const publicOrigin = parseOrigin(env.LIKERTS_MCP_PUBLIC_ORIGIN ?? '', 'LIKERTS_MCP_PUBLIC_ORIGIN', true).origin;
  const authorizationServer = parseOrigin(env.LIKERTS_OIDC_ISSUER ?? '', 'LIKERTS_OIDC_ISSUER').origin;
  const allowedOrigins = new Set((env.LIKERTS_MCP_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean).map(value => parseOrigin(value.trim(), 'LIKERTS_MCP_ALLOWED_ORIGINS', true).origin));
  if (!allowedOrigins.size) throw new Error('LIKERTS_MCP_ALLOWED_ORIGINS must contain at least one trusted origin');
  return {apiUrl, publicOrigin, authorizationServer, allowedOrigins};
}

function cors(req: IncomingMessage, res: ServerResponse, config: RemoteMcpConfig): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!config.allowedOrigins.has(origin)) {
    res.writeHead(403, {'content-type': 'application/json', vary: 'Origin'}).end(JSON.stringify({error: 'origin_not_allowed'}));
    return false;
  }
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-expose-headers', 'Mcp-Session-Id, WWW-Authenticate');
  res.setHeader('vary', 'Origin');
  return true;
}

function metadata(config: RemoteMcpConfig) {
  return {
    resource: config.publicOrigin,
    authorization_servers: [config.authorizationServer],
    bearer_methods_supported: ['header'],
    scopes_supported: [
      'surveys:read', 'surveys:write', 'collections:write', 'responses:read', 'responses:write',
      'usage:read', 'exports:read', 'exports:write', 'identity:write', 'billing:write',
      'webhooks:read', 'webhooks:write'
    ]
  };
}

function challenge(config: RemoteMcpConfig): string {
  return `Bearer resource_metadata="${config.publicOrigin}/.well-known/oauth-protected-resource"`;
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new Error('payload_too_large');
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('invalid_json'); }
}

export function createRemoteMcpHttpServer(config: RemoteMcpConfig) {
  // Validate trust-boundary configuration before opening a listening socket.
  parseOrigin(config.apiUrl, 'LIKERTS_API_URL', true);
  parseOrigin(config.publicOrigin, 'LIKERTS_MCP_PUBLIC_ORIGIN', true);
  parseOrigin(config.authorizationServer, 'LIKERTS_OIDC_ISSUER');
  return createServer(async (req, res) => {
    if (req.url === '/health') {
      if (req.method !== 'GET') {
        res.writeHead(405, {allow: 'GET'}).end();
        return;
      }
      res.writeHead(200, {'content-type': 'application/json', 'cache-control': 'no-store'}).end(JSON.stringify({service: 'likerts-mcp', status: 'ok'}));
      return;
    }
    if (!cors(req, res, config)) return;
    const url = new URL(req.url ?? '/', config.publicOrigin);
    if (url.pathname === '/.well-known/oauth-protected-resource') {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-headers': 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id',
          'access-control-max-age': '600'
        }).end();
      } else if (req.method === 'GET') {
        res.writeHead(200, {'content-type': 'application/json', 'cache-control': 'public, max-age=300'}).end(JSON.stringify(metadata(config)));
      } else res.writeHead(405, {allow: 'GET, OPTIONS'}).end();
      return;
    }
    const match = /^\/mcp\/([^/]+)$/.exec(url.pathname);
    if (!match || !WORKSPACE.test(match[1])) {
      res.writeHead(404, {'content-type': 'application/json'}).end(JSON.stringify({error: 'not_found'}));
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, X-Likerts-Collection-Token',
        'access-control-max-age': '600'
      }).end();
      return;
    }
    const authorization = req.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token || token.trim() !== token || token.includes(' ')) {
      res.writeHead(401, {'content-type': 'application/json', 'www-authenticate': challenge(config)}).end(JSON.stringify({error: 'unauthorized'}));
      return;
    }
    if (!['GET', 'POST', 'DELETE'].includes(req.method ?? '')) {
      res.writeHead(405, {allow: 'GET, POST, DELETE, OPTIONS'}).end();
      return;
    }
    let parsed: unknown = undefined;
    if (req.method === 'POST') {
      try { parsed = await body(req); }
      catch (error) {
        const tooLarge = error instanceof Error && error.message === 'payload_too_large';
        res.writeHead(tooLarge ? 413 : 400, {'content-type': 'application/json'}).end(JSON.stringify({error: tooLarge ? 'payload_too_large' : 'invalid_json'}));
        return;
      }
    }
    const collectionHeader = req.headers['x-likerts-collection-token'];
    const collectionToken = typeof collectionHeader === 'string' && collectionHeader.length <= 512 ? collectionHeader : undefined;
    const client = new LikertsClient(config.apiUrl, token, collectionToken, config.fetch ?? fetch, match[1]);
    const server = createLikertsServer(client);
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined});
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
    } catch {
      if (!res.headersSent) res.writeHead(500, {'content-type': 'application/json'}).end(JSON.stringify({jsonrpc: '2.0', error: {code: -32603, message: 'Internal server error'}, id: null}));
    } finally {
      await transport.close();
      await server.close();
    }
  });
}
