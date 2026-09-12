#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/sdks/react-native"
restore(){ npm ci >/dev/null; }
trap restore EXIT
for version in 0.85.0 0.86.3 0.87.0; do
  npm install --no-save --package-lock=false "react-native@$version" "@react-native/jest-preset@$version"
  npm run check
  npm test -- --runInBand
  echo "PASS: React Native $version with React 19.2.3"
done
