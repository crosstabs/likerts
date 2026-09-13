use crate::{
    normalized_answers_for_pages, request_hash, response_page, submission_hash,
    survey_schema_version, validate_collection_security, validate_draft, validate_management_key,
    validate_sdk_capabilities, Collection, CollectionLimits, CollectionSecurity,
    CollectionSecurityInput, DraftInput, Error, ExportFormat, ExportInput, ExportJob,
    ExportManifest, ExportSchema, ExportSnapshot, ExportStatus, LifecycleBatch, OAuthGrant,
    Question, Receipt, Response, ResponseListInput, ResponsePage, RetentionResult, Role,
    SdkCapabilities, ServiceCredential, Submission, Survey, SurveyPage, UsageSummary, Version,
    WorkspaceMembership,
};
use base64::{
    engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD},
    Engine,
};
use chrono::{Duration as ChronoDuration, Utc};
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{
    postgres::{PgPoolOptions, PgRow},
    PgPool, Postgres, Row, Transaction,
};
use std::{collections::HashSet, sync::Arc, time::Duration};
use uuid::Uuid;

#[derive(Clone)]
pub struct PgStore {
    pool: PgPool,
    collection_credential_key: Arc<[u8]>,
}

fn collection_credential_key() -> Result<Arc<[u8]>, Error> {
    let encoded = std::env::var("LIKERTS_COLLECTION_CREDENTIAL_KEY").map_err(|_| {
        eprintln!("LIKERTS_COLLECTION_CREDENTIAL_KEY is required for PostgreSQL storage");
        Error::Internal
    })?;
    let key = BASE64.decode(encoded).map_err(|_| {
        eprintln!("LIKERTS_COLLECTION_CREDENTIAL_KEY must be base64-encoded");
        Error::Internal
    })?;
    if key.len() != 32 {
        eprintln!("LIKERTS_COLLECTION_CREDENTIAL_KEY must decode to exactly 32 bytes");
        return Err(Error::Internal);
    }
    Ok(key.into())
}

fn database_error(error: sqlx::Error) -> Error {
    let category = error
        .as_database_error()
        .and_then(|database| database.code())
        .map(|code| code.into_owned())
        .unwrap_or_else(|| "non_database".into());
    eprintln!("database operation failed; category={category}");
    if category == "LKF01" {
        return Error::ErasureFenced;
    }
    Error::Internal
}

fn token_hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

fn token_hash_hex(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

fn questions(value: Value) -> Result<Vec<Question>, Error> {
    serde_json::from_value(value).map_err(|_| Error::Internal)
}

fn pages(value: Option<Value>) -> Result<Option<Vec<SurveyPage>>, Error> {
    value
        .map(|value| serde_json::from_value(value).map_err(|_| Error::Internal))
        .transpose()
}

fn database_integer(value: u64) -> Result<i64, Error> {
    i64::try_from(value).map_err(|_| Error::Invalid("numeric value is too large".into()))
}

fn export_format(value: &str) -> Result<ExportFormat, Error> {
    match value {
        "csv" => Ok(ExportFormat::Csv),
        "json" => Ok(ExportFormat::Json),
        _ => Err(Error::Internal),
    }
}
fn export_status(value: &str) -> Result<ExportStatus, Error> {
    match value {
        "queued" => Ok(ExportStatus::Queued),
        "running" => Ok(ExportStatus::Running),
        "ready" => Ok(ExportStatus::Ready),
        "failed" => Ok(ExportStatus::Failed),
        "revoked" => Ok(ExportStatus::Revoked),
        _ => Err(Error::Internal),
    }
}
fn export_job(row: PgRow) -> Result<ExportJob, Error> {
    Ok(ExportJob {
        id: row.get::<Uuid, _>("id").to_string(),
        format: export_format(row.get("format"))?,
        status: export_status(row.get("status"))?,
        created_at: row.get("created_at"),
        expires_at: row.get("expires_at"),
        response_count: row
            .get::<Option<i64>, _>("response_count")
            .map(|v| v as u64),
        content_sha256: row.get("content_sha256"),
        manifest: row
            .get::<Option<Value>, _>("manifest")
            .map(serde_json::from_value)
            .transpose()
            .map_err(|_| Error::Internal)?,
        error_code: row.get("error_code"),
    })
}
fn valid_scope(scope: &str) -> bool {
    matches!(
        scope,
        "surveys:read"
            | "surveys:write"
            | "collections:write"
            | "responses:read"
            | "responses:write"
            | "usage:read"
            | "exports:read"
            | "exports:write"
            | "identity:write"
            | "webhooks:read"
            | "webhooks:write"
    )
}

impl PgStore {
    async fn connect_pool(database_url: &str) -> Result<PgPool, Error> {
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .min_connections(1)
            .acquire_timeout(Duration::from_secs(5))
            .idle_timeout(Duration::from_secs(300))
            .max_lifetime(Duration::from_secs(1800))
            .connect(database_url)
            .await
            .map_err(database_error)?;
        Ok(pool)
    }

    pub async fn connect(database_url: &str) -> Result<Self, Error> {
        let collection_credential_key = collection_credential_key()?;
        let pool = Self::connect_pool(database_url).await?;
        sqlx::migrate!().run(&pool).await.map_err(|_| {
            eprintln!("database migration failed; inspect the restricted database log");
            Error::Internal
        })?;
        Ok(Self {
            pool,
            collection_credential_key,
        })
    }

    pub async fn connect_runtime(database_url: &str) -> Result<Self, Error> {
        Ok(Self {
            pool: Self::connect_pool(database_url).await?,
            collection_credential_key: collection_credential_key()?,
        })
    }

    fn collection_token(&self, workspace: &str, id: Uuid) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.collection_credential_key)
            .expect("validated HMAC key");
        mac.update(b"likerts-collection-credential-v1\0");
        mac.update(workspace.as_bytes());
        mac.update(b"\0");
        mac.update(id.as_bytes());
        format!("lc_{}", URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
    }

    async fn workspace_transaction<'a>(
        &'a self,
        workspace: &str,
    ) -> Result<Transaction<'a, Postgres>, Error> {
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        sqlx::query_scalar::<_, String>("select set_config('likerts.workspace_id',$1,true)")
            .bind(workspace)
            .fetch_one(&mut *transaction)
            .await
            .map_err(database_error)?;
        Ok(transaction)
    }

    async fn capability_transaction<'a>(
        &'a self,
        token: &str,
    ) -> Result<Transaction<'a, Postgres>, Error> {
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        sqlx::query_scalar::<_, String>(
            "select set_config('likerts.collection_token_hash',$1,true)",
        )
        .bind(token_hash_hex(token))
        .fetch_one(&mut *transaction)
        .await
        .map_err(database_error)?;
        Ok(transaction)
    }

    async fn oauth_capability_transaction<'a>(
        &'a self,
        grant_id: Uuid,
    ) -> Result<Transaction<'a, Postgres>, Error> {
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        sqlx::query_scalar::<_, String>("select set_config('likerts.oauth_grant_id',$1,true)")
            .bind(grant_id.to_string())
            .fetch_one(&mut *transaction)
            .await
            .map_err(database_error)?;
        Ok(transaction)
    }

    async fn collection_id_transaction<'a>(
        &'a self,
        collection_id: Uuid,
    ) -> Result<Transaction<'a, Postgres>, Error> {
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        sqlx::query_scalar::<_, String>("select set_config('likerts.collection_id',$1,true)")
            .bind(collection_id.to_string())
            .fetch_one(&mut *transaction)
            .await
            .map_err(database_error)?;
        Ok(transaction)
    }

    async fn set_workspace(
        transaction: &mut Transaction<'_, Postgres>,
        workspace: &str,
    ) -> Result<(), Error> {
        sqlx::query_scalar::<_, String>("select set_config('likerts.workspace_id',$1,true)")
            .bind(workspace)
            .fetch_one(&mut **transaction)
            .await
            .map(|_| ())
            .map_err(database_error)
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub async fn ensure_workspaces<'a>(
        &self,
        workspaces: impl IntoIterator<Item = &'a String>,
    ) -> Result<(), Error> {
        let unique: HashSet<&String> = workspaces.into_iter().collect();
        for workspace in unique {
            let mut transaction = self.workspace_transaction(workspace).await?;
            sqlx::query("insert into likerts.workspaces(id) values ($1) on conflict do nothing")
                .bind(workspace)
                .execute(&mut *transaction)
                .await
                .map_err(database_error)?;
            transaction.commit().await.map_err(database_error)?;
        }
        Ok(())
    }

    /// Creates the deterministic first-party browser workspace once. Existing
    /// workspaces never regain a revoked membership through this path.
    pub async fn bootstrap_personal_workspace(
        &self,
        workspace: &str,
        subject: &str,
    ) -> Result<bool, Error> {
        if !workspace.starts_with("ws_")
            || workspace.len() != 27
            || !workspace[3..]
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            || subject.trim().is_empty()
            || subject.chars().count() > 255
        {
            return Err(Error::Invalid("invalid browser workspace identity".into()));
        }
        let mut transaction = self.workspace_transaction(workspace).await?;
        let created = sqlx::query_scalar::<_, String>(
            "insert into likerts.workspaces(id) values ($1) on conflict do nothing returning id",
        )
        .bind(workspace)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?
        .is_some();
        if created {
            sqlx::query(
                "insert into likerts.workspace_memberships(workspace_id,subject,role) values($1,$2,'owner')",
            )
            .bind(workspace)
            .bind(subject)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        } else {
            let authorized = sqlx::query_scalar::<_, bool>(
                "select exists(select 1 from likerts.workspaces w join likerts.workspace_memberships m on m.workspace_id=w.id where w.id=$1 and w.deleted_at is null and m.subject=$2 and m.revoked_at is null)",
            )
            .bind(workspace)
            .bind(subject)
            .fetch_one(&mut *transaction)
            .await
            .map_err(database_error)?;
            if !authorized {
                return Err(Error::Forbidden);
            }
        }
        transaction.commit().await.map_err(database_error)?;
        Ok(created)
    }

    pub async fn grant_membership(
        &self,
        workspace: &str,
        subject: &str,
        role: Role,
    ) -> Result<(), Error> {
        if subject.trim().is_empty() || subject.chars().count() > 255 {
            return Err(Error::Invalid("invalid identity subject".into()));
        }
        let role = match role {
            Role::Owner => "owner",
            Role::Editor => "editor",
            Role::Reader => "reader",
        };
        let mut transaction = self.workspace_transaction(workspace).await?;
        sqlx::query(
            "insert into likerts.workspace_memberships(workspace_id,subject,role) values ($1,$2,$3) on conflict (workspace_id,subject) do update set role=excluded.role,granted_at=now(),revoked_at=null",
        )
        .bind(workspace)
        .bind(subject)
        .bind(role)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        transaction.commit().await.map_err(database_error)
    }

    pub async fn revoke_membership(&self, workspace: &str, subject: &str) -> Result<(), Error> {
        let mut transaction = self.workspace_transaction(workspace).await?;
        let changed = sqlx::query(
            "update likerts.workspace_memberships set revoked_at=coalesce(revoked_at,now()) where workspace_id=$1 and subject=$2",
        )
        .bind(workspace)
        .bind(subject)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?
        .rows_affected();
        if changed == 0 {
            return Err(Error::NotFound);
        }
        transaction.commit().await.map_err(database_error)
    }

    pub async fn current_membership(&self, workspace: &str, subject: &str) -> Result<Role, Error> {
        let mut transaction = self.workspace_transaction(workspace).await?;
        let role: Option<String> = sqlx::query_scalar(
            "select role from likerts.workspace_memberships where workspace_id=$1 and subject=$2 and revoked_at is null",
        )
        .bind(workspace)
        .bind(subject)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        match role.as_deref() {
            Some("owner") => Ok(Role::Owner),
            Some("editor") => Ok(Role::Editor),
            Some("reader") => Ok(Role::Reader),
            _ => Err(Error::Forbidden),
        }
    }

    pub async fn memberships(&self, workspace: &str) -> Result<Vec<WorkspaceMembership>, Error> {
        let mut transaction = self.workspace_transaction(workspace).await?;
        let rows = sqlx::query("select subject,role,granted_at from likerts.workspace_memberships where workspace_id=$1 and revoked_at is null order by granted_at,subject")
            .bind(workspace).fetch_all(&mut *transaction).await.map_err(database_error)?;
        let memberships = rows
            .into_iter()
            .map(|row| {
                let role = match row.get::<String, _>("role").as_str() {
                    "owner" => Role::Owner,
                    "editor" => Role::Editor,
                    "reader" => Role::Reader,
                    _ => return Err(Error::Internal),
                };
                Ok(WorkspaceMembership {
                    subject: row.get("subject"),
                    role,
                    granted_at: row.get("granted_at"),
                })
            })
            .collect::<Result<Vec<_>, Error>>()?;
        transaction.commit().await.map_err(database_error)?;
        Ok(memberships)
    }

    pub async fn service_credentials(
        &self,
        workspace: &str,
    ) -> Result<Vec<ServiceCredential>, Error> {
        let mut transaction = self.workspace_transaction(workspace).await?;
        let rows = sqlx::query("select id,name,scopes,expires_at,revoked_at from likerts.service_credentials where workspace_id=$1 order by created_at,id")
            .bind(workspace).fetch_all(&mut *transaction).await.map_err(database_error)?;
        let credentials = rows
            .into_iter()
            .map(|row| ServiceCredential {
                id: row.get::<Uuid, _>("id").to_string(),
                workspace_id: workspace.into(),
                name: row.get("name"),
                scopes: row.get("scopes"),
                expires_at: row.get("expires_at"),
                revoked: row
                    .get::<Option<chrono::DateTime<Utc>>, _>("revoked_at")
                    .is_some(),
            })
            .collect();
        transaction.commit().await.map_err(database_error)?;
        Ok(credentials)
    }

    pub async fn issue_oauth_grant(
        &self,
        workspace: &str,
        subject: &str,
        client_id: &str,
        audience: &str,
        mut scopes: Vec<String>,
        expires_at: chrono::DateTime<Utc>,
    ) -> Result<OAuthGrant, Error> {
        let now = Utc::now();
        scopes.sort();
        scopes.dedup();
        if subject.trim().is_empty()
            || subject.chars().count() > 255
            || client_id.trim().is_empty()
            || client_id.chars().count() > 255
            || audience.trim().is_empty()
            || audience.chars().count() > 500
            || scopes.is_empty()
            || scopes.len() > 32
            || scopes.iter().any(|scope| !valid_scope(scope))
            || expires_at <= now
            || expires_at > now + ChronoDuration::days(30)
        {
            return Err(Error::Invalid("invalid OAuth grant".into()));
        }
        self.current_membership(workspace, subject).await?;
        let id = Uuid::new_v4();
        let mut transaction = self.workspace_transaction(workspace).await?;
        sqlx::query("insert into likerts.oauth_grants(workspace_id,id,subject,client_id,audience,scopes,expires_at) values ($1,$2,$3,$4,$5,$6,$7)")
            .bind(workspace).bind(id).bind(subject).bind(client_id).bind(audience).bind(&scopes).bind(expires_at)
            .execute(&mut *transaction).await.map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(OAuthGrant {
            id: id.to_string(),
            workspace_id: workspace.into(),
            subject: subject.into(),
            client_id: client_id.into(),
            audience: audience.into(),
            scopes,
            expires_at,
            revoked: false,
        })
    }

    pub async fn revoke_oauth_grant(&self, workspace: &str, id: &str) -> Result<(), Error> {
        let id = Uuid::parse_str(id).map_err(|_| Error::NotFound)?;
        let mut transaction = self.workspace_transaction(workspace).await?;
        let changed = sqlx::query("update likerts.oauth_grants set revoked_at=coalesce(revoked_at,now()) where workspace_id=$1 and id=$2")
            .bind(workspace).bind(id).execute(&mut *transaction).await.map_err(database_error)?.rows_affected();
        if changed == 0 {
            return Err(Error::NotFound);
        }
        transaction.commit().await.map_err(database_error)
    }

    pub async fn authorize_oauth(
        &self,
        grant_id: &str,
        subject: &str,
        client_id: &str,
        audience: &str,
        token_scopes: &HashSet<String>,
        required_scope: &str,
        required_role: Role,
    ) -> Result<String, Error> {
        if !valid_scope(required_scope) || !token_scopes.contains(required_scope) {
            return Err(Error::Forbidden);
        }
        let grant_id = Uuid::parse_str(grant_id).map_err(|_| Error::Unauthorized)?;
        let mut transaction = self.oauth_capability_transaction(grant_id).await?;
        let row = sqlx::query("select workspace_id,subject,client_id,audience,scopes,expires_at,revoked_at from likerts.oauth_grants where id=$1")
            .bind(grant_id).fetch_optional(&mut *transaction).await.map_err(database_error)?.ok_or(Error::Unauthorized)?;
        if row
            .get::<Option<chrono::DateTime<Utc>>, _>("revoked_at")
            .is_some()
            || row.get::<chrono::DateTime<Utc>, _>("expires_at") <= Utc::now()
            || row.get::<String, _>("subject") != subject
            || row.get::<String, _>("client_id") != client_id
            || row.get::<String, _>("audience") != audience
        {
            return Err(Error::Unauthorized);
        }
        let grant_scopes: Vec<String> = row.get("scopes");
        if !grant_scopes.iter().any(|scope| scope == required_scope) {
            return Err(Error::Forbidden);
        }
        let workspace: String = row.get("workspace_id");
        Self::set_workspace(&mut transaction, &workspace).await?;
        let role: Option<String> = sqlx::query_scalar("select role from likerts.workspace_memberships where workspace_id=$1 and subject=$2 and revoked_at is null")
            .bind(&workspace).bind(subject).fetch_optional(&mut *transaction).await.map_err(database_error)?;
        let allowed = match (role.as_deref(), required_role) {
            (Some("owner"), _) => true,
            (Some("editor"), Role::Editor | Role::Reader) => true,
            (Some("reader"), Role::Reader) => true,
            _ => false,
        };
        if !allowed {
            return Err(Error::Forbidden);
        }
        transaction.commit().await.map_err(database_error)?;
        Ok(workspace)
    }

    pub async fn authorize_oauth_workspace(
        &self,
        workspace: &str,
        subject: &str,
        client_id: &str,
        audience: &str,
        token_scopes: &HashSet<String>,
        required_scope: &str,
        required_role: Role,
    ) -> Result<String, Error> {
        if !valid_scope(required_scope) || !token_scopes.contains(required_scope) {
            return Err(Error::Forbidden);
        }
        let mut transaction = self.workspace_transaction(workspace).await?;
        let grant_exists: bool = sqlx::query_scalar("select exists(select 1 from likerts.oauth_grants where workspace_id=$1 and subject=$2 and client_id=$3 and audience=$4 and revoked_at is null and expires_at>now() and $5=any(scopes))")
            .bind(workspace)
            .bind(subject)
            .bind(client_id)
            .bind(audience)
            .bind(required_scope)
            .fetch_one(&mut *transaction)
            .await
            .map_err(database_error)?;
        if !grant_exists {
            return Err(Error::Unauthorized);
        }
        let role: Option<String> = sqlx::query_scalar("select role from likerts.workspace_memberships where workspace_id=$1 and subject=$2 and revoked_at is null")
            .bind(workspace)
            .bind(subject)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(database_error)?;
        let allowed = match (role.as_deref(), required_role) {
            (Some("owner"), _) => true,
            (Some("editor"), Role::Editor | Role::Reader) => true,
            (Some("reader"), Role::Reader) => true,
            _ => false,
        };
        if !allowed {
            return Err(Error::Forbidden);
        }
        transaction.commit().await.map_err(database_error)?;
        Ok(workspace.into())
    }

    pub async fn issue_service_credential(
        &self,
        workspace: &str,
        name: &str,
        mut scopes: Vec<String>,
        expires_at: chrono::DateTime<Utc>,
    ) -> Result<(ServiceCredential, String), Error> {
        let now = Utc::now();
        scopes.sort();
        scopes.dedup();
        if name.trim().is_empty()
            || name.chars().count() > 100
            || scopes.is_empty()
            || scopes.len() > 32
            || scopes.iter().any(|scope| !valid_scope(scope))
            || expires_at <= now
            || expires_at > now + ChronoDuration::days(365)
        {
            return Err(Error::Invalid("invalid service credential".into()));
        }
        let id = Uuid::new_v4();
        let token = format!("lks_{}", Uuid::new_v4().simple());
        let mut transaction = self.workspace_transaction(workspace).await?;
        sqlx::query(
            "insert into likerts.service_credentials(workspace_id,id,name,token_hash,scopes,expires_at) values ($1,$2,$3,$4,$5,$6)",
        )
        .bind(workspace)
        .bind(id)
        .bind(name)
        .bind(token_hash(&token))
        .bind(&scopes)
        .bind(expires_at)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok((
            ServiceCredential {
                id: id.to_string(),
                workspace_id: workspace.into(),
                name: name.into(),
                scopes,
                expires_at,
                revoked: false,
            },
            token,
        ))
    }

    pub async fn authenticate_service(
        &self,
        token: &str,
        required_scope: &str,
    ) -> Result<String, Error> {
        if !valid_scope(required_scope) {
            return Err(Error::Internal);
        }
        let row =
            sqlx::query("select workspace_id,scopes from likerts.resolve_service_credential($1)")
                .bind(token_hash(token))
                .fetch_optional(&self.pool)
                .await
                .map_err(database_error)?;
        let Some(row) = row else {
            return Err(Error::Unauthorized);
        };
        let scopes: Vec<String> = row.get("scopes");
        if !scopes.iter().any(|scope| scope == required_scope) {
            return Err(Error::Forbidden);
        }
        let workspace: String = row.get("workspace_id");
        Ok(workspace)
    }

    pub async fn revoke_service_credential(&self, workspace: &str, id: &str) -> Result<(), Error> {
        let id = Uuid::parse_str(id).map_err(|_| Error::NotFound)?;
        let mut transaction = self.workspace_transaction(workspace).await?;
        let changed = sqlx::query(
            "update likerts.service_credentials set revoked_at=coalesce(revoked_at,now()) where workspace_id=$1 and id=$2",
        )
        .bind(workspace)
        .bind(id)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?
        .rows_affected();
        if changed == 0 {
            return Err(Error::NotFound);
        }
        transaction.commit().await.map_err(database_error)
    }

    pub async fn create_survey(&self, workspace: &str, input: DraftInput) -> Result<Survey, Error> {
        validate_draft(&input)?;
        let id = Uuid::new_v4();
        let encoded = serde_json::to_value(&input.questions).map_err(|_| Error::Internal)?;
        let encoded_pages = input
            .pages
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|_| Error::Internal)?;
        let mut transaction = self.workspace_transaction(workspace).await?;
        sqlx::query(
            "insert into likerts.surveys(workspace_id,id,revision,title,questions,pages) values ($1,$2,1,$3,$4,$5)",
        )
        .bind(workspace)
        .bind(id)
        .bind(&input.title)
        .bind(encoded)
        .bind(encoded_pages)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(Survey {
            id: id.to_string(),
            revision: 1,
            title: input.title,
            questions: input.questions,
            pages: input.pages,
        })
    }

    pub async fn create_survey_idempotent(
        &self,
        workspace: &str,
        idempotency_key: &str,
        input: DraftInput,
    ) -> Result<Survey, Error> {
        validate_management_key(idempotency_key)?;
        validate_draft(&input)?;
        let hash = request_hash(&input)?;
        let encoded = serde_json::to_value(&input.questions).map_err(|_| Error::Internal)?;
        let encoded_pages = input
            .pages
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|_| Error::Internal)?;
        let mut transaction = self.workspace_transaction(workspace).await?;
        let workspace_exists: Option<String> =
            sqlx::query_scalar("select id from likerts.workspaces where id=$1 for update")
                .bind(workspace)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(database_error)?;
        if workspace_exists.is_none() {
            return Err(Error::NotFound);
        }
        if let Some(row) = sqlx::query(
            "select payload_hash,response from likerts.management_requests where workspace_id=$1 and operation='surveys_create' and idempotency_key=$2",
        )
        .bind(workspace)
        .bind(idempotency_key)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?
        {
            if row.get::<Vec<u8>, _>("payload_hash") != hash {
                return Err(Error::Conflict);
            }
            let survey = serde_json::from_value(row.get("response")).map_err(|_| Error::Internal)?;
            transaction.commit().await.map_err(database_error)?;
            return Ok(survey);
        }
        let id = Uuid::new_v4();
        sqlx::query(
            "insert into likerts.surveys(workspace_id,id,revision,title,questions,pages) values ($1,$2,1,$3,$4,$5)",
        )
        .bind(workspace)
        .bind(id)
        .bind(&input.title)
        .bind(encoded)
        .bind(encoded_pages)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        let survey = Survey {
            id: id.to_string(),
            revision: 1,
            title: input.title,
            questions: input.questions,
            pages: input.pages,
        };
        sqlx::query(
            "insert into likerts.management_requests(workspace_id,operation,idempotency_key,payload_hash,response) values ($1,'surveys_create',$2,$3,$4)",
        )
        .bind(workspace)
        .bind(idempotency_key)
        .bind(hash)
        .bind(serde_json::to_value(&survey).map_err(|_| Error::Internal)?)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(survey)
    }

    pub async fn surveys(&self, workspace: &str) -> Result<Vec<Survey>, Error> {
        let mut transaction = self.workspace_transaction(workspace).await?;
        let rows = sqlx::query(
            "select id,revision,title,questions,pages from likerts.surveys where workspace_id=$1 order by created_at,id",
        )
        .bind(workspace)
        .fetch_all(&mut *transaction)
        .await
        .map_err(database_error)?;
        let surveys = rows
            .into_iter()
            .map(|row| {
                Ok(Survey {
                    id: row.get::<Uuid, _>("id").to_string(),
                    revision: row.get::<i64, _>("revision") as u64,
                    title: row.get("title"),
                    questions: questions(row.get("questions"))?,
                    pages: pages(row.get("pages"))?,
                })
            })
            .collect::<Result<Vec<_>, Error>>()?;
        transaction.commit().await.map_err(database_error)?;
        Ok(surveys)
    }

    pub async fn update(
        &self,
        workspace: &str,
        id: &str,
        revision: u64,
        input: DraftInput,
    ) -> Result<Survey, Error> {
        validate_draft(&input)?;
        let id = Uuid::parse_str(id).map_err(|_| Error::NotFound)?;
        let encoded = serde_json::to_value(&input.questions).map_err(|_| Error::Internal)?;
        let encoded_pages = input
            .pages
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|_| Error::Internal)?;
        let mut transaction = self.workspace_transaction(workspace).await?;
        let row = sqlx::query(
            "update likerts.surveys set revision=revision+1,title=$4,questions=$5,pages=$6,updated_at=now() where workspace_id=$1 and id=$2 and revision=$3 returning revision",
        )
        .bind(workspace)
        .bind(id)
        .bind(database_integer(revision)?)
        .bind(&input.title)
        .bind(encoded)
        .bind(encoded_pages)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?;
        if let Some(row) = row {
            let survey = Survey {
                id: id.to_string(),
                revision: row.get::<i64, _>("revision") as u64,
                title: input.title,
                questions: input.questions,
                pages: input.pages,
            };
            transaction.commit().await.map_err(database_error)?;
            return Ok(survey);
        }
        let exists: bool = sqlx::query_scalar(
            "select exists(select 1 from likerts.surveys where workspace_id=$1 and id=$2)",
        )
        .bind(workspace)
        .bind(id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(database_error)?;
        Err(if exists {
            Error::Conflict
        } else {
            Error::NotFound
        })
    }

    pub async fn publish(
        &self,
        workspace: &str,
        id: &str,
        revision: u64,
    ) -> Result<Version, Error> {
        self.publish_compatible(workspace, id, revision, SdkCapabilities::current_all())
            .await
    }

    pub async fn publish_compatible(
        &self,
        workspace: &str,
        id: &str,
        revision: u64,
        sdk_capabilities: SdkCapabilities,
    ) -> Result<Version, Error> {
        let id = Uuid::parse_str(id).map_err(|_| Error::NotFound)?;
        let mut transaction = self.workspace_transaction(workspace).await?;
        let row = sqlx::query(
            "select revision,title,questions,pages from likerts.surveys where workspace_id=$1 and id=$2",
        )
        .bind(workspace)
        .bind(id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?
        .ok_or(Error::NotFound)?;
        if row.get::<i64, _>("revision") != database_integer(revision)? {
            return Err(Error::Conflict);
        }
        let title: String = row.get("title");
        let value: Value = row.get("questions");
        let decoded_questions = questions(value.clone())?;
        let encoded_pages: Option<Value> = row.get("pages");
        let decoded_pages = pages(encoded_pages.clone())?;
        validate_sdk_capabilities(
            &sdk_capabilities,
            survey_schema_version(&decoded_questions, decoded_pages.as_deref()),
        )?;
        let encoded_capabilities =
            serde_json::to_value(&sdk_capabilities).map_err(|_| Error::Internal)?;
        sqlx::query(
            "insert into likerts.survey_versions(workspace_id,survey_id,version,title,questions,pages,sdk_capabilities) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing",
        )
        .bind(workspace)
        .bind(id)
        .bind(database_integer(revision)?)
        .bind(&title)
        .bind(&value)
        .bind(&encoded_pages)
        .bind(&encoded_capabilities)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        let stored_capabilities: Value = sqlx::query_scalar(
            "select sdk_capabilities from likerts.survey_versions where workspace_id=$1 and survey_id=$2 and version=$3",
        )
        .bind(workspace)
        .bind(id)
        .bind(database_integer(revision)?)
        .fetch_one(&mut *transaction)
        .await
        .map_err(database_error)?;
        if stored_capabilities != encoded_capabilities {
            return Err(Error::Conflict);
        }
        let version = Version {
            survey_id: id.to_string(),
            version: revision,
            title,
            questions: decoded_questions,
            pages: decoded_pages,
            sdk_capabilities,
        };
        transaction.commit().await.map_err(database_error)?;
        Ok(version)
    }

    pub async fn create_collection(
        &self,
        workspace: &str,
        survey_id: &str,
        version: u64,
        placement: &str,
    ) -> Result<Collection, Error> {
        self.create_collection_with_limits(
            workspace,
            survey_id,
            version,
            placement,
            CollectionLimits::default(),
        )
        .await
    }

    pub async fn create_collection_with_limits(
        &self,
        workspace: &str,
        survey_id: &str,
        version: u64,
        placement: &str,
        limits: CollectionLimits,
    ) -> Result<Collection, Error> {
        self.create_collection_compatible(
            workspace,
            survey_id,
            version,
            placement,
            limits,
            SdkCapabilities::current_all(),
        )
        .await
    }

    pub async fn create_collection_compatible(
        &self,
        workspace: &str,
        survey_id: &str,
        version: u64,
        placement: &str,
        limits: CollectionLimits,
        sdk_capabilities: SdkCapabilities,
    ) -> Result<Collection, Error> {
        if placement.trim().is_empty() || placement.chars().count() > 200 {
            return Err(Error::Invalid("invalid placement".into()));
        }
        if limits.response_cap == Some(0)
            || limits.expires_at.is_some_and(|expiry| {
                let now = Utc::now();
                expiry <= now || expiry > now + ChronoDuration::days(90)
            })
        {
            return Err(Error::Invalid("invalid collection limits".into()));
        }
        let survey_id = Uuid::parse_str(survey_id).map_err(|_| Error::NotFound)?;
        let mut transaction = self.workspace_transaction(workspace).await?;
        let workspace_exists: Option<String> =
            sqlx::query_scalar("select id from likerts.workspaces where id=$1 for update")
                .bind(workspace)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(database_error)?;
        if workspace_exists.is_none() {
            return Err(Error::NotFound);
        }
        let active: i64 = sqlx::query_scalar(
            "select count(*) from likerts.collections where workspace_id=$1 and accepting and revoked_at is null and (expires_at is null or expires_at > now())",
        )
        .bind(workspace)
        .fetch_one(&mut *transaction)
        .await
        .map_err(database_error)?;
        if active >= 100 {
            return Err(Error::Capacity);
        }
        let published = sqlx::query(
            "select questions,pages from likerts.survey_versions where workspace_id=$1 and survey_id=$2 and version=$3",
        )
        .bind(workspace)
        .bind(survey_id)
        .bind(database_integer(version)?)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?
        .ok_or(Error::NotFound)?;
        let published_questions = questions(published.get("questions"))?;
        let published_pages = pages(published.get("pages"))?;
        validate_sdk_capabilities(
            &sdk_capabilities,
            survey_schema_version(&published_questions, published_pages.as_deref()),
        )?;
        let id = Uuid::new_v4();
        let token = self.collection_token(workspace, id);
        sqlx::query(
            "insert into likerts.collections(workspace_id,id,survey_id,version,placement,token_hash,expires_at,response_cap,sdk_capabilities) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind(workspace)
        .bind(id)
        .bind(survey_id)
        .bind(database_integer(version)?)
        .bind(placement)
        .bind(token_hash(&token))
        .bind(limits.expires_at)
        .bind(limits.response_cap.map(database_integer).transpose()?)
        .bind(serde_json::to_value(&sdk_capabilities).map_err(|_| Error::Internal)?)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        let collection = Collection {
            id: id.to_string(),
            survey_id: survey_id.to_string(),
            version,
            placement: placement.into(),
            token,
            accepting: true,
            expires_at: limits.expires_at,
            response_cap: limits.response_cap,
            revoked: false,
            sdk_capabilities,
        };
        transaction.commit().await.map_err(database_error)?;
        Ok(collection)
    }

    pub async fn create_collection_idempotent(
        &self,
        workspace: &str,
        idempotency_key: &str,
        survey_id: &str,
        version: u64,
        placement: &str,
        limits: CollectionLimits,
    ) -> Result<Collection, Error> {
        self.create_collection_idempotent_compatible(
            workspace,
            idempotency_key,
            survey_id,
            version,
            placement,
            limits,
            SdkCapabilities::current_all(),
        )
        .await
    }

    pub async fn create_collection_idempotent_compatible(
        &self,
        workspace: &str,
        idempotency_key: &str,
        survey_id: &str,
        version: u64,
        placement: &str,
        limits: CollectionLimits,
        sdk_capabilities: SdkCapabilities,
    ) -> Result<Collection, Error> {
        validate_management_key(idempotency_key)?;
        if placement.trim().is_empty() || placement.chars().count() > 200 {
            return Err(Error::Invalid("invalid placement".into()));
        }
        if limits.response_cap == Some(0)
            || limits.expires_at.is_some_and(|expiry| {
                let now = Utc::now();
                expiry <= now || expiry > now + ChronoDuration::days(90)
            })
        {
            return Err(Error::Invalid("invalid collection limits".into()));
        }
        let hash = request_hash(&(survey_id, version, placement, &limits, &sdk_capabilities))?;
        let survey_id = Uuid::parse_str(survey_id).map_err(|_| Error::NotFound)?;
        let mut transaction = self.workspace_transaction(workspace).await?;
        let workspace_exists: Option<String> =
            sqlx::query_scalar("select id from likerts.workspaces where id=$1 for update")
                .bind(workspace)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(database_error)?;
        if workspace_exists.is_none() {
            return Err(Error::NotFound);
        }
        if let Some(row) = sqlx::query(
            "select payload_hash,response from likerts.management_requests where workspace_id=$1 and operation='collections_create' and idempotency_key=$2",
        )
        .bind(workspace)
        .bind(idempotency_key)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?
        {
            if row.get::<Vec<u8>, _>("payload_hash") != hash {
                return Err(Error::Conflict);
            }
            let mut response: Value = row.get("response");
            let collection_id = response
                .get("id")
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
                .ok_or(Error::Internal)?;
            response["token"] = Value::String(self.collection_token(workspace, collection_id));
            let collection = serde_json::from_value(response).map_err(|_| Error::Internal)?;
            transaction.commit().await.map_err(database_error)?;
            return Ok(collection);
        }
        let active: i64 = sqlx::query_scalar(
            "select count(*) from likerts.collections where workspace_id=$1 and accepting and revoked_at is null and (expires_at is null or expires_at > now())",
        )
        .bind(workspace)
        .fetch_one(&mut *transaction)
        .await
        .map_err(database_error)?;
        if active >= 100 {
            return Err(Error::Capacity);
        }
        let published = sqlx::query(
            "select questions,pages from likerts.survey_versions where workspace_id=$1 and survey_id=$2 and version=$3",
        )
        .bind(workspace)
        .bind(survey_id)
        .bind(database_integer(version)?)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?
        .ok_or(Error::NotFound)?;
        let published_questions = questions(published.get("questions"))?;
        let published_pages = pages(published.get("pages"))?;
        validate_sdk_capabilities(
            &sdk_capabilities,
            survey_schema_version(&published_questions, published_pages.as_deref()),
        )?;
        let id = Uuid::new_v4();
        let token = self.collection_token(workspace, id);
        sqlx::query(
            "insert into likerts.collections(workspace_id,id,survey_id,version,placement,token_hash,expires_at,response_cap,sdk_capabilities) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind(workspace)
        .bind(id)
        .bind(survey_id)
        .bind(database_integer(version)?)
        .bind(placement)
        .bind(token_hash(&token))
        .bind(limits.expires_at)
        .bind(limits.response_cap.map(database_integer).transpose()?)
        .bind(serde_json::to_value(&sdk_capabilities).map_err(|_| Error::Internal)?)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        let collection = Collection {
            id: id.to_string(),
            survey_id: survey_id.to_string(),
            version,
            placement: placement.into(),
            token,
            accepting: true,
            expires_at: limits.expires_at,
            response_cap: limits.response_cap,
            revoked: false,
            sdk_capabilities,
        };
        let mut retry_response = serde_json::to_value(&collection).map_err(|_| Error::Internal)?;
        retry_response
            .as_object_mut()
            .ok_or(Error::Internal)?
            .remove("token");
        sqlx::query(
            "insert into likerts.management_requests(workspace_id,operation,idempotency_key,payload_hash,response) values ($1,'collections_create',$2,$3,$4)",
        )
        .bind(workspace)
        .bind(idempotency_key)
        .bind(hash)
        .bind(retry_response)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(collection)
    }

    pub async fn collection_schema(
        &self,
        id: &str,
        token: &str,
    ) -> Result<(Collection, Version), Error> {
        let id = Uuid::parse_str(id).map_err(|_| Error::Unauthorized)?;
        let mut transaction = self.capability_transaction(token).await?;
        let row = sqlx::query(
            "select workspace_id,survey_id,version,placement,accepting,expires_at,response_cap,sdk_capabilities,revoked_at is not null as revoked from likerts.collections where id=$1 and token_hash=$2",
        )
        .bind(id)
        .bind(token_hash(token))
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?
        .ok_or(Error::Unauthorized)?;
        let workspace: String = row.get("workspace_id");
        let survey_id: Uuid = row.get("survey_id");
        let version = row.get::<i64, _>("version") as u64;
        let placement: String = row.get("placement");
        let accepting: bool = row.get("accepting");
        if row.get::<bool, _>("revoked") {
            return Err(Error::Revoked);
        }
        Self::set_workspace(&mut transaction, &workspace).await?;
        let version_row = sqlx::query(
            "select title,questions,pages,sdk_capabilities from likerts.survey_versions where workspace_id=$1 and survey_id=$2 and version=$3",
        )
        .bind(&workspace)
        .bind(survey_id)
        .bind(database_integer(version)?)
        .fetch_one(&mut *transaction)
        .await
        .map_err(database_error)?;
        let result = (
            Collection {
                id: id.to_string(),
                survey_id: survey_id.to_string(),
                version,
                placement,
                token: String::new(),
                accepting,
                expires_at: row.get("expires_at"),
                response_cap: row
                    .get::<Option<i64>, _>("response_cap")
                    .map(|value| value as u64),
                revoked: row.get("revoked"),
                sdk_capabilities: serde_json::from_value(row.get("sdk_capabilities"))
                    .map_err(|_| Error::Internal)?,
            },
            Version {
                survey_id: survey_id.to_string(),
                version,
                title: version_row.get("title"),
                questions: questions(version_row.get("questions"))?,
                pages: pages(version_row.get("pages"))?,
                sdk_capabilities: serde_json::from_value(version_row.get("sdk_capabilities"))
                    .map_err(|_| Error::Internal)?,
            },
        );
        transaction.commit().await.map_err(database_error)?;
        Ok(result)
    }

    pub async fn set_accepting(
        &self,
        workspace: &str,
        id: &str,
        accepting: bool,
    ) -> Result<(), Error> {
        let id = Uuid::parse_str(id).map_err(|_| Error::NotFound)?;
        let mut transaction = self.workspace_transaction(workspace).await?;
        let workspace_exists: Option<String> =
            sqlx::query_scalar("select id from likerts.workspaces where id=$1 for update")
                .bind(workspace)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(database_error)?;
        if workspace_exists.is_none() {
            return Err(Error::NotFound);
        }
        let collection = sqlx::query(
            "select expires_at,revoked_at from likerts.collections where workspace_id=$1 and id=$2 for update",
        )
        .bind(workspace)
        .bind(id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?
        .ok_or(Error::NotFound)?;
        if collection
            .get::<Option<chrono::DateTime<Utc>>, _>("revoked_at")
            .is_some()
        {
            return Err(Error::Revoked);
        }
        if accepting {
            if collection
                .get::<Option<chrono::DateTime<Utc>>, _>("expires_at")
                .is_some_and(|expiry| expiry <= Utc::now())
            {
                return Err(Error::Expired);
            }
            let active: i64 = sqlx::query_scalar(
                "select count(*) from likerts.collections where workspace_id=$1 and id<>$2 and accepting and revoked_at is null and (expires_at is null or expires_at > now())",
            )
            .bind(workspace)
            .bind(id)
            .fetch_one(&mut *transaction)
            .await
            .map_err(database_error)?;
            if active >= 100 {
                return Err(Error::Capacity);
            }
        }
        sqlx::query("update likerts.collections set accepting=$3 where workspace_id=$1 and id=$2")
            .bind(workspace)
            .bind(id)
            .bind(accepting)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        transaction.commit().await.map_err(database_error)
    }

    pub async fn revoke_collection(&self, workspace: &str, id: &str) -> Result<(), Error> {
        let id = Uuid::parse_str(id).map_err(|_| Error::NotFound)?;
        let mut transaction = self.workspace_transaction(workspace).await?;
        let changed = sqlx::query(
            "update likerts.collections set accepting=false,revoked_at=coalesce(revoked_at,now()) where workspace_id=$1 and id=$2",
        )
        .bind(workspace)
        .bind(id)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?
        .rows_affected();
        if changed == 0 {
            return Err(Error::NotFound);
        }
        transaction.commit().await.map_err(database_error)
    }

    pub async fn set_collection_security(
        &self,
        workspace: &str,
        id: &str,
        input: CollectionSecurityInput,
    ) -> Result<CollectionSecurity, Error> {
        validate_collection_security(&input)?;
        let id = Uuid::parse_str(id).map_err(|_| Error::NotFound)?;
        let mut transaction = self.workspace_transaction(workspace).await?;
        let row = sqlx::query("update likerts.collections set allowed_origins=$3,requests_per_minute=$4 where workspace_id=$1 and id=$2 returning id")
            .bind(workspace).bind(id).bind(&input.allowed_origins).bind(i32::try_from(input.requests_per_minute).map_err(|_| Error::Invalid("invalid collection security policy".into()))?)
            .fetch_optional(&mut *transaction).await.map_err(database_error)?.ok_or(Error::NotFound)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(CollectionSecurity {
            collection_id: row.get::<Uuid, _>("id").to_string(),
            allowed_origins: input.allowed_origins,
            requests_per_minute: input.requests_per_minute,
        })
    }

    pub async fn collection_origin_allowed(&self, id: &str, origin: &str) -> Result<bool, Error> {
        let id = Uuid::parse_str(id).map_err(|_| Error::NotFound)?;
        let mut transaction = self.collection_id_transaction(id).await?;
        let origins: Option<Vec<String>> =
            sqlx::query_scalar("select allowed_origins from likerts.collections where id=$1")
                .bind(id)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(origins.is_some_and(|values| values.iter().any(|value| value == origin)))
    }

    pub async fn consume_collection_rate(&self, id: &str, token: &str) -> Result<(), Error> {
        let id = Uuid::parse_str(id).map_err(|_| Error::Unauthorized)?;
        let mut capability = self.capability_transaction(token).await?;
        let row = sqlx::query("select workspace_id,requests_per_minute from likerts.collections where id=$1 and token_hash=$2")
            .bind(id).bind(token_hash(token)).fetch_optional(&mut *capability).await.map_err(database_error)?.ok_or(Error::Unauthorized)?;
        let workspace: String = row.get("workspace_id");
        let limit: i32 = row.get("requests_per_minute");
        capability.commit().await.map_err(database_error)?;

        let mut transaction = self.workspace_transaction(&workspace).await?;
        let consumed = sqlx::query_scalar::<_, i32>("insert into likerts.collection_rate_windows(workspace_id,collection_id,window_start,attempts) values ($1,$2,date_trunc('minute',now()),1) on conflict (workspace_id,collection_id,window_start) do update set attempts=likerts.collection_rate_windows.attempts+1 where likerts.collection_rate_windows.attempts < $3 returning attempts")
            .bind(&workspace).bind(id).bind(limit).fetch_optional(&mut *transaction).await.map_err(database_error)?;
        if consumed.is_none() {
            return Err(Error::RateLimited);
        }
        sqlx::query("delete from likerts.collection_rate_windows where workspace_id=$1 and window_start < date_trunc('minute',now()) - interval '1 hour'")
            .bind(&workspace).execute(&mut *transaction).await.map_err(database_error)?;
        transaction.commit().await.map_err(database_error)
    }

    async fn prior_receipt(
        transaction: &mut Transaction<'_, Postgres>,
        workspace: &str,
        collection_id: Uuid,
        submission: &Submission,
        payload_hash: &[u8],
    ) -> Result<Option<Receipt>, Error> {
        let row = sqlx::query(
            "select id,payload_hash,raw_deleted_at from likerts.responses where workspace_id=$1 and collection_id=$2 and idempotency_key=$3",
        )
        .bind(workspace)
        .bind(collection_id)
        .bind(&submission.idempotency_key)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(database_error)?;
        let Some(row) = row else {
            return Ok(None);
        };
        let stored_hash: Option<Vec<u8>> = row.get("payload_hash");
        if stored_hash.is_none()
            && row
                .get::<Option<chrono::DateTime<Utc>>, _>("raw_deleted_at")
                .is_some()
        {
            return Err(Error::ReceiptExpired);
        }
        if stored_hash.as_deref() != Some(payload_hash) {
            return Err(Error::Conflict);
        }
        Ok(Some(Receipt {
            response_id: row.get::<Uuid, _>("id").to_string(),
            collection_id: collection_id.to_string(),
            accepted: true,
        }))
    }

    /// Look up an already accepted idempotent submission before consuming a new
    /// rate-limit attempt. Revocation remains terminal and changed payloads conflict.
    pub async fn lookup_receipt(
        &self,
        id: &str,
        token: &str,
        submission: &Submission,
    ) -> Result<Option<Receipt>, Error> {
        if submission.idempotency_key.trim().is_empty()
            || submission.idempotency_key.chars().count() > 128
        {
            return Ok(None);
        }
        let id = Uuid::parse_str(id).map_err(|_| Error::Unauthorized)?;
        let payload_hash = submission_hash(token, submission)?;
        let mut transaction = self.capability_transaction(token).await?;
        let row = sqlx::query(
            "select workspace_id,revoked_at from likerts.collections where id=$1 and token_hash=$2",
        )
        .bind(id)
        .bind(token_hash(token))
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?
        .ok_or(Error::Unauthorized)?;
        if row
            .get::<Option<chrono::DateTime<Utc>>, _>("revoked_at")
            .is_some()
        {
            return Err(Error::Revoked);
        }
        let workspace: String = row.get("workspace_id");
        Self::set_workspace(&mut transaction, &workspace).await?;
        let receipt =
            Self::prior_receipt(&mut transaction, &workspace, id, submission, &payload_hash)
                .await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(receipt)
    }

    pub async fn submit(
        &self,
        id: &str,
        token: &str,
        submission: Submission,
    ) -> Result<Receipt, Error> {
        if submission.idempotency_key.trim().is_empty()
            || submission.idempotency_key.chars().count() > 128
        {
            return Err(Error::Invalid(
                "idempotencyKey required, max 128 characters".into(),
            ));
        }
        if serde_json::to_vec(&submission.metadata)
            .map_err(|_| Error::Internal)?
            .len()
            > 4096
        {
            return Err(Error::Invalid("metadata exceeds 4096 bytes".into()));
        }
        let id = Uuid::parse_str(id).map_err(|_| Error::Unauthorized)?;
        let payload_hash = submission_hash(token, &submission)?;
        let mut transaction = self.capability_transaction(token).await?;
        let capability = sqlx::query(
            "select workspace_id from likerts.collections where id=$1 and token_hash=$2",
        )
        .bind(id)
        .bind(token_hash(token))
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?
        .ok_or(Error::Unauthorized)?;
        let workspace: String = capability.get("workspace_id");
        Self::set_workspace(&mut transaction, &workspace).await?;
        // Ledger inserts hold a workspace FK key-share lock. Acquire it before
        // the collection lock, matching management's workspace→collection order.
        // Key-share remains compatible across concurrent response submissions.
        sqlx::query("select id from likerts.workspaces where id=$1 for key share")
            .bind(&workspace)
            .fetch_one(&mut *transaction)
            .await
            .map_err(database_error)?;
        let row = sqlx::query(
            "select survey_id,version,accepting,expires_at,response_cap,accepted_count,revoked_at from likerts.collections where workspace_id=$1 and id=$2 and token_hash=$3 for update",
        )
        .bind(&workspace)
        .bind(id)
        .bind(token_hash(token))
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?
        .ok_or(Error::Unauthorized)?;
        if row
            .get::<Option<chrono::DateTime<Utc>>, _>("revoked_at")
            .is_some()
        {
            return Err(Error::Revoked);
        }
        if let Some(receipt) =
            Self::prior_receipt(&mut transaction, &workspace, id, &submission, &payload_hash)
                .await?
        {
            transaction.commit().await.map_err(database_error)?;
            return Ok(receipt);
        }
        if !row.get::<bool, _>("accepting") {
            return Err(Error::Closed);
        }
        if row
            .get::<Option<chrono::DateTime<Utc>>, _>("expires_at")
            .is_some_and(|expiry| expiry <= Utc::now())
        {
            return Err(Error::Expired);
        }
        if row
            .get::<Option<i64>, _>("response_cap")
            .is_some_and(|cap| row.get::<i64, _>("accepted_count") >= cap)
        {
            return Err(Error::Capacity);
        }
        let version_row = sqlx::query(
            "select questions,pages from likerts.survey_versions where workspace_id=$1 and survey_id=$2 and version=$3",
        )
        .bind(&workspace)
        .bind(row.get::<Uuid, _>("survey_id"))
        .bind(row.get::<i64, _>("version"))
        .fetch_one(&mut *transaction)
        .await
        .map_err(database_error)?;
        let version_questions = questions(version_row.get("questions"))?;
        let version_pages = pages(version_row.get("pages"))?;
        let stored_answers = normalized_answers_for_pages(
            &version_questions,
            version_pages.as_deref(),
            &submission.answers,
        )?;
        // A first response-list page takes the matching exclusive advisory lock while it fixes
        // its upper sequence. Taking the shared lock before allocating a sequence makes that
        // boundary include all earlier submissions and exclude every later one.
        sqlx::query("select pg_advisory_xact_lock_shared(hashtextextended($1,0))")
            .bind(&workspace)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        let response_id = Uuid::new_v4();
        let inserted = sqlx::query(
            "insert into likerts.responses(workspace_id,id,collection_id,idempotency_key,answers,metadata,payload_hash) values ($1,$2,$3,$4,$5,$6,$7) on conflict (workspace_id,collection_id,idempotency_key) do nothing returning id",
        )
        .bind(&workspace)
        .bind(response_id)
        .bind(id)
        .bind(&submission.idempotency_key)
        .bind(Value::Object(stored_answers))
        .bind(Value::Object(submission.metadata.clone()))
        .bind(&payload_hash)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?;
        let receipt = if inserted.is_some() {
            sqlx::query(
                "insert into likerts.usage_entries(workspace_id,response_id,amount_cents) values ($1,$2,1)",
            )
            .bind(&workspace)
            .bind(response_id)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
            sqlx::query(
                "update likerts.collections set accepted_count=accepted_count+1 where workspace_id=$1 and id=$2",
            )
            .bind(&workspace)
            .bind(id)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
            Receipt {
                response_id: response_id.to_string(),
                collection_id: id.to_string(),
                accepted: true,
            }
        } else {
            Self::prior_receipt(&mut transaction, &workspace, id, &submission, &payload_hash)
                .await?
                .ok_or(Error::Internal)?
        };
        transaction.commit().await.map_err(database_error)?;
        Ok(receipt)
    }

    pub async fn responses(
        &self,
        workspace: &str,
        input: ResponseListInput,
    ) -> Result<ResponsePage, Error> {
        let mut transaction = self.workspace_transaction(workspace).await?;
        let upper_sequence = if input.cursor.is_none() {
            sqlx::query("select pg_advisory_xact_lock(hashtextextended($1,0))")
                .bind(workspace)
                .execute(&mut *transaction)
                .await
                .map_err(database_error)?;
            sqlx::query_scalar::<_, i64>(
                "select coalesce(max(retrieval_sequence),0) from likerts.responses where workspace_id=$1",
            )
            .bind(workspace)
            .fetch_one(&mut *transaction)
            .await
            .map_err(database_error)?
        } else {
            0
        };
        let cursor = input.resolve(|| upper_sequence)?;
        let collection_id = cursor
            .collection_id
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|_| Error::Invalid("invalid response list query".into()))?;
        let rows = sqlx::query(
            "select id,collection_id,answers,metadata,accepted_at,retrieval_sequence
             from likerts.responses
             where workspace_id=$1 and raw_deleted_at is null
               and retrieval_sequence>$2 and retrieval_sequence<=$3
               and ($4::uuid is null or collection_id=$4)
               and ($5::timestamptz is null or accepted_at >= $5)
               and ($6::timestamptz is null or accepted_at < $6)
             order by retrieval_sequence
             limit $7",
        )
        .bind(workspace)
        .bind(cursor.after_sequence)
        .bind(cursor.upper_sequence)
        .bind(collection_id)
        .bind(cursor.accepted_from)
        .bind(cursor.accepted_to)
        .bind(i64::from(cursor.limit) + 1)
        .fetch_all(&mut *transaction)
        .await
        .map_err(database_error)?;
        let responses = rows
            .into_iter()
            .map(|row| Response {
                receipt: Receipt {
                    response_id: row.get::<Uuid, _>("id").to_string(),
                    collection_id: row.get::<Uuid, _>("collection_id").to_string(),
                    accepted: true,
                },
                answers: match row.get::<Value, _>("answers") {
                    Value::Object(value) => value,
                    _ => unreachable!("database constraint requires object"),
                },
                metadata: match row.get::<Value, _>("metadata") {
                    Value::Object(value) => value,
                    _ => unreachable!("database constraint requires object"),
                },
                accepted_at: row.get("accepted_at"),
                retrieval_sequence: row.get("retrieval_sequence"),
            })
            .collect();
        transaction.commit().await.map_err(database_error)?;
        response_page(responses, cursor)
    }

    pub async fn create_export(
        &self,
        workspace: &str,
        input: ExportInput,
    ) -> Result<ExportJob, Error> {
        validate_management_key(&input.idempotency_key)?;
        if matches!((input.accepted_from,input.accepted_to),(Some(from),Some(to)) if from >= to) {
            return Err(Error::Invalid("invalid export filters".into()));
        }
        let collection_id = input
            .collection_id
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|_| Error::Invalid("invalid export filters".into()))?;
        let hash = request_hash(&input)?;
        let mut transaction = self.workspace_transaction(workspace).await?;
        sqlx::query("select id from likerts.workspaces where id=$1 for update")
            .bind(workspace)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(database_error)?
            .ok_or(Error::NotFound)?;
        // Reap abandoned reservations within this tenant before reserving capacity.
        sqlx::query("update likerts.export_jobs set status='failed',error_code='attempt_expired',lease_id=null,lease_expires_at=null where workspace_id=$1 and (status='running' and (lease_expires_at is null or lease_expires_at<=now() or expires_at<=now()) or status='queued' and (created_at<=now()-interval '5 minutes' or expires_at<=now()))")
            .bind(workspace).execute(&mut *transaction).await.map_err(database_error)?;
        if let Some(row) = sqlx::query("select id,request_hash,format,status,created_at,expires_at,response_count,content_sha256,manifest,error_code from likerts.export_jobs where workspace_id=$1 and idempotency_key=$2")
            .bind(workspace).bind(&input.idempotency_key).fetch_optional(&mut *transaction).await.map_err(database_error)? {
            if row.get::<Vec<u8>,_>("request_hash") != hash { return Err(Error::Conflict); }
            if row.get::<chrono::DateTime<Utc>,_>("expires_at") <= Utc::now() { return Err(Error::ExportExpired); }
            let row = if row.get::<String,_>("status") == "failed" {
                let active: bool = sqlx::query_scalar("select exists(select 1 from likerts.export_jobs where workspace_id=$1 and status in ('queued','running'))")
                    .bind(workspace).fetch_one(&mut *transaction).await.map_err(database_error)?;
                if active { return Err(Error::Capacity); }
                sqlx::query("update likerts.export_jobs set status='queued',error_code=null where workspace_id=$1 and id=$2 returning id,format,status,created_at,expires_at,response_count,content_sha256,manifest,error_code")
                    .bind(workspace).bind(row.get::<Uuid,_>("id")).fetch_one(&mut *transaction).await.map_err(database_error)?
            } else { row };
            let job = export_job(row)?; transaction.commit().await.map_err(database_error)?; return Ok(job);
        }
        let active: i64 = sqlx::query_scalar("select count(*) from likerts.export_jobs where workspace_id=$1 and status in ('queued','running')")
            .bind(workspace).fetch_one(&mut *transaction).await.map_err(database_error)?;
        if active > 0 {
            return Err(Error::Capacity);
        }
        if let Some(collection_id) = collection_id {
            let exists = sqlx::query_scalar::<_, i32>(
                "select 1 from likerts.collections where workspace_id=$1 and id=$2",
            )
            .bind(workspace)
            .bind(collection_id)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(database_error)?;
            if exists.is_none() {
                return Err(Error::NotFound);
            }
        }
        sqlx::query("select pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(workspace)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        let upper: i64 = sqlx::query_scalar("select coalesce(max(retrieval_sequence),0) from likerts.responses where workspace_id=$1")
            .bind(workspace).fetch_one(&mut *transaction).await.map_err(database_error)?;
        let id = Uuid::new_v4();
        let format = match &input.format {
            ExportFormat::Csv => "csv",
            ExportFormat::Json => "json",
        };
        let row = sqlx::query("insert into likerts.export_jobs(workspace_id,id,idempotency_key,request_hash,format,collection_id,accepted_from,accepted_to,upper_sequence,status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued') returning id,format,status,created_at,expires_at,response_count,content_sha256,manifest,error_code")
            .bind(workspace).bind(id).bind(&input.idempotency_key).bind(hash).bind(format).bind(collection_id)
            .bind(input.accepted_from).bind(input.accepted_to).bind(upper).fetch_one(&mut *transaction).await.map_err(database_error)?;
        let job = export_job(row)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(job)
    }

    pub async fn claim_export(&self, workspace: &str, id: &str) -> Result<Option<String>, Error> {
        let id = Uuid::parse_str(id).map_err(|_| Error::NotFound)?;
        let mut transaction = self.workspace_transaction(workspace).await?;
        let lease = Uuid::new_v4();
        let claimed = sqlx::query("update likerts.export_jobs set status='running',lease_id=$3,lease_expires_at=now()+make_interval(secs=>$4),error_code=null where workspace_id=$1 and id=$2 and (status='queued' or status='running' and (lease_expires_at is null or lease_expires_at<=now())) and expires_at>now() returning id")
            .bind(workspace).bind(id).bind(lease).bind(crate::exports::EXPORT_LEASE_SECONDS as f64)
            .fetch_optional(&mut *transaction).await.map_err(database_error)?.is_some();
        transaction.commit().await.map_err(database_error)?;
        Ok(claimed.then(|| lease.to_string()))
    }

    pub async fn export_snapshot(
        &self,
        workspace: &str,
        id: &str,
        lease: &str,
    ) -> Result<ExportSnapshot, Error> {
        let id = Uuid::parse_str(id).map_err(|_| Error::NotFound)?;
        let mut transaction = self.workspace_transaction(workspace).await?;
        let job = sqlx::query("select format,collection_id,accepted_from,accepted_to,upper_sequence,status,expires_at,lease_id,lease_expires_at from likerts.export_jobs where workspace_id=$1 and id=$2")
            .bind(workspace).bind(id).fetch_optional(&mut *transaction).await.map_err(database_error)?.ok_or(Error::NotFound)?;
        if job.get::<chrono::DateTime<Utc>, _>("expires_at") <= Utc::now() {
            return Err(Error::ExportExpired);
        }
        if job.get::<String, _>("status") != "running"
            || job
                .get::<Option<Uuid>, _>("lease_id")
                .map(|v| v.to_string())
                .as_deref()
                != Some(lease)
            || job
                .get::<Option<chrono::DateTime<Utc>>, _>("lease_expires_at")
                .is_none_or(|v| v <= Utc::now())
        {
            return Err(Error::NotReady);
        }
        let collection_id: Option<Uuid> = job.get("collection_id");
        let accepted_from: Option<chrono::DateTime<Utc>> = job.get("accepted_from");
        let accepted_to: Option<chrono::DateTime<Utc>> = job.get("accepted_to");
        let upper: i64 = job.get("upper_sequence");
        let bounds = sqlx::query("select count(*)::bigint as count,coalesce(sum(pg_column_size(answers)+pg_column_size(metadata)+128),0)::bigint as bytes from likerts.responses
            where workspace_id=$1 and raw_deleted_at is null and retrieval_sequence<=$2 and ($3::uuid is null or collection_id=$3)
              and ($4::timestamptz is null or accepted_at >= $4) and ($5::timestamptz is null or accepted_at < $5)")
            .bind(workspace).bind(upper).bind(collection_id).bind(accepted_from).bind(accepted_to)
            .fetch_one(&mut *transaction).await.map_err(database_error)?;
        if bounds.get::<i64, _>("count") > crate::exports::MAX_EXPORT_RESPONSES as i64
            || bounds.get::<i64, _>("bytes") > crate::exports::MAX_EXPORT_BYTES as i64
        {
            return Err(Error::Capacity);
        }
        let rows = sqlx::query("select r.id,r.collection_id,r.answers,r.metadata,r.accepted_at,r.retrieval_sequence,c.survey_id,c.version,v.title,v.questions,v.pages
            from likerts.responses r join likerts.collections c on (c.workspace_id,c.id)=(r.workspace_id,r.collection_id)
            join likerts.survey_versions v on (v.workspace_id,v.survey_id,v.version)=(c.workspace_id,c.survey_id,c.version)
            where r.workspace_id=$1 and r.raw_deleted_at is null and r.retrieval_sequence<=$2 and ($3::uuid is null or r.collection_id=$3)
              and ($4::timestamptz is null or r.accepted_at >= $4) and ($5::timestamptz is null or r.accepted_at < $5)
            order by r.retrieval_sequence")
            .bind(workspace).bind(upper).bind(collection_id).bind(accepted_from).bind(accepted_to)
            .fetch_all(&mut *transaction).await.map_err(database_error)?;
        let mut responses = Vec::with_capacity(rows.len());
        let mut schema_keys = HashSet::new();
        let mut schemas = Vec::new();
        for row in rows {
            let survey_id = row.get::<Uuid, _>("survey_id").to_string();
            let version = row.get::<i64, _>("version") as u64;
            let question_list = questions(row.get("questions"))?;
            let page_list = pages(row.get("pages"))?;
            if schema_keys.insert((survey_id.clone(), version)) {
                schemas.push(ExportSchema {
                    survey_id,
                    version,
                    schema_version: survey_schema_version(&question_list, page_list.as_deref()),
                    title: row.get("title"),
                    questions: question_list,
                    pages: page_list,
                });
            }
            responses.push(Response {
                receipt: Receipt {
                    response_id: row.get::<Uuid, _>("id").to_string(),
                    collection_id: row.get::<Uuid, _>("collection_id").to_string(),
                    accepted: true,
                },
                answers: match row.get::<Value, _>("answers") {
                    Value::Object(v) => v,
                    _ => return Err(Error::Internal),
                },
                metadata: match row.get::<Value, _>("metadata") {
                    Value::Object(v) => v,
                    _ => return Err(Error::Internal),
                },
                accepted_at: row.get("accepted_at"),
                retrieval_sequence: row.get("retrieval_sequence"),
            });
        }
        schemas.sort_by(|a, b| (&a.survey_id, a.version).cmp(&(&b.survey_id, b.version)));
        let manifest = ExportManifest {
            format_version: 1,
            response_count: responses.len() as u64,
            snapshot_upper_sequence: upper,
            collection_id: collection_id.map(|v| v.to_string()),
            accepted_from,
            accepted_to,
            schemas,
        };
        let format = export_format(job.get("format"))?;
        transaction.commit().await.map_err(database_error)?;
        Ok(ExportSnapshot {
            format,
            responses,
            manifest,
        })
    }

    pub async fn complete_export(
        &self,
        workspace: &str,
        id: &str,
        lease: &str,
        object_key: &str,
        sha: &str,
        manifest: &ExportManifest,
    ) -> Result<(), Error> {
        let id = Uuid::parse_str(id).map_err(|_| Error::NotFound)?;
        let mut tx = self.workspace_transaction(workspace).await?;
        let changed=sqlx::query("update likerts.export_jobs set status='ready',object_key=$3,response_count=$4,content_sha256=$5,manifest=$6,error_code=null,lease_id=null,lease_expires_at=null where workspace_id=$1 and id=$2 and status='running' and expires_at>now() and lease_id=$7 and lease_expires_at>now()")
            .bind(workspace).bind(id).bind(object_key).bind(database_integer(manifest.response_count)?).bind(sha).bind(serde_json::to_value(manifest).map_err(|_|Error::Internal)?).bind(Uuid::parse_str(lease).map_err(|_|Error::Conflict)?)
            .execute(&mut *tx).await.map_err(database_error)?.rows_affected();
        tx.commit().await.map_err(database_error)?;
        if changed == 1 {
            Ok(())
        } else {
            Err(Error::Conflict)
        }
    }
    pub async fn fail_export(
        &self,
        workspace: &str,
        id: &str,
        lease: &str,
        code: &str,
    ) -> Result<(), Error> {
        let id = Uuid::parse_str(id).map_err(|_| Error::NotFound)?;
        let mut tx = self.workspace_transaction(workspace).await?;
        sqlx::query("update likerts.export_jobs set status='failed',error_code=$3,object_key=null,response_count=null,content_sha256=null,manifest=null,lease_id=null,lease_expires_at=null where workspace_id=$1 and id=$2 and status='running' and lease_id=$4 and lease_expires_at>now()").bind(workspace).bind(id).bind(code).bind(Uuid::parse_str(lease).map_err(|_|Error::Conflict)?).execute(&mut *tx).await.map_err(database_error)?;
        tx.commit().await.map_err(database_error)?;
        Ok(())
    }
    pub async fn export_job(&self, workspace: &str, id: &str) -> Result<ExportJob, Error> {
        let id = Uuid::parse_str(id).map_err(|_| Error::NotFound)?;
        let mut tx = self.workspace_transaction(workspace).await?;
        let row=sqlx::query("select id,format,status,created_at,expires_at,response_count,content_sha256,manifest,error_code from likerts.export_jobs where workspace_id=$1 and id=$2").bind(workspace).bind(id).fetch_optional(&mut *tx).await.map_err(database_error)?.ok_or(Error::NotFound)?;
        if row.get::<String, _>("status") == "revoked" {
            return Err(Error::ExportRevoked);
        }
        if row.get::<chrono::DateTime<Utc>, _>("expires_at") <= Utc::now() {
            return Err(Error::ExportExpired);
        }
        let result = export_job(row)?;
        tx.commit().await.map_err(database_error)?;
        Ok(result)
    }
    pub async fn export_object_key(&self, workspace: &str, id: &str) -> Result<String, Error> {
        let id = Uuid::parse_str(id).map_err(|_| Error::NotFound)?;
        let mut tx = self.workspace_transaction(workspace).await?;
        let row=sqlx::query("select status,expires_at,object_key from likerts.export_jobs where workspace_id=$1 and id=$2").bind(workspace).bind(id).fetch_optional(&mut *tx).await.map_err(database_error)?.ok_or(Error::NotFound)?;
        if row.get::<String, _>("status") == "revoked" {
            return Err(Error::ExportRevoked);
        }
        if row.get::<chrono::DateTime<Utc>, _>("expires_at") <= Utc::now() {
            return Err(Error::ExportExpired);
        }
        if row.get::<String, _>("status") != "ready" {
            return Err(Error::NotReady);
        }
        let key = row.get("object_key");
        tx.commit().await.map_err(database_error)?;
        Ok(key)
    }
    pub async fn revoke_export(&self, workspace: &str, id: &str) -> Result<Option<String>, Error> {
        let id = Uuid::parse_str(id).map_err(|_| Error::NotFound)?;
        let mut tx = self.workspace_transaction(workspace).await?;
        let key = sqlx::query_scalar::<_, Option<String>>(
            "select object_key from likerts.export_jobs where workspace_id=$1 and id=$2 for update",
        )
        .bind(workspace)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(database_error)?
        .ok_or(Error::NotFound)?;
        sqlx::query("update likerts.export_jobs set status='revoked',object_key=null,response_count=null,content_sha256=null,manifest=null,error_code=null where workspace_id=$1 and id=$2").bind(workspace).bind(id).execute(&mut *tx).await.map_err(database_error)?;
        // The archive trigger must record this revocation in the same
        // transaction, or roll back the job and cleanup changes when fenced.
        sqlx::query("insert into likerts.deletion_events(workspace_id,id,kind,resource_id) values ($1,$2,'export',$3) on conflict (workspace_id,kind,resource_id) do nothing")
            .bind(workspace)
            .bind(Uuid::new_v4())
            .bind(id.to_string())
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
        tx.commit().await.map_err(database_error)?;
        Ok(key)
    }

    pub async fn workspace_active(&self, workspace: &str) -> Result<(), Error> {
        let mut tx = self.workspace_transaction(workspace).await?;
        let active = sqlx::query_scalar::<_, bool>(
            "select exists(select 1 from likerts.workspaces where id=$1 and deleted_at is null)",
        )
        .bind(workspace)
        .fetch_one(&mut *tx)
        .await
        .map_err(database_error)?;
        tx.commit().await.map_err(database_error)?;
        if active {
            Ok(())
        } else {
            Err(Error::Unauthorized)
        }
    }

    pub async fn erase_response(&self, workspace: &str, id: &str) -> Result<LifecycleBatch, Error> {
        let id = Uuid::parse_str(id).map_err(|_| Error::NotFound)?;
        let mut tx = self.workspace_transaction(workspace).await?;
        let changed = sqlx::query(
            "update likerts.responses set answers=null,metadata=null,raw_deleted_at=now() where workspace_id=$1 and id=$2 and raw_deleted_at is null",
        )
        .bind(workspace).bind(id).execute(&mut *tx).await.map_err(database_error)?.rows_affected();
        if changed == 0 {
            let exists = sqlx::query_scalar::<_, bool>(
                "select exists(select 1 from likerts.responses where workspace_id=$1 and id=$2)",
            )
            .bind(workspace)
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(database_error)?;
            if !exists {
                return Err(Error::NotFound);
            }
        }
        sqlx::query("insert into likerts.deletion_events(workspace_id,id,kind,resource_id) values ($1,$2,'response',$3) on conflict (workspace_id,kind,resource_id) do nothing")
            .bind(workspace).bind(Uuid::new_v4()).bind(id.to_string()).execute(&mut *tx).await.map_err(database_error)?;
        let rows = sqlx::query("select id,object_key from likerts.export_jobs where workspace_id=$1 and status<>'revoked' order by created_at,id for update")
            .bind(workspace).fetch_all(&mut *tx).await.map_err(database_error)?;
        let mut keys = Vec::new();
        for row in &rows {
            let export_id: Uuid = row.get("id");
            if let Some(key) = row.get::<Option<String>, _>("object_key") {
                keys.push(key);
            }
            sqlx::query("update likerts.export_jobs set status='revoked',object_key=null,response_count=null,content_sha256=null,manifest=null,error_code=null where workspace_id=$1 and id=$2")
                .bind(workspace).bind(export_id).execute(&mut *tx).await.map_err(database_error)?;
            sqlx::query("insert into likerts.deletion_events(workspace_id,id,kind,resource_id) values ($1,$2,'export',$3) on conflict (workspace_id,kind,resource_id) do nothing")
                .bind(workspace).bind(Uuid::new_v4()).bind(export_id.to_string()).execute(&mut *tx).await.map_err(database_error)?;
        }
        tx.commit().await.map_err(database_error)?;
        Ok(LifecycleBatch {
            result: RetentionResult {
                responses_erased: changed,
                exports_revoked: rows.len() as u64,
            },
            object_keys: keys,
        })
    }

    pub async fn run_retention(
        &self,
        workspace: &str,
        now: chrono::DateTime<Utc>,
    ) -> Result<LifecycleBatch, Error> {
        let mut tx = self.workspace_transaction(workspace).await?;
        let ids = sqlx::query_scalar::<_, Uuid>(
            "with due as (select id from likerts.responses where workspace_id=$1 and raw_deleted_at is null and accepted_at < $2 - (select retention_days * interval '1 day' from likerts.workspaces where id=$1) order by accepted_at,id limit 1000 for update skip locked) update likerts.responses r set answers=null,metadata=null,raw_deleted_at=$2 from due where r.workspace_id=$1 and r.id=due.id returning r.id",
        ).bind(workspace).bind(now).fetch_all(&mut *tx).await.map_err(database_error)?;
        for id in &ids {
            sqlx::query("insert into likerts.deletion_events(workspace_id,id,kind,resource_id,deleted_at) values ($1,$2,'response',$3,$4) on conflict (workspace_id,kind,resource_id) do nothing")
                .bind(workspace).bind(Uuid::new_v4()).bind(id.to_string()).bind(now).execute(&mut *tx).await.map_err(database_error)?;
        }
        let rows = sqlx::query("select id,object_key from likerts.export_jobs where workspace_id=$1 and status<>'revoked' and (expires_at <= $2 or $3::boolean or exists (select 1 from likerts.deletion_events d where d.workspace_id=$1 and d.kind='response' and d.deleted_at >= export_jobs.created_at)) order by created_at,id limit 1000 for update skip locked")
            .bind(workspace).bind(now).bind(!ids.is_empty()).fetch_all(&mut *tx).await.map_err(database_error)?;
        let mut keys = Vec::new();
        for row in &rows {
            let id: Uuid = row.get("id");
            if let Some(key) = row.get::<Option<String>, _>("object_key") {
                keys.push(key);
            }
            sqlx::query("update likerts.export_jobs set status='revoked',object_key=null,response_count=null,content_sha256=null,manifest=null,error_code=null where workspace_id=$1 and id=$2")
                .bind(workspace).bind(id).execute(&mut *tx).await.map_err(database_error)?;
            sqlx::query("insert into likerts.deletion_events(workspace_id,id,kind,resource_id,deleted_at) values ($1,$2,'export',$3,$4) on conflict (workspace_id,kind,resource_id) do nothing")
                .bind(workspace).bind(Uuid::new_v4()).bind(id.to_string()).bind(now).execute(&mut *tx).await.map_err(database_error)?;
        }
        tx.commit().await.map_err(database_error)?;
        Ok(LifecycleBatch {
            result: RetentionResult {
                responses_erased: ids.len() as u64,
                exports_revoked: rows.len() as u64,
            },
            object_keys: keys,
        })
    }

    pub async fn erase_workspace(&self, workspace: &str) -> Result<LifecycleBatch, Error> {
        let mut tx = self.workspace_transaction(workspace).await?;
        let exists = sqlx::query_scalar::<_, bool>("select exists(select 1 from likerts.workspaces where id=$1 and deleted_at is null for update)")
            .bind(workspace).fetch_one(&mut *tx).await.map_err(database_error)?;
        if !exists {
            return Err(Error::NotFound);
        }
        let response_ids = sqlx::query_scalar::<_, Uuid>(
            "select id from likerts.responses where workspace_id=$1 and raw_deleted_at is null",
        )
        .bind(workspace)
        .fetch_all(&mut *tx)
        .await
        .map_err(database_error)?;
        for id in &response_ids {
            sqlx::query("insert into likerts.deletion_events(workspace_id,id,kind,resource_id) values ($1,$2,'response',$3) on conflict (workspace_id,kind,resource_id) do nothing")
                .bind(workspace).bind(Uuid::new_v4()).bind(id.to_string()).execute(&mut *tx).await.map_err(database_error)?;
        }
        sqlx::query("update likerts.responses set answers=null,metadata=null,raw_deleted_at=coalesce(raw_deleted_at,now()) where workspace_id=$1 and raw_deleted_at is null")
            .bind(workspace).execute(&mut *tx).await.map_err(database_error)?;
        let exports = sqlx::query("select id,object_key from likerts.export_jobs where workspace_id=$1 and status<>'revoked'")
            .bind(workspace).fetch_all(&mut *tx).await.map_err(database_error)?;
        let mut keys = Vec::new();
        for row in &exports {
            let id: Uuid = row.get("id");
            if let Some(key) = row.get::<Option<String>, _>("object_key") {
                keys.push(key);
            }
            sqlx::query("insert into likerts.deletion_events(workspace_id,id,kind,resource_id) values ($1,$2,'export',$3) on conflict (workspace_id,kind,resource_id) do nothing")
                .bind(workspace).bind(Uuid::new_v4()).bind(id.to_string()).execute(&mut *tx).await.map_err(database_error)?;
        }
        sqlx::query("update likerts.export_jobs set status='revoked',object_key=null,response_count=null,content_sha256=null,manifest=null,error_code=null where workspace_id=$1 and status<>'revoked'").bind(workspace).execute(&mut *tx).await.map_err(database_error)?;
        sqlx::query("update likerts.collections set accepting=false,revoked_at=coalesce(revoked_at,now()),token_hash=decode(md5(id::text) || md5(id::text),'hex') where workspace_id=$1").bind(workspace).execute(&mut *tx).await.map_err(database_error)?;
        sqlx::query("update likerts.survey_versions set title='Deleted',questions='[]'::jsonb where workspace_id=$1").bind(workspace).execute(&mut *tx).await.map_err(database_error)?;
        sqlx::query("update likerts.surveys set title='Deleted',questions='[]'::jsonb,updated_at=now() where workspace_id=$1").bind(workspace).execute(&mut *tx).await.map_err(database_error)?;
        sqlx::query("delete from likerts.management_requests where workspace_id=$1")
            .bind(workspace)
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
        sqlx::query("delete from likerts.oauth_grants where workspace_id=$1")
            .bind(workspace)
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
        sqlx::query("delete from likerts.service_credentials where workspace_id=$1")
            .bind(workspace)
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
        sqlx::query("delete from likerts.workspace_memberships where workspace_id=$1")
            .bind(workspace)
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
        sqlx::query("insert into likerts.deletion_events(workspace_id,id,kind,resource_id) values ($1,$2,'workspace',$1) on conflict (workspace_id,kind,resource_id) do nothing").bind(workspace).bind(Uuid::new_v4()).execute(&mut *tx).await.map_err(database_error)?;
        sqlx::query("update likerts.workspaces set deleted_at=now() where id=$1")
            .bind(workspace)
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
        tx.commit().await.map_err(database_error)?;
        Ok(LifecycleBatch {
            result: RetentionResult {
                responses_erased: response_ids.len() as u64,
                exports_revoked: exports.len() as u64,
            },
            object_keys: keys,
        })
    }

    pub async fn usage(&self, workspace: &str) -> Result<u64, Error> {
        let mut transaction = self.workspace_transaction(workspace).await?;
        let total: i64 = sqlx::query_scalar(
            "select coalesce(sum(amount_cents),0)::bigint from likerts.usage_entries where workspace_id=$1",
        )
        .bind(workspace)
        .fetch_one(&mut *transaction)
        .await
        .map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(total as u64)
    }

    pub async fn usage_summary(&self, workspace: &str) -> Result<UsageSummary, Error> {
        let mut tx = self.workspace_transaction(workspace).await?;
        let row = sqlx::query(
            "select (select count(*)::bigint from likerts.usage_entries where workspace_id=$1) as total, (select count(*)::bigint from likerts.usage_entries where workspace_id=$1 and created_at >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC') as month_total from likerts.workspaces where id=$1",
        )
        .bind(workspace)
        .fetch_one(&mut *tx)
        .await
        .map_err(database_error)?;
        tx.commit().await.map_err(database_error)?;
        let total = row.get::<i64, _>("total") as u64;
        let month = row.get::<i64, _>("month_total") as u64;
        Ok(UsageSummary {
            accepted_responses: total,
            month_accepted_responses: month,
        })
    }

    pub async fn health(&self) -> Result<(), Error> {
        sqlx::query("select 1")
            .execute(&self.pool)
            .await
            .map(|_| ())
            .map_err(database_error)
    }
}
