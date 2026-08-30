import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildObservedHumanPromptContext,
  importObservedHumanResponses,
  OBSERVED_HUMAN_IMPORT_LIMITS,
  redactObservedDirectIdentifiers,
} from './observed-human-import.js';

const rules = {
  preregistrationId: 'prereg-1',
  consent: { field: 'consent', accepted: ['yes', '1', 'true'] },
  eligibility: [{ field: 'eligible', operator: 'EQUALS', value: 'yes' }],
  duplicate: { fields: ['respondent_key'] },
  speeding: { durationField: 'duration_seconds', minimumSeconds: 30 },
  straightLine: { fields: ['q1', 'q2', 'q3'], minimumAnswered: 3 },
  missingness: { fields: ['q1', 'q2', 'q3'], maxMissing: 0.3 },
  exclusions: [{ code: 'MANUAL_EXCLUSION', field: 'exclude', operator: 'EQUALS', value: 'yes' }],
  outcomes: [{ field: 'q1', label: 'Primary outcome' }, { field: 'q2', label: 'Secondary outcome' }],
};

const csv = [
  'respondent_key,consent,eligible,duration_seconds,q1,q2,q3,exclude,comment',
  'a,yes,yes,60,1,2,3,no,This is private human text',
  'a,yes,yes,60,1,2,3,no,duplicate response',
  'b,no,yes,60,5,4,3,no,no consent',
  'c,yes,no,60,1,2,3,no,ineligible',
  'd,yes,yes,10,1,2,3,no,too fast',
  'e,yes,yes,60,2,2,2,no,straight line',
  'f,yes,yes,60,1,,3,no,missing item',
  'g,yes,yes,60,1,2,3,yes,manual exclusion',
].join('\n');

test('local CSV import applies frozen human rules and returns observed aggregates only', async () => {
  const result = await importObservedHumanResponses({ source: csv, format: 'CSV', rules, studyId: 'study-1' });

  assert.equal(result.namespace, 'observed-human');
  assert.equal(result.synthetic, false);
  assert.equal(result.observedHumanResponse, true);
  assert.equal(result.source.localOnly, true);
  assert.equal(result.bases.raw, 8);
  assert.equal(result.bases.consented, 7);
  assert.equal(result.bases.eligible, 6);
  assert.equal(result.bases.analysis, 1);
  assert.equal(result.exclusions.byCode.NO_CONSENT, 1);
  assert.equal(result.exclusions.byCode.DUPLICATE, 1);
  assert.equal(result.exclusions.byCode.SPEEDING, 1);
  assert.equal(result.exclusions.byCode.STRAIGHT_LINE, 1);
  assert.equal(result.exclusions.byCode.MISSINGNESS, 1);
  assert.equal(result.exclusions.byCode.MANUAL_EXCLUSION, 1);
  assert.deepEqual(result.distributions.q1.categories, [{ value: '1', count: 1, share: 1 }]);
  assert.equal(result.distributions.q1.base, 1);
  assert.equal(result.qualityDiagnostics.speeding.flagged, 1);
  assert.equal(result.qualityDiagnostics.straightLine.flagged, 1);
  assert.equal(result.qualityDiagnostics.missingness.flagged, 1);
  assert.doesNotMatch(JSON.stringify(result), /This is private human text|duplicate response/);
  assert.equal(result.rawResponses, undefined);
  assert.match(result.rulesHash, /^[a-f0-9]{64}$/);
});

test('JSON import is deterministic and does not admit synthetic rows into the human namespace', async () => {
  const source = JSON.stringify([
    { respondent_key: 'a', consent: 'yes', eligible: 'yes', duration_seconds: 60, q1: '1', q2: '2', q3: '3' },
  ]);
  const now = () => '2026-08-29T12:00:00.000Z';
  const first = await importObservedHumanResponses({ source, format: 'JSON', rules, now });
  const second = await importObservedHumanResponses({ source, format: 'JSON', rules, now });
  assert.deepEqual(first, second);

  await assert.rejects(
    () => importObservedHumanResponses({ source: JSON.stringify([{ ...JSON.parse(source)[0], synthetic: true }]), format: 'JSON', rules }),
    /synthetic|observed human/i,
  );
});

test('direct identifiers are rejected by default and can only be explicitly redacted', async () => {
  const source = 'email,consent,eligible,q1\nsecret@example.com,yes,yes,1';
  await assert.rejects(
    () => importObservedHumanResponses({ source, format: 'CSV', rules }),
    /direct identifier|email/i,
  );
  const redacted = redactObservedDirectIdentifiers([{ email: 'secret@example.com', consent: 'yes' }]);
  assert.deepEqual(redacted, [{ consent: 'yes' }]);
  assert.doesNotMatch(JSON.stringify(redacted), /secret@example.com/);
});

test('open-text aggregates and prompt context carry counts only, never human wording', async () => {
  const result = await importObservedHumanResponses({
    source: JSON.stringify([{ consent: 'yes', comment: 'A private verbatim response that must stay local.' }]),
    format: 'JSON',
    rules: { consent: { field: 'consent', accepted: ['yes'] }, outcomes: [{ field: 'comment', type: 'OPEN_TEXT' }] },
    now: () => '2026-08-29T12:00:00.000Z',
  });
  assert.doesNotMatch(JSON.stringify(result), /A private verbatim response/);
  const promptContext = buildObservedHumanPromptContext(result);
  assert.equal(promptContext.rawResponsesIncluded, false);
  assert.equal(promptContext.openTextIncluded, false);
  assert.doesNotMatch(JSON.stringify(result.distributions), /private verbatim/);
  assert.doesNotMatch(JSON.stringify(promptContext), /private verbatim/);
});

test('observed-response import rejects oversized content before parsing or aggregation', async () => {
  await assert.rejects(
    () => importObservedHumanResponses({
      source: 'x'.repeat(OBSERVED_HUMAN_IMPORT_LIMITS.maxSourceBytes + 1),
      format: 'CSV',
      rules,
    }),
    (error) => error.code === 'SOURCE_TOO_LARGE',
  );
});
