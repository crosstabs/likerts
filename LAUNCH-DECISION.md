# Launch decision

Current public-launch work, hosted-service gates and council ownership are tracked in [PUBLIC-LAUNCH.md](PUBLIC-LAUNCH.md). The completed items below record earlier release milestones.

**Current decision: released. The community-edition checks in [LAUNCH-TASKS.md](LAUNCH-TASKS.md) pass.**

The intended release is free, MIT licensed, self-hosted, API/MCP/CLI first, and available through five SDKs. Earlier prepaid-response and enterprise-commercial plans were prelaunch experiments and are not part of the product.

Release commit `8588b67` is public on GitHub and deployed to the Render API, MCP gateway, webhook worker, migration image, and Vercel production site. Hosted smoke testing covered service health, OAuth resource discovery, unauthenticated denial, a real accepted response, identical idempotent retry, retrieval, count-only usage, and deletion of the synthetic workspace.
