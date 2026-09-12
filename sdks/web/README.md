# Likerts Web SDK

## Install the local 0.0.3 artifact

This local package supports schemas 1–5. The release manifest records artifact and clean-install verification; frozen 0.0.1 and 0.0.2 artifacts remain available separately.

Run `npm install /path/to/releases/0.0.3/likerts-web-0.0.3.tgz` in your application. The tarball contains compiled ESM and TypeScript declarations; it needs no repository-relative imports or build step. Use a modern browser with Fetch, AbortController and crypto.randomUUID, and bundle the module with your host application. Package metadata remains private; no npm release has been published.

`examples/checkout.ts` supplies a customer-owned button trigger that loads/mounts feedback only when clicked and returns cleanup for navigation. Call it after your own eligibility/consent checks. The client should receive only a collection token. Build/test commands below refer to a source checkout, not the installed tarball.

The Web package fetches a public collection configuration and renders it inside a customer-owned element. The customer decides when to mount it, which first-party page contains it, and when to remove it. Never put a management credential in browser code.

```ts
import {LIKERTS_SDK_CAPABILITY, LikertsClient, mountSurvey} from '@likerts/web';

const client = new LikertsClient('https://feedback.example.com', publicCollectionToken);
const collection = await client.collection(collectionId);
const cleanup = mountSurvey(
  document.querySelector('#feedback')!,
  collection,
  client,
  receipt => console.log(receipt.responseId),
  {orderStage: 'after_payment'},
  {
    messages: {submit: 'Send feedback', submitted: 'Thank you'},
    classNames: {form: 'my-survey', submit: 'my-button'},
  },
);
```

Publish and collection-management requests declare `LIKERTS_SDK_CAPABILITY` for every Web installation group. A collection client caches configuration for five minutes. Use `collection(id, {refresh: true})` before presentation when fresh configuration is required, and `clearCollectionCache()` when ending the client lifecycle.

## Styling and localization

The renderer emits stable `likerts-*` classes for the form, title, question, label, control, submit button and status. Question wrappers also expose `data-likerts-question` and `data-likerts-type`. Supply extra host classes through `classNames`; the SDK never inserts inline styles. Supply translated UI copy through `messages`. Survey titles, question labels and choices remain customer-authored collection content.

The form associates every label and control, exposes title and status relationships, follows native keyboard order, uses native constraint feedback, announces progress, and moves focus to a submission alert after a server failure. `cleanup` aborts an active request, removes the form and suppresses late completion.

## Browser deployment

The client requires HTTPS except on exact loopback development hosts. Customers may use a same-origin proxy or configure exact HTTPS origins with `collections_security_update` for direct browser calls. The API answers bounded preflight requests and echoes only configured origins; the bearer collection credential, expiry, caps and revocation remain authoritative because an origin is never an authentication boundary.

The renderer works under a strict CSP without `unsafe-inline` or `unsafe-eval`. Load the SDK and customer CSS as external same-origin resources and allow the API origin in `connect-src` when it differs. The client rejects redirects, limits each response body to 256 KiB by default, and permits a smaller limit through the final constructor argument.

Run `npm run build && node --test test/*.test.mjs` for component checks. From the repository root, `scripts/check-web-browser.sh` builds the real backend and uses Chromium to verify accessible labels, keyboard-only completion, strict CSP, host styling/localization and accepted-response accounting through a same-origin proxy.

Schema 3 choice semantics are documented in [CHOICE-FEATURES.md](../../contracts/CHOICE-FEATURES.md): Other answers carry separate selected IDs and text; None is exclusive; stars retain numeric answers and dropdowns retain option IDs.

Schema 5 adds the bounded advanced families in [ADVANCED-QUESTIONS.md](../../contracts/ADVANCED-QUESTIONS.md). Ranking answers are complete option-ID permutations and use explicit Move up/down buttons. Matrix answers map each answered row ID to one column ID or a nonempty list of column IDs and render as stacked fieldsets. Constant-sum answers contain every item ID, accept nonnegative integers and must equal the configured total; the remaining amount is announced while editing.
