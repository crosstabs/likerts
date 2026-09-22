# Hosted callback-worker liveness

On 20 September 2026, the callback-worker liveness contract from commit
`ec8a581c2c7b9c739bc94a14633741bd5af8a9e4` was deployed to the bounded Render
preview in the documented migration-first order.

## Deployment evidence

| Step | Render identity | Result |
| --- | --- | --- |
| Migration image | `dep-danl2vbm8hqs73bm6pmg` | Live at `ec8a581c2c7b9c739bc94a14633741bd5af8a9e4` |
| Migration and restricted grants | `job-danl5b142hec73ert7cg` | Succeeded; migration `0029` and the runtime/worker grant scripts completed |
| Callback worker | `dep-danl5m142hec73eru6t0` | Live at the same commit; startup role checks passed |
| API | `dep-danl85rm8hqs73bmlgv0` | Live at the same commit across the configured two instances |

After promotion, `https://likerts-api.onrender.com/health` returned HTTP 200
with `{"status":"ok","storage":"postgresql"}`. An owner-credential read of
`likerts.callback_worker_status()` through an ephemeral PostgreSQL client
returned the fixed value `reachable`; the credential and connection string
were not written to evidence. An unauthenticated request to
`/internal/callback-status` returned HTTP 401, `Cache-Control: no-store`, and
the fixed body `{"status":"unavailable"}`.

This proves the deployed worker can complete an empty queue claim and advance
the database-clock singleton through its restricted function, and that the
deployed API exposes the protected sanitized route. It does not prove active
alerting. At that initial cutoff the Vercel monitor was unarmed and unscheduled, and its
production environment did not yet have `LIKERTS_CALLBACK_STATUS_TOKEN`. No receiver was
configured or contacted. Named primary/backup responders, an approved receiver,
failure and recovery delivery, independent missed-run detection, and human
acknowledgment remain required to close H04.

## Production configuration follow-up — 22 September 2026

Protected PR #41 merged as `0e24bf510581af22f0a884e7998c7ac1e9d80331`.
Vercel production `dpl_7ZDWBUv4UEmyXn58mkEbjuLHu2YD` is READY at that commit.
All 12 prepared monitor configuration variables, including the callback token,
were read back as sensitive and production-only. The arming flag is absent.
An authenticated production `/api/monitor` request returned HTTP 503 with
`{"status":"not_armed","reason":"approved_receiver_and_responder_required"}`.
The configured admission and callback read-only probes both returned
`reachable` from the operator host. No receiver was contacted.

Cleanup/archive status initially failed on their friendly route despite valid
credentials. A credential-free diagnostic preview confirmed that the Vercel Node
launcher retains `/api/status` and appends `?likerts_action=status`; this
request shape was missing from the exact route allowlist. Both direct read-only
selectors returned HTTP 200. PR #42 adds the observed exact form, with a
regression test that first failed with the production 401 and then passed.
The temporary diagnostic deployment was removed after reproduction.

This configuration progress does not close H04: a scheduled monitor, approved
receiver, named primary/backup responders, independent missed-run coverage,
delivered failure/recovery alerts and human acknowledgment remain outstanding.

PR #42 subsequently passed both required checks and merged as
`351824d754969aba72ceef635def73d17bbc0470`. Both rebuilt production maintenance
services returned HTTP 200 on authenticated `/api/status`. Missing/wrong monitor
credentials and extra query parameters returned HTTP 401. The actual monitor
probe implementation now returns `backlog` for both services, matching one
pending cleanup object, 40 due retention workspaces and 10 pending archive
events. Their schedules remain disabled. Admission and callback probes remain
`reachable`, and the production monitor still fails closed as `not_armed`.

## Durable store readback — 22 September 2026

At 12:13 UTC, source `9f0a028` exercised the existing production Redis backing
store through the Vercel integration credential in a fresh synthetic namespace.
The deployed sensitive monitor credential itself was not exported or tested by
this probe. Seven checks passed: empty state reports a missing signal; overlapping
leases are rejected; a wrong lease cannot write/release; a separate store instance
reads healthy state with the seven-day TTL; pending synthetic notification state
survives readback; a synthetic accepted notification retains the degraded health
classification; and stale state reports a missing signal.

The check made 21 bounded Redis HTTP requests. Both owned keys were removed and
their absence verified. The production namespace was untouched, no notification
was sent, and the temporary environment download was removed. This is an
operator-side backing-store check, not a deployed monitor invocation, scheduled
heartbeat, delivered alert or human acknowledgment. H04 remains open.
