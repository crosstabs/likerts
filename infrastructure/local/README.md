# Durable local development with Docker Compose

This starts PostgreSQL 17 and the Rust API from the current checkout. It is a development environment, with no cloud account or paid service. Docker with Compose v2 or later and OpenSSL are required. The first build downloads Rust dependencies and can take several minutes.

From the repository root:

```sh
bash infrastructure/local/compose.sh up --build --detach --wait
curl --fail http://127.0.0.1:8080/health
```

The helper creates random local credentials once in the ignored `.tools/local-compose/.env`, with private file permissions. Keep that file together with the database volume: replacing it does not rotate passwords in an existing database. The API listens only on `127.0.0.1:8080`; PostgreSQL has no published port. Set `LIKERTS_LOCAL_PORT=8081` before the command if port 8080 is occupied.

Database readiness comes first, then the existing immutable migration runner, then the canonical restricted-runtime grants, then API readiness. The API receives only its restricted database credential. It runs without root, with a read-only filesystem and a separate persistent export volume. Database and export volumes survive container recreation.

## First stored response

Install the repository's Rust, jq and curl prerequisites, then run its existing first-response flow using the generated development token:

```sh
export LIKERTS_TOKEN="$(sed -n 's/^LIKERTS_LOCAL_TOKEN=//p' .tools/local-compose/.env)"
export LIKERTS_API_URL=http://127.0.0.1:8080
bash scripts/first-response.sh
unset LIKERTS_TOKEN
```

The flow creates and publishes a survey, creates a collection, submits a response twice with one idempotency key and retrieves the single stored response. Adjust the API URL when using a different port. The generated management token selects the `local-development` workspace with development access. This setup deliberately enables development authentication and disables distributed admission. **Do not expose it publicly or deploy it as production.** Random local credentials do not replace production OAuth, admission, TLS, backups or operational controls. This example has no login UI, MCP gateway or callback delivery worker.

## Stop, restart and delete

Stop and remove only this project's containers and network, keeping data:

```sh
bash infrastructure/local/compose.sh down
bash infrastructure/local/compose.sh up --detach --wait
```

To explicitly erase this local database and export data:

```sh
bash infrastructure/local/compose.sh down --volumes
```

The credential file is retained so another startup works. Delete it only after deleting the matching volumes if you want newly generated credentials. Never use a global Docker prune to reset this example.

For separate copies, set both `LIKERTS_LOCAL_PROJECT=likerts-local-mytest` and `LIKERTS_LOCAL_STATE_DIR=/absolute/private/directory`, plus a distinct port. Use those same values for every lifecycle command. Do not share a credential file between independent projects. Docker administrators can inspect container environment variables; avoid sharing Compose configuration output or the credential file.

## Verification

```sh
bash scripts/check-local-compose.sh
```

This creates a uniquely named isolated project with temporary credentials and a random loopback port. It runs the real first-response script, checks runtime privileges and unscoped tenant denial, removes/recreates all containers without removing volumes, and retrieves the same stored response. Cleanup deletes only that check's resources and volumes. It also requires Node.js 22. For an already built image, use `LIKERTS_SKIP_IMAGE_BUILD=1 LIKERTS_LOCAL_IMAGE=your-local-image`; this does not verify a new source build.

The helper uses `docker compose` by default. If Compose is installed as a standalone binary, set `LIKERTS_COMPOSE_BIN=/absolute/path/to/docker-compose`.
