use likerts_server::{
    exports::{render, sha256_hex},
    postgres::PgStore,
    Error, ExportFormat, ExportInput,
};
use sqlx::{PgPool, Row};
use uuid::Uuid;

async fn ready_export(store: &PgStore, workspace: &str) -> (String, String) {
    let job = store
        .create_export(
            workspace,
            ExportInput {
                idempotency_key: Uuid::new_v4().to_string(),
                format: ExportFormat::Json,
                collection_id: None,
                accepted_from: None,
                accepted_to: None,
            },
        )
        .await
        .unwrap();
    let lease = store
        .claim_export(workspace, &job.id)
        .await
        .unwrap()
        .unwrap();
    let key = format!("{}.{}.export", job.id, lease);
    let snapshot = store
        .export_snapshot(workspace, &job.id, &lease)
        .await
        .unwrap();
    store
        .complete_export(
            workspace,
            &job.id,
            &lease,
            &key,
            &sha256_hex(&render(&snapshot).unwrap()),
            &snapshot.manifest,
        )
        .await
        .unwrap();
    (job.id, key)
}

#[tokio::test]
async fn explicit_export_revocation_is_journaled_idempotent_and_fenced() {
    let Ok(owner_url) = std::env::var("LIKERTS_TEST_DATABASE_URL") else {
        eprintln!("skipping: PostgreSQL not configured");
        return;
    };
    let owner = PgPool::connect(&owner_url).await.unwrap();
    std::env::set_var(
        "LIKERTS_COLLECTION_CREDENTIAL_KEY",
        "bGlrZXJ0cy10ZXN0LWtleS1vbmx5LTMyeCEhISEhISE=",
    );
    let store =
        PgStore::connect_runtime(&std::env::var("LIKERTS_TEST_RUNTIME_DATABASE_URL").unwrap())
            .await
            .unwrap();
    let a = format!("revocation-a-{}", Uuid::new_v4());
    let b = format!("revocation-b-{}", Uuid::new_v4());
    store.ensure_workspaces([&a, &b]).await.unwrap();
    let (first, first_key) = ready_export(&store, &a).await;
    let (other, other_key) = ready_export(&store, &b).await;
    let (fenced, fenced_key) = ready_export(&store, &a).await;

    assert!(matches!(
        store.revoke_export(&a, &other).await,
        Err(Error::NotFound)
    ));
    assert_eq!(
        store.revoke_export(&a, &first).await.unwrap(),
        Some(first_key.clone())
    );
    let first_id = Uuid::parse_str(&first).unwrap();
    let count: i64 = sqlx::query_scalar(
        "select count(*) from likerts.deletion_events d join likerts.erasure_archive_outbox o on o.event_id=d.id where d.workspace_id=$1 and d.kind='export' and d.resource_id=$2 and o.body::jsonb->>'resourceId'=$2 and o.body::jsonb->>'workspaceId'=$1 and o.body_hash=encode(sha256(convert_to(o.body,'UTF8')),'hex')",
    )
    .bind(&a)
    .bind(&first)
    .fetch_one(&owner)
    .await
    .unwrap();
    assert_eq!(
        count, 1,
        "explicit revocation must append its independent archive event"
    );
    assert_eq!(store.revoke_export(&a, &first).await.unwrap(), None);
    let count: i64 = sqlx::query_scalar(
        "select count(*) from likerts.deletion_events where workspace_id=$1 and kind='export' and resource_id=$2",
    ).bind(&a).bind(&first).fetch_one(&owner).await.unwrap();
    assert_eq!(
        count, 1,
        "an identical revocation must not duplicate its journal/outbox"
    );
    let tracked: bool = sqlx::query_scalar(
        "select exists(select 1 from likerts.export_cleanup where workspace_id=$1 and export_id=$2 and object_key=$3 and next_attempt_at<=clock_timestamp())",
    ).bind(&a).bind(first_id).bind(&first_key).fetch_one(&owner).await.unwrap();
    assert!(tracked, "physical deletion remains durably scheduled");

    let before_queue: serde_json::Value =
        sqlx::query_scalar("select to_jsonb(q) from likerts.export_cleanup q where object_key=$1")
            .bind(&fenced_key)
            .fetch_one(&owner)
            .await
            .unwrap();
    let before_audit: i64 =
        sqlx::query_scalar("select count(*) from likerts.audit_events where workspace_id=$1")
            .bind(&a)
            .fetch_one(&owner)
            .await
            .unwrap();
    sqlx::query(
        "update likerts.erasure_archive_control set fence_id=$1,fenced_at=clock_timestamp()",
    )
    .bind(Uuid::new_v4())
    .execute(&owner)
    .await
    .unwrap();
    assert!(matches!(
        store.revoke_export(&a, &fenced).await,
        Err(Error::ErasureFenced)
    ));
    let after_queue: serde_json::Value =
        sqlx::query_scalar("select to_jsonb(q) from likerts.export_cleanup q where object_key=$1")
            .bind(&fenced_key)
            .fetch_one(&owner)
            .await
            .unwrap();
    assert_eq!(
        before_queue, after_queue,
        "fence rejection rolls back tombstone changes"
    );
    let row = sqlx::query("select status,object_key from likerts.export_jobs where id=$1")
        .bind(Uuid::parse_str(&fenced).unwrap())
        .fetch_one(&owner)
        .await
        .unwrap();
    assert_eq!(row.get::<String, _>("status"), "ready");
    assert_eq!(row.get::<String, _>("object_key"), fenced_key);
    let after_audit: i64 =
        sqlx::query_scalar("select count(*) from likerts.audit_events where workspace_id=$1")
            .bind(&a)
            .fetch_one(&owner)
            .await
            .unwrap();
    assert_eq!(
        before_audit, after_audit,
        "fence rejection rolls back audit changes"
    );
    sqlx::query("update likerts.erasure_archive_control set fence_id=null,fenced_at=null")
        .execute(&owner)
        .await
        .unwrap();
    assert_eq!(
        store.revoke_export(&a, &fenced).await.unwrap(),
        Some(fenced_key)
    );
    assert_eq!(
        store.export_object_key(&b, &other).await.unwrap(),
        other_key
    );
    let other_events: i64 =
        sqlx::query_scalar("select count(*) from likerts.deletion_events where workspace_id=$1")
            .bind(&b)
            .fetch_one(&owner)
            .await
            .unwrap();
    assert_eq!(
        other_events, 0,
        "another tenant's export is unchanged and unjournaled"
    );
    drop(store);
    owner.close().await;
}
