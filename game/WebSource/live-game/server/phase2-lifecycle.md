# Phase 2 backend lifecycle verification — 6 November 2026

This report distinguishes driver-seam tests, real local transports, and actual PostgreSQL fault recovery. It does not establish a production provider's failover, TLS, backup deletion or sustained operating envelope.

## Reproduced failures and corrections

| Path | Before | Correction and regression |
| --- | --- | --- |
| Transport shutdown | A second close returned before held maintenance finished; a new create returned 201 during drain; a queued upgrade opened after shutdown; a closed instance reopened without timers/subscriptions. | Shared close completion; reject new/queued work after stopping; destroy pending upgrade sockets; await owned requests/upgrades/fan-out; refuse listen after close. Factory API unchanged. |
| Transaction clock | A GET queued across expiry returned 200 and revived the room; an answer queued across its deadline returned 200; recovery queued beyond ten minutes rotated the token. | Sample time inside the locked callback; recheck recovery/room deadlines there. Rejected recovery preserves the still-current capability. |
| Idle-worker fan-out | Eighteen commit notices with no local subscribers caused an unnecessary durable room read. | Skip fan-out reads without local authenticated subscribers, checking again when the coalesced task executes. Authentication obtains its own snapshot. |
| PostgreSQL listener/shutdown | Five of six initial seam tests failed: early concurrent close, release failure skipped pool drain, raw shutdown error, duplicate LISTEN leases/premature readiness, obsolete listener notifications. | Single-flight acknowledged LISTEN; one-time disposal; ignore obsolete notifications; shared close completion; always drain and sanitize pool errors. |
| LISTEN loss during acknowledgement | A retry firing while the first LISTEN remained pending could consume the only future reconnect attempt. An additional regression failed before correction. | Reschedule after the pending operation settles when no acknowledged listener remains; never reconnect after close. |
| Control frames/auth deadline | Independent frozen-candidate tests received twelve automatic PONGs with a two-frame allowance; a peer ignoring CLOSE retained the sole socket slot after its authentication deadline. | Disable auto-PONG; terminate unauthenticated PING; authenticated PING uses durable member frame quota and queued-byte guard; hard authentication termination. Independent final tests include legitimate bounded PONG. |
| Receipt exhaustion | Two of four new reducer tests failed: a full receipt map blocked host close and self-leave. | Preserve authorized current-match close/self-revocation. Ordinary receipts stay capped; an exact leave retry lives inside its existing hashed revocation record. Legacy persisted string records remain replayable. Conflicting UUIDs, stale matches and unauthorized host actions remain rejected. |

Original app SHA: `e9525f047bc7b247d9bb9eeb56b5c29a62094d95635b70afbe1ac897ae19774c`; store: `09f42408c3e5cbfac02c1e8989eb9fb917ac11fc1b507bfa466e49931597e4d5`; engine: `b56257833d7b08c2c8e65f22340a27ad900bdefe8575aed075672e1491d4c90b`. Initial store-seam red/green checks used installed Node22.22.2 only to reproduce application behavior. All subsequent checks used the parent's separately verified official Node22.23.4 binary; no global runtime was replaced.

## Fresh focused results

From live-game, using the verified Node22.23.4 executable:

```sh
node --test --test-concurrency=1 test/backend-lifecycle.test.mjs test/backend-store-lifecycle.test.mjs test/backend-http.test.mjs
node --test test/backend-storage-failures.test.mjs test/backend-store-lifecycle.test.mjs
node --test test/backend-terminal-receipts.test.mjs test/backend-engine.test.mjs
node --test --test-concurrency=1 test/backend-listener-pg.test.mjs
```

- 19/19 transport, initial six store-lifecycle and existing HTTP tests passed. The complete eight-case transport red run previously exited with 0 passed/8 failed.
- 17/17 diagnostics and final eight store-lifecycle tests passed after the extra reconnect regression.
- 16/16 existing engine and four terminal-receipt tests passed.
- 2/2 actual PostgreSQL listener tests passed, zero skipped. Each used a cryptographically unique owned schema in the explicitly selected disposable loopback `likerts_live_test` fixture via `LIKERTS_LIVE_TEST_DATABASE_URL`. Only the verified test store's LISTEN backend was terminated. An acknowledged replacement received a subsequent cross-connection commit and durable state remained intact. Concurrent close after loss drained the pool/canceled reconnect. All owned pools/schemas were cleaned; no test services remained.
- The independent security owner reported 10/10 worktree Phase2 tests passed at the final fingerprint below, including five negative controls. Frozen-candidate red proof remains separate.

The first transport red attempt was interrupted after a harness typo (`deadlineAt` versus actual `deadline`) prevented a gate from being reached. It was corrected before the complete eight-case red run. No interrupted run counts as a pass. One process-status read was denied by the executor and not retried; the interrupted owned test was stopped through its existing session before rerunning.

These are focused/delta results, not a claim that the historical 139 tests have run on this new source. The parent coordinates the final sequential suite and bounded PostgreSQL write/WAL/soak profile. SQLite emits Node's expected ExperimentalWarning. Timeouts, pool size, resource limits and correctness assertions were not relaxed.

## Lifecycle checkpoint before the optional proxy seam

Combined path+bytes hash in the load harness order (`../server/app.mjs`, `../server/engine.mjs`, `../server/store.mjs`, `../server/errors.mjs`, `../shared/catalogue.json`):

`52626c816c65caaf2f7f11d90ec7bd8c64d9093a585b3594f177789ebb6ecc03`

| File | SHA-256 |
| --- | --- |
| server/app.mjs | `4f3afb1ce511f4298da00a4abed22ab9539932c571cde84bb009d18df3fecd02` |
| server/store.mjs | `dac9f8d5bbd5fe573d44f2de8af967290adfb83e1b1c104d255aa321bf7db818` |
| server/engine.mjs | `8cdd0ee8cc57cad3dba95d3a1afe51dd8473ac5cf6a19c02de42c5b55bada8b0` |
| server/index.mjs | `b4eb5e1ac0e449f60ae11657528c11cbc9b507f916c592c64479f0a532034535` |

The CLI calls the parent's production-runtime guard after config validation and before storage. Production bounds remain four rooms, twelve players plus dedicated host, sixty-four sockets per process, twenty-six durable room leases, and two per member. No deployment, production provisioning or credential/security changes occurred here.

## Current optional proxy-address integration

The parent subsequently approved and implemented a pure client-address policy helper. The factory now accepts the optional backwards-compatible `resolveClientAddress(request)` callback; its default uses the actual TCP peer. API HTTP and WebSocket admission evaluate it once and use the resolved address consistently for budgets. Output must be a bounded valid IP (or conservative unknown). The CLI creates the resolver only after configuration/runtime checks. The helper's trusted-peer list is empty by default: no Render, Vercel or forwarded header is automatically trusted. An explicitly configured exact-IP one-hop append-only topology still requires real ingress verification before deployment.

The parent's four address-policy units and three runtime-policy units passed 7/7 on Node22.23.4 after index integration. The parent owns the additional actual reverse-proxy/HTTP/WS wiring tests and final full run; those are not claimed by this report.

Current combined backend SHA: `5e52c516c572c3112c65be41623e779c6dd9a11047b705008d079eb58b5632dc`.
Current app SHA: `5eb385cd5607cb83e9ba3f4800c5febe456982e174ab84e769e8b95463efe8f9`.
Current index SHA: `8669d27ae3049cab9633d4522b72e2532974e7e03c4e6caaea628bea7e0d642a`.
Engine/store hashes remain those in the preceding table. The lifecycle and independent-security results at `52626c…` are preserved at their actual source fingerprint rather than relabeled as a new full run.

## Remaining scope

Cached readiness reports a bounded-age aggregate storage probe, not assurance that every future mutation/network path succeeds. Lost notifications require authenticated HTTP/watchdog fallback. Driver seams establish injected cleanup behavior; real fixture tests establish only local PostgreSQL termination/replacement. Provider loss, production TLS, migration/runtime roles, rolling deployment, backup restoration, sustained resource/storage costs and physical-device/internet paths remain separate gates.

Heartbeat commands are unused by current browser/native presence loops but remain in the unreleased protocol and exact-UUID receipt contract. An unrecorded heartbeat mutation would weaken conflict semantics. Deliberate removal or a separate presence-only protocol needs client/test coordination. The parent is measuring write/WAL footprint before choosing a smaller pilot receipt ceiling; this report makes no 1GB sufficiency claim.
