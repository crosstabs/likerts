# Stripe sandbox settlement gate

BILL-02 uses Stripe PaymentIntents for aggregated off-session test-mode settlement. The local deterministic provider proves repository behavior without a network dependency, but it is not payment-provider evidence.

The real sandbox gate requires four secrets supplied only to the test process:

```sh
export LIKERTS_STRIPE_TEST_SECRET_KEY='sk_test_...'
export LIKERTS_STRIPE_TEST_WEBHOOK_SECRET='whsec_...'
export LIKERTS_STRIPE_TEST_CUSTOMER_ID='cus_...'
export LIKERTS_STRIPE_TEST_PAYMENT_METHOD_ID='pm_...'
bash scripts/check-stripe-sandbox.sh
```

The customer and payment method must belong to the same Stripe test-mode account and permit a US$5 charge. The existing gate creates one idempotent PaymentIntent, requires it to succeed, refunds the full amount with a separate idempotency key, and checks provider IDs. This verifies the provider adapter only. BILL-02 additionally requires proving that one confirmed US$5 purchase creates exactly 500 paid response credits, retries never double-credit and a refund or reversal removes only refundable paid value. No live key is accepted. A missing credential skips the network test and leaves BILL-02 open; it does not count as a pass.

Webhook processing must verify Stripe's timestamped HMAC signature within five minutes before parsing or changing storage. Provider event IDs are deduplicated durably, the PaymentIntent capability resolves exactly one workspace, and repeated or out-of-order success/failure events cannot duplicate settlement or adjustments.
