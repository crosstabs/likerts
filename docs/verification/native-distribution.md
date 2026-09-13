# Native distribution preparation

Prepared and checked locally on 13 September 2026. This is source/package readiness evidence, not a claim that new Swift tags, pub.dev packages or Maven Central artifacts have been published. Web/React Native/MCP npm publication is separate.

| Target | Prepared | Verified | Still required |
| --- | --- | --- | --- |
| Swift/iOS | Root `Package.swift` exposes the existing `Likerts` sources as a repository dependency; the local `sdks/ios` package remains intact. | Root test suite: 23 tests, 22 passed and the opt-in live rehearsal skipped. A fresh consumer cloned an isolated local Git fixture at semver `0.1.0`, imported the library, checked SDK capability `0.0.3`/schemas 1–5 and decoded a collection. | Merge through required checks, create a new immutable/protected semver tag at that verified commit, then verify a fresh consumer against the actual public GitHub URL. |
| Flutter | Explicit `https://pub.dev` target, full metadata and Flutter/Dart constraints, MIT `LICENSE`, archive exclusions. | Clean staged `flutter pub publish --dry-run`: 53 KB, zero warnings. Fresh source archive consumer resolved dependencies, passed analysis and a widget trigger/dismissal test. | Owner pub.dev authentication and package/publisher rights, reviewed clean source, actual publication, then a fresh registry consumer. |
| Android | Central-ready POM fields, source JAR, generated Dokka HTML inside the `javadoc` JAR, optional in-memory signing. | Unsigned local Maven staging succeeded with AAR/POM/module/source/docs artifacts and checksums; docs JAR has 300 entries including index and MIT license. Required POM sections are present. | Verified `com.likerts` namespace, Central account/token, owner signing key/public-key distribution, signed bundle validation/upload and fresh Maven Central consumption. |

The Git fixture used for Swift verification was temporary and local. It did not create a commit or tag in the Likerts source repository, create another GitHub repository or publish any artifacts. GitHub transport and the eventual public tag remain distinct checks. The Swift package release tag is independent of the SDK capability version embedded in code.

## Swift release steps

1. Merge the root manifest and run the required checks on that exact main commit. Run `swift test --package-path .` for the root package.
2. Confirm a selected semantic version does not exist; the reviewed candidate is `0.1.0`. Protect the new tag from update/deletion and create it at the tested commit. Do not move `community-v0.1.0` or modify historical archives.
3. Verify this dependency from a fresh consumer only after the tag is public:

```swift
.package(url: "https://github.com/crosstabs/likerts.git", exact: "0.1.0")
```

Link `.product(name: "Likerts", package: "likerts")`. Check `likertsSDKCapability`, decode a collection and compile the supported host. Update the iOS/public installation guides only with the real published tag. No separate Swift registry or source-split repository is required.

## Flutter release steps

The installed Dart command supports login without publishing:

```sh
/Users/adi/likerts/.tools/flutter/bin/cache/dart-sdk/bin/dart pub login
```

The owner completes that account flow personally. This machine had no tokens in `dart pub token list` and no standard pub.dev credential file during the inventory; this does not establish whether an account exists elsewhere. The anonymous `likerts` package API returned 404 during inspection; publication must recheck availability/ownership.

The package now explicitly targets pub.dev; source tests that require repository-level contract fixtures are excluded from its archive, while the repository keeps those tests. SDK source, documentation, MIT license and host example files remain in the package. The existing local archive gate now accepts either disabled publishing or the explicit pub.dev target, and includes the license in newly generated archives; frozen archives are unchanged.

From a clean, reviewed checkout, run the package's ordinary tests and:

```sh
cd sdks/flutter
../../.tools/flutter/bin/flutter pub publish --dry-run
```

A dry run from the working tree reported the expected uncommitted-file warning. Repeating in clean isolated staging reported zero warnings; no warnings were suppressed. Once authenticated and approved for the intended publisher, use `flutter pub publish` from that same reviewed package, then install `likerts: 0.0.3` into a fresh application and run its integration check. Do not use `--force`, `--skip-validation` or `--ignore-warnings` to bypass review. A domain-verified publisher is useful but requires the owner's account/domain verification. See [Dart publishing instructions](https://dart.dev/tools/pub/publishing).

## Maven Central staging and release steps

Current coordinates are `com.likerts:likerts-android:0.0.3`. The anonymous Maven metadata URL returned 404 during inspection. Gradle 8.11.1, JDK 17 and Android SDK 35 are installed under `.tools`; a GPG executable and configured Gradle publishing credential file were not found on PATH/in the standard location. No account or key was created.

Use the existing `publishReleasePublicationToLocalReleaseRepository` task with a fresh output directory. To prepare signatures, supply the owner's armored private signing key and optional password through the secret environment, then add `-PlikertsCentralStaging=true`. The configuration fails before staging if the required signing key is absent; normal local development does not require signing secrets.

```sh
# JAVA_HOME / ANDROID_HOME and the signing environment must already be supplied.
# LIKERTS_MAVEN_SIGNING_KEY and LIKERTS_MAVEN_SIGNING_PASSWORD never belong in arguments or Git.
gradle --no-daemon -p sdks/android \
  -PlikertsCentralStaging=true \
  -PlikertsReleaseRepository=/absolute/fresh/central-staging \
  publishReleasePublicationToLocalReleaseRepository
```

The build produces source documentation with pinned Dokka 2.2.0 and packages that HTML as a `javadoc` artifact, following [Dokka's Maven publication guidance](https://kotlinlang.org/docs/dokka-gradle.html#build-javadoc-jar). It does not configure an upload repository or automatically publish to Central. A successful local staging build does not prove Central acceptance or valid owner signatures.

Before upload, verify the namespace and issuer account, make the public signing key available as required, inspect/verify the POM, AAR, sources, documentation and `.asc` signatures, and package the Maven coordinate directory plus checksums into a bundle. Follow the [Central publication requirements](https://central.sonatype.org/publish/requirements/) and [Publisher API](https://central.sonatype.org/publish/publish-portal-api/) using a Portal token from the owner's secret manager. Upload as a user-managed deployment for validation before final publication. Sonatype does not currently provide its own official Gradle Portal plugin; this preparation deliberately stages standard Maven artifacts and leaves the controlled upload explicit. [Gradle options](https://central.sonatype.org/publish/publish-portal-gradle/)

No signing credential was available for the local check, so actual signature verification and Central validation remain required. The local build emitted an Android SDK XML-version warning but completed successfully; this is not evidence of a physical-device test or compatibility certification.
