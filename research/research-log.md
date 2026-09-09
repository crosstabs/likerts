# Research scope and progress

Date: 2026-09-06. Audience: Likerts founder. Decision: reusable foundation for fixed-question surveys with bulk distribution, structured metadata, short links, exports and $1 per 100,000 submission target. Assume optional proprietary SaaS, no AI analysis or uploads in initial collection scope.

The required update_plan tool was searched for and is unavailable in this session. Local progress record used instead.

- Discovery: complete. Three substantial research lanes covered complete apps, reusable components, and field/adjacent platforms. Coordinator checked alternative candidates, official licensing guidance and repository freshness.
- Follow-up: complete. Resolved MIT Form.io browser versus OSL server, SurveyJS renderer versus Creator, OpnForm enterprise boundaries, archive versus project migration. Independently fetched highest-impact license and API sources.
- Synthesis: complete. Fifteen families compared; shortlist stable. No load testing or security audit claimed.
- Deliverable verification: complete. Seven final pages rendered and visually inspected. Removed inherited title border, verified all 15 product families, 52 external hyperlink relationships, table borders and absence of internal citation tokens. No clipping or overlap observed.

## Evidence gaps

| Claim | Evidence | Confidence | Gap or contradiction | Disposition |
| --- | --- | --- | --- | --- |
| LimeSurvey automation | Actual API reference retrieved directly; methods verified | High | Shared public link behavior and anonymity require prototype | Shortlist |
| Form.io browser reuse | Current main LICENSE.txt MIT and custom endpoint example | High | Scope/footprint of restricted editor untested | Shortlist |
| SurveyJS reuse | MIT library and separate commercial FAQ | High | Creator noncompetition scope requires written clarification | Use MIT route |
| Unit economics | Official Cloudflare request/write/storage rates | Low for product cost | No installations or measured bills | Benchmark, no promise |
| Quill Forms license | Root LGPL; package manifests GPL | Unresolved | Conflicting first-party signals | Hold |
| ODK renderer status | Archived repository explicitly moved | Medium | Version-specific defaults/docs in transition | Pin release before use |
| Bulk metadata UI | APIs/hidden fields documented across some candidates | Medium | Native complete workflow not established | Likerts-owned layer |

## Search coverage and stop reason

Discovery searched open-source complete form builders and permissive renderer/editor libraries, then investigated current licenses, deployment requirements, API methods, token/hidden metadata semantics and archive/release history. First-party sources only support report facts. GitHub API snapshot saved separately. GNU website retrieval repeatedly timed out; indexed official FAQ evidence used only for its general distinction, with license texts as primary product evidence.

Stopped broad retrieval after 15 families because additional low-signal repositories would not change the two-route prototype recommendation. Outstanding questions require implementation measurement, selected-package audit or vendor clarification. New small projects are not treated as proven production bases based only on landing pages.
