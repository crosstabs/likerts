const PUBLIC_ERROR_CODE = /^[A-Z][A-Z0-9_:-]{1,79}$/;
const PUBLIC_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function normalizedCode(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  return PUBLIC_ERROR_CODE.test(candidate) ? candidate : null;
}

export function responseErrorCode(payload, status) {
  const candidates = [
    payload?.issue?.code,
    payload?.code,
    payload?.errorCode,
    payload?.error,
  ];
  for (const candidate of candidates) {
    const code = normalizedCode(candidate);
    if (code) return code;
  }
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? `HTTP_${status}`
    : 'REQUEST_FAILED';
}

export function createPublicRequestError(payload, status) {
  const publicCode = responseErrorCode(payload, status);
  const correlationId = typeof payload?.correlationId === 'string'
    && PUBLIC_CORRELATION_ID.test(payload.correlationId)
    ? payload.correlationId
    : null;
  return Object.assign(new Error(publicCode), {
    name: 'PublicRequestError',
    publicCode,
    correlationId,
    statusCode: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
  });
}

export function thrownErrorCode(error, fallback = 'REQUEST_FAILED') {
  const explicit = normalizedCode(error?.publicCode) || normalizedCode(error?.code);
  if (explicit) return explicit;
  if (error instanceof TypeError) return 'NETWORK_ERROR';
  return normalizedCode(fallback) || 'REQUEST_FAILED';
}
