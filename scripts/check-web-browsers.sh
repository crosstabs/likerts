#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
source "$root/scripts/dev-env.sh"
cd "$root"
if [ "${LIKERTS_SKIP_BACKEND_BUILD:-0}" != 1 ]; then
  cargo build --locked --manifest-path backend/Cargo.toml --bin likerts-server
fi
npm --prefix sdks/web ci
npm --prefix sdks/web run build
node sdks/web/test/browser-matrix.mjs
