> **Historical measurement checkpoint.** The “current” hashes, 112-test result and frozen-source language below describe this earlier checkpoint. Start with the [portable README](../README.md) for the final READ COMMITTED pin and the 236-test functional receipt. All earlier measurements and source identities remain unchanged.

# Checked-out connection failure and bounded query batching

6 November 2026. This follows the first v3 normalization checkpoint; earlier fingerprints/results remain historical.

## Actual dropped COMMIT acknowledgement

The independent protocol proxy first reproduced an uncaught pg.Client error while COMMIT was awaiting its response. pg-pool removes its idle error listener during checkout. A pool-level error listener therefore did not handle this checked-out connection's EventEmitter error, even though the command caller awaited/caught its rejected query.

The store now attaches one lifetime client error/end listener through pool connect/acquire before initialization, with a checkout fallback. It records only membership in a weak broken-client set, without retaining driver errors or logging them. Query rejection remains intact. Release always discards a broken client, including when a simulated rollback subsequently succeeds. The guard does not report a missing acknowledgement as success or replay a transaction.

The actual proxy test then passed: it observed PostgreSQL's successful COMMIT CommandComplete and idle ReadyForQuery, withheld both from the caller and dropped that owned connection. The caller received a sanitized phase=commit, outcome=unknown failure with failed rollback. The matching PostgreSQL backend PID was observed leaving the pool. A fresh authoritative connection found exactly one receipt/scoring transition; advancing the round and retrying the original UUID returned current state without another effect. Original RED and fixed GREEN artifacts are preserved in Phase3/evidence/commit-ack-first.tap and commit-ack-fixed.tap; the independent receipt is Phase3/commit-ack-recovery.md.

## Query-shape diagnosis

The first full paired12-player run had substantial WAL savings but worse latency. The added query round trips were a hypothesis to measure, not an established sole cause. An owned diagnostic wrapped pg.Client.query only in its separate process, preserving callback and Promise return/error behavior. It recorded fixed enum labels/counts/timings and post-lock duration, never SQL, parameters, room/player values, credentials or connection URLs. Production code and the main benchmark harness were not instrumented.

Each diagnostic executed44 accepted commands, two complete four-player matches/eight reveals, actual HTTP/WebSockets and owned-schema cleanup. It had no human think-time delay and is not the main benchmark or an end-user latency certification.

| Diagnostic | Query calls | Room lock calls | Action p95 | Post-lock p95 |
| --- | ---: | ---: | ---: | ---: |
| Sealed Phase2 | 969 | 112 | 64.463ms | 15.144ms |
| v3 before batching | 1463 | 106 | 42.073ms | 12.632ms |
| v3 after batching | 1211 | 113 | 88.794ms | 29.890ms |

These short ordered samples did not reproduce the twelve-player latency pattern and do not prove a latency win. Cache/order/host variance was not controlled. Fan-out and maintenance timing vary, and the capture window can straddle in-flight transaction boundaries; call counts are observed window totals, not a precisely identical transaction census. Their useful finding is the changed query shape: v3 issued two configure calls per transaction and two bounded metadata reads per room load.

Only two small changes were made:

1. Send the same constant lock-timeout and writer-version SET LOCAL statements in one query call, preserving BEGIN separately and the existing configure diagnostic phase. This reduces calls, not the number of configuration SQL statements.
2. Read bounded membership and leases with one UNION ALL query. This remains a separate statement after the initial room FOR UPDATE completes, preserving a fresh READ COMMITTED child snapshot after a lock wait. Both adapters execute the same program. Limits, verifiers, row consistency validation and corruption rejection remain enforced.

The final diagnostic observed17.2% fewer total query calls than its earlier v3 sample. Configure calls changed358→184 (two→one per transaction); separate member/lease reads210→109 combined reads (two→one per load). Actual transaction/lock totals varied as shown. Receipt lookup/insert, membership updates, room locks, durable budgets, timeouts and privacy projections were not removed or weakened.

Raw diagnostic results and the exact independent probe fingerprint are Phase3/evidence/query-phase2-4p.json, query-v3-before-batch-4p.json and query-v3-after-batch-4p.json. The probe is Phase3/query-shape-probe.mjs, outside the frozen main benchmark harness.

## Final affected correctness checkpoint

On Node22.23.4/Pg17.10, the sequential command below passed112/112, zero failed/canceled/skipped,45,862.517083ms. This includes the actual COMMIT proxy case and all nine independent v3 adversarial cases; do not add those again as extra unique tests.

```sh
node --test --test-concurrency=1 test/backend*.test.mjs test/phase3-security.test.mjs
```

All24 recorded inputs were identical before and after execution. Exact inputs, TAP and result are Phase3/evidence/v3-batched-before.json, v3-batched-affected.tap and v3-batched-result.json. Test-owned workers, sockets, pools, random PostgreSQL schemas and SQLite files were cleaned; the process exited0. SQLite emitted its expected ExperimentalWarning.

Current store SHA: e766696776b16125a7f9397a2d179e08bdae654f90cb87da503efca03772b9ce.
Current storage-v3 SHA: 82134d953503e41ce2d0f13599c60d75b79e776412ff435f4e29901e394ce260.

Source is frozen for the coordinator's final paired twelve-player measurement. Full application suites and the final performance/resource assessment remain separately recorded work. No managed provider, production TLS, deployment, new credentials, paid resources or public capacity guarantee is implied by these local results.
