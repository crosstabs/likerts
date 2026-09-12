#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/dev-env.sh"

RUN_ID="$(date +%s)-$$"
CONTAINER="likerts-s3-$RUN_ID"
BUCKET="likerts-test-$RUN_ID"
ACCESS_KEY="likertstestaccess"
SECRET_KEY="likertstestsecretvalue"
cleanup() { docker rm --force "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run --detach --name "$CONTAINER" --publish 127.0.0.1::9000 \
  --env MINIO_ROOT_USER="$ACCESS_KEY" --env MINIO_ROOT_PASSWORD="$SECRET_KEY" \
  quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z server /data >/dev/null
PORT="$(docker port "$CONTAINER" 9000/tcp | sed -n 's/.*://p')"
for _ in $(seq 1 60); do
  if curl --fail --silent "http://127.0.0.1:$PORT/minio/health/ready" >/dev/null; then break; fi
  sleep 0.25
done
curl --fail --silent "http://127.0.0.1:$PORT/minio/health/ready" >/dev/null

export AWS_ACCESS_KEY_ID="$ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$SECRET_KEY"
export AWS_REGION="ap-southeast-1"
export AWS_EC2_METADATA_DISABLED=true
export LIKERTS_S3_ENDPOINT="http://127.0.0.1:$PORT"
export LIKERTS_ALLOW_S3_ENDPOINT=1
export LIKERTS_TEST_S3_BUCKET="$BUCKET"
cargo test --manifest-path "$ROOT/backend/Cargo.toml" --test s3_object_store \
  private_s3_store_roundtrips_and_deletes -- --ignored --exact
printf '%s\n' 'S3 object-store gate passed: fail-fast bucket access, bounded put/get and delete.'
