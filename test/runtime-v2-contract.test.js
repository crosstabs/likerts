import assert from 'node:assert/strict';
import test from 'node:test';

import { acquireEvidence, aggregateCohortDistributions, requestSchema, runStudyPipeline } from '../server/synthetic-study-pipeline.js';
import { languageScriptReport } from '../server/language-script.js';

const brief = {
  prompt: 'Would this audience adopt a shared workspace?',
  audience: 'Small business operations leaders',
  panelSize: 100,
};

const studyCandidate = {
  title: 'Workspace adoption',
  summary: 'The model-generated cohort leans interested, with material uncertainty around onboarding.',
  takeaway: 'Use the directional pattern to design research with real participants before investing.',
  distribution: [10, 15, 20, 30, 25],
  confidence: 'Low',
  confidenceNote: 'Synthetic only; validate through appropriate human research.',
  audienceSummary: {
    audienceLabel: 'Operations leaders',
    contextLabel: 'Small businesses',
    attributes: [{ label: 'Role', value: 'Leader' }, { label: 'Team', value: 'Small' }, { label: 'Need', value: 'Coordination' }],
  },
  segments: ['Champions', 'Pragmatists', 'Uncertain', 'Skeptics'].map((label) => ({ label, sample: 25, values: [10, 15, 20, 30, 25] })),
  responses: [1, 2, 4, 5].map((score) => ({ score, profile: `Profile ${score}`, quote: 'This is a model-generated illustration and is not a human response.' })),
  cautions: ['This is a synthetic directional result.', 'Validate the hypothesis with real participants.'],
};

test('researchMode is additive, defaults to QUICK, and accepts DEEP', () => {
  assert.equal(requestSchema.parse(brief).researchMode, 'QUICK');
  assert.equal(requestSchema.parse({ ...brief, researchMode: 'DEEP' }).researchMode, 'DEEP');
  assert.equal(requestSchema.parse({ ...brief, researchMode: 'quick' }).researchMode, 'QUICK');
  assert.equal(requestSchema.parse({ ...brief, researchMode: 'deep' }).researchMode, 'DEEP');
  assert.equal(requestSchema.safeParse({ ...brief, researchMode: 'UNKNOWN' }).success, false);
});

test('Deep cohort aggregation is deterministic and reports explicit disagreement', () => {
  const cells = [
    [10, 10, 20, 30, 30],
    [20, 10, 20, 30, 20],
    [10, 20, 20, 20, 30],
  ];
  const forward = aggregateCohortDistributions(cells);
  const reverse = aggregateCohortDistributions([...cells].reverse());

  assert.deepEqual(forward.distribution, [13, 13, 20, 27, 27]);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.stability.cellCount, 3);
  assert.equal(forward.stability.maxPercentagePointSpread, 10);
  assert.ok(forward.stability.meanJensenShannonDivergence > 0);
  assert.equal(forward.stability.metricVersion, 'stability-v1');
  assert.throws(() => aggregateCohortDistributions([cells[0], []]), /five values/i);
  assert.throws(() => aggregateCohortDistributions([cells[0], [25, 25, 25, 25]]), /five values/i);
});

test('locale script guard detects cross-script contamination without rejecting technical Latin terms', () => {
  assert.deepEqual(languageScriptReport('Ease of理解', 'en-US').unexpectedScripts, ['Han']);
  assert.deepEqual(languageScriptReport('合成Likert調査', 'ja-JP').unexpectedScripts, []);
  assert.deepEqual(languageScriptReport('日本語 अध्ययन', 'ja-JP').unexpectedScripts, ['Devanagari']);
  assert.equal(languageScriptReport('بحث Likerts اصطناعي', 'ar-SA').pass, true);
});

test('public panel output retries on an unexpected writing system', async () => {
  let panelCalls = 0;
  const result = await runStudyPipeline(requestSchema.parse({ ...brief, evidencePolicy: 'PRIOR_ONLY' }), {
    env: {},
    generate: async (options) => {
      const tags = options.providerOptions.gateway.tags;
      let output;
      if (tags.includes('stage:framing')) {
        output = { neutralQuestion: brief.prompt, decisionContext: 'Evaluate a directional adoption hypothesis.', panelDimensions: ['Use case', 'Value', 'Barriers'], assumptions: ['Synthetic cohort only.', 'No causal claim.'], evidenceBoundary: 'No source evidence was supplied; findings are model-only hypotheses.' };
      } else if (tags.includes('stage:panel')) {
        panelCalls += 1;
        output = panelCalls === 1 ? { ...studyCandidate, title: 'Ease of理解' } : studyCandidate;
      } else {
        output = { decision: 'accepted', critiqueSummary: 'No material evidence-alignment or bias issue was detected.', credibilityLevel: 'illustrative-only', evidenceAlignment: 'not-assessed', weakClaims: [], biasSignals: [] };
      }
      return { output, response: { modelId: options.model.modelId }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, providerMetadata: { gateway: { cost: '0.001' } } };
    },
  });

  assert.equal(panelCalls, 2);
  assert.equal(result.study.title, studyCandidate.title);
  assert.deepEqual(result.run.stages.find((stage) => stage.stage === 'panel').attempts.map((attempt) => attempt.status), ['failed', 'completed']);
  assert.equal(result.run.economics.gatewayCost.exactTotalUsd, '0.004');
  assert.equal(result.run.economics.tokenUsage.totalTokens, 8);
});

test('Gateway evidence retrieval uses the stable anonymous attribution key', async () => {
  const users = [];
  await acquireEvidence(requestSchema.parse(brief), {
    env: { VERCEL_OIDC_TOKEN: 'test-token' },
    studyId: 'study-fallback',
    runId: 'run-test',
    gatewayUserId: 'salted-anonymous-client-key',
    searchGenerate: async (options) => {
      users.push(options.providerOptions.gateway.user);
      return { toolResults: [{ toolName: 'exa_search', output: { results: [{ title: 'Source', url: 'https://example.com/source', highlights: ['Evidence excerpt.'] }] } }] };
    },
  });
  assert.deepEqual(users, ['salted-anonymous-client-key', 'salted-anonymous-client-key']);
});

test('DEEP runs a bounded multi-provider cohort and returns economics, lineage, and verification metadata', async () => {
  const calls = [];
  const cellOutputs = [
    [10, 10, 20, 30, 30],
    [20, 10, 20, 30, 20],
    [10, 20, 20, 20, 30],
  ];
  const result = await runStudyPipeline(requestSchema.parse({ ...brief, researchMode: 'DEEP', evidencePolicy: 'PRIOR_ONLY' }), {
    env: { DEEP_COHORT_CELLS: '3' },
    gatewayUserId: 'salted-anonymous-client-key',
    generate: async (options) => {
      calls.push(options);
      const tags = options.providerOptions.gateway.tags;
      let output;
      if (tags.includes('stage:framing')) {
        output = { neutralQuestion: brief.prompt, decisionContext: 'Evaluate a directional adoption hypothesis.', panelDimensions: ['Use case', 'Value', 'Barriers'], assumptions: ['Synthetic cohort only.', 'No causal claim.'], evidenceBoundary: 'No source evidence was supplied; findings are model-only hypotheses.' };
      } else if (tags.includes('stage:respondent-cell')) {
        const cellIndex = Number(tags.find((tag) => tag.startsWith('cell:')).split(':')[1]);
        output = { cellLabel: `Model cell ${cellIndex + 1}`, distribution: cellOutputs[cellIndex], evidenceAlignment: 'prior-only', weakClaims: [] };
      } else if (tags.includes('stage:panel')) {
        output = studyCandidate;
      } else {
        output = { decision: 'accepted', critiqueSummary: 'No material evidence-alignment or bias issue was detected.', credibilityLevel: 'illustrative-only', evidenceAlignment: 'not-assessed', weakClaims: [], biasSignals: [] };
      }
      return {
        output,
        response: { modelId: options.model.modelId },
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        providerMetadata: { gateway: { cost: '0.001' } },
      };
    },
  });

  assert.equal(calls.length, 6);
  assert.deepEqual(result.study.distribution, [13, 13, 20, 27, 27]);
  assert.equal(result.run.researchMode, 'DEEP');
  assert.equal(result.run.stability.cellCount, 3);
  const cellLineage = result.run.modelLineage.filter((stage) => stage.stage === 'respondent-cell');
  assert.equal(cellLineage.length, 3);
  assert.equal(new Set(cellLineage.map((stage) => stage.requestedModel.split('/')[0])).size, 2);
  assert.equal(result.run.verification.separateModelCall, true);
  assert.equal(result.run.verification.independentReview, false);
  assert.equal(result.run.economics.gatewayCost.exactTotalUsd, '0.006');
  assert.equal(result.run.economics.tokenUsage.totalTokens, 180);
  assert.match(result.run.reproducibility.disclaimer, /non-deterministic/i);
  assert.match(result.run.reproducibility.inputHash, /^[a-f0-9]{64}$/);
  assert.match(result.run.reproducibility.evidenceHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.meta.ensemble.stability, result.run.stability);
  assert.deepEqual(result.meta.provenance, result.run.reproducibility);
  assert.deepEqual(result.meta.ownerCost, result.run.economics);
  assert.deepEqual(result.meta.credibility.stability, result.run.stability);
  assert.equal(result.meta.credibility.ensemble.completedCells, 3);
  assert.ok(calls.every((call) => call.providerOptions.gateway.user === 'salted-anonymous-client-key'));
  assert.ok(calls.every((call) => call.providerOptions.gateway.tags.includes('mode:deep')));
  assert.ok(calls.filter((call) => call.providerOptions.gateway.tags.includes('stage:respondent-cell')).every((call) => call.timeout <= 10_000));
  assert.ok(Math.max(...calls.map((call) => call.timeout)) <= 14_000);
});

test('a flagged critic decision remains illustrative without English wrapper text in Japanese output', async () => {
  const localizedNote = 'これは合成結果であり、実際の参加者による調査で検証する必要があります。';
  const localizedCritique = '結論は、利用可能な事前知識だけでは十分に裏付けられていません。';
  const result = await runStudyPipeline(requestSchema.parse({ ...brief, outputLocale: 'ja-JP', evidencePolicy: 'PRIOR_ONLY' }), {
    env: {},
    generate: async (options) => {
      const tags = options.providerOptions.gateway.tags;
      let output;
      if (tags.includes('stage:framing')) {
        output = { neutralQuestion: brief.prompt, decisionContext: 'Evaluate an adoption hypothesis.', panelDimensions: ['Use case', 'Value', 'Barriers'], assumptions: ['Synthetic panel only.', 'No causal claim.'], evidenceBoundary: 'No source evidence was supplied; findings are model-only hypotheses.' };
      } else if (tags.includes('stage:panel')) {
        output = { ...studyCandidate, confidenceNote: localizedNote, cautions: ['これは方向性を示す合成結果です。', '実際の参加者による調査で仮説を検証してください。'] };
      } else {
        output = { decision: 'flagged', critiqueSummary: localizedCritique, credibilityLevel: 'illustrative-only', evidenceAlignment: 'unaligned', weakClaims: ['採用傾向の根拠が弱いです。'], biasSignals: [] };
      }
      return { output, response: { modelId: options.model.modelId }, usage: { totalTokens: 1 } };
    },
  });

  assert.equal(result.run.status, 'completed-with-review-flag');
  assert.equal(result.run.credibility.level, 'illustrative-only');
  assert.equal(result.study.confidence, 'Low');
  assert.equal(result.study.confidenceNote, localizedNote);
  assert.ok(result.study.cautions.includes(localizedCritique));
  assert.doesNotMatch(result.study.cautions.join(' '), /Reviewer flag|Synthetic, directional output only/i);
});
