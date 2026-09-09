# Likerts public policy review pack

**Pre-launch drafts — not published, effective or approved.** Prepared 9 September 2026. These files are proposed customer-facing copy for owner and legal review. Bracketed `[OWNER: ...]` fields require real business decisions or account facts. `[VERIFY: ...]` notes identify operational evidence required before the adjacent promise can be published. Neither marker may appear on a live policy page.

| Draft | Purpose |
| --- | --- |
| [Privacy notice](privacy.md) | Account information, survey data, retention and rights |
| [Service terms](terms.md) | Self-service scope, customer responsibilities and access |
| [Credits and refunds](credits-and-refunds.md) | Free grant, prepaid acceptance and payment adjustments |
| [Subprocessors](subprocessors.md) | Current provider inventory and unresolved contractual details |
| [Support and incidents](support-and-incidents.md) | Contact routes, information to provide and response expectations |

## Required owner/legal decisions

- [ ] Enter the contracting entity's legal name, registration/address, operating jurisdiction, effective date and contracting authority. Do not infer these from the repository owner or Singapore hosting.
- [ ] Choose eligible customer types, supported countries, account-holder minimum age, restricted data/use cases and whether consumer purchases are supported.
- [ ] Supply and test monitored support, privacy, billing and security contacts; assign an owner and backup, support hours/time zone, achievable acknowledgement targets and incident escalation. No mailbox or staffing coverage is assumed.
- [ ] Approve refund eligibility/window, treatment of unused credits on closure, paid-credit expiry or no-expiry policy, tax display/invoicing, and future price-change notice. The code's refund capability does not determine a customer's legal entitlement.
- [ ] Have legal review confirm contractual data roles, applicable privacy rights/lawful grounds, international transfer mechanism, DPA requirements, financial/audit/log retention and the competent authority/contact details applicable to the business.
- [ ] Complete jurisdiction-specific terms: liability allocation, warranties, dispute process/governing law, termination notice, policy-change notice and any mandatory consumer protections. No arbitration, liability cap or waiver has been invented.
- [ ] Confirm provider contracting entities, executed terms/DPAs, processing locations and downstream vendors. Singapore API/database placement does not establish Singapore-only processing.
- [ ] Approve the customer-data use statement, including whether survey content may ever be used for product research or model training. The current collection path performs no per-response AI inference; this alone is not a complete data-use policy.

## Engineering/publication gates

- [ ] Verify fresh-user passwordless signup, recovery, owner identity, one-time grant issuance and grant-abuse handling before describing open self-service activation as available.
- [ ] Activate live Stripe merchant processing; verify production checkout, receipt/refund handling, tax configuration and balance notifications. Existing payment/refund evidence is test mode.
- [ ] Prove scheduled raw-data deletion, export-object cleanup and the configured seven-day Neon backup window. Run managed restore with independently durable deletion replay; the local restore fixture is not a hosted retention guarantee.
- [ ] Audit actual browser cookies/storage and provider request/log fields. Publish accurate purposes, lifetimes and consent controls for enabled features.
- [ ] Review support access, secrets/log redaction, incident detection and notification delivery. Avoid SOC 2, dedicated tenancy, SLA, recovery-time or 24/7 support claims without separate evidence/agreements.
- [ ] Replace every owner/verification marker, review all cross-links and record legal/product/engineering approvals and version history. Publish the approved set together with the product, and preserve the accepted version and acceptance record. Do not silently make these drafts effective.

## Evidence used

Commercial scope: [PRICING.md](../../PRICING.md), [BILLING-LIMITS.md](../../BILLING-LIMITS.md). Lifecycle and access: [DATA-LIFECYCLE.md](../../DATA-LIFECYCLE.md), [COLLECTION-SECURITY.md](../../COLLECTION-SECURITY.md), [SECRET-HANDLING.md](../../SECRET-HANDLING.md). Deployment and tests: [hosted inventory](../../infrastructure/render/hosted-evidence.json), [hosted lifecycle](../../infrastructure/render/hosted-lifecycle-evidence.json), [sandbox refund](../../infrastructure/render/hosted-refund-evidence.json), [local restore](../../infrastructure/recovery/local-evidence.json). The hosted inventory contains historical fields; the current deployment work and task list supersede its stale identity/migration limitations.

Provider references checked on 9 September 2026: [Stripe refund behavior](https://docs.stripe.com/refunds), [Render privacy](https://render.com/privacy), [Neon product terms](https://neon.com/platform-terms), [Clerk privacy](https://clerk.com/legal/privacy). These explain provider practices; they are not evidence of Likerts' executed contracts or its compliance with any particular law.
