#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
example="$root/sdks/ios/Example"
cleanup(){ python3 - "$example" <<'PY'
from pathlib import Path
import shutil,sys
root=Path(sys.argv[1])
for name in ('.derived','LikertsSample.xcodeproj'):
    path=root/name
    if path.exists(): shutil.rmtree(path)
PY
}
trap cleanup EXIT
command -v xcodegen >/dev/null 2>&1
device_id="${LIKERTS_IOS_SIMULATOR_ID:-$(xcrun simctl list devices available | sed -n 's/.*(\([0-9A-F-]\{36\}\)) (Booted).*/\1/p' | head -1)}"
if [ -z "$device_id" ]; then echo "A booted iOS simulator is required" >&2; exit 1; fi
(cd "$example" && xcodegen generate)
xcodebuild -quiet -project "$example/LikertsSample.xcodeproj" -scheme LikertsSample -destination "platform=iOS Simulator,id=$device_id" -derivedDataPath "$example/.derived" test CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-
echo "PASS: Likerts sample UI and Keychain/CryptoKit offline tests completed on simulator $device_id. Simulator-only ad hoc entitlements do not certify a production host or physical device."
