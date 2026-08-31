import { APICallError } from 'ai';
import { validateJsonApiRequest } from '../server/api-boundary.js';
import { anonymousClientKey, McpAdmissionError } from '../server/mcp-abuse-controls.js';
import { runtimeAdmission } from '../server/runtime-admission-store.js';
import { LocalizationRequestError, assertLocalizationExecutionAllowed } from '../server/localization-request.js';
import { admissionUnitsForResearchMode, requestSchema, runStudyPipeline, StudyPipelineError } from '../server/synthetic-study-pipeline.js';
import { RuntimeConfigurationError, assertRuntimeCanExecute } from '../server/runtime-config.js';
import { logStructuredEvent, resolveCorrelationId, setCorrelationHeader } from '../server/observability.js';

export const config = {
  maxDuration: 60,
};

function sendError(response, status, message, details, { code, correlationId } = {}) {
  response.status(status).json({ error: message, ...(code ? { code } : {}), ...(correlationId ? { correlationId } : {}), ...(details ? { details } : {}) });
}

export function createSyntheticStudyApiHandler({
  env = process.env,
  logger = console,
  admission = runtimeAdmission,
  runStudy = runStudyPipeline,
} = {}) {
  return async function handler(request, response) {
    const correlationId = resolveCorrelationId(request.headers);
    response.setHeader('Cache-Control', 'no-store');
    setCorrelationHeader(response, correlationId);

    const boundary = await validateJsonApiRequest(request, response, { env });
    if (!boundary.ok) {
      if (boundary.handled) return undefined;
      return sendError(response, boundary.status, boundary.message, null, { code: boundary.code, correlationId });
    }

    try {
      assertRuntimeCanExecute(env, { synthetic: true, admissionProtection: admission?.protection });
    } catch (error) {
      if (error instanceof RuntimeConfigurationError) {
        logStructuredEvent({
          level: 'warn',
          component: 'api.synthetic-study',
          event: 'request_blocked',
          correlationId,
          error,
          attributes: { method: request.method, reason: error.code },
        }, { logger });
        return sendError(response, 503, error.publicMessage, null, { code: error.code, correlationId });
      }
      throw error;
    }

    const parsed = requestSchema.safeParse(boundary.body);
    if (!parsed.success) {
      return sendError(
        response,
        400,
        'Enter a clear research question, audience, supported research method configuration, and valid optional evidence.',
        parsed.error.issues.map((issue) => ({ field: issue.path.join('.') || 'request', message: issue.message })),
        { code: 'VALIDATION_ERROR', correlationId },
      );
    }

    try {
      assertLocalizationExecutionAllowed(parsed.data.localization);
    } catch (error) {
      if (!(error instanceof LocalizationRequestError)) throw error;
      return sendError(
        response,
        400,
        error.publicMessage,
        [{ field: error.path.join('.') || 'localization', message: error.publicMessage }],
        { code: error.code, correlationId },
      );
    }

    const clientKey = anonymousClientKey(request.headers, env);
    let releaseAdmission = () => {};
    try {
      releaseAdmission = await admission.acquire({
        clientKey,
        estimatedUnits: admissionUnitsForResearchMode(parsed.data.researchMode),
      });
      const result = await runStudy(parsed.data, { gatewayUserId: clientKey, correlationId, logger });
      return response.status(200).json(result);
    } catch (error) {
      logStructuredEvent({
        level: 'error',
        component: 'api.synthetic-study',
        event: 'request_failed',
        correlationId,
        error,
        attributes: {
          method: request.method,
          providerStatusCode: error?.cause?.statusCode,
          admissionCode: error instanceof McpAdmissionError ? error.code : undefined,
        },
      }, { logger });

      if (error instanceof McpAdmissionError) {
        if (error.retryAfterSeconds) response.setHeader('Retry-After', String(error.retryAfterSeconds));
        const status = error.code === 'RATE_LIMITED' || error.code === 'CONCURRENCY_LIMIT' ? 429 : 503;
        return sendError(response, status, error.message, null, { code: error.code, correlationId });
      }
      if (error instanceof StudyPipelineError) {
        const providerStatus = error.cause?.statusCode;
        if (providerStatus === 429) return sendError(response, 429, 'The model service is busy. Try again in a moment.', null, { code: 'MODEL_RATE_LIMITED', correlationId });
        if (providerStatus === 402) return sendError(response, 503, 'The AI Gateway budget is currently unavailable.', null, { code: 'MODEL_BUDGET_UNAVAILABLE', correlationId });
        if (providerStatus === 503) return sendError(response, 503, 'The model service is temporarily unavailable. Try again shortly.', null, { code: 'MODEL_UNAVAILABLE', correlationId });
        if (providerStatus === 401 || providerStatus === 403) return sendError(response, 503, 'The AI Gateway is not configured for this deployment.', null, { code: 'MODEL_GATEWAY_NOT_CONFIGURED', correlationId });
        return sendError(response, error.statusCode, error.message, null, { code: error.code || 'PIPELINE_ERROR', correlationId });
      }
      if (APICallError.isInstance(error)) {
        if (error.statusCode === 429) return sendError(response, 429, 'The model service is busy. Try again in a moment.', null, { code: 'MODEL_RATE_LIMITED', correlationId });
        if (error.statusCode === 402) return sendError(response, 503, 'The AI Gateway budget is currently unavailable.', null, { code: 'MODEL_BUDGET_UNAVAILABLE', correlationId });
        if (error.statusCode === 503) return sendError(response, 503, 'The model service is temporarily unavailable. Try again shortly.', null, { code: 'MODEL_UNAVAILABLE', correlationId });
        if (error.statusCode === 401 || error.statusCode === 403) return sendError(response, 503, 'The AI Gateway is not configured for this deployment.', null, { code: 'MODEL_GATEWAY_NOT_CONFIGURED', correlationId });
      }
      return sendError(response, 500, 'We could not generate this study. Please try again.', null, { code: 'INTERNAL_ERROR', correlationId });
    } finally {
      await releaseAdmission();
    }
  };
}

export default createSyntheticStudyApiHandler();
