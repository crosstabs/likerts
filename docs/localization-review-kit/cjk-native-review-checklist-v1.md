# Likerts CJK native-review checklist

Packet version: `cjk-review-packet-v1.1.0`
Glossary version: `cjk-glossary-v1.0.0`
Locales: `zh-CN`, `ja-JP`, `ko-KR`
Current state: **machine-drafted / review-pending**

This checklist is a human-review template. It is not evidence that a locale has been reviewed. The reviewer must complete one separate record for each locale, covering all six capabilities. A passing automated check, an LLM opinion, a review of one screen, or a review of only one capability cannot populate the reviewer fields or change the release state.

## 1. Reviewer record

Copy this block once per locale. Leave fields blank until an accountable human reviewer completes the work.

```yaml
locale: null                 # zh-CN | ja-JP | ko-KR
market: null                 # CN | JP | KR
reviewerId: null             # stable person or organizational reviewer ID
organization: null
reviewedAt: null             # ISO 8601 date/time
glossaryVersion: cjk-glossary-v1.0.0
reviewedProductVersion: null
reviewedPromptVersion: null
capabilityScope: []          # ui, report, source, retrieval, instrument, sample
blockingFindingsResolved: false
approvalReference: null
status: review-pending
```

Never enter a guessed name, a model name as reviewer, an invented date, or an approval status inferred from test output.

### Signed intake record

After the accountable reviewer completes the full packet, copy
`cjk-native-review-evidence-template.json` to a separate evidence file. Record
the catalog hash, build/product/prompt versions, complete capability scope,
complete review coverage, browser-gate reference, findings projections, packet
reference and SHA-256 digest, and the actual reviewer identity/date. Populate
every `completionSummary` section with `{ id, completed: true,
evidenceReference }` rows: every packet journey, all four viewports, all six
capabilities, all review areas, every accessibility requirement, and every
per-locale provenance field. The three required recheck IDs are
`blocking-findings-resolved`, `blocking-findings-rechecked`, and
`automated-checks-rerun-after-resolution`. `blockingFindingRechecks` must contain
one referenced row for every resolved blocking finding. The reviewer signs that
completed copy with their assigned Ed25519 key. The completed packet itself must
use `likerts-completed-cjk-native-review-packet-v1` /
`cjk-completed-review-packet-v1.1.0`, bind its locale and provenance to the
artifact, repeat the exact `completionSummary`, include structured
`evidenceRecords` whose `contentDigest` is the SHA-256 digest of the exact
referenced evidence bytes, and project its structured findings into the artifact.
The template itself has blank fields, empty completion arrays, and a `null`
signature: it cannot be used as review evidence.

Run the signed copy through `npm run localization:review:intake` only after the
review is complete, supplying the exact completed packet file and every required
operator expectation shown in the protocol. A successful receipt validates the
signed declarations, exact packet-file digest, completed-packet schema, and each
artifact evidence reference against a structured packet evidence record. The
packet digest and signature bind each declared evidence `contentDigest`, but
intake does not fetch the referenced evidence or independently hash its bytes; it
therefore does not show that the review happened or that a referenced capture is
truthful. It is not a registry change or release approval; the locale remains
`review-pending` until an authorized maintainer separately verifies and records
the evidence.

## 2. Before opening the product

- [ ] Freeze the catalog, glossary, product build, prompt/model versions, and sample-study fixture.
- [ ] Record the build and catalog hash in the provenance section of the packet.
- [ ] Confirm that all six capabilities are in the declared scope: `ui`, `report`, `source`, `retrieval`, `instrument`, `sample`.
- [ ] Read the full [localization review and release protocol](../localization-review-and-release.md).
- [ ] Read the locale entry in `cjk-glossary-v1.json`, including risky terms, placeholders, scale anchors, disclosures, and accessibility labels.
- [ ] Prepare a keyboard-only pass and, where available, a screen reader pass.
- [ ] Prepare viewport checks at 320, 375, 768, and 1440 CSS pixels.

## 3. Terminology and translation review

For every glossary term:

- [ ] Meaning is accurate in the displayed context.
- [ ] Register is appropriate for market-research authors and respondents.
- [ ] The preferred term is used consistently across UI, report, source, retrieval, instrument, and sample surfaces.
- [ ] High- and critical-risk terms have an explicit reviewer decision.
- [ ] “Model-generated perspective” is never shortened in a way that could imply a human participant.
- [ ] “Population Fit” does not imply attitudinal accuracy or representativeness beyond the cited evidence.
- [ ] “Human validation” clearly means research with real people, not model review.
- [ ] “Machine-drafted”, “review-pending”, and “unsupported” communicate release state rather than quality or accuracy.
- [ ] “Original language” and “retrieval geography” do not imply translation, truth, or local representativeness.
- [ ] Research-method names preserve their methodological distinction: concept, message, claims, purchase intent, price sensitivity, feature prioritization, brand positioning, UX expectation, survey pretesting, and interview-guide generation.

Record a finding for any term that needs context-specific treatment; do not silently change the glossary during a run.

## 4. Placeholder and technical-token review

Test each placeholder in a short, long, numeric, and CJK-containing value:

`{market}` · `{locale}` · `{count}` · `{date}` · `{source}` · `{segment}` · `{conceptA}` · `{conceptB}` · `{question}` · `{currency}` · `{amount}` · `{percent}` · `{status}`

- [ ] Every placeholder appears exactly once where intended and is not translated, reordered incorrectly, or dropped.
- [ ] Braces and placeholder names remain exact.
- [ ] Locale IDs, market IDs, enum values, URLs, hashes, model IDs, and question IDs remain exact.
- [ ] User-supplied questions, stimuli, source titles, and excerpts are not silently rewritten.
- [ ] Long values wrap without changing token content or creating horizontal page overflow.
- [ ] Exported canonical timestamps and numeric values remain machine-readable.

## 5. Complete journey review

Use `cjk-review-packet-v1.json` as the authoritative journey list. Mark each step in the reviewer’s copy of the packet, not in the source template.

### First run and setup (`ui`)

- [ ] First run works without an account.
- [ ] Interface language, report locale, source locale, retrieval locale, instrument locale, and market are visibly separate.
- [ ] Defaults and mismatch guidance are understandable.
- [ ] Unsupported combinations fail closed and do not become English, Global, or US evidence.
- [ ] Status visibly says machine-drafted and review-pending.

### Research methods and instrument (`instrument`)

- [ ] All ten method templates have natural titles, descriptions, inputs, help, validation, scale anchors, and method-specific caveats.
- [ ] The respondent-facing instrument uses the selected instrument locale.
- [ ] Consent, privacy, accessibility, and localization notices are clear.
- [ ] Human-research handoff states its translation-review blocker.

### Results, Population Frame, Model Card, and stability (`report`)

- [ ] Primary result and method-specific interpretation are natural and do not overclaim.
- [ ] Scale labels, percentages, dates, currencies, and counts are locale-aware.
- [ ] Every synthetic perspective is labelled: “Model-generated perspective—not a participant quotation.”
- [ ] Population Frame includes intended population, geography/language, margins, official datasets, intersections, weighting, unsupported characteristics, coverage date, and Population Fit.
- [ ] The explicit statement that demographic/language fit does not prove attitudinal accuracy is present and understandable.
- [ ] Multiple-run variation is not presented as human sampling error or a fictional confidence interval.

### Evidence and retrieval (`source`, `retrieval`)

- [ ] Source title, publisher, URL, date, original language, role, and caveat are visible.
- [ ] Source excerpts remain in their original language unless a reviewed translation is explicitly supplied.
- [ ] Retrieval geography matches the declared market; Global has no implicit country.
- [ ] `REQUIRE` language policy fails closed when no matching source exists.
- [ ] Retrieval language preference is not described as proof of source truth or attitudinal validity.

### Qualitative exploration (`report`)

- [ ] Selecting a modeled segment preserves context across follow-up questions.
- [ ] Objection, counterfactual, and two-concept comparison modes are understandable.
- [ ] Evidence and assumptions influencing each answer are inspectable.
- [ ] No answer is presented as a participant quotation.

### Samples, saved projects, and exports (`sample`)

- [ ] Locale sample opens with its localization receipt and review-pending status.
- [ ] Save/reopen preserves the canonical locale dimensions.
- [ ] Report and questionnaire exports preserve IDs, numbers, dates, and review status.
- [ ] Planned ASEAN locales cannot be run as if they were enabled.

## 6. Scale-anchor review

Review every anchor in the locale glossary for semantic spacing, polarity, politeness, and cultural naturalness. At minimum check likelihood, purchase intent, compellingness, credibility, and ease. Confirm that:

- [ ] five anchors remain five anchors in the same order;
- [ ] positive and negative endpoints are unambiguous;
- [ ] the neutral midpoint is not accidentally positive or negative;
- [ ] the wording does not imply certainty beyond the original construct;
- [ ] chart labels, instrument labels, exports, and accessible alternatives use the same approved anchors.

## 7. Accessibility and responsive review

- [ ] `lang` and direction are correct for the selected locale.
- [ ] Keyboard focus is visible on every control and follows a sensible order.
- [ ] Screen-reader names, required-state labels, expanded/collapsed state, errors, and live announcements are natural.
- [ ] Charts have a readable semantic table or text alternative.
- [ ] CJK text does not clip at 320, 375, 768, or 1440 px.
- [ ] Korean syllables do not break into orphaned fragments; Japanese and Chinese punctuation remains readable.
- [ ] Technical identifiers can wrap safely without being altered.
- [ ] Zoom/reflow and long translations do not hide primary actions.

Record browser, viewport, assistive technology, path, result, and finding IDs for every failure or exception.

## 8. Findings record

Use one row per issue. Required categories are `meaning`, `tone`, `terminology`, `placeholder`, `scale-anchor`, `disclosure`, `accessibility`, `truncation`, `interaction-label`, `script`, `cultural-assumption`, `source-provenance`, `market-or-retrieval`, and `technical-token`.

```yaml
id: null
locale: null
capability: null
journeyId: null
severity: null              # blocking | high | medium | low
category: null
status: open                # open | accepted | resolved | wont-fix | needs-context
summary: null
sourceText: null
proposedText: null
rationale: null
evidenceReference: null
reviewerId: null
resolvedAt: null
recheckEvidence: null
```

Blocking examples include a mistranslated scale endpoint, a missing synthetic disclosure, a misleading accuracy claim, an instrument that changes the intended construct, a wrong market/retrieval country, a broken placeholder, or an inaccessible primary action.

### Intake projection

The signed artifact uses the registry-safe finding projection defined by the completed-packet schema. `blocking` remains `blocking`; `high`, `medium`, and `low` become `non-blocking`. Only workflow status `resolved` projects to `resolved`; `open`, `accepted`, `wont-fix`, and `needs-context` all project to `open`. In particular, accepted or wont-fix is not a release-clearing resolution. The artifact projection must preserve each finding ID, summary, and evidence reference exactly, and every artifact evidence reference must resolve to a structured `evidenceRecords` entry in the completed packet with a `sha256:` content digest over the exact referenced bytes.

## 9. Release decision

The locale remains `review-pending` unless all of the following are true:

- [ ] Every required capability was reviewed in the same locale packet; a partial per-capability record is not intake-ready.
- [ ] Reviewer identity, date, glossary version, product version, and prompt version are recorded.
- [ ] Findings cover meaning, tone, terminology, placeholders, scale anchors, disclosures, truncation, interaction labels, and cultural assumptions.
- [ ] All blocking findings are resolved and rechecked.
- [ ] Automated key, placeholder, script, formatting, build, keyboard, and browser checks pass.
- [ ] Population-source evidence is separately assessed; language review is not population validation.
- [ ] No attitudinal accuracy claim is made without an eligible held-out human comparison.

Only after the evidence above is recorded may the registry be updated by an authorized maintainer. Until then, do not change `nativeReview.status`, `statusByCapability`, reviewer fields, or the scorecard’s launch status.

## 10. Provenance handoff

Attach the completed packet with:

- locale and market;
- catalog hash and glossary version;
- build, product, prompt, and model versions;
- source snapshot date;
- browser-gate evidence reference and captures/transcripts;
- a `sha256:` content digest for the exact bytes of every referenced evidence record;
- complete findings log and recheck references;
- reviewer and review date;
- approval reference, if and only if one was actually issued.

The packet must preserve the distinction between machine-generated content and human evidence. A native reviewer can approve linguistic quality; that approval alone does not establish population coverage or attitudinal accuracy.
