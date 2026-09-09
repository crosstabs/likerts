#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
iac="$root/infrastructure/aws"
output="$(mktemp -d "${TMPDIR:-/tmp}/likerts-cdk.XXXXXX")"
trap 'rm -rf "$output"' EXIT

unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE AWS_DEFAULT_PROFILE
unset CDK_DEFAULT_ACCOUNT
export CDK_DEFAULT_REGION=ap-southeast-1
export AWS_EC2_METADATA_DISABLED=true

cd "$iac"
npm ci --ignore-scripts
npm run build
npm test
npx cdk synth --quiet --output "$output/staging"
npx cdk synth --quiet -c stage=production --output "$output/production"

test -f "$output/staging/Likerts-staging.template.json"
test -f "$output/production/Likerts-production.template.json"
echo "PASS: credential-free staging/production CDK synth and assertions"
