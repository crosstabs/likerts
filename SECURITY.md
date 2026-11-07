# Security

Do not publish suspected vulnerabilities, room access tokens, database credentials or other people's game data in public issues. Use GitHub's private vulnerability reporting for this repository. If unavailable, contact the repository owner privately through their verified GitHub profile.

Reports should identify the affected commit, client/server environment, synthetic reproduction and impact. Remove personal data, secrets and private keys.

## Deployment boundary

Live game scores, deadlines and room membership are authoritative on the server. Production requires HTTPS, a dedicated restricted PostgreSQL login, verified database TLS, server-side secrets and explicit capacity limits. Keep database credentials out of browser and native bundles. Development memory/SQLite modes are for disposable local work; do not expose a development server publicly.

Hosts upload a fixed quiz copy including its answer key. Player answers remain private until reveal, then become visible to the room. Quiz exports include correct answers. Room codes and client access should be shared only with intended participants.

The operator remains responsible for provider access, backups, request logs, retention, dependency updates, availability and spending controls. Application expiry does not erase backups or participant copies. Security fixes currently land on the default branch; no support period or response-time guarantee is stated.
