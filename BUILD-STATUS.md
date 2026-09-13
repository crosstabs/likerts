# Build status

Current public-launch tasks, evidence and hosted-service gates are tracked in [PUBLIC-LAUNCH.md](PUBLIC-LAUNCH.md). The implementation inventory below is not a hosted readiness guarantee.

Likerts is publicly released as a free, MIT-licensed, self-hosted survey collection platform. No customers used the earlier preview billing model, so response credits, payment routes, checkout UI, and commercial quotas were removed before release.

## Implemented

- Rust API backed by PostgreSQL with forced row-level security and workspace-scoped authorization.
- Survey drafts, immutable published versions, collections, idempotent submissions, response retrieval, deletion, exports, retention, and signed response webhooks.
- Nine bounded question types, conditional visibility, pages, and branching.
- One capability registry across HTTP, MCP, and the Rust CLI.
- Web, React Native, iOS, Android, and Flutter SDKs with host-controlled encrypted offline queues.
- Passwordless hosted workspace shell and a static marketing/documentation site.
- Count-only usage reporting. Accepted responses are never charged or blocked by a commercial quota.

## Release gates

- [x] All repository checks pass against the unmetered contract.
- [x] Secret scan of publishable files and Git history is clean apart from documented test fixtures. Ignored local environment files remain outside version control.
- [x] Hosted API, MCP, worker, migration image, and website run release commit `8588b67`.
- [x] GitHub repository is public with the MIT license, security policy, and contribution guide.
- [x] Fresh-clone setup and first-response flow are verified from the public README.

Operational rate limits, payload limits, queue bounds, storage capacity, backups, and monitoring remain necessary deployment controls.
