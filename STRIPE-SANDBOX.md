# Stripe sandbox and checkout gate

BILL-02 uses Stripe PaymentIntents for aggregated off-session test-mode settlement. The local deterministic provider proves repository behavior without a network dependency, but it is not payment-provider evidence.

The provider adapter gate requires four secrets supplied only to the test process:

```sh
export LIKERTS_STRIPE_TEST_SECRET_KEY='sk_test_...'
export LIKERTS_STRIPE_TEST_WEBHOOK_SECRET='whsec_...'
export LIKERTS_STRIPE_TEST_CUSTOMER_ID='cus_...'
export LIKERTS_STRIPE_TEST_PAYMENT_METHOD_ID='pm_...'
bash scripts/check-stripe-sandbox.sh
```

The customer and payment method must belong to the same Stripe test-mode account and permit a US$5 charge. The existing gate creates one idempotent PaymentIntent, requires it to succeed, refunds the full amount with a separate idempotency key, and checks provider IDs. This verifies the provider adapter only.

The product purchase path uses Stripe Checkout. Set `LIKERTS_STRIPE_SECRET_KEY`, `LIKERTS_STRIPE_WEBHOOK_SECRET`, and the exact HTTPS `LIKERTS_CHECKOUT_RETURN_ORIGIN` on the API service. Register `/v1/webhooks/stripe` for the four `checkout.session.*` lifecycle events, `refund.created`, `refund.updated`, `refund.failed`, and `charge.dispute.*`. A confirmed US$5 Checkout Session creates exactly 500 paid response credits. The local PostgreSQL gate proves exact amount/currency/reference matching and deduplication. The hosted sandbox gate completed the browser return, signed webhook and retry without double-crediting.

Test keys are accepted by default. A live `sk_live_` key is accepted only when `LIKERTS_STRIPE_LIVE_MODE=1`; leave that switch unset until hosted refunds/disputes, legal terms and account ownership are ready. A missing credential skips the network test and leaves BILL-02 open; it does not count as a pass.

Webhook processing verifies Stripe's timestamped HMAC signature within five minutes before parsing or changing storage. Provider event IDs are deduplicated durably, conflicting reuse is rejected, and the verified PaymentIntent resolves exactly one checkout. Cumulative refund and dispute objects converge under the workspace billing lock. Provider withholding can create signed paid-credit debt after consumption; debt blocks new acceptance without changing prior receipts, promotional credits or gross usage.
