# Launch decision — reviewed 10 September 2026

## Decision

**Continue only a small, assisted developer preview after correcting the customer-flow and public-example defects. HOLD public paid launch.**

The preview's intended scope is selected developers using the production control plane, a 1,000-response grant, scoped credentials, API/MCP/CLI and all five SDKs from checksummed direct downloads. Fresh-user identity and real-client acceptance remain unproven; verify actual invitation enforcement before admitting the next cohort. Keep Stripe in test mode and do not promise an SLA during the preview.

The [10 September council review](docs/reviews/2026-09-10/CEO-REPORT.md) found stale checkout return paths after the `/app` split and invalid public CLI/API examples. [LAUNCH-TASKS.md](LAUNCH-TASKS.md) is the current execution queue. These findings are open; the review did not deploy fixes.

Public paid launch begins only after the owner-controlled gates below pass. This is a launch decision, not a claim that those gates passed.

## Evidence that passes

- Production passwordless Clerk sign-in renders on `likerts.com` using verified custom domains; the development badge is absent.
- The public marketing homepage and separate `/app` control plane are deployed on Vercel. Desktop/mobile layouts, navigation, MCP/CLI/API example switching, SDK downloads and the settled Clerk sign-in surface pass production browser verification.
- Render/Neon tenant isolation, restricted runtime roles, all 22 migrations, API/MCP health and unauthenticated denial pass.
- A production tenant-binding rehearsal allows the exact service-credential workspace and rejects a mismatched workspace through both direct API and MCP; tombstoning invalidates the credential through both paths.
- The hosted lifecycle passes scoped credential issue/revocation, survey publication, acceptance of a five-SDK capability declaration, one response submission/retrieval, private Blob export/download, data deletion, export revocation and workspace tombstoning. All-five-SDK execution is recorded locally; hosted supported-device acceptance remains open.
- Hosted same-team SDK proofs now include released Web SDK 0.0.3 in a real browser, plus Android, iOS, React Native Android and Flutter Android native hosts. Each target records exactly one accepted production API response, one promotional debit, zero paid exposure and cleanup. Direct hosted browser CORS, independent customer onboarding, physical devices and the full browser/accessibility matrix remain open.
- A bounded 10-minute production rehearsal dispatched 2,954 submission requests across four disposable workspaces at 4.92 delivered requests/sec, accepted 2,660 unique responses against promotional credits, returned 148 invalid requests as 400, completed two private exports, preserved zero paid exposure and verified cleanup. It is developer-preview capacity evidence, not a public SLA or max-throughput claim.
- Stripe test mode passes a real US$5 checkout, exact 500-credit grant and full-refund reconciliation without changing the 1,000 promotional credits. This used an unclaimed Stripe sandbox account and no real funds.
- Forty product capabilities have API/MCP/CLI parity across 53 registered HTTP routes.
- Five SDK archives and the CLI source bundle are public at `https://likerts.com/downloads/`; production-edge downloads match the published checksums, and the CLI installs from a fresh extraction.
- A production callback reached an independently deployed public HTTPS receiver in one attempt; exact-byte HMAC/timestamp verification passed, the payload contained only event and resource identifiers, and the receiver returned 204. The deployed worker separately rejected a hostname resolving to loopback before HTTP dispatch, refused a 307 without following it, and queued the documented retry after a 10-second receiver timeout. With two live workers, 20 simultaneous events produced exactly 20 unique one-attempt deliveries and verifier requests; the normal one-worker configuration was restored. A timestamped restart replaced that worker during an eight-second receiver request, and graceful drain completed the original lease once with 204. A synchronized restart at Render's one-second minimum still drained the request, so abrupt lease reclaim remains unproved and the 30-second production grace was restored.
- The full local code/contract gate, Render infrastructure and role gates, control-plane gate, and migration-22 backup/restore rehearsal pass.
- ID-only erasure archive source code, migration, restricted-role bootstrap/provisioning and verifier tests pass locally. No private Blob provider run, Neon PITR restore, recovery replay or source-fence maintenance drill has been executed.

Evidence files: `infrastructure/render/hosted-evidence.json`, `infrastructure/render/hosted-lifecycle-evidence.json`, `infrastructure/render/hosted-refund-evidence.json`, `infrastructure/render/hosted-native-ledger-evidence.json`, `infrastructure/render/hosted-web-ledger-evidence.json`, `infrastructure/render/hosted-sandbox-checkout-evidence.json`, `infrastructure/render/hosted-sustained-evidence.json`, `infrastructure/recovery/local-evidence.json`, and `releases/0.0.3/manifest.json`.

## Gates before public paid launch

| Gate | Required acceptance |
| --- | --- |
| Real identity journey | A fresh user completes production email OTP, workspace bootstrap, one-time grant, scoped credential creation, revocation and session/membership removal. Exercise recovery as well. |
| Customer agent journey | That user completes one real API call, CLI call, Codex MCP connection and Claude MCP connection. Provider OAuth remains unadvertised until consent, refresh and revocation pass. |
| Live payments | Activate Stripe live mode, confirm merchant and financial-retention requirements, then complete purchase, signed webhook, refund and reconciliation with live credentials. |
| Terms and support | Publish reviewed privacy, terms, refund/prepaid-credit and subprocessor language; name the support contact and incident owner. |
| Managed operations | Exercise Neon restore/PITR and cross-replica export recovery; deliver an actual alert; validate customer-owned DNS, adversarial callback behavior, enforced egress and expiry cleanup; record complete provider bills. Compatible Render restoration, isolated failed-candidate rejection, bounded sustained hosted load, same-account public HTTPS callbacks, loopback-address denial, redirect refusal, timeout retry scheduling, two-worker exact delivery and graceful in-flight restart already pass. |
| Client acceptance | Complete the declared browser/accessibility and supported native host/device matrix for all five launch SDKs. Same-team hosted Web/native proofs reduce technical risk but do not replace independent customer acceptance. |
| Release automation | Restore GitHub Actions execution by resolving the repository owner's payment/spending-limit issue. Required checks currently do not start, although the same repository gates pass locally. |

Package-registry publication is a convenience gate after direct downloads; it is not required for the invite-only preview. It remains required before claiming normal npm, Maven, pub.dev or Swift registry installation.

## Preview claims

Use: “API-first, MCP-first customer-controlled survey collection. First 1,000 accepted responses free, then US$0.01 per accepted response from prepaid credits. Preview access; no SLA.”

Do not advertise live billing, completed OAuth integration, enterprise SSO, hosted survey links, email distribution, dedicated tenancy, production recovery objectives or package-registry availability.
