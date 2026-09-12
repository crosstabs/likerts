# Likerts community launch plan

Keep the MIT license. Make Likerts easy to try, easy to install and easy to contribute to before a public launch. Trending placement is not a release requirement or a guaranteed outcome.

## Work in progress

- [x] Add contribution instructions with focused checks for each area, issue forms, a PR template and a code of conduct.
- [x] Enable GitHub Discussions and publish a small roadmap and eight actionable contributor issues ([#4–#11](https://github.com/crosstabs/likerts/issues)).
- [x] Build a one-command example that embeds the real Web SDK, submits to a real local API and shows a stored response.
- [x] Record an honest walkthrough of that example and add it to the README.
- [x] Implement the versioned CLI, SDK/MCP tarball and container packaging pipeline with checksums and fresh installation checks. Public artifact verification is the next gate.
- [ ] Run required CI, create the first community release and verify the public downloads in a fresh consumer.
- [ ] Publish remote MCP metadata to the official registry using the repository's verified identity.
- [x] Prepare Show HN and developer-community launch drafts with working demo and contribution links.

## Account-dependent work

- npm registry publication needs an authenticated account with publishing rights to the `@likerts` scope. The local `npm whoami` check currently returns HTTP 401. GitHub Release tarballs provide installation while registry access is unresolved.
- External community posts use the founder's account and require explicit posting authorization. Drafts can be completed and reviewed without sending them.

## After the release

Target the first 10 external installations and three outside contributors. Track reported installation problems, first successful response, time to first maintainer reply and repeat contributions. Do not manufacture stars, engagement, users or testimonials. Offer small, useful tasks with a clear definition of done and retain meaningful scope for contributors.

The community release tag is `community-v0.1.0`; it identifies a tested source snapshot. Historical preview archives remain frozen. Component package versions are reported explicitly instead of implying that old archives contain the free edition.
