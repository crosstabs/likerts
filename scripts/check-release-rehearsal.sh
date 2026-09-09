#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
container="likerts-release-rehearsal-$$"
state_file="$(mktemp)"
backend_log="$(mktemp)"
export_dir="$(mktemp -d)"
backend_pid=""
chmod 600 "$state_file" "$backend_log"

cleanup() {
  if [ -n "$backend_pid" ]; then kill "$backend_pid" >/dev/null 2>&1 || true; wait "$backend_pid" >/dev/null 2>&1 || true; fi
  docker stop "$container" >/dev/null 2>&1 || true
  rm -f "$state_file" "$backend_log"
  rm -rf "$export_dir"
}
trap cleanup EXIT

source "$root/scripts/dev-env.sh"
cargo build --manifest-path "$root/backend/Cargo.toml" --locked --bin likerts-server
docker run --rm --detach --name "$container" --env POSTGRES_PASSWORD=release-rehearsal --publish 127.0.0.1::5432 postgres:17-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$container" pg_isready --username postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec "$container" pg_isready --username postgres >/dev/null
database_port="$(docker port "$container" 5432/tcp | sed 's/.*://')"
backend_port="$(node -e "const n=require('net').createServer();n.listen(0,'127.0.0.1',()=>{console.log(n.address().port);n.close()})")"
management_token="release-rehearsal-management-token"

DATABASE_URL="postgres://postgres:release-rehearsal@127.0.0.1:${database_port}/postgres" \
LIKERTS_RUN_MIGRATIONS=1 LIKERTS_ALLOW_MEMORY=1 LIKERTS_ALLOW_DEV_AUTH=1 \
LIKERTS_DEV_TOKENS="{\"$management_token\":\"release-rehearsal\"}" \
LIKERTS_COLLECTION_CREDENTIAL_KEY="$(openssl rand -base64 32 | tr -d '\n')" \
LIKERTS_EXPORT_DIR="$export_dir" LIKERTS_PORT="$backend_port" \
"$root/backend/target/debug/likerts-server" >"$backend_log" 2>&1 &
backend_pid=$!
export LIKERTS_REHEARSAL_BASE_URL="http://127.0.0.1:$backend_port"
export LIKERTS_REHEARSAL_MANAGEMENT_TOKEN="$management_token"
export LIKERTS_REHEARSAL_DATABASE_CONTAINER="$container"
for _ in $(seq 1 100); do curl --fail --silent "$LIKERTS_REHEARSAL_BASE_URL/health" >/dev/null 2>&1 && break; sleep 0.1; done
if ! curl --fail --silent "$LIKERTS_REHEARSAL_BASE_URL/health" >/dev/null; then cat "$backend_log" >&2; exit 1; fi

node "$root/release/rehearsal-driver.mjs" setup "$state_file" "$root/release/local-rehearsal-evidence.json"
export LIKERTS_REHEARSAL_COLLECTION_ID="$(node -e "const s=JSON.parse(require('fs').readFileSync(process.argv[1]));process.stdout.write(s.collectionId)" "$state_file")"
export LIKERTS_REHEARSAL_COLLECTION_TOKEN="$(node -e "const s=JSON.parse(require('fs').readFileSync(process.argv[1]));process.stdout.write(s.collectionToken)" "$state_file")"

npm --prefix "$root/sdks/web" run build
node "$root/sdks/web/test/release-rehearsal.mjs"
npm --prefix "$root/sdks/react-native" test -- --runInBand --runTestsByPath test/Rehearsal.test.ts
swift test --package-path "$root/sdks/ios" --filter ContractTests.testReleaseRehearsalLoopback

java_home="${JAVA_HOME:-}"
if [ -z "$java_home" ]; then java_home="$(find "$root/.tools/jdk" -type d -path '*/Contents/Home' -print -quit)"; fi
gradle_command="${GRADLE_COMMAND:-}"
if [ -z "$gradle_command" ]; then gradle_command="$(find "$root/.tools" -type f -path '*/bin/gradle' -print -quit)"; fi
JAVA_HOME="$java_home" ANDROID_HOME="${ANDROID_HOME:-$root/.tools/android-sdk}" GRADLE_USER_HOME="${GRADLE_USER_HOME:-$root/.tools/gradle-home}" \
  "$gradle_command" -p "$root/sdks/android" testDebugUnitTest --rerun-tasks --tests com.likerts.sdk.ContractTest.releaseRehearsalLoopback

flutter_command="${FLUTTER_COMMAND:-$root/.tools/flutter/bin/flutter}"
(cd "$root/sdks/flutter" && "$flutter_command" test test/release_rehearsal_test.dart)

node "$root/release/rehearsal-driver.mjs" finalize "$state_file" "$root/release/local-rehearsal-evidence.json"
for forbidden in "$management_token" "$LIKERTS_REHEARSAL_COLLECTION_TOKEN" 'one intent' 'must remain unbilled'; do
  if rg --fixed-strings --quiet -- "$forbidden" "$backend_log"; then
    echo 'Release rehearsal failed: backend log contains a credential or response-content sentinel.' >&2
    exit 1
  fi
done
echo "PASS: REL-01A exercised the real PostgreSQL backend and all five collection SDK clients."
