# Launch economics: costs, free allowance and prepaid usage

Model date 2026-09-10. The existing fully allocated platform assumption remains **$125.39/month**, or **$80.39/month** if the existing Render Pro and Vercel Pro subscriptions are treated as sunk costs. This is a planning floor, not a current invoice or volume guarantee. One-cent pricing must cover free usage, request traffic and support as well as accepted paid responses.

## Current provider state and admission ceiling

The parent operator verified the Vercel store `likerts-production-admission` on September 10: **Free**, primary `iad1`, no read regions, auto-upgrade disabled, eviction disabled. No paid upgrade was made. Its current command usage was not retrieved. The published Free allowance is 500,000 commands/month, 256 MB and 10 GB bandwidth; the paid comparison is $0.20/100,000 commands and Fixed 250 MB is $10/month without per-command billing. Paid command pricing starts from the first command; do not subtract a Free allowance from PAYG. [Upstash pricing](https://upstash.com/pricing/redis)

A single HTTP EVAL is not a single billed command. Upstash's own cost tables count EVAL plus executed nested commands. Our `backend/src/admission.rs` script costs **3 commands** for a new window or a Redis denial, and **4 commands** for a continuing allowed check. Local rejection costs zero Redis commands; health and unmatched routes bypass this layer. [Upstash command accounting](https://upstash.com/docs/redis/sdks/ratelimit-ts/costs)

With a completely unused quota and no other commands, that permits **125,000–166,666 Redis-reaching checks**, not accepted responses. At 80% quota with a 10,000-command planning reserve, the conservative budget is **97,500 checks**. SDK reads, duplicate retries, invalid requests, console/API/MCP traffic and shared-store fixture/administrative operations use that budget too. Actual remaining headroom must subtract metered commands. Exhaustion/network failure causes production admission 503; a zero-dollar plan does not mean unlimited service. The confirmed US-region dependency adds a round trip from Singapore and needs latency acceptance.

## Existing comparisons, now qualified

These rows retain the previous aggregate-grant arithmetic and fixed-provider assumptions for comparison. The payment column is a steady-state fee equivalent at $5 top-ups, not a cash forecast. The Free quota status uses the request assumptions below and is not permission to serve volumes above its allowance.

| Accepted/month | New workspaces | Assumed grants consumed | Paid usage value | Equivalent processing | Baseline platform | Current Free command feasibility |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1,000 | 1 | 1,000 | $0.00 | $0.00 | $125.39 | within estimated command quota |
| 10,000 | 10 | 10,000 | $0.00 | $0.00 | $125.39 | within estimated command quota |
| 100,000 | 25 | 25,000 | $750.00 | $66.75 | $125.39 | depends on actual command mix |
| 1,000,000 | 100 | 100,000 | $9000.00 | $801.00 | $125.39 | exceeds command quota |

The baseline uses Render $90 (API $50, MCP $7, callback worker $7, cron $1, Pro $25), representative Neon $15.39, Vercel Pro $20 and Clerk Hobby $0. These prior inputs are dated 2026-09-09; this update rechecked admission pricing and does not independently reconcile every existing subscription/invoice. The incremental figure removes only already-paid Render/Vercel base subscriptions, not their usage. Optional passkeys/enterprise entitlements remain separate.

## Conditional cost range, without a margin claim

The following paid-admission scenarios show a range rather than asserting profitability. Low traffic assumes 0.02 duplicate retries, 0 invalid requests and 0.1 collection reads per accepted response plus 10 management calls/new workspace. High traffic assumes 0.5 duplicates, 10 invalids and 1 read plus 50 management calls/new workspace. Both assume zero local rejections, so every modeled attempt reaches Redis. A 10,000-command reserve is added. The support range is 0.2–6 minutes/active workspace at $75/hour, with 48 shared SDK/operations hours ($3,600/month). Workspace counts are assumed from 1,000 responses/active workspace, not observed customers.

| Accepted/month | Assumed active workspaces | Platform + fee equivalent + PAYG admission | Including stated support and shared labor |
| ---: | ---: | ---: | ---: |
| 1,000 | 1 | $125.42–$125.51 | $3725.67–$3733.01 |
| 10,000 | 10 | $125.48–$126.41 | $3727.98–$3801.41 |
| 100,000 | 100 | $192.83–$202.17 | $3817.83–$4552.17 |
| 1,000,000 | 1000 | $933.14–$1026.45 | $4783.14–$12126.45 |

This range is **not** a confidence interval or total operating-cost bound. Render CPU/egress, Neon storage/compute growth, webhook attempts, host/function traffic and other vendor overages do not scale automatically in this small model. Large-volume rows require capacity and billing measurement. Included Vercel usage credit is assumed otherwise available; other projects may consume it.

## Grants belong to individual workspaces

Grant face value is forgone potential usage revenue, not cash expense. A new workspace receives 1,000 nonrenewing credits, and unused credits can carry into later months; no expiration/breakage is assumed. Simply subtracting `newWorkspaces × 1,000` from total responses can understate paid use and ignores returning-workspace free balances. Use `workspaceCohorts` or an explicit measured `grantResponsesUsed` input.

| Distribution (10,000 accepted in each case) | Free consumed | Paid consumed | Free balance remaining |
| --- | ---: | ---: | ---: |
| Ten new workspaces each use 1,000 responses | 10,000 | 0 | 0 |
| One new workspace uses 10,000; nine use none | 1,000 | 9,000 | 9,000 |
| Returning ten workspaces consume 400 remaining free credits each | 4,000 | 6,000 | 0 |

## Cash arrives before consumption

`prepaidFlow` separately records purchases, fees, consumption and remaining paid credits. It rejects modeled paid acceptance beyond available credits. A $5 purchase adds 500 credits and incurs $0.445 under the retained US 2.9% + $0.30 reference (8.9%). There is no implicit minimum monthly spend or automatic charge. Actual merchant country, fees, refunds/disputes and tax must replace that reference; this is a commercial unit model, not an accounting-policy conclusion.

| Example | Cash collected now | Paid usage value now | Processing now | Closing unused paid-credit value |
| --- | ---: | ---: | ---: | ---: |
| Buy now, consume some | $50.00 | $1.00 | $4.45 | $49.00 |
| Use credits purchased earlier | $0.00 | $50.00 | $0.00 | $0.00 |

Unspent prepayments are future service obligations, not current response usage. Using old credits earns usage value without new cash or new payment fees in that month. The default fee-equivalent rows cannot be used to forecast runway.

## Abuse and support sensitivity

At 100,000 accepted responses/month and 25 new workspaces, with the baseline duplicate/read/setup assumptions:

| Invalid attempts per accepted | Checks reaching Redis | Billed command range | PAYG command cost |
| ---: | ---: | ---: | ---: |
| 0 | 135,500 | 416,500–552,000 | $0.83–$1.10 |
| 1 | 235,500 | 716,500–952,000 | $1.43–$1.90 |
| 10 | 1,135,500 | 3,416,500–4,552,000 | $6.83–$9.10 |
| 100 | 10,135,500 | 30,416,500–40,552,000 | $60.83–$81.10 |

The implemented local per-process limits bound normal Redis dispatch (current defaults total 50 checks/s per API process). With 2 stable processes and 30 days, a sustained attack could still approach **259,200,000 checks**, or **$2073.60 in command charges** at the conservative 4-command mix, before other costs. This is a static no-restart/config-change ceiling, not a guaranteed bill cap or throughput result. Free quota could be exhausted much earlier. A provider budget/approved fixed plan and monitoring are separate decisions; no upgrade is implied by this model.

| Support minutes/active workspace | Assumed active workspaces | Support budget/month | Shared SDK/operations labor/month |
| ---: | ---: | ---: | ---: |
| 0.2 | 100 | $25.00 | $3600.00 |
| 1.2 | 100 | $150.00 | $3600.00 |
| 6 | 100 | $750.00 | $3600.00 |

Rate limits bound work and spending at the cost of availability. They do not remove Render ingress/connection costs or support/abuse handling. A real request/command histogram, workspace activation distribution and support time log are needed to narrow these sensitivities.

## Evidence and exclusions

Hosted private Blob create/download and deletion-triggered export revocation are already recorded in [hosted evidence](../infrastructure/render/hosted-evidence.json); a provider sandbox is no longer an uncompleted prerequisite. These tests establish functional paths, not monthly cost, expiry cleanup or failover. The model retains 1025.25 JSON bytes/response, 3 export copies, one-day retention and one download as explicit workload assumptions. Allocation/egress differences and actual invoices remain unmeasured.

Excluded from the displayed totals: tax, sales/acquisition, general overhead, compliance/legal work, refund/dispute losses and fees, incident labor outside the stated budget, abuse bandwidth/compute scaling, callback queue growth/egress, provider metering changes, paid Clerk features, extra Redis regions/Prod Pack, and backup/recovery costs beyond the retained Neon allowance. There is no profitability or SLA claim.

Reproduce with `node economics/launch-platform-model.mjs` and `node --test economics/launch-platform-model.test.mjs`. Inputs and per-scenario outputs are saved in adjacent JSON. Attach the sustained hosted runner's actual requests/statuses/latencies and provider command deltas when available; do not infer full-month scale from the bounded run.

Retained provider references: [Render](https://render.com/pricing), [Neon](https://neon.com/pricing), [Vercel](https://vercel.com/pricing), [Blob](https://vercel.com/docs/vercel-blob/usage-and-pricing), [regional rates](https://vercel.com/docs/pricing/regional-pricing), [Clerk](https://clerk.com/pricing), [Stripe](https://stripe.com/pricing).
