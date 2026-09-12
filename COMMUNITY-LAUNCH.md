# Likerts community launch plan

Keep the MIT license. Make Likerts easy to try, easy to install and easy to contribute to before a public launch. Trending placement is not a release requirement or a guaranteed outcome.

## Delivery status

- [x] Add contribution instructions with focused checks for each area, issue forms, a PR template and a code of conduct.
- [x] Enable GitHub Discussions and publish a small roadmap and eight actionable contributor issues ([#4–#11](https://github.com/crosstabs/likerts/issues)).
- [x] Build a one-command example that embeds the real Web SDK, submits to a real local API and shows a stored response.
- [x] Record an honest walkthrough of that example and add it to the README.
- [x] Implement the versioned CLI, SDK/MCP tarball and container packaging pipeline with checksums and fresh installation checks. Public artifact verification is the next gate.
- [x] Run required CI, publish [community-v0.1.0](https://github.com/crosstabs/likerts/releases/tag/community-v0.1.0), and verify the release artifacts and anonymous downloads. Native CLI binaries ran on Linux, macOS and Windows; uploaded packages passed fresh-consumer checks.
- [x] Publish remote MCP metadata using GitHub OIDC. [Official registry record](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.crosstabs%2Flikerts/versions/latest) is active as `io.github.crosstabs/likerts`, version `0.1.0`; [publication workflow](https://github.com/crosstabs/likerts/actions/runs/34697554305) passed.
- [x] Prepare Show HN and developer-community launch drafts with working demo and contribution links.

## Account-dependent work

- npm registry publication needs an authenticated account with publishing rights to the `@likerts` scope. The local `npm whoami` check currently returns HTTP 401. GitHub Release tarballs provide installation while registry access is unresolved.
- GHCR holds the tested runtime image, but the organization disables public package visibility. The same image is available as a public Docker archive in the GitHub release. Enabling anonymous GHCR pulls requires an organization administrator to allow public packages.
- External community posts use the founder's account and require explicit posting authorization. Drafts can be completed and reviewed without sending them.

## After the release

Target the first 10 external installations and three outside contributors. Track reported installation problems, first successful response, time to first maintainer reply and repeat contributions. Do not manufacture stars, engagement, users or testimonials. Offer small, useful tasks with a clear definition of done and retain meaningful scope for contributors.

The community release tag is `community-v0.1.0`; it identifies a tested source snapshot. Historical preview archives remain frozen. Component package versions are reported explicitly instead of implying that old archives contain the free edition.

Release source: `bcee636c41aa4a1ee63391ca43c55e54c7a5167c`. [Required main verification](https://github.com/crosstabs/likerts/actions/runs/34696660606) and [native builds, package installations and runtime smoke](https://github.com/crosstabs/likerts/actions/runs/34697163358) passed. The main verification needed one retry after an external MinIO registry download failed with an unexpected EOF. Release tags are protected against updates and deletion.
