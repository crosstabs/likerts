#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
source "$root/scripts/dev-env.sh"
command -v cargo >/dev/null || { echo 'Install Rust stable, then run this command again.' >&2; exit 1; }
command -v npm >/dev/null || { echo 'Install Node.js 22 or newer, then run this command again.' >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || { echo 'Node.js 22 or newer is required.' >&2; exit 1; }

echo 'Building the real API, CLI and Web SDK…'
cargo build --quiet --locked --manifest-path "$root/backend/Cargo.toml" --bin likerts-server
cargo build --quiet --locked --manifest-path "$root/tools/cli/Cargo.toml" --bin likerts
npm ci --prefix "$root/sdks/web" --ignore-scripts --no-audit --no-fund
npm run build --prefix "$root/sdks/web"
exec node "$root/examples/embedded-feedback/server.mjs"
