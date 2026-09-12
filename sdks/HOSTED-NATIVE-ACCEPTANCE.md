# Opt-in native SDK transport acceptance

These checks complement the existing renderer tests. They run the real SDK client on a native runtime against an explicitly provisioned disposable hosted collection. They are **same-team synthetic acceptance**, not independent customer activation, general device certification or a demand signal. No network calls occur merely by importing the runner or running the normal unconfigured test suites.

The host checks exactly three SDK operations: fetch the collection; submit `{rating:5}` once; resubmit the identical immutable payload with the same supplied idempotency key. Both receipts must be accepted, identify the same collection and return the same response ID. The parent/operator independently verifies the workspace has one accepted response, then revokes or deletes the dedicated resources. The collection must have `responseCap=1`; the runner requires that provisioning attestation, but public collection fetches do not expose the cap, so operator verification is still necessary.

## Private configuration

Provision one fresh disposable workspace/collection per target (`android`, `ios`, `react_native`, `flutter`). The survey needs one required scale question `rating`, min 1, max 5. Supply a private, untracked regular JSON file with mode `0600` and exactly these fields:

```json
{
  "schemaVersion": 1,
  "target": "android",
  "sdkVersion": "0.0.3",
  "baseUrl": "https://API_ORIGIN",
  "collectionId": "COLLECTION_UUID",
  "collectionToken": "COLLECTION_ONLY_TOKEN",
  "idempotencyKey": "stable_unique_test_key",
  "responseCap": 1,
  "disposable": true
}
```

This illustration is not valid provisioning evidence or a usable credential. Never put a management, browser or administrative credential in this file. The runner rejects additional fields, non-HTTPS origins, wrong targets/versions, non-private files, symlinks and tracked configuration. It cannot infer the scope of an opaque token: the provisioning owner must supply the actual collection credential. Keep the same config/key on an ambiguous rerun; do not generate another intended response.

## Commands and boundaries

From the repository root:

```sh
python3 scripts/check-native-hosted.py android --config /PRIVATE/android.json --device emulator-5554 --validate-only
python3 scripts/check-native-hosted.py android --config /PRIVATE/android.json --device emulator-5554
python3 scripts/check-native-hosted.py react_native --config /PRIVATE/react-native.json --device emulator-5554
python3 scripts/check-native-hosted.py flutter --config /PRIVATE/flutter.json --device emulator-5554
python3 scripts/check-native-hosted.py ios --config /PRIVATE/ios.json --device IOS_SIMULATOR_UUID
```

`--validate-only` verifies config and source equivalence without building, launching or making network requests. Actual runs require the local JDK/Gradle/Android SDK and booted ARM64 emulator, or Xcode/XcodeGen and the named iOS simulator. Flutter uses the existing example's Android native integration-test host. React Native uses the existing RN 0.86.3 Android/Hermes host; RN iOS UI proof remains separate. This four-target test is not a claim of hosted transport on every platform/framework/OS version.

The runner compares every current runtime source file with its frozen release-0.0.3 archive/source JAR before building. A mismatch fails closed. These native test hosts compile those source-equivalent SDKs; they do not install the downloaded release artifact itself. Clean artifact-install evidence remains a separate release check. Runtime implementation files are not modified by the runner.

Android and RN credentials are streamed over adb into the test app's private files directory, never compiled into their source or placed in shell arguments. RN passes this private configuration through native launch properties to the actual JavaScript SDK. Swift reads a file placed in the simulator app's Application Support directory. Flutter's private `--dart-define-from-file` is compiled into temporary ignored native-test artifacts; the runner deletes that define file, generated build/cache directories and installed test app after the run. Do not distribute a generated test APK. The original operator config stays private for reconciliation/recovery.

SDK calls have 10-second request timeouts; Swift and Flutter also bound whole operations to 15 seconds, Android has a 50-second coroutine limit/60-second test limit, RN polling is bounded, and native runner commands have explicit deadlines. There is no automatic test retry loop. Test failures reveal only stage codes, not response bodies or credential values. Raw tool logs remain under mode-0600 `.validation-private/`; stdout and result JSON contain only the public receipt fields, device, equivalence statement and cleanup status. Treat raw tool logs as private and review before sharing. Failure to confirm credential-file cleanup fails the run; the provisioning owner still revokes all disposable collection credentials after evidence is captured.

Normal native tests skip the hosted case without configuration. A skip is not a hosted pass. Compilation and no-config skips can be verified before the owner supplies collection files; actual fetch/submission/retry evidence exists only after a configured run and the separate ledger reconciliation.

## Recorded 2026-09-10 run

All four source-equivalent 0.0.3 native clients passed hosted fetch → submission → identical retry against the owner's stage-1 API deployment `56023673919fcfc944244cfbc829e6a21d9b6b09`:

| Target | Executed native runtime | Result |
|---|---|---|
| Kotlin Android | API-35 ARM64 emulator | Same accepted receipt on retry |
| Swift iOS | iPhone 17 Pro, iOS 26.4 simulator, Xcode 26.6 | Same accepted receipt on retry |
| React Native | RN 0.86.3 / React 19.2.3 / Hermes on API-35 ARM64 emulator | Same accepted receipt on retry |
| Flutter | Flutter 3.47.2 / Dart 3.13.2 on API-35 ARM64 emulator | Same accepted receipt on retry |

The parent independently reconciled each dedicated workspace through the management API: **one accepted response, one promotional credit consumed, zero paid consumption and zero unpaid exposure**. Management credentials remained with the parent and never entered these apps. Public receipt evidence and private tool logs are in ignored `.validation-private/native-hosted-*-result.json` / `.log`. The original configs are private and are not release artifacts.

Swift and Flutter each required two configured test executions with the same supplied idempotency key: their transport assertions passed on the first run, then the runner was corrected for XCTest moving its app container and Flutter already uninstalling its test app. Corrected runs returned the same original response IDs and confirmed local credential/config cleanup. Android and RN each needed one configured transport run. The earlier RN host lifecycle regression was fixed and its ordinary UI flow re-passed before its hosted run. No SDK implementation changed.

This records the specific runtimes and synthetic transport boundary above. It does not replace independent first-use observation, artifact-install testing, other OS/framework versions, physical-device acceptance, or production customer offline-adapter acceptance.
