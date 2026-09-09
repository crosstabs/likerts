# Likerts

Embedded surveys, controlled by the customer. Proposed pricing: **first 1,000 accepted responses free per verified workspace, then US$0.01 per accepted response**, with US$5 buying 500 paid credits.

Rust backend, HTTP API, MCP server, Rust CLI, and SDK foundations for Web, React Native, iOS, Android and Flutter. Verified frozen SDK 0.0.3 supports schema versions 1–5, including baseline types, presets, conditional visibility, pages and branching, ranking, matrices, constant-sum questions and durable offline queue APIs. No survey-link hosting, distribution, invitation sending or enterprise deployment layer.

**This repository is a runnable development foundation, not a launch-ready service.** The backend defaults to loopback and supports durable PostgreSQL storage or an explicitly enabled in-memory development mode. The one-time promotional grant, append-only prepaid credit ledger and atomic credit consumption are implemented and verified locally; verified-signup abuse controls, notifications and payment-confirmed purchases remain open. Forced database RLS is implemented, while production identity and the remaining launch controls are still open, so do not accept real customer data or route public production traffic to it.

## Start locally

Requires Rust stable and Node.js 22+; SDK platform builds need their native toolchains. During this build, Rust and selected mobile tooling were installed under ignored `.tools/`, without changing shell profiles. The helper also works with a normal Rust installation.

```bash
source scripts/dev-env.sh
cargo build --manifest-path backend/Cargo.toml --locked
export LIKERTS_DEV_TOKENS='{"local-demo-management-token":"demo"}'
export LIKERTS_ALLOW_MEMORY=1
cargo run --manifest-path backend/Cargo.toml --locked
```

Development server: `http://127.0.0.1:8080`. Set `DATABASE_URL` to use PostgreSQL and run migrations separately or set `LIKERTS_RUN_MIGRATIONS=1` for local development. Memory storage requires the explicit `LIKERTS_ALLOW_MEMORY=1` switch. The displayed token is a public local example, not a production secret. You can map a second distinct token to a second workspace for isolation checks. SDK clients use a separate collection credential returned when creating a collection.

In another terminal:

```bash
source scripts/dev-env.sh
export LIKERTS_API_URL=http://127.0.0.1:8080
export LIKERTS_TOKEN=local-demo-management-token
cargo run --manifest-path tools/cli/Cargo.toml --locked -- capabilities
jq '. + {idempotencyKey:"my-survey-create-1"}' contracts/survey.example.json | cargo run --manifest-path tools/cli/Cargo.toml --locked -- call surveys_create --input -
```

Use the returned survey ID and revision with `surveys_publish`, then `collections_create`. [The capability reference](contracts/CAPABILITIES.md) covers all implemented operations with scopes, errors and input/output examples. [CLI and MCP setup](tools/README.md) describes input files, environment configuration and the stdio MCP server. Connecting an agent does not authorize deployment to a customer's website or app.

## Verify the complete loop

```bash
bash scripts/check.sh
bash scripts/check-postgres.sh
```

The first command checks the interfaces and SDK loop. The PostgreSQL check starts an isolated PostgreSQL 17 container and verifies persistence across reconnect, concurrent retry accounting, workspace filtering, closed collections and ledger consistency. Neither command deploys or makes external customer requests.

See [BUILD-STATUS.md](BUILD-STATUS.md) for platform checks and limitations. Mobile SDK build commands are in [sdks/README.md](sdks/README.md).

## Repository map

| Directory | Responsibility |
| --- | --- |
| `backend/` | Rust domain validation, PostgreSQL migrations/repositories and local HTTP service |
| `contracts/` | Versioned API/survey specifications and cross-platform acceptance fixtures |
| `tools/mcp/` | Typed MCP adapter over the API |
| `tools/cli/` | Rust terminal client |
| `tools/capabilities.json` | Implemented API/MCP/CLI operation inventory |
| `sdks/` | Five rendering and collection SDKs |
| `tests/` | Cross-interface integration verification |
| `economics/LAUNCH-PLATFORM-ECONOMICS.md` | Current Render, Vercel and Clerk launch model for the 1¢ service; hosted costs and margins remain unverified |

## Before launch

All five SDKs are required at launch; this foundation does not reduce that commitment. Release still requires hosted Render, Vercel, Clerk and payment evidence for identity, traffic/abuse controls, private exports and recovery, plus complete platform testing for accessibility, localization and device integration. Local credit accounting, collection rate limits and recovery drills are implemented and tested. Durable response lifecycle, usage visibility, workspace spending caps, scoped service credentials and the shared five-SDK behavior contract are implemented. Public SDK credentials cannot prove a human, purchase or trusted metadata.

Customer-configured signed response callbacks are implemented and locally tested; their payload contains IDs, and they do not distribute surveys. See [the callback contract and hosted acceptance limits](infrastructure/webhooks/README.md).

No production readiness or profitable margin is claimed. The current [MODEL.md](MODEL.md) captures intended scope; `BUILD-STATUS.md` distinguishes implemented features from release work.

Prioritized implementation and launch checklist: [TASKS.md](TASKS.md).
