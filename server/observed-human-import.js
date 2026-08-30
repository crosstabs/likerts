import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLineageEnvelope } from './privacy-contract.js';

export const OBSERVED_HUMAN_IMPORT_VERSION = 'observed-human-import-v1';
export const OBSERVED_HUMAN_NAMESPACE = 'observed-human';
export const OBSERVED_HUMAN_DATA_CLASSIFICATION = 'OBSERVED_HUMAN_DATA';
export const OBSERVED_HUMAN_IMPORT_MODES = Object.freeze(['LOCAL_ONLY']);
export const OBSERVED_HUMAN_IMPORT_LIMITS = Object.freeze({
  maxSourceBytes: 10_000_000,
  maxRows: 100_000,
  maxColumns: 500,
  maxCellCharacters: 100_000,
});

const clone = (value) => structuredClone(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const missingTokens = new Set(['', 'NA', 'N/A', 'NULL', 'NONE', 'MISSING', '.', '-']);

function canonical(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function hashObservedHumanValue(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(canonical(value));
  return createHash('sha256').update(serialized).digest('hex');
}

export class ObservedHumanImportError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ObservedHumanImportError';
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => { throw new ObservedHumanImportError(code, message, details); };

function localFilePath(value, label) {
  if (value instanceof URL) {
    if (value.protocol !== 'file:') fail('LOCAL_ONLY', `${label} must be a local file URL.`);
    return fileURLToPath(value);
  }
  if (typeof value !== 'string' || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) fail('LOCAL_ONLY', `${label} must be a local file path.`);
  return path.resolve(value);
}

function parseCsv(source) {
  const text = String(source).replace(/^\uFEFF/, '');
  const rows = [];
  let current = '';
  let row = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(current);
      current = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(current);
      current = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else {
      current += character;
    }
  }
  if (quoted) fail('INVALID_SOURCE', 'CSV contains an unterminated quoted field.');
  if (current !== '' || row.length) {
    row.push(current);
    if (row.some((value) => value !== '')) rows.push(row);
  }
  if (!rows.length) fail('INVALID_SOURCE', 'CSV source is empty.');
  const columns = rows.shift().map((value) => String(value).trim());
  if (columns.some((value) => !value)) fail('INVALID_SOURCE', 'CSV headers must not be empty.');
  if (new Set(columns).size !== columns.length) fail('INVALID_SOURCE', 'CSV headers must be unique.');
  return rows.map((values, index) => {
    if (values.length !== columns.length) fail('INVALID_SOURCE', `CSV row ${index + 2} has an unexpected number of fields.`);
    return Object.fromEntries(columns.map((column, columnIndex) => [column, values[columnIndex]]));
  });
}

function rowsFromJson(value) {
  let rows = value;
  if (value && !Array.isArray(value) && typeof value === 'object') {
    rows = value.responses ?? value.rows ?? value.data;
  }
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    fail('INVALID_SOURCE', 'JSON observed-response input must be an array of response objects.');
  }
  return rows.map((row) => clone(row));
}

async function readSource(input) {
  const sourcePath = input.sourcePath ?? input.path ?? (input.source instanceof URL ? input.source : null) ?? (input.sourceIsPath ? input.source : null);
  if (sourcePath) {
    const resolved = localFilePath(sourcePath, 'sourcePath');
    const metadata = await stat(resolved);
    if (!metadata.isFile()) fail('INVALID_SOURCE', 'Observed-response sourcePath must identify a local file.');
    if (metadata.size > OBSERVED_HUMAN_IMPORT_LIMITS.maxSourceBytes) fail('SOURCE_TOO_LARGE', `Observed-response sources must not exceed ${OBSERVED_HUMAN_IMPORT_LIMITS.maxSourceBytes} bytes.`);
    const bytes = await readFile(resolved);
    return { text: bytes.toString('utf8'), sourcePath: path.basename(resolved), sourceIsObject: false };
  }
  if (own(input, 'sourceText')) return { text: String(input.sourceText), sourcePath: null, sourceIsObject: false };
  if (own(input, 'source')) {
    if (typeof input.source === 'string' || Buffer.isBuffer(input.source)) return { text: String(input.source), sourcePath: null, sourceIsObject: false };
    return { value: clone(input.source), sourcePath: null, sourceIsObject: true };
  }
  if (own(input, 'responses')) return { value: clone(input.responses), sourcePath: null, sourceIsObject: true };
  fail('INVALID_SOURCE', 'A local CSV/JSON source is required.');
}

function sourceRows(source, format) {
  if (source.sourceIsObject) return { format: 'JSON', rows: rowsFromJson(source.value), sourceBytes: JSON.stringify(canonical(source.value)) };
  const normalizedFormat = String(format || '').toUpperCase() || (/^\s*[\[{]/.test(source.text) ? 'JSON' : 'CSV');
  if (!['CSV', 'JSON'].includes(normalizedFormat)) fail('INVALID_SOURCE', 'Observed-response format must be CSV or JSON.');
  if (normalizedFormat === 'CSV') return { format: normalizedFormat, rows: parseCsv(source.text), sourceBytes: source.text };
  let value;
  try { value = JSON.parse(source.text); } catch { fail('INVALID_SOURCE', 'JSON observed-response input is invalid.'); }
  return { format: normalizedFormat, rows: rowsFromJson(value), sourceBytes: source.text };
}

function normalizedField(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

const DIRECT_IDENTIFIER_PATTERN = /(?:email|e_mail|mail|phone|mobile|telephone|tel|full.?name|first.?name|last.?name|given.?name|surname|street|address|postal.?code|zip.?code|ip.?address|device.?id|contact|social.?handle|url)/i;

export function isObservedDirectIdentifierField(field) {
  return DIRECT_IDENTIFIER_PATTERN.test(String(field || ''));
}

function isDirectIdentifierValue(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) || /^\+?[0-9][0-9 ()-]{7,}$/.test(text);
}

function directIdentifierFields(rows) {
  const keys = new Set(rows.flatMap((row) => Object.keys(row)));
  const fields = [...keys].filter((field) => isObservedDirectIdentifierField(field));
  for (const row of rows) {
    for (const [field, value] of Object.entries(row)) {
      if (isDirectIdentifierValue(value) && !fields.includes(field)) fields.push(field);
    }
  }
  return fields.sort();
}

export function redactObservedDirectIdentifiers(input) {
  const rows = Array.isArray(input) ? input : input?.rows;
  if (!Array.isArray(rows)) fail('INVALID_SOURCE', 'Observed-response rows must be an array.');
  return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([field, value]) => !isObservedDirectIdentifierField(field) && !isDirectIdentifierValue(value)).map(([field, value]) => [field, clone(value)])));
}

function identifierPolicy(input) {
  const policy = String(input.identifierPolicy || input.directIdentifierPolicy || 'REJECT').toUpperCase().replace(/^REDACT_DIRECT_IDENTIFIERS$/, 'REDACT');
  if (!['REJECT', 'REDACT'].includes(policy)) fail('INVALID_POLICY', 'Direct-identifier policy must be REJECT or REDACT.');
  return policy;
}

function valueToken(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value).trim().toLowerCase();
}

function isMissing(value, configured = []) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return missingTokens.has(value.trim().toUpperCase()) || configured.map((item) => String(item).trim().toUpperCase()).includes(value.trim().toUpperCase());
  return false;
}

function asArray(value) { return value == null ? [] : Array.isArray(value) ? value : [value]; }

function condition(condition, label = 'rule') {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) fail('INVALID_RULES', `${label} must be a declarative condition object.`);
  const field = String(condition.field || condition.variable || '').trim();
  if (!field) fail('INVALID_RULES', `${label} requires a field.`);
  const operator = String(condition.operator || 'EQUALS').toUpperCase();
  if (!['EQUALS', 'NOT_EQUALS', 'IN', 'NOT_IN', 'GTE', 'GT', 'LTE', 'LT', 'EXISTS', 'NOT_EXISTS', 'MATCHES'].includes(operator)) fail('INVALID_RULES', `${label} uses an unsupported operator.`);
  const values = condition.values ?? condition.value;
  return { field, operator, ...(values !== undefined ? { value: clone(values) } : {}) };
}

function normalizedRules(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_RULES', 'Preregistered rules must be an object.');
  if (Object.values(input).some((value) => typeof value === 'function')) fail('INVALID_RULES', 'Rules must be serializable declarative values.');
  const consentInput = input.consent ?? input.consentRule ?? null;
  const consent = consentInput ? {
    field: String(consentInput.field || 'consent'),
    accepted: asArray(consentInput.accepted ?? consentInput.acceptedValues ?? consentInput.values ?? ['yes', 'true', '1', 'y']).map(valueToken),
  } : null;
  const eligibilityInput = input.eligibility ?? input.eligibilityRules ?? input.screening ?? input.eligibilityCriteria;
  const eligibility = Array.isArray(eligibilityInput)
    ? eligibilityInput.map((item, index) => condition(item, `eligibility[${index}]`))
    : eligibilityInput?.all
      ? asArray(eligibilityInput.all).map((item, index) => condition(item, `eligibility.all[${index}]`))
      : eligibilityInput ? [condition(eligibilityInput, 'eligibility')] : [];
  const qualityInput = input.quality || {};
  const duplicateInput = input.duplicate ?? input.duplicateRule ?? qualityInput.duplicate ?? null;
  const duplicate = duplicateInput ? {
    fields: asArray(duplicateInput.fields ?? duplicateInput.keyFields ?? duplicateInput.keys ?? duplicateInput.fingerprintFields ?? duplicateInput.fingerprintField ?? duplicateInput.field).map((field) => String(field).trim()).filter(Boolean),
    keep: String(duplicateInput.keep || 'FIRST').toUpperCase(),
  } : null;
  if (duplicate && !['FIRST', 'LAST'].includes(duplicate.keep)) fail('INVALID_RULES', 'Duplicate rule keep must be FIRST or LAST.');
  const speedingInput = input.speeding ?? input.speedingRule ?? qualityInput.speeding ?? null;
  const speeding = speedingInput ? {
    durationField: String(speedingInput.durationField || speedingInput.field || 'duration_seconds'),
    minimumSeconds: Number(speedingInput.minimumSeconds ?? speedingInput.minSeconds ?? speedingInput.minimum ?? speedingInput.threshold ?? 0),
    ...(speedingInput.maximumSeconds != null || speedingInput.maxSeconds != null ? { maximumSeconds: Number(speedingInput.maximumSeconds ?? speedingInput.maxSeconds) } : {}),
    missingIsFailure: speedingInput.missingIsFailure === true,
  } : null;
  if (speeding && (!Number.isFinite(speeding.minimumSeconds) || speeding.minimumSeconds < 0 || (speeding.maximumSeconds != null && (!Number.isFinite(speeding.maximumSeconds) || speeding.maximumSeconds < speeding.minimumSeconds)))) fail('INVALID_RULES', 'Speeding thresholds must be finite and ordered.');
  const straightInput = input.straightLine ?? input.straightline ?? input.straightLineRule ?? qualityInput.straightLine ?? null;
  const straightLine = straightInput ? {
    fields: asArray(straightInput.fields ?? straightInput.questionFields).map((field) => String(field).trim()).filter(Boolean),
    minimumAnswered: Number(straightInput.minimumAnswered ?? straightInput.minimumResponses ?? 2),
  } : null;
  if (straightLine && (!straightLine.fields.length || !Number.isInteger(straightLine.minimumAnswered) || straightLine.minimumAnswered < 2)) fail('INVALID_RULES', 'Straight-line rules require at least two question fields.');
  const missingInput = input.missingness ?? input.missingnessRule ?? qualityInput.missingness ?? null;
  const missingness = missingInput ? {
    fields: asArray(missingInput.fields ?? missingInput.questionFields).map((field) => String(field).trim()).filter(Boolean),
    maxMissing: Number(missingInput.maxMissingResponses != null
      ? Number(missingInput.maxMissingResponses) / Math.max(1, asArray(missingInput.fields ?? missingInput.questionFields).length)
      : missingInput.maxMissing ?? missingInput.maxMissingFraction ?? missingInput.maximumFraction ?? 0),
    missingValues: asArray(missingInput.missingValues).map((value) => String(value)),
  } : null;
  if (missingness && (!missingness.fields.length || !Number.isFinite(missingness.maxMissing) || missingness.maxMissing < 0 || missingness.maxMissing > 1)) fail('INVALID_RULES', 'Missingness rules require fields and a fraction between 0 and 1.');
  const exclusionInputs = input.exclusions ?? input.exclusionRules ?? input.exclude ?? [];
  const exclusions = asArray(exclusionInputs).map((item, index) => ({ code: String(item.code || `EXCLUSION_${index + 1}`).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_'), ...condition(item, `exclusions[${index}]`) }));
  const outcomesInput = input.outcomes ?? input.analysis?.outcomes ?? input.analysis?.variables ?? input.primaryOutcome ?? [];
  const outcomes = asArray(outcomesInput).map((item, index) => typeof item === 'string' ? { field: item, label: item, type: 'CATEGORICAL' } : {
    field: String(item.field || item.variable || '').trim(),
    label: String(item.label || item.field || item.variable || `Outcome ${index + 1}`).trim(),
    type: String(item.type || item.kind || 'CATEGORICAL').toUpperCase(),
    ...(item.values || item.options || item.allowedValues ? { values: asArray(item.values ?? item.options ?? item.allowedValues).map((value) => String(value)) } : {}),
  }).filter((item) => item.field);
  return { preregistrationId: String(input.preregistrationId || input.id || 'UNSPECIFIED_PREREGISTRATION'), consent, eligibility, duplicate, speeding, straightLine, missingness, exclusions, outcomes };
}

function matches(row, rule) {
  const value = row[rule.field];
  const expected = rule.value;
  switch (rule.operator) {
    case 'EQUALS': return valueToken(value) === valueToken(expected);
    case 'NOT_EQUALS': return valueToken(value) !== valueToken(expected);
    case 'IN': return asArray(expected).map(valueToken).includes(valueToken(value));
    case 'NOT_IN': return !asArray(expected).map(valueToken).includes(valueToken(value));
    case 'GTE': return Number(value) >= Number(expected);
    case 'GT': return Number(value) > Number(expected);
    case 'LTE': return Number(value) <= Number(expected);
    case 'LT': return Number(value) < Number(expected);
    case 'EXISTS': return !isMissing(value);
    case 'NOT_EXISTS': return isMissing(value);
    case 'MATCHES': return new RegExp(String(expected)).test(String(value ?? ''));
    default: return false;
  }
}

function exclusionCodeMap() { return Object.create(null); }

function addExclusion(counts, code) { counts[code] = (counts[code] || 0) + 1; }

function responseKey(row, fields) {
  return hashObservedHumanValue(fields.map((field) => [field, row[field] ?? null]));
}

function rowQuality(row, rules) {
  const result = { speeding: false, straightLine: false, missingness: false };
  if (rules.speeding) {
    const duration = Number(row[rules.speeding.durationField]);
    result.speeding = !Number.isFinite(duration)
      ? rules.speeding.missingIsFailure
      : duration < rules.speeding.minimumSeconds || (rules.speeding.maximumSeconds != null && duration > rules.speeding.maximumSeconds);
  }
  if (rules.straightLine) {
    const values = rules.straightLine.fields.map((field) => row[field]).filter((value) => !isMissing(value));
    result.straightLine = values.length >= rules.straightLine.minimumAnswered && new Set(values.map(valueToken)).size <= 1;
  }
  if (rules.missingness) {
    const missing = rules.missingness.fields.filter((field) => isMissing(row[field], rules.missingness.missingValues)).length;
    result.missingness = missing / rules.missingness.fields.length > rules.missingness.maxMissing;
  }
  return result;
}

function safeCategory(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = String(value).trim();
  if (!text || text.length > 120 || /[\r\n]/.test(text)) return null;
  return text;
}

function aggregateOutcome(rows, outcome, missingValues = []) {
  const values = rows.map((row) => row[outcome.field]);
  const present = values.filter((value) => !isMissing(value, missingValues));
  const base = present.length;
  const output = { label: outcome.label, type: outcome.type, base, missing: values.length - base };
  if (outcome.type === 'OPEN_TEXT' || outcome.type === 'TEXT' || outcome.type === 'OPEN_END') {
    return { ...output, textResponses: { count: base, rawValuesIncluded: false, storage: 'LOCAL_ONLY' } };
  }
  const declaredValues = asArray(outcome.values ?? outcome.options).map((value) => String(value));
  const counts = new Map();
  for (const value of present) {
    const category = safeCategory(value);
    // Without an explicit code list, whitespace-bearing values are treated as
    // open human text and are never copied into an aggregate/prompt context.
    if (category === null || (!declaredValues.length && /\s/.test(category))) continue;
    if (declaredValues.length && !declaredValues.includes(category)) continue;
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  const categories = [...counts.entries()].map(([value, count]) => ({ value, count, share: base ? count / base : 0 }));
  return { ...output, categories, structuredValuesOnly: true, rawValuesIncluded: false };
}

function promptContext(result) {
  return {
    namespace: OBSERVED_HUMAN_NAMESPACE,
    contractVersion: result.contractVersion,
    bases: clone(result.bases),
    distributions: clone(result.distributions),
    exclusions: clone(result.exclusions),
    qualityDiagnostics: clone(result.qualityDiagnostics),
    disclosure: 'Aggregated observed-human results only. Raw responses and human open text are local and excluded from model prompts.',
    rawResponsesIncluded: false,
    openTextIncluded: false,
  };
}

export function buildObservedHumanPromptContext(result) {
  if (!result || result.namespace !== OBSERVED_HUMAN_NAMESPACE || result.synthetic !== false || result.observedHumanResponse !== true) fail('INVALID_RESULT', 'Only an observed-human aggregate can be converted to prompt-safe context.');
  return promptContext(result);
}

export const observedHumanPromptContext = buildObservedHumanPromptContext;

function safeRecordId(value) {
  const normalized = String(value || 'observed-import').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
  return normalized || 'observed_import';
}

export async function importObservedHumanResponses(rawInput = {}, maybeRules = {}, maybeOptions = {}) {
  const input = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) && !(rawInput instanceof URL) && !Buffer.isBuffer(rawInput)
    ? rawInput
    : { ...maybeOptions, source: rawInput, rules: maybeRules };
  const source = await readSource(input);
  const sourceByteCount = source.sourceIsObject
    ? Buffer.byteLength(JSON.stringify(canonical(source.value)))
    : Buffer.byteLength(source.text || '');
  if (sourceByteCount > OBSERVED_HUMAN_IMPORT_LIMITS.maxSourceBytes) fail('SOURCE_TOO_LARGE', `Observed-response sources must not exceed ${OBSERVED_HUMAN_IMPORT_LIMITS.maxSourceBytes} bytes.`);
  const parsed = sourceRows(source, input.format || input.sourceFormat);
  if (parsed.rows.length > OBSERVED_HUMAN_IMPORT_LIMITS.maxRows) fail('SOURCE_TOO_LARGE', `Observed-response sources must not exceed ${OBSERVED_HUMAN_IMPORT_LIMITS.maxRows} rows.`);
  for (const row of parsed.rows) {
    const values = Object.values(row);
    if (values.length > OBSERVED_HUMAN_IMPORT_LIMITS.maxColumns) fail('SOURCE_TOO_LARGE', `Observed-response rows must not exceed ${OBSERVED_HUMAN_IMPORT_LIMITS.maxColumns} columns.`);
    if (values.some((value) => typeof value === 'string' && value.length > OBSERVED_HUMAN_IMPORT_LIMITS.maxCellCharacters)) fail('SOURCE_TOO_LARGE', `Observed-response cells must not exceed ${OBSERVED_HUMAN_IMPORT_LIMITS.maxCellCharacters} characters.`);
  }
  const policy = identifierPolicy(input);
  const foundDirectIdentifiers = directIdentifierFields(parsed.rows);
  if (foundDirectIdentifiers.length && policy === 'REJECT') fail('DIRECT_IDENTIFIER', `Direct identifier fields are not accepted: ${foundDirectIdentifiers.join(', ')}.`);
  const rows = foundDirectIdentifiers.length ? redactObservedDirectIdentifiers(parsed.rows) : parsed.rows.map(clone);
  for (const row of rows) {
    if (row.synthetic === true || row.observedHumanResponse === false) fail('SYNTHETIC_INPUT', 'Synthetic rows cannot be imported into the observed-human namespace.');
  }
  const rules = normalizedRules(input.rules ?? input.preregisteredRules ?? input.preregistered ?? {});
  const rulesHash = hashObservedHumanValue(rules);
  const exclusions = exclusionCodeMap();
  const disposition = new Array(rows.length).fill(null);
  const consentedRows = [];
  const eligibleRows = [];
  const duplicateCandidates = [];
  const qualityRows = [];
  const diagnostics = {
    consent: { evaluated: rows.length, accepted: 0, rejected: 0 },
    eligibility: { evaluated: 0, accepted: 0, rejected: 0 },
    duplicate: { evaluated: 0, flagged: 0 },
    speeding: { evaluated: 0, flagged: 0 },
    straightLine: { evaluated: 0, flagged: 0 },
    missingness: { evaluated: 0, flagged: 0 },
  };

  rows.forEach((row, index) => {
    if (rules.consent && !rules.consent.accepted.includes(valueToken(row[rules.consent.field]))) {
      disposition[index] = 'NO_CONSENT';
      addExclusion(exclusions, 'NO_CONSENT');
      diagnostics.consent.rejected += 1;
      return;
    }
    diagnostics.consent.accepted += 1;
    consentedRows.push(index);
    diagnostics.eligibility.evaluated += 1;
    if (rules.eligibility.some((rule) => !matches(row, rule))) {
      disposition[index] = 'INELIGIBLE';
      addExclusion(exclusions, 'INELIGIBLE');
      diagnostics.eligibility.rejected += 1;
      return;
    }
    diagnostics.eligibility.accepted += 1;
    eligibleRows.push(index);
    duplicateCandidates.push(index);
  });

  const duplicateKeep = new Set(duplicateCandidates);
  if (rules.duplicate?.fields.length) {
    const seen = new Map();
    const ordered = rules.duplicate.keep === 'LAST' ? [...duplicateCandidates].reverse() : duplicateCandidates;
    diagnostics.duplicate.evaluated = duplicateCandidates.length;
    for (const index of ordered) {
      const key = responseKey(rows[index], rules.duplicate.fields);
      if (seen.has(key)) {
        duplicateKeep.delete(index);
        disposition[index] = 'DUPLICATE';
        diagnostics.duplicate.flagged += 1;
        addExclusion(exclusions, 'DUPLICATE');
      } else seen.set(key, index);
    }
  }

  for (const index of eligibleRows) {
    if (!duplicateKeep.has(index)) continue;
    const quality = rowQuality(rows[index], rules);
    diagnostics.speeding.evaluated += rules.speeding ? 1 : 0;
    diagnostics.straightLine.evaluated += rules.straightLine ? 1 : 0;
    diagnostics.missingness.evaluated += rules.missingness ? 1 : 0;
    const code = quality.speeding ? 'SPEEDING' : quality.straightLine ? 'STRAIGHT_LINE' : quality.missingness ? 'MISSINGNESS' : null;
    if (quality.speeding) diagnostics.speeding.flagged += 1;
    if (quality.straightLine) diagnostics.straightLine.flagged += 1;
    if (quality.missingness) diagnostics.missingness.flagged += 1;
    if (code) {
      disposition[index] = code;
      addExclusion(exclusions, code);
      continue;
    }
    qualityRows.push(index);
  }

  const finalRows = qualityRows.filter((index) => {
    const excluded = rules.exclusions.find((rule) => matches(rows[index], rule));
    if (!excluded) return true;
    disposition[index] = excluded.code;
    addExclusion(exclusions, excluded.code);
    return false;
  });
  const outcomeRows = finalRows.map((index) => rows[index]);
  const missingValues = rules.missingness?.missingValues || [];
  const distributions = Object.fromEntries(rules.outcomes.map((outcome) => [outcome.field, aggregateOutcome(outcomeRows, outcome, missingValues)]));
  const raw = rows.length;
  const consented = consentedRows.length;
  const eligible = eligibleRows.length;
  const deduplicated = duplicateKeep.size;
  const quality = qualityRows.length;
  const analysis = finalRows.length;
  for (const key of ['duplicate', 'speeding', 'straightLine', 'missingness']) {
    diagnostics[key].rate = diagnostics[key].evaluated ? diagnostics[key].flagged / diagnostics[key].evaluated : 0;
  }
  const providedNow = input.now ? input.now() : new Date();
  const timestampValue = providedNow instanceof Date ? providedNow.toISOString() : new Date(providedNow).toISOString();
  const sourceArtifact = hashObservedHumanValue(parsed.sourceBytes);
  const studyId = input.studyId || input.package?.studyId || null;
  const runId = input.runId || input.package?.sourceLineage?.runId || null;
  const recordId = safeRecordId(input.importId || `${studyId || 'study'}_observed_import`);
  const lineage = createLineageEnvelope({
    recordType: 'OBSERVED_HUMAN_IMPORT',
    recordId,
    classification: OBSERVED_HUMAN_DATA_CLASSIFICATION,
    studyId: studyId ? safeRecordId(studyId) : null,
    runId: runId ? safeRecordId(runId) : null,
    payloadHash: sourceArtifact,
    synthetic: false,
    observedHumanResponse: true,
    createdAt: timestampValue,
    updatedAt: timestampValue,
    retention: input.retention || { mode: 'SESSION' },
  });
  const result = {
    contractVersion: OBSERVED_HUMAN_IMPORT_VERSION,
    namespace: OBSERVED_HUMAN_NAMESPACE,
    dataNamespace: OBSERVED_HUMAN_NAMESPACE,
    mode: 'LOCAL_ONLY',
    synthetic: false,
    observedHumanResponse: true,
    participant: true,
    source: { format: parsed.format, localOnly: true, networkAccessed: false, sourcePath: source.sourcePath, rows: raw, sourceByteCount, sourceArtifact },
    rules: clone(rules),
    rulesHash,
    identifierPolicy: policy,
    directIdentifierFields: foundDirectIdentifiers,
    bases: { raw, consented, eligible, deduplicated, quality, analysis },
    distributions,
    exclusions: { byCode: exclusions, total: Object.values(exclusions).reduce((sum, value) => sum + value, 0) },
    exclusionCounts: exclusions,
    qualityDiagnostics: diagnostics,
    lineage,
    storage: { rawResponses: 'LOCAL_ONLY', openText: 'LOCAL_ONLY', rawResponsesReturned: false, rawTextReturned: false, promptSafe: true },
    disclosures: [
      'Observed human results are kept separate from synthetic results and are not representative unless the approved design supports that claim.',
      'Raw responses and direct identifiers are not returned by this aggregate import contract.',
    ],
  };
  return result;
}

export const importObservedResponses = importObservedHumanResponses;
export const importObservedHumanResponseData = importObservedHumanResponses;
