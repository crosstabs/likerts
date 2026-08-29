import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { admissionUnitsForResearchMode, estimatedModelCallsForResearchMode, StudyPipelineError, runStudyPipeline } from './synthetic-study-pipeline.js';
import {
  LIMITATIONS_MARKDOWN,
  LIMITATIONS_URI,
  MCP_CONTRACT_VERSION,
  MCP_SERVER_INFO,
  METHODOLOGY_MARKDOWN,
  METHODOLOGY_URI,
  publicValidationIssues,
  runSyntheticStudyInputSchema,
  runSyntheticStudyOutputSchema,
  validateBriefInputSchema,
  validateBriefOutputSchema,
} from './mcp-contract.js';
import {
  McpAdmissionError,
  anonymousClientKey,
  anonymousStudyAdmission,
} from './mcp-abuse-controls.js';
import {
  SAMPLE_STUDY_CATALOG_URI,
  getSampleStudy,
  listSampleStudies,
  readSampleStudyCatalog,
  sampleStudyRegistryEntries,
  sampleStudyResourceUri,
} from './sample-study-catalog.js';

// Official SDK contract: tools/resources are registered on a fresh server instance per HTTP request.
// Source: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md#create-a-handler

function errorResult(code, message, { retryable = false, retryAfterSeconds = null } = {}) {
  const structuredContent = {
    ok: false,
    contractVersion: MCP_CONTRACT_VERSION,
    error: { code, message, retryable, retryAfterSeconds },
  };
  return {
    isError: true,
    content: [{ type: 'text', text: `${code}: ${message}` }],
    structuredContent,
  };
}

const PUBLIC_ADMISSION_ERRORS = Object.freeze({
  RATE_LIMITED: { message: 'This anonymous client has reached the synthetic study rate limit.', retryable: true },
  CONCURRENCY_LIMIT: { message: 'The synthetic study service is busy. Try again shortly.', retryable: true },
  BUDGET_EXHAUSTED: { message: 'The synthetic study budget is currently unavailable.', retryable: false },
  SYNTHETIC_RUNS_DISABLED: { message: 'Public synthetic study runs are temporarily disabled.', retryable: false },
});

const listSampleStudiesInputSchema = z.object({
  locale: z.string().trim().min(2).max(16).optional(),
  industry: z.string().trim().min(2).max(80).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict();

const getSampleStudyInputSchema = z.object({
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
}).strict();

function safePipelineError(error) {
  if (error instanceof McpAdmissionError) {
    const code = PUBLIC_ADMISSION_ERRORS[error.code] ? error.code : 'BUDGET_EXHAUSTED';
    const publicError = PUBLIC_ADMISSION_ERRORS[code];
    return errorResult(code, publicError.message, {
      retryable: publicError.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
    });
  }
  if (error instanceof StudyPipelineError && error.statusCode === 424) {
    return errorResult('EXTERNAL_EVIDENCE_UNAVAILABLE', 'Required external evidence could not be acquired.', { retryable: true });
  }
  const providerStatus = error instanceof StudyPipelineError ? error.cause?.statusCode : error?.statusCode;
  if (providerStatus === 429 || providerStatus === 503) {
    return errorResult('UPSTREAM_BUSY', 'The synthetic study service is busy. Try again shortly.', { retryable: true, retryAfterSeconds: 30 });
  }
  if (providerStatus === 402) {
    return errorResult('MODEL_BUDGET_UNAVAILABLE', 'The synthetic study budget is currently unavailable.');
  }
  if (providerStatus === 401 || providerStatus === 403) {
    return errorResult('SERVICE_UNAVAILABLE', 'The synthetic study service is not configured for this deployment.');
  }
  if (error instanceof StudyPipelineError) {
    return errorResult('STUDY_PIPELINE_FAILED', 'The synthetic study could not be completed.', { retryable: error.statusCode >= 500 });
  }
  return errorResult('INTERNAL_ERROR', 'The synthetic study could not be completed.', { retryable: true });
}

function validationSummary(validation) {
  if (validation.valid) return `Research brief is valid. Running it is expected to use ${validation.estimatedModelCalls} bounded model calls.`;
  return `Research brief is invalid (${validation.issues.length} issue${validation.issues.length === 1 ? '' : 's'}). No model was called.`;
}

function studySummary(result) {
  const title = result.study?.title || 'Untitled synthetic study';
  const evidenceMode = result.meta?.evidenceMode || 'unknown';
  const credibility = result.meta?.credibility?.level || 'illustrative-only';
  const takeaway = result.study?.takeaway || 'Review the structured result and cautions.';
  return [
    `Synthetic study generated: ${title}`,
    'This output is model-generated and does not contain observed human responses.',
    `Evidence mode: ${evidenceMode}. Credibility: ${credibility}.`,
    `Takeaway: ${takeaway}`,
  ].join('\n');
}

function defaultReportError(error) {
  console.error('Likerts MCP operation failed', {
    name: error?.name || 'Error',
    statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : undefined,
    code: typeof error?.code === 'string' ? error.code : undefined,
  });
}

export function createLikertsMcpServer({
  runStudy = runStudyPipeline,
  admission = anonymousStudyAdmission,
  clientKey = 'anonymous',
  reportError = defaultReportError,
} = {}) {
  const admissionProtection = {
    durability: admission.protection?.durability === 'durable-adapter-plus-process-local-fallback' ? 'durable-adapter-plus-process-local-fallback' : 'process-local-fallback',
    processLocalFallback: true,
    globallyDurable: admission.protection?.globallyDurable === true,
  };
  const server = new McpServer(MCP_SERVER_INFO, {
    instructions: 'Likerts exposes synthetic, directional research tools. Never present its output as observed human evidence, a representative estimate, or independent source verification.',
  });

  server.registerTool(
    'validate_research_brief',
    {
      title: 'Validate a synthetic research brief',
      description: 'Validate and normalize a proposed Likerts research brief without calling a model or retrieving external evidence.',
      inputSchema: validateBriefInputSchema,
      outputSchema: validateBriefOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ brief }) => {
      const parsed = runSyntheticStudyInputSchema.safeParse(brief);
      const validation = parsed.success
        ? {
            valid: true,
            issues: [],
            normalizedInput: parsed.data,
            estimatedModelCalls: estimatedModelCallsForResearchMode(parsed.data.researchMode),
            estimatedAdmissionUnits: admissionUnitsForResearchMode(parsed.data.researchMode),
            admissionProtection,
            syntheticPanel: true,
            mayUseExternalRetrieval: parsed.data.evidencePolicy !== 'PRIOR_ONLY',
          }
        : {
            valid: false,
            issues: publicValidationIssues(parsed.error),
            normalizedInput: null,
            estimatedModelCalls: estimatedModelCallsForResearchMode(brief.researchMode),
            estimatedAdmissionUnits: admissionUnitsForResearchMode(brief.researchMode),
            admissionProtection,
            syntheticPanel: true,
            mayUseExternalRetrieval: brief.evidencePolicy !== 'PRIOR_ONLY',
          };
      const structuredContent = { ok: true, contractVersion: MCP_CONTRACT_VERSION, validation };
      return { content: [{ type: 'text', text: validationSummary(validation) }], structuredContent };
    },
  );

  server.registerTool(
    'run_synthetic_study',
    {
      title: 'Run an evidence-aware synthetic Likert study',
      description: 'Run a bounded, model-generated Likert study for directional hypothesis generation in QUICK or DEEP mode. This can incur model and retrieval cost. It never surveys humans; supplied and retrieved evidence remains untrusted and is not independently verified.',
      inputSchema: runSyntheticStudyInputSchema,
      outputSchema: runSyntheticStudyOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      let release;
      try {
        release = await admission.acquire({ clientKey, estimatedUnits: admissionUnitsForResearchMode(input.researchMode) });
        const result = await runStudy(input, { gatewayUserId: clientKey });
        const structuredContent = {
          ok: true,
          contractVersion: MCP_CONTRACT_VERSION,
          synthetic: true,
          evidenceAware: true,
          result,
        };
        return { content: [{ type: 'text', text: studySummary(result) }], structuredContent };
      } catch (error) {
        reportError(error);
        return safePipelineError(error);
      } finally {
        release?.();
      }
    },
  );

  server.registerTool(
    'list_sample_studies',
    {
      title: 'List frozen Likerts sample studies',
      description: 'List the published Likerts sample-study catalog without calling models, retrieval, or admission controls. Optional locale and industry filters are bounded and exact-match.',
      inputSchema: listSampleStudiesInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const catalog = await listSampleStudies(input);
      const structuredContent = {
        ok: true,
        contractVersion: MCP_CONTRACT_VERSION,
        synthetic: true,
        generated: false,
        catalog,
      };
      return {
        content: [{ type: 'text', text: `Found ${catalog.studies.length} frozen sample stud${catalog.studies.length === 1 ? 'y' : 'ies'}. These are synthetic examples, not observed human research.` }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    'get_sample_study',
    {
      title: 'Get one frozen Likerts sample study',
      description: 'Fetch a published sample-study record by exact slug without running models or retrieval. The record preserves synthetic disclosure, status, URLs, provenance, evidence, cost, and uncertainty when captured.',
      inputSchema: getSampleStudyInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ slug }) => {
      const study = await getSampleStudy(slug);
      if (!study) return errorResult('SAMPLE_STUDY_NOT_FOUND', 'No Likerts sample study exists for that slug.');
      const structuredContent = {
        ok: true,
        contractVersion: MCP_CONTRACT_VERSION,
        synthetic: true,
        generated: false,
        study,
      };
      return {
        content: [{ type: 'text', text: `${study.brief.title}\nSynthetic sample status: ${study.status}. No people were surveyed.` }],
        structuredContent,
      };
    },
  );

  server.registerResource(
    'synthetic-study-methodology',
    METHODOLOGY_URI,
    {
      title: 'Likerts synthetic study methodology',
      description: 'How Likerts frames, generates, adjudicates, and records evidence for a synthetic Likert study.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: METHODOLOGY_MARKDOWN }] }),
  );

  server.registerResource(
    'synthetic-study-limitations',
    LIMITATIONS_URI,
    {
      title: 'Likerts synthetic study limitations',
      description: 'Non-representativeness, evidence, persistence, and anonymous serverless limiting boundaries.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: LIMITATIONS_MARKDOWN }] }),
  );

  server.registerResource(
    'sample-study-catalog',
    SAMPLE_STUDY_CATALOG_URI,
    {
      title: 'Likerts sample study catalog',
      description: 'Machine-readable catalog of frozen synthetic sample studies, with status and JSON/detail URLs.',
      mimeType: 'application/json',
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await readSampleStudyCatalog(), null, 2) }] }),
  );

  for (const entry of sampleStudyRegistryEntries) {
    server.registerResource(
      `sample-study-${entry.slug}`,
      sampleStudyResourceUri(entry.slug),
      {
        title: `Likerts sample study: ${entry.title}`,
        description: `${entry.localeName}; ${entry.industryName}; ${entry.status}. Synthetic sample, not observed human research.`,
        mimeType: 'application/json',
      },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await getSampleStudy(entry.slug), null, 2) }] }),
    );
  }

  return server;
}

export function createLikertsMcpHandler({
  runStudy,
  admission,
  reportError = defaultReportError,
} = {}) {
  // The per-request factory is the SDK's stateless serverless pattern and avoids cross-client instance reuse.
  // Source: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md#understand-the-per-request-factory
  return createMcpHandler(
    ({ requestInfo }) => createLikertsMcpServer({
      runStudy,
      admission,
      clientKey: requestInfo ? anonymousClientKey(requestInfo.headers) : 'anonymous',
      reportError,
    }),
    {
      legacy: 'stateless',
      responseMode: 'auto',
      maxSubscriptions: 8,
      keepAliveMs: 0,
      onerror: reportError,
    },
  );
}

export const likertsMcpHandler = createLikertsMcpHandler();
