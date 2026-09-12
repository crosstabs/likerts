# Likerts

Likerts is a free, open-source backend for surveys embedded in your own web and mobile products. It provides one typed platform through HTTP, MCP and a Rust CLI, with SDKs for Web, React Native, iOS, Android and Flutter.

Likerts does not host respondent links or send invitations. Your application decides when a survey appears and supplies the customer context. Likerts validates the published schema, stores the response, returns an idempotent receipt and makes the data available through scoped reads, exports and signed callbacks.

There are no response credits, paid plans, license keys or application-level response quotas. Accepted-response counts are observability data only. Operators still configure request rates, payload bounds, storage capacity and concurrency to protect their infrastructure.

## What is included

- Nine question types: single choice, multiple choice, scale, text, number, date, ranking, matrix and constant sum
- NPS and yes/no presets, conditional visibility, pages and branching
- Immutable published survey versions and collection credentials
- PostgreSQL row-level security for workspace isolation
- Scoped service credentials and OAuth grants
- Stable response pagination, bounded exports, retention and erasure
- Signed response webhooks
- API, MCP and CLI operation parity
- Five client SDKs with encrypted offline queue adapters

## Run locally

You need Rust stable and Node.js 22+. The memory store is intended for a disposable local loop; PostgreSQL is required for durable deployments.

```bash
source scripts/dev-env.sh
export LIKERTS_DEV_TOKENS='{"local-demo-management-token":"demo"}'
export LIKERTS_ALLOW_MEMORY=1
export LIKERTS_ADMISSION_MODE=disabled
cargo run --manifest-path backend/Cargo.toml --locked
```

The API listens on `http://127.0.0.1:8080`. In another terminal:

```bash
source scripts/dev-env.sh
export LIKERTS_API_URL=http://127.0.0.1:8080
export LIKERTS_TOKEN=local-demo-management-token
cargo run --manifest-path tools/cli/Cargo.toml --locked -- capabilities
jq '. + {idempotencyKey:"my-survey-create-1"}' contracts/survey.example.json | \
  cargo run --manifest-path tools/cli/Cargo.toml --locked -- call surveys_create --input -
```

Use the returned survey ID and revision with `surveys_publish`, then create a collection. The [capability reference](contracts/CAPABILITIES.md) documents every API, MCP and CLI operation. [Tool setup](tools/README.md) covers the CLI and MCP server.

For PostgreSQL, set `DATABASE_URL` and use a migration-capable local account with `LIKERTS_RUN_MIGRATIONS=1`. Production should run migrations separately and connect the API with the restricted runtime role in `backend/provision-runtime.sql`.

## Verify

```bash
bash scripts/check.sh
bash scripts/check-postgres.sh
bash scripts/check-all-sdks.sh
```

The checks cover domain validation, interface parity, tenant isolation, durable idempotency, response lifecycle and all five SDK implementations.

## Repository map

| Directory | Responsibility |
| --- | --- |
| `backend/` | Rust API, domain validation, PostgreSQL repositories and migrations |
| `contracts/` | OpenAPI, survey schemas and cross-platform fixtures |
| `tools/mcp/` | Typed MCP adapter |
| `tools/cli/` | Rust CLI |
| `sdks/` | Web, React Native, iOS, Android and Flutter SDKs |
| `control-plane/` | Public site, documentation and optional hosted workspace UI |
| `infrastructure/` | Render, recovery, export and webhook deployment assets |

## Security model

A collection credential can fetch one immutable collection and submit responses to it. Management credentials are workspace-bound and explicitly scoped. PostgreSQL row-level security enforces tenant boundaries beneath the application layer. Browser origins are policy controls and do not replace authentication.

Never put a management credential in a browser or mobile app. Treat metadata as untrusted input and avoid sending secrets or unnecessary personal data. See [SECURITY.md](SECURITY.md) for reporting and deployment guidance.

## License

Likerts is available under the [MIT License](LICENSE).
