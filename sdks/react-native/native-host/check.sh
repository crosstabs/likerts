#!/usr/bin/env bash
set -euo pipefail
host="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$host/../../.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-$(find "$root/.tools/jdk" -type d -path '*/Contents/Home' -print -quit)}"
export ANDROID_HOME="${ANDROID_HOME:-$root/.tools/android-sdk}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$root/.tools/gradle-home}"
export ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
gradle_command="${GRADLE_COMMAND:-$root/.tools/gradle-8.11.1/bin/gradle}"
node -e "const r=require('$host/../node_modules/react-native/package.json'); const react=require('$host/../node_modules/react/package.json'); if(r.version!=='0.86.3'||react.version!=='19.2.3')throw Error('Native acceptance requires the locked RN 0.86.3 / React 19.2.3 baseline');"
node "$host/bundle.cjs"
"$gradle_command" -p "$host/android" :app:checkDebugAarMetadata
python3 "$host/build-native.py"
"$gradle_command" -p "$host/android" :app:assembleDebug
"$ANDROID_HOME/platform-tools/adb" -s "$ANDROID_SERIAL" install -r "$host/android/app/build/outputs/apk/debug/app-debug.apk"
python3 "$host/check-device.py"
