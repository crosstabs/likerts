-- Remove the pre-release commercial model. No customer data depends on it.

drop trigger if exists audit_workspace_management_update on likerts.workspaces;
drop trigger if exists workspace_response_credits on likerts.workspaces;
drop trigger if exists workspace_credit_notification_erasure on likerts.workspaces;

drop table if exists likerts.credit_notification_state cascade;
drop table if exists likerts.credit_payment_objects cascade;
drop table if exists likerts.credit_checkout_events cascade;
drop table if exists likerts.credit_checkouts cascade;
drop table if exists likerts.response_credits cascade;
drop table if exists likerts.billing_adjustments cascade;
drop table if exists likerts.payment_events cascade;
drop table if exists likerts.settlement_usage cascade;
drop table if exists likerts.settlement_batches cascade;
drop table if exists likerts.billing_accounts cascade;

drop function if exists likerts.onboard_response_credits() cascade;
drop function if exists likerts.ensure_response_credit_onboarding(text) cascade;
drop function if exists likerts.guard_response_credit_insert() cascade;
drop function if exists likerts.reject_response_credit_mutation() cascade;
drop function if exists likerts.erase_credit_notification_state() cascade;
drop function if exists likerts.enqueue_credit_threshold_notifications() cascade;

alter table likerts.workspaces
    drop column if exists monthly_spend_cap_cents,
    drop column if exists unpaid_exposure_cap_cents,
    drop column if exists billing_paused,
    drop column if exists prepaid_dispute_open;

create trigger audit_workspace_management_update
after update of retention_days, deleted_at on likerts.workspaces
for each row execute function likerts.append_management_audit();

update likerts.webhook_endpoints set event_types=array['response.accepted']::text[];
alter table likerts.webhook_endpoints drop constraint if exists webhook_event_types;
alter table likerts.webhook_endpoints add constraint webhook_event_types
    check (event_types=array['response.accepted']::text[]);

delete from likerts.webhook_events where event_type<>'response.accepted';
alter table likerts.webhook_events drop constraint if exists webhook_event_reference;
alter table likerts.webhook_events alter column response_id set not null;
alter table likerts.webhook_events
    drop column if exists credit_bucket,
    drop column if exists credit_generation,
    drop column if exists credit_threshold;

comment on table likerts.usage_entries is
  'One immutable counting row per accepted response. amount_cents is retained as a fixed legacy storage field and is not a price.';
