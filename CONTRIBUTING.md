# Contributing to Likerts

Help improve shared gameplay, quiz creation, accessibility or a reproducible bug. Search existing issues and use synthetic players and quizzes. Keep credentials, private room access, personal answers, build products and databases out of issues and commits. Follow the [Code of Conduct](CODE_OF_CONDUCT.md); security reports use the [private reporting path](SECURITY.md).

Use Node 22.23.4 for browser/server work. From `game/WebSource/live-game`, run `npm ci` and `npm test`. An explicit disposable PostgreSQL test URL enables integration cases; follow the game README. From `control-plane`, run `npm ci` and `npm run check` for website changes. Native development uses `game/NativeSource/Likerts.xcodeproj` and the shared fixtures beside it.

Use focused checks appropriate to your change. Gameplay changes should exercise both host and player, correct/wrong/missing answers, reveal, recovery and confirmed Leave/Close. Rendered UI changes should be inspected at mobile and desktop widths, including reduced motion and readable text sizes. State checks that were not run. Never run destructive tests against a real room or production database.

A pull request should explain the user problem, changed behavior and relevant verification. Include screenshots for visual changes and a concrete reproduction for regressions. Keep the existing required CI checks meaningful; do not weaken branch protection to make a change pass.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE). Preserve applicable third-party notices and asset attribution. Publishing code does not authorize paid provider, signing, DNS or production-data changes.
