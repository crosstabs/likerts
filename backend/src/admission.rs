//! Fixed-key distributed admission before authentication. No client/IP identity.
use axum::{
    extract::{MatchedPath, Request, State},
    http::{header, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use reqwest::{redirect::Policy, Client, Url};
use serde_json::json;
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

// All replicas use the same three fixed keys. The first request starts a 1s
// Redis-clock window. Saturation does not increment counters or extend expiry.
const SCRIPT: &str = r#"
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count == 0 then
  redis.call('SET', KEYS[1], '1', 'PX', 1000)
  return {1, 0}
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then return redis.error_reply('admission_invalid_expiry') end
if count >= tonumber(ARGV[1]) then return {0, math.max(ttl, 1)} end
redis.call('INCR', KEYS[1])
return {1, 0}
"#;
const MAX_BODY_BYTES: usize = 4096;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Bucket {
    Management = 0,
    Browser = 1,
    Stripe = 2,
}
impl Bucket {
    fn key(self) -> &'static str {
        match self {
            Self::Management => "management",
            Self::Browser => "browser",
            Self::Stripe => "stripe",
        }
    }
}
fn bucket(path: &str) -> Option<Bucket> {
    if path == "/v1/webhooks/stripe" {
        Some(Bucket::Stripe)
    } else if path.starts_with("/v1/browser/") {
        Some(Bucket::Browser)
    } else if path.starts_with("/v1/") {
        Some(Bucket::Management)
    } else {
        None
    }
}
#[derive(Clone)]
pub struct Admission(Option<Arc<Inner>>);
struct Inner {
    url: Url,
    authorization: HeaderValue,
    namespace: String,
    client: Client,
    buckets: [LocalBucket; 3],
}
struct LocalBucket {
    limit: u32,
    window: Mutex<(Instant, u32)>,
    permits: Arc<Semaphore>,
}
#[derive(Debug)]
enum Denial {
    Limited(u64),
    Unavailable,
}
impl IntoResponse for Denial {
    fn into_response(self) -> Response {
        let (status, code, message, retry) = match self {
            Self::Limited(seconds) => (
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
                "Request admission limit reached",
                seconds,
            ),
            Self::Unavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "admission_unavailable",
                "Request admission is temporarily unavailable",
                1,
            ),
        };
        let mut response = (
            status,
            Json(json!({"error":{"code":code,"message":message}})),
        )
            .into_response();
        response.headers_mut().insert(
            header::RETRY_AFTER,
            HeaderValue::from_str(&retry.to_string()).expect("bounded number"),
        );
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        response
    }
}
impl LocalBucket {
    fn take(&self) -> Result<OwnedSemaphorePermit, Denial> {
        // Bound even unsuccessful Redis calls per process. A semaphore alone
        // would allow unlimited fast denial requests to reach the paid provider.
        let mut window = self.window.lock().unwrap_or_else(|e| e.into_inner());
        if window.0.elapsed() >= Duration::from_secs(1) {
            *window = (Instant::now(), 0);
        }
        if window.1 >= self.limit {
            return Err(Denial::Limited(1));
        }
        window.1 += 1;
        drop(window);
        self.permits
            .clone()
            .try_acquire_owned()
            .map_err(|_| Denial::Limited(1))
    }
}
impl Admission {
    pub fn from_env(development: bool) -> Result<Self, &'static str> {
        Self::from_settings(development, |name| std::env::var(name).ok())
    }
    fn from_settings(
        development: bool,
        get: impl Fn(&str) -> Option<String>,
    ) -> Result<Self, &'static str> {
        let mode = get("LIKERTS_ADMISSION_MODE").unwrap_or_else(|| "required".into());
        if mode == "disabled" {
            if !development
                || get("LIKERTS_ADMISSION_REST_URL").is_some()
                || get("LIKERTS_ADMISSION_REST_TOKEN").is_some()
            {
                return Err("Admission bypass requires explicit disposable development with no Redis credentials");
            }
            return Ok(Self(None));
        }
        if mode != "required" {
            return Err("Invalid admission mode");
        }
        let url = get("LIKERTS_ADMISSION_REST_URL").ok_or("Admission Redis URL is required")?;
        let token =
            get("LIKERTS_ADMISSION_REST_TOKEN").ok_or("Admission Redis token is required")?;
        let namespace =
            get("LIKERTS_ADMISSION_NAMESPACE").ok_or("Admission namespace is required")?;
        let number = |name: &str, default: u32, max: u32| -> Result<u32, &'static str> {
            let value = match get(name) {
                Some(raw) => raw
                    .parse::<u32>()
                    .map_err(|_| "Invalid admission numeric bound")?,
                None => default,
            };
            if value == 0 || value > max {
                return Err("Invalid admission numeric bound");
            }
            Ok(value)
        };
        let limits = [
            number("LIKERTS_ADMISSION_MANAGEMENT_RPS", 30, 1000)?,
            number("LIKERTS_ADMISSION_BROWSER_RPS", 10, 1000)?,
            number("LIKERTS_ADMISSION_STRIPE_RPS", 10, 1000)?,
        ];
        let timeout = number("LIKERTS_ADMISSION_TIMEOUT_MS", 750, 2000)?;
        if timeout < 50 {
            return Err("Admission timeout must be at least 50 milliseconds");
        }
        Self::new(
            &url,
            &token,
            &namespace,
            limits,
            Duration::from_millis(timeout.into()),
            development,
        )
    }
    fn new(
        raw_url: &str,
        token: &str,
        namespace: &str,
        limits: [u32; 3],
        timeout: Duration,
        development: bool,
    ) -> Result<Self, &'static str> {
        let url = Url::parse(raw_url).map_err(|_| "Invalid admission Redis origin")?;
        let loopback = development
            && url.scheme() == "http"
            && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
        if !(url.scheme() == "https" || loopback)
            || !url.username().is_empty()
            || url.password().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
            || url.host_str().is_none()
            || (url.scheme() == "https" && url.port().is_some())
            || raw_url.trim() != raw_url
        {
            return Err("Admission Redis requires an exact HTTPS origin; disposable development permits loopback HTTP");
        }
        if !(16..=8192).contains(&token.len()) || !token.bytes().all(|b| b.is_ascii_graphic()) {
            return Err("Invalid admission Redis credential");
        }
        if namespace.is_empty()
            || namespace.len() > 64
            || !namespace
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        {
            return Err("Invalid admission namespace");
        }
        let mut authorization = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_| "Invalid admission Redis credential")?;
        authorization.set_sensitive(true);
        let client = Client::builder()
            .redirect(Policy::none())
            .retry(reqwest::retry::never())
            .no_proxy()
            .timeout(timeout)
            .connect_timeout(timeout)
            .build()
            .map_err(|_| "Unable to configure admission HTTP client")?;
        Ok(Self(Some(Arc::new(Inner {
            url,
            authorization,
            namespace: namespace.into(),
            client,
            buckets: std::array::from_fn(|i| LocalBucket {
                limit: limits[i],
                window: Mutex::new((Instant::now(), 0)),
                permits: Arc::new(Semaphore::new([32, 8, 8][i])),
            }),
        }))))
    }
    async fn admit(&self, kind: Bucket) -> Result<Option<OwnedSemaphorePermit>, Denial> {
        let Some(inner) = &self.0 else {
            return Ok(None);
        };
        let local = &inner.buckets[kind as usize];
        let permit = local.take()?;
        let key = format!("likerts:admission:v1:{}:{}", inner.namespace, kind.key());
        let command = json!(["EVAL", SCRIPT, 1, key, local.limit.to_string()]);
        let mut response = inner
            .client
            .post(inner.url.clone())
            .header(header::AUTHORIZATION, inner.authorization.clone())
            .json(&command)
            .send()
            .await
            .map_err(|_| Denial::Unavailable)?;
        if !response.status().is_success()
            || response
                .content_length()
                .is_some_and(|n| n > MAX_BODY_BYTES as u64)
        {
            return Err(Denial::Unavailable);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Denial::Unavailable)? {
            if bytes.len().saturating_add(chunk.len()) > MAX_BODY_BYTES {
                return Err(Denial::Unavailable);
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| Denial::Unavailable)?;
        if value.get("error").is_some() {
            return Err(Denial::Unavailable);
        }
        let result = value
            .get("result")
            .and_then(|v| v.as_array())
            .filter(|a| a.len() == 2)
            .ok_or(Denial::Unavailable)?;
        match (result[0].as_u64(), result[1].as_u64()) {
            (Some(1), Some(0)) => Ok(Some(permit)),
            (Some(0), Some(ms)) if (1..=1000).contains(&ms) => {
                Err(Denial::Limited(ms.div_ceil(1000)))
            }
            _ => Err(Denial::Unavailable),
        }
    }
}
pub async fn enforce(State(admission): State<Admission>, request: Request, next: Next) -> Response {
    // Framework route templates, never forwarded headers, token text or tenant
    // IDs, choose one of exactly three keys. Unknown routes have no auth handler.
    let kind = request
        .extensions()
        .get::<MatchedPath>()
        .and_then(|path| bucket(path.as_str()));
    let Some(kind) = kind else {
        return next.run(request).await;
    };
    match admission.admit(kind).await {
        Ok(_permit) => next.run(request).await,
        Err(denial) => denial.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    #[test]
    fn production_configuration_is_required_and_bypass_is_explicit() {
        assert!(Admission::from_settings(false, |_| None).is_err());
        assert!(Admission::from_settings(true, |_| None).is_err());
        let get = |key: &str| {
            if key == "LIKERTS_ADMISSION_MODE" {
                Some("disabled".into())
            } else {
                None
            }
        };
        assert!(Admission::from_settings(false, get).is_err());
        assert!(Admission::from_settings(true, get).is_ok());
        let mut values = HashMap::from([
            ("LIKERTS_ADMISSION_REST_URL", "https://example.upstash.io"),
            ("LIKERTS_ADMISSION_REST_TOKEN", "synthetic-token-long"),
            ("LIKERTS_ADMISSION_NAMESPACE", "preview"),
        ]);
        assert!(
            Admission::from_settings(false, |key| values.get(key).map(|v| v.to_string())).is_ok()
        );
        values.insert("LIKERTS_ADMISSION_MANAGEMENT_RPS", "0");
        assert!(
            Admission::from_settings(false, |key| values.get(key).map(|v| v.to_string())).is_err()
        );
    }
    #[test]
    fn origins_credentials_and_key_namespace_are_bounded() {
        for url in [
            "http://redis.internal",
            "https://user:password@redis.example",
            "https://redis.example/path",
            "https://redis.example/?token=secret",
            "https://redis.example/#x",
            "https://redis.example:8443",
            " https://redis.example",
        ] {
            assert!(Admission::new(
                url,
                "synthetic-token-long",
                "preview",
                [30, 10, 10],
                Duration::from_millis(750),
                false
            )
            .is_err());
        }
        assert!(Admission::new(
            "http://127.0.0.1:1234",
            "synthetic-token-long",
            "preview",
            [30, 10, 10],
            Duration::from_millis(750),
            true
        )
        .is_ok());
        assert!(Admission::new(
            "https://redis.example",
            "secret\nleak",
            "preview",
            [30, 10, 10],
            Duration::from_millis(750),
            false
        )
        .is_err());
        assert!(Admission::new(
            "https://redis.example",
            "synthetic-token-long",
            "tenant:attacker",
            [30, 10, 10],
            Duration::from_millis(750),
            false
        )
        .is_err());
        assert_eq!(bucket("/health"), None);
        assert_eq!(bucket("/.well-known/oauth-protected-resource"), None);
        assert_eq!(bucket("/v1/webhooks/stripe"), Some(Bucket::Stripe));
        assert_eq!(bucket("/v1/browser/bootstrap"), Some(Bucket::Browser));
        assert_eq!(
            bucket("/v1/collections/{id}/responses"),
            Some(Bucket::Management)
        );
    }
    #[tokio::test]
    async fn local_rate_and_concurrency_bound_before_any_redis_work() {
        let local = LocalBucket {
            limit: 2,
            window: Mutex::new((Instant::now(), 0)),
            permits: Arc::new(Semaphore::new(1)),
        };
        let first = local.take().unwrap();
        assert!(matches!(local.take(), Err(Denial::Limited(1))));
        drop(first);
        assert!(matches!(local.take(), Err(Denial::Limited(1))));
        *local.window.lock().unwrap() = (Instant::now() - Duration::from_secs(2), 2);
        assert!(local.take().is_ok());
    }

    #[tokio::test]
    async fn concurrency_permit_is_held_through_the_handler_and_released_afterward() {
        use axum::{middleware, routing::get, routing::post, Router};
        use std::sync::atomic::{AtomicUsize, Ordering};
        use tokio::sync::Notify;
        use tower::ServiceExt;

        let calls = Arc::new(AtomicUsize::new(0));
        let counted = calls.clone();
        let provider = Router::new().route(
            "/",
            post(move || {
                counted.fetch_add(1, Ordering::SeqCst);
                async { Json(json!({"result": [1, 0]})) }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, provider).await.unwrap() });
        let mut admission = Admission::new(
            &origin,
            "synthetic-token-long",
            "handler-test",
            [100, 100, 100],
            Duration::from_millis(750),
            true,
        )
        .unwrap();
        Arc::get_mut(admission.0.as_mut().unwrap()).unwrap().buckets[0].permits =
            Arc::new(Semaphore::new(1));
        let entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let app = Router::new()
            .route(
                "/v1/held",
                get({
                    let entered = entered.clone();
                    let release = release.clone();
                    move || {
                        let entered = entered.clone();
                        let release = release.clone();
                        async move {
                            entered.notify_one();
                            release.notified().await;
                            StatusCode::OK
                        }
                    }
                }),
            )
            .route("/v1/ready", get(|| async { StatusCode::OK }))
            .layer(middleware::from_fn_with_state(admission, enforce));
        let request = |path| {
            Request::builder()
                .uri(path)
                .body(axum::body::Body::empty())
                .unwrap()
        };
        let held = tokio::spawn(app.clone().oneshot(request("/v1/held")));
        tokio::time::timeout(Duration::from_secs(2), entered.notified())
            .await
            .unwrap();
        let denied = app.clone().oneshot(request("/v1/ready")).await.unwrap();
        assert_eq!(denied.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        release.notify_one();
        assert_eq!(held.await.unwrap().unwrap().status(), StatusCode::OK);
        assert_eq!(
            app.oneshot(request("/v1/ready")).await.unwrap().status(),
            StatusCode::OK
        );
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        server.abort();
    }
}
