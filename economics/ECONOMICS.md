# Superseded enterprise economics — $5 setup, $0.01 per response

**Historical scenario only.** The user has replaced dedicated enterprise hosting with a shared MCP/API/CLI collection service. These per-customer hosting budgets and break-even results do not apply to the current MODEL.md. Keep this report only as a record of the prior architecture.

The current analysis is [SHARED-ECONOMICS.md](SHARED-ECONOMICS.md), backed by local PostgreSQL load evidence and explicit regional price inputs.

Model date: 6 September 2026. All amounts USD unless stated. $5 is a proposed one-time provisioning fee, not a subscription or response credit. Responses are completed, accepted submissions; retries do not earn revenue. Every customer retains a dedicated deployment. These are scenario estimates, not a measured cloud bill or a forecast of demand. No free tiers, promotional credits, reserved-instance discounts or indefinite suspension savings are assumed.

## Decision

At meaningful volume, one cent can support dedicated infrastructure. At low or zero volume, the present always-on design loses money. The $5 fee does not solve the recurring cost floor. The business can still work by deliberately subsidizing low-volume clients from larger clients, but the customer mix and lifetime retention then determine viability. Do not claim the combination is profitable for every customer.

## Sources and what they establish

Checked on the model date. Source prices are anchors, not a complete approved deployment design.

| Input | Public price / fact | Source |
| --- | --- | --- |
| Lightsail database | Encrypted 2 GB plan: $30/month standard, $60/month HA. The $15 standard plan has no data encryption and is excluded. | [AWS Lightsail](https://aws.amazon.com/lightsail/pricing/) |
| App / load balancer reference | AWS example lists $7/month nano container and $18/month load balancer. Nano capacity is not benchmarked for Likerts. | [AWS Lightsail](https://aws.amazon.com/lightsail/pricing/) |
| Encryption key | Customer-managed KMS keys generally cost $1/key/month; requests and rotation can add charges. | [AWS KMS](https://aws.amazon.com/kms/pricing/) |
| Email | SES outbound base rate $0.10/1,000 emails; attachments and optional features extra. Standard dedicated IP: $24.95/month/IP. | [AWS SES](https://aws.amazon.com/ses/pricing/) |
| Payments, US reference | Domestic card processing 2.9% + $0.30 per successful payment. Model assumes one aggregated monthly usage payment for positive usage, not one payment per response. | [Stripe US](https://stripe.com/pricing) |
| Merchant-country sensitivity | Singapore page lists 3.4% + S$0.50. Do not mix SGD fixed fees into USD calculations. Merchant location, settlement currency and card mix remain undecided. | [Stripe Singapore](https://stripe.com/en-sg/pricing) |
| SSO vendor sensitivity | WorkOS lists entry-tier SSO at $125/connection/month with volume tiers. Model uses $0 incremental connection licence in its base and explicitly tests +$125; this requires a maintained self-hosted or differently priced solution, not free enterprise identity operations. SCIM may add another separately billed connection. | [WorkOS](https://workos.com/pricing) |
| Database sleep | Aurora supports automatic pause for compatible configurations; minimum idle interval 5 minutes, typical resume around 15 seconds and potentially longer after extended pause. | [AWS Aurora pause/resume](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html) |

US AWS price references are illustrative; obtain regional quotes for Singapore or any promised residency. Taxes, FX and optional payment/billing products are excluded.

## Dedicated hosting budgets

| Monthly USD per customer | Lean sensitivity | Working case | Higher-cost sensitivity |
| --- | ---: | ---: | ---: |
| Application and workers | 7 | 30 | 100 |
| Dedicated database | 30 | 60 | 150 |
| Ingress / networking | 18 | 30 | 75 |
| Backup/storage floor | 5 | 20 | 50 |
| Keys / secrets | 3 | 5 | 10 |
| Logs / monitoring | 7 | 25 | 65 |
| Provisioning / control services allocation | 5 | 30 | 50 |
| **Infrastructure total** | **75** | **200** | **500** |

The $7, $30 and $60 component anchors above come from AWS; all other allocations are explicit planning assumptions. They are not vendor package quotes. The $75 case has a single app and non-HA database and cannot inherit an HA promise. The $200 case allows more capacity and redundancy but is not a verified production bill. Customer-managed-key support, private routing, identity runtime, regional availability and deployment topology must be verified against the chosen services; Lightsail prices alone do not demonstrate compliance with MODEL.md. Dedicated cloud resources do not imply exclusive physical hardware.

Fixed compute is not unlimited capacity. The volume tables assume the selected budget plus marginal allowance can serve the workload; peak traffic may require a larger cost scenario or a measured step increase. One million submissions evenly spread over a month differs from a short campaign burst.

## Variable and people costs

Base variable reserve: **$0.0005 per response**, or **$50 per 100,000**. This is an assumption to benchmark, composed of:

- $0.00010 incremental processing / database I/O above fixed capacity.
- $0.00012 retained storage: 10 KB logical payload × 4 storage multiplier × 12 months × assumed $0.25/GB-month blended rate, using decimal GB. This is an amortized retention reserve, not the current month's exact cloud cash bill. Existing retained data still costs money after collection stops.
- $0.00010 traffic / exports: assumed 0.001 GB egress per completion × $0.10/GB; visits, retries and exports included in this assumed ratio.
- $0.00008 incremental logs, requests and abuse reserve.
- $0.00010 email: one SES base-rate email per completed response.

Fixed included storage/transfer allowances can overlap these reserves, so this is a conservative allowance model rather than an exact provider billing calculator. Unbounded unanswered visits, bots, emails or exports are not bounded by completed-response revenue. Separately metering or limiting them is a product decision; this model does not silently impose fees.

Direct support/operations: **$20/customer/month**, an assumed 12 minutes at $100/hour. Includes routine customer support and fleet operations labour, not engineering salaries. Dedicated security-review and onboarding labour are evaluated separately below. $0 incremental SSO licence does not mean $0 implementation or maintenance expense.

Company overhead: **$10,000/month**, illustrative, covering engineering/identity maintenance, common security/compliance work, sales/admin and general overhead not already counted above. This is a sensitivity input, not a SOC 2 quote or a realistic staffing guarantee. At 100 customers the allocation is $100/customer/month; at 10 it is $1,000. Customer acquisition and customer-specific onboarding are additional one-time costs.

## Equations

For a month after setup, N is responses, p = $0.01, f = 2.9%, q = $0.30, v = $0.0005, F = infrastructure, S = SSO licence and H = direct support:

```
Revenue = N × p
Payment cost = Revenue × f + (q if N > 0 else 0)
Infrastructure margin = Revenue − Payment cost − N × v − F − S
Customer contribution = Infrastructure margin − H
Operating result = sum(Customer contributions) − Company overhead
Break-even responses = ceil((F + S + H + q) / (p × (1 − f) − v))
```

Setup is excluded from recurring margin. Cash timing differs with prepaid wallets, invoice terms, failed collections and storage reserves. A billing aggregation threshold does not need to be a minimum usage commitment, but creates receivables or prepaid liabilities. Never charge a card separately for each 1-cent response.

## Monthly outcomes, working case

$200 infrastructure + $20 support; no incremental SSO licence; $0.0005 variable cost; US reference payment fees. Contribution excludes company overhead and setup.

| Responses per customer/month | Revenue | Customer contribution |
| --- | ---: | ---: |
| 0 | $0 | −$220.00 |
| 100 | $1 | −$219.38 |
| 1,000 | $10 | −$211.09 |
| 10,000 | $100 | −$128.20 |
| 100,000 | $1,000 | $700.70 |
| 1,000,000 | $10,000 | $8,989.70 |

The last row is conditional on capacity; it is not a throughput claim.

| Infrastructure budget | Infrastructure break-even | Including $20 direct support | Including support + $100 overhead allocation |
| --- | ---: | ---: | ---: |
| $75 | 8,176 responses | 10,348 | 21,206 |
| $200 | 21,749 responses | 23,920 | 34,778 |
| $500 | 54,322 responses | 56,493 | 67,351 |

Working-case contribution margin at 100,000 responses is 70.07%. Reaching 80% contribution margin needs about 182,067 responses/month at the same cost assumptions, before company overhead.

## $5 setup fee

Processing leaves $4.555. Assuming automated provisioning consumes $1 of incremental work, net setup contribution is **$3.555**. That covers about half a day of the $200/month infrastructure floor, using 30 days/month. At zero usage over 12 months, the working-case lifetime contribution before company overhead is **$3.555 − 12 × $220 = −$2,636.445**.

The $1 provisioning cost is unverified and excludes sales/security review. A two-hour assisted onboarding at assumed $100/hour adds $200 cost, requiring roughly 21,716 additional responses to recover at the base marginal contribution. A 10-hour procurement/security process adds $1,000 and requires about 108,578 additional responses. Neither labour estimate is a market fact. Every $100 of extra fixed monthly cost needs approximately 10,858 extra responses/month.

## Customer mix and idle subsidy

For 100 customers on the working case:

- All 100 at 100,000 responses/month: $100,000 revenue, $70,070 customer contribution, **$60,070 operating result** after $10,000 overhead.
- Ten at 100,000 responses/month and 90 idle: $10,000 revenue, **−$22,793 operating result** after overhead.
- With 100,000 responses per active customer, at least **35 of 100** must be active to cover this fleet and the $10,000 overhead. No setup fees counted; the cohort is mature.

This illustrates why the mean, active share, retention and churn matter. It is not a customer forecast. A fleet can be profitable despite some unprofitable clients, but newly acquired idle clients increase recurring obligations.

## Sensitivities that can change the result

- **SSO at +$125/month:** working-case customer break-even rises to 37,492 responses/month. Use actual volume-tier pricing for a large fleet rather than multiplying the entry price blindly.
- **Invitation conversion:** one invitation per completion costs $10/100k responses; 10 invitations costs $100; 100 invitations costs $1,000. At the last ratio the assumed marginal cost exceeds the 1-cent selling price even before fixed costs and payments. QR traffic avoids invitation sending cost, but still has visits and abuse exposure.
- **Support:** 1 hour/client/month at $100/hour adds $80 above the base, raising break-even by about 8,686 responses.
- **Retention:** doubling retention doubles the storage reserve component; it does not double all costs. Indefinite retention creates indefinite obligations with finite revenue.
- **Payment geography:** adjust both percent and fixed charge in a consistent currency. International cards, currency conversion, chargebacks, failed payments and optional billing products can add costs.
- **Enterprise requirements:** dedicated NAT, WAF, SIEM ingestion, premium support, multiple regions, dedicated email IPs, longer backups or higher HA can exceed the $500 case. No upper bound is claimed.

## Suspension is an experiment, not an assumed saving

A dedicated serverless database can stop charging for compute while paused, but storage, keys, logs and other resources persist. Traffic, open connections and background jobs can prevent pausing. A five-minute idle timeout is significant when sparse responses arrive throughout the day. Aurora's typical ~15-second resume delay can affect the first submission. Serving a static form does not guarantee its response can be durably accepted while the database sleeps. Adding a durable queue changes the current atomic acceptance/credit contract and requires explicit design and testing.

For any proposed sleeping design, measure awake hours, cold-start latency, residual monthly cost, pending job behavior and recovery. Do not weaken the confirmed dedicated boundary to obtain a cheap estimate.

## What to validate before publishing the price promise

Provision one representative isolated environment, measure an idle week and a realistic burst/load run, and obtain regional component prices. Record cost per retained GB, completed response, unanswered visit, invitation and export. Verify identity licensing and onboarding labour. Test restore and first-response latency after inactivity. Then model an actual expected customer mix and retention policy. The current evidence supports pursuing 1-cent usage pricing; it does not establish that $5 plus usage can sustainably include forever-on dedicated infrastructure for every hobby customer.

Reproduce calculations: `python3 economics/model.py`. Outputs: `results.json` and `scenarios.csv`. The executable model checks zero-usage payment behavior, base contribution and break-even boundaries.
