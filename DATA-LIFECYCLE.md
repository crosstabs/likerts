# Data lifecycle and deletion contract

This contract applies to raw respondent answers, export objects and workspace identity data. Financial retention remains a separate launch decision because usage and settlement records may have legal retention duties. Raw answers never inherit that retention.

## Active data

- Raw answers and caller metadata default to 90 days from server acceptance. A workspace may select 1–90 days.
- The retention worker processes at most 1,000 response rows and 1,000 expired export jobs per workspace invocation. Repeated runs drain a backlog without an unbounded transaction.
- Export selection and generated content use the snapshot recorded at job creation. Download authorization expires exactly 24 hours after creation.
- The local object-store adapter receives the expiry timestamp. Production S3 must use private objects, deny public access and enforce deletion with lifecycle rules as a second line of defense.

## Erasure

Explicit response erasure replaces `answers` and `metadata` with SQL null and records `raw_deleted_at`. The response ID, collection ID, acceptance time, usage entry, idempotency key and a 32-byte capability-keyed payload digest remain. That minimal record allows an identical authorized retry to return its original receipt and a changed payload to conflict without retaining answer contents.

Workspace erasure is a tombstone operation. It marks the workspace deleted, closes and revokes collections, erases raw responses, revokes and removes export objects, and removes membership, OAuth-grant and service-credential records. It retains structural IDs, deletion events and financial usage records. Authentication must reject a deleted workspace on every subsequent request.

Every explicit or retention deletion writes an immutable `deletion_events` row in the same transaction as database erasure. Events contain only workspace, kind, opaque resource ID and deletion time. They carry no response content, credential or identity subject.

## Retry records

New submissions store `HMAC-SHA-256(collection capability, canonical JSON submission)` before raw erasure. The collection capability is never stored in plaintext. Existing pre-migration responses have no digest and must be erased on schedule; after erasure they return the terminal receipt-expired result because their original payload cannot be compared safely.

Minimal retry records live through the collection acceptance lifetime plus 30 days. Once that window ends, an old key returns a terminal expiry result and can never create a new accepted response. Collection revocation continues to deny all retries immediately.

## Backups and restore

Production automated backups and point-in-time recovery retain at most seven rolling days. A deleted value may remain encrypted inside an inaccessible backup until that backup expires; it must never be copied into a longer-lived ad hoc snapshot.

A restore is not ready to serve traffic until operations replay all deletion events newer than the restore point from the separately replicated deletion-event stream, run retention to an empty eligible batch, and verify that deleted workspace credentials and export objects are absent. The current local database table proves transactional event creation; OPS-01/OPS-03 must configure the external event copy, private S3 lifecycle and perform the restore drill before launch.

## Verification gates

DATA-03 is complete only when tests prove explicit response erasure, scheduled retention, preserved accounting, identical/changed retry behavior after erasure, export-object deletion, workspace credential denial, tenant isolation, bounded batches and deletion events. OPS-03A now proves a local logical restore with post-backup response and workspace deletion replay, revoked credentials/exports and preserved accounting/audit/RLS. See infrastructure/recovery/local-evidence.json and infrastructure/OPERATIONS.md. OPS-03 remains responsible for independently durable journal replication and the managed RDS backup/PITR restore and replay drill.
