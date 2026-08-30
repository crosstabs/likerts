# Localization Production Goal

## Objective

Make Likerts' localization experience production-ready and defensible across Simplified Chinese (`zh-CN`), Japanese (`ja-JP`), Korean (`ko-KR`), and a market-by-market ASEAN rollout. A locale may be described as launch-ready only after its technical, copy, native-review, evidence, accessibility, and browser gates are independently satisfied.

Language or demographic fit must never be presented as proof of attitudinal accuracy.

## Product principles

1. Localization is a capability contract, not a list of dropdown values.
2. Interface, report, source, retrieval, respondent-instrument, and market settings are separate dimensions.
3. Unknown or unsupported locale/market combinations fail closed; they never silently become English, Global, or United States research.
4. Machine-drafted copy is visibly distinct from native-reviewed copy.
5. Original user text, evidence excerpts, model identifiers, hashes, URLs, stable IDs, and schema enums retain their source form.
6. Population-source coverage and attitudinal validation are separate from language support.

## Release states

Each locale and market cell records five independent states:

- `TECHNICAL`: canonical locale, direction, script policy, formatting, market mapping, and retrieval geography work.
- `MACHINE_DRAFTED`: all product copy is present and automated key, placeholder, script, layout, and interaction checks pass.
- `NATIVE_REVIEWED`: a named native reviewer, review date, glossary version, scope, and resolved findings are recorded.
- `POPULATION_READY`: reviewed official sources match a declared universe and coverage date; otherwise Population Fit stays `UNMEASURED` or `PARTIAL`.
- `ATTITUDINALLY_VALIDATED`: an exact held-out human comparison exists for the same market, language, population, method, wording, scale, and field dates.

Only `NATIVE_REVIEWED` cells may be called localized or launch-ready. No cell may claim attitudinal accuracy without the final state.

## Target matrix

### CJK launch track

- Simplified Chinese: `zh-CN`
- Japanese: `ja-JP`
- Korean: `ko-KR`

### ASEAN technical and review track

- Brunei: `BN`; planned `ms-BN`
- Cambodia: `KH`; planned `km-KH`
- Indonesia: `ID`; first locale `id-ID`
- Laos: `LA`; planned `lo-LA`
- Malaysia: `MY`; first locales `ms-MY` and `en-MY`
- Myanmar: `MM`; planned `my-MM`
- Philippines: `PH`; separate `fil-PH` and `en-PH`
- Singapore: `SG`; first locale `en-SG`, later `ms-SG`, `zh-Hans-SG`, and `ta-SG`
- Thailand: `TH`; first locale `th-TH`
- Vietnam: `VN`; first locale `vi-VN`

Planned locales remain runtime-disabled until their individual gates pass. “ASEAN” is never treated as a locale.

## Delivery plan

### 1. Canonical localization registry

Create one dependency-free, versioned registry for locale and market capabilities. It owns canonical BCP-47 IDs, aliases, labels, direction, script policy, market IDs, retrieval geography, and per-capability release states.

Acceptance:

- Every ID is unique, canonical, deeply frozen, and versioned.
- Global has no implicit country and never routes to the United States.
- Unknown markets/locales and planned capabilities throw typed errors.
- CJK and all ten ASEAN markets have explicit records without overstating support.

### 2. Request contract and migration

Introduce a canonical study localization object with market, report, source, retrieval, and instrument dimensions. Dual-read legacy `market`, `outputLocale`, and `sourceLanguages` during migration; reject conflicting old/new values.

Acceptance:

- Unsupported combinations fail before model or network calls.
- Unknown markets never resolve to the first market entry.
- Canonical hashing is alias-independent and versioned; legacy hashes remain traceable.
- API and MCP contracts expose the same resolved receipt.

### 3. Fail-closed UI catalog

Derive selectors from capability status and replace silent English/raw-key fallback with a complete catalog contract.

Acceptance:

- Every enabled UI locale has exactly the required key and placeholder set.
- CJK flows contain no unintended English product copy.
- Browser-locale normalization is explicit and tested.
- Original-language content remains labelled rather than translated implicitly.

### 4. Localized study authoring

Localize first-run, global chrome, readiness, errors, research materials, and all ten research methods.

Acceptance:

- Every method has localized titles, descriptions, inputs, help, validation, scale anchors, and item actions.
- Interface-language changes use safe report/source defaults with a visible override and mismatch guidance.
- Market names and control names are locale-aware and keyboard accessible.

### 5. Localized results and qualitative exploration

Localize results, Evidence Ledger, Population Frame, Model Card, stability, research-design metadata, modeled segments, follow-up interviews, exports, and human-validation handoff.

Acceptance:

- Canonical enums remain stable in data while presentation values are localized.
- Evidence excerpts and source titles retain source-language metadata.
- Every synthetic perspective remains labelled as model-generated, never a participant quotation.
- Handoff copy cannot be fielded until its translation-review blocker is resolved.

### 6. Formatting, typography, and accessibility

Add locale-aware dates, numbers, currencies, percentages, pluralization, CJK font stacks, punctuation rules, Korean word grouping, safe technical-token wrapping, localized accessible names, and responsive reflow.

Acceptance:

- No page-level overflow at 320, 375, 768, or 1440 pixels.
- Korean prose does not split into orphan syllables.
- Machine exports retain canonical ISO timestamps and numeric values.
- Keyboard, focus, announcements, chart labels, language metadata, and semantic tables are verified.

### 7. ASEAN capability expansion

Add market mappings and planned locales without presenting them as released. Add Thai and other required script policies, explicit source-language preferences, and correct provider geography.

Acceptance:

- Singapore routes to SG geography at runtime. Indonesia, Malaysia, Thailand, Vietnam, and the Philippines retain explicit planned ISO-geography records but remain runtime-rejected until their market gates are enabled.
- Planned and roadmap markets/locales are verified through registry/API fail-closed tests, not represented as selectable product support.
- Global sends no country bias.
- Retrieval-language preference is recorded as a preference, not proof of language correctness or source truth.
- Unsupported respondent instruments emit no disguised English questionnaire.

### 8. Population and validation integrity

Track official-source candidates separately from reviewed registry records, and preserve the Validation Lab zero state until eligible held-out comparisons complete.

Acceptance:

- No population shares are invented or marked curated without provenance and review.
- Conditional audiences remain broader-context-only unless the official source universe exactly matches.
- Validation results never generalize across markets, locales, populations, methods, or question types.

### 9. Samples, persistence, and lineage

Make sample studies, static generation, saved projects, prefill, exports, and evaluation fixtures consume the canonical registry and localization receipt.

Acceptance:

- Samples cannot use planned capabilities.
- Multiple studies per locale are allowed; coverage is a separate assertion.
- Legacy records remain viewable without inventing missing locale data and are blocked from rerun when unresolved.
- Static pages expose separate automated-QA and native-review states.

### 10. Release verification

Add missing-key, forbidden-fallback, placeholder-parity, script, formatting, contract, migration, responsive, keyboard, browser, visual, and content-verification gates.

Acceptance:

- Full tests and production build pass.
- Browser suites exercise CJK and every enabled ASEAN cell across authoring, results, evidence, population, stability, interviews, and handoff.
- A public per-locale scorecard lists supported and unsupported flows, reviewer evidence, calibration date, and known limitations.

## Checkpoints

- Foundation: registry, request adapter, migration, and fail-closed tests pass.
- CJK machine-drafted: complete catalog, full flows, formatting, typography, and browser checks pass.
- CJK native-reviewed: reviewers approve each locale independently and findings are resolved.
- ASEAN technical: market/retrieval/script contracts pass while planned locales remain disabled.
- ASEAN native-reviewed: locales are enabled individually after their review and browser gates pass.
- Final: tests, build, static verification, browser verification, and launch scorecard pass without unsupported accuracy claims.

## Model orchestration

- Architecture lead: frontier model at ultra reasoning for registry, compatibility, lineage, and dependency design.
- CJK UX lead: balanced frontier model at extra-high reasoning for copy coverage, terminology, accessibility, typography, and browser gates.
- ASEAN/backend lead: fast model at high reasoning for market matrix, script policy, retrieval geography, population boundaries, and handoff lifecycle.
- Primary integrator: resolves contracts, reviews every diff, runs checkpoint verification, and owns final release claims.

## Baseline

Before localization implementation, the repository passes all 287 tests. The worktree already contains user-owned changes; implementation must preserve them and avoid unrelated cleanup.

## Technical checkpoint — 2026-08-30

Status: historical checkpoint, superseded by subsequent source changes. The
results below describe the build that was tested at that point; its identifiers
must not be used to approve or describe the current worktree.

The machine-drafted technical checkpoint is green:

- 557/557 repository tests pass.
- The static production check passes across 336 files, and the security check passes.
- All 10 published sample-study captures pass content verification.
- A clean Vite production build succeeds in an isolated temporary output directory.
- The complete 12-cell browser matrix passes full localized product journeys for `zh-CN`, `ja-JP`, and `ko-KR` at 320, 375, 768, and 1440 CSS pixels, with zero page overflow and zero browser, console, network, or resource errors. Every cell verifies document language, first-run and composer flows, localization metadata and controls, keyboard focus, source-language disclosure, results, Population Frames and Model Cards, stability, qualitative exploration, evidence, exports, and human handoff. The more expensive ten-method and exact static-sample lineage journeys run once per CJK locale at `zh-CN`/320, `ja-JP`/375, and `ko-KR`/768.
- All ten specialized research methods are browser-covered in one deep journey per CJK locale, including localized authoring, all six method-result shapes, method-specific instrument drafts, human-handoff exports, and canonical method receipts. The gate uses only bounded in-process fixtures and records no observed-human, participant-panel, live-backend, or live-model activity.
- Every CJK public sample now has an exact static-detail-to-composer journey. The gate checks its registry identity and review state, confirms that the CTA opens an editable `GENERAL_LIKERT` brief without auto-running or inheriting stale method fields, preserves canonical sample lineage through the request, run, metadata, reproducibility record, local persistence, evidence pack, and qualitative project, and restores the exact report after a queryless reload without an extra API call.
- Human-research handoff now distinguishes nominal survey references, researcher-designed quantitative samples, cognitive-pretest rounds, and qualitative stopping rules; population references, actual quotas, and purposive coverage remain separate in UI and exports.
- Human-research lifecycle approval fails closed on inferred blockers, requires attributed and evidence-backed resolution, hashes quota/sample/incidence plans together, rejects unknown edits, and reopens resolved blockers after material package edits.
- CSV, XLSX, TXT, and JSON handoff exports preserve complete versioned question and stimulus records plus package-part integrity hashes; unknown result and recruitment contracts now render a controlled error instead of plausible synthetic defaults.
- CJK respondent-instrument validation uses exact locale admission and field-aware script checks: unsupported variants, English slogans, and arbitrary English UX metadata block with an empty questionnaire instead of borrowing a nearby template or treating prose as a technical token.
- CJK reviewer packets, glossary terms, and the evidence checklist are frozen in [`docs/localization-review-kit`](./localization-review-kit/); reviewer identity, date, findings, and approval fields intentionally remain empty.
- Native-review intake now validates a locale-scoped Ed25519 signature, an exact completed-packet schema, release-candidate bindings, completion and findings projections, and every cited packet evidence record. Missing packet bytes yield a declarations-only receipt, while validated receipts include their clock policy and expiry; intake never mutates the registry or makes a release decision.
- ASEAN reviewer packets and glossary scaffolds are frozen in [`docs/localization-review-kit`](./localization-review-kit/). The 15-locale packet includes planned Malaysian English (`en-MY`), and reviewer/evidence fields intentionally remain empty. Singapore is explicitly documented as `MARKET_ROUTING_ONLY`: it may set Singapore retrieval/population geography, but `en-SG`, `ms-SG`, `zh-Hans-SG`, and `ta-SG` remain planned and non-runnable.
- The capability registry is deliberately versioned as `localization-capabilities-v2`; each non-global market declares a three-letter currency code, and market support is derived from fully enabled locale capabilities so partially enabled records cannot hide a routing-only warning.
- The composer now shows a persistent market-routing-only notice for Singapore, including the current report/instrument languages, planned Singapore language variants, and an opt-in `SGD` correction for priced methods. Currency is never changed automatically.
- The composer now exposes interface/report/instrument mismatches outside optional settings, names all three active languages, preserves research inputs without automatic translation, and offers separate review and explicit alignment actions. Keyboard focus moves to the report-language control after either action, and the card reflows without horizontal overflow at 320 CSS pixels.
- CJK writing-system validation now runs per generated field across framing, all six result shapes, and adjudication. One localized field can no longer mask a separate English-only generated field; bounded failure receipts record field paths and unexpected script names without retaining generated text.
- Browser verification now emits a canonical SHA-256 attestation bound to the exact build artifact, suite, registry, locale/viewport matrix, zero-error assertions, and all nine declared flows. It recursively hashes every manifest-declared regular build file, fetches each file byte-for-byte from the tested origin before and after the matrix, binds Chromium's static-response bodies to that manifest, rejects unmanifested same-origin assets, rejects attestation output inside the build even after an ancestor-symlink swap, and requires a published URL to end exactly `/<artifact-hash>/attestation.json`. Tampered, stale, partial, filtered, wrong-build, mutable-publication, or self-mutating evidence fails closed.
- The superseded checkpoint evidence used build `local-cjk-20260830-2af061cd`, artifact digest `sha256:2af061cd1f172ac68e06658926843099366edc3f5021dfe3c8a49fa5a1e8d9e4`, evidence ID `sha256:a4db28b11b9ac8a2042e035dffe85ca42cfb9a103efe62433251b2a15c3783da`, and CI bundle digest `sha256:beee2098d5e5e4b39e3134132d17c88a054a5701822ff80905b167f8eb1fc011`. It recorded 12/12 matrix cells, all 27 locale-flow evidence entries, three ten-method coverage records, and three exact static-sample coverage records for those exact historical bytes only. Source changes after that run invalidate all four identifiers for current release use.
- A signed-promotion rehearsal validates the only allowed CI-to-published transformation without uploading it. Promotion validation snapshots signed JSON exactly once, and deployment smoke requires independent exact URLs and build/bundle identities, rejects unsafe and IANA special-use DNS results and redirects, bounds time and bytes, cancels stalled resolver/response lifecycles, and reconstructs the canonical scorecard before accepting it. Release-required HTTPS fetches pin evidence and deployed-artifact connections to the prechecked public addresses while preserving the hostname for TLS, Host, and SNI; a custom diagnostic fetch that cannot establish that transport reports `connectionPinned: false`, and release-required mode fails closed rather than overclaiming pinning.
- Generated CJK sample pages now localize market, industry, stability, perspective-disclosure, critic-status, and metadata presentation. Critic-flagged takeaways fail closed into a localized review boundary while the labeled critic evidence and canonical record remain available. Semantic tables and CJK question copy reflow without horizontal overflow at 320 CSS pixels.

This is not a launch approval. The validator-confirmed historical `CI_ARTIFACT`
above is superseded; a newer current-source local `CI_ARTIFACT` is recorded below,
but neither artifact is public or release-authorizing. The public automated-journey
attestation remains `NOT_PUBLISHED`. The CJK catalogs remain `machine-drafted` and
`review-pending`; no native reviewer evidence or eligible held-out attitudinal
calibration has been recorded. ASEAN market and retrieval geography records are
implemented, while ASEAN interface, report, and instrument locales remain
planned and runtime-disabled. A bounded public pilot is now deployed, but it is
not a localization release and model-backed execution remains fail-closed.

## Current source verification — 2026-08-30

This checkpoint describes the current worktree and its bounded public-pilot
deployment after the release-evidence hardening that superseded the historical
browser attestation above. It is not a launch approval:

- All 752 repository tests pass with zero failures, skips, cancellations, or TODOs. Focused presentation coverage also proves generic CJK language-name rendering, fail-closed malformed dates, localized qualitative-project envelopes, market and lineage tamper rejection, localized human-readable quota values without rewriting technical export fields, and fail-closed optional analytics policy and URL-data minimization.
- The focused browser-promotion, runtime evidence-provider, CJK and ASEAN native-review adapter, deployment-smoke CLI, scorecard, localization-request, synthetic-pipeline, segment-perspective, API, and MCP suites pass after adversarial boundary testing. Smoke explicitly rejects a native packet bound to the right build but the wrong immutable attestation URL, and independently rejects ASEAN evidence relabelled as the CJK review program.
- The static production check passes across 368 files, the security check passes, the production dependency audit reports zero vulnerabilities, the changed operational/browser scripts pass syntax validation, and `git diff --check` is clean.
- All 10 frozen sample-study captures pass deterministic content verification. Their warnings and critic states remain visible; this check is not a live model run or new human evidence.
- The production population-registry, sample-library, and 4,687-module Vite build completes successfully. The chunk-size warning remains non-blocking technical debt. The generated study-library hub and detail page pass 12 browser checks at 320, 375, 768, and 1440 CSS pixels, including RTL containment, semantic primary actions, chart labels, visible evidence-boundary disclosures, and zero overflow, console, page, or failed-response errors.
- The current v9 browser attestation is `localization-browser-attestation-v5` / `localized-full-journey-browser-gate-v5`. It passed the complete 12-cell `zh-CN`/`ja-JP`/`ko-KR` × 320/375/768/1440 matrix and recorded 27 locale-flow entries, three ten-method records, three exact static-sample lineage records, 70 manifest-bound build files, and zero network/runtime failures. Every matrix cell binds zero-violation axe 4.13.0 WCAG 2.1 A/AA receipts for the eight canonical surfaces: first run, study authoring, results overview, stability, evidence ledger, Population Frame, qualitative exploration, and research design/human handoff. One designated cell per locale additionally binds required-source error, ten specialized-method result and handoff snapshots, static-sample detail, and restored-sample project. The attestation contains 165 named-surface snapshots and zero automated accessibility violations. It also verifies the skip link, report-tab arrow/Home/End focus behavior, handoff disclosure keyboard activation, JSON handoff download, and static-sample CTA. This automated evidence does not establish screen-reader, native-font, manual keyboard, or manual zoom conformance.
- The v9 release-candidate identifiers are build `local-cjk-v9-20260830-a11y-surfaces`, catalog hash `sha256:e0548d72479b6fedf145da4573101d71e6939fd04a5c617b6e912f5d9032e596`, artifact digest `sha256:d5670c26393b0ac109ba3515391414eb6a5965630758b0aad0b17ca84cfb7660`, evidence ID `sha256:4229f77f2a1721cc842b378f071751ee4d21f7b42974ba215a9b065148ba0a64`, and verified 72-file bundle digest `sha256:0ed56ad49ee564a692c8dda8d07786d7613e1a9d3efb1fdef00a58d46aa6ab8f`. The bundle remains a local `CI_ARTIFACT` at `/private/tmp/likerts-cjk-v9.uAABLC/evidence-bundle`; it is not published evidence or a launch authorization.
- Vercel deployment `dpl_DjLSm1St6Lr4YBJBiwgrEmiFTq1e` (`likerts-dfr42pw7a-crosstabs.vercel.app`) was promoted to `likerts.com`, `www.likerts.com`, `likerts.vercel.app`, and `likerts-crosstabs.vercel.app` on 2026-08-30. The deployed `index.html`, primary JavaScript, and CSS hashes exactly match the locally built files. The live domain passed the complete 12-cell CJK journey matrix with all 165 named accessibility snapshots at zero violations, plus all 12 static-library browser checks with zero overflow, console, page, or failed-response errors. Non-release deployment smoke returned `contractStatus: PASSED` and `releaseReady: false`; its blockers are unpublished automated evidence and incomplete native review for all three CJK locales. This is deployed-product evidence, not a published signed localization attestation.
- The user-owned Vercel Analytics integration is preserved but now fails closed. It mounts only in a production build whose public policy value is exactly `VITE_LIKERTS_VERCEL_ANALYTICS=release-approved`; it is disabled for development, missing values, and lookalikes such as `true` or `1`, and CI explicitly pins the attested profile to `disabled`. If later enabled, malformed or cross-origin events are dropped and URL queries/fragments are removed. Official package behavior confirms that the component otherwise injects an unversioned runtime script without SRI; therefore browser-attested releases must leave it disabled until telemetry/legal/privacy approval and a separately defensible executable-runtime integrity contract exist. The v9 artifact leaves it disabled and proves no analytics or other external runtime request occurred.
- The fresh in-app Product Design audit confirms healthy `zh-CN`, `ja-JP`, and `ko-KR` first-run/composer interaction; corrected Japanese heading balance; a readable full Chinese locale label at 320 pixels; zero page overflow; visible keyboard focus; live mismatch/alignment status; and an explicit Singapore market-routing-only notice listing the four planned Singapore locales. The audited tabs recorded zero console warnings or errors. Those screenshots are local UX evidence, not native-speaker approval, live-backend evidence, or an automated release attestation.
- Localization execution now validates the complete normalized receipt against the current registry. Unknown, forged, planned, wrong-country, unregistered-location, stale-registry, and legacy-custom receipts fail before study hashing, evidence queries, retrieval, admission, model generation, or segment follow-ups. Retrieval locations are bounded by each market record; legacy custom records remain viewable and explicitly rerun-blocked, while explicitly registered subregions such as Japan/Tokyo retain their retrieval location.
- A required retrieval language now requires both matching provider-declared primary-language metadata and a passing registered-script plausibility check on the excerpt. If qualifying evidence is unavailable, the request returns `REQUIRED_SOURCE_LANGUAGE_UNAVAILABLE` before framing/model generation, with zero model calls. The UI and API explicitly describe this as metadata-plus-script corroboration, not language identification; adversarial tests record that English text labelled Spanish and Han-only Chinese text labelled Japanese can pass the same-script check. It is not proof of language or source truth.
- Native-review release evidence now has a bounded, strict, signed adapter. It rejects non-global DNS results, pins HTTPS connections to the prechecked public addresses while preserving TLS/Host/SNI identity, cancels invalid response bodies, disallows stale shared caching, and binds the signed build ID plus exact `browserGateEvidenceReference` to the validated immutable published attestation. Deployment smoke independently revalidates the same packet and fails closed on any browser-binding mismatch even while registry metadata remains pending.
- Native-review intake now has distinct `cjk-native-review` and `asean-native-review` contracts. The explicitly selected program survives the trusted provider, scorecard service, REST/MCP projection, smoke CLI, and deployment-smoke validation; omitted legacy configuration remains CJK-only, program-scoped keys cannot be reused across programs, and relabelled evidence fails closed. The ASEAN reviewer kit now includes a versioned completed-packet schema and null evidence-envelope template. This makes future accountable review admissible; it does not supply translations or change any ASEAN locale from planned/unsupported.
- Browser promotion now stages and verifies the exact portable artifact manifest beside the attestation and promotion record. Release-required smoke verifies that manifest, every bounded deployed file, the root alias, independent CI/build identities, and pinned evidence and deployment connections. The shipped CLI strictly parses `LIKERTS_LOCALIZATION_RELEASE_EVIDENCE_JSON` before smoke and derives an independent zero-argument native-review loader; malformed present authority fails before any smoke request.
- The production HTTP and MCP scorecards now share the strict server-side `LIKERTS_LOCALIZATION_RELEASE_EVIDENCE_JSON` provider and composer. Absent configuration stays pending; present invalid or unavailable evidence returns a sanitized non-cacheable HTTP 503 or a sanitized MCP JSON-RPC error with `LOCALIZATION_RELEASE_EVIDENCE_UNAVAILABLE`. Neither path accepts request-derived evidence authority. Release-required deployment smoke also reads the public MCP resource and requires its complete scorecard projection to match HTTP after removing only the transport correlation ID.
- `npm run localization:catalog-hash` now derives a canonical SHA-256 binding over the exact effective CJK UI messages plus registry version, locale metadata, capability states, and review provenance. Browser attestation v5 content-addresses that value together with exact named accessibility surface receipts; promotion, native intake, runtime evidence configuration, and scorecard composition reject stale or operator-invented bindings. This does not turn automated checks into native review or assistive-technology evidence.
- Static sample lineage v2 now labels its native-review state as `registry-declared` and always sets `releaseEligible: false`; the scorecard v4 projection remains `evidence-qualified` and separately reports automated named-surface scans versus still-missing manual assistive-technology evidence. Release-required smoke rejects a static badge whose declared status differs from the server scorecard's sample-capability status.
- Completed native-review packets now use `cjk-completed-review-packet-v1.1.0` and require a SHA-256 `contentDigest` on every cited evidence record. The exact packet bytes and reviewer signature bind those declared digests. Intake still does not fetch referenced captures, so separate evidence storage or handoff must verify each cited file against its declared digest.
- Human-research handoff now renders every authored stimulus, separates localized blocker explanations from canonical technical IDs, and formats purchase and price-ladder amounts from structured currency data. Human-readable TXT/XLSX presentation uses localized enum, boolean, quota-share, and count labels while canonical CSV/JSON and explicitly labelled technical fields preserve exact IDs, numeric values, records, codes, and lineage without prose substitution. Population and Evidence views localize language names and fail malformed dates closed. Qualitative-project downloads add exact CJK presentation copy, localized market display, the canonical localization receipt, evidence/population hashes, and run/sample lineage around an unchanged, round-trippable canonical package; relabelled or inconsistent envelopes are rejected.
- Production admission source now has one concrete Upstash Redis REST adapter shared by study REST, segment REST, MCP, and health. Atomic acquire uses backend time and permanent namespace policy binding; mixed limits, windows, lease TTLs, database identities, HMAC identities, or Quick/Deep unit schedules fail before counter or lease mutation. Active readiness is bearer-authorized, 100 unauthenticated attempts are regression-tested to make zero backend calls, and authorized readiness exposes only sanitized fleet-parity fingerprints. The deployed pilot has the required independent readiness secret and stable rate-limit salt, so static runtime configuration passes, but it has no Upstash database or credentials. Public health therefore reports `BLOCKED`, and study/MCP execution returns `DURABLE_ADMISSION_REQUIRED` with HTTP 503 before model work. No cross-process live gate or production monitor has been provisioned.

The coordinated implementation and review used a deliberate model mix: frontier
ultra-reasoning agents for the eight-requirement completion matrix, MCP/HTTP
scorecard parity, and adversarial execution-boundary probes; balanced extra-high
agents for the production evidence provider and release-smoke authority path; and
a fast high-reasoning agent for the segment-perspective localization gate. The primary integrator implemented the
registry-authorized receipt guard, migration/subregion handling, UX refinements,
browser audit, documentation, and final repository verification, and reran every
material handoff against focused and repository-wide checks.

Current release state remains deliberately conservative: `zh-CN`, `ja-JP`, and
`ko-KR` are runtime-enabled machine drafts, not native-reviewed releases. The
current source has a validator-confirmed local v5 browser attestation and a
verified deterministic evidence bundle; public evidence remains `NOT_PUBLISHED`,
and automated named-surface scans do not substitute for manual assistive-technology
review. No genuine reviewer-signed
packet, trusted production key configuration, authorized registry promotion,
eligible held-out human calibration, or release-required deployment smoke receipt exists.
Production synthetic execution also remains fail-closed until an actual globally
durable Upstash store is provisioned, its provider credentials and stable namespace are configured,
and the live cross-instance contention/readiness and fleet-policy-parity gates pass. The source now contains
the atomic adapter and one shared runtime composition for API, MCP, and health; neither
source wiring nor an endpoint value is evidence that production infrastructure exists.
ASEAN language locales remain individually planned and runtime-disabled;
Singapore remains market-routing-only. The current localization UX is deployed
as a bounded public pilot; it has not passed the documented localization release
gate and must not be presented as a native-reviewed or attitudinally validated
release.
