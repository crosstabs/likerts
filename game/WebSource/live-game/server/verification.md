> **Historical verification record.** The “current/latest” labels, counts, limits and hashes below belong to their dated checkpoints. The [portable README](../README.md) links the final READ COMMITTED isolation proof and the 236-test functional receipt. These older results are preserved with their original scope.

# Backend verification checkpoint — 2026-11-06

The later v3 receipt/member/lease layout is described in [storage-v3.md](storage-v3.md). The actual COMMIT-loss fix, bounded batching and112-test checkpoint are in [query-batching.md](query-batching.md). Earlier results below retain their own source fingerprints.

The subsequent Phase2 lifecycle corrections and fresh focused results are in [phase2-lifecycle.md](phase2-lifecycle.md). Earlier results below retain their historical fingerprints; they are not automatically results for the new source.

The backend is implemented with the local verification evidence below. This is not a production-readiness or capacity certification. No deployment, provider provisioning, production data access or survey-service modification was performed.

## Latest diagnostic follow-up

### Subsequent launch-cap and health follow-up

The current backend fingerprint is **`8478c33d4f0dea3b59fd36f566693e9668c3d9ef68586397ec7162d9e46eaf85`** after explicit startup caps and cached readiness were added. Production's player ceiling is fixed12; its default/maximum launch policy is four rooms,64 sockets per process,24 sockets per room and two sockets per member. Startup validates environment overrides and passes them to the store and transport. `.env.example`, protocol and metadata schema document those policy ceilings without claiming production capacity.

The focused configuration/health plus HTTP suite passed **13/13**, zero skipped, in 589ms. It proved64 anonymous health/liveness requests caused only the initial readiness query and zero additional database queries or database-backed budget writes; failed/stale readiness returns503, liveness stays independent, refreshes share one pending probe, and readiness can recover. It also proved invalid/unsupported production overrides reject startup, lower development metadata/defaults are coherent, and admissions cannot exceed the actual service cap. No running native test service was restarted.

There are now64 unique backend tests (the previous55 plus eight configuration/health tests and the full-room reconnect regression). Root subsequently ran the default sequential npm test command against the owned local PostgreSQL fixture: 139/139 passed, zero failures/skips, including all64 backend tests,23 independent security tests,27 browser client tests and25 DOM UI tests. The full output is retained in LiveMultiplayer/2026-11-06/evidence/final-node-tests.log; final source inputs are fingerprinted separately. The diagnostic and load results below remain historical at their stated fingerprints.

Current file hashes: `server/app.mjs` = `3dbacf00b216f0405c4d51b2fcb1fc2312e4ca546219f1e0224b205f06f995bb`; `server/index.mjs` = `9ad2bf9fadc0b8ae073a941c4aa153a9fd9ff25911acf23ff79fa7c16c9412ab`; `server/store.mjs` remains `09f42408c3e5cbfac02c1e8989eb9fb917ac11fc1b507bfa466e49931597e4d5`.

### Earlier diagnostic runs

The targeted storage-error diagnostic/recovery patch passed **55/55 backend and 23/23 independent security tests**, including actual PostgreSQL, at fingerprint `8d8e440fb5f13f89a6fecacb7353f6f2c7df029cd3e2696eb123001190624996`. A final generic-55P03 category refinement subsequently passed its **nine focused classifier/recovery tests** at current fingerprint `a26b14c528a093cd51819028d65666b64236928db8f336274476b09220117843`. The root will run one final all-files sequential suite once native/UI source changes settle; no further PostgreSQL/full-suite work is running during that native verification window. See `stress-diagnosis.md` for exact commands, controlled pool/row contention probes, unchanged limits and the original failure's unrecoverable cause.

The diagnostic follow-up's `server/store.mjs` SHA-256 is `09f42408c3e5cbfac02c1e8989eb9fb917ac11fc1b507bfa466e49931597e4d5`. The older correctness and load evidence below is retained with its original source fingerprints rather than relabeled as a current full run.

## Earlier combined correctness run

From `live-game`, with `LIKERTS_LIVE_TEST_DATABASE_URL` set only to the root-owned disposable loopback fixture:

```sh
node --test --test-concurrency=1 --test-reporter=spec test/backend*.mjs
```

**44 passed, zero failed, zero skipped; 9.127 seconds.** The tests comprise 12 reducer/projection tests, five HTTP/static-route tests, 18 SQLite tests and nine actual PostgreSQL tests. The PostgreSQL concurrent-write test retains 100 competing mutations across two adapters and completed in 936.8ms. All limits, assertions and timeouts were unchanged for this rerun.

The independent acceptance suite separately completed **23/23, zero skipped**, including actual independent PostgreSQL-backed service processes, replacement of a worker after a private answer, scoped reconnects, cross-worker fan-out, one-time scoring, shared admission limits and revocation. Its two PostgreSQL cases were additionally rerun with stronger socket-cap assertions. These are not two additional unique tests.

Meaningful regressions covered include host/other-player counterfactual secret projection equality, immutable locks, exact match/round binding, duplicate request conflicts, equal complete-cycle opportunities/shared ranks, pause and deadlines, missing guesses, provisional incomplete results, departure/kick revocation, catalogue exhaustion/rematch selection, response-loss recovery, same-ID admission races, transaction rollback, restart durability, room/metadata/rate ceilings, strict Origin checks, static path isolation and queued-send budgeting.

Admissions bind to an immutable room UUID. A forced same-code/same-createdAt close-and-replacement test rejects the old host's recovery capability with 410 while the new host remains authorized. A legacy missing binding fails closed; it is not inferred or backfilled. This was verified with SQLite and actual PostgreSQL.

## Historical failure retained

An earlier combined run using default parallel test-file execution completed 43/44. The 100-competing-write PostgreSQL test failed after 7.001 seconds with the sanitized `storage_unavailable` error while a large native Simulator build was also running. The original driver reason was not retained, so the precise cause remains unclassified; the build's simultaneous execution is an observation, not proof of causality. Every other test passed in that run. The later idle-window sequential 44/44 run resolved the reproducibility check without changing code, assertions or timeout bounds. Overload/provider failures still reject work explicitly rather than accepting an uncommitted action.

## Earlier local load evidence

The independent loopback harness completed the following on the historical `c5a062…` backend fingerprint below, before the diagnostic follow-up:

| Profile | Actual workload | Outcome | HTTP p95 | State fan-out p95 |
| --- | --- | --- | --- | --- |
| One 50-player room | 51 sockets; three revealed rounds | Zero gameplay errors; 1.965s workload | 236.28ms | 258.45ms |
| Four 12-player rooms | 48 players; 52 sockets; 48 revealed rounds; four complete matches | Zero gameplay errors; all four owned rooms closed; 3.044s workload | 74.51ms | 91.75ms |

The 50-player sample reported peak combined RSS 150,470,656 bytes and maximum event-loop delay 150.08ms. It is a three-round sample, not a complete 50-player cycle. The earlier unoptimized local sample reported HTTP p95 1,566.33ms and fan-out p95 1,566.58ms. The implementation now coalesces notifications over 16ms, reads one committed room per fan-out batch, and independently authorizes/projects each recipient. These before/after local samples are not a controlled production benchmark or a guarantee for another machine/topology.

During an environment interruption, a first attempt at the four-room profile failed before a session ID could be obtained. After access was restored, the root checked that no previous load process/listener remained; the completed four-room result above came from the subsequent authorized run. No uncertain process was blindly duplicated.

## Source fingerprints

The historical load-harness combined SHA-256 is **`c5a062f6f1dc4af287b938b40c7d913252d9d79d8ac2c6db4a2275c5e9bc31c1`**. It hashes the path names and bytes of `server/app.mjs`, `server/engine.mjs`, `server/store.mjs`, `server/errors.mjs` and `shared/catalogue.json` in the harness's fixed order. It was independently recomputed after environment restoration and before the earlier 44-test run. The file hashes in this table describe that historical checkpoint.

| File | SHA-256 |
| --- | --- |
| `server/app.mjs` | `976d2e45542535c4baa54437d5dc9177c11056708aada05c34baa8bb33f47103` |
| `server/engine.mjs` | `b56257833d7b08c2c8e65f22340a27ad900bdefe8575aed075672e1491d4c90b` |
| `server/errors.mjs` | `034fbb4646ea7d9bc1c81cf33cc113e7e600feaffd362f38317a470f133f212c` |
| `server/index.mjs` | `88e57992a4c9deaf93a87ea920061fc618bdd611cc5d5f3c42ebeb6ea4ba80e8` |
| `server/store.mjs` | `664660a35f2826ad6b285f8d68dc640f8e597fc6e0eaa9f476c43deda6d65674` |

The reviewed catalogue hash is `28f342b2cfe60f611573de432173b20e0f71d4699a0d2fd9de910b011dc15aea`. Direct installed dependencies are `pg@8.23.0`, `ws@8.22.0`, and development-only `jsdom@26.1.0`, pinned by the package lock. Official npm installation used `--ignore-scripts`. SQLite emitted Node's expected ExperimentalWarning; npm emitted the existing jsdom-transitive `whatwg-encoding@3.1.1` deprecation notice.

## Remaining boundaries

Production TLS/networking, trusted proxy peer attribution, dedicated migration/runtime roles, provider operating envelope, monitoring ownership, privacy/retention/backup policy, internet/device journeys, sustained load, rolling deployment and backup restoration remain deployment/release work. The disposable PostgreSQL fixture did not verify a production provider's TLS handshake or infrastructure failover. Active-row deletion does not establish erasure from WAL, history or backups. The root owns fixture/service cleanup and broader web/native verification. See `README.md`, `storage.md`, `../operations.md` and `../PROTOCOL.md`.
