# Privacy notice

**Pre-launch draft for owner/legal review — not effective.**

Effective date: [OWNER: date]. Likerts is operated by [OWNER: legal entity and address]. Contact us about privacy at [OWNER: monitored privacy contact].

## Who this notice covers

This notice describes information handled for workspace owners, authorized users and people answering surveys embedded by our customers. Customers choose their questions, audience, presentation, consent process and metadata. Likerts supplies collection, storage and management tools; it does not host respondent survey links or send survey invitations.

For respondent data, the organization presenting the survey is your first contact about why it collects information and how it uses your answers. Likerts processes that data to provide the customer's service. For account administration, billing and service security, Likerts determines the purposes described below. [OWNER: confirm controller/processor roles and applicable DPA with counsel; add the legal entity responsible for each role.]

## Information and purposes

| Information | Why it is handled |
| --- | --- |
| Account email, identity-provider identifiers, workspace membership and permissions | Sign-in, recovery, access control and account administration |
| Survey definitions, submitted answers and customer-supplied metadata | Publish customer configurations, validate submissions, store results and provide authorized retrieval/exports |
| Response IDs, acceptance times, retry records and usage/credit entries | Prevent duplicate acceptance, show usage, maintain balances and reconcile payments |
| Payment references, amounts, currency and payment/refund/dispute status | Complete Stripe-hosted checkout and reconcile purchased credits |
| Bounded service diagnostics, audit events and security-related request information | Operate, troubleshoot and protect the service |
| Information you voluntarily include in support requests | Investigate and respond to your request |

Stripe hosts payment entry. Do not send card details to Likerts support or put them into a survey. Identity and infrastructure providers may process additional technical information under their own terms. [VERIFY: inventory actual IP/user-agent, cookies, logs, checkout customer fields and their retention before publication.]

Customer metadata is supplied by the customer's application and is not proof of a respondent's identity, location or purchase. Respondents do not need a Likerts account. Avoid including sensitive information unless the organization collecting it has expressly explained the need and the applicable safeguards. [OWNER: approve supported data categories and restrictions.]

The collection service does not perform AI inference for each response. When a workspace user retrieves content through an external AI assistant, that assistant may receive the requested data under the user's permissions and its own service terms. Customers must review those tools and their transcript retention. [OWNER: approve a complete prohibition or other explicit policy for Likerts' own secondary data use, advertising and model training; do not infer one from current implementation.]

## Sharing and processing locations

Authorized workspace members and tools can access data within their granted permissions. Customers may configure signed callbacks containing event/resource identifiers and may download results into their own systems. Customers control those destinations and their subsequent use.

We use the service providers described in our [subprocessor list](subprocessors.md) for hosting, authentication, storage, abuse controls and payments. Current API compute and primary database placement are Singapore. Other provider processing may occur elsewhere; this is not a Singapore-only residency promise. [OWNER: complete verified locations, transfer safeguards, legally required disclosures and any corporate-transfer wording.]

## Retention and deletion

The intended launch retention settings are:

| Data | Period or treatment |
| --- | --- |
| Raw answers and client metadata | Default 90 days after acceptance; customer-configurable from 1 to 90 days |
| Generated exports | Authorized download expires 24 hours after job creation; deleted source responses revoke affected exports |
| Minimal retry receipts | Collection acceptance lifetime plus 30 days, subject to revocation; raw answers are not retained for this purpose |
| Rolling backups | Seven days; previously deleted values may remain until the applicable backup expires |
| Financial, deletion and audit records | Separately retained for accounting, security and applicable obligations; [OWNER: exact periods and grounds] |
| Identity, diagnostics and support records | [OWNER: approved category-specific retention and deletion rules] |

[VERIFY: scheduled deletion/export cleanup, seven-day managed backup configuration and restore-time deletion replay must pass before these settings are stated as operating guarantees. The 24-hour active deletion-processing target is not yet a verified service-level commitment.]

Deleting a workspace revokes collection and management access and erases raw responses and specified workspace content. Minimal structural, deletion and financial records remain; workspace deletion does not erase all accounting history or recreate the promotional grant. Copies already downloaded or held in a customer's app or external assistant are controlled by that customer or provider.

## Your choices and requests

Workspace owners can use the authorized management tools for available access, export and deletion operations. A respondent should contact the organization that presented the survey. If you cannot identify that organization, contact [OWNER: privacy contact] with the app/site name and approximate submission time; do not send sensitive answers or credentials. We will verify authority before disclosing data or changing an account.

[OWNER: add applicable access/correction/deletion/objection/portability rights, response periods, lawful grounds, representative/DPO and complaint authority after jurisdiction review. Add the actual age/children policy.]

## Security, cookies and changes

The application uses tenant-scoped authorization, restricted database roles and private authenticated exports. These controls do not establish a certification or an absolute security guarantee. [VERIFY: hosted operational controls and complete cookie/storage notice, including identity-provider authentication storage and customer-controlled offline queues.]

We will identify the effective version and communicate material changes using [OWNER: approved notice channel and lead time].
