# Population source pilot: Spain INE EPA 2026 Q2

Status: `PENDING_DATA_STEWARD_REVIEW`
Registry effect: none until the candidate passes the registry review gate
Retrieved: 2026-08-29
Source-artifact SHA-256: `3ea85556ae2275f8134e768569a7dd473be50544f46118c74e60f728a8978702`

## Candidate decision

Use Spain's Instituto Nacional de Estadística (INE) Labour Force Survey table 65285 as the first registry adapter candidate. It provides absolute population estimates by age group, sex, and autonomous community for people residing in family dwellings. It is suitable for a general population-in-family-dwellings frame; it is only broader context for conditional audiences such as vehicle intenders, apartment residents, customers, workers, or category buyers.

The candidate must not become `CURATED_OFFICIAL` until the transformation output, denominator, attribution, and universe classification have been reviewed. The checked-in registry therefore remains in its honest zero state during adapter development.

## Pinned source

- Publisher: Instituto Nacional de Estadística (INE), Spain.
- Operation: Encuesta de Población Activa (EPA), population base 2021.
- Table: [65285 — Population by age group, sex and autonomous community, absolute values](https://www.ine.es/jaxiT3/Tabla.htm?L=0&t=65285).
- Pinned API request: `https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/65285?date=20260401:20260401&tip=AM`.
- API contract: [INE JSON API reference](https://www.ine.es/dyngs/DAB/en/index.htm?cid=1100).
- Period: 2026 Q2; API reference date `2026-04-01`; result type `Definitivo`.
- Unit: thousands of persons.
- Source rows: 540.
- Published table update observed: 2026-07-28.

## Population universe

The exact candidate universe is people residing in main family dwellings across the national territory. The [INE EPA methodology](https://www.ine.es/inebaseDYN/epa30308/docs/resumetepa21.pdf) excludes collective households such as hospitals, residences, and barracks, as well as secondary or seasonal dwellings, subject to the detailed inclusions stated by INE.

Registry universe ID: `es-residents-main-family-dwellings-all-ages`.

This is not an exact denominator match for:

- all residents regardless of dwelling type;
- adults only, unless the under-16 category is explicitly excluded and the denominator is recomputed;
- urban residents or apartment residents;
- purchase, category, employment, customer, or intent-defined populations;
- households, dwellings, or firms.

Those cases must resolve to `BROADER_CONTEXT_ONLY` unless a transformation and exact conditional denominator are separately reviewed.

## Planned transformations

1. Validate the response as 540 bounded series with one 2026 Q2 definitive data point each.
2. Preserve source series code, variable names, official codes, unit, scale, period, and value.
3. Build the all-ages denominator from series `EPA384355` (`49,345.1` thousand persons).
4. Derive an age marginal from the mutually exclusive source bands: under 16, 16–19, 20–24, 25–34, 35–44, 45–54, 55–64, and 65+.
5. Derive a sex marginal from men and women totals.
6. Derive an autonomous-community marginal from both-sex, all-age totals.
7. Derive a national age × sex intersection. Do not create the full age × sex × region cross-product because it exceeds the runtime's 250-cell safety limit.
8. Divide absolute values by the declared denominator and apply deterministic last-cell rounding only after validating raw totals.
9. Record every source series code used, excluded total, recode, rounding step, and derived-artifact hash.

## Licence and attribution

INE's [Open Data page](https://www.ine.es/datosabiertos/) and [legal/reuse notice](https://www.ine.es/dyngs/AYU/es/index.htm?cid=125) state that INE-origin statistical information is generally available under CC BY 4.0, including derived and commercial reuse with attribution, subject to the stated conditions.

Required transformed-data attribution:

> Elaboración propia con datos extraídos del sitio web del INE: www.ine.es. Table 65285, 2026 Q2; retrieved 2026-08-29.

Likerts must not imply that INE participates in, sponsors, validates, or endorses the transformation or the product.

## Review checklist

- [ ] Confirm table 65285 is INE-origin information covered by the cited general reuse terms.
- [ ] Reproduce the pinned source hash.
- [ ] Confirm the exact population universe and exclusions against the methodology.
- [ ] Confirm the denominator and every included series code.
- [ ] Reconcile marginal and intersection totals before rounding.
- [ ] Inspect the derived registry record and transformation receipt.
- [ ] Confirm source/coverage/publication/retrieval dates and recency status.
- [ ] Approve attribution wording.
- [ ] Approve `EXACT_POPULATION_UNIVERSE` only for the declared universe ID.
- [ ] Keep all narrower audiences `BROADER_CONTEXT_ONLY` or `NO_MATCH`.
