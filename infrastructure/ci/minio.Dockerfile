# CI-only MinIO fixture; the source version matches the previous image pin.
FROM golang:1.27.3-bookworm@sha256:d9b6a1beb9474adc2a1ce842573639b44b2a0dd49b6669f51d3821baf9ec37c9 AS build

ENV CGO_ENABLED=0 GOTOOLCHAIN=local GIT_TERMINAL_PROMPT=0
WORKDIR /src
RUN git init . \
    && git remote add origin https://github.com/minio/minio.git \
    && git fetch --depth=1 origin 0d7408fc9969caf07de6a8c3a84f9fbb10a6739e \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = 0d7408fc9969caf07de6a8c3a84f9fbb10a6739e
RUN ldflags="$(MINIO_RELEASE=RELEASE go run -mod=readonly buildscripts/gen-ldflags.go 2025-04-22T22:12:26Z)" \
    && go build -mod=readonly -tags kqueue -trimpath -ldflags "$ldflags" -o /out/minio . \
    && mkdir -p /out/rootfs/tmp /out/rootfs/data \
    && chmod 1777 /out/rootfs/tmp

FROM scratch
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.revision="0d7408fc9969caf07de6a8c3a84f9fbb10a6739e" \
      org.opencontainers.image.version="RELEASE.2025-04-22T22-12-26Z"
COPY --from=build /out/rootfs/ /
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /src/LICENSE /LICENSE
COPY --from=build /out/minio /minio
WORKDIR /data
ENTRYPOINT ["/minio"]
