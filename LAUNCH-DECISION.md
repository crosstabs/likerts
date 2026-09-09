# Launch decision — 9 September 2026

## Decision

**GO for an invite-only developer preview. HOLD public paid launch.**

The preview can onboard selected developers to the production control plane, grant 1,000 free accepted responses, create scoped credentials, operate the full platform through API/MCP/CLI, and install all five SDKs from checksummed direct downloads. Keep Stripe in test mode and do not promise an SLA during the preview.

Public paid launch begins only after the owner-controlled gates below pass. This is a launch decision, not a claim that those gates passed.

## Evidence that passes

- Production passwordless Clerk sign-in renders on `likerts.com` using verified custom domains; the development badge is absent.
- Render/Neon tenant isolation, restricted runtime roles, all 22 migrations, API/MCP health and unauthenticated denial pass.
- A production tenant-binding rehearsal allows the exact service-credential workspace and rejects a mismatched workspace through both direct API and MCP; tombstoning invalidates the credential through both paths.
- The hosted lifecycle passes scoped credential issue/revocation, survey publication, five-SDK collection, response retrieval, private Blob export/download, data deletion, export revocation and workspace tombstoning.
- A bounded production rehearsal sent 260 attempts, accepted exactly 211 unique responses against promotional credits, preserved zero paid exposure and verified cleanup. It is correctness and latency evidence, not a capacity or SLA claim.
- Stripe test mode passes a real US$5 checkout, exact 500-credit grant and full-refund reconciliation without changing the 1,000 promotional credits.
- Forty product capabilities have API/MCP/CLI parity across 53 registered HTTP routes.
- Five SDK archives and the CLI source bundle are public at `https://likerts.com/downloads/`; production-edge downloads match the published checksums, and the CLI installs from a fresh extraction.
- A production callback reached an independently deployed public HTTPS receiver in one attempt; exact-byte HMAC/timestamp verification passed, the payload contained only event and resource identifiers, and the receiver returned 204. The deployed worker separately rejected a hostname resolving to loopback before HTTP dispatch.
- The full local code/contract gate, Render infrastructure and role gates, control-plane gate, and migration-22 backup/restore rehearsal pass.

Evidence files: `infrastructure/render/hosted-evidence.json`, `infrastructure/render/hosted-lifecycle-evidence.json`, `infrastructure/render/hosted-refund-evidence.json`, `infrastructure/recovery/local-evidence.json`, and `releases/0.0.3/manifest.json`.

## Gates before public paid launch

| Gate | Required acceptance |
| --- | --- |
| Real identity journey | A fresh user completes production email OTP, workspace bootstrap, one-time grant, scoped credential creation, revocation and session/membership removal. Exercise recovery as well. |
| Customer agent journey | That user completes one real API call, CLI call, Codex MCP connection and Claude MCP connection. Provider OAuth remains unadvertised until consent, refresh and revocation pass. |
| Live payments | Activate Stripe live mode, confirm merchant and financial-retention requirements, then complete purchase, signed webhook, refund and reconciliation with live credentials. |
| Terms and support | Publish reviewed privacy, terms, refund/prepaid-credit and subprocessor language; name the support contact and incident owner. |
| Managed operations | Exercise Neon restore/PITR and cross-replica export recovery; deliver an actual alert; validate customer-owned DNS, adversarial callback behavior, enforced egress and expiry cleanup; record complete provider bills and a sustained load result. Compatible Render restoration, isolated failed-candidate rejection, one same-account public HTTPS callback and loopback-address denial already pass. |
| Client acceptance | Complete the declared browser/accessibility and supported native host/device matrix for all five launch SDKs. |
| Release automation | Restore GitHub Actions execution by resolving the repository owner's payment/spending-limit issue. Required checks currently do not start, although the same repository gates pass locally. |

Package-registry publication is a convenience gate after direct downloads; it is not required for the invite-only preview. It remains required before claiming normal npm, Maven, pub.dev or Swift registry installation.

## Preview claims

Use: “API-first, MCP-first customer-controlled survey collection. First 1,000 accepted responses free, then US$0.01 per accepted response from prepaid credits. Preview access; no SLA.”

Do not advertise live billing, completed OAuth integration, enterprise SSO, hosted survey links, email distribution, dedicated tenancy, production recovery objectives or package-registry availability.
