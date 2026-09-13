# Managed maintenance rehearsal — 13 September 2026

This is partial operational evidence, not acceptance of hosted production readiness. Source: `a9f8b95b9f345129d91d961bee1070ad7f92e9e3`, [protected main CI](https://github.com/crosstabs/likerts/actions/runs/34733414936).

Two existing-plan Vercel projects, `likerts-cleanup` and `likerts-erasure-archive`, have separate production-only worker secrets. A separate private Singapore Blob store is linked only to archive. No subscription upgrade occurred; provider usage remains metered. Owner database credentials were used only for controlled migration/provisioning and were not installed in either project.

Migrations 26–27 applied successfully. Both restricted database identities passed live role checks; archive source identity is pinned. API and MCP health remained HTTP 200 afterward. Render application deployment remains the earlier source, so these worker deployments do not imply a Render rollout.

Both bundles were rebuilt from clean verified source, with ARM64 static binaries, bundled public CA, Node 22 and a 240-second function limit. Actual managed preview requests executed in `sin1`: unauthorized GET 401, authenticated missing-role configuration 503, query-string/method rejection 400. These tests did not exercise a configured child.

Configured production deployments:

| Worker | Deployment | Current acceptance |
| --- | --- | --- |
| Archive | `dpl_FpQGmpWf7KgFt4tbt4zSNnppy6Md` | READY, cron disabled. Configured requests returned HTTP 503 `worker_failed`; one completed in 9.6 seconds. Production environment values privately matched the working local configuration. Failure cause remains unclassified. |
| Cleanup | `dpl_5S1CiEcDwkR9NXe6MEujaGcszHBt` | READY, cron disabled. Synthetic physical-deletion/retention verification remains pending. |

The exact Linux archive binary in the official Node 22 Lambda container connected with verified TLS, archived one event to the private store, independently read it back, and wrote a checkpoint. A native local 100-event batch also completed with a checkpoint; the resulting pending backlog was 5,837 events. These are real provider operations from local runners, not successful managed Vercel execution or scheduler delivery. A checkpoint covering 103 events was independently fetched from private Blob and its SHA-256 and source/checkpoint identities verified; the reference and verified object were saved to a private local recovery file outside the database. This is not full chain/fence verification. No production fence/release was performed. The backlog is existing operational history, not a claimed customer count.

The first deployment of a newly created project was automatically promoted to production even when `--target=preview` was requested. No production database/cron credentials were present then; handlers failed closed. Both project cron features were disabled and their states read back. The [promotion runbook](../../infrastructure/maintenance/README.md) now requires disabling cron before the first deployment and verifying actual target/aliases/paused state after every deployment.

Remaining: classify and fix the managed failure, verify synthetic deletion/retry/retention isolation, verify archived fixture/checkpoint contents, arm independent missed-run/backlog alerts with a real receiver and responding owner, then observe actual recurring invocations. Neon PITR window and quarantine restore/replay remain separate unverified work. Local success, a READY deployment and a manual HTTP success cannot substitute for those checks.
