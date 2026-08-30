import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { toPublicPopulationDataRegistry, validatePopulationDataRegistry } from '../server/population-data-registry.js';
import { buildPublicPopulationDataRegistry, registryPublicationUrl } from '../scripts/build-population-registry.mjs';

const registryUrl = new URL('../content/population-data/registry.json', import.meta.url);

test('the checked-in population-data registry makes no official-source claims before curation', async () => {
  const registry = validatePopulationDataRegistry(JSON.parse(await readFile(registryUrl, 'utf8')));
  const published = toPublicPopulationDataRegistry(registry);

  assert.equal(published.status, 'NO_CURATED_DATASETS');
  assert.equal(published.curatedDatasetCount, 0);
  assert.deepEqual(published.datasets, []);
  assert.match(published.boundary, /no curated official population datasets/i);
});

test('the public population-data registry is deterministic and matches the reviewed source registry', async () => {
  const generated = await buildPublicPopulationDataRegistry({ write: false });
  const checkedIn = await readFile(registryPublicationUrl, 'utf8');
  assert.equal(checkedIn, generated.serialized);
  assert.equal(generated.publication.status, 'NO_CURATED_DATASETS');
});
