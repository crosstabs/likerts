# Likerts Sample Study Library: design and markup contract

This contract translates `hub.png` and `detail.png` into a stable, semantic
markup surface. Pages should load `/static-site.css` first and
`/study-library.css` second. All library selectors are scoped below
`.study-library-page` so they cannot change the existing marketing pages.

## Principles and tokens

- The page is content-first and editorial: frozen synthetic examples are
  presented as inspectable research artifacts, never as survey evidence.
- Use one `h1` per page. Keep section headings in order (`h2`, then `h3`).
- Use real links for navigation and page-to-page actions, real buttons for
  filter/reset controls, and native `select`/`input` controls with visible
  labels. Every icon-only control needs an accessible name.
- Never communicate a result using colour alone. Every chart segment has a
  visible text label and an accessible name/value.
- Base palette: `--sl-navy: #021a38`, `--sl-ink: #08152a`,
  `--sl-muted: #526078`, `--sl-blue: #0967f7`, `--sl-blue-dark: #064fc4`,
  `--sl-blue-soft: #eff6ff`, `--sl-border: #d9dee7`,
  `--sl-surface: #f7f9fc`, `--sl-red: #f26954`.
- Spacing uses a 4px rhythm. Common values are 8, 12, 16, 20, 24, 32,
  40, and 56px. Borders are 1px; radii are 4px for controls, 6px for
  buttons, and 8px for cards/panels. Shadows are deliberately minimal.
- The page content is capped at 1160px. The detail content/rail split is
  approximately 2fr/1fr with a 28px gap. The hub's featured card and table
  use the full available width.

## Global page and header

```html
<body class="study-library-page" data-page="hub|detail">
  <a class="skip-link" href="#study-library-content">Skip to content</a>
  <header class="site-header study-library-header">…existing Likerts header…</header>
  <main id="study-library-content" class="study-library-shell">…</main>
</body>
```

The existing `.site-header`, `.header-inner`, `.brand`, `.site-nav`, and
`.header-cta` classes remain valid. For the concepts' header, navigation links
are `Studies`, `Methodology`, `Research standards`, and `Limitations`; the
language control is labelled `Interface language`, and the primary action is
`New study`.

## Hub (`data-page="hub"`)

```html
<main id="study-library-content" class="study-library-shell study-library-hub">
  <section class="library-hero" aria-labelledby="library-title">
    <p class="library-eyebrow">Sample studies</p>
    <h1 id="library-title">Sample synthetic research studies</h1>
    <p class="library-lede">…frozen examples, sources, disagreement, cost, and validation…</p>
    <div class="library-boundary" role="note">
      <span class="library-boundary-icon" aria-hidden="true">ⓘ</span>
      <p><strong>Synthetic examples</strong> — not surveyed people or representative estimates.</p>
    </div>
    <div class="library-actions" aria-label="Study actions">
      <a class="sl-button sl-button-primary" href="/">Run your own study</a>
      <a class="sl-text-action" href="#review-method">How samples are reviewed <span aria-hidden="true">→</span></a>
    </div>
  </section>

  <form class="study-filters" aria-label="Filter sample studies">
    <div class="study-filter-field"><label for="filter-industry">Industry</label><select id="filter-industry" name="industry">…</select></div>
    <div class="study-filter-field"><label for="filter-market">Market</label><select id="filter-market" name="market">…</select></div>
    <div class="study-filter-field"><label for="filter-language">Language</label><select id="filter-language" name="language">…</select></div>
    <div class="study-filter-field"><label for="filter-intent">Research intent</label><select id="filter-intent" name="intent">…</select></div>
    <div class="study-filter-field study-filter-search"><label for="filter-search">Search</label><input id="filter-search" name="q" type="search" placeholder="Search studies" /></div>
  </form>

  <article class="featured-study" aria-labelledby="featured-title">
    <div class="featured-study-body">…</div>
    <div class="featured-study-distribution">…distribution…</div>
    <footer class="featured-study-footer">…sources/cells/cost…</footer>
  </article>

  <section class="study-table-wrap" aria-labelledby="study-list-title">
    <h2 id="study-list-title" class="visually-hidden">All sample studies</h2>
    <div class="study-table" role="table" aria-label="Sample studies">
      <div class="study-table-header" role="row">…</div>
      <a class="study-table-row" role="row" href="/studies/four-day-workweek-adoption/" data-study-link>…</a>
    </div>
    <nav class="study-pagination" aria-label="Study pages">…</nav>
  </section>

  <section class="study-hub-grid" aria-label="Browse studies">
    <div class="industry-hub"><h2>Browse by industry</h2><a class="hub-link-row" href="…"><span>Technology</span><strong>18</strong></a>…</div>
    <div class="language-hub"><h2>Studies by language</h2><a href="…">English</a>…</div>
  </section>
  <section id="review-method" class="study-method-strip" aria-labelledby="method-title">…four method steps…</section>
</main>
```

The table may be a native `<table>` when practical; if a CSS grid is used,
each header/data item must retain `role="row"`/`role="cell"` semantics and the
row link must have an accessible study title. Keep the first five rows visible
at desktop as in the concept. The featured study is a summary of the same
schema as a detail page and must include a disclosure, directional chart,
source count, model-cell count, cost, and `Read study` link.

## Detail (`data-page="detail"`)

```html
<main id="study-library-content" class="study-library-shell study-library-detail">
  <nav class="study-breadcrumbs" aria-label="Breadcrumb">…</nav>
  <header class="study-detail-heading">…h1, question, metadata…</header>
  <div class="study-detail-disclosure library-boundary" role="note">…synthetic boundary…</div>
  <div class="study-detail-actions" aria-label="Study actions">…run and JSON links…</div>
  <div class="study-detail-layout">
    <article class="study-detail-main">
      <section class="directional-read" aria-labelledby="directional-read-title">
        <h2 id="directional-read-title">Directional synthetic read</h2>
        <figure class="distribution-figure">
          <div class="distribution-chart" role="img" aria-label="Directional distribution: …">
            <span class="distribution-segment distribution-strongly-unlikely" style="--segment:9%"></span>…
          </div>
          <figcaption class="distribution-labels"><span><b>Strongly unlikely</b><strong>9%</strong></span>…</span></figcaption>
        </figure>
        <p class="distribution-summary">Across 200 synthetic…</p>
      </section>
      <section class="model-disagreement" aria-labelledby="model-title">…model cells and spread…</section>
      <section class="segment-hypotheses" aria-labelledby="segment-title">…segment rows…</section>
      <section class="synthetic-perspectives" aria-labelledby="perspectives-title">…quoted synthetic perspectives…</section>
      <section class="validation-plan" aria-labelledby="validation-title">…ordered next validation steps…</section>
    </article>
    <aside class="study-detail-rail" aria-label="Evidence and run details">
      <section class="evidence-glance">…</section>
      <section class="source-ledger">…disclosed source cards…</section>
      <section class="run-receipt">…frozen run metadata…</section>
      <section class="known-limitations">…</section>
    </aside>
  </div>
  <section class="evidence-ledger">…native table…</section>
  <section class="model-lineage">…four numbered steps…</section>
  <section class="related-studies">…native table or linked rows…</section>
</main>
```

All model variation copy must say it is model variation, not human
uncertainty. All perspectives are explicitly synthetic and visually distinct
from evidence. Source cards need title, source type, public URL, and a
`Report`/source link. The run receipt exposes a run ID, runtime version,
evidence hash, model lineage, gateway cost, and generated timestamp. Missing
values should be rendered as `Not measured`/`Not supplied`, never silently
omitted.

## Distribution and data vocabulary

Use the five fixed classes below in this order for the standard Likert scale:
`.distribution-strongly-unlikely`, `.distribution-unlikely`,
`.distribution-neutral`, `.distribution-likely`,
`.distribution-strongly-likely`. A segment's visual width is controlled by the
`--segment` custom property, while its accessible label/value lives in visible
`figcaption` text. Segment rows use `.segment-row`, `.segment-label`,
`.segment-bar`, and `.segment-result`. Add `.distribution-compact` for table
rows and cards. Avoid gradients and avoid absolute positioning for labels.

## Responsive behaviour

- At 1160px and below, the shell keeps 24px side gutters; at 760px and below,
  it uses 16px gutters and 20px section gaps.
- At 900px and below, the detail rail moves below the main column. On hub
  pages, the featured card body stacks its chart below the summary and the
  industry/language hubs become one column.
- At 760px and below, filters become one column, table rows become labelled
  cards (`data-label` supplies each mobile label), and row metadata wraps.
  Pagination remains keyboard reachable and horizontally contained.
- At 480px and below, actions stack or wrap, chart labels may use a two-row
  grid, and no fixed-width child may exceed the viewport. Do not hide the
  synthetic boundary disclosure or primary run action.

## Accessibility, print, and RTL

- Visible `:focus-visible` rings use a 3px blue outline with 3px offset.
- Use `aria-live="polite"` on a result-count/status node when filters update.
- Respect `prefers-reduced-motion: reduce`; transitions are disabled.
- Use logical properties (`margin-inline`, `padding-inline`, `inset-inline`)
  in new markup/CSS. The stylesheet supports `[dir="rtl"]` by mirroring the
  rail divider, breadcrumbs, action arrows, and segment direction while
  preserving the semantic label order. Verify with `document.dir = "rtl"`.
- In print, hide site navigation, filters, action buttons, pagination, and
  decorative affordances; preserve headings, disclosures, chart labels,
  tables, source URLs, receipt metadata, and all `::after`/link URLs that are
  useful as evidence. Use `color-adjust: exact` for chart fills where
  supported.

## Generator invariants

1. Every hub row and related row has a stable `data-study-id` and a link.
2. Every detail page has a stable `data-study-id`, `data-run-id`,
   `data-language`, and `data-industry` on `.study-library-page`.
3. Data values are text, not only CSS custom properties or SVG pixels.
4. Each static page has a canonical URL, language alternates, a concise
   description, and JSON-LD appropriate to `CollectionPage` or `Article`.
5. Frozen examples include a generated date and disclosure that they are not
   surveyed people, representative estimates, or external validation.
