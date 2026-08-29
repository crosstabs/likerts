# Likerts

Likerts is a free, no-account synthetic market-research product. It turns a research brief into a directional five-point distribution, segment hypotheses, synthetic verbatims, an evidence ledger, and a reproducibility receipt. It does **not** recruit people or claim population representativeness.

Production: [likerts.com](https://likerts.com)<br>
Agent endpoint: [likerts.com/api/mcp](https://likerts.com/api/mcp)<br>
Public research contract: [likerts.com/research-standards/](https://likerts.com/research-standards/)

## Runtime

- **Quick** runs framing, one aggregate synthetic panel stage, and a separate pipeline critic. AUTO evidence can add two bounded Exa searches through Vercel AI Gateway.
- **Deep** defaults to four independently generated model cells, aggregates them deterministically, reports Jensen–Shannon divergence and maximum percentage-point spread, and then runs the pipeline critic. The cell count is bounded from 2–8.
- Every returned stage records its requested route, fallbacks, resolved model when reported, version identifiers, usage, timestamps, and exact Gateway cost when Vercel returns it.
- Input and evidence hashes support auditable comparison. Model output remains non-deterministic and is never described as human-panel evidence.

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

## Operational controls

| Variable | Default | Purpose |
| --- | ---: | --- |
| `MCP_RATE_LIMIT_SALT` | random per process | Stable, non-reversible anonymous client key. Set a sensitive production value. |
| `MCP_PUBLIC_SYNTHETIC_RUNS_ENABLED` | `true` | Emergency public-run switch. |
| `MCP_RUNS_PER_HOUR` | `3` | Process-local anonymous run window. |
| `MCP_RUN_MAX_CONCURRENCY` | `2` | Process-local concurrent study cap. |
| `MCP_RUN_PROCESS_DAILY_BUDGET` | `30` units | Process-local daily admission budget; Deep uses more units. |
| `MCP_HTTP_REQUESTS_PER_MINUTE` | `90` | MCP HTTP boundary limiter. |
| `MCP_ALLOWED_ORIGINS` | same host only | Additional comma-separated browser origins for MCP. |
| `DEEP_COHORT_CELLS` | `4` | Deep-mode cell count, clamped to 2–8 and the deployment cap. |
| `DEEP_COHORT_MAX_CELLS` | `6` | Deployment cap for Deep cells, itself clamped to 2–8. |
| `DEEP_ADMISSION_UNITS` | `3` | Weighted process-budget units for one Deep run, clamped to 2–10. |

The in-memory admission controls are honest fallback protection, not a globally durable distributed limiter. The production Vercel AI Gateway project budget is the global spend backstop and should be verified before every launch. A durable adapter can be supplied to `createAnonymousStudyAdmission` when a shared store is introduced.

Reported Gateway cost excludes Vercel hosting and any direct non-Gateway provider charges. Google Auto Ads can be added independently; the current CSP blocks framing and plugins without prematurely blocking future ad resources.

## Evaluation boundary

The deterministic lab currently covers 90 briefs across 10 locales, Quick/Deep, source modes, ordinary question types, sensitive prompts, malformed inputs, demographic intersections, and RTL. It checks contracts and reporting honesty—not real-world accuracy. Candidate public human-survey datasets and the preregistration rules for future calibration are published in the [benchmark manifest](public/research-standards/benchmark-manifest.json); every candidate is explicitly marked `candidate-not-run` until a valid comparison is completed.

## Deployment

The repository is linked to the Vercel project serving `likerts.com`.

```sh
npx vercel --prod --yes
```

After deployment, verify the root UI, `/api/synthetic-study`, `/api/mcp`, `/llms.txt`, `/sitemap.xml`, `/research-standards/`, security headers, a Quick run, and a bounded Deep run. Never put secrets or live evaluation captures in Git.
