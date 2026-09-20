//! Callback worker heartbeat with no caller-controlled database fields.
use crate::Error;
use sqlx::PgPool;

fn db(_: sqlx::Error) -> Error {
    Error::Internal
}

pub async fn check_contract(pool: &PgPool) -> Result<(), Error> {
    let valid: bool = sqlx::query_scalar("select has_function_privilege(current_user,'likerts.record_callback_worker_heartbeat()','EXECUTE') and not has_table_privilege(current_user,'likerts.callback_worker_heartbeats','INSERT') and not has_table_privilege(current_user,'likerts.callback_worker_heartbeats','UPDATE') and not has_table_privilege(current_user,'likerts.callback_worker_heartbeats','DELETE') and not has_table_privilege(current_user,'likerts.callback_worker_heartbeats','SELECT')")
        .fetch_one(pool)
        .await
        .map_err(db)?;
    if valid {
        Ok(())
    } else {
        Err(Error::Unauthorized)
    }
}

pub async fn record_heartbeat(pool: &PgPool) -> Result<(), Error> {
    sqlx::query("select likerts.record_callback_worker_heartbeat()")
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(db)
}
