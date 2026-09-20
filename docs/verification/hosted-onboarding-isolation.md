# Hosted onboarding and tenant-isolation verification

This is a production-path verification from 20 September 2026. It used two
fresh synthetic identities, non-sensitive synthetic survey data and the public
`https://likerts.com/app` control plane. Fixture identifiers, sign-in tickets,
session tokens and service credentials remain in private local evidence.

## Deployment boundary

- Website: Vercel production `dpl_8gMT5pEp32DnF9hLZQD1nntV9vrK`, main source
  `1e2b9c5d929042521102dd7ee9da3c9b60a80184`.
- API: Render `dep-danmd53tqb8s73cd74d0`, source
  `ec8a581c2c7b9c739bc94a14633741bd5af8a9e4`.
- Identity: the production Clerk issuer and JWKS at `clerk.likerts.com`, plus a
  60-second `likerts-api` JWT template whose audience is the exact Render API
  origin.

The first fresh-session attempt found two real configuration defects. Render
allowed only an obsolete Vercel preview origin and still trusted the old Clerk
development issuer and JWKS. The production Clerk default session token also
lacked the API audience required by the verifier. The Render allowlist, issuer
and JWKS were corrected, the dedicated audience template was created, and the
browser now requests that template. Validation remains strict: RS256 signature,
issuer, audience, expiry and `azp` must all match, and `azp` must equal the
request `Origin`. [PR #38](https://github.com/crosstabs/likerts/pull/38)
passed both required jobs before merge.

## Result

The final run passed 25 authenticated API operations and these assertions:

- two fresh synthetic Clerk accounts opened the real production app and each
  bootstrapped one distinct personal workspace;
- each account issued a scoped 90-day service credential through the browser
  UI, including explicit review of write and workspace-deletion capabilities;
- each browser session was denied with `403` when it selected the other
  account's workspace;
- tenant A created and published a survey, created a collection and accepted
  one response; an identical retry returned the same receipt and stored one
  response;
- tenant B received no rows when filtering its response list with tenant A's
  collection ID, and received `404` for tenant A's collection, response,
  service credential and export IDs;
- tenant A's export became ready, contained exactly the accepted response and
  matched the API's SHA-256 digest;
- the export and collection were revoked, the raw response was erased, and
  both workspaces were deleted through their scoped credentials.

Independent database readback found both workspaces marked deleted, zero
remaining memberships, zero remaining service credentials, the one response
raw-erased and the one export revoked. Both synthetic Clerk user lookups then
returned `404`. The retained private result contains no session, collection or
service tokens.

## Remaining H01 boundary

The identities were created through Clerk's authorized backend API and entered
the browser through 15-minute sign-in tickets. This proves the hosted
post-authentication onboarding and tenant-isolation path, but it does not prove
that an unaided public user can complete the email-code sign-up screen. H01
therefore remains open only for one owner-observed self-service email-code
authentication followed by the already verified workspace opening. No customer
or external-user onboarding is claimed.
