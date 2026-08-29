import { APICallError } from 'ai';
import { anonymousClientKey, anonymousStudyAdmission, McpAdmissionError } from '../server/mcp-abuse-controls.js';
import { admissionUnitsForResearchMode, requestSchema, runStudyPipeline, StudyPipelineError } from '../server/synthetic-study-pipeline.js';

export const config = {
  maxDuration: 60,
};

function sendError(response, status, message, details) {
  response.status(status).json({ error: message, ...(details ? { details } : {}) });
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendError(response, 405, 'Use POST to generate a synthetic study.');
  }

  const parsed = requestSchema.safeParse(request.body);
  if (!parsed.success) {
    return sendError(
      response,
      400,
      'Enter a clear research question, audience, panel size between 50 and 500, and valid optional evidence.',
      parsed.error.issues.map((issue) => ({ field: issue.path.join('.') || 'request', message: issue.message })),
    );
  }

  const clientKey = anonymousClientKey(request.headers);
  let releaseAdmission = () => {};
  try {
    releaseAdmission = await anonymousStudyAdmission.acquire({
      clientKey,
      estimatedUnits: admissionUnitsForResearchMode(parsed.data.researchMode),
    });
    const result = await runStudyPipeline(parsed.data, { gatewayUserId: clientKey });
    return response.status(200).json(result);
  } catch (error) {
    console.error('Synthetic study generation failed', {
      name: error?.name,
      message: error?.message,
      statusCode: error?.statusCode,
      causeName: error?.cause?.name,
      causeMessage: error?.cause?.message,
      causeStatusCode: error?.cause?.statusCode,
    });

    if (error instanceof McpAdmissionError) {
      if (error.retryAfterSeconds) response.setHeader('Retry-After', String(error.retryAfterSeconds));
      const status = error.code === 'RATE_LIMITED' || error.code === 'CONCURRENCY_LIMIT' ? 429 : 503;
      return sendError(response, status, error.message);
    }
    if (error instanceof StudyPipelineError) {
      const providerStatus = error.cause?.statusCode;
      if (providerStatus === 429) return sendError(response, 429, 'The synthetic panel is busy. Try again in a moment.');
      if (providerStatus === 402) return sendError(response, 503, 'The AI Gateway budget is currently unavailable.');
      if (providerStatus === 503) return sendError(response, 503, 'The synthetic panel is temporarily unavailable. Try again shortly.');
      if (providerStatus === 401 || providerStatus === 403) return sendError(response, 503, 'The AI Gateway is not configured for this deployment.');
      return sendError(response, error.statusCode, error.message);
    }
    if (APICallError.isInstance(error)) {
      if (error.statusCode === 429) return sendError(response, 429, 'The synthetic panel is busy. Try again in a moment.');
      if (error.statusCode === 402) return sendError(response, 503, 'The AI Gateway budget is currently unavailable.');
      if (error.statusCode === 503) return sendError(response, 503, 'The synthetic panel is temporarily unavailable. Try again shortly.');
      if (error.statusCode === 401 || error.statusCode === 403) return sendError(response, 503, 'The AI Gateway is not configured for this deployment.');
    }
    return sendError(response, 500, 'We could not generate this study. Please try again.');
  } finally {
    releaseAdmission();
  }
}
