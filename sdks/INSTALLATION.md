# Local SDK installation and artifact gate

Frozen 0.0.3 artifacts declare schemas 1–5 and include advanced questions plus durable offline queue APIs. Frozen 0.0.2 artifacts declare schemas 1–4; frozen 0.0.1 artifacts retain schemas 1/2. The gate refuses to overwrite an existing successful release manifest; increment `RELEASE-VERSION` for a new candidate.

For a new candidate version, run `bash scripts/check-sdk-release.sh` from the repository. The gate builds all five versioned SDK artifacts and installs each into a new consumer project under `.tools/`, using packaged files rather than repository project dependencies. It writes `releases/<version>/manifest.json` only after every install check passes. The latest evidence is `releases/0.0.3/manifest.json`. The manifest records artifact size, SHA-256 and the exact verification boundary. No package registry is contacted for publication; dependency downloads and the Android file-based Maven repository are local build/install steps.

The gate requires Node/npm, Swift/Xcode on macOS, JDK17, Android SDK35, Gradle8.11.1 and Flutter3.32+. It uses installed toolchains or this repository's `.tools` defaults. Override `JAVA_HOME`, `ANDROID_HOME`, `GRADLE_COMMAND`, `GRADLE_USER_HOME` and `FLUTTER_COMMAND` when appropriate. Set `LIKERTS_KEEP_INSTALL_PROJECTS=1` to retain the disposable consumers for inspection. Failed consumers are retained automatically; a failed run never leaves a fresh success manifest.

| Target | Artifact | Independent install check | Guide |
| --- | --- | --- | --- |
| Web | `likerts-web-0.0.3.tgz` | npm install, public ESM and offline exports, TypeScript host trigger and DOM setup/cleanup | [Web](web/README.md) |
| React Native | `likerts-react-native-0.0.3.tgz` | npm install with RN0.86.3/React19.2.3, offline subpath/declaration checks, Babel compilation and host trigger | [React Native](react-native/README.md) |
| iOS | `Likerts-ios-0.0.3.tar.gz` | Extracted Swift tests plus fresh consumer compilation of public advanced/offline and SwiftUI APIs | [iOS](ios/README.md) |
| Android | `likerts-android-maven-0.0.3.tar.gz` | Extracted Maven repository resolves advanced/offline types and metadata into a new Android app | [Android](android/README.md) |
| Flutter | `likerts-flutter-0.0.3.tar.gz` | Extracted path dependency resolves advanced/offline APIs; analysis and widget trigger/dismissal test | [Flutter](flutter/README.md) |

Every artifact contains its installation guide, changelog and a customer-controlled presentation example. The host decides consent, eligibility, placement and timing. Native callbacks leave submission/retry/cancellation ownership with the app; only the React Native host adapter and Web renderer manage those mechanics themselves. Keep the same complete submission and key after ambiguous failures. A collection credential belongs in the collector; management credentials do not.

The version in `RELEASE-VERSION`, package metadata and each SDK capability record must agree. Record every installed customer SDK group during survey publication and collection binding. Hashes identify each frozen local artifact; source archives and build timestamps are not a byte-for-byte reproducibility claim. Public registry names, repository tags, artifact signing, package publication and release support commitments remain separate decisions. Existing platform, simulator, accessibility and physical-device gates are still required; a clean install does not establish runtime certification.
