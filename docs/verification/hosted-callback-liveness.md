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
alerting. The Vercel monitor remains unarmed and unscheduled, and its production
environment does not yet have `LIKERTS_CALLBACK_STATUS_TOKEN`. No receiver was
configured or contacted. Named primary/backup responders, an approved receiver,
failure and recovery delivery, independent missed-run detection, and human
acknowledgment remain required to close H04.
