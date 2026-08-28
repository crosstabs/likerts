import assert from 'node:assert/strict';
import test from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { LIMITATIONS_URI, METHODOLOGY_URI } from './mcp-contract.js';
import { createAnonymousStudyAdmission, McpAdmissionError } from './mcp-abuse-controls.js';
import { createLikertsMcpHandler } from './mcp-server.js';

const validBrief = {
  prompt: 'Would this audience adopt a shared workspace?',
  audience: 'Small business operations leaders',
  panelSize: 100,
  evidencePolicy: 'PRIOR_ONLY',
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

async function withClient(options, callback) {
  const handler = createLikertsMcpHandler({ reportError: () => {}, ...options });
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
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ['run_synthetic_study', 'validate_research_brief']);
    const runTool = tools.find((tool) => tool.name === 'run_synthetic_study');
    assert.match(runTool.description, /model-generated/i);
    assert.match(runTool.description, /never surveys humans/i);
    assert.equal(runTool.annotations.openWorldHint, true);
    assert.ok(runTool.outputSchema);

    const { resources } = await client.listResources();
    assert.deepEqual(resources.map((resource) => resource.uri).sort(), [LIMITATIONS_URI, METHODOLOGY_URI].sort());

    const methodology = await client.readResource({ uri: METHODOLOGY_URI });
    assert.match(methodology.contents[0].text, /does not survey or observe people/i);
    const limitations = await client.readResource({ uri: LIMITATIONS_URI });
    assert.match(limitations.contents[0].text, /not a perfect distributed rate or cost limit/i);
  });
});

test('the same stateless endpoint remains compatible with 2025-era Streamable HTTP clients', async () => {
  const handler = createLikertsMcpHandler({ runStudy: async () => mockStudy, reportError: () => {} });
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
    assert.equal(valid.structuredContent.validation.estimatedModelCalls, 3);

    const invalid = await client.callTool({
      name: 'validate_research_brief',
      arguments: { brief: { prompt: 'Too short', audience: 'x', panelSize: 900 } },
    });
    assert.equal(invalid.structuredContent.validation.valid, false);
    assert.ok(invalid.structuredContent.validation.issues.some((issue) => issue.code === 'INVALID_PROMPT'));
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
  assert.equal(releases, 1);
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
    assert.equal(result.structuredContent.error.code, 'BUDGET_EXHAUSTED');
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
  release();
  const releaseSecond = await admission.acquire({ clientKey: 'a' });
  releaseSecond();
  await assert.rejects(() => admission.acquire({ clientKey: 'a' }), (error) => error.code === 'RATE_LIMITED');
  timestamp = 2_000;
  await assert.rejects(() => admission.acquire({ clientKey: 'c' }), (error) => error.code === 'BUDGET_EXHAUSTED');

  const externallyDenied = createAnonymousStudyAdmission({ externalCheck: async () => ({ allowed: false, code: 'SHARED_BUDGET_DENIED' }) });
  await assert.rejects(() => externallyDenied.acquire({ clientKey: 'a' }), (error) => error.code === 'SHARED_BUDGET_DENIED');
});
