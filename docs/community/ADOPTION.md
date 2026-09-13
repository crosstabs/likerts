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
gh api repos/crosstabs/likerts/releases/tags/community-v0.1.0 --jq '.assets[] | {name,download_count}'
curl --fail-with-body 'https://api.npmjs.org/downloads/point/last-week/@likerts%2Fweb'
curl --fail-with-body 'https://api.npmjs.org/downloads/point/last-week/@likerts%2Freact-native'
curl --fail-with-body 'https://api.npmjs.org/downloads/point/last-week/@likerts%2Fmcp'
```

Preserve npm's returned `start` and `end` dates when statistics become available. Trending, search indexing and adoption are outcomes to pursue, not guarantees.
