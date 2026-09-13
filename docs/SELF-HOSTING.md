# Self-host Likerts

Start locally, then deploy the same API with explicit production credentials and operational controls. The hosted reference preview at likerts.com is optional. This guide does not turn the local development defaults into a production configuration.

## 1. Get a real response locally

Install Git, Docker with Compose v2 or later and OpenSSL. Clone the repository and start the durable developer stack:

```sh
git clone https://github.com/crosstabs/likerts.git
cd likerts
bash infrastructure/local/compose.sh up --build --detach --wait
curl --fail http://127.0.0.1:8080/health
```

The first build downloads dependencies. PostgreSQL is private to the Compose network; the API binds to loopback. The helper generates private local credentials, applies migrations, provisions the restricted runtime role, and keeps database/export data in named volumes. Follow [local development](../infrastructure/local/README.md#first-stored-response) to submit and retrieve your first response. That flow declares Rust, jq and curl prerequisites; it is not a prebuilt-only installation.

Use [published npm packages and CLI downloads](releases.md) for your application. Keep management credentials on your server or in an agent process; only collection credentials belong in a browser or mobile host. Use [SDK installation](../sdks/INSTALLATION.md) and [tool setup](../tools/README.md) for each supported client.

`bash infrastructure/local/compose.sh down` stops the stack while retaining its data. Adding `--volumes` explicitly deletes only that local project's database/export volumes. See the local guide for separate project names and credential handling. Never deploy this Compose setup publicly: it intentionally uses development authentication and disables pre-auth admission.

## 2. Choose the production boundary

Use PostgreSQL for durable deployments. Separate the public API, migration job, export storage and optional callback worker; configure a verified identity issuer or hashed scoped service credentials. Do not enable memory storage, static development authentication or runtime migrations. A hostname, TLS certificate and scoped credential do not by themselves establish tenant isolation; retain the database role boundary and the tested API authorization paths.

The existing [Render deployment guide](../infrastructure/render/README.md) is the supported project deployment example, with Neon PostgreSQL, private Vercel Blob exports and Vercel website/MCP connection instructions. AWS/S3 adapters are optional alternatives. Reuse your infrastructure rather than assuming any provider's default plan proves retention, capacity or recovery guarantees.

## 3. Provision and migrate before exposing traffic

Create distinct database owner/migrator and runtime logins. The runtime must not own schemas, inherit a privileged role, have superuser access or bypass RLS. Apply the immutable migrations using the separately supplied migration URL and run [canonical runtime provisioning](../backend/provision-runtime.sql) as the owner. Do not modify an applied migration or run it under the HTTP runtime credential.

The [deployment foundation](../infrastructure/README.md#artifact-and-credential-separation) includes the exact migration-container invocation and role separation. Keep database URLs, collection/webhook encryption keys, issuer credentials and object-store credentials in the deployment secret mechanism. Preserve required encryption keys across restarts; replacing a key without a migration/rotation procedure can make stored credentials unusable.

Configure production authentication and [shared admission](../infrastructure/admission/README.md). Verify fail-closed behavior and provider quota/latency for your actual region. The local development token is never a production credential. Put a TLS ingress in front of the API; configure exact browser origins through `collections_security_update` or use an authenticated same-origin application backend. Origin policy is not token authorization.

## 4. Decide which background features you operate

- Exports require a private object store, restricted access and physical object cleanup. Download authorization expiry does not prove object deletion. Follow the selected storage adapter's configuration and verify failed writes/deletes and revocation.
- Response callbacks require the [isolated callback worker](../infrastructure/webhooks/README.md), its restricted database role, signing-key handling and a verified public receiver. Test signature verification, deduplication, retry behavior and endpoint revocation with synthetic data.
- Retention requires scheduled, bounded invocations across the intended workspaces and backlog/failure monitoring. `POST /v1/retention` exists; enabling the API does not schedule it. Follow the [data lifecycle contract](../DATA-LIFECYCLE.md).
- Recovery must use an independently durable deletion journal. A journal only inside the restored database cannot account for deletions after its snapshot. Quarantine restored data and credentials, replay deletions and verify safe reopening before accepting traffic.

Only advertise features whose configuration you have actually exercised. For an API-only deployment, omit callbacks rather than implying a worker is running.

## 5. Verify, observe and recover

Before allowing real users, verify two independent workspaces: create/publish, accept and retrieve a response, identical retry without duplication, cross-workspace denial, credential/collection revocation, erasure and export access if enabled. Confirm the runtime role cannot read tenant rows without workspace context.

`/health` checks the API/database path. Optional public status probes do not prove sign-in email delivery, accepted responses, workers or historical uptime. Assign a real incident owner, activate scheduled/independent monitoring and test delivered failure/recovery alerts. Use [operations and recovery](../infrastructure/OPERATIONS.md) for the supported monitor variables, coverage limits and responder handoff.

Set and verify your actual backup/PITR retention. Rehearse restoration into a quarantined database, reconcile deletion/revocation checkpoints and expired exports, disable old callbacks and run tenant-isolation checks. Record measured safe-reopening time and recoverable data boundary; do not substitute the repository's small local logical-restore test for a managed recovery guarantee.

## 6. Upgrade and roll back deliberately

Record the old and candidate image digests, package versions and migration versions. Build and test an immutable candidate; apply compatible migrations before rolling the runtime. Verify the same synthetic workflow after promotion. If the old image is incompatible with a new schema, use a forward correction or coordinated recovery; rolling back an image does not roll back a database.

Keep previous release assets and tags immutable. Bump changed package versions, publish tested builds, and verify fresh consumers. The [release guide](releases.md) distinguishes community snapshot tags from component versions. Use [support](community/SUPPORT.md) for diagnostics and private security intake.

## Evidence boundary

The local Compose check proves ordered startup, scoped database roles, idempotent first response and persistence across full container recreation. Existing [local recovery evidence](../infrastructure/recovery/local-evidence.json) additionally checks quarantined logical restore and revoked access. Provider backup activation, scheduled retention, alert delivery and managed rollback/restore require operator evidence. The project's own unresolved hosted checks are tracked as H01–H07 in [PUBLIC-LAUNCH.md](../PUBLIC-LAUNCH.md).
