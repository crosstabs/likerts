# Open source forms for Likerts

Product foundation evaluation | 6 September 2026 | Prepared for the Likerts founder

## Recommendation

Evaluate LimeSurvey Community Edition and Form.io’s MIT browser builder and renderer in a small side-by-side prototype. LimeSurvey is the strongest complete-platform candidate for getting a working service quickly. Form.io is the strongest candidate when we want to reuse an existing visual builder while owning the collection backend. SurveyJS’s MIT Form Library is the alternative if we are willing to build a small editor ourselves.

For the stated product, my preferred long-term direction is a reusable browser component with a purpose-built collection backend. That is an architectural judgment about control and scope, not evidence that it will be cheaper than LimeSurvey. Do not commit to a fork or the $1 price before testing the two routes.

The research covers 15 relevant product families, including complete platforms, browser components and field-data systems. It evaluates Likerts as “Google Forms en masse”: a fixed set of question types, bulk collection links, structured metadata, centralized exports and a target price of $1 per 100,000 completed submissions. AI analysis, recruitment, uploads and enterprise research features are outside the initial scope. Recommendations assume we want the option of a proprietary hosted service; an openly licensed Likerts would make AGPL candidates more attractive.

| Route | Reuse | Main work remaining | Decision |
| --- | --- | --- | --- |
| LimeSurvey CE | Builder, survey runtime, storage, automation API | Simple management UI, link metadata, short URLs, billing | Best complete app to prototype |
| Form.io browser components | MIT visual builder and renderer | Collection backend and all account operations | Preferred existing-builder route |
| SurveyJS Form Library | MIT survey renderer | Small editor plus backend and operations | Preferred custom-editor route |

These component boundaries are supported by the [LimeSurvey API reference](https://api.limesurvey.org/classes/remotecontrol-handle.html), [Form.io browser repository](https://github.com/formio/formio.js) and [SurveyJS licensing documentation](https://surveyjs.io/licensing).

The most important correction to the earlier discussion is that a reusable form interface is only part of the product. None of the reviewed documentation established the complete Likerts workflow or its target unit economics. Published features were checked against official documentation, repositories and licenses; no product was installed, security-audited or load-tested in this research.

<!-- PAGE -->
## Complete survey applications

### LimeSurvey Community Edition

The strongest complete-app candidate. RemoteControl documents survey copying, import, activation, settings, bulk participant creation and exports. Participant tables support custom attributes and tokens. That is useful automation coverage for a service managing many collections. Sources: [RemoteControl API](https://api.limesurvey.org/classes/remotecontrol-handle.html) and [participant documentation](https://www.limesurvey.org/manual/Tokens).

We would still build the simple bulk-management experience. A participant token is not automatically a reusable store link: test multiple submissions, resume behavior and anonymous-mode metadata before using it that way. Anonymous responses deliberately avoid participant linkage. PHP and a relational database require deployment and patching, but do not by themselves prove high cost. Sources: [participant settings](https://www.limesurvey.org/manual/Tokens) and [installation requirements](https://www.limesurvey.org/manual/Installation_-_LimeSurvey_CE).

GPL-2.0-or-later applies; trademark rights are separate. Prefer an integration layer over extensive core changes. [License and trademark policy](https://community.limesurvey.org/licence-trademark/).

### OpnForm

A complete builder with REST endpoints for forms and submissions, including hidden fields and metadata. The documented Docker setup includes Nuxt, Laravel, workers, PostgreSQL and Redis. This is a plausible quick product base, with more services to operate than a browser-library approach. Sources: [create API](https://docs.opnform.com/api-reference/forms/create-form), [submissions API](https://docs.opnform.com/api-reference/submissions/list-submissions) and [deployment](https://docs.opnform.com/deployment/docker).

Current licensing separates the AGPL core from proprietary api/app/Enterprise code. The official self-hosted Enterprise offering gates additional users and branding controls. These edition boundaries are not proof that AGPL forbids independently modifying pure core code; they do require an exact code-boundary review before a fork. Verdict: secondary choice. Sources: [root license](https://github.com/OpnForm/OpnForm/blob/main/LICENSE) and [self-hosted licensing](https://opnform.com/self-hosted/license).

### HeyForm

AGPL conversational form builder with varied inputs, hidden fields and exports. Its self-host deployment uses MongoDB and a Redis-compatible service. Hidden fields arrive through URL parameters, so they do not provide confidential or tamper-proof metadata. No supported bulk-management API comparable to LimeSurvey’s was established in this review. Verdict: consider if a conversational respondent experience is a requirement. Sources: [repository](https://github.com/heyform/heyform), [hidden fields](https://docs.heyform.net/features/hidden-fields), [deployment](https://docs.heyform.net/open-source/self-hosting).

### Formbricks

Complete survey and experience-management application with AGPL core and separate enterprise modules. Its README states that the vendor does not offer commercial white-label licensing; this does not erase rights granted by the AGPL for compliant core use. Deployment has Redis and S3-compatible storage requirements. Verdict: credible for an openly licensed survey product, but a broader platform than Likerts initially needs. Sources: [README and boundaries](https://github.com/formbricks/formbricks/blob/main/README.md?plain=1), [migration requirements](https://formbricks.com/docs/self-hosting/advanced/migration).

<!-- PAGE -->
## Browser components we can reuse

### Form io JavaScript builder and renderer

The key discovery is that the MIT browser package contains both a visual builder and renderer. It can render form JSON and submit to a custom endpoint. We can adopt this package without adopting Form.io hosting or its community server. Sources: [browser project](https://github.com/formio/formio.js), [current MIT license](https://github.com/formio/formio.js/blob/main/LICENSE.txt), [custom endpoint example](https://formio.github.io/formio.js/app/examples/customendpoint.html).

Likerts would limit the builder to supported question types and own accounts, versioning, metadata, exports and billing. The prototype must verify that unwanted controls and server-dependent features can be cleanly removed. Server-side validation remains ours; browser validation is insufficient. The separate community server is OSL-3.0, whose external-deployment provision treats network use as distribution. Do not apply the browser package’s MIT license to the server. [Server license](https://github.com/formio/formio/blob/main/LICENSE.txt).

Verdict: first choice when reusing an existing visual editor matters. Keep the schema and submission adapter narrow enough to replace the renderer later.

### SurveyJS Form Library and Creator

The free Form Library is MIT and renders survey JSON. Creator, Dashboard and PDF Generator are proprietary components. SurveyJS supplies the frontend, not the database or collection service. Custom schema properties are possible, but are not a secure metadata-management system. Sources: [licensing](https://surveyjs.io/licensing), [MIT license](https://github.com/surveyjs/survey-library/blob/master/LICENSE), [custom properties](https://surveyjs.io/form-library/documentation/customize-question-types/add-custom-properties-to-a-form).

The commercial FAQ permits SaaS uses while restricting competing developer products. It would be inaccurate to claim either that every survey SaaS is banned or that a standard Creator license certainly covers Likerts. Obtain written scope clarification before relying on Creator. This issue does not apply to the MIT Form Library. [Licensing FAQ](https://surveyjs.io/faq/licensing).

Verdict: excellent shortlist option with a small independently built editor for our fixed types. Compare the effort against simplifying Form.io’s existing builder.

### JSON Forms

MIT schema-based rendering for React, Angular and Vue, with validation, visibility rules and custom renderers. It is form infrastructure rather than a complete survey application or ready-made business editor. Verdict: good for strict data schemas, but likely more questionnaire-specific design work than SurveyJS. That relative effort is an inference. Sources: [official overview](https://jsonforms.io/), [repository](https://github.com/eclipsesource/jsonforms).

### jQuery formBuilder

MIT visual builder and formRender, JSON/XML templates, custom controls and response-data extraction. It remains maintained; using jQuery does not mean abandoned. Verdict: viable, but a lower priority for a new application unless its simple editor saves substantial work. All collection and workspace services remain ours. Sources: [official site](https://formbuilder.online/), [license](https://github.com/kevinchappell/formBuilder/blob/master/LICENSE), [releases](https://github.com/kevinchappell/formBuilder/releases).

<!-- PAGE -->
## Field collection and ecosystem alternatives

### ODK Central and its clients

ODK Central is Apache-2.0 and provides form, account and submission APIs. Its public-link API includes creation and revocation, making it a serious mass-collection candidate rather than merely a mobile survey tool. Collect is a separate mobile client; web collection is also available. Sources: [Central repository](https://github.com/getodk/central), [form and public-link API](https://docs.getodk.org/central-api-form-management/), [web submissions](https://docs.getodk.org/central-submissions/).

Its XLSForm/XForms ecosystem is more complex than our proposed fixed JSON questions. We would need simplified authoring, metadata governance, short links and commercial account management. Verdict: promote to the shortlist if offline fieldwork or standards interoperability becomes central; otherwise its strengths exceed the present scope.

The archived old ODK Web Forms repository records a move into Central Frontend, not abandonment. Documentation about default renderers is in transition; verify the release selected for implementation. [Migration notice](https://github.com/getodk/web-forms), [current frontend](https://github.com/getodk/central-frontend).

### KoboToolbox

Full field-data builder and collection platform; KPI is AGPL-3.0. It supports web collection, offline workflows, hidden fields and URL prefilling, plus API-based management and exports. Its self-host deployment includes several services and databases. Verdict: strong existing tool for field research, lower fit for a stripped-down commercial collection service. Sources: [KPI repository](https://github.com/kobotoolbox/kpi), [web collection](https://support.kobotoolbox.org/data_through_webforms.html), [Docker deployment](https://github.com/kobotoolbox/kobo-docker).

Hosted nonprofit quotas are not self-host infrastructure costs or reuse rights. Likewise, repository migrations within the ecosystem should not be confused with product abandonment.

### Enketo

An XForms engine family rather than a complete survey business application. Current Core and Express license files are Apache-2.0. Express needs supporting services and a form/data server; Core alone does not supply link management or the whole offline workflow. Verdict: use if XForms interoperability is a reason to exist, not just to avoid implementing a few question types. Sources: [current monorepo](https://github.com/enketo/enketo), [Core license](https://raw.githubusercontent.com/enketo/enketo/main/packages/enketo-core/LICENSE), [Express license](https://raw.githubusercontent.com/enketo/enketo/main/packages/enketo-express/LICENSE).

Old Enketo repositories and branding notes can be stale. Check NOTICE files, assets and dependencies at the adopted revision before making broad rebranding claims.

### Nextcloud Forms

An AGPL forms application inside Nextcloud with a simple survey interface and exports. It is relevant if we already want Nextcloud, but adopting the parent collaboration platform creates extra coupling for a standalone Likerts service. Bulk collection metadata was not established by reviewed documentation; that is an evidence gap, not proof of absence. Verdict: do not choose it as the default standalone foundation. [Repository](https://github.com/nextcloud/forms).

<!-- PAGE -->
## Smaller projects and maintenance findings

### Formera

A permissively licensed complete-app candidate worth knowing about. The repository describes a Go backend, Nuxt frontend, SQLite, drag-and-drop builder, ratings, custom slugs and CSV/JSON exports. It explicitly permits offering the MIT project as a paid service. [Repository](https://github.com/FormeraApp/Formera), [license](https://github.com/FormeraApp/Formera/blob/main/LICENSE.md).

The observed repository history is much smaller than the leading candidates, and the current repository metadata reports a last push in January 2026. That is a maintenance-risk signal, not a security finding. Bulk metadata, tenant isolation and sustained collection throughput remain unverified. Verdict: exploratory fallback, not first production choice. [Repository metadata](https://api.github.com/repos/FormeraApp/Formera).

### Quill Forms

React/TypeScript conversational forms with a WordPress ecosystem. License signals need reconciliation: the root LICENSE.md contains LGPL-3.0, while builder-core and renderer-core package manifests declare GPL-2.0-or-later. Do not characterize this as a clean permissive library on the strength of a repository badge. Verdict: hold until the exact packages and license terms are resolved; conversational presentation is not essential to our scope. Sources: [project](https://github.com/quillforms/quillforms), [root license](https://raw.githubusercontent.com/quillforms/quillforms/master/LICENSE.md), [renderer manifest](https://raw.githubusercontent.com/quillforms/quillforms/master/packages/renderer-core/package.json), [builder manifest](https://raw.githubusercontent.com/quillforms/quillforms/master/packages/builder-core/package.json).

### OhMyForm

AGPL complete form-builder project, but its repository was archived on 31 October 2024 and points users toward Formbricks. Verdict: reject as a new foundation unless we deliberately accept maintaining an abandoned project. [Archive notice](https://github.com/ohmyform/ohmyform).

### Maintenance interpretation

Current repository metadata shows September 2026 pushes for LimeSurvey, OpnForm, SurveyJS, Form.io, Formbricks and formBuilder; August pushes for HeyForm, JSON Forms and Quill Forms. These indicate activity, not product quality, secure releases or guaranteed support. Release artifacts confirm OpnForm v2.5.0 on 2 September and HeyForm v3.0.2 on 28 August. Sources: [OpnForm release](https://github.com/OpnForm/OpnForm/releases/tag/v2.5.0), [HeyForm release](https://github.com/heyform/heyform/releases/tag/v3.0.2); repository metadata was retrieved directly from GitHub on the report date.

### What licensing means for our decision

MIT components are the simplest fit for optional proprietary ownership, while retaining required notices. GPL, AGPL and OSL are not bans on commercial services. Their obligations differ: the GNU guidance distinguishes GPL server use from AGPL network-source obligations, and Form.io’s OSL server has its own external-deployment clause. Browser-delivered code and distributed packages need separate consideration. Commercial modules and trademarks do not automatically inherit the core license. Sources: [GNU license FAQ](https://www.gnu.org/licenses/gpl-faq.en.html), [Form.io server license](https://github.com/formio/formio/blob/main/LICENSE.txt).

<!-- PAGE -->
## Collection architecture and cost target

### One form with many collection links

For 2,000 stores using the same questions, prefer one versioned form with 2,000 collection-link records. Each opaque short code maps to a form version and stored metadata such as store ID and campaign. A response records the collection ID, form version and metadata snapshot. This is our proposed design, not a verified native feature across the candidates.

A store link should support many independent people. A respondent token may identify one person or permit resume/edit behavior. Keep these concepts separate. A public store QR code cannot establish that the respondent was physically present or is a unique human. Preserve that distinction in the product promise.

Store trusted metadata behind the link rather than accepting arbitrary hidden URL values as authoritative. Validate permitted metadata and question types on the server. Keep immutable published form versions so edited labels or options do not silently change the meaning of historical exports. Batch link creation, bulk closure, CSV exports and prepaid accounting belong in this management layer whichever engine we choose.

### What the price actually requires

$1 per 100,000 submissions equals $10 per million. A $50 monthly infrastructure bill needs five million submissions just to match that bill at this rate, before payment processing, support or development. This is arithmetic, not a forecast or a cloud quotation.

The earlier $0.26 illustration covered only 200,000 Worker requests at $0.30/million and 200,000 D1 row writes at $1/million. It omitted compute, storage, reads, retries, exports, logs, security services and fixed overhead. Cloudflare’s paid plan includes allowances and a $5 monthly base, so actual bills depend on total account usage. Those rates do not price a LimeSurvey or other PHP deployment. Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

Retention is material. At an assumed 2 KB per response, 100,000 responses contain about 0.2 GB before indexes and database overhead. At D1’s published $0.75/GB-month beyond allowances, that payload alone is about $0.15 per month, or $1.80 for a year. This illustrative calculation shows why a one-time $1 payment cannot casually include permanent hot storage. Archiving can change the model but must be separately costed. [D1 storage pricing](https://developers.cloudflare.com/d1/platform/pricing/).

Limit payload size, text length and question count; exclude uploads from the base rate. Specify retention and export limits. Measure actual traffic per completion because abandoned visits and repeated requests still consume resources. Use prepaid balances and account spending limits. No candidate is proven to meet the price target; none is ruled out merely by language or framework.

<!-- PAGE -->
## Prototype decision and evidence limits

### Test two implementations of the same workflow

Prototype A uses LimeSurvey CE through its documented API, with minimal core changes. Prototype B uses Form.io’s MIT builder and renderer, restricted to our fixed types, with a minimal collection service. If simplifying Form.io requires extensive overrides, substitute SurveyJS’s MIT renderer with a small independent editor.

Use identical fixtures: one 10-question template, 2,000 collection links and 100,000 completed submissions. Treat these as proposed test inputs. Run low steady traffic and bursts separately; 100,000 monthly responses does not specify required concurrency.

| Gate | Evidence needed |
| --- | --- |
| Collection correctness | Exact accepted-response counts; retries do not create duplicate charges or records |
| Metadata | Correct link attribution; tampered parameters cannot replace authoritative metadata |
| Shared links | Independent respondents cannot resume or overwrite someone else’s response |
| Bulk operations | Generate links, close selected campaigns and export consistent columns without manual per-form work |
| Versioning | Editing a draft cannot reinterpret existing responses; exports identify the published version |
| Operating cost | Measured CPU, reads/writes, payload/storage, delivery, logs, exports and fixed cost allocation |
| Maintainability | Reproduce installation and upgrade without a large patch set; identify license boundaries |

Choose LimeSurvey if its existing capabilities substantially reduce implementation and its tested overhead fits the business. Choose the component route if owning ingestion and simplifying management produces a better result with a manageable amount of new code. Avoid inventing a weighted numerical score before observing these tradeoffs.

### Confidence and remaining gaps

Confidence is high in the verified component-license distinctions, documented APIs and archive status. Relative implementation effort is medium-confidence inference. Cost, throughput, accessibility in our final configuration, security and tenant isolation remain untested. Commercial-license applicability for SurveyJS Creator, Quill Forms’ conflicting license signals and release-specific ODK renderer behavior remain explicit gaps.

The research used official repositories, license files, API/deployment documentation and current repository metadata. Follow-up checked licensing exceptions, API claims and stale maintenance signals. Remaining uncertainties require a prototype, package-level audit or vendor clarification.

This is a broad evaluation of 15 relevant families, not a claim to cover every open-source repository. New or weakly documented search results were not promoted based only on a landing page. Hosted-only services and general form-state libraries were excluded because they do not supply a reusable survey product or renderer suitable for this comparison.

Sources are linked beside claims and were checked on 6 September 2026. The next investment should be the two-route prototype.
