import assert from 'node:assert/strict';
import test from 'node:test';

import { isResearchMethodReady } from '../src/data.js';
import { studyReadinessIssues } from '../src/lib/studyReadiness.js';

const baseBrief = {
  prompt: 'How would this audience respond to the supplied research stimulus?',
  audience: 'Small business operations leaders',
};

test('readiness summary stays empty when the general brief is runnable', () => {
  assert.deepEqual(studyReadinessIssues(baseBrief), []);
});

test('readiness summary names the core and method-specific requirements', () => {
  const issues = studyReadinessIssues({
    researchMethod: 'CONCEPT_TEST',
    prompt: '',
    audience: 'x',
    concept: '',
  });

  assert.deepEqual(issues.map((issue) => issue.fieldId), ['research-question', 'audience', 'concept-stimulus']);
  assert.equal(issues[0].reasonKey, 'readinessAtLeastCharacters');
  assert.equal(issues[2].reasonKey, 'readinessAtLeastCharacters');
});

test('readiness summary mirrors the existing method readiness contract', () => {
  const studies = [
    {
      researchMethod: 'MESSAGE_TEST',
      message: 'Bring every weekly report together in one focused workspace.',
      intendedAction: 'Start a free trial',
    },
    {
      researchMethod: 'FEATURE_PRIORITIZATION',
      featureItems: [{ id: 'setup', text: 'Fast setup' }, { id: 'export', text: 'Data export' }, { id: 'sharing', text: 'Team sharing' }],
      decisionContext: 'Choose the next product investment',
      selectionConstraint: 'Rank every feature from highest to lowest priority',
    },
    {
      researchMethod: 'PRICE_SENSITIVITY',
      offer: 'A monthly reporting workspace for small business owners.',
      category: 'Reporting software',
      currency: 'EUR',
      priceUnit: 'per month',
      purchaseChannel: 'Direct website',
      purchaseHorizon: 'Within three months',
      referenceAlternative: 'Spreadsheets',
      pricePoints: [{ id: 'price-10', amount: '10' }, { id: 'price-15', amount: '15' }, { id: 'price-20', amount: '20' }],
    },
  ];

  for (const study of studies) {
    const complete = { ...baseBrief, ...study };
    assert.equal(studyReadinessIssues(complete).length, 0, `${study.researchMethod} should have no readiness issues`);
    assert.equal(studyReadinessIssues({ ...complete, prompt: '' }).length > 0, true);
    assert.equal(isResearchMethodReady({ ...complete, prompt: '' }), isResearchMethodReady(complete));
  }
});

test('localization readiness validates each independent request dimension', () => {
  const localized = {
    ...baseBrief,
    market: 'Japan',
    outputLocale: 'ja-JP',
    sourceLanguages: ['ja-JP', 'en-US'],
    retrievalPolicy: 'REQUIRE',
    retrievalLocales: ['ja-JP'],
    instrumentLocale: '',
  };
  assert.deepEqual(studyReadinessIssues(localized), []);

  const issueIds = studyReadinessIssues({
    ...localized,
    market: 'Indonesia',
    outputLocale: 'id-ID',
    sourceLanguages: ['id-ID'],
    retrievalLocales: [],
    instrumentLocale: 'th-TH',
  }).map((issue) => issue.fieldId);
  assert.deepEqual(issueIds, ['market', 'report-language', 'source-languages', 'retrieval-locales', 'instrument-language']);
});
