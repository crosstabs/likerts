# Vercel control plane and private exports

The Vercel project hosts the operator interface only. Render runs the Rust API, callback worker and PostgreSQL. Browser clients call the API after Clerk authentication. The launch identity path is passwordless email OTP on Clerk Hobby; passkeys are an optional paid upgrade. All export creation, authorization, integrity checking and download responses remain in the API.

## Browser/API bridge

Configure these on the Render API:

- `LIKERTS_MANAGEMENT_ORIGINS=https://<exact-control-plane-origin>`
- `LIKERTS_BROWSER_SESSION_ISSUER=<exact-Clerk-session-issuer>`
- `LIKERTS_BROWSER_SESSION_AUDIENCE=<exact-Likerts-API-audience>`
- `LIKERTS_BROWSER_SESSION_JWKS_URL=<exact-Clerk-JWKS-URL>`
- `LIKERTS_BROWSER_WORKSPACE_KEY=<base64-encoded-32-byte-key>`
- `LIKERTS_BROWSER_OAUTH_CLIENTS=<comma-separated-registered-client-IDs>`

The browser gets a short-lived token from the active Clerk session and sends it as a Bearer token without cookies. The API verifies RS256, issuer, audience, expiry, subject and `azp`; `azp` must exactly equal the allowed request Origin. Management preflights accept only the configured exact HTTPS origin (or an explicitly configured loopback development origin), declared methods, and `Authorization`, `Content-Type`, and `X-Likerts-Workspace`. No wildcard or `Access-Control-Allow-Credentials` header is emitted.

`POST /v1/browser/bootstrap` HMAC-derives one stable personal workspace ID from issuer and subject. Its transaction creates that workspace, its owner membership and the fixed onboarding grant once. A replay returns the same workspace only while membership remains active; it never restores revoked ownership. Changing the derivation key changes the mapping and must be treated as a controlled identity migration, not routine rotation.

Clerk session tokens are not Likerts OAuth capability tokens. They cannot call the general management API. An owner must review a registered client ID and exact scopes in the control plane, then explicitly call `POST /v1/browser/oauth-grants`. The API requires current owner membership, a client ID in `LIKERTS_BROWSER_OAUTH_CLIENTS`, supported nonduplicate scopes, the configured OAuth audience and a maximum 30-day grant. There is no automatic first-use grant.

## Private Blob contract

Set these variables on the **Render API service only**:

- `LIKERTS_EXPORT_PROVIDER=vercel_blob`
- `LIKERTS_VERCEL_BLOB_TOKEN=<private-store read/write token>`
- `LIKERTS_EXPORT_PREFIX=exports`
- `LIKERTS_REQUIRE_REMOTE_EXPORT_STORE=1`

Do not give the callback worker or Vercel control plane the Blob token. Provider selection is explicit and invalid/missing Vercel configuration fails API startup. Local development defaults to the filesystem; existing explicit S3 configuration remains compatible.

The adapter writes with `access=private`, disables random suffixes, authenticates every read, refuses redirects, validates object keys/prefixes, and stops reads above 64 MiB. It does not return Blob URLs to clients. Revocation and the existing 24-hour retention operation delete the object; Vercel Blob has no configured lifecycle policy equivalent to S3, so the authenticated retention job must run reliably.

Private reads use Vercel's documented Bearer flow. Upload/delete compatibility is pinned to the control protocol used by `@vercel/blob` 2.8.0, API version 12, because Vercel does not publish a Rust SDK. The local mock gate detects request-shape drift, but a private Blob sandbox round trip is required before production and whenever the pinned JavaScript client changes.

## Replacement path

The existing Vercel project and private `crosstabs/likerts` repository contain the older site. Replacement is authorized, but the local work does not push or deploy it. Preserve the Git history, import this workspace into the repository, review the complete diff, set `control-plane` as the Vercel Root Directory, configure Preview variables first, and verify Clerk plus the Render API before promoting Production.

Run `bash scripts/check-launch-platform.sh` for the credential-free scaffold and economics gate. Run the Rust export tests separately with the workspace Rust environment. These checks do not prove Vercel account linkage, Blob credentials, custom DNS, Clerk production configuration or hosted export expiry.
