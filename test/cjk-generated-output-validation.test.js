import assert from 'node:assert/strict';
import test from 'node:test';

import {
  generatedOutputLanguageReceipt,
  requestSchema,
  runStudyPipeline,
} from '../server/synthetic-study-pipeline.js';
import { languageScriptReport } from '../server/language-script.js';

const localeText = Object.freeze({
  'zh-CN': '中文结果说明',
  'ja-JP': '日本語の結果説明',
  'ko-KR': '한국어 결과 설명',
});

function baseResult(text) {
  return {
    title: text,
    summary: Array(5).fill(text).join(' '),
    takeaway: Array(7).fill(text).join(' '),
    confidenceNote: Array(4).fill(text).join(' '),
    cautions: [Array(3).fill(text).join(' ')],
  };
}

function resultFor(kind, text) {
  const base = baseResult(text);
  if (kind === 'DIRECTIONAL_DISTRIBUTION') {
    return {
      ...base,
      distribution: [10, 15, 20, 30, 25],
      confidence: 'Low',
      audienceSummary: {
        audienceLabel: text,
        contextLabel: text,
        attributes: [{ label: text, value: text }],
      },
      segments: [{ label: text, values: [10, 15, 20, 30, 25] }],
      responses: [{ score: 4, profile: text, quote: text }],
    };
  }
  if (kind === 'RANKED_ITEMS') {
    return {
      ...base,
      kind,
      rankingLabel: text,
      // This is requester-supplied input copied into the generated shape.
      items: [{ id: 'feature-1', label: 'English requester-supplied feature', rank: 1, rationale: text }],
    };
  }
  if (kind === 'ATTRIBUTE_MATRIX') {
    return {
      ...base,
      kind,
      matrixLabel: text,
      // These labels are requester-supplied, not generated output copy.
      attributes: [{ id: 'attribute-1', label: 'English requester-supplied attribute' }],
      brands: [{
        id: 'brand-1',
        label: 'English requester-supplied brand',
        associations: [{ attributeId: 'attribute-1', level: 'HIGH', accessibleLabel: text }],
      }],
    };
  }
  if (kind === 'PRICE_LADDER') {
    return {
      ...base,
      kind,
      points: [{ id: 'price-1', label: text, amount: 10, distribution: [10, 15, 20, 30, 25] }],
    };
  }
  if (kind === 'INSTRUMENT_REVIEW') {
    return {
      ...base,
      kind,
      issues: [{ id: 'issue-1', questionId: 'question-1', severity: 'HIGH', category: text, explanation: text, revisionSuggestion: text }],
      coverageGaps: [text],
      suggestedCognitiveProbes: [text],
    };
  }
  return {
    ...base,
    kind: 'INTERVIEW_GUIDE',
    opening: text,
    questions: [{ id: 'question-1', topicId: 'topic-1', prompt: text, probes: [text] }],
    moderatorNotes: [text],
    consentAndAccessibilityNotes: [text],
    closing: text,
  };
}

function replaceAtPath(value, path, replacement) {
  const clone = structuredClone(value);
  let target = clone;
  for (const part of path.slice(0, -1)) target = target[part];
  target[path.at(-1)] = replacement;
  return clone;
}

const generatedFieldByKind = Object.freeze([
  {
    kind: 'DIRECTIONAL_DISTRIBUTION',
    path: ['responses', 0, 'quote'],
    expectedPaths: [
      'title', 'summary', 'takeaway', 'confidenceNote', 'cautions.0',
      'audienceSummary.audienceLabel', 'audienceSummary.contextLabel',
      'audienceSummary.attributes.0.label', 'audienceSummary.attributes.0.value',
      'segments.0.label', 'responses.0.profile', 'responses.0.quote',
    ],
  },
  {
    kind: 'RANKED_ITEMS',
    path: ['items', 0, 'rationale'],
    expectedPaths: ['title', 'summary', 'takeaway', 'confidenceNote', 'cautions.0', 'rankingLabel', 'items.0.rationale'],
  },
  {
    kind: 'ATTRIBUTE_MATRIX',
    path: ['brands', 0, 'associations', 0, 'accessibleLabel'],
    expectedPaths: ['title', 'summary', 'takeaway', 'confidenceNote', 'cautions.0', 'matrixLabel', 'brands.0.associations.0.accessibleLabel'],
  },
  {
    kind: 'PRICE_LADDER',
    path: ['points', 0, 'label'],
    expectedPaths: ['title', 'summary', 'takeaway', 'confidenceNote', 'cautions.0', 'points.0.label'],
  },
  {
    kind: 'INSTRUMENT_REVIEW',
    path: ['issues', 0, 'explanation'],
    expectedPaths: [
      'title', 'summary', 'takeaway', 'confidenceNote', 'cautions.0',
      'issues.0.category', 'issues.0.explanation', 'issues.0.revisionSuggestion',
      'coverageGaps.0', 'suggestedCognitiveProbes.0',
    ],
  },
  {
    kind: 'INTERVIEW_GUIDE',
    path: ['questions', 0, 'probes', 0],
    expectedPaths: [
      'title', 'summary', 'takeaway', 'confidenceNote', 'cautions.0', 'opening',
      'questions.0.prompt', 'questions.0.probes.0', 'moderatorNotes.0',
      'consentAndAccessibilityNotes.0', 'closing',
    ],
  },
]);

test('CJK generated-output receipt validates every generated free-text field across result kinds', () => {
  for (const { kind, path, expectedPaths } of generatedFieldByKind) {
    const result = resultFor(kind, localeText['ja-JP']);
    const mixedOutput = replaceAtPath(result, path, 'English-only model-generated text.');
    const localizedReceipt = generatedOutputLanguageReceipt(kind, result, 'ja-JP');
    assert.deepEqual(localizedReceipt.fieldReports.map((entry) => entry.path.join('.')), expectedPaths, kind);

    // The old aggregate report passes because another field contains Japanese.
    assert.equal(languageScriptReport(mixedOutput, 'ja-JP').pass, true, kind);

    const receipt = generatedOutputLanguageReceipt(kind, mixedOutput, 'ja-JP');
    assert.equal(receipt.pass, false, kind);
    assert.deepEqual(receipt.failedPaths, [path], kind);
  }
});

test('CJK generated-output receipt accepts all CJK locales while preserving requester-supplied labels', () => {
  for (const [locale, text] of Object.entries(localeText)) {
    for (const kind of ['RANKED_ITEMS', 'ATTRIBUTE_MATRIX']) {
      const receipt = generatedOutputLanguageReceipt(kind, resultFor(kind, text), locale);
      assert.equal(receipt.pass, true, `${locale} ${kind}`);
      const paths = receipt.fieldReports.map((entry) => entry.path.join('.'));
      if (kind === 'RANKED_ITEMS') assert.equal(paths.includes('items.0.label'), false);
      if (kind === 'ATTRIBUTE_MATRIX') {
        assert.equal(paths.includes('attributes.0.label'), false);
        assert.equal(paths.includes('brands.0.label'), false);
      }
    }
  }
});

const japaneseBrief = {
  prompt: 'この業務チームは共有ワークスペースを採用するでしょうか。',
  audience: '中小企業の業務責任者',
  panelSize: 100,
  outputLocale: 'ja-JP',
  evidencePolicy: 'PRIOR_ONLY',
};

const japaneseDirectionalResult = {
  ...resultFor('DIRECTIONAL_DISTRIBUTION', localeText['ja-JP']),
  audienceSummary: {
    audienceLabel: '中小企業の業務責任者',
    contextLabel: '共有ワークスペースの導入',
    attributes: [
      { label: '役割', value: '業務責任者' },
      { label: '組織規模', value: '中小企業' },
      { label: '課題', value: '引き継ぎの改善' },
    ],
  },
  segments: ['推進者', '実用重視層', '慎重層', '懐疑層'].map((label) => ({ label, values: [10, 15, 20, 30, 25] })),
  responses: [1, 2, 4, 5].map((score) => ({ score, profile: `利用者像${score}`, quote: 'これはモデルによる説明用の引用であり、人間の回答ではありません。' })),
  cautions: ['これは合成的な方向性の結果です。', '人間の参加者を対象とした調査で仮説を確認してください。'],
};

test('pipeline retries a CJK panel result when one generated field is English-only', async () => {
  let panelCalls = 0;
  const result = await runStudyPipeline(requestSchema.parse(japaneseBrief), {
    env: {},
    generate: async (options) => {
      const tags = options.providerOptions.gateway.tags;
      let output;
      if (tags.includes('stage:framing')) {
        output = {
          neutralQuestion: japaneseBrief.prompt,
          decisionContext: '共有ワークスペースに対する方向性を検討します。',
          panelDimensions: ['利用場面', '知覚価値', '導入障壁'],
          assumptions: ['これは合成的な検討です。', '因果関係を主張しません。'],
          evidenceBoundary: '外部ソースは使用しておらず、結果はモデルによる仮説です。',
        };
      } else if (tags.includes('stage:panel')) {
        panelCalls += 1;
        output = panelCalls === 1
          ? { ...japaneseDirectionalResult, summary: 'English-only model-generated summary that must be retried.' }
          : japaneseDirectionalResult;
      } else {
        output = {
          decision: 'accepted',
          critiqueSummary: '重大な証拠整合性またはバイアスの問題は確認されませんでした。',
          credibilityLevel: 'illustrative-only',
          evidenceAlignment: 'not-assessed',
          weakClaims: [],
          biasSignals: [],
        };
      }
      return {
        output,
        response: { modelId: options.model.modelId },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        providerMetadata: { gateway: { cost: '0.001' } },
      };
    },
  });

  assert.equal(panelCalls, 2);
  assert.equal(result.study.summary, japaneseDirectionalResult.summary);
  assert.deepEqual(result.run.stages.find((stage) => stage.stage === 'panel').attempts.map((attempt) => attempt.status), ['failed', 'completed']);
});

test('pipeline retries CJK framing and adjudication when individual generated fields are English-only', async () => {
  let framingCalls = 0;
  let adjudicationCalls = 0;
  const result = await runStudyPipeline(requestSchema.parse(japaneseBrief), {
    env: {},
    generate: async (options) => {
      const tags = options.providerOptions.gateway.tags;
      let output;
      if (tags.includes('stage:framing')) {
        framingCalls += 1;
        output = framingCalls === 1
          ? {
            neutralQuestion: japaneseBrief.prompt,
            decisionContext: 'English-only framing context that must be retried.',
            panelDimensions: ['利用場面', '知覚価値', '導入障壁'],
            assumptions: ['これは合成的な検討です。', '因果関係を主張しません。'],
            evidenceBoundary: '外部ソースは使用しておらず、結果はモデルによる仮説です。',
          }
          : {
            neutralQuestion: japaneseBrief.prompt,
            decisionContext: '共有ワークスペースに対する方向性を検討します。',
            panelDimensions: ['利用場面', '知覚価値', '導入障壁'],
            assumptions: ['これは合成的な検討です。', '因果関係を主張しません。'],
            evidenceBoundary: '外部ソースは使用しておらず、結果はモデルによる仮説です。',
          };
      } else if (tags.includes('stage:panel')) {
        output = japaneseDirectionalResult;
      } else {
        adjudicationCalls += 1;
        output = adjudicationCalls === 1
          ? {
            decision: 'accepted',
            critiqueSummary: '重大な問題は確認されませんでした。',
            credibilityLevel: 'illustrative-only',
            evidenceAlignment: 'not-assessed',
            weakClaims: ['English-only critic finding that must be retried.'],
            biasSignals: [],
          }
          : {
            decision: 'accepted',
            critiqueSummary: '重大な証拠整合性またはバイアスの問題は確認されませんでした。',
            credibilityLevel: 'illustrative-only',
            evidenceAlignment: 'not-assessed',
            weakClaims: [],
            biasSignals: [],
          };
      }
      return {
        output,
        response: { modelId: options.model.modelId },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        providerMetadata: { gateway: { cost: '0.001' } },
      };
    },
  });

  assert.equal(framingCalls, 2);
  assert.equal(adjudicationCalls, 2);
  assert.deepEqual(result.run.stages.find((stage) => stage.stage === 'framing').attempts.map((attempt) => attempt.status), ['failed', 'completed']);
  assert.deepEqual(result.run.stages.find((stage) => stage.stage === 'adjudication').attempts.map((attempt) => attempt.status), ['failed', 'completed']);
  assert.deepEqual(result.run.stages.find((stage) => stage.stage === 'framing').attempts[0].localeValidation, {
    failedPaths: ['decisionContext'],
    unexpectedScripts: [],
  });
  assert.deepEqual(result.run.stages.find((stage) => stage.stage === 'adjudication').attempts[0].localeValidation, {
    failedPaths: ['weakClaims.0'],
    unexpectedScripts: [],
  });
});
