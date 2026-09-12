#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

node --test "$root/economics/launch-platform-model.test.mjs" "$root/tests/hosted-sustained.test.mjs" "$root/tests/hosted-credit-notifications.test.mjs"
node "$root/economics/launch-platform-model.mjs"
bash "$root/scripts/verify-sdk-release.sh"
(cd "$root/control-plane" && npm ci --ignore-scripts)
(cd "$root/control-plane" && npm run check)

fixture_key="pk_test_ZGVtby5jbGVyay5hY2NvdW50cy5kZXYk"
(cd "$root/control-plane" && NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$fixture_key" LIKERTS_PUBLIC_API_ORIGIN="https://api.likerts.test" npm run build >/dev/null)
rg -Fq "$fixture_key" "$root/control-plane/dist/app.js"
rg -Fq 'https://api.likerts.test' "$root/control-plane/dist/app.js"
if rg -Fq '__CLERK_PUBLISHABLE_KEY__' "$root/control-plane/dist/app.js"; then
  echo "Clerk publishable-key placeholder survived the build" >&2
  exit 1
fi
(cd "$root/control-plane" && npm run build >/dev/null)

if rg -n 'LIKERTS_VERCEL_BLOB_TOKEN|BLOB_READ_WRITE_TOKEN|CLERK_SECRET_KEY|STRIPE_SECRET' "$root/control-plane/dist"; then
  echo "server secret reference found in control-plane build" >&2
  exit 1
fi
echo "launch platform local gate passed"
