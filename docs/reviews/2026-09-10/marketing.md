# Marketing readiness review — 10 September 2026

**Verdict: suitable for a closely assisted developer preview after correcting public examples and expectations; not ready for a public paid acquisition launch.** The site has a coherent visual identity and understandable pricing, but the public journey does not yet give a new developer enough trustworthy, executable guidance to reach a first accepted response. More homepage sections would not solve the main gaps.

This review inspected the live homepage, developer tabs, downloads and signed-out app through the Codex in-app browser on 10 September, checked the served HTML with an HTTPS GET (200), and compared the claims with current source and release documents. It did not create an account, submit customer data, purchase credits, or verify authenticated onboarding. Effort below is a planning estimate in focused person-days, excluding owner/legal waiting time. P0 means required before promoting the current offer publicly; P1 means required before scaling acquisition; P2 is subsequent growth work.

## Current customer journey

| Step | Observed state | Health |
| --- | --- | --- |
| 1. Arrive at [likerts.com](https://likerts.com/) | Clear hero, one prominent free-start CTA, five SDK surfaces, simple visual hierarchy. Preview status is only at the bottom. | Visually sound; expectation mismatch. |
| 2. Explore developer interfaces | MCP/CLI/API tabs switch correctly. CLI/API content looks executable but differs from the actual interface. | Content correctness failure. |
| 3. Open [downloads](https://likerts.com/downloads) | Versioned archives and checksum link are available; pending registries are clearly disclosed. No visible install/quickstart links. | Honest distribution, weak activation handoff. |
| 4. Select Start free | Lands on [the app](https://likerts.com/app), with infrastructure configuration indicators and Clerk sign-in headed “Sign in to likerts-auth.” The settled sign-in form renders. | Functional entry; internal language and no guided first-response path visible. |

Captured and visually inspected current-run screenshots: [1 — homepage](/tmp/likerts-marketing-01-home.png), [2 — developer example](/tmp/likerts-marketing-02-developers.png), [3 — downloads](/tmp/likerts-marketing-03-downloads.png), [4 — sign-in](/tmp/likerts-marketing-04-sign-in.png). These are temporary local evidence files, not published assets.

## What is working

- The product category is understandable in the hero body: embeddable survey collection for web and mobile; validate, store and meter accepted responses. The latest page has distinct product, developer, distribution and price sections rather than repeating the same promise. See [homepage source](../../../control-plane/public/index.html:23).
- The ownership boundary is clear: the customer's app handles presentation and distribution; Likerts does not send campaigns or create public survey links. This is a useful differentiator without claiming immunity from complaints or platform policies. See [ownership copy](../../../control-plane/public/index.html:93).
- The commercial model is unusually easy to scan: 1,000 free responses, 1¢ per accepted response, $5 top-up, no subscription or setup fee. The one-time grant is stated. See [pricing section](../../../control-plane/public/index.html:99).
- Downloads distinguish supported preview archives from pending package registries, and expose checksums. No fabricated customer logos or testimonials are present. See [download source](../../../control-plane/public/downloads/index.html:20).

## Highest-impact findings

### M1 — Public technical examples are inaccurate (confirmed content bugs)

The CLI panel shows `likerts survey create`, `likerts collection issue`, and `likerts usage`. The actual parser accepts `likerts call <capability>`, `capabilities`, and `auth`; it rejects the advertised syntax. The API panel and hero show `type: "likert"` and `scale: 5`; the scale contract uses `type: "scale"`, `min`, `max`, `id`, and `label`, and survey creation requires `idempotencyKey`.

Evidence: [marketing examples](../../../control-plane/public/marketing.js:15), [hero example](../../../control-plane/public/index.html:35), [CLI parser](../../../tools/cli/src/main.rs:492), [real getting-started commands](../../../tools/README.md:46), [create input](../../../contracts/examples/surveys_create.input.json:1), [scale schema](../../../contracts/openapi.json:7834).

The question illustration says “Live schema preview” but consists of fixed spans, with values hidden from assistive technology. Its displayed rule “If score ≤ 3, ask why” is not a supported single visibility predicate: the current enum contains equality, inclusion and answered operators, not a less-than-or-equal operator. It should be an explicitly illustrative example using supported behavior, or an actual SDK demo. Evidence: [preview markup](../../../control-plane/public/index.html:68), [conditional contract](../../../contracts/CONDITIONAL-VISIBILITY.md:3).

Commercial implication: a developer who tries the advertised commands encounters rejection immediately. This damages confidence more than a missing decorative asset.

### M2 — The page implies open activation and purchasable credits while launch remains invite-only (confirmed inconsistency; availability unverified)

“Start free,” “collect real product feedback today,” and “buy response credits” are public; “Developer preview · No SLA” appears only in the footer. The launch decision is explicitly **invite-only preview**, Stripe test mode, with fresh-user identity and real Codex/Claude journeys still listed as acceptance gates. This review verified only the rendered sign-in screen, not that signup is closed or broken.

Evidence: [CTAs and pricing](../../../control-plane/public/index.html:101), [closing promise/footer](../../../control-plane/public/index.html:107), [launch decision](../../../LAUNCH-DECISION.md:5), [identity/agent/payment gates](../../../LAUNCH-DECISION.md:31).

Recommendation: make “Developer preview” and its access conditions visible at the primary CTA; describe post-preview paid pricing accurately until live purchases are accepted. Owner must choose and enforce the actual access policy. Avoid labeling a beta as generally available through copy alone.

### M3 — A new developer cannot find a public first-response guide (confirmed discoverability gap)

The main Developers navigation scrolls to a promotional block. Its only next links are Downloads, Control plane and Service status. Downloads provides archives without installation commands, platform requirements, sample apps, API reference or MCP connection instructions. Useful material already exists in `tools/README.md`, SDK READMEs and `contracts/CAPABILITIES.md`, but it is not linked from the public journey.

Evidence: [developer links](../../../control-plane/public/index.html:89), [download page](../../../control-plane/public/downloads/index.html:18), [working API/CLI/MCP setup documentation](../../../tools/README.md:5).

Recommendation: publish a compact versioned docs surface and one complete path: create workspace → issue least-privilege credential → create/publish survey → issue collection → embed → receive first response → retrieve it. Keep all five SDKs available; start with one canonical example so the homepage does not become repetitive.

### M4 — Trust and commercial policies are absent from the public path (confirmed publication gap)

There are no visible privacy, terms, credits/refunds, subprocessor, support or security contact links in the public footer or downloads. The repository contains thoughtful draft policy work, but it explicitly remains unapproved and has unresolved owner facts. Marketing should not invent or publish these decisions.

Separately, the authenticated checkout markup says “Credits never expire while your workspace remains active,” while the legal review pack still asks the owner to choose expiry/no-expiry treatment. This is an unsupported commercial promise in source; it was not observed after authentication.

Evidence: [footer](../../../control-plane/public/index.html:110), [policy review pack](../../../docs/legal/README.md:3), [owner decisions](../../../docs/legal/README.md:15), [checkout copy](../../../control-plane/public/app/index.html:22).

### M5 — Proof is mostly illustration rather than an inspectable outcome (strategic gap plus unverified claims)

The page lists capability families, but does not let visitors experience a working survey or see a real acceptance receipt, structured result and export. “Every SDK … accessible native controls” is broader than the declared acceptance evidence: the browser/accessibility/native device matrix remains a launch gate. Codex/Claude copy also runs ahead of fresh-customer client acceptance.

Evidence: [SDK accessibility claim](../../../control-plane/public/index.html:55), [agent claim](../../../control-plane/public/index.html:81), [remaining acceptance gates](../../../LAUNCH-DECISION.md:31).

Recommendation: make one small, real demo do the work of several claims; label its data/sample state. Promote verified facts, not a generic “production-ready” or enterprise narrative. Collect named customer proof only after real use and permission.

### M6 — Pricing is scannable but purchase questions are unanswered (confirmed copy gap)

The page does not specify US dollars, explain that a response is one accepted survey submission rather than one answer, clarify identical-retry handling, show what happens when credit reaches zero, or link credit/refund terms. Internal pricing documentation already answers several of these. Expiry, tax and refund decisions remain unresolved.

Evidence: [public pricing](../../../control-plane/public/index.html:99), [internal pricing](../../../PRICING.md:5), [credit-policy draft](../../../docs/legal/credits-and-refunds.md:7). Add a short FAQ adjacent to pricing rather than another feature section.

### M7 — Acquisition and measurement are not evidenced (verification gap and recommendation)

No acquisition source or conversion instrumentation is present in `marketing.js`; no public signup/activation funnel dashboard or acquisition experiment plan was found in the inspected repository. Provider-level analytics may exist outside this review. `PRICING.md` explicitly requires activation, grant consumption and conversion measurement before margin claims.

The homepage has title/description metadata, but no canonical URL, Open Graph/Twitter image metadata, or real favicon (`data:,`). Public source contains no sitemap or robots file. These are discoverability and share-quality opportunities, not evidence that search indexing is broken.

Evidence: [page head](../../../control-plane/public/index.html:3), [marketing script](../../../control-plane/public/marketing.js:1), [measurement requirements](../../../PRICING.md:29).

### M8 — Status and authentication language look internal (confirmed UX mismatch)

“Service status” opens a JSON health handler whose `status: "ok"` is unconditional and whose other values only test whether environment settings are present. It does not prove API/identity availability or provide incident history. The sign-in screen identifies the product as “likerts-auth,” and surrounding text introduces OAuth grants/configuration before explaining first use.

Evidence: [status link](../../../control-plane/public/index.html:89), [health handler](../../../control-plane/api/health.js:3), [app introduction](../../../control-plane/public/app/index.html:16), current-run screenshot 4. Relabel the health link accurately now; publish an actual monitored status page when the operational checks exist.

## Prioritized task list

| ID / priority / gate | Deliverable | Accountable owner | Acceptance criteria | Dependency | Estimate |
| --- | --- | --- | --- | --- | --- | --- |
| MKT-01 / P0 / fix current preview | Correct public examples and demo labels | Developer relations + engineering reviewer | Hero/API/CLI examples use the released contract; exact commands run from a fresh install; conditional rule is supported; static illustration is not called live. | Released schema/CLI | 0.5–1 day |
| MKT-02 / P0 / fix current preview | Align claims with the actual access policy | CEO + product marketing | Preview/access conditions visible before CTA; pricing states current availability; signup enforces chosen policy; unapproved expiry/accessibility/client promises removed or supported. | Owner access decision; identity/billing/client acceptance | 0.5 day copy + dependent engineering |
| MKT-03 / P0 / mandatory before paid launch | Publish trust pack and final pricing FAQ | CEO/legal + billing/product marketing | Approved privacy, terms, credits/refunds, subprocessors and monitored support routes linked publicly; no unresolved placeholders; US$ and accepted-submission unit clear; retries, exhaustion, $5 = 500 credits, taxes/refunds/expiry explained consistently. | Owner legal entity, data, refund, expiry, tax and support decisions | 1–2 days publication after approvals |
| MKT-04 / P1 / before scaling acquisition | Publish docs and one working first-response demo | Developer relations + product/SDK engineering | Top-level Docs link; complete create/publish/embed/submit/retrieve path; five SDK install guides; API and Codex/Claude setup; real keyboard-usable demo with labeled data handling. Three independent testers complete docs without verbal help; record actual time. | MKT-01; real identity/client acceptance | 3–5 days |
| MKT-05 / P1 / preview polish | Clean up signup and status handoff | Product + operations | Clerk brand says Likerts; onboarding explains the next step; configuration-only health link renamed accurately. Claim service health only after monitored checks exist. | Clerk branding; operational checks if adding real status | 0.5–1 day UI; monitoring separate |
| MKT-06 / P1 / before scaling acquisition | Measure activation and run one design-partner cohort | CEO + marketing + product analytics | Define source → workspace → credential → first response → repeat use → paid conversion, exclude internal/test traffic and sensitive payloads; select one buyer/use case; recruit 5 developers through owner-approved outreach; weekly decisions from observed blockers/use/willingness to pay. Suggested audience is developers embedding post-action web/mobile feedback, a hypothesis to test. | Docs, identity acceptance, privacy review, owner-approved outreach | 2–3 days setup + 2-week learning window |
| MKT-07 / P2 / optional growth | Add share/search foundations and proof-led content | Marketing + frontend/developer relations | Canonical, favicon, factual social metadata, sitemap and deliberate crawler rules; one reproducible tutorial/sample app and one consented customer story. No unsupported logos, enterprise or speed claims. | Stable positioning/docs; real cohort evidence for story | 2–4 days |

## Suggested sequencing

Fix examples and preview expectations first (MKT-01/02), then resolve owner decisions and publish trust/pricing (MKT-03). Build one demonstrable activation path and a clear handoff (MKT-04/05). Measure it with a small developer cohort (MKT-06). Increase acquisition only after real activation and the shared public-paid launch gates pass. More homepage sections or paid traffic would amplify current onboarding friction; optional growth assets follow evidence (MKT-07).

## Audit limits

This was a desktop, signed-out marketing and handoff review. No claim is made about complete accessibility, mobile/native behavior, authenticated activation, deliverability, operational uptime, legal sufficiency, billing availability, conversion rates or customer demand. Native SDK acceptance, real identity journeys and live billing belong to the product/engineering launch reviews. Semantic risks visible in source include a static “live” preview and tab semantics without associated `tabpanel`/keyboard-arrow handling; they require a focused keyboard/screen-reader check before an accessibility claim.
