import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from '../tools/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../tools/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const registry = JSON.parse(await readFile(join(root, 'tools/capabilities.json'), 'utf8'));
const work = await mkdtemp(join(tmpdir(), 'likerts-mcp-consumer-'));
let client;
let transport;
let requests = 0;
const api = createServer((req, res) => {
  if (req.url !== '/v1/usage' || req.headers.authorization !== 'Bearer package-probe-only') {
    res.writeHead(403).end();
    return;
  }
  requests++;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ acceptedResponses: 1, monthAcceptedResponses: 1 }));
});
try {
  let tarball = process.argv[2];
  if (!tarball) {
    const { stdout } = await exec('npm', ['pack', '--json', '--pack-destination', work], { cwd: join(root, 'tools/mcp'), maxBuffer: 4 * 1024 * 1024 });
    tarball = join(work, JSON.parse(stdout)[0].filename);
  }
  await writeFile(join(work, 'package.json'), JSON.stringify({ name: 'likerts-package-probe', version: '1.0.0', private: true }));
  await exec('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', resolve(tarball)], { cwd: work, maxBuffer: 4 * 1024 * 1024 });
  const installed = join(work, 'node_modules/@likerts/mcp');
  assert.match(await readFile(join(installed, 'LICENSE'), 'utf8'), /MIT License/);
  assert.deepEqual(JSON.parse(await readFile(join(installed, 'dist/data/capabilities.json'), 'utf8')), registry);
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const port = api.address().port;
  transport = new StdioClientTransport({ command: process.execPath, args: [join(installed, 'dist/main.js')], cwd: work, env: { PATH: process.env.PATH ?? '', LIKERTS_API_URL: `http://127.0.0.1:${port}`, LIKERTS_TOKEN: 'package-probe-only' }, stderr: 'pipe' });
  client = new Client({ name: 'fresh-install-probe', version: '1.0.0' });
  await client.connect(transport);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(tool => tool.name).sort(), registry.map(tool => tool.name).sort());
  const result = await client.callTool({ name: 'usage_get', arguments: {} });
  assert.notEqual(result.isError, true);
  assert.deepEqual(result.structuredContent, { result: { acceptedResponses: 1, monthAcceptedResponses: 1 } });
  assert.equal(requests, 1);
  console.log(`Fresh MCP package: ${listed.tools.length} tools discovered and authenticated usage_get passed outside the repository.`);
} finally {
  await client?.close();
  await transport?.close();
  api.closeAllConnections();
  await new Promise(resolve => api.close(resolve));
  await rm(work, { recursive: true, force: true });
}
