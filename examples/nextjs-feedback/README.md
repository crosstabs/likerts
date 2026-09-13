# Next.js App Router feedback host

An independent, loopback-only host example for published `@likerts/web@0.0.3`. The application reuses an existing collection, mounts only after **Give feedback**, and removes the DOM renderer/aborts requests on navigation. A root-layout session keeps an ambiguous submission's original key and payload in memory across client navigation. The user explicitly retries that same attempt; no duplicate is generated to hide an error.

The example uses Next.js `16.3.5`, React `19.3.0`, TypeScript `5.9.3` and Node.js 22+. Next/React versions were checked against npm and [official installation documentation](https://nextjs.org/docs/app/getting-started/installation) on 2026-09-13. A lockfile fixes the dependency graph. It follows [Server/Client Component boundaries](https://nextjs.org/docs/app/getting-started/server-and-client-components): the DOM host is a Client Component; management access is in a `server-only` module.

## Run the complete local example

Install Rust stable, Node.js 22+ and npm. From the repository root in **Bash**:

```sh
source scripts/dev-env.sh
cd examples/nextjs-feedback
npm ci
npm run build
npm run demo
```

Open **http://127.0.0.1:4330**. Select **Give feedback**, answer, submit, then select **Read it from the backend** and compare the receipt ID. Navigate to **Continue browsing** and back to exercise unmount/remount. Ctrl+C stops the Next server and API and deletes the temporary export directory.

The helper builds the real Rust API and CLI, starts an isolated memory-backed API on port 4331, creates a synthetic survey and collection through the CLI using the installed SDK's capability record, and allows only the Next origin for collection CORS. It generates credentials in memory, passes management access only to the Next server, and ignores existing database/authentication configuration. The browser receives only the collection credential. No production workspace is modified.

The first build may take several minutes. For occupied ports:

```sh
LIKERTS_EXAMPLE_PORT=4340 LIKERTS_EXAMPLE_API_PORT=4341 npm run demo
```

Responses survive navigation/browser reload while the local API runs, but disappear when the API stops. The application's pending-retry state is memory-only and survives App Router navigation, **not full reloads or tab closure**. Reconcile an ambiguous result with the operator before starting another submission after a reload.

## Use an existing local collection

Start the API and create/publish a survey and collection using the [root quickstart](../../README.md) or [CLI guide](../../tools/README.md). Declare the installed `LIKERTS_SDK_CAPABILITY` in both publication and collection creation. Configure that collection's exact allowed origin using `collections_security_update`:

```json
{
  "id": "YOUR_COLLECTION_ID",
  "allowedOrigins": ["http://127.0.0.1:4330"],
  "requestsPerMinute": 60
}
```

Copy `.env.example` to `.env.local` and fill in the existing collection ID and restricted collection token. Supply a server-only management credential with `responses:read` for local readback. Do not use real customer data in this unauthenticated operator sample. Set `LIKERTS_EXAMPLE_LOCAL_OPERATOR=1` **only for loopback testing**, then run `npm run build` and `npm start` (or `npm run dev`). The app never creates surveys or collections from browser code.

By default, both example API routes deny access unless that local-operator flag is explicitly enabled. The demo helper sets it and binds Next/API to `127.0.0.1`. Host/Origin/fetch-site checks provide additional local-browser defenses; **these headers are not authentication**. Do not deploy this sample publicly. A real host must replace the local operator routes with authenticated, authorized application routes before exposing response retrieval. Keep management credentials out of `NEXT_PUBLIC_*`, serialized props, client modules and source control. The readback route is bounded to the configured collection's first 100 responses and returns only the receipt-matched record; it is not an administration endpoint.

## Consume a locally packed SDK instead

The checked-in package and lockfile intentionally use the public registry. To test source changes without altering them, from the repository root in Bash:

```sh
npm ci --prefix sdks/web
nextjs_sdk_pack_dir="$(mktemp -d)"
npm pack ./sdks/web --pack-destination "$nextjs_sdk_pack_dir"
cd examples/nextjs-feedback
npm ci
npm install --no-save --package-lock=false "$nextjs_sdk_pack_dir/likerts-web-0.0.3.tgz"
npm run build
npm run demo
```

Use the filename emitted by `npm pack` if the source version changes. `npm ci` restores the pinned registry package. The temporary tarball can be removed when finished. This path does not publish a package or edit historical release archives.

## Verification

Browser plugin was unavailable during initial verification; the isolated check uses Playwright Chromium. Install its browser once, then run from this directory with Cargo available:

```sh
npx playwright install chromium
npm run build
npm run check
```

`check` runs the real API and a **production Next build**, submits one response, deliberately drops the accepted reply, navigates away/back, retries the unchanged key/payload and verifies exactly one stored response. It also checks explicit mounting, collection fetch failure/recovery, renderer cleanup, accepted receipt and server readback, cross-origin denial, desktop/mobile layout, and management-token absence in static output/HTML/browser requests. The simulated failure affects delivery of the reply only; persistence and idempotency use the real backend.

Screenshots default to a temporary directory deleted on completion. To retain them outside the repository:

```sh
LIKERTS_EXAMPLE_SCREENSHOT_DIR=/tmp/likerts-nextjs-qa npm run check
```

This is a Next host integration test, not proof of PostgreSQL durability, a public production authentication flow, all browser engines or every question type. Those have separate platform/SDK checks.
