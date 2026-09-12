alter table likerts.survey_versions
    add column sdk_capabilities jsonb not null default '{"installations":[]}'::jsonb,
    add constraint survey_versions_sdk_capabilities_object
        check (jsonb_typeof(sdk_capabilities) = 'object');
alter table likerts.survey_versions alter column sdk_capabilities drop default;

alter table likerts.collections
    add column sdk_capabilities jsonb not null default '{"installations":[]}'::jsonb,
    add constraint collections_sdk_capabilities_object
        check (jsonb_typeof(sdk_capabilities) = 'object');
alter table likerts.collections alter column sdk_capabilities drop default;
