import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
const publicRoot = new URL('../public/', import.meta.url);
const check = process.argv.includes('--check');
const read = path => readFile(new URL(path, root), 'utf8');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
async function emit(path, expected) {
  const target = new URL(path, publicRoot);
  if (check) {
    const actual = await readFile(target);
    if (!actual.equals(Buffer.from(expected))) throw new Error(`${path} drifted; run node control-plane/scripts/sync-public-reference.mjs`);
  } else {
    await mkdir(new URL('./', target), { recursive: true });
    await writeFile(target, expected);
  }
}
const specText = await read('contracts/openapi.json');
const capabilityText = await read('tools/capabilities.json');
const spec = JSON.parse(specText);
const capabilities = JSON.parse(capabilityText);
await emit('docs/openapi.json', specText);
await emit('docs/capabilities.json', capabilityText);
const inputFiles = (await readdir(new URL('contracts/examples/', root))).filter(path => path.endsWith('.input.json')).sort();
for (const path of inputFiles) await emit(`docs/examples/${path}`, await read(`contracts/examples/${path}`));
const expectedInputs = new Set(inputFiles);
for (const path of (await readdir(new URL('docs/examples/', publicRoot))).filter(path => path.endsWith('.input.json'))) {
  if (!expectedInputs.has(path)) {
    if (check) throw new Error(`Stale public input example: ${path}`);
    await rm(new URL(`docs/examples/${path}`, publicRoot));
  }
}
const operations = capabilities.map(capability => {
  const operation = spec.paths[capability.path]?.[capability.method.toLowerCase()];
  if (!operation || operation.operationId !== capability.name) throw new Error(`Unmatched public capability ${capability.name}`);
  const scope = operation['x-required-scope'] ?? capability.auth;
  const sample = `${capability.name}.input.json`;
  if (!expectedInputs.has(sample)) throw new Error(`Missing input fixture for ${capability.name}`);
  return `<article class="api-operation" id="${capability.name}" data-search="${escape(`${capability.name} ${capability.path} ${capability.description} ${scope}`)}"><h2><code>${escape(capability.name)}</code></h2><p class="api-route"><span>${capability.method}</span> <code>${escape(capability.path)}</code></p><p>${escape(capability.description)}</p><p><strong>Authorization:</strong> ${escape(capability.auth)} · <strong>Scope:</strong> <code>${escape(scope)}</code></p><p><a href="/docs/examples/${sample}">Input example JSON</a> · <a href="/docs/openapi.json">Full schema and errors</a></p></article>`;
}).join('');
const reference = await readFile(new URL('docs/api/index.html', publicRoot), 'utf8');
if (!reference.includes('<!-- OPERATIONS:START -->') || !reference.includes('<!-- OPERATIONS:END -->')) throw new Error('API reference markers missing');
await emit('docs/api/index.html', reference
  .replace(/<!-- OPERATIONS:START -->[\s\S]*?<!-- OPERATIONS:END -->/, `<!-- OPERATIONS:START -->${operations}<!-- OPERATIONS:END -->`)
  .replace(/<span data-capability-count>\d+<\/span>/g, `<span data-capability-count>${capabilities.length}</span>`));
await emit('docs/survey-create.json', await read('contracts/examples/surveys_create.input.json'));
const modules = (await readdir(new URL('sdks/web/dist/', root))).filter(name => /^[a-z-]+\.js$/.test(name)).sort();
if (!modules.includes('index.js')) throw new Error('Build the Web SDK before syncing public reference files');
for (const name of modules) await emit(`demo/sdk/${name}`, await read(`sdks/web/dist/${name}`));
for (const file of ['survey.example.json', 'expanded-survey.example.json', 'choice-survey.example.json', 'conditional-survey.example.json', 'branching-survey.example.json', 'advanced-survey.example.json']) await emit(`docs/examples/${file}`, await read(`contracts/${file}`));
console.log(`${check ? 'Verified' : 'Synced'} public reference: ${capabilities.length} capabilities, ${modules.length} exact release SDK modules.`);
