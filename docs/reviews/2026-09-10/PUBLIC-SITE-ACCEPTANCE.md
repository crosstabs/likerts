# Public-site acceptance — 10 September 2026

**Verdict: the deployed public preview passed this HTTP, navigation, artifact-integrity and source-consistency audit. It is not evidence of paid-launch readiness or completed human onboarding.** The contract snapshot and small presentation/demo corrections identified below were deployed on 2026-09-12 with commit `0bc8f22`; the footer status label was then tightened to “Service checks” in the next source change.

Observed at **2026-09-10T14:34:52.068342+00:00** against `https://likerts.com`. Read-only public requests; no login, workspace creation, response submission, payment, deployment or provider mutation. Parent owns separate live-browser acceptance.

## Observed live results

| Surface | Observed result |
| --- | --- |
| Homepage and pricing | `/` returned 200. Pricing is the `#pricing` section, not a separate route. US$0.01/response and US$5/500 credits explicitly planned; payment testing only, one-time 1,000 grant, no automatic top-up. |
| Quickstart | `/docs` returned 200 with five SDK installation paths, CLI 0.1.2, setup, response/retrieve/export/delete, errors/origins/offline boundaries and preview limits. |
| API reference | `/docs/api` returned 200, with 41 capability sections and working input-fixture links. The deployed OpenAPI snapshot lacks the latest admission error metadata; see finding below. |
| Demo | `/demo` returned 200. Real Web SDK 0.0.3 modules match local checked artifacts. HTML explicitly says local page-memory sample, no send/persist/bill; CSP `connect-src 'none'`. HTTP/source inspection does not exercise its controls. |
| Downloads | `/downloads` returned 200; five SDK 0.0.3 and both latest CLI 0.1.2 archives verify, as do three linked older CLI archives. Registry availability and unsigned Apple Silicon limitation are explicit. |
| Status | `/status` returned 200; live `/api/status` reported collection API/database, MCP and identity keys reachable. Scope explicitly excludes email OTP, payments, workers, response acceptance and uptime history. |
| Signed-out app shell | `/app` returned 200 and loads the expected public app assets. It describes invitation-only email-code access. No email was entered; no signup or authentication success is inferred. |

Trailing-slash links correctly return 308 to clean canonical paths, then 200. The audit fetched **83 distinct requested paths** across page links/assets, fixtures, metadata and downloads: **zero failed final responses, zero missing internal link targets or HTML anchors**. It did not crawl unlinked URLs, authenticate management routes, or validate every external hostname embedded in code samples. Additional direct requests verified all five compiled demo SDK modules, status script and workspace stylesheet with expected JavaScript/CSS MIME types and byte equality.

## Claims, metadata and source consistency

- Homepage, docs and demo consistently describe an invitation-only developer preview with no SLA and payment testing. The offer does not promise enterprise SSO, dedicated tenancy, live paid availability, customer logos or measured uptime. Actual identity-provider configuration was verified separately by the parent; this HTTP audit cannot verify admission or an OTP flow.
- All seven page titles and descriptions are populated. Homepage, docs, API reference and demo have canonical URLs, OG title/image and a large Twitter card. Downloads has a canonical URL; its missing share metadata is corrected locally. Status intentionally has `noindex`.
- `robots.txt` allows public crawling, disallows `/app` and `/api/`, and points to a valid XML sitemap containing five canonical marketing/docs/demo/download URLs. `/app` currently has no HTML `noindex`; optional indexing hygiene was reported to the parent. Robots exclusions are not access controls.
- `social-preview.png` is live `image/png`, 1200 × 630, identical to the local original branded asset; favicon is available. No fabricated customer proof was added.
- Live marketing CSS/JS, docs JS, docs HTML, capabilities registry, demo HTML/examples/SDK modules, API-reference HTML, status JS, robots and sitemap matched local source at audit time. App HTML/JS matched after normalizing the deliberate build-time CSP and public Clerk/API configuration.
- Live homepage copy advertises nine types, conditional flows, offline queues and API/MCP/CLI access. Detailed docs qualify capability declarations, host-controlled queue flushing, authentication/scopes, grant eligibility and acceptance gates; no generic exactly-once delivery or universal device-certification claim was found.

## Concrete corrections and handoff

| Priority | Finding and action | Acceptance |
| --- | --- | --- |
| P1 — documentation consistency | Deployed `/docs/openapi.json` predates final admission contract. Local snapshot was regenerated from frozen `contracts/openapi.json`; includes `admission_unavailable`, protected-route 503 and corrected 429/`Retry-After` metadata. Registry remains 41 capabilities. | Deployed on 2026-09-12 in commit `0bc8f22`; follow-up curl/browser checks confirmed the production alias served the updated site. |
| P2 — accuracy | Homepage search description said “five native SDKs”, which incorrectly included Web. Changed to “five SDKs” and “web and mobile products”. | Deployed on 2026-09-12; live HTML no longer contains “five native SDKs”. |
| P2 — sharing | Downloads had no OG/Twitter metadata. Added factual title/description, canonical OG URL and the existing branded card. | Deployed on 2026-09-12. |
| P2 — example consistency | Local demo simulated an accepted submission with HTTP 201; authoritative submission contract uses HTTP 200. Changed its injected transport to 200; payload and no-network behavior are unchanged. | Deployed on 2026-09-12; control-plane public-docs tests and local build passed. |

No app, status, billing, SDK archive or backend file was changed in this audit. The deployed site still contains the prior values until the parent publishes the small delta. No new tests were added for these low-impact changes; the existing focused public-docs suite passed **4/4**, including authoritative snapshots, actual fixture examples and release-module equality.

## Download integrity evidence

Each file returned 200. The SHA-256 below matched both live `SHA256SUMS` and the local immutable archive. This proves transfer/source equality, not third-party signing or notarization.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `Likerts-ios-0.0.3.tar.gz` | 27,693 | `5d2ac317ce977e097ea36940a23e5b857a77cae9e6e162454a1709c74c66c294` |
| `likerts-android-maven-0.0.3.tar.gz` | 250,017 | `ac4daa930922e2f226d5a305cfbd85553e997fd0e96e1594e9cdcaff88289696` |
| `likerts-cli-0.1.2-aarch64-apple-darwin.tar.gz` | 1,795,995 | `592a86a1b05e92edb289d076265519e74db82967fd40897d4305a60579f5900d` |
| `likerts-cli-source-0.1.2.tar.gz` | 21,235 | `f1fa5a1a08343ea905f3db9327669f1a8c86af10ae8238c2ac4e8bd4ae0718d6` |
| `likerts-flutter-0.0.3.tar.gz` | 16,831 | `4fb59f8e59145c28e15b5b3f6564d5197b5373ee7519641294d0c3e8c45e7b68` |
| `likerts-react-native-0.0.3.tgz` | 28,317 | `0153b7ecad3a0ea56c00014574c9a6c994a572f5169a514f3b94cc2282a37cb8` |
| `likerts-web-0.0.3.tgz` | 18,525 | `595ac8d2caf5208bd5c93806d608c3cfcf410d5b86b6faa391314d45a16dde59` |

## Evidence limits

No browser surface was available to this subagent; client-console errors, rendered mobile layout, keyboard/screen-reader behavior, tab/copy controls, demo interaction and Clerk rendering are assigned to the parent’s separate browser QA. A public 200 is not a functional journey. No real human signup, email delivery, customer acceptance, live payment settlement, sustained capacity, native device behavior, background recovery or incident response was tested here. Current dependency reachability is a single timestamped sample, not an availability percentage.

Local audit scratch output: `/tmp/likerts-public-http-audit/summary.json` and `supplement.json`; these contain only public observations, without credentials or customer data. The checksum table and findings above preserve the durable result.
