alter table likerts.surveys
    add column pages jsonb null
    check (pages is null or jsonb_typeof(pages) = 'array');

alter table likerts.survey_versions
    add column pages jsonb null
    check (pages is null or jsonb_typeof(pages) = 'array');
