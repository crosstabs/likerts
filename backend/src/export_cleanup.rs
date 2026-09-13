//! Durable deletion retries. This worker only receives opaque export object keys.
use crate::exports::ObjectStore;
use sqlx::{PgPool, Row};
use std::time::Duration;
use uuid::Uuid;

#[derive(Clone)]
pub struct ExportCleanup(pub PgPool);

impl ExportCleanup {
    pub async fn check_role(&self) -> Result<(), &'static str> {
        let safe: bool = sqlx::query_scalar("select current_user='likerts_export_cleanup' and r.rolcanlogin and not (r.rolsuper or r.rolbypassrls or r.rolinherit or r.rolcreaterole or r.rolcreatedb or r.rolreplication) and not exists(select 1 from pg_auth_members where member=r.oid) and not exists(select 1 from pg_database where datname=current_database() and datdba=r.oid) and not has_schema_privilege(current_user,'likerts','CREATE') and not exists(select 1 from pg_namespace where nspname='likerts' and nspowner=r.oid) and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='likerts' and (c.relowner=r.oid or (c.relkind in ('r','p','v','m','f') and (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))))) and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='likerts' and (p.proowner=r.oid or (p.prosecdef and has_function_privilege(current_user,p.oid,'EXECUTE') and p.oid not in ('likerts.claim_export_cleanup()'::regprocedure,'likerts.finish_export_cleanup(text,uuid,boolean)'::regprocedure,'likerts.export_cleanup_status()'::regprocedure,'likerts.run_scheduled_retention()'::regprocedure,'likerts.retention_schedule_status()'::regprocedure)))) from pg_roles r where r.rolname=current_user")
            .fetch_one(&self.0).await.map_err(|_| "cleanup_role_check_failed")?;
        if safe {
            Ok(())
        } else {
            Err("cleanup_requires_restricted_role")
        }
    }

    pub async fn one(&self, objects: &dyn ObjectStore) -> Result<bool, &'static str> {
        let Some(row) =
            sqlx::query("select object_key,lease_id from likerts.claim_export_cleanup()")
                .fetch_optional(&self.0)
                .await
                .map_err(|_| "cleanup_claim_failed")?
        else {
            return Ok(false);
        };
        let key: String = row.get("object_key");
        let lease: Uuid = row.get("lease_id");
        let success = matches!(
            tokio::time::timeout(Duration::from_secs(35), objects.delete(&key)).await,
            Ok(Ok(()))
        );
        let finished: bool = sqlx::query_scalar("select likerts.finish_export_cleanup($1,$2,$3)")
            .bind(key)
            .bind(lease)
            .bind(success)
            .fetch_one(&self.0)
            .await
            .map_err(|_| "cleanup_completion_failed")?;
        if !finished {
            return Err("cleanup_stale_lease");
        }
        if !success {
            return Err("cleanup_storage_retry_scheduled");
        }
        Ok(true)
    }

    pub async fn status(&self) -> Result<serde_json::Value, &'static str> {
        sqlx::query_scalar("select likerts.export_cleanup_status()")
            .fetch_one(&self.0)
            .await
            .map_err(|_| "cleanup_status_failed")
    }

    pub async fn retention(&self) -> Result<serde_json::Value, &'static str> {
        sqlx::query_scalar("select likerts.run_scheduled_retention()")
            .fetch_one(&self.0)
            .await
            .map_err(|_| "retention_batch_failed")
    }

    pub async fn retention_status(&self) -> Result<serde_json::Value, &'static str> {
        sqlx::query_scalar("select likerts.retention_schedule_status()")
            .fetch_one(&self.0)
            .await
            .map_err(|_| "retention_status_failed")
    }
}
