# Likerts Android SDK

## Install from Maven Central

Add the repositories to your host project's `settings.gradle.kts`:

```kotlin
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}
```

Add the SDK to your app module's `build.gradle.kts`:

```kotlin
dependencies {
    implementation("com.likerts:likerts-android:0.0.3")
}
```

Enable Compose and use compatible Kotlin/Compose versions from the matrix below.
Maven Central supplies the signed AAR, POM, Gradle metadata, sources and API documentation.

## Build from source

The free community edition supports schemas 1–5. Clone the repository. With Gradle 8.11.1, JDK 17 and Android SDK 35 configured, run this from its root to build a local Maven repository:

```sh
gradle --no-daemon -p sdks/android publishReleasePublicationToLocalReleaseRepository
```

Add the generated `sdks/android/build/local-release/` directory to your host project's dependency repositories:

```kotlin
dependencyResolutionManagement {
    repositories {
        maven { url = uri("/absolute/path/to/likerts/sdks/android/build/local-release") }
        google()
        mavenCentral()
    }
}
```

Then add `implementation("com.likerts:likerts-android:0.0.3")` to the app module and enable Compose with compatible Kotlin/Compose versions from the matrix below. The local Maven repository contains the release AAR, source JAR, POM and Gradle metadata so transitive dependencies resolve. Copying only the AAR loses that dependency metadata. This build command writes to the local Maven repository. Frozen archives under `releases/` predate the free edition; build current source rather than installing those historical packages.

`installation-example/CheckoutFeedback.kt` demonstrates explicit host eligibility, a feedback button and dismissal. Pass collection-only credentials to `LikertsClient`; the host owns coroutine cancellation, submission keys and completion.

The Android SDK includes the collection client and a Jetpack Compose renderer. Administrative credentials must never be embedded in an application; use only a collection-scoped token.

## Host integration

`LikertsSurvey` accepts the host `Modifier`, localized `SurveyStrings`, layout/error `SurveyStyle`, disabled lifecycle state, an optional answer-change callback and a submit callback. The host is responsible for calling `LikertsClient.submit` and retaining the same `Submission` (and idempotency key) for an ambiguous retry.

The renderer uses native radio and checkbox semantics, heading semantics, an assertive validation-error live region, minimum touch targets from Material controls and stable `likerts.*` test tags. Answer and validation state resets whenever the collection ID or immutable version changes.

See `sample/` for a runnable Material 3 host application.

## Supported versions and checks

| Item | Supported/verified |
| --- | --- |
| Android runtime | API 26–35 (Android 8.0–15) |
| Compile/target SDK | 35 |
| Java | 17 |
| Kotlin | 2.1.20 |
| UI | Jetpack Compose BOM 2025.04.01 |

Run `../../scripts/check-android-matrix.sh`. It runs JVM contract tests, compiles the SDK with API 26 as its minimum, assembles the sample application and instrumented UI-test APK, and runs the UI test when `adb` reports a booted device. The Compose flow passed locally on an API-35 AOSP emulator. A release decision still requires SEC-01 and physical-device coverage across the supported range.

Schema 3 choice semantics are documented in [CHOICE-FEATURES.md](../../contracts/CHOICE-FEATURES.md): Other answers carry separate selected IDs and text; None is exclusive; stars retain numeric answers and dropdowns retain option IDs.

Schema 5 adds the bounded advanced families in [ADVANCED-QUESTIONS.md](../../contracts/ADVANCED-QUESTIONS.md). Ranking uses explicit accessible Move up/down controls. Matrix rows are stacked for narrow screens and emit row-to-column ID maps. Constant-sum fields announce the remaining amount and emit every item ID only when integer allocations equal the configured total.
