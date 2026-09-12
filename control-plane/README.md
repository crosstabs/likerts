# Likerts control plane

This is the minimal Vercel project for the operator surface. It is a static, framework-independent shell plus one public health function, so it can replace the older site without coupling the survey API to Vercel Functions.

The browser receives only `LIKERTS_PUBLIC_API_ORIGIN` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. The build validates the publishable key, derives its Clerk frontend domain, and mounts Clerk's sign-in component or user button. Likerts does not render a password form. `CLERK_SECRET_KEY`, object-store credentials and the database URL belong only on the API. Exports continue through the authenticated Likerts download endpoint; the control plane never proxies or signs stored objects.

The build also validates `LIKERTS_PUBLIC_API_ORIGIN` as one exact HTTPS origin (with loopback HTTP allowed only for local development) and writes that origin into the page's `connect-src` policy. It derives and admits only a Clerk-owned frontend origin or the configured `clerk.likerts.com` custom frontend origin encoded in the publishable key. Wildcards, URL credentials, paths, queries and fragments fail the build.

After sign-in, the page obtains the active Clerk session token in memory and calls `POST /v1/browser/bootstrap` with `credentials: omit`. It displays accepted-response counts and lets an owner issue scoped service credentials. The page never stores the session token or receives an API, Clerk secret, object-store or database credential.

Run `npm test` and `npm run build` without credentials. Before deployment, configure the two public variables in `.env.example` and verify Clerk email OTP on Preview. A successful local build does not prove identity, API, custom-domain or production connectivity.

The existing `crosstabs/likerts` Vercel project currently tracks the older private repository. The authorized replacement sequence is: preserve its history, import this workspace into that repository, review the resulting diff, connect this directory as the Vercel project root, configure Preview first, verify it, and only then promote Production. No push or deployment is performed by the local gate.
