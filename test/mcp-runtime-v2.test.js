import assert from 'node:assert/strict';
import test from 'node:test';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createLikertsMcpHandler } from '../server/mcp-server.js';
import { StudyPipelineError } from '../server/synthetic-study-pipeline.js';

const deepBrief = {
  prompt: 'Would this audience adopt a shared workspace?',
  audience: 'Small business operations leaders',
  panelSize: 100,
  evidencePolicy: 'PRIOR_ONLY',
  researchMode: 'deep',
};

test('MCP validates additive Deep mode and applies its weighted admission units', async () => {
  const admissions = [];
  let received;
  let receivedRuntimeOptions;
  const handler = createLikertsMcpHandler({
    reportError: () => {},
    admission: { async acquire(request) { admissions.push(request); return () => {}; } },
    runStudy: async (input, runtimeOptions) => {
      received = input;
      receivedRuntimeOptions = runtimeOptions;
      return { study: { title: 'Synthetic study', takeaway: 'Validate with real participants.' }, meta: { evidenceMode: 'PRIOR_ONLY', credibility: { level: 'illustrative-only' } } };
    },
  });
  const transport = new StreamableHTTPClientTransport(new URL('https://likerts.example/api/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const client = new Client({ name: 'runtime-v2-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  try {
    await client.connect(transport);
    const validation = await client.callTool({ name: 'validate_research_brief', arguments: { brief: deepBrief } });
    assert.equal(validation.structuredContent.validation.normalizedInput.researchMode, 'DEEP');
    assert.equal(validation.structuredContent.validation.estimatedModelCalls, 7);
    assert.equal(validation.structuredContent.validation.estimatedAdmissionUnits, 3);

    const run = await client.callTool({ name: 'run_synthetic_study', arguments: deepBrief });
    assert.equal(run.isError, undefined);
    assert.equal(received.researchMode, 'DEEP');
    assert.equal(admissions[0].estimatedUnits, 3);
    assert.equal(receivedRuntimeOptions.gatewayUserId, admissions[0].clientKey);
    assert.match(receivedRuntimeOptions.gatewayUserId, /^[a-f0-9]{64}$/);
  } finally {
    await client.close();
    await handler.close();
  }
});

test('MCP preserves the public budget-unavailable pattern for wrapped Gateway 402 errors', async () => {
  const handler = createLikertsMcpHandler({
    reportError: () => {},
    runStudy: async () => { throw new StudyPipelineError('internal stage detail', 503, { statusCode: 402 }); },
    admission: { async acquire() { return () => {}; } },
  });
  const transport = new StreamableHTTPClientTransport(new URL('https://likerts.example/api/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const client = new Client({ name: 'runtime-v2-error-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'run_synthetic_study', arguments: deepBrief });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, 'MODEL_BUDGET_UNAVAILABLE');
    assert.equal(JSON.stringify(result).includes('internal stage detail'), false);
  } finally {
    await client.close();
    await handler.close();
  }
});

test('MCP preserves the typed required-source no-match code without exposing provider detail', async () => {
  const handler = createLikertsMcpHandler({
    reportError: () => {},
    runStudy: async () => {
      throw new StudyPipelineError(
        'private provider-specific acquisition detail',
        424,
        undefined,
        'REQUIRED_SOURCE_LANGUAGE_UNAVAILABLE',
      );
    },
    admission: { async acquire() { return () => {}; } },
  });
  const transport = new StreamableHTTPClientTransport(new URL('https://likerts.example/api/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const client = new Client({ name: 'runtime-v2-source-language-error-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'run_synthetic_study', arguments: deepBrief });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, 'REQUIRED_SOURCE_LANGUAGE_UNAVAILABLE');
    assert.match(result.structuredContent.error.message, /provider-declared primary language.*registered-script compatibility check/);
    assert.match(result.structuredContent.error.message, /This check is not language identification\./);
    assert.equal(JSON.stringify(result).includes('private provider-specific'), false);
  } finally {
    await client.close();
    await handler.close();
  }
});
