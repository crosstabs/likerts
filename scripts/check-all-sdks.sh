#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

node scripts/check-sdk-contract.mjs
npm --prefix sdks/web ci
npm --prefix sdks/web run build
node --test sdks/web/test/*.test.mjs
npm --prefix sdks/react-native ci
npm --prefix sdks/react-native run check
npm --prefix sdks/react-native test -- --runInBand
swift test --package-path sdks/ios
if command -v xcrun >/dev/null 2>&1; then
  xcrun --sdk iphonesimulator swiftc -typecheck -target arm64-apple-ios15.0-simulator -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" sdks/ios/Sources/Likerts/*.swift
fi

java_home="${JAVA_HOME:-}"
if [ -z "$java_home" ]; then java_home="$(find "$root/.tools/jdk" -type d -path '*/Contents/Home' -print -quit)"; fi
android_home="${ANDROID_HOME:-$root/.tools/android-sdk}"
gradle_command="${GRADLE_COMMAND:-}"
if [ -z "$gradle_command" ]; then gradle_command="$(find "$root/.tools" -type f -path '*/bin/gradle' -print -quit)"; fi
JAVA_HOME="$java_home" ANDROID_HOME="$android_home" GRADLE_USER_HOME="${GRADLE_USER_HOME:-$root/.tools/gradle-home}" "$gradle_command" -p sdks/android testDebugUnitTest

flutter_command="${FLUTTER_COMMAND:-}"
if [ -z "$flutter_command" ]; then flutter_command="$(find "$root/.tools" -type f -path '*/bin/flutter' -print -quit)"; fi
(cd sdks/flutter && "$flutter_command" pub get && "$flutter_command" analyze && "$flutter_command" test)
