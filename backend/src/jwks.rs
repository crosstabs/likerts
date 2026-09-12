//! Bounded provider key refresh shared by browser and OAuth verification.
//! Unknown key IDs must not turn every invalid JWT into a provider request.
use crate::Error;
use jsonwebtoken::jwk::JwkSet;
use reqwest::{Client, Url};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, RwLock};

const CACHE_TTL: Duration = Duration::from_secs(600);
const REFRESH_INTERVAL: Duration = Duration::from_secs(30);
const MAX_JWKS_BYTES: usize = 256 * 1024;

#[derive(Clone, Default)]
pub(crate) struct JwksCache {
    keys: Arc<RwLock<Option<(JwkSet, Instant)>>>,
    last_attempt: Arc<Mutex<Option<Instant>>>,
}

impl JwksCache {
    pub(crate) async fn keys_for(
        &self,
        client: &Client,
        url: &Url,
        kid: &str,
    ) -> Result<JwkSet, Error> {
        if kid.is_empty() || kid.len() > 256 {
            return Err(Error::Unauthorized);
        }
        if let Some((keys, fetched)) = self.keys.read().await.as_ref() {
            if fetched.elapsed() < CACHE_TTL && keys.find(kid).is_some() {
                return Ok(keys.clone());
            }
        }
        // Serialize refreshes, including unsuccessful attempts, and recheck after
        // acquiring the lock so a concurrent successful refresh is reused.
        let mut last_attempt = self.last_attempt.lock().await;
        let cached = self.keys.read().await.clone();
        if let Some((keys, fetched)) = &cached {
            if fetched.elapsed() < CACHE_TTL && keys.find(kid).is_some() {
                return Ok(keys.clone());
            }
        }
        if last_attempt.is_some_and(|attempt| attempt.elapsed() < REFRESH_INTERVAL) {
            return Err(
                if cached.is_some_and(|(_, fetched)| fetched.elapsed() < CACHE_TTL) {
                    Error::Unauthorized
                } else {
                    Error::Internal
                },
            );
        }
        *last_attempt = Some(Instant::now());
        let keys = fetch_keys(client, url).await?;
        *self.keys.write().await = Some((keys.clone(), Instant::now()));
        if keys.find(kid).is_none() {
            return Err(Error::Unauthorized);
        }
        Ok(keys)
    }
}

async fn fetch_keys(client: &Client, url: &Url) -> Result<JwkSet, Error> {
    let mut response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|_| Error::Internal)?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|size| size > MAX_JWKS_BYTES as u64)
    {
        return Err(Error::Internal);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| Error::Internal)? {
        if bytes.len().saturating_add(chunk.len()) > MAX_JWKS_BYTES {
            return Err(Error::Internal);
        }
        bytes.extend_from_slice(&chunk);
    }
    let keys: JwkSet = serde_json::from_slice(&bytes).map_err(|_| Error::Internal)?;
    if keys.keys.is_empty() {
        return Err(Error::Internal);
    }
    Ok(keys)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    async fn fixture(
        body: String,
        status: axum::http::StatusCode,
    ) -> (
        Url,
        Arc<AtomicUsize>,
        Arc<Mutex<String>>,
        tokio::task::JoinHandle<()>,
    ) {
        let requests = Arc::new(AtomicUsize::new(0));
        let calls = requests.clone();
        let response_body = Arc::new(Mutex::new(body));
        let body = response_body.clone();
        let app = axum::Router::new().route(
            "/keys",
            axum::routing::get(move || {
                let calls = calls.clone();
                let body = body.clone();
                async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    (status, body.lock().await.clone())
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = Url::parse(&format!("http://{}/keys", listener.local_addr().unwrap())).unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (url, requests, response_body, server)
    }

    #[tokio::test]
    async fn unknown_keys_and_concurrent_refreshes_are_bounded_but_known_keys_keep_working() {
        let (url, requests, response_body, server) = fixture(
            r#"{"keys":[{"kty":"oct","k":"ZmFrZQ","kid":"known"}]}"#.into(),
            axum::http::StatusCode::OK,
        )
        .await;
        let client = Client::new();
        let cache = JwksCache::default();
        let mut tasks = Vec::new();
        for n in 0..24 {
            let (cache, client, url) = (cache.clone(), client.clone(), url.clone());
            tasks.push(tokio::spawn(async move {
                cache.keys_for(&client, &url, &format!("invalid-{n}")).await
            }));
        }
        for task in tasks {
            assert!(matches!(task.await.unwrap(), Err(Error::Unauthorized)));
        }
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        assert!(cache.keys_for(&client, &url, "known").await.is_ok());
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        // A subsequent rotation attempt is allowed after the bounded interval.
        *response_body.lock().await =
            r#"{"keys":[{"kty":"oct","k":"ZmFrZQ","kid":"new-key"}]}"#.into();
        assert!(matches!(
            cache.keys_for(&client, &url, "new-key").await,
            Err(Error::Unauthorized)
        ));
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        *cache.last_attempt.lock().await = Some(Instant::now() - REFRESH_INTERVAL);
        assert!(cache.keys_for(&client, &url, "new-key").await.is_ok());
        assert_eq!(requests.load(Ordering::SeqCst), 2);
        server.abort();
    }

    #[tokio::test]
    async fn failed_and_oversized_provider_responses_are_bounded_without_stale_fallback() {
        for (body, status) in [
            (
                "unavailable".into(),
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
            ),
            (" ".repeat(MAX_JWKS_BYTES + 1), axum::http::StatusCode::OK),
        ] {
            let (url, requests, _, server) = fixture(body, status).await;
            let cache = JwksCache::default();
            for _ in 0..3 {
                assert!(matches!(
                    cache.keys_for(&Client::new(), &url, "known").await,
                    Err(Error::Internal)
                ));
            }
            assert_eq!(requests.load(Ordering::SeqCst), 1);
            assert!(cache.keys.read().await.is_none());
            server.abort();
        }
    }

    #[tokio::test]
    async fn expired_cached_keys_never_bypass_a_failed_refresh() {
        let (url, requests, _, server) = fixture(
            "unavailable".into(),
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
        )
        .await;
        let cache = JwksCache::default();
        *cache.keys.write().await = Some((
            serde_json::from_str(r#"{"keys":[{"kty":"oct","k":"ZmFrZQ","kid":"known"}]}"#).unwrap(),
            Instant::now() - CACHE_TTL,
        ));
        for _ in 0..2 {
            assert!(matches!(
                cache.keys_for(&Client::new(), &url, "known").await,
                Err(Error::Internal)
            ));
        }
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        server.abort();
    }
}
