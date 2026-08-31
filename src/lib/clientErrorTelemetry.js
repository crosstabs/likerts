import {
  CLIENT_ERROR_TELEMETRY_VERSION,
  clientErrorTelemetrySchema,
} from '../../shared/client-error-telemetry.mjs';

const SAFE_ERROR_TYPE = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/;
const SAFE_PUBLIC_CODE = /^[A-Z][A-Z0-9_:-]{1,79}$/;
const SAFE_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const STACK_LOCATION = /((?:https?:\/\/|\/)[^\s)]+):(\d+):(\d+)/;

function hash32(value, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function fingerprint(value) {
  return `${hash32(value, 0x811c9dc5)}${hash32(value, 0x9e3779b9)}`;
}

function safeFrame(location, line, column, origin) {
  try {
    const url = new URL(location, origin);
    if (url.origin !== new URL(origin).origin || !/^\/[A-Za-z0-9_./-]{1,180}$/.test(url.pathname)) return null;
    const frame = { asset: url.pathname, line: Number(line), column: Number(column) };
    return Number.isInteger(frame.line) && frame.line > 0
      && Number.isInteger(frame.column) && frame.column > 0
      ? frame
      : null;
  } catch {
    return null;
  }
}

export function firstPartyErrorFrame(error, { origin } = {}) {
  const trustedOrigin = origin || globalThis.location?.origin;
  if (!trustedOrigin || typeof error?.stack !== 'string') return null;
  for (const line of error.stack.split('\n').slice(1)) {
    const match = line.match(STACK_LOCATION);
    if (!match) continue;
    const frame = safeFrame(match[1], match[2], match[3], trustedOrigin);
    if (frame) return frame;
  }
  return null;
}

export function createClientErrorEvent(error, context = {}, options = {}) {
  const errorType = SAFE_ERROR_TYPE.test(String(error?.name || ''))
    ? String(error.name)
    : error instanceof Error ? 'Error' : 'NonErrorRejection';
  const frame = context.frame || firstPartyErrorFrame(error, options);
  const publicCode = SAFE_PUBLIC_CODE.test(String(context.publicCode || error?.publicCode || error?.code || ''))
    ? String(context.publicCode || error?.publicCode || error?.code)
    : null;
  const correlationId = SAFE_CORRELATION_ID.test(String(context.correlationId || error?.correlationId || ''))
    ? String(context.correlationId || error?.correlationId)
    : null;
  const statusCode = Number.isInteger(context.statusCode ?? error?.statusCode)
    && (context.statusCode ?? error.statusCode) >= 100
    && (context.statusCode ?? error.statusCode) <= 599
    ? context.statusCode ?? error.statusCode
    : null;
  const identity = [context.captureKind, errorType, publicCode, frame?.asset, frame?.line, frame?.column].join(':');
  const candidate = {
    schemaVersion: CLIENT_ERROR_TELEMETRY_VERSION,
    captureKind: context.captureKind,
    surface: 'app',
    action: context.action || null,
    errorType,
    fingerprint: fingerprint(identity),
    publicCode,
    correlationId,
    statusCode,
    frame,
  };
  const parsed = clientErrorTelemetrySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function createClientErrorReporter({
  enabled = true,
  fetchImpl = globalThis.fetch,
  origin = globalThis.location?.origin,
  maximumEvents = 5,
} = {}) {
  const fingerprints = new Set();
  let eventCount = 0;
  return (error, context) => {
    if (!enabled || typeof fetchImpl !== 'function' || eventCount >= maximumEvents) return false;
    const event = createClientErrorEvent(error, context, { origin });
    if (!event || fingerprints.has(event.fingerprint)) return false;
    try {
      const request = fetchImpl('/api/client-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        keepalive: true,
        body: JSON.stringify(event),
      });
      Promise.resolve(request).catch(() => {});
      fingerprints.add(event.fingerprint);
      eventCount += 1;
      return true;
    } catch {
      return false;
    }
  };
}

export const reportClientError = createClientErrorReporter({ enabled: import.meta.env?.PROD === true });

export function installGlobalErrorTelemetry({
  target = globalThis,
  reporter = reportClientError,
} = {}) {
  if (typeof target?.addEventListener !== 'function' || typeof target?.removeEventListener !== 'function') return () => {};
  const onError = (event) => reporter(event?.error, {
    captureKind: 'window-error',
    action: 'global',
  });
  const onUnhandledRejection = (event) => reporter(event?.reason, {
    captureKind: 'unhandled-rejection',
    action: 'promise',
  });
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onUnhandledRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onUnhandledRejection);
  };
}
