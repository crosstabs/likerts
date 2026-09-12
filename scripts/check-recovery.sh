#!/usr/bin/env bash
set -euo pipefail
LIKERTS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export LIKERTS_RECOVERY_OUTPUT="${LIKERTS_RECOVERY_OUTPUT:-$LIKERTS_ROOT/infrastructure/recovery/local-evidence.json}"
bash "$LIKERTS_ROOT/scripts/check-container.sh"
