# Live room storage

`openStore` uses only `LIKERTS_LIVE_DATABASE_URL`, never the survey database variable. SQLite requires an explicit on-disk path and is development-only. Production PostgreSQL connections verify the server certificate; explicit insecure SSL modes are rejected.

Room state, admission receipts and shared rate budgets are durable. Notifications carry only code and revision; recipients must reload, reauthorize and project state. Notifications may duplicate or be missed during reconnect, so transport refresh is still required. Cleanup removes at most the supplied limit per table; room/admission/budget quotas fail closed when retained metadata occupies capacity.

## Immutable room identity and admission migration

A six-character room code is a reusable locator. Every newly created room also has a cryptographically random UUID `instanceId`, fixed for that room's lifetime and through rematches. Every new admission binds its member ID to that UUID in `likerts_live_admissions.room_instance`. Recovery checks the current room's instance before invoking the credential-rotation callback. Room code, creation time and the host label are insufficient to establish this binding.

The adapter adds a nullable column to existing dedicated stores without deleting rows:

```sql
ALTER TABLE likerts_live_admissions
  ADD COLUMN IF NOT EXISTS room_instance uuid;
```

PostgreSQL startup serializes initialization under the adapter advisory lock. SQLite checks `PRAGMA table_info` and adds the nullable text column under `BEGIN IMMEDIATE`. Existing admission records remain null and **cannot recover**. Do not backfill the column from a room currently using the same code, from timestamps, or from `member_id = 'host'`: that could grant an old admission access to a replacement room. A fresh room/admission is required for legacy recovery records. Existing tombstones retain their normal bounded expiry.

This code and its tests do not provision a production database or grant schema permissions. Production rollout still requires an approved migration/execution plan for this dedicated schema, a least-privilege runtime configuration and verified operational expiry/backup behavior. The current adapter performs its table/index initialization and additive migration at startup, so the executing role must already have the necessary approved schema privileges. Do not point it at the survey database or expand another service's privileges to make it start.

## Bounded internal failure diagnostics

PostgreSQL transaction failures retain an internal allowlist of phase/category, recognized SQLSTATE, elapsed milliseconds, numeric pool counts, rollback result and transaction outcome. They do not retain raw messages, causes, SQL, parameters, URLs or game/user data, and are not automatically logged. Public HTTP failures remain the same generic 503 response.

An unconfirmed rollback discards that leased client rather than returning an uncertain transaction to the pool. A COMMIT timeout is marked as an unknown outcome; a later successful rollback cannot establish whether an earlier commit completed. There is no automatic transaction replay. Retry an API command with its original request ID to resolve an ambiguous acknowledgement without duplicate scoring or transitions.

Generic SQLSTATE 55P03 is classified as lock unavailable and 57014 as query canceled. Only recognized fixed timeout messages refine those categories to lock/statement timeout; unknown/localized text is never retained. See `stress-diagnosis.md` for controlled failure/recovery evidence, original-failure limitations and exact test/source fingerprints. No timeout or pool-capacity setting was relaxed.
