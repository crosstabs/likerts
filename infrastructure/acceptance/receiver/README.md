# Isolated hosted failure-drill receiver

This temporary Node 22 Vercel fixture supports the callback process-loss procedure in [HOSTED-FAILURE-DRILL.md](../../../docs/operations/HOSTED-FAILURE-DRILL.md). It is not a production callback default, customer webhook product or alert destination. Nothing here deploys itself, sends callbacks, creates accounts or changes provider resources.

Provenance: the bounded signed receiver at commit `5602367` was removed in free-community commit `3593ac5`. This fixture retains its HMAC, authenticated observation and atomic Redis storage design. It replaces the historical paid-credit-only payload with the current `response.accepted` contract; credit thresholds are intentionally not accepted or simulated. This source restoration is not evidence that the earlier receiver remains deployed.

## Verified receipts and optional hold

`POST /api/receive` accepts only the exact [current webhook envelope](../../webhooks/README.md), event version 1 and `response.accepted` type. Its data contains precisely `responseId`, `collectionId`, `surveyId` (UUIDs) and a positive PostgreSQL integer `surveyVersion`. The raw-byte HMAC-SHA256, known key ID, five-minute signature window, UUID delivery headers and matching header/body event ID are checked before decoding and storage. Extra fields, answers and metadata are rejected. PostgreSQL RFC3339 fractional timestamps and offsets are accepted.

Redis atomically deduplicates, enforces capacity and stores a verified receipt before acknowledgment. The receipt is the observable marker: authenticated `GET /api/events` returns event/delivery/first-attempt IDs, `eventType`, `signatureVerified: true` and the four validated response fields. It never returns raw payload bytes, signatures, signing keys, administrator tokens or provider errors. The distinct-event count is not an HTTP-attempt count.

By default, both new and duplicate verified receipts return an empty 204 immediately after the Redis acknowledgment. Set **`LIKERTS_ACCEPTANCE_HOLD_FIRST_RECEIPT=1` only on a separate isolated drill deployment** to withhold the first new receipt's 204 for exactly eight seconds after atomic insertion. The marker is already readable during the hold. Every duplicate of that event returns 204 after its Redis acknowledgment, without entering the hold or replacing the original marker. Each distinct new event can hold once; use only the one planned synthetic event in the process-loss drill. After the one-hour key expiry the same event can be new again.

The setting accepts only unset, `0` or `1`; malformed values fail closed. No request header, query parameter, payload field, sleep-duration parameter, purge route or public switch enables or changes the hold. A hold does not itself prove worker death or lease reclaim: a transport timeout is a different result.

## Private environment

| Variable | Value |
| --- | --- |
| `LIKERTS_ACCEPTANCE_NAMESPACE` | Fresh 16–32 random bytes encoded as 32–64 lowercase hex characters for this run; never reuse an existing namespace. |
| `LIKERTS_ACCEPTANCE_ADMIN_TOKEN` | Independent random token, 32–512 URL-safe characters, used as the bearer token for GET. |
| `LIKERTS_ACCEPTANCE_SIGNING_KEYS_JSON` | At most ten endpoint key UUIDs mapped to their literal returned `whsec_...` signing secrets. `{}` is allowed for initial empty-state checks and rejects every POST. |
| `LIKERTS_ACCEPTANCE_HOLD_FIRST_RECEIPT` | Optional `1` for the isolated eight-second hold; unset or `0` preserves immediate acknowledgment. |
| `KV_REST_API_URL` | Existing `https://<name>.upstash.io` origin, with no credentials, query, custom port or path; `UPSTASH_REDIS_REST_URL` is an alias. |
| `KV_REST_API_TOKEN` | Existing private Redis REST credential; `UPSTASH_REDIS_REST_TOKEN` is an alias. |

Configure secrets only through the approved provider workflow on the isolated project. Do not put them in source, command arguments, URLs, screenshots or logs. Redis operations use only `likerts:acceptance:<namespace>:events`; they never scan or list unrelated keys. Use an existing prefix-restricted Redis credential when available.

## Bounds

- Request body: 4 KiB, three-second read deadline, no compressed body acceptance.
- Redis: one REST command per accepted POST or authorized GET, four-second request/body deadline, 1 MiB response cap, no retry, redirects refused.
- Storage: one hash, at most 2,000 distinct events. The unchanged Lua script makes dedupe, capacity, insertion and initial one-hour TTL atomic. Later insertions and duplicates never extend the TTL.
- Fixed hold: eight seconds only after a successful new insertion. The isolated function's maximum duration is 20 seconds to accommodate up to three seconds of body reading, four of storage and eight of hold. The former ten-second fixture ceiling would truncate that bounded sequence. Ordinary receiver behavior still adds no hold.
- GET requires constant-time bearer validation before storage; it returns only validated distinct receipts, sorted by event ID. Responses are noncacheable and no CORS policy is enabled. Application code emits no logs; provider access-log retention remains account-controlled.

## Local verification

```sh
node --test infrastructure/acceptance/receiver/test/receiver.test.mjs
LIKERTS_RECEIVER_REDIS_TEST=1 node --test infrastructure/acceptance/receiver/test/receiver.test.mjs
```

The first command checks HMAC/tampering/skew, current schema and old-schema rejection, unauthorized reads, redaction, bounds, environment-only configuration, unchanged default behavior and the actual eight-second timer. The second additionally uses a cached `redis:7-alpine` Docker image with `--pull=never`, no network and no published port. It exercises the actual Lua through the real signed handler, reads the committed marker while the first response is held, completes 20 concurrent duplicate retries before releasing that response, and checks the cap and nonextending TTL. Only its uniquely named container is removed. Tests never contact Vercel or Upstash.

## Real drill prerequisites and cleanup

1. Deploy this reviewed candidate to a separate temporary project using approved existing-plan resources. Confirm runtime, hostname, private environment and worker access to its signed POST; leave the signing map empty initially. Check unauthorized GET is 401 and authenticated GET is empty. Stop if the namespace contains unknown records.
2. Prepare one synthetic workspace and disabled endpoint for `response.accepted`. Install its returned signing key, redeploy with hold enabled, verify the empty marker list, then enable the endpoint. Set no production receiver defaults.
3. Before creating the response, establish the runbook's verified exact-instance access, executable/PID/start-time identity, quiet nonfixture traffic checks and read-only lease observer. PID must be greater than 1; graceful restart does not prove abrupt loss.
4. Submit one planned response, observe its authenticated marker and running database attempt, then perform the separately authorized exact-process interruption before the eight-second window closes. Require the same delivery, expired old lease/attempt and new successful attempt per the runbook. A missed window or timeout-only retry is inconclusive.
5. Revoke the synthetic endpoint before tombstoning its verified workspace; check credential denial, preserve aggregate evidence and remove the isolated project and temporary credentials. The exact namespace expires after one hour. Do not purge unknown/shared keys.

Hosted execution, source/deployment identity, process topology, notifications and DNS experiments remain separate evidence gates. DNS tests additionally require a fresh owned leaf, valid TLS, actual worker-resolver observations and restoration; a real rebinding race requires controlled authoritative DNS. This receiver establishes none of those provider prerequisites or an availability SLA.
