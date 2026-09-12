-- credit_notification_state is trigger-owned; API runtime gets no direct grants.
\set ON_ERROR_STOP on
-- Include after the regular runtime provisioner, with the same runtime_role variable.
begin;
select format('grant select,insert,update,delete on likerts.webhook_endpoints,likerts.webhook_events,likerts.webhook_deliveries,likerts.webhook_attempts,likerts.webhook_requests to %I', :'runtime_role') \gexec
select format('grant execute on function likerts.enqueue_response_webhooks(),likerts.erase_response_webhooks(),likerts.revoke_workspace_webhooks() to %I', :'runtime_role') \gexec
commit;
