# Likerts ASEAN native-review rollout checklist

Packet version: `asean-review-packet-v1.0.0`<br>
Glossary version: `asean-glossary-v1.0.0`<br>
Completed packet version: `asean-completed-review-packet-v1.0.0`<br>
Evidence template: `asean-native-review-evidence-template.json`<br>
Registry source: `shared/localization.mjs`<br>
Current state: **copy unsupported / capabilities planned / native review pending**

This is a review handoff, not a translation or launch approval. No ASEAN locale is enabled by this kit. The packet intentionally supplies source terminology and review prompts only; it does not supply translations. A machine pass, test pass, script check, market route, or model opinion cannot populate reviewer fields or change a release state.

## 1. Review queue and boundary

Review in this order, recording a separate packet record for every locale and every capability:

1. Singapore first: `en-SG`, `ms-SG`, `zh-Hans-SG`, `ta-SG`.
2. Next: `id-ID`, `ms-MY`, `en-MY`, `fil-PH`, `en-PH`, `th-TH`, `vi-VN`.
3. Roadmap: `ms-BN`, `km-KH`, `lo-LA`, `my-MM`.

The market and locale dimensions must remain visibly separate:

- A market route resolves the country and retrieval geography. It does not provide localized copy.
- A locale is supported only after its own capability, copy, native-review, browser, accessibility, population-evidence, and (where applicable) calibration gates pass.
- Singapore market routing is enabled in the registry, while all four Singapore locales remain `planned` with `unsupported` copy. Do not call this translation support.
- When Singapore is selected in the product, the composer must keep a visible routing-only notice showing the current report and instrument languages, the planned Singapore language variants, and the fact that pricing currency is not changed automatically for priced methods.
- `ID`, `MY`, `PH`, `TH`, and `VN` markets are `planned`; `BN`, `KH`, `LA`, and `MM` markets are `roadmap`. These statuses do not enable their language locales.

## 2. Reviewer record

Copy once per locale, then once per capability as needed. Leave every reviewer and evidence field null until an accountable human completes the work.

```yaml
locale: null                 # exact BCP-47 ID from the packet
market: null                 # exact ISO market ID from the packet
capability: null             # ui | report | source | retrieval | instrument | sample
reviewer: null               # person or stable organizational reviewer ID
organization: null
reviewedAt: null             # ISO 8601 date/time
glossaryVersion: asean-glossary-v1.0.0
reviewedProductVersion: null
reviewedPromptVersion: null
registryVersion: localization-capabilities-v2
capabilityScope: []
status: review-pending
blockingFindingsResolved: false
approvalReference: null
evidenceReference: null
```

Never enter a guessed name, model name, invented date, translation, approval reference, or status inferred from automated output.

## 3. Before opening the product

- [ ] Freeze `shared/localization.mjs`, catalog version/hash, glossary version, product build, prompt/model versions, and the viewport matrix.
- [ ] Confirm the exact locale and market IDs against the packet and registry; do not substitute `ASEAN` for a locale.
- [ ] Confirm all six capabilities are in scope: `ui`, `report`, `source`, `retrieval`, `instrument`, `sample`.
- [ ] Confirm every current locale capability is `planned`, `copyStatus` is `unsupported`, native review is `review-pending`, reviewer fields are null, population evidence is `unmeasured`, and attitudinal validation is `unsupported`.
- [ ] Read the [localization review and release protocol](../localization-review-and-release.md).
- [ ] Start from `asean-native-review-evidence-template.json`; preserve `reviewProgram: asean-native-review` and never reuse a CJK trust-key entry for this program.
- [ ] Prepare desktop and mobile browsers, keyboard-only navigation, a screen reader where available, and the locale keyboard/IME.
- [ ] Prepare 320, 375, 768, and 1440 CSS-pixel viewports.

## 4. Exact per-capability enablement evidence

Do not mark a capability enabled from a partial pass. For each locale × capability cell, attach immutable evidence to the reviewer’s copy of the packet:

| Capability | Evidence required before enablement |
| --- | --- |
| `ui` | exact-key/placeholder-parity catalog; script/font/line-break browser captures; keyboard and screen-reader evidence; native reviewer decision |
| `report` | reviewed report copy and scale anchors; disclosure and number/date/currency evidence; native reviewer decision |
| `source` | original-language and provenance handling; excerpt/technical-token preservation; native reviewer decision |
| `retrieval` | market geography and language-policy evidence; `REQUIRE`/`PREFER`/`ANY` fail-closed evidence; native reviewer decision |
| `instrument` | all ten method templates and respondent handoff; question/anchor/placeholder evidence; native reviewer decision |
| `sample` | sample, save/reopen, and export evidence; localization receipt and unsupported-state evidence; native reviewer decision |

For every current cell, record exactly: `registryStatus: planned`, `copyStatus: unsupported`, `nativeReviewStatus: review-pending`, `enabled: false`, `evidenceReference: null`. Tests and this checklist do not fill the evidence reference. The registry may be updated only by an authorized maintainer after all gates pass.

## 5. Terminology and locale-specific language review

Use `asean-glossary-v1.json` as the source inventory. It has no translations. For every locale, review each source term in context and record proposed wording only as a finding:

- [ ] `synthetic research` is distinct from research with respondents.
- [ ] `model-generated perspective` and “not a participant quotation” are unambiguous.
- [ ] `population frame` and `Population Fit` do not claim representativeness.
- [ ] `attitudinal accuracy` is not claimed without eligible held-out human calibration.
- [ ] `Evidence Ledger`, `original language`, and `retrieval geography` preserve provenance boundaries.
- [ ] `respondent instrument` is distinct from an analyst preview.
- [ ] `human validation` means research with real people, not model review.
- [ ] `machine-drafted`, `review-pending`, and `unsupported` communicate release state, not quality.
- [ ] `raking / iterative proportional fitting` is not described as attitudinal validation.
- [ ] Locale-specific register, honorific/politeness, borrowed research terms, country usage, and sensitive wording are reviewed by a native speaker for that exact market/locale; do not infer from a neighboring locale.
- [ ] All proposed wording is checked in UI, report, source, retrieval, instrument, and sample contexts.

For every glossary term, record: preferred term, forbidden alternative, rationale, context example, affected capabilities, reviewer, and evidence reference. A null translation field means “not supplied,” never “accepted.”

## 6. Survey-method and instrument review

Review all ten methods in every locale where `instrument` is being assessed. Preserve the construct and method distinction:

- [ ] Concept testing: concept appeal is not purchase intent; stimulus is preserved.
- [ ] Message testing: message meaning, exposure order, and compellingness polarity are clear.
- [ ] Claims testing: claim scope and credibility wording do not strengthen the evidence.
- [ ] Purchase-intent testing: purchase versus consideration is clear; five-point anchors preserve certainty and polarity.
- [ ] Price sensitivity: currency/amount placeholders, price-point ordering, and demand caveats are intact.
- [ ] Feature prioritization: rank versus rating, ties, missing values, and full-rank-order disclosure are clear.
- [ ] Brand positioning: familiarity wording, attribute-brand matrix, and familiarity bases are explicit.
- [ ] UX expectation testing: ease/expectation constructs, task wording, and mobile labels are natural.
- [ ] Survey pretesting: cognitive-pretest scope and the real-person handoff are explicit.
- [ ] Interview-guide generation: a generated guide is not a completed interview; stopping rules and model disclosure remain visible.

Also test every placeholder in short, long, numeric, and native-script values:
`{market}` · `{locale}` · `{count}` · `{date}` · `{source}` · `{segment}` · `{conceptA}` · `{conceptB}` · `{question}` · `{currency}` · `{amount}` · `{percent}` · `{status}`.

- [ ] Placeholder names, braces, ordering, and multiplicity remain exact.
- [ ] User-supplied questions, stimuli, source titles, and excerpts are not silently translated.
- [ ] Locale IDs, market IDs, enum values, URLs, hashes, model IDs, and question IDs remain exact.

## 7. Script, font, input, and line-break gate

Check the expected script from the registry for each locale:

| Script | Locales |
| --- | --- |
| Latin | `en-SG`, `ms-SG`, `id-ID`, `ms-MY`, `en-MY`, `fil-PH`, `en-PH`, `vi-VN`, `ms-BN` |
| Han | `zh-Hans-SG` |
| Tamil | `ta-SG` |
| Thai | `th-TH` |
| Khmer | `km-KH` |
| Lao | `lo-LA` |
| Myanmar | `my-MM` |

- [ ] Expected script renders without disallowed-script contamination in localized chrome.
- [ ] Font fallback covers the script, combining marks, punctuation, and numerals; no tofu or clipping appears.
- [ ] Locale keyboard/IME composition, deletion, cursor movement, paste, and mixed-script input are preserved.
- [ ] Line-break and word-break rules preserve meaning in headings, labels, error text, scales, tables, and exports.
- [ ] Technical identifiers may wrap safely but never change.
- [ ] RTL is not assumed for these locales; direction must still be read from the registry rather than guessed.

Record locale, script, font stack, input method, browser, viewport, line-break rule, pass/fail, finding IDs, and capture reference.

## 8. Mobile and accessibility gate

Run at 320, 375, 768, and 1440 px in mobile and desktop browsers.

- [ ] `lang` and direction match the selected locale.
- [ ] Every control has a natural accessible name when localized copy exists.
- [ ] Focus is visible and keyboard order matches visual order.
- [ ] IME composition and keyboard focus do not reset unexpectedly.
- [ ] Required, expanded/collapsed, validation, and live-region states are announced.
- [ ] Charts have a readable table or text alternative.
- [ ] Long strings do not clip, overlap, or cause page-level horizontal overflow.
- [ ] Touch targets and primary actions remain usable on mobile.
- [ ] Zoom/reflow keeps controls, errors, disclosures, and status visible.

Record browser, viewport, assistive technology, path, pass/fail, finding IDs, and capture reference.

## 9. Population, evidence, and calibration boundaries

- [ ] Population evidence is separately sourced, dated, and scoped to market, language, and intended population.
- [ ] Margins, known intersections, weighting/raking method, unsupported characteristics, and missing values are visible.
- [ ] Market routing is not treated as population coverage.
- [ ] Language or native review is not treated as demographic fit or attitudinal validation.
- [ ] `Population Fit` is not described as attitudinal accuracy or representativeness.
- [ ] Generated records are never called human respondents, participant quotations, or a human sample.
- [ ] No confidence interval or sampling error is computed from generated records.
- [ ] Any attitudinal accuracy claim is blocked until eligible held-out human comparison evidence exists for the exact locale and market; current status is `unsupported`.

## 10. Findings and release decision

Use one finding per issue. Required categories include `meaning`, `tone`, `terminology`, `placeholder`, `scale-anchor`, `disclosure`, `accessibility`, `truncation`, `script`, `font`, `input-method`, `line-break`, `cultural-assumption`, `source-provenance`, `market-or-retrieval`, `technical-token`, and `population-evidence`.

```yaml
id: null
locale: null
market: null
capability: null
journeyId: null
severity: null              # blocking | high | medium | low
category: null
status: open                # open | accepted | resolved | wont-fix | needs-context
summary: null               # concise, non-empty registry-facing description
sourceText: null
proposedText: null
rationale: null
evidenceReference: null
reviewer: null
resolvedAt: null
recheckEvidence: null
```

Before a finding is copied into `shared/localization.mjs` release metadata, project it to the narrower registry schema: `blocking` stays `blocking`; `high`, `medium`, and `low` become `non-blocking`; only `resolved` stays `resolved`, while every other workflow status becomes `open`. A human reviewer must confirm that projection and provide the non-empty `summary`; automation must not infer it.

Keep every locale `unsupported` and `review-pending` unless all required capability evidence, native reviewer identity/date/scope, resolved blocking findings, browser/accessibility evidence, population boundaries, and release records are complete. Do not infer approval from zero automated findings. Do not change `shared/localization.mjs` as part of this kit.

## 11. Provenance handoff

Attach the completed record with locale, market, registry/catalog/glossary versions and hashes, build/product/prompt/model versions, source snapshot date, browser-gate run ID, captures/transcripts, findings and rechecks, reviewer/date, and approval reference only if one was actually issued. Preserve the distinction between linguistic review, population evidence, and attitudinal calibration.

The completed packet must declare `likerts-completed-asean-native-review-packet-v1`, `asean-completed-review-packet-v1.0.0`, and `reviewProgram: asean-native-review`. Sign the corresponding evidence envelope only after the packet and every referenced evidence digest are frozen. A successful import proves only that the signed review evidence is structurally and cryptographically admissible; it does not enable a planned locale or satisfy browser, population, calibration, or deployment gates.
