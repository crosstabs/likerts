import { validateJsonApiRequest } from '../server/api-boundary.js';
import { anonymousClientKey, createFixedWindowLimiter } from '../server/mcp-abuse-controls.js';
import { logStructuredEvent, observeApiHandler, resolveCorrelationId, setCorrelationHeader } from '../server/observability.js';
import { clientErrorTelemetrySchema } from '../shared/client-error-telemetry.mjs';

export const MAX_CLIENT_EVENT_BODY_BYTES = 4 * 1_024;
const clientErrorLimiter = createFixedWindowLimiter({ limit: 30 });

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  return response.end(JSON.stringify(value));
}

export function createClientEventsApiHandler({
  env = process.env,
  logger = console,
  requestLimiter = clientErrorLimiter,
} = {}) {
  const handler = async function clientEventsApiHandler(request, response) {
    const requestCorrelationId = resolveCorrelationId(request.headers);
    setCorrelationHeader(response, requestCorrelationId);

    const boundary = await validateJsonApiRequest(request, response, {
      env,
      maxBodyBytes: MAX_CLIENT_EVENT_BODY_BYTES,
    });
    if (!boundary.ok) {
      if (boundary.handled) return undefined;
      return sendJson(response, boundary.status, {
        error: boundary.message,
        code: boundary.code,
        correlationId: requestCorrelationId,
      });
    }

    const parsed = clientErrorTelemetrySchema.safeParse(boundary.body);
    if (!parsed.success) {
      return sendJson(response, 400, {
        error: 'The client error event is invalid.',
        code: 'INVALID_CLIENT_ERROR_EVENT',
        correlationId: requestCorrelationId,
      });
    }

    const rate = requestLimiter.check(anonymousClientKey(request.headers, env));
    if (!rate.allowed) {
      response.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return sendJson(response, 429, {
        error: 'Too many client error events.',
        code: 'RATE_LIMITED',
        correlationId: requestCorrelationId,
      });
    }

    const event = parsed.data;
    logStructuredEvent({
      level: 'error',
      component: 'client.app',
      event: 'client_error',
      correlationId: event.correlationId || requestCorrelationId,
      error: {
        name: event.errorType,
        code: event.publicCode || undefined,
        statusCode: event.statusCode || undefined,
      },
      attributes: {
        captureKind: event.captureKind,
        surface: event.surface,
        action: event.action,
        fingerprint: event.fingerprint,
        frame: event.frame,
      },
    }, { logger, env });

    return sendJson(response, 202, { accepted: true, correlationId: requestCorrelationId });
  };

  return observeApiHandler(handler, {
    component: 'api.client-events',
    route: '/api/client-events',
    logger,
    env,
  });
}

export default createClientEventsApiHandler();
