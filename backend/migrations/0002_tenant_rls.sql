alter table likerts.workspaces enable row level security;
alter table likerts.workspaces force row level security;
alter table likerts.surveys enable row level security;
alter table likerts.surveys force row level security;
alter table likerts.survey_versions enable row level security;
alter table likerts.survey_versions force row level security;
alter table likerts.collections enable row level security;
alter table likerts.collections force row level security;
alter table likerts.responses enable row level security;
alter table likerts.responses force row level security;
alter table likerts.usage_entries enable row level security;
alter table likerts.usage_entries force row level security;

create policy workspaces_tenant on likerts.workspaces
    for all
    using (id = nullif(current_setting('likerts.workspace_id', true), ''))
    with check (id = nullif(current_setting('likerts.workspace_id', true), ''));

create policy surveys_tenant on likerts.surveys
    for all
    using (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''))
    with check (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''));

create policy survey_versions_tenant on likerts.survey_versions
    for all
    using (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''))
    with check (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''));

create policy collections_tenant on likerts.collections
    for all
    using (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''))
    with check (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''));

create policy collections_capability_read on likerts.collections
    for select
    using (
        token_hash = decode(
            nullif(current_setting('likerts.collection_token_hash', true), ''),
            'hex'
        )
    );

create policy responses_tenant on likerts.responses
    for all
    using (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''))
    with check (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''));

create policy usage_entries_tenant on likerts.usage_entries
    for all
    using (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''))
    with check (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''));
