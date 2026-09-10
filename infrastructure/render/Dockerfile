ARG RUST_IMAGE=rust:1.98.0-slim-bookworm
ARG RUNTIME_IMAGE=debian:bookworm-slim
FROM ${RUST_IMAGE} AS builder
RUN apt-get update && apt-get install --yes --no-install-recommends build-essential ca-certificates cmake \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build/backend
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src ./src
COPY backend/migrations ./migrations
RUN cargo build --locked --release --bins \
    && install --directory /out \
    && install --mode=0755 target/release/likerts-server /out/likerts-server \
    && install --mode=0755 target/release/likerts-migrate /out/likerts-migrate \
    && install --mode=0755 target/release/likerts-webhook-worker /out/likerts-webhook-worker \
    && rm -rf target

FROM node:22-bookworm-slim AS mcp-builder
WORKDIR /build/mcp
COPY tools/mcp/package.json tools/mcp/package-lock.json ./
RUN npm ci
COPY tools/mcp/tsconfig.json ./
COPY tools/mcp/src ./src
RUN npm run build && npm prune --omit=dev

FROM ${RUNTIME_IMAGE} AS runtime
RUN apt-get update && apt-get install --yes --no-install-recommends ca-certificates curl postgresql-client \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 likerts \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/likerts --shell /bin/sh likerts \
    && install --directory --owner=10001 --group=10001 --mode=0700 /home/likerts/.ssh \
    && install --directory --owner=10001 --group=10001 --mode=0700 /var/lib/likerts/exports
COPY --from=builder /out/likerts-server /usr/local/bin/likerts-server
COPY --from=builder /out/likerts-migrate /usr/local/bin/likerts-migrate
COPY --from=builder /out/likerts-webhook-worker /usr/local/bin/likerts-webhook-worker
COPY --from=mcp-builder /usr/local/bin/node /usr/local/bin/node
COPY --from=mcp-builder /build/mcp/package.json /opt/likerts/tools/mcp/package.json
COPY --from=mcp-builder /build/mcp/dist /opt/likerts/tools/mcp/dist
COPY --from=mcp-builder /build/mcp/node_modules /opt/likerts/tools/mcp/node_modules
COPY tools/capabilities.json /opt/likerts/tools/capabilities.json
COPY contracts/openapi.json /opt/likerts/contracts/openapi.json
COPY infrastructure/render/start.sh infrastructure/render/migrate.sh infrastructure/render/bootstrap-rehearsal.sh infrastructure/render/verify-export-reclaim.sh infrastructure/render/diagnose-roles.sh infrastructure/render/diagnose-roles.sql /opt/likerts/render/
COPY infrastructure/render/bootstrap.sql /opt/likerts/render/bootstrap.sql
COPY backend/provision-runtime.sql /opt/likerts/render/provision-runtime.sql
COPY infrastructure/webhooks/provision-worker.sql /opt/likerts/render/provision-worker.sql
USER 10001:10001
ENV LIKERTS_BIND_ADDRESS=0.0.0.0 \
    LIKERTS_PORT=8080 \
    LIKERTS_EXPORT_DIR=/var/lib/likerts/exports
EXPOSE 8080
STOPSIGNAL SIGTERM
CMD ["/bin/sh", "/opt/likerts/render/start.sh", "api"]
