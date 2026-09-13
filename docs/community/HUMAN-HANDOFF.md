# Human launch handoff

Updated 2026-09-13. The software, npm packages and community artifacts are already public. The following tasks require real account access, human authorship or commitments that an automated agent cannot invent. Prepared documents do not mean these tasks have been completed.

| Item | Human input / action | Prepared material and completion evidence |
| --- | --- | --- |
| Support ownership | Name the accountable maintainer, backup/escalation contact if any, and the times they can answer during launch. These are currently unassigned. | [Support guide](SUPPORT.md); record actual ownership and availability before promising a response window. No SLA has been promised. |
| Hosted-service scope | Confirm who operates the optional hosted service and the intended audience, data handling/deletion expectations and support/capacity boundaries. Do not infer a production hosting promise from free MIT software. | Review the launch scope and public hosted disclosures with the chief engineer. Completion is consistent published information backed by actual operational decisions. |
| Hacker News | Sign in, personally write the title and any comment, and be available for replies. | Factual references below. Completion is a submission URL and human-authored conversation, not a generated draft. |
| Rust community | Choose a maintainer account, review the [draft and rules](LAUNCH-KIT.md), and choose an actual availability window. | Record final approved copy, disclosure, submission URL and questions received. No post has been made. |
| DEV | A human author chooses a useful technical lesson from their own work and writes a substantial article under current rules; use the required disclosure if any permitted AI assistance is used. | [Policy review](LAUNCH-KIT.md). No AI promotional draft or automated comments are prepared. Publication remains optional. |
| Search Console | Supply access to an existing verified property or complete account/domain verification. Do not send passwords or private tokens in chat. | Submit `https://likerts.com/sitemap.xml`; inspect home, docs, demo and API reference. Record the property, sitemap receipt and URL Inspection results. Do not claim successful indexing from a submission alone. |
| Codex / Claude end-to-end agent calls | Authenticate Claude Code through its normal account flow; investigate Codex's missing verified tool completion with normal client diagnostics and any real approval prompt. No account upgrade or approval bypass is implied. | Client configuration parsing and the independent npm/PostgreSQL MCP lifecycle passed. Actual client model-call evidence remains incomplete; see the precise boundary below. |
| External adoption | Volunteers report setup results or participate in an onboarding session; people separately consent to any public attribution/quote. | [Evidence ledger](ADOPTION.md). No outside users, contributors or testimonials are presumed. |

## Hacker News factual reference — not submission text

The [HN guidelines](https://news.ycombinator.com/newsguidelines.html) prohibit generated or AI-edited text. The [Show HN guidance](https://news.ycombinator.com/showhn.html) asks for something people can try, with the maker present to discuss it; it discourages sign-up barriers and prohibits soliciting votes. Rules checked 2026-09-13. Write from personal experience without copying or AI-editing this reference into a post.

- Submission destination: [runnable repository](https://github.com/crosstabs/likerts), not only the marketing landing page.
- Product: MIT-licensed embedded survey infrastructure; application-owned placement, no respondent-link distribution or email invitations.
- Implementations: Rust API/CLI; HTTP and MCP management interfaces; Web, React Native, iOS, Android and Flutter SDKs.
- Real example: `bash scripts/run-feedback-demo.sh`, Rust stable, Node.js 22+, npm and Bash; local memory storage clears on shutdown.
- Proof to explore: [recording](https://likerts.com/media/embedded-feedback-demo.webm), [example source](../../examples/embedded-feedback/README.md), [public release](https://github.com/crosstabs/likerts/releases/tag/community-v0.1.0).
- Online [renderer demo](https://likerts.com/demo): browser sample mode, no response persistence.
- Software cost: no response fees; operator supplies hosting and capacity.
- npm: Web/React Native `0.0.3`, MCP `0.1.0`; native SDKs available from source.
- No guaranteed Trending placement, no manufactured stars, no coordinated upvotes/comments and no invented customer story.

## Real agent-client verification boundary

On 13 September 2026, a disposable local PostgreSQL/API environment issued a temporary service credential with only `surveys:read` for a separate empty workspace. One bounded noninteractive model request was attempted per installed client. No production workspace was used, no global client configuration was changed, and no account purchase or real approval bypass was performed. Temporary credentials, workspace, files and container were cleaned up.

| Client | Observed outcome | What remains unproved |
| --- | --- | --- |
| Codex CLI `0.154.0` | The subprocess returned exit code 0, without a verified completed `surveys_list` MCP event. It did not hit the timeout. | MCP connection and successful tool execution were not established. Raw diagnostic logs were intentionally not retained, so the cause is unknown; do not label this an authentication, network, model or permission failure without new evidence. |
| Claude Code `2.1.201` | The bounded request reported authentication required; no verified `surveys_list` tool call completed. | Authenticate through the client's normal account flow before a new bounded attempt. An actual returned tool result is still required. |

Separately, both installed clients parsed their documented configurations: Codex accepted invocation-only stdio/`env_vars` settings; Claude recognized a temporary project `.mcp.json` and correctly reported **Pending approval**. Parsing is not connection evidence. The independent official MCP SDK probe installed public `@likerts/mcp@0.1.0`, discovered all 33 tools and passed a real scoped PostgreSQL lifecycle, idempotent retry, insufficient-scope denial, collection closure, response deletion and credential revocation. Those passed checks do not substitute for the two client model calls.

The optional `--clients` mode in [the MCP lifecycle check](../../scripts/check-mcp-lifecycle.mjs) uses temporary client configuration and sanitized summaries. It is excluded from ordinary CI and exits nonzero unless both clients return a verified empty survey-list result. A future human-authorized rerun should record client version, subprocess exit/timeout, MCP startup outcome and actual tool result without recording tokens or raw customer content.

## Search verification reference

Google documents [Search Console setup and URL Inspection](https://developers.google.com/search/docs/monitor-debug/search-console-start) and [sitemap submission](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap). The public robots file already advertises the sitemap. Account verification supplies evidence of discovery/indexing state; no account access or sitemap submission has been performed by preparing this handoff.

The finite launch-readiness goal can complete autonomous preparation and explicitly record these dependencies. Real authorship, login, support commitments and external adoption cannot be replaced by waiting, test traffic or an AI pretending to be a person.
