# Shared-service economics and local performance

Generated 2026-09-08T14:12:09.831Z. This snapshot predates the selected free-onboarding policy. It models **US$0.01 per accepted completed response** without the one-time 1,000-response promotional grant, prepaid-credit conversion or repeated-workspace abuse. It must be extended and regenerated before it can support a margin claim. Historical dedicated-hosting estimates do not apply.

Scope limit: this measured/planning snapshot predates the separate response-callback worker. Its idle budget and break-even figures exclude callback worker tasks, callback queue/attempt storage and callback HTTPS/NAT egress. Those hosted quantities must be modeled and validated under OPS-02 before these figures can describe the complete current deployment; they are not assumed free.

## What the evidence says

The isolated ARM64 service accepted 100 requests/second for 30 seconds with p95 7.561 ms. That is a local Docker result with a 0.5-vCPU/1-GiB API, not an AWS SLA. The run accepted 4,026 responses, recorded exactly the same number of cents, and charged nothing for 2,200 invalid/unauthorized/oversized requests. A 25-response cap accepted exactly 25 of 200 concurrent attempts; 500 identical retries produced one accepted response. No 429s were observed in this snapshot: rejecting bad payloads is not proof of rate limiting.

| Local phase | Requests | Achieved requests/s | HTTP p95 | Status counts |
| --- | ---: | ---: | ---: | --- |
| paced-valid-100-rps | 3000 | 100.013 | 7.561 ms | {"200":3000} |
| burst-valid | 1000 | 620.579 | 178.389 ms | {"200":1000} |
| identical-retries | 500 | 808.715 | 139.632 ms | {"200":500} |
| invalid-answer | 1000 | 914.964 | 119.598 ms | {"400":1000} |
| unauthorized-token | 1000 | 4228.468 | 32.144 ms | {"401":1000} |
| oversized-body | 200 | 2010.922 | 25.175 ms | {"413":200} |
| response-cap-race | 200 | 1352.86 | 87.193 ms | {"200":25,"409":175} |

The six-question fixture is 871 bytes, including a 512-character pseudorandom comment and 128-character session metadata. PostgreSQL fsync, synchronous_commit and full_page_writes were on. Valid-traffic tenant relation growth was 1840.7 bytes per accepted response; the complete run generated 10,923,528 WAL bytes. Relation totals include indexes and allocation overhead; they are not a long-term vacuum/retention steady state.

CSV and JSON exports covered 4026 responses each. CSV was 3,865,017 bytes and ready in 260.617 ms; JSON was 4,127,648 bytes and ready in 223.555 ms. The current JSON/base64 response increases download wire size; the model uses that measured wire cost. Exports used local files, not S3. Resource readings in local-benchmark.json are snapshots, not peaks.

## Monthly planning result

Base assumptions: two ARM Fargate tasks (0.5 vCPU/1 GiB each), one db.t4g.medium **Multi-AZ SKU counted once**, 20 GiB minimum Multi-AZ gp3 storage, two NAT gateways, minimum four public IPv4 addresses, ALB, basic WAF budget, logs/secrets and explicit operations/capacity allowances. No free credits or transfer allowances are assumed. The modeled AWS idle budget is **$393.48/month** across the shared fleet, not per customer.

| Accepted responses/month | Usage revenue | AWS budget | Processing | Contribution before labor* | After budgeted labor* |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | $0.00 | $393.48 | $0.00 | $-493.48 | $-4,093.48 |
| 1,000 | $10.00 | $393.48 | $0.89 | $-484.42 | $-4,085.92 |
| 10,000 | $100.00 | $393.51 | $8.90 | $-402.91 | $-4,017.91 |
| 100,000 | $1,000.00 | $393.80 | $89.00 | $412.20 | $-3,337.80 |
| 1,000,000 | $10,000.00 | $396.66 | $890.00 | $8,563.34 | $3,463.34 |
| 10,000,000 | $100,000.00 | $551.48 | $8,900.00 | $89,948.52 | $71,348.52 |

*Contribution includes a provisional USD 100 identity budget and 0.5% uncollectible usage allowance. Budgeted labor adds 40 SDK-maintenance hours + 8 operations hours/month at USD 75/hour, plus 1.2 support minutes per active workspace; average workspace volume is 1,000 responses/month. These labor and identity numbers are assumptions, not actual expenses or a Clerk quote. This is not net business profit: tax, acquisition, sales, compliance and general company overhead are excluded.

Under these assumptions, service contribution turns nonnegative at approximately **55,000 responses/month**; including the stated labor budget requires approximately **542,000**. Task counts scale on an assumed 25× peak-to-average shape and 50 requests/s per task. The fixed database size and contingency have not been capacity-tested on RDS; high-volume rows are planning sensitivities, not validated margins.

## The expensive edges

The US domestic-card reference is 2.9% + USD 0.30 per successful payment ([Stripe pricing](https://stripe.com/pricing)). At USD 5 average settlement that consumes **8.9% of revenue**; at USD 1 it consumes **32.9%**; at USD 0.50 it consumes **62.9%**. Month-end hobbyist charges can therefore cost materially more than the optimistic USD 5 base case. Balances below the applicable processor minimum carry forward; usage revenue and cash collection are not the same event. Replace the US reference with the actual merchant country, currency, card mix and any additional billing-product fees before launch.

Support is equally material. At one million responses/month across 1,000 active workspaces, 1.2 support minutes/workspace costs USD 1,500; six minutes costs USD 7,500. All-five-SDK maintenance is a shared fixed labor obligation even when collection infrastructure is cheap.

Unpaid traffic produces no revenue. At 100,000 accepted responses/month, the model's AWS budget rises from $393.72 with no unpaid attempts to $847.03 with 1,000 unpaid attempts per accepted response. This is a conditional capacity/cost budget; real edge rejection, connection patterns and RDS load could change it substantially. Rate limits, caps and cost alerts are launch requirements.

The model conservatively adds a separate 512-byte receipt/accounting allowance for twelve planning months on top of the measured three-month raw-data footprint and 50% space slack. Twelve months is a sensitivity input, **not** an approved financial-retention policy. Retention, backup churn, bloat and non-response metadata must be measured over longer runs.

## Source-backed AWS inputs

AWS regional Price List API records were retrieved 2026-09-08T14:03:37.079Z. Each saved rate includes the SKU, exact price dimension, effective/publication dates and source URL in aws-prices.json. Rates below are USD public on-demand first-tier rates for Singapore. Multi-AZ instance/storage rates already include the standby.

| Input | USD rate | Official regional source/SKU |
| --- | ---: | --- |
| fargateArmVcpuHour | 0.04045 / hours | [SFSC5A7DP37FRTNX](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ap-southeast-1/index.json) |
| fargateArmGbHour | 0.00442 / hours | [U4BJMTG9K96ZW3HA](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ap-southeast-1/index.json) |
| rdsT4gMediumMultiAzHour | 0.203 / Hrs | [3G8THFFBJ944M2HP](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-southeast-1/index.json) |
| rdsGp3MultiAzGbMonth | 0.276 / GB-Mo | [BGF4DVRTWCBBXHUW](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-southeast-1/index.json) |
| rdsExcessBackupGbMonth | 0.095 / GB-Mo | [9XF3U4K57MG3MUFQ](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-southeast-1/index.json) |
| albHour | 0.0252 / Hrs | [UXD3JNG6UAM79CW6](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ap-southeast-1/index.json) |
| albLcuHour | 0.008 / LCU-Hrs | [45KY3J5YX2QM6KS7](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ap-southeast-1/index.json) |
| s3StandardGbMonth | 0.025 / GB-Mo | [M6MTARCQFUQBQ2V3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-southeast-1/index.json) |
| s3PutRequest | 0.000005 / Requests | [VHRJWKRHEA6VHEFY](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-southeast-1/index.json) |
| s3GetRequest | 4e-7 / Requests | [T469UNPYX78434EG](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-southeast-1/index.json) |
| natGatewayHour | 0.059 / Hrs | [98TA3WPUP3A4AH4Y](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-southeast-1/index.json) |
| natGatewayGb | 0.059 / GB | [E9U985ZGMWKXKT47](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-southeast-1/index.json) |
| publicIpv4Hour | 0.005 / Hrs | [C8D8VMQRDHMB9KRU](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/ap-southeast-1/index.json) |
| internetEgressGb | 0.12 / GB | [SDHP4R7WGBVJPQPY](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-southeast-1/index.json) |
| logIngestGb | 0.7 / GB | [ZEKCE7VGMSM5XZPW](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-southeast-1/index.json) |
| logStoredGbMonth | 0.03 / GB-Mo | [RKCBFFXUWXG8KUQY](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-southeast-1/index.json) |
| secretMonth | 0.4 / Secrets | [J5PMSXRJZ3HNHFEV](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/current/ap-southeast-1/index.json) |
| secretApiRequest | 0.000005 / API Requests | [KAUJ7G87ND7HD8N8](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/current/ap-southeast-1/index.json) |

Basic WAF uses published [ACL/rule/request prices](https://aws.amazon.com/waf/pricing/); its configuration and other quantities are planning assumptions. ALB uses the maximum connection/active-connection/byte dimension with an intentionally conservative peak-hour budget across the month ([capacity pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)). No premium managed rules, CAPTCHA or bot-control products are included.

## Reproduce and finish validation

Run `bash scripts/benchmark-local.sh` for a fresh image, isolated database and benchmark. For the unchanged tested image only, `LIKERTS_SKIP_IMAGE_BUILD=1 bash scripts/benchmark-local.sh` skips compilation. Run `node economics/refresh-aws-prices.mjs` to refresh the exact official SKUs, then `node economics/shared-model.mjs` to regenerate this report and shared-results.json. shared-assumptions.json exposes every unmeasured quantity; shared-results.json contains payment, abuse and support sensitivities.

Local load/accounting/cap/export/storage evidence is complete for this fixture. Remaining OPS-02 evidence needs representative AWS staging: TLS/ALB/WAF path, multi-replica routing, RDS latency/CPU credits/IOPS/Multi-AZ, sustained load and maintenance cycles, S3 lifecycle/downloads, failover, actual CloudWatch metering and AWS cost reconciliation. Merchant and identity quotes and real customer traffic/support data remain commercial validation inputs. No AWS resources were provisioned for this analysis.
