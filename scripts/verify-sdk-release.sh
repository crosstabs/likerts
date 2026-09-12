#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
node --test "$root/scripts/verify-sdk-release.test.mjs"
node "$root/scripts/verify-sdk-release.mjs"
