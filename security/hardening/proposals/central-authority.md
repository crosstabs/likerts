# Security Hardening Proposal: Centralize authority and secret lifecycle

## Decision

Adopt Option 2, a typed authorization context with database-scoped audit and protected recoverable capabilities.

## Executive Recommendation

Option 1 strengthens local handler guards. Option 2 carries verified actor, workspace, role and scopes through one owned boundary, then uses it for RLS and audit. I recommend Option 2 because new API/MCP/CLI operations will otherwise repeat controls and drift.

## Evidence

| Evidence | Finding or document | What it establishes |
| --- | --- | --- |
| E1 | PostgreSQL repository and management retry migration | Verbatim errors may contain database details; retry JSON may contain a collection credential. |
| E2 | HTTP authorization helper | Returning only workspace discards the verified actor before sensitive mutation. |
| E3 | Identity RLS migration | Transaction-local workspace and capability policies already contain cross-tenant access. |
| E4 | MCP client | Tokens remain outside tool arguments and results, which we must preserve. |

## Current Design And Failure Mode

Observed E1 and E2 show that authorization, logging and secret recovery have separate owners. We can infer that every new handler can omit an audit event or expose a value through a generic error. RLS limits the blast radius, but it cannot decide what enters logs or an idempotency response.

## Desired Invariants

- Every management mutation receives one verified actor/workspace/scope/role context.
- Audit rows contain identifiers and outcomes, never tokens, claims, answers or metadata, and cannot be updated or deleted by runtime.
- Recoverable credentials are unreadable without a separately managed application key.
- Public collection abuse is rejected before expensive validation and never billed.

## Constraints And Non-Goals

Respondents remain anonymous. Origins provide browser policy, not authentication. Support impersonation and plaintext credential recovery are excluded.

## Before Architecture

See [before](../diagrams/central-authority-before.mmd). The handler owns too many independent decisions.

## Options

### Option 1: Strengthen local guards

We can add audit calls, redact database errors and rate-limit each endpoint in place. This is fast and has negligible resource cost, but future handlers can still omit a control and the credential-bearing retry record remains.

See [local guards](../diagrams/central-authority-local-guards-after.mmd).

| Change | Before | After | Security consequence | Cost |
| --- | --- | --- | --- | --- |
| Error logging | Full database display | SQLSTATE category | Removes common log disclosure | Minimal |
| Audit | Absent | Per-handler call | Adds evidence with omission risk | Low |

### Option 2: Typed central context and protected secrets

The authentication boundary returns a typed principal and opens mutation transactions with workspace and actor context. Repository operations append audit in the same transaction. Collection credentials are derived or authenticated-encrypted using a KMS-backed key, allowing retry without plaintext database storage. A durable collection limiter plus edge IP limiter rejects abuse early.

See [central context](../diagrams/central-authority-central-context-after.mmd).

| Change | Before | After | Security consequence | Cost |
| --- | --- | --- | --- | --- |
| Authorization result | Workspace string | Actor/workspace/role/scopes | Makes audit and least privilege harder to omit | Refactor |
| Retry secret | Plain JSON | Encrypted/derived | Database readers cannot recover capability | Key operations |
| Abuse gate | Collection caps only | Edge IP + durable collection limits | Bounds unpaid work | State and tuning |

## Comparison

| Dimension | Option 1 | Option 2 |
| --- | --- | --- |
| Security | Improves known paths; drift remains | Stronger invariant and smaller disclosure surface |
| Performance | Neutral, source-derived | One limiter/key operation; benchmark required |
| Memory | Neutral | Small context and limiter state |
| Reliability | Per-handler audit can be lost | Transactional audit; KMS outage needs cached-key policy |
| Operability | Low burden | Key rotation, audit retention and limiter alerts |
| Migration | Small | Incremental auth/repository and data migration |

## Recommendation

I recommend Option 2 under the enterprise-isolation and many-interface constraints. Option 1 becomes preferable only for a short-lived prototype with no recoverable credentials.

## Evidence Coverage And Residual Risk

| Evidence | Effect | Residual risk |
| --- | --- | --- |
| E1 — log and retry disclosure | Addresses | Infrastructure administrators still require controlled break-glass access. |
| E2 — lost actor context | Addresses | Background system jobs need explicit system principals. |
| E3 — RLS boundary | Preserves | Migration owners remain privileged. |
| E4 — MCP token handling | Preserves | Host process environment can read its token. |

## Migration And Rollout

Introduce typed context, dual-write audit, protected new credentials, rotate old credentials, then remove plaintext response fields. Roll back application phases while retaining append-only rows; never roll back to exposing newly protected credentials.

## Validation Plan

Test cross-tenant denial, revocation on the next request, audit completeness/redaction, database dump inspection, key rotation, rate-limit concurrency and unbilled rejection. Benchmark p95 and failure behavior locally and on staging.

## Implementation Work Packages

Typed principal; atomic audit; protected idempotent secret recovery; collection and edge limiting; log/error redaction; staging validation.

## Open Questions

AWS KMS cache lifetime, exact WAF thresholds and merchant audit retention require staging and policy decisions.
