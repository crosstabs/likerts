# Security Hardening Review: Likerts management and collection boundaries

## Evidence Basis

I inspected the current authorization, persistence and MCP paths. Forced RLS and hashed capabilities are sound foundations, while actor context, audit ownership, public-collection throttling and idempotent secret recovery remain split across callers.

## Constraints

The design must preserve one-cent acceptance, tenant isolation, stateless horizontal API scaling and API/MCP/CLI parity. Performance effects have not yet been measured on AWS.

## Opportunity Portfolio

| Opportunity | Evidence | Options | Recommendation | Proposal |
| --- | --- | --- | --- | --- |
| Centralize authority and secret lifecycle | Verbatim database errors and credential-bearing retry records (E1), lost actor context (E2), existing RLS boundary (E3) | Local guards; typed authorization context with append-only audit and derived/encrypted secrets | Typed central context | [Proposal](proposals/central-authority.md) |

## Recommendation Summary

I recommend carrying one typed authorization result from token verification through each mutation, using that context for database scope and append-only audit. We should derive or encrypt recoverable collection credentials with a separately managed key, and enforce collection abuse controls before expensive validation. This keeps RLS as the final tenant boundary while removing security decisions from individual handlers.

## Next Decisions

Implementation is authorized by the launch task. AWS KMS key handling, WAF limits and operational support access still require staging evidence.
