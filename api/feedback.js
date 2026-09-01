import { validateJsonApiRequest } from '../server/api-boundary.js';
import { anonymousClientKey, createFixedWindowLimiter } from '../server/mcp-abuse-controls.js';
import { logStructuredEvent, observeApiHandler, resolveCorrelationId, setCorrelationHeader } from '../server/observability.js';
import { productFeedbackSchema } from '../shared/product-feedback.mjs';

export const MAX_FEEDBACK_BODY_BYTES = 4 * 1_024;
const FEEDBACK_WINDOW_MS = 60 * 60 * 1_000;
const feedbackLimiter = createFixedWindowLimiter({ limit: 6, windowMs: FEEDBACK_WINDOW_MS });

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  return response.end(JSON.stringify(value));
}

export function createFeedbackApiHandler({
  env = process.env,
  logger = console,
  requestLimiter = feedbackLimiter,
} = {}) {
  const handler = async function feedbackApiHandler(request, response) {
    const correlationId = resolveCorrelationId(request.headers);
    setCorrelationHeader(response, correlationId);

    const boundary = await validateJsonApiRequest(request, response, {
      env,
      maxBodyBytes: MAX_FEEDBACK_BODY_BYTES,
    });
    if (!boundary.ok) {
      if (boundary.handled) return undefined;
      return sendJson(response, boundary.status, {
        error: boundary.message,
        code: boundary.code,
        correlationId,
      });
    }

    const parsed = productFeedbackSchema.safeParse(boundary.body);
    if (!parsed.success) {
      return sendJson(response, 400, {
        error: 'The feedback submission is invalid.',
        code: 'INVALID_FEEDBACK',
        correlationId,
      });
    }

    const rate = requestLimiter.check(anonymousClientKey(request.headers, env));
    if (!rate.allowed) {
      response.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return sendJson(response, 429, {
        error: 'Too many feedback submissions. Try again later.',
        code: 'RATE_LIMITED',
        correlationId,
      });
    }

    const feedback = parsed.data;
    logStructuredEvent({
      level: 'info',
      component: 'client.feedback',
      event: 'feedback_received',
      correlationId,
      attributes: {
        category: feedback.category,
        interfaceLocale: feedback.interfaceLocale,
        pagePath: feedback.pagePath,
        feedbackText: feedback.message,
      },
    }, { logger, env });

    return sendJson(response, 202, { accepted: true, correlationId });
  };

  return observeApiHandler(handler, {
    component: 'api.feedback',
    route: '/api/feedback',
    logger,
    env,
  });
}

export default createFeedbackApiHandler();
