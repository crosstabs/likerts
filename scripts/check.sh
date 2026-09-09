#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/dev-env.sh"
cd "$LIKERTS_ROOT"
cargo test --manifest-path backend/Cargo.toml --locked
cargo build --manifest-path backend/Cargo.toml --locked
cargo test --manifest-path tools/cli/Cargo.toml --locked
cargo build --manifest-path tools/cli/Cargo.toml --locked
npm --prefix tools/mcp ci
npm --prefix tools/mcp run build
npm --prefix tools/mcp test
npm --prefix sdks/web ci
npm --prefix sdks/web run build
node --test sdks/web/test/*.test.mjs
node scripts/check-sdk-contract.mjs
node tests/integration.mjs
node --test tests/conditional-visibility.mjs
node tests/advanced-questions.mjs
node contracts/check.mjs
node contracts/generate-examples.mjs --check
node --test tests/interface-contract.mjs
