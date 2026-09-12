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

FROM ${RUNTIME_IMAGE} AS runtime
RUN apt-get update && apt-get install --yes --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 likerts \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin likerts \
    && install --directory --owner=10001 --group=10001 --mode=0700 /var/lib/likerts/exports
COPY --from=builder /out/likerts-server /usr/local/bin/likerts-server
COPY --from=builder /out/likerts-migrate /usr/local/bin/likerts-migrate
COPY --from=builder /out/likerts-webhook-worker /usr/local/bin/likerts-webhook-worker
USER 10001:10001
ENV LIKERTS_BIND_ADDRESS=0.0.0.0 \
    LIKERTS_PORT=8080 \
    LIKERTS_EXPORT_DIR=/var/lib/likerts/exports
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
    CMD curl --fail --silent --max-time 2 "http://127.0.0.1:${LIKERTS_PORT}/health" > /dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/likerts-server"]
