use chrono::{Duration, Utc};
use likerts_server::{
    billing::{
        BillingAccountInput, ChargeRequest, LocalPaymentProvider, PaymentProvider, ProviderEvent,
        RefundInput, SettlementInput,
    },
    exports::{render, sha256_hex},
    postgres::PgStore,
    CollectionLimits, CollectionSecurityInput, DraftInput, Error, ExportFormat, ExportInput,
    ExportStatus, Question, ResponseListInput, Role, SdkCapabilities, SdkInstallationCapability,
    SdkTarget, Submission,
};
use serde_json::{json, Map, Value};
use sqlx::Acquire;
use std::collections::HashSet;
use std::process::{Child, Command, Stdio};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

// Historical usage imported before response credits existed. This fixture bypasses
// the current submission service deliberately, keeping the immutable current ledger intact.
async fn seed_legacy_usage(store: &PgStore, workspace: &str, collection: &str, key: &str) {
    let mut tx = store.pool().begin().await.unwrap();
    sqlx::query("select set_config('likerts.workspace_id',$1,true)")
        .bind(workspace)
        .execute(&mut *tx)
        .await
        .unwrap();
    let id = Uuid::new_v4();
    sqlx::query("insert into likerts.responses(workspace_id,id,collection_id,idempotency_key,answers,metadata,accepted_at) values($1,$2,$3,$4,'{}','{}','2020-01-01')")
        .bind(workspace).bind(id).bind(Uuid::parse_str(collection).unwrap()).bind(key).execute(&mut *tx).await.unwrap();
    sqlx::query("insert into likerts.usage_entries(workspace_id,response_id,amount_cents,created_at) values($1,$2,1,'2020-01-01')")
        .bind(workspace).bind(id).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
}

struct TestServer(Child);

impl Drop for TestServer {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn start_server(database_url: &str, port: u16, token: &str, workspace: &str) -> TestServer {
    let tokens =
        serde_json::to_string(&std::collections::HashMap::from([(token, workspace)])).unwrap();
    TestServer(
        Command::new(env!("CARGO_BIN_EXE_likerts-server"))
            .env("DATABASE_URL", database_url)
            .env("LIKERTS_PORT", port.to_string())
            .env("LIKERTS_DEV_TOKENS", tokens)
            .env("LIKERTS_ALLOW_DEV_AUTH", "1")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    )
}

fn start_service_auth_server(database_url: &str, port: u16) -> TestServer {
    TestServer(
        Command::new(env!("CARGO_BIN_EXE_likerts-server"))
            .env("DATABASE_URL", database_url)
            .env("LIKERTS_PORT", port.to_string())
            .env("LIKERTS_OIDC_ISSUER", "https://tenant.example")
            .env("LIKERTS_OIDC_AUDIENCE", "https://api.likerts.test")
            .env(
                "LIKERTS_OIDC_JWKS_URL",
                "https://tenant.example/.well-known/jwks.json",
            )
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    )
}

async fn http_get(port: u16, path: &str, token: Option<&str>) -> Option<(u16, Value)> {
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .ok()?;
    let authorization = token
        .map(|value| format!("Authorization: Bearer {value}\r\n"))
        .unwrap_or_default();
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{authorization}Connection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).await.ok()?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.ok()?;
    let response = String::from_utf8(response).ok()?;
    let (head, body) = response.split_once("\r\n\r\n")?;
    let status = head.split_whitespace().nth(1)?.parse().ok()?;
    Some((status, serde_json::from_str(body).ok()?))
}

async fn wait_for_server(port: u16) {
    for _ in 0..100 {
        if matches!(http_get(port, "/health", None).await, Some((200, _))) {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    panic!("backend did not become healthy");
}

fn question() -> Question {
    serde_json::from_value(json!({
        "id": "satisfaction",
        "label": "How satisfied are you?",
        "type": "scale",
        "required": true,
        "min": 1,
        "max": 5
    }))
    .unwrap()
}

fn submission(key: &str, score: i64) -> Submission {
    let mut answers = Map::new();
    answers.insert("satisfaction".into(), Value::from(score));
    let mut metadata = Map::new();
    metadata.insert("location".into(), Value::from("test-store"));
    Submission {
        idempotency_key: key.into(),
        answers,
        metadata,
    }
}

#[tokio::test]
async fn persists_and_accounts_concurrent_retries_once() {
    let Ok(database_url) = std::env::var("LIKERTS_TEST_DATABASE_URL") else {
        eprintln!("skipping: LIKERTS_TEST_DATABASE_URL is not set");
        return;
    };
    let runtime_database_url = std::env::var("LIKERTS_TEST_RUNTIME_DATABASE_URL")
        .expect("set LIKERTS_TEST_RUNTIME_DATABASE_URL for the restricted role");
    std::env::set_var(
        "LIKERTS_COLLECTION_CREDENTIAL_KEY",
        "bGlrZXJ0cy10ZXN0LWtleS1vbmx5LTMyeCEhISEhISE=",
    );
    let workspace_a = "workspace-a".to_string();
    let workspace_b = "workspace-b".to_string();
    let workspace_c = "workspace-c".to_string();
    let workspaces = [
        workspace_a.clone(),
        workspace_b.clone(),
        workspace_c.clone(),
    ];

    let administrator = PgStore::connect(&database_url).await.unwrap();
    // scripts/check-postgres.sh applies canonical deployment grants before this suite.
    let store = PgStore::connect_runtime(&runtime_database_url)
        .await
        .unwrap();
    store.ensure_workspaces(workspaces.iter()).await.unwrap();

    store
        .grant_membership(&workspace_a, "user_2member_a", Role::Editor)
        .await
        .unwrap();
    assert_eq!(
        store
            .current_membership(&workspace_a, "user_2member_a")
            .await,
        Ok(Role::Editor)
    );
    assert_eq!(
        store
            .current_membership(&workspace_b, "user_2member_a")
            .await,
        Err(Error::Forbidden)
    );
    store
        .revoke_membership(&workspace_a, "user_2member_a")
        .await
        .unwrap();
    assert_eq!(
        store
            .current_membership(&workspace_a, "user_2member_a")
            .await,
        Err(Error::Forbidden)
    );
    store
        .grant_membership(&workspace_a, "user_2oauth", Role::Editor)
        .await
        .unwrap();
    let oauth_grant = store
        .issue_oauth_grant(
            &workspace_a,
            "user_2oauth",
            "codex-client",
            "https://api.likerts.test",
            vec!["surveys:read".into(), "surveys:write".into()],
            Utc::now() + Duration::hours(1),
        )
        .await
        .unwrap();
    let token_scopes = HashSet::from(["surveys:read".into(), "surveys:write".into()]);
    assert_eq!(
        store
            .authorize_oauth(
                &oauth_grant.id,
                "user_2oauth",
                "codex-client",
                "https://api.likerts.test",
                &token_scopes,
                "surveys:write",
                Role::Editor,
            )
            .await,
        Ok(workspace_a.clone())
    );
    assert_eq!(
        store
            .authorize_oauth(
                &oauth_grant.id,
                "user_2oauth",
                "wrong-client",
                "https://api.likerts.test",
                &token_scopes,
                "surveys:read",
                Role::Reader,
            )
            .await,
        Err(Error::Unauthorized)
    );
    assert_eq!(
        store
            .authorize_oauth(
                &oauth_grant.id,
                "user_2oauth",
                "codex-client",
                "https://wrong-audience.example",
                &token_scopes,
                "surveys:read",
                Role::Reader,
            )
            .await,
        Err(Error::Unauthorized)
    );
    let over_scoped_token = HashSet::from(["responses:read".into()]);
    assert_eq!(
        store
            .authorize_oauth(
                &oauth_grant.id,
                "user_2oauth",
                "codex-client",
                "https://api.likerts.test",
                &over_scoped_token,
                "responses:read",
                Role::Reader,
            )
            .await,
        Err(Error::Forbidden)
    );
    assert_eq!(
        store
            .authorize_oauth(
                &oauth_grant.id,
                "user_2oauth",
                "codex-client",
                "https://api.likerts.test",
                &HashSet::new(),
                "surveys:read",
                Role::Reader,
            )
            .await,
        Err(Error::Forbidden)
    );
    let expired_oauth_grant = store
        .issue_oauth_grant(
            &workspace_a,
            "user_2oauth",
            "codex-client",
            "https://api.likerts.test",
            vec!["surveys:read".into()],
            Utc::now() + Duration::hours(1),
        )
        .await
        .unwrap();
    sqlx::query("update likerts.oauth_grants set granted_at=now()-interval '2 seconds',expires_at=now()-interval '1 second' where id=$1")
        .bind(Uuid::parse_str(&expired_oauth_grant.id).unwrap())
        .execute(administrator.pool())
        .await
        .unwrap();
    assert_eq!(
        store
            .authorize_oauth(
                &expired_oauth_grant.id,
                "user_2oauth",
                "codex-client",
                "https://api.likerts.test",
                &HashSet::from(["surveys:read".into()]),
                "surveys:read",
                Role::Reader,
            )
            .await,
        Err(Error::Unauthorized)
    );
    store
        .revoke_membership(&workspace_a, "user_2oauth")
        .await
        .unwrap();
    assert_eq!(
        store
            .authorize_oauth(
                &oauth_grant.id,
                "user_2oauth",
                "codex-client",
                "https://api.likerts.test",
                &token_scopes,
                "surveys:read",
                Role::Reader,
            )
            .await,
        Err(Error::Forbidden)
    );
    store
        .grant_membership(&workspace_a, "user_2oauth", Role::Reader)
        .await
        .unwrap();
    store
        .revoke_oauth_grant(&workspace_a, &oauth_grant.id)
        .await
        .unwrap();
    assert_eq!(
        store
            .authorize_oauth(
                &oauth_grant.id,
                "user_2oauth",
                "codex-client",
                "https://api.likerts.test",
                &token_scopes,
                "surveys:read",
                Role::Reader,
            )
            .await,
        Err(Error::Unauthorized)
    );
    let (service_credential, service_token) = store
        .issue_service_credential(
            &workspace_a,
            "automation",
            vec!["surveys:read".into()],
            Utc::now() + Duration::days(30),
        )
        .await
        .unwrap();
    for table in [
        "workspace_memberships",
        "service_credentials",
        "oauth_grants",
        "collection_rate_windows",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("select count(*) from likerts.{table}"))
            .fetch_one(store.pool())
            .await
            .unwrap();
        assert_eq!(count, 0, "unscoped identity read exposed {table}");
    }
    assert_eq!(
        store
            .authenticate_service(&service_token, "surveys:read")
            .await,
        Ok(workspace_a.clone())
    );
    assert_eq!(
        store
            .authenticate_service(&service_token, "responses:read")
            .await,
        Err(Error::Forbidden)
    );
    assert_eq!(
        store
            .authenticate_service("lks_wrong", "surveys:read")
            .await,
        Err(Error::Unauthorized)
    );
    let (expired_service, expired_service_token) = store
        .issue_service_credential(
            &workspace_a,
            "expires-immediately",
            vec!["surveys:read".into()],
            Utc::now() + Duration::days(1),
        )
        .await
        .unwrap();
    sqlx::query(
        "update likerts.service_credentials set created_at=now()-interval '2 seconds',expires_at=now()-interval '1 second' where id=$1",
    )
    .bind(Uuid::parse_str(&expired_service.id).unwrap())
    .execute(administrator.pool())
    .await
    .unwrap();
    assert_eq!(
        store
            .authenticate_service(&expired_service_token, "surveys:read")
            .await,
        Err(Error::Unauthorized)
    );
    store
        .revoke_service_credential(&workspace_a, &service_credential.id)
        .await
        .unwrap();
    assert_eq!(
        store
            .authenticate_service(&service_token, "surveys:read")
            .await,
        Err(Error::Unauthorized)
    );
    let (runtime_credential, runtime_token) = store
        .issue_service_credential(
            &workspace_a,
            "runtime-auth-test",
            vec!["surveys:read".into()],
            Utc::now() + Duration::days(30),
        )
        .await
        .unwrap();
    let (_identity_credential, identity_token) = store
        .issue_service_credential(
            &workspace_a,
            "identity-admin-test",
            vec!["identity:write".into()],
            Utc::now() + Duration::days(30),
        )
        .await
        .unwrap();
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let auth_port = listener.local_addr().unwrap().port();
    drop(listener);
    let auth_server = start_service_auth_server(&runtime_database_url, auth_port);
    wait_for_server(auth_port).await;
    let client = reqwest::Client::new();
    let memberships_response = client
        .put(format!("http://127.0.0.1:{auth_port}/v1/memberships"))
        .bearer_auth(&identity_token)
        .json(&json!({"subject":"user_2api_member","role":"reader"}))
        .send()
        .await
        .unwrap();
    assert_eq!(memberships_response.status(), 204);
    let memberships: Value = client
        .get(format!("http://127.0.0.1:{auth_port}/v1/memberships"))
        .bearer_auth(&identity_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(memberships
        .as_array()
        .unwrap()
        .iter()
        .any(|membership| membership["subject"] == "user_2api_member"));
    let issued: Value = client
        .post(format!(
            "http://127.0.0.1:{auth_port}/v1/service-credentials"
        ))
        .bearer_auth(&identity_token)
        .json(&json!({"name":"api-issued","scopes":["usage:read"],"expiresAt":(Utc::now()+Duration::days(1)).to_rfc3339()}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(issued["token"].as_str().unwrap().starts_with("lks_"));
    assert_eq!(
        http_get(auth_port, "/v1/usage", issued["token"].as_str())
            .await
            .unwrap()
            .0,
        200
    );
    assert_eq!(
        client
            .delete(format!(
                "http://127.0.0.1:{auth_port}/v1/service-credentials/{}",
                issued["credential"]["id"].as_str().unwrap()
            ))
            .bearer_auth(&identity_token)
            .send()
            .await
            .unwrap()
            .status(),
        204
    );
    assert_eq!(
        http_get(auth_port, "/v1/usage", issued["token"].as_str())
            .await
            .unwrap()
            .0,
        401
    );
    let grant: Value = client
        .post(format!("http://127.0.0.1:{auth_port}/v1/oauth-grants"))
        .bearer_auth(&identity_token)
        .json(&json!({"subject":"user_2api_member","clientId":"codex-client","scopes":["surveys:read"],"expiresAt":(Utc::now()+Duration::hours(1)).to_rfc3339()}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(grant["audience"], "https://api.likerts.test");
    assert_eq!(
        client
            .delete(format!(
                "http://127.0.0.1:{auth_port}/v1/oauth-grants/{}",
                grant["id"].as_str().unwrap()
            ))
            .bearer_auth(&identity_token)
            .send()
            .await
            .unwrap()
            .status(),
        204
    );
    assert_eq!(
        client
            .post(format!(
                "http://127.0.0.1:{auth_port}/v1/memberships/revoke"
            ))
            .bearer_auth(&identity_token)
            .json(&json!({"subject":"user_2api_member"}))
            .send()
            .await
            .unwrap()
            .status(),
        204
    );
    let memberships_after_revoke: Value = client
        .get(format!("http://127.0.0.1:{auth_port}/v1/memberships"))
        .bearer_auth(&identity_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(!memberships_after_revoke
        .as_array()
        .unwrap()
        .iter()
        .any(|membership| membership["subject"] == "user_2api_member"));
    assert_eq!(
        http_get(auth_port, "/v1/surveys", Some(&runtime_token))
            .await
            .unwrap()
            .0,
        200
    );
    assert_eq!(
        http_get(auth_port, "/v1/responses", Some(&runtime_token))
            .await
            .unwrap()
            .0,
        403
    );
    store
        .revoke_service_credential(&workspace_a, &runtime_credential.id)
        .await
        .unwrap();
    assert_eq!(
        http_get(auth_port, "/v1/surveys", Some(&runtime_token))
            .await
            .unwrap()
            .0,
        401
    );
    drop(auth_server);

    let mut audit_tx = store.pool().begin().await.unwrap();
    sqlx::query("select set_config('likerts.workspace_id',$1,true)")
        .bind(&workspace_a)
        .execute(&mut *audit_tx)
        .await
        .unwrap();
    let audit_rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "select action,resource_type,resource_id from likerts.audit_events where workspace_id=$1 order by id",
    )
    .bind(&workspace_a)
    .fetch_all(&mut *audit_tx)
    .await
    .unwrap();
    assert!(audit_rows
        .iter()
        .any(|(action, _, _)| action == "workspace_memberships.insert"));
    assert!(audit_rows
        .iter()
        .any(|(action, _, _)| action == "service_credentials.update"));
    let audit_text = serde_json::to_string(&audit_rows).unwrap();
    assert!(!audit_text.contains(&service_token));
    assert!(!audit_text.contains(&runtime_token));
    assert!(
        sqlx::query("update likerts.audit_events set outcome='failed' where workspace_id=$1")
            .bind(&workspace_a)
            .execute(&mut *audit_tx)
            .await
            .is_err()
    );
    audit_tx.rollback().await.unwrap();

    let unscoped_rows: i64 = sqlx::query_scalar("select count(*) from likerts.workspaces")
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert_eq!(unscoped_rows, 0);

    let mut connection = store.pool().acquire().await.unwrap();
    let mut scoped = connection.begin().await.unwrap();
    sqlx::query("select set_config('likerts.workspace_id',$1,true)")
        .bind(&workspace_a)
        .execute(&mut *scoped)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("select count(*) from likerts.workspaces")
            .fetch_one(&mut *scoped)
            .await
            .unwrap(),
        1
    );
    scoped.commit().await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("select count(*) from likerts.workspaces")
            .fetch_one(&mut *connection)
            .await
            .unwrap(),
        0
    );
    let mut wrong_tenant = connection.begin().await.unwrap();
    sqlx::query("select set_config('likerts.workspace_id',$1,true)")
        .bind(&workspace_a)
        .execute(&mut *wrong_tenant)
        .await
        .unwrap();
    let cross_tenant_insert = sqlx::query("insert into likerts.surveys(workspace_id,id,revision,title,questions) values ($1,gen_random_uuid(),1,'blocked','[]')")
        .bind(&workspace_b)
        .execute(&mut *wrong_tenant)
        .await;
    assert!(cross_tenant_insert.is_err());
    drop(wrong_tenant);
    drop(connection);
    let survey = store
        .create_survey(
            &workspace_a,
            DraftInput {
                title: "Store visit".into(),
                questions: vec![question()],
                pages: None,
            },
        )
        .await
        .unwrap();
    let idempotent_input = DraftInput {
        title: "Idempotent survey".into(),
        questions: vec![question()],
        pages: None,
    };
    let mut survey_create_tasks = Vec::new();
    for _ in 0..8 {
        let store = store.clone();
        let input = idempotent_input.clone();
        let workspace = workspace_a.clone();
        survey_create_tasks.push(tokio::spawn(async move {
            store
                .create_survey_idempotent(&workspace, "survey-create-once", input)
                .await
        }));
    }
    let mut created_survey_ids = HashSet::new();
    for task in survey_create_tasks {
        created_survey_ids.insert(task.await.unwrap().unwrap().id);
    }
    assert_eq!(created_survey_ids.len(), 1);
    let idempotent_survey_id = created_survey_ids.iter().next().unwrap().clone();
    let mut changed_input = idempotent_input;
    changed_input.title = "Changed payload".into();
    assert!(matches!(
        store
            .create_survey_idempotent(&workspace_a, "survey-create-once", changed_input)
            .await,
        Err(Error::Conflict)
    ));
    let version = store
        .publish(&workspace_a, &survey.id, survey.revision)
        .await
        .unwrap();
    let branching_workspace = "workspace-q2".to_string();
    store
        .ensure_workspaces(std::iter::once(&branching_workspace))
        .await
        .unwrap();
    let branching_input: DraftInput = serde_json::from_str(include_str!(
        "../../contracts/branching-survey.example.json"
    ))
    .unwrap();
    let branching_survey = store
        .create_survey(&branching_workspace, branching_input.clone())
        .await
        .unwrap();
    let branching_version = store
        .publish(
            &branching_workspace,
            &branching_survey.id,
            branching_survey.revision,
        )
        .await
        .unwrap();
    assert_eq!(branching_version.pages.as_ref().unwrap().len(), 4);
    let branching_collection = store
        .create_collection(
            &branching_workspace,
            &branching_survey.id,
            branching_version.version,
            "branching",
        )
        .await
        .unwrap();
    let branching_submission = Submission {
        idempotency_key: "branching-route".into(),
        answers: json!({
            "return":"no",
            "highlight":"must be discarded",
            "problem":"Long wait",
            "followUp":"yes"
        })
        .as_object()
        .unwrap()
        .clone(),
        metadata: Map::new(),
    };
    store
        .submit(
            &branching_collection.id,
            &branching_collection.token,
            branching_submission,
        )
        .await
        .unwrap();
    let branching_responses = store
        .responses(
            &branching_workspace,
            ResponseListInput {
                collection_id: Some(branching_collection.id.clone()),
                limit: Some(10),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(branching_responses.items.len(), 1);
    assert_eq!(
        branching_responses.items[0].answers,
        json!({"return":"no","problem":"Long wait","followUp":"yes"})
            .as_object()
            .unwrap()
            .clone()
    );
    let mut changed_branching = branching_input;
    changed_branching.pages.as_mut().unwrap()[0].title = Some("Changed draft".into());
    store
        .update(
            &branching_workspace,
            &branching_survey.id,
            branching_survey.revision,
            changed_branching,
        )
        .await
        .unwrap();
    let (_, frozen_branching) = store
        .collection_schema(&branching_collection.id, &branching_collection.token)
        .await
        .unwrap();
    assert_eq!(
        frozen_branching.pages.as_ref().unwrap()[0].title.as_deref(),
        Some("Your visit")
    );
    let mixed_capabilities = SdkCapabilities {
        installations: vec![
            SdkInstallationCapability {
                target: SdkTarget::Ios,
                sdk_version: "legacy".into(),
                schema_versions: vec![1],
            },
            SdkInstallationCapability {
                target: SdkTarget::Ios,
                sdk_version: "0.0.1".into(),
                schema_versions: vec![1, 2],
            },
        ],
    };
    let compatible_baseline = store
        .create_collection_compatible(
            &workspace_a,
            &survey.id,
            version.version,
            "mixed-fleet",
            CollectionLimits::default(),
            mixed_capabilities.clone(),
        )
        .await
        .unwrap();
    assert_eq!(
        store
            .collection_schema(&compatible_baseline.id, &compatible_baseline.token)
            .await
            .unwrap()
            .0
            .sdk_capabilities,
        mixed_capabilities
    );
    let expanded_survey = store.create_survey(&workspace_a, serde_json::from_value(json!({"title":"Expanded compatibility","questions":[{"id":"nps","label":"Recommend?","type":"scale","required":true,"min":0,"max":10,"preset":"nps"}]})).unwrap()).await.unwrap();
    assert!(matches!(
        store
            .publish_compatible(
                &workspace_a,
                &expanded_survey.id,
                1,
                mixed_capabilities.clone()
            )
            .await,
        Err(Error::Invalid(_))
    ));
    let expanded_version = store
        .publish_compatible(
            &workspace_a,
            &expanded_survey.id,
            1,
            SdkCapabilities::current_all(),
        )
        .await
        .unwrap();
    assert!(matches!(
        store
            .create_collection_compatible(
                &workspace_a,
                &expanded_survey.id,
                expanded_version.version,
                "blocked-mixed",
                CollectionLimits::default(),
                mixed_capabilities
            )
            .await,
        Err(Error::Invalid(_))
    ));
    let collection = store
        .create_collection(&workspace_a, &survey.id, version.version, "receipt")
        .await
        .unwrap();
    let security_collection = store
        .create_collection(
            &workspace_a,
            &survey.id,
            version.version,
            "security-controls",
        )
        .await
        .unwrap();
    store
        .set_collection_security(
            &workspace_a,
            &security_collection.id,
            CollectionSecurityInput {
                allowed_origins: vec!["https://survey.customer.example".into()],
                requests_per_minute: 2,
            },
        )
        .await
        .unwrap();
    assert!(store
        .collection_origin_allowed(&security_collection.id, "https://survey.customer.example")
        .await
        .unwrap());
    assert!(!store
        .collection_origin_allowed(&security_collection.id, "https://evil.example")
        .await
        .unwrap());
    store
        .consume_collection_rate(&security_collection.id, &security_collection.token)
        .await
        .unwrap();
    store
        .consume_collection_rate(&security_collection.id, &security_collection.token)
        .await
        .unwrap();
    assert_eq!(
        store
            .consume_collection_rate(&security_collection.id, &security_collection.token)
            .await,
        Err(Error::RateLimited)
    );
    let mut collection_create_tasks = Vec::new();
    for _ in 0..8 {
        let store = store.clone();
        let workspace = workspace_a.clone();
        let survey_id = survey.id.clone();
        collection_create_tasks.push(tokio::spawn(async move {
            store
                .create_collection_idempotent(
                    &workspace,
                    "collection-create-once",
                    &survey_id,
                    version.version,
                    "idempotent",
                    CollectionLimits::default(),
                )
                .await
        }));
    }
    let mut created_collections = HashSet::new();
    let mut created_tokens = HashSet::new();
    for task in collection_create_tasks {
        let created = task.await.unwrap().unwrap();
        created_collections.insert(created.id);
        created_tokens.insert(created.token);
    }
    assert_eq!(created_collections.len(), 1);
    assert_eq!(created_tokens.len(), 1);
    let idempotent_collection_id = created_collections.iter().next().unwrap().clone();
    let idempotent_collection_token = created_tokens.iter().next().unwrap().clone();
    let mut retry_record_tx = store.pool().begin().await.unwrap();
    sqlx::query("select set_config('likerts.workspace_id',$1,true)")
        .bind(&workspace_a)
        .execute(&mut *retry_record_tx)
        .await
        .unwrap();
    let retry_record: String = sqlx::query_scalar(
        "select response::text from likerts.management_requests where workspace_id=$1 and operation='collections_create' and idempotency_key='collection-create-once'",
    )
    .bind(&workspace_a)
    .fetch_one(&mut *retry_record_tx)
    .await
    .unwrap();
    assert!(!retry_record.contains("token"));
    assert!(!retry_record.contains(&idempotent_collection_token));
    retry_record_tx.rollback().await.unwrap();
    assert!(matches!(
        store
            .create_collection_idempotent(
                &workspace_a,
                "collection-create-once",
                &survey.id,
                version.version,
                "changed",
                CollectionLimits::default(),
            )
            .await,
        Err(Error::Conflict)
    ));

    assert_eq!(store.surveys(&workspace_b).await.unwrap().len(), 0);
    assert_eq!(
        store
            .set_accepting(&workspace_b, &collection.id, false)
            .await,
        Err(Error::NotFound)
    );
    assert!(matches!(
        store.collection_schema(&collection.id, "wrong-token").await,
        Err(Error::Unauthorized)
    ));
    assert_eq!(
        store
            .collection_schema(&collection.id, &collection.token)
            .await
            .unwrap()
            .0
            .id,
        collection.id
    );

    sqlx::raw_sql(
        "create function likerts.fail_usage_test() returns trigger language plpgsql as $$ begin raise exception 'injected usage failure'; end $$;
         create trigger fail_usage_test before insert on likerts.usage_entries for each row execute function likerts.fail_usage_test();",
    )
    .execute(administrator.pool())
    .await
    .unwrap();
    assert!(matches!(
        store
            .submit(
                &collection.id,
                &collection.token,
                submission("rollback-request", 5),
            )
            .await,
        Err(Error::Internal)
    ));
    let partial_responses: i64 = sqlx::query_scalar(
        "select count(*) from likerts.responses where idempotency_key='rollback-request'",
    )
    .fetch_one(administrator.pool())
    .await
    .unwrap();
    assert_eq!(partial_responses, 0);
    sqlx::raw_sql(
        "drop trigger fail_usage_test on likerts.usage_entries;
         drop function likerts.fail_usage_test();",
    )
    .execute(administrator.pool())
    .await
    .unwrap();

    let mut tasks = Vec::new();
    for _ in 0..16 {
        let store = store.clone();
        let collection_id = collection.id.clone();
        let token = collection.token.clone();
        tasks.push(tokio::spawn(async move {
            store
                .submit(&collection_id, &token, submission("same-request", 5))
                .await
        }));
    }
    let mut response_ids = HashSet::new();
    for task in tasks {
        let result = task.await.unwrap();
        assert!(result.is_ok(), "concurrent submission failed: {result:?}");
        response_ids.insert(result.unwrap().response_id);
    }
    assert_eq!(response_ids.len(), 1);
    assert_eq!(store.usage(&workspace_a).await.unwrap(), 1);
    assert_eq!(
        store
            .responses(&workspace_a, ResponseListInput::default())
            .await
            .unwrap()
            .items
            .len(),
        1
    );
    store
        .set_collection_security(
            &workspace_a,
            &collection.id,
            CollectionSecurityInput {
                allowed_origins: vec![],
                requests_per_minute: 1,
            },
        )
        .await
        .unwrap();
    store
        .consume_collection_rate(&collection.id, &collection.token)
        .await
        .unwrap();
    assert_eq!(
        store
            .consume_collection_rate(&collection.id, &collection.token)
            .await,
        Err(Error::RateLimited)
    );
    let retried_after_limit = store
        .lookup_receipt(
            &collection.id,
            &collection.token,
            &submission("same-request", 5),
        )
        .await
        .unwrap()
        .unwrap();
    assert!(response_ids.contains(&retried_after_limit.response_id));

    assert!(matches!(
        store
            .submit(
                &collection.id,
                &collection.token,
                submission("same-request", 4),
            )
            .await,
        Err(Error::Conflict)
    ));
    store
        .set_accepting(&workspace_a, &collection.id, false)
        .await
        .unwrap();
    let prior = store
        .submit(
            &collection.id,
            &collection.token,
            submission("same-request", 5),
        )
        .await
        .unwrap();
    assert_eq!(prior.response_id, response_ids.into_iter().next().unwrap());
    assert!(matches!(
        store
            .submit(
                &collection.id,
                &collection.token,
                submission("new-request", 5),
            )
            .await,
        Err(Error::Closed)
    ));

    store.pool().close().await;
    let restarted = PgStore::connect_runtime(&runtime_database_url)
        .await
        .unwrap();
    assert_eq!(
        restarted
            .create_survey_idempotent(
                &workspace_a,
                "survey-create-once",
                DraftInput {
                    title: "Idempotent survey".into(),
                    questions: vec![question()],
                    pages: None,
                },
            )
            .await
            .unwrap()
            .id,
        idempotent_survey_id
    );
    let retried_collection = restarted
        .create_collection_idempotent(
            &workspace_a,
            "collection-create-once",
            &survey.id,
            version.version,
            "idempotent",
            CollectionLimits::default(),
        )
        .await
        .unwrap();
    assert_eq!(retried_collection.id, idempotent_collection_id);
    assert_eq!(retried_collection.token, idempotent_collection_token);
    let unscoped_management_requests: i64 =
        sqlx::query_scalar("select count(*) from likerts.management_requests")
            .fetch_one(restarted.pool())
            .await
            .unwrap();
    assert_eq!(unscoped_management_requests, 0);
    assert_eq!(restarted.surveys(&workspace_a).await.unwrap().len(), 3);
    assert_eq!(
        restarted
            .responses(&workspace_a, ResponseListInput::default())
            .await
            .unwrap()
            .items
            .len(),
        1
    );
    assert_eq!(restarted.usage(&workspace_a).await.unwrap(), 1);
    let after_lost_acknowledgement = restarted
        .submit(
            &collection.id,
            &collection.token,
            submission("same-request", 5),
        )
        .await
        .unwrap();
    assert_eq!(after_lost_acknowledgement.response_id, prior.response_id);
    assert_eq!(restarted.usage(&workspace_a).await.unwrap(), 1);

    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let management_token = "restart-test-management-token";
    let server = start_server(&runtime_database_url, port, management_token, &workspace_a);
    wait_for_server(port).await;
    let (status, usage_before_restart) = http_get(port, "/v1/usage", Some(management_token))
        .await
        .unwrap();
    assert_eq!(status, 200);
    assert_eq!(usage_before_restart["chargedCents"], 1);
    drop(server);

    let server = start_server(&runtime_database_url, port, management_token, &workspace_a);
    wait_for_server(port).await;
    let (status, usage_after_restart) = http_get(port, "/v1/usage", Some(management_token))
        .await
        .unwrap();
    assert_eq!(status, 200);
    assert_eq!(usage_after_restart, usage_before_restart);
    drop(server);

    let unmatched_responses: i64 = sqlx::query_scalar(
        "select count(*) from likerts.responses r left join likerts.usage_entries u on (u.workspace_id,u.response_id)=(r.workspace_id,r.id) where u.response_id is null",
    )
    .fetch_one(administrator.pool())
    .await
    .unwrap();
    let unmatched_usage: i64 = sqlx::query_scalar(
        "select count(*) from likerts.usage_entries u left join likerts.responses r on (r.workspace_id,r.id)=(u.workspace_id,u.response_id) where r.id is null",
    )
    .fetch_one(administrator.pool())
    .await
    .unwrap();
    assert_eq!((unmatched_responses, unmatched_usage), (0, 0));

    let capped = restarted
        .create_collection_with_limits(
            &workspace_a,
            &survey.id,
            version.version,
            "one-response-cap",
            CollectionLimits {
                expires_at: None,
                response_cap: Some(1),
            },
        )
        .await
        .unwrap();
    for invalid_limits in [
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
            restarted
                .create_collection_with_limits(
                    &workspace_a,
                    &survey.id,
                    version.version,
                    "invalid-limits",
                    invalid_limits,
                )
                .await,
            Err(Error::Invalid(_))
        ));
    }
    let mut capped_tasks = Vec::new();
    for attempt in 0..16 {
        let store = restarted.clone();
        let id = capped.id.clone();
        let token = capped.token.clone();
        capped_tasks.push(tokio::spawn(async move {
            (
                attempt,
                store
                    .submit(&id, &token, submission(&format!("cap-{attempt}"), 5))
                    .await,
            )
        }));
    }
    let mut accepted = 0;
    let mut accepted_attempt = None;
    for task in capped_tasks {
        let (attempt, result) = task.await.unwrap();
        match result {
            Ok(_) => {
                accepted += 1;
                accepted_attempt = Some(attempt);
            }
            Err(Error::Capacity) => {}
            other => panic!("unexpected capped result: {other:?}"),
        }
    }
    assert_eq!(accepted, 1);
    assert_eq!(restarted.usage(&workspace_a).await.unwrap(), 2);
    restarted
        .revoke_collection(&workspace_a, &capped.id)
        .await
        .unwrap();
    assert!(matches!(
        restarted.collection_schema(&capped.id, &capped.token).await,
        Err(Error::Revoked)
    ));
    assert!(matches!(
        restarted
            .submit(
                &capped.id,
                &capped.token,
                submission(&format!("cap-{}", accepted_attempt.unwrap()), 5),
            )
            .await,
        Err(Error::Revoked)
    ));
    assert_eq!(
        restarted
            .set_accepting(&workspace_a, &capped.id, true)
            .await,
        Err(Error::Revoked)
    );

    let expiring = restarted
        .create_collection_with_limits(
            &workspace_a,
            &survey.id,
            version.version,
            "short-expiry",
            CollectionLimits {
                expires_at: Some(Utc::now() + Duration::seconds(1)),
                response_cap: None,
            },
        )
        .await
        .unwrap();
    let expiring_receipt = restarted
        .submit(
            &expiring.id,
            &expiring.token,
            submission("before-expiry", 5),
        )
        .await
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    assert_eq!(
        restarted
            .submit(
                &expiring.id,
                &expiring.token,
                submission("before-expiry", 5),
            )
            .await
            .unwrap()
            .response_id,
        expiring_receipt.response_id
    );
    assert!(matches!(
        restarted
            .submit(&expiring.id, &expiring.token, submission("after-expiry", 5),)
            .await,
        Err(Error::Expired)
    ));
    assert_eq!(
        restarted
            .set_accepting(&workspace_a, &expiring.id, true)
            .await,
        Err(Error::Expired)
    );
    assert_eq!(restarted.usage(&workspace_a).await.unwrap(), 3);

    let closing = restarted
        .create_collection(&workspace_a, &survey.id, version.version, "closure-race")
        .await
        .unwrap();
    let submit_store = restarted.clone();
    let closing_id = closing.id.clone();
    let closing_token = closing.token.clone();
    let submit_task = tokio::spawn(async move {
        submit_store
            .submit(&closing_id, &closing_token, submission("closure-race", 5))
            .await
    });
    let close_store = restarted.clone();
    let close_id = closing.id.clone();
    let close_workspace = workspace_a.clone();
    let close_task = tokio::spawn(async move {
        close_store
            .set_accepting(&close_workspace, &close_id, false)
            .await
    });
    let raced_submission = submit_task.await.unwrap();
    close_task.await.unwrap().unwrap();
    let retry = restarted
        .submit(&closing.id, &closing.token, submission("closure-race", 5))
        .await;
    match raced_submission {
        Ok(receipt) => assert_eq!(retry.unwrap().response_id, receipt.response_id),
        Err(Error::Closed) => assert_eq!(retry.unwrap_err(), Error::Closed),
        other => panic!("unexpected closure race result: {other:?}"),
    }
    assert!(matches!(
        restarted
            .submit(
                &closing.id,
                &closing.token,
                submission("closure-race-new", 5),
            )
            .await,
        Err(Error::Closed)
    ));

    let paged = restarted
        .create_collection(&workspace_a, &survey.id, version.version, "pagination")
        .await
        .unwrap();
    let mut snapshot_ids = HashSet::new();
    for attempt in 0..5 {
        snapshot_ids.insert(
            restarted
                .submit(
                    &paged.id,
                    &paged.token,
                    submission(&format!("page-initial-{attempt}"), 5),
                )
                .await
                .unwrap()
                .response_id,
        );
    }
    let first_page = restarted
        .responses(
            &workspace_a,
            ResponseListInput {
                limit: Some(2),
                collection_id: Some(paged.id.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(first_page.items.len(), 2);
    assert!(first_page.next_cursor.is_some());

    let mut later_tasks = Vec::new();
    for attempt in 0..4 {
        let store = restarted.clone();
        let id = paged.id.clone();
        let token = paged.token.clone();
        later_tasks.push(tokio::spawn(async move {
            store
                .submit(&id, &token, submission(&format!("page-later-{attempt}"), 5))
                .await
        }));
    }
    for task in later_tasks {
        task.await.unwrap().unwrap();
    }

    let mut traversed_ids: Vec<String> = first_page
        .items
        .iter()
        .map(|response| response.receipt.response_id.clone())
        .collect();
    let original_cursor = first_page.next_cursor.clone().unwrap();
    let repeated = restarted
        .responses(
            &workspace_a,
            ResponseListInput {
                cursor: Some(original_cursor.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let mut cursor = Some(original_cursor);
    while let Some(value) = cursor {
        let page = restarted
            .responses(
                &workspace_a,
                ResponseListInput {
                    cursor: Some(value),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        traversed_ids.extend(
            page.items
                .iter()
                .map(|response| response.receipt.response_id.clone()),
        );
        cursor = page.next_cursor;
    }
    assert_eq!(traversed_ids.len(), 5);
    assert_eq!(
        traversed_ids.iter().cloned().collect::<HashSet<_>>(),
        snapshot_ids
    );
    assert_eq!(
        repeated
            .items
            .iter()
            .map(|response| &response.receipt.response_id)
            .collect::<Vec<_>>(),
        traversed_ids[2..4].iter().collect::<Vec<_>>()
    );
    let fresh_page = restarted
        .responses(
            &workspace_a,
            ResponseListInput {
                collection_id: Some(paged.id.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(fresh_page.items.len(), 9);
    let cutoff = fresh_page.items[4].accepted_at;
    let from_page = restarted
        .responses(
            &workspace_a,
            ResponseListInput {
                collection_id: Some(paged.id.clone()),
                accepted_from: Some(cutoff),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(
        !from_page.items.is_empty()
            && from_page
                .items
                .iter()
                .all(|response| response.accepted_at >= cutoff)
    );
    let to_page = restarted
        .responses(
            &workspace_a,
            ResponseListInput {
                collection_id: Some(paged.id.clone()),
                accepted_to: Some(cutoff),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(to_page
        .items
        .iter()
        .all(|response| response.accepted_at < cutoff));
    assert!(matches!(
        restarted
            .responses(
                &workspace_a,
                ResponseListInput {
                    accepted_from: Some(cutoff),
                    accepted_to: Some(cutoff),
                    ..Default::default()
                },
            )
            .await,
        Err(Error::Invalid(_))
    ));
    assert!(restarted
        .responses(
            &workspace_b,
            ResponseListInput {
                collection_id: Some(paged.id.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap()
        .items
        .is_empty());
    assert!(matches!(
        restarted
            .responses(
                &workspace_a,
                ResponseListInput {
                    cursor: first_page.next_cursor,
                    collection_id: Some(collection.id.clone()),
                    ..Default::default()
                },
            )
            .await,
        Err(Error::Invalid(_))
    ));

    let export_collection = restarted
        .create_collection(&workspace_a, &survey.id, version.version, "export-snapshot")
        .await
        .unwrap();
    for attempt in 0..3 {
        restarted
            .submit(
                &export_collection.id,
                &export_collection.token,
                submission(&format!("export-before-{attempt}"), 5),
            )
            .await
            .unwrap();
    }
    let export_input = ExportInput {
        idempotency_key: "durable-export".into(),
        format: ExportFormat::Csv,
        collection_id: Some(export_collection.id.clone()),
        accepted_from: None,
        accepted_to: None,
    };
    let export_job = restarted
        .create_export(&workspace_a, export_input.clone())
        .await
        .unwrap();
    assert!(matches!(
        restarted
            .create_export(
                &workspace_a,
                ExportInput {
                    idempotency_key: "second-active-export".into(),
                    format: ExportFormat::Json,
                    collection_id: None,
                    accepted_from: None,
                    accepted_to: None
                }
            )
            .await,
        Err(Error::Capacity)
    ));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("select count(*) from likerts.export_jobs")
            .fetch_one(restarted.pool())
            .await
            .unwrap(),
        0
    );
    assert!(matches!(
        restarted
            .create_export(
                &workspace_a,
                ExportInput {
                    format: ExportFormat::Json,
                    ..export_input.clone()
                }
            )
            .await,
        Err(Error::Conflict)
    ));
    for attempt in 0..2 {
        restarted
            .submit(
                &export_collection.id,
                &export_collection.token,
                submission(&format!("export-after-{attempt}"), 5),
            )
            .await
            .unwrap();
    }
    let export_lease = restarted
        .claim_export(&workspace_a, &export_job.id)
        .await
        .unwrap()
        .unwrap();
    assert!(restarted
        .claim_export(&workspace_a, &export_job.id)
        .await
        .unwrap()
        .is_none());
    let export_snapshot = restarted
        .export_snapshot(&workspace_a, &export_job.id, &export_lease)
        .await
        .unwrap();
    assert_eq!(export_snapshot.responses.len(), 3);
    assert_eq!(export_snapshot.manifest.response_count, 3);
    assert_eq!(export_snapshot.manifest.schemas.len(), 1);
    let bytes = render(&export_snapshot).unwrap();
    let digest = sha256_hex(&bytes);
    restarted
        .complete_export(
            &workspace_a,
            &export_job.id,
            &export_lease,
            "durable-export.csv",
            &digest,
            &export_snapshot.manifest,
        )
        .await
        .unwrap();
    let ready = restarted
        .export_job(&workspace_a, &export_job.id)
        .await
        .unwrap();
    assert_eq!(ready.status, ExportStatus::Ready);
    assert_eq!(ready.content_sha256.as_deref(), Some(digest.as_str()));
    assert!(matches!(
        restarted.export_job(&workspace_b, &export_job.id).await,
        Err(Error::NotFound)
    ));
    assert_eq!(
        restarted
            .revoke_export(&workspace_a, &export_job.id)
            .await
            .unwrap()
            .as_deref(),
        Some("durable-export.csv")
    );
    assert!(matches!(
        restarted
            .export_object_key(&workspace_a, &export_job.id)
            .await,
        Err(Error::ExportRevoked)
    ));

    let failed_input = ExportInput {
        idempotency_key: "failed-export".into(),
        format: ExportFormat::Json,
        collection_id: None,
        accepted_from: None,
        accepted_to: None,
    };
    let failed = restarted
        .create_export(&workspace_a, failed_input.clone())
        .await
        .unwrap();
    let failed_lease = restarted
        .claim_export(&workspace_a, &failed.id)
        .await
        .unwrap()
        .unwrap();
    restarted
        .fail_export(&workspace_a, &failed.id, &failed_lease, "injected_failure")
        .await
        .unwrap();
    assert_eq!(
        restarted
            .export_job(&workspace_a, &failed.id)
            .await
            .unwrap()
            .status,
        ExportStatus::Failed
    );
    let retried = restarted
        .create_export(&workspace_a, failed_input)
        .await
        .unwrap();
    assert_eq!(retried.id, failed.id);
    assert_eq!(retried.status, ExportStatus::Queued);
    let failed_lease = restarted
        .claim_export(&workspace_a, &failed.id)
        .await
        .unwrap()
        .unwrap();
    let snapshot = restarted
        .export_snapshot(&workspace_a, &failed.id, &failed_lease)
        .await
        .unwrap();
    let bytes = render(&snapshot).unwrap();
    restarted
        .complete_export(
            &workspace_a,
            &failed.id,
            &failed_lease,
            "failed-retried.json",
            &sha256_hex(&bytes),
            &snapshot.manifest,
        )
        .await
        .unwrap();
    assert_eq!(
        restarted
            .export_job(&workspace_a, &failed.id)
            .await
            .unwrap()
            .status,
        ExportStatus::Ready
    );

    sqlx::query("update likerts.export_jobs set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1")
        .bind(Uuid::parse_str(&failed.id).unwrap()).execute(administrator.pool()).await.unwrap();
    assert!(matches!(
        restarted.export_job(&workspace_a, &failed.id).await,
        Err(Error::ExportExpired)
    ));

    let capacity_survey = restarted
        .create_survey(
            &workspace_c,
            DraftInput {
                title: "Capacity".into(),
                questions: vec![question()],
                pages: None,
            },
        )
        .await
        .unwrap();
    let capacity_version = restarted
        .publish(&workspace_c, &capacity_survey.id, capacity_survey.revision)
        .await
        .unwrap();
    let mut active_collections = Vec::new();
    for attempt in 0..99 {
        active_collections.push(
            restarted
                .create_collection(
                    &workspace_c,
                    &capacity_survey.id,
                    capacity_version.version,
                    &format!("capacity-{attempt}"),
                )
                .await
                .unwrap(),
        );
    }
    let mut create_tasks = Vec::new();
    for attempt in 99..101 {
        let store = restarted.clone();
        let workspace = workspace_c.clone();
        let survey_id = capacity_survey.id.clone();
        create_tasks.push(tokio::spawn(async move {
            store
                .create_collection(
                    &workspace,
                    &survey_id,
                    capacity_version.version,
                    &format!("capacity-{attempt}"),
                )
                .await
        }));
    }
    let mut created = 0;
    for task in create_tasks {
        match task.await.unwrap() {
            Ok(_) => created += 1,
            Err(Error::Capacity) => {}
            other => panic!("unexpected active-cap result: {other:?}"),
        }
    }
    assert_eq!(created, 1);
    let active_count: i64 = sqlx::query_scalar(
        "select count(*) from likerts.collections where workspace_id=$1 and accepting and revoked_at is null and (expires_at is null or expires_at > now())",
    )
    .bind(&workspace_c)
    .fetch_one(administrator.pool())
    .await
    .unwrap();
    assert_eq!(active_count, 100);
    restarted
        .set_accepting(&workspace_c, &active_collections[0].id, false)
        .await
        .unwrap();
    restarted
        .create_collection(
            &workspace_c,
            &capacity_survey.id,
            capacity_version.version,
            "capacity-replacement",
        )
        .await
        .unwrap();
    assert_eq!(
        restarted
            .set_accepting(&workspace_c, &active_collections[0].id, true)
            .await,
        Err(Error::Capacity)
    );

    let billing_survey = restarted
        .create_survey(
            &workspace_b,
            DraftInput {
                title: "Billing concurrency".into(),
                questions: vec![question()],
                pages: None,
            },
        )
        .await
        .unwrap();
    let billing_version = restarted
        .publish(&workspace_b, &billing_survey.id, billing_survey.revision)
        .await
        .unwrap();
    let billing_collection = restarted
        .create_collection(
            &workspace_b,
            &billing_survey.id,
            billing_version.version,
            "billing-cap",
        )
        .await
        .unwrap();
    for (key, kind, promotional_delta, paid_delta) in [
        (
            "expire-promo",
            likerts_server::credits::CreditKind::Correction,
            -1000,
            0,
        ),
        (
            "paid-test",
            likerts_server::credits::CreditKind::Purchase,
            0,
            8,
        ),
    ] {
        administrator
            .record_credit_adjustment(
                &workspace_b,
                likerts_server::credits::CreditAdjustment {
                    idempotency_key: key.into(),
                    kind,
                    promotional_delta,
                    paid_delta,
                    reference_id: None,
                    reason_code: "test_fixture".into(),
                },
            )
            .await
            .unwrap();
    }
    let limits = restarted
        .update_billing_limits(
            &workspace_b,
            likerts_server::BillingLimitsInput {
                monthly_spend_cap_cents: Some(1),
                unpaid_exposure_cap_cents: Some(5),
            },
        )
        .await
        .unwrap();
    assert_eq!(limits.monthly_spend_cap_cents, 1);
    assert_eq!(
        restarted
            .usage_summary(&workspace_a)
            .await
            .unwrap()
            .monthly_spend_cap_cents,
        500
    );
    let mut billing_tasks = Vec::new();
    for attempt in 0..8 {
        let store = restarted.clone();
        let collection = billing_collection.clone();
        billing_tasks.push(tokio::spawn(async move {
            store
                .submit(
                    &collection.id,
                    &collection.token,
                    submission(&format!("billing-{attempt}"), 5),
                )
                .await
        }));
    }
    let mut billed = 0;
    let mut cap_rejected = 0;
    for task in billing_tasks {
        match task.await.unwrap() {
            Ok(_) => billed += 1,
            Err(Error::SpendLimit) => cap_rejected += 1,
            result => panic!("unexpected spend-cap result: {result:?}"),
        }
    }
    assert_eq!((billed, cap_rejected), (1, 7));
    let mut retry_receipts = 0;
    for attempt in 0..8 {
        match restarted
            .submit(
                &billing_collection.id,
                &billing_collection.token,
                submission(&format!("billing-{attempt}"), 5),
            )
            .await
        {
            Ok(_) => retry_receipts += 1,
            Err(Error::SpendLimit) => {}
            result => panic!("unexpected capped retry result: {result:?}"),
        }
    }
    assert_eq!(retry_receipts, 1);
    let billing_usage = restarted.usage_summary(&workspace_b).await.unwrap();
    assert_eq!(billing_usage.charged_cents, 1);
    assert_eq!(billing_usage.remaining_monthly_cents, 0);
    assert!(!billing_usage.accepting_paid_responses);

    restarted
        .configure_billing_account(
            &workspace_b,
            BillingAccountInput {
                provider_customer_id: "cus_local".into(),
                provider_payment_method_id: "pm_ok".into(),
            },
        )
        .await
        .unwrap();
    // New prepaid responses must never also enter the legacy postpaid collector.
    assert!(matches!(
        restarted
            .prepare_settlement(
                &workspace_b,
                SettlementInput {
                    idempotency_key: "no-double-charge".into(),
                }
            )
            .await,
        Err(Error::Invalid(_))
    ));
    seed_legacy_usage(
        &administrator,
        &workspace_b,
        &billing_collection.id,
        "legacy-success",
    )
    .await;
    let settlement_input = SettlementInput {
        idempotency_key: "settle-once".into(),
    };
    let charge = restarted
        .prepare_settlement(&workspace_b, settlement_input.clone())
        .await
        .unwrap();
    assert_eq!(charge.settlement.amount_cents, 1);
    assert_eq!(
        restarted
            .prepare_settlement(&workspace_b, settlement_input)
            .await
            .unwrap()
            .settlement
            .id,
        charge.settlement.id
    );
    let provider = LocalPaymentProvider::new("webhook-secret");
    let intent = provider
        .create_charge(ChargeRequest {
            idempotency_key: "provider-once".into(),
            customer_id: charge.customer_id,
            payment_method_id: charge.payment_method_id,
            amount_cents: charge.settlement.amount_cents,
        })
        .await
        .unwrap();
    restarted
        .apply_provider_intent(&workspace_b, &charge.settlement.id, &intent)
        .await
        .unwrap();
    let succeeded = ProviderEvent {
        id: "evt_success".into(),
        event_type: "payment_intent.succeeded".into(),
        intent_id: intent.id.clone(),
        failure_code: None,
        amount_total: None,
        currency: None,
        payment_status: None,
        client_reference_id: None,
    };
    assert_eq!(
        restarted
            .apply_payment_event(&succeeded, &[7u8; 32])
            .await
            .unwrap()
            .status,
        "succeeded"
    );
    assert_eq!(
        restarted
            .apply_payment_event(&succeeded, &[7u8; 32])
            .await
            .unwrap()
            .status,
        "succeeded"
    );
    let refund_reference = provider.refund(&intent.id, 1, "refund-once").await.unwrap();
    let refunded = restarted
        .record_refund(
            &workspace_b,
            &charge.settlement.id,
            &RefundInput {
                amount_cents: 1,
                reason: "customer request".into(),
                idempotency_key: "refund-once".into(),
            },
            &refund_reference,
        )
        .await
        .unwrap();
    assert_eq!(refunded.status, "refunded");
    assert_eq!(
        restarted
            .record_refund(
                &workspace_b,
                &charge.settlement.id,
                &RefundInput {
                    amount_cents: 1,
                    reason: "customer request".into(),
                    idempotency_key: "refund-once".into()
                },
                &refund_reference
            )
            .await
            .unwrap()
            .status,
        "refunded"
    );
    restarted
        .update_billing_limits(
            &workspace_b,
            likerts_server::BillingLimitsInput {
                monthly_spend_cap_cents: Some(5),
                unpaid_exposure_cap_cents: Some(5),
            },
        )
        .await
        .unwrap();
    restarted
        .submit(
            &billing_collection.id,
            &billing_collection.token,
            submission("billing-failure", 5),
        )
        .await
        .unwrap();
    seed_legacy_usage(
        &administrator,
        &workspace_b,
        &billing_collection.id,
        "legacy-failure",
    )
    .await;
    let failed_charge = restarted
        .prepare_settlement(
            &workspace_b,
            SettlementInput {
                idempotency_key: "settle-failure".into(),
            },
        )
        .await
        .unwrap();
    let failed_intent = provider
        .create_charge(ChargeRequest {
            idempotency_key: "provider-failure".into(),
            customer_id: failed_charge.customer_id,
            payment_method_id: "pm_fail".into(),
            amount_cents: failed_charge.settlement.amount_cents,
        })
        .await
        .unwrap();
    assert_eq!(
        restarted
            .apply_provider_intent(&workspace_b, &failed_charge.settlement.id, &failed_intent)
            .await
            .unwrap()
            .status,
        "failed"
    );
    assert_eq!(
        restarted
            .usage_summary(&workspace_b)
            .await
            .unwrap()
            .blocked_reason
            .as_deref(),
        Some("billing_paused")
    );
    let recovered = ProviderEvent {
        id: "evt_recovered".into(),
        event_type: "payment_intent.succeeded".into(),
        intent_id: failed_intent.id,
        failure_code: None,
        amount_total: None,
        currency: None,
        payment_status: None,
        client_reference_id: None,
    };
    assert_eq!(
        restarted
            .apply_payment_event(&recovered, &[8u8; 32])
            .await
            .unwrap()
            .status,
        "succeeded"
    );
    assert!(
        restarted
            .usage_summary(&workspace_b)
            .await
            .unwrap()
            .accepting_paid_responses
    );
    let stale_failure = ProviderEvent {
        id: "evt_stale_failure".into(),
        event_type: "payment_intent.payment_failed".into(),
        intent_id: recovered.intent_id,
        failure_code: Some("late_failure".into()),
        amount_total: None,
        currency: None,
        payment_status: None,
        client_reference_id: None,
    };
    assert_eq!(
        restarted
            .apply_payment_event(&stale_failure, &[9u8; 32])
            .await
            .unwrap()
            .status,
        "succeeded"
    );
    assert!(
        restarted
            .usage_summary(&workspace_b)
            .await
            .unwrap()
            .accepting_paid_responses
    );

    let lifecycle_collection = restarted
        .create_collection(&workspace_a, &survey.id, version.version, "lifecycle")
        .await
        .unwrap();
    let lifecycle_submission = submission("lifecycle-explicit", 5);
    let lifecycle_receipt = restarted
        .submit(
            &lifecycle_collection.id,
            &lifecycle_collection.token,
            lifecycle_submission.clone(),
        )
        .await
        .unwrap();
    let usage_before_erasure = restarted.usage(&workspace_a).await.unwrap();
    let lifecycle_export = restarted
        .create_export(
            &workspace_a,
            ExportInput {
                idempotency_key: "lifecycle-export".into(),
                format: ExportFormat::Json,
                collection_id: None,
                accepted_from: None,
                accepted_to: None,
            },
        )
        .await
        .unwrap();
    assert!(matches!(
        restarted
            .erase_response(&workspace_b, &lifecycle_receipt.response_id)
            .await,
        Err(Error::NotFound)
    ));
    let erased = restarted
        .erase_response(&workspace_a, &lifecycle_receipt.response_id)
        .await
        .unwrap();
    assert_eq!(erased.result.responses_erased, 1);
    assert_eq!(erased.result.exports_revoked, 2);
    assert_eq!(
        restarted.usage(&workspace_a).await.unwrap(),
        usage_before_erasure
    );
    assert!(matches!(
        restarted
            .export_job(&workspace_a, &lifecycle_export.id)
            .await,
        Err(Error::ExportRevoked)
    ));
    assert_eq!(
        restarted
            .submit(
                &lifecycle_collection.id,
                &lifecycle_collection.token,
                lifecycle_submission,
            )
            .await
            .unwrap()
            .response_id,
        lifecycle_receipt.response_id
    );
    assert!(matches!(
        restarted
            .submit(
                &lifecycle_collection.id,
                &lifecycle_collection.token,
                submission("lifecycle-explicit", 4),
            )
            .await,
        Err(Error::Conflict)
    ));

    let retention_receipt = restarted
        .submit(
            &lifecycle_collection.id,
            &lifecycle_collection.token,
            submission("lifecycle-retention", 5),
        )
        .await
        .unwrap();
    sqlx::query("update likerts.responses set accepted_at=now()-interval '91 days' where id=$1")
        .bind(Uuid::parse_str(&retention_receipt.response_id).unwrap())
        .execute(administrator.pool())
        .await
        .unwrap();
    let retained_usage = restarted.usage(&workspace_a).await.unwrap();
    let retained = restarted
        .run_retention(&workspace_a, Utc::now())
        .await
        .unwrap();
    assert_eq!(retained.result.responses_erased, 1);
    assert_eq!(restarted.usage(&workspace_a).await.unwrap(), retained_usage);
    assert_eq!(
        restarted
            .run_retention(&workspace_a, Utc::now())
            .await
            .unwrap()
            .result
            .responses_erased,
        0
    );
    let deletion_events: i64 =
        sqlx::query_scalar("select count(*) from likerts.deletion_events where workspace_id=$1")
            .bind(&workspace_a)
            .fetch_one(administrator.pool())
            .await
            .unwrap();
    assert!(deletion_events >= 4);

    let workspace_erasure = restarted.erase_workspace(&workspace_a).await.unwrap();
    assert!(workspace_erasure.result.responses_erased > 0);
    assert_eq!(restarted.usage(&workspace_a).await.unwrap(), retained_usage);
    assert!(matches!(
        restarted.workspace_active(&workspace_a).await,
        Err(Error::Unauthorized)
    ));
    assert!(matches!(
        restarted
            .submit(
                &lifecycle_collection.id,
                &lifecycle_collection.token,
                submission("after-account-deletion", 5),
            )
            .await,
        Err(Error::Unauthorized)
    ));
    let remaining_identity: i64 = sqlx::query_scalar(
        "select (select count(*) from likerts.workspace_memberships where workspace_id=$1) + (select count(*) from likerts.oauth_grants where workspace_id=$1) + (select count(*) from likerts.service_credentials where workspace_id=$1)",
    )
    .bind(&workspace_a)
    .fetch_one(administrator.pool())
    .await
    .unwrap();
    assert_eq!(remaining_identity, 0);
}
