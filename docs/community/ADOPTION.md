# Adoption evidence ledger

This ledger tracks whether people can use Likerts and where they get stuck. It does not measure survey respondents or collect their data. Ten external installations and three outside contributors are initial learning targets, **not achieved results or launch completion requirements**.

## Baseline — 2026-09-13, approximately 00:05 UTC

| Measure | Observed value | Source and limitation |
| --- | --- | --- |
| GitHub stars | 0 | [Public repository API](https://api.github.com/repos/crosstabs/likerts), `stargazers_count`. Interest signal only. |
| GitHub forks | 0 | Same API, `forks_count`. A fork is not an installation. |
| GitHub subscribers | 0 | Same API, `subscribers_count`. Not active users. |
| Open issue/PR count | 8 | Same API, `open_issues_count`; this API field can include PRs. Existing contributor tasks are not reported adoption. |
| npm weekly downloads: Web, React Native, MCP | Unavailable | All three public download-stat API requests returned HTTP 404. New publication is verified separately; absent statistics do not mean zero downloads. |
| Confirmed external successful installations | Unknown | No external confirmation collected for this ledger. Internal release verification is excluded. |
| External first persisted responses and setup time | Unknown | Requires voluntary reports or an observed external onboarding session. |
| Outside contributors / repeat contributors | Unknown | Not inferred from commits, stars or prepared issues. Establish classification before counting. |
| Median first maintainer reply time | Unknown | No classified external-support sample. |
| Search impressions / website conversion | Unknown | No Search Console or visitor analytics report inspected. |

Release asset counts from the [public release API](https://api.github.com/repos/crosstabs/likerts/releases/tags/community-v0.1.0), at the same baseline:

| Asset | Downloads |
| --- | --- |
| CLI macOS arm64 / Linux x64 / Windows x64 | 2 each |
| Web / MCP / runtime archives | 3 each |
| React Native archive | 2 |
| Release manifest | 2 |
| Checksums | 3 |

These counts include internal verification and repeated/bot downloads. They cannot establish unique installations or users. The release was published at `2026-09-12T13:50:23Z`.

## Public-signal refresh — 2026-09-20, approximately 02:00 UTC

| Measure | Observed value | Source and limitation |
| --- | --- | --- |
| GitHub stars / forks / subscribers | 0 / 0 / 0 | [Public repository API](https://api.github.com/repos/crosstabs/likerts). These are interest signals, not installations. |
| Open issue/PR count | 0 | Same API. All prepared contributor issues are closed; zero open work is not evidence of adoption. |
| Repository contributors | One account: `barangaroo` | [Public contributors API](https://api.github.com/repos/crosstabs/likerts/contributors). No accepted outside contributor is visible. Bots, private activity and unmerged help are not inferred. |
| npm downloads: Web | 217 | [npm point API](https://api.npmjs.org/downloads/point/2026-09-12:2026-09-18/@likerts%2Fweb), window `2026-09-12` through `2026-09-18`. May include maintainer, CI and other automated package requests. |
| npm downloads: React Native | 170 | [Same source/window](https://api.npmjs.org/downloads/point/2026-09-12:2026-09-18/@likerts%2Freact-native); not device-use evidence. |
| npm downloads: MCP | 192 | [Same source/window](https://api.npmjs.org/downloads/point/2026-09-12:2026-09-18/@likerts%2Fmcp); not a successful client session count. |
| Confirmed external successful installations | Unknown | No voluntary external confirmation or observed outside onboarding is recorded. Download and clone counters cannot close this measure. |
| External first persisted responses / setup time | Unknown | No consented external lifecycle observation is recorded. |
| Outside contributors / repeat contributors | 0 / 0 confirmed | The public contributors list contains only the maintainer account. |

Release asset counts from the current [`community-v0.1.2` release API](https://api.github.com/repos/crosstabs/likerts/releases/tags/community-v0.1.2) at this refresh:

| Asset | Downloads |
| --- | --- |
| CLI macOS arm64 / Linux x64 / Windows x64 | 3 / 21 / 2 |
| Web / React Native / MCP / runtime archives | 2 each |
| Release manifest | 2 |
| Checksums | 22 |

The Linux archive and checksum totals are especially likely to include repository CI and maintainer verification. They are distribution traffic, not 21 external installations. A08 therefore remains open.

## Recording new evidence

Keep public aggregate observations here and sensitive support details in the appropriate private channel. Do not instrument self-hosted installations or add response-level telemetry for this ledger. A voluntary report can be anonymized; get permission before publishing a person's name, organization, quote or integration story.

| Date | Integration/platform | Evidence link or consented anonymous reference | Stage reached | Setup time, if measured | Friction / issue | Maintainer first reply | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | No external observation recorded yet | Unknown | Unknown | — | — | — |

Definitions:

- **External installation:** someone outside the maintainer/automated test team confirms the documented installation worked. Record the version and platform; deduplicate repeated attempts by that integration without storing personal identifiers publicly.
- **First real response:** the integrator confirms an accepted receipt and retrieves the matching response from their running API. Browser sample receipts do not qualify. Record whether storage is temporary memory or durable PostgreSQL.
- **Setup time:** elapsed time from beginning the documented path to first real response, with prerequisites/build time and pauses stated. Do not manufacture a “five-minute setup” claim from an internal warm-cache test.
- **Outside contribution:** an accepted contribution by an external person; keep bug reproductions, docs, code and reviews distinguishable. A repeat contributor makes a separate later contribution.
- **First maintainer reply:** time from a classified external support report to the first useful human maintainer response. Report sample size; automated acknowledgements do not count.

The launch support owner should review new reports after each launch session, assign reproducible friction to issues and record what improved. The review cadence and named owner remain [pending](HUMAN-HANDOFF.md); no scheduled monitor or outreach is created by this document.

Refresh public counts with read-only requests, retaining dates and windows:

```sh
gh api repos/crosstabs/likerts --jq '{stargazers_count,forks_count,subscribers_count,open_issues_count}'
gh api repos/crosstabs/likerts/releases/tags/community-v0.1.2 --jq '.assets[] | {name,download_count}'
gh api repos/crosstabs/likerts/contributors --paginate --jq '.[] | {login,contributions,type}'
curl --fail-with-body 'https://api.npmjs.org/downloads/point/last-week/@likerts%2Fweb'
curl --fail-with-body 'https://api.npmjs.org/downloads/point/last-week/@likerts%2Freact-native'
curl --fail-with-body 'https://api.npmjs.org/downloads/point/last-week/@likerts%2Fmcp'
```

Preserve npm's returned `start` and `end` dates when statistics become available. Trending, search indexing and adoption are outcomes to pursue, not guarantees.
