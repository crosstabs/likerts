# Likerts launch execution queue

Updated 10 September 2026 after the [CEO council review](docs/reviews/2026-09-10/CEO-REPORT.md). This is the current execution order; [TASKS.md](TASKS.md) retains implementation history and detailed requirements. Department reports are supporting evidence, not additional parallel backlogs.

**Release state: assisted preview, subject to the immediate fixes below; public paid launch on hold.** Task acceptance remains open unless checked below; implementation progress and actual provider/runtime evidence are tracked in [the execution record](docs/reviews/2026-09-10/EXECUTION.md). Scope remains all five SDKs, API/MCP/CLI, customer-controlled distribution, 1,000 one-time free responses and prepaid US$0.01 accepted responses. No new enterprise or distribution features are required.

P0 = fix before opening the affected path to the next external preview user. P1 = required for the public paid release. P2 = adoption improvements or separately gated capabilities. Role owners are proposed workstream accountability, not named staffed teams. Effort is focused person-days, excludes external waiting, overlaps between related tasks and must not be added into a promised launch date.

## P0 — Repair and prove first use

- [x] **L01 — Correct public examples and promises** · Developer relations + marketing · **0.5–1 day**
  - Use real schema/request fixtures and exact CLI commands; label abbreviated illustrations, and replace the unsupported conditional example. Remove “live” from a static illustration or implement a real demo. Make preview/access conditions visible beside the main CTA. State US$ and define one response as one accepted survey submission; explain retry/reject charging and zero-balance behavior. Remove unapproved expiry and unsupported client/accessibility claims.
  - **Done:** exact API/CLI examples execute against the released contract; copy review finds no unsupported feature or availability claims. Relabel the configuration-only status link until L12 supplies real monitoring.
  - **Evidence:** commit `15dbdf3`, production deployment `dpl_6CyEaEp9g1o5y5LPZFB2Ze6SCQV8`, [public-site acceptance](docs/reviews/2026-09-10/PUBLIC-SITE-ACCEPTANCE.md), hosted CLI/Web evidence and `npm --prefix control-plane test` prove the corrected public examples, SDK demo contract, preview/pricing copy, download metadata and “Service checks” status label. This closes public-example accuracy only; it does not close first-user onboarding, L05 independent-docs success or L12 incident monitoring.
  - **Depends:** existing contracts; the independent admission inspection at the start of L04. Unapproved promises can be removed immediately; later commercial wording uses L06A decisions. **Maps:** IF-01, REL-02/03.

- [ ] **L02 — Repair checkout return and settlement states** · Frontend + billing · **1–2 days**
  - Send success/cancel to `/app`; derive pending/settled/failed states from the server, not a query parameter. Refresh credits after settlement and clearly label or gate sandbox checkout.
  - **Done:** cancellation, delayed webhook, refresh/retry and a US$5 test purchase show correct states and exactly 500 purchased credits once; spoofed success query cannot claim payment. Verify post-sign-in routing with L04. Preserve independent ledger guarantees.
  - **Depends:** deployed console and Stripe sandbox. **Maps:** BILL-02, REL-01.

- [ ] **L03 — Restore CI and release checks** · Release engineering + repository billing owner · **0.5–1 day after account unblock**
  - Resolve GitHub's payment/spending block; run required jobs on the reviewed change and configure enforcement for promotion.
  - **Done:** actual executed green jobs, final commit SHA and run links are recorded; empty/unstarted jobs cannot count as passing.
  - **Depends:** owner-controlled GitHub billing. **Maps:** OPS-01.

- [ ] **L04 — Verify admission and real identity/client onboarding** · Identity + QA + founder · **1–3 days plus provider fixes**
  - First inspect provider admission independently of other tasks; keep assisted preview as the current policy and enforce admission if needed. Run `release/acceptance/` with a fresh controlled inbox using existing valid contract fixtures. Verify OTP, recovery, `/app` redirect, single 1,000 grant, relogin, scope denial, credential revoke and live-session membership removal. Connect actual API, CLI, Codex and Claude Code using the documented supported authentication path.
  - **Done:** redacted human/client evidence, one real accepted response/retrieval/export and cleanup; denied/revoked access takes effect and no grant resurrection occurs. Mark service-token evidence separately from OAuth.
  - **Depends:** admission inspection has no task dependency; complete routing acceptance after L02, using a controlled inbox and real clients. External cohort opening also requires L01/L05/L06A. **Maps:** ID-01/02, BILL-01, REL-01.

- [ ] **L05 — Publish onboarding docs and make credentials usable** · Developer relations + product/frontend · **2–4 days**
  - Link public docs from homepage, app and downloads. Provide five install guides and a canonical create → publish → collection → embed → receipt → retrieve/export → delete path. Explain origins, installed SDK capability declarations, errors, idempotency, safe retries and native offline storage duties. Publish API reference and workspace-specific API/CLI/Codex/Claude Code setup.
  - Offer clear scope presets with destructive permissions explicitly selected, visible scope/expiry, copy fallback and recoverable revoke errors. Use Likerts branding and explain the next step in the console. Gate unaccepted OAuth UI.
  - **Done:** a developer outside the implementation team reaches a first hosted response from public docs without repository access or verbal help; record time and friction. Exact snippets match the shipped version.
  - **Depends:** L01/L04; existing source docs/artifacts. **Maps:** ID-02, SDK-03, REL-01.

- [ ] **L06 — Approve trust, preview terms and support ownership** · Founder/business owner + legal + product · **1–2 publication days after decisions**
  - **L06A — Early decisions:** resolve owner facts in `docs/legal/`: entity/jurisdiction, data roles, intended retention, credit expiry/refunds, financial records and monitored contacts. Assign incident owner/backup and feasible support coverage. Approve and publish the applicable preview notice/terms/contact route before new external preview data. Approve commercial decisions before the controlled live-payment acceptance. This stage can proceed without the operational drills.
  - **L06B — Final publication:** replace verification fields using actual provider and L09–L12 evidence; approve and publish the complete commercial policy set before external paid access. Do not promise unverified retention, recovery or support capabilities.
  - **Done:** approved, versioned policy set and closure/support instructions are linked publicly and match checkout/pricing; no placeholders or invented approval. Provider/data promises are supported by evidence. Test the selected contact routes.
  - **Depends:** L06A requires real owner/legal facts only; L06B follows relevant L09–L12 evidence and is enforced at L15. **Maps:** REL-03, BILL-02. This staged gate does not permit publishing unresolved drafts.

## P1 — Required before public paid launch

- [ ] **L07 — Accept all five SDKs on declared hosts** · SDK leads + QA · **4–7 person-days across platforms**
  - Freeze the supported browser/OS/framework matrix; run independent customer host apps against the hosted service for Web, React Native, iOS, Android and Flutter. Cover renderer/navigation, advanced questions, cancellation, retry, accessibility, localization and app lifecycle. Exercise real secure offline adapters, restart and backup exclusion on native targets.
  - **Done:** versioned results and limitations for every claimed surface; local clean-consumer checks and hosted declarations are not substituted for runtime evidence. Keep all five surfaces; narrow unsupported version claims if necessary.
  - **Depends:** L04/L05, devices/runtimes. **Maps:** SDK-WEB/RN/IOS/ANDROID/FLUTTER, REL-01.

- [ ] **L08 — Finish credit visibility and abuse controls** · Billing + identity/security + product · **2–4 days**
  - Show promotional/paid balances, blocking reason and thresholds. Deliver specified 80/90/100% owner notifications through the agreed channel; demonstrate zero-balance pause and recovery. Define thresholds clearly for top-ups/refunds. Bound invalid/unauthorized work across replicas and control duplicate-identity grant abuse; do not infer unique people from unique accounts.
  - **Done:** observed notifications, denied abuse scenarios without charges/regrants, and idempotent final-credit behavior with honest customer messaging. No silent debt or automatic charging.
  - **Depends:** L04, approved notification/support channel from L06A, monitoring from L12. **Maps:** BILL-01, SEC-01.

- [ ] **L09 — Accept live billing and financial reconciliation** · Billing + merchant owner · **2–3 days plus activation/review**
  - Complete sandbox late/out-of-order/refund/dispute acceptance. Activate the real merchant, confirm applicable tax/invoice/financial-retention treatment, then conduct an authorized live purchase/refund and signed-event reconciliation.
  - **Done:** live-mode evidence links charge, webhook, purchased balance, refund and ledger; promotional and gross usage records remain correct. Customer-facing mode is accurate. Do not manufacture a real dispute for testing.
  - **Depends:** L02/L06A/L08, owner merchant activation and live-payment authority. This is a controlled acceptance transaction; external paid access waits for L06B/L15. **Maps:** BILL-02, REL-01/03.

- [ ] **L10 — Prove managed restore, deletion and export recovery** · Operations + backend · **3–5 days**
  - Run quarantined Neon restore/PITR with independently durable deletion replay, credential/collection/export quarantine, provider/credit reconciliation and isolation rechecks. Verify configured retention and measure recovery bounds. Force actual API loss during export and replacement on another replica; prove fencing, expiry and orphan cleanup.
  - **Done:** restored service cannot resurrect deleted data or access; reconciliation completes before traffic resumes. Record measured recovery time/loss and hard-failure export evidence. Graceful drain does not satisfy abrupt failure.
  - **Depends:** owner Marketplace verification, isolated recovery resources and bounded exercise budget. **Maps:** OPS-03, DATA-02/03.

- [ ] **L11 — Finish callback failure and outbound-network acceptance** · Backend + operations · **2–3 days**
  - Exercise customer-controlled DNS, dynamic rebinding, deployed outbound enforcement and abrupt worker loss with fenced lease reclaim. Verify revoked queues cannot restart after restore; preserve completed HMAC, redirect, timeout and two-worker evidence.
  - **Done:** adverse hosted tests and delivered alerts pass; documentation states receiver event-ID deduplication and does not promise exactly-once delivery under failures.
  - **Depends:** controlled DNS/receiver, failure controls, L10/L12. **Maps:** LATER-01, OPS-01.

- [ ] **L12 — Activate operations, audit and incident response** · Operations + security + support owner · **2–4 days**
  - Monitor deployed API/DB/worker/export dependencies and missing-monitor signals; deliver an alert to a real responder. Update stale AWS runbooks to Render/Neon. Review provider access, support break-glass, denied-operation audit coverage, safe log drains and credential/key rotation. Provide a truthful public status surface if one is linked.
  - **Done:** responder acknowledges the drill; failure and recovery are visible; selected rotation/revocation succeeds without leaking tokens or survey answers; owner and backup can follow the current runbook. A config JSON response or parsed alert rules are insufficient.
  - **Depends:** L06A contacts and provider access. **Maps:** SEC-02, OPS-03, REL-03.

- [ ] **L13 — Establish capacity and real unit costs** · Performance + finance/product · **2–3 days plus billing observation**
  - Run agreed bounded sustained load across actual replicas with exports, callbacks and invalid traffic. Reconcile accepted/retry/usage counts, latency and throttling. Collect complete provider and processor costs and model grant consumption, conversion, abuse and support effort.
  - **Done:** reproducible measured limits and a cost range with exclusions; no extrapolated SLA or unsupported margin claim. Replace estimates with bills as available and label residual assumptions.
  - **Depends:** L08/L12, owner billing exports and test ceiling. **Maps:** DEC-04, OPS-02.

- [ ] **L14 — Observe independent activation and preview learning** · Product + marketing + founder · **1–2 implementation days plus observation**
  - Define privacy-reviewed visit/docs → signup → credential → first accepted response → repeat use → top-up metrics, with denominators and staff/test exclusion. Confirm existing provider analytics before adding tooling; never collect survey answers/secrets in funnel events.
  - **Done:** three independent developers complete documented first use; record actual time, drop-offs and support load. Target five relevant design partners for post-action web/mobile feedback and document willingness-to-pay learning. Three testers and five partners are proposed learning targets, not evidence of demand or permission to contact anyone.
  - **Depends:** L04/L05/L06A; founder-authorized outreach or existing opted-in testers. **Maps:** PRICING.md measurement requirement.

- [ ] **L15 — Reconcile evidence and take the release decision** · Chief engineer + product + QA · **0.5–1 day after prerequisite gates**
  - Fix stale schema/setup/acceptance documentation and retain local/hosted/human boundaries. On the actual release revision, rerun affected checks, confirm capability parity and perform the complete customer release rehearsal. Link CI, runtime, policy and operational evidence; close legacy requirements only at their true boundary.
  - **Done:** P0/P1 acceptance is complete and public claims match evidence; an explicit public-paid go/no-go decision names accountable owners and support limits. No “launch ready” declaration based only on artifacts or local tests.
  - **Depends:** L01–L14. **Maps:** IF-01, REL-01/02, DEC-04. The hosted five-SDK wording is corrected now in LAUNCH-DECISION; remaining documentation reconciliation is still open.

## P2 — Adoption and separately gated capability work

- [ ] **L16 — Publish normal package installs and prebuilt CLI** · Release + SDK leads · **2–4 days plus registry access**. Establish namespace ownership, publish coordinated packages/binaries and verify clean installations, versions and rollback. Keep checksummed downloads working. **Depends:** L03/L07, registry credentials. **Maps:** SDK-03. Required before advertising those installation paths.
- [ ] **L17 — Add proof-led discovery assets** · Marketing + developer relations · **2–4 days**. Add branded favicon/social metadata/canonical/crawler setup; build a clearly labeled working demo from the released SDK and a reproducible use-case tutorial. Publish customer stories only with evidence and permission. **Depends:** L05/L07/L14 and approved demo data handling. Measure activation before broad acquisition spending.
- [ ] **L18 — Complete provider OAuth acceptance** · Identity + integrations · **Estimate after provider configuration review**. Prove consent/custom scopes, audience/client binding, refresh-family revocation, signing-key rotation and supported real-client flows; document token storage/recovery. **Depends:** provider/client configuration and controlled identities. **Maps:** remaining ID-02. Remains unadvertised until accepted; verified scoped service credentials are the initial supported integration path. Reclassify as a launch blocker if OAuth is included in the advertised release offer.

## Starting order and external dependencies

Start L01/L02/L03 and prepare L05 immediately. In parallel, obtain L06 business decisions and the owner account/inbox access for L04/L10. Once real first use passes, L07 and operational work L10–L13 can progress independently; L09 follows commercial approval. Run L14 with the corrected experience; L15 is the final release gate.

Owner dependencies are finite: controlled inbox/real agent clients, GitHub payment setting, Neon account verification, merchant/legal decisions, monitored contacts/responders, device access and bounded test/billing data. Prepare concrete implementation and rehearsals before requesting any final approval. Do not treat external waiting as a reason to stop independent engineering work.
