import assert from 'node:assert/strict';
import test from 'node:test';

import { buildResearchDesign, methodConfigSchema, researchMethodPromptBlock, researchMethodSchema } from './research-methods.js';

test('MESSAGE_TEST owns a strict message stimulus and directional result metadata', () => {
  const config = methodConfigSchema.parse({
    method: 'MESSAGE_TEST',
    message: { id: 'message-a', text: 'Save time with one workspace that brings every weekly report together.' },
    intendedAction: 'Consider signing up for a free trial',
    exposureContext: 'Landing-page hero copy',
  });
  const design = buildResearchDesign({ researchMethod: researchMethodSchema.parse('message_test'), methodConfig: config });

  assert.equal(design.methodId, 'MESSAGE_TEST');
  assert.equal(design.resultKind, 'DIRECTIONAL_DISTRIBUTION');
  assert.equal(design.segmentPerspectiveEligible, true);
  assert.equal(design.stimulus.message.id, 'message-a');
  const prompt = researchMethodPromptBlock({ researchMethod: 'MESSAGE_TEST', methodConfig: config });
  assert.match(prompt, /RESULT KIND\nDIRECTIONAL_DISTRIBUTION/);
  assert.match(prompt, /METHOD-OWNED SCALE\nMESSAGE_REACTION_5/);
  assert.match(prompt, /5\. Very compelling/);
});

test('CLAIMS_TEST requires an exact declared claim status and does not treat it as verification', () => {
  const config = methodConfigSchema.parse({ method: 'CLAIMS_TEST', claim: { id: 'claim-a', text: 'Our service reduces routine reporting time by half.' }, claimStatus: 'UNVERIFIED' });
  const design = buildResearchDesign({ researchMethod: 'CLAIMS_TEST', methodConfig: config });

  assert.equal(design.resultKind, 'DIRECTIONAL_DISTRIBUTION');
  assert.equal(design.stimulus.claimStatus, 'UNVERIFIED');
  assert.equal(methodConfigSchema.safeParse({ ...config, claimStatus: 'VERIFIED' }).success, false);
  assert.match(design.cautions.join(' '), /not verified/i);
});

test('UX_EXPECTATION_TEST is explicit about expected ease rather than observed usability', () => {
  const config = methodConfigSchema.parse({ method: 'UX_EXPECTATION_TEST', taskScenario: { id: 'first-export', text: 'A first-time administrator exports the prior month of account activity.' }, userGoal: 'Create a report for the finance team', experienceDescription: 'A browser dashboard with a reports section and CSV export action.', device: 'Laptop browser' });
  const design = buildResearchDesign({ researchMethod: 'UX_EXPECTATION_TEST', methodConfig: config });

  assert.equal(design.scale.id, 'UX_EXPECTED_EASE_5');
  assert.equal(design.stimulus.taskScenario.id, 'first-export');
  assert.match(design.cautions.join(' '), /not observed usability/i);
});

test('FEATURE_PRIORITIZATION retains three to eight unique supplied feature IDs', () => {
  const config = methodConfigSchema.parse({ method: 'FEATURE_PRIORITIZATION', features: [{ id: 'setup', text: 'Fast setup' }, { id: 'export', text: 'Data export' }, { id: 'sharing', text: 'Team sharing' }], decisionContext: 'Choose the next product investment', selectionConstraint: 'Rank every feature from highest to lowest priority' });
  const design = buildResearchDesign({ researchMethod: 'FEATURE_PRIORITIZATION', methodConfig: config });

  assert.equal(design.resultKind, 'RANKED_ITEMS');
  assert.equal(design.segmentPerspectiveEligible, false);
  assert.equal(methodConfigSchema.safeParse({ ...config, features: [...config.features, { id: 'setup', text: 'Duplicate' }] }).success, false);
});

test('BRAND_POSITIONING requires supplied comparator and attribute IDs without duplication', () => {
  const config = methodConfigSchema.parse({ method: 'BRAND_POSITIONING', focalBrand: { id: 'our-brand', label: 'Our Brand' }, comparatorBrands: [{ id: 'brand-a', label: 'Brand A' }, { id: 'brand-b', label: 'Brand B' }], category: 'Project management software', attributes: [{ id: 'value', label: 'Value' }, { id: 'easy', label: 'Ease of use' }, { id: 'secure', label: 'Security' }] });
  const design = buildResearchDesign({ researchMethod: 'BRAND_POSITIONING', methodConfig: config });

  assert.equal(design.resultKind, 'ATTRIBUTE_MATRIX');
  assert.equal(design.stimulus.comparatorBrands[0].id, 'brand-a');
  assert.equal(methodConfigSchema.safeParse({ ...config, comparatorBrands: [{ id: 'our-brand', label: 'Duplicate focal' }, config.comparatorBrands[1]] }).success, false);
});

test('PRICE_SENSITIVITY allows exactly three to eight ascending stable price points', () => {
  const config = methodConfigSchema.parse({ method: 'PRICE_SENSITIVITY', offer: { id: 'offer-a', text: 'A monthly reporting workspace for small business owners.' }, category: 'Reporting software', currency: 'EUR', unit: 'per month', channel: 'Direct website', purchaseHorizon: 'Within the next three months', referenceAlternative: 'Spreadsheets', pricePoints: [{ id: 'price-10', amount: 10 }, { id: 'price-15', amount: 15 }, { id: 'price-20', amount: 20 }] });
  const design = buildResearchDesign({ researchMethod: 'PRICE_SENSITIVITY', methodConfig: config });

  assert.equal(design.resultKind, 'PRICE_LADDER');
  assert.deepEqual(design.stimulus.pricePoints.map((point) => point.id), ['price-10', 'price-15', 'price-20']);
  assert.equal(methodConfigSchema.safeParse({ ...config, pricePoints: [config.pricePoints[1], config.pricePoints[0], config.pricePoints[2]] }).success, false);
});

test('SURVEY_PRETEST keeps supplied survey question references for an instrument review', () => {
  const config = methodConfigSchema.parse({ method: 'SURVEY_PRETEST', studyObjective: 'Understand account-management satisfaction', targetPopulation: 'Small business administrators', surveyQuestions: [{ id: 'q-satisfaction', text: 'How satisfied are you with account management?' }] });
  const design = buildResearchDesign({ researchMethod: 'SURVEY_PRETEST', methodConfig: config });

  assert.equal(design.resultKind, 'INSTRUMENT_REVIEW');
  assert.equal(design.stimulus.surveyQuestions[0].id, 'q-satisfaction');
  assert.equal(design.segmentPerspectiveEligible, false);
});

test('INTERVIEW_GUIDE requires stable supplied topic IDs and produces a guide-only result', () => {
  const config = methodConfigSchema.parse({ method: 'INTERVIEW_GUIDE', researchObjective: 'Understand first-use expectations', participantContext: 'People evaluating a new reporting tool', topics: [{ id: 'first-use', label: 'First use' }, { id: 'trust', label: 'Trust' }] });
  const design = buildResearchDesign({ researchMethod: 'INTERVIEW_GUIDE', methodConfig: config });

  assert.equal(design.resultKind, 'INTERVIEW_GUIDE');
  assert.equal(design.stimulus.topics[1].id, 'trust');
  assert.equal(methodConfigSchema.safeParse({ ...config, topics: [{ id: 'first-use', label: 'First use' }, { id: 'first-use', label: 'Duplicate' }] }).success, false);
});
