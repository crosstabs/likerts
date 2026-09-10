#!/usr/bin/env bash
set -euo pipefail
host="$(cd "$(dirname "$0")" && pwd)"
pod_command="${POD_COMMAND:-pod}"
command -v xcodegen >/dev/null || { echo "XcodeGen is required." >&2; exit 1; }
command -v "$pod_command" >/dev/null || { echo "CocoaPods is required (or set POD_COMMAND to an executable wrapper)." >&2; exit 1; }
simulator="${LIKERTS_IOS_SIMULATOR_ID:-}"
if [ -z "$simulator" ]; then
  echo "Set LIKERTS_IOS_SIMULATOR_ID to the iOS simulator UUID to test." >&2
  exit 1
fi
node -e "const root=process.argv[1];if(require(root+'/../node_modules/react-native/package.json').version!=='0.86.3'||require(root+'/../node_modules/react/package.json').version!=='19.2.3')throw Error('Install the locked RN dependencies first')" "$host"
node "$host/bundle.cjs" ios
cd "$host/ios"
xcodegen generate
if [ -f Podfile.lock ]; then "$pod_command" install --deployment; else "$pod_command" install; fi
xcodebuild -quiet -workspace LikertsRNAcceptance.xcworkspace -scheme LikertsRNAcceptance \
  -destination "platform=iOS Simulator,id=$simulator" -derivedDataPath .derived \
  test CODE_SIGNING_ALLOWED=NO
echo "PASS: React Native iOS native controls emitted the exact expected answer map once. Synthetic host only; no hosted networking or billing assertion."
