#!/usr/bin/env bash
set -euo pipefail
LIKERTS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$LIKERTS_ROOT/scripts/check-sdk-release.mjs" "$@"
