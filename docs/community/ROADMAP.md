# Community roadmap

Likerts is an MIT-licensed collection backend for feedback inside customer-owned products. The API, MCP, CLI and five SDKs already exist. This roadmap focuses on making them easier to adopt and maintain. These are priorities, not delivery-date promises.

## 1. Make the first real response easy

Reduce the distance from a fresh clone to a response someone can inspect. Prioritize a small Docker-based local environment, tested setup instructions and copyable integration examples. Each example should handle cleanup and errors, use collection-only credentials and distinguish simulated receipts from persisted responses.

Success means a new contributor can follow documented steps from a clean checkout, submit feedback, retry without duplication and understand where the response lives.

## 2. Fit naturally into existing products

Add focused React/Next.js, Vue and Svelte host examples around the existing Web SDK. Improve keyboard use, screen-reader announcements, lifecycle cleanup and narrow-screen rendering across supported clients. Work from an actual integration or a reproducible usability problem rather than adding question types without a use case.

Success means an application developer can use an idiomatic example and retain control over placement, presentation and consent.

## 3. Keep behavior dependable as people contribute

Extend browser coverage, exercise documentation examples against the actual contract and make compatibility changes explicit. Preserve workspace isolation, scoped access, immutable publication and idempotent submission across every interface. Package distribution and deployment improvements should build on reproducible source artifacts.

Success means a contributor can see which checks protect their change and a maintainer can review its impact without manually rebuilding every client.

## How to help

Browse [open issues](https://github.com/crosstabs/likerts/issues). Reproductions, documentation corrections and tests of an integration are useful contributions. Read [CONTRIBUTING.md](../../CONTRIBUTING.md) for focused setup and checks. Propose a small, testable change before a broad rewrite.

Survey distribution, public respondent links and a paid response meter are outside this roadmap. Hosting costs and operational capacity remain the operator's responsibility.
