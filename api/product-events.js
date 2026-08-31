import { validateJsonApiRequest } from '../server/api-boundary.js';
import { anonymousClientKey, createFixedWindowLimiter } from '../server/mcp-abuse-controls.js';
import { logStructuredEvent, observeApiHandler, resolveCorrelationId, setCorrelationHeader } from '../server/observability.js';
import { sanitizeLikertsAnalyticsEnvelope } from '../src/lib/webAnalyticsPolicy.js';

export const MAX_PRODUCT_EVENT_BODY_BYTES = 4 * 1_024;
const productEventLimiter = createFixedWindowLimiter({ limit: 120 });

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  return response.end(JSON.stringify(value));
}

export function createProductEventsApiHandler({
  env = process.env,
  logger = console,
  requestLimiter = productEventLimiter,
} = {}) {
  const handler = async function productEventsApiHandler(request, response) {
    const correlationId = resolveCorrelationId(request.headers);
    setCorrelationHeader(response, correlationId);
    const boundary = await validateJsonApiRequest(request, response, {
      env,
      maxBodyBytes: MAX_PRODUCT_EVENT_BODY_BYTES,
    });
    if (!boundary.ok) {
      if (boundary.handled) return undefined;
      return sendJson(response, boundary.status, {
        error: boundary.message,
        code: boundary.code,
        correlationId,
      });
    }

    const event = sanitizeLikertsAnalyticsEnvelope(boundary.body);
    if (!event) {
      return sendJson(response, 400, {
        error: 'The product event is invalid.',
        code: 'INVALID_PRODUCT_EVENT',
        correlationId,
      });
    }

    const rate = requestLimiter.check(anonymousClientKey(request.headers, env));
    if (!rate.allowed) {
      response.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return sendJson(response, 429, {
        error: 'Too many product events.',
        code: 'RATE_LIMITED',
        correlationId,
      });
    }

    logStructuredEvent({
      level: 'info',
      component: 'client.app',
      event: 'product_event',
      correlationId,
      attributes: {
        productEvent: event.name,
        properties: event.properties,
      },
    }, { logger, env });
    return sendJson(response, 202, { accepted: true, correlationId });
  };

  return observeApiHandler(handler, {
    component: 'api.product-events',
    route: '/api/product-events',
    logger,
    env,
  });
}

export default createProductEventsApiHandler();
