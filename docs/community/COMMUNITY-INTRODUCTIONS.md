# Community introductions — drafts and publishing handoff

Prepared **2026-09-13**. No post, comment, message, account creation or publication change was made. These are two distinct, reviewable drafts for a real founder to review and own. Do not copy either into Hacker News or DEV: the [existing handoff](HUMAN-HANDOFF.md) explains their different AI-content restrictions.

## Destinations and current rule evidence

| Community | Why this fits and what the primary rules allow | Exact destination and unresolved requirements |
| --- | --- | --- |
| **Hashnode: a technical article on the founder's publication** | Its [Code of Conduct](https://hashnode.com/code-of-conduct), updated 4 June 2026, expressly permits reviewed AI-generated articles and welcomes technical tutorials and relevant repository/documentation links. It forbids bulk/automated posting and using the community primarily for promotion without contributing. Its [terms](https://hashnode.com/terms) require responsibility for AI suggestions and prohibit unsolicited promotional spam. The draft below teaches a specific failure-handling technique; this is not permission for a promotional posting campaign. | Start at [Hashnode](https://hashnode.com/), select the founder's existing publication and create an article. The [22 June interface update](https://hashnode.com/changelog/2026-06-22-writing-first-redesign) identifies this writing workflow. **Publishing account, publication URL, editor access and final article URL are unknown.** No account is presumed to exist. Founder review and an authorized publication/account are required; no moderator preapproval requirement was found for this article format. |
| **r/selfhosted: current New Project Megathread, one top-level comment** | [Rule 6](https://www.reddit.com/r/selfhosted/wiki/rules/) routes projects younger than three months into the current megathread; ordinary promotion must respect its relevance/documentation and anti-spam rules. The moderator's [April rules update](https://old.reddit.com/r/selfhosted/comments/1sey9ch/quarter_2_update_revisiting_rules_again/) provides the new-project route and requires transparent AI disclosure. The [retrieved megathread template](https://old.reddit.com/r/selfhosted/comments/1w6lmbj/new_project_megathread_week_of_03_sep_2026/) requests project, repository, description, deployment and AI involvement. This route is appropriate for a self-hostable embedded-survey backend and its developer/operator audience. | The exact **retrieved** thread is [Week of 03 Sep 2026](https://www.reddit.com/r/selfhosted/comments/1w6lmbj/new_project_megathread_week_of_03_sep_2026/). **Do not assume it is current on publication day.** Open [r/selfhosted](https://www.reddit.com/r/selfhosted/) and use its then-current pinned New Project Megathread. Current-thread permalink, founder Reddit account, eligibility/history, comment access and reply availability are unknown. Direct live JSON access returned HTTP 403 during this review; search/page snapshots did not establish a newer current thread. No standalone project post is prepared. |

The sources above were read on the preparation date; cached pages are evidence of their displayed rules, not a guarantee of today's logged-in composer state. Recheck destination rules, thread status and any account restrictions before publishing. The checkout's earliest recorded commit is 2026-08-28; that supports treating Likerts as a new project for planning, but the founder should disclose any earlier public presence if relevant to the subreddit age rule.

**Rust is a fallback requiring a new decision.** Its [announcements category](https://users.rust-lang.org/t/about-the-announcements-category/1185) accepts project announcements, but the [moderator update of 10 September 2026](https://users.rust-lang.org/t/announcement-topic-category/142378) says announcements were muted by default and discusses quality/AI concerns. The [general guidelines](https://users.rust-lang.org/guidelines) do not explicitly resolve permission for AI-written promotional text. The older Rust draft in [LAUNCH-KIT.md](LAUNCH-KIT.md) is therefore not treated here as an AI-policy-cleared destination. A proposal by a participant in that discussion is not an adopted rule.

## Draft 1 — Hashnode technical article

**Proposed title:** An accepted response can look like a failed request: testing checkout feedback retries

**Founder disclosure:** I'm the founder of [Likerts](https://github.com/crosstabs/likerts), free MIT-licensed infrastructure for surveys embedded in an application. AI tools helped implement the project, write tests and prepare this article. I am responsible for the published claims. This article describes reproducible project tests, not a customer case study.

A submit button can show a network error after the server has already stored the answer. Giving the retry a fresh request key then turns one person's feedback into two responses. The useful test is to let the real API accept the request and deliberately drop its reply.

The [Next.js checkout walkthrough](https://github.com/crosstabs/likerts/blob/main/docs/guides/checkout-feedback.md) does exactly that. It runs a production Next build against a disposable local Rust API using published `@likerts/web@0.0.3`. The host opens feedback only after a visitor's action and attaches `{ screen: "checkout", framework: "nextjs" }` as metadata.

The retry implementation keeps two things separate: the DOM renderer's lifetime and the unfinished submission's lifetime. Before the first network write, it copies the submission and its idempotency key into a session owned by the root layout. Navigation aborts requests and removes the renderer, while the session retains the original attempt. Reopening feedback exposes an explicit retry of that saved payload. A successful retry returns the same receipt.

You can reproduce the check with Rust stable, Node.js 22+, npm and Bash. From a repository checkout:

```sh
set -e
source scripts/dev-env.sh
npm ci --prefix examples/nextjs-feedback
npm exec --prefix examples/nextjs-feedback -- playwright install chromium
npm run build --prefix examples/nextjs-feedback
LIKERTS_EXAMPLE_PORT=4380 LIKERTS_EXAMPLE_API_PORT=4381 \
  npm run check --prefix examples/nextjs-feedback
```

The browser check accepts an answer, drops the reply, navigates away and back, retries, and then verifies one stored response with the original receipt. It also checks renderer cleanup and management-token absence from browser requests and built assets. These checks passed locally on 13 September 2026.

There are deliberate limits. The pending attempt lives in memory across client navigation; it does not survive a full reload or tab closure. A real application needs a reconciliation or persistence policy for that case. The local API's data clears on shutdown. Its unauthenticated operator readback is bound to loopback and must not be deployed publicly; a production host needs its own authenticated, authorized response access. Metadata supplied by a browser is not proof that a purchase happened.

The broader project has a Rust API/CLI, HTTP and MCP management, and Web/mobile SDKs. Survey placement and audience remain the application's responsibility; the software does not distribute invitations or respondent links. There is no software response fee, and self-hosters supply their infrastructure.

For a second reproducible boundary, the [MCP lifecycle walkthrough](https://github.com/crosstabs/likerts/blob/main/docs/guides/agent-survey-lifecycle.md) creates a scoped credential against disposable PostgreSQL, proves a read-only credential cannot create a survey, and ends by verifying revocation. It uses the public MCP package without needing a model account. The practical contribution is the runnable failure case: if your integration also navigates during submission, try the lost-reply sequence before relying on its retry button.

## Draft 2 — r/selfhosted new-project comment

**Project name:** Likerts

**Affiliation:** I'm the founder. This is an introduction to my project, not an independent recommendation.

**Repository:** [crosstabs/likerts](https://github.com/crosstabs/likerts) — free, MIT-licensed.

**What it does:** Likerts is a backend and SDKs for collecting feedback inside an app you already operate. Your app decides who sees a survey and where it appears. The Rust API and CLI, plus HTTP/MCP management, cover survey publication, collections and response management. It includes scoped collection credentials, immutable published survey versions and idempotent submission retries. There are Web, React Native, iOS, Android and Flutter SDKs. It does not send email invitations or provide respondent-link distribution.

**Why self-host it:** Run the backend and PostgreSQL under your own administration and embed feedback in your own application. The software has no response fee; you still provide hosting, capacity, access control and operations. This is an early community release, with no support SLA or compliance certification claim.

**Try it:** The [repository setup](https://github.com/crosstabs/likerts#readme) and [release/install notes](https://github.com/crosstabs/likerts/blob/main/docs/releases.md) cover source and container paths. To see collection working locally first, the [checkout walkthrough](https://github.com/crosstabs/likerts/blob/main/docs/guides/checkout-feedback.md) runs a Next app, submits an answer and retrieves it from the real API. That demo needs Rust stable, Node.js 22+, npm and Bash; it uses temporary memory storage and a loopback-only operator view. Do not expose that demo operator route publicly. Durable self-hosting requires PostgreSQL and the deployment configuration documented in the repository.

**AI involvement:** AI coding agents have been used substantially for implementation, tests and documentation. This comment was prepared with AI assistance. Passing automated checks are recorded in the repository; this is not a claim that a human manually audited every line or that outside customers have validated it.

The most useful feedback would be a reproducible installation problem or a missing step in the embedded-app integration. The repository links community support and private security reporting. No account is needed to download the source or run the local walkthrough.

## Before either draft can become a published introduction

1. A real founder reviews the selected draft and the linked implementation. Keep the affiliation and substantive AI disclosure accurate; do not add a fictional personal experience, adoption number or promise to answer at a time that has not been agreed.
2. Merge/publish the two guide files and verify their **public** links before posting. They existed and passed local rehearsals when these drafts were prepared; this document alone does not establish that the GitHub `main` URLs already serve them. Check the repository, release and guide links from a signed-out browser.
3. Identify the publishing account and destination. For Hashnode, record the authorized publication URL and editor access. For Reddit, record the current pinned thread permalink, account eligibility and one top-level-comment action. Respect any real trust/moderation prompt; do not manufacture account history or bypass restrictions.
4. Record the final reviewed text and the user's authorization to publish from that identified account. This delegated preparation task grants no authority to post, send a moderator message, sign up or change account settings. It found no general rule requiring a moderator permission request for the two proposed formats; if the live composer requires one, record that actual requirement before seeking it.
5. Choose a real owner and reply window. After publication, record the URL/time and substantive questions in the [adoption ledger](ADOPTION.md). Count actual independent setup reports separately from views/downloads. Do not solicit votes, manufacture comments or repost into multiple channels automatically.

| Deliverable | State | Completion evidence still needed |
| --- | --- | --- |
| Two differentiated introductions and primary-rule review | Prepared | This file; product claims grounded in the two tested guides. |
| Hashnode article | Not published | Authorized account/publication, reviewed final copy, publication URL. |
| r/selfhosted introduction | Not posted | Current pinned thread, eligible account, reviewed comment, comment permalink. |
| Replies and external adoption | No activity claimed | Named responder/availability and actual independent reports. |
