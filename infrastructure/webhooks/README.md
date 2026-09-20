# Customer event webhooks

Launch hosting now targets [Render](../render/README.md). The AWS SG/NACL controls documented below apply only to the optional AWS target. Render retains application DNS/IP pinning; network-enforced outbound destination isolation remains unproven there.

This is customer-configured response and account-event delivery. Likerts does not send invitations, distribute surveys, or create respondent links. The receiver URL belongs to the customer.

Seven management operations, API/MCP/CLI parity, the durable worker and migration `0017_response_webhooks.sql` are implemented. The PostgreSQL lifecycle/privilege/interface gate and CDK synthesis assertions pass locally. Hosted HTTPS transport and AWS deployment evidence remain separate release gates. See `contracts/CAPABILITIES.md` for all operation inputs, scopes, outputs and errors.

## Receiver contract

An accepted completed response creates one `response.accepted` event and one delivery per enabled endpoint in the same PostgreSQL transaction. Duplicate response submissions create no additional event. Creation defaults to disabled: install the returned signing secret on the receiver, then explicitly enable the endpoint. Responses accepted while disabled do not accumulate historical notifications for that endpoint.

The JSON payload contains only IDs, version and timestamps:

```json
{"id":"EVENT_UUID","type":"response.accepted","eventVersion":1,"createdAt":"2026-09-09T00:00:00Z","data":{"responseId":"RESPONSE_UUID","collectionId":"COLLECTION_UUID","surveyId":"SURVEY_UUID","surveyVersion":4}}
```

Answers, metadata, question labels and respondent contents never enter the delivery payload. Receivers needing those values use a separately scoped management API credential. A deleted/expired response may already be unavailable when a callback arrives.

Headers are `Likerts-Event-Id`, `Likerts-Delivery-Id`, `Likerts-Attempt-Id` and `Likerts-Signature`. The signature format is `t=UNIX_SECONDS,kid=KEY_GENERATION_UUID,v1=HEX_MAC`. HMAC-SHA256 uses the literal returned `whsec_...` secret string as its UTF-8 key and signs `timestamp + "." + eventId + "." + exactRawBodyBytes`. Verify the MAC in constant time before decoding the body, accept at most five minutes of clock skew, check the header event ID equals the body event ID, then deduplicate processing by event ID. Keep the raw body; parsing and reserializing it changes its signature.

Deliveries are at least once within bounded attempts; receivers must tolerate duplicates and out-of-order events. A timeout can happen after the receiver has processed an event. Return any 2xx only after safely recording receipt. Response bodies are never read or stored by Likerts.

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

The dedicated `likerts_webhook_worker` login is NOINHERIT/NOBYPASSRLS and has no role memberships. Its worker-wide RLS policies permit only endpoint reads, ID-only event reads/expired cleanup, delivery reads/updates and attempt reads/inserts/updates. It cannot read surveys, responses, identity, exports, management idempotency snapshots or audit rows, mutate endpoint configuration, or migrate the schema. The API runtime retains tenant-only policies and cannot assume the worker role. The worker task has no S3 access, collection keys, identity secrets or migration credentials. Its only injected secrets are its own database username/password and the webhook credential key. `LIKERTS_WEBHOOK_DATABASE_URL` is constructed in memory; concurrency defaults to four and is limited to 1–16. `LIKERTS_WEBHOOK_CHECK_CONFIG=1` validates the login and exits without claiming or sending events. SIGTERM stops new claims and permits bounded in-flight completion.

The worker also maintains one database-clock liveness singleton. It can execute only the no-argument `record_callback_worker_heartbeat()` function and has no direct privilege on the underlying row. The function checks `session_user`, so the API, maintenance jobs and a role reached through membership cannot spoof freshness. A successful queue claim, including an empty poll, permits one bounded heartbeat write at most every 30 seconds across the process; claim/database failures never advance it. The API runtime can execute only the `callback_worker_status()` SECURITY DEFINER function, which returns `reachable`, `stale` after 120 seconds, or `unavailable`. Process identity is intentionally neither persisted nor exposed because singleton freshness is the health evidence.

Deploy in this order: migration `0029` and both restricted grant scripts, callback worker, API, then the durable monitor. The worker startup check rejects a missing migration, direct table grants or missing recorder grant. The API route `/internal/callback-status` uses the existing `LIKERTS_MONITOR_TOKEN`; its response contains only the fixed status field and has `no-store`. A worker rollback simply stops refreshing the singleton and becomes stale; monitor state uses isolated v3 Redis keys so a monitor rollback retains its untouched older state.

Provision the worker login separately, then run `provision-worker.sql` as the database owner. Apply `runtime-grants.sql` after `backend/provision-runtime.sql` with the same `runtime_role`. Re-run the worker and runtime grant scripts after migration `0029`; neither script creates credentials or grants support bypass access. `webhooks:write` requires the owner role for human OAuth; `webhooks:read` permits readers. Service credentials require the matching explicit scope. Unconfigured webhook storage returns a structured 503; memory mode cannot enable callbacks.

## Reproducible local evidence

Run `bash scripts/check-webhook-isolation.sh`. It creates and removes an isolated PostgreSQL 17 container, applies all current migrations, provisions actual restricted API/worker logins and tests:

- Atomic acceptance/outbox rollback and duplicate suppression; tenant API isolation; no worker customer-data privileges; response/workspace erasure cascades.
- Disabled creation, deterministic protected credential retry, conflicting input rejection, explicit enable, parallel claims, persisted attempt generation/timestamp, transient retry timing and restart recovery.
- Stale completion fencing, bounded replay, endpoint rotation, wrong-master-key failure before dispatch and recovery after key restoration, revocation fencing, expiry cleanup and actual SQL permission-denied errors for forbidden worker tables.
- Signature/tampering/clock-window tests, endpoint parser validation, public-IP checks, and loopback HTTP wire tests for exact bytes/headers, status classification and redirect refusal.
- All seven real API/MCP/CLI webhook operations against restricted PostgreSQL, subscription validation/idempotency, cross-tenant failures, eight retries producing one response event, and worker startup refusing the API database identity.
- Response and workspace erasure, revocation, replay bounds, state privilege denials, and non-null response references.

`bash scripts/check-aws-iac.sh` separately verifies credential-free staging/production topology, worker secret/task-role separation, DNS/return-path ACL rules and NAT routes. `bash scripts/check-recovery.sh` verifies restored callbacks remain quarantined; alert-rule behavior is checked by `bash scripts/check-observability.sh`.

Only a loopback receiver is contacted by local HTTP wire tests. No external receiver was contacted by this gate. Deployed HTTPS transport, egress enforcement, AWS worker health and recovery/load evidence remain separate acceptance requirements.

Implementation references: [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html), [reqwest client configuration](https://docs.rs/reqwest/latest/reqwest/struct.ClientBuilder.html), [IANA IPv4 special registry](https://www.iana.org/assignments/iana-ipv4-special-registry), [IANA IPv6 special registry](https://www.iana.org/assignments/iana-ipv6-special-registry), and [Azure platform IP](https://learn.microsoft.com/en-us/azure/virtual-network/what-is-ip-address-168-63-129-16). Address rules are conservative snapshots and should be reviewed when the registries change.

## AWS network and restore operations

The callback task has separate private subnets routed through the existing NAT gateway(s). Security groups permit public TCP 443, PostgreSQL TCP 5432 only to the database security group, and UDP/TCP 53 only to the VPC resolver `/32`. The callback subnet ACL allows RDS 5432 first, then resolver DNS, denies private/shared/link-local/reserved destinations, and allows public egress. Inbound TCP ephemeral 1024–65535 covers HTTPS/RDS replies; a resolver-only UDP ephemeral rule makes DNS return traffic explicit. Synth assertions check those rules and each callback subnet's NAT route.

The VPC local route is unavoidable; ACL/security-group enforcement restricts access over that route. [AWS documents that network ACLs cannot block AmazonProvidedDNS/Route 53 Resolver traffic](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html). The explicit DNS rules document intent; URL/IP validation prevents the worker from using private DNS results for callbacks. Custom resolvers or private AWS endpoints require a separately reviewed network change.

Three callback alarms cover missing running tasks, high CPU and repeated worker persistence/claim failures. Staging keeps one worker task; production keeps two. Subscribe and exercise the alarm destination in AWS before claiming operational delivery. The health check validates database connectivity and the restricted worker login, not the customer's receiver availability.

After restoring a database, quarantine all restored webhook endpoints and delete restored event/idempotency queues before starting workers. A snapshot can predate endpoint revocation or signing-key rotation. `infrastructure/recovery/replay.sql` performs this quarantine and the local recovery drill checks it alongside preserved worker restrictions. Reconcile current customer ownership, then create fresh endpoint credentials. Never automatically resume an old callback queue after restore.
