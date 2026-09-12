# Launch execution — 10 September 2026

This supplements the council audit with implementation and verification evidence. It is not a public-paid launch approval. Source changes in this report are not deployed until the deployment record names their revision.

## Implemented and locally verified

- Homepage claims and executable examples corrected; invitation-only preview, US$0.01 accepted-response unit and test payments explicit. Public quickstart, five SDK install guides, API reference, real released-Web-SDK sample demo, social image, favicon and crawler metadata added.
- Workspace checkout returns to `/app`; paid state comes from authenticated server records. Pending/cancel/failure/retry handling, sandbox labels, safe scope presets, one-time credential handling and workspace-specific API/CLI/Codex/Claude Code setup added. Eleven focused workspace tests passed.
- Management checkout lookup extends API/MCP/CLI parity to 41 capabilities, 55 registered routes and 75 schemas. Focused restricted-role credit, HTTP scope/tenant and MCP tests passed.
- OAuth/browser JWKS refreshes are coalesced and rate-bounded, and key downloads bounded. Unknown-key flooding, concurrent refresh, upstream failure and oversized response tests passed.
- Opt-in signed credit depletion events (80/90/100) use separate promotional/paid generations, transactional outbox, no response content or balance amounts, least-privilege grants and tenant isolation. Migration 0023 has passed restricted-runtime and Render-compatible non-superuser owner gates; hosted delivery is pending. Full rebuilt container/recovery passed all23 migrations, quarantined both event types and verified forced tenant isolation; the1.803s local fixture restore is not managed PITR evidence.
- Public dependency-status endpoint/page and authenticated responder webhook monitor implemented. Six focused tests and a live read-only API/MCP/Clerk-key probe passed. No responder or schedule is configured; this is not full operational monitoring.
- Private monitor hardening now requires an explicit armed flag, responder ID, exact HTTPS receiver origin, durable Upstash state, a missing-run heartbeat endpoint and bounded admission usage probing. Control-plane tests cover the armed/unarmed paths, alert delivery, recovery events and secret redaction. No real responder has acknowledged a drill.
- ID-only erasure archive migration and restricted archiver role tooling were added behind an explicit maintenance fence. The Rust verifier now has focused tests for fenced checkpoint chains, release invalidation, duplicate event rejection and missing-object refusal. No provider Blob store, Neon PITR or managed restore drill has run for this path.
- CLI 0.1.2 source and Apple Silicon macOS binary packaged with SHA-256 checksums; native fresh extraction, a separate fresh Cargo source install, version and 41-operation inventory verified. It is unsigned/not notarized. Registry publication remains separate.

## Provider actions actually performed

- Production Clerk admission changed from Open to Invite-only; dashboard confirmed saved mode. Application display name changed from `likerts-auth` to `Likerts` and saved. Email OTP required/verified configuration inspected. No production user or invitation was created; inbox delivery and real first sign-in remain unverified.
- Read-only GitHub billing inspection found the organization Actions US$10 hard budget fully consumed. On 2026-09-12, the required push and pull-request workflows created `interfaces-and-database` and `container` check runs for commits `0bc8f22`, `15dbdf3` and `812257b`, but each job failed within seconds with zero steps and no downloadable logs. The latest pull-request run is `34685861660`: `container` job `103532622147` and `interfaces-and-database` job `103532622213` both completed failed from 09:26:41Z to 09:26:43Z with no steps. GitHub org Actions policy/billing API access returned an org-admin permission requirement from this account, so raising or repairing the owner-controlled runner/spending state remains required before L03 can close.
- Vercel Neon resource detail shows Launch plan. Neon SSO requests account-link email verification; managed restore controls and recovery window remain inaccessible until verified. No managed restore was performed.

## Runtime evidence

| Surface | Result | Evidence boundary |
| --- | --- | --- |
| Android | Six API35 instrumented tests passed after correcting the test host scrolling and adding two secure offline tests. | Required validation, visible advanced controls, exact answer map, exactly one completion and actual Keystore/AES-GCM durable noBackup storage; SDK runtime unchanged. |
| React Native Android | Real RN0.86.3 / React19.2.3 / Hermes host passed twice. | Native validation/ranking/matrix/allocation and exact answer map; no mocked renderer, no hosted-network or physical-device claim. |
| React Native iOS | Real RN0.86.3/Hermes native XCTest host passed on iOS26.4. | Native controls, keyboard, required validation and exact answer map; no hosted networking or physical-device claim. |
| iOS | Three iOS26.4 simulator tests passed. | Localized/accessibility UI plus two actual Keychain/CryptoKit secure-offline tests; not all deployment targets, physical devices or backup restore. |
| Flutter iOS | iOS26.4 simulator integration test passed. | Required error and full rendered completion. |
| Web/public | Local actual-SDK demo required validation and synthetic receipt passed; homepage inspected. Hosted browser acceptance passed on 2026-09-12 using the released Web SDK 0.0.3 through a localhost-only proxy to the production API. | Demo makes no hosted response and consumes no credit. Hosted proof covers one required scale question, empty-submit validation, one accepted receipt, identical retry/same response ID, one promotional debit and cleanup. Direct hosted browser CORS, independent customer activation and the broader browser/accessibility matrix remain open. |

Native host source and versioned evidence files retain their exact procedures. Ephemeral local logs: `/tmp/likerts-android-acceptance-fixed.log`, `/tmp/likerts-rn-native-acceptance.log`, `/tmp/likerts-flutter-ios-acceptance.log`; RN screenshot `/tmp/likerts-rn-native-pass.png`. These files are not public launch artifacts.

## Hosted client checks

The packaged CLI0.1.2 Apple Silicon archive executed the public quickstart fixtures against the hosted API: create/publish/collection, one accepted response, identical retry/one debit, retrieval, read-only scope denial, private export and sample-response deletion. [Aggregate evidence](../../../infrastructure/render/hosted-cli-012-evidence.json). A scoped synthetic service credential connected from actual Codex CLI0.154.0 with GPT-6Astra and invoked `usage_get`; no other tool ran. The installed0.152.0 client was too old for that model. Claude Code2.1.201 reached its local authentication gate and requires sign-in. These checks do not prove fresh human OTP onboarding; synthetic workspace/credential cleanup is tracked separately.

Hosted Web/native/sustained evidence added after the original report:

- [Native hosted ledger evidence](../../../infrastructure/render/hosted-native-ledger-evidence.json): Android API35, iOS 26.4, React Native 0.86.3/Hermes Android, and Flutter 3.47.2 Android each reached exactly one accepted production API response with one promotional debit, zero paid usage/exposure and cleanup. Same-team synthetic host proof, not independent customer onboarding.
- [Web hosted ledger evidence](../../../infrastructure/render/hosted-web-ledger-evidence.json): released Web SDK 0.0.3 mounted in a real browser, required validation blocked empty submission, rating `5` accepted once, identical retry returned the same response ID, ledger stayed at one accepted/promotional debit and the disposable workspace was tombstoned.
- [Sustained hosted evidence](../../../infrastructure/render/hosted-sustained-evidence.json): 10-minute bounded run across four disposable workspaces completed 2,954 dispatched submission requests at 4.92 delivered requests/sec, with 2,660 unique accepted receipts, 148 invalid 400s, two private exports, zero paid exposure and cleanup verified. This is bounded preview rehearsal evidence, not a public capacity/SLA claim.
- [Sandbox checkout evidence](../../../infrastructure/render/hosted-sandbox-checkout-evidence.json): actual Stripe test checkout for US$5 granted 500 purchased credits, signed webhook reconciliation succeeded, repeated server reads stayed stable, and an actual test refund returned paid credits to zero while promotional credits remained intact. Stripe live mode, merchant activation, tax/invoice treatment and human owner checkout remain open.

## Still in execution

Current source integration after the latest footer-label change, recovery gate provider execution, final public browser QA after the next Vercel deployment, real responder alerting, customer-owned DNS/adverse callback drills, live billing, real-client onboarding and independent activation. The main queue remains open until each task’s complete acceptance condition is evidenced.

## Pending owner-controlled inputs

Legal entity/jurisdiction and commercial decisions; monitored support/privacy/security contacts and incident responders; controlled OTP inbox; GitHub Actions spending cap; Neon account linking; live merchant activation/authorized payment acceptance; package-registry ownership; independent testers/design partners. Requests are pending in this task. No assumed answers, invented policy approval or simulated customer evidence count as completion.
