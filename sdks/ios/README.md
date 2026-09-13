# Likerts iOS SDK

## Install the Swift package

The free community edition supports schemas 1–5. Add `https://github.com/crosstabs/likerts.git` in Xcode with exact version **0.1.0**, then link the `Likerts` product. A fresh public GitHub consumer passed; see [native distribution evidence](../../docs/verification/native-distribution.md). The Swift package tag is separate from SDK capability version `0.0.3`.

For a SwiftPM consumer:

```swift
.package(url: "https://github.com/crosstabs/likerts.git", exact: "0.1.0")
// In the target dependencies:
.product(name: "Likerts", package: "likerts")
```

For local development, clone the repository and use its `sdks/ios` package. Frozen archives under `releases/` predate the free edition and are not the current installation path.

In Xcode, choose **Add Package Dependencies → Add Local** and select `/absolute/path/to/likerts/sdks/ios`, then link its `Likerts` product to your app target. For a SwiftPM consumer, use `.package(name: "Likerts", path: "/absolute/path/to/likerts/sdks/ios")` and `.product(name: "Likerts", package: "Likerts")`. The package uses Swift tools 5.9 and supports iOS 15+ and macOS 12+. The repository root exposes the same `Likerts` product through the public Git dependency above. No binary framework or separate Swift registry publication is claimed.

`InstallationExample/CheckoutFeedback.swift` demonstrates host-controlled eligibility and sheet presentation. The host owns collection loading, stable submission/retry state and cancellation on dismissal. The checkout includes public sources, package tests, and the full XcodeGen app referenced below.

The Swift package provides `LikertsClient`, typed collection/submission models and the SwiftUI `SurveyView`. Add the local package during development and import `Likerts`. Only a public collection token belongs in an application bundle.

`SurveyView` renders all nine question types and returns a locally validated `[String: Answer]` snapshot. The host owns the async submit task, server-error UI, placement and dismissal. Cancel that task when its containing screen disappears and retain the same `Submission` value after an ambiguous failure.

```swift
SurveyView(
    collection: collection,
    disabled: isSubmitting,
    strings: SurveyStrings(submit: "Enviar", requiredSuffix: "obligatorio"),
    theme: SurveyTheme(accentColor: .purple),
    accessibilityIdentifierPrefix: "checkout.feedback"
) { answers in
    submit(answers)
}
```

`SurveyStrings` localizes operational copy and validation templates while survey titles, questions and choices remain customer-authored content. `SurveyTheme` controls the accent, title font and validation color; normal SwiftUI environment and container modifiers remain available to the host. Stable accessibility identifiers cover the title, question labels, controls, validation message and submit button. Required state is voiced in labels, option labels include their question context, invalid submission posts an accessibility announcement, and collection identity changes clear transient answers and feedback.

The reproducible sample under `Example/` uses XcodeGen to create an iOS 15+ app. It demonstrates Spanish copy, a customer color and completion. `scripts/check-ios-simulator.sh` generates the project, builds it, launches it on an already booted simulator, and runs an XCTest UI flow that checks identifiers/labels, translated required feedback, text entry and completion.

## Supported OS matrix

| OS target | Verification |
|---|---|
| iOS 15 | Package deployment floor and simulator SDK typecheck |
| iOS 16 | Simulator SDK typecheck |
| iOS 17 | Simulator SDK typecheck |
| iOS 18 | Simulator SDK typecheck |
| iOS 26 | Simulator SDK typecheck; sample UI test passed on iOS 26.4. Actual iOS 26.6.1 device passed renderer and offline-host tests 3/3 at source `2996ebc` ([evidence](../../docs/verification/ios-physical.md)). |

Run `scripts/check-ios-matrix.sh` for all deployment-target checks and `swift test --package-path sdks/ios` for the model/state suite. Older OS runtimes remain unverified. Physical iOS 26.6.1 rendering and Keychain/CryptoKit offline-host checks passed separately; live HTTP/network-loss, reboot/lock-state and VoiceOver behavior are not established by that bounded device run.

Schema 3 choice semantics are documented in [CHOICE-FEATURES.md](../../contracts/CHOICE-FEATURES.md): Other answers carry separate selected IDs and text; None is exclusive; stars retain numeric answers and dropdowns retain option IDs.

Schema 5 adds the bounded advanced families in [ADVANCED-QUESTIONS.md](../../contracts/ADVANCED-QUESTIONS.md). Ranking uses explicit accessible Move up/down controls. Matrix rows are stacked for narrow screens and emit row-to-column ID maps. Constant-sum fields announce the remaining amount and emit every item ID only when integer allocations equal the configured total.
