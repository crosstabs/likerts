#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
source "$root/scripts/dev-env.sh"

export LIKERTS_API_URL="${LIKERTS_API_URL:-http://127.0.0.1:8080}"
export LIKERTS_TOKEN="${LIKERTS_TOKEN:-local-demo-management-token}"

work="$(mktemp -d "${TMPDIR:-/tmp}/likerts-first-response.XXXXXX")"
trap 'rm -rf "$work"' EXIT
umask 077

call() {
  cargo run --quiet --manifest-path "$root/tools/cli/Cargo.toml" --locked -- \
    call "$1" --input -
}

run_id="$(date +%s)-$$"
jq --arg key "quickstart-survey-$run_id" '.idempotencyKey=$key' \
  "$root/control-plane/public/docs/survey-create.json" | call surveys_create > "$work/survey.json"

jq -n \
  --arg id "$(jq -r .id "$work/survey.json")" \
  --argjson revision "$(jq .revision "$work/survey.json")" \
  --slurpfile sdk "$root/control-plane/public/docs/sdk-capabilities.json" \
  '{id:$id,revision:$revision,sdkCapabilities:$sdk[0]}' | call surveys_publish > "$work/published.json"

jq -n \
  --arg key "quickstart-collection-$run_id" \
  --arg surveyId "$(jq -r .surveyId "$work/published.json")" \
  --argjson version "$(jq .version "$work/published.json")" \
  --slurpfile sdk "$root/control-plane/public/docs/sdk-capabilities.json" \
  '{idempotencyKey:$key,surveyId:$surveyId,version:$version,placement:"quickstart",sdkCapabilities:$sdk[0]}' | \
  call collections_create > "$work/collection.json"

export LIKERTS_COLLECTION_TOKEN="$(jq -r .token "$work/collection.json")"
jq -n \
  --arg id "$(jq -r .id "$work/collection.json")" \
  --arg key "quickstart-response-$run_id" \
  '{id:$id,idempotencyKey:$key,answers:{rating:5},metadata:{channel:"quickstart"}}' > "$work/submission.json"
call responses_submit < "$work/submission.json" > "$work/receipt.json"
call responses_submit < "$work/submission.json" > "$work/retry.json"
test "$(jq -r .responseId "$work/receipt.json")" = "$(jq -r .responseId "$work/retry.json")"

unset LIKERTS_COLLECTION_TOKEN
jq -n --arg collectionId "$(jq -r .id "$work/collection.json")" \
  '{collectionId:$collectionId,limit:10}' | call responses_list > "$work/responses.json"
test "$(jq '.items | length' "$work/responses.json")" -eq 1

jq -n \
  --arg responseId "$(jq -r .responseId "$work/receipt.json")" \
  --arg collectionId "$(jq -r .collectionId "$work/receipt.json")" \
  '{accepted:true,responseId:$responseId,collectionId:$collectionId,idempotentRetry:true,retrievedResponses:1}'
