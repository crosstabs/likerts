#!/usr/bin/env bash
# Source this file from any directory; uses a workspace-local Rust toolchain if installed.
LIKERTS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -x "$LIKERTS_ROOT/.tools/cargo/bin/cargo" ]; then
  export RUSTUP_HOME="$LIKERTS_ROOT/.tools/rustup"
  export CARGO_HOME="$LIKERTS_ROOT/.tools/cargo"
  export PATH="$CARGO_HOME/bin:$PATH"
fi
