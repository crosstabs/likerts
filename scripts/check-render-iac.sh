#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
# No Render credentials, network calls, builds, provisioning or deployments.
node "$root/infrastructure/render/check.mjs"
node "$root/infrastructure/render/check-hosted-load-evidence.mjs"
node "$root/infrastructure/render/check-hosted-binding-evidence.mjs"
sh -n "$root/infrastructure/render/start.sh" "$root/infrastructure/render/migrate.sh" "$root/infrastructure/render/verify-export-reclaim.sh"
node --test "$root/infrastructure/render/entrypoints.test.mjs"
