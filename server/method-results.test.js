import assert from 'node:assert/strict';
import test from 'node:test';

import {
  METHOD_RESULT_CONTRACT_VERSION,
  METHOD_RESULT_DISCLOSURE,
  normalizeMethodResult,
  projectLegacyDirectionalResult,
  validateMethodResult,
} from './method-results.js';

const directional = {
  contractVersion: METHOD_RESULT_CONTRACT_VERSION,
  kind: 'DIRECTIONAL_DISTRIBUTION',
  disclosure: METHOD_RESULT_DISCLOSURE,
  accessibleLabel: 'Model-generated likelihood after concept exposure',
  summary: 'This is a directional synthetic distribution for hypothesis exploration.',
  scale: {
    id: 'CONCEPT_INTENT_5',
    labels: ['Very unlikely', 'Unlikely', 'Not sure', 'Likely', 'Very likely'],
  },
  distribution: [10, 15, 20, 30, 25],
};

test('normalizes a directional result and projects its legacy five-point distribution', () => {
  const result = normalizeMethodResult(directional);

  assert.deepEqual(result.distribution, [10, 15, 20, 30, 25]);
  assert.deepEqual(projectLegacyDirectionalResult(result), {
    distribution: [10, 15, 20, 30, 25],
    responseScale: {
      id: 'CONCEPT_INTENT_5',
      labels: ['Very unlikely', 'Unlikely', 'Not sure', 'Likely', 'Very likely'],
    },
    disclosure: METHOD_RESULT_DISCLOSURE,
  });
});

test('preserves supplied ranked item IDs while requiring contiguous ordinal ranks', () => {
  const result = normalizeMethodResult({
    contractVersion: METHOD_RESULT_CONTRACT_VERSION,
    kind: 'RANKED_ITEMS', disclosure: METHOD_RESULT_DISCLOSURE,
    accessibleLabel: 'Model-generated feature priority', summary: 'A directional ordering of the supplied features for hypothesis exploration.',
    rankingLabel: 'Feature priority order',
    items: [
      { id: 'fast-setup', label: 'Fast setup', rank: 2 },
      { id: 'data-export', label: 'Data export', rank: 1, rationale: 'This may reduce manual work.' },
    ],
  });

  assert.deepEqual(result.items.map((item) => [item.id, item.rank]), [['fast-setup', 2], ['data-export', 1]]);
  assert.equal(validateMethodResult({ ...result, items: [{ ...result.items[0], rank: 1 }, { ...result.items[1], rank: 1 }] }).success, false);
  assert.equal(projectLegacyDirectionalResult(result), null);
});

test('requires every brand to retain one accessible association for every supplied attribute', () => {
  const result = normalizeMethodResult({
    contractVersion: METHOD_RESULT_CONTRACT_VERSION,
    kind: 'ATTRIBUTE_MATRIX', disclosure: METHOD_RESULT_DISCLOSURE,
    accessibleLabel: 'Model-generated brand association matrix', summary: 'A directional comparison of supplied brands and supplied attributes for hypothesis exploration.',
    matrixLabel: 'Brand associations',
    attributes: [{ id: 'value', label: 'Value' }, { id: 'ease', label: 'Ease of use' }],
    brands: [
      { id: 'brand-a', label: 'Brand A', associations: [{ attributeId: 'value', level: 'HIGH', accessibleLabel: 'High association with value' }, { attributeId: 'ease', level: 'MEDIUM', accessibleLabel: 'Medium association with ease of use' }] },
      { id: 'brand-b', label: 'Brand B', associations: [{ attributeId: 'value', level: 'LOW', accessibleLabel: 'Low association with value' }, { attributeId: 'ease', level: 'HIGH', accessibleLabel: 'High association with ease of use' }] },
    ],
  });

  assert.equal(result.brands[1].associations[1].attributeId, 'ease');
  assert.equal(validateMethodResult({ ...result, brands: [{ ...result.brands[0], associations: [result.brands[0].associations[0]] }, result.brands[1]] }).success, false);
});

test('accepts only ascending, stable-ID price ladders with a full stated-intent distribution at each price', () => {
  const result = normalizeMethodResult({
    contractVersion: METHOD_RESULT_CONTRACT_VERSION,
    kind: 'PRICE_LADDER', disclosure: METHOD_RESULT_DISCLOSURE,
    accessibleLabel: 'Model-generated stated intent at supplied prices', summary: 'A directional stated-intent profile where the supplied price is the only modeled changing condition.',
    scale: { id: 'PURCHASE_INTENT_5', labels: ['Definitely would not', 'Probably would not', 'Might or might not', 'Probably would', 'Definitely would'] },
    priceContext: { currency: 'EUR', unit: 'per month' },
    points: [
      { id: 'eur-10', label: '€10 per month', amount: 10, distribution: [10, 15, 20, 30, 25] },
      { id: 'eur-15', label: '€15 per month', amount: 15, distribution: [15, 20, 20, 25, 20] },
      { id: 'eur-20', label: '€20 per month', amount: 20, distribution: [20, 20, 25, 20, 15] },
    ],
  });

  assert.deepEqual(result.points.map((point) => point.id), ['eur-10', 'eur-15', 'eur-20']);
  assert.equal(validateMethodResult({ ...result, points: [result.points[1], result.points[0], result.points[2]] }).success, false);
});

test('keeps instrument-review findings tied to stable question IDs without manufacturing a distribution', () => {
  const result = normalizeMethodResult({
    contractVersion: METHOD_RESULT_CONTRACT_VERSION,
    kind: 'INSTRUMENT_REVIEW', disclosure: METHOD_RESULT_DISCLOSURE,
    accessibleLabel: 'Model-generated survey-draft review', summary: 'A model review of supplied survey wording that requires human cognitive pretesting.',
    issues: [{ id: 'issue-1', questionId: 'screen-q1', severity: 'HIGH', category: 'Double-barrelled wording', explanation: 'The question asks about two separable topics in one response.', revisionSuggestion: 'Split the question into one item for each topic.' }],
    coverageGaps: ['The draft does not state a recall period.'],
    suggestedCognitiveProbes: ['What time period did you use when answering this question?'],
  });

  assert.equal(result.issues[0].questionId, 'screen-q1');
  assert.equal('distribution' in result, false);
  assert.equal(validateMethodResult({ ...result, issues: [{ ...result.issues[0], id: 'issue-1' }, { ...result.issues[0], id: 'issue-1' }] }).success, false);
});

test('returns an interview-guide draft as neutral prompts and probes, not a participant perspective', () => {
  const result = normalizeMethodResult({
    contractVersion: METHOD_RESULT_CONTRACT_VERSION,
    kind: 'INTERVIEW_GUIDE', disclosure: METHOD_RESULT_DISCLOSURE,
    accessibleLabel: 'Model-generated interview guide draft', summary: 'A draft guide for researcher review and use with real human participants where appropriate.',
    opening: 'Thank the participant, explain the study purpose, and obtain informed consent before beginning.',
    questions: [{ id: 'guide-q1', topicId: 'first-use', prompt: 'Please walk me through the first time you would use this service.', probes: ['What would you expect to happen next?'] }],
    moderatorNotes: ['Do not imply that a participant should have a positive or negative view.'],
    consentAndAccessibilityNotes: ['Offer a break and an accessible format before the discussion begins.'],
    closing: 'Ask whether the participant has anything else they would like the research team to know.',
  });

  assert.deepEqual(result.questions[0].probes, ['What would you expect to happen next?']);
  assert.equal('responses' in result, false);
  assert.equal(validateMethodResult({ ...result, questions: [{ ...result.questions[0], id: 'guide-q1' }, { ...result.questions[0], id: 'guide-q1' }] }).success, false);
});
