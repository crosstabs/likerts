# Likerts React Native SDK

## Install

Install a published version from npm:

```sh
npm install @likerts/react-native
```

You can also use the installable tarballs from the [community release](https://github.com/crosstabs/likerts/releases/tag/community-v0.1.2).

## Install the current source

The free community edition supports schemas 1–5. Clone the repository and run these commands from its root:

```sh
npm ci --prefix sdks/react-native
npm run build --prefix sdks/react-native
cd sdks/react-native
npm pack
```

From a host app on the supported React/React Native matrix, run `npm install /absolute/path/to/likerts/sdks/react-native/likerts-react-native-0.0.3.tgz` to install the tarball you just built. The package supplies a React Native source entry for Metro and compiled TypeScript declarations. It has no native module, autolinking step or pod installation of its own. React and React Native remain host peer dependencies. Frozen archives under `releases/` predate the free edition; build current source rather than installing those historical packages.

Import `LikertsClient` and `SurveyHost` from `@likerts/react-native`. `examples/CheckoutFeedback.tsx` shows host-controlled eligibility, a feedback button, dismissal and completion. Supply the host runtime's cryptographically strong key generator and a collection-only token; no management credential belongs in the bundle. Repository build/test commands below are for SDK contributors.

The package provides a public collection client, a native `Survey` renderer and an optional `SurveyHost` adapter. Administrative credentials do not belong in an iOS or Android bundle.

`Survey` is the lower-level component. The app owns loading, submission, errors and dismissal. It accepts translated operational messages, typed native style slots, initial answers, answer-change and validation callbacks, and a stable `testID` prefix. Controls expose question-qualified accessibility labels, selected/disabled/busy state and announced validation errors. Changing the collection identity resets answers and validation state.

`SurveyHost` is a small host-app adapter for teams that want the SDK to connect the client and renderer. It cancels collection loading and an active submission when its screen unmounts, keeps the same submission and idempotency key after an ambiguous failure, clears that pending intent when answers change, and invokes `onComplete` once after a valid receipt.

```tsx
const client = new LikertsClient('https://feedback.example.com', publicCollectionToken);

<SurveyHost
  client={client}
  collectionId={collectionId}
  createIdempotencyKey={() => randomUUIDFromYourNativeRuntime()}
  metadata={{screen: 'receipt'}}
  onComplete={() => navigation.goBack()}
  onError={reportError}
  surveyProps={{
    messages: {submit: 'Send feedback', requiredSuffix: 'required'},
    styles: {container: styles.survey, submit: styles.primaryButton},
    testID: 'checkout-feedback',
  }}
/>
```

The host supplies the key generator because React Native runtime crypto support varies. Create a key for one intended submission and preserve it across ambiguous retries. The adapter does this automatically.

## Supported framework matrix

| React Native | React | Android/iOS renderer contract | Status |
|---|---|---|---|
| 0.85.x | 19.2.3 | TypeScript and Jest native-component integration | Passed on 0.85.0 |
| 0.86.x | 19.2.3 | TypeScript and Jest native-component integration | Passed on 0.86.3; locked development baseline |
| 0.87.x | 19.2.3 | TypeScript and Jest native-component integration | Passed on 0.87.0 |

Run `scripts/check-react-native-matrix.sh` from the repository root to reinstall and test all three exact baselines. The suite exercises both `Platform.OS` values and native accessibility/control props. These checks do not claim App Store/Play device certification; physical-device release rehearsal remains part of the cross-platform release gate. Separate [Android and iOS native-host runners](native-host/README.md) embed the real RN 0.86.3 renderer and exercise validation, accessibility state and exact advanced-question answers. They passed on an API-35 ARM64 emulator and iOS 26.4 simulator; they do not establish hosted networking, offline adapters or every OS/framework version.

React Native 0.85+ requires a supported Node release; this repository uses Node 22. The package uses public React Native component APIs and the New Architecture compatible surface only.

Schema 3 choice semantics are documented in [CHOICE-FEATURES.md](../../contracts/CHOICE-FEATURES.md): Other answers carry separate selected IDs and text; None is exclusive; stars retain numeric answers and dropdowns retain option IDs.

Schema 5 adds the bounded advanced families in [ADVANCED-QUESTIONS.md](../../contracts/ADVANCED-QUESTIONS.md). Ranking uses explicit accessible Move up/down controls. Matrix rows are stacked for narrow screens and emit row-to-column ID maps. Constant-sum inputs announce the remaining amount and emit every item ID only when integer allocations equal the configured total.
