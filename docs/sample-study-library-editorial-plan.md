# Sample Study Library Editorial Plan

## Status

Proposed launch plan. No sample-study results described here have been published, generated, or validated by humans.

This document was assembled with automated research and repository inspection. It must not be described as native-human reviewed, independently reviewed, expert reviewed, or editorially approved unless that work has actually occurred and the responsible reviewer is identified.

Permitted status labels are:

- `Automated QA passed` — automated structural, language-script, source-link, arithmetic, metadata, and policy checks passed.
- `Human editorial review pending` — no qualified human editor has yet approved the study.
- `Human editorial review completed by {name or accountable team}, {date}` — use only after that person or team actually reviewed the complete page.
- `Native-language review completed by {name or accountable team}, {date}` — use only after a proficient human reviewer actually reviewed the full locale-specific page.
- `Independent review completed by {name or organization}, {date}` — use only when a reviewer independent of the production process actually performed and documented the review.

`Automated QA passed` must never be presented as equivalent to human, native-language, expert, or independent editorial review.

## Purpose and decision

Likerts should launch a small, curated library of complete, frozen synthetic sample studies. The library should demonstrate the product, create useful entry points for different languages and industries, and lead readers toward appropriate human research.

Launch with ten studies: one locally relevant study for each currently enabled sample/report locale. Do not expand into a locale-by-industry matrix until the pilot pages meet the quality gates in this document and demonstrate real user value.

Every public study must remain explicit that:

- its distributions, segments, explanations, and verbatims are model-generated synthetic output;
- no people were surveyed, sampled, interviewed, or observed by the synthetic run;
- the output is not representative of a population and provides no margin of error or statistical significance;
- official and public sources provide context, not proof of the synthetic result;
- repeated model runs can vary and should not be described as deterministic;
- material decisions require appropriate human validation.

## Current-state audit

The repository currently supports these ten enabled sample/report locales. Interface-language support is a narrower runtime capability and must not include a locale until the UI catalog has exact key and placeholder coverage:

- `en-US`
- `es-ES`
- `pt-BR`
- `fr-FR`
- `de-DE`
- `zh-CN`
- `ja-JP`
- `ko-KR`
- `ar-SA`
- `hi-IN`

The existing `/examples/` page is English-only and contains four example briefs rather than complete studies. It explicitly reports no audience findings. The public sitemap contains no study-library, locale-hub, industry-hub, or study-detail URLs.

The market picker includes Spain and Saudi Arabia for market routing and locale-specific output, but `es-ES` and `ar-SA` interface UI remain planned until their UI catalogs are complete. Static sample/report availability must not be described as complete interface localization.

## Common study-record requirements

Every study record and detail page must include:

- stable study ID and stable slug;
- public version and immutable run ID;
- locale, language, text direction, market, search country, and source languages;
- industry and research intent;
- exact research question, audience, and assumptions;
- evidence-use boundaries and a claim-to-source ledger;
- run date, source retrieval/access date, editorial update date, and status labels;
- prompt version, schema version, model route and fallbacks, evidence hash, and input hash when available;
- synthetic distribution and diagnostics, labeled as model output rather than observations;
- model disagreement or stability information when the runtime provides it;
- visible limitations and “what could change this read” content;
- a concrete human-validation-next plan;
- official source URLs and an honest account of which sources were actually retrieved and used;
- a prefilled “run your own version” action only when the app can reproduce the brief accurately;
- a machine-readable JSON representation that uses the same language and evidence boundaries as the visible page.

## Launch collection

The specifications below are briefs, not results. A study becomes a launch candidate only after its actual synthetic output is generated, frozen, reviewed against the source ledger, and passed through the launch rules later in this document.

### 1. United States: AI-copilot pilot for smaller employer businesses

- **Stable ID:** `SS-EN-US-001`
- **Slug:** `ai-copilot-pilot-small-business-us`
- **Proposed URL:** `/en-us/studies/ai-copilot-pilot-small-business-us/`
- **Locale:** `en-US`
- **Language:** English
- **Market / search country:** United States / `US`
- **Industry:** B2B software and workplace technology
- **Research intent:** Identify the controls that might make a bounded AI-copilot pilot credible to smaller employer businesses.
- **Exact question:** “How likely would you be to approve a 60-day AI-copilot trial for drafting and internal knowledge search if every output required human review, business data was contractually protected, and monthly cost was capped?”
- **Audience:** Owners and operations, IT, or functional decision-makers at United States employer businesses with 20–249 employees.
- **Assumptions:** The pilot covers low-risk internal workflows only; it makes no automated employment decisions; it includes onboarding and an opt-out; it makes no staffing-reduction promise; the contractual data controls work as described.
- **Evidence-use boundary:** United States Census Bureau data may establish firm-size, sector, and AI-use context. NIST publications may define relevant risk-management considerations. Neither source may be used to claim product preference, pilot intent, purchase likelihood, workforce impact, or the accuracy of a synthetic distribution.
- **Human validation next:** Conduct 12–15 interviews across owners, operations leaders, IT decision-makers, and functional managers; run a message-and-control conjoint with a properly recruited business sample; then measure opt-in, weekly use, review burden, error escalation, and discontinuation during an observed 60-day pilot.
- **Official source candidates:**
  - https://www.census.gov/hfp/btos/data_downloads
  - https://www.census.gov/hfp/btos/about
  - https://www.nist.gov/itl/ai-risk-management-framework
  - https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf

### 2. Spain: electric-vehicle charging in communal apartment parking

- **Stable ID:** `SS-ES-ES-001`
- **Slug:** `coche-electrico-recarga-garaje-comunitario-espana`
- **Proposed URL:** `/es-es/studies/coche-electrico-recarga-garaje-comunitario-espana/`
- **Locale:** `es-ES`
- **Language:** Spanish
- **Market / search country:** Spain / `ES`
- **Industry:** Automotive and electric mobility
- **Research intent:** Explore whether an installation-inclusive charging proposition might reduce uncertainty for apartment residents considering an electric vehicle.
- **Exact question:** “¿Qué probabilidad habría de que eligiera un coche eléctrico como próximo vehículo si el precio incluyera la instalación del punto de recarga en su plaza de garaje comunitario, con coste total y plazos por escrito?”
- **Audience:** Drivers in Spanish cities who live in apartment buildings with communal parking and expect to replace a car within 24–36 months.
- **Assumptions:** A private parking space exists; installation is technically feasible; community, electrical, and building approvals remain real constraints; installation scope and schedule are written; the study makes no general claim about total cost savings.
- **Evidence-use boundary:** DGT and MITECO data may describe public charging infrastructure and documented charging questions. They do not establish purchase intent, private-installation feasibility, community approval, price sensitivity, or preference for the proposed bundle.
- **Human validation next:** Interview residents, property administrators, vehicle dealers, and installers; test price, installation, timing, and approval variants in a discrete-choice survey; validate behavior with qualified dealer leads and completed home-charging assessments.
- **Official source candidates:**
  - https://nap.dgt.es/es/dataset/0d1f0fbe-504d-4cc3-a09e-bdf6b248e8b8
  - https://revista.dgt.es/images/PRESENTACION-ENCUESTA-RESUMEN.pdf
  - https://www.idae.es/tecnologias/eficiencia-energetica/transporte/grupo-de-trabajo-de-infraestructuras-de-recarga-del-vehiculo-electrico-gtirve

### 3. Brazil: recurring business subscriptions through Pix Automático

- **Stable ID:** `SS-PT-BR-001`
- **Slug:** `assinatura-pix-automatico-microempresas-brasil`
- **Proposed URL:** `/pt-br/studies/assinatura-pix-automatico-microempresas-brasil/`
- **Locale:** `pt-BR`
- **Language:** Brazilian Portuguese
- **Market / search country:** Brazil / `BR`
- **Industry:** Financial services and SaaS payments
- **Research intent:** Test which authorization and cancellation disclosures might support trust in recurring business subscriptions through Pix Automático.
- **Exact question:** “Qual é a probabilidade de você contratar uma assinatura empresarial via Pix Automático se o valor, a frequência, o aviso antes da cobrança e o cancelamento imediato forem mostrados antes da autorização?”
- **Audience:** MEI and small-business owners who already use Pix for business transactions.
- **Assumptions:** The recipient is a registered business; authorization is explicit; the amount and frequency are disclosed; cancellation is available in-app; the study does not assume universal product availability or zero fraud.
- **Evidence-use boundary:** Banco Central do Brasil statistics and rules may define Pix use, operating rules, authorization, and cancellation context. They do not prove willingness to subscribe, trust, comprehension, conversion, retention, or preference for any interface.
- **Human validation next:** Run Portuguese comprehension interviews; test disclosure, notification, cancellation, and price variants; then observe authorization completion, failed payments, cancellations, disputes, and support contacts in a limited live pilot.
- **Official source candidates:**
  - https://www.bcb.gov.br/estabilidadefinanceira/pix-em-numeros-estatisticas
  - https://dadosabertos.bcb.gov.br/dataset/pix
  - https://www.bcb.gov.br/estabilidadefinanceira/pix-normas
  - https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?numero=513&tipo=Instru%C3%A7%C3%A3o+Normativa+BCB

### 4. France: reusable glass packaging with a supermarket deposit

- **Stable ID:** `SS-FR-FR-001`
- **Slug:** `consigne-bouteille-reemployable-supermarche-france`
- **Proposed URL:** `/fr-fr/studies/consigne-bouteille-reemployable-supermarche-france/`
- **Locale:** `fr-FR`
- **Language:** French
- **Market / search country:** France / `FR`
- **Industry:** Grocery retail and sustainable packaging
- **Research intent:** Explore the convenience and deposit conditions under which shoppers might try reusable glass packaging.
- **Exact question:** “Dans quelle mesure seriez-vous susceptible d’acheter régulièrement une boisson dans une bouteille en verre réemployable avec une consigne de 1 €, si le retour se faisait dans votre supermarché habituel et que le prix du produit restait identique ?”
- **Audience:** Adults aged 25–64 who buy packaged drinks in a supermarket at least weekly.
- **Assumptions:** Product price and quality remain the same; a return point is available in the shopper’s usual supermarket; the deposit is refunded promptly; the page asserts no universal environmental benefit beyond the conditions evaluated by the cited source.
- **Evidence-use boundary:** ADEME may establish definitions, policy targets, measured reuse context, and scenario-specific environmental analysis. The study must not generalize environmental advantages beyond the evaluated system or infer shopper purchase, return, or repeat-use behavior from those sources.
- **Human validation next:** Conduct French shop-along and return-journey interviews; run deposit, return-location, and convenience conjoint testing; then perform a store trial measuring purchase, return, breakage, refund completion, and repeat use.
- **Official source candidates:**
  - https://observatoire-reemploi-reutilisation.ademe.fr/emballages
  - https://observatoire-reemploi-reutilisation.ademe.fr/chiffres-reemploi-emballages
  - https://observatoire-reemploi-reutilisation.ademe.fr/actualites/etude-consigne-emballages

### 5. Germany: transparent heat-pump quote for an existing home

- **Stable ID:** `SS-DE-DE-001`
- **Slug:** `waermepumpe-angebot-bestandsheim-deutschland`
- **Proposed URL:** `/de-de/studies/waermepumpe-angebot-bestandsheim-deutschland/`
- **Locale:** `de-DE`
- **Language:** German
- **Market / search country:** Germany / `DE`
- **Industry:** Home energy and renovation
- **Research intent:** Identify which quote components might make homeowners willing to begin a heat-pump assessment.
- **Exact question:** “Wie wahrscheinlich ist es, dass Sie für Ihr bestehendes Ein- oder Zweifamilienhaus ein verbindliches Wärmepumpenangebot anfordern, wenn Fördercheck, Gesamtpreis, Schallprognose und erwartete Betriebskosten transparent ausgewiesen werden?”
- **Audience:** Owner-occupiers of existing one- or two-family homes primarily heated with gas or oil.
- **Assumptions:** Property suitability is unconfirmed until assessed; an accredited installer performs the assessment; subsidies and operating costs are date-, property-, and household-dependent; all estimates show their inputs.
- **Evidence-use boundary:** Destatis may describe housing and heating context. KfW may define current program terms. Funding terms must be timestamped and rechecked before publication or substantive update. Neither source supports homeowner intent, price acceptance, property suitability, or realized savings.
- **Human validation next:** Interview homeowners and installers; run a quote-component and price-choice experiment; track requested assessments, completed site visits, abandoned journeys, accepted quotes, and post-installation outcomes where feasible.
- **Official source candidates:**
  - https://www.destatis.de/DE/Presse/Pressemitteilungen/2025/06/PD25_N031_31_51.html
  - https://www.destatis.de/DE/Presse/Pressemitteilungen/Zensus2022-Pressemitteilungen/PM_zensus2022_52.html
  - https://www.kfw.de/inlandsfoerderung/Privatpersonen/Bestehende-Immobilie/F%C3%B6rderprodukte/Heizungsf%C3%B6rderung-f%C3%BCr-Privatpersonen-Wohngeb%C3%A4ude-%28458%29/

### 6. China: visible data controls for connected electric-vehicle features

- **Stable ID:** `SS-ZH-CN-001`
- **Slug:** `smart-ev-data-controls-china`
- **Proposed URL:** `/zh-cn/studies/smart-ev-data-controls-china/`
- **Locale:** `zh-CN`
- **Language:** Simplified Chinese
- **Market / search country:** China / `CN`
- **Industry:** Automotive and connected services
- **Research intent:** Explore whether visible data controls might change willingness to enable connected-car features.
- **Exact question:** “如果一款智能新能源汽车默认关闭非必要数据采集，并提供车内本地处理、逐项授权和一键删除记录，您有多大可能启用语音助手和个性化导航？”
- **Audience:** Adults in major Chinese cities planning to consider a new-energy vehicle within three years.
- **Assumptions:** The controls work as described; essential safety processing remains separate; the interface explains what cannot be disabled; the proposition makes no promise of total anonymity; all participants see the same feature demonstration.
- **Evidence-use boundary:** MIIT may establish automotive and new-energy-vehicle market context. CAC and MIIT rules may define regulated data categories and obligations. They cannot establish consumer trust, privacy comprehension, feature demand, permission behavior, or compliance by a hypothetical product.
- **Human validation next:** Run Mandarin cognitive interviews; test control designs with an interactive prototype; conduct a multi-city choice experiment; then measure actual consent comprehension and permission settings in a consented product trial.
- **Official source candidates:**
  - https://www.miit.gov.cn/jgsj/zbys/qcgy/art/2026/art_4c5ed7009d21485da32b2a01abcf2819.html
  - https://www.cac.gov.cn/2021-08/20/c_1631049984897667.htm
  - https://www.miit.gov.cn/gyhxxhb/jgsj/cyzcyfgs/bmgz/xxtxl/art/2022/art_6c31c457291248cc9f95d1dd5f9979c3.html

### 7. Japan: mobile pre-check-in and digital room key

- **Stable ID:** `SS-JA-JP-001`
- **Slug:** `mobile-checkin-business-hotels-japan`
- **Proposed URL:** `/ja-jp/studies/mobile-checkin-business-hotels-japan/`
- **Locale:** `ja-JP`
- **Language:** Japanese
- **Market / search country:** Japan / `JP`
- **Industry:** Travel and hospitality
- **Research intent:** Test conditions under which domestic business travelers might accept mobile pre-check-in and a digital room key.
- **Exact question:** “スタッフによる対応も選べ、料金・キャンセル条件・データ利用が事前に明示される場合、次回の国内出張でモバイル事前チェックインとデジタルキーを利用する可能性はどの程度ありますか。”
- **Audience:** Adults who made at least two domestic business-hotel stays during the previous year.
- **Assumptions:** Staff assistance remains available; identity checks meet applicable requirements; a physical-key fallback exists; fees, cancellation, and data use are disclosed; the study does not assume digital check-in always reduces waiting.
- **Evidence-use boundary:** Japan Tourism Agency statistics may describe lodging and travel context and official tourism-DX priorities. They do not prove traveler preference, operational savings, queue reduction, accessibility, or successful digital-key use.
- **Human validation next:** Observe hotel arrival workflows; conduct Japanese interviews across age and device-comfort groups; A/B test opt-in; measure completion, desk fallback, check-in time, lockout, accessibility issues, and satisfaction.
- **Official source candidates:**
  - https://www.mlit.go.jp/kankocho/tokei_hakusyo/shukuhakutokei.html
  - https://www.mlit.go.jp/kankocho/seisaku_seido/kihonkeikaku/jizoku_kankochi/kanko-dx.html
  - https://www.mlit.go.jp/kankocho/tokei_hakusyo/shohidoko.html

### 8. South Korea: lower-priced, ad-supported OTT plan

- **Stable ID:** `SS-KO-KR-001`
- **Slug:** `ad-supported-ott-plan-south-korea`
- **Proposed URL:** `/ko-kr/studies/ad-supported-ott-plan-south-korea/`
- **Locale:** `ko-KR`
- **Language:** Korean
- **Market / search country:** South Korea / `KR`
- **Industry:** Streaming media
- **Research intent:** Explore the price, advertising, and cancellation trade-offs around switching to an ad-supported OTT tier.
- **Exact question:** “광고가 시간당 최대 4분이고 아동 콘텐츠에는 광고가 없으며 언제든 해지할 수 있다면, 현재 가장 많이 쓰는 유료 OTT 요금제를 30% 저렴한 광고형 요금제로 바꿀 가능성은 얼마나 됩니까?”
- **Audience:** Adults aged 20–49 who used a paid OTT service during the last three months.
- **Assumptions:** Catalogue and video quality are unchanged; the 30% discount is real; the stated ad load is enforced; children’s content has no ads; cancellation remains monthly.
- **Evidence-use boundary:** KISDI and KCC materials may establish reported media-use and subscription context. Their estimates must not be reused or relabeled as the synthetic result, and they do not establish switching, churn, ad tolerance, or preference for the proposed plan.
- **Human validation next:** Conduct Korean price-and-ad-load conjoint testing with current paid users; run a consented plan-offer experiment; observe switching, viewing time, ad abandonment, churn, cancellation, and complaint rates.
- **Official source candidates:**
  - https://kisdi.re.kr/report/view.do?arrMasterId=3934581&artId=1862836&key=m2101113024973&masterId=3934581
  - https://kisdi.re.kr/bbs/view.do?bbsSn=114726&key=m2101113055776
  - https://stat.kisdi.re.kr/main.html
  - https://m.kcc.go.kr/user.do?boardId=1058&boardSeq=65045&cp=2&dc=E04010000&mode=view&page=E04010000

### 9. Saudi Arabia: Arabic AI study assistant for higher education

- **Stable ID:** `SS-AR-SA-001`
- **Slug:** `arabic-ai-study-assistant-saudi-universities`
- **Proposed URL:** `/ar-sa/studies/arabic-ai-study-assistant-saudi-universities/`
- **Locale:** `ar-SA`
- **Language:** Arabic
- **Text direction:** Right to left
- **Market / search country:** Saudi Arabia / `SA`
- **Industry:** Higher education and education technology
- **Research intent:** Identify governance and product conditions that might support voluntary use of an Arabic AI study assistant.
- **Exact question:** “ما مدى احتمال استخدامك مساعد دراسة جامعي باللغة العربية تدعمه المؤسسة، إذا أظهر مصادره، ولم يُستخدم في التقييم، وخضع لإشراف المدرّس، وأتاح لك حذف بياناتك؟”
- **Audience:** Adult university students enrolled in Arabic-primary courses in Saudi Arabia.
- **Assumptions:** The institution approves the tool; citations are inspectable; the tool is not used for grading or misconduct detection; teacher escalation and data deletion are available; participation is voluntary.
- **Evidence-use boundary:** National eLearning Center sources may define governance and quality expectations. GASTAT may establish education and connectivity context. These sources do not establish student acceptance, learning outcomes, factual accuracy, academic integrity, or privacy comprehension.
- **Human validation next:** Conduct Arabic cognitive interviews; obtain faculty, student, accessibility, and governance review; run a controlled semester pilot measuring voluntary adoption, factual errors, source checking, help-seeking, learning outcomes, and privacy comprehension.
- **Official source candidates:**
  - https://nelc.gov.sa/media-center/news/national-elearning-center-announces-ai-framework-digital-learning
  - https://nelc.gov.sa/en/regulations-and-standards/elearning-standards
  - https://www.stats.gov.sa/documents/20117/2435267/ICT%2BAccess%2Band%2BUsage%2B2025-EN.pdf/d91fc7dd-2f2e-ee1a-248c-c8f38102ef01?t=1767603674645
  - https://www.stats.gov.sa/documents/20117/2435273/Education%2Band%2BTraining%2BStatistics%2B2025%2BEN%2B%281%29.pdf/08f376b7-5906-0a24-1fe9-f609ebfcc5ae?t=1767866579084

### 10. India: Hindi agrometeorological advisory for small farmers

- **Stable ID:** `SS-HI-IN-001`
- **Slug:** `hindi-agromet-advisory-small-farmers-india`
- **Proposed URL:** `/hi-in/studies/hindi-agromet-advisory-small-farmers-india/`
- **Locale:** `hi-IN`
- **Language:** Hindi
- **Market / search country:** India / `IN`
- **Industry:** Agriculture and advisory technology
- **Research intent:** Explore whether localization, voice delivery, and crop-level relevance might support repeat use of verified agrometeorological advisories.
- **Exact question:** “यदि आपके ब्लॉक और फसल के अनुसार सत्यापित मौसम‑कृषि सलाह हिन्दी में, कम डेटा वाले ऐप और आवाज़ दोनों से, सप्ताह में दो बार मुफ़्त मिले, तो आपके उसे नियमित रूप से देखने की कितनी संभावना है?”
- **Audience:** Small and marginal operational holders in Hindi-speaking districts who have personal or shared access to a mobile phone.
- **Assumptions:** The service is free; advice is timestamped and linked to IMD or extension sources; voice access works on low bandwidth; shared-device use is supported; the service does not replace local extension advice.
- **Evidence-use boundary:** Agriculture Census materials may define the operational-holding population frame. IMD may define existing weather and advisory services. Neither source proves phone access, comprehension, repeat use, action, yield, income, or farm outcomes.
- **Human validation next:** Conduct assisted Hindi interviews in at least three states; test text, voice, low-data, and shared-device journeys; pilot through a full crop stage; observe message receipt, comprehension, action, non-use, and extension-worker escalation.
- **Official source candidates:**
  - https://mausam.imd.gov.in/responsive/agromet_adv_ser_state_current.php
  - https://mausamsankalp.imd.gov.in/
  - https://internal.imd.gov.in/press_release/20220824_pr_1790.pdf
  - https://www.agcensus.gov.in/AgriCensus/media/Operational%20Guideline%202021-22.pdf

## Information architecture

Use this hierarchy:

```text
/studies/                                      Global collection and methodology summary
/studies/industries/                           Editorial industry index
/studies/industries/{industry}/                Publish only after the industry-hub gate passes
/{locale}/studies/                             Locale-specific market and library hub
/{locale}/studies/{stable-slug}/               Frozen study detail
/{locale}/studies/{stable-slug}/study.json     Machine-readable study record
```

Use lowercase full locale tags in URLs. Keep the stable study ID in the record rather than the URL so a carefully managed title change does not break identity.

At launch, publish `/studies/`, ten locale hubs, and ten detail pages. Create the industry taxonomy in the content model, but do not index an individual industry hub until it contains at least three editorially approved studies plus an industry-specific introduction, official-source guide, and human-validation guidance. Until that threshold is met, industry labels may filter the global collection without producing crawlable facet combinations.

Suggested industry slugs include:

- `workplace-technology`
- `electric-mobility`
- `payments`
- `sustainable-packaging`
- `home-energy`
- `connected-vehicles`
- `travel-hospitality`
- `streaming-media`
- `education-technology`
- `agriculture-technology`

Do not generate combinations such as locale × industry × market × intent unless a page has a distinct user purpose and passes the same editorial gates as a detail page.

## Canonical, hreflang, sitemap, and internal-link rules

### Canonical URLs

- Every indexable page must return HTTP 200 and declare a self-referencing canonical.
- A localized page must canonicalize to itself, not to English.
- Do not use `robots.txt`, the removal tool, or `noindex` as a substitute for canonicalization.
- Sitemaps, internal links, Open Graph URLs, and structured data must use the same canonical URL.
- Tracking parameters and UI filters must not become competing indexable versions.

### Hreflang

- Use `hreflang` only between genuinely equivalent localized versions of the same page.
- The ten launch detail pages are different studies. They must not be declared as language alternates of one another.
- If a study is later translated, each translated page receives its own self-canonical and every member of the alternate cluster lists itself and all other members.
- Use exact supported locale tags such as `en-US`, `es-ES`, and `ar-SA`.
- Use `x-default` for a neutral chooser or global hub, normally `/studies/`.
- Locale hubs may form a reciprocal alternate cluster only if they deliver an equivalent library experience rather than unrelated thin pages.
- Do not automatically redirect users by IP or assumed browser language. Provide a visible, crawlable language selector.
- Keep each page’s primary content and navigation in one language; translated chrome around an untranslated report does not qualify as a localized page.

### Sitemaps

- Keep the root `/sitemap.xml` as a sitemap index once separate study sitemaps are introduced.
- Add `/sitemap-studies.xml`; split by locale only when volume or Search Console analysis makes that useful.
- Include only canonical, indexable, HTTP 200 URLs.
- Use fully qualified absolute URLs.
- Set `lastmod` only when the study result, source ledger, limitations, validation plan, or other substantive editorial content changed.
- Choose one maintainable hreflang implementation. HTML annotations are simplest for the pilot; duplicating the same declarations in HTML and XML adds no ranking benefit and creates consistency risk.

### Internal links

- Global study hub links to every published locale hub and study.
- Locale hub links to each published study in that locale.
- Study detail links back to its locale hub and to methodology, research standards, limitations, the relevant industry context, and the matched human-validation guidance.
- Each detail page should link to two to four genuinely related studies when they exist; related links should be based on industry, decision type, or research method rather than keyword overlap alone.
- Use crawlable `<a href>` links and descriptive anchor text. Do not rely on JavaScript-only card clicks.
- Render visible breadcrumbs and matching `BreadcrumbList` structured data.

### Structured data

- Use `CollectionPage` for global, locale, and qualifying industry hubs.
- Use `Article` and `BreadcrumbList` for study-detail pages.
- Add `Dataset` only when the page exposes a real public data object and the markup precisely identifies it as model-generated synthetic data.
- Never add `AggregateRating`, review, respondent, or survey-result markup to represent synthetic output.
- Structured data must match visible content and must not imply human observations or review that the page does not have.

## Hard publication gates

A page is not publishable if any gate fails.

1. **Boundary above the first result:** The page states that the output is model-generated synthetic output, no people were surveyed, it is not representative, and repeated runs can vary.
2. **Complete provenance:** The page records stable study and run IDs, version, generation date, locale, market, exact brief, assumptions, sources, source dates, model route, prompt/schema versions, and hashes where available.
3. **Frozen output:** A public page never silently regenerates on view. A rerun creates a new version or a visible replacement with a change log.
4. **No fake sample:** Simulation units and model cells are never called respondents, participants, people, sample size, or `n`. The page reports no margin of error, statistical significance, representativeness, or population incidence.
5. **Evidence classes stay distinct:** Official-source fact, supplied or retrieved context, explicit assumption, model inference, editorial synthesis, and human-validation status remain visibly separate.
6. **Claim ledger passes:** Every externally checkable factual claim has a nearby fit-for-purpose source. Every synthetic interpretation is labeled as inference. Unsupported claims are removed rather than softened.
7. **Source fitness passes:** Jurisdiction, population, date, definitions, field period, and methodology fit the statement. Mutable policies, incentives, prices, rules, and statistics are rechecked on publication day.
8. **No source-result laundering:** An official survey estimate is never copied, normalized, or paraphrased as a Likerts synthetic finding. Retrieved text is context, not independent verification.
9. **Verbatim safety passes:** Synthetic verbatims are labeled illustrative model-generated language and are never styled as participant quotes, customer testimony, interviews, or observed speech.
10. **Original usefulness passes:** The page contains a decision-specific brief, local context, visible source ledger, assumptions, disagreement or stability information when available, limitations, “what could change this read,” and a concrete validation design.
11. **Localization passes automated QA:** Locale, script, direction, dates, numerals, punctuation, links, and expected language all pass automated checks.
12. **Localization status is honest:** Automated language or script QA is not described as native-language review. The page says `Human editorial review pending` until actual review occurs.
13. **Automation disclosure is present:** The page explains that models and automation produced the synthetic study and identifies the accountable publisher. Do not invent a person, expertise, or byline.
14. **No scaled page multiplication:** A translation, industry page, or search-intent variation is not published merely to target another query. Substantially similar intents are consolidated.
15. **Technical integrity passes:** The page returns 200, self-canonicalizes, has valid reciprocal alternates where applicable, has a unique title/H1/description, contains crawlable links, appears in the correct sitemap, and exposes structured data consistent with visible content.
16. **Arithmetic and contract pass:** The five-point distribution contains valid values, sums to 100 under the documented normalization rule, and matches the visible chart and downloadable JSON.
17. **Risk boundary passes:** Launch content does not use synthetic output as the basis for medical, legal, credit, employment-selection, political-persuasion, safety-critical, or other consequential claims.
18. **Human next step is concrete:** The page names the human population, recruitment need, method, decision criterion, and observed behavior required to turn the hypothesis into evidence.
19. **Accessibility passes:** The page works at keyboard and screen-reader level; charts have equivalent text; color is not the only carrier of meaning; Arabic directionality and mixed LTR URLs render correctly.
20. **Status labels are truthful:** The page never claims native-human, expert, independent, legal, methodological, or editorial review unless that review actually occurred and is recorded.

## Launch status workflow

Use the following sequence for every study:

```text
Brief approved for generation
  -> Synthetic run completed and frozen
  -> Source and claim ledger assembled
  -> Automated QA passed
  -> Human editorial review pending
  -> Human editorial review completed, if actually performed
  -> Native-language review completed, if actually performed
  -> Publishable
```

Rules:

- A study may be staged internally after `Automated QA passed`.
- A public page may not imply that automation constitutes editorial approval.
- The preferred public-launch standard is actual human editorial review and actual native-language review for every non-English study.
- If the team deliberately publishes before human review, the status `Human editorial review pending` must be visible near the study metadata and the page must make no claim of human, native, expert, or independent review.
- “Pipeline critic,” “model review,” “multi-model review,” and “automated QA” describe internal model or software stages only. They are not independent review.
- When a human review is completed, record the reviewer or accountable team, date, scope, and material corrections. Do not backdate the status.
- A reviewer who created or directly edited the study may be an editorial reviewer but is not independent. Use “independent” only when organizational and process independence are real.
- A language model, translation API, spell checker, language detector, or script check cannot satisfy the native-language-review status.

## Go/no-go launch checklist

Launch only when every applicable item is true:

- [ ] Ten actual synthetic studies have been generated, frozen, and versioned; no placeholder or seed output is presented as a completed study.
- [ ] Spain and Saudi Arabia can be represented faithfully in the app, or the affected run CTAs disclose the current limitation.
- [ ] Every page states that no humans were surveyed, no population estimate exists, and reruns can vary.
- [ ] Every factual claim resolves to a jurisdiction- and population-fit official source with a retrieval or access date.
- [ ] Mutable official facts and program terms were rechecked on publication day.
- [ ] Every visible and machine-readable distribution passes arithmetic and contract checks.
- [ ] Locale, script, directionality, links, metadata, canonical, and hreflang checks pass automated QA.
- [ ] Every page truthfully displays `Automated QA passed` only after the checks pass.
- [ ] Every page displays `Human editorial review pending` until a real human review is documented.
- [ ] No page claims native-language review unless a proficient human reviewed the full page and is recorded.
- [ ] No page claims independent review merely because another model or pipeline stage critiqued it.
- [ ] Sitemap, crawlable navigation, visible breadcrumbs, study JSON, and structured-data validation pass.
- [ ] No thin industry hub, search facet, or automated locale variation is indexable.
- [ ] Every study supplies a specific human-validation plan and an accurate prefilled run action where supported.
- [ ] Final review finds no surveyed-people wording, fake quotes, unsupported rankings, generalized environmental claims, deterministic wording, or unsupported causal claims.

**Launch decision:** Go for a ten-study editorial pilot only after the hard gates pass. No-go for mass translation, programmatic industry expansion, or claims of human/native/independent review without the documented work.

## Primary SEO guidance

- Multilingual and multi-regional sites: https://developers.google.com/search/docs/advanced/crawling/managing-multi-regional-sites
- Localized versions and reciprocal hreflang: https://developers.google.com/search/docs/advanced/crawling/localized-versions
- Canonicalization: https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- Sitemaps: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- Crawlable internal links: https://developers.google.com/search/docs/crawling-indexing/links-crawlable
- Helpful, reliable, people-first content: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Generative-AI content guidance: https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
- AI-search optimization guidance: https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- Spam and scaled-content policies: https://developers.google.com/search/docs/essentials/spam-policies
- Structured-data policies: https://developers.google.com/search/docs/appearance/structured-data/sd-policies
- Breadcrumb structured data: https://developers.google.com/search/docs/appearance/structured-data/breadcrumb
