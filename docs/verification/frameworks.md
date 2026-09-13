# Vue and Svelte host verification

13 September 2026. Framework examples were added against source checkout `160620a` and checked locally on macOS arm64 with Node.js `22.22.2`, Rust stable and Playwright `1.63.0` Chromium. This records local evidence, not a merged-CI or production deployment claim.

| Integration | Versions | Lifecycle ownership |
| --- | --- | --- |
| [Vue](../../examples/vue-feedback/README.md) | Vue `3.5.42`, Vite `8.3.0`, Web SDK `0.0.3` | Template ref, `onMounted`, `onUnmounted`, parent `v-if` |
| [Svelte](../../examples/svelte-feedback/README.md) | Svelte `5.57.0`, Vite `8.3.0`, Web SDK `0.0.3` | `bind:this`, synchronous `onMount` returning disposal, parent conditional block |

Versions and lifecycle behavior were checked against npm and [Vue lifecycle docs](https://vuejs.org/api/composition-api-lifecycle.html#onunmounted), [Svelte lifecycle docs](https://svelte.dev/docs/svelte/lifecycle-hooks), and [Vite requirements](https://vite.dev/guide/). Each example is private and has its own pinned dependencies/lockfile. Both consume the published SDK; neither adds a new platform SDK or changes the Web API.

## Reproducible commands

From the repository root in Bash, with Docker/cloud accounts unnecessary:

```sh
source scripts/dev-env.sh
npm ci --prefix examples/vue-feedback
npm exec --prefix examples/vue-feedback -- playwright install chromium
npm run build --prefix examples/vue-feedback
npm run check --prefix examples/vue-feedback
npm ci --prefix examples/svelte-feedback
npm exec --prefix examples/svelte-feedback -- playwright install chromium
npm run build --prefix examples/svelte-feedback
npm run check --prefix examples/svelte-feedback
```

For Linux CI, install Chromium dependencies with `playwright install --with-deps chromium`. The examples use ports 4350/4351 and 4360/4361 by default; override `LIKERTS_EXAMPLE_PORT` and `LIKERTS_EXAMPLE_API_PORT` together when needed. Each check builds the real Rust API/CLI, uses unique credentials/workspace in an isolated temporary memory-backed API, serves production Vite output, then stops processes and removes its temporary directory. No existing cloud workspace or database is touched.

The Browser plugin/browser skill was unavailable; regular Playwright was used. The flow under test is: opt into local feedback → explicit keyboard open → render → submit → close during an accepted-but-delayed reply → reopen → retry unchanged payload/key → accepted receipt → server-side response lookup.

## Results

Both framework builds/type checks passed. Svelte reported zero errors and zero warnings. `npm audit --omit=dev --audit-level=high` reported zero vulnerabilities in both production dependency trees at this check; this is a point-in-time dependency check, not a complete security assessment.

| Check | Vue | Svelte |
| --- | --- | --- |
| Meaningful initial page/title; no form before host action | Pass | Pass |
| Explicit eligibility selection, then keyboard open | Pass | Pass |
| Loading and configuration/API failure with retry recovery | Pass | Pass |
| Three close/reopen cycles, one form only, old form detached | Pass | Pass |
| Close while configuration reply is pending; no late mount | Pass | Pass |
| Close while accepted submission reply is pending; no late receipt UI | Pass | Pass |
| Reopen and retry byte-equivalent JSON payload including same key | Pass | Pass |
| Exactly one stored response, matched receipt and framework metadata | Pass | Pass |
| Management access stays in local server; collection-only browser config | Pass | Pass |
| Both operator routes deny when local opt-in absent; cross-origin denied | Pass | Pass |
| Desktop 1280×900 / mobile 390×844; no horizontal overflow | Pass | Pass |
| No page errors or unexpected console warnings/errors | Pass | Pass |

The test deliberately returns a 503 configuration failure and withholds accepted replies. Expected injected network messages are separated from unexpected browser errors. The real backend handles acceptance, idempotency and response retrieval; these outcomes are not simulated receipts.

Static bundles, rendered HTML and browser request headers/bodies were checked for the test management credential. This is a bounded credential-boundary assertion, not proof against arbitrary data leaks. The standalone server binds to `127.0.0.1`, verifies the actual remote socket is loopback and requires explicit local-operator opt-in in addition to Host/Origin/fetch-site checks. It must not be publicly exposed or reverse-proxied; a real application must add its own authenticated/authorized operator routes.

The documented local-source package path also passed: pack `sdks/web`, install the emitted tarball with `--no-save --package-lock=false`, verify local-file provenance in the installation, then build both applications. Finally, `npm ci` restored the public registry dependency and the production-build/browser checks were repeated. No lockfile was changed to a private local path.

Screenshots were inspected for both frameworks at desktop and mobile widths. Retain fresh captures outside the repository by setting `LIKERTS_EXAMPLE_SCREENSHOT_DIR=/tmp/likerts-framework-qa`. The four files are `vue-desktop.png`, `vue-mobile-receipt.png`, `svelte-desktop.png` and `svelte-mobile-receipt.png`; screenshot artifacts are not committed.

## Limits

The local operator route only reads a receipt-matched record among the configured collection's first 100 responses. Pending attempts survive close/reopen in the host's memory, not a full reload. API data clears on shutdown. These examples do not establish PostgreSQL durability, public host authentication, external adoption, all browser engines, device coverage or every question type. The explicit checkbox illustrates an application-owned eligibility decision, not a consent-compliance promise.
