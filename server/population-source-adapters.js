import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const POPULATION_SOURCE_ADAPTER_VERSION = 'population-source-adapter-v1';

const identifierSchema = z.string().trim().min(1).max(100).regex(/^[a-z0-9][a-z0-9._-]*$/);
const fieldSchema = z.string().trim().min(1).max(160);
const adapterSchema = z.object({
  adapterVersion: z.literal(POPULATION_SOURCE_ADAPTER_VERSION),
  id: identifierSchema,
  format: z.literal('CSV'),
  expectedColumns: z.array(fieldSchema).min(1).max(100),
  filters: z.array(z.object({
    field: fieldSchema,
    operator: z.literal('EQUALS'),
    value: z.string().max(500),
  }).strict()).max(30),
  recodes: z.array(z.object({
    variableId: identifierSchema,
    label: z.string().trim().min(1).max(160),
    sourceField: fieldSchema,
    categories: z.array(z.object({
      code: z.string().trim().min(1).max(120),
      label: z.string().trim().min(1).max(160),
      sourceValues: z.array(z.string().min(1).max(160)).min(1).max(100),
    }).strict()).min(2).max(100),
  }).strict()).length(1),
  countField: fieldSchema,
  denominator: z.object({
    method: z.literal('SUM_INCLUDED_COUNTS'),
    label: z.string().trim().min(1).max(240),
    unit: z.enum(['PERSONS', 'HOUSEHOLDS', 'FIRMS', 'DWELLINGS', 'OTHER']),
  }).strict(),
  exclusions: z.array(z.string().trim().min(1).max(500)).max(30),
  rounding: z.object({
    method: z.literal('HALF_UP_WITH_FINAL_BALANCE'),
    decimalPlaces: z.number().int().min(0).max(12),
  }).strict(),
}).strict().superRefine((adapter, context) => {
  if (new Set(adapter.expectedColumns).size !== adapter.expectedColumns.length) {
    context.addIssue({ code: 'custom', path: ['expectedColumns'], message: 'Expected columns must be unique.' });
  }
  const required = [...adapter.filters.map(({ field }) => field), adapter.recodes[0].sourceField, adapter.countField];
  if (required.some((field) => !adapter.expectedColumns.includes(field))) {
    context.addIssue({ code: 'custom', path: ['expectedColumns'], message: 'Expected columns must include every filter, recode, and count field.' });
  }
  const sourceValues = adapter.recodes[0].categories.flatMap(({ sourceValues: values }) => values);
  if (new Set(sourceValues).size !== sourceValues.length) {
    context.addIssue({ code: 'custom', path: ['recodes', 0, 'categories'], message: 'Recode source values must not overlap.' });
  }
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function hash(value) {
  const input = typeof value === 'string' ? value : JSON.stringify(canonical(value));
  return createHash('sha256').update(input).digest('hex');
}

function localFilePath(value, label) {
  if (value instanceof URL) {
    if (value.protocol !== 'file:') throw new Error(`${label} must be a local file URL.`);
    return fileURLToPath(value);
  }
  if (typeof value !== 'string' || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) throw new Error(`${label} must be a local file path.`);
  return path.resolve(value);
}

function parseCsvLine(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { fields.push(value); value = ''; }
    else value += character;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  fields.push(value);
  return fields;
}

function parseCsv(source) {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.length) throw new Error('CSV source is empty.');
  const columns = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line, rowIndex) => {
    const values = parseCsvLine(line);
    if (values.length !== columns.length) throw new Error(`CSV row ${rowIndex + 2} has ${values.length} fields; expected ${columns.length}.`);
    return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  });
  return { columns, rows };
}

function withReportHash(report) {
  return { ...report, hashes: { ...report.hashes, dryRunReport: hash(report) } };
}

export async function runLocalPopulationSourceAdapter({ adapterPath, sourcePath }) {
  const resolvedAdapterPath = localFilePath(adapterPath, 'adapterPath');
  const resolvedSourcePath = localFilePath(sourcePath, 'sourcePath');
  const [adapterText, sourceText] = await Promise.all([
    readFile(resolvedAdapterPath, 'utf8'),
    readFile(resolvedSourcePath, 'utf8'),
  ]);
  const adapter = adapterSchema.parse(JSON.parse(adapterText));
  const { columns, rows } = parseCsv(sourceText);
  const missingColumns = adapter.expectedColumns.filter((column) => !columns.includes(column));
  const unexpectedColumns = columns.filter((column) => !adapter.expectedColumns.includes(column));
  const schemaDrift = {
    status: missingColumns.length || unexpectedColumns.length ? 'DRIFT_DETECTED' : 'MATCH',
    expectedColumns: adapter.expectedColumns,
    actualColumns: columns,
    missingColumns,
    unexpectedColumns,
  };
  const hashes = { sourceArtifact: hash(sourceText), adapterConfiguration: hash(adapter) };
  const base = {
    adapterVersion: adapter.adapterVersion,
    adapterId: adapter.id,
    mode: 'DRY_RUN',
    sourceFile: path.basename(resolvedSourcePath),
    schemaDrift,
    exclusions: adapter.exclusions,
    rounding: adapter.rounding,
  };
  if (schemaDrift.status === 'DRIFT_DETECTED') return withReportHash({
    ...base,
    status: 'SCHEMA_DRIFT',
    filters: adapter.filters,
    recodes: adapter.recodes,
    denominator: null,
    result: null,
    hashes,
  });

  let included = rows;
  const filters = adapter.filters.map((filter) => {
    const before = included.length;
    included = included.filter((row) => row[filter.field] === filter.value);
    return { ...filter, includedRows: included.length, excludedRows: before - included.length };
  });
  const counts = included.map((row, index) => {
    const value = Number(row[adapter.countField]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Row ${index + 2} has an invalid non-negative count.`);
    return value;
  });
  const denominatorValue = counts.reduce((sum, value) => sum + value, 0);
  if (!(denominatorValue > 0)) throw new Error('The declared denominator is zero after filtering.');

  const recode = adapter.recodes[0];
  const categoryFor = new Map(recode.categories.flatMap((category) => category.sourceValues.map((value) => [value, category.code])));
  const unmappedSourceValues = [...new Set(included.map((row) => row[recode.sourceField]).filter((value) => !categoryFor.has(value)))];
  if (unmappedSourceValues.length) throw new Error(`Unmapped source values: ${unmappedSourceValues.join(', ')}.`);
  const totals = new Map(recode.categories.map(({ code }) => [code, 0]));
  included.forEach((row, index) => totals.set(categoryFor.get(row[recode.sourceField]), totals.get(categoryFor.get(row[recode.sourceField])) + counts[index]));
  const categories = recode.categories.map((category, index) => ({
    code: category.code,
    label: category.label,
    sourceValues: category.sourceValues,
    count: totals.get(category.code),
    share: index === recode.categories.length - 1
      ? 0
      : Number((totals.get(category.code) / denominatorValue).toFixed(adapter.rounding.decimalPlaces)),
  }));
  categories[categories.length - 1].share = Number((1 - categories.slice(0, -1).reduce((sum, { share }) => sum + share, 0)).toFixed(adapter.rounding.decimalPlaces));

  return withReportHash({
    ...base,
    status: 'READY_FOR_REGISTRY_REVIEW',
    filters,
    recodes: adapter.recodes,
    denominator: { ...adapter.denominator, value: denominatorValue },
    result: { variableId: recode.variableId, label: recode.label, categories },
    hashes,
  });
}
