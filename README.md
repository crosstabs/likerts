# Likerts

Embedded surveys, controlled by the customer. Preview pricing: **first 1,000 accepted responses free per verified workspace, then US$0.01 per accepted response**, with US$5 buying 500 paid credits.

Rust backend, HTTP API, MCP server, Rust CLI, and SDK foundations for Web, React Native, iOS, Android and Flutter. Verified frozen SDK 0.0.3 supports schema versions 1–5, including baseline types, presets, conditional visibility, pages and branching, ranking, matrices, constant-sum questions and durable offline queue APIs. No survey-link hosting, distribution, invitation sending or enterprise deployment layer.

**The production service is ready for an invite-only developer preview; public paid launch remains on hold.** The first 1,000-response grant, append-only prepaid credit ledger, atomic consumption and Stripe Checkout/refund path are implemented and pass hosted test-mode acceptance. Production passwordless Clerk domains, Render/Neon tenant isolation, private exports, scoped credentials, direct API/MCP operation and checksummed SDK/CLI downloads are deployed. A fresh-user OTP and Codex/Claude journey, live merchant activation, reviewed legal/support ownership, managed recovery/alerts, sustained capacity and the supported native-device/accessibility matrix remain public-launch gates. See [the launch decision](LAUNCH-DECISION.md) for the exact boundary.

Preview artifacts for all five SDKs and the Rust CLI are available from [the production downloads page](https://likerts.com/downloads/). Likerts does not host or distribute respondent links; the customer's application decides when and where to render a collection.

## Start locally

Requires Rust stable and Node.js 22+; SDK platform builds need their native toolchains. During this build, Rust and selected mobile tooling were installed under ignored `.tools/`, without changing shell profiles. The helper also works with a normal Rust installation.

```bash
source scripts/dev-env.sh
cargo build --manifest-path backend/Cargo.toml --locked
export LIKERTS_DEV_TOKENS='{"local-demo-management-token":"demo"}'
export LIKERTS_ALLOW_MEMORY=1
export LIKERTS_ADMISSION_MODE=disabled # disposable local development only
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

## Before public paid launch

All five SDKs remain in scope together. Public release still requires the owner-controlled and managed-operation gates in [LAUNCH-DECISION.md](LAUNCH-DECISION.md), including the real customer identity/agent journey, live payment acceptance, traffic-abuse controls, managed recovery and complete platform testing for accessibility, localization and device integration. Durable response lifecycle, usage visibility, workspace spending caps, scoped service credentials, collection rate limits and the shared five-SDK behavior contract are implemented. Public SDK credentials cannot prove a human, purchase or trusted metadata.

Customer-configured signed response callbacks are implemented and locally tested; their payload contains IDs, and they do not distribute surveys. See [the callback contract and hosted acceptance limits](infrastructure/webhooks/README.md).

No public-launch readiness, SLA or profitable margin is claimed. The current [MODEL.md](MODEL.md) captures intended scope; [BUILD-STATUS.md](BUILD-STATUS.md) distinguishes deployed features from remaining release work.

Prioritized implementation and launch checklist: [TASKS.md](TASKS.md).
