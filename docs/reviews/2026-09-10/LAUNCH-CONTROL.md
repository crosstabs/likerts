# Likerts launch control report

Updated 12 September 2026. This is the operating report for the CEO, chief engineer, chief product officer and onboarding/marketing owner. It converts the launch queue into concrete owner actions and engineering gates. It does not approve public paid launch.

## Current call

**Ship posture: invite-only developer preview only. Public paid launch remains on HOLD.**

The product can credibly say: API-first and MCP-first customer-controlled collection; no hosted survey links or distribution; first 1,000 accepted responses free; then US$0.01 per accepted response from prepaid credits; preview access; no SLA. The platform now has production API/MCP health, hosted same-team Web/native proofs, sandbox checkout/refund evidence, bounded load evidence and direct-download artifacts. The open risk is not the core concept. The open risk is proving real humans, real provider accounts, real operational response, real package distribution and owner-approved legal/commercial terms.

## What changed in the latest execution pass

- Production Render migration base deployed at commit `120f1227555b5701a373fca4a738e1b743c94ad6` as `dep-daihp8m7bikc738nfpm0`.
- Production one-off migration/provision job `job-daihrh67bikc738nojd0` ran `/bin/sh /opt/likerts/render/migrate.sh` and succeeded from 09:39:16Z to 09:39:25Z on 12 September 2026.
- Production API deployed at `120f1227555b5701a373fca4a738e1b743c94ad6` as `dep-daihrmp5efls73djicd0` and returned `GET /health` with PostgreSQL storage healthy.
- Production MCP gateway deployed at the same commit as `dep-daihrn67bikc738npbj0` and returned `GET /health` healthy.
- Production callback worker deployed at the same commit as `dep-daihrmp5efls73djicc0`.
- Public marketing/control-plane site deployed from commit `986013fe5022870370ae8aa0fe39449eb9d1a693` as Vercel production deployment `dpl_ED5QvF8btmaGeBh6qxRjU3p46F8S`, aliased to `https://likerts.com`; live copy verification found the revised hero, pricing and service-check labels present, with the old overclaim strings absent.
- Current GitHub required checks still fail before running steps on the latest commit: runs `34686752214` and `34686750491`; both `interfaces-and-database` and `container` jobs show zero steps. This remains an owner-controlled GitHub Actions/billing/policy gate.

## CEO view

The business can run a small assisted preview with selected developers, but should not open public self-serve paid usage yet. The preview should measure first-value friction and validate the 1-cent response promise under real onboarding. The founder must supply legal entity facts, support/privacy/security contacts, a controlled test inbox, merchant authority, package namespace access, and explicit outreach permission before the next external cohort.

The launch claim should stay narrow: “bring your own app, agent or SDK; we collect and meter accepted responses.” Do not sell enterprise isolation, SSO, hosted survey links, email sending, SOC 2, SLA, live billing, OAuth app consent or package-registry installs until their gates are closed with evidence.

## Chief engineer view

The platform architecture is viable for the chosen shape: TypeScript control plane, Rust data plane, MCP/API/CLI surfaces and customer-owned distribution. The latest production backend is now aligned to the current reviewed commit and migration `0024` has run. The remaining engineering gates are acceptance and operations rather than a redesign.

Highest-risk engineering tasks:

1. Restore GitHub Actions execution so release checks actually run on the reviewed SHA.
2. Run fresh-user onboarding with a controlled inbox and real Codex/Claude MCP clients.
3. Complete all-five-SDK hosted/customer-host acceptance across declared supported hosts.
4. Execute Neon managed restore/PITR and erasure replay using the production provider boundary.
5. Deliver and acknowledge a real responder alert, then run key/credential rotation and callback adverse-DNS drills.

## Chief product officer view

The product should remain a collection primitive, not a survey-distribution company. The question surface should stay fixed and predictable for launch: rating/Likert, single choice, multi choice, short text, long text, ranking, matrix, allocation, and contact/metadata fields only where the contract supports them. More expansion should come from SDK rendering quality, metadata ergonomics, receipts, exports and agent operations, rather than a large builder.

The main missing product proof is independent activation. Three outside developers must reach a first accepted hosted response from public docs without repository access or verbal help. Record time to first value, support minutes, blockers and whether they understand that distribution belongs to the customer.

## Onboarding and marketing view

The website should sell the simple wedge: “forms without the form backend; run surveys from your app, CLI or agent.” Avoid repeating API/MCP/SDK language in every section. The next marketing work is proof-led: a live working demo, one quickstart that reaches a hosted response, one agent-control tutorial, and clear preview terms. No customer story, demand claim or conversion metric should be published without a consented participant record.

The acquisition sequence is:

1. Invite a tiny known cohort after L04/L05/L06A pass.
2. Observe first use and fix repeat blockers.
3. Publish proof assets after SDK and docs acceptance.
4. Add paid conversion only after live billing and policy gates pass.

## Required external actions

| Owner action | Why it matters | Launch gate |
| --- | --- | --- |
| Fix GitHub Actions billing/policy/runners for `crosstabs/likerts` | Required release checks currently create jobs but run zero steps | L03 |
| Provide a controlled inbox and run real passwordless OTP onboarding | Synthetic credentials do not prove human signup, recovery or one-time grant behavior | L04 |
| Approve legal entity, jurisdiction, support/privacy/security contacts and preview terms | External preview users need truthful contact, data and commercial terms | L06A |
| Complete Stripe live merchant activation and authorize one controlled live purchase/refund | Sandbox checkout proves code shape, not live money handling | L09 |
| Verify Neon account link and permit quarantined managed restore/PITR drill | Local Docker restore does not prove provider recovery or deletion replay | L10 |
| Name a real incident responder and backup, then acknowledge an alert drill | A configured endpoint is not operational monitoring | L12 |
| Provide package registry ownership for npm/Maven/pub.dev/Swift distribution | Direct downloads work, but normal package installs are not published | L16 |
| Approve exact outreach list/message or opted-in tester pool | Preparation is not permission to contact prospects | L14 |

## Remaining engineering task list

- Close L02 with production checkout return/settlement verification after the latest backend deploy.
- Close L03 only after GitHub Actions execute real green jobs on the reviewed SHA.
- Close L04 with fresh human onboarding and real API/CLI/Codex/Claude evidence.
- Close L05 when an outside developer reaches first response from public docs unaided.
- Close L07 after declared Web, React Native, iOS, Android and Flutter host matrices pass against hosted service.
- Close L08 after visible balances, 80/90/100 notifications, abuse denial and zero-balance pause/recovery pass with customer-safe messaging.
- Close L09 after live payment/refund reconciliation and financial policy approval.
- Close L10 after managed restore/PITR, erasure replay, export recovery and quarantine evidence.
- Close L11 after customer-owned DNS, dynamic rebinding, deployed outbound enforcement and abrupt worker loss evidence.
- Close L12 after real alert acknowledgement, runbook execution and rotation/revocation drill.
- Close L13 after actual provider bills and bounded load/callback/export costs are reconciled.
- Close L14 after consented independent activation and design-partner learning.
- Close L15 only after P0/P1 evidence is reconciled into a public-paid go/no-go decision.
- Close L16 after registry packages and prebuilt CLI are published and clean-install verified.
- Close L17 after proof-led discovery assets are published with approved demo data handling.
- Close L18 only if provider OAuth becomes advertised; otherwise keep scoped service credentials as the supported integration path.

## What this achieves

This keeps Likerts differentiated and cheap without inheriting Google Forms' distribution/spam risk. Customers own where surveys appear; Likerts owns contracts, metering, receipts, APIs, SDKs and agent operations. The architecture can compete like Clerk or Resend by making a painful embedded capability self-serve and metered, but it earns enterprise trust later through evidence rather than promises.
