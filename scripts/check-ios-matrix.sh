#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
for version in 15.0 16.0 17.0 18.0 26.0; do
  xcrun --sdk iphonesimulator swiftc -typecheck -target "arm64-apple-ios${version}-simulator" -sdk "$sdk" "$root"/sdks/ios/Sources/Likerts/*.swift
  echo "PASS: iOS $version deployment target typecheck"
done
