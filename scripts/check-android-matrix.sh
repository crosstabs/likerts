#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
java_home="${JAVA_HOME:-}"
if [ -z "$java_home" ]; then java_home="$(find "$root/.tools/jdk" -type d -path '*/Contents/Home' -print -quit)"; fi
android_home="${ANDROID_HOME:-$root/.tools/android-sdk}"
gradle_command="${GRADLE_COMMAND:-}"
if [ -z "$gradle_command" ]; then gradle_command="$(find "$root/.tools" -type f -path '*/bin/gradle' -print -quit)"; fi
export JAVA_HOME="$java_home" ANDROID_HOME="$android_home" GRADLE_USER_HOME="${GRADLE_USER_HOME:-$root/.tools/gradle-home}"

"$gradle_command" -p "$root/sdks/android" testDebugUnitTest assembleDebug assembleDebugAndroidTest :sample:assembleDebug

if "$android_home/platform-tools/adb" devices 2>/dev/null | awk 'NR > 1 && $2 == "device" { found=1 } END { exit !found }'; then
  "$gradle_command" -p "$root/sdks/android" connectedDebugAndroidTest
else
  echo "Android unit, API-26 compile, sample APK and instrumented-test APK passed; no booted device, so connected tests were skipped." >&2
fi
