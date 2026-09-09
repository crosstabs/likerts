use likerts_server::billing::{ChargeRequest, PaymentProvider, StripePaymentProvider};

#[tokio::test]
#[ignore = "requires explicit Stripe test-mode credentials"]
async fn stripe_test_mode_charge_and_refund_agree() {
    let secret_key = std::env::var("LIKERTS_STRIPE_TEST_SECRET_KEY").unwrap();
    let webhook_secret = std::env::var("LIKERTS_STRIPE_TEST_WEBHOOK_SECRET").unwrap();
    let customer_id = std::env::var("LIKERTS_STRIPE_TEST_CUSTOMER_ID").unwrap();
    let payment_method_id = std::env::var("LIKERTS_STRIPE_TEST_PAYMENT_METHOD_ID").unwrap();
    let provider = StripePaymentProvider::new(secret_key, webhook_secret).unwrap();
    let logical_run = uuid::Uuid::new_v4().to_string();
    let intent = provider
        .create_charge(ChargeRequest {
            idempotency_key: format!("likerts-sandbox-{logical_run}"),
            customer_id,
            payment_method_id,
            amount_cents: 500,
        })
        .await
        .unwrap();
    assert!(intent.id.starts_with("pi_"));
    assert_eq!(intent.status, "succeeded");
    let refund = provider
        .refund(
            &intent.id,
            500,
            &format!("likerts-sandbox-refund-{logical_run}"),
        )
        .await
        .unwrap();
    assert!(refund.starts_with("re_"));
}
