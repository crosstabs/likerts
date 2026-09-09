import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../tools/mcp/package.json',import.meta.url));
const Ajv=require('ajv/dist/2020.js');
const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const blueprint=JSON.parse(read('render.yaml')); // JSON is a strict subset of YAML.
const schema=JSON.parse(read('infrastructure/render/blueprint.schema.json'));
const validate=new Ajv({strict:false,allErrors:true,validateFormats:false}).compile(schema);
assert.ok(validate(blueprint),JSON.stringify(validate.errors));
const env=blueprint.projects[0].environments[0];
assert.equal(env.networking.isolation,'enabled');assert.equal(env.permissions.protection,'enabled');
assert.equal(env.services.length,4);
const service=name=>env.services.find(candidate=>candidate.name===name);
const api=service('likerts-api'),mcp=service('likerts-mcp'),worker=service('likerts-webhooks'),job=service('likerts-migration-job');
for(const item of [api,mcp,worker,job])assert.ok(item);
for(const service of env.services){assert.equal(service.region,'singapore');assert.equal(service.autoDeployTrigger,'off');assert.equal(service.runtime,'docker');assert.ok(!service.preDeployCommand);assert.ok(!service.disk);assert.ok(!service.envVars.some(x=>x.fromDatabase||x.fromGroup));}
const keys=s=>s.envVars.map(x=>x.key).sort();
for(const key of ['LIKERTS_OIDC_ISSUER','LIKERTS_OIDC_AUDIENCE','LIKERTS_OIDC_JWKS_URL']) assert.equal(api.envVars.find(v=>v.key===key)?.sync,false);
for(const key of ['LIKERTS_MANAGEMENT_ORIGINS','LIKERTS_BROWSER_SESSION_ISSUER','LIKERTS_BROWSER_SESSION_AUDIENCE','LIKERTS_BROWSER_SESSION_JWKS_URL','LIKERTS_BROWSER_WORKSPACE_KEY','LIKERTS_BROWSER_OAUTH_CLIENTS']) assert.equal(api.envVars.find(v=>v.key===key)?.sync,false);
assert.equal(api.type,'web');assert.equal(api.numInstances,2);assert.equal(api.healthCheckPath,'/health');
assert.equal(mcp.type,'web');assert.equal(mcp.plan,'starter');assert.equal(mcp.numInstances,1);assert.equal(mcp.healthCheckPath,'/health');assert.match(mcp.dockerCommand,/start\.sh mcp$/);
assert.deepEqual(keys(mcp),['LIKERTS_API_URL','LIKERTS_MCP_ALLOWED_ORIGINS','LIKERTS_MCP_PUBLIC_ORIGIN','LIKERTS_OIDC_ISSUER']);
assert.equal(worker.type,'worker');assert.equal(worker.numInstances,1);
assert.deepEqual(keys(worker),['LIKERTS_WEBHOOK_CONCURRENCY','LIKERTS_WEBHOOK_CREDENTIAL_KEY','LIKERTS_WEBHOOK_DATABASE_URL']);
assert.deepEqual(keys(job),['LIKERTS_BOOTSTRAP_RUNTIME_PASSWORD','LIKERTS_BOOTSTRAP_WORKER_PASSWORD','LIKERTS_MIGRATION_DATABASE_URL']);
assert.equal(job.type,'cron');assert.equal(job.dockerCommand,'/bin/true');assert.equal(job.schedule,'0 0 1 1 *');
for(const service of env.services)for(const variable of service.envVars){if(/PASSWORD|TOKEN|KEY|DATABASE_URL/.test(variable.key)){assert.equal(variable.sync,false);assert.equal(variable.value,undefined);}}
assert.ok(!keys(api).some(k=>/MIGRATION|BOOTSTRAP|DEV_|ALLOW_MEMORY|RUN_MIGRATIONS|WEBHOOK_DATABASE_URL/.test(k)));
const [db]=env.databases;assert.equal(db.region,'singapore');assert.equal(db.postgresMajorVersion,'17');assert.equal(db.highAvailability.enabled,true);assert.equal(db.plan,'1c-4g');assert.equal(db.diskSizeGB,20);assert.deepEqual(db.ipAllowList,[]);assert.equal(db.connectionPool,'none');
const docker=read('infrastructure/render/Dockerfile');assert.match(docker,/USER 10001:10001/);assert.match(docker,/mcp-builder/);assert.match(docker,/\/opt\/likerts\/tools\/mcp\/dist/);assert.match(docker,/tools\/capabilities\.json/);assert.match(docker,/contracts\/openapi\.json/);assert.ok(!docker.includes('ENTRYPOINT'));
const dockerignore=read('.dockerignore');assert.match(dockerignore,/!tools\/mcp\/package-lock\.json/);assert.match(dockerignore,/!tools\/mcp\/src\/\*\*/);assert.match(dockerignore,/!tools\/capabilities\.json/);assert.match(dockerignore,/!contracts\/openapi\.json/);
const migration=read('infrastructure/render/migrate.sh');assert.match(migration,/provision-runtime.sql provision-worker.sql/);assert.ok(!migration.includes('set -x'));assert.match(migration,/export PGDATABASE=/);
console.log('Render contract PASS: pinned official schema, Singapore HA/private Postgres, two API replicas, isolated MCP gateway, separate worker, inert migration job, explicit secret boundaries and deployment ordering.');
