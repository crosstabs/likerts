# Storage version 3

Storage version3 is internal. The public protocol, independently authorized projections, command identifiers and privacy rules remain protocol1.

## Transaction interface

Both adapters retain create/admit/recover/transact and add:

```js
store.transactCommand(code, {
  requestId, fingerprint, maxReceipts,
  authorize(room) { return { actorId, scope: 'active' }; },
}, (room, receiptContext) => ({ room, changed, value, recordReceipt: true }));
```

Authorization runs synchronously after the authoritative room lock, before journal lookup. It may return a terminal transaction result for an expired/missing room. Revoked leave credentials have a separate restricted scope; they cannot authorize a state projection or another command. Callbacks returning Promises are rejected safely. The supplied receipt context binds immutable room instance, stable actor, normalized request UUID and canonical fingerprint. Version3 reducer calls without matching context fail closed.

The journal primary key is `(instance_id, actor_id, request_id)`, independent of reusable room code, match ID and rotated bearer. It contains only fingerprints; no raw command, original response or private answer. Exact retry compares the fingerprint before stale match/round guards, returns the current authorized projection and never reapplies scoring. An elapsed deadline may still advance once on a replay or rejected command. Receipt append, scalar count, state transition and committed notification share one transaction. Unknown COMMIT outcomes retain the existing original-request retry rule; transactions are not automatically replayed.

Generic snapshots/maintenance hydrate only compact state and current membership/leases. They do not load receipt history. Ordinary receipt limits remain in force across rematches. Close deletes the room; self Leave keeps its exact terminal retry in the existing revocation record and remains available when ordinary receipts are full. Legacy string revocations use the journal solely for restricted exact Leave replay.

## Physical layout

- `likerts_live_rooms` retains compact semantic JSON and small instance/revision/expiry/activity/receipt-count/version columns.
- `likerts_live_command_receipts` stores immutable-instance/actor/request fingerprints. Its foreign key targets the room instance, not membership, so player departure does not discard command conflicts.
- `likerts_live_members` stores current presence and credential verifier.
- `likerts_live_socket_leases` stores credential-bound lease identities/expiry, with membership and room-instance ownership.

Presence/lease-only changes omit `state_json` from UPDATE. Changed commands append a small receipt instead of rewriting all earlier history. Room row locking and durable rate budgets remain; this is not an unlocked cache or an in-memory production fallback. Socket renewal after expiry/missing lease rechecks current authorization and reservation ceilings.

`openStore` accepts maxLeasesPerRoom, default26 for production and200 for development, with those reviewed upper bounds. Factory socket configuration exceeding the store bound fails explicitly. Hydration reads at most51 current members plus one overflow sentinel and the configured lease ceiling plus one sentinel. Extra/malformed identities, verifiers, numeric metadata, locators or rows fail closed; they are not silently trimmed. The existing8MiB semantic state limit remains. Larger development lease configurations require review rather than an implicit large-memory fallback.

## Migration and deployment constraint

No real/provider database migration has been executed by this work. The operator must approve a migration window and any required backup/restore handling. Migration needs the same already-authorized schema privileges as startup; this code does not grant them.

Stop all old workers and drain transactions before introducing version3. PostgreSQL initialization serializes under the existing advisory lock and an exclusive room-table lock. SQLite uses BEGIN IMMEDIATE. Schema additions, validation of legacy receipt keys/hashes and metadata, receipt/member/lease extraction, version record and write guards commit all-or-nothing. Migration walks a bounded identifier list and fetches one legacy room payload at a time. Any invalid history, conflicting receipt or fault aborts the entire transaction; no count/history reset or inferred admission ownership is allowed.

PostgreSQL writes to all six application tables require transaction-local `likerts_live.storage_version='3'`; database triggers reject an old writer without it, including admission/budget-only writes. All adapter write/cleanup transactions set it. SQLite write triggers require the version function registered only by the new adapter connection. These are compatibility guards, not replacements for database authentication or role privileges. They reject old writes, not every old read; a mixed old/new worker rollout remains unsupported.

After successful migration, restoring only the old binary is unsafe. A rollback needs an explicitly approved compatible database restoration or forward repair. On failed migration, the original legacy rows and schema changes remain uncommitted. Admission tombstones are not cascaded with active rooms: they retain their existing bounded lifetime and immutable-instance recovery protection. Receipt/member/lease children cascade on room deletion/expiry; no separate journal TTL can silently erase conflicts from an active room. Database/WAL/backups retain their independent operational erasure limits.

## Evidence limits

Phase3/evidence/storage-v3-sqlite-validation.md records the current local checkpoint. Actual PostgreSQL migration/concurrency/failure tests, final affected suites and paired fixed-work/idle/resource measurements must pass before claiming this change verified there. Smaller logical state does not by itself establish a managed database's disk or memory adequacy, vacuum/checkpoint plateau, backup behavior or production readiness. The sealed Phase2 evidence retains its original implementation and hashes.
