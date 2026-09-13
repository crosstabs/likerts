# Launch drafts

The current channel-specific material is in the [launch kit](LAUNCH-KIT.md); account, authorship and support commitments are tracked in the [human handoff](HUMAN-HANDOFF.md). The generic material below is an internal reference, not a destination-approved post. In particular, do not use it for HN or as an AI-generated promotional article on DEV.

External-community drafts and a founder handoff. A separate [GitHub release announcement](https://github.com/crosstabs/likerts/discussions/14) is published; the external drafts below have not been posted. A maintainer should verify the linked demo and quickstart immediately before publishing, adapt wording to their own voice and follow each community's rules.

## Hacker News founder handoff

The [HN guidelines](https://news.ycombinator.com/newsguidelines.html) prohibit generated or AI-edited text. The previous generated introductory comment has been removed. The founder must write the submission title and any introductory comment in their own words, sign in, and be available for replies. Do not copy an AI-written draft into the submission.

Factual reference for the founder:

- Source and submission destination: https://github.com/crosstabs/likerts
- Working local example: `bash scripts/run-feedback-demo.sh`; Rust stable, Node.js22+ and Bash required.
- Online renderer sample: https://likerts.com/demo; sample mode simulates the receipt.
- Real local collection recording: https://likerts.com/media/embedded-feedback-demo.webm
- Public downloads: https://github.com/crosstabs/likerts/releases/tag/community-v0.1.2
- Public Docker image: `ghcr.io/crosstabs/likerts:community-v0.1.2`
- MIT license; self-hosting uses the operator's infrastructure. Web, React Native and MCP packages are published on npm under `@likerts`.

Follow [Show HN's rules](https://news.ycombinator.com/showhn.html), use the runnable project as the destination, and do not solicit votes or coordinated comments.

## Developer community introduction

**Title:** An open-source backend for surveys inside your app: Likerts

If you already control the customer journey, a survey does not have to start with another link. Likerts lets you mount questions inside your web or mobile product and send validated answers to a backend you can run yourself.

The same management operations are exposed through HTTP, MCP and a CLI. SDKs cover Web, React Native, Swift/iOS, Kotlin/Android and Flutter. Survey definitions support scales, choices and open input, plus ranking, matrices, allocation, conditional visibility and branching.

Try the renderer at https://likerts.com/demo, or run the real collection walkthrough from https://github.com/crosstabs/likerts. The online demo is local sample mode; the README walkthrough exercises the backend. The source is MIT licensed, with no software response charges. Hosting is your responsibility.

We are looking for practical feedback: where does setup get confusing, what framework example would help, and what breaks when you embed this in a real application? Contributions and small reproductions are welcome.

**Adaptation note:** Check whether the destination permits project introductions and requires affiliation disclosure or a weekly showcase thread. Keep the introduction technical and specific; do not post identical messages indiscriminately.

## Contribution invitation

Likerts is open for contributions. If you enjoy framework integrations, accessible form controls or clear developer docs, there is useful work beyond the backend.

Start with https://github.com/crosstabs/likerts/blob/main/CONTRIBUTING.md. It has focused checks by area, so a Web example does not require an iOS or Android toolchain. Current priorities are easier first-run setup, idiomatic application integrations and dependable cross-client behavior.

Browse https://github.com/crosstabs/likerts/issues and comment on a task that interests you. A clear bug reproduction or correction to a confusing installation step is as welcome as a code change. Contributions remain MIT licensed.
