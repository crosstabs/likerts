//! Deployment-only schema runner. The HTTP runtime never receives this credential.
use sqlx::postgres::PgPoolOptions;
use std::{process::ExitCode, time::Duration};

#[tokio::main]
async fn main() -> ExitCode {
    let database_url = match std::env::var("LIKERTS_MIGRATION_DATABASE_URL") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => {
            eprintln!("LIKERTS_MIGRATION_DATABASE_URL is required");
            return ExitCode::FAILURE;
        }
    };
    let pool = match PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(15))
        .connect(&database_url)
        .await
    {
        Ok(pool) => pool,
        Err(_) => {
            eprintln!("Migration database connection failed; check deployment credentials and connectivity");
            return ExitCode::FAILURE;
        }
    };
    if sqlx::migrate!().run(&pool).await.is_err() {
        // Database diagnostics can contain secrets or customer values. Operators inspect
        // the restricted database migration log instead of exporting errors to CI logs.
        eprintln!("Schema migration failed; deployment must stop before replacing the service");
        pool.close().await;
        return ExitCode::FAILURE;
    }
    pool.close().await;
    println!("Schema migrations completed successfully");
    ExitCode::SUCCESS
}
