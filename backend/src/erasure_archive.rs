//! ID-only independent erasure archive. No answer, identity or payment clients.
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use reqwest::{header::HeaderValue, Client, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use std::{collections::HashSet, time::Duration};
use uuid::Uuid;

pub const MAX_OBJECT: usize = 256 * 1024;
pub const MAX_EVENTS: usize = 100_000;
pub const FENCE_ATTESTATION: &str = "I_ACCEPT_DELETIONS_WILL_BE_REJECTED";
pub const RELEASE_ATTESTATION: &str = "I_ACCEPT_OLD_CHECKPOINT_NO_LONGER_COVERS_FUTURE_DELETIONS";
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveError {
    Configuration,
    Database,
    Storage,
    InvalidArchive,
    CoverageUnproven,
    FenceReleased,
    Capacity,
    StaleLease,
}
pub type Result<T> = std::result::Result<T, ArchiveError>;
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn uuid(value: &str) -> Result<Uuid> {
    let id = Uuid::parse_str(value).map_err(|_| ArchiveError::InvalidArchive)?;
    if id.to_string() != value {
        return Err(ArchiveError::InvalidArchive);
    }
    Ok(id)
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ErasureEvent {
    pub archive_version: u8,
    pub source_id: String,
    pub event_id: String,
    pub workspace_id: String,
    pub kind: String,
    pub resource_id: String,
    pub deleted_at: DateTime<Utc>,
}
impl ErasureEvent {
    fn validate(&self, source: &str, id: &str) -> Result<()> {
        uuid(&self.event_id)?;
        uuid(&self.source_id)?;
        if self.archive_version != 1
            || self.source_id != source
            || self.event_id != id
            || self.workspace_id.is_empty()
            || self.workspace_id.chars().count() > 200
            || self.workspace_id.chars().any(char::is_control)
        {
            return Err(ArchiveError::InvalidArchive);
        }
        match self.kind.as_str() {
            "workspace" if self.resource_id == self.workspace_id => {}
            "response" | "export" => {
                uuid(&self.resource_id)?;
            }
            _ => return Err(ArchiveError::InvalidArchive),
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ObjectRef {
    pub id: String,
    pub sha256: String,
}
impl ObjectRef {
    fn validate(&self) -> Result<()> {
        uuid(&self.id)?;
        if !valid_hash(&self.sha256) {
            return Err(ArchiveError::InvalidArchive);
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Checkpoint {
    pub archive_version: u8,
    pub source_id: String,
    pub checkpoint_id: String,
    pub previous: Option<ObjectRef>,
    pub fence_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub total_events: u64,
    pub events: Vec<ObjectRef>,
}
impl Checkpoint {
    fn validate(&self, source: &str, id: &str) -> Result<()> {
        uuid(&self.source_id)?;
        uuid(&self.checkpoint_id)?;
        if self.archive_version != 1
            || self.source_id != source
            || self.checkpoint_id != id
            || self.events.len() > 1000
            || self.total_events > MAX_EVENTS as u64
        {
            return Err(ArchiveError::InvalidArchive);
        }
        if let Some(fence) = &self.fence_id {
            uuid(fence)?;
        }
        if let Some(previous) = &self.previous {
            previous.validate()?;
        }
        for event in &self.events {
            event.validate()?;
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Status {
    pub source_id: String,
    pub fence_id: Option<String>,
    pub fenced_at: Option<DateTime<Utc>>,
    pub checkpoint_id: Option<String>,
    pub checkpoint_hash: Option<String>,
    pub covered_events: u64,
    pub pending_events: u64,
    pub oldest_pending_seconds: u64,
}
#[async_trait]
pub trait ArchiveObjects: Send + Sync {
    /// Never overwrite an existing object. An exact existing object is success.
    async fn put_once(&self, key: &str, bytes: &[u8]) -> Result<()>;
    /// A missing object is distinct from an unavailable provider. Reads bypass cache.
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>>;
}
#[derive(Clone)]
pub struct PrivateBlob {
    client: Client,
    authorization: HeaderValue,
    store_id: String,
    prefix: String,
    control: Url,
    read: Url,
}
impl PrivateBlob {
    pub fn new(token: &str, namespace: &str, source: &str) -> Result<Self> {
        uuid(source).map_err(|_| ArchiveError::Configuration)?;
        if namespace.is_empty()
            || namespace.len() > 64
            || !namespace
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        {
            return Err(ArchiveError::Configuration);
        }
        let parts = token.split('_').collect::<Vec<_>>();
        if parts.len() < 5
            || parts[..3] != ["vercel", "blob", "rw"]
            || token.len() > 4096
            || !token.bytes().all(|b| b.is_ascii_graphic())
        {
            return Err(ArchiveError::Configuration);
        }
        let store_id = parts[3];
        if store_id.is_empty()
            || store_id.len() > 100
            || !store_id.bytes().all(|b| b.is_ascii_alphanumeric())
        {
            return Err(ArchiveError::Configuration);
        }
        Self::with_endpoints(
            token,
            store_id,
            format!("erasure/v1/{namespace}/{source}"),
            Url::parse("https://vercel.com/api/blob/").unwrap(),
            Url::parse(&format!(
                "https://{store_id}.private.blob.vercel-storage.com/"
            ))
            .map_err(|_| ArchiveError::Configuration)?,
        )
    }
    fn with_endpoints(
        token: &str,
        store_id: &str,
        prefix: String,
        control: Url,
        read: Url,
    ) -> Result<Self> {
        let mut authorization = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_| ArchiveError::Configuration)?;
        authorization.set_sensitive(true);
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .no_proxy()
            .timeout(Duration::from_secs(10))
            .connect_timeout(Duration::from_secs(5))
            .build()
            .map_err(|_| ArchiveError::Configuration)?;
        Ok(Self {
            client,
            authorization,
            store_id: store_id.into(),
            prefix,
            control,
            read,
        })
    }
    fn pathname(&self, key: &str) -> Result<String> {
        let (kind, name) = key.split_once('/').ok_or(ArchiveError::InvalidArchive)?;
        if !matches!(kind, "events" | "checkpoints" | "releases") {
            return Err(ArchiveError::InvalidArchive);
        }
        uuid(
            name.strip_suffix(".json")
                .ok_or(ArchiveError::InvalidArchive)?,
        )?;
        Ok(format!("{}/{key}", self.prefix))
    }
}
async fn bounded(mut response: reqwest::Response) -> Result<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|size| size > MAX_OBJECT as u64)
    {
        return Err(ArchiveError::Capacity);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ArchiveError::Storage)? {
        if bytes.len().saturating_add(chunk.len()) > MAX_OBJECT {
            return Err(ArchiveError::Capacity);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
#[async_trait]
impl ArchiveObjects for PrivateBlob {
    async fn put_once(&self, key: &str, bytes: &[u8]) -> Result<()> {
        if bytes.len() > MAX_OBJECT {
            return Err(ArchiveError::Capacity);
        }
        let mut url = self.control.clone();
        url.query_pairs_mut()
            .append_pair("pathname", &self.pathname(key)?);
        let response = self
            .client
            .put(url)
            .header("authorization", self.authorization.clone())
            .header("x-vercel-blob-store-id", &self.store_id)
            .header("x-api-version", "12")
            .header("x-api-blob-request-id", Uuid::new_v4().to_string())
            .header("x-api-blob-request-attempt", "0")
            .header("x-vercel-blob-access", "private")
            .header("x-add-random-suffix", "0")
            .header("x-allow-overwrite", "0")
            .header("x-content-type", "application/json")
            .header("x-cache-control-max-age", "60")
            .body(bytes.to_vec())
            .send()
            .await
            .map_err(|_| ArchiveError::Storage)?;
        // A conflict/error is only successful if an independent authenticated
        // read verifies that the already-durable object is exactly our object.
        let _ = bounded(response).await?;
        match self.get(key).await? {
            Some(existing) if existing == bytes => Ok(()),
            Some(_) => Err(ArchiveError::InvalidArchive),
            None => Err(ArchiveError::Storage),
        }
    }
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let mut url = self
            .read
            .join(&self.pathname(key)?)
            .map_err(|_| ArchiveError::Configuration)?;
        url.query_pairs_mut().append_pair("cache", "0");
        let response = self
            .client
            .get(url)
            .header("authorization", self.authorization.clone())
            .send()
            .await
            .map_err(|_| ArchiveError::Storage)?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(ArchiveError::Storage);
        }
        bounded(response).await.map(Some)
    }
}
#[derive(Clone)]
pub struct Archiver {
    pool: PgPool,
    source: String,
}
impl Archiver {
    pub async fn new(pool: PgPool, expected_source: &str) -> Result<Self> {
        uuid(expected_source).map_err(|_| ArchiveError::Configuration)?;
        let safe:bool=sqlx::query_scalar("select current_user='likerts_erasure_archiver' and not (rolsuper or rolbypassrls or rolinherit or rolcreaterole or rolcreatedb) and not exists(select 1 from pg_auth_members where member=r.oid) and not exists(select 1 from pg_database where datname=current_database() and datdba=r.oid) and not exists(select 1 from pg_namespace where nspname='likerts' and nspowner=r.oid) and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='likerts' and c.relowner=r.oid) and not has_table_privilege(current_user,'likerts.responses','SELECT') and not has_table_privilege(current_user,'likerts.response_credits','SELECT') from pg_roles r where rolname=current_user").fetch_one(&pool).await.map_err(|_|ArchiveError::Database)?;
        if !safe {
            return Err(ArchiveError::Configuration);
        }
        let result = Self {
            pool,
            source: expected_source.into(),
        };
        result.status().await?;
        Ok(result)
    }
    pub async fn status(&self) -> Result<Status> {
        let raw: serde_json::Value = sqlx::query_scalar("select likerts.erasure_archive_status()")
            .fetch_one(&self.pool)
            .await
            .map_err(|_| ArchiveError::Database)?;
        let status: Status = serde_json::from_value(raw).map_err(|_| ArchiveError::Database)?;
        if status.source_id != self.source {
            return Err(ArchiveError::Configuration);
        }
        Ok(status)
    }
    pub async fn one(&self, objects: &dyn ArchiveObjects) -> Result<bool> {
        let row = sqlx::query("select * from likerts.claim_erasure_archive()")
            .fetch_optional(&self.pool)
            .await
            .map_err(|_| ArchiveError::Database)?;
        let Some(row) = row else { return Ok(false) };
        let id: Uuid = row.get("event_id");
        let lease: Uuid = row.get("lease_id");
        let body: String = row.get("body");
        let digest: String = row.get("body_hash");
        let result = async {
            let event: ErasureEvent =
                serde_json::from_str(&body).map_err(|_| ArchiveError::InvalidArchive)?;
            event.validate(&self.source, &id.to_string())?;
            if hash(body.as_bytes()) != digest {
                return Err(ArchiveError::InvalidArchive);
            }
            objects
                .put_once(&format!("events/{id}.json"), body.as_bytes())
                .await?;
            let finished: bool =
                sqlx::query_scalar("select likerts.finish_erasure_archive($1,$2,$3)")
                    .bind(id)
                    .bind(lease)
                    .bind(&digest)
                    .fetch_one(&self.pool)
                    .await
                    .map_err(|_| ArchiveError::Database)?;
            if !finished {
                return Err(ArchiveError::StaleLease);
            }
            Ok(true)
        }
        .await;
        if result.is_err() {
            let _ = sqlx::query("select likerts.retry_erasure_archive($1,$2)")
                .bind(id)
                .bind(lease)
                .execute(&self.pool)
                .await;
        }
        result
    }
    pub async fn checkpoint(&self, objects: &dyn ArchiveObjects) -> Result<Option<ObjectRef>> {
        let body: Option<String> =
            sqlx::query_scalar("select likerts.prepare_erasure_checkpoint()")
                .fetch_one(&self.pool)
                .await
                .map_err(|_| ArchiveError::Database)?;
        let Some(body) = body else { return Ok(None) };
        let checkpoint: Checkpoint =
            serde_json::from_str(&body).map_err(|_| ArchiveError::InvalidArchive)?;
        checkpoint.validate(&self.source, &checkpoint.checkpoint_id)?;
        let reference = ObjectRef {
            id: checkpoint.checkpoint_id,
            sha256: hash(body.as_bytes()),
        };
        objects
            .put_once(
                &format!("checkpoints/{}.json", reference.id),
                body.as_bytes(),
            )
            .await?;
        let finished: bool = sqlx::query_scalar("select likerts.finish_erasure_checkpoint($1,$2)")
            .bind(uuid(&reference.id)?)
            .bind(&reference.sha256)
            .fetch_one(&self.pool)
            .await
            .map_err(|_| ArchiveError::Database)?;
        if !finished {
            // Another archiver may have finished the same immutable checkpoint.
            let status = self.status().await?;
            if status.checkpoint_id.as_deref() != Some(reference.id.as_str())
                || status.checkpoint_hash.as_deref() != Some(reference.sha256.as_str())
            {
                return Err(ArchiveError::StaleLease);
            }
        }
        Ok(Some(reference))
    }
    pub async fn fence(&self, attestation: &str) -> Result<String> {
        if attestation != FENCE_ATTESTATION {
            return Err(ArchiveError::Configuration);
        }
        let id: Uuid = sqlx::query_scalar("select likerts.fence_erasure_source($1,$2)")
            .bind(uuid(&self.source)?)
            .bind(attestation)
            .fetch_one(&self.pool)
            .await
            .map_err(|_| ArchiveError::Database)?;
        Ok(id.to_string())
    }
    pub async fn release(
        &self,
        objects: &dyn ArchiveObjects,
        fence: &str,
        attestation: &str,
    ) -> Result<()> {
        if attestation != RELEASE_ATTESTATION {
            return Err(ArchiveError::Configuration);
        }
        uuid(fence)?;
        let status = self.status().await?;
        if status.fence_id.as_deref() != Some(fence) {
            return Err(ArchiveError::CoverageUnproven);
        }
        // Durable invalidation precedes allowing any new deletion. A crash here
        // conservatively invalidates a checkpoint but never permits resurrection.
        let body=serde_json::to_vec(&serde_json::json!({"archiveVersion":1,"sourceId":self.source,"fenceId":fence,"released":true})).map_err(|_|ArchiveError::InvalidArchive)?;
        objects
            .put_once(&format!("releases/{fence}.json"), &body)
            .await?;
        let released: bool = sqlx::query_scalar("select likerts.release_erasure_source($1,$2,$3)")
            .bind(uuid(&self.source)?)
            .bind(uuid(fence)?)
            .bind(attestation)
            .fetch_one(&self.pool)
            .await
            .map_err(|_| ArchiveError::Database)?;
        if !released {
            return Err(ArchiveError::CoverageUnproven);
        }
        Ok(())
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedArchive {
    pub archive_version: u8,
    pub source_id: String,
    pub fence_id: String,
    pub checkpoint: ObjectRef,
    pub coverage: &'static str,
    pub events: Vec<ErasureEvent>,
}
/// Verify the entire chain and every event before emitting any replay input.
/// This proves the fenced source set, never that an unfenced source later stopped.
pub async fn verify(
    objects: &dyn ArchiveObjects,
    source: &str,
    fence: &str,
    head: ObjectRef,
) -> Result<VerifiedArchive> {
    uuid(source)?;
    uuid(fence)?;
    head.validate()?;
    if objects
        .get(&format!("releases/{fence}.json"))
        .await?
        .is_some()
    {
        return Err(ArchiveError::FenceReleased);
    }
    let mut next = Some(head.clone());
    let mut checkpoints = HashSet::new();
    let mut event_ids = HashSet::new();
    let mut events = Vec::new();
    let mut expected_total = None;
    while let Some(reference) = next {
        if !checkpoints.insert(reference.id.clone()) || checkpoints.len() > 10000 {
            return Err(ArchiveError::Capacity);
        }
        let bytes = objects
            .get(&format!("checkpoints/{}.json", reference.id))
            .await?
            .ok_or(ArchiveError::CoverageUnproven)?;
        if bytes.len() > MAX_OBJECT || hash(&bytes) != reference.sha256 {
            return Err(ArchiveError::InvalidArchive);
        }
        let checkpoint: Checkpoint =
            serde_json::from_slice(&bytes).map_err(|_| ArchiveError::InvalidArchive)?;
        checkpoint.validate(source, &reference.id)?;
        if checkpoints.len() == 1 {
            if checkpoint.fence_id.as_deref() != Some(fence) {
                return Err(ArchiveError::CoverageUnproven);
            }
        }
        if expected_total.is_some_and(|total| checkpoint.total_events != total) {
            return Err(ArchiveError::InvalidArchive);
        }
        if checkpoint.total_events < (checkpoint.events.len() as u64) {
            return Err(ArchiveError::InvalidArchive);
        }
        expected_total = Some(checkpoint.total_events - checkpoint.events.len() as u64);
        for reference in checkpoint.events {
            if !event_ids.insert(reference.id.clone()) || event_ids.len() > MAX_EVENTS {
                return Err(ArchiveError::Capacity);
            }
            let bytes = objects
                .get(&format!("events/{}.json", reference.id))
                .await?
                .ok_or(ArchiveError::CoverageUnproven)?;
            if bytes.len() > 4096 || hash(&bytes) != reference.sha256 {
                return Err(ArchiveError::InvalidArchive);
            }
            let event: ErasureEvent =
                serde_json::from_slice(&bytes).map_err(|_| ArchiveError::InvalidArchive)?;
            event.validate(source, &reference.id)?;
            events.push(event);
        }
        next = checkpoint.previous;
    }
    if expected_total != Some(0) {
        return Err(ArchiveError::InvalidArchive);
    }
    // Catch a release that raced this potentially long verification. Operational
    // reopening still requires the source to remain in the attested fenced state.
    if objects
        .get(&format!("releases/{fence}.json"))
        .await?
        .is_some()
    {
        return Err(ArchiveError::FenceReleased);
    }
    Ok(VerifiedArchive {
        archive_version: 1,
        source_id: source.into(),
        fence_id: fence.into(),
        checkpoint: head,
        coverage: "fenced_source_set_only",
        events,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashMap, sync::Mutex};

    #[derive(Default)]
    struct MemoryObjects(Mutex<HashMap<String, Vec<u8>>>);

    impl MemoryObjects {
        fn insert(&self, key: impl Into<String>, bytes: impl Into<Vec<u8>>) {
            self.0.lock().unwrap().insert(key.into(), bytes.into());
        }
    }

    #[async_trait]
    impl ArchiveObjects for MemoryObjects {
        async fn put_once(&self, key: &str, bytes: &[u8]) -> Result<()> {
            let mut values = self.0.lock().unwrap();
            match values.get(key) {
                Some(existing) if existing == bytes => Ok(()),
                Some(_) => Err(ArchiveError::InvalidArchive),
                None => {
                    values.insert(key.into(), bytes.to_vec());
                    Ok(())
                }
            }
        }

        async fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
            Ok(self.0.lock().unwrap().get(key).cloned())
        }
    }

    fn event(source: &str, id: &str, workspace: &str, kind: &str, resource: &str) -> Vec<u8> {
        serde_json::json!({
            "archiveVersion": 1,
            "sourceId": source,
            "eventId": id,
            "workspaceId": workspace,
            "kind": kind,
            "resourceId": resource,
            "deletedAt": "2026-09-10T12:00:00Z"
        })
        .to_string()
        .into_bytes()
    }

    fn checkpoint(
        source: &str,
        id: &str,
        fence: Option<&str>,
        previous: Option<ObjectRef>,
        total: u64,
        events: Vec<ObjectRef>,
    ) -> (Vec<u8>, ObjectRef) {
        let body = serde_json::json!({
            "archiveVersion": 1,
            "sourceId": source,
            "checkpointId": id,
            "previous": previous,
            "fenceId": fence,
            "createdAt": "2026-09-10T12:01:00Z",
            "totalEvents": total,
            "events": events
        })
        .to_string()
        .into_bytes();
        let reference = ObjectRef {
            id: id.into(),
            sha256: hash(&body),
        };
        (body, reference)
    }

    #[tokio::test]
    async fn verifies_fenced_chain_and_rejects_release_marker() {
        let source = "11111111-1111-4111-8111-111111111111";
        let fence = "22222222-2222-4222-8222-222222222222";
        let event_id = "33333333-3333-4333-8333-333333333333";
        let bytes = event(
            source,
            event_id,
            "ws_verified_archive",
            "response",
            "44444444-4444-4444-8444-444444444444",
        );
        let objects = MemoryObjects::default();
        objects.insert(format!("events/{event_id}.json"), bytes.clone());
        let (checkpoint, head) = checkpoint(
            source,
            "55555555-5555-4555-8555-555555555555",
            Some(fence),
            None,
            1,
            vec![ObjectRef {
                id: event_id.into(),
                sha256: hash(&bytes),
            }],
        );
        objects.insert(format!("checkpoints/{}.json", head.id), checkpoint);
        let verified = verify(&objects, source, fence, head.clone()).await.unwrap();
        assert_eq!(verified.coverage, "fenced_source_set_only");
        assert_eq!(verified.events.len(), 1);

        objects.insert(format!("releases/{fence}.json"), b"released".to_vec());
        assert_eq!(
            verify(&objects, source, fence, head).await.unwrap_err(),
            ArchiveError::FenceReleased
        );
    }

    #[tokio::test]
    async fn verifier_rejects_missing_duplicate_or_mismatched_event_archive() {
        let source = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let fence = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        let event_id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
        let event_bytes = event(source, event_id, "ws_archive_gap", "workspace", "ws_archive_gap");
        let event_ref = ObjectRef {
            id: event_id.into(),
            sha256: hash(&event_bytes),
        };
        let (duplicate_checkpoint, duplicate_head) = checkpoint(
            source,
            "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            Some(fence),
            None,
            2,
            vec![event_ref.clone(), event_ref.clone()],
        );
        let objects = MemoryObjects::default();
        objects.insert(format!("events/{event_id}.json"), event_bytes);
        objects.insert(
            format!("checkpoints/{}.json", duplicate_head.id),
            duplicate_checkpoint,
        );
        assert_eq!(
            verify(&objects, source, fence, duplicate_head).await.unwrap_err(),
            ArchiveError::Capacity
        );

        let missing_ref = ObjectRef {
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee".into(),
            sha256: "0".repeat(64),
        };
        let (missing_checkpoint, missing_head) = checkpoint(
            source,
            "ffffffff-ffff-4fff-8fff-ffffffffffff",
            Some(fence),
            None,
            1,
            vec![missing_ref],
        );
        let missing = MemoryObjects::default();
        missing.insert(
            format!("checkpoints/{}.json", missing_head.id),
            missing_checkpoint,
        );
        assert_eq!(
            verify(&missing, source, fence, missing_head).await.unwrap_err(),
            ArchiveError::CoverageUnproven
        );
    }
}
