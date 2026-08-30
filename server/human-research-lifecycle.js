import { createHash } from 'node:crypto';
import { createLineageEnvelope, lineageEnvelopeSchema } from './privacy-contract.js';

export const HUMAN_RESEARCH_LIFECYCLE_VERSION = 'human-research-lifecycle-v1';
export const HUMAN_RESEARCH_PACKAGE_VERSION = 'human-research-package-v1';
export const HUMAN_RESEARCH_LIFECYCLE_STATES = Object.freeze([
  'DRAFT',
  'RESEARCHER_REVIEW',
  'APPROVED_FOR_FIELDING',
  'FIELDING',
  'CLOSED',
  'ANALYZED',
]);
export const HUMAN_RESEARCH_STATUSES = HUMAN_RESEARCH_LIFECYCLE_STATES;
export const HUMAN_RESEARCH_PACKAGE_PARTS = Object.freeze([
  'questionnaire',
  'screener',
  'quota',
  'recruitment',
  'analysis',
  'sourceLineage',
]);

export const HUMAN_RESEARCH_BLOCKER_CODES = Object.freeze([
  'TRANSLATION_REVIEW',
  'CONSENT_PRIVACY_REVIEW',
  'STIMULUS_REVIEW',
  'QUESTIONNAIRE_REVIEW',
  'SAMPLE_DESIGN_REVIEW',
  'SAMPLING_COVERAGE_REVIEW',
  'DENOMINATOR_REVIEW',
  'ANALYSIS_REVIEW',
]);

const statusIndex = (status) => HUMAN_RESEARCH_LIFECYCLE_STATES.indexOf(status);
const clone = (value) => structuredClone(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

function canonical(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function hashHumanResearchValue(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function humanResearchPackageHashes(parts) {
  const hashes = Object.fromEntries(HUMAN_RESEARCH_PACKAGE_PARTS.map((part) => [part, hashHumanResearchValue(parts?.[part] ?? null)]));
  hashes.package = hashHumanResearchValue(hashes);
  return hashes;
}

function withHashAliases(hashes) {
  return {
    ...hashes,
    questionnaireHash: hashes.questionnaire,
    screenerHash: hashes.screener,
    quotaHash: hashes.quota,
    recruitmentHash: hashes.recruitment,
    analysisHash: hashes.analysis,
    sourceLineageHash: hashes.sourceLineage,
    packageHash: hashes.package,
  };
}

export class HumanResearchLifecycleError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'HumanResearchLifecycleError';
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => { throw new HumanResearchLifecycleError(code, message, details); };

function normalizedCode(value) {
  return String(value || 'UNSPECIFIED_BLOCKER')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80) || 'UNSPECIFIED_BLOCKER';
}

function normalizedResolutionEvidence(value) {
  if (typeof value === 'string') {
    const evidence = value.trim();
    if (evidence) return evidence;
  } else if (value && typeof value === 'object') {
    if ((Array.isArray(value) && value.length) || (!Array.isArray(value) && Object.keys(value).length)) return clone(value);
  }
  fail('BLOCKER_RESOLUTION_EVIDENCE_REQUIRED', 'Blocker resolution requires non-empty review evidence.');
}

function normalizeResolution(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const evidence = normalizedResolutionEvidence(value.evidence);
  return {
    actor: String(value.actor || '').trim(),
    resolvedAt: String(value.resolvedAt || '').trim(),
    evidence,
    evidenceHash: String(value.evidenceHash || hashHumanResearchValue(evidence)).trim(),
    version: value.version,
  };
}

function normalizeBlocker(value) {
  if (typeof value === 'string') {
    return { code: normalizedCode(value), message: value.trim(), resolved: false };
  }
  if (!value || typeof value !== 'object') fail('INVALID_BLOCKER', 'Each human-research blocker must be a string or object.');
  const code = normalizedCode(value.code || value.id || value.type || value.reason);
  const message = String(value.message || value.reason || code).trim();
  if (!message) fail('INVALID_BLOCKER', `Blocker ${code} must include a message.`);
  const resolved = value.resolved === true || value.isBlocking === false || ['RESOLVED', 'APPROVED', 'COMPLETED', 'CLEAR'].includes(String(value.status || '').toUpperCase());
  return {
    code,
    message,
    resolved,
    ...(value.severity ? { severity: String(value.severity).toUpperCase() } : {}),
    ...(value.source ? { source: String(value.source) } : {}),
    ...(value.mandatory === true ? { mandatory: true } : {}),
    ...(resolved && value.resolution ? { resolution: normalizeResolution(value.resolution) } : {}),
  };
}

function normalizeBlockers(values) {
  if (values == null) return [];
  const source = Array.isArray(values)
    ? values
    : values && typeof values === 'object'
      ? Object.entries(values).flatMap(([key, value]) => asBlockerEntries(key, value))
      : null;
  if (!source) fail('INVALID_BLOCKER', 'Human-research blockers must be an array or keyed object.');
  const blockers = source.map(normalizeBlocker);
  const seen = new Set();
  for (const blocker of blockers) {
    if (seen.has(blocker.code)) fail('INVALID_BLOCKER', `Blocker codes must be unique: ${blocker.code}.`);
    seen.add(blocker.code);
  }
  return blockers;
}

function normalizeDeclaredBlockers(values) {
  if (values == null) return [];
  const source = Array.isArray(values)
    ? values
    : values && typeof values === 'object'
      ? Object.entries(values).flatMap(([key, value]) => asBlockerEntries(key, value))
      : null;
  if (!source) fail('INVALID_BLOCKER', 'Human-research blockers must be an array or keyed object.');
  return normalizeBlockers(source.map((value) => typeof value === 'string'
    ? value
    : { ...value, resolved: false, isBlocking: true, status: 'OPEN', resolution: undefined }));
}

function asBlockerEntries(key, value) {
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? { code: key, message: item } : { ...item, code: item.code || key });
  if (value && typeof value === 'object') return [{ ...value, code: value.code || key }];
  if (value === false || value == null) return [];
  return [{ code: key, message: String(value) }];
}

function activeBlockers(blockers) {
  return blockers.filter((blocker) => !blocker.resolved);
}

function blockerIssues(blockers) {
  return activeBlockers(blockers).map((blocker) => blocker.code);
}

const SAMPLE_DESIGN_REVIEW_STATUSES = new Set(['PLANNING_ESTIMATE', 'RESEARCHER_DESIGN_REQUIRED', 'BLOCKED']);
const SAMPLING_COVERAGE_REVIEW_STATUSES = new Set(['TARGETS_UNAVAILABLE', 'UNESTIMATED', 'BLOCKED']);
const planStatus = (value) => String(value || '').trim().toUpperCase();
const objectPart = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

function quotaPartFromHandoff(handoff = {}) {
  const hasCompositeQuotaPart = own(handoff, 'quotaPlan') || own(handoff, 'samplePlan') || own(handoff, 'incidencePlan');
  if (!hasCompositeQuotaPart) return handoff.quota ?? null;
  return {
    quotaPlan: handoff.quotaPlan ?? handoff.quota ?? null,
    samplePlan: handoff.samplePlan ?? null,
    incidencePlan: handoff.incidencePlan ?? null,
  };
}

function quotaPartPlans(quota) {
  const quotaObject = objectPart(quota);
  const isComposite = own(quotaObject, 'quotaPlan') || own(quotaObject, 'samplePlan') || own(quotaObject, 'incidencePlan');
  if (!isComposite) return { quotaPlan: quotaObject, samplePlan: {}, incidencePlan: {}, hasQuotaPlan: quota != null };
  return {
    quotaPlan: objectPart(quotaObject.quotaPlan),
    samplePlan: objectPart(quotaObject.samplePlan),
    incidencePlan: objectPart(quotaObject.incidencePlan),
    hasQuotaPlan: quotaObject.quotaPlan != null,
  };
}

function sampleDesignReviewRequired(...plans) {
  return plans.some((plan) => plan?.sampleDesignReviewRequired === true
    || plan?.sampleSizeReviewRequired === true
    || plan?.researcherDesignReviewRequired === true
    || plan?.reviewRequired === true
    || SAMPLE_DESIGN_REVIEW_STATUSES.has(planStatus(plan?.status))
    || ['PENDING', 'REQUIRED', 'REQUIRES_REVIEW', 'RESEARCHER_DESIGN_REQUIRED'].includes(planStatus(plan?.reviewStatus)));
}

function samplingCoverageReviewRequired(quotaPlan, incidencePlan) {
  return quotaPlan?.samplingCoverageReviewRequired === true
    || quotaPlan?.coverageReviewRequired === true
    || incidencePlan?.samplingCoverageReviewRequired === true
    || incidencePlan?.coverageReviewRequired === true
    || ['PENDING', 'REQUIRED', 'REQUIRES_REVIEW'].includes(planStatus(quotaPlan?.samplingCoverageReviewStatus))
    || ['PENDING', 'REQUIRED', 'REQUIRES_REVIEW'].includes(planStatus(incidencePlan?.samplingCoverageReviewStatus))
    || quotaPlan?.denominatorReviewRequired === true
    || planStatus(quotaPlan?.denominatorStatus) === 'PENDING'
    || SAMPLING_COVERAGE_REVIEW_STATUSES.has(planStatus(quotaPlan?.status))
    || SAMPLING_COVERAGE_REVIEW_STATUSES.has(planStatus(incidencePlan?.status));
}

function partsFromHandoff(handoff = {}) {
  return {
    questionnaire: handoff.questionnaire ?? null,
    screener: handoff.screener ?? handoff.screeningPlan ?? null,
    quota: quotaPartFromHandoff(handoff),
    recruitment: handoff.recruitment ?? handoff.recruitmentPlan ?? null,
    analysis: handoff.analysis ?? handoff.analysisPlan ?? null,
    sourceLineage: handoff.sourceLineage ?? handoff.sourceStudy ?? null,
  };
}

function blockersFromHandoff(handoff = {}) {
  const blockers = [];
  const add = (code, message, source) => blockers.push({ code, message, resolved: false, source });
  if (handoff.blockers) blockers.push(...normalizeDeclaredBlockers(handoff.blockers));
  for (const issue of handoff.lifecycle?.blockingIssues || []) add(normalizedCode(issue), String(issue), 'HANDOFF_LIFECYCLE');
  for (const issue of handoff.blockingIssues || []) add(normalizedCode(issue), String(issue), 'HANDOFF');
  const questionnaire = handoff.questionnaire || {};
  const languageReview = questionnaire.languageValidation?.status === 'HUMAN_TRANSLATION_REVIEW_REQUIRED';
  if (languageReview) add('TRANSLATION_REVIEW', 'Human translation and locale review is required.', 'QUESTIONNAIRE');
  if (questionnaire.hasPlaceholders === true) add('QUESTIONNAIRE_REVIEW', 'Questionnaire placeholders must be resolved before approval.', 'QUESTIONNAIRE');
  if ((questionnaire.stimuli || []).some((stimulus) => (stimulus.reviewFlags || []).length)) add('STIMULUS_REVIEW', 'Stimulus wording and presentation require researcher review.', 'QUESTIONNAIRE');
  const screening = handoff.screeningPlan || {};
  if (screening.sensitiveDataReviewRequired === true) add('CONSENT_PRIVACY_REVIEW', 'Consent and privacy handling require researcher approval.', 'SCREENER');
  if ((screening.criteria || []).some((criterion) => /REQUIRES_|DRAFT/i.test(String(criterion.status || '')))) add('CONSENT_PRIVACY_REVIEW', 'Screening and eligibility criteria require operational review.', 'SCREENER');
  const quota = handoff.quotaPlan || {};
  if (quota.status === 'TARGETS_UNAVAILABLE' || (quota.status !== 'NOT_APPLICABLE' && handoff.incidencePlan?.status === 'UNESTIMATED')) add('DENOMINATOR_REVIEW', 'Screened denominator and quota basis are not established.', 'QUOTA');
  if (samplingCoverageReviewRequired(quota, handoff.incidencePlan)) add('SAMPLING_COVERAGE_REVIEW', 'Sampling coverage, incidence, and quota basis require researcher review.', 'QUOTA');
  if (sampleDesignReviewRequired(handoff, handoff.samplePlan)) add('SAMPLE_DESIGN_REVIEW', 'Sample-size, incidence, and fielding design require researcher review.', 'QUOTA');
  const analysis = handoff.analysisPlan || {};
  if (analysis.status === 'REQUIRES_REVIEW' || analysis.blocked === true) add('ANALYSIS_REVIEW', 'Analysis rules require researcher review.', 'ANALYSIS');
  const unique = new Map();
  return blockers.filter((blocker) => !unique.has(blocker.code) && unique.set(blocker.code, true));
}

function blockersFromParts(parts) {
  const blockers = [];
  if (parts.questionnaire == null) blockers.push({ code: 'QUESTIONNAIRE_REVIEW', message: 'A questionnaire is required before approval.', resolved: false, source: 'PACKAGE' });
  if (parts.screener == null) blockers.push({ code: 'CONSENT_PRIVACY_REVIEW', message: 'A consent and eligibility screener is required before approval.', resolved: false, source: 'PACKAGE' });
  if (parts.quota == null) blockers.push({ code: 'DENOMINATOR_REVIEW', message: 'A reviewed denominator and quota plan is required before approval.', resolved: false, source: 'PACKAGE' });
  if (parts.analysis == null) blockers.push({ code: 'ANALYSIS_REVIEW', message: 'A preregistered analysis plan is required before approval.', resolved: false, source: 'PACKAGE' });
  const questionnaire = parts.questionnaire || {};
  const questionReviewFlags = (questionnaire.questions || []).flatMap((question) => question.reviewFlags || []).map(normalizedCode);
  if (questionnaire.languageValidation?.status === 'HUMAN_TRANSLATION_REVIEW_REQUIRED' || questionnaire.translationReviewRequired === true || ['PENDING', 'REQUIRED'].includes(String(questionnaire.translationStatus || '').toUpperCase()) || questionReviewFlags.includes('HUMAN_TRANSLATION_REVIEW_REQUIRED')) blockers.push({ code: 'TRANSLATION_REVIEW', message: 'Human translation and locale review is required.', resolved: false, source: 'QUESTIONNAIRE' });
  if (questionnaire.hasPlaceholders === true || questionnaire.questionnaireReviewRequired === true || questionnaire.reviewRequired === true || questionReviewFlags.some((flag) => flag.endsWith('_REVIEW_REQUIRED'))) blockers.push({ code: 'QUESTIONNAIRE_REVIEW', message: 'Questionnaire placeholders and wording must be resolved before approval.', resolved: false, source: 'QUESTIONNAIRE' });
  if (questionnaire.stimulusReviewRequired === true || (questionnaire.stimuli || []).some((stimulus) => (stimulus.reviewFlags || []).length)) blockers.push({ code: 'STIMULUS_REVIEW', message: 'Stimulus wording and presentation require researcher review.', resolved: false, source: 'QUESTIONNAIRE' });
  const screener = parts.screener || {};
  if (screener.consentPrivacyReviewRequired === true || screener.sensitiveDataReviewRequired === true || planStatus(screener.consentPrivacyStatus) === 'PENDING' || planStatus(screener.privacyStatus) === 'PENDING' || (screener.criteria || []).some((criterion) => /REQUIRES_|DRAFT/i.test(String(criterion.status || '')))) blockers.push({ code: 'CONSENT_PRIVACY_REVIEW', message: 'Consent and privacy handling require researcher approval.', resolved: false, source: 'SCREENER' });
  const { quotaPlan, samplePlan, incidencePlan, hasQuotaPlan } = quotaPartPlans(parts.quota);
  if (!hasQuotaPlan || quotaPlan.denominatorReviewRequired === true || quotaPlan.denominatorStatus === 'PENDING' || quotaPlan.status === 'TARGETS_UNAVAILABLE' || (quotaPlan.status !== 'NOT_APPLICABLE' && incidencePlan.status === 'UNESTIMATED')) blockers.push({ code: 'DENOMINATOR_REVIEW', message: 'Screened denominator and quota basis require researcher review.', resolved: false, source: 'QUOTA' });
  if (!hasQuotaPlan || samplingCoverageReviewRequired(quotaPlan, incidencePlan)) blockers.push({ code: 'SAMPLING_COVERAGE_REVIEW', message: 'Sampling coverage, incidence, and quota basis require researcher review.', resolved: false, source: 'QUOTA' });
  if (sampleDesignReviewRequired(samplePlan)) blockers.push({ code: 'SAMPLE_DESIGN_REVIEW', message: 'Sample-size, incidence, and fielding design require researcher review.', resolved: false, source: 'QUOTA' });
  const analysis = parts.analysis || {};
  if (analysis.analysisReviewRequired === true || analysis.reviewRequired === true || planStatus(analysis.reviewStatus) === 'PENDING' || planStatus(analysis.status) === 'REQUIRES_REVIEW' || analysis.blocked === true) blockers.push({ code: 'ANALYSIS_REVIEW', message: 'Analysis rules require researcher review.', resolved: false, source: 'ANALYSIS' });
  return blockers;
}

function resolveParts(input) {
  const handoff = input.handoff || null;
  const fromHandoff = handoff ? partsFromHandoff(handoff) : {};
  return Object.fromEntries(HUMAN_RESEARCH_PACKAGE_PARTS.map((part) => [
    part,
    own(input, part) ? input[part] : fromHandoff[part] ?? null,
  ]));
}

function resolveBlockers(input) {
  const parts = resolveParts(input);
  const declared = [
    ...(own(input, 'blockers') ? normalizeDeclaredBlockers(input.blockers) : []),
    ...(own(input, 'blockingIssues') ? normalizeDeclaredBlockers(input.blockingIssues) : []),
  ];
  const fromHandoff = input.handoff ? blockersFromHandoff(input.handoff) : [];
  const fromParts = blockersFromParts(parts);
  const blockers = new Map(declared.map((blocker) => [blocker.code, blocker]));
  for (const blocker of [...fromHandoff, ...fromParts]) {
    blockers.set(blocker.code, { ...blockers.get(blocker.code), ...blocker, resolved: false, mandatory: true });
  }
  return normalizeBlockers([...blockers.values()]);
}

function timestamp(options = {}, fallback = () => new Date().toISOString()) {
  const value = options.now ? options.now() : fallback();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function packageIdFor(input, parts) {
  const id = input.packageId || input.id || input.handoff?.handoffId;
  if (id) {
    const normalized = String(id).trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 160);
    if (normalized) return normalized;
  }
  return `hrp_${hashHumanResearchValue({ studyId: input.studyId || null, parts }).slice(0, 24)}`;
}

function syncPackageFields(record) {
  const parts = Object.fromEntries(HUMAN_RESEARCH_PACKAGE_PARTS.map((part) => [part, record[part] ?? null]));
  const blockersByCode = new Map(normalizeBlockers(record.blockers || []).map((blocker) => [blocker.code, blocker]));
  for (const inferred of blockersFromParts(parts)) {
    const existing = blockersByCode.get(inferred.code);
    blockersByCode.set(inferred.code, { ...inferred, ...existing, mandatory: true });
  }
  const blockers = normalizeBlockers([...blockersByCode.values()]);
  const packageHashes = withHashAliases(humanResearchPackageHashes(parts));
  const next = {
    ...record,
    blockers,
    blockingIssues: blockerIssues(blockers),
    packageHashes,
    hashes: packageHashes,
  };
  if (next.lineage) {
    next.lineage = {
      ...next.lineage,
      version: next.version,
      updatedAt: next.updatedAt,
      payloadHash: packageHashes.package,
    };
  }
  return next;
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString() === value;
}

function validateBlockerResolutions(record, blockers) {
  for (const blocker of blockers) {
    if (!blocker.resolved) continue;
    const resolution = blocker.resolution;
    if (!resolution || !resolution.actor || !isCanonicalTimestamp(resolution.resolvedAt)) {
      fail('INVALID_PACKAGE', `Resolved blocker ${blocker.code} requires an actor and canonical resolution timestamp.`);
    }
    if (!Number.isInteger(resolution.version) || resolution.version < 2 || resolution.version > record.version) {
      fail('INVALID_PACKAGE', `Resolved blocker ${blocker.code} has an invalid lifecycle version.`);
    }
    if (resolution.evidenceHash !== hashHumanResearchValue(resolution.evidence)) {
      fail('TAMPERED_PACKAGE', `Resolved blocker ${blocker.code} evidence does not match its hash.`);
    }
    const event = (record.transitionHistory || []).find((candidate) => candidate.event === 'BLOCKER_RESOLVED'
      && candidate.blockerCode === blocker.code
      && candidate.version === resolution.version
      && candidate.at === resolution.resolvedAt
      && candidate.actor === resolution.actor
      && candidate.evidenceHash === resolution.evidenceHash
      && hashHumanResearchValue(candidate.evidence) === resolution.evidenceHash);
    if (!event) fail('TAMPERED_PACKAGE', `Resolved blocker ${blocker.code} is not backed by a lifecycle resolution event.`);
  }
}

function validateInferredBlockers(record, blockers) {
  const byCode = new Map(blockers.map((blocker) => [blocker.code, blocker]));
  for (const inferred of blockersFromParts(record)) {
    const stored = byCode.get(inferred.code);
    if (!stored || stored.mandatory !== true) fail('TAMPERED_PACKAGE', `Mandatory lifecycle blocker ${inferred.code} is missing or mutable.`);
  }
}

function validateApproval(record) {
  const approval = record.approval;
  if (!approval || !String(approval.actor || '').trim() || !isCanonicalTimestamp(approval.approvedAt)) {
    fail('INVALID_PACKAGE', 'Approved packages require an attributed approval with a canonical timestamp.');
  }
  if (!Number.isInteger(approval.version) || approval.version < 2 || approval.version > record.version) {
    fail('INVALID_PACKAGE', 'Approved package approval version is invalid.');
  }
  if (JSON.stringify(approval.packageHashes) !== JSON.stringify(record.packageHashes)) {
    fail('TAMPERED_PACKAGE', 'Approved package hashes do not match the current package parts.');
  }
  const event = (record.transitionHistory || []).find((candidate) => candidate.event === 'TRANSITION'
    && candidate.from === 'RESEARCHER_REVIEW'
    && candidate.to === 'APPROVED_FOR_FIELDING'
    && candidate.version === approval.version
    && candidate.actor === approval.actor
    && isCanonicalTimestamp(candidate.at));
  if (!event) fail('TAMPERED_PACKAGE', 'Approval is not backed by an attributed lifecycle transition.');
}

export function validateHumanResearchPackage(record, options = {}) {
  if (!record || typeof record !== 'object') fail('INVALID_PACKAGE', 'Human-research package must be an object.');
  if (record.contractVersion !== HUMAN_RESEARCH_LIFECYCLE_VERSION) fail('INVALID_PACKAGE', 'Unsupported human-research lifecycle contract version.');
  if (record.packageVersion !== HUMAN_RESEARCH_PACKAGE_VERSION) fail('INVALID_PACKAGE', 'Unsupported human-research package version.');
  if (record.synthetic !== false || record.observedHumanResponse !== false) fail('INVALID_PACKAGE', 'Human-research packages cannot be synthetic or observed-response records.');
  if (!String(record.packageId || '').trim()) fail('INVALID_PACKAGE', 'Human-research package ID is required.');
  if (!HUMAN_RESEARCH_LIFECYCLE_STATES.includes(record.status)) fail('INVALID_PACKAGE', `Unknown human-research package status: ${record.status}.`);
  if (!Number.isInteger(record.version) || record.version < 1) fail('INVALID_PACKAGE', 'Human-research package version must be a positive integer.');
  const expectedHashes = withHashAliases(humanResearchPackageHashes(record));
  for (const part of HUMAN_RESEARCH_PACKAGE_PARTS) {
    if (record.packageHashes?.[part] !== expectedHashes[part]) fail('TAMPERED_PACKAGE', `Package hash mismatch for ${part}.`);
  }
  if (record.packageHashes?.package !== expectedHashes.package) fail('TAMPERED_PACKAGE', 'Package hash mismatch for package.');
  if (record.packageHashes?.packageHash !== expectedHashes.packageHash) fail('TAMPERED_PACKAGE', 'Package hash mismatch for package.');
  if (record.hashes && JSON.stringify(record.hashes) !== JSON.stringify(record.packageHashes)) fail('TAMPERED_PACKAGE', 'Package hash aliases do not match.');
  if (record.lineage) {
    try { lineageEnvelopeSchema.parse(record.lineage); } catch { fail('INVALID_PACKAGE', 'Human-research package lineage is invalid.'); }
    if (record.lineage.recordId !== record.packageId || record.lineage.version !== record.version || record.lineage.payloadHash !== record.packageHashes.package) fail('TAMPERED_PACKAGE', 'Human-research package lineage does not match its version or hash.');
  }
  const blockers = normalizeBlockers(record.blockers || []);
  if (JSON.stringify(blockers) !== JSON.stringify(record.blockers || [])) fail('INVALID_PACKAGE', 'Human-research blockers are not normalized.');
  if (JSON.stringify(record.blockingIssues || []) !== JSON.stringify(blockerIssues(blockers))) fail('TAMPERED_PACKAGE', 'Package blocking issues do not match its blockers.');
  validateInferredBlockers(record, blockers);
  validateBlockerResolutions(record, blockers);
  if (statusIndex(record.status) >= statusIndex('APPROVED_FOR_FIELDING')) {
    if (activeBlockers(blockers).length) fail('APPROVAL_BLOCKED', `Approval has unresolved blockers: ${blockerIssues(blockers).join(', ')}.`);
    validateApproval(record);
  }
  if (!options.skipClone) return clone(record);
  return record;
}

export const parseHumanResearchPackage = validateHumanResearchPackage;

export function toHumanResearchStorageRecord(packageRecord) {
  const record = validateHumanResearchPackage(packageRecord);
  return { id: record.packageId, kind: 'HUMAN_RESEARCH_PACKAGE', version: record.version, data: record, lineage: record.lineage };
}

export function fromHumanResearchStorageRecord(storageRecord) {
  if (!storageRecord || storageRecord.kind !== 'HUMAN_RESEARCH_PACKAGE') fail('INVALID_PACKAGE', 'Storage record is not a human-research package.');
  const record = validateHumanResearchPackage(storageRecord.data);
  if (storageRecord.id !== record.packageId || storageRecord.version !== record.version) fail('TAMPERED_PACKAGE', 'Stored human-research package identity or version does not match.');
  return record;
}

export function createHumanResearchPackage(input = {}, options = {}) {
  if (!input || typeof input !== 'object') fail('INVALID_PACKAGE', 'Human-research package input must be an object.');
  if (input.status && input.status !== 'DRAFT') fail('INVALID_PACKAGE', 'New human-research packages must start in DRAFT.');
  const parts = resolveParts(input);
  const blockers = resolveBlockers(input);
  const now = timestamp(options);
  const packageId = packageIdFor(input, parts);
  const record = syncPackageFields({
    contractVersion: HUMAN_RESEARCH_LIFECYCLE_VERSION,
    packageVersion: HUMAN_RESEARCH_PACKAGE_VERSION,
    packageId,
    studyId: input.studyId || input.handoff?.sourceStudy?.studyId || null,
    version: 1,
    status: 'DRAFT',
    createdAt: input.createdAt || now,
    updatedAt: now,
    ...parts,
    blockers,
    approval: null,
    approvalInvalidated: null,
    transitionHistory: [{ version: 1, from: null, to: 'DRAFT', event: 'CREATED', at: now }],
    synthetic: false,
    observedHumanResponse: false,
  });
  record.lineage = createLineageEnvelope({
    recordType: 'HUMAN_RESEARCH_PACKAGE',
    recordId: packageId,
    classification: 'USER_PROVIDED',
    studyId: record.studyId ? packageIdFor({ packageId: record.studyId }, parts) : null,
    runId: null,
    payloadHash: record.packageHashes.package,
    synthetic: false,
    observedHumanResponse: false,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    retention: input.retention || { mode: 'SESSION' },
  });
  return validateHumanResearchPackage(record);
}

function transitionOptions(nextStatus, options) {
  if (typeof nextStatus === 'object' && nextStatus !== null) {
    return { ...nextStatus, nextStatus: nextStatus.nextStatus || nextStatus.status };
  }
  return { ...(options || {}), nextStatus };
}

function requireExpectedVersion(record, expectedVersion) {
  if (!Number.isInteger(expectedVersion)) fail('EXPECTED_VERSION_REQUIRED', 'An expected package version is required for optimistic updates.');
  if (record.version !== expectedVersion) fail('VERSION_CONFLICT', `Human-research package version conflict: expected ${expectedVersion}, current ${record.version}.`);
}

function actorFor(options) {
  return String(options.actor || options.approvedBy || options.reviewer || '').trim();
}

export function transitionHumanResearchPackage(record, nextStatus, options = {}) {
  const parsed = validateHumanResearchPackage(record);
  const resolved = transitionOptions(nextStatus, options);
  const target = resolved.nextStatus;
  requireExpectedVersion(parsed, resolved.expectedVersion);
  if (!HUMAN_RESEARCH_LIFECYCLE_STATES.includes(target)) fail('INVALID_TRANSITION', `Unknown human-research package status: ${target}.`);
  const expectedPrevious = HUMAN_RESEARCH_LIFECYCLE_STATES[statusIndex(parsed.status) + 1];
  if (target !== expectedPrevious) fail('INVALID_TRANSITION', `Cannot transition ${parsed.status} to ${target}; the next state is ${expectedPrevious || 'none'}.`);
  const now = timestamp(resolved);
  const next = clone(parsed);
  next.version += 1;
  next.status = target;
  next.updatedAt = now;
  if (target === 'APPROVED_FOR_FIELDING') {
    const actor = actorFor(resolved);
    if (!actor) fail('APPROVAL_ACTOR_REQUIRED', 'Approval requires a named researcher or authorized reviewer.');
    const blockers = activeBlockers(next.blockers);
    if (blockers.length) fail('APPROVAL_BLOCKED', `Approval has unresolved blockers: ${blockers.map((item) => item.code).join(', ')}.`, blockers);
    next.approval = {
      actor,
      approvedAt: resolved.approvedAt || now,
      version: next.version,
      packageHashes: clone(next.packageHashes),
      attestation: resolved.attestation || null,
    };
  }
  if (target === 'FIELDING') next.fielding = { startedAt: resolved.startedAt || now, actor: actorFor(resolved) || null };
  if (target === 'CLOSED') next.closed = { closedAt: resolved.closedAt || now, actor: actorFor(resolved) || null };
  if (target === 'ANALYZED') next.analysisCompleted = { completedAt: resolved.completedAt || now, actor: actorFor(resolved) || null };
  next.transitionHistory = [...(next.transitionHistory || []), { version: next.version, from: parsed.status, to: target, event: 'TRANSITION', at: now, actor: actorFor(resolved) || null }];
  return validateHumanResearchPackage(syncPackageFields(next));
}

function editOptions(patchOrOptions, maybeOptions) {
  if (patchOrOptions && own(patchOrOptions, 'patch')) return { ...patchOrOptions };
  return { ...(maybeOptions || {}), patch: patchOrOptions };
}

const EDITABLE_PACKAGE_KEYS = new Set([
  ...HUMAN_RESEARCH_PACKAGE_PARTS,
  'screeningPlan',
  'quotaPlan',
  'samplePlan',
  'incidencePlan',
  'recruitmentPlan',
  'analysisPlan',
  'sourceStudy',
]);
const QUOTA_SUBPLAN_KEYS = ['quotaPlan', 'samplePlan', 'incidencePlan'];
const PACKAGE_PART_ALIASES = {
  screeningPlan: 'screener',
  recruitmentPlan: 'recruitment',
  analysisPlan: 'analysis',
  sourceStudy: 'sourceLineage',
};

function compositeQuotaForEdit(quota) {
  const quotaObject = objectPart(quota);
  if (QUOTA_SUBPLAN_KEYS.some((key) => own(quotaObject, key))) return clone(quotaObject);
  return { quotaPlan: quota ?? null, samplePlan: null, incidencePlan: null };
}

export function editHumanResearchPackage(record, patchOrOptions, maybeOptions) {
  const parsed = validateHumanResearchPackage(record);
  const options = editOptions(patchOrOptions, maybeOptions);
  requireExpectedVersion(parsed, options.expectedVersion);
  if (!options.patch || typeof options.patch !== 'object' || Array.isArray(options.patch)) fail('INVALID_EDIT', 'A human-research package edit requires a patch object.');
  const forbidden = ['contractVersion', 'packageVersion', 'packageId', 'version', 'status', 'packageHashes', 'approval', 'transitionHistory'];
  if (forbidden.some((key) => own(options.patch, key))) fail('INVALID_EDIT', 'Package identity, status, hashes, and approval are controlled by lifecycle operations.');
  if (own(options.patch, 'blockers') || own(options.patch, 'blockingIssues')) fail('INVALID_EDIT', 'Blockers can only be resolved through lifecycle blocker operations.');
  const unknownKeys = Object.keys(options.patch).filter((key) => !EDITABLE_PACKAGE_KEYS.has(key));
  if (unknownKeys.length) fail('INVALID_EDIT', `Unknown human-research package edit fields: ${unknownKeys.join(', ')}.`);
  for (const [alias, part] of Object.entries(PACKAGE_PART_ALIASES)) {
    if (own(options.patch, alias) && own(options.patch, part)) fail('INVALID_EDIT', `Package edit cannot include both ${part} and ${alias}.`);
  }
  if (own(options.patch, 'quota') && QUOTA_SUBPLAN_KEYS.some((key) => own(options.patch, key))) fail('INVALID_EDIT', 'Package edit cannot replace quota and edit a quota sub-plan in the same operation.');
  const next = clone(parsed);
  const patch = clone(options.patch);
  for (const part of HUMAN_RESEARCH_PACKAGE_PARTS) if (own(patch, part)) next[part] = patch[part];
  for (const [alias, part] of Object.entries(PACKAGE_PART_ALIASES)) if (own(patch, alias)) next[part] = patch[alias];
  if (QUOTA_SUBPLAN_KEYS.some((key) => own(patch, key))) {
    const quota = compositeQuotaForEdit(next.quota);
    for (const key of QUOTA_SUBPLAN_KEYS) if (own(patch, key)) quota[key] = patch[key];
    next.quota = quota;
  }
  const reopenedBlockers = next.blockers.filter((blocker) => blocker.resolved).map((blocker) => blocker.code);
  next.blockers = next.blockers.map((blocker) => {
    if (!blocker.resolved) return blocker;
    const { resolution: _staleResolution, ...reopened } = blocker;
    return { ...reopened, resolved: false };
  });
  const now = timestamp(options);
  const wasApproved = statusIndex(parsed.status) >= statusIndex('APPROVED_FOR_FIELDING');
  next.version += 1;
  next.updatedAt = now;
  if (wasApproved) {
    next.status = 'RESEARCHER_REVIEW';
    next.approvalInvalidated = {
      at: now,
      previousVersion: parsed.version,
      reason: String(options.reason || 'Post-approval package edit requires renewed researcher review.'),
      editedBy: actorFor(options) || null,
    };
    next.approval = null;
  }
  next.transitionHistory = [...(next.transitionHistory || []), {
    version: next.version,
    from: parsed.status,
    to: next.status,
    event: wasApproved ? 'EDIT_INVALIDATED_APPROVAL' : 'EDIT',
    at: now,
    actor: actorFor(options) || null,
    reason: String(options.reason || 'Package edited.'),
    reopenedBlockers,
  }];
  return validateHumanResearchPackage(syncPackageFields(next));
}

export function resolveHumanResearchBlocker(record, code, options = {}) {
  const parsed = validateHumanResearchPackage(record);
  requireExpectedVersion(parsed, options.expectedVersion);
  const targetCode = normalizedCode(code);
  const target = parsed.blockers.find((blocker) => blocker.code === targetCode);
  if (!target) fail('BLOCKER_NOT_FOUND', `Unknown human-research blocker: ${targetCode}.`);
  if (target.resolved) fail('BLOCKER_ALREADY_RESOLVED', `Human-research blocker ${targetCode} is already resolved.`);
  const actor = actorFor(options);
  if (!actor) fail('BLOCKER_RESOLUTION_ACTOR_REQUIRED', 'Blocker resolution requires a named researcher or authorized reviewer.');
  const evidence = normalizedResolutionEvidence(options.evidence);
  const now = timestamp(options);
  const evidenceHash = hashHumanResearchValue(evidence);
  const next = clone(parsed);
  next.version += 1;
  next.updatedAt = now;
  const blockers = next.blockers.map((blocker) => blocker.code === targetCode ? {
    ...blocker,
    resolved: true,
    resolution: {
      actor,
      resolvedAt: now,
      evidence,
      evidenceHash,
      version: next.version,
    },
  } : blocker);
  if (!blockers.some((blocker) => blocker.code === targetCode)) fail('BLOCKER_NOT_FOUND', `Unknown human-research blocker: ${targetCode}.`);
  next.blockers = blockers;
  next.transitionHistory = [...(next.transitionHistory || []), {
    version: next.version,
    from: parsed.status,
    to: parsed.status,
    event: 'BLOCKER_RESOLVED',
    at: now,
    actor,
    blockerCode: targetCode,
    evidence: clone(evidence),
    evidenceHash,
  }];
  return validateHumanResearchPackage(syncPackageFields(next));
}

export function createHumanResearchPackageStore(options = {}) {
  const records = new Map();
  const now = options.now || (() => new Date().toISOString());
  const storage = options.storage || null;
  const read = (id) => {
    const record = records.get(id);
    if (!record) fail('NOT_FOUND', `Human-research package ${id} was not found.`);
    return clone(record);
  };
  const store = {
    async createPackage(input) {
      const record = createHumanResearchPackage(input, { now });
      if (storage) {
        try { await storage.create(toHumanResearchStorageRecord(record)); } catch (error) { fail('CONFLICT', error?.message || `Human-research package ${record.packageId} already exists.`); }
      } else {
        if (records.has(record.packageId)) fail('CONFLICT', `Human-research package ${record.packageId} already exists.`);
        records.set(record.packageId, clone(record));
      }
      return clone(record);
    },
    async getPackage(id) {
      if (storage) {
        const stored = await storage.get(id);
        if (!stored) fail('NOT_FOUND', `Human-research package ${id} was not found.`);
        return fromHumanResearchStorageRecord(stored);
      }
      return read(id);
    },
    async transitionPackage(id, nextStatus, transition) {
      const current = await store.getPackage(id);
      const next = transitionHumanResearchPackage(current, nextStatus, transition);
      if (storage) await storage.update(id, current.version, { data: next, lineage: next.lineage });
      else records.set(id, clone(next));
      return clone(next);
    },
    async editPackage(id, patchOrOptions, maybeOptions) {
      const current = await store.getPackage(id);
      const next = editHumanResearchPackage(current, patchOrOptions, maybeOptions);
      if (storage) await storage.update(id, current.version, { data: next, lineage: next.lineage });
      else records.set(id, clone(next));
      return clone(next);
    },
    async listPackages() {
      if (storage) return (await storage.list({ kind: 'HUMAN_RESEARCH_PACKAGE' })).map(fromHumanResearchStorageRecord);
      return [...records.values()].map(clone);
    },
  };
  store.create = store.createPackage;
  store.get = store.getPackage;
  store.transition = store.transitionPackage;
  store.edit = store.editPackage;
  store.list = store.listPackages;
  return store;
}

export const createResearchPackage = createHumanResearchPackage;
export const transitionResearchPackage = transitionHumanResearchPackage;
export const editResearchPackage = editHumanResearchPackage;
