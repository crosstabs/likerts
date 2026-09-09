# Likerts engineering decisions

Decision date: 8 September 2026. These are implementation defaults selected under the user's delegation to engineering. They describe intended behavior, not deployed capabilities. BUILD-STATUS.md records verified implementation.

## Product and delivery

Keep US$0.01 per accepted completed response after a one-time grant of 1,000 accepted responses per verified workspace. Workspace creation and onboarding require no card. The smallest paid credit purchase is US$5 for 500 responses; it is usable balance, not a provisioning fee, subscription or monthly commitment. Ship Web, React Native, iOS, Android and Flutter together. Customers own survey presentation and distribution. Transactional account and payment messages are separate from respondent distribution.

Freeze question expansion until the collection, authorization and payment paths meet the release checks. Build one modular Rust service. TypeScript serves the MCP adapter and Web/React Native integrations; Swift, Kotlin and Dart remain native SDK languages. Every management capability has an API contract and MCP/CLI exposure. Browser consent, passkey ceremonies and payment authentication are explicit handoffs from those interfaces.

## Identity: managed Clerk, application-owned permissions

Select Clerk for hosted human identity and OAuth while preserving a provider-neutral JWT/OIDC verifier. Configure passwords and usernames off, email OTP for bootstrap/recovery and passkeys for routine login. Verify the selected plan and flows in a sandbox before release. [Sign-up and sign-in options](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options), [passkeys](https://clerk.com/docs/reference/android/passkeys).

Use authorization code with PKCE S256 for interactive clients. Require exact issuer and explicit JWKS configuration, JWT access tokens, custom Likerts scopes and RFC authorization-server metadata. Prove resource handling, consent, discovery and refresh/revocation against actual MCP clients; provider login alone does not establish MCP compatibility. Keep provider credentials out of MCP tools and SDK bundles. [Clerk OAuth implementation](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth).

Likerts owns workspaces, memberships and grants. Start with owner, editor and reader roles, with separate explicit billing permissions. Effective access is the intersection of current membership, granted workspace, scopes and resource ownership. Removal invalidates subsequent requests even if an identity token has not expired. Automation gets tenant-bound, hashed, expiring, revocable service credentials. Respondents do not need accounts.

Recovery uses the provider's verified email OTP flow, followed by session/grant revocation and passkey reenrollment. Sensitive billing, ownership and credential changes require fresh authentication. Test recovery and revocation end to end; do not invent a local password fallback or a support bypass.

## Billing: free grant, then prepaid metering through Stripe

Use Stripe for payment setup and credit purchases, while the Likerts ledger remains authoritative for grants, purchased balance and accepted response usage. Issue one idempotent, nonrenewing 1,000-response promotional grant to a verified workspace. Do not require a payment method during that grant. Require an authenticated owner and a configured payment method to purchase paid credits. See [PRICING.md](PRICING.md).

The minimum purchase is US$5 and adds 500 paid response credits only after a provider-confirmed payment. Never represent the purchase as a fee. New acceptance pauses when both promotional and paid balances are exhausted. Reads, exports and valid prior receipts remain available. Automatic top-up is off by default and requires an explicit owner-selected trigger, amount and spending cap. Stripe's minimum depends on settlement currency, so validate it for the actual merchant account. [Stripe minimum amounts](https://docs.stripe.com/currencies).

Expose promotional balance, paid balance, lifetime usage, purchase history, optional automatic-top-up controls and the exact blocking reason. Notify owners at 80%, 90% and 100% of each available balance. A failed or disputed payment adds no usable credit and may pause paid acceptance. Promotional grants are nontransferable, have no cash value and cannot be recreated by deleting a workspace.

Acceptance, deduplication, usage and credit consumption commit in one database transaction. Consume promotional balance before paid balance. Do not call Stripe inside that transaction. Persist checkout/payment jobs and reconcile signed, deduplicated provider events before crediting balance. Retries must not collect or credit twice. Grants, purchases, consumption, refunds, reversals and corrections are append-only entries; do not edit historical entries or turn promotional credits into refundable paid value. Provide dispute intake and review, without treating a client-supplied response as proof of a real human or purchase.

## Retention and limits: bounded collection

These are initial product defaults to implement and load-test, not measured capacity claims.

| Resource | Initial rule |
| --- | --- |
| Raw answers and respondent metadata | 90 days from acceptance; customers may select a shorter period |
| Deletion | Immediately hide from reads; remove active data and related export objects within 24 hours |
| Generated export | Authorized access; expires after 24 hours |
| Backups | Seven-day rolling retention; restore must reapply deletion records before serving traffic |
| Request payload | 64 KiB, including metadata |
| Client metadata | 4 KiB encoded; always untrusted |
| Questions per survey | 1–100; existing question constraints remain |
| Active collections | 100 per workspace initially; adjustable after capacity review |
| Collection lifetime | 90-day maximum; shorter expiry configurable; a successor collection gets a new identity |
| Management traffic | 10 requests/second/workspace, burst 20 |
| Collection traffic | 100 requests/second/workspace, burst 200, with additional per-capability/IP and global controls |
| Response pagination | 100 default, 1,000 maximum per page |
| Export concurrency | One job/workspace; stream bounded chunks into object storage |

Preserve minimal idempotency receipts through the collection's acceptance lifetime plus a 30-day retry window, independently of raw response retention. Retain only the data needed for deduplication and conflict detection, including a keyed payload digest. Expired, deleted or revoked collection identities cannot accept new submissions or be reused. Revocation can deny old receipts; ordinary closure and expiry preserve authorized retries during the window. After the window return a terminal expired result, never a new acceptance. Specify canonical payload hashing and deletion behavior in BE-03/DATA-03.

Keep financial records separate from respondent answers. Final financial-record retention depends on the merchant's operating jurisdiction and settlement obligations; this is an external fact to establish before paid launch, not permission to retain raw answers indefinitely.

Rate limits reject unpaid traffic independently of spending caps. SDK backoff follows server retry guidance and keeps the same submission key and payload. No inference runs per response. Removing hosted links removes Likerts' respondent-link delivery surface; it does not eliminate API abuse, customer distribution complaints or account-message deliverability concerns.

## Runtime: shared Render deployment

Select Render for the Rust API and separate callback worker, Render Postgres for primary data and the separately configured private Vercel Blob adapter for exports. Use Singapore as the initial staging and launch region default, with region recorded per workspace. This is not a universal residency promise. Model provider costs before provisioning production capacity.

Use one shared deployment with database-enforced tenant boundaries. Before public launch use Render Postgres high availability on a qualifying paid workspace and at least two API instances; verify actual failure-domain behavior in staging. Migrations run as a separate manual one-off job based on an inert cron service with owner-only credentials; API/worker never receive the owner DSN. Runtime roles cannot own tables, bypass RLS or alter schema. RLS denies missing tenant context and transaction-local settings cannot leak through the pool. Public collection access gets a separately bounded authorization path; never grant unrestricted database access to an SDK capability.

Production startup must fail if durable storage is absent; memory mode requires an explicit development configuration. RLS with application-supplied context protects against omitted tenant filters and pooled-context leakage; it is not a guarantee against a compromised service that can forge that context.

Use a Pro-or-higher Render workspace for seven-day PITR and verify a restore. The documented latest PITR target is at least ten minutes old, so a five-minute disaster RPO requires additional verified recovery infrastructure. Configuration alone is not a recovery result. [Render recovery](https://render.com/docs/postgresql-backups).

Internal targets: 99.9% monthly availability; p95 accepted-submission latency below 300 ms measured within the deployment region at 100 requests/second sustained; recovery within one hour; the prior five-minute disaster data-loss objective is under review because Render PITR alone does not establish it. These are unmeasured engineering targets, not customer guarantees. Normal process crashes must not lose acknowledged commits. Benchmark unpaid abuse, database failover, restores and costs before publishing an SLA or margin.

The launch Blueprint and secret/role/transport boundaries are in [infrastructure/render/README.md](infrastructure/render/README.md). The prior AWS CDK implementation remains an optional alternate target; its SG/NACL and RDS evidence cannot be carried over to Render. Hosted Render TLS, worker egress limits, private export durability and failover must pass independently.

## Execution order and evidence

1. SEC-01: unpaid-traffic limits, trusted-context boundaries and browser-origin policy. BE-04 expiry, revocation and collection caps are implemented and verified.
2. ID-01/ID-02: provider sandbox, passwordless recovery, current memberships, scoped OAuth, revocable automation credentials and real MCP/CLI login tests.
3. DATA-03 and BILL-01–02: deletion, retention workers, cap visibility and sandbox settlement/reconciliation. DATA-01 pagination and DATA-02 exports are implemented and verified.
4. SDK-01–03 and OPS-01–03: common SDK contract, all five platform release checks, staging, restore/load drills and updated shared-service economics.
5. Full release rehearsal with all capabilities exposed through API/MCP/CLI and all five SDKs verified together.

Decision work is complete enough to proceed; implementation tasks remain open. Provider configuration, jurisdiction-specific financial retention, measured cost and recovery results are launch gates owned by engineering, not routine questions returned to the founder.

Evidence now includes injected rollback, reconnect persistence, restricted-role RLS, concurrent deduplication, a discarded-acknowledgement retry, termination/restart of the real backend process, stable response traversal under concurrent acceptance, and export failure/requeue/revocation/expiry. The managed-database backup and restore drill remains an operations task. A database test skipped for a missing environment variable is not evidence of a passing database check.
