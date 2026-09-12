# Native Android acceptance

`bash scripts/check-android-matrix.sh` from the repository root runs the JVM/build checks and, with a booted device, connected instrumented tests. On 2026-09-10 the API-35 ARM64 emulator passed six connected SDK tests, including four renderer tests and two secure-offline tests.

`KeystoreOfflineInstrumentedTest` supplies a test-only host adapter using a real Android Keystore AES-256-GCM key and an `AtomicFile` under `Context.noBackupFilesDir`. Fresh adapter/queue objects recover ciphertext and the existing key. The test checks an identical payload through retries, rejects a receipt for the wrong collection, removes a record only after a matching accepted receipt, and checks an ephemeral credential is absent even from the decrypted persisted envelope. Authenticated ciphertext tampering and deletion of the native key quarantine records without a credential lookup or send call.

The adapter is confined to `androidTest`; it is not a shipped production adapter. Send callbacks are synthetic and do not establish hosted networking or metering. Reopening objects verifies durable readback, not process death or interrupted writes. These emulator results do not certify hardware-backed keys, backup/restore behavior of a customer app, physical-device lock behavior, or the entire supported Android range.

`HostedTransportInstrumentedTest` is a separate opt-in case described in [hosted native acceptance](../../../HOSTED-NATIVE-ACCEPTANCE.md). It skips without private configuration and is never counted as a hosted pass on that basis. Its real SDK fetch/submission/retry run requires an owner-provisioned disposable collection and separate ledger reconciliation.
