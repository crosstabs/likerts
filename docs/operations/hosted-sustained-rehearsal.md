# Bounded hosted sustained rehearsal

`node scripts/check-hosted-sustained.mjs` runs a synthetic 10-minute workload. It is a bounded correctness/latency experiment, not a claim of capacity, uptime, SLA, failover or sustainable margin. Do not run it against customer workspaces.

## Inputs and limits

The owner provisions at least four **new, disposable** `hosted-launch-*` workspaces using the approved bootstrap/migration workflow. Each must have exactly 1,000 promotional credits, zero paid credits/debt/usage and no survey drafts. Do not share these workspaces with other traffic during the run.

Save a private regular file (0600; no symlink) outside the repository. It must have this shape, with real values supplied privately:

```json
{
  "workspaces": [
    {
      "workspaceId": "hosted-launch-sustained-unique-1",
      "bootstrapToken": "SUPPLY_PRIVATE_BOOTSTRAP_CREDENTIAL",
      "disposable": true
    }
  ]
}
```

The example shows one entry; the default workload requires four distinct workspace/credential pairs. The `disposable: true` attestation authorizes cleanup of that specific supplied workspace **only after** the runner proves a pristine ledger, empty survey inventory and exact workspace binding through its newly issued child credential. A mismatch never authorizes workspace deletion. Only an exact child credential created by this run may be revoked if later verification fails.

The default plan schedules 3,000 response attempts over 600 seconds: 2,700 valid, 150 identical seeded retries and 150 invalid answers. Four seed responses are additional. Unique accepted responses are bounded to 2,704 across four workspaces; a workspace receives at most 685 unique planned responses. Its collection cap is one higher than its planned acceptance count to keep the final invalid attempt inside the validation path. Each cap remains below the 1,000 promotional-credit grant.

Every HTTP request, including setup, exports, periodic usage checks and cleanup, shares a maximum **5 RPS dispatch rate** and at most **8 in-flight requests**. No catch-up bursts occur. Management traffic may reduce actual submission throughput; evidence records delivered rates, skipped slots, status counts, schedule lag and latency rather than asserting the requested rate was achieved. The main request budget is 3,600; bounded cleanup requests may exceed it so an exhausted measurement budget never prevents safe cleanup.

Two private JSON export jobs start at 25% and 65% of the measured window while response collection continues. Each is polled with a fixed bound, downloaded using the workspace credential, rejected with an invalid credential and checked against its SHA-256. Contents are discarded, not saved in evidence. No callback or external alert receiver is used.

## Dry run first

```sh
export LIKERTS_HOSTED_WORKSPACES_FILE=/private/path/workspaces.json
node scripts/check-hosted-sustained.mjs --dry-run
```

Dry-run validates file permissions, names, explicit disposable attestations, distinct credentials, attempt budgets and promotional-credit bounds. It performs **zero network calls** and prints no workspace IDs or credentials. It does not prove the supplied remote workspaces are pristine; that check happens before the actual workload.

The optional environment settings `LIKERTS_HOSTED_TARGET_RPS` (0.1–5, default 5) and `LIKERTS_HOSTED_DURATION_SECONDS` (60–600, default 600) can reduce a rehearsal. Evidence always records actual settings; a shorter run is not a 10-minute result.

## Owner-controlled hosted run

After provisioning and reviewing the dry-run plan:

```sh
export LIKERTS_HOSTED_BASE_URL=https://likerts-api.onrender.com
export LIKERTS_HOSTED_EVIDENCE_OUTPUT=/private/path/sustained-evidence.json
node scripts/check-hosted-sustained.mjs
```

The API must be one exact HTTPS origin. Evidence must not overwrite the credentials file. Setup/cleanup time is additional to the measured 10-minute window. The runner reports aggregate progress each minute and excludes tokens, answer payloads, export bytes and workspace identifiers from evidence/log output. A paid-credit change, wrong receipt, unexpected rejection or accounting discrepancy stops the workload. `SIGINT`/`SIGTERM` stops new requests and aborts in-flight measurement traffic, then runs cleanup through independent bounded requests.

For each verified disposable workspace, cleanup revokes this run's exports, tombstones the workspace and verifies that both bootstrap and child credentials are denied. It retries tombstone acknowledgement/denial verification up to three times. Unverified workspaces are never tombstoned. Review `cleanup` and `failures`; a failed or unverified cleanup must not be treated as a passed run. Preserve the private input file until all supplied workspace cleanup has been confirmed through the owner workflow, then remove it securely.

A hard process kill, machine shutdown, API outage or interrupted network can prevent cleanup; the private input file is the owner's bounded recovery list. The runner never discovers or sweeps other workspaces and does not replace baseline evidence files. Store new results under a new reviewed evidence filename.

## Read the evidence accurately

- `workload` is the requested envelope and hard bounds.
- `phases` and `sustained` contain dispatched/skipped counts, measured rates and p50/p95/p99 client latency. All phases share the full sustained-window denominator.
- `exports` contains only success/privacy/hash checks, byte count, response count and elapsed time.
- `accounting` reconciles all unique acknowledged accepted receipts, cents, promotional responses/remaining credits and zero paid exposure.
- `cleanup` counts verified, deleted, denied and unverified-not-deleted workspaces. No secret or workspace identifier is included.
- `status: passed` means the checks passed for the traffic actually delivered and verified cleanup completed. It is not an assertion that every scheduled slot was dispatched at the target rate; inspect `sustained` before quoting throughput.

Local validation: `node --test tests/hosted-sustained.test.mjs`. These tests exercise planning, credential-file safety, pristine-ledger admission and dry-run non-disclosure; hosted workload, export behavior and cleanup must be verified by a separate approved hosted execution.
