export class LiveError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'LiveError';
    this.code = code;
    this.status = status;
  }
}

export const fail = (code, message, status = 400) => { throw new LiveError(code, message, status); };

export function publicError(error) {
  if (error instanceof LiveError) return { status: error.status, error: { code: error.code, message: error.message } };
  const known = {
    room_exists: [409, 'This room locator is already in use.'],
    room_limit: [503, 'The game service is at capacity. Try again later.'],
    storage_unavailable: [503, 'The game service is temporarily unavailable.'],
    admission_conflict: [409, 'This admission identifier has already been used for a different request.'],
    admission_invalid: [401, 'A valid admission recovery credential is required.'],
    admission_unavailable: [410, 'This admission can no longer be recovered.'],
    admission_limit: [429, 'Admission recovery is temporarily limited.'],
    rate_limited: [429, 'Please wait before trying again.'],
  }[error?.code];
  return { status: known?.[0] ?? 503, error: { code: known ? error.code : 'service_unavailable', message: known?.[1] ?? 'The game service is temporarily unavailable.' } };
}
