# Independent erasure archive worker

`likerts-erasure-archive` makes the existing ID-only archive library runnable. It uses only the dedicated `likerts_erasure_archiver` database role and its own private Blob credential. It does not initialize the API, identity provider, webhook worker, raw-answer client or normal export storage.

This is an implementation and local verification artifact. It has **not** been deployed to Render or connected to a live independent archive here. It does not establish a provider backup window, a managed recovery guarantee, a completed Neon restore drill or an alerting operation. See the separate H03 gate in [the launch plan](../../PUBLIC-LAUNCH.md).

## Provisioning prerequisites

1. Run the [normal schema migrations](../../backend/src/bin/likerts-migrate.rs) using the migration owner before starting the archiver. Migration `0024_erasure_archive.sql` installs the ID-only outbox, source identity, checkpoints and explicit deletion fence. The API inserts an outbox event in the same transaction as a deletion; it does not need the archive credential.
2. Supply a nonempty strong `LIKERTS_BOOTSTRAP_ARCHIVER_PASSWORD` through your secret manager. With the migration-owner connection provided through protected `PG*` environment/service configuration, run:

   ```sh
   psql -X --set=ON_ERROR_STOP=1 --file=infrastructure/erasure-archive/bootstrap.sql
   psql -X --set=ON_ERROR_STOP=1 --file=infrastructure/erasure-archive/provision-archiver.sql
   psql -X --tuples-only --no-align --command='select source_id from likerts.erasure_archive_control;'
   ```

   Record the returned source UUID in the independently managed worker configuration. Do not automatically replace it when a restored or different database is attached. Bootstrap creates the role only if absent; it does not rotate an existing password. Password rotation is a separate controlled database operation.
3. Provision a **separate private Blob store/credential** for archive material. Do not give its token to the API, export worker or ordinary application deployment. The current adapter uses a Vercel Blob read/write token, whose provider privileges are broader than this program's limited methods. Prefix validation and no-overwrite requests are application controls, not provider-enforced WORM/object-lock guarantees. Separately establish retention, deletion protection, ownership and independent administrative recovery access; a shared failure domain cannot be wished away by using another prefix.
4. Choose a stable archive namespace and source ID. Export checkpoint IDs/hashes and fence identity to an independently protected operational record. A database-only record of the latest checkpoint is insufficient after database rollback. Decide who responds to missing/stale checkpoints and owns any recovery window before using this for hosted-data commitments.
5. Build the updated runtime image, which now packages the binary, and configure its supervisor/schedule, restart backoff and alerts. CI exercises the executable locally. No hosted archive schedule is activated by packaging it; the historical community runtime image remains unchanged.

The SQL provisioning grants only the archive security-definer functions, schema usage and database connection. It revokes table, sequence and unrelated function grants. At startup the library verifies the exact role, no superuser/BYPASSRLS/inheritance/role memberships or ownership, no raw-response/usage SELECT access, and the expected source UUID. It rejects the API, migration-owner or webhook credential.

## Configuration

Supply secrets via the worker's protected environment, never CLI arguments or repository files. SQL connection and provider error bodies are not emitted by the binary.

| Variable | Meaning |
| --- | --- |
| `LIKERTS_ERASURE_DATABASE_URL` | PostgreSQL URL for **likerts_erasure_archiver** only; needed except for archive-only `verify`. |
| `LIKERTS_ERASURE_SOURCE_ID` | Expected canonical lowercase source UUID, obtained at provisioning. Required for all operations. |
| `LIKERTS_ERASURE_BLOB_TOKEN` | Dedicated private archive Blob read/write token; required for storage operations and `check-config`. |
| `LIKERTS_ERASURE_NAMESPACE` | Stable 1–64 character namespace using letters, digits, `_` or `-`. Objects live under `erasure/v1/{namespace}/{sourceId}/`. |
| `LIKERTS_ERASURE_BATCH_SIZE` | `1..1000`, default `100`; maximum newly archived events per drain/worker iteration. |
| `LIKERTS_ERASURE_POLL_SECONDS` | `1..3600`, default `30`; pause between successful worker iterations. |
| `LIKERTS_ERASURE_ALLOW_LOCAL_INSECURE` | Default off. Set exactly `1` only for a loopback PostgreSQL test without TLS. Non-loopback databases cannot use this override. |
| `LIKERTS_ERASURE_FENCE_ID` | Required by `verify` and `release`; exact fence from a separately authorized source maintenance operation. |
| `LIKERTS_ERASURE_CHECKPOINT_ID`, `LIKERTS_ERASURE_CHECKPOINT_HASH` | Required by `verify`; exact independently recorded checkpoint UUID and SHA-256. |

Remote database connections force certificate/hostname verification (`verify-full`) even if the URL requests weaker TLS. The URL username must match the archiver role. Only `sslmode` and `application_name` query keys are accepted, preventing URL query options from changing the checked host/user. Configure a reviewed certificate trust arrangement if your database uses private roots; do not disable verification to work around it. One database connection, a 10-second acquisition timeout, 15-second statement timeout and 5-second lock timeout bound database operations.

The existing Blob adapter disables redirects/proxies/automatic HTTP retries, bounds objects, and uses authenticated uncached readback to verify bytes before completing the archive record. The configured private token's format being accepted does **not** prove storage availability or permissions.

## Build and operate

From the repository root in Bash:

```sh
source scripts/dev-env.sh
cargo build --locked --release --manifest-path backend/Cargo.toml --bin likerts-erasure-archive
backend/target/release/likerts-erasure-archive --help
```

If Cargo uses a custom target directory, use the emitted binary there. With the environment populated:

```sh
backend/target/release/likerts-erasure-archive status
backend/target/release/likerts-erasure-archive check-config
backend/target/release/likerts-erasure-archive drain
```

- `status` is a read-only database/source/role check. It reports source/fence/checkpoint identifiers, covered and pending counts, and oldest pending age. It does not need Blob credentials or test storage.
- `check-config` checks the role/source and parses archive configuration. Its JSON explicitly reports `archiveConnectivityVerified: false`; it never writes a test object or claims live durability.
- `drain` archives up to the configured batch size, then tries one checkpoint and emits sanitized JSON. A successful bounded batch does not prove the whole backlog is empty. `pendingEvents` counts unarchived events; already archived events can still await checkpoint coverage. Compare checkpoint movement/covered count as well as backlog.
- `checkpoint` tries to persist/confirm the next checkpoint without claiming another event. It can return null when no new checkpoint is needed.
- `run` repeats bounded drain/checkpoint iterations until SIGINT/SIGTERM. Any database/storage/validation failure exits nonzero; configure supervisor backoff and alerting. It does not swallow failures and pretend the worker is healthy.

```sh
backend/target/release/likerts-erasure-archive run
```

Do not run aggressive concurrent schedules to hide backlog. The database leases are authoritative. Failed events use the existing retry schedule (up to five minutes); cancelled/crashed in-flight event leases expire after 60 seconds. Existing identical archive objects are read back and reused; different bytes at the same key fail closed. Cancelling during a checkpoint leaves its pending immutable body available for a later retry.

An immutable write/readback operation retries once after 100 ms only for the `Storage` error category. That category also includes provider authorization and redirect responses; it does not distinguish temporary failures from permanent failures. Each attempt writes the same key and bytes with overwrite disabled, then requires an authenticated, cache-bypassing read of exactly those bytes. Mismatched content, configuration validation failures and size limits are not retried. At most four HTTP requests can occur, each with the existing 10-second timeout: the HTTP allowance plus delay is 40.1 seconds. Database acquisition/network overhead and completion add time, so this is not an end-to-end 60-second guarantee. The database still rejects an expired event lease; no successful HTTP retry can acknowledge stale work. Exhausted retries remain a failure, preserving the durable event retry and pending-checkpoint paths.

Treat output as private operational data: it includes source/checkpoint IDs and counts. `verify` additionally emits ID-only deletion events, which are still sensitive linkage data even without answers. Error output contains only a fixed error category. Monitor exit status, oldest pending age, pending/covered changes and checkpoint freshness against a documented owner-approved threshold. An idle worker with no new deletions can legitimately have an old checkpoint; do not invent an alert based only on age.

## Manual fenced recovery operations

These are **not routine worker actions**. Coordinate source maintenance, quarantine the restore and restrict API/callback/export access using the [recovery process](../recovery/replay.sql). A fence rejects new deletion commits; it does not stop all writes, reads, callbacks or exports. Stopping the archiver is not a fence.

To fence the source, an authorized operator must provide the literal acknowledgement:

```sh
backend/target/release/likerts-erasure-archive fence --ack I_ACCEPT_DELETIONS_WILL_BE_REJECTED
```

Record the returned fence ID independently. Drain/checkpoint until all source erasures are covered by a checkpoint carrying that fence. The verifier, not `pendingEvents == 0` alone, is the coverage check. Keep the source fenced for the operation being proved.

With the independently recorded source/fence/checkpoint/hash and Blob configuration, `verify` needs **no database credential**:

```sh
umask 077
backend/target/release/likerts-erasure-archive verify > verified-erasure-archive.json
```

The library verifies the complete hash-linked checkpoint/event chain before emitting replay input and rejects missing/corrupt objects or a released fence. Protect this file and use an approved quarantine replay workflow; this executable does not itself restore a database, replay SQL or reopen traffic. Its result explicitly covers `fenced_source_set_only`, not future deletions, credential revocation coverage or all application state. A racing source release invalidates that guarantee; operational coordination remains necessary.

Only after a separately reviewed recovery decision, release that exact fence using:

```sh
backend/target/release/likerts-erasure-archive release --ack I_ACCEPT_OLD_CHECKPOINT_NO_LONGER_COVERS_FUTURE_DELETIONS
```

Release durably writes an archive invalidation marker **before** allowing new source deletions. It invalidates old fenced-checkpoint coverage for future use. The binary never calls fence/release automatically, and wrong/missing acknowledgements fail before connecting. Never release simply to make a verification error disappear.

## Local verification and remaining evidence

```sh
source scripts/dev-env.sh
cargo test --locked --manifest-path backend/Cargo.toml --bin likerts-erasure-archive
cargo test --locked --manifest-path backend/Cargo.toml --lib erasure_archive::tests
cargo build --locked --manifest-path backend/Cargo.toml --bin likerts-erasure-archive --bin likerts-migrate
node infrastructure/erasure-archive/check-local.mjs
```

The Node smoke uses a disposable `postgres:16-alpine` Docker container bound to loopback, current migrations and existing archiver-role provisioning. It proves role/source status, denied raw answer/usage reads, rejection of owner credentials and source mismatch, and rejection of unattested maintenance. Its fake Blob token is used only by non-network `check-config`. Container/volume and generated credentials are removed. The script does not contact Blob or any cloud provider.

Local checks passed on 2026-09-13. Unit checks cover argument/attestation handling, TLS/role URL constraints and batch bounds; existing library tests cover fenced-chain verification and rejected released/missing/duplicate archives. The PostgreSQL smoke passed with the restricted role and reported no provider connectivity claim.

Still required for H03: approved independent archive store/credentials/retention protection, deployed executable/schedule and named alert owner; live drain/checkpoint readback plus outage/retry observations; verified provider backup/PITR window; quarantined restore with later erasure and access-revocation replay; isolation checks, safe traffic reopening and measured recovery results. No live independent archive or recovery completion is claimed by these local tests.
