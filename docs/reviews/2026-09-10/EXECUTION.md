# Launch execution — 10 September 2026

This supplements the council audit with implementation and verification evidence. It is not a public-paid launch approval. Source changes in this report are not deployed until the deployment record names their revision.

## Implemented and locally verified

- Homepage claims and executable examples corrected; invitation-only preview, US$0.01 accepted-response unit and test payments explicit. Public quickstart, five SDK install guides, API reference, real released-Web-SDK sample demo, social image, favicon and crawler metadata added.
- Workspace checkout returns to `/app`; paid state comes from authenticated server records. Pending/cancel/failure/retry handling, sandbox labels, safe scope presets, one-time credential handling and workspace-specific API/CLI/Codex/Claude Code setup added. Eleven focused workspace tests passed.
- Management checkout lookup extends API/MCP/CLI parity to 41 capabilities, 55 registered routes and 75 schemas. Focused restricted-role credit, HTTP scope/tenant and MCP tests passed.
- OAuth/browser JWKS refreshes are coalesced and rate-bounded, and key downloads bounded. Unknown-key flooding, concurrent refresh, upstream failure and oversized response tests passed.
- Opt-in signed credit depletion events (80/90/100) use separate promotional/paid generations, transactional outbox, no response content or balance amounts, least-privilege grants and tenant isolation. Migration 0023 has passed restricted-runtime and Render-compatible non-superuser owner gates; hosted delivery is pending. Full rebuilt container/recovery passed all23 migrations, quarantined both event types and verified forced tenant isolation; the1.803s local fixture restore is not managed PITR evidence.
- Public dependency-status endpoint/page and authenticated responder webhook monitor implemented. Six focused tests and a live read-only API/MCP/Clerk-key probe passed. No responder or schedule is configured; this is not full operational monitoring.
- CLI 0.1.2 source and Apple Silicon macOS binary packaged with SHA-256 checksums; native fresh extraction, a separate fresh Cargo source install, version and 41-operation inventory verified. It is unsigned/not notarized. Registry publication remains separate.

## Provider actions actually performed

- Production Clerk admission changed from Open to Invite-only; dashboard confirmed saved mode. Application display name changed from `likerts-auth` to `Likerts` and saved. Email OTP required/verified configuration inspected. No production user or invitation was created; inbox delivery and real first sign-in remain unverified.
- Read-only GitHub billing inspection found the organization Actions US$10 hard budget fully consumed. Recent workflow jobs did not execute. Raising the cap requires the pending owner spending decision.
- Vercel Neon resource detail shows Launch plan. Neon SSO requests account-link email verification; managed restore controls and recovery window remain inaccessible until verified. No managed restore was performed.

## Runtime evidence

| Surface | Result | Evidence boundary |
| --- | --- | --- |
| Android | Six API35 instrumented tests passed after correcting the test host scrolling and adding two secure offline tests. | Required validation, visible advanced controls, exact answer map, exactly one completion and actual Keystore/AES-GCM durable noBackup storage; SDK runtime unchanged. |
| React Native Android | Real RN0.86.3 / React19.2.3 / Hermes host passed twice. | Native validation/ranking/matrix/allocation and exact answer map; no mocked renderer, no hosted-network or physical-device claim. |
| React Native iOS | Real RN0.86.3/Hermes native XCTest host passed on iOS26.4. | Native controls, keyboard, required validation and exact answer map; no hosted networking or physical-device claim. |
| iOS | Three iOS26.4 simulator tests passed. | Localized/accessibility UI plus two actual Keychain/CryptoKit secure-offline tests; not all deployment targets, physical devices or backup restore. |
| Flutter iOS | iOS26.4 simulator integration test passed. | Required error and full rendered completion. |
| Web/public | Local actual-SDK demo required validation and synthetic receipt passed; homepage inspected. | Demo makes no hosted response and consumes no credit. Mobile390×844 API operation filtering has no document overflow; final deployment QA remains in progress. |

Native host source and versioned evidence files retain their exact procedures. Ephemeral local logs: `/tmp/likerts-android-acceptance-fixed.log`, `/tmp/likerts-rn-native-acceptance.log`, `/tmp/likerts-flutter-ios-acceptance.log`; RN screenshot `/tmp/likerts-rn-native-pass.png`. These files are not public launch artifacts.

## Hosted client checks

The packaged CLI0.1.2 Apple Silicon archive executed the public quickstart fixtures against the hosted API: create/publish/collection, one accepted response, identical retry/one debit, retrieval, read-only scope denial, private export and sample-response deletion. [Aggregate evidence](../../../infrastructure/render/hosted-cli-012-evidence.json). A scoped synthetic service credential connected from actual Codex CLI0.154.0 with GPT-6Astra and invoked `usage_get`; no other tool ran. The installed0.152.0 client was too old for that model. Claude Code2.1.201 reached its local authentication gate and requires sign-in. These checks do not prove fresh human OTP onboarding; synthetic workspace/credential cleanup is tracked separately.

## Still in execution

Current source integration, recovery gate, RN iOS/runtime adapters, final public browser QA, hosted deployment/lifecycle, actual signed credit notifications, sustained workload and real-client acceptance. The main queue remains open until each task’s complete acceptance condition is evidenced.

## Pending owner-controlled inputs

Legal entity/jurisdiction and commercial decisions; monitored support/privacy/security contacts and incident responders; controlled OTP inbox; GitHub Actions spending cap; Neon account linking; live merchant activation/authorized payment acceptance; package-registry ownership; independent testers/design partners. Requests are pending in this task. No assumed answers, invented policy approval or simulated customer evidence count as completion.
