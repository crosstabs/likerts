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

export function createPilotAnalyticsTracker({
  enabled = analyticsPolicy.enabled,
  emit = track,
} = {}) {
  return (name, properties = {}) => {
    if (!enabled || typeof emit !== 'function') return false;
    const event = sanitizeLikertsAnalyticsEvent(name, properties);
    if (!event) return false;
    try {
      emit(event.name, event.properties);
      return true;
    } catch {
      return false;
    }
  };
}

export const trackPilotEvent = createPilotAnalyticsTracker();
