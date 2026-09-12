#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/dev-env.sh"

cargo fmt --manifest-path "$ROOT/backend/Cargo.toml" -- --check
cargo test --manifest-path "$ROOT/backend/Cargo.toml" exports::tests -- --nocapture
cargo test --manifest-path "$ROOT/backend/Cargo.toml" --test metrics -- --nocapture
bash "$ROOT/scripts/check-postgres.sh"
bash "$ROOT/scripts/check-s3-object-store.sh"
bash "$ROOT/scripts/check-aws-iac.sh"

printf '%s\n' \
  'SEC-02A local gate passed: protected credentials, tenant audit, bounded object storage, redacted telemetry and least-privilege AWS synthesis.'
