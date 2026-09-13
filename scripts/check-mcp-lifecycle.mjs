// Fresh public npm installation against a disposable real Rust API/PostgreSQL (never a hosted workspace).
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '../tools/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../tools/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(await readFile(join(root, 'tools/mcp/server.json'), 'utf8'));
const pkg = metadata.packages.find(value => value.registryType === 'npm');
assert.equal(pkg.identifier, '@likerts/mcp');
assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
const work = await mkdtemp(join(tmpdir(), 'likerts-mcp-lifecycle-'));
const connections = [];
let api;
const container = `likerts-mcp-lifecycle-${randomUUID()}`;
let databaseStarted = false;
const bootstrapToken = randomUUID();
const clientBootstrapToken = randomUUID();
const clientResults = [];
try {
  await exec('cargo', ['build', '--locked', '--manifest-path', join(root, 'backend/Cargo.toml'), '--bins'], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  await writeFile(join(work, 'package.json'), JSON.stringify({ name: 'likerts-public-mcp-lifecycle', version: '1.0.0', private: true }));
  await exec('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/', `${pkg.identifier}@${pkg.version}`], { cwd: work, maxBuffer: 4 * 1024 * 1024 });
  const installed = join(work, 'node_modules/@likerts/mcp');
  const actualPackage = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(actualPackage.version, pkg.version);
  assert.equal(actualPackage.mcpName, metadata.name);
  await exec('docker', ['run', '--rm', '--detach', '--name', container, '--env', 'POSTGRES_PASSWORD=local-lifecycle-only', '--publish', '127.0.0.1::5432', 'postgres:17-alpine']);
  databaseStarted = true;
  let databaseReady = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await exec('docker', ['exec', container, 'psql', '--host', '127.0.0.1', '-U', 'postgres', '-c', 'select 1']); databaseReady = true; break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(databaseReady, 'Disposable PostgreSQL did not become ready');
  const { stdout: mapping } = await exec('docker', ['port', container, '5432/tcp']);
  const databasePort = mapping.trim().split(':').at(-1);
  assert.match(databasePort, /^\d+$/);
  const ownerUrl = `postgres://postgres:local-lifecycle-only@127.0.0.1:${databasePort}/postgres`;
  await exec(join(root, 'backend/target/debug/likerts-migrate'), [], { env: { PATH: process.env.PATH ?? '', LIKERTS_MIGRATION_DATABASE_URL: ownerUrl } });
  await exec('docker', ['exec', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', "create role likerts_runtime_test login password 'local-runtime-only' noinherit nobypassrls"]);
  await exec('docker', ['cp', join(root, 'backend/provision-runtime.sql'), `${container}:/tmp/provision-runtime.sql`]);
  await exec('docker', ['exec', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'runtime_role=likerts_runtime_test', '-f', '/tmp/provision-runtime.sql']);
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  // Deliberately do not inherit DATABASE_URL, OIDC settings, or production credentials.
  api = spawn(join(root, 'backend/target/debug/likerts-server'), [], { cwd: work, env: {
    PATH: process.env.PATH ?? '', LIKERTS_ALLOW_DEV_AUTH: '1', LIKERTS_ADMISSION_MODE: 'disabled',
    DATABASE_URL: `postgres://likerts_runtime_test:local-runtime-only@127.0.0.1:${databasePort}/postgres`,
    LIKERTS_COLLECTION_CREDENTIAL_KEY: randomBytes(32).toString('base64'),
    LIKERTS_DEV_TOKENS: JSON.stringify({ [bootstrapToken]: `mcp-probe-${randomUUID()}`, [clientBootstrapToken]: `mcp-clients-${randomUUID()}` }),
    LIKERTS_BIND_ADDRESS: '127.0.0.1', LIKERTS_PORT: String(port), LIKERTS_EXPORT_DIR: join(work, 'exports'),
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [api.stdout, api.stderr]) stream.resume();
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(api.exitCode, null, 'Local API exited before readiness');
    try { if ((await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Local API did not become healthy');
  async function connect(token, collectionToken) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(installed, 'dist/main.js')], cwd: work,
      env: { PATH: process.env.PATH ?? '', LIKERTS_API_URL: origin, LIKERTS_TOKEN: token, ...(collectionToken ? { LIKERTS_COLLECTION_TOKEN: collectionToken } : {}) }, stderr: 'pipe' });
    const client = new Client({ name: 'public-package-lifecycle', version: '1.0.0' });
    connections.push({ client, transport });
    await client.connect(transport);
    return client;
  }
  async function call(client, name, args = {}) {
    const response = await client.callTool({ name, arguments: args });
    assert.notEqual(response.isError, true, `${name} failed: ${response.isError ? JSON.stringify(response.content) : ""}`);
    return response.structuredContent.result;
  }
  const bootstrap = await connect(bootstrapToken);
  const tools = await bootstrap.listTools();
  const expected = JSON.parse(await readFile(join(root, 'tools/capabilities.json'), 'utf8'));
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), expected.map(tool => tool.name).sort());
  const credential = await call(bootstrap, 'service_credentials_create', {
    name: 'Temporary scoped MCP lifecycle', scopes: ['surveys:read', 'surveys:write', 'collections:write', 'responses:read', 'responses:write', 'usage:read'],
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  const manager = await connect(credential.token);
  const surveyInput = JSON.parse(await readFile(join(root, 'control-plane/public/docs/survey-create.json'), 'utf8'));
  const sdkCapabilities = JSON.parse(await readFile(join(root, 'control-plane/public/docs/sdk-capabilities.json'), 'utf8'));
  const survey = await call(manager, 'surveys_create', { ...surveyInput, idempotencyKey: randomUUID() });
  const published = await call(manager, 'surveys_publish', { id: survey.id, revision: survey.revision, sdkCapabilities });
  const collection = await call(manager, 'collections_create', { idempotencyKey: randomUUID(), surveyId: published.surveyId, version: published.version, placement: 'registry-lifecycle', sdkCapabilities });
  const collector = await connect(credential.token, collection.token);
  const config = await call(collector, 'collections_get', { id: collection.id });
  assert.equal(config.id, collection.id);
  const submission = { id: collection.id, idempotencyKey: randomUUID(), answers: { rating: 5 }, metadata: { channel: 'public-npm-mcp-rehearsal' } };
  const receipt = await call(collector, 'responses_submit', submission);
  const retry = await call(collector, 'responses_submit', submission);
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.responseId, retry.responseId);
  const responses = await call(manager, 'responses_list', { collectionId: collection.id, limit: 10 });
  assert.equal(responses.items.length, 1);
  assert.equal(responses.items[0].receipt.responseId, receipt.responseId);
  assert.deepEqual(responses.items[0].answers, submission.answers);
  assert.deepEqual(responses.items[0].metadata, submission.metadata);
  const limitedCredential = await call(bootstrap, 'service_credentials_create', { name: 'Read only MCP probe', scopes: ['surveys:read'], expiresAt: new Date(Date.now() + 3600000).toISOString() });
  const reader = await connect(limitedCredential.token);
  await call(reader, 'surveys_list');
  if (process.argv.includes('--clients')) {
    const clientBootstrap = await connect(clientBootstrapToken);
    const clientCredential = await call(clientBootstrap, 'service_credentials_create', { name: 'Temporary real-client read probe', scopes: ['surveys:read'], expiresAt: new Date(Date.now() + 3600000).toISOString() });
    const executable = join(work, 'node_modules/.bin/likerts-mcp');
    // Preserve account/config locations unchanged, without forwarding unrelated provider or production secrets.
    const clientEnv = Object.fromEntries(['PATH', 'HOME', 'CODEX_HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM'].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
    Object.assign(clientEnv, { LIKERTS_API_URL: origin, LIKERTS_TOKEN: clientCredential.token });
    const prompt = 'This is a bounded integration test. Use only the Likerts MCP surveys_list tool exactly once with empty arguments. Do not read files, environment variables, credentials, or use shell/network/other tools. Report whether the returned survey list is empty. Do not substitute a guess if the MCP call is unavailable.';
    const configPath = join(work, 'client-mcp.json');
    await writeFile(configPath, JSON.stringify({ mcpServers: { likerts_probe: { type: 'stdio', command: executable, env: { LIKERTS_API_URL: '${LIKERTS_API_URL}', LIKERTS_TOKEN: '${LIKERTS_TOKEN}' } } } }));
    const probes = [
      { name: 'codex', args: ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--model', 'gpt-6-astra', '-c', 'model_reasoning_effort="low"', '--json', '-c', 'approval_policy="never"', '-c', `mcp_servers.likerts_probe.command=${JSON.stringify(executable)}`, '-c', 'mcp_servers.likerts_probe.env_vars=["LIKERTS_API_URL","LIKERTS_TOKEN"]', '-c', 'mcp_servers.likerts_probe.enabled_tools=["surveys_list"]', prompt] },
      { name: 'claude', args: ['--print', '--no-session-persistence', '--strict-mcp-config', '--mcp-config', configPath, '--setting-sources', '', '--tools', '', '--allowedTools', 'mcp__likerts_probe__surveys_list', '--output-format', 'stream-json', '--verbose', prompt] },
    ];
    for (const probe of probes) {
      let version = 'unavailable';
      try { version = (await exec(probe.name, ['--version'], { timeout: 10000 })).stdout.trim(); } catch {}
      let result;
      let output = '';
      let diagnostics = '';
      try {
        const run = await exec(probe.name, probe.args, { cwd: work, env: clientEnv, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
        output = run.stdout; diagnostics = run.stderr; result = 'completed';
      } catch (error) {
        output = error.stdout ?? ''; diagnostics = error.stderr ?? '';
        result = error.killed ? 'timeout' : error.code === 'ENOENT' ? 'client_not_installed' : 'client_failed';
      }
      const events = output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      const serialized = JSON.stringify(events);
      // Report classifications only: raw logs may contain process settings or tool results.
      const codexCalls = events.filter(event => event.type === 'item.completed' && event.item?.type === 'mcp_tool_call' && event.item?.tool === 'surveys_list').map(event => event.item);
      const claudeCalls = events.filter(event => event.type === 'assistant').flatMap(event => event.message?.content ?? []).filter(block => block.type === 'tool_use' && block.name === 'mcp__likerts_probe__surveys_list');
      const claudeResults = events.filter(event => event.type === 'user').flatMap(event => event.message?.content ?? []).filter(block => block.type === 'tool_result' && claudeCalls.some(call => call.id === block.tool_use_id));
      const called = probe.name === 'codex' ? codexCalls.length > 0 : claudeCalls.length > 0;
      const replies = probe.name === 'codex' ? codexCalls.filter(call => call.status === 'completed' && !call.error && call.result?.isError !== true).map(call => call.result) : claudeResults.filter(result => !result.is_error);
      function emptyList(value) {
        const empty = payload => Array.isArray(payload) && payload.length === 0;
        if (typeof value === 'string') { try { const parsed = JSON.parse(value); return empty(parsed) || empty(parsed?.result); } catch { return false; } }
        if (!value || typeof value !== 'object') return false;
        if (empty(value.structuredContent?.result) || empty(value.structured_content?.result)) return true;
        if (typeof value.content === 'string') return emptyList(value.content);
        return Array.isArray(value.content) && value.content.some(block => block.type === 'text' && emptyList(block.text));
      }
      const verified = called && replies.some(emptyList);
      const text = `${serialized} ${diagnostics}`;
      const classification = verified ? 'empty_survey_list_verified' : called ? 'tool_result_unverified' : /not logged in|login required|authentication|invalid api key|please run.*login|401/i.test(text) ? 'authentication_required'
        : /permission|approval|not trusted/i.test(text) ? 'approval_required' : /usage limit|rate.?limit|quota|429/i.test(text) ? 'usage_limit' : result === 'completed' ? 'client_finished_without_verified_tool' : result;
      const summary = { client: probe.name, version, status: classification, surveyListToolInvoked: called, emptyListVerified: verified };
      clientResults.push(summary);
      console.log(JSON.stringify({ clientProbe: summary }));
    }
    await call(clientBootstrap, 'workspace_delete');
  }

  const denied = await reader.callTool({ name: 'surveys_create', arguments: { ...surveyInput, idempotencyKey: randomUUID() } });
  assert.equal(denied.isError, true);
  assert.equal(JSON.parse(denied.content[0].text).error.status, 403);
  await call(manager, 'collections_update', { id: collection.id, accepting: false });
  const closed = await collector.callTool({ name: 'responses_submit', arguments: { ...submission, idempotencyKey: randomUUID() } });
  assert.equal(closed.isError, true);
  await call(manager, 'responses_delete', { id: receipt.responseId });
  assert.equal((await call(manager, 'responses_list', { collectionId: collection.id, limit: 10 })).items.length, 0);
  await call(bootstrap, 'service_credentials_revoke', { id: credential.credential.id });
  assert.equal((await manager.callTool({ name: 'usage_get', arguments: {} })).isError, true);
  await call(bootstrap, 'workspace_delete');
  if (clientResults.some(result => !result.emptyListVerified)) process.exitCode = 1;
  console.log(JSON.stringify({ package: `${pkg.identifier}@${pkg.version}`, tools: tools.tools.length, realApi: true, scopedLifecycle: true, identicalRetry: true, retrievedResponses: 1, insufficientScopeStatus: 403, collectionClosed: true, responseDeleted: true, credentialRevoked: true, storage: 'disposable-postgresql-restricted-role', ...(clientResults.length ? { clientResults } : {}) }));
} finally {
  for (const { client, transport } of connections.reverse()) { await client.close().catch(() => {}); await transport.close().catch(() => {}); }
  if (api && api.exitCode === null) { const stopped = once(api, 'exit'); api.kill('SIGTERM'); const timer = setTimeout(() => api.kill('SIGKILL'), 5000); await stopped; clearTimeout(timer); }
  if (databaseStarted) await exec('docker', ['stop', '--time', '5', container]).catch(() => {});
  await rm(work, { recursive: true, force: true });
}
