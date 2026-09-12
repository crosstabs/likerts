# Likerts Android SDK

## Install the local 0.0.3 artifact

This local package supports schemas 1–5. The release manifest records artifact and clean-install verification; frozen 0.0.1 and 0.0.2 artifacts remain available separately.

Extract `likerts-android-maven-0.0.3.tar.gz` and add its `maven/` directory to the host project's dependency repositories:

```kotlin
dependencyResolutionManagement {
    repositories {
        maven { url = uri("/path/to/extracted/maven") }
        google()
        mavenCentral()
    }
}
```

Then add `implementation("com.likerts:likerts-android:0.0.3")` to the app module and enable Compose with compatible Kotlin/Compose versions from the matrix below. The local Maven bundle contains the release AAR, source JAR, POM and Gradle metadata so transitive dependencies resolve. Copying only the AAR loses that dependency metadata. No remote Maven registry has been written.

`android-guide/CheckoutFeedback.kt` in the archive (or `installation-example/CheckoutFeedback.kt` in a source checkout) demonstrates explicit host eligibility, a feedback button and dismissal. Pass collection-only credentials to `LikertsClient`; the host owns coroutine cancellation, submission keys and completion. The clean install gate compiles the packaged example in a new application that depends only on the extracted Maven repository.

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
