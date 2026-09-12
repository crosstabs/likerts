# Identity and authorization contract

Likerts uses Clerk as the initial managed identity and OAuth provider behind a provider-neutral OIDC boundary. Human accounts are passwordless: email OTP provides bootstrap and recovery, and passkeys provide routine login. Usernames and passwords are disabled. Respondents do not authenticate.

Every human management request selects one workspace with `X-Likerts-Workspace` and carries a JWT access token for the exact Likerts API resource. The workspace header is only a selector. The service verifies RS256, the exact issuer string, audience, expiry, subject, OAuth client identity and requested scope against the explicitly configured JWKS URL. It then requires a matching Likerts-owned durable grant for that workspace, subject, client, audience and scope and loads the current membership in the same RLS-scoped transaction. Effective authority is the intersection of token scope, stored grant scope and current role. Removing either the membership or grant blocks the next request even while the provider token remains cryptographically valid.

The JWT may identify the OAuth client with the standard `client_id` claim or the compatibility `azp` claim. If both exist they must match. An optional namespaced grant ID is syntax-checked but does not provide authority. Email, Clerk Organization membership and mutable provider profile data are never authorization keys.

Roles are `owner`, `editor` and `reader`. Owners manage membership, credentials and billing. Editors create, edit and publish surveys and manage collections. Readers retrieve responses and usage. Billing, identity and webhook mutations have explicit scopes even for owners.

Interactive browser, CLI and remote MCP clients use authorization code with PKCE S256. Likerts publishes OAuth protected-resource metadata with its resource identifier, authorization server and every management scope. Clients fetch the provider's `/.well-known/oauth-authorization-server` metadata and must verify the exact issuer, HTTPS endpoints, authorization-code and refresh support, S256, and advertised requested scopes. The CLI sends the RFC 8707 `resource` parameter in authorization and token requests, binds the loopback callback with `state`, and stores rotating credentials in an atomic user-only file. Provider access tokens never appear in MCP tool arguments or results.

For Clerk, configure the exact Frontend API issuer without changing its trailing-slash form, its published `/.well-known/jwks.json` URL, JWT access tokens, custom Likerts scopes, a public CLI OAuth client with the exact loopback redirect, and consent. MCP clients that omit `scope` need deliberately narrow default scopes; do not grant every management scope by default. Prefer Client ID Metadata Documents where the client supports them, and enable dynamic registration only for clients that require it. Likerts does not accept opaque provider tokens because the runtime verifies JWTs locally.

Unattended automation uses a tenant-owned opaque service credential. Likerts stores only its SHA-256 digest, expiry, scopes and revocation state. Service credentials do not impersonate a human and cannot cross workspaces.

Recovery uses Clerk's verified email flow, followed by provider session/refresh-token revocation and passkey reenrollment. Likerts membership remains independently revocable. Ownership, billing and credential changes require recent authentication. There is no local password or support bypass.

Production requires all three variables together:

- `LIKERTS_OIDC_ISSUER`: exact JWT `iss` and authorization-server identifier;
- `LIKERTS_OIDC_AUDIENCE`: exact Likerts API resource/audience;
- `LIKERTS_OIDC_JWKS_URL`: explicit trusted HTTPS JWKS URL.

The verifier refuses redirects, limits JWKS responses to 256 KiB, caches keys for ten minutes and refreshes when the token `kid` is absent. A refresh failure fails authentication. Logs record bounded outcome categories and request IDs, never bearer tokens, claim payloads, email addresses or response contents.

## Checked local identity gate

The provider-independent gate exercises controls owned by Likerts:

- locally signed Clerk-shaped RS256 JWTs prove exact issuer, audience, expiry, signature and `client_id` validation, including conflicting `client_id`/`azp` rejection;
- restricted PostgreSQL tests prove the intersection of token scope, durable grant scope and current role, including wrong client/audience, excess scope, expired/revoked grants, membership removal, service-credential revocation and cross-workspace denial;
- the CLI validates OAuth authorization-server metadata, PKCE S256 and required scope advertisement, binds callback state, sends a resource indicator, rotates refresh tokens and uses private atomic storage;
- the contract checker keeps all management operations aligned across OpenAPI, MCP and CLI.

These checks do not substitute for hosted evidence. ID-01 and ID-02 remain open until a Clerk sandbox records: passwords/usernames disabled; passkey enrollment and login on supported physical devices; email OTP bootstrap and recovery; real CLI authorization-code/PKCE/refresh/logout; Codex and Claude MCP consent; refresh-family revocation; signing-key rotation with bounded JWKS refresh; membership removal during an otherwise-valid session; wrong-audience and excess-scope rejection by the deployed API; and the contracted Clerk plan and limits. Record redacted tenant/client identifiers, timestamps and outcomes, never tokens or OTPs.

Primary references: [Clerk OAuth implementation](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth), [Clerk OAuth token verification](https://clerk.com/docs/guides/configure/auth-strategies/oauth/verify-oauth-tokens), [Clerk passkeys](https://clerk.com/docs/reference/android/passkeys), and [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
