# Security

Please do not publish suspected vulnerabilities in a public issue. Use GitHub's private vulnerability reporting for this repository. If that option is unavailable, contact the repository owner privately through their verified GitHub profile.

Reports should include the affected version or commit, deployment mode, reproduction steps, impact and any suggested fix. Remove customer data, access tokens and private keys from the report.

## Deployment boundary

Likerts is self-hosted software. Operators are responsible for TLS, secret storage, database backups, capacity, network controls, identity-provider configuration and dependency updates. Use PostgreSQL with the restricted runtime roles in `backend/provision-runtime.sql`; memory storage and static development tokens are for disposable local development only.

Supported releases receive security fixes on the latest published version. Until the first stable release, fixes land on the default branch and may include breaking changes.
