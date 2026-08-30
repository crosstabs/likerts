import { createHash } from 'node:crypto';

export const VALIDATION_LAB_VERSION = 'validation-lab-v1';
export const VALIDATION_CASE_VERSION = 'validation-case-v1';
export const VALIDATION_RUN_VERSION = 'validation-run-v1';
export const VALIDATION_METRIC_VERSION = 'validation-metrics-v1';
export const VALIDATION_THRESHOLDS = Object.freeze({
  meanAbsolutePercentagePointError: 5,
  topTwoBoxAbsoluteError: 5,
  rankOrderAgreement: 0.8,
  segmentDirectionAgreement: 0.75,
  repeatRunMaxCategorySpread: 8,
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const rounded = (value, digits = 4) => Number(value.toFixed(digits));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const topTwo = (distribution, indices) => indices.reduce((sum, index) => sum + distribution[index], 0);
const direction = (value, tieThreshold = 0) => value > tieThreshold ? 1 : value < -tieThreshold ? -1 : 0;
const totalVariationDistancePp = (left, right) => left.reduce((sum, value, index) => sum + Math.abs(value - right[index]), 0) / 2;

export function createOutcomeCommitment(humanOutcome, nonce, identity) {
  if (typeof nonce !== 'string' || nonce.length < 24) throw new TypeError('An outcome commitment nonce of at least 24 characters is required.');
  if (!identity?.caseId || !identity?.protocolVersion) throw new TypeError('The case ID and protocol version must be bound into the outcome commitment.');
  return { algorithm: 'SHA256', hash: sha256(canonicalJson({ humanOutcome, nonce, caseId: identity.caseId, protocolVersion: identity.protocolVersion })) };
}

function blindSyntheticPayload(preregistration) {
  const {
    protocolVersion,
    caseId,
    registeredAt,
    population,
    market,
    language,
    weighting,
    researchMethod,
    modelPolicy,
    evidencePolicy,
    questions,
    subgroupContrasts,
  } = preregistration;
  return {
    protocolVersion,
    caseId,
    registeredAt,
    population,
    market,
    language,
    weighting,
    researchMethod,
    modelPolicy: {
      runtimeVersion: modelPolicy?.runtimeVersion,
      promptVersions: modelPolicy?.promptVersions,
      schemaVersions: modelPolicy?.schemaVersions,
      modelRoutes: modelPolicy?.modelRoutes,
    },
    evidencePolicy,
    questions: questions?.map(({ questionId, questionType, wording, scaleLabels, topTwoIndices }) => ({ questionId, questionType, wording, scaleLabels, topTwoIndices })),
    subgroupContrasts: subgroupContrasts?.map(({ contrastId, questionId, leftGroupId, rightGroupId, metric, tieThresholdPp = 0 }) => ({ contrastId, questionId, leftGroupId, rightGroupId, metric, tieThresholdPp })),
  };
}

export function createSyntheticBriefHash(preregistration) {
  return sha256(canonicalJson(blindSyntheticPayload(preregistration)));
}

export function createPreregistrationHash(preregistration) {
  return sha256(canonicalJson(preregistration));
}

function questionWordingHash(questions = []) {
  return sha256(canonicalJson(questions.map(({ questionId, questionType, wording }) => ({ questionId, questionType, wording }))));
}

function responseScaleHash(questions = []) {
  return sha256(canonicalJson(questions.map(({ questionId, scaleLabels, topTwoIndices }) => ({ questionId, scaleLabels, topTwoIndices }))));
}

export function createValidationRunLineage(preregistration) {
  return {
    preregistrationHash: createPreregistrationHash(preregistration),
    syntheticBriefHash: preregistration.syntheticBriefHash,
    datasetDescriptorHash: sha256(canonicalJson(preregistration.dataset)),
    questionWordingHash: questionWordingHash(preregistration.questions),
    responseScaleHash: responseScaleHash(preregistration.questions),
    populationFrameHash: preregistration.populationFrameHash,
    researchMethod: preregistration.researchMethod,
    evidencePolicy: preregistration.evidencePolicy,
    runtimeVersion: preregistration.modelPolicy?.runtimeVersion,
    promptVersions: preregistration.modelPolicy?.promptVersions,
    schemaVersions: preregistration.modelPolicy?.schemaVersions,
    modelRoutes: preregistration.modelPolicy?.modelRoutes,
  };
}

export function buildBlindSyntheticBrief(preregistration) {
  return {
    ...blindSyntheticPayload(preregistration),
    syntheticBriefHash: createSyntheticBriefHash(preregistration),
    outcomeCommitment: preregistration.outcomeCommitment,
    referenceOutcomeStatus: 'SEALED_AND_WITHHELD_FROM_SYNTHETIC_RUN',
    contaminationBoundary: 'The observed result is withheld from this run. Public-data presence in model pretraining cannot be ruled out.',
  };
}

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const unique = (values) => new Set(values).size === values.length;

function validatePreregistration(preregistration) {
  if (!isRecord(preregistration) || preregistration.protocolVersion !== VALIDATION_CASE_VERSION) return 'The preregistration protocol version is absent or unsupported.';
  if (![preregistration.caseId, preregistration.registeredAt, preregistration.population, preregistration.market, preregistration.language, preregistration.weighting, preregistration.researchMethod].every(isNonEmptyString)) return 'Required preregistration identity or population fields are missing.';
  if (Number.isNaN(Date.parse(preregistration.registeredAt))) return 'The preregistration timestamp is malformed.';
  const dataset = preregistration.dataset;
  if (!isRecord(dataset) || ![dataset.id, dataset.version, dataset.sourceUrl, dataset.licence, dataset.fieldStart, dataset.fieldEnd].every(isNonEmptyString) || !/^https:\/\//.test(dataset.sourceUrl)) return 'Dataset version, access, licence, source, or field dates are missing or malformed.';
  if ([dataset.fieldStart, dataset.fieldEnd].some((value) => Number.isNaN(Date.parse(value)))) return 'Dataset field dates are malformed.';
  if (Date.parse(dataset.fieldStart) > Date.parse(dataset.fieldEnd)) return 'Dataset field dates are reversed.';
  const eligibility = preregistration.eligibility;
  if (!isRecord(eligibility) || eligibility.status !== 'ELIGIBLE' || !['exactQuestionWording', 'compatibleResponseScale', 'compatiblePopulation', 'heldOutAtSyntheticExecution'].every((key) => eligibility[key] === true)) return 'The benchmark is ineligible: exact wording, scale, population compatibility, and held-out status must be preregistered.';
  const sample = preregistration.humanStudy;
  if (!isRecord(sample) || !Number.isInteger(sample.sampleSize) || sample.sampleSize <= 0 || !Number.isFinite(sample.effectiveSampleSize) || sample.effectiveSampleSize <= 0 || sample.effectiveSampleSize > sample.sampleSize) return 'Human-study sample and effective-sample metadata are missing or malformed.';
  if (!/^[a-f0-9]{64}$/.test(preregistration.populationFrameHash || '')) return 'The population-frame hash is missing or malformed.';
  const policy = preregistration.modelPolicy;
  if (!isRecord(policy) || !isNonEmptyString(policy.runtimeVersion) || !isRecord(policy.promptVersions) || !Object.keys(policy.promptVersions).length || !Object.values(policy.promptVersions).every(isNonEmptyString) || !isRecord(policy.schemaVersions) || !Object.keys(policy.schemaVersions).length || !Object.values(policy.schemaVersions).every(isNonEmptyString) || !Array.isArray(policy.modelRoutes) || !policy.modelRoutes.length || !policy.modelRoutes.every(isNonEmptyString)) return 'Model, prompt, schema, or runtime lineage is missing.';
  if (!['NONE', 'PRIOR_ONLY', 'FROZEN_EVIDENCE', 'PAIRED_EVIDENCE_VARIANTS'].includes(preregistration.evidencePolicy)) return 'The evidence policy is unsupported.';
  const questions = preregistration.questions;
  if (!Array.isArray(questions) || questions.length < 3 || !unique(questions.map((question) => question?.questionId))) return 'At least three uniquely identified matched questions are required.';
  for (const question of questions) {
    if (!isRecord(question) || ![question.questionId, question.questionType, question.wording].every(isNonEmptyString) || !Array.isArray(question.scaleLabels) || question.scaleLabels.length < 3 || !question.scaleLabels.every(isNonEmptyString) || !Array.isArray(question.topTwoIndices) || question.topTwoIndices.length !== 2 || question.topTwoIndices[0] !== question.scaleLabels.length - 2 || question.topTwoIndices[1] !== question.scaleLabels.length - 1) return `Question ${question?.questionId || '(unknown)'} is malformed.`;
  }
  const contrasts = preregistration.subgroupContrasts;
  if (!Array.isArray(contrasts) || !contrasts.length || !unique(contrasts.map((contrast) => contrast?.contrastId))) return 'At least one uniquely identified subgroup contrast is required.';
  for (const contrast of contrasts) {
    if (!isRecord(contrast) || ![contrast.contrastId, contrast.questionId, contrast.leftGroupId, contrast.rightGroupId].every(isNonEmptyString) || contrast.leftGroupId === contrast.rightGroupId || contrast.metric !== 'TOP_TWO_BOX' || !questions.some((question) => question.questionId === contrast.questionId) || !Number.isFinite(contrast.tieThresholdPp ?? 0) || (contrast.tieThresholdPp ?? 0) < 0) return `Subgroup contrast ${contrast?.contrastId || '(unknown)'} is malformed or unsupported.`;
  }
  if (!isRecord(preregistration.outcomeCommitment) || preregistration.outcomeCommitment.algorithm !== 'SHA256' || !/^[a-f0-9]{64}$/.test(preregistration.outcomeCommitment.hash || '')) return 'The sealed outcome commitment is missing or malformed.';
  if (!/^[a-f0-9]{64}$/.test(preregistration.syntheticBriefHash || '') || preregistration.syntheticBriefHash !== createSyntheticBriefHash(preregistration)) return 'The frozen synthetic brief hash is missing or does not match the canonical blind brief.';
  return null;
}

export function validateValidationPreregistration(preregistration) {
  try {
    return validatePreregistration(preregistration);
  } catch (error) {
    return `The preregistration could not be validated safely: ${error instanceof Error ? error.message : 'unknown validation error'}`;
  }
}

function validDistribution(values, length) {
  return Array.isArray(values)
    && values.length === length
    && values.every((value) => Number.isFinite(value) && value >= 0 && value <= 100)
    && Math.abs(values.reduce((sum, value) => sum + value, 0) - 100) < 1e-8;
}

function invalidReport(preregistration, reason) {
  const questions = Array.isArray(preregistration?.questions) ? preregistration.questions : [];
  return {
    reportVersion: VALIDATION_LAB_VERSION,
    caseId: preregistration?.caseId || null,
    comparisonStatus: 'INVALIDATED',
    outcome: 'NOT_ASSESSED',
    market: preregistration?.market || null,
    language: preregistration?.language || null,
    questionTypes: [...new Set(questions.map((question) => question?.questionType).filter(isNonEmptyString))],
    reason,
    metrics: null,
    boundary: 'An invalidated comparison produces no metric and supports no accuracy claim.',
  };
}

function averageDistribution(distributions) {
  return distributions[0].map((_, index) => mean(distributions.map((distribution) => distribution[index])));
}

function rank(values) {
  const ordered = values.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value);
  const ranks = Array(values.length);
  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && ordered[end].value === ordered[start].value) end += 1;
    const averageRank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) ranks[ordered[index].index] = averageRank;
    start = end;
  }
  return ranks;
}

function spearman(left, right) {
  if (left.length < 3 || right.length !== left.length) return null;
  const leftRanks = rank(left);
  const rightRanks = rank(right);
  const leftMean = mean(leftRanks);
  const rightMean = mean(rightRanks);
  const numerator = leftRanks.reduce((sum, value, index) => sum + (value - leftMean) * (rightRanks[index] - rightMean), 0);
  const leftSquare = leftRanks.reduce((sum, value) => sum + (value - leftMean) ** 2, 0);
  const rightSquare = rightRanks.reduce((sum, value) => sum + (value - rightMean) ** 2, 0);
  return leftSquare && rightSquare ? rounded(numerator / Math.sqrt(leftSquare * rightSquare)) : null;
}

function jsDivergence(left, right) {
  const epsilon = 1e-12;
  const a = left.map((value) => value / 100);
  const b = right.map((value) => value / 100);
  const midpoint = a.map((value, index) => (value + b[index]) / 2);
  const kl = (source, target) => source.reduce((sum, value, index) => sum + (value ? value * Math.log2((value + epsilon) / (target[index] + epsilon)) : 0), 0);
  return (kl(a, midpoint) + kl(b, midpoint)) / 2;
}

function repeatVariation(completedRuns, syntheticRuns, questionIds) {
  const groups = [...new Set(completedRuns.map((run) => run.evidenceHash))]
    .map((evidenceHash) => ({ evidenceHash, runs: completedRuns.filter((run) => run.evidenceHash === evidenceHash) }))
    .sort((left, right) => right.runs.length - left.runs.length || left.evidenceHash.localeCompare(right.evidenceHash));
  const selected = groups[0] || { evidenceHash: null, runs: [] };
  const comparableRuns = selected.runs;
  const attemptedRunCount = selected.evidenceHash ? syntheticRuns.filter((run) => run.evidenceHash === selected.evidenceHash).length : 0;
  const completionRate = attemptedRunCount ? comparableRuns.length / attemptedRunCount : null;
  if (comparableRuns.length < 3) return {
    status: 'NOT_ASSESSED',
    reason: 'At least three completed runs with identical frozen lineage and evidence are required.',
    evidenceHash: selected.evidenceHash,
    completedRunCount: comparableRuns.length,
    attemptedRunCount,
    completionRate: completionRate === null ? null : rounded(completionRate),
    maxCategorySpreadPp: null,
    topTwoBoxSpreadPp: null,
    meanPairwiseTotalVariationDistancePp: null,
    maxPairwiseTotalVariationDistancePp: null,
    meanPairwiseJensenShannonDivergence: null,
  };
  let maxCategorySpread = 0;
  let topTwoBoxSpread = 0;
  const divergences = [];
  const totalVariationDistances = [];
  for (const questionId of questionIds) {
    const vectors = comparableRuns.map((run) => run.questionResults.find((result) => result.questionId === questionId).distribution);
    vectors[0].forEach((_, index) => {
      const category = vectors.map((vector) => vector[index]);
      maxCategorySpread = Math.max(maxCategorySpread, Math.max(...category) - Math.min(...category));
    });
    const topTwoValues = vectors.map((vector) => vector.at(-2) + vector.at(-1));
    topTwoBoxSpread = Math.max(topTwoBoxSpread, Math.max(...topTwoValues) - Math.min(...topTwoValues));
    for (let left = 0; left < vectors.length; left += 1) {
      for (let right = left + 1; right < vectors.length; right += 1) {
        divergences.push(jsDivergence(vectors[left], vectors[right]));
        totalVariationDistances.push(totalVariationDistancePp(vectors[left], vectors[right]));
      }
    }
  }
  return {
    status: 'ASSESSED',
    evidenceHash: selected.evidenceHash,
    completedRunCount: comparableRuns.length,
    attemptedRunCount,
    completionRate: rounded(completionRate),
    maxCategorySpreadPp: rounded(maxCategorySpread),
    topTwoBoxSpreadPp: rounded(topTwoBoxSpread),
    meanPairwiseTotalVariationDistancePp: rounded(mean(totalVariationDistances)),
    maxPairwiseTotalVariationDistancePp: rounded(Math.max(...totalVariationDistances)),
    meanPairwiseJensenShannonDivergence: rounded(mean(divergences), 6),
  };
}

function evidenceSensitivity(completedRuns, questions) {
  const pairs = [...new Set(completedRuns.map((run) => run.evidencePairId).filter(Boolean))]
    .map((pairId) => ({ pairId, runs: completedRuns.filter((run) => run.evidencePairId === pairId) }))
    .filter((pair) => new Set(pair.runs.map((run) => run.evidenceHash)).size >= 2);
  const hashes = [...new Set(pairs.flatMap((pair) => pair.runs.map((run) => run.evidenceHash)))];
  if (!pairs.length) return { status: 'NOT_ASSESSED', reason: 'No preregistered paired evidence variants completed with otherwise identical lineage.', pairedComparisonCount: 0, evidenceHashCount: hashes.length, maxTopTwoBoxDifferencePp: null };
  let maximum = 0;
  for (const pair of pairs) {
    const pairHashes = [...new Set(pair.runs.map((run) => run.evidenceHash))];
    for (const question of questions) {
      const byHash = pairHashes.map((hash) => {
        const results = pair.runs.filter((run) => run.evidenceHash === hash).map((run) => run.questionResults.find((result) => result.questionId === question.questionId).distribution);
        return topTwo(averageDistribution(results), question.topTwoIndices);
      });
      maximum = Math.max(maximum, Math.max(...byHash) - Math.min(...byHash));
    }
  }
  return { status: 'ASSESSED', pairedComparisonCount: pairs.length, evidenceHashCount: hashes.length, maxTopTwoBoxDifferencePp: rounded(maximum), interpretation: 'Evidence sensitivity describes output movement under paired evidence changes; it is not an accuracy metric.' };
}

function averagedQuestionResults(completedRuns, questions) {
  return questions.map((question) => {
    const runs = completedRuns.map((run) => run.questionResults.find((result) => result.questionId === question.questionId));
    const groupIds = [...new Set(runs.flatMap((result) => result.subgroups?.map((group) => group.groupId) || []))];
    return {
      questionId: question.questionId,
      distribution: averageDistribution(runs.map((result) => result.distribution)),
      subgroups: groupIds.map((groupId) => ({ groupId, distribution: averageDistribution(runs.map((result) => result.subgroups.find((group) => group.groupId === groupId).distribution)) })),
    };
  });
}

function classifyOutcome(metrics, failedRuns) {
  if (metrics.rankOrderAgreement === null || metrics.segmentDirectionAgreement === null || metrics.repeatRunVariation.status !== 'ASSESSED') return 'NOT_ASSESSED';
  const passes = [
    metrics.meanAbsolutePercentagePointError <= VALIDATION_THRESHOLDS.meanAbsolutePercentagePointError,
    metrics.topTwoBoxAbsoluteError <= VALIDATION_THRESHOLDS.topTwoBoxAbsoluteError,
    metrics.rankOrderAgreement === null || metrics.rankOrderAgreement >= VALIDATION_THRESHOLDS.rankOrderAgreement,
    metrics.segmentDirectionAgreement === null || metrics.segmentDirectionAgreement >= VALIDATION_THRESHOLDS.segmentDirectionAgreement,
    metrics.repeatRunVariation.maxCategorySpreadPp === null || metrics.repeatRunVariation.maxCategorySpreadPp <= VALIDATION_THRESHOLDS.repeatRunMaxCategorySpread,
  ];
  if (passes.every(Boolean) && failedRuns === 0) return 'WITHIN_PREREGISTERED_TOLERANCE';
  if (passes.every(Boolean)) return 'MIXED_EVIDENCE';
  return passes.every((value) => !value) ? 'OUTSIDE_PREREGISTERED_TOLERANCE' : 'MIXED_EVIDENCE';
}

function scoreValidationCaseUnsafe({ preregistration, reveal, syntheticRuns, evaluator }) {
  const preregistrationError = validatePreregistration(preregistration);
  if (preregistrationError) return invalidReport(preregistration, preregistrationError);
  if (!reveal?.humanOutcome || createOutcomeCommitment(reveal.humanOutcome, reveal.nonce, preregistration).hash !== preregistration.outcomeCommitment.hash) return invalidReport(preregistration, 'The revealed human outcome does not match the preregistered commitment.');
  if (!isRecord(evaluator) || !isNonEmptyString(evaluator.version) || !isNonEmptyString(evaluator.evaluatedAt) || !isNonEmptyString(evaluator.calibrationDate) || Number.isNaN(Date.parse(evaluator.evaluatedAt)) || Number.isNaN(Date.parse(evaluator.calibrationDate))) return invalidReport(preregistration, 'Evaluator-owned version, evaluation timestamp, or calibration date metadata are missing or malformed.');
  if (!Array.isArray(syntheticRuns) || !syntheticRuns.length) return { ...invalidReport(preregistration, 'No synthetic runs were supplied.'), comparisonStatus: 'ABORTED' };
  if (!unique(syntheticRuns.map((run) => run?.runId)) || syntheticRuns.some((run) => !isNonEmptyString(run?.runId))) return invalidReport(preregistration, 'Synthetic run identifiers are missing or duplicated.');
  if (syntheticRuns.some((run) => run.syntheticBriefHash !== preregistration.syntheticBriefHash)) return invalidReport(preregistration, 'At least one synthetic run does not match the frozen brief hash.');
  const expectedRunLineage = createValidationRunLineage(preregistration);
  if (syntheticRuns.some((run) => canonicalJson(run.lineage) !== canonicalJson(expectedRunLineage))) return invalidReport(preregistration, 'At least one synthetic run does not match the frozen dataset, frame, method, model, prompt, schema, runtime, or evidence-policy lineage.');
  if (syntheticRuns.some((run) => run?.runVersion !== VALIDATION_RUN_VERSION || !['COMPLETED', 'FAILED', 'ABORTED', 'EXCLUDED'].includes(run.status) || !/^[a-f0-9]{64}$/.test(run.evidenceHash || '') || (run.status !== 'COMPLETED' && !isNonEmptyString(run.failureCode)))) return invalidReport(preregistration, 'A synthetic run is unversioned or has malformed status, evidence, or failure metadata.');

  if (!Array.isArray(reveal.humanOutcome.questions) || reveal.humanOutcome.questions.length !== preregistration.questions.length || !unique(reveal.humanOutcome.questions.map((question) => question?.questionId)) || reveal.humanOutcome.questions.some((question) => !preregistration.questions.some((registered) => registered.questionId === question?.questionId))) return invalidReport(preregistration, 'The human outcome does not contain the exact preregistered question set with unique identifiers.');
  const humanByQuestion = new Map(reveal.humanOutcome.questions.map((question) => [question.questionId, question]));
  const questionIds = preregistration.questions.map((question) => question.questionId);
  for (const question of preregistration.questions) {
    const human = humanByQuestion.get(question.questionId);
    if (!human || !validDistribution(human.distribution, question.scaleLabels.length)) return invalidReport(preregistration, `Human result ${question.questionId} is missing or malformed.`);
    if (human.subgroups && (!Array.isArray(human.subgroups) || !unique(human.subgroups.map((group) => group?.groupId)))) return invalidReport(preregistration, `Human result ${question.questionId} has malformed or duplicate subgroup identifiers.`);
    for (const contrast of preregistration.subgroupContrasts.filter((item) => item.questionId === question.questionId)) {
      if (![contrast.leftGroupId, contrast.rightGroupId].every((groupId) => human.subgroups?.some((group) => group.groupId === groupId && validDistribution(group.distribution, question.scaleLabels.length)))) return invalidReport(preregistration, `Human result ${question.questionId} is missing a preregistered subgroup for ${contrast.contrastId}.`);
    }
  }
  const completedRuns = syntheticRuns.filter((run) => run.status === 'COMPLETED');
  const failedRuns = syntheticRuns.length - completedRuns.length;
  if (!completedRuns.length) {
    return {
      reportVersion: VALIDATION_LAB_VERSION,
      caseId: preregistration.caseId,
      comparisonStatus: 'ABORTED',
      outcome: 'NOT_ASSESSED',
      market: preregistration.market,
      language: preregistration.language,
      questionTypes: [...new Set(preregistration.questions.map((question) => question.questionType))],
      completedRuns: 0,
      failedRuns,
      reason: 'No eligible synthetic run completed.',
      metrics: null,
      boundary: 'An aborted comparison produces no metric and supports no accuracy claim.',
    };
  }
  for (const run of completedRuns) {
    if (!Array.isArray(run.questionResults) || run.questionResults.length !== questionIds.length || !unique(run.questionResults.map((result) => result?.questionId)) || run.questionResults.some((result) => !questionIds.includes(result.questionId))) return invalidReport(preregistration, `Synthetic run ${run.runId} does not contain the exact preregistered question set.`);
    for (const question of preregistration.questions) {
      const result = run.questionResults?.find((item) => item.questionId === question.questionId);
      if (!result || !validDistribution(result.distribution, question.scaleLabels.length)) return invalidReport(preregistration, `Synthetic run ${run.runId} has a missing or malformed result for ${question.questionId}.`);
      if (result.subgroups && (!Array.isArray(result.subgroups) || !unique(result.subgroups.map((group) => group?.groupId)))) return invalidReport(preregistration, `Synthetic run ${run.runId} has malformed or duplicate subgroup identifiers for ${question.questionId}.`);
      for (const contrast of preregistration.subgroupContrasts.filter((item) => item.questionId === question.questionId)) {
        if (![contrast.leftGroupId, contrast.rightGroupId].every((groupId) => result.subgroups?.some((group) => group.groupId === groupId && validDistribution(group.distribution, question.scaleLabels.length)))) return invalidReport(preregistration, `Synthetic run ${run.runId} is missing a preregistered subgroup for ${contrast.contrastId}.`);
      }
    }
  }

  const syntheticAverage = averagedQuestionResults(completedRuns, preregistration.questions);
  const rankingInputs = [];
  const questionMetrics = preregistration.questions.map((question) => {
    const human = humanByQuestion.get(question.questionId);
    const synthetic = syntheticAverage.find((result) => result.questionId === question.questionId);
    rankingInputs.push({ humanTopTwoBox: topTwo(human.distribution, question.topTwoIndices), syntheticTopTwoBox: topTwo(synthetic.distribution, question.topTwoIndices) });
    return {
      questionId: question.questionId,
      questionType: question.questionType,
      meanAbsolutePercentagePointError: rounded(mean(human.distribution.map((value, index) => Math.abs(value - synthetic.distribution[index])))),
      maxCategoryAbsoluteErrorPp: rounded(Math.max(...human.distribution.map((value, index) => Math.abs(value - synthetic.distribution[index])))),
      totalVariationDistancePp: rounded(totalVariationDistancePp(human.distribution, synthetic.distribution)),
      jensenShannonDivergence: rounded(jsDivergence(human.distribution, synthetic.distribution), 6),
      topTwoBoxAbsoluteError: rounded(Math.abs(topTwo(human.distribution, question.topTwoIndices) - topTwo(synthetic.distribution, question.topTwoIndices))),
    };
  });
  const contrastResults = preregistration.subgroupContrasts.map((contrast) => {
    const question = preregistration.questions.find((item) => item.questionId === contrast.questionId);
    const human = humanByQuestion.get(contrast.questionId);
    const synthetic = syntheticAverage.find((item) => item.questionId === contrast.questionId);
    const humanLeft = human.subgroups.find((group) => group.groupId === contrast.leftGroupId);
    const humanRight = human.subgroups.find((group) => group.groupId === contrast.rightGroupId);
    if (!humanLeft || !humanRight) return { ...contrast, status: 'NOT_ASSESSED', agreement: null };
    const syntheticLeft = synthetic.subgroups.find((group) => group.groupId === contrast.leftGroupId);
    const syntheticRight = synthetic.subgroups.find((group) => group.groupId === contrast.rightGroupId);
    const tieThresholdPp = contrast.tieThresholdPp ?? 0;
    const humanDifferencePp = topTwo(humanLeft.distribution, question.topTwoIndices) - topTwo(humanRight.distribution, question.topTwoIndices);
    const syntheticDifferencePp = topTwo(syntheticLeft.distribution, question.topTwoIndices) - topTwo(syntheticRight.distribution, question.topTwoIndices);
    const humanDirection = direction(humanDifferencePp, tieThresholdPp);
    const syntheticDirection = direction(syntheticDifferencePp, tieThresholdPp);
    return { ...contrast, status: 'ASSESSED', tieThresholdPp, humanDifferencePp: rounded(humanDifferencePp), syntheticDifferencePp: rounded(syntheticDifferencePp), humanDirection, syntheticDirection, agreement: humanDirection === syntheticDirection };
  });
  const assessedContrasts = contrastResults.filter((contrast) => contrast.status === 'ASSESSED');
  const repeatRunVariation = repeatVariation(completedRuns, syntheticRuns, questionIds);
  const rankOrderAgreement = spearman(rankingInputs.map((question) => question.humanTopTwoBox), rankingInputs.map((question) => question.syntheticTopTwoBox));
  const metrics = {
    metricVersion: VALIDATION_METRIC_VERSION,
    meanAbsolutePercentagePointError: rounded(mean(questionMetrics.map((question) => question.meanAbsolutePercentagePointError))),
    meanMaxCategoryAbsoluteErrorPp: rounded(mean(questionMetrics.map((question) => question.maxCategoryAbsoluteErrorPp))),
    meanTotalVariationDistancePp: rounded(mean(questionMetrics.map((question) => question.totalVariationDistancePp))),
    meanJensenShannonDivergence: rounded(mean(questionMetrics.map((question) => question.jensenShannonDivergence)), 6),
    topTwoBoxAbsoluteError: rounded(mean(questionMetrics.map((question) => question.topTwoBoxAbsoluteError))),
    rankOrderAgreement,
    rankOrderAgreementReason: rankOrderAgreement === null ? 'At least three matched questions with non-constant top-two-box ranks are required.' : null,
    segmentDirectionAgreement: assessedContrasts.length ? rounded(assessedContrasts.filter((contrast) => contrast.agreement).length / assessedContrasts.length) : null,
    repeatRunVariation,
    evidenceSensitivity: evidenceSensitivity(completedRuns, preregistration.questions),
  };
  return {
    reportVersion: VALIDATION_LAB_VERSION,
    metricVersion: VALIDATION_METRIC_VERSION,
    caseId: preregistration.caseId,
    comparisonStatus: 'COMPLETED',
    outcome: classifyOutcome(metrics, failedRuns),
    evaluationDate: evaluator.evaluatedAt.slice(0, 10),
    calibrationDate: evaluator.calibrationDate.slice(0, 10),
    evaluatorVersion: evaluator.version,
    market: preregistration.market,
    language: preregistration.language,
    questionTypes: [...new Set(preregistration.questions.map((question) => question.questionType))],
    completedRuns: completedRuns.length,
    failedRuns,
    metrics,
    questionMetrics,
    subgroupContrasts: contrastResults,
    thresholds: VALIDATION_THRESHOLDS,
    lineage: {
      dataset: preregistration.dataset,
      datasetDescriptorHash: sha256(canonicalJson(preregistration.dataset)),
      questionWordingHash: questionWordingHash(preregistration.questions),
      responseScaleHash: responseScaleHash(preregistration.questions),
      population: preregistration.population,
      weighting: preregistration.weighting,
      researchMethod: preregistration.researchMethod,
      runtimeVersion: preregistration.modelPolicy.runtimeVersion,
      promptVersions: preregistration.modelPolicy.promptVersions,
      schemaVersions: preregistration.modelPolicy.schemaVersions,
      modelRoutes: preregistration.modelPolicy.modelRoutes,
      syntheticBriefHash: preregistration.syntheticBriefHash,
      outcomeCommitmentHash: preregistration.outcomeCommitment.hash,
      preregistrationHash: createPreregistrationHash(preregistration),
      syntheticRunBundleHash: sha256(canonicalJson(syntheticRuns)),
      runIds: syntheticRuns.map((run) => run.runId),
    },
    boundary: 'This reports agreement with one frozen observed human-survey reference under one protocol. It applies only to the recorded questions, population, market, language, field dates, weighting, model routes, prompts, and schemas. Public-data presence in model pretraining cannot be ruled out.',
  };
}

export function scoreValidationCase(input) {
  try {
    return scoreValidationCaseUnsafe(input || {});
  } catch (error) {
    return invalidReport(input?.preregistration, `The comparison could not be scored safely: ${error instanceof Error ? error.message : 'unknown evaluator error'}`);
  }
}

function summarizeDimension(comparisons, field) {
  const values = [...new Set(comparisons.flatMap((comparison) => Array.isArray(comparison[field]) ? comparison[field] : [comparison[field]]).filter(Boolean))];
  return Object.fromEntries(values.map((value) => {
    const rows = comparisons.filter((comparison) => Array.isArray(comparison[field]) ? comparison[field].includes(value) : comparison[field] === value);
    const completed = rows.filter((comparison) => comparison.comparisonStatus === 'COMPLETED');
    return [value, { comparisons: rows.length, completedComparisons: completed.length, outcomes: Object.fromEntries(['WITHIN_PREREGISTERED_TOLERANCE', 'MIXED_EVIDENCE', 'OUTSIDE_PREREGISTERED_TOLERANCE', 'NOT_ASSESSED'].map((outcome) => [outcome, rows.filter((row) => row.outcome === outcome).length])) }];
  }));
}

export function summarizeValidationCases(comparisons = []) {
  const completed = comparisons.filter((comparison) => comparison.comparisonStatus === 'COMPLETED');
  const supportedMarkets = [...new Set(completed.map((comparison) => comparison.market))];
  const supportedQuestionTypes = [...new Set(completed.flatMap((comparison) => comparison.questionTypes || []))];
  const seenMarkets = [...new Set(comparisons.map((comparison) => comparison.market).filter(Boolean))];
  const seenQuestionTypes = [...new Set(comparisons.flatMap((comparison) => comparison.questionTypes || []))];
  return {
    scorecardVersion: VALIDATION_LAB_VERSION,
    status: completed.length ? 'COMPLETED_COMPARISONS_AVAILABLE' : 'NO_COMPLETED_BENCHMARKS',
    completedComparisons: completed.length,
    publishedWithinTolerance: completed.filter((comparison) => comparison.outcome === 'WITHIN_PREREGISTERED_TOLERANCE').length,
    publishedMixedOutcomes: completed.filter((comparison) => comparison.outcome === 'MIXED_EVIDENCE').length,
    publishedOutsideTolerance: completed.filter((comparison) => comparison.outcome === 'OUTSIDE_PREREGISTERED_TOLERANCE').length,
    publishedNonCompletedComparisons: comparisons.length - completed.length,
    latestEvaluationDate: completed.map((comparison) => comparison.evaluationDate).filter(Boolean).sort().at(-1) || null,
    supportedMarkets,
    supportedQuestionTypes,
    unsupportedMarkets: comparisons.length ? seenMarkets.filter((market) => !supportedMarkets.includes(market)) : ['ALL'],
    unsupportedQuestionTypes: comparisons.length ? seenQuestionTypes.filter((type) => !supportedQuestionTypes.includes(type)) : ['ALL'],
    byMarket: summarizeDimension(comparisons, 'market'),
    byLanguage: summarizeDimension(comparisons, 'language'),
    byQuestionType: summarizeDimension(comparisons, 'questionTypes'),
    comparisons,
    boundary: 'Results are scoped to their exact benchmark cells. No completed comparison may be generalized to an untested market, language, population, model, prompt, method, or question type.',
  };
}
