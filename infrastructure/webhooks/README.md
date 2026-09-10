# Customer event webhooks

Launch hosting now targets [Render](../render/README.md). The AWS SG/NACL controls documented below apply only to the optional AWS target. Render retains application DNS/IP pinning; network-enforced outbound destination isolation remains unproven there.

This is customer-configured response and account-event delivery. Likerts does not send invitations, distribute surveys, or create respondent links. The receiver URL belongs to the customer.

Seven management operations, API/MCP/CLI parity, the durable worker and migrations `0017_response_webhooks.sql` / `0023_credit_threshold_notifications.sql` are implemented. The PostgreSQL lifecycle/privilege/interface gate and CDK synthesis assertions pass locally. Hosted HTTPS transport and AWS deployment evidence remain separate release gates. See `contracts/CAPABILITIES.md` for all operation inputs, scopes, outputs and errors.

## Receiver contract

An accepted completed response creates one `response.accepted` event and one delivery per enabled endpoint in the same PostgreSQL transaction. Duplicate response submissions create no additional event. Creation defaults to disabled: install the returned signing secret on the receiver, then explicitly enable the endpoint. Responses accepted while disabled do not accumulate historical notifications for that endpoint.

The JSON payload contains only IDs, version and timestamps:

```json
{"id":"EVENT_UUID","type":"response.accepted","eventVersion":1,"createdAt":"2026-09-09T00:00:00Z","data":{"responseId":"RESPONSE_UUID","collectionId":"COLLECTION_UUID","surveyId":"SURVEY_UUID","surveyVersion":4}}
```

Answers, metadata, question labels and respondent contents never enter the delivery payload. Receivers needing those values use a separately scoped management API credential. A deleted/expired response may already be unavailable when a callback arrives.

Headers are `Likerts-Event-Id`, `Likerts-Delivery-Id`, `Likerts-Attempt-Id` and `Likerts-Signature`. The signature format is `t=UNIX_SECONDS,kid=KEY_GENERATION_UUID,v1=HEX_MAC`. HMAC-SHA256 uses the literal returned `whsec_...` secret string as its UTF-8 key and signs `timestamp + "." + eventId + "." + exactRawBodyBytes`. Verify the MAC in constant time before decoding the body, accept at most five minutes of clock skew, check the header event ID equals the body event ID, then deduplicate processing by event ID. Keep the raw body; parsing and reserializing it changes its signature.

Deliveries are at least once within bounded attempts; receivers must tolerate duplicates and out-of-order events. A timeout can happen after the receiver has processed an event. Return any 2xx only after safely recording receipt. Response bodies are never read or stored by Likerts.

## Opt-in credit threshold notifications

Existing and newly created endpoints default to `eventTypes: ["response.accepted"]`. Credit alerts require an explicit subscription at creation:

```json
{"idempotencyKey":"credit-alerts-001","url":"https://hooks.customer.com/likerts","eventTypes":["credits.threshold_reached"]}
```

Use `webhook_endpoints_create` through the API, MCP or CLI with this input. To receive both event types, include both strings. Subscription order does not affect idempotency. The URL and subscriptions are immutable; pause/revoke and create a new endpoint to change them. Creation remains disabled until the customer installs the signing secret and calls `webhook_endpoints_update` with `enabled: true`.

Creating or enabling a credit subscriber requires both `webhooks:write` and `usage:read`. Human OAuth also requires workspace ownership. Pausing or revoking only requires `webhooks:write`; this allows an operator to stop outbound delivery after billing access is removed. Reads, rotation and replay retain their existing webhook scopes. A service credential cannot bypass workspace binding or acquire a new subscription by changing UUID spelling. All seven webhook operations remain available through API, MCP and CLI.

The `credits.threshold_reached` payload uses the same exact-byte signature, timestamps, retries, leases and replay contract:

```json
{"id":"EVENT_UUID","type":"credits.threshold_reached","eventVersion":1,"createdAt":"2026-09-10T00:00:00Z","data":{"workspaceId":"WORKSPACE_ID","bucket":"promotional","generationId":"GENERATION_UUID","thresholdPercent":80}}
```

There are separate `promotional` and `paid` balance generations. A positive increase in a bucket's **available, nonnegative** balance starts a new generation whose baseline is the resulting balance. A paid top-up never rearms promotional alerts. Paying down debt without increasing available balance does not start a generation. When a later ledger debit leaves at most 20%, 10% or 0% of that baseline, the transaction creates the corresponding 80%, 90% or 100% event. A debit crossing several thresholds creates each threshold once. Consumption, refunds, reversals and negative corrections can deplete a balance; the event does **not** claim that the same percentage was consumed by responses. Refund/dispute recovery or a positive adjustment can start a fresh generation when available balance increases.

Only future crossings while an opted-in endpoint is enabled fan out to that endpoint. There is no historical backfill when enabling or subscribing. Existing workspaces initialize the generation lazily from the balance immediately before the first changed ledger entry after migration; migration does not recreate historical grants. Retrieve `usage_get` when enabling alerts and on receipt for current balances, debt and blocking reason. Events can arrive after a later top-up and can arrive out of order. Console lifetime consumption percentages are a different view and are not the durable generation baseline.

The payload exposes no answers, balances, grant amounts or purchase amounts. The worker cannot read the response-credit ledger or the numeric baseline. Durable high-water state suppresses duplicate thresholds after retries, restarts and seven-day event cleanup. Unique `(workspace, bucket, generation, threshold)` event keys provide a second fence. With no enabled subscriber the crossing is recorded but creates no outbox backlog. These notifications reach the customer's receiver; routing them to the workspace owner is the receiver's responsibility. Likerts does not send an email or SMS from this feature.

Migration 0023 must land before the new API build. Existing endpoint defaults and queued response events remain compatible. The new `credit_notification_state` table has forced tenant RLS, no public/runtime/worker direct grants, and only fixed-search-path security-definer triggers mutate it. The event CHECK distinguishes a response FK from a credit bucket/generation/threshold. Workspace deletion clears state and all queued events. Response deletion only removes its response callback; it does not undo billing or a balance alert. During recovery, revoke **all** restored endpoints and delete **all** event types, but preserve surviving workspace high-water marks. Reconcile ownership before creating fresh endpoints; do not replay an old restored queue.

## Bounds and lifecycle

- Five non-revoked endpoints per workspace; 100 total endpoint records per workspace.
- Seven attempts per delivery run. Retry delays after failed attempts are 60, 240, 960, 3,840, 15,360 and 61,440 seconds. Retry transport/DNS failures, 408, 429 and 5xx. Redirects and other 4xx fail permanently. `Retry-After` does not override this bounded schedule.
- One in-flight attempt per endpoint across workers, with a 30-second claim lease. DNS resolution is limited to five seconds and the HTTP request to ten seconds. Expired leases recover durably with a new attempt ID; stale completions cannot replace newer outcomes.
- Event/delivery/attempt records expire seven days after their source transaction. Response erasure and workspace deletion delete their queued callback records transactionally. A request already sent cannot be recalled.
- A completed or failed delivery can be explicitly replayed at most three times before expiry. Replay preserves event/delivery IDs, resets the seven-attempt budget and increments replay count. Creation, key rotation and replay are idempotent; reusing a key with different input conflicts.
- Disabling stops new event fan-out and new worker sends, but preserves queued work until re-enabled or expired. Revocation permanently cancels queued/running deliveries. The final pre-send check narrows the race; an HTTP request already in flight may finish within its timeout.

## Signing key ownership and rotation

`LIKERTS_WEBHOOK_CREDENTIAL_KEY` is a standard-base64 encoding of a separate 32-byte secret, unrelated to collection credentials. It is available only to the API runtime (credential creation/reconstruction) and the webhook worker, never the database migrator or a client SDK. Derivation includes a protocol domain, workspace ID, endpoint UUID and random key-generation UUID. PostgreSQL stores only generation IDs and SHA-256 digests. Credential responses have no debug formatting and must never be logged.

Endpoint creation and rotation return the signing secret through their protected management response. A matching idempotency retry reconstructs the original response/generation; it does not reveal subsequent generations. A rotation switches future claims to a new generation. Attempts persist their generation, digest and signature timestamp before sending, so their identity survives restart. The receiver should retain the old generation for the five-minute signature window while installing the new one. Revoked endpoints cannot reconstruct creation credentials.

There is no implicit master-key ring in this implementation. An uncoordinated replacement of the runtime master key fails closed against stored digests and marks affected deliveries `credential_key_unavailable`. Master-key replacement requires disabling endpoints, waiting for in-flight attempts to end, switching the API and worker secret together, rotating each endpoint, installing each new receiver secret, re-enabling endpoints and explicitly replaying eligible failed deliveries. Old creation/rotation idempotency keys cannot reconstruct secrets after the old master key is removed. Do not promise transparent master-key rotation.

## SSRF and execution boundary

Only HTTPS URLs on port 443 with a DNS hostname are accepted. Credentials, fragments, IP literals, dotless/internal names and nonstandard ports are rejected. Every attempt freshly resolves the hostname, rejects any private/special-purpose result (including mixed public/private answers), and pins the validated addresses into that attempt's HTTP client. TLS still validates the original hostname. Redirect following, environment proxies and HTTP-library automatic retries are disabled. The CDK task uses dedicated callback subnets with ACL private-destination denies, restricted security-group egress and explicit RDS/resolver exceptions. Synthesis is not proof of deployed egress enforcement. The current VPC is IPv4; a receiver needs a usable public IPv4 address there.

The dedicated `likerts_webhook_worker` login is NOINHERIT/NOBYPASSRLS and has no role memberships. Its worker-wide RLS policies permit only endpoint reads, ID-only event reads/expired cleanup, delivery reads/updates and attempt reads/inserts/updates. It cannot read surveys, responses, billing, identity, exports, management idempotency snapshots or audit rows, mutate endpoint configuration, or migrate the schema. The API runtime retains tenant-only policies and cannot assume the worker role. The worker task has no S3 access, collection keys, identity secrets, billing keys or migration credentials. Its only injected secrets are its own database username/password and the webhook credential key. `LIKERTS_WEBHOOK_DATABASE_URL` is constructed in memory; concurrency defaults to four and is limited to 1–16. `LIKERTS_WEBHOOK_CHECK_CONFIG=1` validates the login and exits without claiming or sending events. SIGTERM stops new claims and permits bounded in-flight completion.

Provision the worker login separately, then run `provision-worker.sql` as the database owner. Apply `runtime-grants.sql` after `backend/provision-runtime.sql` with the same `runtime_role`. Neither script creates credentials or grants support bypass access. `webhooks:write` requires the owner role for human OAuth; `webhooks:read` permits readers. Service credentials require the matching explicit scope. Unconfigured webhook storage returns a structured 503; memory mode cannot enable callbacks.

## Reproducible local evidence

Run `bash scripts/check-webhook-isolation.sh`. It creates and removes an isolated PostgreSQL 17 container, applies all current migrations including 0023, provisions actual restricted API/worker logins and tests:

- Atomic acceptance/outbox rollback and duplicate suppression; tenant API isolation; no worker customer-data privileges; response/workspace erasure cascades.
- Disabled creation, deterministic protected credential retry, conflicting input rejection, explicit enable, parallel claims, persisted attempt generation/timestamp, transient retry timing and restart recovery.
- Stale completion fencing, bounded replay, endpoint rotation, wrong-master-key failure before dispatch and recovery after key restoration, revocation fencing, expiry cleanup and actual SQL permission-denied errors for forbidden worker tables.
- Signature/tampering/clock-window tests, endpoint parser validation, public-IP checks, and loopback HTTP wire tests for exact bytes/headers, status classification and redirect refusal.
- All seven real API/MCP/CLI webhook operations against restricted PostgreSQL, conditional credit-subscription scopes, subscription validation/idempotency, cross-tenant failures, eight retries producing one event/one cent, and worker startup refusing the API database identity.
- Actual runtime acceptance at a credit threshold; independent bucket generations; refund depletion; concurrent idempotent adjustment; rollback of events/high-water; no backfill; revocation/deletion; state privilege denials; and nullable event-reference invariants.
- Authoritative checkout inspection via API/MCP/CLI: forged success queries cannot settle a pending purchase or mint credits, and wrong-tenant/missing-scope/browser-impersonation reads are denied.

`local-evidence.json` records the latest isolated gate outcomes and the exact container/recovery image. `bash scripts/check-aws-iac.sh` separately verifies credential-free staging/production topology, worker secret/task-role separation, DNS/return-path ACL rules and NAT routes. `bash scripts/check-recovery.sh` verifies restored callbacks remain quarantined; alert-rule behavior is checked by `bash scripts/check-observability.sh`.

Only a loopback receiver is contacted by local HTTP wire tests. No external receiver was contacted by this gate. Deployed HTTPS transport, egress enforcement, AWS worker health and recovery/load evidence remain separate acceptance requirements.

Implementation references: [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html), [reqwest client configuration](https://docs.rs/reqwest/latest/reqwest/struct.ClientBuilder.html), [IANA IPv4 special registry](https://www.iana.org/assignments/iana-ipv4-special-registry), [IANA IPv6 special registry](https://www.iana.org/assignments/iana-ipv6-special-registry), and [Azure platform IP](https://learn.microsoft.com/en-us/azure/virtual-network/what-is-ip-address-168-63-129-16). Address rules are conservative snapshots and should be reviewed when the registries change.

## AWS network and restore operations

The callback task has separate private subnets routed through the existing NAT gateway(s). Security groups permit public TCP 443, PostgreSQL TCP 5432 only to the database security group, and UDP/TCP 53 only to the VPC resolver `/32`. The callback subnet ACL allows RDS 5432 first, then resolver DNS, denies private/shared/link-local/reserved destinations, and allows public egress. Inbound TCP ephemeral 1024–65535 covers HTTPS/RDS replies; a resolver-only UDP ephemeral rule makes DNS return traffic explicit. Synth assertions check those rules and each callback subnet's NAT route.

The VPC local route is unavoidable; ACL/security-group enforcement restricts access over that route. [AWS documents that network ACLs cannot block AmazonProvidedDNS/Route 53 Resolver traffic](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html). The explicit DNS rules document intent; URL/IP validation prevents the worker from using private DNS results for callbacks. Custom resolvers or private AWS endpoints require a separately reviewed network change.

Three callback alarms cover missing running tasks, high CPU and repeated worker persistence/claim failures. Staging keeps one worker task; production keeps two. Subscribe and exercise the alarm destination in AWS before claiming operational delivery. The health check validates database connectivity and the restricted worker login, not the customer's receiver availability.

After restoring a database, quarantine all restored webhook endpoints and delete restored event/idempotency queues before starting workers. A snapshot can predate endpoint revocation or signing-key rotation. `infrastructure/recovery/replay.sql` performs this quarantine and the local recovery drill checks it alongside preserved worker restrictions. Reconcile current customer ownership, then create fresh endpoint credentials. Never automatically resume an old callback queue after restore.

## Hosted credit threshold acceptance

`node scripts/check-hosted-credit-notifications.mjs` uses one explicitly disposable, pristine `hosted-launch-*` workspace with 1,000 promotional credits and zero paid exposure. It accepts at most 1,000 synthetic responses, at no more than five aggregate API/receiver requests per second and four concurrent submissions. The runner performs no paid purchase, refund or ledger adjustment. It verifies outbox counts at 700/800/900/1,000 accepted responses and waits up to two minutes for three signed promotional events, in one generation, matching the API's delivered event/delivery IDs. This proves customer receiver delivery, not email/SMS routing.

First deploy an isolated owned verifier, create one disabled credit-only endpoint in the fresh workspace, and install that endpoint's `keyId` and `signingSecret` in the receiver. The receiver must expose `POST /api/receive` with exact-byte HMAC verification and bounded deduplication. Its protected `GET /api/events` returns `{events:[{eventId,deliveryId,attemptId,eventType,signatureVerified,bucket,generationId,thresholdPercent}],receivedCount}`; no raw bodies or answers. It must be empty and use the same origin as the configured receive URL.

Supply a regular, non-symlink mode-0600 manifest through `LIKERTS_HOSTED_THRESHOLD_INPUT`. Its fields are `workspaceId`, `disposable: true`, `receiverOwned: true`, `bootstrapToken`, `endpointId`, `receiverUrl`, `verifierUrl` and `verifierToken`. Set `LIKERTS_HOSTED_BASE_URL` to the exact HTTPS API origin and `LIKERTS_HOSTED_EVIDENCE_OUTPUT` to the desired evidence file. Credentials stay in the private file and are never printed or copied into evidence. The runner checks the issued child credential's workspace binding, current zero-usage state, empty survey inventory, and exact receiver subscription before enabling delivery.

The runner revokes the endpoint and tombstones only the workspace whose ownership/binding and pristine state it verified. Failed preflight never deletes an unverified workspace; an exact child credential created during preflight is revoked separately. Failed cleanup makes the evidence fail. Receiver deployment/secret configuration and removal remain the operator's job. Reusing the workspace is intentionally unsupported after cleanup. The evidence has distinct limits: promotional generation only, synthetic same-account receiver, no provider egress policy proof, no general load/failover promise.
