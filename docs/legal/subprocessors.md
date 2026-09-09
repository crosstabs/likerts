# Service providers and subprocessors

**Pre-launch draft for owner/legal review — not a finalized contractual list.** Last reviewed: 9 September 2026.

This inventory describes the selected Likerts service. Provider legal entities, data roles, contracts and all processing locations require owner verification before publication. A marketplace purchase does not mean Vercel operates every connected provider.

| Provider/service | Service role and anticipated information | Verified placement/status | Owner review required |
| --- | --- | --- | --- |
| Render | API, MCP and callback-worker compute; processes service requests and authorized survey/account data | Singapore compute is deployed | Contracting entity, DPA, logs/support locations, subprocessors and retention |
| Neon | Primary PostgreSQL storage for surveys, responses, access, credit and audit records | Singapore database through Vercel Marketplace | Contracting entity, DPA, backup/restore configuration, support locations and transfers |
| Vercel | Control-plane hosting and private Blob exports; website/authentication requests and generated export contents | Control plane/private Blob connected | Contracting entity, CDN/Blob processing locations, DPA, logs and actual object expiry |
| Clerk | Account authentication, email OTP, identity identifiers and session infrastructure | Production custom domain configured | Contracting entity, DPA, email/identity processing locations, retention and downstream providers |
| Stripe | Hosted payments, payment identifiers and purchase/refund/dispute processing | Checkout and full refund verified in test mode | Live merchant entity/account, geographical availability, controller/processor roles, terms and retention |
| Upstash | Connected admission/rate-control resource; expected bounded counters and request identifiers | Marketplace resource connected | Actual production request path and stored fields, region, retention and whether it is an active subprocessor |

Render and Neon Singapore placement does not guarantee that account, authentication, payment, diagnostic, CDN or support data remains in Singapore. [OWNER: document each approved location and applicable transfer mechanism.]

Customer-selected external AI assistants, SDK host applications and callback receivers can receive information when the customer configures or authorizes them. Their providers are selected by the customer and should be evaluated separately. Source-code/build tooling should be added to this list if it actually receives customer personal data; repository access alone does not establish that role.

AWS is not part of the selected launch topology. An optional AWS infrastructure implementation in the repository is not evidence of active customer-data processing.

[OWNER: publish provider legal names, finalized DPAs/data roles, the provider-change notice period/channel, objection/request process and contact. Do not imply an executed DPA or transfer safeguard from this inventory.]

Provider reference pages: [Render privacy](https://render.com/privacy), [Neon product terms](https://neon.com/platform-terms), [Clerk privacy](https://clerk.com/legal/privacy). These must be supplemented with the actual account contracts and vendor inventories held by the owner.
