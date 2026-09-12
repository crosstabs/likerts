#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/dev-env.sh"
cd "$LIKERTS_ROOT"

cargo test --manifest-path backend/Cargo.toml --locked --lib branching::tests
bash scripts/check-postgres.sh
node contracts/check.mjs

npm --prefix sdks/web run build
(cd sdks/web && node --test test/branching.test.mjs test/renderer.test.mjs)
npm --prefix sdks/react-native test -- --runInBand Branching.test.ts Survey.test.tsx
npm --prefix sdks/react-native run build
(cd sdks/ios && swift test)

JAVA_HOME="$(find .tools/jdk -type d -path '*/Contents/Home' -print -quit)" \
ANDROID_HOME="$LIKERTS_ROOT/.tools/android-sdk" \
GRADLE_USER_HOME="$LIKERTS_ROOT/.tools/gradle-home" \
"$(find .tools -type f -path '*/bin/gradle' -print -quit)" \
  -p sdks/android testDebugUnitTest --rerun-tasks

(cd sdks/flutter && ../../.tools/flutter/bin/flutter test)
