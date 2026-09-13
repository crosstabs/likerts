# Svelte feedback host

A small, independent Svelte 5.57.0 application using the published `@likerts/web@0.0.3` DOM renderer. This is a host integration, not a new SDK. It reuses an existing collection; survey management never enters the browser.

The host's optional-feedback eligibility checkbox must be selected before **Give feedback** opens the child component. A Svelte `bind:this` receives the DOM host. Synchronous `onMount` starts the controller and returns cleanup; the parent `{#if}` block destroys/recreates the component. The async work is deliberately not the `onMount` callback itself. Loading, API failure, unconfirmed submission, blocked and accepted receipt states are explicit. A host-owned session retains the original ambiguous payload/key across close/reopen. No automatic replacement submission is created.

## Real local walkthrough

Prerequisites: Node.js **22.12+**, npm, Rust stable and Bash. Vite 8.3 requires a compatible current Node runtime. From the repository root in Bash:

```sh
source scripts/dev-env.sh
cd examples/svelte-feedback
npm ci
npm run build
npm run demo
```

Open **http://127.0.0.1:4360**. Opt into the fictional feedback example, open it, submit synthetic answers and choose **Read it from the backend**. The retrieved response ID must match the receipt. Close/reopen to exercise the framework lifecycle. Ctrl+C stops both servers and clears temporary data.

The helper builds the real Rust API/CLI, creates a unique local workspace/survey/collection using the installed SDK's capability record, and starts a memory-backed API on `4361`. It configures the collection for the exact browser origin. Fresh credentials stay in process memory; only the collection token reaches the browser. It does not use existing cloud credentials, database settings or a production workspace. Both servers bind to `127.0.0.1`.

Change occupied ports together:

```sh
LIKERTS_EXAMPLE_PORT=4370 LIKERTS_EXAMPLE_API_PORT=4371 npm run demo
```

Data persists only while the API runs. The host retry session is memory-only: close/reopen preserves it, a full browser reload clears it. Reconcile an ambiguous result with the operator before starting another submission after reload.

## Connect an existing local collection

Use the [API quickstart](../../README.md) and [CLI guide](../../tools/README.md) to create and publish a survey and collection outside the browser. Supply `{ installations: [LIKERTS_SDK_CAPABILITY] }` for the installed SDK when publishing and creating the collection. Configure its browser origin with `collections_security_update`:

```json
{
  "id": "YOUR_COLLECTION_ID",
  "allowedOrigins": ["http://127.0.0.1:4360"],
  "requestsPerMinute": 60
}
```

Copy `.env.example` to `.env.local` and fill in the API origin, collection ID and its limited credential. For the local operator readback only, supply a server-side management credential with `responses:read`. Explicitly set `LIKERTS_EXAMPLE_LOCAL_OPERATOR=1` for this loopback evaluation, then run `npm run build` and `npm start`. Node reads `.env.local` only for this server command. Never prefix the management token with `VITE_` or import it into client source.

The API configuration/readback routes return 403 without local opt-in. The standalone Node server binds only to loopback and checks the actual remote socket address, Host, Origin and fetch-site header. Headers alone are not authentication. **Do not expose or reverse-proxy this operator example publicly.** A real application must authenticate/authorize its own server routes and choose its eligibility, consent and collection-credential delivery policy. The example checkbox illustrates a host decision; it is not a consent-compliance system.

Readback is limited to the configured collection's first 100 records and returns the one matching receipt. It is not a public analytics or administration API. Use only synthetic, non-sensitive data here.

## Test a locally packed source SDK

The checked-in dependency and lockfile use npm. From the repository root in Bash, install a fresh source tarball without changing either:

```sh
npm ci --prefix sdks/web
framework_sdk_pack_dir="$(mktemp -d)"
npm pack ./sdks/web --pack-destination "$framework_sdk_pack_dir"
cd examples/svelte-feedback
npm ci
npm install --no-save --package-lock=false "$framework_sdk_pack_dir/likerts-web-0.0.3.tgz"
npm run build
npm run demo
```

Use the emitted tarball name if the source version changes. `npm ci` restores the public package. Remove the temporary package directory when finished. Nothing is published or committed by this workflow.

## Verify

From this directory, with Cargo available:

```sh
npm ci
npx playwright install chromium
npm run build
npm run check
```

Linux CI may use `npx playwright install --with-deps chromium`. `check` runs the production Vite output and the real API, without requiring a Vite development server. It verifies eligibility/keyboard mounting, error/recovery, three mount/unmount cycles, closing during loading, and closing after the API accepts a submission but before its reply reaches the browser. A late reply must not update the closed component. Reopening offers an explicit retry of the same payload/key; the API stores exactly one response and the local operator reads it back.

The checks also exercise default-disabled operator routes, cross-origin denial, management-token absence in the bundle/HTML/browser requests, and desktop/mobile layouts. Temporary processes/files are removed on completion. To retain screenshots outside the repository:

```sh
LIKERTS_EXAMPLE_SCREENSHOT_DIR=/tmp/likerts-framework-qa npm run check
```

See [framework verification](../../docs/verification/frameworks.md) for dated results. These tests cover Chromium, synthetic data and temporary storage; they do not establish public host authentication, PostgreSQL durability, all browser engines or all SDK question types. No app-store or package publication is implied.
