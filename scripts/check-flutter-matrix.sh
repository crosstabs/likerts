#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
flutter_command="${FLUTTER_COMMAND:-}"
if [ -z "$flutter_command" ] && [ -x "$root/.tools/flutter/bin/flutter" ]; then flutter_command="$root/.tools/flutter/bin/flutter"; fi
if [ -z "$flutter_command" ]; then flutter_command="$(find "$root/.tools" -type f -path '*/bin/flutter' -print -quit)"; fi
if [ -z "$flutter_command" ]; then echo "Flutter is required" >&2; exit 1; fi

export ANDROID_HOME="${ANDROID_HOME:-$root/.tools/android-sdk}"
java_home="${JAVA_HOME:-}"
if [ -z "$java_home" ] && [ -d "$root/.tools/jdk" ]; then java_home="$(find "$root/.tools/jdk" -type d -path '*/Contents/Home' -print -quit)"; fi
if [ -n "$java_home" ]; then export JAVA_HOME="$java_home"; fi

version="$($flutter_command --version --machine | sed -n 's/.*"frameworkVersion": *"\([^"]*\)".*/\1/p')"
major="${version%%.*}"; remainder="${version#*.}"; minor="${remainder%%.*}"
if [ -z "$version" ] || [ "$major" -lt 3 ] || { [ "$major" -eq 3 ] && [ "$minor" -lt 32 ]; }; then
  echo "Likerts requires Flutter 3.32 or newer; found ${version:-unknown}" >&2
  exit 1
fi

(cd "$root/sdks/flutter" && "$flutter_command" clean && "$flutter_command" pub get && "$flutter_command" analyze && "$flutter_command" test)
(cd "$root/sdks/flutter/example" && "$flutter_command" clean && "$flutter_command" pub get && "$flutter_command" analyze && "$flutter_command" build apk --debug)
if command -v xcrun >/dev/null 2>&1; then
  (cd "$root/sdks/flutter/example" && "$flutter_command" build ios --simulator --debug)
fi
if [ -n "${FLUTTER_ANDROID_DEVICE:-}" ]; then
  (cd "$root/sdks/flutter/example" && "$flutter_command" test integration_test/survey_flow_test.dart -d "$FLUTTER_ANDROID_DEVICE")
fi
if [ -n "${FLUTTER_IOS_SIMULATOR:-}" ]; then
  (cd "$root/sdks/flutter/example" && "$flutter_command" test integration_test/survey_flow_test.dart -d "$FLUTTER_IOS_SIMULATOR")
fi

echo "Flutter $version package, Android sample and iOS simulator sample passed."
