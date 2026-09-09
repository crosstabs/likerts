# Likerts product and system model

Status: target architecture with an initial local development implementation; see BUILD-STATUS.md for verified scope and launch gaps. This document supersedes the dedicated enterprise architecture and economics preserved in economics/. Current pricing decision: free workspace onboarding with a one-time grant of 1,000 accepted responses, then US$0.01 per accepted response. The smallest paid purchase is US$5 for 500 response credits. There is no subscription, provisioning fee or monthly commitment. See [PRICING.md](PRICING.md).

Engineering defaults and delivery order are selected in [ENGINEERING-DECISIONS.md](ENGINEERING-DECISIONS.md). These decisions supersede earlier open choices; integrations remain subject to implementation and validation.

## Product boundary

Likerts is an embedded survey configuration and response collection service. Customers own presentation, placement, targeting, triggers and distribution in their websites and applications. Likerts provides schemas, optional rendering SDKs, validation, durable collection and authorized retrieval/export.

No Likerts-hosted respondent pages, public survey links, URL shortener, QR generation, link distribution, invitation sending or campaign delivery. No vanity domains, customer email sending domains or unsubscribe mailing service. The customer controls any external invitations and recipient suppression. API endpoint URLs are integration endpoints, not shareable respondent survey links.

No dedicated customer deployments, enterprise SSO/SAML configuration, SCIM or bespoke infrastructure commitments in the initial scope. Removing enterprise features does not remove authentication, customer data isolation or abuse controls.

## Stack and interfaces

| Layer | Technology / role |
| --- | --- |
| Backend | Modular Rust API and restricted callback worker on Render Singapore, Neon Postgres in Singapore and private Vercel Blob exports |
| MCP | Agents configure surveys and access authorized platform operations |
| CLI | Rust client over the HTTP API for developers and automation |
| HTTP API | Versioned management and collection contracts |
| Web SDK | TypeScript; embedded customer-site presentation |
| React Native SDK | TypeScript; framework-appropriate mobile presentation |
| iOS SDK | Swift; native presentation |
| Android SDK | Kotlin; native presentation |
| Flutter SDK | Dart; Flutter presentation |

All customer management capabilities have API, MCP and CLI coverage: account/workspace lifecycle, grants and credentials, survey drafts and versions, collection configurations, response retrieval/deletion, exports, usage, payment administration and response callback configuration. A capability registry maps schemas, scopes, roles, idempotency and audit behavior. SDKs expose respondent integration capabilities, not privileged administration.

One versioned survey and submission contract spans all SDKs. No inference runs per response. Collection works independently of any agent session. Frozen local SDK artifacts and clean-install evidence exist for 0.0.1, 0.0.2 and 0.0.3. The shared-service economics model includes explicit maintenance/support assumptions; provider deployment costs and margins remain unverified.

## Customer-controlled experience

The developer installs an SDK or integrates the API. Customer code decides when and where to request or present a survey, supplies approved context and handles consent. Examples include a checkout-completed event, a feedback screen or an inline component. Customers may use SDK rendering or build their own UI.

An agent can configure schema and collection settings through MCP, CLI or API within its grant. This does not automatically authorize deployment to a customer application or create instrumentation that has not been installed. Likerts does not contact respondents or independently launch campaigns. Remote configuration contains supported data/settings, not executable code.

SDKs fetch/preload configurations, render where instructed, dismiss and report completion. Callers explicitly retry transport failures with the same payload and idempotency key; baseline clients do not retry automatically. Customers own targeting and frequency policy. Any SDK-local frequency helper is best-effort and can reset on reinstall or cleared storage; cross-device enforcement requires an explicitly designed identity/privacy model.

## Survey and collection contract

Six initial question types: single choice, multiple choice, integer rating scale, bounded text, number and date. Stable question/option IDs, strict payload limits and authoritative server validation. No uploads or arbitrary HTML/JavaScript. Schema 4 adds bounded forward routing, without an arbitrary branching expression language.

The first expansion adds NPS (`type: scale`, `preset: nps`, bounds 0–10), yes/no (`type: single_choice`, `preset: yes_no`, option IDs yes/no), optional scale value labels, and multiple-choice minSelections/maxSelections. NPS answers remain numbers and yes/no answers remain option IDs. Labels and limits are validated by the backend and rendered across all five SDKs. An unanswered optional multiple-choice question may be omitted; a supplied answer must meet its limits.

Public configurations use schemaVersion 1 for baseline questions, version 2 for the first presets/labels/limits expansion, version 3 for conditional visibility and Other/exclusive/presentation controls, version 4 for pages and bounded forward routing, and version 5 for ranking, matrices and constant-sum allocation. Frozen SDK 0.0.1 accepts 1/2; frozen 0.0.2 accepts 1–4; frozen 0.0.3 accepts 1–5 and includes durable offline queue APIs. Unsupported versions are rejected. Publish and collection configuration require customer-declared installation groups with target, SDK version label and supported schema versions. Every group must support the actual schema version, so a mixed fleet containing a v1-only installation blocks a v2 publish or binding. The declaration prevents accidental configuration and is not device attestation. Published versions and collection bindings retain their original schema and capability record.

Draft edits use optimistic revisions. Publishing freezes an immutable version. A collection configuration binds a published version, customer application/placement identifier, acceptance state and optional caps. It has no public landing page or short code. Changed version bindings require a new collection identity so historical answers remain interpretable. SDK clients cache decoded configurations for five minutes, support explicit refresh, evict on refresh failure and reject any refreshed response that changes the collection/survey/version/schema-version binding.

Client-supplied metadata is untrusted context. Keep it distinct from server-controlled configuration metadata. Where authoritative metadata is needed, a customer's authenticated backend can mint a bounded signed submission context; never treat a browser/mobile metadata field as proof of identity, location or purchase. Signing and replay semantics require implementation specification.

Atomically commit each validated response and exactly one usage entry before returning success. Stable submission idempotency keys deduplicate retries; different answers using the same key conflict. Concurrent retries must not double-charge. New submissions check acceptance state, expiry and caps; previously accepted retries return the original receipt. Keys do not prove respondent uniqueness or stop bots.

Durable offline collection is an explicit opt-in SDK facility on all five platforms; normal submission never enters it automatically. Queues preserve immutable idempotency envelopes, enforce record/byte/age ceilings, run one caller-triggered oldest-first flush, classify retry and terminal outcomes, quarantine authentication failures and remove data only after a valid same-collection accepted one-cent receipt. Web supplies real IndexedDB/WebCrypto persistence. Native applications must inject a Keychain/Keystore-backed authenticated-encryption storage adapter; this repository cannot certify that host adapter's durability, backup exclusion or hardware protection. Local enqueue, inspection, retry, expiry and deletion never create usage. See [the offline contract](contracts/OFFLINE-COLLECTION.md).

Customer-configured response callbacks use signed ID-only events, an atomic outbox and a separately restricted worker. Creation defaults to disabled; customers install signing credentials before enabling delivery. Bounded retries, replay, rotation, erasure and revocation are locally verified; hosted HTTPS/egress/alarms/recovery remain open. See [the webhook contract](infrastructure/webhooks/README.md).

## Security and access

Each workspace is an authorization boundary on shared infrastructure. Rust constructs an authorized workspace context after authentication, current membership and scope checks. Tenant-owned records, jobs, caches and objects carry workspace identity. Composite database references include workspace_id. PostgreSQL row-level policies default-deny missing context; runtime roles are not table owners, superusers or BYPASSRLS. Transaction-local context must not leak across pooled requests.

Removing enterprise SSO does not remove account authentication. Use Clerk-hosted passwordless login with passkeys and email OTP bootstrap/recovery behind a provider-neutral OIDC boundary. Likerts owns workspace membership and authorization. OAuth consent grants agents bounded workspace scopes; CLI login uses authorization-server metadata, PKCE S256 and a private atomic credential file in the user configuration directory (0700 directory/0600 file on Unix). Native OS keychain storage is not implemented. Automation uses revocable scoped service credentials. Authentication/consent and payment setup may require browser steps without a management dashboard. Clerk sandbox and MCP compatibility checks remain implementation gates.

Never ship management keys in browser/mobile bundles. SDK-visible identifiers and collection capabilities grant only approved schema access and bounded submission, not response reading or management. Public identifiers, CORS and app bundle identifiers are not strong client authentication. Server-side validation, quotas, revocation, rate limits and abuse detection remain necessary even without hosted links. A compromised integration must not expose other workspaces.

Exports require authorized selection and download access, use a consistent snapshot and stable schema IDs, protect spreadsheet-oriented CSV against formula execution, and expire after 24 hours. Default raw response retention is 90 days, with shorter periods configurable; active deletion processing has a 24-hour target and backups expire on a seven-day cycle. ENGINEERING-DECISIONS.md defines the separate receipt lifecycle and deletion replay on restore. Raw-data/export retention, erasure and local restore replay are implemented; seven-day managed backup expiry and RDS recovery still require hosted evidence.

## Billing and economics

Give each verified workspace one nonrenewing grant of 1,000 accepted responses without requiring a card. After the grant, charge US$0.01 per accepted response from purchased balance; the smallest purchase is US$5 for 500 credits. Invalid requests and identical retries consume nothing. Grant issuance, payment crediting, response consumption, refunds and reversals must be append-only and idempotent. Balance enforcement must be atomic with acceptance; payment events must be authenticated and deduplicated. Durable one-cent gross usage and the promotional/prepaid ledger are implemented locally. Credits fund acceptance atomically and are excluded from historical postpaid settlement. Verified signup/duplicate-workspace abuse controls, threshold notifications, checkout/top-up operations and Stripe sandbox proof remain unfinished. See BILLING-LIMITS.md.

The historical dedicated-hosting break-even results do not apply. The prior AWS [shared-service model](economics/SHARED-ECONOMICS.md) includes infrastructure, authentication, API traffic, SDK maintenance, retained data, exports, payments, abuse controls and support, with measured local data and explicit planning assumptions. It predates the promotional grant and therefore does not model acquisition subsidy, conversion or repeated-workspace abuse. Exclude customer-specific deployments, email sending, public-link hosting/distribution and enterprise connection licences. No mandatory AI cost per response. One cent is a selling price, not a measured margin.

Render is the launch hosting target; [its Blueprint/runbook](infrastructure/render/README.md) separates owner migration, API and worker credentials. The AWS deployment remains an optional alternate. Render-specific hosted proof and updated provider economics are required before launch.

## Implementation and release proof

Local gates cover scoped access, versioned schemas, embedded collection configurations, idempotent durable response/usage commits, response retrieval/export/deletion and MCP/API/CLI coverage. Provider-backed identity/bootstrap and payment, hosted infrastructure and final platform acceptance remain release gates. All five SDKs—Web, React Native, iOS, Android and Flutter—are required at the first public launch. This launch breadth is confirmed; native quality and feature parity must meet the same release bar.

Verify cross-workspace denial, scope enforcement, untrusted metadata handling, duplicate billing prevention, failed commits, revocation, export consistency and realistic peak traffic. Benchmark a shared deployment and estimate SDK maintenance before publishing profitability or availability claims.
