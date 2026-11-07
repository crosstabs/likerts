// Local-only PostgreSQL endurance/write-volume experiment. Never targets a hosted URL.
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import pg from 'pg';
import WebSocket from 'ws';
import { createLiveServer } from '../server/app.mjs';
import { openStore } from '../server/store.mjs';
import { LiveClient } from '../web/client.mjs';
import { assertProductionRuntime } from '../deployment/runtime-policy.mjs';
import { localTestDatabaseURL } from '../deployment/local-test-database.mjs';

assertProductionRuntime(true);
const options = { durationSeconds: 120, pauseMs: 1000, players: 12, maxRequests: 5000, output: null };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = { '--duration-seconds': 'durationSeconds', '--pause-ms': 'pauseMs', '--players': 'players', '--max-requests': 'maxRequests', '--output': 'output' }[process.argv[i]];
  if (!key || process.argv[i + 1] === undefined) throw new Error('Use explicit bounded soak options.');
  options[key] = key === 'output' ? process.argv[i + 1] : Number(process.argv[i + 1]);
}
for (const [key, min, max] of [['durationSeconds', 10, 900], ['pauseMs', 100, 5000], ['players', 2, 12], ['maxRequests', 100, 5000]]) {
  if (!Number.isSafeInteger(options[key]) || options[key] < min || options[key] > max) throw new Error(`Invalid bounded soak option ${key}`);
}
const database = localTestDatabaseURL(process.env.LIKERTS_LIVE_TEST_DATABASE_URL);
const schema = 'live_soak_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: database.href, connectionTimeoutMillis: 2000 });
let store, app, cancelled = false, createdSchema = false, measuredAt = null;
const clients = [], timings = [], loop = monitorEventLoopDelay({ resolution: 20 });
const result = { kind: 'bounded local PostgreSQL endurance experiment', node: process.versions.node,
  platform: process.platform + '/' + process.arch, durationRequestedSeconds: options.durationSeconds,
  players: options.players, rooms: 1, maxRequests: options.maxRequests, completedMatches: 0, reveals: 0,
  commands: 0, errors: 0, stopReason: 'not_started', peakRSSBytes: 0,
  serviceAndSyntheticClientsShareProcess: true, productionTLSVerified: false };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = performance.now() + 8000;
  while (!predicate() && performance.now() < deadline) await pause(10);
  if (!predicate()) throw new Error('A local projected-state transition did not arrive.');
}
async function command(client, action, values) {
  const start = performance.now(); await client.action(action, values); timings.push(performance.now() - start); result.commands++;
}
const percentile = p => { const values = [...timings].sort((a, b) => a - b); return values.length ? Number(values[Math.min(values.length - 1, Math.floor(values.length * p))].toFixed(2)) : null; };
process.once('SIGINT', () => { cancelled = true; }); process.once('SIGTERM', () => { cancelled = true; });
try {
  await admin.connect();
  result.postgres = (await admin.query('SHOW server_version')).rows[0].server_version;
  await admin.query(`CREATE SCHEMA "${schema}"`); createdSchema = true;
  database.searchParams.set('options', `-csearch_path=${schema}`);
  const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
  const hash = createHash('sha256');
  for (const path of ['../server/app.mjs', '../server/engine.mjs', '../server/store.mjs', '../server/errors.mjs', '../shared/catalogue.json']) {
    hash.update(path); hash.update(await readFile(new URL(path, import.meta.url)));
  }
  result.backendFingerprint = hash.digest('hex');
  store = await openStore({ databaseURL: database.href, production: false, maxRooms: 1 });
  app = await createLiveServer({ store, catalogue, limits: { maxRooms: 1, maxPlayers: 12, maxSockets: 32, maxSocketsPerRoom: 26, maxSocketsPerMember: 2, maxRequests: options.maxRequests } });
  const { origin } = await app.listen({ host: '127.0.0.1', port: 0 });
  function client() { const value = new LiveClient({ origin, WebSocket, storage: null, pollMs: 3000 }); clients.push(value); return value; }
  const host = client(); await host.create({ capacity: options.players, cycles: 1, topic: 'mix', answerSeconds: 0, predictSeconds: 0 });
  const members = [];
  for (let n = 0; n < options.players; n++) { const value = client(); await value.join(host.state.code, 'SoakQA' + (n + 1), true); members.push(value); }
  await until(() => clients.every(value => value.status === 'connected'));
  await host.refresh();
  const baseline = (await admin.query('SELECT pg_current_wal_lsn()::text AS lsn, pg_database_size(current_database())::text AS bytes')).rows[0];
  const cpu = process.cpuUsage(); measuredAt = performance.now(); loop.enable();
  result.stopReason = 'duration';
  outer: while (!cancelled && performance.now() - measuredAt < options.durationSeconds * 1000) {
    await command(host, 'start');
    while (host.state.phase !== 'finished') {
      const round = host.state.round;
      await until(() => members.every(value => value.state?.round?.id === round.id && value.state.phase === 'answer'));
      if (host.state.round.ownAnswer !== null || members.some(value => value.state.self.id !== round.subjectId && value.state.round.ownAnswer !== null)) throw new Error('Recipient isolation failed.');
      const subject = members.find(value => value.state.self.id === round.subjectId);
      await command(subject, 'answer', { value: 4 });
      const predictors = members.filter(value => value !== subject);
      await until(() => predictors.every(value => value.state?.phase === 'predict'));
      if (host.state.round.ownAnswer !== null || predictors.some(value => value.state.round.ownAnswer !== null)
        || clients.some(value => value.state.reveal !== null)) throw new Error('Predict-phase answer isolation failed.');
      // Hold the final prediction so the earlier choices must stay private.
      await Promise.all(predictors.slice(0, -1).map((value, n) => command(value, 'guess', { value: (n % 5) + 1 })));
      await host.refresh(); await predictors.at(-1).refresh();
      if (host.state.phase !== 'predict' || host.state.round.ownGuess !== null || host.state.reveal !== null
        || predictors.at(-1).state.round.ownGuess !== null || predictors.at(-1).state.reveal !== null) throw new Error('Pending prediction isolation failed.');
      await command(predictors.at(-1), 'guess', { value: ((predictors.length - 1) % 5) + 1 });
      await until(() => clients.every(value => value.state?.phase === 'reveal'));
      result.reveals++;
      await command(host, 'next');
      result.peakRSSBytes = Math.max(result.peakRSSBytes, process.memoryUsage().rss);
      const size = await store.transact(host.state.code, room => ({ room, changed: false, value: { bytes: Buffer.byteLength(JSON.stringify(room)), requests: Object.keys(room.requests).length } }));
      result.peakRoomBytes = Math.max(result.peakRoomBytes ?? 0, size.value.bytes);
      result.peakReceipts = Math.max(result.peakReceipts ?? 0, size.value.requests);
      const disk = (await admin.query('SELECT pg_database_size(current_database())::text AS bytes, COALESCE((SELECT sum(size) FROM pg_ls_waldir()),0)::text AS wal')).rows[0];
      result.peakDatabaseBytes = Math.max(result.peakDatabaseBytes ?? 0, Number(disk.bytes));
      result.peakWALDirectoryBytes = Math.max(result.peakWALDirectoryBytes ?? 0, Number(disk.wal));
      if (Number(disk.bytes) > 200 * 1024 * 1024 || Number(disk.wal) > 256 * 1024 * 1024) { result.stopReason = 'owned_fixture_disk_budget'; break outer; }
      if (cancelled) { result.stopReason = 'operator_cancelled'; break outer; }
      if (options.pauseMs) await pause(options.pauseMs);
    }
    if (host.state.completion !== 'complete' || host.state.leaderboard.some(row => row.opportunities !== options.players - 1)) throw new Error('A completed rotation was not fair.');
    result.completedMatches++;
    if (performance.now() - measuredAt < options.durationSeconds * 1000) await command(host, 'rematch');
  }
  result.measuredSeconds = Number(((performance.now() - measuredAt) / 1000).toFixed(3));
  result.cpuMicroseconds = process.cpuUsage(cpu); result.commandLatencyMs = { p50: percentile(.50), p95: percentile(.95), p99: percentile(.99) };
  result.eventLoopMs = { p95: Number((loop.percentile(95) / 1e6).toFixed(2)), max: Number((loop.max / 1e6).toFixed(2)) };
  const final = (await admin.query('SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),$1::pg_lsn)::text AS wal, pg_database_size(current_database())::text AS bytes', [baseline.lsn])).rows[0];
  result.generatedWALBytes = Number(final.wal); result.databaseGrowthBytes = Number(final.bytes) - Number(baseline.bytes);
  await host.action('close'); result.ownedRoomClosed = true;
} catch (error) {
  result.errors++; result.stopReason = ['request_limit', 'storage_unavailable'].includes(error?.code) ? error.code : 'local_experiment_failed';
  // No raw exception, request, state, capability or database URL is recorded.
  process.exitCode = 1;
} finally {
  loop.disable(); for (const value of clients) value.dispose();
  await app?.close().catch(() => {}); await store?.close().catch(() => {});
  if (createdSchema) await admin.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => { result.cleanupFailed = true; process.exitCode = 1; });
  await admin.end().catch(() => {});
  result.fixtureSchemaCreated = createdSchema;
  result.fixtureSchemaRemoved = createdSchema && !result.cleanupFailed;
  if (options.output) await writeFile(options.output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
