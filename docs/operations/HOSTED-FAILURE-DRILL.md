# Hosted process-loss and DNS acceptance

Reviewed 2026-09-10; isolated receiver preparation verified locally 2026-09-13. The bounded hosted worker-loss, DNS and compatible rollback procedure subsequently passed on 15 September in the [combined evidence](../verification/hosted-callback-recovery.md). This remains the reusable operator procedure; it is not evidence for a future run or a different deployment.

Subsequent [hosted receiver verification](../verification/hosted-receiver.md) passed on Vercel/Redis with one locally signed synthetic event. The marker was visible during the hold, a duplicate acknowledged first, and cleanup removed that signed deployment. Those later provider operations are recorded separately; they did not exercise an API/worker interruption or lease reclaim.

## Decision

The [disposable supervisor fixture](../../infrastructure/failure-fixture/README.md) avoids the observed production PID 1 constraint without changing production. It copies the released API/worker binaries into a separate container and permits one authenticated, identity-checked kill per child. Local native guard tests and a constrained emulated lifecycle passed; peak web memory was 180.1 MiB under a 512 MiB/no-swap limit with PostgreSQL separate. The [native hosted export drill](../verification/hosted-export-recovery.md) and later [callback recovery drill](../verification/hosted-callback-recovery.md) used separate Free Render web/PostgreSQL resources and exact child loss. Fixture credentials were revoked and all owned resources were removed. The SSH procedure below remains an alternative for an independently authorized, eligible instance.

Use an SSH session to one **verified live instance** and signal one exact application PID with `SIGKILL`, after a synthetic job is demonstrably in flight. `render restart` is a graceful replacement deployment and cannot substitute for this test. Current official Render documentation says restart replaces instances and deploy shutdown sends SIGTERM before any eventual forced kill. The previous hosted drills let the original leases finish. [Render deploy lifecycle](https://render.com/docs/deploys)

The image previously created UID 10001 with `nologin`, no home and no `.ssh` directory. It now creates `/home/likerts`, `/bin/sh` and an owned mode-0700 `.ssh` directory, retaining UID/GID 10001. It installs no SSH daemon, keys, password, sudo, additional capability or extra runtime credential. These are the Docker prerequisites described by Render; they are **not proof that this account can already SSH**. [Render SSH requirements](https://render.com/docs/ssh#docker-specific-configuration)

There is one additional gate: the selected application must be a normal child PID greater than 1. Same-namespace processes cannot ordinarily SIGKILL the namespace-init PID 1. If the binary is PID 1, stop: an operator-reviewed init wrapper or provider-side force-termination facility is needed. Do not report a successful `kill` exit status as a proven crash. No undocumented Render force-kill API was established in this review. [Linux PID namespace semantics](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html)

Read-only live preflight on 2026-09-13 at 05:45 UTC reached API instance `srv-dagbp57qj5pc738fe96g-847c7fbccd-dtt4c` through the existing Render dashboard shell. The caller and `/usr/local/bin/likerts-server` had UID 10001; the server was **PID 1**, so this instance fails the child-PID gate. No signal was sent. Other API instances and the callback worker were not inspected, and dashboard shell access does not prove account SSH authentication. Review and test the required process topology in isolated resources before attempting loss; this observation does not authorize a production interruption.

## Access and preflight

Required: Render account access to the intended paid web service/background worker; an account-registered SSH public key and corresponding private key held locally; operator access to exact-instance IDs; approved synthetic workspace credentials; and the migration job's existing restricted-use owner connection for **read-only** lease/count observations. Keep the owner credential off API, worker and local evidence. Provider access remains with the parent/operator.

Do not run alongside a deploy, migration, other load drill or customer traffic. Before each kill, the operator must verify no nonfixture queued/running work and no active customer collection traffic; a quiet callback queue alone does not prove that the API is safe to interrupt. Abort on uncertainty. Only the supplied, preverified `hosted-launch-*` workspace is eligible for cleanup.

The installed CLI is 2.22.0. These exact commands were checked with local `--help`; they do not print environment secrets:

```sh
render services instances "$LIKERTS_DRILL_SERVICE_ID" --output json
render ssh "$LIKERTS_DRILL_INSTANCE_ID"
```

Choose the full instance ID from the inventory. Do not use `--ephemeral`: that starts another instance without the service start command and cannot kill the live owner. For scripted SSH, copy the account's documented Connect command and append the instance slug, using the correct regional host; verify its host key against Render's published fingerprint. Do not disable host-key checking. [Render CLI reference](https://render.com/docs/cli-reference), [specific-instance SSH](https://render.com/docs/ssh#connecting-to-a-specific-instance)

Inside the selected shell, inspect only allowlisted metadata, never `env`, `/proc/*/environ` or full command lines:

```sh
id -u
getent passwd likerts
stat -c '%u:%g %a' /home/likerts/.ssh
node - <<'NODE'
const fs = require('node:fs');
const allowed = new Set(['/usr/local/bin/likerts-server', '/usr/local/bin/likerts-webhook-worker']);
const rows = [];
for (const entry of fs.readdirSync('/proc')) {
  if (!/^\d+$/.test(entry)) continue;
  try {
    const executable = fs.readlinkSync(`/proc/${entry}/exe`);
    if (!allowed.has(executable)) continue;
    const status = fs.readFileSync(`/proc/${entry}/status`, 'utf8');
    const uid = Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]);
    const stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8');
    const startTicks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    rows.push({pid: Number(entry), uid, executable, startTicks});
  } catch {}
}
console.log(JSON.stringify({
  serviceId: process.env.RENDER_SERVICE_ID,
  instanceId: process.env.RENDER_INSTANCE_ID,
  processes: rows,
}));
NODE
```

The service/instance IDs must equal the intended inventory entry, UID must be 10001, exactly one expected binary must match, and PID must be greater than 1. Record the binary SHA-256 without reading secret state. `RENDER_SERVICE_ID` and `RENDER_INSTANCE_ID` are documented provider identity fields. [Default Render environment metadata](https://render.com/docs/environment-variables)

Once the job's in-flight gate is met, perform a second identity/start-time check immediately before the signal. Run this only in the already verified shell, substituting the recorded nonsecret values:

```sh
node - EXPECTED_SERVICE EXPECTED_INSTANCE EXPECTED_PID EXPECTED_START_TICKS /usr/local/bin/likerts-webhook-worker <<'NODE'
const fs = require('node:fs');
const [service, instance, rawPid, startTicks, executable] = process.argv.slice(2);
const pid = Number(rawPid);
function requireValue(ok) { if (!ok) throw new Error('drill_identity_mismatch'); }
requireValue(process.env.RENDER_SERVICE_ID === service && process.env.RENDER_INSTANCE_ID === instance);
requireValue(process.getuid() === 10001 && Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid);
requireValue(['/usr/local/bin/likerts-server','/usr/local/bin/likerts-webhook-worker'].includes(executable));
requireValue(fs.readlinkSync(`/proc/${pid}/exe`) === executable);
const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
requireValue(Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]) === 10001);
const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
requireValue(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] === startTicks);
console.log(JSON.stringify({signal:'SIGKILL', requestedAt:new Date().toISOString(), pid}));
process.kill(pid, 'SIGKILL');
NODE
```

This is an explicit disruptive command, not a health probe. The checks narrow wrong-target/PID-reuse risk but are not an atomic `pidfd` signal. Use one preopened session and one attempt; abort on process change rather than broadening to `pkill`, process groups, PID 1 or all instances. Verify the old process exits and a replacement starts; SSH disconnection by itself proves neither.

## Callback lease reclaim

Source behavior: `backend/src/webhook_store.rs` claims a 30-second lease; subsequent claims mark an abandoned attempt `expired` / `worker_lease_expired`, then start a new attempt. `backend/src/bin/likerts-webhook-worker.rs` handles SIGTERM and waits up to 25 seconds, explaining why the earlier eight-second receiver request drained successfully. `backend/src/webhooks.rs` imposes a ten-second HTTP deadline.

The [isolated signed receiver](../../infrastructure/acceptance/receiver/README.md) now implements an environment-only **hold-first-verified-receipt for eight seconds** mode. Set `LIKERTS_ACCEPTANCE_HOLD_FIRST_RECEIPT=1` only on a separate temporary deployment. It validates the current `response.accepted` envelope and HMAC, atomically stores the authenticated marker, then holds only the first insertion's acknowledgment. Authenticated `GET /api/events` exposes that marker during the hold; duplicate deliveries return 204 after Redis acknowledgment without holding or replacing the original receipt. The ordinary default adds no hold, no public request parameter enables it, and the 2,000-record cap and nonextending one-hour TTL remain. Local tests prove this preparation; they do not prove a deployed receiver or expired worker-lease reclaim. The historical paid-only receiver was removed in the free community release; this fixture intentionally rejects credit-threshold events.

1. Verify the worker has one intended live instance and there are no other active workspaces' queued/running deliveries. Establish the SSH session before creating the event.
2. Use one synthetic accepted response with a disabled-then-enabled fixture endpoint subscribed to `response.accepted`, and observe its verified receiver marker plus database `running` attempt. Record lease expiry privately.
3. Signal that exact worker before the receiver's eight-second hold ends. If the attempt already completed or the window was missed, classify the attempt inconclusive; do not claim reclaim or repeat without a fresh bounded plan.
4. Poll management delivery status every two seconds for at most 180 seconds. Require the same event/delivery IDs, a new attempt ID, the previous attempt `expired` with `worker_lease_expired`, final delivered status/204, and one distinct receiver event. A `transport_failed` retry without an expired lease is a different result.
5. Revoke the endpoint, tombstone only the verified fixture workspace and verify credential denial. Preserve aggregate evidence and the old/new instance relationship; remove the temporary receiver project.

A single-instance run proves replacement after loss. It does not prove a second already-running replica reclaimed work. For that claim, use a separately bounded two-instance run and identify the claimant; current privacy-safe logs do not attribute each delivery to an instance.

## API export lease reclaim

The [native hosted export report](../verification/hosted-export-recovery.md) records the disposable supervisor path separately from the SSH alternative below. The isolated path uses a bounded controller lock on its own fresh database to keep the export snapshot in flight while the initial lease commits, then signals the exact API child through the supervisor and releases the lock before waiting for real expiry. The actual 300-second expiry, same-job recovery, new winning fence and authorized download passed, followed by credential revocation and independently verified deletion of both owned resources.

Source behavior: exports claim **300 seconds**, execution is bounded at 240 seconds, and a ready export deliberately clears its live lease columns (`backend/src/exports.rs`, `backend/src/postgres.rs`). The winning object's name is `<job UUID>.<winning lease UUID>.export`. The corrected `infrastructure/render/verify-export-reclaim.sh` compares that durable winning lease to the captured initial lease and rejects original-lease completion or a malformed fence.

The API has no autonomous export reclaim loop: a later authenticated `GET /v1/exports/{id}` calls `process_export` for queued/running jobs (`backend/src/main.rs:1546`). An owner-only DB observer cannot trigger progress. Use a separately running scoped API poller after loss; never edit lease timestamps to make a hosted result pass.

To ensure the killed process owns the initial job, create it through a tunnel to that exact API instance, not a randomly routed public POST:

```sh
render ssh "$LIKERTS_DRILL_INSTANCE_ID" -- -L 127.0.0.1:18080:127.0.0.1:10000
```

The verified service's actual port must match (10000 is the configured Render API port). In another local terminal, use a private mode-0600 curl config carrying the fixture's scoped credential to POST the exact saved export request to `http://127.0.0.1:18080/v1/exports`. All requests still pass application authorization. Start the owner verifier with the exact fixture workspace/idempotency key, observe initial running lease, then use the other preopened SSH session to kill that API process. The tunnel closing is expected; continue bounded status polling through the public HTTPS API.

Require a new fenced winning lease, private authorized download with manifest count and SHA-256 matching the synthetic snapshot, unauthorized download denial, and cleanup/revocation. Allow up to 12 minutes after the initial lease observation; the five-minute lease is real. Do not start another export in that workspace: creation can reap an expired reservation. If the original export finishes before the kill, the verifier must fail the stronger claim. A stopped process and new result still do not prove automatic background recovery—the status poll is part of this design.

## Owned DNS validation across attempts

Use a fresh leaf such as `callback-drill-<random>.likerts.com`, with no preexisting A/AAAA/CNAME records, attached as a custom hostname to the isolated signed receiver so TLS validates that exact hostname. Never touch apex, `www`, Clerk/mail records, wildcard records or authoritative nameservers for the whole domain. Check current authoritative NS publicly first:

```sh
dig +short NS likerts.com
dig +noall +answer "$LIKERTS_DRILL_HOST" A
dig +noall +answer "$LIKERTS_DRILL_HOST" AAAA
```

The operator needs authorized DNS account access. Current GoDaddy legacy v1 OpenAPI exposes GET/PUT/DELETE for one domain/type/name RRset; PUT replaces that RRset. The provider's current DNS guide documents a minimum TTL of 600 seconds. Confirm the account's actual endpoint/auth mode and authoritative hosting before a write; the existing key/secret must not be confused with newer PAT authentication. [GoDaddy DNS guide](https://developer.godaddy.com/en/docs/api-users/domains/manage/dns), [v1 machine-readable contract](https://developer.godaddy.com/openapi/domains-v1.json)

For an account that uses the legacy v1 endpoint, the precise **leaf-only** path is:

```sh
# Config is private 0600 and contains the existing authorization header; never print it.
curl --fail --silent --show-error --max-time 10 --config "$LIKERTS_DNS_CURL_CONFIG" \
  "https://api.godaddy.com/v1/domains/likerts.com/records/A/$LIKERTS_DRILL_LABEL" \
  --output "$LIKERTS_DRILL_PRIVATE_DIR/original-a.json"

# Only after ownership, absence, TLS, fixture and restoration gates are satisfied:
curl --fail --silent --show-error --max-time 10 --config "$LIKERTS_DNS_CURL_CONFIG" \
  --request PUT --header 'Content-Type: application/json' \
  --data-binary "@$LIKERTS_DRILL_PRIVATE_DIR/next-a.json" \
  "https://api.godaddy.com/v1/domains/likerts.com/records/A/$LIKERTS_DRILL_LABEL"
```

Validate `LIKERTS_DRILL_LABEL` as exactly `callback-drill-` plus 16–32 lowercase hex characters, and verify it belongs to this run. The phase file is an array such as `[{"data":"127.0.0.1","ttl":600}]`; the public phase uses the receiver's **verified actual public IP**, never a guessed or documentation address. If using a platform-required CNAME, use only the exact label's CNAME RRset and a separately controlled target; do not leave a CNAME and A at the same label. No DNS command above was run during this review.

Run at most four one-event phases: public baseline (verified 204); same hostname changed to loopback (expected `endpoint_address_denied`, no HTTP receipt); mixed public plus denied A answers (same denial); restored public (verified 204). Inspect **both A and AAAA**. Use the worker's actual system resolver via `node:dns.lookup(host,{all:true})` in the verified SSH session to establish propagation before each event; a local laptop's `dig` alone is insufficient. Poll DNS at most once per 15 seconds for 30 minutes; cache/propagation failure is inconclusive, not a security pass. Never probe a real private service/metadata URL—only verify the worker rejects the DNS answer before dispatch.

Pause/revoke endpoints before cleanup; restore/delete only the owned leaf's recorded RRsets, check authoritative answers, detach its custom domain, remove the temporary receiver. Keep before/after state privately until restoration is confirmed.

## What a true rebinding race additionally needs

Changing an ordinary GoDaddy record between deliveries proves repeated DNS validation. It cannot reliably place a DNS change between validation and connection. The production path currently calls system `lookup_host` once, validates all addresses, then pins that exact set into a new no-proxy/no-redirect/no-retry HTTPS client (`backend/src/webhooks.rs:344`); source review and deterministic tests support the intended defense, but are not a hosted race trace.

A concrete stronger fixture needs an operator-controlled authoritative DNS server reachable on UDP **and TCP 53**, delegation of only a fresh child zone, per-query logs and a TLS receiver for the exact names. Supply a public A answer for the initial resolution (AAAA NODATA), then a denied answer for subsequent resolutions with a low TTL. Use unique names per run to avoid unrelated cache entries. Public receiver receipt plus observed DNS query transitions can demonstrate behavior, but resolver caching can still prevent the intended race; record query timing and actual resolution rather than assuming TTL 0 means uncached.

No currently verified Render/Vercel HTTP project provides that authoritative UDP/TCP 53 surface; an owned suitable host/provider is an additional prerequisite. Do not silently use a third-party rebinding domain. Deterministic fallback: a separate isolated integration harness with a controlled resolver and two destinations tests that the HTTP client uses only the validated pinned address. Label that local evidence honestly; keep the hosted dynamic-race gate open until the necessary DNS control is provisioned and measured.

## Local validation and remaining changes

`node --test infrastructure/render/failure-drill.test.mjs` covers SSH image prerequisites, correct new-lease success, original-lease rejection, malformed object fence, early completion, terminal failure and invalid fixture IDs. `node infrastructure/render/check.mjs` retains the Render schema and role/secret boundaries. These checks never connect to production.

`LIKERTS_RECEIVER_REDIS_TEST=1 node --test infrastructure/acceptance/receiver/test/receiver.test.mjs` passed all 12 checks locally on Node 22.22.2, including the actual eight-second timer and a real isolated Redis test: the marker was readable while the first reply was held, 20 concurrent duplicates returned 204 before that reply, and capacity/TTL checks passed. Required CI runs this command after `scripts/check-admission.sh`, whose successful Redis container startup makes `redis:7-alpine` available for the receiver test's `--pull=never`. The [PR #25 receiver step](https://github.com/crosstabs/likerts/actions/runs/34741377430) passed 12/12 with zero skips; the [merged-source checks](https://github.com/crosstabs/likerts/actions/runs/34741790142) also passed.

The 15 September run completed a fresh isolated receiver, actual worker endpoint, expired worker-lease recovery, compatible rollback and leaf-only denied/mixed/restored DNS changes. Account SSH remains a prerequisite only for the alternative SSH procedure; the production API PID 1 was not signaled. The run changed records between attempts and does not trace a DNS answer swap between validation and connection. Deterministic hosted rebinding still needs the additional authoritative-DNS control described above. None of this implies network-enforced egress isolation or a failover SLA.
