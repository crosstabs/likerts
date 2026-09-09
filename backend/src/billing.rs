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
}

pub trait PaymentProvider: Send + Sync {
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
}

impl StripePaymentProvider {
    pub fn new(secret_key: String, webhook_secret: String) -> Result<Self, Error> {
        if !secret_key.starts_with("sk_test_") || !webhook_secret.starts_with("whsec_") {
            return Err(Error::Invalid("Stripe test credentials required".into()));
        }
        Ok(Self {
            client: Client::new(),
            secret_key,
            webhook_secret: webhook_secret.into_bytes(),
            api_origin: "https://api.stripe.com".into(),
        })
    }
}

impl PaymentProvider for StripePaymentProvider {
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
}
#[derive(Deserialize)]
struct StripeError {
    code: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn local_provider_is_idempotent_and_failure_is_deterministic() {
        let provider = LocalPaymentProvider::new("secret");
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
    }
}
