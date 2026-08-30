# Production Readiness Runbook

This runbook covers the Phase 8 foundations for bounded runtime configuration, admission control, emergency shutdown, CI gates, and deployment verification. It is intentionally operational: no live eval, model call, external mutation, or production deploy should happen unless a human explicitly authorizes that action for the environment.

## Runtime Configuration

The runtime parser is strict. Invalid booleans, malformed numbers, or values outside the documented bounds make readiness fail closed with `RUNTIME_CONFIG_INVALID`.

| Variable | Default | Bound |
| --- | ---: | --- |
| `LIKERTS_EXECUTION_DISABLED` | `false` | `true`, `false`, `1`, or `0` |
| `MCP_PUBLIC_SYNTHETIC_RUNS_ENABLED` | `true` | `true`, `false`, `1`, or `0` |
| `LIKERTS_EVAL_LIVE` | `false` | `true`, `false`, `1`, or `0` |
| `MCP_HTTP_REQUESTS_PER_MINUTE` | `90` | 10 to 1000 |
| `MCP_RUN_MAX_CONCURRENCY` | `2` | 1 to 10 |
| `MCP_RUNS_PER_HOUR` | `3` | 1 to 50 |
| `MCP_RUN_PROCESS_DAILY_BUDGET` | `30` | 1 to 10000 |
| `DEEP_ADMISSION_UNITS` | `3` | 2 to 10 |
| `DEEP_COHORT_CELLS` | `4` | 2 to `DEEP_COHORT_MAX_CELLS` |
| `DEEP_COHORT_MAX_CELLS` | `6` | 2 to 8 |
| `LIKERTS_STAGE_TIMEOUT_MULTIPLIER` | `1` | 1 to 4 |
| `LIKERTS_EVAL_MAX_RUNS` | `3` | 1 to 5 |
| `LIKERTS_EVAL_MAX_COST_USD` | `1` | 0 to 5 |
| `LIKERTS_EVAL_ESTIMATED_COST_USD` | `0.25` | 0 to 1 |
| `LIKERTS_EVAL_MAX_DURATION_MS` | `120000` | 1000 to 300000 |
| `LIKERTS_EVAL_OUTPUT_MAX_BYTES` | `200000` | 512 to 1000000 |
| `LIKERTS_ADMISSION_STORE_PROVIDER` | unset | exactly `upstash-redis-rest` when shared admission is selected |
| `UPSTASH_REDIS_REST_URL` | unset | public HTTPS `*.upstash.io` URL; no credentials, query, or fragment |
| `UPSTASH_REDIS_REST_TOKEN` | unset | non-empty server-only write token |
| `LIKERTS_ADMISSION_NAMESPACE` | unset | stable 8–128 character production namespace |
| `LIKERTS_ADMISSION_LEASE_TTL_MS` | `120000` | 61000 to 300000 milliseconds |
| `LIKERTS_ADMISSION_STORE_TIMEOUT_MS` | `2500` | 250 to 10000 milliseconds |
| `LIKERTS_READINESS_TOKEN` | unset | separate 32–4096 character secret; required in production or with the shared provider |
| `MCP_RATE_LIMIT_SALT` | random only without shared admission | stable 32–4096 character secret; required in production or with the shared provider |
| `VITE_LIKERTS_VERCEL_ANALYTICS` | unset/disabled | exactly `release-approved` to opt in at build time; public, not a secret |

Only `upstash-redis-rest` is implemented. Generic Redis, PostgreSQL, and arbitrary HTTPS URLs are not accepted or advertised. Provider configuration is summarized without its endpoint, token, namespace, client key, or backend diagnostics. Merely setting an endpoint is not proof of durability: production execution remains blocked until the complete provider configuration constructs the concrete adapter and its protection metadata satisfies the admission-store contract.

Vercel Web Analytics is fail-closed: it is not mounted in development or in a production build without the exact approval token. Do not set the token until telemetry-provider authorization, legal/privacy review, and the approved data-processing boundary are recorded. The production-readiness workflow explicitly sets the value to `disabled` so its browser artifact profile is deterministic. Browser-attested localization releases must likewise leave analytics disabled until the dynamically served analytics script has a separately defensible executable-runtime integrity contract; otherwise the exact-artifact browser gate must reject the unmanifested response.

When production configuration is otherwise valid but no actual admission adapter capability is present, paid execution fails with `DURABLE_ADMISSION_REQUIRED`; incomplete or malformed provider fields fail earlier as `RUNTIME_CONFIG_INVALID`.

The adapter performs the client-window, active-lease, and weighted-budget decision in one atomic Upstash Lua `EVAL` using Redis server time. Before server time, pruning, counters, or leases are touched, the script atomically establishes or validates a permanent namespace policy fingerprint. That fingerprint binds the adapter contract and provider, canonical database identity, namespace, every limit and window, lease TTL, anonymous-client HMAC identity, and Quick/Deep unit schedule. A mismatch returns a sanitized unavailable result before admission state mutates. Denials do not charge counters. A successful admission charges its rate and budget once and creates a unique expiring concurrency lease; release removes only that lease and never refunds rate or budget. SDK network retries are disabled. If a committed response is lost, the conservative counters may remain charged but paid model work does not start; the call is never replayed automatically.

Primary implementation references: [Upstash atomic Lua scripting](https://upstash.com/blog/lua-scripting-on-upstash-redis-atomic-operations-over-http), [key locking](https://upstash.com/docs/redis/features/key-locking), [SDK retry behavior](https://upstash.com/docs/redis/sdks/ts/retries), [durable storage](https://upstash.com/docs/redis/features/durability), [eviction](https://upstash.com/docs/redis/features/eviction), [consistency](https://upstash.com/docs/redis/features/consistency), and [Vercel’s protected forwarding headers](https://vercel.com/docs/headers/request-headers.rsc).

Anonymous identity uses HMAC-SHA-256 with `MCP_RATE_LIMIT_SALT`. On Vercel it accepts only `x-vercel-forwarded-for`; changing ordinary `x-forwarded-for` cannot rotate the admission identity. A non-Vercel production runtime deliberately collapses requests without a verified ingress identity into one fail-safe bucket instead of trusting caller-supplied forwarding headers.

## Health And Readiness

Use `GET /api/health` or any `HEAD` health request for public metadata-only liveness. It returns a non-sensitive service summary, runtime status, admission-store durability class, and a correlation ID without contacting Redis.

Use `GET /api/health?ready=1` for active readiness only from an authorized monitor that sends the separate `LIKERTS_READINESS_TOKEN` as `Authorization: Bearer …`. Never put this token in a query string. Missing, malformed, or incorrect authorization returns a sanitized `401` and performs zero Redis calls. After authorization and static configuration pass, readiness atomically validates the namespace policy and performs a bounded write/read/delete/backend-time Lua probe. This storage-only probe remains available during emergency execution shutdown: the response stays `503` with `status: DISABLED`, while its authorized body includes only sanitized namespace, database, policy, and unit-schedule fingerprints for fleet-parity checks. It also returns a sanitized `503` when runtime configuration is invalid, production lacks the concrete globally durable adapter, or the backend is unreachable, unauthorized, timed out, policy-mismatched, or malformed. The default in-memory admission mode is intentionally reported as `DEGRADED_NOT_GLOBALLY_DURABLE`; this is acceptable for local development but production-blocking.

## Migration

No user or research data migration is required. Moving paid-work admission from development memory to the concrete shared provider requires separate infrastructure authority:

1. Provision a dedicated regional Upstash Redis database near the Vercel paid functions. Persistence is always enabled; keep database eviction disabled so capacity pressure rejects writes instead of deleting admission state.
2. Keep preview and production in separate databases or stable namespaces. Never derive the production namespace from a deployment ID: compatible rolling deployments must share the same keys. Any intentional change to a bound limit, window, lease TTL, client-identity salt/version, unit schedule, database, or adapter policy requires disabled execution plus a new namespace (or an explicitly drained and authorized deletion of the old permanent policy key).
3. Store `LIKERTS_ADMISSION_STORE_PROVIDER=upstash-redis-rest`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `LIKERTS_ADMISSION_NAMESPACE`, a high-entropy `MCP_RATE_LIMIT_SALT`, and a separate high-entropy `LIKERTS_READINESS_TOKEN` in the deployment secret manager. Do not put them in source, screenshots, evidence, URLs, or CLI history.
4. Keep `LIKERTS_EXECUTION_DISABLED=true` while verifying liveness and the authenticated storage-only readiness probe. A healthy probe deliberately remains `503`/`DISABLED` until execution is re-enabled, but exposes the sanitized fleet fingerprints to the authorized monitor.
5. Against the provisioned database, run the integration contention gate from at least two independent processes: exactly the configured concurrency count may acquire; rate and weighted budget may never overshoot; crashed leases recover only after TTL; repeated or stale releases do nothing.
6. Query authenticated readiness on every concurrently serving deployment/version and require identical namespace, database, policy, and unit-schedule fingerprints. Source tests prove REST study, REST segment, MCP inner/outer, and health share one runtime admission singleton; the fleet check proves those deployments point to the same bound backend policy. Verify failure, bad-token, timeout, mismatch, and malformed-reply cases all stop before model work with no private diagnostic.
7. Verify the Vercel AI Gateway project budget independently; Upstash uses leader-based asynchronous replication and must not be marketed as an absolute financial guarantee.
8. Re-enable execution only after authorized `GET /api/health?ready=1` returns `OK`, fleet fingerprints match, and the post-deploy gates pass.

The repository ships an opt-in first-pass live gate. It creates two independent Redis clients/adapters and refuses production runtime labels or a non-verification namespace. Run it only with separately authorized credentials and a unique TTL-bounded namespace; it never runs during `npm test` or deploys anything:

```bash
LIKERTS_ADMISSION_INTEGRATION=1 \
LIKERTS_ADMISSION_STORE_PROVIDER=upstash-redis-rest \
UPSTASH_REDIS_REST_URL=https://<database>.upstash.io \
UPSTASH_REDIS_REST_TOKEN=<server-only-token> \
LIKERTS_ADMISSION_NAMESPACE=likerts:verification:<unique-run> \
MCP_RATE_LIMIT_SALT=<stable-secret-at-least-32-characters> \
  npm run admission:verify:live
```

This command is not the full two-process production gate: after it passes, run the same contention assertions from two separately launched workers against the dedicated verification namespace before enabling execution.

The repository also ships that cross-process gate. Use the same separately
authorized credentials and a new verification namespace. It launches independent
worker processes, proves exact concurrency, rate and weighted-budget denial,
idempotent and stale release behavior, then deliberately crashes lease holders
and waits for the minimum supported TTL before proving recovery:

```bash
LIKERTS_ADMISSION_INTEGRATION=1 \
LIKERTS_ADMISSION_STORE_PROVIDER=upstash-redis-rest \
UPSTASH_REDIS_REST_URL=https://<database>.upstash.io \
UPSTASH_REDIS_REST_TOKEN=<server-only-token> \
LIKERTS_ADMISSION_NAMESPACE=likerts:verification:<unique-run> \
LIKERTS_ADMISSION_LEASE_TTL_MS=61000 \
MCP_RATE_LIMIT_SALT=<stable-secret-at-least-32-characters> \
  npm run admission:verify:contention
```

Rollback begins by setting `LIKERTS_EXECUTION_DISABLED=true`. Removing the provider configuration then returns the service to disabled execution with no globally durable claim; it must never cause a production fallback to process memory.

## Rollback

Immediate execution rollback:

1. Set `LIKERTS_EXECUTION_DISABLED=true`.
2. Confirm authorized `GET /api/health?ready=1` returns `503` with `status: DISABLED`.
3. Confirm no synthetic study run can acquire admission.
4. Leave static public pages online when possible.

Code rollback:

1. Revert the deployment to the previous known-good commit using the hosting platform rollback control.
2. Keep `LIKERTS_EXECUTION_DISABLED=true` during rollback verification.
3. Re-run health and smoke checks.
4. Re-enable execution only after the failure condition is understood.

## Manual Deploy

Manual deploys require human release authority and production credentials. Before deploy, run local gates:

```bash
npm ci
node scripts/ci-static-check.mjs
npm test
npm run build
node scripts/ci-security-check.mjs
```

Do not run `npm run eval:live` as part of deploy. Live evals are disabled by default and require explicit cost, duration, run-count, output-size, and data-handling approval.

## Post-Deploy Smoke

Run the read-only localization contract check from the exact release source. It
does not call a model, start a study, mutate production, or infer sign-off:

```bash
LIKERTS_DEPLOYMENT_URL=https://candidate.example.com/ \
  npm run localization:smoke
```

That command requires an explicit target, checks the scorecard API plus the
three CJK static hubs, verifies the deployed locale/market matrix against the
canonical registry, and reports open native-review/publication gates without
calling them failures. If the scorecard claims published browser evidence, the
smoke gate fetches the immutable HTTPS attestation and its promotion record when
both exact URLs are independently configured. Release-required smoke also fetches
the adjacent `artifact-manifest.json` and every declared deployed build file to
recompute the signed artifact digest. A diagnostic invocation with
no URL pair never follows scorecard-directed evidence URLs. With the pair, the
smoke first requires both scorecard URLs to match exactly and rejects loopback,
private, link-local, reserved, and internal evidence hosts before any artifact
request. The default release transport pins HTTPS socket lookup to those exact
prechecked public addresses while preserving the configured hostname for TLS
certificate checks, SNI, and the Host header. The same rule applies to the
deployment-root artifact bytes; release-required mode fails closed when an
injected/custom fetch cannot establish the pinned transport. It then validates
the attestation's canonical digest, freshness, execution
boundary, complete locale/viewport and journey coverage, and verifies the
promotion with configured trusted Ed25519 public keys. Scorecard metadata alone
is never treated as evidence. For a release decision, require the exact
published build, independently selected CI evidence bundle, and all documented gates:

In release-required mode the smoke also performs a bounded JSON-RPC
`resources/read` against `/api/mcp` for
`likerts://localization/scorecard`, removes only the transport correlation ID,
and requires the complete MCP projection to equal the HTTP scorecard. A
missing, malformed, or divergent deployed MCP resource fails the release smoke.

```bash
LIKERTS_DEPLOYMENT_URL=https://candidate.example.com/ \
LIKERTS_LOCALIZATION_EXPECTED_BUILD_ID=<build-id> \
LIKERTS_LOCALIZATION_EXPECTED_ARTIFACT_DIGEST=sha256:<artifact-digest> \
LIKERTS_LOCALIZATION_EXPECTED_CI_EVIDENCE_ID=sha256:<ci-attestation-evidence-id> \
LIKERTS_LOCALIZATION_EXPECTED_BUNDLE_DIGEST=sha256:<verified-ci-bundle-digest> \
LIKERTS_LOCALIZATION_EXPECTED_EVIDENCE_URL=https://evidence.example/localization/<artifact-hash>/attestation.json \
LIKERTS_LOCALIZATION_EXPECTED_PROMOTION_URL=https://evidence.example/localization/<artifact-hash>/promotion.json \
LIKERTS_LOCALIZATION_PROMOTION_KEYS_JSON='{"release-operator":"-----BEGIN PUBLIC KEY-----..."}' \
LIKERTS_LOCALIZATION_RELEASE_EVIDENCE_JSON='<strict server-only browser-and-native authority JSON>' \
LIKERTS_LOCALIZATION_REQUIRE_RELEASE_READY=1 \
  npm run localization:smoke
```

The release-required form fails closed unless all expected build, CI evidence,
bundle, evidence URL, and promotion URL values are supplied from independently
selected release records; the deployed scorecard is not allowed to select its
own release identity or fetch destination. The two exact URLs must be default-port
public HTTPS URLs in the same content-addressed artifact directory, without
credentials, query strings, or fragments. The public keys validate only the signed
promotion record; never place its matching private key in deployment or smoke
configuration.

The shipped CLI parses `LIKERTS_LOCALIZATION_RELEASE_EVIDENCE_JSON` strictly
before starting smoke and derives from it a separate zero-argument loader for
native-review packets and trusted reviewer public keys. A malformed present value
fails as `LOCALIZATION_SMOKE_CONFIG_INVALID` before any smoke request. This native
authority does not replace the independently supplied expected build, CI bundle,
attestation URL, promotion URL, or promotion-key variables above, and it never
grants publication authority.

Every request uses manual redirect handling and must return an exact non-redirected
200 at the requested URL. The default per-request timeout is 15 seconds. JSON is
streamed through a 2 MiB byte cap and static HTML through a 512 KiB byte cap before
parsing or inspection. Programmatic diagnostic callers may inject bounded limits
for their environment, subject to hard ceilings of 60 seconds, 8 MiB JSON, and
4 MiB HTML.

The scorecard HTTP route and MCP resource now share a strict server-only runtime
evidence provider. When `LIKERTS_LOCALIZATION_RELEASE_EVIDENCE_JSON` is absent they
deliberately return a pending scorecard; when it is present they load only the exact
configured immutable browser and native-review evidence with bounded, DNS-pinned
HTTPS validation. Invalid or unavailable configured evidence fails closed with a
sanitized transport-specific error. Do not work around that boundary with arbitrary
server file paths, request-derived authority, or scorecard-selected fetch URLs. The
production value, public artifacts, trusted keys, credentials, deployment, and
release decision remain external infrastructure/release-authority prerequisites.
The smoke command's exact URL authority only bounds read-only verification and does
not inject or publish evidence.

Post-deploy smoke checks:

1. `GET /api/health` returns JSON, `Cache-Control: no-store`, and no secrets.
2. Authenticated `GET /api/health?ready=1` returns ready only when execution is intentionally enabled, config is valid, the backend is writable, and the bound policy matches; unauthenticated attempts make zero backend calls.
3. `npm run localization:smoke` passes for the explicit deployment URL; the
   release-required form remains failing while native review or immutable
   browser evidence is incomplete.
4. Release-required smoke reports `mcpScorecardParity: "MATCHED"`; the HTTP and
   MCP localization scorecards project the same evidence state for the exact
   release. Diagnostic smoke leaves this field `NOT_CHECKED`.
5. Public static pages load from the deployment.
6. Logs contain correlation IDs and structured redacted events.
7. No live eval runs occurred during CI or deployment.
8. If a human separately authorizes paid model smoke testing, run exactly one bounded synthetic request and record only the correlation ID, status code, duration, and non-sensitive summary.

## Infrastructure Authority Gates

The following remain outside code authority:

- Provisioning a globally durable admission store.
- Creating production secrets or changing deployment-platform environment variables.
- Running the live shared-store contention/readiness gate with authorized credentials and recording its non-sensitive receipt.
- Granting model or AI Gateway budget.
- Deploying, rolling back, or changing DNS.
- Enabling live eval runs against any paid endpoint.
