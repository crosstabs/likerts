# Launch drafts

Drafts only. Nothing in this document has been posted. A maintainer should verify the linked demo and quickstart immediately before publishing, adapt wording to their own voice and follow each community's rules.

## Show HN

**Title:** Show HN: Likerts — open-source surveys embedded in your own product

**Submission URL:** https://github.com/crosstabs/likerts

**Introductory comment:**

Likerts is a survey collection backend for feedback that appears inside your own web or mobile application. Your application controls who sees a question and when. The backend validates the answer against an immutable published survey, stores it and returns an idempotent receipt.

You can try the browser renderer without signing up: https://likerts.com/demo. That online sample keeps answers in page memory and simulates the receipt. For real collection, clone the repository and run `bash scripts/run-feedback-demo.sh`: the Web SDK submits to a local Rust API and an operator view retrieves the stored response. It needs Rust and Node.js 22+. Watch that exact flow at https://likerts.com/media/embedded-feedback-demo.webm.

The backend and CLI are Rust; the platform also exposes HTTP and MCP, with Web, React Native, iOS, Android and Flutter SDKs. It is MIT licensed and self-hostable. There is no paid response meter; you pay for your own infrastructure. It does not send invitations or create public survey links.

It is early software. Check https://github.com/crosstabs/likerts/releases for versioned CLI downloads and installable Web, React Native and MCP tarballs; mobile SDKs are available from source. Packages are not yet on npm. I would especially value feedback on the first-run experience and how cleanly the collection API fits into an existing product.

**Before posting:** Follow the [Show HN guidelines](https://news.ycombinator.com/showhn.html): submit something people can run, make it easy to try, explain the work personally and be available for discussion. Do not solicit votes. Use the repository or runnable demo as the submission destination, not a landing page alone.

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
