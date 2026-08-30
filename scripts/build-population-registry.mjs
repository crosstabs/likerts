import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { toPublicPopulationDataRegistry, validatePopulationDataRegistry } from '../server/population-data-registry.js';

export const registrySourceUrl = new URL('../content/population-data/registry.json', import.meta.url);
export const registryPublicationUrl = new URL('../public/research-standards/population-data-registry.json', import.meta.url);

export async function buildPublicPopulationDataRegistry({
  sourceUrl = registrySourceUrl,
  outputUrl = registryPublicationUrl,
  write = true,
} = {}) {
  const registry = validatePopulationDataRegistry(JSON.parse(await readFile(sourceUrl, 'utf8')));
  const publication = toPublicPopulationDataRegistry(registry);
  const serialized = `${JSON.stringify(publication, null, 2)}\n`;
  if (write) await writeFile(outputUrl, serialized, 'utf8');
  return { publication, serialized };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildPublicPopulationDataRegistry().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
