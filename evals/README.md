# Likerts evaluation laboratory

This directory contains deterministic, synthetic-only evaluation inputs and scoring. It is designed to run in CI without network access, accounts, copyrighted datasets, or paid model calls.

## Offline contract checks

Run the focused tests with:

```sh
node --test tests/eval-scoring.test.js
```

The tests exercise 90 fixtures: seven ordinary question types for each of the 10 supported locales, 10 sensitive/high-risk cases that must be rejected or caveated, and malformed/edge inputs. Dimensions include Arabic RTL, locale/script matching, diverse markets, demographic intersections, PRIOR_ONLY versus web-evidence mode, and Quick versus Deep depth.

To score captured pipeline-shaped results (JSON array/object or JSONL):

```sh
node scripts/eval-offline.js path/to/captured-results.jsonl
```

`evaluateResult` checks result shape, five-way distribution arithmetic, citation/provenance fields, evidence class, output locale/script, unsupported human-panel claims, model lineage, cost metadata, and uncertainty/cautions. Malformed results return a failed report instead of throwing. `scoreRepeatability` reports total variation distance, Jensen–Shannon divergence, and maximum percentage-point spread across repeated runs.

Repeatability compares each repeat with the first run: total variation is the largest half-L1 distribution distance, Jensen–Shannon is the mean pairwise divergence from that baseline, and maximum spread is the largest category percentage-point range.

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
