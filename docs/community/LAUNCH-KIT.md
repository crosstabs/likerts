# Public launch kit

Prepared 2026-09-13. These are reviewable assets and channel plans, not evidence that external announcements have been posted. [GitHub Discussion #14](https://github.com/crosstabs/likerts/discussions/14) is already published. Check the [human handoff](HUMAN-HANDOFF.md) before choosing a launch window.

## Product facts

Likerts is free, MIT-licensed infrastructure for surveys embedded in an application's own web and mobile experiences. A Rust API and CLI, MCP adapter and five SDKs provide survey creation, publication, collection and response management. The application controls audience and placement. Likerts does not send invitations or host respondent links.

There are nine wire question types: single choice, multiple choice, scale, text, number, date, ranking, matrix and constant sum. Presets, conditional visibility, pages and branching build on them. Self-hosting requires the operator's infrastructure; no response fee is charged by the software. Do not claim SOC 2 certification, an SLA, unlimited infrastructure capacity, customer adoption or app-store availability.

| Asset | Current destination / version |
| --- | --- |
| Product site | [likerts.com](https://likerts.com) |
| Runnable source and contribution entry | [crosstabs/likerts](https://github.com/crosstabs/likerts), [contributing](../../CONTRIBUTING.md), [open issues](https://github.com/crosstabs/likerts/issues) |
| Real collection recording | [40-second walkthrough](https://likerts.com/media/embedded-feedback-demo.webm), [poster](https://likerts.com/media/embedded-feedback-poster.png), [captions](https://likerts.com/media/embedded-feedback-demo.vtt) |
| Tested implementation guides | [Checkout feedback with metadata](../guides/checkout-feedback.md), [MCP survey lifecycle](../guides/agent-survey-lifecycle.md) |
| Framework hosts | [Next.js](../../examples/nextjs-feedback/README.md), [Vue](../../examples/vue-feedback/README.md), [Svelte](../../examples/svelte-feedback/README.md) |
| Interactive renderer | [Browser demo](https://likerts.com/demo); local sample mode, simulated receipt, no responses sent |
| Social image | [1200 × 630 PNG](https://likerts.com/social-preview.png) |
| Full community snapshot | [community-v0.1.2](https://github.com/crosstabs/likerts/releases/tag/community-v0.1.2), native CLI `0.1.2` for Linux x64, macOS arm64 and Windows x64 |
| npm packages | [@likerts/web `0.0.3`](https://www.npmjs.com/package/@likerts/web), [@likerts/react-native `0.0.3`](https://www.npmjs.com/package/@likerts/react-native), [@likerts/mcp `0.1.0`](https://www.npmjs.com/package/@likerts/mcp) |
| iOS / Android / Flutter | iOS Swift Git tag `0.1.0`; [Flutter `0.0.3` on pub.dev](https://pub.dev/packages/likerts/versions/0.0.3); Android from source. See [installation](../../sdks/INSTALLATION.md). Maven Central publication remains pending; SDK packages do not imply a consumer app. |
| Container | `ghcr.io/crosstabs/likerts:community-v0.1.2`; see [digest and checksums](../releases.md) |
| MCP registry | [io.github.crosstabs/likerts](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.crosstabs%2Flikerts/versions/latest), registered version `0.1.1` with npm stdio and remote HTTP; npm package remains `0.1.0`. A registry listing is not a guarantee of client compatibility or hosting availability |
| Help | [Community support](SUPPORT.md), [private security reporting](../../SECURITY.md) |

The real walkthrough runs with Rust stable, Node.js 22+, npm and Bash:

```sh
git clone https://github.com/crosstabs/likerts.git
cd likerts
bash scripts/run-feedback-demo.sh
```

Open `http://127.0.0.1:4310`, submit, then select **Read it from the backend** and compare the response ID. The first build can take several minutes. The API stores data in memory until shutdown; this is real local collection, not durable production storage. The example's unauthenticated operator view must remain on loopback. See [example instructions](../../examples/embedded-feedback/README.md).

## Two candidate developer communities

The expanded-goal review supersedes these older candidates with [current introductions and rule checks](COMMUNITY-INTRODUCTIONS.md). In particular, the Rust announcement draft below is historical preparation, not a cleared current destination. Do not publish it without the new account-time rule check.

Rules were read on 2026-09-13. Recheck them and any account/category restrictions immediately before posting. Publication and replies require a responsible maintainer; nothing here authorizes mass messages or coordinated votes.

| Candidate | Fit and permitted format | Prepared state |
| --- | --- | --- |
| [Rust users: announcements](https://users.rust-lang.org/c/announcements/6) | The [category description](https://users.rust-lang.org/t/about-the-announcements-category/1185) permits project announcements. The [forum guidelines](https://users.rust-lang.org/guidelines) require relevant, civil discussion, no spam and no cross-posting the same topic. Focus on the Rust API/CLI and runnable source. | Draft below; maintainer review, account access and availability pending. |
| [DEV Community](https://dev.to) | Its [content policy](https://dev.to/terms) requires substantial on-topic content rather than promotion/backlinks. Its [AI guidelines](https://dev.to/guidelines-for-ai-assisted-articles-on-dev) prohibit AI-assisted promotional posts and AI-generated comments. The [August 2026 disclosure update](https://dev.to/devteam/introducing-ai-disclosure-on-dev-tools-for-nuance-clarity-and-better-feeds-34mk) adds disclosure tiers; it does not expressly remove those restrictions. | Human-authored educational article candidate only; no generated promotional draft. Author must contribute actual experience and technical substance, disclose any permitted AI assistance and answer personally. |

### Rust announcement draft — not posted

**Title:** Likerts: an MIT-licensed Rust API and CLI for embedded surveys

**Disclosure:** This is a project announcement from a Likerts maintainer. The draft was prepared with AI assistance and needs maintainer review before publication.

Likerts collects survey responses inside an existing application. Its backend and CLI are written in Rust; the same management operations are available through HTTP and MCP. Web and mobile SDKs render the published survey and submit with a collection-scoped credential.

The project includes immutable survey versions, PostgreSQL workspace isolation and idempotent submissions. A small local storefront example runs the actual Web SDK against the Rust API and lets you retrieve the response afterward:

```sh
git clone https://github.com/crosstabs/likerts.git
cd likerts
bash scripts/run-feedback-demo.sh
```

You need Rust stable, Node.js 22+, npm and Bash. The example binds to loopback and uses temporary memory storage; production deployments require PostgreSQL and operator-managed configuration. The software does not send survey invitations or provide public respondent links.

[Source and setup](https://github.com/crosstabs/likerts) · [recorded walkthrough](https://likerts.com/media/embedded-feedback-demo.webm) · [versioned downloads](https://github.com/crosstabs/likerts/releases/tag/community-v0.1.2)

Feedback on the Rust setup path, CLI ergonomics and reproductions of integration failures would be useful. The repository has focused checks and contributor tasks for people who want to explore it.

## Launch session checklist

- [ ] Record the intended source/release versions and latest passing launch checks; do not relabel historical artifacts.
- [ ] Follow the public installation path in a clean environment and verify the recording, demo, release and support links.
- [ ] Confirm the support owner, launch availability, hosted-service boundaries and channel account access in [the handoff](HUMAN-HANDOFF.md).
- [ ] Recheck destination rules, affiliation/authorship disclosure and the actual final copy. HN requires human-authored text; do not use the Rust draft there.
- [ ] Publish only the selected, authorized announcement and record its URL/time below. Monitor replies during the human's chosen availability window.
- [ ] Route reproducible friction to issues, security concerns privately, and consented adoption evidence to [the ledger](ADOPTION.md).

| Channel | Status | URL / time / accountable maintainer |
| --- | --- | --- |
| GitHub community announcement | Published | [Discussion #14](https://github.com/crosstabs/likerts/discussions/14); updated 2026-09-13 with current quickstarts, registry, evidence and preview limits |
| Hacker News | Pending human authorship and account | — |
| Rust users | Draft only | — |
| DEV | Human article candidate only | — |

Search Console verification and sitemap inspection are separate distribution tasks in the handoff. Search indexing, placement on Trending and external engagement are not guaranteed or prerequisites for declaring technical release work complete.
