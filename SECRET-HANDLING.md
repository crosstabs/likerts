# Secret and audit boundary

Likerts does not provide a support impersonation path or a support API for customer data. Customer management access resolves through an OIDC membership/grant or a tenant-bound service credential. The database runtime is `NOINHERIT NOBYPASSRLS`; audit reads require transaction-local workspace context, and the runtime cannot update or delete audit rows. Production infrastructure must not grant standing ECS Exec, database login or export-bucket access to support staff. Emergency access belongs in a separately approved, time-bounded infrastructure role with provider audit logs.

## Stored credentials

| Credential | Durable representation | Recoverable copy |
| --- | --- | --- |
| Service credential | SHA-256 digest, workspace, scopes, expiry and revocation | Returned once to the authorized creator |
| Collection capability | SHA-256 digest on the collection | Deterministically derived with the separately managed `LIKERTS_COLLECTION_CREDENTIAL_KEY` when an idempotent creation retry must return it |
| OAuth grant | Grant ID, subject, client, audience, scopes, expiry and revocation | Access/refresh tokens remain at the OIDC provider and authorized client |
| Webhook signing credential | Endpoint generation IDs and SHA-256 digests; attempt generation/timestamp | Protected reconstruction from the separate API/worker-only `LIKERTS_WEBHOOK_CREDENTIAL_KEY`; see [rotation limits](infrastructure/webhooks/README.md) |
| Monitor token | HMAC-derived in-process comparison tag | Deployment secret manager and metrics scraper |
| Stripe secrets | Not stored in Likerts tables | Deployment secret manager only |

`LIKERTS_COLLECTION_CREDENTIAL_KEY` is exactly 32 random bytes encoded as base64. Keep it outside PostgreSQL and supply it only to the API runtime. All running tasks must use the same value. The derived capability binds a domain separator, workspace and random collection UUID; PostgreSQL receives only its SHA-256 digest. Migration `0015_protected_collection_credentials.sql` removes pre-launch collection retry rows that could contain plaintext credentials and adds a database constraint prohibiting that field. Because those old synthetic retry records are deliberately removed, their management idempotency keys cannot be replayed after the migration.

Changing the derivation key invalidates idempotent credential recovery for active collections. The safe initial rotation procedure is to create successor collections under the new key, move customer applications, revoke every old collection and retain the prior key only until no old creation retry can be served. Automated key-ring rotation and KMS data-key caching require staging design evidence before production rotation is claimed.

## Audit and error data

Database triggers append management events in the same transaction as survey, collection, identity, export and workspace mutations. Events contain workspace, request ID, time, actor class/hash, action, resource type/ID and outcome. They contain no request body, answers, metadata, survey definition, access token, service credential or collection capability. RLS limits customer-visible rows; database grants and recovery tests prove historical rows are append-only to the runtime.

Database errors emitted by the service contain only a SQLSTATE category. Migration and object-store failures emit fixed operational messages. API errors use bounded codes and fixed descriptions; MCP and CLI errors preserve operation/status without copying an upstream response body. Metrics label only route templates, bounded methods and status classes. Export contents are returned only by the scoped download operation and are never included in service diagnostic logs. Authorized CLI JSON results and MCP tool responses can contain the requested data or newly issued credentials; callers must protect those outputs and their transcript retention.

## Verification

- `bash scripts/check-sec02-local.sh` is the aggregate local gate. It runs the focused secret/error tests, restricted-role PostgreSQL checks, a private MinIO round trip and credential-free AWS synthesis.
- `bash scripts/check-postgres.sh` proves tenant-scoped audit content, append-only grants, immediate credential revocation, deterministic collection retry after reconnect, and absence of the recoverable collection token from its management retry record.
- `bash scripts/check-s3-object-store.sh` proves fail-fast bucket access and private put/get/delete behavior. Both S3 and the local adapter bound reads to 64 MiB; a missing S3 key is distinct from an authorization, KMS or service failure. The local adapter creates private, unpredictable temporary files and atomically renames them.
- `bash scripts/check-aws-iac.sh` proves the runtime alone receives the precreated collection derivation key through a resource-scoped Secrets Manager policy. Its entire secret string must be the standard-base64 encoding of exactly 32 random bytes, and the value must remain stable across task replacement and idempotent retries.
- `bash scripts/check-recovery.sh` scans audit fixtures for credentials and customer payload sentinels and verifies audit history survives restore unchanged.
- `bash scripts/check-release-rehearsal.sh` keeps its capability-bearing state and backend log private, never prints the state, and rejects a backend log containing the management credential, collection capability or response-content sentinels. SEC-02A also statically rejects credential-bearing console statements in its driver.
- `npm --prefix tools/mcp test` includes a separate-process malformed-origin startup regression: URL parser errors must not print a configured credential-bearing input.
- `bash scripts/check-webhook-isolation.sh` verifies digest-only callback credential persistence, restricted worker privileges, signing-key mismatch failure and customer-content exclusion.
- `bash scripts/check-container.sh` proves the runtime cannot read unscoped audit rows or mutate them.
- `bash scripts/check.sh` exercises structured API/MCP/CLI errors; the capability contract rejects adapters that echo upstream bodies.

Real Clerk audit integration, hosted object-store policy inspection, break-glass controls, provider log inspection, denied/failed-operation audit coverage and key rotation remain hosted gates. No customer data should enter the service until those controls pass.

## Synthetic signing fixture

`backend/tests/fixtures/oidc_test_private.pem` is an intentionally public, test-only RSA key used by the `#[cfg(test)]` identity tests. It is not a Clerk or deployment credential and must never be trusted by a deployed issuer. The Docker build context excludes test fixtures. Browser captures, local IDE state and SDK tool-generated plugin records are ignored; do not place real credentials in retained examples or release artifacts.
