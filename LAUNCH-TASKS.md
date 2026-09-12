# Community edition launch tasks

## Code and contract

- [x] Remove billing, checkout, settlement, payment-webhook, credit, and commercial-limit operations.
- [x] Make response receipts and usage summaries count-only.
- [x] Update MCP, CLI contract, OpenAPI, SDK sources, and public console.
- [x] Pass backend, interface, control-plane, and all five SDK gates.
- [x] Remove or clearly archive remaining prelaunch commercial artifacts.

## Open-source readiness

- [x] Add MIT license, contribution guide, and security policy.
- [x] Replace the README with a self-hosted quickstart and architecture map.
- [x] Verify a fresh clone can reach its first accepted response.
- [x] Scan publishable files and Git history for credentials and private evidence.
- [x] Publish the GitHub repository and set its description, homepage, and topics.

## Hosted reference deployment

- [x] Deploy the database migration and unmetered Rust API.
- [x] Deploy the matching MCP server and callback worker.
- [x] Deploy the revised marketing site and documentation.
- [x] Verify service health, the passwordless login surface, MCP discovery and denial, and one idempotent response on production.
