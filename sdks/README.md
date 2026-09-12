# Likerts SDK foundations

[Installation and versioned artifacts](INSTALLATION.md) describes the local package gate, all five installation methods, changelogs and customer-controlled trigger examples. Run `bash scripts/check-sdk-release.sh` to create and verify a local candidate without publishing packages.

All five launch targets have source clients and basic optional renderers. These are initial development packages, not production releases. Customers own placement, triggers, consent, styling and distribution. No SDK contains management credentials, hosted survey links, campaign sending or background targeting. Their shared runtime rules are defined in [BEHAVIOR-CONTRACT.md](BEHAVIOR-CONTRACT.md) and exercised from `contracts/sdk-behavior.json`.

[OFFLINE-QUEUE.md](OFFLINE-QUEUE.md) records the cross-platform durable queue API and host responsibilities.

The frozen `0.0.1` packages declare schemas 1 and 2. Frozen `0.0.2` packages declare schemas 1–4, and frozen `0.0.3` packages declare schemas 1–5. Management callers declare every installed deployment group during publish and collection creation; `contracts/sdk-compatibility.json` includes current-fleet and mixed old/new examples. Collection clients cache decoded configuration for five minutes, accept an explicit refresh flag, evict rather than serve stale data after refresh failure, and reject any attempted change to the immutable collection/survey/version/schema-version binding.

| Target | Client | Renderer |
|---|---|---|
| Web | `web/src/index.ts` | DOM `mountSurvey` |
| React Native | `react-native/src/index.ts` | `Survey` native controls |
| iOS | `ios/Sources/Likerts/Likerts.swift` | SwiftUI `SurveyView` |
| Android | `android/.../Likerts.kt` | Compose `LikertsSurvey` |
| Flutter | `flutter/lib/likerts.dart` | `LikertsSurvey` in `survey.dart` |

The collection-only bearer token authorizes GET `/v1/collections/{id}` and POST `/v1/collections/{id}/responses`. Configurations use immutable schema versions 1–5 and support `single_choice`, `multiple_choice`, `scale`, `text`, `number`, `date`, `ranking`, `matrix` and `constant_sum`. Metadata supplied by the app is untrusted. Swift uses Codable/Sendable `JSONValue` for nested metadata objects, arrays, numbers, booleans and null; all clients accept JSON metadata objects. Swift `submit` returns a typed `Receipt` and rejects an unaccepted receipt.

Create one idempotency key per intended submission and reuse the complete payload on ambiguous transport failures. Never regenerate the key just because a request timed out. Normal submission does not silently retry or enter the optional offline queue. Applications explicitly enqueue immutable submissions and trigger each queue flush. Clients require HTTPS outside exact loopback development hosts, reject redirects, default to a 15-second timeout and expose native cancellation. The Web renderer owns submission state; native renderers emit answers and the host supplies submitting/disabled state, stable keys, server error feedback and completion handling.

All nine types have controls; dates use ISO text inputs on mobile and numbers use numeric text entry rather than native scale widgets. Advanced families use explicit rank movement, stacked matrix rows and constant-sum remaining feedback. Renderers enforce their local bounded schemas while server validation remains authoritative. The Web renderer has stable external styling hooks, localized UI copy, explicit accessible structure/focus behavior and a 256 KiB response bound. Durable offline queue modules are available on all five SDKs; Web includes its IndexedDB/WebCrypto adapter, while native hosts inject the documented Keychain/Keystore-backed encrypted-storage adapter. Do not expose administrative tokens in any app bundle.

## Checks

- Web: `cd sdks/web && npm ci && npm run build && node --test test/*.test.mjs`; repository-root `scripts/check-web-browser.sh` adds Chromium, CSP, keyboard and real-backend verification.
- React Native: `cd sdks/react-native && npm ci && npm run check && npm test`; `scripts/check-react-native-matrix.sh` verifies React Native 0.85.0, 0.86.3 and 0.87.0 with React 19.2.3.
- Swift package and 22 always-on contract/state tests plus an opt-in live rehearsal: `swift test --package-path sdks/ios`; `scripts/check-ios-matrix.sh` checks iOS 15/16/17/18/26 deployment targets and `scripts/check-ios-simulator.sh` runs the generated sample UI test on a booted simulator.
- iOS native typecheck: `xcrun --sdk iphonesimulator swiftc -typecheck -target arm64-apple-ios15.0-simulator -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" sdks/ios/Sources/Likerts/*.swift`.
- Android: Gradle 8.11.1+, JDK17 and Android SDK35; `scripts/check-android-matrix.sh`.
- Flutter: Flutter 3.32+; `scripts/check-flutter-matrix.sh`.
- Offline queue: `scripts/check-offline-queue.sh` runs the shared contract, all five platform suites and real Chromium IndexedDB/WebCrypto persistence.
- Full shared contract gate: `scripts/check-all-sdks.sh` (uses globally configured toolchains or the repository-local development toolchains when present).

Do not interpret successful compilation as device behavior, accessibility certification or a production readiness claim. See root verification notes for which toolchains actually ran.

Verified locally on 2026-09-08 through the full shared contract gate: Web compilation and 17 tests; React Native typecheck and 19 always-on tests; Swift package build with 15 always-on tests plus iOS simulator SDK typecheck; Android ten always-on JVM tests plus one Compose instrumentation test; Flutter 3.47.2 analysis with 13 always-on tests. Each SDK also has an opt-in real-backend rehearsal probe, exercised together by `scripts/check-release-rehearsal.sh`. The Web gate additionally passes Chromium keyboard/CSP integration against the real backend, the React Native suite passes on 0.85.0, 0.86.3 and 0.87.0, the generated native iOS sample passes XCTest on an iOS 26.4 simulator, the Android Compose flow passes on an API-35 AOSP emulator, and the Flutter sample completes its integration flow on both simulators. Native checks are not end-to-end physical-device runs. Locked Node development dependency audits reported zero vulnerabilities.

Android verified locally: Gradle 8.11.1, JDK 17 and Android SDK 35; the matrix gate runs ten contract tests, builds the API-26 library, sample APK and instrumented UI-test APK, and passed its Compose UI flow on an API-35 AOSP emulator. See `android/README.md` for the support matrix and remaining physical-device/security gates.


## Question expansion

All five SDKs support schema versions 1–5. Version 2 adds optional `preset` (`nps` or `yes_no`), scale `labels`, and multiple-choice `minSelections` / `maxSelections`. The six original answer types remain unchanged. The server chooses version 2 only when an expansion field is present. Upgrade installed SDKs before publishing expanded surveys; older clients reject unsupported configurations.

NPS renders numeric choices 0–10. Scale labels are paired with their numbers. Yes/no uses option IDs `yes` and `no` with customer-provided display labels. Selection controls enforce maximums or show validation errors, and submission checks minimums. Optional unanswered questions can be omitted; selecting fewer than a configured minimum is invalid. Backend validation is authoritative.

Question-expansion scenarios remain part of each platform's current contract suite. No physical-device or accessibility audit is implied. Shared authoring examples are in `contracts/expanded-survey.example.json` and `contracts/expanded-response.example.json`.

The schema 3 additions use [explicit Other/None answer semantics and presentation presets](../contracts/CHOICE-FEATURES.md). Schema 4 pages and routing are included in frozen 0.0.2.

Schema 5 adds [ranking, matrix and constant-sum questions](../contracts/ADVANCED-QUESTIONS.md). The shared fixture fixes their exact answer shapes, validation bounds and mobile interaction rules; SDK 0.0.3 supports schemas 1–5.
