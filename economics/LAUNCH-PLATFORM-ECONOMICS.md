# Render + Vercel + Clerk launch economics

Model date 2026-09-09. This is a reproducible planning model, not a provider bill or capacity result. It uses conservative published regional Blob maxima where Singapore varies, Clerk Hobby for passwordless email OTP, Render list prices, and the US domestic-card Stripe reference. Taxes, Render workspace fees and bandwidth, support, labor, compliance, abuse, Clerk add-ons and vendor overages are excluded.

The fixed platform floor is **$206.00/month**: two Render API instances ($50), one remote MCP gateway ($7), one callback worker ($7), PostgreSQL primary plus HA standby ($110), two 20 GB database volumes ($12), Vercel Pro ($20 including its usage credit), and Clerk Hobby ($0). The MCP gateway is isolated from database and provider secrets. The inert migration cron has no standing compute allocation; actual executions and Render workspace charges must be measured.

| Accepted | New workspaces | Free responses used | Usage revenue | Blob planning cost | Contribution before labor |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1 | 1,000 | $0.00 | $0.00 | $-206.00 |
| 10,000 | 10 | 10,000 | $0.00 | $0.01 | $-206.00 |
| 100,000 | 25 | 25,000 | $750.00 | $0.10 | $477.25 |
| 1,000,000 | 100 | 100,000 | $9000.00 | $0.96 | $7993.00 |

A verified workspace receives one nonrenewing 1,000-response grant. The model treats its **$10 face value** as forgone revenue, not a $10 cash expense. It bills only accepted responses above the aggregate grants. A $5 purchase adds 500 credits; the 2.9% + $0.30 reference consumes **8.9%** of a $5 payment. Actual processor geography and payment mix must replace this reference before launch.

Anonymous respondents do not consume Clerk operator MRUs. Clerk Hobby supplies passwordless email OTP and the model assigns it $0/month. Passkeys require the optional **+$25/month** Pro upgrade and are excluded from the launch floor. Enterprise connections and production entitlement details require a quote/check before enabling them.

Blob cost uses the measured JSON export size (1025.25 bytes/response), three copies, one-day retention, one authenticated download, and conservative published regional rates. Vercel's $20 usage credit absorbs the modeled Blob amount in these rows. Private Blob remains a provider dependency and its Rust control protocol is pinned and locally contract-tested; a provider sandbox is still required.

Sources: [Render pricing](https://render.com/pricing), [Render HA](https://render.com/docs/postgresql-high-availability), [Vercel pricing](https://vercel.com/pricing), [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing), [regional pricing](https://vercel.com/docs/pricing/regional-pricing), [Clerk pricing](https://clerk.com/pricing), [Stripe pricing](https://stripe.com/pricing).
