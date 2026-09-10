use crate::Error;
use chrono::Utc;
use hmac::{Hmac, Mac};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use std::{collections::HashMap, future::Future, pin::Pin, sync::Mutex};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BillingAccountInput {
    pub provider_customer_id: String,
    pub provider_payment_method_id: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SettlementInput {
    pub idempotency_key: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RefundInput {
    pub amount_cents: u64,
    pub reason: String,
    pub idempotency_key: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreditCheckoutInput {
    pub amount_cents: u64,
    pub idempotency_key: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreditCheckout {
    pub id: String,
    pub amount_cents: u64,
    pub response_credits: u64,
    pub status: String,
    pub checkout_url: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settlement {
    pub id: String,
    pub amount_cents: u64,
    pub currency: String,
    pub status: String,
    pub provider_intent_id: Option<String>,
    pub failure_code: Option<String>,
}
#[derive(Clone, Debug)]
pub struct SettlementCharge {
    pub settlement: Settlement,
    pub customer_id: String,
    pub payment_method_id: String,
}

pub type ProviderFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, Error>> + Send + 'a>>;

#[derive(Clone, Debug)]
pub struct ChargeRequest {
    pub idempotency_key: String,
    pub customer_id: String,
    pub payment_method_id: String,
    pub amount_cents: u64,
}

#[derive(Clone, Debug)]
pub struct CheckoutRequest {
    pub idempotency_key: String,
    pub purchase_id: String,
    pub workspace_id: String,
    pub amount_cents: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ProviderCheckout {
    pub id: String,
    pub url: String,
    pub status: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ProviderIntent {
    pub id: String,
    pub status: String,
    pub failure_code: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ProviderEvent {
    pub id: String,
    pub event_type: String,
    pub intent_id: String,
    pub failure_code: Option<String>,
    pub amount_total: Option<u64>,
    pub currency: Option<String>,
    pub payment_status: Option<String>,
    pub client_reference_id: Option<String>,
    pub payment_intent_id: Option<String>,
    pub amount: Option<u64>,
    pub status: Option<String>,
}

pub trait PaymentProvider: Send + Sync {
    /// Public configuration label only; never includes provider credentials.
    fn mode(&self) -> &'static str;
    fn create_checkout<'a>(
        &'a self,
        request: CheckoutRequest,
    ) -> ProviderFuture<'a, ProviderCheckout>;
    fn create_charge<'a>(&'a self, request: ChargeRequest) -> ProviderFuture<'a, ProviderIntent>;
    fn retrieve<'a>(&'a self, intent_id: &'a str) -> ProviderFuture<'a, ProviderIntent>;
    fn refund<'a>(
        &'a self,
        intent_id: &'a str,
        amount_cents: u64,
        idempotency_key: &'a str,
    ) -> ProviderFuture<'a, String>;
    fn verify_event(&self, signature: &str, body: &[u8]) -> Result<ProviderEvent, Error>;
}

pub struct LocalPaymentProvider {
    intents: Mutex<HashMap<String, ProviderIntent>>,
    webhook_secret: Vec<u8>,
}

impl LocalPaymentProvider {
    pub fn new(webhook_secret: impl Into<Vec<u8>>) -> Self {
        Self {
            intents: Mutex::new(HashMap::new()),
            webhook_secret: webhook_secret.into(),
        }
    }
}

impl PaymentProvider for LocalPaymentProvider {
    fn mode(&self) -> &'static str {
        "test"
    }

    fn create_checkout<'a>(
        &'a self,
        request: CheckoutRequest,
    ) -> ProviderFuture<'a, ProviderCheckout> {
        Box::pin(async move {
            Ok(ProviderCheckout {
                id: format!("cs_test_{}", request.purchase_id),
                url: format!("https://checkout.stripe.test/{}", request.purchase_id),
                status: "open".into(),
            })
        })
    }

    fn create_charge<'a>(&'a self, request: ChargeRequest) -> ProviderFuture<'a, ProviderIntent> {
        Box::pin(async move {
            let mut intents = self.intents.lock().map_err(|_| Error::Internal)?;
            if let Some(prior) = intents.get(&request.idempotency_key) {
                return Ok(prior.clone());
            }
            let failed = request.payment_method_id == "pm_fail";
            let intent = ProviderIntent {
                id: format!("pi_local_{}", Uuid::new_v4().simple()),
                status: if failed { "failed" } else { "submitted" }.into(),
                failure_code: failed.then(|| "card_declined".into()),
            };
            intents.insert(request.idempotency_key, intent.clone());
            Ok(intent)
        })
    }

    fn retrieve<'a>(&'a self, intent_id: &'a str) -> ProviderFuture<'a, ProviderIntent> {
        Box::pin(async move {
            self.intents
                .lock()
                .map_err(|_| Error::Internal)?
                .values()
                .find(|intent| intent.id == intent_id)
                .cloned()
                .ok_or(Error::NotFound)
        })
    }

    fn refund<'a>(
        &'a self,
        intent_id: &'a str,
        amount_cents: u64,
        idempotency_key: &'a str,
    ) -> ProviderFuture<'a, String> {
        Box::pin(async move {
            if amount_cents == 0
                || idempotency_key.is_empty()
                || !self
                    .intents
                    .lock()
                    .map_err(|_| Error::Internal)?
                    .values()
                    .any(|intent| intent.id == intent_id)
            {
                return Err(Error::Invalid("invalid refund".into()));
            }
            Ok(format!("re_local_{}", Uuid::new_v4().simple()))
        })
    }

    fn verify_event(&self, signature: &str, body: &[u8]) -> Result<ProviderEvent, Error> {
        verify_stripe_event(
            &self.webhook_secret,
            signature,
            body,
            Utc::now().timestamp(),
        )
    }
}

#[derive(Clone)]
pub struct StripePaymentProvider {
    client: Client,
    secret_key: String,
    webhook_secret: Vec<u8>,
    api_origin: String,
    checkout_return_origin: String,
    live_mode: bool,
}

impl StripePaymentProvider {
    pub fn new(
        secret_key: String,
        webhook_secret: String,
        checkout_return_origin: String,
        allow_live_mode: bool,
    ) -> Result<Self, Error> {
        let test_key = secret_key.starts_with("sk_test_");
        let live_key = secret_key.starts_with("sk_live_");
        if (!test_key && !(allow_live_mode && live_key)) || !webhook_secret.starts_with("whsec_") {
            return Err(Error::Invalid(
                "Stripe credentials do not match the configured mode".into(),
            ));
        }
        let origin = reqwest::Url::parse(&checkout_return_origin)
            .map_err(|_| Error::Invalid("invalid checkout return origin".into()))?;
        if origin.scheme() != "https"
            || origin.host_str().is_none()
            || !origin.username().is_empty()
            || origin.password().is_some()
            || origin.path() != "/"
            || origin.query().is_some()
            || origin.fragment().is_some()
        {
            return Err(Error::Invalid("invalid checkout return origin".into()));
        }
        Ok(Self {
            client: Client::new(),
            secret_key,
            webhook_secret: webhook_secret.into_bytes(),
            api_origin: "https://api.stripe.com".into(),
            checkout_return_origin: checkout_return_origin.trim_end_matches('/').into(),
            live_mode: live_key,
        })
    }

    fn checkout_return_url(&self, purchase_id: &str, outcome: &str) -> Result<String, Error> {
        let mut url =
            reqwest::Url::parse(&self.checkout_return_origin).map_err(|_| Error::Internal)?;
        url.set_path("/app");
        url.query_pairs_mut()
            .append_pair("checkout", outcome)
            .append_pair("purchase_id", purchase_id);
        Ok(url.into())
    }
}

impl PaymentProvider for StripePaymentProvider {
    fn mode(&self) -> &'static str {
        if self.live_mode {
            "live"
        } else {
            "test"
        }
    }

    fn create_checkout<'a>(
        &'a self,
        request: CheckoutRequest,
    ) -> ProviderFuture<'a, ProviderCheckout> {
        Box::pin(async move {
            let body = serde_urlencoded::to_string([
                ("mode", "payment".to_owned()),
                (
                    "success_url",
                    self.checkout_return_url(&request.purchase_id, "success")?,
                ),
                (
                    "cancel_url",
                    self.checkout_return_url(&request.purchase_id, "cancelled")?,
                ),
                ("client_reference_id", request.purchase_id.clone()),
                ("metadata[likerts_purchase_id]", request.purchase_id.clone()),
                (
                    "metadata[likerts_workspace_id]",
                    request.workspace_id.clone(),
                ),
                (
                    "payment_intent_data[metadata][likerts_purchase_id]",
                    request.purchase_id.clone(),
                ),
                (
                    "payment_intent_data[metadata][likerts_workspace_id]",
                    request.workspace_id.clone(),
                ),
                ("line_items[0][price_data][currency]", "usd".to_owned()),
                (
                    "line_items[0][price_data][unit_amount]",
                    request.amount_cents.to_string(),
                ),
                (
                    "line_items[0][price_data][product_data][name]",
                    "Likerts response credits".to_owned(),
                ),
                ("line_items[0][quantity]", "1".to_owned()),
            ])
            .map_err(|_| Error::Internal)?;
            let response = self
                .client
                .post(format!("{}/v1/checkout/sessions", self.api_origin))
                .basic_auth(&self.secret_key, Some(""))
                .header("Idempotency-Key", request.idempotency_key)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(body)
                .send()
                .await
                .map_err(|_| Error::Internal)?;
            let status = response.status();
            let value: Value = response.json().await.map_err(|_| Error::Internal)?;
            if !status.is_success() {
                return Err(Error::Invalid("Stripe checkout rejected".into()));
            }
            Ok(ProviderCheckout {
                id: value
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or(Error::Internal)?
                    .into(),
                url: value
                    .get("url")
                    .and_then(Value::as_str)
                    .ok_or(Error::Internal)?
                    .into(),
                status: value
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("open")
                    .into(),
            })
        })
    }

    fn create_charge<'a>(&'a self, request: ChargeRequest) -> ProviderFuture<'a, ProviderIntent> {
        Box::pin(async move {
            let amount = i64::try_from(request.amount_cents)
                .map_err(|_| Error::Invalid("amount too large".into()))?;
            let body = serde_urlencoded::to_string([
                ("amount", amount.to_string()),
                ("currency", "usd".into()),
                ("customer", request.customer_id),
                ("payment_method", request.payment_method_id),
                ("confirm", "true".into()),
                ("off_session", "true".into()),
            ])
            .map_err(|_| Error::Internal)?;
            let response = self
                .client
                .post(format!("{}/v1/payment_intents", self.api_origin))
                .basic_auth(&self.secret_key, Some(""))
                .header("Idempotency-Key", request.idempotency_key)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(body)
                .send()
                .await
                .map_err(|_| Error::Internal)?;
            let status = response.status();
            let value: Value = response.json().await.map_err(|_| Error::Internal)?;
            if !status.is_success() {
                return Err(Error::Invalid("Stripe charge rejected".into()));
            }
            Ok(ProviderIntent {
                id: value
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or(Error::Internal)?
                    .into(),
                status: stripe_intent_status(
                    value
                        .get("status")
                        .and_then(Value::as_str)
                        .ok_or(Error::Internal)?,
                ),
                failure_code: value
                    .pointer("/last_payment_error/code")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            })
        })
    }

    fn retrieve<'a>(&'a self, intent_id: &'a str) -> ProviderFuture<'a, ProviderIntent> {
        Box::pin(async move {
            let response = self
                .client
                .get(format!(
                    "{}/v1/payment_intents/{intent_id}",
                    self.api_origin
                ))
                .basic_auth(&self.secret_key, Some(""))
                .send()
                .await
                .map_err(|_| Error::Internal)?;
            let status = response.status();
            let value: Value = response.json().await.map_err(|_| Error::Internal)?;
            if !status.is_success() {
                return Err(Error::NotFound);
            }
            Ok(ProviderIntent {
                id: value
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or(Error::Internal)?
                    .into(),
                status: stripe_intent_status(
                    value
                        .get("status")
                        .and_then(Value::as_str)
                        .ok_or(Error::Internal)?,
                ),
                failure_code: value
                    .pointer("/last_payment_error/code")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            })
        })
    }

    fn refund<'a>(
        &'a self,
        intent_id: &'a str,
        amount_cents: u64,
        idempotency_key: &'a str,
    ) -> ProviderFuture<'a, String> {
        Box::pin(async move {
            let body = serde_urlencoded::to_string([
                ("payment_intent", intent_id.to_owned()),
                ("amount", amount_cents.to_string()),
            ])
            .map_err(|_| Error::Internal)?;
            let response = self
                .client
                .post(format!("{}/v1/refunds", self.api_origin))
                .basic_auth(&self.secret_key, Some(""))
                .header("Idempotency-Key", idempotency_key)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(body)
                .send()
                .await
                .map_err(|_| Error::Internal)?;
            let status = response.status();
            let value: Value = response.json().await.map_err(|_| Error::Internal)?;
            if !status.is_success() {
                return Err(Error::Invalid("Stripe refund rejected".into()));
            }
            Ok(value
                .get("id")
                .and_then(Value::as_str)
                .ok_or(Error::Internal)?
                .into())
        })
    }

    fn verify_event(&self, signature: &str, body: &[u8]) -> Result<ProviderEvent, Error> {
        verify_stripe_event(
            &self.webhook_secret,
            signature,
            body,
            Utc::now().timestamp(),
        )
    }
}

fn stripe_intent_status(status: &str) -> String {
    match status {
        "succeeded" => "succeeded",
        "canceled" => "failed",
        "requires_payment_method" => "failed",
        _ => "submitted",
    }
    .into()
}

pub fn verify_stripe_event(
    secret: &[u8],
    signature: &str,
    body: &[u8],
    now: i64,
) -> Result<ProviderEvent, Error> {
    let mut timestamp = None;
    let mut signatures = Vec::new();
    for part in signature.split(',') {
        if let Some(value) = part.strip_prefix("t=") {
            timestamp = value.parse::<i64>().ok();
        }
        if let Some(value) = part.strip_prefix("v1=") {
            signatures.push(value);
        }
    }
    let timestamp = timestamp.ok_or(Error::Unauthorized)?;
    if (now - timestamp).abs() > 300 {
        return Err(Error::Unauthorized);
    }
    let mut signed = timestamp.to_string().into_bytes();
    signed.push(b'.');
    signed.extend_from_slice(body);
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).map_err(|_| Error::Internal)?;
    mac.update(&signed);
    let expected = format!("{:x}", mac.finalize().into_bytes());
    if !signatures
        .iter()
        .any(|candidate| constant_time_eq(candidate.as_bytes(), expected.as_bytes()))
    {
        return Err(Error::Unauthorized);
    }
    let envelope: StripeEnvelope =
        serde_json::from_slice(body).map_err(|_| Error::Invalid("invalid Stripe event".into()))?;
    Ok(ProviderEvent {
        id: envelope.id,
        event_type: envelope.event_type,
        intent_id: envelope.data.object.id,
        failure_code: envelope
            .data
            .object
            .last_payment_error
            .and_then(|error| error.code),
        amount_total: envelope.data.object.amount_total,
        currency: envelope.data.object.currency,
        payment_status: envelope.data.object.payment_status,
        client_reference_id: envelope.data.object.client_reference_id,
        payment_intent_id: envelope.data.object.payment_intent,
        amount: envelope.data.object.amount,
        status: envelope.data.object.status,
    })
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |diff, (a, b)| diff | (a ^ b))
        == 0
}

#[derive(Deserialize)]
struct StripeEnvelope {
    id: String,
    #[serde(rename = "type")]
    event_type: String,
    data: StripeData,
}
#[derive(Deserialize)]
struct StripeData {
    object: StripeObject,
}
#[derive(Deserialize)]
struct StripeObject {
    id: String,
    last_payment_error: Option<StripeError>,
    amount_total: Option<u64>,
    currency: Option<String>,
    payment_status: Option<String>,
    client_reference_id: Option<String>,
    payment_intent: Option<String>,
    amount: Option<u64>,
    status: Option<String>,
}
#[derive(Deserialize)]
struct StripeError {
    code: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stripe_checkout_returns_to_console_with_nonsecret_purchase_id_and_reports_mode() {
        let captured = std::sync::Arc::new(Mutex::new(None));
        let capture = captured.clone();
        let router = axum::Router::new().route("/v1/checkout/sessions", axum::routing::post(
            move |axum::Form(form): axum::Form<HashMap<String, String>>| {
                let capture = capture.clone();
                async move {
                    *capture.lock().unwrap() = Some(form);
                    axum::Json(serde_json::json!({"id":"cs_test_example","url":"https://checkout.stripe.com/c/example","status":"open"}))
                }
            },
        ));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let mut provider = StripePaymentProvider::new(
            "sk_test_fixture".into(),
            "whsec_fixture".into(),
            "https://likerts.example".into(),
            false,
        )
        .unwrap();
        provider.api_origin = format!("http://{address}");
        assert_eq!(provider.mode(), "test");
        let purchase_id = Uuid::new_v4().to_string();
        provider
            .create_checkout(CheckoutRequest {
                idempotency_key: "fixture-checkout".into(),
                purchase_id: purchase_id.clone(),
                workspace_id: "workspace-one".into(),
                amount_cents: 500,
            })
            .await
            .unwrap();
        let form = captured.lock().unwrap().take().unwrap();
        for (field, outcome) in [("success_url", "success"), ("cancel_url", "cancelled")] {
            let url = reqwest::Url::parse(&form[field]).unwrap();
            assert_eq!(
                url.origin().ascii_serialization(),
                "https://likerts.example"
            );
            assert_eq!(url.path(), "/app");
            assert_eq!(
                url.query_pairs().into_owned().collect::<HashMap<_, _>>(),
                HashMap::from([
                    ("checkout".into(), outcome.into()),
                    ("purchase_id".into(), purchase_id.clone())
                ])
            );
        }
        server.abort();
        assert!(StripePaymentProvider::new(
            "sk_live_fixture".into(),
            "whsec_fixture".into(),
            "https://likerts.example".into(),
            false
        )
        .is_err());
        assert_eq!(
            StripePaymentProvider::new(
                "sk_live_fixture".into(),
                "whsec_fixture".into(),
                "https://likerts.example".into(),
                true
            )
            .unwrap()
            .mode(),
            "live"
        );
        assert!(StripePaymentProvider::new(
            "sk_test_fixture".into(),
            "whsec_fixture".into(),
            "https://secret@likerts.example".into(),
            false
        )
        .is_err());
    }

    #[tokio::test]
    async fn local_provider_is_idempotent_and_failure_is_deterministic() {
        let provider = LocalPaymentProvider::new("secret");
        let checkout = provider
            .create_checkout(CheckoutRequest {
                idempotency_key: "checkout-one".into(),
                purchase_id: "purchase-one".into(),
                workspace_id: "workspace-one".into(),
                amount_cents: 500,
            })
            .await
            .unwrap();
        assert_eq!(checkout.status, "open");
        let request = ChargeRequest {
            idempotency_key: "one".into(),
            customer_id: "cus_local".into(),
            payment_method_id: "pm_ok".into(),
            amount_cents: 500,
        };
        let first = provider.create_charge(request.clone()).await.unwrap();
        assert_eq!(first, provider.create_charge(request).await.unwrap());
        let failed = provider
            .create_charge(ChargeRequest {
                idempotency_key: "two".into(),
                customer_id: "cus_local".into(),
                payment_method_id: "pm_fail".into(),
                amount_cents: 500,
            })
            .await
            .unwrap();
        assert_eq!(failed.failure_code.as_deref(), Some("card_declined"));
    }

    #[test]
    fn webhook_signature_and_age_are_verified() {
        let body = br#"{"id":"evt_1","type":"payment_intent.succeeded","data":{"object":{"id":"pi_1","last_payment_error":null}}}"#;
        let timestamp = 1_700_000_000;
        let mut mac = Hmac::<Sha256>::new_from_slice(b"secret").unwrap();
        mac.update(format!("{timestamp}.").as_bytes());
        mac.update(body);
        let signature = format!("t={timestamp},v1={:x}", mac.finalize().into_bytes());
        assert_eq!(
            verify_stripe_event(b"secret", &signature, body, timestamp)
                .unwrap()
                .intent_id,
            "pi_1"
        );
        assert!(matches!(
            verify_stripe_event(b"secret", &signature, body, timestamp + 301),
            Err(Error::Unauthorized)
        ));

        let checkout_body = br#"{"id":"evt_checkout","type":"checkout.session.completed","data":{"object":{"id":"cs_test_one","last_payment_error":null,"amount_total":500,"currency":"usd","payment_status":"paid","client_reference_id":"123e4567-e89b-12d3-a456-426614174010"}}}"#;
        let mut mac = Hmac::<Sha256>::new_from_slice(b"secret").unwrap();
        mac.update(format!("{timestamp}.").as_bytes());
        mac.update(checkout_body);
        let signature = format!("t={timestamp},v1={:x}", mac.finalize().into_bytes());
        let checkout =
            verify_stripe_event(b"secret", &signature, checkout_body, timestamp).unwrap();
        assert_eq!(checkout.intent_id, "cs_test_one");
        assert_eq!(checkout.amount_total, Some(500));
        assert_eq!(checkout.payment_status.as_deref(), Some("paid"));
    }
}
