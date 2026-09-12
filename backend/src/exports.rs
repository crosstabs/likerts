use crate::{Error, ExportFormat, ExportSnapshot};
use async_trait::async_trait;
use aws_sdk_s3::primitives::ByteStream;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::time::Duration;
use std::{fs, path::PathBuf};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};

pub const EXPORT_LEASE_SECONDS: i64 = 300;
pub const EXPORT_EXECUTION_SECONDS: u64 = 240;

pub const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_EXPORT_RESPONSES: usize = 100_000;

#[async_trait]
pub trait ObjectStore: Send + Sync {
    async fn put(&self, key: &str, bytes: &[u8], expires_at: DateTime<Utc>) -> Result<(), Error>;
    async fn get(&self, key: &str) -> Result<Vec<u8>, Error>;
    async fn delete(&self, key: &str) -> Result<(), Error>;
}

fn validate_object_key(key: &str) -> Result<(), Error> {
    if key.is_empty()
        || key.len() > 100
        || !key
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
    {
        return Err(Error::Invalid("invalid object key".into()));
    }
    Ok(())
}

async fn read_bounded(reader: impl AsyncRead + Unpin, maximum: usize) -> Result<Vec<u8>, Error> {
    let limit = u64::try_from(maximum)
        .map_err(|_| Error::Internal)?
        .saturating_add(1);
    let mut bytes = Vec::with_capacity(maximum.min(64 * 1024));
    reader
        .take(limit)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| Error::Internal)?;
    if bytes.len() > maximum {
        return Err(Error::Capacity);
    }
    Ok(bytes)
}

fn validated_s3_endpoint(value: &str) -> Result<reqwest::Url, Error> {
    let endpoint =
        reqwest::Url::parse(value).map_err(|_| Error::Invalid("invalid S3 endpoint".into()))?;
    if !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
        || (endpoint.scheme() != "https"
            && !(endpoint.scheme() == "http"
                && endpoint
                    .host_str()
                    .is_some_and(|host| matches!(host, "127.0.0.1" | "localhost" | "::1"))))
    {
        return Err(Error::Invalid(
            "custom S3 endpoints require HTTPS or exact loopback HTTP without credentials, query or fragment".into(),
        ));
    }
    Ok(endpoint)
}

#[derive(Clone)]
pub struct LocalObjectStore {
    root: PathBuf,
}

impl LocalObjectStore {
    pub fn new(root: impl Into<PathBuf>) -> Result<Self, Error> {
        let root = root.into();
        fs::create_dir_all(&root).map_err(|_| Error::Internal)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
                .map_err(|_| Error::Internal)?;
        }
        Ok(Self { root })
    }
    fn path(&self, key: &str) -> Result<PathBuf, Error> {
        validate_object_key(key)?;
        Ok(self.root.join(key))
    }
}

#[async_trait]
impl ObjectStore for LocalObjectStore {
    async fn put(&self, key: &str, bytes: &[u8], _expires_at: DateTime<Utc>) -> Result<(), Error> {
        if bytes.len() > MAX_EXPORT_BYTES {
            return Err(Error::Capacity);
        }
        let path = self.path(key)?;
        let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4().simple()));
        let mut options = tokio::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            options.mode(0o600);
        }
        let write_result = async {
            let mut file = options
                .open(&temporary)
                .await
                .map_err(|_| Error::Internal)?;
            file.write_all(bytes).await.map_err(|_| Error::Internal)?;
            file.sync_all().await.map_err(|_| Error::Internal)
        }
        .await;
        if write_result.is_err() {
            let _ = tokio::fs::remove_file(&temporary).await;
            return write_result;
        }
        match tokio::fs::rename(&temporary, path).await {
            Ok(()) => Ok(()),
            Err(_) => {
                let _ = tokio::fs::remove_file(temporary).await;
                Err(Error::Internal)
            }
        }
    }
    async fn get(&self, key: &str) -> Result<Vec<u8>, Error> {
        let file = tokio::fs::File::open(self.path(key)?)
            .await
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    Error::NotFound
                } else {
                    Error::Internal
                }
            })?;
        read_bounded(file, MAX_EXPORT_BYTES).await
    }
    async fn delete(&self, key: &str) -> Result<(), Error> {
        match tokio::fs::remove_file(self.path(key)?).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(Error::Internal),
        }
    }
}

/// Private S3 export storage for multi-task deployments. Bucket encryption,
/// public-access blocking and lifecycle expiry remain infrastructure controls.
#[derive(Clone)]
pub struct S3ObjectStore {
    client: aws_sdk_s3::Client,
    bucket: String,
    prefix: String,
}

impl S3ObjectStore {
    pub async fn from_environment(bucket: String, prefix: String) -> Result<Self, Error> {
        if bucket.trim().is_empty()
            || prefix.is_empty()
            || prefix.len() > 100
            || prefix.starts_with('/')
            || prefix.ends_with('/')
            || prefix.split('/').any(|part| {
                part.is_empty()
                    || part == "."
                    || part == ".."
                    || !part
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
            })
        {
            return Err(Error::Invalid("invalid S3 export configuration".into()));
        }
        let config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
        let mut s3_config = aws_sdk_s3::config::Builder::from(&config);
        if let Ok(endpoint) = std::env::var("LIKERTS_S3_ENDPOINT") {
            if std::env::var("LIKERTS_ALLOW_S3_ENDPOINT").as_deref() != Ok("1") {
                return Err(Error::Invalid(
                    "LIKERTS_ALLOW_S3_ENDPOINT=1 is required for a custom S3 endpoint".into(),
                ));
            }
            let endpoint = validated_s3_endpoint(&endpoint)?;
            s3_config = s3_config
                .endpoint_url(endpoint.as_str())
                .force_path_style(true);
        }
        let client = aws_sdk_s3::Client::from_conf(s3_config.build());
        client
            .head_bucket()
            .bucket(&bucket)
            .send()
            .await
            .map_err(|_| Error::Internal)?;
        Ok(Self {
            client,
            bucket,
            prefix,
        })
    }

    fn key(&self, key: &str) -> Result<String, Error> {
        validate_object_key(key)?;
        Ok(format!("{}/{}", self.prefix, key))
    }
}

#[async_trait]
impl ObjectStore for S3ObjectStore {
    async fn put(&self, key: &str, bytes: &[u8], expires_at: DateTime<Utc>) -> Result<(), Error> {
        if bytes.len() > MAX_EXPORT_BYTES {
            return Err(Error::Capacity);
        }
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(self.key(key)?)
            .body(ByteStream::from(bytes.to_vec()))
            .metadata("likerts-expires-at", expires_at.to_rfc3339())
            .send()
            .await
            .map_err(|_| Error::Internal)?;
        Ok(())
    }

    async fn get(&self, key: &str) -> Result<Vec<u8>, Error> {
        let output = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(self.key(key)?)
            .send()
            .await
            .map_err(|error| {
                if error
                    .as_service_error()
                    .is_some_and(|service| service.is_no_such_key())
                {
                    Error::NotFound
                } else {
                    Error::Internal
                }
            })?;
        if output.content_length().is_some_and(|size| {
            size < 0 || usize::try_from(size).map_or(true, |size| size > MAX_EXPORT_BYTES)
        }) {
            return Err(Error::Capacity);
        }
        read_bounded(output.body.into_async_read(), MAX_EXPORT_BYTES).await
    }

    async fn delete(&self, key: &str) -> Result<(), Error> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(self.key(key)?)
            .send()
            .await
            .map_err(|_| Error::Internal)?;
        Ok(())
    }
}

/// Private Vercel Blob storage for deployments where the API runs outside
/// Vercel. Upload/delete use the protocol pinned by `@vercel/blob` 2.8.0;
/// downloads use Vercel's documented authenticated private-blob URL.
#[derive(Clone)]
pub struct VercelBlobObjectStore {
    client: reqwest::Client,
    control_endpoint: reqwest::Url,
    read_endpoint: reqwest::Url,
    token: String,
    store_id: String,
    prefix: String,
}

impl VercelBlobObjectStore {
    const API_VERSION: &'static str = "12";

    pub fn new(token: String, prefix: String) -> Result<Self, Error> {
        let token_parts = token.split('_').collect::<Vec<_>>();
        let store_id = token_parts
            .get(3)
            .copied()
            .filter(|part| {
                !part.is_empty()
                    && part.len() <= 100
                    && part.bytes().all(|byte| byte.is_ascii_alphanumeric())
            })
            .ok_or_else(|| Error::Invalid("invalid Vercel Blob token".into()))?
            .to_owned();
        if token_parts.get(..3) != Some(["vercel", "blob", "rw"].as_slice())
            || token_parts.len() < 5
            || token.len() > 4096
            || !token.is_ascii()
            || token.chars().any(char::is_whitespace)
        {
            return Err(Error::Invalid("invalid Vercel Blob token".into()));
        }
        Self::with_endpoints(
            token,
            store_id.clone(),
            prefix,
            reqwest::Url::parse("https://vercel.com/api/blob/").map_err(|_| Error::Internal)?,
            reqwest::Url::parse(&format!(
                "https://{store_id}.private.blob.vercel-storage.com/"
            ))
            .map_err(|_| Error::Internal)?,
        )
    }

    fn with_endpoints(
        token: String,
        store_id: String,
        prefix: String,
        control_endpoint: reqwest::Url,
        read_endpoint: reqwest::Url,
    ) -> Result<Self, Error> {
        validate_prefix(&prefix, "Vercel Blob")?;
        for endpoint in [&control_endpoint, &read_endpoint] {
            if !endpoint.username().is_empty()
                || endpoint.password().is_some()
                || endpoint.query().is_some()
                || endpoint.fragment().is_some()
                || (endpoint.scheme() != "https"
                    && !(endpoint.scheme() == "http"
                        && endpoint
                            .host_str()
                            .is_some_and(|host| matches!(host, "127.0.0.1" | "localhost" | "::1"))))
            {
                return Err(Error::Invalid("invalid Vercel Blob endpoint".into()));
            }
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| Error::Internal)?;
        Ok(Self {
            client,
            control_endpoint,
            read_endpoint,
            token,
            store_id,
            prefix,
        })
    }

    fn pathname(&self, key: &str) -> Result<String, Error> {
        validate_object_key(key)?;
        Ok(format!("{}/{}", self.prefix, key))
    }

    fn private_url(&self, key: &str) -> Result<reqwest::Url, Error> {
        self.read_endpoint
            .join(&self.pathname(key)?)
            .map_err(|_| Error::Internal)
    }

    fn authenticated(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request
            .bearer_auth(&self.token)
            .header("x-vercel-blob-store-id", &self.store_id)
            .header("x-api-version", Self::API_VERSION)
            .header("x-api-blob-request-id", uuid::Uuid::new_v4().to_string())
            .header("x-api-blob-request-attempt", "0")
    }
}

fn validate_prefix(prefix: &str, provider: &str) -> Result<(), Error> {
    if prefix.is_empty()
        || prefix.len() > 100
        || prefix.starts_with('/')
        || prefix.ends_with('/')
        || prefix.split('/').any(|part| {
            part.is_empty()
                || part == "."
                || part == ".."
                || !part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
    {
        return Err(Error::Invalid(format!(
            "invalid {provider} export configuration"
        )));
    }
    Ok(())
}

#[async_trait]
impl ObjectStore for VercelBlobObjectStore {
    async fn put(&self, key: &str, bytes: &[u8], _expires_at: DateTime<Utc>) -> Result<(), Error> {
        if bytes.len() > MAX_EXPORT_BYTES {
            return Err(Error::Capacity);
        }
        let mut url = self.control_endpoint.clone();
        url.set_query(Some(
            &serde_urlencoded::to_string([("pathname", self.pathname(key)?)])
                .map_err(|_| Error::Internal)?,
        ));
        let response = self
            .authenticated(self.client.put(url))
            .header("x-vercel-blob-access", "private")
            .header("x-add-random-suffix", "0")
            .header("x-allow-overwrite", "1")
            .header("x-content-type", "application/octet-stream")
            .header("x-cache-control-max-age", "60")
            .body(bytes.to_vec())
            .send()
            .await
            .map_err(|_| Error::Internal)?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(Error::Internal)
        }
    }

    async fn get(&self, key: &str) -> Result<Vec<u8>, Error> {
        let mut response = self
            .client
            .get(self.private_url(key)?)
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|_| Error::Internal)?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(Error::NotFound);
        }
        if !response.status().is_success() {
            return Err(Error::Internal);
        }
        if response
            .content_length()
            .is_some_and(|size| usize::try_from(size).map_or(true, |size| size > MAX_EXPORT_BYTES))
        {
            return Err(Error::Capacity);
        }
        let mut bytes = Vec::with_capacity(
            response
                .content_length()
                .and_then(|size| usize::try_from(size).ok())
                .unwrap_or(0)
                .min(64 * 1024),
        );
        while let Some(chunk) = response.chunk().await.map_err(|_| Error::Internal)? {
            if bytes.len().saturating_add(chunk.len()) > MAX_EXPORT_BYTES {
                return Err(Error::Capacity);
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }

    async fn delete(&self, key: &str) -> Result<(), Error> {
        let url = self
            .control_endpoint
            .join("delete")
            .map_err(|_| Error::Internal)?;
        let response = self
            .authenticated(self.client.post(url))
            .json(&serde_json::json!({"urls": [self.private_url(key)?.as_str()]}))
            .send()
            .await
            .map_err(|_| Error::Internal)?;
        if response.status().is_success() || response.status() == reqwest::StatusCode::NOT_FOUND {
            Ok(())
        } else {
            Err(Error::Internal)
        }
    }
}

fn csv_cell(value: &str) -> String {
    let dangerous = value.starts_with(['=', '+', '-', '@', '\t', '\r'])
        || value.trim_start().starts_with(['=', '+', '-', '@']);
    let safe = if dangerous {
        format!("'{value}")
    } else {
        value.to_owned()
    };
    format!("\"{}\"", safe.replace('"', "\"\""))
}

pub fn render(snapshot: &ExportSnapshot) -> Result<Vec<u8>, Error> {
    let bytes = match snapshot.format {
        ExportFormat::Json => serde_json::to_vec(&serde_json::json!({
            "manifest": snapshot.manifest,
            "responses": snapshot.responses,
        }))
        .map_err(|_| Error::Internal)?,
        ExportFormat::Csv => {
            let mut output = String::from(
                "response_id,collection_id,accepted_at,answers_json,metadata_json\r\n",
            );
            for response in &snapshot.responses {
                let values = [
                    response.receipt.response_id.clone(),
                    response.receipt.collection_id.clone(),
                    response.accepted_at.to_rfc3339(),
                    serde_json::to_string(&response.answers).map_err(|_| Error::Internal)?,
                    serde_json::to_string(&response.metadata).map_err(|_| Error::Internal)?,
                ];
                output.push_str(
                    &values
                        .iter()
                        .map(|value| csv_cell(value))
                        .collect::<Vec<_>>()
                        .join(","),
                );
                output.push_str("\r\n");
            }
            output.into_bytes()
        }
    };
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err(Error::Capacity);
    }
    Ok(bytes)
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDownload {
    pub file_name: String,
    pub content_type: String,
    pub content_base64: String,
    pub content_sha256: String,
    pub manifest: crate::ExportManifest,
}

pub fn default_root() -> PathBuf {
    std::env::temp_dir().join("likerts-exports")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::{Request, State},
        http::StatusCode,
        response::IntoResponse,
        Router,
    };
    use std::sync::{Arc, Mutex};
    #[test]
    fn formula_cells_are_neutralized() {
        for value in ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "  =hidden", "\t=tab"] {
            assert!(csv_cell(value).starts_with("\"'"));
        }
        assert_eq!(csv_cell("safe"), "\"safe\"");
    }
    #[tokio::test]
    async fn local_store_bounds_keys_and_roundtrips() {
        let root =
            std::env::temp_dir().join(format!("likerts-object-test-{}", uuid::Uuid::new_v4()));
        let store = LocalObjectStore::new(&root).unwrap();
        store.put("valid.json", b"data", Utc::now()).await.unwrap();
        assert_eq!(store.get("valid.json").await.unwrap(), b"data");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(root.join("valid.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        assert!(store.put("../escape", b"bad", Utc::now()).await.is_err());
        store.delete("valid.json").await.unwrap();
        assert!(store.get("valid.json").await.is_err());
        let _ = fs::remove_dir_all(root);
    }
    #[tokio::test]
    async fn object_reads_stop_after_the_configured_bound() {
        assert_eq!(read_bounded(tokio::io::empty(), 8).await.unwrap(), b"");
        assert_eq!(
            read_bounded(tokio::io::repeat(7), 8).await,
            Err(Error::Capacity)
        );
    }

    #[derive(Clone, Default)]
    struct BlobRequests(Arc<Mutex<Vec<(String, String, Vec<u8>)>>>);

    async fn blob_mock(State(seen): State<BlobRequests>, request: Request) -> impl IntoResponse {
        let method = request.method().to_string();
        let uri = request.uri().to_string();
        let authorization = request
            .headers()
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_owned();
        let headers = request.headers().clone();
        let body = axum::body::to_bytes(request.into_body(), MAX_EXPORT_BYTES + 1)
            .await
            .unwrap();
        seen.0.lock().unwrap().push((
            method.clone(),
            format!("{uri}|{authorization}"),
            body.to_vec(),
        ));
        match (method.as_str(), uri.split('?').next().unwrap_or("")) {
            ("PUT", "/api/blob/") => {
                assert_eq!(headers.get("x-vercel-blob-access").unwrap(), "private");
                assert_eq!(headers.get("x-vercel-blob-store-id").unwrap(), "store123");
                assert_eq!(headers.get("x-api-version").unwrap(), "12");
                StatusCode::OK.into_response()
            }
            ("GET", "/read/exports/valid.json") => b"private export".into_response(),
            ("POST", "/api/blob/delete") => StatusCode::OK.into_response(),
            _ => StatusCode::NOT_FOUND.into_response(),
        }
    }

    #[tokio::test]
    async fn vercel_blob_uses_private_authenticated_bounded_protocol() {
        let seen = BlobRequests::default();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server_seen = seen.clone();
        tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().fallback(blob_mock).with_state(server_seen),
            )
            .await
            .unwrap();
        });
        let store = VercelBlobObjectStore::with_endpoints(
            "vercel_blob_rw_store123_secret".into(),
            "store123".into(),
            "exports".into(),
            reqwest::Url::parse(&format!("http://{address}/api/blob/")).unwrap(),
            reqwest::Url::parse(&format!("http://{address}/read/")).unwrap(),
        )
        .unwrap();
        store
            .put("valid.json", b"private export", Utc::now())
            .await
            .unwrap();
        assert_eq!(store.get("valid.json").await.unwrap(), b"private export");
        store.delete("valid.json").await.unwrap();

        let requests = seen.0.lock().unwrap();
        assert_eq!(requests.len(), 3);
        assert!(requests.iter().all(|(_, request, _)| {
            request.ends_with("|Bearer vercel_blob_rw_store123_secret")
        }));
        assert!(requests[0].1.contains("pathname=exports%2Fvalid.json"));
        assert!(!requests[0].1.split('|').next().unwrap().contains("secret"));
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&requests[2].2).unwrap(),
            serde_json::json!({"urls":[format!("http://{address}/read/exports/valid.json")]})
        );
    }

    #[test]
    fn vercel_blob_rejects_unsafe_startup_configuration() {
        for token in [
            "",
            "no-store",
            "vercel_blob_rw_bad/store_secret",
            "vercel_blob_rw_store_secret\n",
        ] {
            assert!(VercelBlobObjectStore::new(token.into(), "exports".into()).is_err());
        }
        for prefix in ["", "/exports", "exports/", "../exports", "exports//daily"] {
            assert!(VercelBlobObjectStore::new(
                "vercel_blob_rw_store123_secret".into(),
                prefix.into()
            )
            .is_err());
        }
    }
    #[test]
    fn custom_endpoint_rejects_credential_and_cleartext_exfiltration_shapes() {
        assert!(validated_s3_endpoint("https://s3.example.com").is_ok());
        assert!(validated_s3_endpoint("http://127.0.0.1:9000").is_ok());
        for endpoint in [
            "http://s3.example.com",
            "https://user:password@s3.example.com",
            "https://s3.example.com?credential=secret",
            "https://s3.example.com/#secret",
        ] {
            assert!(
                validated_s3_endpoint(endpoint).is_err(),
                "accepted {endpoint}"
            );
        }
    }
}
