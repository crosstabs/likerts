# Anonymous newcomer rehearsal

Run from a source checkout with Docker Compose, Node.js 22, npm, OpenSSL, Git and tar:

```sh
node scripts/check-newcomer.mjs
```

The command builds the current backend using the durable local Compose environment. It creates a fresh temporary consumer directory, downloads the public `community-v0.1.0` CLI archive anonymously, verifies its SHA256 against the release's `SHA256SUMS`, and checks CLI version `0.1.2`. It installs `@likerts/web@0.0.3` from the public npm registry with fresh npm configuration/cache and no npm authentication, plus pinned Playwright for browser verification. Linux x64 and macOS arm64 are supported by this rehearsal.

The downloaded CLI creates and publishes a survey using the installed SDK's own capability record, then creates a collection. The installed SDK mounts the actual survey in headless Chromium; browser interaction submits it, an identical SDK retry returns the same receipt, and the released CLI retrieves exactly one stored response. The CLI revokes the collection and the browser verifies that the original collection token can no longer submit.

The loopback example host proxies only that collection's respondent routes. It never supplies the management token to browser code. This verifies a customer-controlled same-origin integration, not arbitrary third-party CORS settings or hosted login.

The harness uses unique Docker resources and newly generated local credentials. Its `finally` block closes the browser/server, removes its Compose containers and volumes, and deletes its temporary consumer and credentials. It never needs repository `.tools` files, existing npm login, a cloud account or production credentials. Playwright may reuse its standard browser download cache. First-time image/browser downloads require network access and can take several minutes; Linux CI installs Chromium's system dependencies.

For a deliberately prebuilt matching backend image, set `LIKERTS_SKIP_IMAGE_BUILD=1` and `LIKERTS_LOCAL_IMAGE=your-local-image`. To use standalone Compose, set `LIKERTS_COMPOSE_BIN=/absolute/path/to/docker-compose`.

To save sanitized evidence with versions, checksums and outcomes:

```sh
LIKERTS_NEWCOMER_EVIDENCE=/absolute/path/newcomer-evidence.json node scripts/check-newcomer.mjs
```

The evidence contains no credentials, collection IDs, response payloads or private file paths. [The checked-in rehearsal result](newcomer-evidence.json) records one actual local run. It establishes released-client compatibility with the checked-out backend; it does not establish hosted sign-in, production capacity, managed recovery or an availability commitment.

Required CI runs both this command and `bash scripts/check-local-compose.sh`. The latter executes the documented `scripts/first-response.sh` flow and verifies persistence after removing/recreating all containers while retaining volumes. This keeps source onboarding and published-package onboarding under separate explicit checks.
