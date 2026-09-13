# The build context is a synthetic source-only directory made by build.sh.
# No database/provider/deployment credentials are accepted during compilation.
ARG RUST_IMAGE=rust:1.98.0-alpine@sha256:a10e64dd139b7387337c7fbe8aca31b959b57b2fd4c8ae20a02cf1d6ea424dce
FROM ${RUST_IMAGE} AS builder
RUN apk add --no-cache build-base cmake clang perl linux-headers ca-certificates binutils
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
ENV CARGO_BUILD_JOBS=2
RUN cargo build --release --locked --bin likerts-export-cleanup --bin likerts-erasure-archive \
    && mkdir /out \
    && cp target/release/likerts-export-cleanup target/release/likerts-erasure-archive /out/ \
    && cp /etc/ssl/certs/ca-certificates.crt /out/ \
    && ! readelf -l /out/likerts-export-cleanup | grep 'INTERP' \
    && ! readelf -l /out/likerts-erasure-archive | grep 'INTERP' \
    && ! readelf -d /out/likerts-export-cleanup | grep 'NEEDED' \
    && ! readelf -d /out/likerts-erasure-archive | grep 'NEEDED'
FROM scratch AS output
COPY --from=builder /out/ /
COPY source.json /source.json
