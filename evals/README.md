# Likerts evaluation laboratory

This directory contains deterministic, synthetic-only evaluation inputs and scoring. It is designed to run in CI without network access, accounts, copyrighted datasets, or paid model calls.

## Offline contract checks

Run the focused tests with:

```sh
node --test tests/eval-scoring.test.js
```

The tests exercise 90 general fixtures plus an 11-method × 10-locale offline contract matrix. The general set includes seven ordinary question types per locale, sensitive/high-risk cases that must be rejected or caveated, and malformed/edge inputs. The method matrix covers every result kind, both prior-only and uploaded-grounding modes, human-handoff expectations, all follow-up intents, Arabic RTL, and an explicit prohibition on network or paid calls.

To score captured pipeline-shaped results (JSON array/object or JSONL):

```sh
node scripts/eval-offline.js path/to/captured-results.jsonl
```

`evaluateResult` checks result shape, five-way distribution arithmetic, citation/provenance fields, evidence class, output locale/script, unsupported human-panel claims, model lineage, cost metadata, and uncertainty/cautions. Malformed results return a failed report instead of throwing. `scoreRepeatability` reports total variation distance, Jensen–Shannon divergence, and maximum percentage-point spread across repeated runs.

Repeatability compares each repeat with the first run: total variation is the largest half-L1 distribution distance, Jensen–Shannon is the mean pairwise divergence from that baseline, and maximum spread is the largest category percentage-point range.

## Versioned release gate

`release-gates.js` turns the evaluation signals into a fail-closed release decision. A candidate can return `GO` only when all of the following are true:

- the previous baseline and current capture satisfy the versioned metric and lineage contract;
- contract, unsupported-human-claim, malformed-input, repeatability, p95 latency, p95 cost, fallback, and regression thresholds pass;
- every criterion in `human-editorial-rubric-v1` has an attributed and dated human `PASS` review, signed by a configured trusted reviewer and bound to the exact normalized candidate hash; and
- `evaluation-release-policy-v1` has a trusted approver signature over the exact threshold hash and baseline hash.

Missing editorial work or policy approval produces `HOLD`; malformed inputs and automated, safety, regression, or explicit editorial failures produce `NO_GO`. Runtime, prompt, schema, and model-route changes are reported separately from metric drift. The resulting artifact whitelists numeric metrics and bounded version identifiers, so prompt, source, respondent, quote, transcript, and evidence text are not copied into release telemetry.

Capture chronology is enforced: a candidate older than its baseline is `NO_GO`. Invalid or untrusted signatures are also `NO_GO`, rather than pending work.

The release-only command consumes a repository-local signed bundle and exits successfully only for a verified `GO`:

```sh
LIKERTS_RELEASE_REVIEWER_KEYS_JSON='{ "reviewer-id": "-----BEGIN PUBLIC KEY-----..." }' \
LIKERTS_RELEASE_APPROVER_KEYS_JSON='{ "approver-id": "-----BEGIN PUBLIC KEY-----..." }' \
npm run eval:release -- --bundle path/to/signed-release-bundle.json
```

The manually triggered `Evaluation Release Gate` workflow invokes the same command with trusted public-key maps supplied through repository secrets. It performs no deployment. Missing secrets, malformed bundles, `HOLD`, and `NO_GO` all fail the job.

The checked-in thresholds are initial safety bounds, not a claim of empirical validity. They become an approved gate only through the signed calibration record above. This repository contains no such approval or real-data result, so it does not itself authorize a live release or accuracy claim.

Offline scoring is contract validation, not proof that a model result is true. A passing synthetic fixture says that the captured payload is explicit and structurally safe to review; it does not establish population representativeness, causal validity, human-panel equivalence, or source verification.

## Live runs (opt-in and paid-risk)

The live runner is off by default and makes no request unless `LIKERTS_EVAL_LIVE=1` (or `enabled: true` is passed to the exported function). Use a local/staging URL explicitly:

```sh
LIKERTS_EVAL_LIVE=1 \
LIKERTS_EVAL_URL=http://localhost:3000/api/synthetic-study \
LIKERTS_EVAL_FIXTURE_LIMIT=2 \
LIKERTS_EVAL_MAX_RUNS=2 \
LIKERTS_EVAL_MAX_COST_USD=0.50 \
node scripts/eval-live.js
```

The runner refuses a request set that exceeds either the strict run cap or the estimated-cost cap, records redacted JSONL plus a summary, and evaluates returned payloads with the same offline scorer. Live calls may incur model/retrieval cost and are intentionally excluded from normal tests and CI. Do not point it at production without an explicit operator decision.

## Public ground-truth comparisons

For a validity study, compare directional outputs with a clearly defined public reference measured by compatible wording, population, date, geography, and response scale. Record the reference URL, sampling/method notes, and mismatch assumptions. Compare distributions and uncertainty descriptively; report disagreement and missingness. A public benchmark can calibrate or falsify a hypothesis, but it must not be described as evidence that a synthetic panel is equivalent to the benchmark’s human participants or representative sample. Do not fetch or bundle copyrighted datasets into this repository.

The public [benchmark manifest](../public/research-standards/benchmark-manifest.json) records the initial official-source candidates and required preregistration protocol. It is a roadmap, not a result set; each candidate remains `candidate-not-run` until its access terms, exact wording, scale, population, field dates, weights, and matching synthetic brief have been frozen and evaluated.

## Validation Lab offline contract

`scripts/validation-lab-offline.js` is a local, offline-only boundary for held-out benchmark work. Before a synthetic run it accepts only a versioned `SYNTHETIC_EXECUTION` import containing an eligible preregistration, then emits the blinded brief. The import rejects revealed outcomes, reveal nonces, unversioned records, ineligible mappings, and extra pre-run fields. It makes no model, network, or hosted-service call.

```sh
node scripts/validation-lab-offline.js --dry-run path/to/synthetic-import.json
```

After a synthetic run has finished, supply its captured runs and the separately held reveal to produce a local machine-readable scorecard. This preserves failures and records the calibration date plus runtime, model-route, prompt, and schema lineage. The command does not publish anything:

```sh
node scripts/validation-lab-offline.js \
  --import path/to/synthetic-import.json \
  --runs path/to/synthetic-runs.json \
  --reveal path/to/sealed-reveal.json \
  --evaluator path/to/evaluator.json \
  --output path/to/local-scorecard.json
```

`validation-lab-fixtures.js` contains invented deterministic contract data only. It is explicitly not a real benchmark or a calibration result.

### Fixture-only execution contracts

Run the complete local Validation Lab contract suite with:

```sh
node --test \
  test/validation-lab.test.js \
  test/validation-lab-import.test.js \
  test/validation-lab-execution.test.js
```

The suite uses invented records only and makes no model, network, recruitment, publication, or deployment call.

`sealValidationArtifacts` writes two content-bound files: a public preregistration artifact containing the salted outcome commitment, and a private reveal containing the nonce and extracted human outcome. The reveal must be inside the configured private root and outside the configured public root. Lexical and canonical roots must not overlap; symbolic-link roots, destination ancestors, final destinations, and nonce registries fail closed. Artifact creation uses exclusive no-follow opens with a post-open inode and canonical-path check. Private directories are owner-only (`0700`) and reveal/registry files are `0600`; this repository also ignores `.validation-private/`. A private nonce-fingerprint registry rejects reuse; weak, low-diversity nonces fail before either artifact is written. The CLI reads the nonce from a local file so it is not placed in the command output:

```sh
node scripts/validation-lab-offline.js --seal \
  --preregistration path/to/preregistration.json \
  --human-outcome path/to/human-outcome.json \
  --nonce-file .validation-private/case.nonce.txt \
  --public-root path/to/local-public-artifacts \
  --private-root .validation-private \
  --public-artifact path/to/local-public-artifacts/case.json \
  --private-reveal .validation-private/case.reveal.json
```

`extractConfiguredHumanOutcomeFromFile` accepts only a versioned `CSV` or `JSON` mapping. The config must name the JSON record path (when applicable), exact filters, ordered response codes, weight field, group definitions, and date field. Unknown response codes, duplicate identities, empty groups, invalid weights, and malformed dates fail closed. The result includes source/config hashes, weighted and unweighted bases, field dates, and distributions summing deterministically to 100. It has no inference or LLM path.

`planBlindValidationExecution` expands the blinded import across question × repeat × subgroup × evidence variant, freezes hashes and runtime/prompt/schema/model lineage into each item, and returns no executable items if either the call or estimated-cost hard cap is exceeded. `assembleBlindValidationExecution` accepts only results belonging to that frozen plan, preserves every supplied success and failure verbatim, and converts every missing planned result into an explicit `MISSING_RESULT` failure with full lineage.

`createPublicValidationCaseArtifact` content-addresses each local case report. `generatePublicValidationScorecardArtifact` verifies those immutable hashes, sorts cases deterministically, shows completed, failed, invalidated, and not-assessed cases, and returns canonical byte-identical JSON. Aggregate metrics are `SUPPRESSED_UNDERPOWERED` until the configured minimum completed-and-assessed case count is met. Artifacts remain `NOT_PUBLISHED`; generation does not change the public benchmark manifest.

Tasks 7.6 and 7.7 remain authority-gated. They require approval of a real dataset, licence, language, and methodology, followed by a separate explicit run authorization and cost cap. None of the fixture-only commands performs those tasks.
