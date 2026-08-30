# Evidence-first productization plan

Status: active
Scope: all eight remaining productization tracks
Primary boundary: synthetic research is directional model output, never observed human evidence.

## Authority boundary

The repository work may implement and verify every offline contract, adapter, fixture, UI flow, export, dry-run command, and release gate. It must not perform any of the following without separate, explicit authorization:

- deploy or change production configuration;
- create hosted databases, queues, telemetry, or shared rate-limit stores;
- enable paid live-model evaluation;
- download, commit, redistribute, or publish a real dataset before licence and methodology review;
- expose a sealed observed outcome to a synthetic runner before the run is complete;
- contact a panel provider or recruit, screen, message, or pay participants;
- claim accuracy or supported coverage from synthetic fixtures.

## Dependency graph

```text
privacy + lineage + storage contracts
            |
            +--> population registry --> population resolver --> reviewed source snapshot
            |
            +--> method-result algebra --> eight method slices
            |
            +--> local projects --> durable interviews + material retention
            |
            +--> handoff lifecycle --> local human-response import
            |
            +--> validation preregistration --> sealed runner --> public generator
            |
            +--> runtime config + observability --> CI/release gates

reviewed source + frozen human case + authorized model budget
            |
            +--> first eligible blind benchmark --> scoped public scorecard
```

## Phase 0 — Shared contracts

### Task 0.1: Privacy and retention contract

Add strict schemas for data class, persistence mode, retention status, expiry, deletion, and redaction.

Acceptance criteria:

- Classes distinguish public, user-provided, sensitive, and observed-human data.
- Unknown security-sensitive fields fail closed.
- Logs and evaluation artifacts redact credentials, direct identifiers, raw respondent text, and private source text.
- Observed-human records cannot enter generation prompts without a separately validated transformation.
- Expiry and deletion are deterministic and test-covered.

### Task 0.2: Immutable lineage envelope

Create shared versioned identifiers and hashes for project, study, run, conversation, turn, handoff, material, validation case, and release.

Acceptance criteria:

- Every persisted object has an ID, schema version, timestamps, version number, lineage hash, and parent reference where applicable.
- Stale optimistic-concurrency writes fail closed.
- Mutating frozen inputs produces a new version and invalidates dependent approval.

### Task 0.3: Storage and integration interfaces

Define adapter interfaces with in-memory/offline implementations and explicit unavailable states for hosted integrations.

Acceptance criteria:

- No provider is provisioned by default.
- Local tests cover create/read/list/append/delete/expiry and race behavior.
- Runtime output names the active persistence and protection mode without exposing secrets.

Checkpoint: focused contract tests, full test suite, clean build.

## Phase 1 — Official Population Data Registry

### Task 1.1: Registry schema and honest zero state

Add registry, dataset, release, publisher, licence, attribution, geography, population-universe, denominator, table/indicator, variable/category mapping, dates, hashes, transformations, and review-state contracts.

Acceptance criteria:

- Duplicate IDs, unsafe URLs, invalid dates, missing licence metadata, unknown categories, and invalid shares fail closed.
- Only registry-owned reviewed records can become `CURATED_OFFICIAL`.
- Empty publication says `NO_CURATED_DATASETS` and claims no coverage.

### Task 1.2: Denominator-aware resolver

Resolve an intended population to `EXACT_POPULATION_UNIVERSE`, `BROADER_CONTEXT_ONLY`, or `NO_MATCH`.

Acceptance criteria:

- Only exact-universe records become automatic IPF/raking constraints.
- Broader context remains visible but receives no unsupported fit credit.
- User-supplied records cannot overwrite registry authority, release, or hashes.

### Task 1.3: Deterministic import harness

Create a local-file adapter command that emits a reviewed release candidate and provenance receipt.

Acceptance criteria:

- It records filters, recodes, exclusions, denominators, rounding, checksums, and transformation version.
- Schema drift, unknown values, missing totals, unsafe decompression, or inconsistent shares fail closed.
- CI uses invented fixtures and makes no statistics-agency network call.

### Task 1.4: Recency and provenance presentation

Calculate source recency from pinned coverage/publication dates and expose release, licence, universe fit, transformation, and freshness in UI/API/MCP/exports.

Acceptance criteria:

- Dates are never silently refreshed.
- Stale or unreviewed releases remain visibly stale or unreviewed.
- Population Fit remains partial whenever an input component is absent.

### Task 1.5: First reviewed source pilot

Prepare a pilot adapter configuration and end-to-end path. A real snapshot is included only after a human approves the exact publisher table, licence, permitted artifact, and population universe.

Checkpoint: registry/import/resolver tests, reproducible dry run, browser provenance inspection.

## Phase 2 — Method-result architecture

### Task 2.1: Versioned result algebra

Add a discriminated `methodResult` union:

- `DIRECTIONAL_DISTRIBUTION`
- `RANKED_ITEMS`
- `ATTRIBUTE_MATRIX`
- `PRICE_LADDER`
- `INSTRUMENT_REVIEW`
- `INTERVIEW_GUIDE`

Acceptance criteria:

- The runtime-owned method template selects the allowed result schema.
- Legacy General, Concept, and Purchase outputs retain their compatible directional projection.
- Non-distribution methods never manufacture respondents, five-point panels, segments, or quotations.
- Method, template, config, prompt, and output-schema versions enter lineage and model cards.

### Task 2.2: Generic renderer and export dispatch

Build reusable renderers for distribution, ranking, matrix, ladder, issue review, and guide outputs.

Acceptance criteria:

- Every renderer has an accessible table or structured text equivalent.
- Irrelevant tabs disappear rather than showing empty synthetic sections.
- JSON/CSV/XLSX/text exports preserve stable input IDs, result kind, lineage, and limitations.

Checkpoint: the existing three methods remain compatible; one fixture per result kind parses, renders, and exports.

## Phase 3 — Eight research-method slices

Each method is exposed only after its complete config, prompt, result, critic, handoff, UI, API/MCP, export, fixture, and documentation path passes.

### Task 3.1: Message Testing

- Required: exact message, exposure context, optional intended action.
- Output: message-reaction distribution with method-owned anchors.
- Human validation: monadic comprehension/reaction test.
- Boundary: no causal persuasion or campaign-performance claim.

### Task 3.2: Claims Testing

- Required: exact claim and user-declared substantiation status.
- Output: claim-credibility distribution.
- Human validation: comprehension/credibility testing plus legal or regulatory review.
- Boundary: the model never certifies truth, legality, or substantiation.

### Task 3.3: UX Expectation Testing

- Required: task scenario, user goal, product/experience, optional device/context.
- Output: expected ease/confidence distribution.
- Human validation: moderated prototype/task testing.
- Boundary: no observed usability, completion-time, accessibility, or success-rate claim.

### Task 3.4: Feature Prioritization

- Required: 3–8 stable-ID features and ranking constraint.
- Output: every supplied item exactly once in a contiguous ordinal ranking.
- Human validation: forced rank, MaxDiff, or conjoint as appropriate.
- Boundary: no invented shares, respondent counts, or importance percentages.

### Task 3.5: Brand Positioning

- Required: focal brand, 2–5 supplied comparators, category, 3–6 supplied attributes.
- Output: anchored model-generated attribute matrix.
- Human validation: blinded brand-association tracker.
- Boundary: no invented competitor, market share, quality fact, causal position, or unsupported perceptual-map axis.

### Task 3.6: Price Sensitivity

- Required: exact offer, context, currency/unit, channel/horizon/reference alternative, and 3–8 ascending stable-ID prices.
- Output: full intent distribution at every price, with price as the only varied input.
- Human validation: randomized Gabor-Granger or choice research.
- Boundary: no elasticity, willingness-to-pay, optimization, demand, revenue, or market-sizing claim.

### Task 3.7: Survey Pretesting

- Required: objective, audience/locale, and structured survey draft.
- Output: issue list linked only to real question IDs, with severity, rationale, revision, and cognitive probe.
- Human validation: cognitive interviews and localization/accessibility review.
- Boundary: “no issues detected by the model” is not a validated survey.

### Task 3.8: Interview-Guide Generation

- Required: objective, 2–8 topic IDs, participant context, constraints, and sensitive areas.
- Output: ordered opening, neutral questions/probes, moderator/consent/accessibility notes, and closing.
- Human validation: researcher review and pilot interview.
- Boundary: a guide contains no synthetic finding, persona answer, or participant quotation.

Checkpoint: all method fixtures, MCP parity, handoff exports, keyboard/responsive/RTL tests, and forbidden-claim scans pass.

## Phase 4 — Durable qualitative projects

### Task 4.1: Local project repository

Add bounded IndexedDB-backed projects, frozen runs, conversations, turns, notes, and material indexes with a small metadata fallback.

Acceptance criteria:

- Reload, export, clear, and import preserve hashes and lineage.
- Turns are append-only; revisions preserve parents.
- Quota/eviction is visible and deterministic.
- Delete project removes all child local data.
- UI states plainly that browser storage is not encrypted account storage.

### Task 4.2: Server conversation-store interface

Add an in-memory tested adapter and integration-ready durable interface.

Acceptance criteria:

- Append requires expected index and parent turn.
- Tampered, stale, expired, or deleted histories return controlled errors.
- Default hosted behavior stays stateless unless a reviewed adapter is configured.

### Task 4.3: Notes and bounded synthesis

Separate researcher annotations, model perspectives, and observed-human material.

Acceptance criteria:

- Every model response keeps exactly `Model-generated perspective—not a participant quotation.`
- Synthesis resolves source turn/evidence IDs and preserves unsupported characteristics.
- Exports cannot relabel synthetic text as a participant quote or observed finding.

Checkpoint: persistence/reload/import/delete browser journey and concurrency/tamper tests.

## Phase 5 — Production research grounding

### Task 5.1: Safe document extraction

Support bounded PDF, DOCX, and XLSX extraction without executing formulas, macros, links, scripts, or embedded objects.

Acceptance criteria:

- MIME/extension, byte, page, sheet, row, cell, text, decompression, and time limits are explicit.
- PDF pages, DOCX paragraphs, and XLSX sheet/cell coordinates survive as locators.
- Encrypted, malformed, macro-bearing, oversized, and decompression-bomb fixtures fail safely.
- Raw files never enter prompt payloads or logs.

### Task 5.2: Deterministic retrieval index

Add normalized chunks, exact/near deduplication, stable scoring/tie-breaking, and strict top-k/context budgets.

Acceptance criteria:

- Chunks retain material ID, locator, language, character range, and hash.
- Source content is isolated as untrusted data, never instructions.
- Retrieval is byte-identical across repeated runs for the same inputs.

### Task 5.3: Claim-level evidence ledger

Require generated claims to resolve to evidence chunks or be downgraded to explicit inference/assumption.

Acceptance criteria:

- Evidence classes distinguish uploaded, retrieved, inference, assumption, and observed-human data.
- URL presence or client hash never creates `VERIFIED` status.
- UI and exports distinguish grounding from validation.

### Task 5.4: Material retention and deletion

Removing a material or project deletes local excerpts/indexes; server adapters expose expiry/deletion; exports contain hashes/locators rather than raw files by default.

Checkpoint: adversarial fixture corpus, browser upload/review/remove flow, no raw-content leakage.

## Phase 6 — Human-research operations

### Task 6.1: Frozen package lifecycle

Implement `DRAFT → RESEARCHER_REVIEW → APPROVED_FOR_FIELDING → FIELDING → CLOSED → ANALYZED`.

Acceptance criteria:

- Approval is impossible while translation, consent/privacy, stimulus, questionnaire, denominator, or analysis blockers remain.
- Post-approval edits create a new version and invalidate approval.
- Package hashes cover questionnaire, screener, quota, recruitment, analysis, and source lineage.

### Task 6.2: Local observed-response import

Import matching CSV/JSON locally and apply preregistered consent, eligibility, duplicate, speeding, straight-line, missingness, and exclusion rules.

Acceptance criteria:

- Direct identifiers are rejected or explicitly redacted.
- Raw responses remain local by default and never enter model prompts.
- Output contains aggregate distributions, bases, exclusions, and quality diagnostics.
- Synthetic and human namespaces stay separate until formal comparison.

### Task 6.3: Provider adapter boundary

Model feasibility, quote, screener mapping, field status, completes, and result export as dry-run interfaces.

Acceptance criteria:

- Default status remains `LINK_ONLY_NOT_INTEGRATED` or `DRY_RUN`.
- No credentials, webhooks, payment, contact, or recruitment are added.
- Monitor targets cannot become quotas without denominator and collection-field review.

Checkpoint: lifecycle/tamper/import/denominator tests and independently opened export package.

## Phase 7 — Validation Lab execution system

### Task 7.1: Complete preregistration contract

Bind scorer/metric version, thresholds, scale direction/mapping, wording/translation/population match, dataset hash, bases, exclusions, weights, subgroup definitions, and publication fields before reveal.

### Task 7.2: Two-artifact sealing command

Emit a public preregistration plus salted commitment and a private ignored reveal bundle. Reject weak/reused nonces and public reveal paths.

### Task 7.3: Deterministic human-outcome extractor

Extract configured questions, codes, filters, weights, groups, and dates from local files; never infer mappings with an LLM.

### Task 7.4: Blind execution planner and assembler

Generate question × repeat × subgroup × evidence-variant plans, caps, and estimated calls/cost without revealing outcomes; assemble every success/failure with full lineage.

### Task 7.5: Public artifact generator

Build scorecards from immutable public case artifacts, show every completed/failed/invalid/not-assessed case, suppress underpowered aggregates, and generate byte-identical output.

### Task 7.6: First real case

After dataset/licence/language/methodology approval, register at least three compatible questions and one defensible subgroup contrast before any paid synthetic execution.

### Task 7.7: Authorized blind run and reveal

Only with an explicit run and cost cap: execute the frozen plan, preserve failures, verify commitment, score, review, and publish regardless of outcome.

Checkpoint: all fixture-based sealing/extraction/planning/assembly/publication tests pass; public state remains `NO_COMPLETED_BENCHMARKS` until Tasks 7.6–7.7 genuinely complete.

Offline implementation note (fixture-only, 2026-08-29): Tasks 7.2–7.5 have deterministic local contracts and focused tests in `scripts/validation-lab-offline.js` and `test/validation-lab-execution.test.js`. They seal separate public/private artifacts, extract only explicitly configured CSV/JSON mappings, plan and assemble blind capped matrices with complete lineage, and generate content-addressed scorecard bytes with underpowered aggregate suppression. These contracts make no model or network call and do not publish an artifact.

Authority gates: Task 7.6 still requires dataset/licence/language/methodology approval for real human data. Task 7.7 still requires an independent explicit authorization for the frozen blind run and its cost cap, followed by reveal, review, and publication regardless of outcome. The public benchmark state must remain `NO_COMPLETED_BENCHMARKS` until both gates are genuinely completed.

## Phase 8 — Evaluation and production readiness

### Task 8.1: Offline evaluation matrix

Cover every method/result kind, supported locale, RTL, source mode, sensitive prompt, malformed input, follow-up intent, handoff, and forbidden claim without network or paid calls.

### Task 8.2: Disabled-by-default live harness

Require explicit enablement and hard run, cost, duration, and output caps. Redact sensitive inputs and capture complete version/route/cost/latency lineage for offline replay.

### Task 8.3: Drift and release gates

Version human editorial rubrics and detect contract, quality, cost, latency, fallback, and model-route changes. Never store prompt/source/respondent text in telemetry by default.

### Task 8.4: Runtime configuration and shared admission

Validate bounded production configuration, expose an emergency execution switch, add an atomic shared-store adapter contract, and label in-memory mode degraded rather than globally durable.

### Task 8.5: Health, observability, security, and privacy

Add non-sensitive health/readiness output, correlation IDs, redacted event schemas, fail-closed origin/body/file handling, SSRF and injection tests, dependency review, and retention/deletion documentation.

### Task 8.6: CI, migration, rollback, and release runbooks

CI runs unit/contract/build/static/browser/security checks without paid calls or deployment. Document migrations, rollback, manual deploy authorization, and post-deploy smoke coverage.

## Final verification

- full automated suite and clean production build;
- deterministic generated artifacts and `git diff --check`;
- desktop, mobile, narrow tablet, and RTL browser QA with no console errors or horizontal overflow;
- keyboard and accessible-table coverage for every method result kind;
- PDF/DOCX/XLSX adversarial extraction fixtures;
- CSV/JSON/XLSX export round trips and independent workbook/document inspection;
- API/MCP parity and explicit external-integration states;
- security, concurrency, expiry, deletion, prompt-injection, SSRF, and failure-path tests;
- mixed-model P0/P1 review with all blockers resolved or explicitly authority-gated;
- no unsupported accuracy, participant, confidence-interval, incidence, demand, revenue, or representativeness claims;
- user-owned unrelated files remain untouched.
