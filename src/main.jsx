import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import App from './App.jsx';
import {
  resolveVercelAnalyticsPolicy,
  sanitizeVercelAnalyticsEvent,
} from './lib/webAnalyticsPolicy.js';
import './styles.css';

const analyticsPolicy = resolveVercelAnalyticsPolicy({
  approvalToken: import.meta.env.VITE_LIKERTS_VERCEL_ANALYTICS,
  isProduction: import.meta.env.PROD,
});

const sanitizeAnalyticsEvent = (event) => sanitizeVercelAnalyticsEvent(event, {
  origin: window.location.origin,
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    {analyticsPolicy.enabled ? <Analytics beforeSend={sanitizeAnalyticsEvent} /> : null}
  </StrictMode>,
);
