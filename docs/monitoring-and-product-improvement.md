# Monitoring and product-improvement runbook

Likerts uses one privacy-safe structured event stream for runtime reliability, browser failures, and aggregate product behavior. Production browser telemetry is sent only to same-origin API routes and becomes ordinary Vercel Function logs. Vercel Web Analytics remains a separate, optional integration.

## Event flow

```text
Study, segment, and MCP APIs ───────────┐
React/global/caught browser errors ────┼─> structured-event-v2 JSON ─> Vercel Runtime Logs
Allowlisted aggregate product events ──┤                                ├─> alerts
Explicit user feedback submissions ────┘                                ├─> approved Log Drain
                                                                       └─> weekly product review
```

Every structured event contains:

- `schemaVersion`, timestamp, level, component, and event name;
- a validated correlation ID;
- bounded runtime environment, region, commit release, and deployment ID when Vercel supplies them;
- event-specific allowlisted attributes; and
- only error name, public code, and bounded HTTP status.

Raw prompts, research materials, evidence, respondent-like text, transcripts, request bodies, credentials, cookies, error messages, and raw stacks are not part of the automatic telemetry contract. The sole open-text exception is a message a visitor explicitly submits through the feedback panel after seeing its collection notice. Feedback is bounded to 800 characters and must not contain personal information or research material.

## Event catalog

| Event | Level | Purpose | Important dimensions |
| --- | --- | --- | --- |
| `request_finished` | info/warn/error | Exactly one outcome for study, segment, MCP, client-error, product-event, and feedback API calls | route, method, status, duration, outcome |
| `study_run_finished` | info | Successful study generation | mode, method, locale, completion status, stage counts, token usage, Gateway cost |
| `segment_followup_finished` | info | Successful model-segment follow-up | intent, method, locale, duration, usage, Gateway cost |
| `request_failed` | error | A handled study or segment failure | public error class/code plus safe product dimensions |
| `request_blocked` | warn | Runtime configuration or emergency switch prevented work | method and public reason code |
| `client_error` | error | React boundary, uncaught error, unhandled rejection, or caught study request | release, fingerprint, capture kind, safe first-party frame, public request diagnostics |
| `product_event` | info | Aggregate allowlisted product behavior | event name and coarse method/mode/locale/action properties |
| `feedback_received` | info | Explicit product feedback submitted from the side panel | bounded feedback text, category, page path, and interface locale |
| `evidence_gateway_search_failed` | warn | A bounded evidence lookup failed | provider and operation only |

The browser error reporter sends at most five distinct fingerprints per page and deduplicates repeats. It uses `credentials: omit`; no account, cookie, persistent visitor ID, prompt, URL, message, or raw stack is sent. The server applies a separate rate limit and uses a non-reversible client key only for that in-memory abuse-control window. The key is never logged.

Product events contain no user or session identifier. They support aggregate ratios, not individual-user funnels. Their current allowlist is:

- `study_started`, `study_completed`, and `study_failed`;
- `interface_locale_changed`;
- `human_validation_opened`;
- `human_validation_exported`;
- `feedback_opened`; and
- `feedback_submitted` with category only, never the submitted text.

`/api/feedback` is a separate explicit-content channel. It accepts one category, a 3–800 character message, the interface locale, and a path without query or fragment. It has no email/account field, omits browser credentials, enforces same-origin JSON, and permits at most six accepted submissions per anonymous client per hour in each active function process. The non-reversible abuse-control key is not logged.

When explicitly approved, the same sanitized product events may also be mirrored to Vercel Web Analytics. Same-origin structured product logging does not enable Web Analytics or inject its runtime script.

## Correlation workflow

API responses expose `X-Correlation-ID`, and API error bodies include the same value. The browser retains validated correlation IDs, displays them with failed-study references, and includes them in caught-request error events.

For a reported problem:

1. Search Runtime Logs for the correlation ID.
2. Open the matching `request_finished` event to establish route, status, release, region, and duration.
3. Inspect adjacent `request_failed`, `client_error`, or provider events from the same request.
4. Group matching browser failures by `fingerprint` and `runtime.release`.
5. Reproduce against the same release without requesting the user's research input.

## Dashboard queries

Create one reliability notebook and one product notebook in Vercel Observability. Keep preview and production separate.

Reliability dashboard:

- request outcome counts by route, status class, release, and region;
- admitted study success and failure counts, excluding expected validation rejections;
- Quick and Deep p50/p95 duration;
- provider rate-limit, budget, configuration, and unavailable errors;
- model fallback/partial-stage counts;
- browser error counts grouped by fingerprint and release;
- token usage and exact Gateway cost where reported; and
- `/api/client-events` or `/api/product-events` rejection/rate-limit counts, which indicate malformed clients or abuse.

Product dashboard:

- `study_completed / study_started`;
- `study_failed / study_started`, split by coarse category;
- completion by mode, method, and locale;
- human-validation open and export counts per completed study;
- feedback-panel opens, accepted submissions, and category mix;
- persistence class on completed studies; and
- locale changes, which indicate localization demand but not translation quality.

Do not infer unique users, retention, conversion, representativeness, or human attitudes from aggregate event counts.

## Alert policy for the public pilot

Low traffic makes anomaly-only alerts too slow. Use deterministic monitors as the primary pilot signal and Vercel anomaly alerts as secondary coverage.

| Severity | Trigger | Initial response |
| --- | --- | --- |
| Critical | Three consecutive public health failures | Check deployment status and recent releases; roll back if release-correlated |
| Critical | Authenticated readiness fails when paid execution is intentionally enabled | Disable execution and inspect admission-store/runtime events |
| Critical | Any production `MODEL_BUDGET_UNAVAILABLE`, invalid provider credentials, or durable-admission policy mismatch | Disable paid execution until the control plane is verified |
| High | At least five admitted runs and more than 10% unexpected failures in 15 minutes | Group by code, provider, region, and release |
| High | Three matching `client_error` fingerprints on one release | Reproduce the implicated action and compare with the prior release |
| Warning | Quick p95 exceeds 50 seconds or either mode regresses more than 50% from its seven-day baseline | Inspect stage and outbound-provider durations |
| Warning | Client/product event endpoints exceed their rate limit without a traffic increase | Check bot traffic and client loops |

Public `GET /api/health` is suitable for liveness. Authenticated `GET /api/health?ready=1` is suitable only after paid execution is intentionally configured; keep its bearer token in the monitor's secret store and never put it in a URL. The current bounded pilot intentionally reports blocked readiness until globally durable admission is provisioned, so that expected state must not page an operator.

## Vercel setup

1. In Runtime Logs, verify production emits `structured-event-v2` and that release/region fields are present.
2. Enable function error-anomaly and usage-anomaly alerts where the plan supports them.
3. Configure the deterministic health monitor independently of traffic-driven anomaly detection.
4. If retention beyond the Vercel plan's runtime-log window is required, configure an approved Log Drain for production Function logs.
5. Drain 100% of errors, blocked requests, client errors, and study/segment completion events. Sample high-volume ordinary success requests only after volume justifies it.
6. Before enabling a drain, record its data-processing approval, region, access controls, retention, deletion, signature verification, and incident ownership.

Never drain raw request bodies or add ad hoc `console.log` calls containing application objects.

## Release verification

Before deployment:

```bash
npm test
npm run build
```

In preview:

1. Complete one valid study with a non-sensitive test brief.
2. Confirm one `study_run_finished` and one `request_finished` share a correlation ID.
3. Submit one schema-invalid client/product/feedback event and confirm it is rejected without logging the supplied fields.
4. Trigger a controlled browser test failure and confirm `client_error` contains only the allowlisted contract.
5. Confirm ordinary user-facing errors show a shareable correlation reference.
6. Submit one non-sensitive feedback fixture and confirm `feedback_received` contains the category, path, locale, and bounded fixture text.

After promotion, compare the first hour with the previous release by error fingerprint, request failure rate, and p95 duration. Rollback starts by disabling paid execution when model work may be affected, then restoring the last known-good deployment.

## Improvement cadence

Daily operational review:

- investigate critical/high alerts;
- group new failures by release and fingerprint; and
- annotate deploy-correlated regressions.

Weekly product review:

1. Review the five largest error groups by affected requests, not log volume.
2. Review study start/completion/failure ratios by mode, method, and locale.
3. Review whether users reach evidence export and human-validation actions.
4. Create backlog items with baseline metric, release, fingerprint/code, and reproduction path.
5. After shipping a fix, compare the same metric and segment against the prior release.

Logging is successful only when it changes prioritization, verifies a fix, or shortens incident diagnosis.
