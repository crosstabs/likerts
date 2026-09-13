# Isolated released-version rollback

This fixture tests runtime **0.1.1 → 0.1.2 → 0.1.1** with one separately running PostgreSQL 16 database. It does not change the production image or add a runtime version-selection endpoint. `Dockerfile.runtime-0.1.1` copies historical binaries from an exact release digest; the ordinary `Dockerfile` remains pinned to 0.1.2. Both use the same reviewed supervisor and Node base.

**The old runtime is not a generally approved production rollback target.** Version 0.1.1 lacks the explicit-export-revocation journal/fence fix in 0.1.2. Schema compatibility does not preserve that newer guarantee. The isolated rehearsal checks that a revocation recorded by 0.1.2 remains denied and its journal/outbox remain unchanged after rollback. It does not create new explicit export revocations on 0.1.1 or operate a fenced archive source. See [the known behavior and reconciliation scope](../../docs/operations/EXPORT-REVOCATION-JOURNAL.md).

## Pinned releases

| Runtime | Source | Released image SHA-256 |
| --- | --- | --- |
| 0.1.1 | `a9f8b95b9f345129d91d961bee1070ad7f92e9e3` | `9b9662f9fd085bce4172f0526a4a4ef74a32243c1cfc14ca462416c962231900` |
| 0.1.2 | `2996ebcbb9821cff67e0a6e8cae4722f0abf9e42` | `40042f29d15f7fb18a1d95287b099fd94cf2185df3c637e3304d73764488ae7c` |

The historical digest/source match the [community-v0.1.1 release](https://github.com/crosstabs/likerts/releases/tag/community-v0.1.1) and its [release build](https://github.com/crosstabs/likerts/actions/runs/34734043606). The local check pulls both images by digest, verifies their OCI source/revision/version labels and exact API/worker executable hashes, then checks that the two releases' migrations and role-provisioning scripts are byte-identical. Hashes are fixed in the checker and included in its sanitized result.

## Local verification

Requirements: Docker with Linux containers, Python 3, Git history containing both release commits, and network access to the public container registry. Run:

```sh
docker pull postgres:16
python3 infrastructure/failure-fixture/check-version-rollback.py
```

The command builds two uniquely tagged fixture images, creates its own Docker network and fresh PostgreSQL container, and binds web HTTP only to loopback. It uses generated secrets and a non-superuser migration owner, then provisions the ordinary restricted API/worker roles. The owner connection never enters either web child. Each web incarnation is limited to 512 MiB, no swap and 0.1 CPU. On ARM hosts only, the existing local emulation adapter is mounted read-only; that file remains excluded from the hosted image context. This is a container replacement test, not a signal test or provider rollback.

The test verifies:

1. **Old baseline:** 0.1.1 creates/publishes a survey and stores response R0; an identical retry returns the same receipt. Ordinary hashed service authentication works; anonymous/admin-only requests are denied.
2. **Upgrade:** a new 0.1.2 container reads and deduplicates R0, adds R1, creates/downloads a two-response export, and revokes it through the API. Download returns 410; exactly one deletion event joins one valid-hash archive outbox entry. A second scoped credential is revoked and returns 401.
3. **Rollback:** a fresh 0.1.1 container reads/deduplicates R0/R1, continues to deny that export and revoked credential, and preserves the exact journal/outbox bytes. It adds R2 and generates a new three-response export whose receipt set, answers, manifest count and computed SHA-256 match the API and database. Unauthorized download is denied.
4. **Persistence and cleanup:** all three boots have different supervisor identities and the expected release hashes; all 27 applied migration versions/checksums stay unchanged. The command removes only its own containers, network and uniquely tagged fixture images, and reports cleanup success.

The [sanitized local result](version-rollback-local-evidence.json) passed on 13 September 2026 at 11:40:53–11:43:24 UTC, using actual amd64 release binaries under ARM-host QEMU. All three boots, retained responses, revocation/outbox checks, final export and owned-resource cleanup passed. The first attempt reached PostgreSQL's temporary initialization server and stopped; readiness was corrected to require the final TCP listener before the successful run. No application change was needed.

Detailed synthetic observations and failures remain under the run's ignored `.tools/likerts-rollback-*` directory with restrictive permissions. Release base images/build cache may remain locally. No account credentials, provider operations or production data are used.

## Hosted acceptance still required

The local result does not establish that Render accepted a rollback or retained the target build. Use the next explicitly owned Free web/PostgreSQL pair only after fresh allowance, plan, database/role and source/CI checks. The prior export-drill resources were deleted; their deployment history cannot be reused.

Deploy **A** from the reviewed legacy Dockerfile and **B** from the ordinary Dockerfile, each with an explicit protected source commit and recorded release hashes. Preserve A's deploy ID. Keep the same fresh restricted database connections and collection/webhook encryption keys across both deployments; add no production connection. Run the corresponding baseline and upgrade assertions above. If B also exercises a callback, revoke its fixture endpoint and verify zero queued/running deliveries before rollback.

Journal one exact request before dispatching `POST /v1/services/{ownedServiceId}/rollback` with body `{"deployId":"<recorded A deploy ID>"}`. Do not automatically retry an uncertain response. Require the returned rollback deployment live, A's old binary hashes, a new boot, unchanged database/schema, retained receipts/deduplication, persistent revocation/credential denial and a newly generated final export. Keep automatic deploys disabled and avoid unrelated deployments: Free web rollback is limited to the two most recent previous deploys. [Render rollback behavior](https://render.com/docs/rollbacks), [Free limitations](https://render.com/docs/free)

Render restores the target deployment's environment snapshot; its current environment-variable settings are not proof of which values the rolled-back process received. Preserve needed fixture-only secrets privately, keep encryption/database keys stable, and verify live application authentication. Do not assume local export files survive a web deployment. Create a new final export; do not use an old ready job's missing file as a recovery success.

Finish by revoking only fixture collections/credentials and deleting the exact owned web service before its database, with independent absence readbacks. No paid fallback, production rollback, schema downgrade, old-runtime archive guarantee, VM/PITR recovery or availability claim is authorized by this fixture. Follow the broader [H06 procedure](../../docs/operations/HOSTED-FAILURE-DRILL.md) for the remaining hosted work.
