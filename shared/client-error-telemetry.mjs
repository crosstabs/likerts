import { z } from 'zod';

export const CLIENT_ERROR_TELEMETRY_VERSION = 'client-error-v1';

const correlationId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
const publicCode = z.string().regex(/^[A-Z][A-Z0-9_:-]{1,79}$/);
const safeToken = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/);

export const clientErrorTelemetrySchema = z.object({
  schemaVersion: z.literal(CLIENT_ERROR_TELEMETRY_VERSION),
  captureKind: z.enum(['react-boundary', 'window-error', 'unhandled-rejection', 'caught-request']),
  surface: z.enum(['app']),
  action: z.enum(['render', 'global', 'promise', 'study-run']).nullable().default(null),
  errorType: safeToken,
  fingerprint: z.string().regex(/^[a-f0-9]{16}$/),
  publicCode: publicCode.nullable().default(null),
  correlationId: correlationId.nullable().default(null),
  statusCode: z.number().int().min(100).max(599).nullable().default(null),
  frame: z.object({
    asset: z.string().regex(/^\/[A-Za-z0-9_./-]{1,180}$/),
    line: z.number().int().min(1).max(10_000_000),
    column: z.number().int().min(1).max(10_000_000),
  }).strict().nullable().default(null),
}).strict();
