import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import syntheticStudyApi from '../api/synthetic-study.js';
import {
  isResearchMethodReady,
  methodConfigForStudy,
  researchMethods,
  resultKindForResearchMethod,
  segmentPerspectiveEligibleFor,
} from '../src/data.js';
import {
  RUN_SYNTHETIC_STUDY_DESCRIPTION,
  runSyntheticStudyInputSchema,
  publicValidationIssues,
} from '../server/mcp-contract.js';
import { methodConfigSchema } from '../server/research-methods.js';

const baseBrief = {
  prompt: 'How would this audience respond to the supplied research stimulus?',
  audience: 'Small business operations leaders',
  panelSize: 100,
  evidencePolicy: 'PRIOR_ONLY',
};

const methodStudies = Object.freeze({
  MESSAGE_TEST: {
    message: 'Bring every weekly report together in one focused workspace.',
    intendedAction: 'Start a free trial',
    exposureContext: 'Landing-page hero',
  },
  CLAIMS_TEST: {
    claim: 'Teams can complete routine weekly reporting in half the time.',
    claimStatus: 'UNVERIFIED',
    exposureContext: 'Product page',
  },
  UX_EXPECTATION_TEST: {
    taskScenario: 'A first-time administrator exports the prior month of account activity.',
    userGoal: 'Create a finance report',
    experienceDescription: 'A browser dashboard with a reports section and CSV export action.',
    uxContext: 'First use',
    device: 'Laptop browser',
  },
  FEATURE_PRIORITIZATION: {
    featureItems: [
      { id: 'setup', text: 'Fast setup' },
      { id: 'export', text: 'Data export' },
      { id: 'sharing', text: 'Team sharing' },
    ],
    decisionContext: 'Choose the next product investment',
    selectionConstraint: 'Rank every feature from highest to lowest priority',
  },
  BRAND_POSITIONING: {
    focalBrand: 'Northstar',
    comparatorBrands: [{ id: 'brand-a', label: 'Brand A' }, { id: 'brand-b', label: 'Brand B' }],
    category: 'Project management software',
    brandAttributes: [
      { id: 'value', label: 'Value' },
      { id: 'ease', label: 'Ease of use' },
      { id: 'security', label: 'Security' },
    ],
  },
  PRICE_SENSITIVITY: {
    offer: 'A monthly reporting workspace for small business owners.',
    category: 'Reporting software',
    currency: 'EUR',
    priceUnit: 'per month',
    purchaseChannel: 'Direct website',
    purchaseHorizon: 'Within three months',
    referenceAlternative: 'Spreadsheets',
    pricePoints: [{ id: 'price-10', amount: '10' }, { id: 'price-15', amount: '15' }, { id: 'price-20', amount: '20' }],
  },
  SURVEY_PRETEST: {
    studyObjective: 'Understand account-management satisfaction',
    targetPopulation: 'Small business administrators',
    surveyQuestions: [{ id: 'q1', text: 'How satisfied are you with account management?' }],
  },
  INTERVIEW_GUIDE: {
    researchObjective: 'Understand first-use expectations',
    participantContext: 'People evaluating a new reporting tool',
    interviewTopics: [{ id: 'first-use', label: 'First use' }, { id: 'trust', label: 'Trust' }],
    sensitiveAreas: [{ id: 'privacy', text: 'Personal financial details' }],
  },
});

const expectedKinds = Object.freeze({
  MESSAGE_TEST: 'DIRECTIONAL_DISTRIBUTION',
  CLAIMS_TEST: 'DIRECTIONAL_DISTRIBUTION',
  UX_EXPECTATION_TEST: 'DIRECTIONAL_DISTRIBUTION',
  FEATURE_PRIORITIZATION: 'RANKED_ITEMS',
  BRAND_POSITIONING: 'ATTRIBUTE_MATRIX',
  PRICE_SENSITIVITY: 'PRICE_LADDER',
  SURVEY_PRETEST: 'INSTRUMENT_REVIEW',
  INTERVIEW_GUIDE: 'INTERVIEW_GUIDE',
});

test('the product registry exposes every specialized method with its result and segment contracts', () => {
  const ids = researchMethods.map((method) => method.id);
  for (const [method, resultKind] of Object.entries(expectedKinds)) {
    assert.ok(ids.includes(method), `${method} is missing from the composer registry`);
    assert.equal(resultKindForResearchMethod(method), resultKind);
    assert.equal(segmentPerspectiveEligibleFor(method), resultKind === 'DIRECTIONAL_DISTRIBUTION');
  }
  assert.equal(segmentPerspectiveEligibleFor('PRICE_SENSITIVITY'), false);
  assert.equal(segmentPerspectiveEligibleFor('CONCEPT_TEST'), true);
});

test('composer state serializes into strict API and MCP methodConfig contracts for all eight methods', () => {
  for (const [researchMethod, study] of Object.entries(methodStudies)) {
    const composerStudy = { ...study, researchMethod };
    assert.equal(isResearchMethodReady(composerStudy), true, `${researchMethod} should be ready`);
    const methodConfig = methodConfigForStudy(composerStudy);
    assert.equal(methodConfigSchema.safeParse(methodConfig).success, true, `${researchMethod} methodConfig should parse`);
    const request = runSyntheticStudyInputSchema.safeParse({ ...baseBrief, researchMethod, methodConfig });
    assert.equal(request.success, true, `${researchMethod} request should parse: ${request.error?.message || ''}`);
  }
});

test('conditional readiness mirrors method-contract boundaries before enabling a run', () => {
  assert.equal(isResearchMethodReady({ researchMethod: 'FEATURE_PRIORITIZATION', ...methodStudies.FEATURE_PRIORITIZATION, featureItems: methodStudies.FEATURE_PRIORITIZATION.featureItems.slice(0, 2) }), false);
  assert.equal(isResearchMethodReady({ researchMethod: 'BRAND_POSITIONING', ...methodStudies.BRAND_POSITIONING, brandAttributes: methodStudies.BRAND_POSITIONING.brandAttributes.slice(0, 2) }), false);
  assert.equal(isResearchMethodReady({ researchMethod: 'PRICE_SENSITIVITY', ...methodStudies.PRICE_SENSITIVITY, pricePoints: [{ id: 'high', amount: '20' }, { id: 'low', amount: '10' }, { id: 'middle', amount: '15' }] }), false);
  assert.equal(isResearchMethodReady({ researchMethod: 'INTERVIEW_GUIDE', ...methodStudies.INTERVIEW_GUIDE, interviewTopics: methodStudies.INTERVIEW_GUIDE.interviewTopics.slice(0, 1) }), false);
  assert.equal(isResearchMethodReady({ researchMethod: 'MESSAGE_TEST', ...methodStudies.MESSAGE_TEST, exposureContext: 'x' }), false);
  assert.equal(isResearchMethodReady({ researchMethod: 'UX_EXPECTATION_TEST', ...methodStudies.UX_EXPECTATION_TEST, device: 'x' }), false);
  assert.equal(isResearchMethodReady({ researchMethod: 'INTERVIEW_GUIDE', ...methodStudies.INTERVIEW_GUIDE, sensitiveAreas: [{ id: 'privacy', text: 'x' }] }), false);
  assert.equal(isResearchMethodReady({ researchMethod: 'SURVEY_PRETEST', ...methodStudies.SURVEY_PRETEST, studyObjective: 'x'.repeat(501) }), false);
});

test('public MCP validation and tool copy advertise the implemented method set', () => {
  const parsed = runSyntheticStudyInputSchema.safeParse({ ...baseBrief, researchMethod: 'NOT_A_METHOD' });
  assert.equal(parsed.success, false);
  const message = publicValidationIssues(parsed.error).map((issue) => issue.message).join(' ');
  for (const method of Object.keys(expectedKinds)) {
    assert.match(message, new RegExp(method));
    assert.match(RUN_SYNTHETIC_STUDY_DESCRIPTION, new RegExp(method));
  }
});

test('the HTTP API rejects a specialized method without its matching methodConfig before model work', async () => {
  const headers = new Map();
  const response = {
    statusCode: 200,
    payload: null,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
  };
  await syntheticStudyApi({
    method: 'POST',
    body: { ...baseBrief, researchMethod: 'MESSAGE_TEST' },
    headers: { host: 'likerts.example', 'content-type': 'application/json' },
  }, response);
  assert.equal(response.statusCode, 400);
  assert.match(response.payload.error, /supported research method configuration/i);
  assert.ok(response.payload.details.some((issue) => issue.field === 'methodConfig'));
  assert.equal(headers.get('cache-control'), 'no-store');
});

test('results workspace dispatches all six result kinds and gates segment exploration on the method contract', async () => {
  const source = await readFile(new URL('../src/components/ResultsWorkspace.jsx', import.meta.url), 'utf8');
  for (const kind of new Set(Object.values(expectedKinds))) assert.match(source, new RegExp(`case '${kind}'`));
  assert.match(source, /segmentPerspectiveEligible === true/);
  assert.match(source, /method-result--attribute-matrix/);
  assert.match(source, /method-result--price-ladder/);
  assert.match(source, /method-result--instrument-review/);
  assert.match(source, /method-result--interview-guide/);
});
