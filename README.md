# Likerts

Likerts is a free, no-account synthetic market-research product. It turns a research brief into a transparent Population Frame, a directional five-point distribution, segment hypotheses, labeled model-generated perspectives, an evidence ledger, a Model Card, and a reproducibility receipt. It does **not** recruit people or claim population representativeness.

Public pilot: [likerts.com](https://likerts.com) (the current localization UX is deployed; model-backed execution remains fail-closed until globally durable admission storage is provisioned)<br>
Agent endpoint: [likerts.com/api/mcp](https://likerts.com/api/mcp)<br>
Public research contract: [likerts.com/research-standards/](https://likerts.com/research-standards/)<br>
Localization scorecard: [likerts.com/api/localization-scorecard](https://likerts.com/api/localization-scorecard) (live, with release evidence honestly pending)<br>
Sample study library: [likerts.com/studies](https://likerts.com/studies/)

## Runtime

- **Quick** runs framing, one aggregate model-synthesis stage, and a separate pipeline critic. AUTO evidence can add two bounded Exa searches through Vercel AI Gateway.
- **Deep** defaults to four independently generated model cells, aggregates them deterministically, reports Jensen–Shannon divergence and maximum percentage-point spread, and then runs the pipeline critic. The cell count is bounded from 2–8.
- Every study creates a versioned Population Frame before model calls. Structured marginals and known intersections use post-stratification or iterative proportional fitting when feasible; missing characteristics remain explicitly unsupported. Population weighting constrains declared composition only—demographic fit does not prove attitudinal accuracy.
- New studies use a runtime-owned method template. Alongside General Likert, Concept, and Purchase Intent, the product supports Message Testing, Claims Testing, UX Expectation Testing, Feature Prioritization, Brand Positioning, Price Sensitivity, Survey Pretesting, and Interview-Guide Generation. Each method owns its required stimulus, estimand, output shape/chart, critic rubric, limitations, and recommended human validation.
- Every result includes a transparent Model Card. It states that outputs are not observed human responses, are not representative samples, and remain unvalidated for attitudes.
- A brief can include up to four bounded `txt`, `md`, `csv`, `json`, PDF, DOCX, or XLSX research materials. Documents are extracted locally with page/paragraph/cell locators and strict byte, expansion, page, sheet, row, cell, character, and time limits; formulas, macros, links, scripts, and embedded objects are never executed. Only retrieved bounded excerpts enter the request, while raw files stay out of prompts and saved runs.
- Every returned stage records its requested route, fallbacks, resolved model when reported, version identifiers, usage, timestamps, and exact Gateway cost when Vercel returns it.
- Input and evidence hashes support auditable comparison. Model output remains non-deterministic and is never described as human-panel evidence.
- Completed directional runs support bounded follow-up exploration of one runtime-identified model segment: ordinary follow-ups, objection tests, structured counterfactuals, and two-concept comparisons. Each turn preserves prior context, resolves declared evidence and assumption references, records turn/model lineage, and carries the immutable label “Model-generated perspective—not a participant quotation.” The server endpoint remains stateless; an optional bounded IndexedDB project persists the client-side transcript with export/import/clear controls and explicitly states that browser storage is not encrypted account storage.
- Every completed run includes a deterministic human-research handoff: a questionnaire draft, screener, monitor-only demographic targets, transparent sample-planning math, an unestimated-incidence boundary, recruitment and analysis plans, provider links, missing-field checklist, and CSV/XLSX/text/JSON exports. It does not book a panel, infer incidence from synthetic output, or claim that anyone was surveyed.

Vercel AI Gateway uses deployment OIDC automatically. Direct `AI_GATEWAY_API_KEY` is also supported by the SDK. Exa Gateway retrieval therefore needs no separate Exa key on Vercel. Optional `EXA_API_KEY` and `FIRECRAWL_API_KEY` enable the direct/fallback retrieval paths shown in the evidence ledger.

## Local development

```sh
npm install
npm run dev
npm test
npm run build
npm run eval:offline
```

Normal tests and offline evaluation make no paid model calls. The live evaluation runner is disabled by default; see [evals/README.md](evals/README.md) before enabling it.

## Sample study library

The library publishes ten frozen Deep-mode studies across the ten enabled sample/report locales. Every generated JSON record exposes the curated brief, a Population Frame, Model Card, five-point distribution, model-cell disagreement, runtime evidence ledger, critic findings, cost and lineage provenance, synthetic-research boundaries, and a prefilled **Run your own version** link. Locale hubs are static, crawlable HTML; records are also available under `/{locale}/studies/{slug}/study.json` and through the read-only MCP tools `list_sample_studies` and `get_sample_study`. Interface-language support is narrower and only exposes locales whose UI catalog is complete.

```sh
npm run studies:build
npm run studies:verify
STUDY_LIBRARY_URL=http://127.0.0.1:5173/studies/index.html \
STUDY_LIBRARY_DETAIL_URL=http://127.0.0.1:5173/en-us/studies/ai-copilot-pilot-small-business-us/index.html \
npm run studies:verify:browser
```

`npm run build` regenerates the static library before Vite builds the application. Live sample capture is separate, opt-in, serial by default, and requires explicit run, estimated-cost, and actual-cost caps. Published sample captures are sanitized editorial artifacts; they contain no credentials, session records, or human respondent data. The public status remains `Automated QA passed · human editorial review pending` until a human review is genuinely completed.

## Operational controls

Runtime reliability, browser failures, correlation IDs, aggregate product events, explicit in-product feedback, alert thresholds, dashboards, and the improvement cadence are defined in the [monitoring and product-improvement runbook](docs/monitoring-and-product-improvement.md). Automatic same-origin operational telemetry is independent of the optional Vercel Web Analytics integration and never includes raw research inputs; the feedback panel separately discloses its bounded open-text collection.

| Variable | Default | Purpose |
| --- | ---: | --- |
| `LIKERTS_ADMISSION_STORE_PROVIDER` | unset | Set to `upstash-redis-rest` to select the implemented shared admission provider. Production paid execution remains blocked without it. |
| `UPSTASH_REDIS_REST_URL` | unset | HTTPS REST endpoint for the dedicated Upstash Redis database. Only an `*.upstash.io` host without credentials, query, or fragment is accepted. |
| `UPSTASH_REDIS_REST_TOKEN` | unset | Server-only Upstash write token. Never expose it to the browser, logs, health output, or evidence bundles. |
| `LIKERTS_ADMISSION_NAMESPACE` | unset | Stable environment namespace shared by every production function and rolling deployment, for example `likerts:production:v1`. |
| `LIKERTS_ADMISSION_LEASE_TTL_MS` | `120000` | Distributed concurrency-lease lifetime; bounded above the 60-second paid-function duration so a crashed invocation heals without expiring during a valid run. |
| `LIKERTS_ADMISSION_STORE_TIMEOUT_MS` | `2500` | Bounded Upstash request/readiness deadline. Remote failures fail closed and never fall back to process memory in production. |
| `LIKERTS_READINESS_TOKEN` | unset | Separate 32–4096 character server secret for active readiness. Required in production and whenever Upstash is configured; send it only in `Authorization: Bearer …`, never in a URL. |
| `MCP_RATE_LIMIT_SALT` | random per process only without shared admission | HMAC secret for non-reversible anonymous client keys. Production and every shared-store configuration require a stable 32–4096 character value. |
| `MCP_PUBLIC_SYNTHETIC_RUNS_ENABLED` | `true` | Emergency public-run switch. |
| `MCP_RUNS_PER_HOUR` | `3` | Anonymous run window; globally enforced when the shared provider is configured. |
| `MCP_RUN_MAX_CONCURRENCY` | `2` | Concurrent paid-work cap; enforced with expiring distributed leases in shared mode. |
| `MCP_RUN_PROCESS_DAILY_BUDGET` | `30` units | Legacy-named admission budget; globally enforced in shared mode, and Deep uses more units. |
| `MCP_HTTP_REQUESTS_PER_MINUTE` | `90` | MCP HTTP boundary limiter. |
| `MCP_ALLOWED_ORIGINS` | same host only | Additional comma-separated browser origins for MCP. |
| `DEEP_COHORT_CELLS` | `4` | Deep-mode cell count, clamped to 2–8 and the deployment cap. |
| `DEEP_COHORT_MAX_CELLS` | `6` | Deployment cap for Deep cells, itself clamped to 2–8. |
| `DEEP_ADMISSION_UNITS` | `3` | Weighted process-budget units for one Deep run, clamped to 2–10. |
| `LIKERTS_LOCALIZATION_RELEASE_EVIDENCE_JSON` | unset | Strict, signed localization release evidence shared by the HTTP and MCP localization scorecards; an unset value keeps both honestly pending. |

Local development uses honest in-memory fallback protection. Production paid execution requires the implemented Upstash Redis REST adapter, which makes the rate, active-lease, and weighted-budget decision in one atomic Lua script using backend time. Before any counter, prune, or lease mutation, the namespace is permanently bound to a policy fingerprint covering the database, namespace, limits and windows, lease TTL, HMAC identity, and Quick/Deep unit schedule; drift fails closed, so intentional safety-policy changes require a new namespace or an explicitly drained migration. SDK network retries are disabled so an uncertain committed write cannot be replayed and double-charged; an unavailable or malformed backend fails closed. Public liveness is metadata-only, while an active readiness probe requires the independent bearer token. Upstash persistence does not turn the limiter into an absolute financial guarantee—its replication/failover model is eventually consistent—so the Vercel AI Gateway project budget remains the hard global spend backstop. Provisioning the database, setting credentials, and passing the live readiness/contention gates remain deployment-authority work; see the [production-readiness runbook](docs/production-readiness-runbook.md).

The localization evidence variable is fail-closed and accepts only an exact-build configuration with immutable public HTTPS evidence and trusted Ed25519 reviewer/promotion keys. `npm run localization:catalog-hash` prints the catalog hash derived from the current CJK UI catalogs and registry review provenance; a supplied hash is only an assertion and must equal that derived value. Use the [localization review and release protocol](docs/localization-review-and-release.md#production-scorecard-evidence-configuration) rather than constructing the payload ad hoc.

Reported Gateway cost excludes Vercel hosting and any direct non-Gateway provider charges. Google Auto Ads can be added independently; the current CSP blocks framing and plugins without prematurely blocking future ad resources.

## Evaluation boundary

The deterministic lab covers 90 general-risk/malformed fixtures plus an 11-method × 10-locale offline contract matrix. It spans Quick/Deep, source modes, sensitive prompts, demographic intersections, follow-up intents, handoff expectations, and RTL. It checks contracts and reporting honesty—not real-world accuracy.

The public [population-data registry](public/research-standards/population-data-registry.json) currently reports `NO_CURATED_DATASETS`. A source becomes `CURATED_OFFICIAL` only through the reviewed registry path; user-provided or retrieved material cannot self-assert that status.

The localization scorecard keeps runtime support, copy provenance, native review, population evidence, and attitudinal validation separate. Simplified Chinese (`zh-CN`), Japanese (`ja-JP`), and Korean (`ko-KR`) are runtime-enabled machine drafts that still require attributed native review; ASEAN language locales remain planned and runtime-disabled. Neither language support nor demographic fit permits an attitudinal-accuracy claim.

The Validation Lab foundation adds a sealed observed-outcome commitment, a canonical blind brief, frozen dataset/frame/method/model/prompt/schema lineage, deterministic distribution and subgroup scoring, paired evidence sensitivity, and fail-closed publication of incomplete or malformed cases. Its public [benchmark manifest](public/research-standards/benchmark-manifest.json) currently reports `NO_COMPLETED_BENCHMARKS`, zero supported markets/languages/question types, and no accuracy claim. Candidate datasets remain `candidate-not-run` roadmap entries until an eligible held-out comparison completes; a candidate’s verification date is not a calibration date.

## Deployment

The repository is linked to the Vercel project serving `likerts.com`. Deployment `dpl_DjLSm1St6Lr4YBJBiwgrEmiFTq1e` was promoted on 2026-08-30 as a bounded public pilot: static product, samples, standards, health, and the localization scorecard are live, while production study, segment, and MCP execution returns `DURABLE_ADMISSION_REQUIRED` before model work because no globally durable admission store is configured. A later release still requires an authorized operator; a live pilot is not localization release approval.

```sh
npx vercel --prod --yes
```

After deployment, set `LIKERTS_DEPLOYMENT_URL` to the explicit deployment root and run `npm run localization:smoke`. A real release decision additionally requires the independently selected expected build ID and artifact digest, CI evidence ID, verified bundle digest, exact immutable attestation and promotion URLs, trusted promotion public keys, the strict browser-and-native `LIKERTS_LOCALIZATION_RELEASE_EVIDENCE_JSON` authority, and `LIKERTS_LOCALIZATION_REQUIRE_RELEASE_READY=1`; see the [production-readiness runbook](docs/production-readiness-runbook.md#post-deploy-smoke) for the complete fail-closed command. Also verify the root UI, `/studies/`, one locale-tagged study with its release status visible and its `study.json`, the two read-only sample-study MCP tools, the MCP localization-scorecard resource, `/api/localization-scorecard`, `/api/synthetic-study`, `/api/segment-perspective`, `/api/mcp`, `/llms.txt`, `/sitemap.xml`, `/research-standards/`, security headers, a Quick run, one bounded segment follow-up (including the `explore_synthetic_segment` MCP contract), and a bounded Deep run. Never put secrets, private research inputs, or non-editorial live evaluation captures in Git.
