# Engineering decisions

## Product boundary

- Ship survey collection infrastructure without distribution or public-link features.
- Support nine bounded question types, conditional visibility, pages, and branching.
- Keep one typed operation registry across HTTP, MCP, and CLI.
- Ship Web, React Native, iOS, Android, and Flutter SDKs from the same schema contract.

## Architecture

- Use TypeScript for MCP, browser tooling, and JavaScript SDKs.
- Use Rust for the API, CLI, validation, authorization, and high-throughput submission path.
- Use PostgreSQL as the durable source of truth and force row-level security on tenant tables.
- Derive workspace scope from authenticated credentials; never trust a caller-supplied workspace alone.
- Use collection-only credentials in respondent applications and scoped, revocable credentials for management.

## Distribution

- Release the complete source under MIT.
- Do not meter, charge, or commercially cap accepted responses.
- Preserve rate, payload, concurrency, storage, export, and offline-queue bounds as configurable safety controls.
- Treat the hosted site as a convenience deployment of the same public code.
