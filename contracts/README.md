# Shared contract fixtures

`survey.example.json` exercises all six question types. `response.example.json` is its valid submission. All wire names are camelCase. No fixture credential is a production credential.

`conditional-survey.example.json` and `conditional-response.example.json` exercise schema-v3 conditional visibility. [CONDITIONAL-VISIBILITY.md](CONDITIONAL-VISIBILITY.md) defines the bounded condition grammar, missing-answer truth table, cycle rejection, hidden-answer removal and requiredness semantics.

`advanced-survey.example.json`, `advanced-response.example.json` and `advanced-question-cases.json` exercise schema-v5 ranking, matrix and constant-sum questions. [ADVANCED-QUESTIONS.md](ADVANCED-QUESTIONS.md) defines their bounded configuration, exact answer schemas and mobile interaction requirements.

[OFFLINE-COLLECTION.md](OFFLINE-COLLECTION.md) defines the planned durable encrypted queue, its hard capacity and age limits, caller-controlled retry transitions, revocation/expiry behavior and platform threat limits. `offline-queue-cases.json` is the shared state-transition fixture.

The HTTP API, MCP, CLI and SDKs must use the same schema and submission semantics. A public collection token is a limited submission capability, not proof of a human or of customer-authenticated metadata. Metadata supplied by a client is untrusted.

Contract coverage must include missing required answers, wrong answer types, unknown option IDs, out-of-range ratings, repeated transport requests and mismatched reuse of an idempotency key. SDK rendering never replaces server validation.

`openapi.json` is the authoritative wire schema for the implemented local API. MCP derives its input and output schemas from it and validates both arguments and successful responses. [CAPABILITIES.md](CAPABILITIES.md) documents every operation, scope, error and synthetic input/output example. Edit `example-data.mjs` and run `node contracts/generate-examples.mjs` to refresh the generated examples/reference.

After building the MCP adapter and CLI, run `node contracts/check.mjs`, `node contracts/generate-examples.mjs --check` and `node --test tests/interface-contract.mjs`. CI runs these gates in `scripts/check.sh`. They verify exact registered Axum routes against OpenAPI, explicit reasons for non-tool transports, API/MCP/CLI operation sets, required schemas/errors, all examples and real MCP/CLI HTTP dispatch for every capability. Upstream error bodies are never echoed by the tools; their safe structured error envelope is `ToolError` in OpenAPI. The operation fixture server checks transport semantics; existing integration/PostgreSQL suites separately prove backend behavior.
