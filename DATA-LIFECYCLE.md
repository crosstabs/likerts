# Data lifecycle and deletion contract

This document describes the community edition’s implemented data operations and the deployment responsibilities needed to make them run on a schedule. Usage counts are observability data, not billing or settlement records. The hosted reference preview has not completed the retention, backup and independent deletion-journal gates in [PUBLIC-LAUNCH.md](PUBLIC-LAUNCH.md#hosted-service-gates--required-before-expanding-the-preview-claim).

## Active data

- The database retention policy defaults to 90 days from server acceptance and supports 1–90 days. Eligibility is not deletion: an operator must invoke retention after data becomes due.
- The authenticated `POST /v1/retention` operation (scope `responses:write`) processes at most 1,000 due response rows and 1,000 eligible export jobs per workspace invocation. Repeated runs drain a backlog without an unbounded transaction. A scheduler must enumerate the intended workspaces, invoke bounded batches and monitor failures; the API route alone provides no scheduling guarantee.
- Export selection and generated content use the snapshot recorded at job creation. Download authorization expires exactly 24 hours after creation.
- Expired or revoked export objects must be deleted from the configured store, with failures monitored and reconciled. The current hosted store is private Vercel Blob; S3 is an optional self-host adapter. A download authorization expiry does not by itself prove physical object deletion.

## Erasure

Explicit response erasure replaces `answers` and `metadata` with SQL null and records `raw_deleted_at`. The response ID, collection ID, acceptance time, usage entry, idempotency key and a 32-byte capability-keyed payload digest remain. That minimal record allows an identical authorized retry to return its original receipt and a changed payload to conflict without retaining answer contents.

Workspace erasure is a tombstone operation. It marks the workspace deleted, closes and revokes collections, erases raw responses, revokes export access, and removes membership, OAuth-grant and service-credential records. Storage deletion is attempted after database revocation commits. A storage failure requires operator reconciliation: another workspace-delete request does not automatically replay the lost object-cleanup work. H02 must resolve and verify this physical-cleanup boundary before hosted deletion guarantees. It retains structural IDs, deletion events and count-only usage records. Authentication must reject a deleted workspace on every subsequent request.

Every explicit or retention deletion writes an immutable `deletion_events` row in the same transaction as database erasure. Events contain only workspace, kind, opaque resource ID and deletion time. They carry no response content, credential or identity subject.

## Retry records

New submissions store `HMAC-SHA-256(collection capability, canonical JSON submission)` before raw erasure. The collection capability is never stored in plaintext. Existing pre-migration responses have no digest and must be erased on schedule; after erasure they return the terminal receipt-expired result because their original payload cannot be compared safely.

Minimal retry records remain after raw-answer erasure so an authorized identical retry can return its original receipt. The current implementation does not establish an automatic collection-lifetime-plus-30-day purge; operators must not advertise that expiry as implemented. Collection revocation denies retries immediately.

## Backups and restore

Each operator must configure and verify its backup/PITR retention window, encryption and access restrictions. The hosted Neon window has not yet been verified; this project does not currently promise seven-day backup expiry or measured managed recovery objectives. A deleted value may persist in a backup until the configured backup expires; record that boundary and avoid ad hoc snapshots that silently extend it.

A restore is not ready to serve traffic until operations replay all deletion events newer than the restore point from the separately replicated deletion-event stream, run retention to an empty eligible batch, and verify that deleted workspace credentials and export objects are absent. The current local database table proves transactional event creation. Before hosted production-data readiness, H02/H03 must prove the independently durable event copy, private Blob cleanup and a quarantined Neon restore. Self-host operators must prove the corresponding controls on their selected providers.

## Verification gates

Current automated checks cover explicit erasure, bounded retention invocations, preserved count-only usage, retry behavior after erasure, export invalidation, workspace credential denial, tenant isolation and deletion events. They do not prove that hosted retention is scheduled or that provider backups expire under a verified policy.

The local logical restore test replays post-backup response and workspace deletion, quarantines credentials/exports/callbacks and verifies audit/RLS behavior. See [local evidence](infrastructure/recovery/local-evidence.json) and [operations](infrastructure/OPERATIONS.md). Managed Neon PITR, independent journal replication and safe reopening remain H03; operational scheduling and export cleanup remain H02.
