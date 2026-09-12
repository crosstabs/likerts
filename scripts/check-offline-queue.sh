#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/dev-env.sh"
cd "$LIKERTS_ROOT"

node contracts/check-offline-queue.mjs
npm --prefix sdks/web run build
node --test sdks/web/test/offline.test.mjs
chrome_path="${CHROME_PATH:-$HOME/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing}"
CHROME_PATH="$chrome_path" node sdks/web/test/offline-browser-gate.mjs

npm --prefix sdks/react-native run check
npm --prefix sdks/react-native test -- --runInBand --runTestsByPath test/Offline.test.ts
npm --prefix sdks/react-native run build
swift test --package-path sdks/ios --filter OfflineQueueTests

java_home="${JAVA_HOME:-}"
if [ -z "$java_home" ]; then java_home="$(find "$LIKERTS_ROOT/.tools/jdk" -type d -path '*/Contents/Home' -print -quit)"; fi
android_home="${ANDROID_HOME:-$LIKERTS_ROOT/.tools/android-sdk}"
gradle_command="${GRADLE_COMMAND:-}"
if [ -z "$gradle_command" ]; then gradle_command="$(find "$LIKERTS_ROOT/.tools" -type f -path '*/bin/gradle' -print -quit)"; fi
JAVA_HOME="$java_home" ANDROID_HOME="$android_home" GRADLE_USER_HOME="${GRADLE_USER_HOME:-$LIKERTS_ROOT/.tools/gradle-home}" "$gradle_command" -p sdks/android testDebugUnitTest --tests com.likerts.sdk.OfflineQueueTest

flutter_command="${FLUTTER_COMMAND:-}"
if [ -z "$flutter_command" ]; then flutter_command="$(find "$LIKERTS_ROOT/.tools" -type f -path '*/bin/flutter' -print -quit)"; fi
(cd sdks/flutter && "$flutter_command" analyze && "$flutter_command" test test/offline_queue_test.dart)
