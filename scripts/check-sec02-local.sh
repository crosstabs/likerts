#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/dev-env.sh"

if rg -n 'console\.(log|error|warn)\([^\n]*(collectionToken|managementToken|state|token)' \
  "$ROOT/release/rehearsal-driver.mjs" >/dev/null; then
  printf '%s\n' 'Release rehearsal driver contains a credential-bearing console statement.' >&2
  exit 1
fi

cargo fmt --manifest-path "$ROOT/backend/Cargo.toml" -- --check
cargo test --manifest-path "$ROOT/backend/Cargo.toml" exports::tests -- --nocapture
cargo test --manifest-path "$ROOT/backend/Cargo.toml" --test metrics -- --nocapture
bash "$ROOT/scripts/check-postgres.sh"
bash "$ROOT/scripts/check-s3-object-store.sh"
bash "$ROOT/scripts/check-aws-iac.sh"

printf '%s\n' \
  'SEC-02A local gate passed: protected credentials, tenant audit, bounded object storage, redacted telemetry and least-privilege AWS synthesis.'
