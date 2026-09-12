# Likerts Flutter SDK

## Install the current source

The free community edition supports schemas 1–5. Clone the repository and use its `sdks/flutter` package. Frozen archives under `releases/` predate the free edition; use current source rather than those historical packages.

Add the current source package as a path dependency in your host app:

```yaml
dependencies:
  likerts:
    path: /absolute/path/to/likerts/sdks/flutter
```

Run `flutter pub get` using Dart 3.8+ / Flutter 3.32+. The package needs `http` 1.6+ for abortable requests and remains `publish_to: none`; no pub.dev release has been published. Import the client from `package:likerts/likerts.dart` and renderer from `package:likerts/survey.dart`.

`installation-example/checkout_feedback.dart` shows a host-owned feedback button, eligibility and dismissal. The host loads the collection, holds the same immutable submission/key across ambiguous failures and cancels pending work when dismissed. The checkout contains package sources, the trigger example, full Android/iOS app examples, and simulator gates.

This package provides the collection-only client and a native Flutter survey renderer. Administrative credentials must never be shipped in a mobile application; use only a collection-scoped token.

## Host integration

`LikertsSurvey` accepts the host collection, disabled/submitting state, `LikertsSurveyStrings`, `LikertsSurveyStyle`, an optional answer-change callback and a submit callback. The host calls `LikertsClient.submit` and retains the same immutable `Submission` and idempotency key for an ambiguous retry.

The renderer uses native radio, checkbox, choice-chip and text-field semantics. Survey and question titles are semantic headings, validation is a live region, Material controls retain their platform touch targets, and `likerts.*` keys support host integration tests. Answer and error state resets whenever the collection ID or immutable version changes.

The runnable `example/` embeds the SDK in a scrolling Material application for both Android and iOS. Its integration test completes required validation, scale, text and radio controls, then observes the host-owned completion state.

## Supported matrix

| Item | Supported | Local evidence |
| --- | --- | --- |
| Flutter | 3.32 and later stable releases | 3.32.8 and 3.47.2 |
| Android | Host-supported API levels; example uses Flutter's current minimum | Android 15 / API 35 AOSP emulator |
| iOS | iOS 15 and later | iOS 26.4 simulator |

Run `../../scripts/check-flutter-matrix.sh`. It validates the minimum Flutter version, analyzes and tests the package, analyzes the example, builds its Android APK and iOS simulator app, and optionally runs the same native integration flow when `FLUTTER_ANDROID_DEVICE` and `FLUTTER_IOS_SIMULATOR` are set. Release still requires SEC-01 and physical-device coverage.

Schema 3 choice semantics are documented in [CHOICE-FEATURES.md](../../contracts/CHOICE-FEATURES.md): Other answers carry separate selected IDs and text; None is exclusive; stars retain numeric answers and dropdowns retain option IDs.

Schema 5 adds the bounded advanced families in [ADVANCED-QUESTIONS.md](../../contracts/ADVANCED-QUESTIONS.md). Ranking uses explicit accessible Move up/down controls. Matrix rows are stacked for narrow screens and emit row-to-column ID maps. Constant-sum fields announce the remaining amount and emit every item ID only when integer allocations equal the configured total.
