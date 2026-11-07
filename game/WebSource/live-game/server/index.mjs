import { readFile } from 'node:fs/promises';
import { createLiveServer, readServiceConfiguration } from './app.mjs';
import { openStore } from './store.mjs';
import { assertProductionRuntime } from '../deployment/runtime-policy.mjs';
import { createClientAddressResolver } from '../deployment/client-address-policy.mjs';

const configuration = readServiceConfiguration();
assertProductionRuntime(configuration.production);
const resolveClientAddress = createClientAddressResolver();
const { production, databaseURL, sqlitePath, host, port, limits } = configuration;
const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
let app, store;
try {
  store = await openStore({ databaseURL, sqlitePath, production, maxRooms: limits.maxRooms });
  app = await createLiveServer({ ...configuration, store, catalogue, resolveClientAddress });
  await app.listen({ host, port });
  // No URLs, tokens, room codes, nicknames or provider details in application logs.
  console.log(`Likerts Live ready (${store.kind}; ${production ? 'production' : 'development'}).`);
} catch {
  await app?.close().catch(() => {}); await store?.close().catch(() => {});
  console.error('Likerts Live could not start. Check the dedicated service configuration.'); process.exitCode = 1;
}
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  await app?.close(); await store?.close();
}
process.once('SIGINT', () => { void stop().then(() => { process.exitCode = 0; }); });
process.once('SIGTERM', () => { void stop().then(() => { process.exitCode = 0; }); });
