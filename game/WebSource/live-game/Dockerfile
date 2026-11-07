FROM node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --chown=node:node web ./web
COPY --chown=node:node deployment ./deployment
COPY --chown=node:node scripts/check-runtime.mjs ./scripts/check-runtime.mjs
RUN node scripts/check-runtime.mjs

USER node
ENV NODE_ENV=production PORT=4311 LIKERTS_LIVE_BIND_ADDRESS=0.0.0.0
EXPOSE 4311
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/live/liveness').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server/index.mjs"]
