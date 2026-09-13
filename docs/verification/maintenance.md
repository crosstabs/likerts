# Maintenance implementation verification

Checked locally on 13 September 2026 for the runtime `0.1.1` candidate. This is implementation evidence; no hosted worker/schedule, physical cloud deletion, active alerts or Neon restore is claimed here.

`bash scripts/check-postgres.sh` passed four maintenance integration tests and the existing PostgreSQL lifecycle suite against disposable PostgreSQL 17. The tests use the limited runtime role, a separately authenticated cleanup role and synthetic records.

| Property | Actual assertion |
| --- | --- |
| Durable cleanup | An attempt key exists before upload; revocation and workspace erasure preserve it after the live key/authorization is removed. Failed deletion retries; success retains a tombstone. |
| Physical late write | A real local object is recreated after a successful deletion and removed by a later sweep. |
| Export safety | Active ready winner is protected; expired attempt is fenced against completion; stale attempt can be removed while its newer winner remains ready. |
| Worker concurrency | Only one simultaneous claimant gets a key; old/wrong leases cannot acknowledge; crashed lease recovers; 32 locked jobs rotate behind other due work without speculative deletion. |
| Retention bounds | 1,001 old responses and 1,001 eligible exports are processed in 1,000 + 1 batches, preserving fresh data and a second tenant. Fixtures retain ingestion accounting invariants. |
| Atomicity and isolation | Rollback preserves source records; committed erasures have deletion-journal/archive entries and cleanup tombstones; tenant scope is restored; FORCE RLS and runtime execution denial are asserted. |
| Credential mistakes | Eight excess-privilege cases are rejected, including column grants, role attributes/membership/ownership and unexpected privileged-function execution. |

`bash scripts/check-render-roles.sh` independently passed with a CREATEROLE, NOSUPERUSER, NOBYPASSRLS migration owner, matching the managed-database ownership boundary. It checks FORCE RLS/ownership on seven operational/tenant tables and SECURITY DEFINER ownership on five maintenance functions, applies provisioning twice, authenticates the cleanup role over TCP, denies raw-table access, executes tenant-specific retention and cleanup, verifies lease fencing and scope restoration, and leaves a fresh second-tenant export intact. No response rows were needed in that drill.

Both new executable test suites passed: explicit archiver maintenance acknowledgment/configuration bounds and cleanup identity/verified-TLS enforcement. The archiver's disposable database smoke passed role/source checks and answer/usage-read denial. The standard `bash scripts/check.sh` suite passed backend/API/MCP/CLI/Web integration and contract checks. See the CI record appended after protected merge for the final immutable source revision; local test results alone do not prove deployment.

The [retention runbook](../operations/RETENTION-WORKER.md) records the hourly retry of lock-skipped underfull batches, indefinite ID-only tombstones, daily repeat-delete cost, pre-migration orphan reconciliation and provider credential/configuration boundaries. The [archiver runbook](../../infrastructure/erasure-archive/README.md) records independent-storage and quarantined-recovery prerequisites. These limits remain part of hosted launch acceptance.
