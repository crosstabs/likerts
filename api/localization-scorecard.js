import { createLocalizationReleaseEvidenceProvider } from '../server/localization-release-evidence-provider.js';
import { buildLocalizationScorecardFromReleaseEvidence } from '../server/localization-scorecard-service.js';
import { resolveCorrelationId, setCorrelationHeader } from '../server/observability.js';

export const config = { maxDuration: 30 };

export function createLocalizationScorecardHandler({
  releaseEvidenceProvider = null,
  nativeReviewEvidenceProvider = null,
  scorecardNow = () => new Date(),
} = {}) {
  if (releaseEvidenceProvider !== null && nativeReviewEvidenceProvider !== null) {
    throw new TypeError('Choose one localization release-evidence provider.');
  }
  if (releaseEvidenceProvider !== null && typeof releaseEvidenceProvider !== 'function') {
    throw new TypeError('Localization release-evidence provider must be a function.');
  }
  if (nativeReviewEvidenceProvider !== null && typeof nativeReviewEvidenceProvider !== 'function') {
    throw new TypeError('Native-review evidence provider must be a function.');
  }
  const evidenceProvider = releaseEvidenceProvider ?? nativeReviewEvidenceProvider;
  const runtimeReleaseEvidence = releaseEvidenceProvider !== null;
  return async function localizationScorecardHandler(request, response) {
    const correlationId = resolveCorrelationId(request.headers);
    setCorrelationHeader(response, correlationId);
    const method = String(request.method || '').toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) {
      response.statusCode = 405;
      response.setHeader('Allow', 'GET, HEAD');
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      return response.end(JSON.stringify({ error: 'Use GET or HEAD for the localization scorecard.', correlationId }));
    }
    let scorecard;
    try {
      const releaseEvidenceContext = evidenceProvider === null
        ? null
        : await evidenceProvider();
      scorecard = buildLocalizationScorecardFromReleaseEvidence(releaseEvidenceContext, {
        now: typeof scorecardNow === 'function' ? scorecardNow() : scorecardNow,
      });
    } catch {
      response.statusCode = 503;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      if (method === 'HEAD') return response.end();
      return response.end(JSON.stringify({
        error: runtimeReleaseEvidence
          ? 'Localization release evidence is temporarily unavailable.'
          : 'Native-review release evidence is temporarily unavailable.',
        code: runtimeReleaseEvidence
          ? 'LOCALIZATION_RELEASE_EVIDENCE_UNAVAILABLE'
          : 'LOCALIZATION_NATIVE_REVIEW_EVIDENCE_UNAVAILABLE',
        correlationId,
      }));
    }
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'private, no-store');
    if (method === 'HEAD') return response.end();
    return response.end(JSON.stringify(scorecard));
  };
}

/** Creates the production scorecard route from server-only runtime configuration. */
export function createRuntimeLocalizationScorecardHandler(options = {}) {
  return createLocalizationScorecardHandler({
    releaseEvidenceProvider: createLocalizationReleaseEvidenceProvider(options),
    scorecardNow: options.now,
  });
}

export default createRuntimeLocalizationScorecardHandler();
