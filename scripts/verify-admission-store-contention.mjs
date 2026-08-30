#!/usr/bin/env node

import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { readAdmissionStoreIntegrationConfiguration } from './verify-admission-store-integration.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const WORKER_FLAG = '--worker';
const WORKER_COUNT = 3;
const REQUEST_TIMEOUT_MS = 10_000;
const LIMITS = Object.freeze({
  maximumConcurrency: 2,
  runsPerClientWindow: 1,
  clientWindowMs: 60 * 60 * 1_000,
  processDailyBudget: 7,
  dailyBudgetWindowMs: 24 * 60 * 60 * 1_000,
});

class ContentionVerificationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ContentionVerificationError';
    this.code = code;
  }
}

function namespaceFingerprint(namespace) {
  return createHash('sha256').update(namespace).digest('hex').slice(0, 16);
}

function waitForWorkerMessage(worker, requestId, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('exit', onExit);
      worker.off('error', onError);
    };
    const onMessage = (message) => {
      if (message?.requestId !== requestId) return;
      cleanup();
      resolve(message);
    };
    const onExit = () => {
      cleanup();
      reject(new ContentionVerificationError('WORKER_EXITED'));
    };
    const onError = () => {
      cleanup();
      reject(new ContentionVerificationError('WORKER_FAILED'));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new ContentionVerificationError('WORKER_TIMEOUT'));
    }, timeoutMs);
    worker.on('message', onMessage);
    worker.once('exit', onExit);
    worker.once('error', onError);
  });
}

async function command(worker, action, payload = {}, timeoutMs) {
  const requestId = randomUUID();
  const response = waitForWorkerMessage(worker, requestId, timeoutMs);
  worker.send({ requestId, action, ...payload });
  return response;
}

async function spawnWorker(env) {
  const worker = fork(SCRIPT_PATH, [WORKER_FLAG], {
    env,
    silent: true,
  });
  worker.stderr?.resume();
  const ready = await waitForWorkerMessage(worker, 'ready');
  if (ready.status !== 'ready') throw new ContentionVerificationError('WORKER_NOT_READY');
  return worker;
}

async function stopWorker(worker) {
  if (!worker || worker.exitCode !== null || !worker.connected) return;
  try {
    await command(worker, 'stop');
  } catch {
    worker.kill('SIGTERM');
  }
}

async function workerMain() {
  try {
    const configuration = readAdmissionStoreIntegrationConfiguration(process.env);
    const { createUpstashAdmissionStore, createUpstashRedisClient } = await import('../server/upstash-admission-store.js');
    const redis = createUpstashRedisClient({
      url: configuration.url,
      token: configuration.token,
      timeoutMs: configuration.timeoutMs,
    });
    const store = createUpstashAdmissionStore({
      redis,
      namespace: configuration.namespace,
      limits: LIMITS,
      leaseTtlMs: configuration.leaseTtlMs,
      timeoutMs: configuration.timeoutMs,
      unitSchedule: { quick: 1, deep: 3 },
      clientIdentity: configuration.clientIdentity,
    });
    if (await store.checkReady() !== true) throw new ContentionVerificationError('WORKER_NOT_READY');

    const releases = new Map();
    process.on('message', async (message) => {
      const requestId = message?.requestId;
      try {
        if (message?.action === 'acquire') {
          try {
            const release = await store.acquire({
              clientKey: message.clientKey,
              estimatedUnits: message.estimatedUnits,
            });
            releases.set(message.leaseId, release);
            process.send?.({ requestId, status: 'granted', leaseId: message.leaseId });
          } catch (error) {
            process.send?.({ requestId, status: 'denied', code: error?.code || 'ADMISSION_DENIED' });
          }
          return;
        }
        if (message?.action === 'release') {
          const release = releases.get(message.leaseId);
          if (!release) throw new ContentionVerificationError('UNKNOWN_LEASE');
          await release();
          process.send?.({ requestId, status: 'released', leaseId: message.leaseId });
          return;
        }
        if (message?.action === 'stop') {
          process.send?.({ requestId, status: 'stopped' });
          process.disconnect?.();
          return;
        }
        throw new ContentionVerificationError('UNKNOWN_COMMAND');
      } catch (error) {
        process.send?.({ requestId, status: 'failed', code: error?.code || 'WORKER_COMMAND_FAILED' });
      }
    });
    process.send?.({ requestId: 'ready', status: 'ready' });
  } catch (error) {
    process.send?.({ requestId: 'ready', status: 'failed', code: error?.code || 'WORKER_NOT_READY' });
    process.exitCode = 1;
  }
}

function expectStatus(response, status, code = null) {
  if (response?.status !== status || (code && response?.code !== code)) {
    throw new ContentionVerificationError('UNEXPECTED_ADMISSION_RESULT');
  }
}

function waitForExit(worker) {
  if (worker.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => worker.once('exit', resolve));
}

async function parentMain() {
  const configuration = readAdmissionStoreIntegrationConfiguration(process.env);
  const workers = [];
  try {
    for (let index = 0; index < WORKER_COUNT; index += 1) workers.push(await spawnWorker(process.env));

    const concurrency = await Promise.all(workers.map((worker, index) => command(worker, 'acquire', {
      leaseId: `concurrency-${index}`,
      clientKey: `contention-concurrency-${index}`,
      estimatedUnits: 1,
    })));
    const granted = concurrency.map((result, index) => ({ result, index })).filter(({ result }) => result.status === 'granted');
    const denied = concurrency.filter((result) => result.status === 'denied');
    if (granted.length !== LIMITS.maximumConcurrency || denied.length !== 1) {
      throw new ContentionVerificationError('CONCURRENCY_OVERSHOOT');
    }
    expectStatus(denied[0], 'denied', 'CONCURRENCY_LIMIT');

    const first = granted[0];
    const second = granted[1];
    await command(workers[first.index], 'release', { leaseId: `concurrency-${first.index}` });
    await command(workers[first.index], 'release', { leaseId: `concurrency-${first.index}` });

    const replacement = await command(workers[denied[0] === concurrency[0] ? 0 : denied[0] === concurrency[1] ? 1 : 2], 'acquire', {
      leaseId: 'replacement',
      clientKey: 'contention-replacement',
      estimatedUnits: 1,
    });
    expectStatus(replacement, 'granted');
    await command(workers[first.index], 'release', { leaseId: `concurrency-${first.index}` });

    const staleProbe = await command(workers[first.index], 'acquire', {
      leaseId: 'stale-probe',
      clientKey: 'contention-stale-probe',
      estimatedUnits: 1,
    });
    expectStatus(staleProbe, 'denied', 'CONCURRENCY_LIMIT');

    await command(workers[second.index], 'release', { leaseId: `concurrency-${second.index}` });
    const replacementWorkerIndex = denied[0] === concurrency[0] ? 0 : denied[0] === concurrency[1] ? 1 : 2;
    await command(workers[replacementWorkerIndex], 'release', { leaseId: 'replacement' });

    const rateLease = await command(workers[0], 'acquire', {
      leaseId: 'rate',
      clientKey: 'contention-rate',
      estimatedUnits: 1,
    });
    expectStatus(rateLease, 'granted');
    const rateDenial = await command(workers[1], 'acquire', {
      leaseId: 'rate-denied',
      clientKey: 'contention-rate',
      estimatedUnits: 1,
    });
    expectStatus(rateDenial, 'denied', 'RATE_LIMITED');
    await command(workers[0], 'release', { leaseId: 'rate' });

    const weightedDenial = await command(workers[2], 'acquire', {
      leaseId: 'weighted-denied',
      clientKey: 'contention-weighted',
      estimatedUnits: 4,
    });
    expectStatus(weightedDenial, 'denied', 'BUDGET_EXHAUSTED');

    const crashLeases = await Promise.all([0, 1].map((index) => command(workers[index], 'acquire', {
      leaseId: `crash-${index}`,
      clientKey: `contention-crash-${index}`,
      estimatedUnits: 1,
    })));
    crashLeases.forEach((result) => expectStatus(result, 'granted'));
    const crashed = [workers[0], workers[1]];
    crashed.forEach((worker) => worker.kill('SIGKILL'));
    await Promise.all(crashed.map(waitForExit));

    const recoveryWorker = await spawnWorker(process.env);
    workers.push(recoveryWorker);
    const beforeExpiry = await command(recoveryWorker, 'acquire', {
      leaseId: 'before-expiry',
      clientKey: 'contention-before-expiry',
      estimatedUnits: 1,
    });
    expectStatus(beforeExpiry, 'denied', 'CONCURRENCY_LIMIT');

    await new Promise((resolve) => setTimeout(resolve, configuration.leaseTtlMs + 1_500));
    const afterExpiry = await command(recoveryWorker, 'acquire', {
      leaseId: 'after-expiry',
      clientKey: 'contention-after-expiry',
      estimatedUnits: 1,
    });
    expectStatus(afterExpiry, 'granted');
    await command(recoveryWorker, 'release', { leaseId: 'after-expiry' });

    process.stdout.write(`${JSON.stringify({
      status: 'VERIFIED',
      processes: WORKER_COUNT + 1,
      exactConcurrent: { requested: WORKER_COUNT, granted: granted.length },
      denials: { concurrency: 2, rate: 1, weightedBudget: 1 },
      repeatedRelease: 'IDEMPOTENT',
      staleRelease: 'PRESERVED_REPLACEMENT',
      crashedLeaseRecovery: 'RECOVERED_AFTER_TTL',
      namespaceFingerprint: namespaceFingerprint(configuration.namespace),
    }, null, 2)}\n`);
  } finally {
    await Promise.all(workers.map(stopWorker));
  }
}

if (process.argv.includes(WORKER_FLAG)) {
  await workerMain();
} else {
  try {
    await parentMain();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: 'FAILED',
      code: error instanceof ContentionVerificationError ? error.code : 'CONTENTION_VERIFICATION_FAILED',
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
