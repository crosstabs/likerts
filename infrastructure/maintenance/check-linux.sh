#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
bundle=$(cd "${1:?Usage: check-linux.sh BINARY_OUTPUT_DIRECTORY linux/arm64\|linux/amd64}" && pwd)
platform=${2:-linux/arm64}
case "$platform" in linux/arm64|linux/amd64) ;; *) exit 2;; esac
# AWS's Node 22 Lambda image uses Amazon Linux 2023. This validates execution
# under the Lambda Linux family, not Vercel's entire managed invocation path.
docker run --rm --platform "$platform" --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --entrypoint /var/lang/bin/node --volume "$root:/checks:ro" --volume "$bundle:/bundle:ro" \
  public.ecr.aws/lambda/nodejs:22@sha256:c71939cdffffb125e6255fdb284ccde3c748bcba60658c7efc6d3a2241b2398b /checks/lambda-smoke.mjs /bundle
