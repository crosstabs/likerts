use likerts_server::Error;
#[allow(dead_code)]
#[path = "../src/webhook_store.rs"]
mod webhook_store;
#[allow(dead_code)]
#[path = "../src/webhooks.rs"]
mod webhooks;
use sqlx::{PgPool, Row};
use uuid::Uuid;
use webhook_store::WebhookStore;
use webhooks::*;

#[tokio::test]
async fn durable_claims_rotation_replay_revocation_and_least_privilege() {
    let Ok(admin_url) = std::env::var("LIKERTS_WEBHOOK_TEST_ADMIN_URL") else {
        eprintln!("SKIP webhook PostgreSQL lifecycle: run scripts/check-webhook-isolation.sh");
        return;
    };
    let admin = PgPool::connect(&admin_url).await.unwrap();
    let api_pool = PgPool::connect(&std::env::var("LIKERTS_WEBHOOK_TEST_API_URL").unwrap())
        .await
        .unwrap();
    let worker_pool = PgPool::connect(&std::env::var("LIKERTS_WEBHOOK_TEST_WORKER_URL").unwrap())
        .await
        .unwrap();
    let keys = WebhookKeys::new(&[73; 32]).unwrap();
    let api = WebhookStore::new(api_pool, keys.clone());
    let worker = WebhookStore::new(worker_pool.clone(), keys.clone());
    worker.check_worker_role().await.unwrap();
    assert!(matches!(
        api.check_worker_role().await,
        Err(Error::Unauthorized)
    ));
    assert!(matches!(api.claim().await, Err(Error::Unauthorized)));
    for table in [
        "responses",
        "surveys",
        "survey_versions",
        "usage_entries",
        "workspace_memberships",
        "oauth_grants",
        "export_jobs",
        "audit_events",
        "webhook_requests",
    ] {
        let error = sqlx::query(&format!("select * from likerts.{table} limit 1"))
            .fetch_all(&worker_pool)
            .await
            .unwrap_err();
        assert_eq!(
            error.as_database_error().unwrap().code().as_deref(),
            Some("42501"),
            "{table}"
        );
    }
    let workspace = format!("webhook-life-{}", Uuid::new_v4());
    let survey = Uuid::new_v4();
    let collection = Uuid::new_v4();
    sqlx::query("insert into likerts.workspaces(id) values($1)")
        .bind(&workspace)
        .execute(&admin)
        .await
        .unwrap();
    sqlx::query("insert into likerts.surveys(workspace_id,id,revision,title,questions) values($1,$2,1,'Callbacks','[]')").bind(&workspace).bind(survey).execute(&admin).await.unwrap();
    let cap = serde_json::json!({"installations":[{"target":"web","sdkVersion":"0.0.1","schemaVersions":[1,2]}]});
    sqlx::query("insert into likerts.survey_versions(workspace_id,survey_id,version,title,questions,sdk_capabilities) values($1,$2,1,'Callbacks','[]',$3)").bind(&workspace).bind(survey).bind(&cap).execute(&admin).await.unwrap();
    sqlx::query("insert into likerts.collections(workspace_id,id,survey_id,version,placement,token_hash,sdk_capabilities) values($1,$2,$3,1,'app',$4,$5)").bind(&workspace).bind(collection).bind(survey).bind(vec![1u8;32]).bind(&cap).execute(&admin).await.unwrap();
    let input = EndpointInput {
        idempotency_key: "create".into(),
        url: "https://hooks.customer.com/accepted".into(),
    };
    let endpoint = api
        .create_endpoint(&workspace, input.clone())
        .await
        .unwrap();
    assert!(!endpoint.endpoint.enabled);
    let repeated = api.create_endpoint(&workspace, input).await.unwrap();
    assert_eq!(endpoint.signing_secret, repeated.signing_secret);
    assert_eq!(endpoint.endpoint.id, repeated.endpoint.id);
    assert!(matches!(
        api.create_endpoint(
            &workspace,
            EndpointInput {
                idempotency_key: "create".into(),
                url: "https://different.customer.com/".into()
            }
        )
        .await,
        Err(Error::Conflict)
    ));
    let insert = |key: &str| {
        sqlx::query("insert into likerts.responses(workspace_id,id,collection_id,idempotency_key,answers,metadata) values($1,$2,$3,$4,'{\"private\":\"never-send-this\"}','{}')").bind(workspace.clone()).bind(Uuid::new_v4()).bind(collection).bind(key.to_owned())
    };
    insert("disabled").execute(&admin).await.unwrap();
    assert!(api
        .list_deliveries(&workspace, None, None, 100)
        .await
        .unwrap()
        .is_empty());
    api.update_endpoint(
        &workspace,
        &endpoint.endpoint.id,
        EndpointUpdate {
            enabled: Some(true),
            revoke: None,
        },
    )
    .await
    .unwrap();
    insert("one").execute(&admin).await.unwrap();
    insert("two").execute(&admin).await.unwrap();
    assert_eq!(
        api.list_deliveries(&workspace, None, None, 100)
            .await
            .unwrap()
            .len(),
        2
    );
    let (a, b, c, d) = tokio::join!(
        worker.claim(),
        worker.claim(),
        worker.claim(),
        worker.claim()
    );
    let claims = [a.unwrap(), b.unwrap(), c.unwrap(), d.unwrap()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    assert_eq!(
        claims.len(),
        1,
        "only one in-flight attempt per endpoint across concurrent workers"
    );
    let first = &claims[0];
    assert!(!first.body.contains("never-send-this"));
    assert!(worker.dispatch_active(first).await.unwrap());
    let persisted =
        sqlx::query("select key_id,signature_timestamp from likerts.webhook_attempts where id=$1")
            .bind(Uuid::parse_str(&first.attempt_id).unwrap())
            .fetch_one(&admin)
            .await
            .unwrap();
    assert_eq!(persisted.get::<Uuid, _>("key_id").to_string(), first.key_id);
    assert_eq!(
        persisted.get::<i64, _>("signature_timestamp"),
        first.signature_timestamp
    );
    worker
        .finish(first, AttemptOutcome::Failed(Some(400), "http_permanent"))
        .await
        .unwrap();
    let second = worker.claim().await.unwrap().unwrap();
    worker
        .finish(&second, AttemptOutcome::Delivered(204))
        .await
        .unwrap();
    assert!(worker.claim().await.unwrap().is_none());
    let replay = api
        .replay(
            &workspace,
            &first.delivery_id,
            WebhookOperationInput {
                idempotency_key: "replay-1".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(replay.event_id, first.event_id);
    assert_eq!(replay.replay_count, 1);
    assert_eq!(
        api.replay(
            &workspace,
            &first.delivery_id,
            WebhookOperationInput {
                idempotency_key: "replay-1".into()
            }
        )
        .await
        .unwrap()
        .replay_count,
        1
    );
    let old_attempt = worker.claim().await.unwrap().unwrap();
    let rotated = api
        .rotate_key(
            &workspace,
            &endpoint.endpoint.id,
            WebhookOperationInput {
                idempotency_key: "rotate".into(),
            },
        )
        .await
        .unwrap();
    assert_ne!(rotated.signing_secret, old_attempt.signing_secret);
    assert_eq!(
        api.rotate_key(
            &workspace,
            &endpoint.endpoint.id,
            WebhookOperationInput {
                idempotency_key: "rotate".into()
            }
        )
        .await
        .unwrap()
        .signing_secret,
        rotated.signing_secret
    );
    assert!(verify_signature(
        &old_attempt.signing_secret,
        &old_attempt.key_id,
        &old_attempt.event_id,
        &signature(
            &old_attempt.signing_secret,
            &old_attempt.key_id,
            &old_attempt.event_id,
            old_attempt.signature_timestamp,
            old_attempt.body.as_bytes()
        ),
        old_attempt.body.as_bytes(),
        old_attempt.signature_timestamp
    ));
    worker
        .finish(&old_attempt, AttemptOutcome::Retry(Some(503), "http_retry"))
        .await
        .unwrap();
    let scheduled = api
        .get_delivery(&workspace, &first.delivery_id)
        .await
        .unwrap();
    assert_eq!(scheduled.status, "queued");
    assert!(scheduled.next_attempt_at > chrono::Utc::now() + chrono::Duration::seconds(55));
    assert!(worker.claim().await.unwrap().is_none());
    sqlx::query("update likerts.webhook_deliveries set next_attempt_at=now() where id=$1")
        .bind(Uuid::parse_str(&first.delivery_id).unwrap())
        .execute(&admin)
        .await
        .unwrap();
    let restarted = WebhookStore::new(worker_pool.clone(), keys.clone());
    let retry = restarted.claim().await.unwrap().unwrap();
    assert_eq!(retry.attempt_number, 2);
    assert_eq!(retry.signing_secret, rotated.signing_secret);
    assert_eq!(retry.event_id, first.event_id);
    sqlx::query(
        "update likerts.webhook_deliveries set lease_until=now()-interval '1 second' where id=$1",
    )
    .bind(Uuid::parse_str(&retry.delivery_id).unwrap())
    .execute(&admin)
    .await
    .unwrap();
    let recovered = restarted.claim().await.unwrap().unwrap();
    assert_eq!(recovered.attempt_number, 3);
    restarted
        .finish(&retry, AttemptOutcome::Delivered(200))
        .await
        .unwrap();
    assert_eq!(
        api.get_delivery(&workspace, &retry.delivery_id)
            .await
            .unwrap()
            .status,
        "running"
    );
    restarted
        .finish(&recovered, AttemptOutcome::Delivered(200))
        .await
        .unwrap();
    for count in 2..=3 {
        api.replay(
            &workspace,
            &first.delivery_id,
            WebhookOperationInput {
                idempotency_key: format!("replay-{count}"),
            },
        )
        .await
        .unwrap();
        let attempt = restarted.claim().await.unwrap().unwrap();
        restarted
            .finish(&attempt, AttemptOutcome::Delivered(200))
            .await
            .unwrap();
    }
    assert!(matches!(
        api.replay(
            &workspace,
            &first.delivery_id,
            WebhookOperationInput {
                idempotency_key: "replay-4".into()
            }
        )
        .await,
        Err(Error::Conflict)
    ));
    insert("revoke").execute(&admin).await.unwrap();
    let revoked = restarted.claim().await.unwrap().unwrap();
    api.update_endpoint(
        &workspace,
        &endpoint.endpoint.id,
        EndpointUpdate {
            enabled: None,
            revoke: Some(true),
        },
    )
    .await
    .unwrap();
    assert!(!restarted.dispatch_active(&revoked).await.unwrap());
    restarted
        .finish(&revoked, AttemptOutcome::Delivered(200))
        .await
        .unwrap();
    assert_eq!(
        api.get_delivery(&workspace, &revoked.delivery_id)
            .await
            .unwrap()
            .status,
        "cancelled"
    );
    assert!(matches!(
        api.create_endpoint(
            &workspace,
            EndpointInput {
                idempotency_key: "create".into(),
                url: "https://hooks.customer.com/accepted".into()
            }
        )
        .await,
        Err(Error::Revoked)
    ));
    let replacement = api
        .create_endpoint(
            &workspace,
            EndpointInput {
                idempotency_key: "master-fail-closed".into(),
                url: "https://hooks.customer.com/replacement".into(),
            },
        )
        .await
        .unwrap();
    api.update_endpoint(
        &workspace,
        &replacement.endpoint.id,
        EndpointUpdate {
            enabled: Some(true),
            revoke: None,
        },
    )
    .await
    .unwrap();
    insert("master-unavailable").execute(&admin).await.unwrap();
    let wrong_master = WebhookStore::new(worker_pool.clone(), WebhookKeys::new(&[74; 32]).unwrap());
    assert!(wrong_master.claim().await.unwrap().is_none());
    let blocked = api
        .list_deliveries(&workspace, Some(&replacement.endpoint.id), None, 100)
        .await
        .unwrap();
    assert_eq!(blocked.len(), 1);
    assert_eq!(blocked[0].status, "failed");
    assert_eq!(
        blocked[0].failure_code.as_deref(),
        Some("credential_key_unavailable")
    );
    assert_eq!(blocked[0].attempts, 0);
    api.replay(
        &workspace,
        &blocked[0].id,
        WebhookOperationInput {
            idempotency_key: "after-master-restored".into(),
        },
    )
    .await
    .unwrap();
    let restored_key = restarted.claim().await.unwrap().unwrap();
    restarted
        .finish(&restored_key, AttemptOutcome::Delivered(200))
        .await
        .unwrap();
    let leaked:bool=sqlx::query_scalar("select exists(select 1 from likerts.webhook_requests where workspace_id=$1 and response::text like '%whsec_%')").bind(&workspace).fetch_one(&admin).await.unwrap();
    assert!(!leaked);
    sqlx::query("update likerts.webhook_events set expires_at=now()-interval '1 second' where workspace_id=$1").bind(&workspace).execute(&admin).await.unwrap();
    assert!(restarted.claim().await.unwrap().is_none());
    assert!(api
        .list_deliveries(&workspace, None, None, 100)
        .await
        .unwrap()
        .is_empty());
}
