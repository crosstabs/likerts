# Add feedback after checkout

This walkthrough runs a customer-owned Next.js page that opens a survey on demand, attaches checkout metadata, submits to a real local Likerts API and reads the accepted response back through the server. The application decides when feedback appears. Likerts does not send invitations or create a respondent link.

The runnable [Next.js example](../../examples/nextjs-feedback/README.md) uses published `@likerts/web@0.0.3`, Next.js `16.3.5`, React `19.3.0` and the repository's Rust CLI `0.1.2`. It is an evaluation host with synthetic data, not a publicly deployable customer portal. For other hosts, see the independently runnable [Vue](../../examples/vue-feedback/README.md) and [Svelte](../../examples/svelte-feedback/README.md) examples.

## Run the checkout

Prerequisites: a checkout of this repository, Rust stable, Node.js 22+ and npm. Use **Bash** from the repository root. No cloud account, database server or production credentials are required.

```sh
set -e
source scripts/dev-env.sh
npm ci --prefix examples/nextjs-feedback
npm run build --prefix examples/nextjs-feedback
LIKERTS_EXAMPLE_PORT=4380 LIKERTS_EXAMPLE_API_PORT=4381 \
  npm run demo --prefix examples/nextjs-feedback
```

Open **http://127.0.0.1:4380**. Select **Give feedback**, set the rating to 5 and enter a synthetic comment. Submit, then select **Read it from the backend**. The stored record's `receipt.responseId` must match the receipt shown on the page, and its metadata contains:

```json
{"screen":"checkout","framework":"nextjs"}
```

Use **Continue browsing** and **Back to checkout** to exercise client navigation. Feedback requires an explicit action when reopening. Ctrl+C stops both servers and removes their temporary export directory; responses disappear when this memory-backed API stops. Use different values for both ports if either is occupied.

## Follow the data through the application

The [local helper](../../examples/nextjs-feedback/scripts/run-local.mjs) generates a disposable workspace and credentials, then calls the real CLI to:

1. Create a survey with a required 1–5 `rating` and optional `comment` of at most 200 characters.
2. Publish that revision using `{ installations: [LIKERTS_SDK_CAPABILITY] }` from the installed Web SDK.
3. Create a collection pinned to the published version with `placement: "checkout"`.
4. Set its allowed browser origin to the exact host above and its request rate to 60 per minute.

Publication is an explicit step. Editing a draft does not change an existing collection's immutable published version. Declare every active SDK deployment group's real capabilities when publishing a survey for multiple clients.

The [client component](../../examples/nextjs-feedback/components/feedback.tsx) fetches `/api/feedback/config` only after the visitor selects the feedback button. That route returns the API origin, collection ID and collection credential. The component then obtains the schema and mounts the SDK renderer into its own DOM container. This is the mounting call from the example; `container`, `collection`, `client` and the receipt callback are supplied by that component:

```ts
cleanup = mountSurvey(container.current, collection, client, result => {
  if (!abort.signal.aborted) { setReceipt(result); setState('accepted'); }
}, { screen: 'checkout', framework: 'nextjs' });
```

In a real checkout, mount only after your application has established eligibility, for example after its own confirmed-order state and the visitor's feedback action. Add only metadata you need. Browser-supplied metadata is untrusted: it must not establish payment success, tenant identity or permission to view an order. Do not put payment details or secrets in it.

React effect cleanup aborts pending requests and calls the renderer cleanup function. The root-layout [feedback session](../../examples/nextjs-feedback/components/session.tsx) holds an unfinished submission independently of that renderer, so navigation can remove the DOM without losing the original retry payload.

## Handle an uncertain result

The wrapper copies the full submission, including its idempotency key, **before** sending it. If the reply is lost, the server may already have accepted the response. **Retry original submission** resends that exact saved payload and key; a successful identical retry returns the original receipt.

Do not generate a fresh key to make a timeout or conflict disappear. Validation/authorization failures need correction, while rate limits need bounded backoff. The example asks the visitor to retry explicitly and distinguishes a rejected attempt from an uncertain one. See [troubleshooting](../community/SUPPORT.md#common-integration-problems).

This pending state survives App Router navigation only. Reloading or closing the tab clears it. If that happens during an ambiguous attempt, reconcile with the operator before starting another submission. This example does not implement a persistent offline queue.

## Keep the server boundary intact

| Access | Credential and boundary |
| --- | --- |
| Fetch the published collection and submit | Collection credential in the browser; it cannot read stored responses or manage surveys. |
| Create/publish/configure | Server/operator management credential with `surveys:read`, `surveys:write` and `collections:write` as needed. |
| Retrieve stored responses | Server/operator management credential with `responses:read`; never expose it through `NEXT_PUBLIC_*`, serialized props or a client import. |

The helper's broad development credential is generated only for this disposable loopback workspace. Replace it with scoped credentials in an actual integration. A collection's CORS allowlist is browser policy, not customer authentication or an anti-bot guarantee.

The [server module](../../examples/nextjs-feedback/lib/server.ts) is marked `server-only`. Both example routes fail closed unless `LIKERTS_EXAMPLE_LOCAL_OPERATOR=1` is explicitly set, and the helper binds Next and the API to `127.0.0.1`. **Do not deploy these unauthenticated local operator routes publicly.** Host/Origin checks do not authenticate a user. Before public deployment, implement your application's authenticated, authorized response retrieval; a receipt ID alone is not permission. The sample readback searches only the first 100 responses of its configured collection. A real operator workflow must handle pagination and its authorization model.

## Reproduce the verification

Stop the interactive demo first. From the repository root in Bash:

```sh
set -e
source scripts/dev-env.sh
npm ci --prefix examples/nextjs-feedback
npm exec --prefix examples/nextjs-feedback -- playwright install chromium
npm run build --prefix examples/nextjs-feedback
LIKERTS_EXAMPLE_PORT=4380 LIKERTS_EXAMPLE_API_PORT=4381 \
  npm run check --prefix examples/nextjs-feedback
```

This command sequence passed on **2026-09-13** with the versions above. The production-build browser check proves explicit mounting, collection-fetch failure/recovery, navigation cleanup/remount, an API-accepted response whose reply is deliberately dropped, an identical retry after navigation, exactly one stored response, server readback, local default denial, cross-origin denial, desktop/mobile layout and management-token absence from HTML/static assets/client requests. The real API handles persistence and idempotency; only delivery of the first reply is fault-injected.

The check uses disposable memory storage and Chromium. It does not establish PostgreSQL durability, production authentication, all-browser compatibility or delivery after a full reload. Both servers and temporary data are cleaned up on normal completion.
