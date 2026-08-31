# Operations and privacy contract

Likerts produces synthetic research hypotheses. A model-generated perspective is not a participant, respondent, quotation, interview, survey, or observed human response. The contracts in `server/privacy-contract.js` and `server/storage-contract.js` make that boundary machine-checkable.

## Data classes

| Class | Meaning | Model transmission | Default handling |
| --- | --- | --- | --- |
| `PUBLIC` | Public, non-personal material | Allowed when the run explicitly uses it | May be retained with its lineage |
| `USER_PROVIDED` | Material supplied by the user, origin unverified | Only bounded excerpts, when explicitly included | Hash and bound excerpt; do not treat as verified evidence |
| `SENSITIVE` | Potentially sensitive business, demographic, or personal material | Not sent by a storage contract; requires an explicit, validated transformation | Minimize, redact, expire, and delete on request |
| `OBSERVED_HUMAN_DATA` | Responses collected from real people | Never sent to synthetic generation by default | Keep separate from synthetic records and use only under the approved human-research workflow |

The lineage envelope requires a payload hash, stable record identity, classification, timestamps, retention policy, and explicit `synthetic`/`observedHumanResponse` flags. A record cannot be both synthetic and observed human data. Client-supplied history remains untrusted unless a future authenticated storage layer verifies it.

## Retention and deletion

Records use one of three policies:

- `SESSION`: keep only for the active session or local working context.
- `TTL`: retain until the supplied ISO-8601 `expiresAt`; an expiry is mandatory.
- `UNTIL_DELETED`: retain until the user or an authorized operator requests deletion.

Deletion must remove the record and its derived indexes where the configured storage supports them. A deletion request is represented by `deletionRequestedAt`; it is not permission to retain raw content indefinitely. The current memory adapter is test/offline infrastructure and is not a production durability or privacy guarantee.

## Redaction

`redactSensitive` recursively replaces authorization headers, API keys, secrets, passwords, bearer values, cookies, private keys, and standalone tokens with `[REDACTED]`. Usage counters such as `inputTokens` and `outputTokens` remain available for cost accounting. Long strings are bounded to 2,000 characters. Redaction is defensive logging hygiene, not anonymization or encryption.

Do not log raw prompts, uploaded documents, open-text responses, access tokens, or provider credentials. Hashes identify content for lineage; they do not authenticate its origin and are not a substitute for encryption.

## Storage boundary

The storage adapter is intentionally small: create, get, update-with-expected-version, list, and delete. Every record carries a complete lineage envelope whose record ID/type/version must match the storage record. Updates are optimistic-concurrency checked and return isolated copies. The in-memory implementation accepts an injectable clock and removes expired TTL records deterministically; it is suitable for unit tests and local development only. A production adapter must define authentication, tenant isolation, encryption, backups, region, retention enforcement, deletion propagation, and incident access controls before it is enabled.

No provider, panel, database, telemetry service, or recruitment system is contacted by these contracts. Integration work requires explicit authorization, credentials, legal/privacy review, and an approved data-processing agreement.

Production operational telemetry uses two same-origin endpoints on the existing Vercel deployment. `/api/client-events` accepts only a strict browser-error fingerprint contract; `/api/product-events` accepts only the existing coarse product-event allowlist. Browser requests omit credentials and contain no persistent user/session identifier, raw URL, message, stack, prompt, research material, or application state. Both endpoints apply bounded bodies, same-origin checks, strict schemas, per-client abuse limits, and structured server-side redaction before writing ordinary Function logs. No additional telemetry provider or dynamically injected browser runtime is involved. See the [monitoring and product-improvement runbook](monitoring-and-product-improvement.md).

Vercel Web Analytics is present as an optional integration but is disabled by default. It is enabled only in a production build whose `VITE_LIKERTS_VERCEL_ANALYTICS` value is exactly `release-approved`; values such as `true` or `1` do not enable it. Approval requires the telemetry-provider, legal/privacy, and data-processing checks above. When enabled, the client drops malformed or cross-origin events and removes URL credentials, queries, and fragments before sending an event. The approval token is a public build-time policy switch, not a secret or evidence that those checks occurred.

Same-origin operational and product-event logging remains active in production when Vercel Web Analytics is disabled. If Web Analytics is explicitly approved, sanitized product events may be mirrored to it; approval does not broaden the event schema.

The localization release artifact additionally requires every executable browser response to match its immutable build manifest. Vercel's injected `/_vercel/insights/script.js` is not part of that static manifest. Therefore a browser-attested release must leave analytics disabled unless a separately reviewed runtime-dependency integrity contract is implemented and verified; an approval token alone does not satisfy that gate.

## Synthetic and human research boundary

Synthetic output may support question development, hypothesis generation, and interview planning. It must not be labeled as a human finding, representative sample, incidence estimate, conversion forecast, statistically significant result, or participant quote. Observed human data can be imported only through a separately validated human-research workflow with consent, eligibility, quality, denominator, and retention rules established before analysis.

## Operational checklist

Before enabling durable production storage or human-data import, verify:

1. Authentication and tenant ownership are defined.
2. Retention, deletion, backup, and regional processing policies are documented.
3. Logs and evaluation captures pass redaction tests.
4. Sensitive and observed-human data are excluded from model calls by default.
5. Storage, rate-limit, and telemetry providers have approved contracts and credentials.
6. Human-research ethics, consent, privacy, and jurisdictional review is complete.
