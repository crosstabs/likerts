#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/dev-env.sh"
required=(LIKERTS_STRIPE_TEST_SECRET_KEY LIKERTS_STRIPE_TEST_WEBHOOK_SECRET LIKERTS_STRIPE_TEST_CUSTOMER_ID LIKERTS_STRIPE_TEST_PAYMENT_METHOD_ID)
for name in "${required[@]}"; do
  if [ -z "${!name:-}" ]; then
    echo "Stripe sandbox gate unavailable: $name is not set" >&2
    exit 2
  fi
done
cd "$LIKERTS_ROOT"
cargo test --manifest-path backend/Cargo.toml --locked --test stripe_sandbox -- --ignored --exact stripe_test_mode_charge_and_refund_agree
