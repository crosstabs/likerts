# SDK installation

The free, MIT-licensed SDKs support schema versions 1–5 and return accepted-response receipts without billing fields. Web and React Native are published on npm as version `0.0.3`. iOS is available through the public Swift Git package tag `0.1.0`, with a local package option. Flutter is published on pub.dev as `likerts 0.0.3`. Android is published on Maven Central as `com.likerts:likerts-android:0.0.3`. See [published versions](../docs/releases.md#install-from-npm).

Clone the source to build locally:

```sh
git clone https://github.com/crosstabs/likerts.git
cd likerts
```

The frozen archives under `releases/` are historical snapshots from before the free edition. They are no longer downloadable from the website and should not be used for a new community-edition integration.

## Choose a platform

| Platform | Installation | Guide |
| --- | --- | --- |
| Web | `npm install @likerts/web@0.0.3` (Node.js 22+). | [Web](web/README.md) |
| React Native | `npm install @likerts/react-native@0.0.3` (React `^19.2.3`, React Native `>=0.85 <0.88`). | [React Native](react-native/README.md) |
| iOS | Add `https://github.com/crosstabs/likerts.git` at exact Swift package version `0.1.0` and link `Likerts`; local `sdks/ios` is also supported. | [iOS](ios/README.md) |
| Android | Add `google()` and `mavenCentral()` to your dependency repositories, then `implementation("com.likerts:likerts-android:0.0.3")` to your app module. | [Android](android/README.md) |
| Flutter | Add `likerts: 0.0.3` to your host's `pubspec.yaml`, then run `flutter pub get` (Dart 3.8+ / Flutter 3.32+). | [Flutter](flutter/README.md) |

Each platform guide includes exact build/install commands, framework requirements, and a customer-controlled presentation example. For reproducible application builds, pin the repository commit you consume and store generated packages in your own artifact repository.

## Connect your collection

Start the local API using the [quickstart](https://likerts.com/docs#run), or sign in at [likerts.com/app](https://likerts.com/app) for the optional [hosted reference preview](https://likerts.com/preview). Use synthetic, non-sensitive data while its operational gates remain open. For hosted management, copy your workspace ID and create a scoped credential under **Connect Codex, Claude, or the CLI**. Store the token in your secret manager; it is returned only at creation. [The management guide](../tools/README.md) covers direct API/CLI use and remote MCP configuration for Codex and Claude Code.

The hosted API origin is `https://likerts-api.onrender.com`; local development uses `http://127.0.0.1:8080`. Create a survey, publish it with the capability records from every installed SDK group, then create a collection. These management operations use the service credential. `collections_create` returns a separate collection credential for the embedded SDK.

Configure the SDK with the API origin, collection ID, and collection credential. Never put the management credential in a browser or mobile app. For browser traffic, use a same-origin proxy or configure exact HTTPS origins through `collections_security_update`. Remote MCP management uses a different origin, `https://likerts-mcp.onrender.com/mcp/{workspaceId}`; SDK requests go to the API.

The host decides consent, eligibility, placement, styling, and timing. Native callbacks leave submission/retry/cancellation ownership with the app; the React Native `SurveyHost` adapter and Web renderer can manage those mechanics. Keep the same complete submission and key after ambiguous failures. Optional offline queues do not enqueue or flush automatically.

## Maintainer package verification

`bash scripts/check-sdk-release.sh` builds all five versioned artifacts and installs each into a new consumer project under `.tools/`. It writes a release manifest only after all install checks pass and refuses to overwrite a successful frozen manifest. Increment the candidate version consistently before producing a new frozen release; do not interpret the old manifests as verification of later source changes.

The gate requires Node/npm, Swift/Xcode on macOS, JDK 17, Android SDK 35, Gradle 8.11.1, and Flutter 3.32+. It uses installed toolchains or this repository's `.tools` defaults. Override `JAVA_HOME`, `ANDROID_HOME`, `GRADLE_COMMAND`, `GRADLE_USER_HOME`, and `FLUTTER_COMMAND` as needed. `LIKERTS_KEEP_INSTALL_PROJECTS=1` retains disposable consumers for inspection.

This gate builds local artifacts; it does not publish packages. Source and installed package tests, browser/simulator flows, and physical-device coverage have separate verification boundaries. See [the SDK overview](README.md) for checks and recorded evidence.
