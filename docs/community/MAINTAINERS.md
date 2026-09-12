# Maintainer workflow

This is the working process for the public repository. It records how to make decisions without promising response times or staffing levels.

## Triage

1. Check whether an issue contains a reproducible problem or a concrete user workflow. Ask for the smallest missing detail; avoid collecting real responses or credentials.
2. Link duplicates and existing work. Apply `bug`, `enhancement` or `documentation` as appropriate. Add `help wanted` when scope and acceptance criteria are ready for a contributor.
3. Use `good first issue` only when setup is small, behavior is specific and a maintainer can explain the relevant files. Architectural or security-sensitive tasks are not first issues merely because their descriptions are short.
4. For an accepted proposal, state the boundary, an example and the check that proves completion. When declining or deferring, explain why and link an alternative when available.

Move suspected vulnerabilities to the [private reporting process](../../SECURITY.md). Moderate behavior using the [Code of Conduct](../../CODE_OF_CONDUCT.md).

## Review and merge

Review user-visible behavior first, then implementation. Check the relevant contract, authorization, SDK and migration impact. Require focused evidence from the contributor and the repository's required CI checks. Maintain branch protection; investigate a failing check rather than bypassing it.

For visible UI changes, inspect desktop/mobile screenshots and exercise the changed interaction. For example apps, verify a clean installation and ensure browser bundles contain only collection-scoped configuration. For contract changes, inspect generated references and cross-interface parity.

Prefer a small pull request with a clear description. Preserve attribution when merging. Close or link the related issue only after its acceptance criteria are met; a partial example is not completed platform support.

## Release and communication

Record the actual commit, compatibility changes and verification performed. Build downloadable artifacts from that commit and publish checksums when distributing binaries. Do not describe historical preview archives as the current community edition. Native platform checks remain necessary for native SDK release claims.

Keep public product claims aligned with current code and evidence. The browser demo is local sample mode; it does not prove hosted authentication or response persistence. Do not claim customer adoption, service guarantees or package-store availability without evidence.

Publish announcements only when a maintainer explicitly chooses to do so. Adapt each draft to the destination's rules and be available to answer technical questions. See [launch drafts](LAUNCH-DRAFTS.md).
