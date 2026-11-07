# PostgreSQL stress-failure diagnosis — 2026-11-06

## What the original failure proves

The original combined backend run passed 43/44 tests. The 100-competing-mutation PostgreSQL test rejected `Promise.all` at index 61 after 7.001 seconds with `storage_unavailable`. A native Simulator build was also running. The later unchanged sequential run passed all 44 tests, including those same 100 mutations in 936.8ms.

The original driver message/code was discarded by `PostgreSQLStore.transaction`, which attempted rollback and then created a new generic error without a cause. No retained raw-driver log was found. Therefore the original cause cannot be recovered from that record. Compiler activity is contextual evidence, not a proven cause. The successful rerun establishes non-reproduction under that later workload; it does not identify the earlier failure.

## Existing limits, unchanged

| Boundary | Actual configuration |
| --- | --- |
| Pool | Ten connections per store, including one dedicated LISTEN connection; nine available for room transactions |
| Pool checkout / connection establishment | 5,000ms |
| PostgreSQL statement timeout | 5,000ms |
| Transaction-local lock timeout | 5,000ms |
| Client query-read timeout | 6,000ms |
| PostgreSQL test case timeout | 30,000ms |

The stress test starts 100 mutations across two independent stores. Its elapsed time can include queueing, database waits, client timers and rollback. Seven seconds is insufficient to distinguish those paths. Installed `pg@8.23.0` and `pg-pool@3.14.0` have different fixed messages for pool checkout, connection establishment and local query-read timeouts; PostgreSQL server errors additionally carry SQLSTATE. Primary installed sources are `node_modules/pg-pool/index.js:224,276`, `node_modules/pg/lib/client.js:170,707` and `node_modules/pg-protocol/dist/parser.js:308`.

PostgreSQL's SQLSTATE `55P03` means lock unavailable, and `57014` means query canceled. Neither alone proves a specific timeout. The classifier uses the broad code category unless a recognized fixed timeout message establishes a narrower label. Localized/unknown messages retain the generic category. [PostgreSQL 17 error-code reference](https://www.postgresql.org/docs/17/errcodes-appendix.html).

Equal statement and lock timeout values cause the statement limit to expire first, so a lock-wait workload can legitimately produce a statement timeout. No timeout was changed to manufacture a different classification. [PostgreSQL 17 lock-timeout documentation](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-LOCK-TIMEOUT).

## Targeted fix

Internal storage failures now retain only:

- Enum operation phase and category; recognized SQLSTATE or null.
- Integer elapsed milliseconds captured before rollback.
- Bounded numeric pool total/idle/waiting counts at failure.
- Rollback outcome and transaction outcome, including an explicit unknown result for a COMMIT response timeout.

Raw driver messages, causes, SQL, parameters, URLs, provider names, room/member identifiers, nicknames, answers, guesses and credentials are not retained in that diagnostic. No diagnostic is automatically logged or added to the HTTP response. `publicError` continues returning the same generic 503 envelope; tests verify that internal fields and private fixture markers cannot cross it.

If rollback cannot be confirmed, the client is discarded with `release(true)` rather than returned to the idle pool. This closes a source-confirmed recovery gap; it is not claimed as the cause of the original stress failure. A commit timeout remains an unknown outcome even if a later rollback succeeds. No automatic mutation replay was added: clients resolve ambiguity using the original request ID, preserving API idempotency.

## Reproducible feedback loops

The tests exercise the actual transaction catch path with controlled driver failures. Before the fix, seven of eight initial tests failed: diagnostics were absent and failed rollback returned the connection normally. After the fix, nine focused tests pass, including a subsequent release-error case. They distinguish pool checkout, connection establishment, query read, server cancellation/lock/deadlock, rollback failure and ambiguous commit; they also prove ordinary success and domain errors retain their behavior.

Two controlled probes ran against only the root-owned disposable loopback PostgreSQL fixture:

| Probe | Observed diagnostic | Recovery proof |
| --- | --- | --- |
| Hold the nine available connections in one owned pool | `phase=acquire`, `kind=pool_acquire_timeout`, elapsed 5,001ms; pool total ten / idle zero; no transaction started | Release only those held clients; a subsequent transaction succeeds |
| Hold an owned room row from a second transaction | `phase=operation`, `kind=statement_timeout`, SQLSTATE `57014`, elapsed 5,012ms; rollback succeeded | Release the owned blocker; count remains zero, then one fresh mutation commits exactly once |

These prove distinguishable, bounded failure and recovery modes. They do not retroactively prove which one occurred in the original run. The probes use no CPU throttling, system settings, database-wide changes, disabled timeouts, increased timeouts, new services or production data.

## Verification and handoff

At diagnostic fingerprint **`8d8e440fb5f13f89a6fecacb7353f6f2c7df029cd3e2696eb123001190624996`**, the expanded backend suite passed **55/55**, zero skipped, in 15.827s; the original 100-mutation test passed in 703.6ms. The independent security suite passed **23/23**, zero skipped, in 9.081s, including actual independent PostgreSQL-backed processes. The two controlled probes also passed within that full run (5,002ms pool acquisition; 5,004ms row contention).

A final classification-label refinement then made generic `55P03` explicitly `lock_unavailable`, with `lock_timeout` reserved for its fixed timeout message. **Nine focused classifier/recovery tests passed on that final source.** No game behavior, limits or transport changed. The root requested holding further PostgreSQL/full-suite work while native runtime verification starts, and will run one final all-files sequential suite after all source changes settle:

```sh
# Set LIKERTS_LIVE_TEST_DATABASE_URL only to the authorized disposable
# loopback likerts_live_test fixture. Do not use the survey DATABASE_URL.
node --test --test-concurrency=1 --test-reporter=spec test/*.test.mjs
```

Final combined backend fingerprint: **`a26b14c528a093cd51819028d65666b64236928db8f336274476b09220117843`**. Final `server/store.mjs` SHA-256: **`09f42408c3e5cbfac02c1e8989eb9fb917ac11fc1b507bfa466e49931597e4d5`**. The combined hash follows the existing load harness's fixed-order source/catalogue algorithm. Earlier load measurements remain tied to their original `c5a062…` fingerprint; they were not relabeled as measurements of this diagnostic patch. No tests or probes remain running from this investigation.
