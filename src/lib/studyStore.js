const STORAGE_KEY = 'likerts:runs:v2';
const MAX_RUNS = 12;

export function createRunId() {
  if (globalThis.crypto?.randomUUID) {
    return `lk_${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
  }
  return `lk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function readRuns() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRun(run) {
  try {
    const existing = readRuns().filter((item) => item.id !== run.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([run, ...existing].slice(0, MAX_RUNS)));
    return true;
  } catch {
    return false;
  }
}

export function getLatestRun() {
  return readRuns().find((run) => run.status === 'complete') || null;
}

export function removePendingRun(id) {
  try {
    const remaining = readRuns().filter((run) => !(run.id === id && run.status === 'pending'));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
  } catch {
    // Local persistence is a convenience; generation should still work without it.
  }
}

export function createPendingRun(study) {
  const run = {
    id: createRunId(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    study,
  };
  saveRun(run);
  return run;
}

export function persistCompletedRun(pendingRun, study, result) {
  return saveRun({
    ...pendingRun,
    id: result.meta?.runId || pendingRun.id,
    status: 'complete',
    completedAt: new Date().toISOString(),
    study,
    result,
  });
}
