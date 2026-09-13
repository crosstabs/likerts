#!/usr/bin/env bash
set -euo pipefail
umask 077
repository=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
platform=${1:-linux/arm64}
output=${2:?Usage: build.sh linux/arm64\|linux/amd64 NEW_OUTPUT_DIRECTORY}
case "$platform" in linux/arm64|linux/amd64) ;; *) echo 'Unsupported build platform' >&2; exit 2;; esac
[[ ! -e "$output" ]] || { echo 'Output directory must not already exist' >&2; exit 2; }
staging=$(mktemp -d "${TMPDIR:-/tmp}/likerts-maintenance-source.XXXXXX")
image="likerts-maintenance-build-$$"
container=""
cleanup() {
  if [[ -n "$container" ]]; then docker rm "$container" >/dev/null 2>&1 || true; fi
  docker image rm "$image" >/dev/null 2>&1 || true
  rm -rf "$staging"
}
trap cleanup EXIT
cp "$repository/backend/Cargo.toml" "$repository/backend/Cargo.lock" "$staging/"
cp -R "$repository/backend/src" "$repository/backend/migrations" "$staging/"
build_image=${LIKERTS_MAINTENANCE_RUST_IMAGE:-rust:1.98.0-alpine@sha256:a10e64dd139b7387337c7fbe8aca31b959b57b2fd4c8ae20a02cf1d6ea424dce}
node "$repository/infrastructure/maintenance/source-manifest.mjs" "$repository" "$staging" "$build_image"
# Immutable image references can be supplied by a reviewed release pipeline.
# docker does not inherit host environment variables as build arguments.
docker build --platform "$platform" --file "$repository/infrastructure/maintenance/Dockerfile" \
  --build-arg "RUST_IMAGE=$build_image" \
  --tag "$image" "$staging"
mkdir -p "$output"
container=$(docker create --entrypoint /not-executed "$image")
docker cp "$container:/." "$output/"
node "$repository/infrastructure/maintenance/package.mjs" "$output" "$platform"
