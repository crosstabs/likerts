use async_trait::async_trait;
use chrono::{DateTime, Utc};
use likerts_server::{
    export_cleanup::ExportCleanup,
    exports::{render, sha256_hex, LocalObjectStore, ObjectStore},
    postgres::PgStore,
    Error, ExportFormat, ExportInput,
};
use sqlx::{PgPool, Row};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use uuid::Uuid;

#[derive(Default)]
struct Objects {
    fail: AtomicBool,
    deleted: Mutex<Vec<String>>,
}
#[async_trait]
impl ObjectStore for Objects {
    async fn put(&self, _: &str, _: &[u8], _: DateTime<Utc>) -> Result<(), Error> {
        unreachable!()
    }
    async fn get(&self, _: &str) -> Result<Vec<u8>, Error> {
        unreachable!()
    }
    async fn delete(&self, key: &str) -> Result<(), Error> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(Error::Internal);
        }
        self.deleted.lock().unwrap().push(key.into());
        Ok(())
    }
}

#[tokio::test]
async fn cleanup_survives_erasure_failures_and_fences_expired_attempts() {
    let Ok(owner_url) = std::env::var("LIKERTS_TEST_DATABASE_URL") else {
        eprintln!("skipping: PostgreSQL not configured");
        return;
    };
    let owner = PgPool::connect(&owner_url).await.unwrap();
    let runtime_url = std::env::var("LIKERTS_TEST_RUNTIME_DATABASE_URL").unwrap();
    std::env::set_var(
        "LIKERTS_COLLECTION_CREDENTIAL_KEY",
        "bGlrZXJ0cy10ZXN0LWtleS1vbmx5LTMyeCEhISEhISE=",
    );
    let runtime = PgPool::connect(&runtime_url).await.unwrap();
    let store = PgStore::connect_runtime(&runtime_url).await.unwrap();
    let worker = ExportCleanup(
        PgPool::connect(&std::env::var("LIKERTS_TEST_CLEANUP_DATABASE_URL").unwrap())
            .await
            .unwrap(),
    );
    worker.check_role().await.unwrap();
    assert!(ExportCleanup(owner.clone()).check_role().await.is_err());
    assert!(sqlx::query("select * from likerts.responses")
        .execute(&worker.0)
        .await
        .is_err());
    assert!(sqlx::query("select * from likerts.export_cleanup")
        .execute(&worker.0)
        .await
        .is_err());
    assert!(sqlx::query("select * from likerts.claim_export_cleanup()")
        .execute(&runtime)
        .await
        .is_err());
    let workspace = format!("cleanup-{}", Uuid::new_v4());
    store.ensure_workspaces([&workspace]).await.unwrap();
    let input = ExportInput {
        idempotency_key: "cleanup-ready".into(),
        format: ExportFormat::Json,
        collection_id: None,
        accepted_from: None,
        accepted_to: None,
    };
    let job = store
        .create_export(&workspace, input.clone())
        .await
        .unwrap();
    let lease = store
        .claim_export(&workspace, &job.id)
        .await
        .unwrap()
        .unwrap();
    let key = format!("{}.{}.export", job.id, lease);
    let count: i64 =
        sqlx::query_scalar("select count(*) from likerts.export_cleanup where object_key=$1")
            .bind(&key)
            .fetch_one(&owner)
            .await
            .unwrap();
    assert_eq!(count, 1, "attempt key exists before upload");
    let snapshot = store
        .export_snapshot(&workspace, &job.id, &lease)
        .await
        .unwrap();
    store
        .complete_export(
            &workspace,
            &job.id,
            &lease,
            &key,
            &sha256_hex(&render(&snapshot).unwrap()),
            &snapshot.manifest,
        )
        .await
        .unwrap();
    // Force only this candidate due. A ready, unexpired winner must be protected.
    sqlx::query("update likerts.export_cleanup set next_attempt_at=clock_timestamp()-interval '1 second' where object_key=$1").bind(&key).execute(&owner).await.unwrap();
    let objects = Objects::default();
    assert!(!worker.one(&objects).await.unwrap());
    assert!(objects.deleted.lock().unwrap().is_empty());
    store.revoke_export(&workspace, &job.id).await.unwrap();
    objects.fail.store(true, Ordering::SeqCst);
    assert_eq!(
        worker.one(&objects).await,
        Err("cleanup_storage_retry_scheduled")
    );
    assert_eq!(worker.status().await.unwrap()["retryingObjects"], 1);
    // Workspace erasure removes tenant authorization but must preserve cleanup.
    store.erase_workspace(&workspace).await.unwrap();
    objects.fail.store(false, Ordering::SeqCst);
    sqlx::query("update likerts.export_cleanup set next_attempt_at=clock_timestamp()-interval '1 second' where object_key=$1").bind(&key).execute(&owner).await.unwrap();
    assert!(worker.one(&objects).await.unwrap());
    assert_eq!(*objects.deleted.lock().unwrap(), vec![key.clone()]);
    assert_eq!(worker.status().await.unwrap()["retryingObjects"], 0);
    // A late provider PUT is covered by a retained, periodically swept tombstone.
    // Exercise actual bytes appearing AFTER a successful deletion, not just a
    // mock delete counter. This directory belongs only to this test.
    let directory = std::env::temp_dir().join(format!("likerts-cleanup-{}", Uuid::new_v4()));
    let physical = LocalObjectStore::new(&directory).unwrap();
    physical
        .put(&key, b"late private export", Utc::now())
        .await
        .unwrap();
    assert_eq!(physical.get(&key).await.unwrap(), b"late private export");
    sqlx::query("update likerts.export_cleanup set next_attempt_at=clock_timestamp()-interval '1 second' where object_key=$1").bind(&key).execute(&owner).await.unwrap();
    assert!(worker.one(&physical).await.unwrap());
    assert!(physical.get(&key).await.is_err());
    assert!(!directory.join(&key).exists());
    std::fs::remove_dir(&directory).unwrap();

    let second = format!("cleanup-{}", Uuid::new_v4());
    store.ensure_workspaces([&second]).await.unwrap();
    let job = store.create_export(&second, input).await.unwrap();
    let lease = store.claim_export(&second, &job.id).await.unwrap().unwrap();
    let key = format!("{}.{}.export", job.id, lease);
    let snapshot = store
        .export_snapshot(&second, &job.id, &lease)
        .await
        .unwrap();
    sqlx::query("update likerts.export_jobs set lease_expires_at=clock_timestamp()-interval '2 minutes' where id=$1").bind(Uuid::parse_str(&job.id).unwrap()).execute(&owner).await.unwrap();
    sqlx::query("update likerts.export_cleanup set next_attempt_at=clock_timestamp()-interval '1 second' where object_key=$1").bind(&key).execute(&owner).await.unwrap();
    let mut transaction = worker.0.begin().await.unwrap();
    sqlx::query("select set_config('likerts.workspace_id','prior-scope',true)")
        .execute(&mut *transaction)
        .await
        .unwrap();
    let row = sqlx::query("select * from likerts.claim_export_cleanup()")
        .fetch_one(&mut *transaction)
        .await
        .unwrap();
    let cleanup_lease: Uuid = row.get("lease_id");
    assert_eq!(row.get::<String, _>("object_key"), key);
    let scope: String = sqlx::query_scalar("select current_setting('likerts.workspace_id')")
        .fetch_one(&mut *transaction)
        .await
        .unwrap();
    assert_eq!(scope, "prior-scope");
    transaction.commit().await.unwrap();
    assert!(store
        .complete_export(
            &second,
            &job.id,
            &lease,
            &key,
            "irrelevant",
            &snapshot.manifest
        )
        .await
        .is_err());
    assert!(
        !worker.one(&objects).await.unwrap(),
        "a current cleanup lease excludes another worker"
    );
    let finished: bool = sqlx::query_scalar("select likerts.finish_export_cleanup($1,$2,true)")
        .bind(&key)
        .bind(Uuid::new_v4())
        .fetch_one(&worker.0)
        .await
        .unwrap();
    assert!(!finished, "wrong lease cannot acknowledge");
    sqlx::query("update likerts.export_cleanup set lease_expires_at=clock_timestamp()-interval '1 second' where object_key=$1").bind(&key).execute(&owner).await.unwrap();
    assert!(
        worker.one(&objects).await.unwrap(),
        "crashed worker's lease recovers"
    );
    let finished: bool = sqlx::query_scalar("select likerts.finish_export_cleanup($1,$2,true)")
        .bind(&key)
        .bind(cleanup_lease)
        .fetch_one(&worker.0)
        .await
        .unwrap();
    assert!(!finished, "old worker cannot acknowledge replacement lease");
}

// These fixtures only run against the disposable database created by
// scripts/check-postgres.sh. Tests are serialized because grants are role-wide.
async fn maintenance_pools() -> Option<(PgPool, PgPool, ExportCleanup)> {
    let Ok(url) = std::env::var("LIKERTS_TEST_DATABASE_URL") else {
        return None;
    };
    Some((
        PgPool::connect(&url).await.unwrap(),
        PgPool::connect(&std::env::var("LIKERTS_TEST_RUNTIME_DATABASE_URL").unwrap())
            .await
            .unwrap(),
        ExportCleanup(
            PgPool::connect(&std::env::var("LIKERTS_TEST_CLEANUP_DATABASE_URL").unwrap())
                .await
                .unwrap(),
        ),
    ))
}

async fn seed_responses(owner: &PgPool, workspace: &str, count: i32, age_days: i32) {
    let survey = Uuid::new_v4();
    let collection = Uuid::new_v4();
    sqlx::query("insert into likerts.surveys(workspace_id,id,revision,title,questions) values($1,$2,1,'Retention fixture','[]')").bind(workspace).bind(survey).execute(owner).await.unwrap();
    sqlx::query("insert into likerts.survey_versions(workspace_id,survey_id,version,title,questions,sdk_capabilities) values($1,$2,1,'Retention fixture','[]','{}')").bind(workspace).bind(survey).execute(owner).await.unwrap();
    sqlx::query("insert into likerts.collections(workspace_id,id,survey_id,version,placement,token_hash,sdk_capabilities) values($1,$2,$3,1,'retention',decode(replace($2::text,'-','')||replace($2::text,'-',''),'hex'),'{}')").bind(workspace).bind(collection).bind(survey).execute(owner).await.unwrap();
    sqlx::query("insert into likerts.responses(workspace_id,id,collection_id,idempotency_key,answers,metadata,accepted_at) select $1,gen_random_uuid(),$2,n::text,'{\"answer\":\"private\"}','{\"account\":\"private\"}',clock_timestamp()-$4*interval '1 day' from generate_series(1,$3) n").bind(workspace).bind(collection).bind(count).bind(age_days).execute(owner).await.unwrap();
    // Preserve the ingestion ledger invariant also checked by the following
    // PostgreSQL integration binary against this same disposable database.
    sqlx::query("insert into likerts.usage_entries(workspace_id,response_id,amount_cents,created_at) select workspace_id,id,1,accepted_at from likerts.responses where workspace_id=$1 and collection_id=$2").bind(workspace).bind(collection).execute(owner).await.unwrap();
    sqlx::query("update likerts.collections set accepted_count=$3 where workspace_id=$1 and id=$2")
        .bind(workspace)
        .bind(collection)
        .bind(i64::from(count))
        .execute(owner)
        .await
        .unwrap();
}

async fn seed_ready_exports(owner: &PgPool, workspace: &str, count: i32) {
    sqlx::query("insert into likerts.export_jobs(workspace_id,id,idempotency_key,request_hash,format,upper_sequence,status,object_key,response_count,content_sha256,manifest) select $1,id,n::text,decode(repeat('00',32),'hex'),'json',0,'ready',id::text||'.fixture.export',0,repeat('0',64),'{}' from (select n,gen_random_uuid() id from generate_series(1,$2) n) fixtures").bind(workspace).bind(count).execute(owner).await.unwrap();
}

#[tokio::test]
async fn retention_is_bounded_atomic_and_tenant_scoped() {
    let Some((owner, runtime, worker)) = maintenance_pools().await else {
        return;
    };
    let a = format!("retention-a-{}", Uuid::new_v4());
    let b = format!("retention-b-{}", Uuid::new_v4());
    for workspace in [&a, &b] {
        sqlx::query("insert into likerts.workspaces(id,retention_days) values($1,1)")
            .bind(workspace)
            .execute(&owner)
            .await
            .unwrap();
    }
    seed_responses(&owner, &a, 1001, 2).await;
    seed_responses(&owner, &a, 1, 0).await;
    seed_responses(&owner, &b, 1, 2).await;
    seed_ready_exports(&owner, &a, 1001).await;
    seed_ready_exports(&owner, &b, 1).await;
    // Isolate this batch from workspaces left by earlier tests. The scheduler
    // itself, not its caller, chooses the due workspace and retention cutoff.
    sqlx::query(
        "update likerts.retention_schedule set next_run_at=clock_timestamp()+interval '1 day'",
    )
    .execute(&owner)
    .await
    .unwrap();
    sqlx::query("update likerts.retention_schedule set next_run_at=clock_timestamp()-interval '1 second' where workspace_id=$1").bind(&a).execute(&owner).await.unwrap();
    for pool in [&runtime, &worker.0] {
        assert!(sqlx::query("select * from likerts.retention_schedule")
            .execute(pool)
            .await
            .is_err());
    }
    assert!(sqlx::query("select likerts.run_scheduled_retention()")
        .execute(&runtime)
        .await
        .is_err());
    let forced: bool = sqlx::query_scalar("select bool_and(relrowsecurity and relforcerowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='likerts' and c.relname in ('retention_schedule','responses','export_jobs')").fetch_one(&owner).await.unwrap();
    assert!(forced);
    let mut transaction = worker.0.begin().await.unwrap();
    sqlx::query("select set_config('likerts.workspace_id',$1,true)")
        .bind(&b)
        .execute(&mut *transaction)
        .await
        .unwrap();
    let first: serde_json::Value = sqlx::query_scalar("select likerts.run_scheduled_retention()")
        .fetch_one(&mut *transaction)
        .await
        .unwrap();
    assert_eq!(
        first,
        serde_json::json!({"worked":true,"responsesErased":1000,"exportsRevoked":1000})
    );
    let scope: String = sqlx::query_scalar("select current_setting('likerts.workspace_id')")
        .fetch_one(&mut *transaction)
        .await
        .unwrap();
    assert_eq!(scope, b, "maintenance restores the caller's scope");
    // Rollback proves erasure, journal, object tombstones and scheduling form
    // one transaction rather than independently committed side effects.
    transaction.rollback().await.unwrap();
    let count: i64 =
        sqlx::query_scalar("select count(*) from likerts.deletion_events where workspace_id=$1")
            .bind(&a)
            .fetch_one(&owner)
            .await
            .unwrap();
    assert_eq!(count, 0);
    let count: i64 = sqlx::query_scalar("select count(*) from likerts.responses where workspace_id=$1 and raw_deleted_at is not null").bind(&a).fetch_one(&owner).await.unwrap();
    assert_eq!(count, 0);
    assert_eq!(worker.retention().await.unwrap(), first);
    let fast_retry: bool = sqlx::query_scalar("select next_run_at<clock_timestamp()+interval '5 seconds' from likerts.retention_schedule where workspace_id=$1").bind(&a).fetch_one(&owner).await.unwrap();
    assert!(
        fast_retry,
        "a full batch schedules the remaining backlog promptly"
    );
    sqlx::query("update likerts.retention_schedule set next_run_at=clock_timestamp()-interval '1 second' where workspace_id=$1").bind(&a).execute(&owner).await.unwrap();
    assert_eq!(
        worker.retention().await.unwrap(),
        serde_json::json!({"worked":true,"responsesErased":1,"exportsRevoked":1})
    );
    assert_eq!(
        worker.retention().await.unwrap(),
        serde_json::json!({"worked":false})
    );
    let row = sqlx::query("select count(*) filter(where answers is null and metadata is null and raw_deleted_at is not null) erased,count(*) filter(where answers is not null and metadata is not null and raw_deleted_at is null) live from likerts.responses where workspace_id=$1").bind(&a).fetch_one(&owner).await.unwrap();
    assert_eq!(row.get::<i64, _>("erased"), 1001);
    assert_eq!(row.get::<i64, _>("live"), 1);
    let count: i64 = sqlx::query_scalar("select count(*) from likerts.deletion_events d join likerts.erasure_archive_outbox o on o.event_id=d.id where d.workspace_id=$1").bind(&a).fetch_one(&owner).await.unwrap();
    assert_eq!(
        count, 2002,
        "every erased response and revoked export has an archival journal event"
    );
    let count: i64 = sqlx::query_scalar("select count(*) from likerts.export_jobs j join likerts.export_cleanup q on q.export_id=j.id where j.workspace_id=$1 and j.status='revoked' and j.object_key is null and q.next_attempt_at<=clock_timestamp()").bind(&a).fetch_one(&owner).await.unwrap();
    assert_eq!(
        count, 1001,
        "all revoked physical objects retain due deletion tombstones"
    );
    let count: i64 = sqlx::query_scalar("select count(*) from likerts.responses where workspace_id=$1 and raw_deleted_at is null and answers is not null").bind(&b).fetch_one(&owner).await.unwrap();
    assert_eq!(count, 1);
    let count: i64 = sqlx::query_scalar("select count(*) from likerts.export_jobs where workspace_id=$1 and status='ready' and object_key is not null").bind(&b).fetch_one(&owner).await.unwrap();
    assert_eq!(count, 1);
    let count: i64 =
        sqlx::query_scalar("select count(*) from likerts.deletion_events where workspace_id=$1")
            .bind(&b)
            .fetch_one(&owner)
            .await
            .unwrap();
    assert_eq!(count, 0);
    // A no-op subsequent pass does not duplicate journal entries.
    sqlx::query("update likerts.retention_schedule set next_run_at=clock_timestamp()-interval '1 second' where workspace_id=$1").bind(&a).execute(&owner).await.unwrap();
    assert_eq!(
        worker.retention().await.unwrap(),
        serde_json::json!({"worked":true,"responsesErased":0,"exportsRevoked":0})
    );
    // Do not leave a due object backlog for another test's global worker.
    sqlx::query("update likerts.export_cleanup set next_attempt_at=clock_timestamp()+interval '1 day' where workspace_id=$1").bind(&a).execute(&owner).await.unwrap();
}

#[tokio::test]
async fn restricted_role_rejects_adversarial_grants() {
    let Some((owner, _, worker)) = maintenance_pools().await else {
        return;
    };
    worker.check_role().await.unwrap();
    for (grant, revoke) in [
        (
            "grant execute on function likerts.erasure_archive_status() to likerts_export_cleanup",
            "revoke execute on function likerts.erasure_archive_status() from likerts_export_cleanup",
        ),
        (
            "grant select on likerts.responses to likerts_export_cleanup",
            "revoke select on likerts.responses from likerts_export_cleanup",
        ),
        (
            "grant select(answers) on likerts.responses to likerts_export_cleanup",
            "revoke select(answers) on likerts.responses from likerts_export_cleanup",
        ),
        (
            "grant update(metadata) on likerts.responses to likerts_export_cleanup",
            "revoke update(metadata) on likerts.responses from likerts_export_cleanup",
        ),
        (
            "grant create on schema likerts to likerts_export_cleanup",
            "revoke create on schema likerts from likerts_export_cleanup",
        ),
        (
            "alter role likerts_export_cleanup createdb",
            "alter role likerts_export_cleanup nocreatedb",
        ),
        (
            "alter role likerts_export_cleanup inherit",
            "alter role likerts_export_cleanup noinherit",
        ),
        (
            "grant likerts_runtime_test to likerts_export_cleanup",
            "revoke likerts_runtime_test from likerts_export_cleanup",
        ),
    ] {
        sqlx::query(grant).execute(&owner).await.unwrap();
        let result = worker.check_role().await;
        sqlx::query(revoke).execute(&owner).await.unwrap();
        assert_eq!(
            result,
            Err("cleanup_requires_restricted_role"),
            "unsafe grant accepted: {grant}"
        );
        worker.check_role().await.unwrap();
    }
}

#[tokio::test]
async fn cleanup_workers_skip_locked_jobs_fairly_and_claim_once() {
    let Some((owner, _, worker)) = maintenance_pools().await else {
        return;
    };
    let workspace = format!("cleanup-locks-{}", Uuid::new_v4());
    sqlx::query("insert into likerts.workspaces(id) values($1)")
        .bind(&workspace)
        .execute(&owner)
        .await
        .unwrap();
    seed_ready_exports(&owner, &workspace, 33).await;
    let ids: Vec<Uuid> =
        sqlx::query_scalar("select id from likerts.export_jobs where workspace_id=$1 order by id")
            .bind(&workspace)
            .fetch_all(&owner)
            .await
            .unwrap();
    sqlx::query("update likerts.export_jobs set status='revoked',object_key=null,response_count=null,content_sha256=null,manifest=null where workspace_id=$1").bind(&workspace).execute(&owner).await.unwrap();
    sqlx::query("update likerts.export_cleanup set next_attempt_at=clock_timestamp()-interval '2 days' where export_id=any($1)").bind(&ids[..32]).execute(&owner).await.unwrap();
    sqlx::query("update likerts.export_cleanup set next_attempt_at=clock_timestamp()-interval '1 day' where export_id=$1").bind(ids[32]).execute(&owner).await.unwrap();
    let mut lock = owner.begin().await.unwrap();
    sqlx::query("select id from likerts.export_jobs where id=any($1) for update")
        .bind(&ids[..32])
        .fetch_all(&mut *lock)
        .await
        .unwrap();
    let objects = Objects::default();
    assert!(
        !tokio::time::timeout(std::time::Duration::from_secs(2), worker.one(&objects))
            .await
            .expect("locked jobs must not block cleanup")
            .unwrap()
    );
    assert!(
        objects.deleted.lock().unwrap().is_empty(),
        "a locked job cannot be treated as missing"
    );
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(2), worker.one(&objects))
            .await
            .expect("old locked candidates must rotate behind other work")
            .unwrap()
    );
    assert_eq!(
        *objects.deleted.lock().unwrap(),
        vec![format!("{}.fixture.export", ids[32])]
    );
    lock.rollback().await.unwrap();
    sqlx::query("update likerts.export_cleanup set next_attempt_at=clock_timestamp()+interval '1 day' where workspace_id=$1").bind(&workspace).execute(&owner).await.unwrap();

    let key = format!("{}.orphan.export", Uuid::new_v4());
    sqlx::query("insert into likerts.export_cleanup(object_key,workspace_id,export_id,next_attempt_at) values($1,$2,$3,clock_timestamp()-interval '1 second')").bind(&key).bind(&workspace).bind(Uuid::new_v4()).execute(&owner).await.unwrap();
    let (a, b) = tokio::join!(
        sqlx::query("select * from likerts.claim_export_cleanup()").fetch_optional(&worker.0),
        sqlx::query("select * from likerts.claim_export_cleanup()").fetch_optional(&worker.0)
    );
    let claims: Vec<_> = [a.unwrap(), b.unwrap()].into_iter().flatten().collect();
    assert_eq!(
        claims.len(),
        1,
        "concurrent callers cannot share a live cleanup lease"
    );
    assert_eq!(claims[0].get::<String, _>("object_key"), key);
    let finished: bool = sqlx::query_scalar("select likerts.finish_export_cleanup($1,$2,true)")
        .bind(&key)
        .bind(claims[0].get::<Uuid, _>("lease_id"))
        .fetch_one(&worker.0)
        .await
        .unwrap();
    assert!(finished);

    // A stale attempt for the same job is disposable, but a newer ready
    // winner must remain downloadable until expiry.
    let winner_workspace = format!("cleanup-winner-{}", Uuid::new_v4());
    sqlx::query("insert into likerts.workspaces(id) values($1)")
        .bind(&winner_workspace)
        .execute(&owner)
        .await
        .unwrap();
    seed_ready_exports(&owner, &winner_workspace, 1).await;
    let job: Uuid = sqlx::query_scalar("select id from likerts.export_jobs where workspace_id=$1")
        .bind(&winner_workspace)
        .fetch_one(&owner)
        .await
        .unwrap();
    let old_key = format!("{}.{}.export", job, Uuid::new_v4());
    sqlx::query("insert into likerts.export_cleanup(object_key,workspace_id,export_id,next_attempt_at) values($1,$2,$3,clock_timestamp()-interval '1 second')").bind(&old_key).bind(&winner_workspace).bind(job).execute(&owner).await.unwrap();
    sqlx::query("update likerts.export_cleanup set next_attempt_at=clock_timestamp()-interval '1 second' where workspace_id=$1").bind(&winner_workspace).execute(&owner).await.unwrap();
    let old_objects = Objects::default();
    assert!(worker.one(&old_objects).await.unwrap());
    assert!(!worker.one(&old_objects).await.unwrap());
    assert_eq!(*old_objects.deleted.lock().unwrap(), vec![old_key]);
    let ready: bool = sqlx::query_scalar(
        "select status='ready' and object_key=$2 from likerts.export_jobs where id=$1",
    )
    .bind(job)
    .bind(format!("{job}.fixture.export"))
    .fetch_one(&owner)
    .await
    .unwrap();
    assert!(ready);
}
