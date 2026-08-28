import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireEvidence, buildEvidenceQueries, collectEvidence, isBcp47Locale, isSafePublicUrl, normalisePercentages, requestSchema, runStudyPipeline, sha256 } from './synthetic-study-pipeline.js';

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

test('request validation rejects private targets and keeps user excerpts auditable', () => {
  assert.equal(isSafePublicUrl('https://example.com/report'), true);
  assert.equal(isSafePublicUrl('http://127.0.0.1/admin'), false);
  assert.equal(isSafePublicUrl('http://[::1]/admin'), false);
  assert.throws(() => input({ sourceUrls: ['http://localhost:3000/secret'] }));
  const evidence = collectEvidence(input({ sources: [{ url: 'https://example.com/report', title: 'Example report', excerpt: 'A user supplied research excerpt.' }] }));
  assert.equal(evidence.mode, 'USER_PROVIDED');
  assert.equal(evidence.evidenceHash, sha256(JSON.stringify(evidence.ledger)));
});

test('market, locale, and location inputs validate independently of audience', () => {
  assert.equal(isBcp47Locale('fr-CA'), true);
  assert.equal(isBcp47Locale('not_a_locale'), false);
  const parsed = input({ market: 'Quebec retail', outputLocale: 'fr-ca', sourceLanguages: ['fr-CA', 'en'], searchCountry: 'ca', searchLocation: 'Montreal, Quebec' });
  assert.equal(parsed.outputLocale, 'fr-CA');
  assert.deepEqual(parsed.sourceLanguages, ['fr-CA', 'en']);
  assert.equal(parsed.searchCountry, 'CA');
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

test('Firecrawl search is used as the no-Exa AUTO fallback and REQUIRE_EXTERNAL fails closed', async () => {
  const evidence = await acquireEvidence(input(), {
    env: { FIRECRAWL_API_KEY: 'test-key' },
    fetchImpl: async () => jsonResponse({ success: true, data: { web: [{ title: 'Search result', url: 'https://example.com/search', markdown: 'Search-derived public evidence.' }] } }),
  });
  assert.equal(evidence.mode, 'FIRECRAWL_SEARCH');
  await assert.rejects(() => acquireEvidence(input({ evidencePolicy: 'REQUIRE_EXTERNAL' }), { env: {}, fetchImpl: async () => { throw new Error('should not fetch'); } }), { name: 'StudyPipelineError', statusCode: 424 });
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

test('pipeline allocates stable IDs before each tagged model stage', async () => {
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
  const result = await runStudyPipeline(input(), { env: {}, generate: async (options) => { calls.push(options); return { output: outputs.shift(), response: { modelId: 'mock/model' }, usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } }; } });
  assert.equal(calls.length, 3);
  assert.match(result.run.studyId, /^study_/);
  assert.match(result.run.runId, /^run_/);
  for (const call of calls) {
    assert.ok(call.providerOptions.gateway.tags.includes(`study:${result.run.studyId}`));
    assert.ok(call.providerOptions.gateway.tags.includes(`run:${result.run.runId}`));
  }
  assert.equal(result.run.evidence.mode, 'PRIOR_ONLY');
  assert.equal(result.run.stages.every((stage) => stage.usage.totalTokens === 30), true);
});
