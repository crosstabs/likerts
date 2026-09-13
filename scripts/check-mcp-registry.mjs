import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from '../tools/mcp/node_modules/ajv/dist/ajv.js';

const metadata = JSON.parse(await readFile(new URL('../tools/mcp/server.json', import.meta.url), 'utf8'));
assert.equal(metadata.$schema, 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
async function json(url) {
  const result = await fetch(url, { signal: AbortSignal.timeout(20000) });
  assert.equal(result.status, 200, `Unable to fetch ${url}: ${result.status}`);
  return result.json();
}
const schema = await json(metadata.$schema);
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addFormat('uri', value => { try { return Boolean(new URL(value).protocol); } catch { return false; } });
const validate = ajv.compile(schema);
assert.ok(validate(metadata), JSON.stringify(validate.errors));
assert.equal(metadata.name, 'io.github.crosstabs/likerts');
assert.match(metadata.version, /^\d+\.\d+\.\d+$/);
assert.equal(metadata.packages.length, 1);
const pkg = metadata.packages[0];
assert.equal(pkg.registryType, 'npm');
assert.equal(pkg.registryBaseUrl, 'https://registry.npmjs.org');
assert.equal(pkg.identifier, '@likerts/mcp');
assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
assert.equal(pkg.transport.type, 'stdio');
assert.equal(pkg.runtimeHint, 'npx');
const token = pkg.environmentVariables.find(variable => variable.name === 'LIKERTS_TOKEN');
assert.equal(token.isRequired, true);
assert.equal(token.isSecret, true);
assert.equal(token.value, undefined);
assert.equal(token.default, undefined);
const published = await json(`https://registry.npmjs.org/${encodeURIComponent(pkg.identifier)}/${pkg.version}`);
assert.equal(published.name, pkg.identifier);
assert.equal(published.version, pkg.version);
assert.equal(published.mcpName, metadata.name);
assert.equal(published.bin['likerts-mcp'], 'dist/main.js');
assert.equal(published.license, 'MIT');
console.log(`Registry ${metadata.version}: official schema valid; ${pkg.identifier}@${pkg.version} ownership metadata and stdio executable verified.`);
if (process.argv.includes('--published')) {
  const record = await json(`https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(metadata.name)}/versions/${metadata.version}`);
  assert.equal(record.server.name, metadata.name);
  assert.equal(record.server.version, metadata.version);
  assert.deepEqual(record.server.packages, metadata.packages);
  assert.deepEqual(record.server.remotes, metadata.remotes);
  console.log(`Registry ${metadata.version}: published npm and remote metadata match the tested source.`);
}
