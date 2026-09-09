# Durable offline collection

The offline queue is an explicit SDK facility. It does not silently intercept normal `submit` calls and does not run an autonomous retry loop. A host creates a queue with limits, enqueues an immutable submission and calls `flush` when its own lifecycle and connectivity policy allow. The same serialized submission and `idempotencyKey` are used for every attempt. Billing still happens only when the backend accepts a response; local enqueue, inspection, expiry and retry never create usage.

## Required behavior

- Each record binds `collectionId`, the immutable serialized submission, creation time, byte size, attempt count and state. Mutation requires deleting the old record and enqueueing a new idempotency key.
- Defaults are 1,000 records, 10 MiB total encoded payload and seven days of age. Configurable limits may only reduce or increase these within hard ceilings of 10,000 records, 100 MiB and 30 days.
- Enqueue rejects a record larger than 64 KiB or a queue that would exceed either capacity limit. It never evicts an unsubmitted record to make room.
- Persistent payloads and record metadata are authenticated-encrypted at rest. Keys live outside the queue data: iOS Keychain, Android Keystore, or an equivalent host/native secure-key adapter. Decryption or authentication failure quarantines the record and never submits partial data.
- `flush` is caller-triggered, processes a stable oldest-first snapshot and permits one active flush per queue. Cancellation stops before the next attempt and never rewrites an in-flight envelope.
- A valid accepted receipt removes its record. A timeout, connection failure, `408`, `425`, `429`, or `5xx` leaves it pending and increments its attempt count. `Retry-After` is returned to the caller as a hint; the SDK does not sleep or schedule work.
- `400`, idempotency mismatch `409`, `401`, `403`, `404`, and `410` are terminal. The record remains encrypted in a `blocked` state with a bounded safe reason (`invalid`, `conflict`, `unauthorized`, `revoked`, `deleted`, or `expired`) until caller deletion or age expiry. It is never retried automatically.
- Before each flush, records older than their configured maximum age become `expired_local` and are not sent. The caller can inspect counts/reasons and delete records; SDK logs and callbacks never expose answers or tokens.
- Collection credentials are supplied to `flush` by a caller-controlled resolver and are never persisted in queue records. One revoked collection cannot block attempts for other collections in the same snapshot.

Collection expiry and revocation remain authoritative server decisions. A locally queued record is not proof that its collection or credential is still valid. The queue does not promise delivery, background execution, cross-device synchronization or recovery after loss of the platform key.

## Platform storage profile

| SDK | Durable ciphertext | Key protection |
|---|---|---|
| Web | IndexedDB record encrypted with AES-GCM | non-extractable WebCrypto key in IndexedDB; vulnerable to same-origin script compromise while unlocked |
| React Native | required native queue adapter | Keychain/Keystore-backed key; no AsyncStorage plaintext fallback |
| iOS | application-support file or SQLite blob | device-only Keychain key, AES-GCM |
| Android | private app file or Room blob | non-exportable Android Keystore AES-GCM key |
| Flutter | native platform adapter on iOS/Android | same Keychain/Keystore profiles as native SDKs |

Browser encryption limits exposure from copied storage and casual disk inspection. It cannot protect data from malicious JavaScript executing in the same origin, an unlocked compromised device, screenshots, caller logs, or metadata deliberately copied outside the SDK. Native backup inclusion and device migration are controlled by the host application and must not export the queue key.
