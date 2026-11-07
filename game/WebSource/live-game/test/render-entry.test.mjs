import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveRenderEnvironment } from '../deployment/render-entry.mjs';
import pg from 'pg';

const environment = () => ({ RENDER: 'true', RENDER_SERVICE_TYPE: 'web', NODE_ENV: 'production',
  RENDER_EXTERNAL_URL: 'https://likerts-live-not-provisioned.onrender.com',
  LIKERTS_LIVE_DATABASE_URL: 'postgresql://synthetic:never-a-real-key@dpg-not-provisioned.singapore-postgres.render.com/likerts_live_staging?sslmode=verify-full' });

test('Render startup maps documented defaults without mutating the source environment', () => {
  const input = environment(), before = { ...input };
  const result = resolveRenderEnvironment(input, '22.23.4');
  assert.deepEqual(input, before);
  assert.equal(result.PORT, '10000'); assert.equal(result.LIKERTS_LIVE_BIND_ADDRESS, '0.0.0.0');
  assert.equal(result.LIKERTS_LIVE_ORIGINS, input.RENDER_EXTERNAL_URL);
  assert.equal(result.LIKERTS_LIVE_PUBLIC_ORIGIN, input.RENDER_EXTERNAL_URL);
});

test('An explicit custom game origin remains exact and must appear in the allowlist', () => {
  const input = { ...environment(), LIKERTS_LIVE_PUBLIC_ORIGIN: 'https://play.example.invalid/',
    LIKERTS_LIVE_ORIGINS: 'https://play.example.invalid' };
  const result = resolveRenderEnvironment(input, '22.23.4');
  assert.equal(result.LIKERTS_LIVE_PUBLIC_ORIGIN, 'https://play.example.invalid');
  assert.throws(() => resolveRenderEnvironment({ ...input, LIKERTS_LIVE_ORIGINS: 'https://unrelated.example.invalid' }, '22.23.4'));
});

test('Internal, unrelated and insecure database configurations cannot pass the Render preflight', () => {
  const input = environment();
  for (const uri of [
    input.LIKERTS_LIVE_DATABASE_URL.replace('sslmode=verify-full', 'sslmode=require'),
    input.LIKERTS_LIVE_DATABASE_URL + '&sslmode=verify-full',
    input.LIKERTS_LIVE_DATABASE_URL.replace('likerts_live_staging?', 'ai_boo?'),
    input.LIKERTS_LIVE_DATABASE_URL.replace('dpg-not-provisioned.singapore-postgres.render.com', 'dpg-not-provisioned-a'),
    input.LIKERTS_LIVE_DATABASE_URL + '&sslrejectunauthorized=false',
  ]) assert.throws(() => resolveRenderEnvironment({ ...input, LIKERTS_LIVE_DATABASE_URL: uri }, '22.23.4'), error => !error.message.includes('never-a-real-key'));
});

test('The provider entry does not silently enable unsafe runtime, bind or origin defaults', () => {
  for (const delta of [{ RENDER: undefined }, { NODE_ENV: 'development' }, { RENDER_SERVICE_TYPE: 'worker' },
    { LIKERTS_LIVE_BIND_ADDRESS: '127.0.0.1' }, { RENDER_EXTERNAL_URL: 'https://unrelated.example.invalid' },
    { LIKERTS_LIVE_PUBLIC_ORIGIN: 'https://user:password@example.invalid' },
    { LIKERTS_LIVE_PUBLIC_ORIGIN: 'https://play.example.invalid/path' }]) {
    assert.throws(() => resolveRenderEnvironment({ ...environment(), ...delta }, '22.23.4'));
  }
  assert.throws(() => resolveRenderEnvironment(environment(), '22.22.2'), error => error.code === 'runtime_unsupported');
});

test('The actual pg parser cannot override the validated Render destination or TLS through query parameters', () => {
  const input = environment();
  const accepted = new pg.Client({ connectionString: resolveRenderEnvironment(input, '22.23.4').LIKERTS_LIVE_DATABASE_URL }).connectionParameters;
  assert.equal(accepted.host, new URL(input.LIKERTS_LIVE_DATABASE_URL).hostname);
  assert.equal(accepted.database, 'likerts_live_staging');
  assert.notEqual(accepted.ssl.rejectUnauthorized, false);
  for (const option of ['host=example.invalid', 'port=1', 'database=unrelated', 'user=other',
    'password=other', 'options=-csearch_path%3Dpublic', 'sslcert=unapproved-file', 'SSLMODE=disable']) {
    assert.throws(() => resolveRenderEnvironment({ ...input, LIKERTS_LIVE_DATABASE_URL: input.LIKERTS_LIVE_DATABASE_URL + '&' + option }, '22.23.4'));
  }
  assert.throws(() => resolveRenderEnvironment({ ...input, LIKERTS_LIVE_DATABASE_URL: input.LIKERTS_LIVE_DATABASE_URL + '#ignored-by-driver' }, '22.23.4'));
});

test('The real check command opens no service or database and redacts its synthetic credential', () => {
  const entry = fileURLToPath(new URL('../deployment/render-entry.mjs', import.meta.url));
  const stdout = execFileSync(process.execPath, [entry, '--check'], { env: environment(), encoding: 'utf8', timeout: 3000 });
  const result = JSON.parse(stdout);
  assert.equal(result.openedConnections, 0); assert.equal(result.productionTLSHandshakeVerified, false);
  assert.equal(result.providerDeploymentVerified, false); assert.equal(result.ownerApprovalVerified, false);
  assert.equal(result.gameURL, environment().RENDER_EXTERNAL_URL + '/play');
  assert.doesNotMatch(stdout, /synthetic|never-a-real-key|postgresql:\/\//);
});

test('Pilot drafts retain one worker, explicit one-gigabyte storage and no embedded credentials', async () => {
  const service = JSON.parse(await readFile(new URL('../deployment/render.service.draft.yaml', import.meta.url), 'utf8')).services;
  const database = JSON.parse(await readFile(new URL('../deployment/render.database.draft.yaml', import.meta.url), 'utf8')).databases;
  assert.equal(service.length, 1); assert.equal(database.length, 1);
  assert.equal(service[0].numInstances, 1); assert.equal(service[0].autoDeployTrigger, 'off');
  assert.equal(service[0].envVars.find(item => item.key === 'LIKERTS_LIVE_MAX_REQUESTS').value, '1000');
  assert.equal(database[0].diskSizeGB, 1); assert.equal(database[0].storageAutoscalingEnabled, false);
  assert.equal(database[0].connectionPool, 'none'); assert.deepEqual(database[0].ipAllowList, []);
  assert.equal(service[0].envVars.find(item => item.key === 'LIKERTS_LIVE_DATABASE_URL').sync, false);
  assert.ok(service[0].envVars.every(item => !item.generateValue && !item.fromDatabase));
  assert.ok(service[0].envVars.every(item => !/PASSWORD|TOKEN|SECRET/.test(item.key)));
});
