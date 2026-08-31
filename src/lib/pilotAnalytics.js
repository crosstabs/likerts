import { track } from '@vercel/analytics';

import {
  resolveVercelAnalyticsPolicy,
  sanitizeLikertsAnalyticsEvent,
} from './webAnalyticsPolicy.js';

const viteEnvironment = import.meta.env || {};
const analyticsPolicy = resolveVercelAnalyticsPolicy({
  approvalToken: viteEnvironment.VITE_LIKERTS_VERCEL_ANALYTICS,
  isProduction: viteEnvironment.PROD,
});

function emitSameOrigin(name, properties) {
  const request = fetch('/api/product-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    keepalive: true,
    body: JSON.stringify({ name, properties }),
  });
  Promise.resolve(request).catch(() => {});
}

export function createPilotAnalyticsTracker({
  enabled = viteEnvironment.PROD === true,
  emit = emitSameOrigin,
  secondaryEmit = analyticsPolicy.enabled ? track : null,
} = {}) {
  return (name, properties = {}) => {
    if (!enabled || typeof emit !== 'function') return false;
    const event = sanitizeLikertsAnalyticsEvent(name, properties);
    if (!event) return false;
    try {
      emit(event.name, event.properties);
      if (typeof secondaryEmit === 'function') secondaryEmit(event.name, event.properties);
      return true;
    } catch {
      return false;
    }
  };
}

export const trackPilotEvent = createPilotAnalyticsTracker();
