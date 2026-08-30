import { validateSampleLineage } from '../../server/sample-lineage.js';

const STORAGE_KEY = 'likerts:runs:v2';
const MAX_RUNS = 12;

const lineagePaths = Object.freeze([
  ['study', 'sampleLineage'],
  ['result', 'meta', 'sampleLineage'],
  ['result', 'meta', 'provenance', 'sampleLineage'],
  ['result', 'provenance', 'sampleLineage'],
  ['result', 'run', 'sampleLineage'],
  ['result', 'reproducibility', 'sampleLineage'],
  ['result', 'run', 'reproducibility', 'sampleLineage'],
  ['result', 'persistence', 'clientRecord', 'input', 'sampleLineage'],
  ['result', 'persistence', 'clientRecord', 'study', 'sampleLineage'],
  ['result', 'persistence', 'clientRecord', 'run', 'sampleLineage'],
  ['result', 'persistence', 'clientRecord', 'run', 'reproducibility', 'sampleLineage'],
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function valueAtPath(root, path) {
  let current = root;
  for (const key of path) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) return { present: false, value: null };
    current = current[key];
  }
  return { present: true, value: current };
}

/**
 * Local run storage is a convenience cache, not authenticated provenance.
 * Before a complete run is restored or exported, every stored lineage copy is
 * checked against the current sample registry and against every other copy.
 */
export function validateRestoredRunLineage(run) {
  let canonicalLineage = null;
  let sawNull = false;
  for (const path of lineagePaths) {
    const candidate = valueAtPath(run, path);
    if (!candidate.present) continue;
    if (candidate.value === null) {
      sawNull = true;
      if (canonicalLineage !== null) throw new Error('Stored run contains conflicting sample lineage copies.');
      continue;
    }
    const expected = validateSampleLineage(candidate.value);
    const serialized = canonicalJson(expected);
    if (sawNull || (canonicalLineage !== null && canonicalLineage !== serialized)) {
      throw new Error('Stored run contains conflicting sample lineage copies.');
    }
    canonicalLineage = serialized;
  }
  return run;
}

export function createRunId() {
  if (globalThis.crypto?.randomUUID) {
    return `lk_${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
  }
  return `lk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function readRuns() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    // Invalid complete records are ignored from the read view. We leave the
    // raw cache untouched because it is local, user-owned, and not signed;
    // this is quarantine-by-omission rather than a claim of authenticity.
    return parsed.filter((run) => {
      if (run?.status !== 'complete') return true;
      try {
        validateRestoredRunLineage(run);
        return true;
      } catch {
        return false;
      }
    });
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
