import { readFileSync } from 'node:fs';
export interface Capability { name: string; method: string; path: string; description: string; input: string; auth: 'management' | 'collection' }
export const capabilities: Capability[] = JSON.parse(readFileSync(new URL('../../capabilities.json', import.meta.url), 'utf8'));
export class LikertsHttpError extends Error {
  constructor(public operation: string, public status: number) {
    super(`Likerts ${operation} failed (HTTP ${status})`);
  }
}
export class LikertsClient {
  private base: URL;
  constructor(baseUrl: string, private managementToken?: string, private collectionToken?: string, private transport: typeof fetch = fetch, private workspaceId?: string) {
    try { this.base = new URL(baseUrl); }
    catch { throw new Error('LIKERTS_API_URL must be a valid origin'); }
    if (this.base.username || this.base.password || this.base.search || this.base.hash || this.base.pathname !== '/') throw new Error('LIKERTS_API_URL must be an origin without credentials, path, query or fragment');
    if (this.base.protocol !== 'https:' && !(this.base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(this.base.hostname))) throw new Error('HTTPS is required except on loopback');
  }
  async call(name: string, input: Record<string, unknown>): Promise<unknown> {
    const operation = capabilities.find(c => c.name === name);
    if (!operation) throw new Error('Unknown capability');
    const token = operation.auth === 'management' ? this.managementToken : this.collectionToken;
    if (!token) throw new Error(`Missing ${operation.auth} credential`);
    let path = operation.path;
    const body = { ...input };
    if (path.includes('{id}')) {
      if (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(input.id)) throw new Error('Invalid resource ID');
      path = path.replace('{id}', encodeURIComponent(input.id)); delete body.id;
    }
    const url = new URL(path, this.base);
    if (operation.method === 'GET') {
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue;
        if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error('Invalid query input');
        url.searchParams.set(key, String(value));
      }
    }
    const response = await this.transport(url, {
      method: operation.method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(operation.auth === 'management' && this.workspaceId ? {'x-likerts-workspace': this.workspaceId} : {}) },
      ...(operation.method === 'GET' ? {} : {body: JSON.stringify(body)})
    });
    // Do not echo upstream bodies: malformed servers may return credentials or HTML.
    if (!response.ok) throw new LikertsHttpError(name, response.status);
    if (response.status === 204) return {};
    try { return await response.json(); }
    catch { throw new Error('Server returned invalid JSON'); }
  }
}
