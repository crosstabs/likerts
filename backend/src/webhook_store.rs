//! Durable webhook management and worker claims; the worker role has no customer-data grants.
use crate::{webhooks::*, Error};
use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgRow, PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

#[derive(Clone)]
pub struct WebhookStore {
    pool: PgPool,
    keys: WebhookKeys,
}
fn db(_: sqlx::Error) -> Error {
    Error::Internal
}
fn uuid(value: &str) -> Result<Uuid, Error> {
    Uuid::parse_str(value).map_err(|_| Error::NotFound)
}
fn key(value: &str) -> Result<(), Error> {
    if value.trim().is_empty() || value.chars().count() > 128 || value.chars().any(char::is_control)
    {
        Err(Error::Invalid("invalid idempotency key".into()))
    } else {
        Ok(())
    }
}
fn hash(value: &Value) -> Result<Vec<u8>, Error> {
    Ok(Sha256::digest(serde_json::to_vec(value).map_err(|_| Error::Internal)?).to_vec())
}
fn endpoint(row: &PgRow) -> Endpoint {
    Endpoint {
        id: row.get::<Uuid, _>("id").to_string(),
        url: row.get("url"),
        enabled: row.get("enabled"),
        revoked: row.get::<Option<DateTime<Utc>>, _>("revoked_at").is_some(),
        key_id: row.get::<Uuid, _>("key_id").to_string(),
        created_at: row.get("created_at"),
    }
}
fn delivery(row: &PgRow) -> Delivery {
    Delivery {
        id: row.get::<Uuid, _>("id").to_string(),
        endpoint_id: row.get::<Uuid, _>("endpoint_id").to_string(),
        event_id: row.get::<Uuid, _>("event_id").to_string(),
        status: row.get("status"),
        attempts: row.get::<i32, _>("attempts") as u32,
        replay_count: row.get::<i32, _>("replay_count") as u32,
        next_attempt_at: row.get("next_attempt_at"),
        last_status: row.get::<Option<i32>, _>("last_status").map(|v| v as u16),
        failure_code: row.get("failure_code"),
        expires_at: row.get("expires_at"),
    }
}

impl WebhookStore {
    pub fn new(pool: PgPool, keys: WebhookKeys) -> Self {
        Self { pool, keys }
    }
    async fn tenant(
        &self,
        workspace: &str,
        lock: bool,
    ) -> Result<Transaction<'_, Postgres>, Error> {
        let mut tx = self.pool.begin().await.map_err(db)?;
        sqlx::query("select set_config('likerts.workspace_id',$1,true)")
            .bind(workspace)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        let query = if lock {
            "select id from likerts.workspaces where id=$1 and deleted_at is null for update"
        } else {
            "select id from likerts.workspaces where id=$1 and deleted_at is null"
        };
        if sqlx::query(query)
            .bind(workspace)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db)?
            .is_none()
        {
            return Err(Error::NotFound);
        }
        Ok(tx)
    }
    async fn worker(&self) -> Result<Transaction<'_, Postgres>, Error> {
        let mut tx = self.pool.begin().await.map_err(db)?;
        let permitted: bool = sqlx::query_scalar("select exists(select 1 from pg_roles r where r.rolname=current_user and current_user='likerts_webhook_worker' and r.rolcanlogin and not r.rolsuper and not r.rolbypassrls and not r.rolinherit and not r.rolcreatedb and not r.rolcreaterole and not exists(select 1 from pg_auth_members m where m.member=r.oid))")
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        if !permitted {
            return Err(Error::Unauthorized);
        }
        sqlx::query("select set_config('likerts.workspace_id','',true)")
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        Ok(tx)
    }
    pub async fn check_worker_role(&self) -> Result<(), Error> {
        self.worker().await?.commit().await.map_err(db)
    }
    async fn prior(
        tx: &mut Transaction<'_, Postgres>,
        workspace: &str,
        operation: &str,
        idempotency_key: &str,
        payload: &[u8],
    ) -> Result<Option<PgRow>, Error> {
        let row=sqlx::query("select resource_id,key_id,key_hash,payload_hash,response from likerts.webhook_requests where workspace_id=$1 and operation=$2 and idempotency_key=$3").bind(workspace).bind(operation).bind(idempotency_key).fetch_optional(&mut **tx).await.map_err(db)?;
        if row
            .as_ref()
            .is_some_and(|row| row.get::<Vec<u8>, _>("payload_hash") != payload)
        {
            return Err(Error::Conflict);
        }
        Ok(row)
    }
    async fn remember(
        tx: &mut Transaction<'_, Postgres>,
        workspace: &str,
        operation: &str,
        idempotency_key: &str,
        payload: &[u8],
        resource_id: Uuid,
        key_id: Option<Uuid>,
        key_hash: Option<&[u8]>,
        response: Value,
    ) -> Result<(), Error> {
        sqlx::query("insert into likerts.webhook_requests(workspace_id,operation,idempotency_key,payload_hash,resource_id,key_id,key_hash,response) values($1,$2,$3,$4,$5,$6,$7,$8)").bind(workspace).bind(operation).bind(idempotency_key).bind(payload).bind(resource_id).bind(key_id).bind(key_hash).bind(response).execute(&mut **tx).await.map_err(db)?;
        Ok(())
    }
    pub async fn list_endpoints(&self, workspace: &str) -> Result<Vec<Endpoint>, Error> {
        let mut tx = self.tenant(workspace, false).await?;
        let rows=sqlx::query("select id,url,enabled,revoked_at,key_id,created_at from likerts.webhook_endpoints where workspace_id=$1 order by created_at,id limit 100").bind(workspace).fetch_all(&mut *tx).await.map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(rows.iter().map(endpoint).collect())
    }
    pub async fn create_endpoint(
        &self,
        workspace: &str,
        input: EndpointInput,
    ) -> Result<EndpointCredential, Error> {
        key(&input.idempotency_key)?;
        let url = validate_endpoint(&input.url)?.to_string();
        let payload = hash(&serde_json::json!({"url":url}))?;
        let mut tx = self.tenant(workspace, true).await?;
        if let Some(prior) = Self::prior(
            &mut tx,
            workspace,
            "create",
            &input.idempotency_key,
            &payload,
        )
        .await?
        {
            let id: Uuid = prior.get("resource_id");
            let generation: Uuid = prior.get("key_id");
            let digest: Vec<u8> = prior.get("key_hash");
            let active:bool=sqlx::query_scalar("select exists(select 1 from likerts.webhook_endpoints where workspace_id=$1 and id=$2 and revoked_at is null)").bind(workspace).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
            if !active {
                return Err(Error::Revoked);
            }
            let record =
                serde_json::from_value(prior.get("response")).map_err(|_| Error::Internal)?;
            let secret = self.keys.reconstruct(workspace, id, generation, &digest)?;
            tx.commit().await.map_err(db)?;
            return Ok(EndpointCredential {
                endpoint: record,
                signing_secret: secret,
            });
        }
        let row=sqlx::query("select count(*)::bigint total,count(*) filter(where revoked_at is null)::bigint active from likerts.webhook_endpoints where workspace_id=$1").bind(workspace).fetch_one(&mut *tx).await.map_err(db)?;
        if row.get::<i64, _>("active") >= MAX_ENDPOINTS || row.get::<i64, _>("total") >= 100 {
            return Err(Error::Capacity);
        }
        let id = Uuid::new_v4();
        let generation = Uuid::new_v4();
        let secret = self.keys.secret(workspace, id, generation);
        let digest = secret_digest(&secret);
        let row=sqlx::query("insert into likerts.webhook_endpoints(workspace_id,id,url,key_id,key_hash) values($1,$2,$3,$4,$5) returning id,url,enabled,revoked_at,key_id,created_at").bind(workspace).bind(id).bind(url).bind(generation).bind(&digest).fetch_one(&mut *tx).await.map_err(db)?;
        let record = endpoint(&row);
        Self::remember(
            &mut tx,
            workspace,
            "create",
            &input.idempotency_key,
            &payload,
            id,
            Some(generation),
            Some(&digest),
            serde_json::to_value(&record).map_err(|_| Error::Internal)?,
        )
        .await?;
        tx.commit().await.map_err(db)?;
        Ok(EndpointCredential {
            endpoint: record,
            signing_secret: secret,
        })
    }
    pub async fn update_endpoint(
        &self,
        workspace: &str,
        id: &str,
        input: EndpointUpdate,
    ) -> Result<Endpoint, Error> {
        if input.enabled.is_none() && input.revoke != Some(true)
            || input.revoke == Some(false)
            || input.revoke == Some(true) && input.enabled == Some(true)
        {
            return Err(Error::Invalid(
                "set enabled or revoke the webhook endpoint".into(),
            ));
        }
        let id = uuid(id)?;
        let mut tx = self.tenant(workspace, true).await?;
        let row=sqlx::query("select id,url,enabled,revoked_at,key_id,created_at from likerts.webhook_endpoints where workspace_id=$1 and id=$2 for update").bind(workspace).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(Error::NotFound)?;
        if row.get::<Option<DateTime<Utc>>, _>("revoked_at").is_some() {
            return Err(Error::Revoked);
        }
        let row=sqlx::query("update likerts.webhook_endpoints set enabled=case when $4 then false else coalesce($3,enabled) end,revoked_at=case when $4 then now() else revoked_at end where workspace_id=$1 and id=$2 returning id,url,enabled,revoked_at,key_id,created_at").bind(workspace).bind(id).bind(input.enabled).bind(input.revoke==Some(true)).fetch_one(&mut *tx).await.map_err(db)?;
        if input.revoke == Some(true) {
            sqlx::query("update likerts.webhook_deliveries set status='cancelled',lease_until=null,failure_code='endpoint_revoked' where workspace_id=$1 and endpoint_id=$2 and status in ('queued','running')").bind(workspace).bind(id).execute(&mut *tx).await.map_err(db)?;
            sqlx::query("update likerts.webhook_attempts a set status='cancelled',completed_at=now(),failure_code='endpoint_revoked' from likerts.webhook_deliveries d where a.workspace_id=$1 and d.workspace_id=a.workspace_id and d.id=a.delivery_id and d.endpoint_id=$2 and a.status='running'").bind(workspace).bind(id).execute(&mut *tx).await.map_err(db)?;
        }
        tx.commit().await.map_err(db)?;
        Ok(endpoint(&row))
    }
    pub async fn rotate_key(
        &self,
        workspace: &str,
        id: &str,
        input: WebhookOperationInput,
    ) -> Result<EndpointCredential, Error> {
        key(&input.idempotency_key)?;
        let id = uuid(id)?;
        let payload = hash(&serde_json::json!({"id":id}))?;
        let mut tx = self.tenant(workspace, true).await?;
        if !sqlx::query_scalar::<_,bool>("select exists(select 1 from likerts.webhook_endpoints where workspace_id=$1 and id=$2 and revoked_at is null)").bind(workspace).bind(id).fetch_one(&mut *tx).await.map_err(db)?{return Err(Error::NotFound)}
        if let Some(prior) = Self::prior(
            &mut tx,
            workspace,
            "rotate",
            &input.idempotency_key,
            &payload,
        )
        .await?
        {
            let generation: Uuid = prior.get("key_id");
            let digest: Vec<u8> = prior.get("key_hash");
            let record =
                serde_json::from_value(prior.get("response")).map_err(|_| Error::Internal)?;
            let secret = self.keys.reconstruct(workspace, id, generation, &digest)?;
            tx.commit().await.map_err(db)?;
            return Ok(EndpointCredential {
                endpoint: record,
                signing_secret: secret,
            });
        }
        let generation = Uuid::new_v4();
        let secret = self.keys.secret(workspace, id, generation);
        let digest = secret_digest(&secret);
        let row=sqlx::query("update likerts.webhook_endpoints set key_id=$3,key_hash=$4 where workspace_id=$1 and id=$2 returning id,url,enabled,revoked_at,key_id,created_at").bind(workspace).bind(id).bind(generation).bind(&digest).fetch_one(&mut *tx).await.map_err(db)?;
        let record = endpoint(&row);
        Self::remember(
            &mut tx,
            workspace,
            "rotate",
            &input.idempotency_key,
            &payload,
            id,
            Some(generation),
            Some(&digest),
            serde_json::to_value(&record).map_err(|_| Error::Internal)?,
        )
        .await?;
        tx.commit().await.map_err(db)?;
        Ok(EndpointCredential {
            endpoint: record,
            signing_secret: secret,
        })
    }
    pub async fn get_delivery(&self, workspace: &str, id: &str) -> Result<Delivery, Error> {
        let mut tx = self.tenant(workspace, false).await?;
        let row=sqlx::query("select d.*,e.expires_at from likerts.webhook_deliveries d join likerts.webhook_events e using(workspace_id) where d.workspace_id=$1 and d.id=$2 and e.id=d.event_id").bind(workspace).bind(uuid(id)?).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(Error::NotFound)?;
        tx.commit().await.map_err(db)?;
        Ok(delivery(&row))
    }
    pub async fn list_deliveries(
        &self,
        workspace: &str,
        endpoint_id: Option<&str>,
        after: Option<&str>,
        limit: u16,
    ) -> Result<Vec<Delivery>, Error> {
        if !(1..=100).contains(&limit) {
            return Err(Error::Invalid("limit must be between 1 and 100".into()));
        }
        let endpoint_id = endpoint_id.map(uuid).transpose()?;
        let after = after.map(uuid).transpose()?;
        let mut tx = self.tenant(workspace, false).await?;
        let rows=sqlx::query("select d.*,e.expires_at from likerts.webhook_deliveries d join likerts.webhook_events e on e.workspace_id=d.workspace_id and e.id=d.event_id where d.workspace_id=$1 and ($2::uuid is null or d.endpoint_id=$2) and ($3::uuid is null or d.id>$3) order by d.id limit $4").bind(workspace).bind(endpoint_id).bind(after).bind(i64::from(limit)).fetch_all(&mut *tx).await.map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(rows.iter().map(delivery).collect())
    }
    pub async fn replay(
        &self,
        workspace: &str,
        id: &str,
        input: WebhookOperationInput,
    ) -> Result<Delivery, Error> {
        key(&input.idempotency_key)?;
        let id = uuid(id)?;
        let payload = hash(&serde_json::json!({"id":id}))?;
        let mut tx = self.tenant(workspace, true).await?;
        if let Some(prior) = Self::prior(
            &mut tx,
            workspace,
            "replay",
            &input.idempotency_key,
            &payload,
        )
        .await?
        {
            let result =
                serde_json::from_value(prior.get("response")).map_err(|_| Error::Internal)?;
            tx.commit().await.map_err(db)?;
            return Ok(result);
        }
        let row=sqlx::query("select d.*,e.expires_at,p.enabled,p.revoked_at from likerts.webhook_deliveries d join likerts.webhook_events e on e.workspace_id=d.workspace_id and e.id=d.event_id join likerts.webhook_endpoints p on p.workspace_id=d.workspace_id and p.id=d.endpoint_id where d.workspace_id=$1 and d.id=$2 for update of d").bind(workspace).bind(id).fetch_optional(&mut *tx).await.map_err(db)?.ok_or(Error::NotFound)?;
        if row.get::<DateTime<Utc>, _>("expires_at") <= Utc::now() {
            return Err(Error::Expired);
        }
        if row.get::<Option<DateTime<Utc>>, _>("revoked_at").is_some() {
            return Err(Error::Revoked);
        }
        if !row.get::<bool, _>("enabled")
            || row.get::<i32, _>("replay_count") >= MAX_REPLAYS as i32
            || !matches!(
                row.get::<String, _>("status").as_str(),
                "delivered" | "failed"
            )
        {
            return Err(Error::Conflict);
        }
        sqlx::query("update likerts.webhook_deliveries set status='queued',attempts=0,replay_count=replay_count+1,next_attempt_at=now(),lease_until=null,current_attempt_id=null,last_status=null,failure_code=null where workspace_id=$1 and id=$2").bind(workspace).bind(id).execute(&mut *tx).await.map_err(db)?;
        let row=sqlx::query("select d.*,e.expires_at from likerts.webhook_deliveries d join likerts.webhook_events e on e.workspace_id=d.workspace_id and e.id=d.event_id where d.workspace_id=$1 and d.id=$2").bind(workspace).bind(id).fetch_one(&mut *tx).await.map_err(db)?;
        let result = delivery(&row);
        Self::remember(
            &mut tx,
            workspace,
            "replay",
            &input.idempotency_key,
            &payload,
            id,
            None,
            None,
            serde_json::to_value(&result).map_err(|_| Error::Internal)?,
        )
        .await?;
        tx.commit().await.map_err(db)?;
        Ok(result)
    }
    pub async fn claim(&self) -> Result<Option<Dispatch>, Error> {
        let mut tx = self.worker().await?;
        sqlx::query("delete from likerts.webhook_events where (workspace_id,id) in (select workspace_id,id from likerts.webhook_events where expires_at<=now() limit 1000)").execute(&mut *tx).await.map_err(db)?;
        // Lock delivery rows before attempts, matching finish/revoke to avoid lock inversion.
        sqlx::query("with expired as (update likerts.webhook_deliveries set status=case when attempts>=7 then 'failed' else 'queued' end,next_attempt_at=now(),lease_until=null,failure_code='worker_lease_expired' where (workspace_id,id) in (select workspace_id,id from likerts.webhook_deliveries where status='running' and lease_until<=now() order by lease_until for update skip locked limit 100) returning workspace_id,current_attempt_id) update likerts.webhook_attempts a set status='expired',failure_code='worker_lease_expired',completed_at=now() from expired d where a.workspace_id=d.workspace_id and a.id=d.current_attempt_id and a.status='running'").execute(&mut *tx).await.map_err(db)?;
        let row=sqlx::query("select d.*,e.body,p.url,p.key_id,p.key_hash from likerts.webhook_deliveries d join likerts.webhook_events e on e.workspace_id=d.workspace_id and e.id=d.event_id join likerts.webhook_endpoints p on p.workspace_id=d.workspace_id and p.id=d.endpoint_id where d.status='queued' and d.attempts<7 and d.next_attempt_at<=now() and e.expires_at>now() and p.enabled and p.revoked_at is null and not exists(select 1 from likerts.webhook_deliveries running where running.workspace_id=d.workspace_id and running.endpoint_id=d.endpoint_id and running.status='running' and running.lease_until>now()) order by d.next_attempt_at,d.id for update of d skip locked limit 1").fetch_optional(&mut *tx).await.map_err(db)?;
        let Some(row) = row else {
            tx.commit().await.map_err(db)?;
            return Ok(None);
        };
        let workspace: String = row.get("workspace_id");
        let id: Uuid = row.get("id");
        let endpoint_id: Uuid = row.get("endpoint_id");
        let key_id: Uuid = row.get("key_id");
        let digest: Vec<u8> = row.get("key_hash");
        let attempt_id = Uuid::new_v4();
        let timestamp = Utc::now().timestamp();
        let number = row.get::<i32, _>("attempts") + 1;
        // Serialize claims for an endpoint without giving the worker endpoint UPDATE rights.
        // A fresh statement after the lock observes any previously committed running claim.
        let locked: bool =
            sqlx::query_scalar("select pg_try_advisory_xact_lock(hashtextextended($1, 192837))")
                .bind(format!("{}:{}", workspace, endpoint_id))
                .fetch_one(&mut *tx)
                .await
                .map_err(db)?;
        if !locked {
            tx.commit().await.map_err(db)?;
            return Ok(None);
        }
        let running:bool=sqlx::query_scalar("select exists(select 1 from likerts.webhook_deliveries where workspace_id=$1 and endpoint_id=$2 and status='running' and lease_until>now())").bind(&workspace).bind(endpoint_id).fetch_one(&mut *tx).await.map_err(db)?;
        if running {
            tx.commit().await.map_err(db)?;
            return Ok(None);
        }
        let secret = match self
            .keys
            .reconstruct(&workspace, endpoint_id, key_id, &digest)
        {
            Ok(secret) => secret,
            Err(_) => {
                sqlx::query("update likerts.webhook_deliveries set status='failed',failure_code='credential_key_unavailable' where workspace_id=$1 and id=$2").bind(&workspace).bind(id).execute(&mut *tx).await.map_err(db)?;
                tx.commit().await.map_err(db)?;
                return Ok(None);
            }
        };
        sqlx::query("update likerts.webhook_deliveries set status='running',attempts=$3,current_attempt_id=$4,lease_until=now()+interval '30 seconds' where workspace_id=$1 and id=$2").bind(&workspace).bind(id).bind(number).bind(attempt_id).execute(&mut *tx).await.map_err(db)?;
        sqlx::query("insert into likerts.webhook_attempts(workspace_id,id,delivery_id,attempt_number,replay_count,key_id,key_hash,signature_timestamp,status) values($1,$2,$3,$4,$5,$6,$7,$8,'running')").bind(&workspace).bind(attempt_id).bind(id).bind(number).bind(row.get::<i32,_>("replay_count")).bind(key_id).bind(digest).bind(timestamp).execute(&mut *tx).await.map_err(db)?;
        let result = Dispatch {
            workspace,
            delivery_id: id.to_string(),
            event_id: row.get::<Uuid, _>("event_id").to_string(),
            endpoint_id: endpoint_id.to_string(),
            attempt_id: attempt_id.to_string(),
            attempt_number: number as u32,
            key_id: key_id.to_string(),
            signature_timestamp: timestamp,
            url: row.get("url"),
            body: row.get("body"),
            signing_secret: secret,
        };
        tx.commit().await.map_err(db)?;
        Ok(Some(result))
    }
    pub async fn dispatch_active(&self, dispatch: &Dispatch) -> Result<bool, Error> {
        let mut tx = self.worker().await?;
        let active=sqlx::query_scalar("select exists(select 1 from likerts.webhook_deliveries d join likerts.webhook_endpoints p on p.workspace_id=d.workspace_id and p.id=d.endpoint_id join likerts.webhook_events e on e.workspace_id=d.workspace_id and e.id=d.event_id where d.workspace_id=$1 and d.id=$2 and d.current_attempt_id=$3 and d.status='running' and d.lease_until>now() and p.enabled and p.revoked_at is null and e.expires_at>now())").bind(&dispatch.workspace).bind(uuid(&dispatch.delivery_id)?).bind(uuid(&dispatch.attempt_id)?).fetch_one(&mut *tx).await.map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(active)
    }
    pub async fn finish(&self, dispatch: &Dispatch, outcome: AttemptOutcome) -> Result<(), Error> {
        let mut tx = self.worker().await?;
        let (attempt_status, delivery_status, status, code, next) = match outcome {
            AttemptOutcome::Delivered(status) => {
                ("delivered", "delivered", Some(status), None, Utc::now())
            }
            AttemptOutcome::Failed(status, code) => {
                ("failed", "failed", status, Some(code), Utc::now())
            }
            AttemptOutcome::Retry(status, code) => match retry_delay(dispatch.attempt_number) {
                Some(delay) => (
                    "retry",
                    "queued",
                    status,
                    Some(code),
                    Utc::now() + Duration::seconds(delay.as_secs() as i64),
                ),
                None => (
                    "failed",
                    "failed",
                    status,
                    Some("attempts_exhausted"),
                    Utc::now(),
                ),
            },
        };
        let changed=sqlx::query("update likerts.webhook_deliveries set status=$4,last_status=$5,failure_code=$6,next_attempt_at=$7,lease_until=null where workspace_id=$1 and id=$2 and current_attempt_id=$3 and status='running'").bind(&dispatch.workspace).bind(uuid(&dispatch.delivery_id)?).bind(uuid(&dispatch.attempt_id)?).bind(delivery_status).bind(status.map(i32::from)).bind(code).bind(next).execute(&mut *tx).await.map_err(db)?.rows_affected();
        if changed == 1 {
            sqlx::query("update likerts.webhook_attempts set status=$3,http_status=$4,failure_code=$5,completed_at=now() where workspace_id=$1 and id=$2 and status='running'").bind(&dispatch.workspace).bind(uuid(&dispatch.attempt_id)?).bind(attempt_status).bind(status.map(i32::from)).bind(code).execute(&mut *tx).await.map_err(db)?;
        }
        tx.commit().await.map_err(db)
    }
}
