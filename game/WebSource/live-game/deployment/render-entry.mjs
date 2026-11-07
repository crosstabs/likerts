import { pathToFileURL } from 'node:url';
import { readServiceConfiguration } from '../server/app.mjs';
import { assertProductionRuntime } from './runtime-policy.mjs';

function reject() { throw new Error('Render Live configuration is incomplete or unsafe; review the deployment runbook.'); }
function origin(value) {
  let url;
  try { url = new URL(value); } catch { reject(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') reject();
  return url.origin;
}

/** Pure configuration mapping; does not open storage, sockets, files or provider APIs. */
export function resolveRenderEnvironment(input, version = process.versions.node) {
  assertProductionRuntime(true, version);
  if (input.RENDER !== 'true' || (input.NODE_ENV && input.NODE_ENV !== 'production')
    || (input.RENDER_SERVICE_TYPE && input.RENDER_SERVICE_TYPE !== 'web')
    || (input.LIKERTS_LIVE_BIND_ADDRESS && input.LIKERTS_LIVE_BIND_ADDRESS !== '0.0.0.0')) reject();
  const publicOrigin = origin(input.LIKERTS_LIVE_PUBLIC_ORIGIN || input.RENDER_EXTERNAL_URL);
  if (!input.LIKERTS_LIVE_PUBLIC_ORIGIN && !new URL(publicOrigin).hostname.endsWith('.onrender.com')) reject();
  const allowed = input.LIKERTS_LIVE_ORIGINS
    ? input.LIKERTS_LIVE_ORIGINS.split(',').map(value => origin(value.trim())) : [publicOrigin];
  if (!allowed.includes(publicOrigin)) reject();
  let database;
  try { database = new URL(input.LIKERTS_LIVE_DATABASE_URL); } catch { reject(); }
  const expectedDatabase = input.LIKERTS_LIVE_EXPECTED_DATABASE || 'likerts_live_staging';
  if (!/^likerts_live_[a-z0-9_]+$/.test(expectedDatabase)
    || !['postgres:', 'postgresql:'].includes(database.protocol)
    || !database.hostname.endsWith('.render.com') || database.hostname.endsWith('.internal')
    || database.pathname !== '/' + expectedDatabase || database.hash || database.searchParams.getAll('sslmode').length !== 1
    || database.searchParams.get('sslmode') !== 'verify-full'
    // pg-connection-string permits query parameters to override the URL's host,
    // database, credentials and TLS options. Accept only the reviewed TLS mode.
    || [...database.searchParams.keys()].some(key => key !== 'sslmode')) reject();
  const environment = { ...input, NODE_ENV: 'production', PORT: input.PORT || '10000',
    LIKERTS_LIVE_BIND_ADDRESS: '0.0.0.0', LIKERTS_LIVE_PUBLIC_ORIGIN: publicOrigin,
    LIKERTS_LIVE_ORIGINS: allowed.join(',') };
  readServiceConfiguration(environment);
  return environment;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  try {
    const environment = resolveRenderEnvironment(process.env);
    const configuration = readServiceConfiguration(environment);
    if (process.argv.includes('--check')) {
      console.log(JSON.stringify({ status: 'configuration-shape-valid', openedConnections: 0,
        runtime: process.versions.node, publicOrigin: configuration.publicOrigin,
        gameURL: configuration.publicOrigin + '/play',
        bind: configuration.host, port: configuration.port, limits: configuration.limits,
        databaseConfigured: true, productionTLSHandshakeVerified: false,
        providerDeploymentVerified: false, ownerApprovalVerified: false }));
    } else {
      // Only non-secret configuration defaults are set here; credentials stay in the
      // provider's existing environment and are never copied into files or output.
      for (const key of ['NODE_ENV', 'PORT', 'LIKERTS_LIVE_BIND_ADDRESS', 'LIKERTS_LIVE_PUBLIC_ORIGIN', 'LIKERTS_LIVE_ORIGINS']) process.env[key] = environment[key];
      await import('../server/index.mjs');
    }
  } catch {
    console.error('Likerts Live Render startup/check failed. Review the runtime, dedicated external database and origin configuration.');
    process.exitCode = 1;
  }
}
