#!/usr/bin/env bash
set -euo pipefail
LIKERTS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROMTOOL_IMAGE="${PROMTOOL_IMAGE:-prom/prometheus:v3.5.0}"
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
  --mount "type=bind,source=$LIKERTS_ROOT/infrastructure/observability,target=/etc/prometheus,readonly" \
  --workdir /etc/prometheus --entrypoint /bin/promtool "$PROMTOOL_IMAGE" check config --syntax-only prometheus.yml
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
  --mount "type=bind,source=$LIKERTS_ROOT/infrastructure/observability,target=/etc/prometheus,readonly" \
  --workdir /etc/prometheus --entrypoint /bin/promtool "$PROMTOOL_IMAGE" check rules alerts.yml
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:mode=1777 \
  --mount "type=bind,source=$LIKERTS_ROOT/infrastructure/observability,target=/etc/prometheus,readonly" \
  --workdir /etc/prometheus --entrypoint /bin/promtool "$PROMTOOL_IMAGE" test rules alerts.test.yml
