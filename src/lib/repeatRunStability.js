export const REPEAT_RUN_STABILITY_VERSION = 'repeat-run-stability-v1';

const LOW_VARIATION_THRESHOLDS = Object.freeze({
  maxPercentagePointSpread: 8,
  topTwoBoxSpread: 8,
});

function validDistribution(value) {
  return Array.isArray(value)
    && value.length === 5
    && value.every((item) => Number.isFinite(item) && item >= 0)
    && Math.abs(value.reduce((sum, item) => sum + item, 0) - 100) < 1e-6;
}

function jensenShannon(left, right) {
  const p = left.map((value) => value / 100);
  const q = right.map((value) => value / 100);
  const midpoint = p.map((value, index) => (value + q[index]) / 2);
  const kl = (values, reference) => values.reduce((sum, value, index) => (
    value === 0 ? sum : sum + value * Math.log2(value / reference[index])
  ), 0);
  return (kl(p, midpoint) + kl(q, midpoint)) / 2;
}

const uniqueValues = (runs, key) => [...new Set(runs.map((run) => run.meta?.[key]).filter(Boolean))];

export function compareRepeatRuns(runs = []) {
  const usable = runs.filter((run) => validDistribution(run?.distribution));
  const inputHashes = uniqueValues(usable, 'inputHash');
  const populationFrameHashes = uniqueValues(usable, 'populationFrameHash');
  const evidenceHashes = uniqueValues(usable, 'evidenceHash');
  const lineage = {
    sameInput: inputHashes.length === 1,
    samePopulationFrame: populationFrameHashes.length <= 1,
    evidenceChanged: evidenceHashes.length > 1,
    inputHashes,
    populationFrameHashes,
    evidenceHashes,
  };
  const base = {
    metricVersion: REPEAT_RUN_STABILITY_VERSION,
    runCount: usable.length,
    thresholds: { ...LOW_VARIATION_THRESHOLDS },
    lineage,
    disclaimer: 'Repeat-run convergence measures model-output variation, not accuracy, representativeness, or agreement with real people.',
  };
  if (usable.length < 2) return { ...base, status: 'INSUFFICIENT_RUNS', convergence: 'NOT_ASSESSED', metrics: null };
  if (!lineage.sameInput || !lineage.samePopulationFrame) return { ...base, status: 'NOT_COMPARABLE', convergence: 'NOT_ASSESSED', metrics: null };

  const distributions = usable.map((run) => run.distribution);
  const maxPercentagePointSpread = Math.max(...Array.from({ length: 5 }, (_, index) => {
    const values = distributions.map((distribution) => distribution[index]);
    return Math.max(...values) - Math.min(...values);
  }));
  const topTwo = distributions.map((distribution) => distribution[3] + distribution[4]);
  const topTwoBoxSpread = Math.max(...topTwo) - Math.min(...topTwo);
  const pairwiseJsd = [];
  for (let left = 0; left < distributions.length; left += 1) {
    for (let right = left + 1; right < distributions.length; right += 1) pairwiseJsd.push(jensenShannon(distributions[left], distributions[right]));
  }
  const meanPairwiseJensenShannonDivergence = pairwiseJsd.reduce((sum, value) => sum + value, 0) / pairwiseJsd.length;
  const metrics = { maxPercentagePointSpread, topTwoBoxSpread, meanPairwiseJensenShannonDivergence };
  const lowVariation = maxPercentagePointSpread <= LOW_VARIATION_THRESHOLDS.maxPercentagePointSpread
    && topTwoBoxSpread <= LOW_VARIATION_THRESHOLDS.topTwoBoxSpread;
  return { ...base, status: 'COMPARABLE', convergence: lowVariation ? 'LOW_VARIATION' : 'MATERIAL_VARIATION', metrics };
}
