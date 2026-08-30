import { createHash } from 'node:crypto';
import { isSafePublicUrl } from './public-url.js';

export const HUMAN_RESEARCH_PROVIDER_ADAPTER_VERSION = 'human-research-provider-adapter-v1';
export const PROVIDER_ADAPTER_STATES = Object.freeze(['LINK_ONLY_NOT_INTEGRATED', 'DRY_RUN']);
export const PROVIDER_ADAPTER_MODES = PROVIDER_ADAPTER_STATES;

const clone = (value) => structuredClone(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const identifier = (value, fallback = 'provider') => String(value || fallback).trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100) || fallback;

function canonical(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function hash(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }

export class HumanResearchProviderAdapterError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'HumanResearchProviderAdapterError';
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => { throw new HumanResearchProviderAdapterError(code, message, details); };

const FORBIDDEN_KEYS = /(?:credential|api[-_]?key|secret|password|authorization|bearer|token|webhook|payment|billing|card|contact|email|phone|recruit|invite|callback|endpoint|url.?hook)/i;

function assertBoundary(value, path = 'request') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) fail('BOUNDARY_VIOLATION', `${path}.${key} is a credential, network, contact, payment, or integration field outside the local provider-adapter boundary.`);
    if (typeof child === 'function') fail('BOUNDARY_VIOLATION', `${path}.${key} cannot be a callable integration.`);
    if (child && typeof child === 'object') assertBoundary(child, `${path}.${key}`);
  }
}

function publicLink(value) {
  if (value == null) return null;
  try {
    const parsed = new URL(String(value));
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !isSafePublicUrl(parsed.toString())) fail('INVALID_PROVIDER', 'Provider links must be public http(s) links without credentials.');
    return parsed.toString();
  } catch {
    fail('INVALID_PROVIDER', 'Provider links must be public http(s) links.');
  }
}

function safeRequest(request = {}) {
  assertBoundary(request);
  const source = request && typeof request === 'object' ? request : {};
  return {
    market: source.market == null ? null : String(source.market),
    countryCode: source.countryCode == null ? null : String(source.countryCode),
    language: source.language == null ? null : String(source.language),
    targetCompletes: Number.isFinite(Number(source.targetCompletes)) ? Number(source.targetCompletes) : null,
    targetAudience: source.targetAudience == null ? null : String(source.targetAudience),
    screenerQuestionCount: Array.isArray(source.screener) ? source.screener.length : Array.isArray(source.questions) ? source.questions.length : null,
  };
}

function base(adapter, operation, request = {}) {
  return {
    contractVersion: HUMAN_RESEARCH_PROVIDER_ADAPTER_VERSION,
    providerId: adapter.providerId,
    providerName: adapter.name,
    relationship: adapter.relationship,
    mode: adapter.mode,
    state: adapter.mode,
    operation,
    networkAccessed: false,
    credentialsUsed: false,
    paymentEnabled: false,
    contacted: false,
    requestHash: hash(request),
  };
}

function aggregateWithoutRawText(value) {
  if (Array.isArray(value)) return value.map(aggregateWithoutRawText);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:raw.?response|raw.?text|verbatim|participant.?text|answer|comment|quote|open.?text|response.?text|^text$)/i.test(key))
    .map(([key, child]) => [key, aggregateWithoutRawText(child)]));
}

function questionItems(request = {}) {
  const source = Array.isArray(request.screener) ? request.screener : Array.isArray(request.questions) ? request.questions : request.screener?.questions;
  return Array.isArray(source) ? source : [];
}

function screenerMapping(adapter, request = {}) {
  assertBoundary(request);
  const questions = questionItems(request);
  const requestedMappings = request.mapping || request.fieldMapping || {};
  const mapping = questions.map((question, index) => {
    const questionId = identifier(question.questionId || question.id, `question_${index + 1}`);
    const providerField = requestedMappings[questionId] == null ? null : identifier(requestedMappings[questionId]);
    return {
      questionId,
      questionType: String(question.type || 'UNKNOWN').toUpperCase(),
      providerField,
      mappingStatus: providerField ? 'SUPPLIED_FOR_REVIEW' : 'UNMAPPED_REQUIRES_PROVIDER_CONFIRMATION',
      supported: providerField != null,
      optionsCount: Array.isArray(question.options) ? question.options.length : null,
    };
  });
  return {
    ...base(adapter, 'SCREENER_MAPPING', request),
    status: 'DRY_RUN',
    mappingStatus: 'REQUIRES_RESEARCHER_PROVIDER_REVIEW',
    questionCount: questions.length,
    mappedCount: mapping.filter((item) => item.supported).length,
    unmappedCount: mapping.filter((item) => !item.supported).length,
    mapping,
    disclosure: 'Screener mapping is a local proposal only; no provider schema was fetched or validated.',
  };
}

function createAdapter(input = {}) {
  if (!input || typeof input !== 'object') fail('INVALID_PROVIDER', 'Provider adapter configuration must be an object.');
  assertBoundary(input);
  const requestedState = input.state || input.mode || input.relationship || input.status;
  if (requestedState && !PROVIDER_ADAPTER_STATES.includes(String(requestedState).toUpperCase())) fail('BOUNDARY_VIOLATION', 'Provider adapters may only be LINK_ONLY_NOT_INTEGRATED or DRY_RUN.');
  const providerId = identifier(input.providerId || input.id, 'provider');
  const name = String(input.name || input.providerName || providerId).trim();
  if (!name) fail('INVALID_PROVIDER', 'Provider adapter name is required.');
  const link = publicLink(input.link || input.publicLink || null);
  const adapter = {
    contractVersion: HUMAN_RESEARCH_PROVIDER_ADAPTER_VERSION,
    providerId,
    name,
    link,
    relationship: 'LINK_ONLY_NOT_INTEGRATED',
    mode: 'DRY_RUN',
    networkAccessed: false,
    credentialsUsed: false,
    paymentEnabled: false,
    contacted: false,
  };
  adapter.feasibility = (request = {}) => {
    const safe = safeRequest(request);
    return {
      ...base(adapter, 'FEASIBILITY', safe),
      status: 'UNCONFIRMED',
      feasible: null,
      incidence: null,
      result: null,
      request: safe,
      disclosure: 'Provider feasibility has not been requested; confirm audience availability, incidence, timing, and terms directly with the researcher and provider.',
    };
  };
  adapter.quote = (request = {}) => {
    const safe = safeRequest(request);
    return {
      ...base(adapter, 'QUOTE', safe),
      status: 'UNQUOTED',
      amount: null,
      currency: null,
      unit: null,
      quote: null,
      estimatedCost: null,
      request: safe,
      disclosure: 'No price or payment operation is available in this adapter boundary.',
    };
  };
  adapter.screenerMapping = (request = {}) => screenerMapping(adapter, request);
  adapter.mapScreener = adapter.screenerMapping;
  adapter.screener = adapter.screenerMapping;
  adapter.fieldStatus = (request = {}) => {
    const safe = safeRequest(request);
    return {
      ...base(adapter, 'FIELD_STATUS', safe),
      status: 'DRY_RUN',
      fieldingStatus: 'NOT_CONNECTED',
      providerStatus: 'NOT_REQUESTED',
      requestedAt: null,
      startedAt: null,
      completedAt: null,
      request: safe,
      disclosure: 'No fielding request, webhook, recruitment contact, or provider status lookup was made.',
    };
  };
  adapter.status = adapter.fieldStatus;
  adapter.completes = (inputCompletes = {}) => {
    assertBoundary(inputCompletes);
    const requested = Number(inputCompletes.requested ?? inputCompletes.targetCompletes);
    const completed = Number(inputCompletes.completed ?? inputCompletes.completes);
    const safeRequested = Number.isFinite(requested) && requested >= 0 ? requested : null;
    const safeCompleted = Number.isFinite(completed) && completed >= 0 ? completed : null;
    const supplied = { requested: safeRequested, completed: safeCompleted };
    return {
      ...base(adapter, 'COMPLETES', supplied),
      status: 'DRY_RUN',
      completesStatus: 'CLIENT_SUPPLIED_UNVERIFIED',
      requested: safeRequested,
      completed: safeCompleted,
      requestedCompletes: safeRequested,
      achievedCompletes: safeCompleted,
      providerConfirmed: false,
      disclosure: 'Completes are a client-supplied planning value, not a provider-confirmed fielding result.',
    };
  };
  adapter.exportResults = (result = {}) => {
    assertBoundary(result);
    if (result.synthetic === true || result.observedHumanResponse === false) fail('NAMESPACE_VIOLATION', 'Synthetic results cannot be exported through the observed-human provider boundary.');
    if (result.namespace && !/^observed[-_]human$/i.test(String(result.namespace))) fail('NAMESPACE_VIOLATION', 'Only the observed-human namespace can be exported through this adapter boundary.');
      const aggregate = result.aggregates || result.distributions || null;
    const safeAggregate = aggregate == null ? null : aggregateWithoutRawText(aggregate);
    return {
      ...base(adapter, 'RESULT_EXPORT', { namespace: result.namespace || OBSERVED_NAMESPACE, bases: result.bases || null, aggregateHash: hash(safeAggregate) }),
      status: 'DRY_RUN',
      exportStatus: 'NOT_EXPORTED',
      namespace: result.namespace || OBSERVED_NAMESPACE,
      aggregate: safeAggregate,
      bases: result.bases ? clone(result.bases) : null,
      exclusions: result.exclusions ? aggregateWithoutRawText(result.exclusions) : null,
      qualityDiagnostics: result.qualityDiagnostics ? aggregateWithoutRawText(result.qualityDiagnostics) : null,
      rawResponses: undefined,
      rawText: undefined,
      openText: undefined,
      networkAccessed: false,
      disclosure: 'Aggregate shape prepared locally only; raw responses and open text are never exported by this adapter.',
    };
  };
  adapter.export = adapter.exportResults;
  adapter.resultExport = adapter.exportResults;
  adapter.feasibilityCheck = adapter.feasibility;
  adapter.quoteCheck = adapter.quote;
  return Object.freeze(adapter);
}

const OBSERVED_NAMESPACE = 'observed-human';

export function createHumanResearchProviderAdapter(input = {}) { return createAdapter(input); }
export const createProviderAdapter = createHumanResearchProviderAdapter;

export function dryRunProviderFeasibility(adapterOrConfig, request = {}) {
  const adapter = typeof adapterOrConfig?.feasibility === 'function' ? adapterOrConfig : createAdapter(adapterOrConfig);
  return adapter.feasibility(request);
}

export function dryRunProviderQuote(adapterOrConfig, request = {}) {
  const adapter = typeof adapterOrConfig?.quote === 'function' ? adapterOrConfig : createAdapter(adapterOrConfig);
  return adapter.quote(request);
}

export function mapProviderScreener(adapterOrConfig, request = {}) {
  const adapter = typeof adapterOrConfig?.screenerMapping === 'function' ? adapterOrConfig : createAdapter(adapterOrConfig);
  return adapter.screenerMapping(request);
}

export function dryRunProviderFieldStatus(adapterOrConfig, request = {}) {
  const adapter = typeof adapterOrConfig?.fieldStatus === 'function' ? adapterOrConfig : createAdapter(adapterOrConfig);
  return adapter.fieldStatus(request);
}

export function dryRunProviderCompletes(adapterOrConfig, request = {}) {
  const adapter = typeof adapterOrConfig?.completes === 'function' ? adapterOrConfig : createAdapter(adapterOrConfig);
  return adapter.completes(request);
}

export function dryRunProviderResultExport(adapterOrConfig, request = {}) {
  const adapter = typeof adapterOrConfig?.exportResults === 'function' ? adapterOrConfig : createAdapter(adapterOrConfig);
  return adapter.exportResults(request);
}

export const getProviderFeasibility = dryRunProviderFeasibility;
export const getProviderQuote = dryRunProviderQuote;
export const getProviderFieldStatus = dryRunProviderFieldStatus;
export const getProviderCompletes = dryRunProviderCompletes;
export const exportProviderResults = dryRunProviderResultExport;

export const planProviderFeasibility = dryRunProviderFeasibility;
export const planProviderQuote = dryRunProviderQuote;
export const mapScreenerToProvider = mapProviderScreener;
export const planProviderFieldStatus = dryRunProviderFieldStatus;
export const planProviderCompletes = dryRunProviderCompletes;
export const buildProviderResultExport = dryRunProviderResultExport;
