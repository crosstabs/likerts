-- Pre-launch migration: old collection-create retry rows contained recoverable bearer
-- credentials. Remove them and prohibit future credential-bearing retry records. Existing
-- collections remain usable, but their old management idempotency keys must not be retried.
delete from likerts.management_requests where operation = 'collections_create';

alter table likerts.management_requests
    add constraint management_requests_no_collection_token check (
        operation <> 'collections_create' or not (response ? 'token')
    );
