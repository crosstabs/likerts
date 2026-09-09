import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const sentinel='LIKERTS_SYNTHETIC_SECRET_SENTINEL';
const script=name=>fileURLToPath(new URL(name,import.meta.url));
for(const [name,mode,env,expected] of [
  ['API rejects owner credential','api',{LIKERTS_MIGRATION_DATABASE_URL:sentinel},'Owner credential forbidden'],
  ['API rejects worker credential','api',{LIKERTS_WEBHOOK_DATABASE_URL:sentinel},'Worker credential forbidden'],
  ['runtime rejects dev switch','api',{LIKERTS_DEV_TOKENS:sentinel},'Development and runtime-migration switches forbidden'],
  ['worker rejects export token','worker',{LIKERTS_VERCEL_BLOB_TOKEN:sentinel},'Non-worker credential forbidden'],
  ['worker rejects plaintext DSN','worker',{LIKERTS_WEBHOOK_DATABASE_URL:`postgres://worker:${sentinel}@localhost/db`},'Explicit database TLS mode required'],
  ['MCP rejects API database credential','mcp',{DATABASE_URL:sentinel},'Data-plane credentials forbidden'],
  ['MCP fails closed without API origin','mcp',{LIKERTS_MCP_PUBLIC_ORIGIN:'https://api.example.com',LIKERTS_OIDC_ISSUER:'https://issuer.example.com',LIKERTS_MCP_ALLOWED_ORIGINS:'https://app.example.com'},'Canonical HTTPS API origin required'],
])test(name,()=>{
  const result=spawnSync('/bin/sh',[script('start.sh'),mode],{env:{PATH:process.env.PATH,...env},encoding:'utf8'});
  assert.equal(result.status,1);assert.ok(result.stderr.includes(expected));assert.ok(!result.stderr.includes(sentinel));assert.equal(result.stdout,'');
});
test('migration rejects application signing key before running SQL',()=>{
  const result=spawnSync('/bin/sh',[script('migrate.sh')],{env:{PATH:process.env.PATH,LIKERTS_MIGRATION_DATABASE_URL:'postgres://owner@localhost/db?sslmode=require',LIKERTS_BOOTSTRAP_RUNTIME_PASSWORD:'synthetic',LIKERTS_BOOTSTRAP_WORKER_PASSWORD:'synthetic',LIKERTS_WEBHOOK_CREDENTIAL_KEY:sentinel},encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/Application secrets forbidden/);assert.ok(!result.stderr.includes(sentinel));
});
