use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

pub mod advanced_questions;
pub mod auth;
pub mod billing;
pub mod branching;
pub mod choice_features;
pub mod conditional;
pub mod exports;
mod jwks;
pub mod metrics;
pub mod postgres;

pub use branching::{PageBranch, SurveyPage};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Choice {
    pub id: String,
    pub label: String,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub other: Option<OtherText>,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub exclusive: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OtherText {
    pub max_length: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Presentation {
    Stars,
    Dropdown,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    Nps,
    YesNo,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PromptItem {
    pub id: String,
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MatrixMode {
    Single,
    Multiple,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum VisibilityOperator {
    Equals,
    NotEquals,
    Includes,
    NotIncludes,
    Answered,
    NotAnswered,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VisibilityCondition {
    pub question_id: String,
    pub operator: VisibilityOperator,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub value: Option<Value>,
}

// Optional properties may be omitted, but null is not a supported configuration.
fn non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Question {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub required: bool,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub options: Option<Vec<Choice>>,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub min: Option<f64>,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub max: Option<f64>,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub max_length: Option<usize>,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub preset: Option<Preset>,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub labels: Option<HashMap<String, String>>,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub min_selections: Option<usize>,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub max_selections: Option<usize>,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub presentation: Option<Presentation>,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub visible_when: Option<VisibilityCondition>,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub rows: Option<Vec<PromptItem>>,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub columns: Option<Vec<Choice>>,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub matrix_mode: Option<MatrixMode>,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub items: Option<Vec<PromptItem>>,
    #[serde(
        default,
        deserialize_with = "non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub total: Option<u64>,
}

pub fn schema_version(questions: &[Question]) -> u64 {
    if questions
        .iter()
        .any(|q| matches!(q.kind.as_str(), "ranking" | "matrix" | "constant_sum"))
    {
        return 5;
    }
    if questions.iter().any(|q| {
        q.presentation.is_some()
            || q.visible_when.is_some()
            || q.options.as_ref().is_some_and(|options| {
                options
                    .iter()
                    .any(|o| o.other.is_some() || o.exclusive.is_some())
            })
    }) {
        return 3;
    }
    if questions.iter().any(|q| {
        q.preset.is_some()
            || q.labels.is_some()
            || q.min_selections.is_some()
            || q.max_selections.is_some()
    }) {
        2
    } else {
        1
    }
}

pub fn survey_schema_version(questions: &[Question], pages: Option<&[SurveyPage]>) -> u64 {
    let question_version = schema_version(questions);
    if question_version == 5 {
        5
    } else if pages.is_some() {
        4
    } else {
        question_version
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SdkTarget {
    Web,
    ReactNative,
    Ios,
    Android,
    Flutter,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SdkInstallationCapability {
    pub target: SdkTarget,
    pub sdk_version: String,
    pub schema_versions: Vec<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SdkCapabilities {
    pub installations: Vec<SdkInstallationCapability>,
}

impl SdkCapabilities {
    pub fn current_all() -> Self {
        Self {
            installations: [
                SdkTarget::Web,
                SdkTarget::ReactNative,
                SdkTarget::Ios,
                SdkTarget::Android,
                SdkTarget::Flutter,
            ]
            .into_iter()
            .map(|target| SdkInstallationCapability {
                target,
                sdk_version: "0.0.3".into(),
                schema_versions: vec![1, 2, 3, 4, 5],
            })
            .collect(),
        }
    }
}

pub fn validate_sdk_capabilities(
    capabilities: &SdkCapabilities,
    required_schema_version: u64,
) -> Result<(), Error> {
    if capabilities.installations.is_empty() || capabilities.installations.len() > 100 {
        return Err(invalid(
            "sdkCapabilities requires 1 to 100 installation groups",
        ));
    }
    let mut groups = HashSet::new();
    for installation in &capabilities.installations {
        if !bounded(&installation.sdk_version, 64)
            || installation.schema_versions.is_empty()
            || installation.schema_versions.len() > 16
            || installation
                .schema_versions
                .iter()
                .any(|version| *version == 0)
            || installation
                .schema_versions
                .iter()
                .copied()
                .collect::<HashSet<_>>()
                .len()
                != installation.schema_versions.len()
            || !groups.insert((
                installation.target.clone(),
                installation.sdk_version.clone(),
            ))
        {
            return Err(invalid("invalid sdkCapabilities declaration"));
        }
        if !installation
            .schema_versions
            .contains(&required_schema_version)
        {
            return Err(invalid(
                "an SDK installation does not support the survey schemaVersion",
            ));
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DraftInput {
    pub title: String,
    pub questions: Vec<Question>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pages: Option<Vec<SurveyPage>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Survey {
    pub id: String,
    pub revision: u64,
    pub title: String,
    pub questions: Vec<Question>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pages: Option<Vec<SurveyPage>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub survey_id: String,
    pub version: u64,
    pub title: String,
    pub questions: Vec<Question>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pages: Option<Vec<SurveyPage>>,
    pub sdk_capabilities: SdkCapabilities,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub survey_id: String,
    pub version: u64,
    pub placement: String,
    pub token: String,
    pub accepting: bool,
    pub expires_at: Option<DateTime<Utc>>,
    pub response_cap: Option<u64>,
    pub revoked: bool,
    pub sdk_capabilities: SdkCapabilities,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CollectionLimits {
    pub expires_at: Option<DateTime<Utc>>,
    pub response_cap: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CollectionSecurityInput {
    pub allowed_origins: Vec<String>,
    pub requests_per_minute: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollectionSecurity {
    pub collection_id: String,
    pub allowed_origins: Vec<String>,
    pub requests_per_minute: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Submission {
    pub idempotency_key: String,
    pub answers: Map<String, Value>,
    #[serde(default)]
    pub metadata: Map<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub response_id: String,
    pub collection_id: String,
    pub accepted: bool,
    pub charged_cents: u64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub receipt: Receipt,
    pub answers: Map<String, Value>,
    pub metadata: Map<String, Value>,
    pub accepted_at: DateTime<Utc>,
    #[serde(skip)]
    pub(crate) retrieval_sequence: i64,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ResponseListInput {
    pub limit: Option<u16>,
    pub cursor: Option<String>,
    pub collection_id: Option<String>,
    pub accepted_from: Option<DateTime<Utc>>,
    pub accepted_to: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponsePage {
    pub items: Vec<Response>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Csv,
    Json,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExportInput {
    pub idempotency_key: String,
    pub format: ExportFormat,
    pub collection_id: Option<String>,
    pub accepted_from: Option<DateTime<Utc>>,
    pub accepted_to: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportSchema {
    pub survey_id: String,
    pub version: u64,
    pub schema_version: u64,
    pub title: String,
    pub questions: Vec<Question>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pages: Option<Vec<SurveyPage>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportManifest {
    pub format_version: u64,
    pub response_count: u64,
    pub snapshot_upper_sequence: i64,
    pub collection_id: Option<String>,
    pub accepted_from: Option<DateTime<Utc>>,
    pub accepted_to: Option<DateTime<Utc>>,
    pub schemas: Vec<ExportSchema>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ExportStatus {
    Queued,
    Running,
    Ready,
    Failed,
    Revoked,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportJob {
    pub id: String,
    pub format: ExportFormat,
    pub status: ExportStatus,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub response_count: Option<u64>,
    pub content_sha256: Option<String>,
    pub manifest: Option<ExportManifest>,
    pub error_code: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ExportSnapshot {
    pub format: ExportFormat,
    pub responses: Vec<Response>,
    pub manifest: ExportManifest,
}

#[derive(Clone)]
struct ExportRecord {
    job: ExportJob,
    input: ExportInput,
    upper_sequence: i64,
    object_key: Option<String>,
    lease: Option<(String, chrono::DateTime<Utc>)>,
}

#[derive(Clone)]
struct AcceptedRecord {
    payload_hash: Vec<u8>,
    receipt: Receipt,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionResult {
    pub responses_erased: u64,
    pub exports_revoked: u64,
}

#[derive(Clone, Debug)]
pub struct LifecycleBatch {
    pub result: RetentionResult,
    pub object_keys: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BillingLimitsInput {
    pub monthly_spend_cap_cents: Option<u64>,
    pub unpaid_exposure_cap_cents: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub accepted_responses: u64,
    pub charged_cents: u64,
    pub credits: credits::CreditBalance,
    pub month_accepted_responses: u64,
    pub month_charged_cents: u64,
    pub unpaid_exposure_cents: u64,
    pub monthly_spend_cap_cents: u64,
    pub unpaid_exposure_cap_cents: u64,
    pub remaining_monthly_cents: u64,
    pub remaining_exposure_cents: u64,
    pub accepting_paid_responses: bool,
    pub blocked_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ResponseCursor {
    pub(crate) version: u8,
    pub(crate) limit: u16,
    pub(crate) collection_id: Option<String>,
    pub(crate) accepted_from: Option<DateTime<Utc>>,
    pub(crate) accepted_to: Option<DateTime<Utc>>,
    pub(crate) after_sequence: i64,
    pub(crate) upper_sequence: i64,
}

impl ResponseListInput {
    pub(crate) fn resolve(
        self,
        upper_sequence: impl FnOnce() -> i64,
    ) -> Result<ResponseCursor, Error> {
        if let Some(cursor) = self.cursor {
            if cursor.len() > 2048 {
                return Err(invalid("invalid response cursor"));
            }
            let bytes = URL_SAFE_NO_PAD
                .decode(cursor)
                .map_err(|_| invalid("invalid response cursor"))?;
            let decoded: ResponseCursor =
                serde_json::from_slice(&bytes).map_err(|_| invalid("invalid response cursor"))?;
            if decoded.version != 1
                || decoded.limit == 0
                || decoded.limit > 1000
                || decoded.after_sequence < 0
                || decoded.upper_sequence < decoded.after_sequence
                || self.limit.is_some_and(|value| value != decoded.limit)
                || self
                    .collection_id
                    .is_some_and(|value| Some(value) != decoded.collection_id)
                || self
                    .accepted_from
                    .is_some_and(|value| Some(value) != decoded.accepted_from)
                || self
                    .accepted_to
                    .is_some_and(|value| Some(value) != decoded.accepted_to)
            {
                return Err(invalid("response cursor does not match query"));
            }
            return Ok(decoded);
        }
        let limit = self.limit.unwrap_or(100);
        if limit == 0
            || limit > 1000
            || self
                .collection_id
                .as_ref()
                .is_some_and(|id| Uuid::parse_str(id).is_err())
            || matches!((self.accepted_from, self.accepted_to), (Some(from), Some(to)) if from >= to)
        {
            return Err(invalid("invalid response list query"));
        }
        Ok(ResponseCursor {
            version: 1,
            limit,
            collection_id: self.collection_id,
            accepted_from: self.accepted_from,
            accepted_to: self.accepted_to,
            after_sequence: 0,
            upper_sequence: upper_sequence(),
        })
    }
}

pub(crate) fn response_page(
    mut items: Vec<Response>,
    cursor: ResponseCursor,
) -> Result<ResponsePage, Error> {
    let has_more = items.len() > usize::from(cursor.limit);
    items.truncate(usize::from(cursor.limit));
    let next_cursor = if has_more {
        let mut next = cursor;
        next.after_sequence = items.last().ok_or(Error::Internal)?.retrieval_sequence;
        Some(URL_SAFE_NO_PAD.encode(serde_json::to_vec(&next).map_err(|_| Error::Internal)?))
    } else {
        None
    };
    Ok(ResponsePage { items, next_cursor })
}

#[derive(Debug, PartialEq)]
pub enum Error {
    Invalid(String),
    NotFound,
    Unauthorized,
    Forbidden,
    Conflict,
    Closed,
    Expired,
    Capacity,
    Revoked,
    ExportExpired,
    ExportRevoked,
    NotReady,
    ReceiptExpired,
    SpendLimit,
    RateLimited,
    Internal,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Owner,
    Editor,
    Reader,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceCredential {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub scopes: Vec<String>,
    pub expires_at: DateTime<Utc>,
    pub revoked: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthGrant {
    pub id: String,
    pub workspace_id: String,
    pub subject: String,
    pub client_id: String,
    pub audience: String,
    pub scopes: Vec<String>,
    pub expires_at: DateTime<Utc>,
    pub revoked: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMembership {
    pub subject: String,
    pub role: Role,
    pub granted_at: DateTime<Utc>,
}
fn invalid(message: &str) -> Error {
    Error::Invalid(message.to_owned())
}
fn bounded(s: &str, n: usize) -> bool {
    !s.trim().is_empty() && s.chars().count() <= n
}
fn identifier(s: &str) -> bool {
    bounded(s, 64)
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn validate_collection_security(input: &CollectionSecurityInput) -> Result<(), Error> {
    if input.allowed_origins.len() > 20
        || input.requests_per_minute == 0
        || input.requests_per_minute > 100_000
    {
        return Err(invalid("invalid collection security policy"));
    }
    let mut unique = HashSet::new();
    for origin in &input.allowed_origins {
        let url = reqwest::Url::parse(origin)
            .map_err(|_| invalid("allowed origins must be exact origins"))?;
        let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
        if url.username() != ""
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
            || (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
            || !unique.insert(url.to_string().trim_end_matches('/').to_owned())
            || origin.trim_end_matches('/') != url.to_string().trim_end_matches('/')
        {
            return Err(invalid(
                "allowed origins must be unique exact HTTPS origins",
            ));
        }
    }
    Ok(())
}

pub(crate) fn validate_management_key(key: &str) -> Result<(), Error> {
    if !bounded(key, 128) {
        return Err(invalid("idempotencyKey required, max 128 characters"));
    }
    Ok(())
}

pub(crate) fn request_hash<T: Serialize>(input: &T) -> Result<Vec<u8>, Error> {
    let encoded = serde_json::to_vec(input).map_err(|_| Error::Internal)?;
    Ok(Sha256::digest(encoded).to_vec())
}

pub(crate) fn submission_hash(token: &str, input: &Submission) -> Result<Vec<u8>, Error> {
    let encoded = serde_json::to_vec(input).map_err(|_| Error::Internal)?;
    let mut mac = Hmac::<Sha256>::new_from_slice(token.as_bytes()).map_err(|_| Error::Internal)?;
    mac.update(&encoded);
    Ok(mac.finalize().into_bytes().to_vec())
}

pub fn validate_draft(draft: &DraftInput) -> Result<(), Error> {
    if !bounded(&draft.title, 200) || draft.questions.is_empty() || draft.questions.len() > 100 {
        return Err(invalid("title or question count out of bounds"));
    }
    let mut ids = HashSet::new();
    for q in &draft.questions {
        choice_features::validate_question_features(q)?;
        advanced_questions::validate_question(q)?;
        if !identifier(&q.id) || !ids.insert(&q.id) || !bounded(&q.label, 1000) {
            return Err(invalid("invalid or duplicate question id/label"));
        }
        if q.min.is_some_and(|v| !v.is_finite())
            || q.max.is_some_and(|v| !v.is_finite())
            || matches!((q.min,q.max), (Some(a),Some(b)) if a>b)
        {
            return Err(invalid("invalid numeric bounds"));
        }
        if q.labels.is_some() && q.kind != "scale" {
            return Err(invalid("labels are supported only on scales"));
        }
        if (q.min_selections.is_some() || q.max_selections.is_some()) && q.kind != "multiple_choice"
        {
            return Err(invalid("selection limits require multiple_choice"));
        }
        match q.preset {
            Some(Preset::Nps) if q.kind != "scale" || q.min != Some(0.0) || q.max != Some(10.0) => {
                return Err(invalid("nps requires a scale from 0 to 10"));
            }
            Some(Preset::YesNo)
                if q.kind != "single_choice"
                    || !q.options.as_ref().is_some_and(|options| {
                        options.len() == 2
                            && options.iter().any(|o| o.id == "yes")
                            && options.iter().any(|o| o.id == "no")
                    }) =>
            {
                return Err(invalid("yes_no requires single_choice options yes and no"));
            }
            _ => {}
        }
        match q.kind.as_str() {
            "single_choice" | "multiple_choice" => {
                let options = q
                    .options
                    .as_ref()
                    .ok_or_else(|| invalid("choices require options"))?;
                let mut option_ids = HashSet::new();
                if options.is_empty()
                    || options.len() > 100
                    || options.iter().any(|o| {
                        !identifier(&o.id) || !bounded(&o.label, 500) || !option_ids.insert(&o.id)
                    })
                {
                    return Err(invalid("invalid choices"));
                }
                if q.min.is_some() || q.max.is_some() || q.max_length.is_some() {
                    return Err(invalid("unsupported choice properties"));
                }
                if q.kind == "multiple_choice" {
                    let minimum = q.min_selections.unwrap_or(0).max(usize::from(q.required));
                    let maximum = q.max_selections.unwrap_or(options.len());
                    if minimum > maximum || maximum > options.len() {
                        return Err(invalid("invalid selection limits"));
                    }
                }
            }
            "scale" => {
                if !matches!((q.min,q.max),(Some(a),Some(b)) if a.fract()==0.0 && b.fract()==0.0 && a>=-1000.0 && b<=1000.0)
                {
                    return Err(invalid(
                        "scale requires integer min/max between -1000 and 1000",
                    ));
                }
                if q.options.is_some() || q.max_length.is_some() {
                    return Err(invalid("unsupported scale properties"));
                }
                if let Some(labels) = &q.labels {
                    if labels.len() > 2001
                        || labels.iter().any(|(key, label)| {
                            !bounded(label, 500)
                                || !key.parse::<i64>().is_ok_and(|n| {
                                    n.to_string() == *key
                                        && n as f64 >= q.min.unwrap()
                                        && n as f64 <= q.max.unwrap()
                                })
                        })
                    {
                        return Err(invalid("invalid scale labels"));
                    }
                }
            }
            "number" => {
                if q.options.is_some() || q.max_length.is_some() {
                    return Err(invalid("unsupported number properties"));
                }
            }
            "text" => {
                if !matches!(q.max_length, Some(1..=10000))
                    || q.options.is_some()
                    || q.min.is_some()
                    || q.max.is_some()
                {
                    return Err(invalid("text requires max_length from 1 to 10000"));
                }
            }
            "date" => {
                if q.options.is_some()
                    || q.min.is_some()
                    || q.max.is_some()
                    || q.max_length.is_some()
                {
                    return Err(invalid("unsupported date properties"));
                }
            }
            "ranking" | "matrix" | "constant_sum" => {}
            _ => return Err(invalid("unsupported question type")),
        }
    }
    conditional::validate_visibility(&draft.questions)?;
    branching::validate_pages(&draft.questions, draft.pages.as_deref())?;
    Ok(())
}

pub fn validate_answers(questions: &[Question], answers: &Map<String, Value>) -> Result<(), Error> {
    normalized_answers(questions, answers).map(|_| ())
}

pub fn normalized_answers(
    questions: &[Question],
    answers: &Map<String, Value>,
) -> Result<Map<String, Value>, Error> {
    normalized_answers_for_pages(questions, None, answers)
}

pub fn normalized_answers_for_pages(
    questions: &[Question],
    pages: Option<&[SurveyPage]>,
    answers: &Map<String, Value>,
) -> Result<Map<String, Value>, Error> {
    if answers
        .keys()
        .any(|id| !questions.iter().any(|q| &q.id == id))
    {
        return Err(invalid("unknown answer id"));
    }
    let answers = branching::routed_answers(questions, pages, answers)?;
    let reached_questions = if let Some(pages) = pages {
        let reached = branching::reached_page_indices(questions, Some(pages), &answers)?;
        Some(
            reached
                .iter()
                .flat_map(|index| pages[*index].question_ids.iter().map(String::as_str))
                .collect::<HashSet<_>>(),
        )
    } else {
        None
    };
    for q in questions {
        if reached_questions
            .as_ref()
            .is_some_and(|reached| !reached.contains(q.id.as_str()))
        {
            continue;
        }
        if !answers.contains_key(&q.id) && !conditional::is_visible(questions, &answers, &q.id)? {
            continue;
        }
        let Some(answer) = answers.get(&q.id) else {
            if q.required {
                return Err(invalid("missing required answer"));
            } else {
                continue;
            }
        };
        let valid = match q.kind.as_str() {
            "text" => answer.as_str().is_some_and(|s| {
                s.chars().count() <= q.max_length.unwrap_or(0)
                    && (!q.required || !s.trim().is_empty())
            }),
            "single_choice" | "multiple_choice" => {
                choice_features::validate_choice_answer(q, answer)
            }
            "scale" | "number" => answer.as_f64().is_some_and(|n| {
                n.is_finite()
                    && (q.kind != "scale" || n.fract() == 0.0)
                    && q.min.is_none_or(|min| n >= min)
                    && q.max.is_none_or(|max| n <= max)
            }),
            "date" => answer.as_str().is_some_and(|s| {
                s.len() == 10
                    && s.as_bytes()[4] == b'-'
                    && s.as_bytes()[7] == b'-'
                    && chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
            }),
            "ranking" | "matrix" | "constant_sum" => advanced_questions::validate_answer(q, answer),
            _ => false,
        };
        if !valid {
            return Err(invalid("invalid answer value"));
        }
    }
    Ok(answers)
}

#[derive(Default)]
pub struct Store {
    surveys: HashMap<String, (String, Survey)>,
    versions: HashMap<(String, u64), (String, Version)>,
    collections: HashMap<String, (String, Collection)>,
    accepted: HashMap<(String, String), AcceptedRecord>,
    responses: HashMap<String, Vec<Response>>,
    usage: HashMap<String, u64>,
    credit_books: HashMap<String, credits::CreditBook>,
    management_requests: HashMap<(String, String, String), (Vec<u8>, Value)>,
    next_response_sequence: i64,
    exports: HashMap<(String, String), ExportRecord>,
    export_requests: HashMap<(String, String), (Vec<u8>, String)>,
    deleted_workspaces: HashSet<String>,
    retention_dirty_workspaces: HashSet<String>,
    billing_limits: HashMap<String, (u64, u64)>,
    collection_security: HashMap<String, CollectionSecurity>,
    collection_rate_windows: HashMap<(String, i64), u32>,
}
impl Store {
    pub fn set_collection_security(
        &mut self,
        workspace: &str,
        id: &str,
        input: CollectionSecurityInput,
    ) -> Result<CollectionSecurity, Error> {
        self.collections
            .get(id)
            .filter(|(owner, _)| owner == workspace)
            .ok_or(Error::NotFound)?;
        validate_collection_security(&input)?;
        let security = CollectionSecurity {
            collection_id: id.into(),
            allowed_origins: input.allowed_origins,
            requests_per_minute: input.requests_per_minute,
        };
        self.collection_security.insert(id.into(), security.clone());
        Ok(security)
    }

    pub fn collection_origin_allowed(&self, id: &str, origin: &str) -> bool {
        self.collection_security
            .get(id)
            .is_some_and(|security| security.allowed_origins.iter().any(|value| value == origin))
    }

    pub fn consume_collection_rate(&mut self, id: &str, token: &str) -> Result<(), Error> {
        self.collections
            .get(id)
            .filter(|(_, collection)| collection.token == token)
            .ok_or(Error::Unauthorized)?;
        let limit = self
            .collection_security
            .get(id)
            .map(|security| security.requests_per_minute)
            .unwrap_or(6000);
        let minute = Utc::now().timestamp() / 60;
        let count = self
            .collection_rate_windows
            .entry((id.into(), minute))
            .or_default();
        if *count >= limit {
            return Err(Error::RateLimited);
        }
        *count += 1;
        self.collection_rate_windows
            .retain(|(_, window), _| *window >= minute - 1);
        Ok(())
    }
    pub fn create_survey(&mut self, workspace: &str, input: DraftInput) -> Result<Survey, Error> {
        validate_draft(&input)?;
        if self.deleted_workspaces.contains(workspace) {
            return Err(Error::NotFound);
        }
        self.credit_books.entry(workspace.into()).or_default();
        let survey = Survey {
            id: Uuid::new_v4().to_string(),
            revision: 1,
            title: input.title,
            questions: input.questions,
            pages: input.pages,
        };
        self.surveys
            .insert(survey.id.clone(), (workspace.to_owned(), survey.clone()));
        Ok(survey)
    }
    pub fn create_survey_idempotent(
        &mut self,
        workspace: &str,
        idempotency_key: &str,
        input: DraftInput,
    ) -> Result<Survey, Error> {
        validate_management_key(idempotency_key)?;
        validate_draft(&input)?;
        let hash = request_hash(&input)?;
        let request_key = (
            workspace.to_owned(),
            "surveys_create".to_owned(),
            idempotency_key.to_owned(),
        );
        if let Some((prior_hash, response)) = self.management_requests.get(&request_key) {
            return if prior_hash == &hash {
                serde_json::from_value(response.clone()).map_err(|_| Error::Internal)
            } else {
                Err(Error::Conflict)
            };
        }
        let survey = self.create_survey(workspace, input)?;
        self.management_requests.insert(
            request_key,
            (
                hash,
                serde_json::to_value(&survey).map_err(|_| Error::Internal)?,
            ),
        );
        Ok(survey)
    }
    pub fn surveys(&self, workspace: &str) -> Vec<Survey> {
        self.surveys
            .values()
            .filter(|(w, _)| w == workspace)
            .map(|(_, s)| s.clone())
            .collect()
    }
    pub fn update(
        &mut self,
        workspace: &str,
        id: &str,
        revision: u64,
        input: DraftInput,
    ) -> Result<Survey, Error> {
        validate_draft(&input)?;
        let (owner, survey) = self
            .surveys
            .get_mut(id)
            .filter(|(w, _)| w == workspace)
            .ok_or(Error::NotFound)?;
        let _ = owner;
        if survey.revision != revision {
            return Err(Error::Conflict);
        }
        survey.revision += 1;
        survey.title = input.title;
        survey.questions = input.questions;
        survey.pages = input.pages;
        Ok(survey.clone())
    }
    pub fn publish(&mut self, workspace: &str, id: &str, revision: u64) -> Result<Version, Error> {
        self.publish_compatible(workspace, id, revision, SdkCapabilities::current_all())
    }
    pub fn publish_compatible(
        &mut self,
        workspace: &str,
        id: &str,
        revision: u64,
        sdk_capabilities: SdkCapabilities,
    ) -> Result<Version, Error> {
        let (_, survey) = self
            .surveys
            .get(id)
            .filter(|(w, _)| w == workspace)
            .ok_or(Error::NotFound)?;
        if survey.revision != revision {
            return Err(Error::Conflict);
        }
        validate_sdk_capabilities(
            &sdk_capabilities,
            survey_schema_version(&survey.questions, survey.pages.as_deref()),
        )?;
        let key = (id.to_owned(), revision);
        if let Some((_, version)) = self.versions.get(&key) {
            return if version.sdk_capabilities == sdk_capabilities {
                Ok(version.clone())
            } else {
                Err(Error::Conflict)
            };
        }
        let version = Version {
            survey_id: id.to_owned(),
            version: revision,
            title: survey.title.clone(),
            questions: survey.questions.clone(),
            pages: survey.pages.clone(),
            sdk_capabilities,
        };
        self.versions
            .insert(key, (workspace.to_owned(), version.clone()));
        Ok(version)
    }
    pub fn create_collection(
        &mut self,
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
    }

    pub fn create_collection_with_limits(
        &mut self,
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
    }

    pub fn create_collection_compatible(
        &mut self,
        workspace: &str,
        survey_id: &str,
        version: u64,
        placement: &str,
        limits: CollectionLimits,
        sdk_capabilities: SdkCapabilities,
    ) -> Result<Collection, Error> {
        let published = self
            .versions
            .get(&(survey_id.to_owned(), version))
            .filter(|(w, _)| w == workspace)
            .ok_or(Error::NotFound)?;
        validate_sdk_capabilities(
            &sdk_capabilities,
            survey_schema_version(&published.1.questions, published.1.pages.as_deref()),
        )?;
        if !bounded(placement, 200) {
            return Err(invalid("invalid placement"));
        }
        if self
            .collections
            .values()
            .filter(|(owner, collection)| {
                owner == workspace
                    && collection.accepting
                    && !collection.revoked
                    && collection
                        .expires_at
                        .is_none_or(|expiry| expiry > Utc::now())
            })
            .count()
            >= 100
        {
            return Err(Error::Capacity);
        }
        if limits.response_cap == Some(0)
            || limits.expires_at.is_some_and(|expiry| {
                let now = Utc::now();
                expiry <= now || expiry > now + Duration::days(90)
            })
        {
            return Err(invalid("invalid collection limits"));
        }
        let collection = Collection {
            id: Uuid::new_v4().to_string(),
            survey_id: survey_id.to_owned(),
            version,
            placement: placement.to_owned(),
            token: Uuid::new_v4().to_string(),
            accepting: true,
            expires_at: limits.expires_at,
            response_cap: limits.response_cap,
            revoked: false,
            sdk_capabilities,
        };
        self.collections.insert(
            collection.id.clone(),
            (workspace.to_owned(), collection.clone()),
        );
        Ok(collection)
    }
    pub fn create_collection_idempotent(
        &mut self,
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
    }

    pub fn create_collection_idempotent_compatible(
        &mut self,
        workspace: &str,
        idempotency_key: &str,
        survey_id: &str,
        version: u64,
        placement: &str,
        limits: CollectionLimits,
        sdk_capabilities: SdkCapabilities,
    ) -> Result<Collection, Error> {
        validate_management_key(idempotency_key)?;
        let hash = request_hash(&(survey_id, version, placement, &limits, &sdk_capabilities))?;
        let request_key = (
            workspace.to_owned(),
            "collections_create".to_owned(),
            idempotency_key.to_owned(),
        );
        if let Some((prior_hash, response)) = self.management_requests.get(&request_key) {
            return if prior_hash == &hash {
                serde_json::from_value(response.clone()).map_err(|_| Error::Internal)
            } else {
                Err(Error::Conflict)
            };
        }
        let collection = self.create_collection_compatible(
            workspace,
            survey_id,
            version,
            placement,
            limits,
            sdk_capabilities,
        )?;
        self.management_requests.insert(
            request_key,
            (
                hash,
                serde_json::to_value(&collection).map_err(|_| Error::Internal)?,
            ),
        );
        Ok(collection)
    }
    pub fn collection(&self, id: &str, token: &str) -> Result<Collection, Error> {
        self.collections
            .get(id)
            .filter(|(_, c)| c.token == token)
            .filter(|(_, c)| !c.revoked)
            .map(|(_, c)| c.clone())
            .ok_or_else(|| {
                if self
                    .collections
                    .get(id)
                    .is_some_and(|(_, c)| c.token == token && c.revoked)
                {
                    Error::Revoked
                } else {
                    Error::Unauthorized
                }
            })
    }
    pub fn schema(&self, id: &str, token: &str) -> Result<Version, Error> {
        let (_, c) = self
            .collections
            .get(id)
            .filter(|(_, c)| c.token == token)
            .ok_or(Error::Unauthorized)?;
        if c.revoked {
            return Err(Error::Revoked);
        }
        Ok(self.versions[&(c.survey_id.clone(), c.version)].1.clone())
    }
    pub fn set_accepting(
        &mut self,
        workspace: &str,
        id: &str,
        accepting: bool,
    ) -> Result<(), Error> {
        let (_, current) = self
            .collections
            .get(id)
            .filter(|(w, _)| w == workspace)
            .ok_or(Error::NotFound)?;
        if current.revoked {
            return Err(Error::Revoked);
        }
        if accepting {
            if current
                .expires_at
                .is_some_and(|expiry| expiry <= Utc::now())
            {
                return Err(Error::Expired);
            }
            let active = self
                .collections
                .iter()
                .filter(|(collection_id, (owner, collection))| {
                    collection_id.as_str() != id
                        && owner == workspace
                        && collection.accepting
                        && !collection.revoked
                        && collection
                            .expires_at
                            .is_none_or(|expiry| expiry > Utc::now())
                })
                .count();
            if active >= 100 {
                return Err(Error::Capacity);
            }
        }
        let (_, collection) = self
            .collections
            .get_mut(id)
            .filter(|(w, _)| w == workspace)
            .ok_or(Error::NotFound)?;
        collection.accepting = accepting;
        Ok(())
    }

    pub fn revoke_collection(&mut self, workspace: &str, id: &str) -> Result<(), Error> {
        let (_, collection) = self
            .collections
            .get_mut(id)
            .filter(|(owner, _)| owner == workspace)
            .ok_or(Error::NotFound)?;
        collection.revoked = true;
        collection.accepting = false;
        Ok(())
    }

    /// Return a terminal receipt without spending rate-limit capacity. This keeps an
    /// already accepted idempotent retry available even when the collection's current
    /// request window is exhausted.
    pub fn lookup_receipt(
        &self,
        id: &str,
        token: &str,
        submission: &Submission,
    ) -> Result<Option<Receipt>, Error> {
        let (_, collection) = self
            .collections
            .get(id)
            .filter(|(_, collection)| collection.token == token)
            .ok_or(Error::Unauthorized)?;
        if collection.revoked {
            return Err(Error::Revoked);
        }
        if !bounded(&submission.idempotency_key, 128) {
            return Ok(None);
        }
        let key = (id.to_owned(), submission.idempotency_key.clone());
        let payload_hash = submission_hash(token, submission)?;
        let Some(previous) = self.accepted.get(&key) else {
            return Ok(None);
        };
        if previous.payload_hash != payload_hash {
            return Err(Error::Conflict);
        }
        Ok(Some(previous.receipt.clone()))
    }

    pub fn submit(
        &mut self,
        id: &str,
        token: &str,
        submission: Submission,
    ) -> Result<Receipt, Error> {
        let (workspace, c) = self
            .collections
            .get(id)
            .filter(|(_, c)| c.token == token)
            .ok_or(Error::Unauthorized)?;
        if c.revoked {
            return Err(Error::Revoked);
        }
        if !bounded(&submission.idempotency_key, 128) {
            return Err(invalid("idempotency_key required, max 128 characters"));
        }
        let key = (id.to_owned(), submission.idempotency_key.clone());
        let payload_hash = submission_hash(token, &submission)?;
        if let Some(previous) = self.accepted.get(&key) {
            return if previous.payload_hash == payload_hash {
                Ok(previous.receipt.clone())
            } else {
                Err(Error::Conflict)
            };
        }
        if !c.accepting {
            return Err(Error::Closed);
        }
        if c.expires_at.is_some_and(|expiry| expiry <= Utc::now()) {
            return Err(Error::Expired);
        }
        if c.response_cap.is_some_and(|cap| {
            self.responses
                .get(workspace)
                .map(|responses| {
                    responses
                        .iter()
                        .filter(|response| response.receipt.collection_id == id)
                        .count() as u64
                        >= cap
                })
                .unwrap_or(false)
        }) {
            return Err(Error::Capacity);
        }
        let balance = self
            .credit_books
            .get(workspace)
            .cloned()
            .unwrap_or_default()
            .balance();
        let monthly_cap = self
            .billing_limits
            .get(workspace)
            .copied()
            .unwrap_or((500, 500))
            .0;
        if balance.available_credits == 0
            || (balance.promotional_credits == 0 && balance.month_paid_responses >= monthly_cap)
        {
            return Err(Error::SpendLimit);
        }
        if serde_json::to_vec(&submission.metadata).unwrap().len() > 4096 {
            return Err(invalid("metadata exceeds 4096 bytes"));
        }
        let version = &self.versions[&(c.survey_id.clone(), c.version)].1;
        let stored_answers = normalized_answers_for_pages(
            &version.questions,
            version.pages.as_deref(),
            &submission.answers,
        )?;
        let receipt = Receipt {
            response_id: Uuid::new_v4().to_string(),
            collection_id: id.to_owned(),
            accepted: true,
            charged_cents: 1,
        };
        self.credit_books
            .entry(workspace.clone())
            .or_default()
            .consume(&receipt.response_id)?;
        self.responses
            .entry(workspace.clone())
            .or_default()
            .push(Response {
                receipt: receipt.clone(),
                answers: stored_answers,
                metadata: submission.metadata.clone(),
                accepted_at: Utc::now(),
                retrieval_sequence: self.next_response_sequence + 1,
            });
        self.next_response_sequence += 1;
        *self.usage.entry(workspace.clone()).or_default() += 1;
        self.accepted.insert(
            key,
            AcceptedRecord {
                payload_hash,
                receipt: receipt.clone(),
            },
        );
        Ok(receipt)
    }
    pub fn responses(
        &self,
        workspace: &str,
        input: ResponseListInput,
    ) -> Result<ResponsePage, Error> {
        let cursor = input.resolve(|| self.next_response_sequence)?;
        let items = self
            .responses
            .get(workspace)
            .into_iter()
            .flatten()
            .filter(|response| {
                response.retrieval_sequence > cursor.after_sequence
                    && response.retrieval_sequence <= cursor.upper_sequence
                    && cursor
                        .collection_id
                        .as_ref()
                        .is_none_or(|id| &response.receipt.collection_id == id)
                    && cursor
                        .accepted_from
                        .is_none_or(|from| response.accepted_at >= from)
                    && cursor
                        .accepted_to
                        .is_none_or(|to| response.accepted_at < to)
            })
            .take(usize::from(cursor.limit) + 1)
            .cloned()
            .collect();
        response_page(items, cursor)
    }
    pub fn usage(&self, workspace: &str) -> u64 {
        self.usage.get(workspace).copied().unwrap_or(0)
    }
    pub fn usage_summary(&self, workspace: &str) -> UsageSummary {
        let charged = self.usage(workspace);
        let (monthly, exposure) = self
            .billing_limits
            .get(workspace)
            .copied()
            .unwrap_or((500, 500));
        let credits = self
            .credit_books
            .get(workspace)
            .cloned()
            .unwrap_or_default()
            .balance();
        let blocked_reason = if credits.available_credits == 0 {
            Some("credits_exhausted".into())
        } else if credits.promotional_credits == 0 && credits.month_paid_responses >= monthly {
            Some("monthly_spend_cap".into())
        } else {
            None
        };
        UsageSummary {
            accepted_responses: charged,
            charged_cents: charged,
            month_accepted_responses: charged,
            month_charged_cents: charged,
            unpaid_exposure_cents: 0,
            monthly_spend_cap_cents: monthly,
            unpaid_exposure_cap_cents: exposure,
            remaining_monthly_cents: monthly.saturating_sub(credits.month_paid_responses),
            remaining_exposure_cents: exposure,
            accepting_paid_responses: blocked_reason.is_none(),
            blocked_reason,
            credits,
        }
    }
    /// Trusted local/operator integration only; never expose this as a customer mint API.
    pub fn record_credit_adjustment(
        &mut self,
        workspace: &str,
        input: credits::CreditAdjustment,
    ) -> Result<credits::CreditEntry, Error> {
        if self.deleted_workspaces.contains(workspace) {
            return Err(Error::NotFound);
        }
        self.credit_books
            .entry(workspace.into())
            .or_default()
            .adjust(input)
    }
    pub fn credit_entries(&self, workspace: &str) -> Vec<credits::CreditEntry> {
        self.credit_books
            .get(workspace)
            .map(|book| book.entries.clone())
            .unwrap_or_default()
    }
    pub fn update_billing_limits(
        &mut self,
        workspace: &str,
        input: BillingLimitsInput,
    ) -> Result<UsageSummary, Error> {
        if input.monthly_spend_cap_cents.is_none() && input.unpaid_exposure_cap_cents.is_none() {
            return Err(invalid("at least one billing limit is required"));
        }
        if input
            .monthly_spend_cap_cents
            .into_iter()
            .chain(input.unpaid_exposure_cap_cents)
            .any(|value| value > 1_000_000_000)
        {
            return Err(invalid("billing limit exceeds 1000000000 cents"));
        }
        let current = self
            .billing_limits
            .get(workspace)
            .copied()
            .unwrap_or((500, 500));
        self.billing_limits.insert(
            workspace.to_owned(),
            (
                input.monthly_spend_cap_cents.unwrap_or(current.0),
                input.unpaid_exposure_cap_cents.unwrap_or(current.1),
            ),
        );
        Ok(self.usage_summary(workspace))
    }

    pub fn create_export(
        &mut self,
        workspace: &str,
        input: ExportInput,
    ) -> Result<ExportJob, Error> {
        validate_management_key(&input.idempotency_key)?;
        if input.collection_id.as_ref().is_some_and(|id| {
            Uuid::parse_str(id).is_err()
                || !self
                    .collections
                    .get(id)
                    .is_some_and(|(owner, _)| owner == workspace)
        }) || matches!((input.accepted_from,input.accepted_to),(Some(from),Some(to)) if from >= to)
        {
            return Err(invalid("invalid export filters"));
        }
        let hash = request_hash(&input)?;
        for ((owner, _), record) in &mut self.exports {
            if owner == workspace
                && ((matches!(
                    record.job.status,
                    ExportStatus::Queued | ExportStatus::Running
                ) && record.job.expires_at <= Utc::now())
                    || (record.job.status == ExportStatus::Running
                        && record
                            .lease
                            .as_ref()
                            .is_none_or(|(_, until)| *until <= Utc::now()))
                    || (record.job.status == ExportStatus::Queued
                        && record.job.created_at <= Utc::now() - Duration::minutes(5)))
            {
                record.job.status = ExportStatus::Failed;
                record.job.error_code = Some("attempt_expired".into());
                record.lease = None;
            }
        }
        let active = self.exports.iter().any(|((owner, _), record)| {
            owner == workspace
                && matches!(
                    record.job.status,
                    ExportStatus::Queued | ExportStatus::Running
                )
        });
        let request_key = (workspace.to_owned(), input.idempotency_key.clone());
        if let Some((prior_hash, id)) = self.export_requests.get(&request_key).cloned() {
            if prior_hash != hash {
                return Err(Error::Conflict);
            }
            let record = self
                .exports
                .get_mut(&(workspace.to_owned(), id))
                .ok_or(Error::Internal)?;
            if record.job.expires_at <= Utc::now() {
                return Err(Error::ExportExpired);
            }
            if record.job.status == ExportStatus::Failed {
                if active {
                    return Err(Error::Capacity);
                }
                record.job.status = ExportStatus::Queued;
                record.job.error_code = None;
            }
            return Ok(record.job.clone());
        }
        if self.exports.iter().any(|((owner, _), record)| {
            owner == workspace
                && matches!(
                    record.job.status,
                    ExportStatus::Queued | ExportStatus::Running
                )
        }) {
            return Err(Error::Capacity);
        }
        let now = Utc::now();
        let id = Uuid::new_v4().to_string();
        let job = ExportJob {
            id: id.clone(),
            format: input.format.clone(),
            status: ExportStatus::Queued,
            created_at: now,
            expires_at: now + Duration::hours(24),
            response_count: None,
            content_sha256: None,
            manifest: None,
            error_code: None,
        };
        self.exports.insert(
            (workspace.to_owned(), id.clone()),
            ExportRecord {
                job: job.clone(),
                input,
                upper_sequence: self.next_response_sequence,
                object_key: None,
                lease: None,
            },
        );
        self.export_requests.insert(request_key, (hash, id));
        Ok(job)
    }

    pub fn claim_export(&mut self, workspace: &str, id: &str) -> Result<Option<String>, Error> {
        let record = self
            .exports
            .get_mut(&(workspace.to_owned(), id.to_owned()))
            .ok_or(Error::NotFound)?;
        if record.job.expires_at <= Utc::now() {
            return Err(Error::ExportExpired);
        }
        if record.job.status == ExportStatus::Queued
            || (record.job.status == ExportStatus::Running
                && record
                    .lease
                    .as_ref()
                    .is_none_or(|(_, until)| *until <= Utc::now()))
        {
            let lease = Uuid::new_v4().to_string();
            record.job.status = ExportStatus::Running;
            record.lease = Some((
                lease.clone(),
                Utc::now() + Duration::seconds(crate::exports::EXPORT_LEASE_SECONDS),
            ));
            return Ok(Some(lease));
        }
        Ok(None)
    }

    pub fn export_snapshot(
        &self,
        workspace: &str,
        id: &str,
        lease: &str,
    ) -> Result<ExportSnapshot, Error> {
        let record = self
            .exports
            .get(&(workspace.to_owned(), id.to_owned()))
            .ok_or(Error::NotFound)?;
        if record.job.status != ExportStatus::Running
            || record.job.expires_at <= Utc::now()
            || record
                .lease
                .as_ref()
                .is_none_or(|(token, until)| token != lease || *until <= Utc::now())
        {
            return Err(Error::NotReady);
        }
        let responses: Vec<Response> = self
            .responses
            .get(workspace)
            .into_iter()
            .flatten()
            .filter(|response| {
                response.retrieval_sequence <= record.upper_sequence
                    && record
                        .input
                        .collection_id
                        .as_ref()
                        .is_none_or(|value| &response.receipt.collection_id == value)
                    && record
                        .input
                        .accepted_from
                        .is_none_or(|value| response.accepted_at >= value)
                    && record
                        .input
                        .accepted_to
                        .is_none_or(|value| response.accepted_at < value)
            })
            .take(crate::exports::MAX_EXPORT_RESPONSES + 1)
            .cloned()
            .collect();
        if responses.len() > crate::exports::MAX_EXPORT_RESPONSES {
            return Err(Error::Capacity);
        }
        let mut schema_keys = HashSet::new();
        let mut schemas = Vec::new();
        for response in &responses {
            let (_, collection) = &self.collections[&response.receipt.collection_id];
            if schema_keys.insert((collection.survey_id.clone(), collection.version)) {
                let version = &self.versions[&(collection.survey_id.clone(), collection.version)].1;
                schemas.push(ExportSchema {
                    survey_id: version.survey_id.clone(),
                    version: version.version,
                    schema_version: survey_schema_version(
                        &version.questions,
                        version.pages.as_deref(),
                    ),
                    title: version.title.clone(),
                    questions: version.questions.clone(),
                    pages: version.pages.clone(),
                });
            }
        }
        schemas.sort_by(|a, b| (&a.survey_id, a.version).cmp(&(&b.survey_id, b.version)));
        let manifest = ExportManifest {
            format_version: 1,
            response_count: responses.len() as u64,
            snapshot_upper_sequence: record.upper_sequence,
            collection_id: record.input.collection_id.clone(),
            accepted_from: record.input.accepted_from,
            accepted_to: record.input.accepted_to,
            schemas,
        };
        Ok(ExportSnapshot {
            format: record.input.format.clone(),
            responses,
            manifest,
        })
    }

    pub fn complete_export(
        &mut self,
        workspace: &str,
        id: &str,
        lease: &str,
        object_key: String,
        sha: String,
        manifest: ExportManifest,
    ) -> Result<(), Error> {
        let record = self
            .exports
            .get_mut(&(workspace.to_owned(), id.to_owned()))
            .ok_or(Error::NotFound)?;
        if record.job.status != ExportStatus::Running
            || record.job.expires_at <= Utc::now()
            || record
                .lease
                .as_ref()
                .is_none_or(|(token, until)| token != lease || *until <= Utc::now())
        {
            return Err(Error::Conflict);
        }
        record.lease = None;
        record.object_key = Some(object_key);
        record.job.status = ExportStatus::Ready;
        record.job.response_count = Some(manifest.response_count);
        record.job.content_sha256 = Some(sha);
        record.job.manifest = Some(manifest);
        Ok(())
    }
    pub fn fail_export(
        &mut self,
        workspace: &str,
        id: &str,
        lease: &str,
        code: &str,
    ) -> Result<(), Error> {
        let record = self
            .exports
            .get_mut(&(workspace.to_owned(), id.to_owned()))
            .ok_or(Error::NotFound)?;
        if record.job.status != ExportStatus::Running
            || record
                .lease
                .as_ref()
                .is_none_or(|(token, until)| token != lease || *until <= Utc::now())
        {
            return Ok(());
        }
        record.lease = None;
        record.job.status = ExportStatus::Failed;
        record.job.error_code = Some(code.to_owned());
        Ok(())
    }
    pub fn export_job(&self, workspace: &str, id: &str) -> Result<ExportJob, Error> {
        let record = self
            .exports
            .get(&(workspace.to_owned(), id.to_owned()))
            .ok_or(Error::NotFound)?;
        if record.job.status == ExportStatus::Revoked {
            return Err(Error::ExportRevoked);
        }
        if record.job.expires_at <= Utc::now() {
            return Err(Error::ExportExpired);
        }
        Ok(record.job.clone())
    }
    pub fn export_object_key(&self, workspace: &str, id: &str) -> Result<String, Error> {
        let record = self
            .exports
            .get(&(workspace.to_owned(), id.to_owned()))
            .ok_or(Error::NotFound)?;
        if record.job.status == ExportStatus::Revoked {
            return Err(Error::ExportRevoked);
        }
        if record.job.expires_at <= Utc::now() {
            return Err(Error::ExportExpired);
        }
        if record.job.status != ExportStatus::Ready {
            return Err(Error::NotReady);
        }
        record.object_key.clone().ok_or(Error::Internal)
    }
    pub fn revoke_export(&mut self, workspace: &str, id: &str) -> Result<Option<String>, Error> {
        let record = self
            .exports
            .get_mut(&(workspace.to_owned(), id.to_owned()))
            .ok_or(Error::NotFound)?;
        record.job.status = ExportStatus::Revoked;
        Ok(record.object_key.take())
    }

    fn revoke_workspace_exports(&mut self, workspace: &str) -> (u64, Vec<String>) {
        let mut keys = Vec::new();
        let mut revoked = 0;
        for ((owner, _), record) in &mut self.exports {
            if owner == workspace && record.job.status != ExportStatus::Revoked {
                record.job.status = ExportStatus::Revoked;
                revoked += 1;
                if let Some(key) = record.object_key.take() {
                    keys.push(key)
                }
            }
        }
        (revoked, keys)
    }
    pub fn erase_response(&mut self, workspace: &str, id: &str) -> Result<LifecycleBatch, Error> {
        let responses = self.responses.get_mut(workspace).ok_or(Error::NotFound)?;
        let before = responses.len();
        responses.retain(|response| response.receipt.response_id != id);
        if responses.len() == before {
            return Err(Error::NotFound);
        }
        let (revoked, keys) = self.revoke_workspace_exports(workspace);
        Ok(LifecycleBatch {
            result: RetentionResult {
                responses_erased: 1,
                exports_revoked: revoked,
            },
            object_keys: keys,
        })
    }
    pub fn run_retention(
        &mut self,
        workspace: &str,
        now: DateTime<Utc>,
    ) -> Result<LifecycleBatch, Error> {
        if self.deleted_workspaces.contains(workspace) {
            return Err(Error::NotFound);
        }
        let cutoff = now - Duration::days(90);
        let responses = self.responses.entry(workspace.to_owned()).or_default();
        let ids: HashSet<String> = responses
            .iter()
            .filter(|r| r.accepted_at < cutoff)
            .take(1000)
            .map(|r| r.receipt.response_id.clone())
            .collect();
        responses.retain(|r| !ids.contains(&r.receipt.response_id));
        if !ids.is_empty() {
            self.retention_dirty_workspaces.insert(workspace.to_owned());
        }
        let revoke_snapshots = self.retention_dirty_workspaces.contains(workspace);
        let mut keys = Vec::new();
        let mut revoked = 0;
        for ((owner, _), record) in &mut self.exports {
            if owner == workspace
                && record.job.status != ExportStatus::Revoked
                && (record.job.expires_at <= now || revoke_snapshots)
                && revoked < 1000
            {
                record.job.status = ExportStatus::Revoked;
                revoked += 1;
                if let Some(key) = record.object_key.take() {
                    keys.push(key)
                }
            }
        }
        if revoke_snapshots
            && !self.exports.iter().any(|((owner, _), record)| {
                owner == workspace && record.job.status != ExportStatus::Revoked
            })
        {
            self.retention_dirty_workspaces.remove(workspace);
        }
        Ok(LifecycleBatch {
            result: RetentionResult {
                responses_erased: ids.len() as u64,
                exports_revoked: revoked,
            },
            object_keys: keys,
        })
    }
    pub fn erase_workspace(&mut self, workspace: &str) -> Result<LifecycleBatch, Error> {
        if !self.deleted_workspaces.insert(workspace.to_owned()) {
            return Err(Error::NotFound);
        }
        let erased = self.responses.remove(workspace).map_or(0, |r| r.len()) as u64;
        for (owner, collection) in self.collections.values_mut() {
            if owner == workspace {
                collection.revoked = true;
                collection.accepting = false
            }
        }
        let (revoked, keys) = self.revoke_workspace_exports(workspace);
        self.management_requests
            .retain(|(owner, _, _), _| owner != workspace);
        self.surveys.retain(|_, (owner, _)| owner != workspace);
        self.versions.retain(|_, (owner, _)| owner != workspace);
        Ok(LifecycleBatch {
            result: RetentionResult {
                responses_erased: erased,
                exports_revoked: revoked,
            },
            object_keys: keys,
        })
    }
    pub fn workspace_active(&self, workspace: &str) -> Result<(), Error> {
        if self.deleted_workspaces.contains(workspace) {
            Err(Error::Unauthorized)
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn draft() -> DraftInput {
        serde_json::from_value(json!({"title":"Checkout", "questions":[{"id":"rating","label":"How was it?","type":"scale","required":true,"min":1,"max":5}]})).unwrap()
    }
    fn submission(n: u64) -> Submission {
        serde_json::from_value(json!({"idempotencyKey":"retry-1","answers":{"rating":n}})).unwrap()
    }
    fn enhanced() -> DraftInput {
        serde_json::from_value(json!({"title":"Expanded", "questions":[
            {"id":"nps","label":"Recommend?","type":"scale","min":0,"max":10,"preset":"nps","labels":{"0":"Unlikely","10":"Very likely"},"required":true},
            {"id":"again","label":"Again?","type":"single_choice","preset":"yes_no","options":[{"id":"yes","label":"Oui"},{"id":"no","label":"Non"}]},
            {"id":"reasons","label":"Reasons","type":"multiple_choice","minSelections":1,"maxSelections":2,"options":[{"id":"a","label":"A"},{"id":"b","label":"B"},{"id":"c","label":"C"}]}
        ]})).unwrap()
    }
    fn capabilities(schema_versions: Vec<u64>) -> SdkCapabilities {
        SdkCapabilities {
            installations: vec![
                SdkInstallationCapability {
                    target: SdkTarget::Ios,
                    sdk_version: "legacy".into(),
                    schema_versions: vec![1],
                },
                SdkInstallationCapability {
                    target: SdkTarget::Ios,
                    sdk_version: "current".into(),
                    schema_versions,
                },
            ],
        }
    }
    #[test]
    fn declared_mixed_sdk_fleet_blocks_incompatible_publish_and_binding() {
        let mut store = Store::default();
        let baseline = store.create_survey("a", draft()).unwrap();
        let mixed = capabilities(vec![1, 2]);
        let version = store
            .publish_compatible("a", &baseline.id, 1, mixed.clone())
            .unwrap();
        assert_eq!(version.sdk_capabilities, mixed);
        let collection = store
            .create_collection_compatible(
                "a",
                &baseline.id,
                1,
                "mixed",
                CollectionLimits::default(),
                capabilities(vec![1, 2]),
            )
            .unwrap();
        assert_eq!(collection.version, 1);

        let expanded = store.create_survey("a", enhanced()).unwrap();
        assert!(matches!(
            store.publish_compatible("a", &expanded.id, 1, capabilities(vec![1, 2])),
            Err(Error::Invalid(_))
        ));
        let all_current = SdkCapabilities::current_all();
        store
            .publish_compatible("a", &expanded.id, 1, all_current.clone())
            .unwrap();
        assert!(matches!(
            store.create_collection_compatible(
                "a",
                &expanded.id,
                1,
                "old-and-new",
                CollectionLimits::default(),
                capabilities(vec![1, 2]),
            ),
            Err(Error::Invalid(_))
        ));
        let bound = store
            .create_collection_compatible(
                "a",
                &expanded.id,
                1,
                "new-only",
                CollectionLimits::default(),
                all_current,
            )
            .unwrap();
        store.update("a", &expanded.id, 1, draft()).unwrap();
        store.publish("a", &expanded.id, 2).unwrap();
        assert_eq!(
            schema_version(&store.schema(&bound.id, &bound.token).unwrap().questions),
            2
        );
    }
    #[test]
    fn conditional_schema_is_immutable_and_submission_discards_hidden_answers() {
        let mut store = Store::default();
        let conditional: DraftInput = serde_json::from_value(json!({"title":"Conditional","questions":[
            {"id":"return","label":"Return?","type":"single_choice","required":true,"options":[{"id":"yes","label":"Yes"},{"id":"no","label":"No"}]},
            {"id":"reason","label":"Reason","type":"text","required":true,"maxLength":100,"visibleWhen":{"questionId":"return","operator":"equals","value":"no"}}
        ]})).unwrap();
        let survey = store.create_survey("a", conditional).unwrap();
        let version = store
            .publish_compatible("a", &survey.id, 1, SdkCapabilities::current_all())
            .unwrap();
        assert_eq!(schema_version(&version.questions), 3);
        let collection = store
            .create_collection_compatible(
                "a",
                &survey.id,
                1,
                "conditional",
                CollectionLimits::default(),
                SdkCapabilities::current_all(),
            )
            .unwrap();
        assert_eq!(
            schema_version(
                &store
                    .schema(&collection.id, &collection.token)
                    .unwrap()
                    .questions
            ),
            3
        );
        store.submit(&collection.id,&collection.token,serde_json::from_value(json!({"idempotencyKey":"conditional-1","answers":{"return":"yes","reason":"stale hidden answer"}})).unwrap()).unwrap();
        let stored = store.responses("a", ResponseListInput::default()).unwrap();
        assert_eq!(
            stored.items[0].answers,
            json!({"return":"yes"}).as_object().unwrap().clone()
        );
    }
    #[test]
    fn deletion_preserves_billing_and_idempotency_then_blocks_deleted_workspace() {
        let mut store = Store::default();
        let survey = store.create_survey("a", draft()).unwrap();
        store.publish("a", &survey.id, 1).unwrap();
        let collection = store
            .create_collection("a", &survey.id, 1, "receipt")
            .unwrap();
        let original = submission(5);
        let receipt = store
            .submit(&collection.id, &collection.token, original.clone())
            .unwrap();
        assert_eq!(store.usage("a"), 1);
        let export = store
            .create_export(
                "a",
                ExportInput {
                    idempotency_key: "delete-export".into(),
                    format: ExportFormat::Json,
                    collection_id: None,
                    accepted_from: None,
                    accepted_to: None,
                },
            )
            .unwrap();

        let erased = store.erase_response("a", &receipt.response_id).unwrap();
        assert_eq!(erased.result.responses_erased, 1);
        assert_eq!(erased.result.exports_revoked, 1);
        assert_eq!(store.usage("a"), 1);
        assert_eq!(
            store
                .submit(&collection.id, &collection.token, original)
                .unwrap()
                .response_id,
            receipt.response_id
        );
        assert!(matches!(
            store.submit(&collection.id, &collection.token, submission(4)),
            Err(Error::Conflict)
        ));
        assert!(matches!(
            store.export_job("a", &export.id),
            Err(Error::ExportRevoked)
        ));

        store.erase_workspace("a").unwrap();
        assert_eq!(store.usage("a"), 1);
        assert!(matches!(
            store.workspace_active("a"),
            Err(Error::Unauthorized)
        ));
    }
    #[test]
    fn enhanced_presets_and_properties_are_strict() {
        let d = enhanced();
        validate_draft(&d).unwrap();
        for (index, property, value) in [
            (0, "min", json!(1)),
            (0, "max", json!(9)),
            (0, "type", json!("number")),
            (0, "preset", json!("yes_no")),
            (1, "type", json!("multiple_choice")),
            (1, "labels", json!({"0":"No"})),
            (1, "minSelections", json!(1)),
            (2, "minSelections", json!(3)),
            (2, "maxSelections", json!(4)),
            (2, "preset", json!("nps")),
        ] {
            let mut value_draft = serde_json::to_value(&d).unwrap();
            value_draft["questions"][index][property] = value;
            let decoded: DraftInput = serde_json::from_value(value_draft).unwrap();
            assert!(validate_draft(&decoded).is_err(), "{index}/{property}");
        }
        let mut bad = d.clone();
        bad.questions[1].options.as_mut().unwrap()[1].id = "maybe".into();
        assert!(validate_draft(&bad).is_err());
        for (property, value) in [
            ("preset", json!("stars")),
            ("preset", Value::Null),
            ("labels", Value::Null),
            ("minSelections", json!(-1)),
            ("maxSelections", json!(1.5)),
            ("unsupported", json!(true)),
        ] {
            let mut encoded = serde_json::to_value(&d).unwrap();
            encoded["questions"][2][property] = value;
            assert!(
                serde_json::from_value::<DraftInput>(encoded).is_err(),
                "{property}"
            );
        }
    }
    #[test]
    fn labels_require_canonical_in_range_integer_keys_and_bounded_text() {
        for labels in [
            json!({"01":"bad"}),
            json!({"-0":"bad"}),
            json!({"1.0":"bad"}),
            json!({"+1":"bad"}),
            json!({"11":"bad"}),
            json!({"-1":"bad"}),
            json!({"1":" "}),
            json!({"1":"x".repeat(501)}),
        ] {
            let mut d = enhanced();
            d.questions[0].labels = Some(serde_json::from_value(labels).unwrap());
            assert!(validate_draft(&d).is_err());
        }
        let mut d = enhanced();
        d.questions[0].preset = None;
        d.questions[0].min = Some(-2.0);
        d.questions[0].labels = Some(HashMap::from([("-2".into(), "Low".into())]));
        validate_draft(&d).unwrap();
    }
    #[test]
    fn supplied_optional_selections_obey_limits_and_required_enforces_one() {
        let d = enhanced();
        for answers in [
            json!({"nps":8}),
            json!({"nps":8,"reasons":["a"]}),
            json!({"nps":8,"reasons":["a","b"]}),
        ] {
            validate_answers(&d.questions, answers.as_object().unwrap()).unwrap();
        }
        for choices in [
            json!([]),
            json!(["a", "b", "c"]),
            json!(["a", "a"]),
            json!(["unknown"]),
            json!("a"),
        ] {
            assert!(validate_answers(
                &d.questions,
                json!({"nps":8,"reasons":choices}).as_object().unwrap()
            )
            .is_err());
        }
        let mut d = enhanced();
        d.questions[2].min_selections = Some(0);
        d.questions[2].max_selections = Some(0);
        validate_draft(&d).unwrap();
        validate_answers(
            &d.questions,
            json!({"nps":8,"reasons":[]}).as_object().unwrap(),
        )
        .unwrap();
        d.questions[2].required = true;
        assert!(validate_draft(&d).is_err());
        d.questions[2].max_selections = Some(2);
        validate_draft(&d).unwrap();
        assert!(validate_answers(
            &d.questions,
            json!({"nps":8,"reasons":[]}).as_object().unwrap()
        )
        .is_err());
        assert!(validate_answers(&d.questions, json!({"nps":8}).as_object().unwrap()).is_err());
    }
    #[test]
    fn enhanced_versions_are_frozen_and_retries_bill_once() {
        assert_eq!(schema_version(&draft().questions), 1);
        assert_eq!(schema_version(&enhanced().questions), 2);
        for field in ["preset", "labels", "minSelections", "maxSelections"] {
            let mut d = enhanced();
            for q in &mut d.questions {
                if field != "preset" {
                    q.preset = None;
                }
                if field != "labels" {
                    q.labels = None;
                }
                if field != "minSelections" {
                    q.min_selections = None;
                }
                if field != "maxSelections" {
                    q.max_selections = None;
                }
            }
            validate_draft(&d).unwrap();
            assert_eq!(schema_version(&d.questions), 2, "{field}");
        }
        let encoded = serde_json::to_value(draft()).unwrap();
        assert!(encoded["questions"][0].get("preset").is_none());
        assert!(encoded["questions"][0].get("options").is_none());
        let mut s = Store::default();
        let survey = s.create_survey("a", enhanced()).unwrap();
        s.publish("a", &survey.id, 1).unwrap();
        let c = s.create_collection("a", &survey.id, 1, "checkout").unwrap();
        s.update("a", &survey.id, 1, draft()).unwrap();
        let v2 = s.publish("a", &survey.id, 2).unwrap();
        assert_eq!(schema_version(&v2.questions), 1);
        let frozen = s.schema(&c.id, &c.token).unwrap();
        assert_eq!(schema_version(&frozen.questions), 2);
        assert_eq!(
            frozen.questions[0].labels.as_ref().unwrap()["10"],
            "Very likely"
        );
        let response: Submission = serde_json::from_value(json!({"idempotencyKey":"enhanced","answers":{"nps":9,"again":"yes","reasons":["a","b"]}})).unwrap();
        let receipt = s.submit(&c.id, &c.token, response.clone()).unwrap();
        s.set_accepting("a", &c.id, false).unwrap();
        assert_eq!(
            s.submit(&c.id, &c.token, response).unwrap().response_id,
            receipt.response_id
        );
        assert_eq!(s.usage("a"), 1);
        assert_eq!(
            s.responses("a", ResponseListInput::default())
                .unwrap()
                .items
                .len(),
            1
        );
    }
    #[test]
    fn retries_never_double_bill_even_after_close() {
        let mut s = Store::default();
        let survey = s.create_survey("a", draft()).unwrap();
        s.publish("a", &survey.id, 1).unwrap();
        let c = s.create_collection("a", &survey.id, 1, "checkout").unwrap();
        let first = s.submit(&c.id, &c.token, submission(4)).unwrap();
        s.set_accepting("a", &c.id, false).unwrap();
        assert_eq!(
            first.response_id,
            s.submit(&c.id, &c.token, submission(4))
                .unwrap()
                .response_id
        );
        assert_eq!(
            s.submit(&c.id, &c.token, submission(3)).unwrap_err(),
            Error::Conflict
        );
        assert_eq!(s.usage("a"), 1);
        let mut new = submission(4);
        new.idempotency_key = "new".into();
        assert_eq!(s.submit(&c.id, &c.token, new).unwrap_err(), Error::Closed);
    }
    #[test]
    fn collection_limits_are_terminal_and_active_count_is_bounded() {
        let mut s = Store::default();
        let survey = s.create_survey("a", draft()).unwrap();
        s.publish("a", &survey.id, 1).unwrap();
        for limits in [
            CollectionLimits {
                expires_at: None,
                response_cap: Some(0),
            },
            CollectionLimits {
                expires_at: Some(Utc::now() - Duration::seconds(1)),
                response_cap: None,
            },
            CollectionLimits {
                expires_at: Some(Utc::now() + Duration::days(91)),
                response_cap: None,
            },
        ] {
            assert!(matches!(
                s.create_collection_with_limits("a", &survey.id, 1, "invalid", limits),
                Err(Error::Invalid(_))
            ));
        }

        let capped = s
            .create_collection_with_limits(
                "a",
                &survey.id,
                1,
                "capped",
                CollectionLimits {
                    expires_at: None,
                    response_cap: Some(1),
                },
            )
            .unwrap();
        let first = s.submit(&capped.id, &capped.token, submission(4)).unwrap();
        assert_eq!(
            s.submit(&capped.id, &capped.token, submission(4))
                .unwrap()
                .response_id,
            first.response_id
        );
        let mut second = submission(4);
        second.idempotency_key = "second".into();
        assert_eq!(
            s.submit(&capped.id, &capped.token, second).unwrap_err(),
            Error::Capacity
        );
        s.revoke_collection("a", &capped.id).unwrap();
        assert_eq!(
            s.schema(&capped.id, &capped.token).unwrap_err(),
            Error::Revoked
        );
        assert_eq!(
            s.submit(&capped.id, &capped.token, submission(4))
                .unwrap_err(),
            Error::Revoked
        );
        assert_eq!(
            s.set_accepting("a", &capped.id, true).unwrap_err(),
            Error::Revoked
        );

        let expiring = s
            .create_collection_with_limits(
                "a",
                &survey.id,
                1,
                "expiring",
                CollectionLimits {
                    expires_at: Some(Utc::now() + Duration::milliseconds(20)),
                    response_cap: None,
                },
            )
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
        assert_eq!(
            s.submit(&expiring.id, &expiring.token, submission(4))
                .unwrap_err(),
            Error::Expired
        );
        assert_eq!(
            s.set_accepting("a", &expiring.id, true).unwrap_err(),
            Error::Expired
        );

        let mut active = Vec::new();
        for attempt in 0..100 {
            active.push(
                s.create_collection("a", &survey.id, 1, &format!("active-{attempt}"))
                    .unwrap(),
            );
        }
        assert_eq!(
            s.create_collection("a", &survey.id, 1, "too-many")
                .unwrap_err(),
            Error::Capacity
        );
        s.set_accepting("a", &active[0].id, false).unwrap();
        s.create_collection("a", &survey.id, 1, "replacement")
            .unwrap();
        assert_eq!(
            s.set_accepting("a", &active[0].id, true).unwrap_err(),
            Error::Capacity
        );
    }
    #[test]
    fn management_creation_retries_return_original_resources() {
        let mut s = Store::default();
        let created = s
            .create_survey_idempotent("a", "survey-once", draft())
            .unwrap();
        assert_eq!(
            s.create_survey_idempotent("a", "survey-once", draft())
                .unwrap()
                .id,
            created.id
        );
        let mut changed = draft();
        changed.title = "Changed".into();
        assert_eq!(
            s.create_survey_idempotent("a", "survey-once", changed)
                .unwrap_err(),
            Error::Conflict
        );
        s.publish("a", &created.id, 1).unwrap();
        let collection = s
            .create_collection_idempotent(
                "a",
                "collection-once",
                &created.id,
                1,
                "checkout",
                CollectionLimits::default(),
            )
            .unwrap();
        let retry = s
            .create_collection_idempotent(
                "a",
                "collection-once",
                &created.id,
                1,
                "checkout",
                CollectionLimits::default(),
            )
            .unwrap();
        assert_eq!(retry.id, collection.id);
        assert_eq!(retry.token, collection.token);
        assert_eq!(
            s.create_collection_idempotent(
                "a",
                "collection-once",
                &created.id,
                1,
                "changed",
                CollectionLimits::default(),
            )
            .unwrap_err(),
            Error::Conflict
        );
    }
    #[test]
    fn immutable_versions_validation_and_workspace_isolation() {
        let mut s = Store::default();
        let survey = s.create_survey("a", draft()).unwrap();
        s.publish("a", &survey.id, 1).unwrap();
        assert_eq!(s.publish("b", &survey.id, 1).unwrap_err(), Error::NotFound);
        assert_eq!(
            s.create_collection("b", &survey.id, 1, "x").unwrap_err(),
            Error::NotFound
        );
        let c = s.create_collection("a", &survey.id, 1, "x").unwrap();
        let mut updated = draft();
        updated.questions[0].max = Some(3.0);
        s.update("a", &survey.id, 1, updated).unwrap();
        assert!(s.submit(&c.id, &c.token, submission(5)).is_ok());
        assert!(s
            .responses("b", ResponseListInput::default())
            .unwrap()
            .items
            .is_empty());
        assert_eq!(s.usage("b"), 0);
        let mut bad = submission(6);
        bad.idempotency_key = "bad".into();
        assert!(s.submit(&c.id, &c.token, bad).is_err());
        assert_eq!(s.usage("a"), 1);
        assert_eq!(s.schema(&c.id, "wrong").unwrap_err(), Error::Unauthorized);
    }
    #[test]
    fn collection_security_bounds_origins_and_attempt_rate() {
        let mut store = Store::default();
        let survey = store.create_survey("a", draft()).unwrap();
        store.publish("a", &survey.id, 1).unwrap();
        let collection = store
            .create_collection("a", &survey.id, 1, "embedded")
            .unwrap();
        assert!(store
            .set_collection_security(
                "a",
                &collection.id,
                CollectionSecurityInput {
                    allowed_origins: vec!["https://survey.customer.example".into()],
                    requests_per_minute: 2,
                },
            )
            .is_ok());
        assert!(store.collection_origin_allowed(&collection.id, "https://survey.customer.example"));
        assert!(!store.collection_origin_allowed(&collection.id, "https://evil.example"));
        assert_eq!(
            store.set_collection_security(
                "a",
                &collection.id,
                CollectionSecurityInput {
                    allowed_origins: vec!["https://customer.example/path".into()],
                    requests_per_minute: 2,
                },
            ),
            Err(Error::Invalid(
                "allowed origins must be unique exact HTTPS origins".into()
            ))
        );
        store
            .consume_collection_rate(&collection.id, &collection.token)
            .unwrap();
        let mut accepted = submission(4);
        accepted.idempotency_key = "accepted-before-limit".into();
        let receipt = store
            .submit(&collection.id, &collection.token, accepted.clone())
            .unwrap();
        store
            .consume_collection_rate(&collection.id, &collection.token)
            .unwrap();
        assert_eq!(
            store.consume_collection_rate(&collection.id, &collection.token),
            Err(Error::RateLimited)
        );
        let retried = store
            .lookup_receipt(&collection.id, &collection.token, &accepted)
            .unwrap()
            .unwrap();
        assert_eq!(retried.response_id, receipt.response_id);
        let mut changed = accepted;
        changed.answers.insert("rating".into(), json!(5));
        assert!(matches!(
            store.lookup_receipt(&collection.id, &collection.token, &changed),
            Err(Error::Conflict)
        ));
        assert_eq!(store.usage("a"), 1);
    }
    #[test]
    fn duplicate_questions_and_unexpected_answers_rejected() {
        let mut d = draft();
        d.questions.push(d.questions[0].clone());
        assert!(validate_draft(&d).is_err());
        assert!(validate_answers(
            &draft().questions,
            json!({"rating":3,"extra":"x"}).as_object().unwrap()
        )
        .is_err());
        assert!(validate_answers(
            &draft().questions,
            json!({"rating":3.5}).as_object().unwrap()
        )
        .is_err());
    }
    #[test]
    fn shared_six_type_contract_fixtures_validate() {
        let d: DraftInput =
            serde_json::from_str(include_str!("../../contracts/survey.example.json")).unwrap();
        let response: Submission =
            serde_json::from_str(include_str!("../../contracts/response.example.json")).unwrap();
        validate_draft(&d).unwrap();
        validate_answers(&d.questions, &response.answers).unwrap();
        let encoded = serde_json::to_value(&d).unwrap();
        assert_eq!(encoded["questions"][3]["maxLength"], 500);
        let mut invalid_date = response.answers.clone();
        invalid_date.insert("visitDate".into(), json!("2026-02-30"));
        assert!(validate_answers(&d.questions, &invalid_date).is_err());
        let mut duplicate_choices = response.answers;
        duplicate_choices.insert("improvements".into(), json!(["payment", "payment"]));
        assert!(validate_answers(&d.questions, &duplicate_choices).is_err());
    }
    #[test]
    fn shared_expanded_contract_fixtures_validate_and_bill_once() {
        let d: DraftInput =
            serde_json::from_str(include_str!("../../contracts/expanded-survey.example.json"))
                .unwrap();
        let response: Submission = serde_json::from_str(include_str!(
            "../../contracts/expanded-response.example.json"
        ))
        .unwrap();
        validate_draft(&d).unwrap();
        validate_answers(&d.questions, &response.answers).unwrap();
        assert_eq!(schema_version(&d.questions), 2);
        let mut store = Store::default();
        let survey = store.create_survey("fixture", d).unwrap();
        store.publish("fixture", &survey.id, 1).unwrap();
        let collection = store
            .create_collection("fixture", &survey.id, 1, "checkout")
            .unwrap();
        let first = store
            .submit(&collection.id, &collection.token, response.clone())
            .unwrap();
        let retry = store
            .submit(&collection.id, &collection.token, response)
            .unwrap();
        assert_eq!(first.response_id, retry.response_id);
        assert_eq!(store.usage("fixture"), 1);
    }
    #[test]
    fn concurrent_retries_create_one_usage_entry() {
        use std::sync::{Arc, Mutex};
        let mut s = Store::default();
        let survey = s.create_survey("a", draft()).unwrap();
        s.publish("a", &survey.id, 1).unwrap();
        let c = s.create_collection("a", &survey.id, 1, "x").unwrap();
        let shared = Arc::new(Mutex::new(s));
        let workers: Vec<_> = (0..16)
            .map(|_| {
                let state = shared.clone();
                let c = c.clone();
                std::thread::spawn(move || {
                    state
                        .lock()
                        .unwrap()
                        .submit(&c.id, &c.token, submission(4))
                        .unwrap()
                        .response_id
                })
            })
            .collect();
        let receipts: HashSet<_> = workers.into_iter().map(|w| w.join().unwrap()).collect();
        assert_eq!(receipts.len(), 1);
        assert_eq!(shared.lock().unwrap().usage("a"), 1);
    }
    #[test]
    fn export_lease_fences_stale_completion_and_reaps_capacity() {
        let mut store = Store::default();
        store.create_survey("a", draft()).unwrap();
        let input = ExportInput {
            idempotency_key: "lease".into(),
            format: ExportFormat::Json,
            collection_id: None,
            accepted_from: None,
            accepted_to: None,
        };
        let job = store.create_export("a", input.clone()).unwrap();
        let old = store.claim_export("a", &job.id).unwrap().unwrap();
        let snapshot = store.export_snapshot("a", &job.id, &old).unwrap();
        assert!(store.claim_export("a", &job.id).unwrap().is_none());
        store
            .exports
            .get_mut(&("a".into(), job.id.clone()))
            .unwrap()
            .lease
            .as_mut()
            .unwrap()
            .1 = Utc::now() - Duration::seconds(1);
        let new = store.claim_export("a", &job.id).unwrap().unwrap();
        assert_ne!(old, new);
        assert!(matches!(
            store.complete_export(
                "a",
                &job.id,
                &old,
                "old".into(),
                "old".into(),
                snapshot.manifest.clone()
            ),
            Err(Error::Conflict)
        ));
        store.fail_export("a", &job.id, &old, "stale").unwrap();
        assert_eq!(
            store.export_job("a", &job.id).unwrap().status,
            ExportStatus::Running
        );
        store
            .complete_export(
                "a",
                &job.id,
                &new,
                "new".into(),
                "new".into(),
                snapshot.manifest,
            )
            .unwrap();
        assert_eq!(store.create_export("a", input).unwrap().id, job.id);
        let orphan = store
            .create_export(
                "a",
                ExportInput {
                    idempotency_key: "orphan".into(),
                    format: ExportFormat::Csv,
                    collection_id: None,
                    accepted_from: None,
                    accepted_to: None,
                },
            )
            .unwrap();
        store.claim_export("a", &orphan.id).unwrap();
        store
            .exports
            .get_mut(&("a".into(), orphan.id.clone()))
            .unwrap()
            .lease
            .as_mut()
            .unwrap()
            .1 = Utc::now() - Duration::seconds(1);
        store
            .create_export(
                "a",
                ExportInput {
                    idempotency_key: "next".into(),
                    format: ExportFormat::Csv,
                    collection_id: None,
                    accepted_from: None,
                    accepted_to: None,
                },
            )
            .unwrap();
        assert_eq!(
            store.export_job("a", &orphan.id).unwrap().status,
            ExportStatus::Failed
        );
    }
    #[test]
    fn concurrent_spend_cap_accepts_only_one_final_cent() {
        use std::sync::{Arc, Mutex};
        let mut store = Store::default();
        let survey = store.create_survey("a", draft()).unwrap();
        store.publish("a", &survey.id, 1).unwrap();
        let collection = store
            .create_collection("a", &survey.id, 1, "spend-cap")
            .unwrap();
        store
            .update_billing_limits(
                "a",
                BillingLimitsInput {
                    monthly_spend_cap_cents: Some(1),
                    unpaid_exposure_cap_cents: Some(5),
                },
            )
            .unwrap();
        // Exercise paid spending after the one-time promotional grant is exhausted.
        for (key, kind, promotional_delta, paid_delta) in [
            ("expire-promo", credits::CreditKind::Correction, -1000, 0),
            ("paid-test", credits::CreditKind::Purchase, 0, 8),
        ] {
            store
                .record_credit_adjustment(
                    "a",
                    credits::CreditAdjustment {
                        idempotency_key: key.into(),
                        kind,
                        promotional_delta,
                        paid_delta,
                        reference_id: None,
                        reason_code: "test_fixture".into(),
                    },
                )
                .unwrap();
        }
        let shared = Arc::new(Mutex::new(store));
        let workers: Vec<_> = (0..8)
            .map(|attempt| {
                let state = shared.clone();
                let collection = collection.clone();
                std::thread::spawn(move || {
                    let mut input = submission(5);
                    input.idempotency_key = format!("cap-{attempt}");
                    state
                        .lock()
                        .unwrap()
                        .submit(&collection.id, &collection.token, input)
                })
            })
            .collect();
        let results: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(Error::SpendLimit)))
                .count(),
            7
        );
        let summary = shared.lock().unwrap().usage_summary("a");
        assert_eq!(summary.charged_cents, 1);
        assert_eq!(summary.remaining_monthly_cents, 0);
        assert_eq!(summary.blocked_reason.as_deref(), Some("monthly_spend_cap"));
    }
}

pub mod webhook_store;
pub mod webhooks;

pub mod browser_auth;
pub mod credits;
pub mod management_cors;
