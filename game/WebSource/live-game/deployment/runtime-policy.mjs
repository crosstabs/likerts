// Reviewed against the official 21 October 2026 Node security release.
// This is a pinned deployment baseline, not a promise that future releases need no review.
export const runtimePolicy = Object.freeze({
  major: 22,
  minimum: '22.23.4',
  reviewedAt: '2026-11-06',
  advisory: 'https://nodejs.org/en/blog/vulnerability/october-2026-security-releases',
});

export function isReviewedRuntime(version) {
  if (typeof version !== 'string') return false;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const actual = match.slice(1).map(Number);
  if (!actual.every(Number.isSafeInteger) || actual[0] !== runtimePolicy.major) return false;
  const floor = runtimePolicy.minimum.split('.').map(Number);
  return actual[1] > floor[1] || (actual[1] === floor[1] && actual[2] >= floor[2]);
}

export function assertProductionRuntime(production, version = process.versions.node) {
  if (!production) return;
  if (!isReviewedRuntime(version)) {
    const error = new Error('Production requires the reviewed patched Node.js 22 runtime.');
    error.code = 'runtime_unsupported';
    throw error;
  }
}
