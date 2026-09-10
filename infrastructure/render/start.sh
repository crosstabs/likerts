#!/bin/sh
set -eu
# Never enable shell tracing: environment values include credentials.
test -z "${LIKERTS_ALLOW_MEMORY:-}${LIKERTS_ALLOW_DEV_AUTH:-}${LIKERTS_DEV_TOKENS:-}${LIKERTS_RUN_MIGRATIONS:-}" || { echo 'Development and runtime-migration switches forbidden on Render' >&2; exit 1; }
case "${1:-}" in
  api)
    test -z "${LIKERTS_MIGRATION_DATABASE_URL:-}" || { echo 'Owner credential forbidden on API' >&2; exit 1; }
    test -z "${LIKERTS_WEBHOOK_DATABASE_URL:-}" || { echo 'Worker credential forbidden on API' >&2; exit 1; }
    : "${DATABASE_URL:?Restricted API database URL is required}"
    [ "${LIKERTS_ADMISSION_MODE:-required}" = required ] || { echo 'Distributed admission is mandatory on Render API' >&2; exit 1; }
    : "${LIKERTS_ADMISSION_REST_URL:?Admission Redis origin required}"
    : "${LIKERTS_ADMISSION_REST_TOKEN:?Admission Redis token required}"
    : "${LIKERTS_ADMISSION_NAMESPACE:?Shared admission namespace required}"
    : "${LIKERTS_OIDC_ISSUER:?OIDC issuer required}"
    : "${LIKERTS_OIDC_AUDIENCE:?OIDC audience required}"
    : "${LIKERTS_OIDC_JWKS_URL:?Explicit HTTPS JWKS URL required}"
    : "${LIKERTS_MANAGEMENT_ORIGINS:?Exact browser management origin required}"
    : "${LIKERTS_BROWSER_SESSION_ISSUER:?Browser session issuer required}"
    : "${LIKERTS_BROWSER_SESSION_AUDIENCE:?Browser session audience required}"
    : "${LIKERTS_BROWSER_SESSION_JWKS_URL:?Browser session JWKS URL required}"
    : "${LIKERTS_BROWSER_WORKSPACE_KEY:?Browser workspace derivation key required}"
    : "${LIKERTS_BROWSER_OAUTH_CLIENTS:?Registered browser-approved OAuth clients required}"
    : "${LIKERTS_MONITOR_TOKEN:?Separate monitor token required}"
    : "${LIKERTS_STRIPE_SECRET_KEY:?Stripe secret key required}"
    : "${LIKERTS_STRIPE_WEBHOOK_SECRET:?Stripe webhook secret required}"
    : "${LIKERTS_CHECKOUT_RETURN_ORIGIN:?Exact checkout return origin required}"
    case "$LIKERTS_STRIPE_SECRET_KEY" in
      sk_live_*)
        [ "${LIKERTS_STRIPE_LIVE_MODE:-}" = 1 ] || {
          echo 'Stripe live key requires LIKERTS_STRIPE_LIVE_MODE=1' >&2
          exit 1
        }
        ;;
    esac
    case "$DATABASE_URL" in *'?sslmode=require'|*'?sslmode=verify-full') ;; *) echo 'Explicit database TLS mode required' >&2; exit 1;; esac
    export LIKERTS_BIND_ADDRESS=0.0.0.0 LIKERTS_PORT="${PORT:-10000}"
    exec /usr/local/bin/likerts-server
    ;;
  worker)
    test -z "${LIKERTS_ADMISSION_REST_TOKEN:-}${DATABASE_URL:-}${LIKERTS_MIGRATION_DATABASE_URL:-}${LIKERTS_VERCEL_BLOB_TOKEN:-}${LIKERTS_STRIPE_SECRET_KEY:-}${LIKERTS_STRIPE_WEBHOOK_SECRET:-}${LIKERTS_STRIPE_LIVE_MODE:-}" || { echo 'Non-worker credential forbidden on callback worker' >&2; exit 1; }
    : "${LIKERTS_WEBHOOK_DATABASE_URL:?Restricted worker database URL is required}"
    case "$LIKERTS_WEBHOOK_DATABASE_URL" in *'?sslmode=require'|*'?sslmode=verify-full') ;; *) echo 'Explicit database TLS mode required' >&2; exit 1;; esac
    exec /usr/local/bin/likerts-webhook-worker
    ;;
  mcp)
    test -z "${LIKERTS_ADMISSION_REST_TOKEN:-}${DATABASE_URL:-}${LIKERTS_MIGRATION_DATABASE_URL:-}${LIKERTS_WEBHOOK_DATABASE_URL:-}${LIKERTS_VERCEL_BLOB_TOKEN:-}${LIKERTS_COLLECTION_CREDENTIAL_KEY:-}${LIKERTS_WEBHOOK_CREDENTIAL_KEY:-}${LIKERTS_MONITOR_TOKEN:-}${LIKERTS_BROWSER_WORKSPACE_KEY:-}${LIKERTS_STRIPE_SECRET_KEY:-}${LIKERTS_STRIPE_WEBHOOK_SECRET:-}" || { echo 'Data-plane credentials forbidden on MCP gateway' >&2; exit 1; }
    : "${LIKERTS_API_URL:?Canonical HTTPS API origin required}"
    : "${LIKERTS_MCP_PUBLIC_ORIGIN:?Canonical OAuth resource origin required}"
    : "${LIKERTS_OIDC_ISSUER:?OIDC issuer required}"
    : "${LIKERTS_MCP_ALLOWED_ORIGINS:?Exact MCP browser origin required}"
    export LIKERTS_MCP_BIND_ADDRESS=0.0.0.0 LIKERTS_MCP_PORT="${PORT:-10000}"
    exec /usr/local/bin/node /opt/likerts/tools/mcp/dist/remote-main.js
    ;;
  *) echo 'Select api, worker or mcp mode' >&2; exit 1 ;;
esac
