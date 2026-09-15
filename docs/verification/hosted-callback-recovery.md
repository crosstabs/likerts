# Hosted callback recovery, DNS and rollback drill

Verified 15 September 2026 against exact source `6afda66a452e6c498a31125edc1c1393bb76aea6`. The isolated H06 fixture passed abrupt worker loss, a real expired callback lease, compatible Render rollback, hostile DNS answers and restored delivery. The fixture used one new Free Render web service, one new Free PostgreSQL 16 database, temporary Vercel preview receiver deployments and one fresh leaf under `likerts.com`. Production services, databases and application domains were not changed.

## Worker loss and callback recovery

The hosted supervisor ran released runtime `0.1.2` with separate native API and callback-worker children. The receiver held the first valid reply while the worker had a committed 30-second delivery lease. The controller verified the exact live Render instance and child identity, sent SIGKILL only to that worker child, and observed its replacement in the same supervisor boot while API requests continued.

The abandoned first attempt remained attached to the same event and delivery until its real lease expired. It then became `expired` with `worker_lease_expired`; attempt two used a different attempt ID and delivered HTTP 204. The signed receiver retained exactly one distinct event. The two attempts did not create two receiver records, and an identical response submission returned the original receipt.

| Check | Observed result |
| --- | --- |
| Delivery lease | 30 seconds, observed running before SIGKILL |
| Worker replacement | Generation 1 → 2; API stayed generation 1 |
| First attempt | `expired`, `worker_lease_expired` |
| Second attempt | `delivered`, HTTP 204 |
| Durable identity | Same event and delivery IDs across both attempts |
| Receiver result | One signed event, no duplicate receipt |

## Compatible hosted rollback

A separate fresh fixture at the same source ran the sequence runtime `0.1.1` → `0.1.2` → Render rollback to `0.1.1`. All 27 database migrations and their checksums remained unchanged. Three synthetic responses survived the sequence; idempotent retries returned the original receipts. Export hashes and decoded answers matched after rollback, a revoked credential still returned 401, and an already revoked export remained unavailable with its deletion journal intact.

The older runtime's previously documented erasure-archive journal gap still exists, so this is compatible runtime rollback evidence rather than hosted archive/PITR evidence. H03 remains responsible for the recovery cut, quarantine restore, replay and safe reopening.

## Denied, mixed and restored DNS

The DNS drill created only `callback-drill-944198aa5a93f700.likerts.com`; the apex, `www`, mail, Clerk, wildcard and nameserver records were untouched. Before mutation, A, AAAA and CNAME records for the leaf were empty. The controller attached the leaf to the isolated signed Vercel receiver, confirmed TLS and an authenticated empty event log, then exercised these authoritative A answers with TTL 600:

| Phase | Authoritative and public answer | Worker result | Receiver result |
| --- | --- | --- | --- |
| Denied | `127.0.0.1` | One terminal attempt, `endpoint_address_denied` | Zero requests |
| Mixed | `76.76.21.21` plus `127.0.0.1` | One terminal attempt, `endpoint_address_denied` | Zero requests |
| Restored | `76.76.21.21` | One attempt delivered HTTP 204 after cache expiry | One request; signature verified |

The mixed phase used a fresh worker generation after all four observed authoritative/public resolvers returned both addresses. Because every resolved address must be public, the one loopback answer failed the whole delivery closed. After restoring the public answer, all four external resolvers returned only the public address while Render's recursive resolver still retained the prior mixed result. A fresh delivery remained denied during that cache window. After the full 600-second TTL elapsed, another fresh response delivered once. This records both fail-closed behavior and the real recovery delay imposed by DNS caching; a provider DNS change is not an instant recovery guarantee.

Vercel rejected adding a protection exception to the production-class custom alias because the existing project policy is `all_except_custom_domains`; custom domains were already excluded. The generated preview alias retained its scoped exception for administrative receiver reads. No global protection setting was changed.

## Cleanup and scope

The endpoint was revoked with zero queued/running deliveries and its fixture credential returned 401. Cleanup then removed the exact leaf record, Vercel custom domain and alias, generated receiver alias, two receiver deployments, four temporary preview variables, Free Render service and Free PostgreSQL database. Both authoritative nameservers and two public resolvers returned no A record. Fresh provider reads returned 404 for both Render resources, the receiver project's original variables/protection/aliases were restored, and all three recorded production deployment IDs remained unchanged and live.

The synthetic fixtures contained survey IDs, response IDs, ratings and test metadata only. Private credentials, provider receipts and raw logs remain outside Git. This evidence closes the bounded H06 worker-loss, callback reclaim, compatible rollback and DNS-drill deliverable. It does not establish Neon PITR, scheduled monitoring, alert acknowledgment, multi-instance failover, unrestricted hosted capacity or an availability promise; H03–H05 remain open.
