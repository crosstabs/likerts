use likerts_server::{
    credits::{CreditAdjustment, CreditKind},
    postgres::PgStore,
    webhook_store::WebhookStore,
    webhooks::{default_event_types, AttemptOutcome, EndpointInput, EndpointUpdate, WebhookKeys},
};
use serde_json::Value;
use sqlx::{PgPool, Row};
use uuid::Uuid;

fn change(
    key: &str,
    kind: CreditKind,
    promo: i64,
    paid: i64,
    reference: Option<String>,
) -> CreditAdjustment {
    CreditAdjustment {
        idempotency_key: key.into(),
        kind,
        promotional_delta: promo,
        paid_delta: paid,
        reference_id: reference,
        reason_code: "notification_fixture".into(),
    }
}
async fn events(pool: &PgPool, workspace: &str) -> Vec<Value> {
    sqlx::query("select body from likerts.webhook_events where workspace_id=$1 and event_type='credits.threshold_reached' order by created_at,id")
        .bind(workspace).fetch_all(pool).await.unwrap().iter()
        .map(|r| serde_json::from_str(&r.get::<String,_>("body")).unwrap()).collect()
}
#[tokio::test]
async fn bucket_generations_outbox_scopes_rollback_and_erasure() {
    let Ok(admin_url) = std::env::var("LIKERTS_WEBHOOK_TEST_ADMIN_URL") else {
        eprintln!("SKIP credit notifications: run scripts/check-webhook-isolation.sh");
        return;
    };
    std::env::set_var(
        "LIKERTS_COLLECTION_CREDENTIAL_KEY",
        "bGlrZXJ0cy10ZXN0LWtleS1vbmx5LTMyeCEhISEhISE=",
    );
    let admin = PgPool::connect(&admin_url).await.unwrap();
    let owner = PgStore::connect_runtime(&admin_url).await.unwrap();
    let api_url = std::env::var("LIKERTS_WEBHOOK_TEST_API_URL").unwrap();
    let runtime = PgStore::connect_runtime(&api_url).await.unwrap();
    let api_pool = PgPool::connect(&api_url).await.unwrap();
    let worker_pool = PgPool::connect(&std::env::var("LIKERTS_WEBHOOK_TEST_WORKER_URL").unwrap())
        .await
        .unwrap();
    let keys = WebhookKeys::new(&[73; 32]).unwrap();
    let api = WebhookStore::new(api_pool.clone(), keys.clone());
    let worker = WebhookStore::new(worker_pool.clone(), keys);
    let w = format!("credit-notify-{}", Uuid::new_v4());
    let other = format!("credit-other-{}", Uuid::new_v4());
    runtime.ensure_workspaces([&w, &other]).await.unwrap();
    for pool in [&api_pool, &worker_pool] {
        let error = sqlx::query("select * from likerts.credit_notification_state")
            .fetch_all(pool)
            .await
            .unwrap_err();
        assert_eq!(
            error.as_database_error().unwrap().code().as_deref(),
            Some("42501")
        );
    }
    let response = api
        .create_endpoint(
            &w,
            EndpointInput {
                idempotency_key: "responses".into(),
                url: "https://hooks.customer.com/responses".into(),
                event_types: default_event_types(),
            },
        )
        .await
        .unwrap();
    let credit = api
        .create_endpoint(
            &w,
            EndpointInput {
                idempotency_key: "credits".into(),
                url: "https://hooks.customer.com/credits".into(),
                event_types: vec!["credits.threshold_reached".into()],
            },
        )
        .await
        .unwrap();
    for id in [&response.endpoint.id, &credit.endpoint.id] {
        api.update_endpoint(
            &w,
            id,
            EndpointUpdate {
                enabled: Some(true),
                revoke: None,
            },
        )
        .await
        .unwrap();
    }
    // Restricted runtime acceptance exercises the trigger under forced RLS; the
    // default response subscriber must not receive account notifications.
    let survey = runtime.create_survey(&w,serde_json::from_value(serde_json::json!({"title":"Notification fixture","questions":[{"id":"score","type":"scale","label":"Score","required":true,"min":1,"max":5}]})).unwrap()).await.unwrap();
    runtime.publish(&w, &survey.id, 1).await.unwrap();
    let collection = runtime
        .create_collection(&w, &survey.id, 1, "app")
        .await
        .unwrap();
    runtime
        .submit(
            &collection.id,
            &collection.token,
            serde_json::from_value(
                serde_json::json!({"idempotencyKey":"first","answers":{"score":4},"metadata":{}}),
            )
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        api.list_deliveries(&w, Some(&response.endpoint.id), None, 100)
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(api
        .list_deliveries(&w, Some(&credit.endpoint.id), None, 100)
        .await
        .unwrap()
        .is_empty());
    api.update_endpoint(
        &w,
        &response.endpoint.id,
        EndpointUpdate {
            enabled: Some(false),
            revoke: None,
        },
    )
    .await
    .unwrap();
    // Avoid a pending response claim interfering with the credit-only claim below.
    sqlx::query("delete from likerts.webhook_events where workspace_id=$1 and event_type='response.accepted'").bind(&w).execute(&admin).await.unwrap();
    let depletion = change("promo-80", CreditKind::Correction, -798, 0, None);
    let (a, b) = tokio::join!(
        owner.record_credit_adjustment(&w, depletion.clone()),
        owner.record_credit_adjustment(&w, depletion)
    );
    assert_eq!(a.unwrap().id, b.unwrap().id);
    assert!(events(&admin, &w).await.is_empty());
    let crossing: likerts_server::Submission = serde_json::from_value(serde_json::json!({
        "idempotencyKey":"crossing", "answers":{"score":4}, "metadata":{}
    }))
    .unwrap();
    let (a, b) = tokio::join!(
        runtime.submit(&collection.id, &collection.token, crossing.clone()),
        runtime.submit(&collection.id, &collection.token, crossing)
    );
    assert_eq!(a.unwrap().response_id, b.unwrap().response_id);
    let first = events(&admin, &w).await;
    assert_eq!(first.len(), 1);
    assert_eq!(first[0]["data"]["bucket"], "promotional");
    assert_eq!(first[0]["data"]["thresholdPercent"], 80);
    let promo_generation = first[0]["data"]["generationId"].clone();
    assert_eq!(
        api.list_deliveries(&w, Some(&response.endpoint.id), None, 100)
            .await
            .unwrap()
            .len(),
        0
    );
    assert!(api
        .list_deliveries(&other, None, None, 100)
        .await
        .unwrap()
        .is_empty());
    // A rolled-back debit must roll back both the outbox and dedupe high-water.
    let mut tx = admin.begin().await.unwrap();
    sqlx::query("insert into likerts.response_credits(workspace_id,idempotency_key,kind,promotional_delta,reason_code) values($1,'rollback','correction',-100,'test')").bind(&w).execute(&mut *tx).await.unwrap();
    tx.rollback().await.unwrap();
    assert_eq!(events(&admin, &w).await.len(), 1);
    let claim = worker.claim().await.unwrap().unwrap();
    assert_eq!(claim.workspace, w);
    assert_eq!(
        serde_json::from_str::<Value>(&claim.body).unwrap(),
        first[0]
    );
    worker
        .finish(&claim, AttemptOutcome::Delivered(204))
        .await
        .unwrap();
    // Refunds deplete paid balance, while paid top-ups rearm only that bucket.
    let purchase = owner
        .record_credit_adjustment(&w, change("purchase", CreditKind::Purchase, 0, 1000, None))
        .await
        .unwrap();
    owner
        .record_credit_adjustment(
            &w,
            change(
                "refund",
                CreditKind::Refund,
                0,
                -800,
                Some(purchase.id.clone()),
            ),
        )
        .await
        .unwrap();
    let before_topup = events(&admin, &w).await;
    let old_paid = before_topup
        .iter()
        .find(|e| e["data"]["bucket"] == "paid")
        .unwrap()["data"]["generationId"]
        .clone();
    owner
        .record_credit_adjustment(&w, change("topup", CreditKind::Purchase, 0, 200, None))
        .await
        .unwrap();
    owner
        .record_credit_adjustment(
            &w,
            change(
                "refund-rest",
                CreditKind::Refund,
                0,
                -200,
                Some(purchase.id),
            ),
        )
        .await
        .unwrap();
    owner
        .record_credit_adjustment(&w, change("paid-80", CreditKind::Correction, 0, -120, None))
        .await
        .unwrap();
    owner
        .record_credit_adjustment(&w, change("paid-100", CreditKind::Correction, 0, -80, None))
        .await
        .unwrap();
    owner
        .record_credit_adjustment(
            &w,
            change("promo-90", CreditKind::Correction, -100, 0, None),
        )
        .await
        .unwrap();
    owner
        .record_credit_adjustment(
            &w,
            change("promo-100", CreditKind::Correction, -100, 0, None),
        )
        .await
        .unwrap();
    let all = events(&admin, &w).await;
    assert_eq!(all.len(), 7);
    let promo = all
        .iter()
        .filter(|e| e["data"]["bucket"] == "promotional")
        .collect::<Vec<_>>();
    assert_eq!(promo.len(), 3);
    assert!(promo
        .iter()
        .all(|e| e["data"]["generationId"] == promo_generation));
    let new_paid = all
        .iter()
        .filter(|e| e["data"]["bucket"] == "paid" && e["data"]["generationId"] != old_paid)
        .collect::<Vec<_>>();
    assert_eq!(new_paid.len(), 3);
    assert!(new_paid
        .iter()
        .all(|e| e["data"]["generationId"] == new_paid[0]["data"]["generationId"]));
    for e in &all {
        assert_eq!(
            e["data"].as_object().unwrap().len(),
            4,
            "no amounts or answers in event"
        );
        assert_eq!(e["data"]["workspaceId"], w);
    }
    // Notification dedupe is independent of the seven-day event retention.
    sqlx::query("delete from likerts.webhook_events where workspace_id=$1")
        .bind(&w)
        .execute(&admin)
        .await
        .unwrap();
    assert_eq!(sqlx::query_scalar::<_,i32>("select high_water from likerts.credit_notification_state where workspace_id=$1 and bucket='promotional'").bind(&w).fetch_one(&admin).await.unwrap(),100);
    api.update_endpoint(
        &w,
        &credit.endpoint.id,
        EndpointUpdate {
            enabled: Some(false),
            revoke: None,
        },
    )
    .await
    .unwrap();
    owner
        .record_credit_adjustment(
            &w,
            change("disabled-grant", CreditKind::Grant, 100, 0, None),
        )
        .await
        .unwrap();
    owner
        .record_credit_adjustment(
            &w,
            change("disabled-exhaust", CreditKind::Correction, -100, 0, None),
        )
        .await
        .unwrap();
    api.update_endpoint(
        &w,
        &credit.endpoint.id,
        EndpointUpdate {
            enabled: Some(true),
            revoke: None,
        },
    )
    .await
    .unwrap();
    assert!(
        events(&admin, &w).await.is_empty(),
        "enabling never backfills alerts"
    );
    owner
        .record_credit_adjustment(&w, change("fresh-grant", CreditKind::Grant, 100, 0, None))
        .await
        .unwrap();
    owner
        .record_credit_adjustment(&w, change("fresh-80", CreditKind::Correction, -80, 0, None))
        .await
        .unwrap();
    let fresh = events(&admin, &w).await;
    assert_eq!(fresh.len(), 1);
    assert_ne!(fresh[0]["data"]["generationId"], promo_generation);
    // The typed nullable FK must reject an account event with response fields or
    // absent bucket/threshold; PostgreSQL CHECK NULL must not allow malformed rows.
    for fields in [
        "null,null,null",
        "'paid',gen_random_uuid(),null",
        "null,gen_random_uuid(),80",
    ] {
        let sql=format!("insert into likerts.webhook_events(workspace_id,id,event_type,credit_bucket,credit_generation,credit_threshold,body,created_at,expires_at) values($1,gen_random_uuid(),'credits.threshold_reached',{fields},'{{}}',now(),now()+interval '7 days')");
        let error = sqlx::query(&sql)
            .bind(&w)
            .execute(&admin)
            .await
            .unwrap_err();
        assert_eq!(
            error.as_database_error().unwrap().code().as_deref(),
            Some("23514")
        );
    }
    api.update_endpoint(
        &w,
        &credit.endpoint.id,
        EndpointUpdate {
            enabled: None,
            revoke: Some(true),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        api.list_deliveries(&w, None, None, 100).await.unwrap()[0].status,
        "cancelled"
    );
    owner
        .record_credit_adjustment(
            &w,
            change("revoked-exhaust", CreditKind::Correction, -20, 0, None),
        )
        .await
        .unwrap();
    assert_eq!(events(&admin, &w).await.len(), 1);
    sqlx::query("update likerts.workspaces set deleted_at=now() where id=$1")
        .bind(&w)
        .execute(&admin)
        .await
        .unwrap();
    assert!(events(&admin, &w).await.is_empty());
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "select count(*) from likerts.credit_notification_state where workspace_id=$1"
        )
        .bind(&w)
        .fetch_one(&admin)
        .await
        .unwrap(),
        0
    );
}
