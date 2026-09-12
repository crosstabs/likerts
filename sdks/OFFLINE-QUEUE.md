# Offline queue API

All SDKs expose the same logical operations with platform-native naming and async primitives:

```text
open(storage, keyProvider, limits?) -> OfflineQueue
enqueue(collectionId, immutableSubmission) -> recordId
snapshot() -> {pending, blockedByReason, expiredLocal, quarantined, bytes}
flush(resolveCredential, cancellation?) -> FlushReport
delete(recordId) -> void
deleteCollection(collectionId) -> count
purgeQuarantined() -> count
```

`storage` must be durable and authenticated-encrypted. React Native and Flutter require an installed native adapter and fail initialization if its declared protection profile is not Keychain/Keystore-backed authenticated encryption. There is no plaintext, AsyncStorage, shared-preferences or user-defaults fallback. Web owns IndexedDB storage and AES-GCM with a non-extractable WebCrypto key in a separate object store. Swift, Kotlin, React Native and Flutter accept opaque sealed-record adapters so the application can select a file/SQLite/Room implementation while keys remain in device-only Keychain or Android Keystore.

`resolveCredential(collectionId)` runs immediately before each network attempt. Returning no credential leaves the record pending and reports `credential_unavailable`; the credential is never written to storage. `flush` returns per-record safe outcomes, the server's bounded `Retry-After` hint where present and aggregate counts. It does not return answer payloads.

The queue copies and canonically serializes a submission during `enqueue`. Callers cannot edit the queued value through a retained object reference. Reusing an idempotency key with different bytes is rejected locally when detectable and remains a terminal server conflict if attempted across queues or devices.

Applications decide when to retry, whether to request OS background execution and how to tell a respondent that delivery is pending or blocked. Queue callbacks are state notifications rather than delivery promises. Cancelling a flush stops before the next attempt and leaves the current record pending unless a valid accepted receipt was already decoded.

## Physical limits and guarantees

The defaults are 1,000 records, 10 MiB of serialized submissions and seven days. Configuration cannot exceed 10,000 records, 100 MiB, 30 days or 64 KiB for one submission. Limits count clear serialized submission bytes rather than encryption and storage-engine overhead, so applications must reserve additional device storage. Capacity rejection never evicts a queued record.

Web persistence has been exercised in Chromium with real IndexedDB, a non-extractable WebCrypto AES-GCM key, reload and flush. Native core tests exercise strict adapter rejection, authenticated-decryption quarantine and state transitions, but the SDK cannot certify a host-supplied adapter's backup exclusion, hardware protection or durability. React Native and Flutter deliberately ship no fallback adapter. None of the queues request OS background time, synchronize across devices or recover data after the platform key is lost.

Only a valid server receipt with `accepted: true`, a response ID and the matching collection ID removes an envelope. Credentials are resolved immediately before each attempt and are never sealed into queue storage.
