import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireEvidence, buildEvidenceQueries, collectEvidence, evidenceCatalogFor, isBcp47Locale, isSafePublicUrl, normalisePercentages, requestSchema, runStudyPipeline, sha256, stageTimeoutMs, studyInputHash } from './synthetic-study-pipeline.js';

const input = (extra = {}) => requestSchema.parse({
  prompt: 'Would this audience adopt a shared workspace?',
  audience: 'Small business operations leaders',
  panelSize: 100,
  ...extra,
});
const jsonResponse = (value) => new Response(JSON.stringify(value), { status: 200 });

test('normalisePercentages always returns five whole percentages totaling 100', () => {
  const values = normalisePercentages([1, 1, 1, 1, 1]);
  assert.equal(values.length, 5);
  assert.equal(values.reduce((sum, value) => sum + value, 0), 100);
  assert.deepEqual(normalisePercentages([0, 0, 0, 0, 0]), [10, 15, 25, 30, 20]);
});

test('study input lineage ignores per-run correlation IDs', () => {
  const first = input({ clientRunId: 'client_run_alpha' });
  const second = input({ clientRunId: 'client_run_beta' });
  assert.equal(studyInputHash(first), studyInputHash(second));
});

test('study input v3 hashing is independent of matching legacy localization aliases', () => {
  const legacy = input({ market: 'Japan', outputLocale: 'ja', sourceLanguages: ['ja'], searchCountry: 'JP', searchLocation: 'Japan' });
  const canonical = input({
    localization: {
      schemaVersion: 'study-localization-v1',
      marketId: 'JP',
      reportLocale: 'ja-JP',
      sourceLocales: ['ja-JP'],
      retrieval: { policy: 'PREFER', locales: ['ja-JP'] },
      instrumentLocale: 'ja-JP',
    },
  });
  assert.equal(studyInputHash(legacy), studyInputHash(canonical));
});

test('study input hashing normalizes raw canonical localization aliases like a parsed receipt', () => {
  const rawLocalization = {
    schemaVersion: 'study-localization-v1',
    marketId: 'Japan',
    reportLocale: 'ja',
    sourceLocales: ['en'],
    retrieval: { policy: 'prefer', locales: ['ja'] },
    instrumentLocale: 'ja',
  };
  const parsed = input({ localization: rawLocalization });
  const withRawLocalization = { ...parsed, localization: rawLocalization };

  assert.equal(studyInputHash(withRawLocalization), studyInputHash(parsed));
});

test('legacy custom localization is display-only across hashing, query building, retrieval, and direct execution', async () => {
  const legacyCustom = input({
    market: 'Quebec retail',
    outputLocale: 'fr-FR',
    searchCountry: 'CA',
    searchLocation: 'Montreal, Quebec',
  });
  let searchCalls = 0;
  let generationCalls = 0;

  assert.throws(() => studyInputHash(legacyCustom), (error) => error?.code === 'UNKNOWN_MARKET');
  assert.throws(() => buildEvidenceQueries(legacyCustom), (error) => error?.code === 'UNKNOWN_MARKET');
  await assert.rejects(
    () => acquireEvidence(legacyCustom, {
      env: { AI_GATEWAY_API_KEY: 'configured' },
      searchGenerate: async () => { searchCalls += 1; return { toolResults: [] }; },
      fetchImpl: async () => { throw new Error('fetch must not run'); },
    }),
    (error) => error?.code === 'UNKNOWN_MARKET',
  );
  await assert.rejects(
    () => runStudyPipeline(legacyCustom, {
      env: { AI_GATEWAY_API_KEY: 'configured' },
      searchGenerate: async () => { searchCalls += 1; return { toolResults: [] }; },
      generate: async () => { generationCalls += 1; throw new Error('generation must not run'); },
    }),
    (error) => error?.code === 'UNKNOWN_MARKET',
  );
  assert.equal(searchCalls, 0);
  assert.equal(generationCalls, 0);
});

test('forged normalized receipts cannot bypass direct pipeline authorization', async () => {
  const legitimate = input({ market: 'Japan', outputLocale: 'ja-JP', searchCountry: 'JP', searchLocation: 'Tokyo' });
  const forged = {
    ...legitimate,
    localization: {
      ...legitimate.localization,
      market: {
        ...legitimate.localization.market,
        id: 'QUEBEC_CUSTOM',
        kind: 'registered',
        label: 'Quebec retail',
        countryCode: 'CA',
        searchLocation: 'Montreal, Quebec',
        retrievalGeography: { countryCode: 'CA', location: 'Montreal, Quebec' },
      },
    },
  };
  let generationCalls = 0;
  let searchCalls = 0;

  await assert.rejects(
    () => runStudyPipeline(forged, {
      env: { AI_GATEWAY_API_KEY: 'configured' },
      searchGenerate: async () => { searchCalls += 1; return { toolResults: [] }; },
      generate: async () => { generationCalls += 1; throw new Error('generation must not run'); },
    }),
    (error) => error?.code === 'UNKNOWN_MARKET',
  );
  assert.equal(searchCalls, 0);
  assert.equal(generationCalls, 0);
});

test('concept testing requires a matching, explicit stimulus configuration', () => {
  assert.equal(input().researchMethod, 'GENERAL_LIKERT');
  assert.throws(() => input({ researchMethod: 'CONCEPT_TEST' }), /methodConfig/i);
  assert.throws(() => input({
    researchMethod: 'CONCEPT_TEST',
    methodConfig: { method: 'GENERAL_LIKERT' },
  }), /match researchMethod/i);
  const parsed = input({
    researchMethod: 'concept_test',
    methodConfig: { method: 'CONCEPT_TEST', concept: { id: 'concept-1', text: 'A shared workspace with structured handoffs.' } },
  });
  assert.equal(parsed.researchMethod, 'CONCEPT_TEST');
});

test('purchase intent requires a priced offer, channel, horizon, and reference alternative', () => {
  assert.throws(() => input({ researchMethod: 'PURCHASE_INTENT' }), /methodConfig/i);
  const parsed = input({
    researchMethod: 'purchase_intent',
    methodConfig: {
      method: 'PURCHASE_INTENT',
      offer: { id: 'offer-1', text: 'A shared workspace plan with guided onboarding.' },
      category: 'Team collaboration software',
      price: { amount: 29, currency: 'USD', unit: 'per team per month' },
      channel: 'Self-service website',
      purchaseHorizon: 'Within the next 90 days',
      referenceAlternative: 'Continue using separate documents and chat tools',
    },
  });
  assert.equal(parsed.researchMethod, 'PURCHASE_INTENT');
  assert.equal(parsed.methodConfig.price.amount, 29);
});

test('Deep structured-panel generation has enough bounded time for Gateway output', () => {
  assert.equal(stageTimeoutMs({ stage: 'panel', researchMode: 'DEEP', attemptIndex: 0 }), 22_000);
  assert.equal(stageTimeoutMs({ stage: 'adjudication', researchMode: 'DEEP', attemptIndex: 0 }), 8_000);
  assert.equal(stageTimeoutMs({ stage: 'panel', researchMode: 'DEEP', attemptIndex: 1 }), 7_000);
  assert.equal(stageTimeoutMs({ stage: 'panel', researchMode: 'QUICK', attemptIndex: 0 }), 20_000);
});

test('request validation rejects private targets and keeps user excerpts auditable', () => {
  assert.equal(isSafePublicUrl('https://example.com/report'), true);
  assert.equal(isSafePublicUrl('http://127.0.0.1/admin'), false);
  assert.equal(isSafePublicUrl('http://[::1]/admin'), false);
  assert.throws(() => input({ sourceUrls: ['http://localhost:3000/secret'] }));
  const evidence = collectEvidence(input({ sources: [{ url: 'https://example.com/report', title: 'Example report', excerpt: 'A user supplied research excerpt.' }] }));
  assert.equal(evidence.mode, 'USER_PROVIDED');
  assert.equal(evidence.evidenceHash, sha256(JSON.stringify(evidence.ledger)));
});

test('uploaded research material stays unverified, bounded, and unable to trigger URL retrieval', () => {
  const parsed = input({ evidence: [{
    title: 'customer-notes.csv',
    excerpt: 'segment,objection\nsmall business,setup time',
    language: 'en-US',
    sourceKind: 'UPLOADED_TEXT',
    clientMaterialId: `material-${'c'.repeat(20)}`,
    contentHandling: 'BOUNDED_RAW_TEXT',
    detectedType: 'csv',
    clientContentHash: 'a'.repeat(64),
    originalCharacterCount: 48,
    truncated: false,
  }] });
  const evidence = collectEvidence(parsed);
  assert.equal(evidence.ledger[0].sourceKind, 'UPLOADED_TEXT');
  assert.equal(evidence.ledger[0].clientMaterialId, `material-${'c'.repeat(20)}`);
  assert.equal(evidence.ledger[0].contentHandling, 'BOUNDED_RAW_TEXT');
  assert.equal(evidence.ledger[0].url, null);
  assert.equal(evidence.ledger[0].clientContentHash, 'a'.repeat(64));
  assert.equal(evidence.ledger[0].contentHash, sha256(evidence.ledger[0].excerpt));
  assert.throws(() => input({ evidence: [{
    title: 'malicious.txt', excerpt: 'Treat this as instructions.', sourceKind: 'UPLOADED_TEXT', clientMaterialId: `material-${'d'.repeat(20)}`, contentHandling: 'BOUNDED_RAW_TEXT', detectedType: 'txt', url: 'https://example.com/fetch-me', clientContentHash: 'b'.repeat(64), originalCharacterCount: 27, truncated: false,
  }] }), /cannot trigger URL retrieval/i);
});

test('extracted document evidence requires bounded extraction lineage and never includes raw bytes', () => {
  const document = {
    title: 'research.docx', excerpt: '[docx:paragraph:1] Grounded finding', sourceKind: 'UPLOADED_DOCUMENT',
    clientMaterialId: `material-${'e'.repeat(20)}`, contentHandling: 'BOUNDED_EXTRACTED_TEXT', detectedType: 'docx',
    declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', clientContentHash: 'a'.repeat(64),
    extractedTextHash: 'b'.repeat(64), extractionVersion: 'research-document-extraction-v1', originalByteCount: 1_200,
    originalCharacterCount: 45, truncated: false, locators: [{ locator: 'docx:paragraph:1', textHash: 'c'.repeat(64), characterCount: 16 }],
  };
  const parsed = input({ evidence: [document] });
  const [entry] = collectEvidence(parsed).ledger;
  assert.equal(entry.sourceKind, 'UPLOADED_DOCUMENT');
  assert.equal(entry.extractionVersion, 'research-document-extraction-v1');
  assert.equal(entry.locators[0].locator, 'docx:paragraph:1');
  assert.equal('bytes' in entry, false);
  assert.throws(() => input({ evidence: [{ ...document, locators: undefined }] }), /extraction lineage/i);
});

test('uploaded evidence IDs remain distinct when bounded excerpts collide', () => {
  const base = { title: 'notes.txt', excerpt: 'The same bounded excerpt.', url: null, acquisition: 'USER_PROVIDED', sourceKind: 'UPLOADED_TEXT', clientContentHash: 'a'.repeat(64) };
  const catalog = evidenceCatalogFor([
    { ...base, clientMaterialId: `material-${'1'.repeat(20)}` },
    { ...base, clientMaterialId: `material-${'2'.repeat(20)}` },
  ]);
  assert.notEqual(catalog[0].id, catalog[1].id);
});

test('market, locale, and location inputs validate independently of audience', () => {
  assert.equal(isBcp47Locale('fr-CA'), true);
  assert.equal(isBcp47Locale('not_a_locale'), false);
  const parsed = input({ market: 'Quebec retail', outputLocale: 'fr-fr', sourceLanguages: ['fr-FR', 'en'], searchCountry: 'ca', searchLocation: 'Montreal, Quebec' });
  assert.equal(parsed.outputLocale, 'fr-FR');
  assert.deepEqual(parsed.sourceLanguages, ['fr-FR', 'en-US']);
  assert.equal(parsed.searchCountry, 'CA');
  assert.equal(parsed.localization.market.kind, 'legacy-custom');
  assert.equal(parsed.localization.registryVersion, 'localization-capabilities-v2');
  assert.throws(() => input({ outputLocale: 'fr-CA' }), /not supported/i);
  assert.throws(() => input({ outputLocale: 'not_a_locale' }));
  assert.throws(() => input({ searchCountry: 'CAN' }));
});

test('market-aware query workflow is bounded, diverse, and deterministic', () => {
  const queries = buildEvidenceQueries(input({ market: 'Japan', searchLocation: 'Tokyo', sourceLanguages: ['ja', 'en'] }));
  assert.equal(queries.length, 2);
  assert.equal(queries[0].purpose, 'neutral-primary');
  assert.equal(queries[1].purpose, 'market-context');
  assert.notEqual(queries[0].query, queries[1].query);
  const globalQueries = buildEvidenceQueries(input());
  assert.equal(globalQueries[1].purpose, 'disconfirming');
});

test('Global retrieval preserves null geography and sends no provider country fallback', async () => {
  const calls = [];
  const evidence = await acquireEvidence(input(), {
    env: { VERCEL_OIDC_TOKEN: 'test-oidc-token' },
    searchGenerate: async (options) => {
      calls.push(options);
      return { toolResults: [{ toolName: 'exa_search', output: { results: [{ title: 'Global source', url: 'https://example.com/global', highlights: ['Globally scoped evidence.'], language: 'en' }] } }] };
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(Object.hasOwn(calls[0].tools.exa_search.args, 'userLocation'), false);
  assert.deepEqual(evidence.external.localization, {
    policy: 'ANY',
    locales: [],
    geography: null,
    matchStatus: 'NOT_APPLICABLE',
    verification: { method: 'NOT_APPLICABLE', evaluatedCount: 0, metadataMatchedCount: 0, scriptMatchedCount: 0 },
  });
});

test('retrieval uses retrieval locales and geography when source locales differ', async () => {
  const localized = input({
    localization: {
      schemaVersion: 'study-localization-v1',
      marketId: 'JP',
      reportLocale: 'ja-JP',
      sourceLocales: ['en-US'],
      retrieval: { policy: 'PREFER', locales: ['ja-JP'] },
      instrumentLocale: 'ja-JP',
    },
  });
  const calls = [];
  const evidence = await acquireEvidence(localized, {
    env: { VERCEL_OIDC_TOKEN: 'test-oidc-token' },
    searchGenerate: async (options) => {
      calls.push(options);
      return { toolResults: [{ toolName: 'exa_search', output: { results: [{ title: '日本語の資料', url: 'https://example.jp/evidence', highlights: ['日本語の調査資料です。'], language: 'ja' }] } }] };
    },
  });

  assert.equal(calls[0].tools.exa_search.args.userLocation, 'JP');
  assert.match(calls[0].prompt, /ja-JP/);
  assert.doesNotMatch(calls[0].prompt, /en-US/);
  assert.deepEqual(evidence.external.localization, {
    policy: 'PREFER',
    locales: ['ja-JP'],
    geography: { countryCode: 'JP', location: 'Japan' },
    matchStatus: 'MATCHED',
    verification: { method: 'PROVIDER_LANGUAGE_PLUS_REGISTERED_SCRIPT', evaluatedCount: 1, metadataMatchedCount: 1, scriptMatchedCount: 1 },
  });
});

test('Singapore routing-only studies send SG—not US—to evidence retrieval', async () => {
  const localized = input({
    localization: {
      schemaVersion: 'study-localization-v1',
      marketId: 'SG',
      reportLocale: 'en-US',
      sourceLocales: ['en-US'],
      retrieval: { policy: 'PREFER', locales: ['en-US'] },
      instrumentLocale: 'en-US',
    },
  });
  const calls = [];
  const evidence = await acquireEvidence(localized, {
    env: { VERCEL_OIDC_TOKEN: 'test-oidc-token' },
    searchGenerate: async (options) => {
      calls.push(options);
      return { toolResults: [{ toolName: 'exa_search', output: { results: [{ title: 'Singapore source', url: 'https://example.sg/evidence', highlights: ['Singapore market evidence.'], language: 'en' }] } }] };
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.tools.exa_search.args.userLocation === 'SG'), true);
  assert.equal(calls.some((call) => call.tools.exa_search.args.userLocation === 'US'), false);
  assert.deepEqual(evidence.external.localization, {
    policy: 'PREFER',
    locales: ['en-US'],
    geography: { countryCode: 'SG', location: 'Singapore' },
    matchStatus: 'MATCHED',
    verification: { method: 'PROVIDER_LANGUAGE_PLUS_REGISTERED_SCRIPT', evaluatedCount: 1, metadataMatchedCount: 1, scriptMatchedCount: 1 },
  });
});

test('provided public URLs are fetched through Firecrawl and recorded in the ledger', async () => {
  const calls = [];
  const evidence = await acquireEvidence(input({ sourceUrls: ['https://example.com/report'] }), {
    env: { FIRECRAWL_API_KEY: 'test-key' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ success: true, data: { markdown: 'Fetched public evidence about workspace adoption.', metadata: { title: 'Example report', sourceURL: 'https://example.com/report' } } });
    },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v2\/scrape$/);
  assert.equal(evidence.mode, 'EXA_FIRECRAWL');
  assert.deepEqual(evidence.ledger[0], { title: 'Example report', url: 'https://example.com/report', excerpt: 'Fetched public evidence about workspace adoption.', acquisition: 'FIRECRAWL', originalLanguage: null, contentHash: sha256('Fetched public evidence about workspace adoption.') });
});

test('AUTO uses two tagged Gateway Exa searches with anonymous attribution and deduplication', async () => {
  const gatewayCalls = [];
  const evidence = await acquireEvidence(input(), {
    env: { VERCEL_OIDC_TOKEN: 'test-oidc-token' },
    searchGenerate: async (options) => {
      gatewayCalls.push(options);
      return {
        toolResults: [{
          toolName: 'exa_search',
          output: {
            requestId: 'gateway-search-request',
            results: [
              { title: 'Gateway source', url: 'https://example.com/gateway', highlights: ['Gateway-retrieved research evidence.'], language: 'en' },
              { title: 'Duplicate source', url: 'https://example.com/gateway', highlights: ['Duplicate content.'] },
            ],
          },
        }],
      };
    },
  });
  assert.equal(gatewayCalls.length, 2);
  assert.deepEqual(gatewayCalls[0].toolChoice, { type: 'tool', toolName: 'exa_search' });
  assert.ok(gatewayCalls[0].tools.exa_search);
  assert.match(gatewayCalls[0].providerOptions.gateway.user, /^[a-f0-9]{32}$/);
  assert.ok(gatewayCalls[0].providerOptions.gateway.tags.includes('query:neutral-primary'));
  assert.ok(gatewayCalls[1].providerOptions.gateway.tags.includes('query:disconfirming'));
  assert.equal(evidence.mode, 'EXA_GATEWAY');
  assert.equal(evidence.ledger.length, 1);
  assert.equal(evidence.ledger[0].acquisition, 'EXA_GATEWAY');
  assert.equal(evidence.ledger[0].originalLanguage, 'en');
  assert.equal(evidence.external.events[0].provider, 'vercel-ai-gateway');
  assert.equal(evidence.external.events[0].outcome, 'completed');
  assert.equal(evidence.external.events[0].searches.length, 2);
});

test('AUTO retains one successful Gateway query when its paired query fails', async () => {
  let calls = 0;
  const evidence = await acquireEvidence(input({ market: 'Japan', searchCountry: 'JP' }), {
    env: { VERCEL_OIDC_TOKEN: 'test-oidc-token' },
    searchGenerate: async () => {
      calls += 1;
      if (calls === 2) throw new Error('second query unavailable');
      return {
        toolResults: [{
          toolName: 'exa_search',
          output: { requestId: 'partial-search', results: [{ id: 'one', title: 'Usable source', url: 'https://example.com/partial', highlights: ['One bounded query completed.'] }] },
        }],
      };
    },
  });
  assert.equal(evidence.mode, 'EXA_GATEWAY');
  assert.equal(evidence.ledger.length, 1);
  assert.deepEqual(evidence.external.events[0].searches.map((search) => search.outcome).sort(), ['completed', 'failed']);
});

test('Gateway retrieval failures emit only structured sanitized telemetry', async () => {
  const warnings = [];
  const logger = { warn: (line) => warnings.push(line) };
  const sensitiveMessage = 'Bearer private-monitor-token research prompt must not reach logs';

  const evidence = await acquireEvidence(input(), {
    env: { VERCEL_OIDC_TOKEN: 'test-oidc-token' },
    correlationId: 'corr_gateway_failure_1234',
    logger,
    searchGenerate: async () => {
      const error = new Error(sensitiveMessage);
      error.code = 'GATEWAY_UNAVAILABLE';
      error.statusCode = 503;
      throw error;
    },
  });

  assert.equal(warnings.length, 1);
  const event = JSON.parse(warnings[0]);
  assert.equal(event.level, 'warn');
  assert.equal(event.event, 'evidence_gateway_search_failed');
  assert.equal(event.correlationId, 'corr_gateway_failure_1234');
  assert.deepEqual(event.error, { name: 'Error', code: 'GATEWAY_UNAVAILABLE', statusCode: 503 });
  assert.deepEqual(event.attributes, { provider: 'vercel-ai-gateway', operation: 'exa-search' });
  assert.equal(warnings[0].includes(sensitiveMessage), false);
  assert.equal(evidence.external.events[0].outcome, 'failed');
});

test('AUTO uses validated Exa highlights when Firecrawl is unavailable', async () => {
  let calls = 0;
  const evidence = await acquireEvidence(input(), {
    env: { EXA_API_KEY: 'test-key' },
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ results: [
        { title: 'Public source', url: 'https://example.com/a', highlights: ['Relevant public excerpt.'] },
        { title: 'Rejected target', url: 'http://127.0.0.1/private', highlights: ['Must not enter ledger.'] },
      ] });
    },
  });
  assert.equal(calls, 2);
  assert.equal(evidence.mode, 'EXA_HIGHLIGHTS');
  assert.deepEqual(evidence.ledger.map((entry) => entry.url), ['https://example.com/a']);
  assert.equal(evidence.external.events[0].outcome, 'completed');
});

test('REQUIRE retrieval retains only provider-language metadata plus registered-script matches and fails when none match', async () => {
  const required = input({
    localization: {
      schemaVersion: 'study-localization-v1',
      marketId: 'JP',
      reportLocale: 'ja-JP',
      sourceLocales: ['en-US'],
      retrieval: { policy: 'REQUIRE', locales: ['ja-JP'] },
      instrumentLocale: 'ja-JP',
    },
  });
  const matching = await acquireEvidence(required, {
    env: { VERCEL_OIDC_TOKEN: 'test-oidc-token' },
    searchGenerate: async () => ({
      toolResults: [{ toolName: 'exa_search', output: { results: [
        { title: 'English source', url: 'https://example.com/en', highlights: ['English evidence.'], language: 'en-GB' },
        { title: '日本語の資料', url: 'https://example.jp/ja', highlights: ['日本語の証拠です。'], language: 'ja' },
        { title: 'Unknown language', url: 'https://example.com/unknown', highlights: ['Evidence with no language metadata.'] },
      ] } }],
    }),
  });

  assert.deepEqual(matching.ledger.map((entry) => entry.url), ['https://example.jp/ja']);
  assert.equal(matching.ledger[0].originalLanguage, 'ja');
  assert.equal(matching.external.localization.matchStatus, 'MATCHED');
  assert.deepEqual(matching.external.localization.verification, {
    method: 'PROVIDER_LANGUAGE_PLUS_REGISTERED_SCRIPT',
    evaluatedCount: 3,
    metadataMatchedCount: 1,
    scriptMatchedCount: 1,
  });

  await assert.rejects(() => acquireEvidence(required, {
    env: { VERCEL_OIDC_TOKEN: 'test-oidc-token' },
    searchGenerate: async () => ({ toolResults: [{ toolName: 'exa_search', output: { results: [
      { title: 'English source', url: 'https://example.com/en-only', highlights: ['English evidence.'], language: 'en-US' },
      { title: 'Unknown language', url: 'https://example.com/unknown-only', highlights: ['Evidence with no language metadata.'] },
    ] } }] }),
  }), (error) => {
    assert.equal(error?.name, 'StudyPipelineError');
    assert.equal(error?.statusCode, 424);
    assert.equal(error?.code, 'REQUIRED_SOURCE_LANGUAGE_UNAVAILABLE');
    assert.match(error?.message, /provider-declared primary-language metadata.*registered-script compatibility check/);
    return true;
  });
});

test('REQUIRE receipt does not misrepresent same-script compatibility as language identification', async () => {
  const cases = [
    {
      localization: {
        schemaVersion: 'study-localization-v1',
        marketId: 'ES',
        reportLocale: 'es-ES',
        sourceLocales: ['es-ES'],
        retrieval: { policy: 'REQUIRE', locales: ['es-ES'] },
        instrumentLocale: 'es-ES',
      },
      result: {
        title: 'Proveedor declara español',
        url: 'https://example.es/provider-declared-es',
        highlights: ['This English excerpt is Latin-script compatible but is not identified as Spanish.'],
        language: 'es',
      },
    },
    {
      localization: {
        schemaVersion: 'study-localization-v1',
        marketId: 'JP',
        reportLocale: 'ja-JP',
        sourceLocales: ['ja-JP'],
        retrieval: { policy: 'REQUIRE', locales: ['ja-JP'] },
        instrumentLocale: 'ja-JP',
      },
      result: {
        title: '提供元は日本語と申告',
        url: 'https://example.jp/provider-declared-ja',
        highlights: ['城市住宅数据仅包含汉字，因此文字脚本检查无法证明它是日语。'],
        language: 'ja',
      },
    },
  ];

  for (const scenario of cases) {
    const evidence = await acquireEvidence(input({ localization: scenario.localization }), {
      env: { VERCEL_OIDC_TOKEN: 'test-oidc-token' },
      searchGenerate: async () => ({
        toolResults: [{ toolName: 'exa_search', output: { results: [scenario.result] } }],
      }),
    });

    assert.deepEqual(evidence.ledger.map((entry) => entry.url), [scenario.result.url]);
    assert.equal(evidence.external.localization.matchStatus, 'MATCHED');
    assert.deepEqual(evidence.external.localization.verification, {
      method: 'PROVIDER_LANGUAGE_PLUS_REGISTERED_SCRIPT',
      evaluatedCount: 1,
      metadataMatchedCount: 1,
      scriptMatchedCount: 1,
    });
  }
});

test('REQUIRE retrieval rejects source-language metadata contradicted by the excerpt before model work', async () => {
  const required = input({
    localization: {
      schemaVersion: 'study-localization-v1',
      marketId: 'JP',
      reportLocale: 'ja-JP',
      sourceLocales: ['en-US'],
      retrieval: { policy: 'REQUIRE', locales: ['ja-JP'] },
      instrumentLocale: 'ja-JP',
    },
  });
  let generationCalls = 0;

  await assert.rejects(() => runStudyPipeline(required, {
    env: { VERCEL_OIDC_TOKEN: 'test-oidc-token' },
    searchGenerate: async () => ({ toolResults: [{ toolName: 'exa_search', output: { results: [
      { title: 'Mislabeled source', url: 'https://example.jp/mislabeled', highlights: ['This excerpt is entirely English.'], language: 'ja' },
    ] } }] }),
    generate: async () => {
      generationCalls += 1;
      throw new Error('model work must not start');
    },
  }), (error) => error?.code === 'REQUIRED_SOURCE_LANGUAGE_UNAVAILABLE');

  assert.equal(generationCalls, 0);
});

test('Firecrawl search is used as the no-Exa AUTO fallback and REQUIRE_EXTERNAL fails closed', async () => {
  const evidence = await acquireEvidence(input(), {
    env: { FIRECRAWL_API_KEY: 'test-key' },
    fetchImpl: async () => jsonResponse({ success: true, data: { web: [{ title: 'Search result', url: 'https://example.com/search', markdown: 'Search-derived public evidence.' }] } }),
  });
  assert.equal(evidence.mode, 'FIRECRAWL_SEARCH');
  await assert.rejects(
    () => acquireEvidence(input({ evidencePolicy: 'REQUIRE_EXTERNAL' }), { env: {}, fetchImpl: async () => { throw new Error('should not fetch'); } }),
    (error) => {
      assert.equal(error?.name, 'StudyPipelineError');
      assert.equal(error?.statusCode, 424);
      assert.equal(error?.code, 'REQUIRED_EXTERNAL_EVIDENCE_UNAVAILABLE');
      return true;
    },
  );
});

test('a failed Gateway search falls transparently to PRIOR_ONLY without network calls', async () => {
  const evidence = await acquireEvidence(input(), {
    env: { VERCEL_OIDC_TOKEN: 'test-oidc-token' },
    searchGenerate: async () => { throw new Error('gateway unavailable'); },
    fetchImpl: async () => { throw new Error('network must not be used'); },
  });
  assert.equal(evidence.mode, 'PRIOR_ONLY');
  assert.equal(evidence.ledger.length, 0);
  assert.deepEqual(evidence.external.events, [{ provider: 'vercel-ai-gateway', operation: 'exa-search', outcome: 'failed' }]);
});

test('pipeline allocates stable IDs and carries one population frame through every model stage', async () => {
  const candidate = {
    title: 'Workspace adoption', summary: 'The synthetic panel leans interested, with uncertainty around onboarding.', takeaway: 'Test onboarding friction with a real research study before investing.', distribution: [10, 15, 20, 30, 25], confidence: 'Low', confidenceNote: 'Synthetic only; validate with human research.',
    audienceSummary: { audienceLabel: 'Operations leaders', contextLabel: 'Small businesses', attributes: [{ label: 'Role', value: 'Leader' }, { label: 'Team', value: 'Small' }, { label: 'Need', value: 'Coordination' }] },
    segments: ['Champions', 'Pragmatists', 'Uncertain', 'Skeptics'].map((label) => ({ label, sample: 25, values: [10, 15, 20, 30, 25] })),
    responses: [1, 2, 4, 5].map((score) => ({ score, profile: `Profile ${score}`, quote: 'This is a model-generated illustrative response for a synthetic panel.' })), cautions: ['This is a synthetic result.', 'Validate the hypothesis with real people.'],
  };
  const outputs = [
    { neutralQuestion: 'Would this audience adopt a shared workspace?', decisionContext: 'Evaluate an adoption hypothesis.', panelDimensions: ['Use case', 'Value', 'Barriers'], assumptions: ['Synthetic panel only.', 'No causal claim.'], evidenceBoundary: 'No source evidence was supplied; findings are model-only hypotheses.' },
    candidate,
    { decision: 'accepted', critique: ['No unsupported evidence claim found.'], credibilityLevel: 'illustrative-only' },
  ];
  const calls = [];
  const populationFrame = {
    officialSourceDatasets: [{
      id: 'official-age', title: 'Official age table', publisher: 'National statistics office',
      url: 'https://example.gov/age', coverageDate: '2025-01-01', geography: 'Global',
      variables: ['age'], verificationStatus: 'USER_DECLARED_OFFICIAL',
    }],
    marginalDistributions: [{
      variable: 'age', label: 'Age', sourceDatasetId: 'official-age',
      categories: [{ value: '18-34', share: 0.4 }, { value: '35+', share: 0.6 }],
    }],
    unsupportedCharacteristics: ['Adoption intent remains unvalidated.'],
    coverageDate: '2025-01-01',
  };
  const result = await runStudyPipeline(input({
    populationFrame,
    researchMethod: 'CONCEPT_TEST',
    methodConfig: { method: 'CONCEPT_TEST', concept: { id: 'workspace-concept', text: 'A shared workspace with guided onboarding and structured handoffs.' } },
  }), { env: {}, generate: async (options) => { calls.push(options); return { output: outputs.shift(), response: { modelId: 'mock/model' }, usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } }; } });
  assert.equal(calls.length, 3);
  assert.match(result.run.studyId, /^study_/);
  assert.match(result.run.runId, /^run_/);
  for (const call of calls) {
    assert.ok(call.providerOptions.gateway.tags.includes(`study:${result.run.studyId}`));
    assert.ok(call.providerOptions.gateway.tags.includes(`run:${result.run.runId}`));
    assert.ok(call.providerOptions.gateway.tags.includes('method:concept_test'));
  }
  assert.equal(result.run.evidence.mode, 'PRIOR_ONLY');
  assert.equal(result.humanResearchHandoff.schemaVersion, 'human-research-handoff-v1');
  assert.equal(result.run.humanResearchHandoff.handoffId, result.humanResearchHandoff.handoffId);
  assert.match(result.meta.humanResearchHandoffHash, /^[a-f0-9]{64}$/);
  assert.equal(result.humanResearchHandoff.sourceStudy.observedHumanResponses, false);
  assert.equal(result.run.stages.every((stage) => stage.usage.totalTokens === 30), true);
  assert.equal(result.populationFrame.frameVersion, 'population-frame-v1');
  assert.deepEqual(result.run.populationFrame, result.populationFrame);
  assert.deepEqual(result.meta.populationFrame, result.populationFrame);
  assert.deepEqual(result.persistence.clientRecord.run.populationFrame, result.populationFrame);
  assert.match(result.run.reproducibility.populationFrameHash, /^[a-f0-9]{64}$/);
  assert.equal(result.meta.modelCard.populationFrameHash, result.run.reproducibility.populationFrameHash);
  assert.equal(result.meta.modelCard.attitudinalValidation, 'NOT_VALIDATED');
  assert.equal(result.researchDesign.methodId, 'CONCEPT_TEST');
  assert.equal(result.researchDesign.chartId, 'FIVE_POINT_CONCEPT_INTENT');
  assert.equal(result.researchDesign.primaryOutcome.value, 55);
  assert.equal(result.study.methodResult.kind, 'DIRECTIONAL_DISTRIBUTION');
  assert.deepEqual(result.study.methodResult.scale.labels, result.researchDesign.scale.anchors);
  assert.match(result.run.reproducibility.methodResultHash, /^[a-f0-9]{64}$/);
  assert.equal(result.meta.modelCard.researchMethodVersion, result.researchDesign.methodVersion);
  assert.deepEqual(result.run.researchDesign, result.researchDesign);
  assert.deepEqual(result.persistence.clientRecord.run.researchDesign, result.researchDesign);
  assert.ok(result.study.segments.every((segment) => !('sample' in segment)));
  assert.ok(result.study.responses.every((response) => response.disclosure === 'Model-generated perspective—not a participant quotation.'));
  assert.ok(calls.every((call) => call.prompt.includes('POPULATION FRAME')));
  assert.ok(calls.every((call) => call.prompt.includes(result.run.reproducibility.populationFrameHash)));
  assert.ok(calls.every((call) => !/synthetic panel size/i.test(call.prompt)));
  assert.ok(calls.every((call) => call.prompt.includes('CONCEPT_TEST')));
  assert.match(calls.at(-1).prompt, /concept clarity/i);
});

test('non-directional method outputs preserve supplied IDs, omit fictional panel fields, and record method-result lineage', async () => {
  const base = { title: 'Feature priority', summary: 'This is a model-generated ordinal feature priority for hypothesis exploration only.', takeaway: 'Validate trade-offs with relevant people before making a roadmap decision.', confidenceNote: 'Synthetic only; validate with human research.', cautions: ['This is model-generated direction only.'] };
  const result = await runStudyPipeline(input({
    researchMode: 'QUICK', researchMethod: 'FEATURE_PRIORITIZATION',
    methodConfig: { method: 'FEATURE_PRIORITIZATION', features: [{ id: 'setup', text: 'Fast setup' }, { id: 'export', text: 'Data export' }, { id: 'sharing', text: 'Team sharing' }], decisionContext: 'Choose the next investment', selectionConstraint: 'Rank all features' },
  }), { env: {}, generate: async (options) => {
    const output = options.system.includes('research-methods framer')
      ? { neutralQuestion: 'Which features should be prioritized?', decisionContext: 'Product investment', panelDimensions: ['Features', 'Trade-offs', 'Risks'], assumptions: ['Synthetic only.', 'No human sample.'], evidenceBoundary: 'No source evidence was supplied.' }
      : options.system.includes('separate evidence-alignment')
        ? { decision: 'accepted', critiqueSummary: 'No unsupported claim found.', credibilityLevel: 'illustrative-only', evidenceAlignment: 'not-assessed', weakClaims: [], biasSignals: [] }
        : { ...base, kind: 'RANKED_ITEMS', rankingLabel: 'Priority', items: [{ id: 'setup', label: 'Altered model label', rank: 1 }, { id: 'export', label: 'Altered model label', rank: 2 }, { id: 'sharing', label: 'Altered model label', rank: 3 }] };
    return { output, response: { modelId: 'mock/model' }, usage: {} };
  } });

  assert.equal(result.study.methodResult.kind, 'RANKED_ITEMS');
  assert.deepEqual(result.study.methodResult.items.map((item) => item.id), ['setup', 'export', 'sharing']);
  assert.deepEqual(result.study.methodResult.items.map((item) => item.label), ['Fast setup', 'Data export', 'Team sharing']);
  assert.equal('distribution' in result.study, false);
  assert.equal('segments' in result.study, false);
  assert.equal('responses' in result.study, false);
  assert.equal(result.run.stages.some((stage) => stage.stage === 'respondent-cell'), false);
  assert.equal(result.run.stability.applicable, false);
  assert.match(result.run.reproducibility.methodResultHash, /^[a-f0-9]{64}$/);
  assert.equal(result.modelCard.resultKind, 'RANKED_ITEMS');
});

const nonDirectionalBase = {
  title: 'Method result', summary: 'This model-generated method result is directional input for structured human follow-up only.',
  takeaway: 'Review this output with a researcher and validate it with relevant people before making a decision.',
  confidenceNote: 'This is model-generated direction and has not been validated against human participants.',
  cautions: ['This output is not observed human evidence.'],
};

async function runNonDirectionalMethod(researchMethod, methodConfig, methodOutput) {
  return runStudyPipeline(input({ researchMode: 'QUICK', researchMethod, methodConfig }), { env: {}, generate: async (options) => {
    const output = options.system.includes('research-methods framer')
      ? { neutralQuestion: 'What directional pattern should be explored?', decisionContext: 'Plan human validation.', panelDimensions: ['Inputs', 'Trade-offs', 'Risks'], assumptions: ['Synthetic only.', 'No human sample.'], evidenceBoundary: 'No source evidence was supplied.' }
      : options.system.includes('separate evidence-alignment')
        ? { decision: 'accepted', critiqueSummary: 'No unsupported claim found.', credibilityLevel: 'illustrative-only', evidenceAlignment: 'not-assessed', weakClaims: [], biasSignals: [] }
        : methodOutput;
    return { output, response: { modelId: 'mock/model' }, usage: {} };
  } });
}

test('brand-positioning pipeline canonicalizes every supplied brand/attribute and rejects association tampering', async () => {
  const methodConfig = {
    method: 'BRAND_POSITIONING', focalBrand: { id: 'focal', label: 'Focal Brand' },
    comparatorBrands: [{ id: 'comp-a', label: 'Comparator A' }, { id: 'comp-b', label: 'Comparator B' }], category: 'Team software',
    attributes: [{ id: 'easy', label: 'Easy to use' }, { id: 'trusted', label: 'Trustworthy' }, { id: 'modern', label: 'Modern' }],
  };
  const associations = (level = 'MEDIUM') => methodConfig.attributes.map((attribute) => ({ attributeId: attribute.id, level, accessibleLabel: 'Model wording is ignored' }));
  const output = { ...nonDirectionalBase, kind: 'ATTRIBUTE_MATRIX', matrixLabel: 'Association direction', attributes: methodConfig.attributes.map((item) => ({ id: item.id, label: 'Changed' })), brands: [methodConfig.focalBrand, ...methodConfig.comparatorBrands].map((brand) => ({ id: brand.id, label: 'Changed', associations: associations(brand.id === 'focal' ? 'HIGH' : 'MEDIUM') })) };
  const result = await runNonDirectionalMethod('BRAND_POSITIONING', methodConfig, output);
  assert.deepEqual(result.study.methodResult.brands.map((brand) => brand.label), ['Focal Brand', 'Comparator A', 'Comparator B']);
  assert.deepEqual(result.study.methodResult.attributes.map((attribute) => attribute.label), ['Easy to use', 'Trustworthy', 'Modern']);
  assert.equal(result.study.methodResult.brands[0].associations[0].accessibleLabel, 'HIGH association with Easy to use');
  assert.equal('segments' in result.study, false);
  const tampered = structuredClone(output);
  tampered.brands[0].associations.pop();
  await assert.rejects(() => runNonDirectionalMethod('BRAND_POSITIONING', methodConfig, tampered), /every supplied ID exactly once/i);
});

test('Japanese panel script validation preserves an exact Korean brand label but not a model summary', async () => {
  const suppliedKoreanBrand = '한국 사용자가 제공한 원본 브랜드 이름 그대로 유지해야 합니다';
  const methodConfig = {
    method: 'BRAND_POSITIONING',
    focalBrand: { id: 'focal', label: suppliedKoreanBrand },
    comparatorBrands: [{ id: 'comp-a', label: '比較ブランドA' }, { id: 'comp-b', label: '比較ブランドB' }],
    category: 'チーム向けソフトウェア',
    attributes: [{ id: 'easy', label: '使いやすさ' }, { id: 'trusted', label: '信頼性' }, { id: 'modern', label: '現代性' }],
  };
  const associations = methodConfig.attributes.map((attribute) => ({ attributeId: attribute.id, level: 'MEDIUM', accessibleLabel: '関連性のモデル評価' }));
  const panelOutput = {
    title: 'ブランド関連性の結果',
    summary: 'これはブランドの関連性を探索するためのモデル生成結果であり、観察された人間の回答ではありません。',
    takeaway: '意思決定の前に、対象者を含む適切な人間調査を実施し、この方向性とその解釈を慎重に検証してください。',
    confidenceNote: 'この結果はモデル生成の方向性であり、人間の参加者による検証は完了していません。',
    cautions: ['これは観察された人間の証拠ではありません。'],
    kind: 'ATTRIBUTE_MATRIX',
    matrixLabel: '関連性の方向',
    attributes: methodConfig.attributes.map((attribute) => ({ ...attribute })),
    brands: [methodConfig.focalBrand, ...methodConfig.comparatorBrands].map((brand) => ({ ...brand, associations })),
  };
  const localizedInput = input({
    researchMethod: 'BRAND_POSITIONING',
    methodConfig,
    localization: {
      schemaVersion: 'study-localization-v1', marketId: 'JP', reportLocale: 'ja-JP', sourceLocales: [],
      retrieval: { policy: 'ANY', locales: [] }, instrumentLocale: 'ja-JP',
    },
  });
  const japaneseCritique = '重大な根拠の問題は検出されませんでした。';
  const run = (output, adjudicationSummary = japaneseCritique) => runStudyPipeline(localizedInput, { env: {}, generate: async (options) => {
    const stageOutput = options.system.includes('research-methods framer')
      ? { neutralQuestion: 'どのブランド関連性を探索すべきですか。', decisionContext: '人間調査の計画に使う方向性を検討します。', panelDimensions: ['ブランド認知', '属性の関連', '解釈のリスク'], assumptions: ['これは合成的な探索のみです。', '人間の回答は観察していません。'], evidenceBoundary: '外部の根拠はなく、モデルの仮説としてのみ扱います。' }
      : options.system.includes('separate evidence-alignment')
        ? { decision: 'accepted', critiqueSummary: adjudicationSummary, credibilityLevel: 'illustrative-only', evidenceAlignment: 'not-assessed', weakClaims: [], biasSignals: [] }
        : output;
    return { output: stageOutput, response: { modelId: 'mock/model' }, usage: {} };
  } });

  const result = await run(panelOutput);
  assert.equal(result.study.methodResult.brands[0].label, suppliedKoreanBrand);

  await assert.rejects(
    () => run({ ...panelOutput, summary: suppliedKoreanBrand }),
    (error) => error?.name === 'StudyPipelineError' && /method result could not be completed/i.test(error.message),
  );

  const rejectedAdjudication = await run(panelOutput, suppliedKoreanBrand);
  assert.equal(rejectedAdjudication.run.stages.find((stage) => stage.stage === 'adjudication').status, 'failed');
  assert.equal(rejectedAdjudication.run.verification.status, 'unavailable');
});

test('price-sensitivity pipeline preserves exact ascending prices and rejects altered amounts', async () => {
  const methodConfig = {
    method: 'PRICE_SENSITIVITY', offer: { id: 'offer', text: 'A structured collaboration service for small teams.' }, category: 'Team software', currency: 'EUR', unit: 'per team per month',
    channel: 'Self-service website', purchaseHorizon: 'Within 90 days', referenceAlternative: 'Continue with separate tools',
    pricePoints: [{ id: 'p10', amount: 10 }, { id: 'p20', amount: 20 }, { id: 'p30', amount: 30 }],
  };
  const output = { ...nonDirectionalBase, kind: 'PRICE_LADDER', points: methodConfig.pricePoints.map((point, index) => ({ id: point.id, label: 'Changed', amount: point.amount, distribution: [10 + index, 15, 25, 30 - index, 20] })) };
  const result = await runNonDirectionalMethod('PRICE_SENSITIVITY', methodConfig, output);
  assert.deepEqual(result.study.methodResult.points.map((point) => point.label), ['EUR 10 per team per month', 'EUR 20 per team per month', 'EUR 30 per team per month']);
  assert.deepEqual(result.study.methodResult.priceContext, { currency: 'EUR', unit: 'per team per month' });
  assert.equal(result.modelCard.purpose.includes('simulated panel'), false);
  assert.equal('distribution' in result.study, false);
  const tampered = structuredClone(output);
  tampered.points[1].amount = 21;
  await assert.rejects(() => runNonDirectionalMethod('PRICE_SENSITIVITY', methodConfig, tampered), /amounts must match/i);
});

test('survey-pretest pipeline keeps issue references inside the supplied instrument and rejects invented question IDs', async () => {
  const methodConfig = { method: 'SURVEY_PRETEST', studyObjective: 'Assess onboarding expectations', targetPopulation: 'Small business leaders', surveyQuestions: [{ id: 'q1', text: 'How clear was setup?' }, { id: 'q2', text: 'How likely are you to continue?' }] };
  const output = { ...nonDirectionalBase, kind: 'INSTRUMENT_REVIEW', issues: [{ id: 'issue-1', questionId: 'q1', severity: 'MEDIUM', category: 'Specificity', explanation: 'The reference period is not defined.', revisionSuggestion: 'Add a clear reference period.' }], coverageGaps: ['Consent language requires researcher review.'], suggestedCognitiveProbes: ['What did setup mean to you?'] };
  const result = await runNonDirectionalMethod('SURVEY_PRETEST', methodConfig, output);
  assert.equal(result.study.methodResult.issues[0].questionId, 'q1');
  assert.equal(result.researchDesign.segmentPerspectiveEligible, false);
  assert.equal('responses' in result.study, false);
  const tampered = structuredClone(output);
  tampered.issues[0].questionId = 'invented';
  await assert.rejects(() => runNonDirectionalMethod('SURVEY_PRETEST', methodConfig, tampered), /supplied survey question IDs/i);
});

test('interview-guide pipeline covers every supplied topic and rejects invented or missing topic references', async () => {
  const methodConfig = { method: 'INTERVIEW_GUIDE', researchObjective: 'Understand onboarding barriers', participantContext: 'Recent small-business software evaluators', topics: [{ id: 'context', label: 'Current context' }, { id: 'barriers', label: 'Barriers' }], sensitiveAreas: ['Business finances'] };
  const output = { ...nonDirectionalBase, kind: 'INTERVIEW_GUIDE', opening: 'Explain purpose, consent, recording, and the right to stop.', questions: [{ id: 'guide-q1', topicId: 'context', prompt: 'Tell me about your current workflow.', probes: ['What prompted the change?'] }, { id: 'guide-q2', topicId: 'barriers', prompt: 'What made evaluation difficult?', probes: ['What information was missing?'] }], moderatorNotes: ['Use neutral probes.'], consentAndAccessibilityNotes: ['Confirm consent and accessibility needs before starting.'], closing: 'Invite final comments and explain next steps.' };
  const result = await runNonDirectionalMethod('INTERVIEW_GUIDE', methodConfig, output);
  assert.deepEqual(result.study.methodResult.questions.map((question) => question.topicId), ['context', 'barriers']);
  assert.equal(result.modelCard.observedHumanResponses, false);
  assert.equal('distribution' in result.study, false);
  const tampered = structuredClone(output);
  tampered.questions[1].topicId = 'invented';
  await assert.rejects(() => runNonDirectionalMethod('INTERVIEW_GUIDE', methodConfig, tampered), /topic references must contain every supplied ID exactly once/i);
});
