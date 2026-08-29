const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

const firstText = (...values) => values.map(text).find(Boolean) || null;

function ensembleText(value) {
  if (typeof value === 'string') return text(value);
  if (!value || typeof value !== 'object') return null;
  const count = value.models ?? value.count ?? value.size ?? value.members ?? value.cellCount ?? value.cohortCount;
  const agreement = value.agreement ?? value.consensus ?? value.score;
  if (count && agreement) return `${count} models · ${agreement}`;
  if (count) return `${count} models`;
  return text(agreement);
}

function stabilityFor(value) {
  if (!value || typeof value !== 'object') return text(value);
  if (typeof value.applicable === 'boolean') {
    return {
      applicable: value.applicable,
      ...(Number.isFinite(value.maxPercentagePointSpread) ? { maxPercentagePointSpread: value.maxPercentagePointSpread } : {}),
      ...(Number.isFinite(value.meanJensenShannonDivergence) ? { meanJensenShannonDivergence: value.meanJensenShannonDivergence } : {}),
    };
  }
  return firstText(value.label, value.summary, value.status);
}

function ensembleFor(value) {
  if (value && typeof value === 'object' && Number.isFinite(value.completedCells) && Number.isFinite(value.plannedCells)) {
    return { completedCells: value.completedCells, plannedCells: value.plannedCells };
  }
  return ensembleText(value);
}

function ownerCostFor(result) {
  const economics = result.meta?.economics || result.economics || {};
  const gatewayCost = economics.gatewayCost || {};
  if (gatewayCost.reporting === 'complete' && Number.isFinite(Number(gatewayCost.exactTotalUsd))) {
    return { amount: Number(gatewayCost.exactTotalUsd), currency: economics.currency || 'USD', estimated: false };
  }
  const value = economics.ownerCost || result.meta?.ownerCost || result.meta?.cost || result.ownerCost || result.usage?.ownerCost;
  if (typeof value === 'number') return { amount: value, currency: result.meta?.currency || 'USD', estimated: true };
  if (!value || typeof value !== 'object' || !Number.isFinite(Number(value.amount ?? value.value ?? value.cost))) return null;
  return {
    amount: Number(value.amount ?? value.value ?? value.cost),
    currency: value.currency || 'USD',
    estimated: value.estimated !== false && value.exact !== true,
  };
}

export function researchSignalsFor(result = {}) {
  const credibility = result.credibility || {};
  const meta = result.meta || {};
  const provenance = meta.provenance || meta.reproducibility || result.reproducibility || {};
  const stability = credibility.stability || meta.stability || result.stability;
  const inputHash = firstText(provenance.inputHash, meta.inputHash, meta.hashes?.input);
  const evidenceHash = firstText(provenance.evidenceHash, meta.evidenceHash, meta.hashes?.evidence);

  return {
    stability: stabilityFor(stability) || firstText(credibility.stabilityLabel),
    ensemble: ensembleFor(credibility.ensemble || meta.ensemble || meta.cohort || result.ensemble || result.cohort),
    provenance: inputHash && evidenceHash ? `${inputHash} · ${evidenceHash}` : inputHash || evidenceHash,
    ownerCost: ownerCostFor(result),
    sourceFreshness: firstText(meta.sourceFreshness, meta.freshness, result.evidence?.freshness),
  };
}
