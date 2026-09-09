#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/dev-env.sh"
cd "$LIKERTS_ROOT"
# Build the authoritative validator and actual management/collection transports.
cargo test --manifest-path backend/Cargo.toml --locked --lib choice_features
cargo test --manifest-path backend/Cargo.toml --locked --test choice_features
cargo build --manifest-path backend/Cargo.toml --locked
cargo build --manifest-path tools/cli/Cargo.toml --locked
npm --prefix tools/mcp run build
node contracts/check.mjs
node contracts/check-choice-features.mjs
# Each platform consumes the shared values; renderer suites exercise host interaction.
bash scripts/check-all-sdks.sh
node tests/choice-features.mjs
