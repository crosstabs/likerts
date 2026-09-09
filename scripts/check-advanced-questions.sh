#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/dev-env.sh"
cd "$LIKERTS_ROOT"

cargo test --manifest-path backend/Cargo.toml --locked --lib advanced_questions::tests
cargo build --manifest-path backend/Cargo.toml --locked --bin likerts-server
cargo build --manifest-path tools/cli/Cargo.toml --locked
npm --prefix tools/mcp run build
node contracts/check.mjs
node contracts/check-advanced-questions.mjs
bash scripts/check-all-sdks.sh
node tests/advanced-questions.mjs
