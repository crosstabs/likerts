# Test-only image. Released binaries are copied unchanged; no Rust rebuild.
FROM ghcr.io/crosstabs/likerts@sha256:40042f29d15f7fb18a1d95287b099fd94cf2185df3c637e3304d73764488ae7c AS released
FROM node@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96
COPY --from=released /usr/local/bin/likerts-server /usr/local/bin/likerts-server
COPY --from=released /usr/local/bin/likerts-webhook-worker /usr/local/bin/likerts-webhook-worker
COPY --from=released /usr/local/bin/likerts-migrate /usr/local/bin/likerts-migrate
WORKDIR /opt/fixture
COPY supervisor.mjs ./supervisor.mjs
RUN mkdir -p /tmp/likerts-drill-exports && chown 10001:10001 /tmp/likerts-drill-exports \
    && sha256sum /usr/local/bin/likerts-server /usr/local/bin/likerts-webhook-worker > /opt/fixture/binaries.sha256 \
    && ldd /usr/local/bin/likerts-server && ldd /usr/local/bin/likerts-webhook-worker
USER 10001:10001
ENV PORT=10000
EXPOSE 10000
STOPSIGNAL SIGTERM
CMD ["node", "/opt/fixture/supervisor.mjs"]
