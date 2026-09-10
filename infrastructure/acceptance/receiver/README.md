# Temporary hosted acceptance receiver

An isolated Node 22 Vercel project for synthetic `credits.threshold_reached` delivery acceptance. This is a test fixture, not a customer webhook product or production alert destination. It does not deploy itself, create workspaces, send callbacks, poll, or configure provider resources.

`POST /api/receive` accepts only the exact current credit-event schema. It verifies the raw-byte HMAC-SHA256, known key ID, five-minute signature window, UUID delivery headers, and matching body/header event IDs before writing. It accepts RFC3339 creation timestamps, including PostgreSQL's fractional seconds and `+00:00` offset. It returns an empty 204 only after Redis acknowledges storage or an already-recorded event ID. Invalid signatures return 401; invalid schemas return 400; unsupported media/encoding return 415; oversized bodies return 413; storage/capacity/configuration failures return 503. No raw request, answer, workspace ID, signature, credential, or provider error is logged or persisted by this application.

`GET /api/events` requires `Authorization: Bearer <admin token>`. Authentication hashes both values to the same length then compares in constant time. It returns:

```json
{
  "events": [{
    "eventId": "UUID",
    "deliveryId": "UUID",
    "attemptId": "UUID",
    "eventType": "credits.threshold_reached",
    "signatureVerified": true,
    "bucket": "promotional",
    "generationId": "UUID",
    "thresholdPercent": 80
  }],
  "receivedCount": 1
}
```

`receivedCount` is the number of **distinct verified event IDs retained**, not HTTP attempts. The first delivery/attempt is kept for a repeated event. Array order is by event ID and carries no delivery-order guarantee. Unauthorized callers cannot inspect Redis. Responses use `Cache-Control: no-store`; CORS is not enabled. There is no public configurator, purge route, failure switch, or forwarding target.

## Private environment

| Variable | Required value |
| --- | --- |
| `LIKERTS_ACCEPTANCE_NAMESPACE` | New cryptographically random 16–32 bytes encoded as 32–64 lowercase hex characters for **each acceptance run**. Never reuse an existing namespace. |
| `LIKERTS_ACCEPTANCE_ADMIN_TOKEN` | Independently generated random token, 32–512 URL-safe characters. |
| `LIKERTS_ACCEPTANCE_SIGNING_KEYS_JSON` | JSON map from returned `endpoint.keyId` UUID to literal returned `signingSecret` (`whsec_...`). At most 10 keys. `{}` is allowed for initial setup and rejects every receipt. |
| `KV_REST_API_URL` | Existing Upstash REST HTTPS origin; no path, credentials, query or custom port. `UPSTASH_REDIS_REST_URL` is an alias if the KV name is absent. |
| `KV_REST_API_TOKEN` | Existing Redis REST credential that can execute `EVAL`, `HGET`, `HLEN`, `HSET`, `EXPIRE` and `HVALS`. `UPSTASH_REDIS_REST_TOKEN` is the alternate name. |

Create private configuration through your approved provider/secret workflow. Do not place secrets in command arguments, task messages, source, URLs, screenshots or logs. Set all values only on the isolated receiver project. The Redis origin is operator-supplied and limited to the Upstash service; request input never chooses it. The same existing database may be used, but all fixture commands access one exact key: `likerts:acceptance:<random namespace>:events`. This application never scans, lists or deletes other keys. A restricted Redis ACL token for this prefix is preferable when already available.

## Deployment and acceptance order

1. From this directory, deploy an isolated temporary project to the approved Vercel account using the operator's existing CLI workflow. This package has no third-party runtime dependencies. Confirm the receiver hostname and environment. Leave its signing map empty until the endpoint exists.
2. Verify `GET /api/events` without authentication returns 401. With the private admin credential it must return exactly `{"events":[],"receivedCount":0}`. If nonempty, stop and investigate; do not purge an unknown namespace.
3. Create the synthetic workspace's disabled endpoint with explicit `eventTypes: ["credits.threshold_reached"]`. Install its returned key ID and signing secret in the receiver environment, redeploy, and check the empty authenticated receipt list again. Only then enable the endpoint.
4. Run the separately reviewed bounded acceptance runner. It must verify actual API delivery IDs against these verified receipts, all three thresholds, the same promotional generation, and exact zero paid exposure. A healthy receiver alone does not prove the worker or credit transaction ran.
5. Bound caller polling: at most 60 requests, at least two seconds apart, per-request timeout five seconds, redirects refused. Stop on abort, invalid credentials, unexpected schema/IDs, capacity errors, or the configured deadline. This receiver itself never retries Redis requests or runs a polling loop.
6. Stop and revoke the synthetic endpoint before deleting its workspace. Capture only aggregate pass/fail evidence. Delete the isolated Vercel project and remove temporary local credentials. The Redis key expires automatically; if an operator needs earlier deletion, first verify the exact namespace belongs to this run and delete only that exact key through the approved provider workflow. Never scan or sweep shared data.

Vercel deployment protection must permit the worker's signed POST to this **temporary hostname** for the drill; the admin GET still enforces its independent bearer credential. Check account controls without altering the main Likerts project. There is no general DNS/redirect test mode here. A later DNS/failure experiment needs its own approved, bounded procedure.

## Bounds and evidence limits

- Request bodies: 4 KiB, at most three seconds to read; authenticated JSON only. No compressed body acceptance.
- Redis: one REST command per accepted POST or authenticated GET, four-second total request/body deadline, no automatic retry, redirects refused, response body at most 1 MiB.
- Storage: at most 2,000 distinct events in one hash. Lua atomically deduplicates, checks the cap, records and sets a one-hour TTL on the first receipt. Later writes and retries do **not** extend that TTL. After expiry, a retry can be recorded anew; complete evidence collection before expiry.
- Vercel functions: ten-second maximum duration; the receiver does no background work after responding.
- This code does not establish Upstash/Vercel availability, end-to-end hosted delivery, external DNS protection, callback retry behavior, or a production SLA. A newly deployed environment and real signed worker requests still need acceptance.
- Provider platform access logs are governed by the account's own retention settings. Application code deliberately writes no logs and stores only the eight allowlisted receipt fields above.

## Local checks

```sh
node --test infrastructure/acceptance/receiver/test/*.test.mjs
LIKERTS_RECEIVER_REDIS_TEST=1 node --test infrastructure/acceptance/receiver/test/*.test.mjs
```

The second command additionally uses an already-cached `redis:7-alpine` Docker image with `--pull=never`, no network and no published port. It starts a uniquely named fixture container and removes only that container in `finally`. It verifies actual Lua behavior under concurrent duplicate deliveries, the 2,000-event limit and nonextending TTL. Other tests exercise the real HMAC/handler code with synthetic secrets, malformed and tampered input, unauthorized reads, redaction, redirect rejection and bounded failures. Tests do not contact Upstash or Vercel.

Protocol source: [Likerts webhook contract](../../webhooks/README.md). Platform references: [Vercel Node request functions](https://vercel.com/docs/functions/runtimes/node-js), [raw webhook bytes](https://vercel.com/kb/guide/how-do-i-get-the-raw-body-of-a-serverless-function), and [Upstash REST command format](https://upstash.com/docs/redis/features/restapi).
