# Localization review and release protocol

This protocol prevents runtime support, translated copy, native review, population evidence, and attitudinal validation from being presented as the same claim.

## Evidence required for a native-review state

A locale capability may move from `review-pending` to `native-reviewed` only after a human reviewer supplies:

- reviewer name or stable organizational reviewer ID;
- review date in ISO 8601 format;
- glossary version;
- capability scope (`ui`, `report`, `source`, `retrieval`, `instrument`, or `sample`);
- reviewed product and prompt version;
- findings log covering accuracy, tone, terminology, placeholders, truncation, interaction labels, scale anchors, disclosures, and unsafe cultural assumptions;
- confirmation that all blocking findings were resolved and rechecked.

The registry records this as structured `nativeReview` evidence: `capabilityScope`,
`reviewedProductVersion`, `reviewedPromptVersion`, and a `findingsLog` whose entries
contain an ID, severity, status, and summary. `blockingFindingsResolved` must be
`true`, and the aggregate `nativeReview.status` is derived from the per-capability
statuses: it is `native-reviewed` only when every capability in the registry is
reviewed. A capability is release eligible only when it is in scope and all of this
evidence is present; a status string alone is never sufficient.

An LLM pass, automated script check, or successful build is not native review. Models may prepare machine-drafted copy and identify risks, but they cannot populate reviewer evidence.

Static sample badges expose the registry's declared `sample` copy-review state with
`authority: "registry-declared"` and `releaseEligible: false`. They do not assert
server release eligibility. A release-required deployment smoke check compares the
rendered badge with the scorecard's evidence-qualified `sample` capability state
and rejects any divergence.

## Signed native-review evidence intake

After the accountable reviewer has completed the CJK packet, an authorized
operator may validate the signed record before proposing any registry edit:

```sh
npm run localization:catalog-hash

LIKERTS_NATIVE_REVIEWER_KEYS_JSON='{"reviewer-id":{"publicKeyPem":"-----BEGIN PUBLIC KEY-----...","allowedLocales":["ja-JP"]}}' \
  npm run localization:review:intake -- \
  --input path/to/signed-cjk-native-review.json \
  --review-packet path/to/completed-cjk-review-packet.json \
  --review-packet-reference native-review/ja-jp/completed-cjk-review-packet.json \
  --expected-locale ja-JP \
  --expected-catalog-hash sha256:<64-lowercase-hex-characters> \
  --expected-build-id <exact-build-id> \
  --expected-browser-evidence-reference <exact-browser-evidence-reference> \
  --expected-approval-reference <exact-approval-reference> \
  --expected-product-version <exact-product-version> \
  --expected-prompt-version <exact-prompt-version> \
  --output path/to/native-review-receipt.json
```

All options shown above are required and may occur only once. Copy the exact
derived `catalogHash` from `npm run localization:catalog-hash`; the CLI treats
`--expected-catalog-hash` only as an operator assertion and rejects any value
that differs from the current candidate. The seven
`--expected-*` values come from the operator's independently selected release
candidate, not from the signed input. Intake fails unless they exactly match the
signed locale, catalog hash, build ID, browser-evidence reference, approval
reference, product version, and prompt version. Programmatic callers must provide
the same values in `expectedBindings`; they must also bind the packet digest and
reference. `LIKERTS_NATIVE_REVIEWER_KEYS_JSON` is an explicit reviewer trust map:
each reviewer entry must have only `publicKeyPem` and a non-empty
`allowedLocales` list drawn from `zh-CN`, `ja-JP`, and `ko-KR`. A legacy
`reviewerId -> PEM string` map is rejected, and a trusted reviewer cannot sign for
a locale outside their listed scope.

The input is an Ed25519-signed envelope with an exact
`native-review-evidence-v1` artifact. The reviewer ID is looked up only as an own
property of the configured key map, the key must parse as an Ed25519 public key,
and the signature must be the canonical padded Base64 encoding of exactly 64
bytes. `reviewedAt` must use `YYYY-MM-DDTHH:mm:ss.sssZ`. Intake applies a bounded
freshness policy (by default, maximum age 30 days and future skew 5 minutes); the
API and CLI wrapper accept an injected clock and bounds for deterministic use.

The signed artifact must identify the CJK locale, current registry and glossary
versions, the exact release-candidate bindings, a completed review-packet
reference and SHA-256 digest, every capability, every required review area, and
structured findings. Its `completionSummary` contains `{ id, completed,
evidenceReference }` rows and must cover exactly once:

- every journey ID in `cjk-review-packet-v1.json`;
- viewports 320, 375, 768, and 1440;
- all six localization capabilities and all required CJK review areas;
- every accessibility and per-locale provenance requirement in the packet;
- the resolution, recheck, and automated-rerun requirements; and
- every resolved blocking finding in `blockingFindingRechecks`.

Every row must say `completed: true` and cite evidence in the completed packet.
The submitted packet is not the pending source template: it must use
`likerts-completed-cjk-native-review-packet-v1` /
`cjk-completed-review-packet-v1.1.0`, have `status: "completed"`, and contain
the exact signed `completionSummary`, locale-bound provenance, structured
findings, and unique `{ id, kind, summary, contentDigest }` `evidenceRecords`.
Every `contentDigest` is required to be `sha256:` followed by 64 lowercase hex
characters and must be computed over the exact referenced evidence bytes. Its
locale, market, catalog/glossary/build/product/prompt values, browser evidence,
reviewer, date, approval reference, and packet reference must match the signed
artifact.
The artifact findings log must be the documented packet projection: `blocking`
stays blocking, `high`/`medium`/`low` become non-blocking, only `resolved` stays
resolved, and `open`/`accepted`/`wont-fix`/`needs-context` become open. Every
artifact completion, finding, browser-gate, and approval evidence reference must
resolve to a correctly typed packet evidence record.

The signed digest is over the exact packet-file bytes. The CLI opens each input and
packet once, rejects a symbolic link where the platform supports no-follow opens,
`fstat`s that handle, and reads at most 1 MiB before parsing strict UTF-8 JSON
without duplicate object keys. It hashes those exact packet bytes, compares the digest and reference with the signed artifact, validates
the completed schema, and records `reviewPacketByteVerification: "HASH_VERIFIED"`
plus `reviewPacketSchemaValidation: "COMPLETED_PACKET_VALIDATED"`. API validation
without supplied packet bytes records `status: "DECLARATIONS_ONLY"`,
`reviewPacketByteVerification: "NOT_SUPPLIED"`, and
`reviewPacketSchemaValidation: "NOT_SUPPLIED"`; it does not claim to have
inspected, hashed, or schema-validated a referenced file. Do not commit private
keys or a trusted-key environment value to the repository.

Because every evidence-record digest is inside those packet bytes, the packet
digest and Ed25519 signature bind the reviewer's declared `contentDigest` values.
The current importer does not open or fetch the evidence references, however, so
it does not compare those declarations with the referenced bytes. A successful
receipt proves the declared digests were signed; independent evidence storage or
handoff must verify the referenced content against them.

### Canonical signing bytes

Sign the UTF-8 bytes returned by `canonicalNativeReviewEvidenceJson`, not a
pretty-printed file or a JavaScript object. It emits compact JSON: object keys are
sorted with JavaScript's default UTF-16 code-unit ordering, arrays keep their
existing order, and strings/numbers/booleans/null use `JSON.stringify` spelling.
Accessor properties, non-plain values, sparse arrays, non-finite numbers, and
cyclic data are rejected. Intake snapshots those canonical artifact bytes once and
uses that immutable snapshot for signature verification, evidence ID, validation,
and the returned receipt.

The fixed known-answer vector is the UTF-8 string
`{"a":[true,null,{"a":2,"b":"x"}],"z":0,"é":"snowman ☃"}`, whose SHA-256 is
`b5436cb14572a31a8c4e61529510d7774fb81dda23439f1830c3b601c2c34211`.
The native-intake test verifies an independently fixed Ed25519 signature for those
exact bytes.

Start from the deliberately incomplete
[CJK intake template](./localization-review-kit/cjk-native-review-evidence-template.json).
It has blank evidence fields and a `null` signature, so it is not review
evidence and the intake command must reject it until a reviewer completes and
signs a separate copy.

An accepted packet-backed receipt has status `EVIDENCE_VALIDATED` and a stable
evidence ID derived from the canonical signed artifact (not from Base64 envelope
spelling). It includes `validatedAt`, `expiresAt`, and the applied freshness
`policy`; a receipt must not be reused after its stated expiry. A declarations-only
API receipt is deliberately not `EVIDENCE_VALIDATED`. Neither form establishes that
the reviewer is the claimed person, that cited captures are truthful, or that the
review acts actually occurred. Even `HASH_VERIFIED` plus completed-schema validation
establishes only the supplied packet bytes and declared record links, not the truth
of their contents. Maintainer inspection and the
actual accountable human review remain mandatory. The receipt deliberately reports
`registryMutation: "NOT_PERFORMED"` and `releaseDecision: "NOT_EVALUATED"`:
the command does not modify `shared/localization.mjs`, change copy or
native-review statuses, or make a release decision. The signed packet and intake
must instead be created against an exact prospective candidate in which the
reviewer metadata and deliberate registry-version change have already been
prepared. An authorized maintainer must inspect the receipt and referenced
evidence, then merge and deploy those exact reviewed bytes without another
catalog or registry mutation. Any later copy, metadata, catalog, or registry
change creates a new candidate and requires the affected gates to run again. An
unsigned template, a CI artifact, or an automated test result cannot produce an
accepted receipt.

## Review sequence

1. Prepare the exact prospective catalog and `shared/localization.mjs` projection, including reviewer fields that will become valid on sign-off and a deliberate prospective `LOCALIZATION_REGISTRY_VERSION`; keep this candidate unmerged.
2. Freeze that candidate's catalog, glossary, registry, product, prompt, and build identifiers. Run `npm run localization:catalog-hash` to derive the exact CJK UI catalog/registry binding. The command does not prepare reviewer metadata or make a release decision, so the maintainer must still reconcile the complete prospective projection explicitly.
3. Run exact-key, placeholder, script, build, browser, and automated accessibility checks on those exact candidate bytes.
4. Give the reviewer the complete candidate journey, not isolated strings: first run, all research methods, errors, results, evidence, population frame, model card, stability, qualitative exploration, exports, and human-research handoff. Use the frozen [CJK review packet](./localization-review-kit/cjk-review-packet-v1.json) and [checklist](./localization-review-kit/cjk-native-review-checklist-v1.md), or the separate [ASEAN review packet](./localization-review-kit/asean-review-packet-v1.json) and [checklist](./localization-review-kit/asean-native-review-checklist-v1.md), so reviewer identity, scope, findings, and sign-off remain attributable.
5. Record findings without replacing technical tokens, URLs, hashes, model IDs, or canonical enum values in stored data. Resolve findings in the candidate, then freeze and rerun every affected check before signature.
6. Sign the final candidate packet and run native-evidence intake against that same prospective registry version and build. A receipt for another worktree, version, or build is not transferable.
7. After authorized inspection, merge, publish, and deploy the exact reviewed candidate. Do not increment the registry version or alter catalog/reviewer metadata after signature; any such change starts a new review candidate.

## Browser gate

Each reviewed locale must pass at 320, 375, 768, and 1440 CSS pixels:

- no page-level horizontal overflow;
- keyboard access and visible focus for every control;
- correct document `lang` and `dir`;
- readable chart alternatives and semantic tables;
- no clipped CJK text, orphaned Korean syllables, or broken technical identifiers;
- localized accessible names, validation messages, and live announcements;
- original-language evidence clearly labelled and not silently translated.

The automated browser matrix runs axe checks for WCAG 2.1 Level A and AA rules
before leaving each canonical UX surface. Every locale/viewport cell must bind
the exact core surface set, while one designated deep cell per locale must also
bind the error, specialized-method, human-handoff, static-sample, and restored-
project surfaces. Each named receipt records how many snapshots were inspected
and must contain zero violations. This is a required technical gate, not proof
of complete accessibility: automated keyboard checks and axe cannot establish
screen-reader behavior, language quality, native-platform font rendering, or
manual zoom/reflow conformance. Those checks still require accountable manual
review.

Canonical browser attestation v5 content-addresses the axe engine, engine
version, exact ruleset tags, exact named surface receipts, snapshot counts, and
zero violations for every matrix cell. It also signs the current derived
localization catalog hash. Earlier attestation schemas, a stale catalog hash,
missing or extra surfaces, duplicate receipts, altered rulesets, aggregate/count
mismatches, or any recorded violation fail closed.

## Market and research claims

Native language review does not establish population coverage. Population readiness requires reviewed official data for the declared universe and coverage date.

Neither language nor population fit proves attitudinal accuracy. The scorecard calibration date must remain `null` until the Validation Lab contains an eligible held-out comparison for the exact market, locale, population, method, wording, scale, and field dates.

The attitudinal validation status is also evidence-backed rather than an assertion:
`validated` requires a structured `attitudinalValidationEvidence` record containing a
comparison ID, calibration date, and calibration scope for market, locale, population,
method, question types, wording, scale, and field dates. Until that record exists, the scorecard must
keep `accuracyClaimPermitted` false and the calibration fields null.

## Local attestation bundle and promotion boundary

The browser gate can write a passed `CI_ARTIFACT` attestation, but that file alone is
not a publication. Create a deterministic, content-addressed local bundle only after
the complete browser run has produced the attestation and the exact build directory:

```sh
npm run attestation:bundle -- \
  --attestation /path/to/attestation.json \
  --artifact-directory /path/to/dist \
  --output /path/to/evidence-bundle
```

The bundle contains the canonical attestation, a portable artifact manifest, and the
hashed build files under `<artifact-sha256>/`. This mirrors the required immutable
publication path (`/<artifact-hash>/attestation.json`) while remaining local. Its
manifest is explicitly `CI_ARTIFACT` with `published: false`; the command does not
upload, deploy, or claim a public URL. Verify it independently
from the local directory before any separately authorized promotion:

```sh
npm run attestation:bundle:verify -- /path/to/evidence-bundle
```

Verification recomputes every payload hash, the aggregate bundle digest, the exact
artifact digest, and the attestation evidence ID. It rejects altered files, stale or
non-canonical manifests, and `PUBLISHED` attestations. A future publication step must
still serve the same attestation at HTTPS `/<artifact-hash>/attestation.json` and must
be reviewed as a separate deployment action.

## Signed browser-evidence promotion

Publishing is a separate, authorized handoff. It starts from the independently
verified local `CI_ARTIFACT` bundle and writes three canonical files for a later upload;
it does not upload, deploy, or change any scorecard:

```sh
LIKERTS_LOCALIZATION_PROMOTION_KEYS_JSON='{"release-operator":"-----BEGIN PUBLIC KEY-----..."}' \
  npm run attestation:promote -- \
  --bundle /path/to/evidence-bundle \
  --evidence-url https://evidence.example/localization/<artifact-hash>/attestation.json \
  --promotion-url https://evidence.example/localization/<artifact-hash>/promotion.json \
  --signer-id release-operator \
  --private-key-file /secure/path/release-operator-ed25519.pem \
  --output /path/to/publication-stage
```

The stage contains only canonical `artifact-manifest.json`, `attestation.json`, and
`promotion.json`, and reports `publicationPrepared: true` with `uploaded: false`.
The manifest is copied byte-for-byte from the verified bundle and rechecked against
every bundled artifact file before staging; strict deployment smoke uses it to bind
the bytes served by the deployment to the signed artifact digest. The private key is
read only to sign locally and is never written to the stage or output. The signed
`localization-browser-evidence-promotion-v1` artifact binds the exact verified CI
bundle digest and CI evidence ID to the build ID/artifact digest, the deterministically
derived `PUBLISHED` attestation ID, both immutable URLs, signer ID, and canonical UTC
signing time. The two HTTPS URLs must share the same `/<artifact-hash>/` directory.

The public scorecard must remain `NOT_PUBLISHED` for a raw `PUBLISHED` attestation.
It may project automated journey evidence only after a trusted Ed25519 promotion record
is validated against that exact published attestation. Do not commit private keys or the
trusted-public-key environment value to the repository.

The scorecard API is deliberately fail-closed: it does not discover staged files,
read an arbitrary local path, or accept evidence URLs from an HTTP request. It reads
one server-only configuration variable described below. When that variable is absent,
the scorecard remains honestly pending. When it is present but invalid or unavailable,
the API returns a sanitized, non-cacheable 503 rather than silently falling back to a
pending or published claim. Creating or uploading the records alone is not a release
decision.

## Native-review release evidence injection

The server now has a programmatic, deployment-authority adapter for native-review
evidence. For each configured CJK locale it accepts only an independently selected
envelope URL, completed-packet URL, exact nine-field `expectedBindings`, and optional
allowed HTTPS origin; trusted reviewer public keys are supplied separately. It fetches
at most three locale pairs, uses manual redirect handling, bounds every file to 1 MiB
plus an aggregate deadline/byte budget, rejects any DNS result that is not globally
routable, and pins HTTPS socket lookup to the prechecked public addresses while
preserving the configured hostname for certificate validation, SNI, and the Host
header. It requires exact HTTPS response identity and JSON content type, parses strict
JSON, validates the signed envelope and exact packet bytes, and returns copied, frozen
scorecard context. It never takes URLs or bindings from an HTTP request or the deployed
scorecard. Missing deployment configuration remains the existing pending projection; a
configured source that is invalid or unavailable makes the scorecard API fail with a
sanitized, non-cacheable 503 instead of silently falling back to pending. Successful
scorecard responses are also non-cacheable, so intermediaries cannot replay stale
release state or a request-scoped correlation identifier.

Deployment smoke must receive that context independently, either directly from release
authority or from a zero-argument loader. It validates the signed evidence again and
uses the identical context for its canonical scorecard reconstruction. The signed
`browserGateEvidenceReference` must equal the exact immutable URL of the validated
published attestation, and its build ID must match that attestation; deployment smoke
fails closed on a mismatch even while the registry remains `review-pending`. If a
deployed scorecard claims effective native-review evidence while smoke lacks independent
native authority, smoke fails `LOCALIZATION_SMOKE_NATIVE_REVIEW_AUTHORITY_REQUIRED`. A
valid packet still does not promote the current `review-pending` registry: an authorized
maintainer must separately update matching registry metadata and rerun the browser and
release gates.

## Production scorecard evidence configuration

`/api/localization-scorecard` composes browser-promotion and native-review evidence
from the single server-only variable
`LIKERTS_LOCALIZATION_RELEASE_EVIDENCE_JSON`. The route never reads request headers,
query parameters, cookies, or bodies to choose release evidence. The value must be
compact JSON using exactly this shape; unknown or partial fields are rejected:

```json
{
  "schemaVersion": "localization-release-evidence-source-v1",
  "browser": {
    "buildIdentity": {
      "id": "<exact-build-id>",
      "artifactDigest": "sha256:<64-lowercase-hex-characters>"
    },
    "attestationUrl": "https://evidence.example/localization/<artifact-hash>/attestation.json",
    "promotionUrl": "https://evidence.example/localization/<artifact-hash>/promotion.json",
    "trustedPromotionKeys": {
      "release-operator": "-----BEGIN PUBLIC KEY-----\n<Ed25519 public key>\n-----END PUBLIC KEY-----\n"
    }
  },
  "nativeReview": {
    "sourceConfig": {
      "ja-JP": {
        "envelopeUrl": "https://evidence.example/native-review/ja-JP/<packet-hash>/envelope.json",
        "packetUrl": "https://evidence.example/native-review/ja-JP/<packet-hash>/packet.json",
        "allowedOrigin": "https://evidence.example",
        "expectedBindings": {
          "locale": "ja-JP",
          "catalogHash": "sha256:<64-lowercase-hex-characters>",
          "buildId": "<exact-build-id>",
          "browserGateEvidenceReference": "https://evidence.example/localization/<artifact-hash>/attestation.json",
          "approvalReference": "<maintainer-approval-reference>",
          "reviewedProductVersion": "<product-version>",
          "reviewedPromptVersion": "<prompt-version>",
          "reviewPacketDigest": "sha256:<64-lowercase-hex-characters>",
          "reviewPacketReference": "<stable-review-packet-reference>"
        }
      }
    },
    "trustedReviewerKeys": {
      "reviewer-id": {
        "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n<Ed25519 public key>\n-----END PUBLIC KEY-----\n",
        "allowedLocales": ["ja-JP"]
      }
    }
  }
}
```

The browser URLs must share the exact content-addressed artifact directory named by
the configured digest. Native packet URLs must be bound to their packet digest, and
every native `browserGateEvidenceReference` must equal the configured attestation URL.
Both loaders use DNS-pinned HTTPS with no redirects, strict JSON content types,
bounded files, an aggregate deadline, exact build/signature validation, and only
globally routable addresses. Configure public keys only; signing keys never belong in
the deployed runtime. The remaining operator work is to publish the immutable files,
populate the environment value, deploy the exact build, and run deployment smoke with
independent evidence authority.

The HTTP endpoint and MCP localization-scorecard resource use the same shared
composer and the same zero-argument, server-only release-evidence provider. An
unset configuration stays honestly pending. A present but invalid or unavailable
configuration returns a sanitized non-cacheable HTTP 503 or, for MCP, a sanitized
JSON-RPC internal error whose data code is
`LOCALIZATION_RELEASE_EVIDENCE_UNAVAILABLE`; provider diagnostics are not exposed.
Neither path accepts request-derived evidence authority, and the existing MCP
runtime exposure controls remain unchanged.

Release-required deployment smoke performs a bounded MCP `resources/read` for
`likerts://localization/scorecard` and requires the complete projection to match
HTTP after removing only the transport correlation ID. Diagnostic smoke does not
claim that parity check.

The signed native packet carries `catalogHash`, and intake requires it to equal
the value derived from the exact effective CJK UI messages plus registry version,
locale metadata, capability states, and review provenance in the current
candidate. Browser attestation v5 binds the same value, promotion rejects a stale
attestation, runtime evidence configuration rejects an arbitrary native binding,
and the scorecard requires the native and browser bindings to match. The browser
artifact manifest separately binds the exact deployed build bytes. These controls
prove catalog/build lineage, not language quality or accountable native review.

## Current release boundary

Simplified Chinese (`zh-CN`), Japanese (`ja-JP`), and Korean (`ko-KR`) are machine-drafted and runtime-enabled, but remain `review-pending` and not launch-ready. ASEAN language locales remain planned and runtime-disabled until their individual technical, copy, native-review, accessibility, population, and browser gates are satisfied.
