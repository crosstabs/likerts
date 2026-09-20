use axum::{
    extract::{DefaultBodyLimit, FromRequest, Path, Query, Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    middleware,
    response::{IntoResponse, Response as AxumResponse},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use likerts_server::{
    admission::{self, Admission},
    analysis::{analyze_responses, MAX_ANALYSIS_RESPONSES},
    auth::{OidcClaims, OidcVerifier},
    browser_auth::{
        validate_approved_scopes, BrowserClaims, BrowserOAuthClients, BrowserSessionVerifier,
    },
    exports::{
        default_root, render, sha256_hex, ExportDownload, LocalObjectStore, ObjectStore,
        S3ObjectStore, VercelBlobObjectStore,
    },
    management_cors::{self, ManagementCors},
    metrics::{self, Metrics},
    postgres::PgStore,
    survey_schema_version,
    webhook_store::WebhookStore,
    webhooks::{EndpointInput, EndpointUpdate, WebhookKeys, WebhookOperationInput},
    Collection, CollectionLimits, CollectionSecurity, CollectionSecurityInput, DraftInput, Error,
    ExportFormat, ExportInput, ExportJob, ExportManifest, ExportSnapshot, LifecycleBatch,
    OAuthGrant, Receipt, ResponseAnalysis, ResponseAnalysisInput, ResponseListInput, ResponsePage,
    RetentionResult, Role, SdkCapabilities, ServiceCredential, Store, Submission, Survey,
    SurveyPage, UsageSummary, Version, WorkspaceMembership,
};
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

struct ApiJson<T>(T);

impl<S, T> FromRequest<S> for ApiJson<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = AxumResponse;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        match Json::<T>::from_request(request, state).await {
            Ok(Json(value)) => Ok(Self(value)),
            Err(error) => {
                let status = match error.status() {
                    StatusCode::UNPROCESSABLE_ENTITY => StatusCode::BAD_REQUEST,
                    other => other,
                };
                let code = match status {
                    StatusCode::PAYLOAD_TOO_LARGE => "payload_too_large",
                    StatusCode::UNSUPPORTED_MEDIA_TYPE => "unsupported_media_type",
                    _ => "invalid_request",
                };
                Err((
                    status,
                    Json(json!({"error":{"code":code,"message":error.body_text()}})),
                )
                    .into_response())
            }
        }
    }
}

#[derive(Clone)]
enum Storage {
    Memory(Arc<Mutex<Store>>),
    Postgres(PgStore),
}

impl Storage {
    fn memory_store(&self) -> Result<std::sync::MutexGuard<'_, Store>, Error> {
        match self {
            Self::Memory(store) => store.lock().map_err(|_| Error::Internal),
            Self::Postgres(_) => Err(Error::Internal),
        }
    }

    async fn create_survey(
        &self,
        workspace: &str,
        idempotency_key: &str,
        input: DraftInput,
    ) -> Result<Survey, Error> {
        match self {
            Self::Memory(_) => {
                self.memory_store()?
                    .create_survey_idempotent(workspace, idempotency_key, input)
            }
            Self::Postgres(store) => {
                store
                    .create_survey_idempotent(workspace, idempotency_key, input)
                    .await
            }
        }
    }

    async fn surveys(&self, workspace: &str) -> Result<Vec<Survey>, Error> {
        match self {
            Self::Memory(_) => Ok(self.memory_store()?.surveys(workspace)),
            Self::Postgres(store) => store.surveys(workspace).await,
        }
    }

    async fn update(
        &self,
        workspace: &str,
        id: &str,
        revision: u64,
        input: DraftInput,
    ) -> Result<Survey, Error> {
        match self {
            Self::Memory(_) => self.memory_store()?.update(workspace, id, revision, input),
            Self::Postgres(store) => store.update(workspace, id, revision, input).await,
        }
    }

    async fn publish(
        &self,
        workspace: &str,
        id: &str,
        revision: u64,
        sdk_capabilities: SdkCapabilities,
    ) -> Result<Version, Error> {
        match self {
            Self::Memory(_) => {
                self.memory_store()?
                    .publish_compatible(workspace, id, revision, sdk_capabilities)
            }
            Self::Postgres(store) => {
                store
                    .publish_compatible(workspace, id, revision, sdk_capabilities)
                    .await
            }
        }
    }

    async fn create_collection(
        &self,
        workspace: &str,
        idempotency_key: &str,
        survey_id: &str,
        version: u64,
        placement: &str,
        limits: CollectionLimits,
        sdk_capabilities: SdkCapabilities,
    ) -> Result<Collection, Error> {
        match self {
            Self::Memory(_) => self
                .memory_store()?
                .create_collection_idempotent_compatible(
                    workspace,
                    idempotency_key,
                    survey_id,
                    version,
                    placement,
                    limits,
                    sdk_capabilities,
                ),
            Self::Postgres(store) => {
                store
                    .create_collection_idempotent_compatible(
                        workspace,
                        idempotency_key,
                        survey_id,
                        version,
                        placement,
                        limits,
                        sdk_capabilities,
                    )
                    .await
            }
        }
    }

    async fn collection_schema(
        &self,
        id: &str,
        token: &str,
    ) -> Result<(Collection, Version), Error> {
        match self {
            Self::Memory(_) => {
                let store = self.memory_store()?;
                Ok((store.collection(id, token)?, store.schema(id, token)?))
            }
            Self::Postgres(store) => store.collection_schema(id, token).await,
        }
    }

    async fn set_accepting(&self, workspace: &str, id: &str, accepting: bool) -> Result<(), Error> {
        match self {
            Self::Memory(_) => self.memory_store()?.set_accepting(workspace, id, accepting),
            Self::Postgres(store) => store.set_accepting(workspace, id, accepting).await,
        }
    }

    async fn revoke_collection(&self, workspace: &str, id: &str) -> Result<(), Error> {
        match self {
            Self::Memory(_) => self.memory_store()?.revoke_collection(workspace, id),
            Self::Postgres(store) => store.revoke_collection(workspace, id).await,
        }
    }

    async fn set_collection_security(
        &self,
        workspace: &str,
        id: &str,
        input: CollectionSecurityInput,
    ) -> Result<CollectionSecurity, Error> {
        match self {
            Self::Memory(_) => self
                .memory_store()?
                .set_collection_security(workspace, id, input),
            Self::Postgres(store) => store.set_collection_security(workspace, id, input).await,
        }
    }

    async fn collection_origin_allowed(&self, id: &str, origin: &str) -> Result<bool, Error> {
        match self {
            Self::Memory(_) => Ok(self.memory_store()?.collection_origin_allowed(id, origin)),
            Self::Postgres(store) => store.collection_origin_allowed(id, origin).await,
        }
    }

    async fn consume_collection_rate(&self, id: &str, token: &str) -> Result<(), Error> {
        match self {
            Self::Memory(_) => self.memory_store()?.consume_collection_rate(id, token),
            Self::Postgres(store) => store.consume_collection_rate(id, token).await,
        }
    }
    async fn lookup_receipt(
        &self,
        id: &str,
        token: &str,
        input: &Submission,
    ) -> Result<Option<Receipt>, Error> {
        match self {
            Self::Memory(store) => store
                .lock()
                .map_err(|_| Error::Internal)?
                .lookup_receipt(id, token, input),
            Self::Postgres(store) => store.lookup_receipt(id, token, input).await,
        }
    }

    async fn submit(&self, id: &str, token: &str, input: Submission) -> Result<Receipt, Error> {
        match self {
            Self::Memory(_) => self.memory_store()?.submit(id, token, input),
            Self::Postgres(store) => store.submit(id, token, input).await,
        }
    }

    async fn responses(
        &self,
        workspace: &str,
        input: ResponseListInput,
    ) -> Result<ResponsePage, Error> {
        match self {
            Self::Memory(_) => self.memory_store()?.responses(workspace, input),
            Self::Postgres(store) => store.responses(workspace, input).await,
        }
    }

    async fn response_analysis(
        &self,
        workspace: &str,
        input: ResponseAnalysisInput,
    ) -> Result<ResponseAnalysis, Error> {
        let minimum_group_size = input.minimum_group_size()?;
        let schemas = match self {
            Self::Memory(_) => self
                .memory_store()?
                .response_schemas(workspace, input.collection_id.as_deref())?,
            Self::Postgres(store) => {
                store
                    .response_schemas(workspace, input.collection_id.as_deref())
                    .await?
            }
        };
        let mut cursor = None;
        let mut responses = Vec::new();
        loop {
            let page = self
                .responses(
                    workspace,
                    ResponseListInput {
                        limit: Some(1_000),
                        cursor,
                        collection_id: input.collection_id.clone(),
                        accepted_from: input.accepted_from,
                        accepted_to: input.accepted_to,
                    },
                )
                .await?;
            responses.extend(page.items);
            if responses.len() > MAX_ANALYSIS_RESPONSES {
                return Err(Error::Invalid(
                    "analysis is limited to 50000 responses; narrow acceptedFrom and acceptedTo"
                        .into(),
                ));
            }
            let Some(next_cursor) = page.next_cursor else {
                break;
            };
            cursor = Some(next_cursor);
        }
        Ok(analyze_responses(
            schemas,
            responses,
            minimum_group_size,
            chrono::Utc::now(),
        ))
    }

    async fn usage_summary(&self, workspace: &str) -> Result<UsageSummary, Error> {
        match self {
            Self::Memory(_) => Ok(self.memory_store()?.usage_summary(workspace)),
            Self::Postgres(store) => store.usage_summary(workspace).await,
        }
    }
    async fn health(&self) -> Result<&'static str, Error> {
        match self {
            Self::Memory(_) => Ok("development-memory"),
            Self::Postgres(store) => {
                store.health().await?;
                Ok("postgresql")
            }
        }
    }
    async fn callback_worker_status(&self) -> Result<&'static str, Error> {
        match self {
            Self::Memory(_) => Ok("unavailable"),
            Self::Postgres(store) => store.callback_worker_status().await,
        }
    }

    async fn authenticate_service(&self, token: &str, scope: &str) -> Result<String, Error> {
        match self {
            Self::Postgres(store) => store.authenticate_service(token, scope).await,
            Self::Memory(_) => Err(Error::Unauthorized),
        }
    }

    async fn authorize_oauth(
        &self,
        claims: &OidcClaims,
        workspace: &str,
        audience: &str,
        required_scope: &str,
        required_role: Role,
    ) -> Result<String, Error> {
        match self {
            Self::Postgres(store) => {
                let scopes: HashSet<String> =
                    claims.scopes().into_iter().map(str::to_owned).collect();
                store
                    .authorize_oauth_workspace(
                        workspace,
                        &claims.sub,
                        claims.oauth_client_id()?,
                        audience,
                        &scopes,
                        required_scope,
                        required_role,
                    )
                    .await
            }
            Self::Memory(_) => Err(Error::Unauthorized),
        }
    }

    async fn create_export(&self, workspace: &str, input: ExportInput) -> Result<ExportJob, Error> {
        match self {
            Self::Memory(_) => self.memory_store()?.create_export(workspace, input),
            Self::Postgres(store) => store.create_export(workspace, input).await,
        }
    }
    async fn claim_export(&self, workspace: &str, id: &str) -> Result<Option<String>, Error> {
        match self {
            Self::Memory(_) => self.memory_store()?.claim_export(workspace, id),
            Self::Postgres(store) => store.claim_export(workspace, id).await,
        }
    }
    async fn export_snapshot(
        &self,
        workspace: &str,
        id: &str,
        lease: &str,
    ) -> Result<ExportSnapshot, Error> {
        match self {
            Self::Memory(_) => self.memory_store()?.export_snapshot(workspace, id, lease),
            Self::Postgres(store) => store.export_snapshot(workspace, id, lease).await,
        }
    }
    async fn complete_export(
        &self,
        workspace: &str,
        id: &str,
        lease: &str,
        key: String,
        sha: String,
        manifest: ExportManifest,
    ) -> Result<(), Error> {
        match self {
            Self::Memory(_) => self
                .memory_store()?
                .complete_export(workspace, id, lease, key, sha, manifest),
            Self::Postgres(store) => {
                store
                    .complete_export(workspace, id, lease, &key, &sha, &manifest)
                    .await
            }
        }
    }
    async fn fail_export(
        &self,
        workspace: &str,
        id: &str,
        lease: &str,
        code: &str,
    ) -> Result<(), Error> {
        match self {
            Self::Memory(_) => self.memory_store()?.fail_export(workspace, id, lease, code),
            Self::Postgres(store) => store.fail_export(workspace, id, lease, code).await,
        }
    }
    async fn export_job(&self, workspace: &str, id: &str) -> Result<ExportJob, Error> {
        match self {
            Self::Memory(_) => self.memory_store()?.export_job(workspace, id),
            Self::Postgres(store) => store.export_job(workspace, id).await,
        }
    }
    async fn export_object_key(&self, workspace: &str, id: &str) -> Result<String, Error> {
        match self {
            Self::Memory(_) => self.memory_store()?.export_object_key(workspace, id),
            Self::Postgres(store) => store.export_object_key(workspace, id).await,
        }
    }
    async fn revoke_export(&self, workspace: &str, id: &str) -> Result<Option<String>, Error> {
        match self {
            Self::Memory(_) => self.memory_store()?.revoke_export(workspace, id),
            Self::Postgres(store) => store.revoke_export(workspace, id).await,
        }
    }
    async fn workspace_active(&self, workspace: &str) -> Result<(), Error> {
        match self {
            Self::Memory(_) => self.memory_store()?.workspace_active(workspace),
            Self::Postgres(store) => store.workspace_active(workspace).await,
        }
    }
    async fn erase_response(&self, workspace: &str, id: &str) -> Result<LifecycleBatch, Error> {
        match self {
            Self::Memory(_) => self.memory_store()?.erase_response(workspace, id),
            Self::Postgres(store) => store.erase_response(workspace, id).await,
        }
    }
    async fn run_retention(&self, workspace: &str) -> Result<LifecycleBatch, Error> {
        match self {
            Self::Memory(_) => self
                .memory_store()?
                .run_retention(workspace, chrono::Utc::now()),
            Self::Postgres(store) => store.run_retention(workspace, chrono::Utc::now()).await,
        }
    }
    async fn erase_workspace(&self, workspace: &str) -> Result<LifecycleBatch, Error> {
        match self {
            Self::Memory(_) => self.memory_store()?.erase_workspace(workspace),
            Self::Postgres(store) => store.erase_workspace(workspace).await,
        }
    }
    async fn memberships(&self, workspace: &str) -> Result<Vec<WorkspaceMembership>, Error> {
        match self {
            Self::Postgres(store) => store.memberships(workspace).await,
            Self::Memory(_) => Err(Error::Internal),
        }
    }
    async fn grant_membership(
        &self,
        workspace: &str,
        subject: &str,
        role: Role,
    ) -> Result<(), Error> {
        match self {
            Self::Postgres(store) => store.grant_membership(workspace, subject, role).await,
            Self::Memory(_) => Err(Error::Internal),
        }
    }
    async fn revoke_membership(&self, workspace: &str, subject: &str) -> Result<(), Error> {
        match self {
            Self::Postgres(store) => store.revoke_membership(workspace, subject).await,
            Self::Memory(_) => Err(Error::Internal),
        }
    }
    async fn service_credentials(&self, workspace: &str) -> Result<Vec<ServiceCredential>, Error> {
        match self {
            Self::Postgres(store) => store.service_credentials(workspace).await,
            Self::Memory(_) => Err(Error::Internal),
        }
    }
    async fn issue_service_credential(
        &self,
        workspace: &str,
        name: &str,
        scopes: Vec<String>,
        expires_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<(ServiceCredential, String), Error> {
        match self {
            Self::Postgres(store) => {
                store
                    .issue_service_credential(workspace, name, scopes, expires_at)
                    .await
            }
            Self::Memory(_) => Err(Error::Internal),
        }
    }
    async fn revoke_service_credential(&self, workspace: &str, id: &str) -> Result<(), Error> {
        match self {
            Self::Postgres(store) => store.revoke_service_credential(workspace, id).await,
            Self::Memory(_) => Err(Error::Internal),
        }
    }
    async fn issue_oauth_grant(
        &self,
        workspace: &str,
        subject: &str,
        client_id: &str,
        audience: &str,
        scopes: Vec<String>,
        expires_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<OAuthGrant, Error> {
        match self {
            Self::Postgres(store) => {
                store
                    .issue_oauth_grant(workspace, subject, client_id, audience, scopes, expires_at)
                    .await
            }
            Self::Memory(_) => Err(Error::Internal),
        }
    }
    async fn revoke_oauth_grant(&self, workspace: &str, id: &str) -> Result<(), Error> {
        match self {
            Self::Postgres(store) => store.revoke_oauth_grant(workspace, id).await,
            Self::Memory(_) => Err(Error::Internal),
        }
    }
    async fn bootstrap_personal_workspace(
        &self,
        workspace: &str,
        subject: &str,
    ) -> Result<bool, Error> {
        match self {
            Self::Postgres(store) => store.bootstrap_personal_workspace(workspace, subject).await,
            Self::Memory(_) => Err(Error::Invalid("durable storage required".into())),
        }
    }
    async fn current_membership(&self, workspace: &str, subject: &str) -> Result<Role, Error> {
        match self {
            Self::Postgres(store) => store.current_membership(workspace, subject).await,
            Self::Memory(_) => Err(Error::Unauthorized),
        }
    }
}

#[derive(Clone)]
struct App {
    storage: Storage,
    tokens: Arc<HashMap<String, String>>,
    objects: Arc<dyn ObjectStore>,
    oidc: Option<OidcVerifier>,
    browser_sessions: Option<BrowserSessionVerifier>,
    browser_oauth_clients: BrowserOAuthClients,
    metrics: Metrics,
    webhooks: Option<WebhookStore>,
}

async fn browser_claims(app: &App, headers: &HeaderMap) -> Result<BrowserClaims, ApiError> {
    let origin = headers
        .get("origin")
        .and_then(|value| value.to_str().ok())
        .ok_or(ApiError(Error::Unauthorized))?;
    let verifier = app
        .browser_sessions
        .as_ref()
        .ok_or(ApiError(Error::Unauthorized))?;
    Ok(verifier.verify(bearer(headers)?, origin).await?)
}

async fn browser_owner_workspace(
    app: &App,
    headers: &HeaderMap,
) -> Result<(BrowserClaims, String), ApiError> {
    let claims = browser_claims(app, headers).await?;
    let workspace = headers
        .get("x-likerts-workspace")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty() && value.chars().count() <= 200)
        .ok_or(ApiError(Error::Invalid(
            "X-Likerts-Workspace is required".into(),
        )))?;
    if app
        .storage
        .current_membership(workspace, &claims.sub)
        .await?
        != Role::Owner
    {
        return Err(ApiError(Error::Forbidden));
    }
    Ok((claims, workspace.into()))
}

async fn browser_bootstrap(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let claims = browser_claims(&app, &headers).await?;
    let verifier = app
        .browser_sessions
        .as_ref()
        .ok_or(ApiError(Error::Unauthorized))?;
    let workspace = verifier.workspace_id(&claims.sub)?;
    let created = app
        .storage
        .bootstrap_personal_workspace(&workspace, &claims.sub)
        .await?;
    let usage = app.storage.usage_summary(&workspace).await?;
    Ok((
        if created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        Json(json!({
            "workspaceId": workspace,
            "created": created,
            "usage": usage
        })),
    ))
}

async fn browser_results(
    State(app): State<App>,
    headers: HeaderMap,
    input: Result<Query<ResponseAnalysisInput>, axum::extract::rejection::QueryRejection>,
) -> Result<impl IntoResponse, ApiError> {
    let (_, workspace) = browser_owner_workspace(&app, &headers).await?;
    let Query(input) = input.map_err(|error| ApiError(Error::Invalid(error.body_text())))?;
    Ok(Json(
        app.storage.response_analysis(&workspace, input).await?,
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct BrowserOAuthApprovalInput {
    client_id: String,
    scopes: Vec<String>,
}

async fn browser_approve_oauth(
    State(app): State<App>,
    headers: HeaderMap,
    ApiJson(input): ApiJson<BrowserOAuthApprovalInput>,
) -> Result<impl IntoResponse, ApiError> {
    let (claims, workspace) = browser_owner_workspace(&app, &headers).await?;
    if !app.browser_oauth_clients.allows(&input.client_id) {
        return Err(ApiError(Error::Forbidden));
    }
    validate_approved_scopes(&input.scopes)?;
    let audience = app
        .oidc
        .as_ref()
        .ok_or(ApiError(Error::Invalid("OAuth is not configured".into())))?
        .audience();
    let grant = app
        .storage
        .issue_oauth_grant(
            &workspace,
            &claims.sub,
            &input.client_id,
            audience,
            input.scopes,
            chrono::Utc::now() + chrono::Duration::days(30),
        )
        .await?;
    Ok((StatusCode::CREATED, Json(grant)))
}

async fn browser_list_service_credentials(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let (_, workspace) = browser_owner_workspace(&app, &headers).await?;
    Ok(Json(app.storage.service_credentials(&workspace).await?))
}

async fn browser_create_service_credential(
    State(app): State<App>,
    headers: HeaderMap,
    ApiJson(input): ApiJson<CredentialInput>,
) -> Result<impl IntoResponse, ApiError> {
    let (_, workspace) = browser_owner_workspace(&app, &headers).await?;
    let (credential, token) = app
        .storage
        .issue_service_credential(&workspace, &input.name, input.scopes, input.expires_at)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"credential":credential,"token":token})),
    ))
}

async fn browser_remove_service_credential(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let (_, workspace) = browser_owner_workspace(&app, &headers).await?;
    app.storage
        .revoke_service_credential(&workspace, &id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

struct ApiError(Error);

impl From<Error> for ApiError {
    fn from(error: Error) -> Self {
        Self(error)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> AxumResponse {
        let (status, code, message) = match self.0 {
            Error::Invalid(message) => (StatusCode::BAD_REQUEST, "invalid_request", message),
            Error::NotFound => (
                StatusCode::NOT_FOUND,
                "not_found",
                "Resource not found".into(),
            ),
            Error::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Invalid credentials".into(),
            ),
            Error::Forbidden => (
                StatusCode::FORBIDDEN,
                "forbidden",
                "Credential lacks required access".into(),
            ),
            Error::Conflict => (
                StatusCode::CONFLICT,
                "conflict",
                "Revision or idempotency conflict".into(),
            ),
            Error::Closed => (
                StatusCode::CONFLICT,
                "collection_closed",
                "Collection is closed".into(),
            ),
            Error::Expired => (
                StatusCode::GONE,
                "collection_expired",
                "Collection has expired".into(),
            ),
            Error::Capacity => (
                StatusCode::CONFLICT,
                "collection_capacity",
                "Collection capacity reached".into(),
            ),
            Error::Revoked => (
                StatusCode::GONE,
                "collection_revoked",
                "Collection credential has been revoked".into(),
            ),
            Error::ExportExpired => (
                StatusCode::GONE,
                "export_expired",
                "Export download has expired".into(),
            ),
            Error::ExportRevoked => (
                StatusCode::GONE,
                "export_revoked",
                "Export access has been revoked".into(),
            ),
            Error::NotReady => (
                StatusCode::CONFLICT,
                "export_not_ready",
                "Export is not ready".into(),
            ),
            Error::ReceiptExpired => (
                StatusCode::GONE,
                "receipt_expired",
                "The retained retry receipt has expired".into(),
            ),
            Error::RateLimited => (
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
                "Collection request rate exceeded".into(),
            ),
            Error::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "Internal service error".into(),
            ),
            Error::ErasureFenced => (
                StatusCode::SERVICE_UNAVAILABLE,
                "erasure_source_fenced",
                "Deletions are paused for recovery maintenance; no new erasure was committed"
                    .into(),
            ),
        };
        let mut response = (
            status,
            Json(json!({"error":{"code":code,"message":message}})),
        )
            .into_response();
        if status == StatusCode::TOO_MANY_REQUESTS {
            response
                .headers_mut()
                .insert("retry-after", axum::http::HeaderValue::from_static("60"));
        }
        response
    }
}

fn bearer(headers: &HeaderMap) -> Result<&str, ApiError> {
    headers
        .get("authorization")
        .and_then(|header| header.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.is_empty())
        .ok_or(ApiError(Error::Unauthorized))
}

fn require_selected_workspace(headers: &HeaderMap, authorized: &str) -> Result<(), ApiError> {
    let Some(value) = headers.get("x-likerts-workspace") else {
        return Ok(());
    };
    let selected = value
        .to_str()
        .ok()
        .filter(|value| !value.trim().is_empty() && value.chars().count() <= 128)
        .ok_or(ApiError(Error::Invalid(
            "X-Likerts-Workspace is malformed".into(),
        )))?;
    if selected != authorized {
        return Err(ApiError(Error::Forbidden));
    }
    Ok(())
}

async fn workspace(app: &App, headers: &HeaderMap, scope: &str) -> Result<String, ApiError> {
    let token = bearer(headers)?;
    if let Some(workspace) = app.tokens.get(token) {
        require_selected_workspace(headers, workspace)?;
        app.storage.workspace_active(workspace).await?;
        return Ok(workspace.clone());
    }
    let resolved = match app.storage.authenticate_service(token, scope).await {
        Ok(workspace) => {
            require_selected_workspace(headers, &workspace)?;
            workspace
        }
        Err(Error::Forbidden) => return Err(ApiError(Error::Forbidden)),
        Err(Error::Unauthorized) => {
            let verifier = app.oidc.as_ref().ok_or(ApiError(Error::Unauthorized))?;
            let claims = verifier.verify(token).await?;
            let selected_workspace = headers
                .get("x-likerts-workspace")
                .and_then(|value| value.to_str().ok())
                .filter(|value| !value.trim().is_empty() && value.chars().count() <= 128)
                .ok_or(ApiError(Error::Invalid(
                    "X-Likerts-Workspace is required for human OAuth access".into(),
                )))?;
            let required_role = if matches!(scope, "identity:write" | "webhooks:write") {
                Role::Owner
            } else if scope.ends_with(":write") {
                Role::Editor
            } else {
                Role::Reader
            };
            app.storage
                .authorize_oauth(
                    &claims,
                    selected_workspace,
                    verifier.audience(),
                    scope,
                    required_role,
                )
                .await?
        }
        Err(error) => return Err(ApiError(error)),
    };
    app.storage.workspace_active(&resolved).await?;
    Ok(resolved)
}

async fn oauth_protected_resource(State(app): State<App>) -> Result<impl IntoResponse, ApiError> {
    let verifier = app.oidc.as_ref().ok_or(ApiError(Error::NotFound))?;
    let mut response = Json(json!({
        "resource": verifier.audience(),
        "authorization_servers": [verifier.issuer()],
        "bearer_methods_supported": ["header"],
        "scopes_supported": [
            "surveys:read", "surveys:write", "collections:write", "responses:read", "responses:write",
            "usage:read", "exports:read", "exports:write", "identity:write", "webhooks:read", "webhooks:write"
        ]
    }))
    .into_response();
    response
        .headers_mut()
        .insert("access-control-allow-origin", HeaderValue::from_static("*"));
    response.headers_mut().insert(
        "cache-control",
        HeaderValue::from_static("public, max-age=300"),
    );
    Ok(response)
}

async fn oauth_protected_resource_preflight() -> AxumResponse {
    let mut response = StatusCode::NO_CONTENT.into_response();
    response
        .headers_mut()
        .insert("access-control-allow-origin", HeaderValue::from_static("*"));
    response.headers_mut().insert(
        "access-control-allow-methods",
        HeaderValue::from_static("GET, OPTIONS"),
    );
    response.headers_mut().insert(
        "access-control-allow-headers",
        HeaderValue::from_static("Authorization, Content-Type"),
    );
    response
        .headers_mut()
        .insert("access-control-max-age", HeaderValue::from_static("600"));
    response
}

fn uses_collection_credential(path: &str, method: &Method) -> bool {
    let parts: Vec<_> = path.trim_matches('/').split('/').collect();
    (matches!(parts.as_slice(), ["v1", "collections", _])
        && (*method == Method::GET || *method == Method::PATCH))
        || (matches!(parts.as_slice(), ["v1", "collections", _, "responses"])
            && *method == Method::POST)
}

async fn oauth_authentication_challenge(
    State(resource_metadata): State<Option<String>>,
    request: Request,
    next: middleware::Next,
) -> AxumResponse {
    let challenge_eligible = request.uri().path().starts_with("/v1/")
        && !request.uri().path().starts_with("/v1/browser/")
        && !uses_collection_credential(request.uri().path(), request.method());
    let mut response = next.run(request).await;
    if challenge_eligible && response.status() == StatusCode::UNAUTHORIZED {
        if let Some(resource_metadata) = resource_metadata {
            if let Ok(value) =
                HeaderValue::from_str(&format!("Bearer resource_metadata=\"{resource_metadata}\""))
            {
                response.headers_mut().insert("www-authenticate", value);
            }
        }
    }
    response
}

async fn health(State(app): State<App>) -> Result<impl IntoResponse, ApiError> {
    let storage = app.storage.health().await?;
    Ok(Json(json!({"status":"ok","storage":storage})))
}

async fn scrape_metrics(State(app): State<App>, headers: HeaderMap) -> AxumResponse {
    metrics::scrape(State(app.metrics), headers).await
}

async fn callback_worker_status(State(app): State<App>, headers: HeaderMap) -> AxumResponse {
    const UNAVAILABLE: &str = "unavailable";
    let (code, status) = if !app.metrics.authorized(&headers) {
        (StatusCode::UNAUTHORIZED, UNAVAILABLE)
    } else {
        match app.storage.callback_worker_status().await {
            Ok(status) => (StatusCode::OK, status),
            Err(_) => (StatusCode::SERVICE_UNAVAILABLE, UNAVAILABLE),
        }
    };
    let mut response = (code, Json(json!({"status":status}))).into_response();
    response
        .headers_mut()
        .insert("cache-control", HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        "x-robots-tag",
        HeaderValue::from_static("noindex, nofollow"),
    );
    response
}

async fn create(
    State(app): State<App>,
    headers: HeaderMap,
    ApiJson(input): ApiJson<CreateSurveyInput>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "surveys:write").await?;
    Ok((
        StatusCode::CREATED,
        Json(
            app.storage
                .create_survey(
                    &workspace,
                    &input.idempotency_key,
                    DraftInput {
                        title: input.title,
                        questions: input.questions,
                        pages: input.pages,
                    },
                )
                .await?,
        ),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CreateSurveyInput {
    idempotency_key: String,
    title: String,
    questions: Vec<likerts_server::Question>,
    pages: Option<Vec<SurveyPage>>,
}

async fn surveys(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "surveys:read").await?;
    Ok(Json(app.storage.surveys(&workspace).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Update {
    revision: u64,
    title: String,
    questions: Vec<likerts_server::Question>,
    pages: Option<Vec<SurveyPage>>,
}

async fn update(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    ApiJson(input): ApiJson<Update>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "surveys:write").await?;
    Ok(Json(
        app.storage
            .update(
                &workspace,
                &id,
                input.revision,
                DraftInput {
                    title: input.title,
                    questions: input.questions,
                    pages: input.pages,
                },
            )
            .await?,
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Publish {
    revision: u64,
    #[serde(rename = "sdkCapabilities")]
    sdk_capabilities: SdkCapabilities,
}

async fn publish(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    ApiJson(input): ApiJson<Publish>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "surveys:write").await?;
    Ok(Json(
        app.storage
            .publish(&workspace, &id, input.revision, input.sdk_capabilities)
            .await?,
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CollectionInput {
    idempotency_key: String,
    survey_id: String,
    version: u64,
    placement: String,
    #[serde(default)]
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    response_cap: Option<u64>,
    sdk_capabilities: SdkCapabilities,
}

async fn create_collection(
    State(app): State<App>,
    headers: HeaderMap,
    ApiJson(input): ApiJson<CollectionInput>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "collections:write").await?;
    let result = app
        .storage
        .create_collection(
            &workspace,
            &input.idempotency_key,
            &input.survey_id,
            input.version,
            &input.placement,
            CollectionLimits {
                expires_at: input.expires_at,
                response_cap: input.response_cap,
            },
            input.sdk_capabilities,
        )
        .await?;
    Ok((StatusCode::CREATED, Json(result)))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Acceptance {
    #[serde(default)]
    accepting: Option<bool>,
    #[serde(default)]
    revoke: Option<bool>,
}

async fn acceptance(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    ApiJson(input): ApiJson<Acceptance>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "collections:write").await?;
    match (input.accepting, input.revoke) {
        (Some(accepting), None) => {
            app.storage
                .set_accepting(&workspace, &id, accepting)
                .await?;
            Ok(Json(json!({"id":id,"accepting":accepting,"revoked":false})))
        }
        (None, Some(true)) => {
            app.storage.revoke_collection(&workspace, &id).await?;
            Ok(Json(json!({"id":id,"accepting":false,"revoked":true})))
        }
        _ => Err(ApiError(Error::Invalid(
            "provide exactly one of accepting or revoke:true".into(),
        ))),
    }
}

async fn configure_collection_security(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    ApiJson(input): ApiJson<CollectionSecurityInput>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "collections:write").await?;
    Ok(Json(
        app.storage
            .set_collection_security(&workspace, &id, input)
            .await?,
    ))
}

async fn request_origin(
    app: &App,
    headers: &HeaderMap,
    id: &str,
) -> Result<Option<String>, ApiError> {
    let Some(origin) = headers.get("origin") else {
        return Ok(None);
    };
    let origin = origin.to_str().map_err(|_| ApiError(Error::Forbidden))?;
    if !app.storage.collection_origin_allowed(id, origin).await? {
        return Err(ApiError(Error::Forbidden));
    }
    Ok(Some(origin.into()))
}

fn with_cors(mut response: AxumResponse, origin: Option<String>) -> AxumResponse {
    if let Some(origin) = origin {
        if let Ok(value) = axum::http::HeaderValue::from_str(&origin) {
            response
                .headers_mut()
                .insert("access-control-allow-origin", value);
            response
                .headers_mut()
                .insert("vary", axum::http::HeaderValue::from_static("Origin"));
        }
    }
    response
}

async fn collection_preflight(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<AxumResponse, ApiError> {
    let origin = request_origin(&app, &headers, &id)
        .await?
        .ok_or(ApiError(Error::Forbidden))?;
    let requested = headers
        .get("access-control-request-method")
        .and_then(|value| value.to_str().ok())
        .ok_or(ApiError(Error::Forbidden))?;
    if !matches!(requested, "GET" | "POST") {
        return Err(ApiError(Error::Forbidden));
    }
    let mut response = with_cors(StatusCode::NO_CONTENT.into_response(), Some(origin));
    response.headers_mut().insert(
        "access-control-allow-methods",
        axum::http::HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    response.headers_mut().insert(
        "access-control-allow-headers",
        axum::http::HeaderValue::from_static("Authorization, Content-Type"),
    );
    response.headers_mut().insert(
        "access-control-max-age",
        axum::http::HeaderValue::from_static("600"),
    );
    Ok(response)
}

async fn schema(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<AxumResponse, ApiError> {
    let token = bearer(&headers)?;
    let (collection, version) = app.storage.collection_schema(&id, token).await?;
    let origin = request_origin(&app, &headers, &id).await?;
    let mut survey_schema = json!({
        "schemaVersion": survey_schema_version(&version.questions, version.pages.as_deref()),
        "title": version.title,
        "questions": version.questions
    });
    if let Some(pages) = version.pages {
        survey_schema["pages"] =
            serde_json::to_value(pages).map_err(|_| ApiError(Error::Internal))?;
    }
    Ok(with_cors(
        Json(json!({
            "id": collection.id,
            "surveyId": collection.survey_id,
            "version": collection.version,
            "placement": collection.placement,
            "schema": survey_schema
        }))
        .into_response(),
        origin,
    ))
}

async fn submit(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    ApiJson(input): ApiJson<Submission>,
) -> Result<AxumResponse, ApiError> {
    let token = bearer(&headers)?;
    let origin = request_origin(&app, &headers, &id).await?;
    match app.storage.lookup_receipt(&id, token, &input).await {
        Ok(Some(receipt)) => {
            return Ok(with_cors(Json(receipt).into_response(), origin));
        }
        Ok(None) => {}
        Err(error) => {
            return Ok(with_cors(ApiError(error).into_response(), origin));
        }
    }
    let response = match app.storage.consume_collection_rate(&id, token).await {
        Ok(()) => match app.storage.submit(&id, token, input).await {
            Ok(receipt) => Json(receipt).into_response(),
            Err(error) => ApiError(error).into_response(),
        },
        Err(error) => ApiError(error).into_response(),
    };
    Ok(with_cors(response, origin))
}

async fn responses(
    State(app): State<App>,
    headers: HeaderMap,
    input: Result<Query<ResponseListInput>, axum::extract::rejection::QueryRejection>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "responses:read").await?;
    let Query(input) = input.map_err(|error| ApiError(Error::Invalid(error.body_text())))?;
    Ok(Json(app.storage.responses(&workspace, input).await?))
}

async fn response_aggregate(
    State(app): State<App>,
    headers: HeaderMap,
    input: Result<Query<ResponseAnalysisInput>, axum::extract::rejection::QueryRejection>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "responses:read").await?;
    let Query(input) = input.map_err(|error| ApiError(Error::Invalid(error.body_text())))?;
    Ok(Json(
        app.storage
            .response_analysis(&workspace, input)
            .await?
            .into_aggregate(),
    ))
}

async fn response_analysis(
    State(app): State<App>,
    headers: HeaderMap,
    input: Result<Query<ResponseAnalysisInput>, axum::extract::rejection::QueryRejection>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "responses:read").await?;
    let Query(input) = input.map_err(|error| ApiError(Error::Invalid(error.body_text())))?;
    Ok(Json(
        app.storage.response_analysis(&workspace, input).await?,
    ))
}

async fn usage(State(app): State<App>, headers: HeaderMap) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "usage:read").await?;
    Ok(Json(app.storage.usage_summary(&workspace).await?))
}

async fn process_export(app: App, workspace: String, id: String) {
    let Ok(Some(lease)) = app.storage.claim_export(&workspace, &id).await else {
        return;
    };
    // A stale attempt must never overwrite the winning attempt's object.
    let key = format!("{id}.{lease}.export");
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(likerts_server::exports::EXPORT_EXECUTION_SECONDS),
        async {
            let job = app.storage.export_job(&workspace, &id).await?;
            let snapshot = app.storage.export_snapshot(&workspace, &id, &lease).await?;
            let manifest = snapshot.manifest.clone();
            let (bytes, sha) = tokio::task::spawn_blocking(move || {
                let bytes = render(&snapshot)?;
                let sha = sha256_hex(&bytes);
                Ok::<_, Error>((bytes, sha))
            })
            .await
            .map_err(|_| Error::Internal)??;
            app.objects.put(&key, &bytes, job.expires_at).await?;
            app.storage
                .complete_export(&workspace, &id, &lease, key.clone(), sha, manifest)
                .await
        },
    )
    .await;
    if !matches!(result, Ok(Ok(()))) {
        let _ = app
            .storage
            .fail_export(&workspace, &id, &lease, "generation_failed")
            .await;
        // An ambiguous commit may have succeeded: never delete its published object.
        // On database unavailability, leave the attempt object to provider expiry.
        let unused = match app.storage.export_object_key(&workspace, &id).await {
            Ok(published) => published != key,
            Err(
                Error::NotReady | Error::ExportRevoked | Error::ExportExpired | Error::NotFound,
            ) => true,
            Err(_) => false,
        };
        if unused {
            let _ = app.objects.delete(&key).await;
        }
    }
}

async fn create_export(
    State(app): State<App>,
    headers: HeaderMap,
    ApiJson(input): ApiJson<ExportInput>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "exports:write").await?;
    let job = app.storage.create_export(&workspace, input).await?;
    tokio::spawn(process_export(app, workspace, job.id.clone()));
    Ok((StatusCode::ACCEPTED, Json(job)))
}

async fn export_status(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "exports:read").await?;
    let job = app.storage.export_job(&workspace, &id).await?;
    if matches!(
        job.status,
        likerts_server::ExportStatus::Queued | likerts_server::ExportStatus::Running
    ) {
        tokio::spawn(process_export(app, workspace, id));
    }
    Ok(Json(job))
}

async fn export_download(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "exports:read").await?;
    let job = app.storage.export_job(&workspace, &id).await?;
    let key = app.storage.export_object_key(&workspace, &id).await?;
    let bytes = app.objects.get(&key).await?;
    let sha = sha256_hex(&bytes);
    if job.content_sha256.as_deref() != Some(&sha) {
        return Err(ApiError(Error::Internal));
    }
    let (extension, content_type) = match job.format {
        ExportFormat::Csv => ("csv", "text/csv"),
        ExportFormat::Json => ("json", "application/json"),
    };
    Ok(Json(ExportDownload {
        file_name: format!("likerts-export-{id}.{extension}"),
        content_type: content_type.into(),
        content_base64: BASE64.encode(bytes),
        content_sha256: sha,
        manifest: job.manifest.ok_or(Error::Internal)?,
    }))
}

async fn revoke_export(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "exports:write").await?;
    if let Some(key) = app.storage.revoke_export(&workspace, &id).await? {
        app.objects.delete(&key).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_lifecycle_objects(app: &App, batch: &LifecycleBatch) -> Result<(), ApiError> {
    for key in &batch.object_keys {
        app.objects.delete(key).await?;
    }
    Ok(())
}

async fn erase_response(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "responses:write").await?;
    let batch = app.storage.erase_response(&workspace, &id).await?;
    delete_lifecycle_objects(&app, &batch).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn run_retention(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<RetentionResult>, ApiError> {
    let workspace = workspace(&app, &headers, "responses:write").await?;
    let batch = app.storage.run_retention(&workspace).await?;
    delete_lifecycle_objects(&app, &batch).await?;
    Ok(Json(batch.result))
}

async fn erase_workspace(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "identity:write").await?;
    let batch = app.storage.erase_workspace(&workspace).await?;
    delete_lifecycle_objects(&app, &batch).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MembershipInput {
    subject: String,
    role: Role,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SubjectInput {
    subject: String,
}

async fn list_memberships(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "identity:write").await?;
    Ok(Json(app.storage.memberships(&workspace).await?))
}

async fn put_membership(
    State(app): State<App>,
    headers: HeaderMap,
    ApiJson(input): ApiJson<MembershipInput>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "identity:write").await?;
    app.storage
        .grant_membership(&workspace, &input.subject, input.role)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_membership(
    State(app): State<App>,
    headers: HeaderMap,
    ApiJson(input): ApiJson<SubjectInput>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "identity:write").await?;
    app.storage
        .revoke_membership(&workspace, &input.subject)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CredentialInput {
    name: String,
    scopes: Vec<String>,
    expires_at: chrono::DateTime<chrono::Utc>,
}

async fn list_service_credentials(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "identity:write").await?;
    Ok(Json(app.storage.service_credentials(&workspace).await?))
}

async fn create_service_credential(
    State(app): State<App>,
    headers: HeaderMap,
    ApiJson(input): ApiJson<CredentialInput>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "identity:write").await?;
    let (credential, token) = app
        .storage
        .issue_service_credential(&workspace, &input.name, input.scopes, input.expires_at)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"credential":credential,"token":token})),
    ))
}

async fn remove_service_credential(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "identity:write").await?;
    app.storage
        .revoke_service_credential(&workspace, &id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct OAuthGrantInput {
    subject: String,
    client_id: String,
    scopes: Vec<String>,
    expires_at: chrono::DateTime<chrono::Utc>,
}

async fn create_oauth_grant(
    State(app): State<App>,
    headers: HeaderMap,
    ApiJson(input): ApiJson<OAuthGrantInput>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "identity:write").await?;
    let audience = app
        .oidc
        .as_ref()
        .ok_or(ApiError(Error::Invalid("OIDC is not configured".into())))?
        .audience();
    Ok((
        StatusCode::CREATED,
        Json(
            app.storage
                .issue_oauth_grant(
                    &workspace,
                    &input.subject,
                    &input.client_id,
                    audience,
                    input.scopes,
                    input.expires_at,
                )
                .await?,
        ),
    ))
}

async fn remove_oauth_grant(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let workspace = workspace(&app, &headers, "identity:write").await?;
    app.storage.revoke_oauth_grant(&workspace, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[tokio::main]
async fn main() {
    let allow_memory = std::env::var("LIKERTS_ALLOW_MEMORY").as_deref() == Ok("1");
    let allow_dev_auth =
        std::env::var("LIKERTS_ALLOW_DEV_AUTH").as_deref() == Ok("1") || allow_memory;
    let admission =
        Admission::from_env(allow_dev_auth).expect("Invalid request admission configuration");
    let raw = std::env::var("LIKERTS_DEV_TOKENS").unwrap_or_else(|_| "{}".into());
    let tokens: HashMap<String, String> =
        serde_json::from_str(&raw).expect("Invalid LIKERTS_DEV_TOKENS JSON");
    assert!(
        tokens
            .iter()
            .all(|(token, workspace)| token.len() >= 16 && !workspace.trim().is_empty()),
        "Require non-empty workspace and tokens at least 16 characters long"
    );

    let oidc_issuer = std::env::var("LIKERTS_OIDC_ISSUER").ok();
    let oidc_audience = std::env::var("LIKERTS_OIDC_AUDIENCE").ok();
    let oidc_jwks_url = std::env::var("LIKERTS_OIDC_JWKS_URL").ok();
    assert_eq!(
        oidc_issuer.is_some() as u8 + oidc_audience.is_some() as u8 + oidc_jwks_url.is_some() as u8,
        if oidc_issuer.is_some() { 3 } else { 0 },
        "LIKERTS_OIDC_ISSUER, LIKERTS_OIDC_AUDIENCE and LIKERTS_OIDC_JWKS_URL must be configured together"
    );
    let oidc =
        oidc_issuer
            .zip(oidc_audience)
            .zip(oidc_jwks_url)
            .map(|((issuer, audience), jwks_url)| {
                OidcVerifier::new(&issuer, &audience, &jwks_url)
                    .expect("Invalid OIDC configuration")
            });
    let browser_issuer = std::env::var("LIKERTS_BROWSER_SESSION_ISSUER").ok();
    let browser_audience = std::env::var("LIKERTS_BROWSER_SESSION_AUDIENCE").ok();
    let browser_jwks = std::env::var("LIKERTS_BROWSER_SESSION_JWKS_URL").ok();
    let browser_workspace_key = std::env::var("LIKERTS_BROWSER_WORKSPACE_KEY").ok();
    let browser_configured = browser_issuer.is_some() as u8
        + browser_audience.is_some() as u8
        + browser_jwks.is_some() as u8
        + browser_workspace_key.is_some() as u8;
    assert!(
        matches!(browser_configured, 0 | 4),
        "All LIKERTS_BROWSER_SESSION_* and LIKERTS_BROWSER_WORKSPACE_KEY variables must be configured together"
    );
    let browser_sessions = browser_issuer
        .zip(browser_audience)
        .zip(browser_jwks)
        .zip(browser_workspace_key)
        .map(|(((issuer, audience), jwks), encoded_key)| {
            let key = BASE64
                .decode(encoded_key)
                .expect("LIKERTS_BROWSER_WORKSPACE_KEY must be base64");
            BrowserSessionVerifier::new(&issuer, &audience, &jwks, &key)
                .expect("Invalid browser session configuration")
        });
    let browser_oauth_clients = BrowserOAuthClients::parse(
        std::env::var("LIKERTS_BROWSER_OAUTH_CLIENTS")
            .ok()
            .as_deref(),
    )
    .expect("Invalid LIKERTS_BROWSER_OAUTH_CLIENTS");
    let management_cors =
        ManagementCors::parse(std::env::var("LIKERTS_MANAGEMENT_ORIGINS").ok().as_deref())
            .expect("Invalid LIKERTS_MANAGEMENT_ORIGINS");
    assert!(
        tokens.is_empty() || allow_dev_auth,
        "LIKERTS_DEV_TOKENS requires LIKERTS_ALLOW_DEV_AUTH=1"
    );
    assert!(
        !allow_memory || !tokens.is_empty(),
        "Memory mode requires at least one development token"
    );

    let storage = match std::env::var("DATABASE_URL") {
        Ok(database_url) if !database_url.trim().is_empty() => {
            let store = if std::env::var("LIKERTS_RUN_MIGRATIONS").as_deref() == Ok("1") {
                PgStore::connect(&database_url)
                    .await
                    .expect("Unable to migrate PostgreSQL storage")
            } else {
                PgStore::connect_runtime(&database_url)
                    .await
                    .expect("Unable to initialize PostgreSQL storage")
            };
            store
                .ensure_workspaces(tokens.values())
                .await
                .expect("Unable to initialize configured workspaces");
            Storage::Postgres(store)
        }
        _ if allow_memory => {
            Storage::Memory(Arc::new(Mutex::new(Store::default())))
        }
        _ => panic!("DATABASE_URL is required; set LIKERTS_ALLOW_MEMORY=1 only for disposable development runs"),
    };
    let storage_name = storage
        .health()
        .await
        .expect("Storage failed initial health check");
    let port: u16 = std::env::var("LIKERTS_PORT")
        .unwrap_or_else(|_| "8080".into())
        .parse()
        .expect("Invalid port");
    let export_provider = std::env::var("LIKERTS_EXPORT_PROVIDER").unwrap_or_else(|_| {
        if std::env::var("LIKERTS_EXPORT_BUCKET").is_ok_and(|bucket| !bucket.trim().is_empty()) {
            "s3".into()
        } else {
            "local".into()
        }
    });
    let export_prefix = std::env::var("LIKERTS_EXPORT_PREFIX").unwrap_or_else(|_| "exports".into());
    let (objects, export_store_name): (Arc<dyn ObjectStore>, &str) = match export_provider.as_str()
    {
        "vercel_blob" => (
            Arc::new(
                VercelBlobObjectStore::new(
                    std::env::var("LIKERTS_VERCEL_BLOB_TOKEN")
                        .expect("LIKERTS_VERCEL_BLOB_TOKEN is required for vercel_blob exports"),
                    export_prefix,
                )
                .expect("Invalid private Vercel Blob export configuration"),
            ),
            "vercel_blob",
        ),
        "s3" => {
            let bucket = std::env::var("LIKERTS_EXPORT_BUCKET")
                .expect("LIKERTS_EXPORT_BUCKET is required for s3 exports");
            if bucket.trim().is_empty() {
                panic!("LIKERTS_EXPORT_BUCKET is required for s3 exports");
            }
            (
                Arc::new(
                    S3ObjectStore::from_environment(bucket, export_prefix)
                        .await
                        .expect("Unable to initialize S3 export object store"),
                ),
                "s3",
            )
        }
        "local"
            if std::env::var("LIKERTS_REQUIRE_REMOTE_EXPORT_STORE").as_deref() == Ok("1")
                || std::env::var("LIKERTS_REQUIRE_S3").as_deref() == Ok("1") =>
        {
            panic!("A remote export provider is required by configuration")
        }
        "local" => (
            Arc::new(
                LocalObjectStore::new(
                    std::env::var_os("LIKERTS_EXPORT_DIR")
                        .map(std::path::PathBuf::from)
                        .unwrap_or_else(default_root),
                )
                .expect("Unable to initialize local export object store"),
            ),
            "local",
        ),
        _ => panic!("LIKERTS_EXPORT_PROVIDER must be local, s3, or vercel_blob"),
    };
    let metrics = Metrics::from_env().expect("Invalid metrics configuration");
    let webhooks = std::env::var("LIKERTS_WEBHOOK_CREDENTIAL_KEY")
        .ok()
        .map(|encoded| {
            let bytes = BASE64
                .decode(encoded)
                .expect("Webhook credential key must be base64");
            let keys =
                WebhookKeys::new(&bytes).expect("Webhook credential key must decode to 32 bytes");
            match &storage {
                Storage::Postgres(store) => WebhookStore::new(store.pool().clone(), keys),
                Storage::Memory(_) => panic!("Webhooks require durable PostgreSQL storage"),
            }
        });
    let app = App {
        storage,
        tokens: Arc::new(tokens),
        objects,
        oidc,
        browser_sessions,
        browser_oauth_clients,
        metrics: metrics.clone(),
        webhooks,
    };
    let protected_resource_metadata = app
        .oidc
        .as_ref()
        .map(OidcVerifier::protected_resource_metadata_url);
    let router = Router::new()
        .route(
            "/.well-known/oauth-protected-resource",
            get(oauth_protected_resource).options(oauth_protected_resource_preflight),
        )
        .route("/health", get(health))
        .route("/internal/metrics", get(scrape_metrics))
        .route("/internal/callback-status", get(callback_worker_status))
        .route("/v1/surveys", get(surveys).post(create))
        .route("/v1/surveys/{id}", axum::routing::put(update))
        .route("/v1/surveys/{id}/publish", post(publish))
        .route("/v1/collections", post(create_collection))
        .route(
            "/v1/collections/{id}",
            get(schema).patch(acceptance).options(collection_preflight),
        )
        .route(
            "/v1/collections/{id}/security",
            axum::routing::put(configure_collection_security),
        )
        .route(
            "/v1/collections/{id}/responses",
            post(submit).options(collection_preflight),
        )
        .route("/v1/responses", get(responses))
        .route("/v1/responses/aggregate", get(response_aggregate))
        .route("/v1/responses/analyze", get(response_analysis))
        .route("/v1/responses/{id}", axum::routing::delete(erase_response))
        .route("/v1/retention", post(run_retention))
        .route("/v1/workspace", axum::routing::delete(erase_workspace))
        .route("/v1/memberships", get(list_memberships).put(put_membership))
        .route("/v1/memberships/revoke", post(remove_membership))
        .route(
            "/v1/service-credentials",
            get(list_service_credentials).post(create_service_credential),
        )
        .route(
            "/v1/service-credentials/{id}",
            axum::routing::delete(remove_service_credential),
        )
        .route("/v1/oauth-grants", post(create_oauth_grant))
        .route("/v1/browser/bootstrap", post(browser_bootstrap))
        .route("/v1/browser/results", get(browser_results))
        .route(
            "/v1/browser/service-credentials",
            get(browser_list_service_credentials).post(browser_create_service_credential),
        )
        .route(
            "/v1/browser/service-credentials/{id}",
            axum::routing::delete(browser_remove_service_credential),
        )
        .route("/v1/browser/oauth-grants", post(browser_approve_oauth))
        .route(
            "/v1/oauth-grants/{id}",
            axum::routing::delete(remove_oauth_grant),
        )
        .route("/v1/exports", post(create_export))
        .route("/v1/exports/{id}", get(export_status).delete(revoke_export))
        .route("/v1/exports/{id}/download", get(export_download))
        .route("/v1/usage", get(usage))
        .route(
            "/v1/webhook-endpoints",
            get(webhook_endpoints_list).post(webhook_endpoints_create),
        )
        .route(
            "/v1/webhook-endpoints/{id}",
            axum::routing::patch(webhook_endpoints_update),
        )
        .route(
            "/v1/webhook-endpoints/{id}/rotate-key",
            post(webhook_endpoints_rotate),
        )
        .route("/v1/webhook-deliveries", get(webhook_deliveries_list))
        .route("/v1/webhook-deliveries/{id}", get(webhook_deliveries_get))
        .route(
            "/v1/webhook-deliveries/{id}/replay",
            post(webhook_deliveries_replay),
        )
        .layer(DefaultBodyLimit::max(64 * 1024))
        .layer(middleware::from_fn_with_state(
            protected_resource_metadata,
            oauth_authentication_challenge,
        ))
        .layer(middleware::from_fn_with_state(
            admission,
            admission::enforce,
        ))
        .layer(middleware::from_fn_with_state(
            management_cors,
            management_cors::enforce,
        ))
        .layer(middleware::from_fn_with_state(metrics, metrics::observe))
        .with_state(app);
    let bind_address = std::env::var("LIKERTS_BIND_ADDRESS").unwrap_or_else(|_| "127.0.0.1".into());
    eprintln!("Likerts storage={storage_name}; responses=unmetered; exports={export_store_name}. Listening on {bind_address}:{port}");
    let listener = tokio::net::TcpListener::bind((bind_address.as_str(), port))
        .await
        .expect("Unable to bind HTTP listener");
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("HTTP server failed");
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("Unable to install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = terminate.recv() => {},
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};

    #[tokio::test]
    async fn malformed_json_has_structured_error() {
        let request = Request::builder()
            .header("content-type", "application/json")
            .body(Body::from("{bad-json"))
            .unwrap();
        let result = ApiJson::<DraftInput>::from_request(request, &()).await;
        let response = match result {
            Err(response) => response,
            Ok(_) => panic!("accepted malformed JSON"),
        };
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = to_bytes(response.into_body(), 4096).await.unwrap();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["error"]["code"], "invalid_request");
    }

    #[tokio::test]
    async fn oauth_metadata_preflight_is_public_and_collection_credentials_are_distinct() {
        let response = oauth_protected_resource_preflight().await;
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            response.headers()["access-control-allow-origin"],
            HeaderValue::from_static("*")
        );
        assert!(uses_collection_credential(
            "/v1/collections/abc",
            &Method::GET
        ));
        assert!(uses_collection_credential(
            "/v1/collections/abc/responses",
            &Method::POST
        ));
        assert!(!uses_collection_credential(
            "/v1/collections/abc/security",
            &Method::PUT
        ));
        assert!(!uses_collection_credential(
            "/v1/collections",
            &Method::POST
        ));
    }

    #[test]
    fn service_credentials_bind_an_explicit_workspace_selection() {
        let mut headers = HeaderMap::new();
        assert!(require_selected_workspace(&headers, "workspace-a").is_ok());
        headers.insert(
            "x-likerts-workspace",
            HeaderValue::from_static("workspace-a"),
        );
        assert!(require_selected_workspace(&headers, "workspace-a").is_ok());
        assert!(matches!(
            require_selected_workspace(&headers, "workspace-b"),
            Err(ApiError(Error::Forbidden))
        ));
        headers.insert("x-likerts-workspace", HeaderValue::from_static(" "));
        assert!(matches!(
            require_selected_workspace(&headers, "workspace-a"),
            Err(ApiError(Error::Invalid(_)))
        ));
    }
}

// Callback management uses a dedicated restricted worker.
struct WebhookApiError(Option<Error>);
impl From<Error> for WebhookApiError {
    fn from(error: Error) -> Self {
        Self(Some(error))
    }
}
impl From<ApiError> for WebhookApiError {
    fn from(error: ApiError) -> Self {
        Self(Some(error.0))
    }
}
impl IntoResponse for WebhookApiError {
    fn into_response(self) -> AxumResponse {
        let (status, code, message) = match self.0 {
            None => (
                StatusCode::SERVICE_UNAVAILABLE,
                "webhooks_unavailable",
                "Response webhooks are not configured",
            ),
            Some(Error::Expired) => (
                StatusCode::GONE,
                "webhook_expired",
                "Webhook event has expired",
            ),
            Some(Error::Revoked) => (
                StatusCode::GONE,
                "webhook_revoked",
                "Webhook endpoint has been revoked",
            ),
            Some(Error::Capacity) => (
                StatusCode::CONFLICT,
                "webhook_capacity",
                "Webhook endpoint limit reached",
            ),
            Some(error) => return ApiError(error).into_response(),
        };
        (
            status,
            Json(json!({"error":{"code":code,"message":message}})),
        )
            .into_response()
    }
}
fn webhook_store(app: &App) -> Result<&WebhookStore, WebhookApiError> {
    app.webhooks.as_ref().ok_or(WebhookApiError(None))
}
async fn webhook_endpoints_list(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, WebhookApiError> {
    let workspace = workspace(&app, &headers, "webhooks:read").await?;
    Ok(Json(webhook_store(&app)?.list_endpoints(&workspace).await?))
}
async fn webhook_endpoints_create(
    State(app): State<App>,
    headers: HeaderMap,
    ApiJson(input): ApiJson<EndpointInput>,
) -> Result<impl IntoResponse, WebhookApiError> {
    let workspace_id = workspace(&app, &headers, "webhooks:write").await?;
    Ok((
        StatusCode::CREATED,
        Json(
            webhook_store(&app)?
                .create_endpoint(&workspace_id, input)
                .await?,
        ),
    ))
}
async fn webhook_endpoints_update(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    ApiJson(input): ApiJson<EndpointUpdate>,
) -> Result<impl IntoResponse, WebhookApiError> {
    let workspace_id = workspace(&app, &headers, "webhooks:write").await?;
    Ok(Json(
        webhook_store(&app)?
            .update_endpoint(&workspace_id, &id, input)
            .await?,
    ))
}
async fn webhook_endpoints_rotate(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    ApiJson(input): ApiJson<WebhookOperationInput>,
) -> Result<impl IntoResponse, WebhookApiError> {
    let workspace = workspace(&app, &headers, "webhooks:write").await?;
    Ok(Json(
        webhook_store(&app)?
            .rotate_key(&workspace, &id, input)
            .await?,
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WebhookDeliveryQuery {
    endpoint_id: Option<String>,
    after: Option<String>,
    limit: Option<u16>,
}
async fn webhook_deliveries_list(
    State(app): State<App>,
    headers: HeaderMap,
    query: Result<Query<WebhookDeliveryQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<impl IntoResponse, WebhookApiError> {
    let workspace = workspace(&app, &headers, "webhooks:read").await?;
    let Query(input) =
        query.map_err(|_| Error::Invalid("Invalid webhook delivery filters".into()))?;
    Ok(Json(
        webhook_store(&app)?
            .list_deliveries(
                &workspace,
                input.endpoint_id.as_deref(),
                input.after.as_deref(),
                input.limit.unwrap_or(100),
            )
            .await?,
    ))
}
async fn webhook_deliveries_get(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, WebhookApiError> {
    let workspace = workspace(&app, &headers, "webhooks:read").await?;
    Ok(Json(
        webhook_store(&app)?.get_delivery(&workspace, &id).await?,
    ))
}
async fn webhook_deliveries_replay(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    ApiJson(input): ApiJson<WebhookOperationInput>,
) -> Result<impl IntoResponse, WebhookApiError> {
    let workspace = workspace(&app, &headers, "webhooks:write").await?;
    Ok(Json(
        webhook_store(&app)?.replay(&workspace, &id, input).await?,
    ))
}
