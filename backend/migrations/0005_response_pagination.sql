alter table likerts.responses
    add column retrieval_sequence bigint generated always as identity;

create unique index responses_retrieval_sequence_idx
    on likerts.responses(retrieval_sequence);

create index responses_workspace_retrieval_idx
    on likerts.responses(workspace_id, retrieval_sequence);

create index responses_collection_retrieval_idx
    on likerts.responses(workspace_id, collection_id, retrieval_sequence);
