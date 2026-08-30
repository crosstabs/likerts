import assert from 'node:assert/strict';
import test from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createLocalizationScorecardHandler } from '../api/localization-scorecard.js';
import { sampleStudies } from '../content/sample-studies.mjs';
import {
  createLocalizationBrowserReleaseFixture,
  TEST_BROWSER_NOW,
} from '../test/helpers/localization-browser-release-fixture.js';
import { LIMITATIONS_URI, LOCALIZATION_SCORECARD_URI, MCP_CONTRACT_VERSION, METHODOLOGY_URI } from './mcp-contract.js';
import { createAnonymousStudyAdmission, McpAdmissionError } from './mcp-abuse-controls.js';
import { createLikertsMcpHandler } from './mcp-server.js';
import { SAMPLE_STUDY_CATALOG_URI, sampleStudyResourceUri } from './sample-study-catalog.js';
import { normalizeLocalizationRequest } from './localization-request.js';

const localizationReceiptFor = (reportLocale = 'en-US') => normalizeLocalizationRequest({
  localization: {
    schemaVersion: 'study-localization-v1',
    marketId: 'GLOBAL',
    reportLocale,
    sourceLocales: [],
    retrieval: { policy: 'ANY', locales: [] },
    instrumentLocale: reportLocale,
  },
});

const validBrief = {
  prompt: 'Would this audience adopt a shared workspace?',
  audience: 'Small business operations leaders',
  panelSize: 100,
  evidencePolicy: 'PRIOR_ONLY',
};

const validSegmentPerspectiveRequest = {
  studyId: 'study_12345678',
  runId: 'run_12345678',
  expectedTurnIndex: 0,
  parentTurnId: null,
  segment: { id: 'segment-1', label: 'Ages 25–34', distribution: [5, 9, 12, 34, 40] },
  question: 'What is the strongest modeled objection to this concept?',
  intent: 'OBJECTION',
  history: [],
  grounding: {
    localizationReceipt: localizationReceiptFor(),
    outputLocale: 'en-US',
    evidenceHash: null,
    populationFrameHash: null,
    researchDesignHash: null,
    modelCardHash: null,
    researchMethod: 'CONCEPT_TEST',
    researchMethodVersion: 'concept-test-v1',
    segments: [{ id: 'segment-1', label: 'Ages 25–34', distribution: [5, 9, 12, 34, 40] }],
    evidence: [],
    assumptions: [],
    unsupportedCharacteristics: [],
  },
};

const mockStudy = {
  study: {
    title: 'Synthetic workspace adoption',
    takeaway: 'Use this directional hypothesis to design research with real participants.',
    cautions: ['Synthetic output only.'],
  },
  meta: {
    evidenceMode: 'PRIOR_ONLY',
    credibility: { level: 'illustrative-only', observedHumanResponses: false },
  },
  run: { studyId: 'study_test', runId: 'run_test', status: 'completed' },
  persistence: { status: 'session-only' },
};

function responseRecorder() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: '',
    headers,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value = '') { this.body += value; return this; },
  };
}

function browserReleaseEvidenceContext() {
  const browser = createLocalizationBrowserReleaseFixture();
  return {
    journeyAttestation: browser.attestation,
    journeyPromotion: browser.promotion,
    trustedPromotionKeys: browser.trustedPromotionKeys,
    buildIdentity: browser.buildIdentity,
    nativeReviewEvidenceByLocale: {},
    nativeReviewBindingsByLocale: {},
    trustedNativeReviewerKeys: {},
  };
}

async function withClient(options, callback) {
  const handler = createLikertsMcpHandler({
    reportError: () => {},
    localizationReleaseEvidenceProvider: async () => null,
    ...options,
  });
  const transport = new StreamableHTTPClientTransport(new URL('https://likerts.example/api/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const client = new Client(
    { name: 'likerts-contract-test', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  );
  try {
    await client.connect(transport);
    assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
    return await callback(client);
  } finally {
    await client.close();
    await handler.close();
  }
}

test('MCP advertises the stable public tools and immutable methodology resources', async () => {
  await withClient({ runStudy: async () => mockStudy }, async (client) => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ['explore_synthetic_segment', 'get_sample_study', 'list_sample_studies', 'run_synthetic_study', 'validate_research_brief']);
    const runTool = tools.find((tool) => tool.name === 'run_synthetic_study');
    assert.match(runTool.description, /model-generated/i);
    assert.match(runTool.description, /never surveys humans/i);
    assert.match(runTool.description, /population frame/i);
    assert.equal(runTool.annotations.openWorldHint, true);
    assert.ok(runTool.outputSchema);
    const exploreTool = tools.find((tool) => tool.name === 'explore_synthetic_segment');
    assert.match(exploreTool.description, /not a participant quotation/i);
    assert.equal(exploreTool.annotations.idempotentHint, false);
    const listTool = tools.find((tool) => tool.name === 'list_sample_studies');
    assert.equal(listTool.annotations.readOnlyHint, true);
    assert.equal(listTool.annotations.openWorldHint, false);

    const { resources } = await client.listResources();
    assert.deepEqual(
      resources.map((resource) => resource.uri).sort(),
      [LIMITATIONS_URI, LOCALIZATION_SCORECARD_URI, METHODOLOGY_URI, SAMPLE_STUDY_CATALOG_URI, ...sampleStudies.map((study) => sampleStudyResourceUri(study.slug))].sort(),
    );

    const methodology = await client.readResource({ uri: METHODOLOGY_URI });
    assert.match(methodology.contents[0].text, /does not survey or observe people/i);
    assert.match(methodology.contents[0].text, /population frame/i);
    assert.match(methodology.contents[0].text, /demographic fit does not prove attitudinal accuracy/i);
    assert.match(methodology.contents[0].text, /model card/i);
    const limitations = await client.readResource({ uri: LIMITATIONS_URI });
    assert.match(limitations.contents[0].text, /not a perfect distributed rate or cost limit/i);
    const localizationScorecard = await client.readResource({ uri: LOCALIZATION_SCORECARD_URI });
    assert.equal(localizationScorecard.ttlMs, 0);
    assert.equal(localizationScorecard.cacheScope, 'private');
    const localizationPayload = JSON.parse(localizationScorecard.contents[0].text);
    assert.equal(localizationPayload.locales.find((locale) => locale.locale === 'ja-JP').launchStatus, 'NATIVE_REVIEW_REQUIRED');
    assert.equal(localizationPayload.methodology.accuracyBoundary.includes('does not prove attitudinal accuracy'), true);
    const sampleCatalog = await client.readResource({ uri: SAMPLE_STUDY_CATALOG_URI });
    assert.equal(JSON.parse(sampleCatalog.contents[0].text).studies.length, 10);
  });
});

test('MCP scorecard matches REST release evidence without accepting request-derived authority', async () => {
  const context = browserReleaseEvidenceContext();
  const providerCalls = [];
  const provider = (...args) => {
    providerCalls.push(args);
    return context;
  };
  const restHandler = createLocalizationScorecardHandler({
    releaseEvidenceProvider: async () => context,
    scorecardNow: TEST_BROWSER_NOW,
  });
  const restResponse = responseRecorder();
  await restHandler({ method: 'GET', headers: {} }, restResponse);
  const restPayload = JSON.parse(restResponse.body);

  await withClient({
    localizationReleaseEvidenceProvider: provider,
    localizationScorecardNow: TEST_BROWSER_NOW,
  }, async (client) => {
    await client.readResource({ uri: METHODOLOGY_URI });
    assert.equal(providerCalls.length, 0);
    await assert.rejects(
      client.readResource({ uri: `${LOCALIZATION_SCORECARD_URI}?evidenceUrl=https://attacker.invalid/evidence.json` }),
    );
    assert.equal(providerCalls.length, 0);

    const first = await client.readResource({ uri: LOCALIZATION_SCORECARD_URI });
    assert.equal(first.ttlMs, 0);
    assert.equal(first.cacheScope, 'private');
    assert.deepEqual(JSON.parse(first.contents[0].text), restPayload);
    assert.equal(restPayload.automatedJourneyVerification.status, 'PUBLISHED');
    assert.equal(restPayload.automatedJourneyVerification.publicationBinding, 'SIGNED_PROMOTION_RECORD');
    assert.deepEqual(providerCalls, [[]]);

    await client.readResource({ uri: LOCALIZATION_SCORECARD_URI });
    assert.deepEqual(providerCalls, [[], []]);
  });
});

test('MCP scorecard sanitizes provider and composition failures instead of falling back to pending', async () => {
  const cases = [
    {
      diagnostic: 'secret provider transport detail',
      provider: async () => { throw new Error('secret provider transport detail'); },
    },
    {
      diagnostic: 'invalid native-review context',
      provider: async () => ({ nativeReviewEvidenceByLocale: {} }),
    },
  ];

  for (const item of cases) {
    let providerCalls = 0;
    const reported = [];
    await withClient({
      localizationReleaseEvidenceProvider: async () => {
        providerCalls += 1;
        return item.provider();
      },
      reportError: (error) => { reported.push(error); },
    }, async (client) => {
      await assert.rejects(
        client.readResource({ uri: LOCALIZATION_SCORECARD_URI }),
        (error) => {
          assert.equal(error.code, -32_603);
          assert.equal(error.data?.code, 'LOCALIZATION_RELEASE_EVIDENCE_UNAVAILABLE');
          assert.equal(error.message, 'Localization release evidence is temporarily unavailable.');
          assert.equal(JSON.stringify({ message: error.message, data: error.data }).includes(item.diagnostic), false);
          return true;
        },
      );
    });
    assert.equal(providerCalls, 1);
    assert.ok(reported.some((error) => error.message.includes(item.diagnostic)));
  }
});

test('the same stateless endpoint remains compatible with 2025-era Streamable HTTP clients', async () => {
  const handler = createLikertsMcpHandler({
    runStudy: async () => mockStudy,
    reportError: () => {},
    localizationReleaseEvidenceProvider: async () => null,
  });
  const transport = new StreamableHTTPClientTransport(new URL('https://likerts.example/api/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const client = new Client({ name: 'likerts-legacy-contract-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    assert.equal(client.getNegotiatedProtocolVersion(), '2025-11-25');
    const result = await client.callTool({ name: 'validate_research_brief', arguments: { brief: validBrief } });
    assert.equal(result.structuredContent.validation.valid, true);
  } finally {
    await client.close();
    await handler.close();
  }
});

test('validate_research_brief normalizes valid input and reports stable issues without a model call', async () => {
  let modelCalls = 0;
  await withClient({ runStudy: async () => { modelCalls += 1; return mockStudy; } }, async (client) => {
    const valid = await client.callTool({ name: 'validate_research_brief', arguments: { brief: validBrief } });
    assert.equal(valid.isError, undefined);
    assert.equal(valid.structuredContent.validation.valid, true);
    assert.equal(valid.structuredContent.validation.normalizedInput.assumptions, '');
    assert.equal(valid.structuredContent.validation.normalizedInput.researchMethod, 'GENERAL_LIKERT');
    assert.equal(MCP_CONTRACT_VERSION, '2.1.0');
    assert.equal(valid.structuredContent.contractVersion, '2.1.0');
    assert.equal(valid.structuredContent.validation.normalizedInput.localization.market.id, 'GLOBAL');
    assert.equal(valid.structuredContent.validation.normalizedInput.localization.market.retrievalGeography, null);
    assert.equal(Object.hasOwn(valid.structuredContent.validation.normalizedInput, 'searchCountry'), false);
    assert.equal(valid.structuredContent.validation.estimatedModelCalls, 3);

    const invalid = await client.callTool({
      name: 'validate_research_brief',
      arguments: { brief: { prompt: 'Too short', audience: 'x', panelSize: 900 } },
    });
    assert.equal(invalid.structuredContent.validation.valid, false);
    assert.ok(invalid.structuredContent.validation.issues.some((issue) => issue.code === 'INVALID_PROMPT'));
    const invalidMethod = await client.callTool({
      name: 'validate_research_brief',
      arguments: { brief: { ...validBrief, researchMethod: 'CONCEPT_TEST' } },
    });
    assert.ok(invalidMethod.structuredContent.validation.issues.some((issue) => issue.code === 'INVALID_METHOD_CONFIG'));
    const plannedMarket = await client.callTool({
      name: 'validate_research_brief',
      arguments: { brief: { ...validBrief, market: 'Indonesia', outputLocale: 'id-ID', searchCountry: 'ID' } },
    });
    assert.equal(plannedMarket.structuredContent.validation.valid, false);
    assert.ok(plannedMarket.structuredContent.validation.issues.some((issue) => issue.code === 'INVALID_MARKET'));
    const plannedLocale = await client.callTool({
      name: 'validate_research_brief',
      arguments: { brief: { ...validBrief, market: 'United States', outputLocale: 'id-ID', searchCountry: 'US' } },
    });
    assert.equal(plannedLocale.structuredContent.validation.valid, false);
    assert.ok(plannedLocale.structuredContent.validation.issues.some((issue) => issue.code === 'INVALID_OUTPUT_LOCALE'));
    assert.equal(JSON.stringify(invalid.structuredContent).includes('Zod'), false);
  });
  assert.equal(modelCalls, 0);
});

test('run_synthetic_study returns structured, explicitly synthetic and evidence-aware output', async () => {
  let received;
  let releases = 0;
  const admission = {
    async acquire() {
      return () => { releases += 1; };
    },
  };
  await withClient({ runStudy: async (input) => { received = input; return mockStudy; }, admission }, async (client) => {
    const result = await client.callTool({ name: 'run_synthetic_study', arguments: validBrief });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.synthetic, true);
    assert.equal(result.structuredContent.evidenceAware, true);
    assert.equal(result.structuredContent.result.meta.credibility.observedHumanResponses, false);
    assert.match(result.content[0].text, /does not contain observed human responses/i);
  });
  assert.equal(received.evidencePolicy, 'PRIOR_ONLY');
  assert.equal(received.localization.schemaVersion, 'study-localization-v1');
  assert.equal(received.localization.market.id, 'GLOBAL');
  assert.equal(received.localization.market.retrievalGeography, null);
  assert.equal(Object.hasOwn(received, 'searchCountry'), false);
  assert.equal(releases, 1);
});

test('MCP rejects unresolved legacy custom markets before admission or generation', async () => {
  let admissionCalls = 0;
  let generationCalls = 0;
  const admission = {
    async acquire() {
      admissionCalls += 1;
      return () => {};
    },
  };

  await withClient({
    admission,
    runStudy: async () => {
      generationCalls += 1;
      throw new Error('generation must not run');
    },
  }, async (client) => {
    const brief = {
      ...validBrief,
      market: 'Quebec retail',
      outputLocale: 'fr-FR',
      searchCountry: 'CA',
      searchLocation: 'Montreal, Quebec',
    };
    const validation = await client.callTool({ name: 'validate_research_brief', arguments: { brief } });
    assert.equal(validation.structuredContent.validation.valid, false);
    assert.ok(validation.structuredContent.validation.issues.some((issue) => issue.code === 'UNKNOWN_MARKET'));

    const result = await client.callTool({ name: 'run_synthetic_study', arguments: brief });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, 'UNKNOWN_MARKET');
    assert.equal(result.structuredContent.error.retryable, false);
  });

  assert.equal(admissionCalls, 0);
  assert.equal(generationCalls, 0);
});

test('explore_synthetic_segment is a separate bounded non-participant tool', async () => {
  let received;
  let releases = 0;
  const admission = { async acquire() { return () => { releases += 1; }; } };
  const response = {
    disclosure: 'Model-generated perspective—not a participant quotation.',
    answer: 'The strongest modeled objection is implementation risk under the supplied conditions.',
    synthetic: true,
    participant: false,
  };
  await withClient({ runStudy: async () => mockStudy, runSegmentPerspective: async (input) => { received = input; return response; }, admission }, async (client) => {
    const result = await client.callTool({ name: 'explore_synthetic_segment', arguments: validSegmentPerspectiveRequest });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.synthetic, true);
    assert.equal(result.structuredContent.participant, false);
    assert.equal(result.structuredContent.result.disclosure, response.disclosure);
    assert.match(result.content[0].text, /not a participant quotation/i);
  });
  assert.equal(received.segment.id, 'segment-1');
  assert.equal(releases, 1);
});

test('explore_synthetic_segment rejects planned and unknown locales before admission or generation', async () => {
  let admissionCalls = 0;
  let generationCalls = 0;
  const admission = {
    async acquire() {
      admissionCalls += 1;
      return () => {};
    },
  };

  await withClient({
    runStudy: async () => mockStudy,
    runSegmentPerspective: async () => {
      generationCalls += 1;
      throw new Error('generation must not run');
    },
    admission,
  }, async (client) => {
    for (const [outputLocale, expectedCode] of [
      ['id-ID', 'UNSUPPORTED_REPORT_LOCALE'],
      ['xx-YY', 'UNKNOWN_LOCALE'],
    ]) {
      const result = await client.callTool({
        name: 'explore_synthetic_segment',
        arguments: {
          ...validSegmentPerspectiveRequest,
          grounding: { ...validSegmentPerspectiveRequest.grounding, outputLocale },
        },
      });

      assert.equal(result.isError, true, outputLocale);
      assert.equal(result.structuredContent.error.code, expectedCode, outputLocale);
      assert.equal(result.structuredContent.error.retryable, false, outputLocale);
    }
  });

  assert.equal(admissionCalls, 0);
  assert.equal(generationCalls, 0);
});

test('explore_synthetic_segment rejects absent, custom, and forged localization before admission or generation', async () => {
  let admissionCalls = 0;
  let generationCalls = 0;
  const admission = { async acquire() { admissionCalls += 1; return () => {}; } };
  await withClient({
    runStudy: async () => mockStudy,
    runSegmentPerspective: async () => { generationCalls += 1; throw new Error('generation must not run'); },
    admission,
  }, async (client) => {
    const cases = [
      { name: 'absent', grounding: (() => { const grounding = { ...validSegmentPerspectiveRequest.grounding }; delete grounding.localizationReceipt; return grounding; })(), code: 'INVALID_LOCALIZATION_RECEIPT' },
      { name: 'custom', grounding: { ...validSegmentPerspectiveRequest.grounding, localizationReceipt: { ...localizationReceiptFor(), market: { ...localizationReceiptFor().market, id: 'LEGACY_CUSTOM', kind: 'legacy-custom' } } }, code: 'UNKNOWN_MARKET' },
      { name: 'forged', grounding: { ...validSegmentPerspectiveRequest.grounding, localizationReceipt: { ...localizationReceiptFor(), registryVersion: 'forged-registry' } }, code: 'INVALID_LOCALIZATION_RECEIPT' },
    ];
    for (const item of cases) {
      const result = await client.callTool({ name: 'explore_synthetic_segment', arguments: { ...validSegmentPerspectiveRequest, grounding: item.grounding } });
      assert.equal(result.isError, true, item.name);
      assert.equal(result.structuredContent.error.code, item.code, item.name);
      assert.equal(JSON.stringify(result).includes('forged-registry'), false);
    }
  });
  assert.equal(admissionCalls, 0);
  assert.equal(generationCalls, 0);
});

test('sample-study MCP tools list and get frozen studies without model or admission calls', async () => {
  let modelCalls = 0;
  let admissionCalls = 0;
  const admission = {
    async acquire() {
      admissionCalls += 1;
      return () => {};
    },
  };
  await withClient({ runStudy: async () => { modelCalls += 1; return mockStudy; }, admission }, async (client) => {
    const listed = await client.callTool({ name: 'list_sample_studies', arguments: { locale: 'ja-JP', limit: 3 } });
    assert.equal(listed.isError, undefined);
    assert.equal(listed.structuredContent.synthetic, true);
    assert.equal(listed.structuredContent.generated, false);
    assert.equal(listed.structuredContent.catalog.studies.length, 1);
    assert.equal(listed.structuredContent.catalog.studies[0].locale, 'ja-JP');
    assert.equal(listed.structuredContent.catalog.studies[0].sampleLineage.source, 'static-sample-library');
    assert.match(listed.content[0].text, /not observed human research/i);

    const slug = sampleStudies[0].slug;
    const fetched = await client.callTool({ name: 'get_sample_study', arguments: { slug } });
    assert.equal(fetched.isError, undefined);
    assert.equal(fetched.structuredContent.study.brief.slug, slug);
    assert.equal(fetched.structuredContent.study.sampleLineage.slug, slug);
    assert.equal(fetched.structuredContent.study.sampleLineage.source, 'static-sample-library');
    assert.match(fetched.structuredContent.study.canonicalUrl, /^https:\/\/likerts\.com\//);
    assert.match(fetched.content[0].text, /No people were surveyed/i);
  });
  assert.equal(modelCalls, 0);
  assert.equal(admissionCalls, 0);
});

test('get_sample_study reports unknown slugs without leaking internals', async () => {
  await withClient({ runStudy: async () => mockStudy }, async (client) => {
    const result = await client.callTool({ name: 'get_sample_study', arguments: { slug: 'missing-study' } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, 'SAMPLE_STUDY_NOT_FOUND');
    assert.equal(JSON.stringify(result).includes('ENOENT'), false);
  });
});

test('run_synthetic_study never exposes unexpected internal errors', async () => {
  await withClient({ runStudy: async () => { throw new Error('secret upstream payload'); } }, async (client) => {
    const result = await client.callTool({ name: 'run_synthetic_study', arguments: validBrief });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, 'INTERNAL_ERROR');
    assert.equal(JSON.stringify(result).includes('secret upstream payload'), false);
  });
});

test('run_synthetic_study sanitizes messages from a shared admission hook', async () => {
  const admission = {
    async acquire() {
      throw new McpAdmissionError('PRIVATE_POLICY_CODE', 'secret shared-store diagnostic');
    },
  };
  await withClient({ runStudy: async () => { throw new Error('must not run'); }, admission }, async (client) => {
    const result = await client.callTool({ name: 'run_synthetic_study', arguments: validBrief });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, 'ADMISSION_STORE_UNAVAILABLE');
    assert.equal(JSON.stringify(result).includes('secret shared-store diagnostic'), false);
  });
});

test('anonymous study admission enforces per-client, concurrency, budget, and external hooks', async () => {
  let timestamp = 0;
  const admission = createAnonymousStudyAdmission({
    maximumConcurrency: 1,
    runsPerClientWindow: 2,
    clientWindowMs: 1_000,
    processDailyBudget: 2,
    now: () => timestamp,
  });
  const release = await admission.acquire({ clientKey: 'a' });
  await assert.rejects(() => admission.acquire({ clientKey: 'b' }), (error) => error instanceof McpAdmissionError && error.code === 'CONCURRENCY_LIMIT');
  await release();
  const releaseSecond = await admission.acquire({ clientKey: 'a' });
  await releaseSecond();
  await assert.rejects(() => admission.acquire({ clientKey: 'a' }), (error) => error.code === 'RATE_LIMITED');
  timestamp = 2_000;
  await assert.rejects(() => admission.acquire({ clientKey: 'c' }), (error) => error.code === 'BUDGET_EXHAUSTED');

  const externallyDenied = createAnonymousStudyAdmission({ externalCheck: async () => ({ allowed: false, code: 'SHARED_BUDGET_DENIED' }) });
  await assert.rejects(
    () => externallyDenied.acquire({ clientKey: 'a' }),
    (error) => error.code === 'ADMISSION_STORE_UNAVAILABLE' && !error.message.includes('SHARED_BUDGET_DENIED'),
  );
});
