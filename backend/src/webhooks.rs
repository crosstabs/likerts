//! Customer-configured response event delivery. No survey distribution.
use crate::Error;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use reqwest::{redirect::Policy, Client, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    time::Duration,
};
use uuid::Uuid;

pub const MAX_ENDPOINTS: i64 = 5;
pub const MAX_ATTEMPTS: u32 = 7;
pub const MAX_REPLAYS: u32 = 3;
pub const EVENT_RETENTION_DAYS: i64 = 7;
pub const ATTEMPT_LEASE_SECONDS: i64 = 30;
pub const SIGNATURE_TOLERANCE_SECONDS: i64 = 300;
const RETRY_DELAYS: [u64; 6] = [60, 240, 960, 3840, 15360, 61440];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EndpointInput {
    pub idempotency_key: String,
    pub url: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EndpointUpdate {
    pub enabled: Option<bool>,
    pub revoke: Option<bool>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WebhookOperationInput {
    pub idempotency_key: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub id: String,
    pub url: String,
    pub enabled: bool,
    pub revoked: bool,
    pub key_id: String,
    pub created_at: DateTime<Utc>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointCredential {
    pub endpoint: Endpoint,
    pub signing_secret: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Delivery {
    pub id: String,
    pub endpoint_id: String,
    pub event_id: String,
    pub status: String,
    pub attempts: u32,
    pub replay_count: u32,
    pub next_attempt_at: DateTime<Utc>,
    pub last_status: Option<u16>,
    pub failure_code: Option<String>,
    pub expires_at: DateTime<Utc>,
}
#[derive(Clone)]
pub struct Dispatch {
    pub workspace: String,
    pub delivery_id: String,
    pub event_id: String,
    pub endpoint_id: String,
    pub attempt_id: String,
    pub attempt_number: u32,
    pub key_id: String,
    pub signature_timestamp: i64,
    pub url: String,
    pub body: String,
    pub signing_secret: String,
}

/// Digest-only storage: distinct runtime master key, endpoint and signing generation.
#[derive(Clone)]
pub struct WebhookKeys([u8; 32]);
impl WebhookKeys {
    pub fn new(master: &[u8]) -> Result<Self, Error> {
        let key: [u8; 32] = master
            .try_into()
            .map_err(|_| Error::Invalid("webhook credential key must contain 32 bytes".into()))?;
        Ok(Self(key))
    }
    pub fn secret(&self, workspace: &str, endpoint: Uuid, generation: Uuid) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.0).expect("fixed HMAC key");
        mac.update(b"likerts.response-webhook.signing.v1\0");
        mac.update(&(workspace.len() as u64).to_be_bytes());
        mac.update(workspace.as_bytes());
        mac.update(endpoint.as_bytes());
        mac.update(generation.as_bytes());
        format!(
            "whsec_{}",
            URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
        )
    }
    pub fn reconstruct(
        &self,
        workspace: &str,
        endpoint: Uuid,
        generation: Uuid,
        digest: &[u8],
    ) -> Result<String, Error> {
        let secret = self.secret(workspace, endpoint, generation);
        let expected = secret_digest(&secret);
        if digest.len() != 32
            || expected
                .iter()
                .zip(digest)
                .fold(0u8, |difference, (a, b)| difference | (a ^ b))
                != 0
        {
            return Err(Error::Internal);
        }
        Ok(secret)
    }
}
pub fn secret_digest(secret: &str) -> Vec<u8> {
    Sha256::digest(secret.as_bytes()).to_vec()
}

/// Delays after a failed attempt; no automatic retry after seven attempts.
pub fn retry_delay(attempt: u32) -> Option<Duration> {
    attempt
        .checked_sub(1)
        .and_then(|i| RETRY_DELAYS.get(i as usize))
        .map(|seconds| Duration::from_secs(*seconds))
}
pub fn retryable_status(status: u16) -> bool {
    status == 408 || status == 429 || (500..600).contains(&status)
}

pub fn signature(
    secret: &str,
    key_id: &str,
    event_id: &str,
    timestamp: i64,
    body: &[u8],
) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC key");
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b".");
    mac.update(event_id.as_bytes());
    mac.update(b".");
    mac.update(body);
    let hex = mac
        .finalize()
        .into_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    format!("t={timestamp},kid={key_id},v1={hex}")
}
/// Reference receiver verifier: verify exact raw bytes before decoding JSON.
pub fn verify_signature(
    secret: &str,
    expected_key_id: &str,
    event_id: &str,
    header: &str,
    body: &[u8],
    now: i64,
) -> bool {
    if body.len() > 4096 || header.len() > 256 || Uuid::parse_str(event_id).is_err() {
        return false;
    }
    let parts = header.split(',').collect::<Vec<_>>();
    if parts.len() != 3 {
        return false;
    }
    let Some(timestamp) = parts[0]
        .strip_prefix("t=")
        .and_then(|v| v.parse::<i64>().ok())
    else {
        return false;
    };
    if timestamp.abs_diff(now) > SIGNATURE_TOLERANCE_SECONDS as u64
        || parts[1].strip_prefix("kid=") != Some(expected_key_id)
    {
        return false;
    }
    let Some(hex) = parts[2].strip_prefix("v1=") else {
        return false;
    };
    if hex.len() != 64 {
        return false;
    }
    let Some(bytes) = hex
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            std::str::from_utf8(pair)
                .ok()
                .and_then(|s| u8::from_str_radix(s, 16).ok())
        })
        .collect::<Option<Vec<_>>>()
    else {
        return false;
    };
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC key");
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b".");
    mac.update(event_id.as_bytes());
    mac.update(b".");
    mac.update(body);
    mac.verify_slice(&bytes).is_ok()
}

pub fn validate_endpoint(value: &str) -> Result<Url, Error> {
    if value.len() > 2048 || value.trim() != value || value.chars().any(char::is_control) {
        return Err(Error::Invalid("invalid webhook endpoint".into()));
    }
    let url = Url::parse(value).map_err(|_| Error::Invalid("invalid webhook endpoint".into()))?;
    let host = url
        .host_str()
        .ok_or_else(|| Error::Invalid("webhook endpoint requires a host".into()))?;
    if url.scheme() != "https"
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || host.parse::<IpAddr>().is_ok()
        || host.starts_with('[')
        || !host.contains('.')
        || host.ends_with('.')
        || [
            ".localhost",
            ".local",
            ".internal",
            ".invalid",
            ".test",
            ".example",
            ".onion",
        ]
        .iter()
        .any(|suffix| host.ends_with(suffix))
    {
        return Err(Error::Invalid(
            "webhooks require a public HTTPS hostname on port 443 without credentials or fragments"
                .into(),
        ));
    }
    Ok(url)
}
fn in_v4(ip: Ipv4Addr, network: Ipv4Addr, bits: u32) -> bool {
    let mask = u32::MAX << (32 - bits);
    u32::from(ip) & mask == u32::from(network) & mask
}
fn in_v6(ip: Ipv6Addr, network: Ipv6Addr, bits: u32) -> bool {
    let mask = u128::MAX << (128 - bits);
    u128::from(ip) & mask == u128::from(network) & mask
}
/// Conservative public Internet allow policy; cloud metadata, transition and special-use ranges fail closed.
pub fn public_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) => {
            let denied = [
                ([0, 0, 0, 0], 8),
                ([10, 0, 0, 0], 8),
                ([100, 64, 0, 0], 10),
                ([127, 0, 0, 0], 8),
                ([169, 254, 0, 0], 16),
                ([172, 16, 0, 0], 12),
                ([192, 0, 0, 0], 24),
                ([192, 0, 2, 0], 24),
                ([192, 88, 99, 0], 24),
                ([192, 168, 0, 0], 16),
                ([198, 18, 0, 0], 15),
                ([198, 51, 100, 0], 24),
                ([203, 0, 113, 0], 24),
                ([224, 0, 0, 0], 4),
                ([240, 0, 0, 0], 4),
            ];
            ip != Ipv4Addr::new(168, 63, 129, 16)
                && !denied
                    .iter()
                    .any(|(network, bits)| in_v4(ip, Ipv4Addr::from(*network), *bits))
        }
        IpAddr::V6(ip) => {
            in_v6(ip, Ipv6Addr::new(0x2000, 0, 0, 0, 0, 0, 0, 0), 3)
                && ![
                    (Ipv6Addr::new(0x2001, 0, 0, 0, 0, 0, 0, 0), 23),
                    (Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 0), 32),
                    (Ipv6Addr::new(0x2002, 0, 0, 0, 0, 0, 0, 0), 16),
                    (Ipv6Addr::new(0x3fff, 0, 0, 0, 0, 0, 0, 0), 20),
                ]
                .iter()
                .any(|(network, bits)| in_v6(ip, *network, *bits))
        }
    }
}
pub fn validate_addresses(addresses: &[SocketAddr]) -> Result<(), Error> {
    if addresses.is_empty()
        || addresses.len() > 32
        || addresses
            .iter()
            .any(|address| address.port() != 443 || !public_address(address.ip()))
    {
        return Err(Error::Invalid(
            "webhook DNS must resolve only to public Internet addresses".into(),
        ));
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq)]
pub enum AttemptOutcome {
    Delivered(u16),
    Retry(Option<u16>, &'static str),
    Failed(Option<u16>, &'static str),
}
/// Resolve afresh, validate every address, then pin that exact set while retaining hostname TLS verification.
pub async fn deliver(dispatch: &Dispatch) -> AttemptOutcome {
    if dispatch.body.len() > 4096 {
        return AttemptOutcome::Failed(None, "event_too_large");
    }
    let url = match validate_endpoint(&dispatch.url) {
        Ok(url) => url,
        Err(_) => return AttemptOutcome::Failed(None, "endpoint_invalid"),
    };
    let host = url.host_str().expect("validated hostname").to_owned();
    let addresses = match tokio::time::timeout(
        Duration::from_secs(5),
        tokio::net::lookup_host((host.as_str(), 443)),
    )
    .await
    {
        Ok(Ok(values)) => values.collect::<Vec<_>>(),
        _ => return AttemptOutcome::Retry(None, "dns_failed"),
    };
    if validate_addresses(&addresses).is_err() {
        return AttemptOutcome::Failed(None, "endpoint_address_denied");
    }
    let client = match Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .retry(reqwest::retry::never())
        .https_only(true)
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        .resolve_to_addrs(&host, &addresses)
        .build()
    {
        Ok(client) => client,
        Err(_) => return AttemptOutcome::Failed(None, "transport_configuration"),
    };
    send_request(&client, url, dispatch).await
}

// Only deliver() reaches this in production, after URL/DNS validation and IP pinning.
async fn send_request(client: &Client, url: Url, dispatch: &Dispatch) -> AttemptOutcome {
    let result = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("User-Agent", "Likerts-Webhooks/1")
        .header("Likerts-Event-Id", &dispatch.event_id)
        .header("Likerts-Delivery-Id", &dispatch.delivery_id)
        .header("Likerts-Attempt-Id", &dispatch.attempt_id)
        .header(
            "Likerts-Signature",
            signature(
                &dispatch.signing_secret,
                &dispatch.key_id,
                &dispatch.event_id,
                dispatch.signature_timestamp,
                dispatch.body.as_bytes(),
            ),
        )
        .body(dispatch.body.clone())
        .send()
        .await;
    // Response bodies are never read, parsed, followed, stored or logged.
    match result {
        Ok(response) => {
            let status = response.status().as_u16();
            if (200..300).contains(&status) {
                AttemptOutcome::Delivered(status)
            } else if retryable_status(status) {
                AttemptOutcome::Retry(Some(status), "http_retryable")
            } else {
                AttemptOutcome::Failed(Some(status), "http_rejected")
            }
        }
        Err(_) => AttemptOutcome::Retry(None, "transport_failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn wire_headers_sign_raw_bytes_and_statuses_never_follow_redirects() {
        use axum::{
            body::Bytes,
            extract::{Path, State},
            http::{HeaderMap, StatusCode},
            response::IntoResponse,
            routing::post,
            Router,
        };
        use std::sync::{Arc, Mutex};
        type Captured = Arc<Mutex<Vec<(HeaderMap, Vec<u8>)>>>;
        async fn receive(
            State(captured): State<Captured>,
            Path(status): Path<u16>,
            headers: HeaderMap,
            body: Bytes,
        ) -> impl IntoResponse {
            captured.lock().unwrap().push((headers, body.to_vec()));
            (
                StatusCode::from_u16(status).unwrap(),
                [("location", "/200")],
                "receiver-private-body",
            )
        }
        let captured: Captured = Arc::new(Mutex::new(vec![]));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let router = Router::new()
            .route("/{status}", post(receive))
            .with_state(captured.clone());
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let client = Client::builder()
            .no_proxy()
            .redirect(Policy::none())
            .retry(reqwest::retry::never())
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let dispatch = Dispatch {
            workspace: "test".into(),
            delivery_id: Uuid::new_v4().to_string(),
            event_id: Uuid::new_v4().to_string(),
            endpoint_id: Uuid::new_v4().to_string(),
            attempt_id: Uuid::new_v4().to_string(),
            attempt_number: 1,
            key_id: Uuid::new_v4().to_string(),
            signature_timestamp: 1000,
            url: "https://hooks.customer.com/".into(),
            body: "{\"value\": \"é\"}".into(),
            signing_secret: "whsec_test".into(),
        };
        for (status, expected) in [
            (204, AttemptOutcome::Delivered(204)),
            (429, AttemptOutcome::Retry(Some(429), "http_retryable")),
            (503, AttemptOutcome::Retry(Some(503), "http_retryable")),
            (400, AttemptOutcome::Failed(Some(400), "http_rejected")),
            (307, AttemptOutcome::Failed(Some(307), "http_rejected")),
        ] {
            assert_eq!(
                send_request(
                    &client,
                    Url::parse(&format!("http://{address}/{status}")).unwrap(),
                    &dispatch
                )
                .await,
                expected
            );
        }
        let values = captured.lock().unwrap();
        assert_eq!(
            values.len(),
            5,
            "HTTP redirects or implicit retries must not create another request"
        );
        for (headers, body) in values.iter() {
            assert_eq!(body, dispatch.body.as_bytes());
            assert_eq!(headers["likerts-event-id"], dispatch.event_id);
            assert_eq!(headers["likerts-attempt-id"], dispatch.attempt_id);
            assert_eq!(headers["content-type"], "application/json");
            assert!(verify_signature(
                &dispatch.signing_secret,
                &dispatch.key_id,
                &dispatch.event_id,
                headers["likerts-signature"].to_str().unwrap(),
                body,
                1000
            ));
        }
        task.abort();
    }
    #[test]
    fn signs_exact_bytes_and_rejects_stale_or_modified_events() {
        let id = Uuid::new_v4().to_string();
        let key = Uuid::new_v4().to_string();
        let body = b"{\"type\":\"response.accepted\"}";
        let header = signature("secret", &key, &id, 1000, body);
        assert!(verify_signature("secret", &key, &id, &header, body, 1001));
        assert!(!verify_signature("secret", &key, &id, &header, b"{}", 1001));
        assert!(!verify_signature(
            "secret",
            &key,
            &Uuid::new_v4().to_string(),
            &header,
            body,
            1001
        ));
        assert!(!verify_signature("secret", &key, &id, &header, body, 1301));
        assert!(!verify_signature("secret", &key, &id, &header, body, 699));
        assert!(!verify_signature(
            "secret",
            &key,
            &id,
            &format!("{header},v1=00"),
            body,
            1000
        ));
    }
    #[test]
    fn derived_secrets_are_scoped_rotatable_and_digest_checked() {
        let keys = WebhookKeys::new(&[9; 32]).unwrap();
        let endpoint = Uuid::new_v4();
        let generation = Uuid::new_v4();
        let secret = keys.secret("a", endpoint, generation);
        assert_eq!(
            keys.reconstruct("a", endpoint, generation, &secret_digest(&secret))
                .unwrap(),
            secret
        );
        assert_ne!(keys.secret("b", endpoint, generation), secret);
        assert_ne!(keys.secret("a", endpoint, Uuid::new_v4()), secret);
        assert!(WebhookKeys::new(&[8; 32])
            .unwrap()
            .reconstruct("a", endpoint, generation, &secret_digest(&secret))
            .is_err());
    }
    #[test]
    fn endpoint_parser_rejects_credentials_ports_and_obfuscated_addresses() {
        assert!(validate_endpoint("https://hooks.customer.com/likerts?tenant=one").is_ok());
        for value in [
            "http://hooks.customer.com/x",
            "https://user:pass@hooks.customer.com/",
            "https://hooks.customer.com:8443/",
            "https://127.0.0.1/",
            "https://2130706433/",
            "https://0x7f000001/",
            "https://[::1]/",
            "https://localhost/",
            "https://metadata.google.internal/",
            "https://customer.com/#x",
            "https://customer.com./",
        ] {
            assert!(validate_endpoint(value).is_err(), "{value}")
        }
    }
    #[test]
    fn every_resolved_address_must_be_public_and_pinned_to_https() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "172.16.1.1",
            "192.168.1.1",
            "100.64.0.1",
            "168.63.129.16",
            "198.18.0.1",
            "192.0.2.1",
            "224.0.0.1",
            "240.0.0.1",
            "::1",
            "::ffff:8.8.8.8",
            "64:ff9b::808:808",
            "fd00::1",
            "fe80::1",
            "2001:db8::1",
            "2002:0808:0808::1",
            "3fff::1",
        ] {
            assert!(!public_address(ip.parse().unwrap()), "{ip}")
        }
        for ip in [
            "8.8.8.8",
            "1.1.1.1",
            "2606:4700:4700::1111",
            "2001:4860:4860::8888",
        ] {
            assert!(public_address(ip.parse().unwrap()), "{ip}")
        }
        assert!(validate_addresses(&[
            "8.8.8.8:443".parse().unwrap(),
            "127.0.0.1:443".parse().unwrap()
        ])
        .is_err());
        assert!(validate_addresses(&[]).is_err());
        assert!(validate_addresses(&["8.8.8.8:80".parse().unwrap()]).is_err());
    }
    #[test]
    fn retries_are_bounded_and_do_not_retry_redirects_or_permanent_errors() {
        assert!(retry_delay(0).is_none());
        assert_eq!(retry_delay(1).unwrap().as_secs(), 60);
        assert_eq!(retry_delay(6).unwrap().as_secs(), 61440);
        assert!(retry_delay(7).is_none());
        for status in [408, 429, 500, 503] {
            assert!(retryable_status(status))
        }
        for status in [200, 301, 307, 400, 401, 403, 404, 410] {
            assert!(!retryable_status(status))
        }
    }
}
