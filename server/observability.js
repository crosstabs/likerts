import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { redactSensitive } from './privacy-contract.js';

export const STRUCTURED_EVENT_VERSION = 'structured-event-v1';
export const CORRELATION_ID_HEADER = 'X-Correlation-ID';

const correlationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const telemetryKey = /prompt|source|evidence|respondent|quote|transcript|rawtext|body/i;

export const eventSchema = z.object({
  schemaVersion: z.literal(STRUCTURED_EVENT_VERSION),
  timestamp: z.string().datetime({ offset: true }),
  level: z.enum(['info', 'warn', 'error']),
  component: z.string().trim().min(1).max(120),
  event: z.string().trim().min(1).max(120).regex(/^[a-z0-9_.:-]+$/i),
  correlationId: z.string().regex(correlationIdPattern),
  attributes: z.record(z.string(), z.unknown()).default({}),
  error: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    code: z.string().trim().min(1).max(120).optional(),
    statusCode: z.number().int().min(100).max(599).optional(),
  }).strict().optional(),
}).strict();

export function headerValue(headers, name) {
  if (headers instanceof Headers) return headers.get(name) || '';
  if (!headers) return '';
  const target = name.toLowerCase();
  const direct = headers[name] ?? headers[target];
  if (direct !== undefined) return Array.isArray(direct) ? direct[0] || '' : String(direct || '');
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return Array.isArray(value) ? value[0] || '' : String(value || '');
  }
  return '';
}

export function resolveCorrelationId(headers, { randomId = randomUUID } = {}) {
  const candidate = headerValue(headers, 'x-correlation-id') || headerValue(headers, 'x-request-id');
  return correlationIdPattern.test(candidate) ? candidate : randomId();
}

export function setCorrelationHeader(response, correlationId) {
  response.setHeader(CORRELATION_ID_HEADER, correlationId);
}

function sanitizeAttributes(value, key = '') {
  const normalizedKey = key.replaceAll(/[-_.\s]/g, '').toLowerCase();
  if (normalizedKey && telemetryKey.test(normalizedKey)) return '[OMITTED]';
  if (Array.isArray(value)) return value.map((item) => sanitizeAttributes(item));
  if (!value || typeof value !== 'object') return redactSensitive(value);
  const redacted = redactSensitive(value);
  return Object.fromEntries(Object.entries(redacted).map(([childKey, childValue]) => [
    childKey,
    sanitizeAttributes(childValue, childKey),
  ]));
}

function publicError(error = {}) {
  if (!error) return undefined;
  const candidate = {
    name: typeof error.name === 'string' ? error.name : undefined,
    code: typeof error.code === 'string' ? error.code : undefined,
    statusCode: Number.isInteger(error.statusCode) ? error.statusCode : undefined,
  };
  return Object.values(candidate).some((value) => value !== undefined) ? candidate : undefined;
}

export function createStructuredEvent(input, { now = () => new Date().toISOString() } = {}) {
  return eventSchema.parse({
    schemaVersion: STRUCTURED_EVENT_VERSION,
    timestamp: now(),
    level: input.level,
    component: input.component,
    event: input.event,
    correlationId: input.correlationId,
    attributes: sanitizeAttributes(input.attributes || {}),
    error: publicError(input.error),
  });
}

export function logStructuredEvent(input, { logger = console, now } = {}) {
  const event = createStructuredEvent(input, { now });
  const line = JSON.stringify(event);
  const target = event.level === 'error' ? logger.error : event.level === 'warn' ? logger.warn : logger.info;
  target.call(logger, line);
  return event;
}
