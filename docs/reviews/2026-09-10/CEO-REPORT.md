# Likerts launch council — 10 September 2026

**Decision: keep the preview small and assisted; hold public paid launch.** Correct the customer-facing defects before bringing in the next preview cohort. The main launch gap is a trustworthy journey from first visit to first response, backed by operating evidence.

The council combined independent marketing, product and engineering source/evidence reviews with live public-journey checks and a current CI account-status check. Their findings converge: the collection foundations are substantial, but a new customer still lacks a proven, documented path through onboarding and payment. No new production configuration, customer account, payment or deployment was made for this review.

Reviewed code: `bae6d5b8338c32e4526d1e77ba50e021bb67c566`. Recorded hosted evidence is mostly from 9 September; current read-only site checks and the GitHub CI check were made on 10 September. This review does not certify security, accessibility, compliance or uptime.

## Council assessment

| Function | What is already working | What is lacking | Accountable role |
| --- | --- | --- | --- |
| Marketing | Recognizable site, clear embedded-collection category, simple pricing, honest checksummed downloads. | Accurate examples; visible preview conditions; public docs, trust and support links; an initial audience and measured activation. | Marketing lead + developer relations |
| Product | Create/publish/collect/retrieve/export/delete lifecycle; nine question families; five SDK artifacts; API/MCP/CLI coverage. | Independent first-use journey; actionable credentials and client setup; payment-return UX; credit visibility; actual supported-host acceptance. | Product lead + QA |
| Engineering | Durable accounting/idempotency, tenant isolation, scoped credentials, hosted core lifecycle and sandbox payment evidence. | Fresh identity/agent acceptance, running CI, live settlement, managed restore and hard-failure recovery, delivered alerts, production access operations and sustained cost/capacity evidence. | Chief engineer + operations |
| Business operations | Pricing and draft policies exist; Render/Vercel/Neon deployment is real. | Approved entity/policies, merchant readiness, named responders, complete costs and customer learning. | Founder/business owner |

These are workstream assignments, not a claim that permanent staff or support coverage have been hired. The review agents completed this audit; implementation remains in the queue.

## Immediate findings

1. **Checkout returns to the wrong page.** The backend sends successful/cancelled checkout to `/`; the console now lives at `/app`. The homepage cannot display the return state. Separately, console copy asserts payment based on a query parameter rather than confirmed purchase state. This is a customer-flow defect, not evidence that ledger credits were lost. Sources: `backend/src/billing.rs:265`, `control-plane/public/app.js:167`.
2. **The advertised code does not work.** Public CLI commands are absent from the parser; the API/hero use unsupported `type: "likert"` fields and omit required create fields. The conditional illustration uses an unsupported numeric operator. Fix the examples using released contracts. Sources: `control-plane/public/marketing.js:17`, `contracts/examples/surveys_create.input.json`, `tools/cli/src/main.rs:523`.
3. **The public offer exceeds its acceptance evidence.** “Start free” and “collect … today” lead into a service whose decision is invite-only preview and whose full fresh-user journey is unrecorded. Application bootstrap does not itself check an invitation; provider restrictions were not inspected. Current admission is unverified, not proven open or closed.
4. **There is no discoverable first-response guide.** Useful setup material exists in the repository, but public navigation and downloads do not lead a visitor through a complete integration. Downloads and rendered sign-in are insufficient onboarding evidence.
5. **Public trust and operations need real owners.** Privacy, terms, credits/refunds, subprocessors and support remain drafts. The checkout says credits never expire while that business decision is still unresolved. The “Service status” link only reports configuration presence. CI does not start because of a GitHub account payment/spending block.

The individual reports contain exact evidence and reproduction boundaries: [marketing](marketing.md), [product](product.md), [engineering](engineering.md).

## Launch scope and claims

Keep the agreed scope: customer-controlled embedded surveys, API/MCP/CLI management, and Web, React Native, iOS, Android and Flutter SDKs. Keep free onboarding with one nonrenewing 1,000-response grant, followed by US$0.01 per accepted submission and a US$5 minimum credit purchase, subject to commercial approval and live-billing acceptance.

All five SDKs remain in the first-launch acceptance matrix. Direct archives already provide a preview distribution path. Public package registries and prebuilt CLI binaries improve adoption; advertise them only after clean public installation succeeds. Provider OAuth remains open and unadvertised until consent, refresh, revocation and real-client acceptance pass. Service-credential acceptance must be recorded separately.

Do not add a survey builder, analytics dashboard, distribution/email, new question types, enterprise SSO or dedicated tenancy to close this queue. Retain the current TypeScript/Rust and Render/Vercel/Neon direction.

Correct the evidence language: the hosted lifecycle accepted a **five-SDK capability declaration and one response**. All-five execution is recorded locally; production host/device acceptance remains open. A 260-attempt hosted rehearsal is bounded correctness/latency evidence. Sandbox payment/refund is not live settlement. Graceful restart is not abrupt-failure recovery.

## Execution decision

Use [LAUNCH-TASKS.md](../../../LAUNCH-TASKS.md) as the ordered execution queue. It consolidates duplicate council findings and maps them to existing requirements in [TASKS.md](../../../TASKS.md). None of these new tasks is marked complete merely because a report exists.

- **First:** correct examples, checkout and preview expectations; unblock CI. Publish the first-response path and obtain the owner facts needed for trust/support.
- **Then:** complete real identity/API/CLI/Codex/Claude Code acceptance and an independent developer onboarding attempt. Exercise all five supported SDK hosts. Recovery, alerts and callback failure work can proceed alongside this.
- **Before public payment:** close the live-money, policy, security/operations, capacity and final release gates on the actual release revision.
- **For acquisition:** start with developers adding post-action feedback to a web/mobile product. This is an initial positioning hypothesis. Test it with a small design-partner cohort and measure first-response completion, repeat use and support effort. Do not buy broad traffic into the current onboarding gaps.

There is no defensible launch date yet. Estimates in the queue describe focused effort; provider account access, legal decisions and real-device/customer evidence can determine elapsed time. Set a date only after the first-user journey passes and external blockers have owners and dates.

## Founder inputs to batch once

1. Controlled inbox and real Codex/Claude Code access for acceptance; confirm the provider's invitation policy.
2. GitHub billing/spending repair and Neon Marketplace account verification so CI and restore testing can proceed.
3. Contracting entity/jurisdiction, refund and credit-expiry decisions, financial retention, merchant activation and approved live-payment authority.
4. Monitored support/security/privacy contacts, incident owner and backup, notification receiver and feasible coverage.
5. Required device/runtime access, provider billing exports, and an agreed budget for bounded load/recovery exercises.

Engineers can correct code, publish draft docs and prepare rehearsals while these inputs are gathered. They must not invent business identities, policy approval, test outcomes or staffed response coverage.

## Commercial discipline

The existing [economics model](../../../economics/LAUNCH-PLATFORM-ECONOMICS.md) estimates a US$125.39 monthly allocated floor or US$80.39 incremental floor when existing plans are treated as sunk. Those are 9 September planning assumptions, not complete bills or a margin result. They exclude material costs including labor, support and abuse. The free grant has US$10 of price-equivalent value; that is not its cash delivery cost.

Before claiming “built for enterprise, costed for hobby” economics, reconcile actual provider and processor costs, grant abuse, paid conversion and support demand. Current product claims should describe the implemented collection service and verified limits.
