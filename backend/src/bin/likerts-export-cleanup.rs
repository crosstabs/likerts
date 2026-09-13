//! Restricted export deletion worker; no management/identity credentials.
use likerts_server::{
    export_cleanup::ExportCleanup,
    exports::{LocalObjectStore, ObjectStore, S3ObjectStore, VercelBlobObjectStore},
};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions, PgSslMode};
use std::{str::FromStr, time::Duration};

fn database_options(value: &str, local: bool) -> Result<PgConnectOptions, &'static str> {
    let url = reqwest::Url::parse(value).map_err(|_| "invalid_cleanup_database_url")?;
    if !matches!(url.scheme(), "postgres" | "postgresql")
        || url.username() != "likerts_export_cleanup"
        || url.fragment().is_some()
        || url.host_str().is_none()
        || url
            .query_pairs()
            .any(|(key, _)| !matches!(key.as_ref(), "sslmode" | "application_name"))
    {
        return Err("invalid_cleanup_database_url");
    }
    let loopback = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if local && !loopback {
        return Err("local_cleanup_requires_loopback_database");
    }
    let options = PgConnectOptions::from_str(value).map_err(|_| "invalid_cleanup_database_url")?;
    // Override weaker URL settings; hosted connections verify the server name.
    Ok(options.ssl_mode(if local {
        PgSslMode::Disable
    } else {
        PgSslMode::VerifyFull
    }))
}

async fn run() -> Result<(), &'static str> {
    let command = std::env::args().nth(1).unwrap_or_else(|| "once".into());
    if std::env::args().count() > 2 {
        return Err("unexpected_cleanup_arguments");
    }
    if !matches!(command.as_str(), "once" | "worker" | "status" | "check") {
        return Err("expected_once_worker_status_or_check");
    }
    let url = std::env::var("LIKERTS_CLEANUP_DATABASE_URL")
        .map_err(|_| "cleanup_database_url_required")?;
    let local = match std::env::var("LIKERTS_CLEANUP_ALLOW_LOCAL_INSECURE").as_deref() {
        Ok("1") => true,
        Err(_) | Ok("0") => false,
        _ => return Err("invalid_local_cleanup_switch"),
    };
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(5))
        .after_connect(|connection, _| {
            Box::pin(async move {
                sqlx::query("set statement_timeout='10s'")
                    .execute(connection)
                    .await?;
                Ok(())
            })
        })
        .connect_with(database_options(&url, local)?)
        .await
        .map_err(|_| "cleanup_database_connection_failed")?;
    let cleanup = ExportCleanup(pool);
    cleanup.check_role().await?;
    if command == "status" {
        println!(
            "{}",
            serde_json::json!({"cleanup":cleanup.status().await?,"retention":cleanup.retention_status().await?})
        );
        return Ok(());
    }
    if command == "check" {
        println!("cleanup_role_verified");
        return Ok(());
    }
    let prefix = std::env::var("LIKERTS_EXPORT_PREFIX").unwrap_or_else(|_| "exports".into());
    let objects: Box<dyn ObjectStore> = match std::env::var("LIKERTS_EXPORT_STORE").as_deref() {
        Ok("vercel_blob") => Box::new(
            VercelBlobObjectStore::new(
                std::env::var("LIKERTS_VERCEL_BLOB_TOKEN").map_err(|_| "blob_token_required")?,
                prefix,
            )
            .map_err(|_| "invalid_blob_configuration")?,
        ),
        Ok("s3") => Box::new(
            S3ObjectStore::from_environment(
                std::env::var("LIKERTS_EXPORT_BUCKET").map_err(|_| "export_bucket_required")?,
                prefix,
            )
            .await
            .map_err(|_| "invalid_s3_configuration")?,
        ),
        Ok("local") if std::env::var("LIKERTS_ALLOW_LOCAL_CLEANUP").as_deref() == Ok("1") => {
            Box::new(
                LocalObjectStore::new(
                    std::env::var("LIKERTS_EXPORT_DIR").map_err(|_| "export_directory_required")?,
                )
                .map_err(|_| "invalid_local_configuration")?,
            )
        }
        _ => return Err("explicit_export_store_required"),
    };
    if command == "once" {
        println!("retention={}", cleanup.retention().await?);
        println!("cleanup_worked={}", cleanup.one(objects.as_ref()).await?);
        return Ok(());
    }
    // Stop taking work on SIGTERM; a canceled deletion retains its database lease
    // and is retried. The provider key is never removed from the tombstone table.
    #[cfg(unix)]
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .map_err(|_| "signal_configuration_failed")?;
    loop {
        let work = async {
            if let Err(error) = cleanup.retention().await {
                eprintln!("{error}");
            }
            let delay = match cleanup.one(objects.as_ref()).await {
                Ok(true) => Duration::from_millis(100),
                Ok(false) => Duration::from_secs(5),
                Err(error) => {
                    eprintln!("{error}");
                    Duration::from_secs(5)
                }
            };
            tokio::time::sleep(delay).await;
        };
        #[cfg(unix)]
        tokio::select! { _=work=>{},_=terminate.recv()=>break,_=tokio::signal::ctrl_c()=>break }
        #[cfg(not(unix))]
        tokio::select! { _=work=>{},_=tokio::signal::ctrl_c()=>break }
    }
    Ok(())
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn database_identity_and_tls_cannot_be_redirected_by_options() {
        assert!(database_options(
            "postgres://likerts_export_cleanup:synthetic@127.0.0.1/test",
            true
        )
        .is_ok());
        assert!(database_options(
            "postgres://likerts_export_cleanup:synthetic@db.example/test",
            true
        )
        .is_err());
        assert!(database_options("postgres://owner:synthetic@127.0.0.1/test", true).is_err());
        assert!(database_options(
            "postgres://likerts_export_cleanup:synthetic@db.example/test?host=127.0.0.1",
            false
        )
        .is_err());
        let options = database_options(
            "postgres://likerts_export_cleanup:synthetic@db.example/test?sslmode=disable",
            false,
        )
        .unwrap();
        assert!(matches!(options.get_ssl_mode(), PgSslMode::VerifyFull));
    }
}
