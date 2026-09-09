use likerts_server::{
    credits::{CreditAdjustment, CreditKind},
    postgres::PgStore,
    BillingLimitsInput, DraftInput, Error, Store, Submission,
};
use serde_json::{json, Map};
use uuid::Uuid;
fn draft() -> DraftInput {
    serde_json::from_value(json!({"title":"Credit fixture","questions":[{"id":"rating","type":"scale","label":"Rating","required":true,"min":1,"max":5}]})).unwrap()
}
fn response(key: &str) -> Submission {
    serde_json::from_value(json!({"idempotencyKey":key,"answers":{"rating":4},"metadata":{}}))
        .unwrap()
}
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
        reason_code: "operator_verified".into(),
    }
}
#[test]
fn memory_onboarding_is_once_promo_first_and_zero_is_closed() {
    let mut store = Store::default();
    let s = store.create_survey("a", draft()).unwrap();
    store.publish("a", &s.id, 1).unwrap();
    let c = store.create_collection("a", &s.id, 1, "app").unwrap();
    assert_eq!(store.credit_entries("a").len(), 1);
    store.create_survey("a", draft()).unwrap();
    assert_eq!(store.credit_entries("a").len(), 1);
    store
        .update_billing_limits(
            "a",
            BillingLimitsInput {
                monthly_spend_cap_cents: Some(0),
                unpaid_exposure_cap_cents: Some(0),
            },
        )
        .unwrap();
    let mut invalid = response("invalid");
    invalid.answers = Map::new();
    assert!(store.submit(&c.id, &c.token, invalid).is_err());
    for n in 0..1000 {
        store
            .submit(&c.id, &c.token, response(&format!("free-{n}")))
            .unwrap();
    }
    let summary = store.usage_summary("a");
    assert_eq!(summary.credits.promotional_responses, 1000);
    assert_eq!(summary.credits.available_credits, 0);
    assert_eq!(summary.unpaid_exposure_cents, 0);
    assert_eq!(summary.blocked_reason.as_deref(), Some("credits_exhausted"));
    assert!(matches!(
        store.submit(&c.id, &c.token, response("too-many")),
        Err(Error::SpendLimit)
    ));
    let first = store.submit(&c.id, &c.token, response("free-0")).unwrap();
    assert_eq!(
        store
            .submit(&c.id, &c.token, response("free-0"))
            .unwrap()
            .response_id,
        first.response_id
    );
    assert_eq!(store.credit_entries("a").len(), 1001);
    let purchase = change("purchase", CreditKind::Purchase, 0, 2, None);
    let entry = store
        .record_credit_adjustment("a", purchase.clone())
        .unwrap();
    assert_eq!(
        store.record_credit_adjustment("a", purchase).unwrap(),
        entry
    );
    assert!(matches!(
        store.submit(&c.id, &c.token, response("paid-cap")),
        Err(Error::SpendLimit)
    ));
    store
        .update_billing_limits(
            "a",
            BillingLimitsInput {
                monthly_spend_cap_cents: Some(2),
                unpaid_exposure_cap_cents: None,
            },
        )
        .unwrap();
    for n in 0..2 {
        store
            .submit(&c.id, &c.token, response(&format!("paid-{n}")))
            .unwrap();
    }
    assert_eq!(store.usage_summary("a").credits.paid_responses, 2);
    assert_eq!(store.usage("a"), 1002);
    assert_eq!(
        store.record_credit_adjustment(
            "a",
            change("refund-used", CreditKind::Refund, 0, -1, Some(entry.id))
        ),
        Err(Error::SpendLimit)
    );
    let gift = store
        .record_credit_adjustment("a", change("grant", CreditKind::Grant, 3, 0, None))
        .unwrap();
    store
        .record_credit_adjustment(
            "a",
            change(
                "reverse",
                CreditKind::Reversal,
                -3,
                0,
                Some(gift.id.clone()),
            ),
        )
        .unwrap();
    assert!(store
        .record_credit_adjustment(
            "a",
            change("reverse-again", CreditKind::Reversal, -3, 0, Some(gift.id))
        )
        .is_err());
}
#[tokio::test]
async fn postgres_credits_are_atomic_append_only_and_tenant_scoped() {
    let Ok(admin_url) = std::env::var("LIKERTS_TEST_DATABASE_URL") else {
        eprintln!("skipping: run scripts/check-response-credits.sh");
        return;
    };
    let runtime_url = std::env::var("LIKERTS_TEST_RUNTIME_DATABASE_URL").unwrap();
    std::env::set_var(
        "LIKERTS_COLLECTION_CREDENTIAL_KEY",
        "bGlrZXJ0cy10ZXN0LWtleS1vbmx5LTMyeCEhISEhISE=",
    );
    let admin = PgStore::connect(&admin_url).await.unwrap();
    let api = PgStore::connect_runtime(&runtime_url).await.unwrap();
    let w = format!("credits-{}", Uuid::new_v4());
    api.ensure_workspaces([&w]).await.unwrap();
    api.ensure_workspaces([&w]).await.unwrap();
    assert_eq!(api.credit_entries(&w).await.unwrap().len(), 1);
    assert_eq!(
        api.usage_summary(&w)
            .await
            .unwrap()
            .credits
            .available_credits,
        1000
    );
    let other = format!("other-{}", Uuid::new_v4());
    api.ensure_workspaces([&other]).await.unwrap();
    let purchase = change("purchase", CreditKind::Purchase, 0, 2, None);
    assert_eq!(
        api.record_credit_adjustment(&w, purchase.clone()).await,
        Err(Error::Forbidden)
    );
    let bought = admin
        .record_credit_adjustment(&w, purchase.clone())
        .await
        .unwrap();
    assert_eq!(
        admin.record_credit_adjustment(&w, purchase).await.unwrap(),
        bought
    );
    assert_eq!(
        admin
            .record_credit_adjustment(&w, change("purchase", CreditKind::Purchase, 0, 3, None))
            .await,
        Err(Error::Conflict)
    );
    admin
        .record_credit_adjustment(
            &w,
            change("adjust-promo", CreditKind::Correction, -999, 0, None),
        )
        .await
        .unwrap();
    api.update_billing_limits(
        &w,
        BillingLimitsInput {
            monthly_spend_cap_cents: Some(0),
            unpaid_exposure_cap_cents: Some(0),
        },
    )
    .await
    .unwrap();
    let s = api.create_survey(&w, draft()).await.unwrap();
    api.publish(&w, &s.id, 1).await.unwrap();
    let c = api.create_collection(&w, &s.id, 1, "app").await.unwrap();
    let c2 = api.create_collection(&w, &s.id, 1, "app2").await.unwrap();
    let mut invalid = response("invalid");
    invalid.answers = Map::new();
    assert!(api.submit(&c.id, &c.token, invalid).await.is_err());
    // A later usage failure must roll back response, credit and callback transaction.
    sqlx::query("create function likerts.credit_test_fail_usage() returns trigger language plpgsql as $$ begin raise exception 'synthetic rollback';end $$").execute(admin.pool()).await.unwrap();
    sqlx::query("create trigger credit_test_fail before insert on likerts.usage_entries for each row execute function likerts.credit_test_fail_usage()").execute(admin.pool()).await.unwrap();
    assert!(matches!(
        api.submit(&c.id, &c.token, response("rollback")).await,
        Err(Error::Internal)
    ));
    assert_eq!(
        api.usage_summary(&w)
            .await
            .unwrap()
            .credits
            .available_credits,
        3
    );
    sqlx::query("drop trigger credit_test_fail on likerts.usage_entries")
        .execute(admin.pool())
        .await
        .unwrap();
    let free = api
        .submit(&c.id, &c.token, response("first"))
        .await
        .unwrap();
    assert_eq!(
        api.submit(&c.id, &c.token, response("first"))
            .await
            .unwrap()
            .response_id,
        free.response_id
    );
    let summary = api.usage_summary(&w).await.unwrap();
    assert_eq!(summary.credits.promotional_credits, 0);
    assert_eq!(summary.credits.paid_credits, 2);
    assert_eq!(summary.unpaid_exposure_cents, 0);
    assert_eq!(summary.credits.promotional_responses, 1);
    assert!(matches!(
        api.submit(&c.id, &c.token, response("paid-blocked")).await,
        Err(Error::SpendLimit)
    ));
    api.update_billing_limits(
        &w,
        BillingLimitsInput {
            monthly_spend_cap_cents: Some(10),
            unpaid_exposure_cap_cents: None,
        },
    )
    .await
    .unwrap();
    let mut tasks = Vec::new();
    for n in 0..8 {
        let api = api.clone();
        let c = if n % 2 == 0 { c.clone() } else { c2.clone() };
        tasks.push(tokio::spawn(async move {
            api.submit(&c.id, &c.token, response(&format!("race-{n}")))
                .await
        }));
    }
    let mut accepted = 0;
    for task in tasks {
        match task.await.unwrap() {
            Ok(_) => accepted += 1,
            Err(Error::SpendLimit) => {}
            other => panic!("unexpected {other:?}"),
        }
    }
    assert_eq!(accepted, 2);
    let final_state = api.usage_summary(&w).await.unwrap();
    assert_eq!(final_state.credits.available_credits, 0);
    assert_eq!(final_state.charged_cents, 3);
    assert_eq!(final_state.credits.paid_responses, 2);
    assert_eq!(
        final_state.blocked_reason.as_deref(),
        Some("credits_exhausted")
    );
    let restarted = PgStore::connect_runtime(&runtime_url).await.unwrap();
    assert_eq!(
        restarted
            .submit(&c.id, &c.token, response("first"))
            .await
            .unwrap()
            .response_id,
        free.response_id
    );
    assert_eq!(restarted.credit_entries(&w).await.unwrap().len(), 6);
    assert_eq!(
        api.usage_summary(&other)
            .await
            .unwrap()
            .credits
            .available_credits,
        1000
    );
    let purchase2 = admin
        .record_credit_adjustment(&w, change("purchase2", CreditKind::Purchase, 0, 3, None))
        .await
        .unwrap();
    let refund = change(
        "refund",
        CreditKind::Refund,
        0,
        -1,
        Some(purchase2.id.clone()),
    );
    let refunded = admin
        .record_credit_adjustment(&w, refund.clone())
        .await
        .unwrap();
    assert_eq!(
        admin.record_credit_adjustment(&w, refund).await.unwrap(),
        refunded
    );
    assert!(admin
        .record_credit_adjustment(
            &w,
            change(
                "reverse-refunded",
                CreditKind::Reversal,
                0,
                -3,
                Some(purchase2.id)
            )
        )
        .await
        .is_err());
    assert!(admin
        .record_credit_adjustment(
            &other,
            change(
                "wrong-tenant-refund",
                CreditKind::Refund,
                0,
                -1,
                Some(bought.id)
            )
        )
        .await
        .is_err());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("select count(*) from likerts.response_credits")
            .fetch_one(api.pool())
            .await
            .unwrap(),
        0
    );
    assert!(!sqlx::query_scalar::<_,bool>("select has_table_privilege(current_user,'likerts.response_credits','UPDATE') or has_table_privilege(current_user,'likerts.response_credits','DELETE')").fetch_one(api.pool()).await.unwrap());
    let mutation = sqlx::query(
        "update likerts.response_credits set paid_delta=paid_delta+1 where workspace_id=$1",
    )
    .bind(&w)
    .execute(admin.pool())
    .await
    .unwrap_err();
    assert_eq!(
        mutation.as_database_error().unwrap().code().as_deref(),
        Some("42501")
    );
    // Prove the SQL privilege boundary independently of the Rust operator guard.
    let mut denied = api.pool().begin().await.unwrap();
    sqlx::query("select set_config('likerts.workspace_id',$1,true)")
        .bind(&w)
        .execute(&mut *denied)
        .await
        .unwrap();
    let mint = sqlx::query("insert into likerts.response_credits(workspace_id,idempotency_key,kind,paid_delta,reason_code) values($1,'illegal-mint','purchase',1,'test')")
        .bind(&w).execute(&mut *denied).await.unwrap_err();
    assert_eq!(
        mint.as_database_error().unwrap().code().as_deref(),
        Some("42501")
    );
    denied.rollback().await.unwrap();
    let mut denied = api.pool().begin().await.unwrap();
    sqlx::query("select set_config('likerts.workspace_id',$1,true)")
        .bind(&w)
        .execute(&mut *denied)
        .await
        .unwrap();
    let mint = sqlx::query("select likerts.ensure_response_credit_onboarding($1)")
        .bind(&other)
        .execute(&mut *denied)
        .await
        .unwrap_err();
    assert_eq!(
        mint.as_database_error().unwrap().code().as_deref(),
        Some("42501")
    );
    denied.rollback().await.unwrap();
    let audit_count:i64=sqlx::query_scalar("select count(*) from likerts.audit_events where workspace_id=$1 and action='response_credits.insert'").bind(&w).fetch_one(admin.pool()).await.unwrap();
    assert_eq!(
        audit_count,
        api.credit_entries(&w).await.unwrap().len() as i64
    );
    let entries_before_delete: i64 =
        sqlx::query_scalar("select count(*) from likerts.response_credits where workspace_id=$1")
            .bind(&w)
            .fetch_one(admin.pool())
            .await
            .unwrap();
    api.erase_workspace(&w).await.unwrap();
    assert!(api.ensure_workspaces([&w]).await.is_err());
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "select count(*) from likerts.response_credits where workspace_id=$1"
        )
        .bind(&w)
        .fetch_one(admin.pool())
        .await
        .unwrap(),
        entries_before_delete
    );
}

#[tokio::test]
async fn browser_workspace_bootstrap_is_once_and_never_restores_revoked_ownership() {
    let Ok(admin_url) = std::env::var("LIKERTS_TEST_DATABASE_URL") else {
        eprintln!("skipping: run scripts/check-response-credits.sh");
        return;
    };
    let runtime_url = std::env::var("LIKERTS_TEST_RUNTIME_DATABASE_URL").unwrap();
    std::env::set_var(
        "LIKERTS_COLLECTION_CREDENTIAL_KEY",
        "bGlrZXJ0cy10ZXN0LWtleS1vbmx5LTMyeCEhISEhISE=",
    );
    let _admin = PgStore::connect(&admin_url).await.unwrap();
    let api = PgStore::connect_runtime(&runtime_url).await.unwrap();
    let suffix = Uuid::new_v4().simple().to_string();
    let workspace = format!("ws_{}", &suffix[..24]);
    let subject = format!("user_{suffix}");
    assert!(api
        .bootstrap_personal_workspace(&workspace, &subject)
        .await
        .unwrap());
    assert!(!api
        .bootstrap_personal_workspace(&workspace, &subject)
        .await
        .unwrap());
    assert_eq!(
        api.current_membership(&workspace, &subject).await.unwrap(),
        likerts_server::Role::Owner
    );
    assert_eq!(
        api.usage_summary(&workspace)
            .await
            .unwrap()
            .credits
            .available_credits,
        1000
    );
    assert_eq!(api.credit_entries(&workspace).await.unwrap().len(), 1);
    api.revoke_membership(&workspace, &subject).await.unwrap();
    assert_eq!(
        api.bootstrap_personal_workspace(&workspace, &subject).await,
        Err(Error::Forbidden)
    );
}
