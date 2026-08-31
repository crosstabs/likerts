import { validateJsonApiRequest } from '../server/api-boundary.js';
import { anonymousClientKey, McpAdmissionError } from '../server/mcp-abuse-controls.js';
import { runtimeAdmission } from '../server/runtime-admission-store.js';
import {
  groundedInterviewRequestSchema,
  prepareGroundedInterviewRequest,
  runGroundedSegmentInterview,
  SegmentPerspectiveError,
} from '../server/qualitative-interview.js';
import { logStructuredEvent, observeApiHandler, resolveCorrelationId, setCorrelationHeader } from '../server/observability.js';
import { RuntimeConfigurationError, assertRuntimeCanExecute } from '../server/runtime-config.js';
import { LocalizationRequestError } from '../server/localization-request.js';

export const config = { maxDuration: 30 };

function sendError(response, status, message, code, details, correlationId) {
  response.status(status).json({ error: message, ...(code ? { code } : {}), ...(correlationId ? { correlationId } : {}), ...(details ? { details } : {}) });
}

export function createSegmentPerspectiveApiHandler({
  env = process.env,
  logger = console,
  admission = runtimeAdmission,
  runPerspective = runGroundedSegmentInterview,
} = {}) {
  const handler = async function handler(request, response) {
    const correlationId = resolveCorrelationId(request.headers);
    response.setHeader('Cache-Control', 'no-store');
    setCorrelationHeader(response, correlationId);

    const boundary = await validateJsonApiRequest(request, response, { env });
    if (!boundary.ok) {
      if (boundary.handled) return undefined;
      return sendError(response, boundary.status, boundary.message, boundary.code, null, correlationId);
    }

    try {
      assertRuntimeCanExecute(env, { synthetic: true, admissionProtection: admission?.protection });
    } catch (error) {
      if (error instanceof RuntimeConfigurationError) {
        logStructuredEvent({
          level: 'warn',
          component: 'api.segment-perspective',
          event: 'request_blocked',
          correlationId,
          error,
          attributes: { method: request.method, reason: error.code },
        }, { logger, env });
        return sendError(response, 503, error.publicMessage, error.code, null, correlationId);
      }
      throw error;
    }

    const parsed = groundedInterviewRequestSchema.safeParse(boundary.body);
    if (!parsed.success) {
      return sendError(
        response,
        400,
        'Enter a valid frozen-run segment, bounded question, complete conversation history, and internally consistent grounding context.',
        'INVALID_SEGMENT_PERSPECTIVE_REQUEST',
        parsed.error.issues.map((issue) => ({ field: issue.path.join('.') || 'request', message: issue.message })),
        correlationId,
      );
    }

    let perspectiveRequest;
    try {
      perspectiveRequest = prepareGroundedInterviewRequest(parsed.data);
    } catch (error) {
      if (error instanceof SegmentPerspectiveError || error instanceof LocalizationRequestError) {
        return sendError(response, error instanceof LocalizationRequestError ? 400 : error.statusCode, error.publicMessage || error.message, error.code, null, correlationId);
      }
      throw error;
    }

    const clientKey = anonymousClientKey(request.headers, env);
    let releaseAdmission = () => {};
    try {
      releaseAdmission = await admission.acquire({ clientKey, estimatedUnits: 1 });
      const result = await runPerspective(perspectiveRequest, { gatewayUserId: clientKey });
      const [lineage] = result?.modelLineage || [];
      logStructuredEvent({
        level: 'info',
        component: 'api.segment-perspective',
        event: 'segment_followup_finished',
        correlationId,
        attributes: {
          outcome: 'succeeded',
          intent: perspectiveRequest.intent,
          researchMethod: perspectiveRequest.grounding.researchMethod,
          reportLocale: perspectiveRequest.grounding.outputLocale,
          durationMs: lineage?.durationMs,
          tokenUsage: lineage?.usage,
          gatewayCostUsdExact: lineage?.gatewayCostUsdExact,
        },
      }, { logger, env });
      return response.status(200).json(result);
    } catch (error) {
      logStructuredEvent({
        level: 'error',
        component: 'api.segment-perspective',
        event: 'request_failed',
        correlationId,
        error,
        attributes: {
          method: request.method,
          intent: perspectiveRequest.intent,
          researchMethod: perspectiveRequest.grounding.researchMethod,
          reportLocale: perspectiveRequest.grounding.outputLocale,
          providerStatusCode: error?.cause?.statusCode,
          admissionCode: error instanceof McpAdmissionError ? error.code : undefined,
        },
      }, { logger, env });
      if (error instanceof McpAdmissionError) {
        if (error.retryAfterSeconds) response.setHeader('Retry-After', String(error.retryAfterSeconds));
        const status = error.code === 'RATE_LIMITED' || error.code === 'CONCURRENCY_LIMIT' ? 429 : 503;
        return sendError(response, status, error.message, error.code, null, correlationId);
      }
      if (error instanceof SegmentPerspectiveError) {
        return sendError(response, error.statusCode, error.message, error.code, null, correlationId);
      }
      return sendError(response, 500, 'The model-grounded segment perspective could not be generated.', 'PERSPECTIVE_GENERATION_FAILED', null, correlationId);
    } finally {
      await releaseAdmission();
    }
  };
  return observeApiHandler(handler, {
    component: 'api.segment-perspective',
    route: '/api/segment-perspective',
    logger,
    env,
  });
}

export default createSegmentPerspectiveApiHandler();
