/** Validate the caller's fixture target before pg can interpret query overrides.
 * Only numeric loopback and the dedicated synthetic database are supported.
 * Fixture code may append its own schema options after this validation.
 */
export function localTestDatabaseURL(input) {
  let target;
  try { target = new URL(input); } catch { /* Use a redacted error below. */ }
  if (!target || !['postgres:', 'postgresql:'].includes(target.protocol)
    || !['127.0.0.1', '[::1]'].includes(target.hostname)
    || target.pathname !== '/likerts_live_test' || target.search || target.hash) {
    throw new Error('Use the explicit numeric-loopback likerts_live_test fixture without URL query options.');
  }
  return target;
}
