#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
# No Render credentials, network calls, builds, provisioning or deployments.
node "$root/infrastructure/render/check.mjs"
sh -n "$root/infrastructure/render/start.sh" "$root/infrastructure/render/migrate.sh" "$root/infrastructure/render/verify-export-reclaim.sh"
node --test "$root/infrastructure/render/entrypoints.test.mjs"
