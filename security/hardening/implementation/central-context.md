# Implementation Plan: Typed central context and protected secrets

## Selected Design And Constraints
Carry actor/workspace/role/scopes through the management path, keep forced RLS, append audit atomically, protect recoverable collection credentials, and reject abuse before billing.

## Source Revision And Drift Check
No Git revision exists. Refresh current files before every shared-file patch.

## Affected Components
`backend/src/main.rs`, `backend/src/postgres.rs`, identity/audit migrations, collection submission, deployment secrets and verification scripts.

## Ordered Work Packages
Redact logs; add append-only audit; type authorization context; add protected secret storage and rotation; add collection limiter; add edge policy; validate.

## Compatibility And Migration
Keep existing token hashes valid while rotating credentials. API shapes remain versioned through OpenAPI and the capability registry.

## Tactical Protections During Migration
Keep RLS forced, redirects disabled, tokens outside MCP arguments, static auth development-only and database logs category-only.

## Tests And Security Validation
Inspect logs/dumps for sentinels; race limits; revoke membership/grants/credentials mid-session; verify runtime cannot alter audit; run API/MCP/CLI parity.

## Performance And Resource Benchmarks
Compare p50/p95, database writes and WAL at 100 RPS and burst load before/after limiter and audit. Reject any design that threatens the documented internal latency target without an approved tradeoff.

## Rollout And Rollback
Deploy schema first, dual-write, validate, rotate credentials, remove plaintext. Application rollback may stop new writes but must retain audit and protected data.

## Acceptance Criteria
SEC-01/02 acceptance checks pass, no sentinel secrets/content appear in logs or database retry JSON, and revocation/rate-limit denials are immediate and unbilled.

## Open Decisions
KMS provider configuration and WAF thresholds await AWS staging.
