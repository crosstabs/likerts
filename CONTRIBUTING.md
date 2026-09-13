# Contributing to Likerts

Help make it easier to put feedback inside a product. Useful contributions include a reproducible bug report, a clearer installation step, a working framework example, a keyboard-accessibility fix or a focused SDK improvement. You do not need to install every mobile toolchain to contribute.

Start with the [browser demo](https://likerts.com/demo), or follow the [local first-response walkthrough](README.md#run-the-api-locally). The browser demo keeps answers in page memory; the local walkthrough exercises the API and verifies a stored response.

## Pick a change

- Search [existing issues](https://github.com/crosstabs/likerts/issues) before opening one. Include a small reproduction and the behavior you expected.
- For a small fix, send a focused pull request. Discuss a new question type, public contract change or significant dependency in an issue first so compatibility work can be planned together.
- To take an issue, leave a short comment describing your approach. Ask for missing context; you do not need a complete design to get started.
- See the [roadmap](docs/community/ROADMAP.md) for priorities. These are opportunities, not release-date promises.

Security reports belong in the [private reporting path](SECURITY.md). Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Work locally

Fork the repository, clone your fork and create a descriptive branch. Commands below run from the repository root. Node.js work needs Node 22+ and npm; Rust work needs stable Rust. `source scripts/dev-env.sh` makes an existing local toolchain available without installing one.

Choose checks for the area you changed:

| Area | Focused checks |
| --- | --- |
| Landing page or public docs | `npm ci --prefix control-plane`, then `npm run check --prefix control-plane`; open the changed page at desktop and mobile widths and exercise its controls |
| Rust API/domain | `cargo test --manifest-path backend/Cargo.toml --locked` and `cargo fmt --manifest-path backend/Cargo.toml --check` |
| Rust CLI | `cargo test --manifest-path tools/cli/Cargo.toml --locked` and `cargo fmt --manifest-path tools/cli/Cargo.toml --check` |
| MCP adapter | `npm ci --prefix tools/mcp`, `npm run build --prefix tools/mcp`, `npm test --prefix tools/mcp` |
| Web SDK | `npm ci --prefix sdks/web`, `npm run build --prefix sdks/web`, `node --test sdks/web/test/*.test.mjs` |
| React Native SDK | `npm ci --prefix sdks/react-native`, `npm run check --prefix sdks/react-native`, `npm test --prefix sdks/react-native` |
| iOS SDK | `swift test --package-path sdks/ios`; see [iOS setup](sdks/ios/README.md) for simulator/UI work |
| Android SDK | With the [Android prerequisites](sdks/android/README.md), `gradle --no-daemon -p sdks/android testDebugUnitTest` |
| Flutter SDK | With Flutter installed, run `flutter pub get`, `flutter analyze`, `flutter test` from `sdks/flutter` |
| Contracts/examples | `node contracts/check.mjs` and `node contracts/generate-examples.mjs --check` |

Public-reference checks need a built Web SDK. If they report missing or stale SDK output, run `npm ci --prefix sdks/web` and `npm run build --prefix sdks/web`. When deliberately changing the API reference or SDK snapshot, run `node control-plane/scripts/sync-public-reference.mjs` and include the corresponding source change.

For a PostgreSQL storage or isolation change, also run `bash scripts/check-postgres.sh` with Docker available. Web renderer changes should run `bash scripts/check-web-browser.sh` for real browser submission. Interface changes should run `bash scripts/check.sh`, which covers API/MCP/CLI parity. A change spanning all SDKs requires the matching [SDK matrix checks](sdks/README.md); maintainers can help with platforms you cannot run locally.

A prose-only change needs a careful read and working links, not the full build matrix. Mention checks you could not run and why. CI and maintainer review provide broader coverage before merge.

## Send a reviewable pull request

Explain the user problem, what changes and how you verified it. Link the issue when there is one. Include a screenshot for visible UI changes and a before/after request example for changed API behavior. Add tests for a new behavior or regression where they prove something useful.

Keep generated files paired with their source. Do not commit credentials, real survey responses, build directories or private validation evidence. Use synthetic examples and collection-scoped tokens in client code; never put management credentials in a browser or mobile bundle.

Maintainers review scope and compatibility, run relevant checks and may ask for a smaller change before merging. We do not promise response times. See the [maintainer workflow](docs/community/MAINTAINERS.md).

## License

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE). Preserve applicable third-party notices and attribute borrowed material. There is no separate contributor license agreement.
