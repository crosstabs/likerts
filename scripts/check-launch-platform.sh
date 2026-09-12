#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

contains_fixed() {
  if command -v rg >/dev/null 2>&1; then
    rg -Fq "$1" "$2"
  else
    grep -Fq "$1" "$2"
  fi
}

find_secret_references() {
  if command -v rg >/dev/null 2>&1; then
    rg -n 'LIKERTS_VERCEL_BLOB_TOKEN|BLOB_READ_WRITE_TOKEN|CLERK_SECRET_KEY|DATABASE_URL' "$1"
  else
    grep -R -n -E 'LIKERTS_VERCEL_BLOB_TOKEN|BLOB_READ_WRITE_TOKEN|CLERK_SECRET_KEY|DATABASE_URL' "$1"
  fi
}

node "$root/contracts/check-release.mjs"
npm --prefix "$root/sdks/web" run build
node "$root/control-plane/scripts/sync-public-reference.mjs"
(cd "$root/control-plane" && npm ci --ignore-scripts)
(cd "$root/control-plane" && npm run check)

fixture_key="pk_test_ZGVtby5jbGVyay5hY2NvdW50cy5kZXYk"
(cd "$root/control-plane" && NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$fixture_key" LIKERTS_PUBLIC_API_ORIGIN="https://api.likerts.test" npm run build >/dev/null)
contains_fixed "$fixture_key" "$root/control-plane/dist/app.js"
contains_fixed 'https://api.likerts.test' "$root/control-plane/dist/app.js"
if contains_fixed '__CLERK_PUBLISHABLE_KEY__' "$root/control-plane/dist/app.js"; then
  echo "Clerk publishable-key placeholder survived the build" >&2
  exit 1
fi
(cd "$root/control-plane" && npm run build >/dev/null)

if find_secret_references "$root/control-plane/dist"; then
  echo "server secret reference found in control-plane build" >&2
  exit 1
fi
echo "community edition launch-platform gate passed"
