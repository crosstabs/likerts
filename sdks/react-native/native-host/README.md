# React Native runtime acceptance

This app embeds the actual `Survey` export in Android and iOS React Native hosts. It uses RN 0.86.3, React 19.2.3, Hermes and the New Architecture. Its question controls are real native views. No renderer, React Native component, native bridge or submission callback is mocked. The default UI runners use bundled JavaScript and a synthetic local fixture without hosted networking. A separate, explicitly configured [native hosted transport runner](../../HOSTED-NATIVE-ACCEPTANCE.md) uses the real SDK client on Android; its collection-only credential is supplied at runtime through private native launch properties.

Install the repository's locked JavaScript dependencies with `npm ci --prefix sdks/react-native`, boot an ARM64 Android emulator, then run:

```sh
ANDROID_SERIAL=emulator-5554 bash sdks/react-native/native-host/check.sh
```

The runner uses the existing `.tools` JDK 17, Gradle 8.11.1, Android SDK (compile SDK 36) and NDK, or the corresponding `JAVA_HOME`, `GRADLE_COMMAND`, `ANDROID_HOME` and `GRADLE_USER_HOME` overrides. Gradle resolves pinned React Native/Hermes Maven artifacts on first use. The host targets API 35 and currently packages ARM64 only. Bundled JavaScript means no Metro development server or device network connection is required at runtime.

The host has no custom/autolinked native modules. `build-native.py` compiles the small RN core TurboModule registration glue with the installed NDK and the pinned AAR prefab headers plus React Native's own Folly flags. Generated native libraries, the bundle, Gradle outputs and local paths are ignored. SDK source is imported through its public source entry point; separate release-artifact clean-install checks remain required.

The native UI runner verifies required validation blocks submission; moves a ranking option; selects a matrix cell and verifies its checked state; enters 60/40 through Android input; checks the remaining allocation; and submits once. The host compares the entire emitted answer map and submission count with the expected values. The runner only passes if that exact result is rendered in the native accessibility tree. It saves a screenshot to `/tmp/likerts-rn-native-pass.png` (override with `LIKERTS_RN_SCREENSHOT`).

## iOS simulator

With Xcode, XcodeGen and CocoaPods 1.16.2 installed, run:

```sh
LIKERTS_IOS_SIMULATOR_ID=<simulator-uuid> bash sdks/react-native/native-host/check-ios.sh
```

`POD_COMMAND` may point to an executable wrapper for an isolated Ruby/Bundler environment. The local 2026-09-10 run used system Ruby 2.6.10 with Bundler 2.4.22/CocoaPods 1.16.2 installed under ignored `.tools`, with its default `logger` 1.3.0 pinned and preloaded. No system gem installation was modified. A current compatible Ruby/CocoaPods installation may use the normal `pod` executable. The committed Podfile lock pins the native dependency graph; generated projects, downloaded Pods and bundles are ignored.

The runner generates an Xcode workspace, bundles the same JavaScript fixture, and runs a native XCTest flow. It verifies required validation blocks the callback, ranking order, the radio's native `radio button, checked` accessibility value, number-pad entry, exact allocation, and the entire emitted map with one submission. The host explicitly manages keyboard insets and dismisses the number pad on drag so Submit stays reachable. The Xcode result bundle retains a screenshot attachment.

Both runners passed on 2026-09-10: Android API 35 ARM64 emulator and iPhone 17 Pro iOS 26.4 simulator (Xcode 26.6). These are specific runtime checks. They do not prove hosted API collection, response accounting, offline storage/backup protection, minimum supported OS runtimes, physical devices, or every claimed framework version. Separate release-artifact clean-install checks remain required.
