//! Standalone ID-only archiver. No API, identity, answer or export credentials.
use likerts_server::erasure_archive::{
    self, ArchiveError, Archiver, ObjectRef, PrivateBlob, FENCE_ATTESTATION, RELEASE_ATTESTATION,
};
use serde_json::json;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions, PgSslMode};
use std::{process::ExitCode, str::FromStr, time::Duration};
use uuid::Uuid;

type Result<T> = std::result::Result<T, ArchiveError>;
const HELP: &str = "likerts-erasure-archive <status|monitor-status|check-config|drain|checkpoint|run|verify|fence|release>\n\
Credentials/configuration are read only from LIKERTS_ERASURE_* environment variables.\n\
'fence --ack I_ACCEPT_DELETIONS_WILL_BE_REJECTED' rejects new source deletions.\n\
'release --ack I_ACCEPT_OLD_CHECKPOINT_NO_LONGER_COVERS_FUTURE_DELETIONS' invalidates the fence checkpoint.\n\
See infrastructure/erasure-archive/README.md before maintenance commands.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Status,
    MonitorStatus,
    Check,
    Drain,
    Checkpoint,
    Run,
    Verify,
    Fence,
    Release,
}
fn mode(args: &[String]) -> Result<Mode> {
    let value = match args.first().map(String::as_str) {
        Some("status") => Mode::Status,
        Some("monitor-status") => Mode::MonitorStatus,
        Some("check-config") => Mode::Check,
        Some("drain") => Mode::Drain,
        Some("checkpoint") => Mode::Checkpoint,
        Some("run") => Mode::Run,
        Some("verify") => Mode::Verify,
        Some("fence")
            if args.get(1).map(String::as_str) == Some("--ack")
                && args.get(2).map(String::as_str) == Some(FENCE_ATTESTATION) =>
        {
            Mode::Fence
        }
        Some("release")
            if args.get(1).map(String::as_str) == Some("--ack")
                && args.get(2).map(String::as_str) == Some(RELEASE_ATTESTATION) =>
        {
            Mode::Release
        }
        _ => return Err(ArchiveError::Configuration),
    };
    if args.len()
        != if matches!(value, Mode::Fence | Mode::Release) {
            3
        } else {
            1
        }
    {
        return Err(ArchiveError::Configuration);
    }
    Ok(value)
}
fn env(name: &str) -> Result<String> {
    std::env::var(name)
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or(ArchiveError::Configuration)
}
fn canonical_uuid(value: &str) -> Result<()> {
    if Uuid::parse_str(value)
        .map_err(|_| ArchiveError::Configuration)?
        .to_string()
        != value
    {
        return Err(ArchiveError::Configuration);
    }
    Ok(())
}
fn number(value: Option<String>, default: u64, min: u64, max: u64) -> Result<u64> {
    let value = value
        .map(|s| s.parse::<u64>())
        .transpose()
        .map_err(|_| ArchiveError::Configuration)?
        .unwrap_or(default);
    if !(min..=max).contains(&value) {
        return Err(ArchiveError::Configuration);
    }
    Ok(value)
}
fn database_options(value: &str, local: bool, mode: Mode) -> Result<PgConnectOptions> {
    let url = reqwest::Url::parse(value).map_err(|_| ArchiveError::Configuration)?;
    if !matches!(url.scheme(), "postgres" | "postgresql")
        || url.username() != "likerts_erasure_archiver"
        || url.fragment().is_some()
        || url.host_str().is_none()
    {
        return Err(ArchiveError::Configuration);
    }
    let loopback = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    // Do not allow URL query options to change the checked host/user or turn off
    // verified TLS. Provider-specific connect options belong in a reviewed change.
    if url
        .query_pairs()
        .any(|(key, _)| !matches!(key.as_ref(), "sslmode" | "application_name"))
        || (local && !loopback)
    {
        return Err(ArchiveError::Configuration);
    }
    let options = PgConnectOptions::from_str(value).map_err(|_| ArchiveError::Configuration)?;
    Ok(options
        .ssl_mode(if local {
            PgSslMode::Disable
        } else {
            PgSslMode::VerifyFull
        })
        .application_name(if mode == Mode::MonitorStatus {
            "likerts-erasure-archive-observability-v2"
        } else {
            "likerts-erasure-archive"
        })
        .options([("statement_timeout", "15000"), ("lock_timeout", "5000")]))
}
fn objects(source: &str) -> Result<PrivateBlob> {
    PrivateBlob::new(
        &env("LIKERTS_ERASURE_BLOB_TOKEN")?,
        &env("LIKERTS_ERASURE_NAMESPACE")?,
        source,
    )
}
fn emit(value: impl serde::Serialize) -> Result<()> {
    use std::io::Write;
    let mut stdout = std::io::stdout().lock();
    serde_json::to_writer(&mut stdout, &value).map_err(|_| ArchiveError::Storage)?;
    writeln!(stdout).map_err(|_| ArchiveError::Storage)
}
async fn batch(archiver: &Archiver, objects: &PrivateBlob, maximum: u64) -> Result<()> {
    let mut archived = 0;
    while archived < maximum && archiver.one(objects).await? {
        archived += 1;
    }
    let checkpoint = archiver.checkpoint(objects).await?;
    let status = archiver.status().await?;
    emit(
        json!({"operation":"drain","archivedThisRun":archived,"checkpoint":checkpoint,"status":status}),
    )
}
async fn shutdown() {
    #[cfg(unix)]
    if let Ok(mut terminate) =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
    {
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
        return;
    }
    let _ = tokio::signal::ctrl_c().await;
}
async fn execute(mode: Mode) -> Result<()> {
    let source = env("LIKERTS_ERASURE_SOURCE_ID")?;
    canonical_uuid(&source)?;
    if mode == Mode::Verify {
        let fence = env("LIKERTS_ERASURE_FENCE_ID")?;
        let head = ObjectRef {
            id: env("LIKERTS_ERASURE_CHECKPOINT_ID")?,
            sha256: env("LIKERTS_ERASURE_CHECKPOINT_HASH")?,
        };
        // No database credential is needed to verify independently stored objects.
        let verified = erasure_archive::verify(&objects(&source)?, &source, &fence, head).await?;
        return emit(verified);
    }
    let local = match std::env::var("LIKERTS_ERASURE_ALLOW_LOCAL_INSECURE").as_deref() {
        Ok("1") => true,
        Ok("0") | Err(_) => false,
        _ => return Err(ArchiveError::Configuration),
    };
    let options = database_options(&env("LIKERTS_ERASURE_DATABASE_URL")?, local, mode)?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(options)
        .await
        .map_err(|_| ArchiveError::Database)?;
    if mode == Mode::MonitorStatus {
        let (_, status) = Archiver::new_observability(pool.clone(), &source).await?;
        pool.close().await;
        return emit(status);
    }
    let archiver = Archiver::new(pool.clone(), &source).await?;
    let result = async {
        match mode {
            Mode::Status => emit(archiver.status().await?),
            Mode::MonitorStatus => unreachable!(),
            Mode::Fence => emit(json!({"operation":"fence","sourceId":source,"fenceId":archiver.fence(FENCE_ATTESTATION).await?})),
            Mode::Check => {
                let _ = objects(&source)?;
                emit(json!({"operation":"check-config","databaseRoleAndSourceVerified":true,"archiveConfigurationParsed":true,"archiveConnectivityVerified":false}))
            }
            Mode::Release => {
                archiver.release(&objects(&source)?, &env("LIKERTS_ERASURE_FENCE_ID")?, RELEASE_ATTESTATION).await?;
                emit(json!({"operation":"release","released":true}))
            }
            Mode::Checkpoint => emit(json!({"operation":"checkpoint","checkpoint":archiver.checkpoint(&objects(&source)?).await?})),
            Mode::Drain | Mode::Run => {
                let maximum = number(std::env::var("LIKERTS_ERASURE_BATCH_SIZE").ok(), 100, 1, 1000)?;
                let interval = number(std::env::var("LIKERTS_ERASURE_POLL_SECONDS").ok(), 30, 1, 3600)?;
                let objects = objects(&source)?;
                if mode == Mode::Drain { return batch(&archiver, &objects, maximum).await; }
                let stop = shutdown(); tokio::pin!(stop);
                loop {
                    // Cancellation releases no checkpoint early. An in-flight lease
                    // can expire and be retried with the exact immutable object.
                    tokio::select! { _ = &mut stop => break, result = batch(&archiver, &objects, maximum) => { result?; } }
                    tokio::select! { _ = &mut stop => break, _ = tokio::time::sleep(Duration::from_secs(interval)) => {} }
                }
                emit(json!({"operation":"run","stopped":true}))
            }
            Mode::Verify => unreachable!(),
        }
    }.await;
    pool.close().await;
    result
}
#[tokio::main]
async fn main() -> ExitCode {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args == ["--help"] {
        println!("{HELP}");
        return ExitCode::SUCCESS;
    }
    let result = match mode(&args) {
        Ok(mode) => execute(mode).await,
        Err(error) => Err(error),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("erasure_archive failed category={error:?}; inspect restricted operational diagnostics");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| s.to_string()).collect()
    }
    #[test]
    fn maintenance_is_explicit_and_unknown_arguments_fail_closed() {
        assert_eq!(mode(&args(&["drain"])).unwrap(), Mode::Drain);
        assert_eq!(
            mode(&args(&["monitor-status"])).unwrap(),
            Mode::MonitorStatus
        );
        for value in [
            vec![],
            vec!["fence"],
            vec!["release"],
            vec!["fence", "--ack", RELEASE_ATTESTATION],
            vec!["run", "--token", "secret"],
        ] {
            assert_eq!(mode(&args(&value)), Err(ArchiveError::Configuration));
        }
        assert_eq!(
            mode(&args(&["fence", "--ack", FENCE_ATTESTATION])).unwrap(),
            Mode::Fence
        );
        assert_eq!(
            mode(&args(&["release", "--ack", RELEASE_ATTESTATION])).unwrap(),
            Mode::Release
        );
    }
    #[test]
    fn database_requires_archiver_identity_and_verified_tls_unless_explicit_loopback() {
        let safe =
            "postgresql://likerts_erasure_archiver:secret@db.example.test/archive?sslmode=disable";
        assert!(matches!(
            database_options(safe, false, Mode::Status)
                .unwrap()
                .get_ssl_mode(),
            PgSslMode::VerifyFull
        ));
        assert!(database_options(safe, true, Mode::Status).is_err());
        assert!(
            database_options("postgres://admin:secret@localhost/test", true, Mode::Status).is_err()
        );
        assert!(database_options(
            "postgres://likerts_erasure_archiver:secret@localhost/test?host=remote.test",
            true,
            Mode::Status
        )
        .is_err());
        assert!(matches!(
            database_options(
                "postgres://likerts_erasure_archiver:secret@127.0.0.1/test",
                true,
                Mode::Status
            )
            .unwrap()
            .get_ssl_mode(),
            PgSslMode::Disable
        ));
    }
    #[test]
    fn bounded_batches_intervals_and_source_ids() {
        assert_eq!(number(None, 100, 1, 1000).unwrap(), 100);
        for value in ["0", "1001", "-1", "secret"] {
            assert!(number(Some(value.into()), 100, 1, 1000).is_err());
        }
        assert!(canonical_uuid("NOT-A-SOURCE").is_err());
        assert!(canonical_uuid("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA").is_err());
        assert!(canonical_uuid("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").is_ok());
    }
}
