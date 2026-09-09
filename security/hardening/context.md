# Hardening evidence context

Source root: `/Users/adi/likerts`. No Git revision exists, so source drift is unknown. The evidence collection is the current source for management authentication, PostgreSQL storage, identity migrations and MCP transport. Combined inventory digest: `2b629975c653f6c59143a4ecc68537587599e690e2f27c48960227e87d222bc5`.

| ID | Evidence | Observation |
| --- | --- | --- |
| E1 | `backend/src/postgres.rs` | Database errors were logged verbatim; management idempotency responses can contain collection credentials. |
| E2 | `backend/src/main.rs` | Authorization originally returned only a workspace string, losing actor identity before mutation handlers. |
| E3 | `backend/migrations/0006_identity_authorization.sql` | Forced RLS and capability lookup provide a strong tenant boundary. |
| E4 | `tools/mcp/src/client.ts` | Credentials stay in process configuration rather than model-visible tool arguments. |
