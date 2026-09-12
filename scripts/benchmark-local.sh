#!/usr/bin/env bash
set -euo pipefail
LIKERTS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export LIKERTS_BENCHMARK_OUTPUT="${LIKERTS_BENCHMARK_OUTPUT:-$LIKERTS_ROOT/.validation-private/local-benchmark.json}"
export LIKERTS_API_CPUS=0.5
export LIKERTS_API_MEMORY=1g
export LIKERTS_DB_CPUS=1
export LIKERTS_DB_MEMORY=1536m
bash "$LIKERTS_ROOT/scripts/check-container.sh"
