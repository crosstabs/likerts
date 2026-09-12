use likerts_server::{
    postgres::PgStore, DraftInput, Error, ExportFormat, ExportInput, ExportStatus, Question,
};
use serde_json::json;
use uuid::Uuid;

fn input(key: &str) -> ExportInput {
    ExportInput {
        idempotency_key: key.into(),
        format: ExportFormat::Json,
        collection_id: None,
        accepted_from: None,
        accepted_to: None,
    }
}
async fn expire(admin: &PgStore, workspace: &str, id: &str) {
    sqlx::query("update likerts.export_jobs set lease_expires_at=now()-interval '1 second' where workspace_id=$1 and id=$2")
        .bind(workspace).bind(Uuid::parse_str(id).unwrap()).execute(admin.pool()).await.unwrap();
}
#[tokio::test]
async fn interrupted_export_reclaims_with_fencing_and_tenant_isolation() {
    let Ok(url) = std::env::var("LIKERTS_TEST_DATABASE_URL") else {
        eprintln!("SKIP: use scripts/check-export-leases.sh for restricted PostgreSQL");
        return;
    };
    let runtime = std::env::var("LIKERTS_TEST_RUNTIME_DATABASE_URL").unwrap();
    std::env::set_var(
        "LIKERTS_COLLECTION_CREDENTIAL_KEY",
        "bGlrZXJ0cy10ZXN0LWtleS1vbmx5LTMyeCEhISEhISE=",
    );
    let admin = PgStore::connect(&url).await.unwrap();
    let api = PgStore::connect_runtime(&runtime).await.unwrap();
    let workspace = format!("lease-{}", Uuid::new_v4());
    let other = format!("other-{}", Uuid::new_v4());
    api.ensure_workspaces([&workspace, &other]).await.unwrap();
    let question: Question = serde_json::from_value(
        json!({"id":"score","type":"scale","label":"Score","min":1,"max":5,"required":true}),
    )
    .unwrap();
    api.create_survey(
        &workspace,
        DraftInput {
            title: "Lease fixture".into(),
            questions: vec![question],
            pages: None,
        },
    )
    .await
    .unwrap();
    let job = api
        .create_export(&workspace, input("crashed"))
        .await
        .unwrap();
    let abandoned = api
        .claim_export(&workspace, &job.id)
        .await
        .unwrap()
        .unwrap();
    let snapshot = api
        .export_snapshot(&workspace, &job.id, &abandoned)
        .await
        .unwrap();
    assert!(api
        .claim_export(&workspace, &job.id)
        .await
        .unwrap()
        .is_none());
    assert!(api.claim_export(&other, &job.id).await.unwrap().is_none());
    assert!(matches!(
        api.export_snapshot(&other, &job.id, &abandoned).await,
        Err(Error::NotFound)
    ));
    // The claim is committed before execution. Closing the connection pool models
    // its process disappearing: a replacement must recover solely from durable state.
    api.pool().close().await;
    drop(api);
    let replacement = PgStore::connect_runtime(&runtime).await.unwrap();
    assert!(replacement
        .claim_export(&workspace, &job.id)
        .await
        .unwrap()
        .is_none());
    expire(&admin, &workspace, &job.id).await;
    let mut contenders = Vec::new();
    for _ in 0..8 {
        let store = replacement.clone();
        let workspace = workspace.clone();
        let id = job.id.clone();
        contenders.push(tokio::spawn(async move {
            store.claim_export(&workspace, &id).await.unwrap()
        }));
    }
    let mut winners = Vec::new();
    for c in contenders {
        if let Some(lease) = c.await.unwrap() {
            winners.push(lease)
        }
    }
    assert_eq!(winners.len(), 1);
    let winner = &winners[0];
    assert_ne!(winner, &abandoned);
    assert!(matches!(
        replacement
            .export_snapshot(&workspace, &job.id, &abandoned)
            .await,
        Err(Error::NotReady)
    ));
    assert!(matches!(
        replacement
            .complete_export(
                &workspace,
                &job.id,
                &abandoned,
                "stale.export",
                "old",
                &snapshot.manifest
            )
            .await,
        Err(Error::Conflict)
    ));
    replacement
        .fail_export(&workspace, &job.id, &abandoned, "stale_failure")
        .await
        .unwrap();
    assert_eq!(
        replacement
            .export_job(&workspace, &job.id)
            .await
            .unwrap()
            .status,
        ExportStatus::Running
    );
    let retained = replacement
        .export_snapshot(&workspace, &job.id, winner)
        .await
        .unwrap();
    assert_eq!(
        retained.manifest.snapshot_upper_sequence,
        snapshot.manifest.snapshot_upper_sequence
    );
    replacement
        .complete_export(
            &workspace,
            &job.id,
            winner,
            "winner.export",
            "new",
            &retained.manifest,
        )
        .await
        .unwrap();
    replacement
        .fail_export(&workspace, &job.id, &abandoned, "stale_failure")
        .await
        .unwrap();
    assert_eq!(
        replacement
            .export_object_key(&workspace, &job.id)
            .await
            .unwrap(),
        "winner.export"
    );
    assert_eq!(
        replacement
            .create_export(&workspace, input("crashed"))
            .await
            .unwrap()
            .id,
        job.id
    );

    // An abandoned reservation cannot pin the one-active-export slot forever.
    let abandoned_job = replacement
        .create_export(&workspace, input("old-slot"))
        .await
        .unwrap();
    let old_lease = replacement
        .claim_export(&workspace, &abandoned_job.id)
        .await
        .unwrap()
        .unwrap();
    expire(&admin, &workspace, &abandoned_job.id).await;
    let next = replacement
        .create_export(&workspace, input("new-slot"))
        .await
        .unwrap();
    assert_eq!(
        replacement
            .export_job(&workspace, &abandoned_job.id)
            .await
            .unwrap()
            .status,
        ExportStatus::Failed
    );
    assert!(matches!(
        replacement
            .create_export(&workspace, input("old-slot"))
            .await,
        Err(Error::Capacity)
    ));
    assert!(matches!(
        replacement
            .complete_export(
                &workspace,
                &abandoned_job.id,
                &old_lease,
                "old.export",
                "old",
                &snapshot.manifest
            )
            .await,
        Err(Error::Conflict)
    ));
    let next_lease = replacement
        .claim_export(&workspace, &next.id)
        .await
        .unwrap()
        .unwrap();
    replacement
        .revoke_export(&workspace, &next.id)
        .await
        .unwrap();
    assert!(matches!(
        replacement
            .complete_export(
                &workspace,
                &next.id,
                &next_lease,
                "revoked.export",
                "old",
                &snapshot.manifest
            )
            .await,
        Err(Error::Conflict)
    ));

    // The HTTP status endpoint on a replacement API resumes an expired claim.
    let poll = replacement
        .create_export(&workspace, input("resume-by-poll"))
        .await
        .unwrap();
    replacement
        .claim_export(&workspace, &poll.id)
        .await
        .unwrap()
        .unwrap();
    expire(&admin, &workspace, &poll.id).await;
    let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = socket.local_addr().unwrap().port();
    drop(socket);
    let export_dir = std::env::temp_dir().join(format!("likerts-export-lease-{}", Uuid::new_v4()));
    struct ChildGuard(std::process::Child, std::path::PathBuf);
    impl Drop for ChildGuard {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
            let _ = std::fs::remove_dir_all(&self.1);
        }
    }
    let _server = ChildGuard(
        std::process::Command::new(env!("CARGO_BIN_EXE_likerts-server"))
            .env("DATABASE_URL", &runtime)
            .env("LIKERTS_PORT", port.to_string())
            .env("LIKERTS_ALLOW_DEV_AUTH", "1")
            .env("LIKERTS_ADMISSION_MODE", "disabled")
            .env(
                "LIKERTS_DEV_TOKENS",
                serde_json::to_string(&json!({"lease-recovery-token":workspace})).unwrap(),
            )
            .env("LIKERTS_EXPORT_PROVIDER", "local")
            .env("LIKERTS_EXPORT_DIR", &export_dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap(),
        export_dir,
    );
    let client = reqwest::Client::new();
    let origin = format!("http://127.0.0.1:{port}");
    let mut ready = false;
    for _ in 0..300 {
        if client.get(format!("{origin}/health")).send().await.is_ok() {
            ready = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert!(ready);
    let mut completed = false;
    for _ in 0..150 {
        let response = client
            .get(format!("{origin}/v1/exports/{}", poll.id))
            .bearer_auth("lease-recovery-token")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let body: serde_json::Value = response.json().await.unwrap();
        if body["status"] == "ready" {
            completed = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert!(
        completed,
        "authorized status polling must restart durable work"
    );
    let response = client
        .get(format!("{origin}/v1/exports/{}/download", poll.id))
        .bearer_auth("lease-recovery-token")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(
        replacement
            .create_export(&workspace, input("resume-by-poll"))
            .await
            .unwrap()
            .id,
        poll.id
    );
}
