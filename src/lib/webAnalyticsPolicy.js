export const VERCEL_ANALYTICS_APPROVAL_TOKEN = 'release-approved';

const ANALYTICS_EVENT_SCHEMAS = Object.freeze({
  study_started: Object.freeze({
    mode: ['quick', 'deep'],
    method: 'method',
    locale: 'locale',
    trigger: ['composer', 'replay'],
    evidence: ['none', 'provided'],
  }),
  study_completed: Object.freeze({
    mode: ['quick', 'deep'],
    method: 'method',
    locale: 'locale',
    trigger: ['composer', 'replay'],
    evidence: ['none', 'provided'],
    persistence: ['durable', 'local', 'session'],
  }),
  study_failed: Object.freeze({
    mode: ['quick', 'deep'],
    method: 'method',
    locale: 'locale',
    trigger: ['composer', 'replay'],
    category: ['admission', 'disabled', 'localization', 'network', 'model', 'other'],
  }),
  interface_locale_changed: Object.freeze({ locale: 'locale' }),
  human_validation_opened: Object.freeze({
    method: 'method',
    locale: 'locale',
    handoffAvailable: 'boolean',
  }),
  human_validation_exported: Object.freeze({
    method: 'method',
    locale: 'locale',
    format: ['csv', 'xlsx', 'txt', 'json'],
  }),
  feedback_opened: Object.freeze({ locale: 'locale' }),
  feedback_submitted: Object.freeze({
    category: ['BUG', 'CONFUSING', 'IDEA', 'PRAISE', 'OTHER'],
    locale: 'locale',
  }),
});

function sanitizedEventValue(value, rule) {
  if (Array.isArray(rule)) return rule.includes(value) ? value : null;
  if (rule === 'boolean') return typeof value === 'boolean' ? value : null;
  if (rule === 'method') return /^[A-Z][A-Z0-9_]{0,63}$/.test(String(value || '')) ? String(value) : null;
  if (rule === 'locale') return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(String(value || '')) ? String(value) : null;
  return null;
}

export function resolveVercelAnalyticsPolicy({ approvalToken, isProduction } = {}) {
  if (approvalToken !== VERCEL_ANALYTICS_APPROVAL_TOKEN) {
    return Object.freeze({
      enabled: false,
      status: approvalToken ? 'INVALID_APPROVAL_TOKEN' : 'NOT_APPROVED',
    });
  }

  if (isProduction !== true) {
    return Object.freeze({ enabled: false, status: 'NON_PRODUCTION' });
  }

  return Object.freeze({ enabled: true, status: 'APPROVED' });
}

export function sanitizeVercelAnalyticsEvent(event, { origin } = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)
    || typeof event.url !== 'string' || !event.url
    || typeof origin !== 'string' || !origin) return null;

  let trustedOrigin;
  let eventUrl;
  try {
    trustedOrigin = new URL(origin).origin;
    eventUrl = new URL(event.url, trustedOrigin);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(eventUrl.protocol) || eventUrl.origin !== trustedOrigin) return null;

  eventUrl.username = '';
  eventUrl.password = '';
  eventUrl.search = '';
  eventUrl.hash = '';
  return { ...event, url: eventUrl.href };
}

export function sanitizeLikertsAnalyticsEvent(name, properties = {}) {
  const schema = ANALYTICS_EVENT_SCHEMAS[name];
  if (!schema || !properties || typeof properties !== 'object' || Array.isArray(properties)) return null;

  const sanitized = {};
  for (const [key, rule] of Object.entries(schema)) {
    const value = sanitizedEventValue(properties[key], rule);
    if (value === null) return null;
    sanitized[key] = value;
  }
  return Object.freeze({ name, properties: Object.freeze(sanitized) });
}

export function sanitizeLikertsAnalyticsEnvelope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'name,properties') return null;
  const event = sanitizeLikertsAnalyticsEvent(input.name, input.properties);
  if (!event || Object.keys(input.properties).length !== Object.keys(event.properties).length) return null;
  for (const [key, value] of Object.entries(event.properties)) {
    if (input.properties[key] !== value) return null;
  }
  return event;
}

export function coarseStudyFailureCategory(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (/ADMISSION|RATE_LIMIT|BUDGET|CONCURRENCY/.test(normalized)) return 'admission';
  if (/DISABLED|SHUTDOWN/.test(normalized)) return 'disabled';
  if (/LOCALIZATION|LOCALE|LANGUAGE|SCRIPT/.test(normalized)) return 'localization';
  if (/NETWORK|FETCH|TIMEOUT|ABORT/.test(normalized)) return 'network';
  if (/MODEL|GATEWAY|PROVIDER/.test(normalized)) return 'model';
  return 'other';
}
