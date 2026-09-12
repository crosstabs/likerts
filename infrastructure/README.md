# Deployment foundation

**Launch target: Render Singapore.** Start with [the Render Blueprint and runbook](render/README.md). AWS/CDK below is retained as an optional alternate target. Platform-specific network, secrets, object storage and recovery checks must be repeated on Render.

The OCI image, isolated database migration job and container integration gate are implemented. These commands are reproducible **local gates**. Render API/MCP/worker, Neon PostgreSQL and Vercel web/private Blob exports are deployed for assisted preview. GitHub Actions is currently blocked before execution by the exhausted organization Actions budget; local results do not substitute for hosted CI. Public paid release remains on hold; see [the current launch queue](../LAUNCH-TASKS.md).

## Build and verify

Requirements: Docker Engine, Node.js 22, OpenSSL and Bash. Docker Compose is not required.

```sh
bash scripts/check-container.sh
```

The script builds the Rust server and deployment-only `likerts-migrate` binary with the locked Cargo dependency set. It then creates an isolated network, PostgreSQL database and export volume, checks the deployment, and removes only its uniquely named test resources on exit. No host database port is published. The HTTP port binds to host loopback only. The disposable fixture uses randomly generated database passwords and a known synthetic scoped service credential; never use the fixture for a shared environment.

The gate covers:

- A non-superuser migration owner applies the complete migration set; a second run is a safe no-op.
- The HTTP runtime has separate `NOINHERIT NOBYPASSRLS` credentials and explicit table grants. Running migrations with that credential fails.
- A server without `DATABASE_URL` fails rather than silently entering memory mode.
- The runtime uses UID/GID 10001, a read-only root filesystem, no Linux capabilities and `no-new-privileges`. Only the export volume is writable.
- A genuine hashed service credential creates and reads a survey; missing and insufficient scope are rejected.
- SIGTERM shuts down cleanly; replacing the server container preserves database contents. Direct unscoped runtime queries see no tenant rows.
- The runtime can insert tenant-scoped audit records through its sequence grant, but cannot update/delete audit records or read them without tenant context.

Use an existing candidate image with `LIKERTS_IMAGE=<image> LIKERTS_SKIP_IMAGE_BUILD=1 bash scripts/check-container.sh`. Do not skip the image build when source files changed.

## Artifact and credential separation

The opt-in performance gate is `bash scripts/benchmark-local.sh`. It uses an isolated setup with a 0.5-vCPU/1-GiB API and 1-vCPU/1.5-GiB PostgreSQL, then measures paced/burst acceptance, rejected requests, collection caps, exports and storage. Results are written under `.validation-private/`. Normal container checks do not run this longer benchmark. No real customer data or cloud resources are involved.

The recovery gate is `bash scripts/check-recovery.sh`; it includes the container gate and a quarantined logical restore, post-backup deletion replay, append-only audit verification and migration-failure checks. `bash scripts/check-observability.sh` verifies monitoring configuration and alert behavior. [OPERATIONS.md](OPERATIONS.md) describes the monitoring boundaries, incident response, recovery workflow and remaining Render/Neon activation checks.

The Render launch uses private Vercel Blob exports; [the Render runbook](render/README.md) describes its credentials and acceptance. The optional AWS deployment selects private S3 storage when `LIKERTS_EXPORT_BUCKET` is set and uses the optional `LIKERTS_EXPORT_PREFIX` (default `exports`). It loads the standard AWS task-role credential and region chain, checks bucket access during startup, and refuses to start under `LIKERTS_REQUIRE_S3=1` without a bucket. The backend performs bounded asynchronous put/get/delete operations; S3 lifecycle remains an infrastructure policy. `bash scripts/check-s3-object-store.sh` proves the wire behavior against an isolated MinIO S3 endpoint. Custom endpoints require an explicit local-test switch and HTTPS except for exact loopback HTTP.

`Dockerfile` uses a fixed Rust toolchain tag and a locked Cargo dependency set. Base OS image tags still receive updates, so a tag is not a byte-for-byte reproducibility claim. Before promotion, resolve builder/runtime base images to digests with the existing `RUST_IMAGE`/`RUNTIME_IMAGE` build arguments, record the tested final image digest and promote that exact digest. Build each deployed architecture in CI; local ARM64 evidence does not prove an AMD64 build. The `.dockerignore` allowlist excludes credentials, host artifacts and SDK dependency directories from the build context.

The separate migration invocation is:

```sh
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
  --env LIKERTS_MIGRATION_DATABASE_URL \
  --entrypoint /usr/local/bin/likerts-migrate <tested-image-digest>
```

Supply `LIKERTS_MIGRATION_DATABASE_URL` through the deployment secret mechanism, not command-line literals, tracked configuration or runtime task secrets. The migration runner has no HTTP listener and exits after applying migrations. SQLx validates previously applied migration checksums and serializes migration execution. Any failure stops promotion; its output intentionally omits raw database errors that could contain sensitive values.

Create the restricted runtime login out of band and apply `backend/provision-runtime.sql` as the schema owner after successful migrations. That file uses a quoted psql role variable. Do not grant the runtime schema ownership, superuser, role membership in the migration owner, `BYPASSRLS`, or migration-table access. The runtime receives only `DATABASE_URL`; omit all development-auth/memory switches and `LIKERTS_RUN_MIGRATIONS` from staging and production configuration.

## AWS staging implementation boundary

The optional AWS architecture is expressed as TypeScript AWS CDK in [aws/README.md](aws/README.md). `bash scripts/check-aws-iac.sh` typechecks it, runs synth-time security and topology assertions, and synthesizes staging and production templates without AWS credentials. No cloud resources were created. Hosted deployment still must prove ACM/TLS, restricted database provisioning with certificate verification, S3 export lifecycle, WAF behavior, logs/alarms, migration-before-service ordering, smoke checks and a failed-deployment rollback.

Provider references: [ECS task execution roles and secret access](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html), [ECS IAM separation](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-iam-roles.html). AWS documents that [ECS Exec does not support read-only root filesystems](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-exec.html); the selected runtime keeps its read-only filesystem and no Exec access.

## Promotion and rollback runbook

Record the candidate/previous image digests, migration versions and compatibility review before each promotion. Use expand/contract changes so the old and new application can coexist during rollout. Test the old image against the new schema before declaring automatic application rollback safe. The container restart gate alone does not prove mixed-version compatibility.

After a successful migration job and restricted-role provisioning, replace the staging service with the candidate digest and verify health, authorization, collection acceptance, retrieval and usage. Promote only after the separate release checklist and provider tests pass. For Render, retain the previous service deployment and tested revision, use the migration-before-runtime sequence in the Render runbook, and rehearse a compatible rollback before claiming automatic recovery. The optional AWS deployment uses ECS task-definition rollback.

On a migration failure, keep the old service and stop promotion. Never automatically undo migrations or edit applied migration files. If an incompatible migration already committed, stop new acceptance and choose a forward correction or coordinated database restore; a database restore alone can discard newer accepted responses. Before serving restored data, reapply deletion/revocation records and reconcile accounting. Measure recovery time/data loss in the OPS-03 drill.

Pending launch evidence includes executed hosted CI, failed-rollout rehearsal, managed Neon recovery, deployed failure/alert acceptance, sustained capacity/cost and all-platform customer-host acceptance. Existing hosted private Blob/lifecycle evidence is recorded separately from these open gates. AWS/ECR provisioning is not a requirement for the selected Render/Vercel launch.
