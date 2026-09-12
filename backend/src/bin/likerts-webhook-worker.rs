//! Restricted callback worker. It never initializes S3 or identity providers.
use base64::{engine::general_purpose::STANDARD, Engine};
use likerts_server::{
    webhook_store::WebhookStore,
    webhooks::{deliver, WebhookKeys},
};
use sqlx::postgres::PgPoolOptions;
use std::time::Duration;
use tokio::{sync::watch, task::JoinSet};

async fn shutdown() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("Unable to install worker SIGTERM handler");
        tokio::select! { _=tokio::signal::ctrl_c()=>{},_=terminate.recv()=>{} }
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c()
            .await
            .expect("Unable to install worker shutdown handler");
    }
}
#[tokio::main]
async fn main() {
    let url = std::env::var("LIKERTS_WEBHOOK_DATABASE_URL")
        .expect("LIKERTS_WEBHOOK_DATABASE_URL is required");
    let encoded = std::env::var("LIKERTS_WEBHOOK_CREDENTIAL_KEY")
        .expect("LIKERTS_WEBHOOK_CREDENTIAL_KEY is required");
    let bytes = STANDARD
        .decode(encoded)
        .expect("Webhook credential key must be base64");
    let keys = WebhookKeys::new(&bytes).expect("Webhook credential key must decode to 32 bytes");
    let concurrency = std::env::var("LIKERTS_WEBHOOK_CONCURRENCY")
        .unwrap_or_else(|_| "4".into())
        .parse::<u32>()
        .expect("Invalid webhook concurrency");
    assert!(
        (1..=16).contains(&concurrency),
        "Webhook concurrency must be between 1 and 16"
    );
    let pool = PgPoolOptions::new()
        .max_connections(concurrency)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&url)
        .await
        .expect("Unable to connect webhook worker storage");
    let store = WebhookStore::new(pool, keys);
    store
        .check_worker_role()
        .await
        .expect("Worker requires the restricted likerts_webhook_worker database role");
    if std::env::var("LIKERTS_WEBHOOK_CHECK_CONFIG").as_deref() == Ok("1") {
        println!("Webhook worker configuration and restricted role verified");
        return;
    }
    let (stop, receiver) = watch::channel(false);
    let mut tasks = JoinSet::new();
    for _ in 0..concurrency {
        let store = store.clone();
        let mut receiver = receiver.clone();
        tasks.spawn(async move {
            loop {
                if *receiver.borrow() {
                    break;
                }
                let delay = match store.claim().await {
                    Ok(Some(dispatch)) => {
                        match store.dispatch_active(&dispatch).await {
                            Ok(true) => {
                                let outcome = deliver(&dispatch).await;
                                if store.finish(&dispatch, outcome).await.is_err() {
                                    eprintln!("webhook_worker completion_persistence_failed");
                                }
                            }
                            Ok(false) => {}
                            Err(_) => eprintln!("webhook_worker dispatch_check_failed"),
                        }
                        Duration::from_millis(20)
                    }
                    Ok(None) => Duration::from_millis(1000),
                    Err(_) => {
                        eprintln!("webhook_worker claim_failed");
                        Duration::from_secs(5)
                    }
                };
                tokio::select! { _=tokio::time::sleep(delay)=>{},_=receiver.changed()=>{} }
            }
        });
    }
    eprintln!("webhook_worker started concurrency={concurrency}");
    tokio::select! { _=shutdown()=>{},result=tasks.join_next()=>{eprintln!("webhook_worker loop_ended unexpectedly={}",result.is_some());} }
    let _ = stop.send(true);
    if tokio::time::timeout(Duration::from_secs(25), async {
        while tasks.join_next().await.is_some() {}
    })
    .await
    .is_err()
    {
        tasks.abort_all();
    }
}
