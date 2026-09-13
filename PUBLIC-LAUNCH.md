# Likerts public launch: council decision and task list

Reviewed 13 September 2026 by developer relations, chief engineering and marketing agents, consolidated by the CEO agent. This is the current launch execution record. Role names assign responsibility for work; they do not imply hired human staff or an on-call service.

## Decision

The MIT community edition is already publicly released. The next milestone is a dependable, discoverable public launch: a newcomer can understand Likerts, install it, collect and retrieve a real response, and get help without maintainer-only setup.

Launch the self-hosted open-source product. Keep the existing hosted reference service explicitly identified as a preview; unrestricted hosted onboarding and production-data promises require the separate H gates below. Do not describe preview health checks as an availability guarantee, an API retention operation as a running schedule, or a local restore as managed recovery evidence.

Preserve the product: free MIT software, customer-owned placement and distribution, API/MCP/CLI parity, and Web, React Native, iOS, Android and Flutter SDKs. Use the existing Render, Vercel, Neon and connected resources. No new billing meter, enterprise certification program, survey-link distributor, app-store application or platform migration is part of this launch.

## Verified baseline — do not rebuild these

| Delivered | Evidence and limits |
| --- | --- |
| Public MIT repository, contribution guide, private security-reporting instructions, Code of Conduct, Discussions and roadmap | [Repository](https://github.com/crosstabs/likerts); [contribution guide](CONTRIBUTING.md); eight existing contributor issues #4–#11. Actual support staffing still needs an owner. |
| Versioned community release, three native CLI targets, SDK/MCP tarballs and public runtime image | [community-v0.1.0](https://github.com/crosstabs/likerts/releases/tag/community-v0.1.0), source `bcee636c41aa4a1ee63391ca43c55e54c7a5167c`; [native build evidence](https://github.com/crosstabs/likerts/actions/runs/34697163358). CLI binaries are unsigned; release assets and tags are immutable. |
| Public npm packages | `@likerts/web@0.0.3`, `@likerts/react-native@0.0.3`, `@likerts/mcp@0.1.0`. Fresh registry consumer checks passed; anonymous metadata/tarball checksums verified. MCP discovered 33 tools and completed authenticated `usage_get` against a local test API. RN entry-point checks are not device-rendering evidence. |
| Remote MCP registry listing | [Official record](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.crosstabs%2Flikerts/versions/latest), `io.github.crosstabs/likerts` version `0.1.0`, remote HTTP. npm stdio metadata is a separate remaining improvement. |
| Real local collection demo and recording | [Example](examples/embedded-feedback/README.md), `bash scripts/run-feedback-demo.sh`, [recording](https://likerts.com/media/embedded-feedback-demo.webm). Website renderer demo simulates receipts; the local walkthrough uses the API. |
| Website and basic SEO | Home, docs, demo, robots, sitemap, social image and llms.txt are available. Public npm docs deployed as `dpl_B4od4acDLtdFDyL4r29rC5y8yPWD`; [live docs](https://likerts.com/docs) verified. Search indexing and adoption are not established by availability. |
| Current documentation source and required CI | Source `95dc39786fbce8bdca761f4f8d6335b497fabed1`; [PR #16](https://github.com/crosstabs/likerts/pull/16); [required checks](https://github.com/crosstabs/likerts/actions/runs/34726436497) passed. These do not imply that every deployed service uses the same revision. |
| Engineering foundations | Existing checks cover tenant RLS/scopes, idempotency, shared admission across real API processes/Redis, export lease recovery, webhook privileges and local quarantined recovery. [Local recovery evidence](infrastructure/recovery/local-evidence.json) is not hosted Neon PITR evidence. |

The council performed a readiness review, not an exhaustive security audit. “Not verified” identifies missing evidence; it does not automatically mean the implementation is absent or broken.

## Live deployment inventory

Read-only provider checks on 2026-09-13 identify the current reference services below. A live provider deploy status is deployment evidence, not a completed fresh-user or recovery drill. Source changes after these commits are not presumed deployed there.

| Component | Provider deployment | Source / boundary |
| --- | --- | --- |
| API | Render `dep-daijk15g1s2s73fk5630` | `8588b67d26bb564417fc06db65c0093e5e49bf0e`; live, Singapore, two instances |
| MCP gateway | Render `dep-daijk15g1s2s73fk55vg` | Same `8588b67` source; live, Singapore |
| Callback worker | Render `dep-daijk13m8hqs73d4pla0` | Same `8588b67` source; live, Singapore |
| Website | Vercel `dpl_B4od4acDLtdFDyL4r29rC5y8yPWD` | `95dc397` checkout; production alias likerts.com and npm docs checked |

## Execution rules

- **P0:** required before broad public promotion, or before the explicitly named hosted capability.
- **P1:** planned public-launch deliverable; complete the L tasks for the tracked launch-readiness goal.
- **P2:** adoption/maturity work after the launch. Keep it visible without making launch depend on outside people.
- An unchecked task stays open until its acceptance evidence is linked. Preparing a script, starting CI, generating a draft or receiving a provider 200 is not necessarily completion.
- Reuse existing issues and tests. Do not close all contributor opportunities to manufacture a completed checklist. If taking an issue, link the implementation PR and satisfy its acceptance criteria.
- Keep credentials, respondent data and raw private operational logs out of public evidence. Record versions, aggregate outcomes and sanitized commands.
- Publish code/deployments within existing authorization. Prepare new third-party outreach for a concrete owner-approved destination; never infer permission to message people from this task list. Human authentication and destination authorship rules remain human tasks.

## Public-launch tasks — tracked goal scope

Owners are accountable roles; the coordinating agent records acceptance evidence and external dependencies. Implementation progress below does not close deployed or CI acceptance gates early.

| Status / ID | Priority / owner | Deliverable and acceptance evidence | Depends on |
| --- | --- | --- | --- |
| [x] L01 | P0 · CEO + engineering | Publish this consolidated plan and a dated release inventory. Link exact API/MCP/worker/web deployment identities, source, artifacts and checks; link older launch documents here and distinguish historical completion from current gaps. | — |
| [ ] L02 | P0 · DevRel + engineering | Reconcile active installation and operations docs. Fix false no-npm claims in `sdks/INSTALLATION.md`, stale downloads content, CONTRIBUTING README anchor, obsolete paid/AWS/CI-budget statements and lifecycle assertions. Verify served routes as well as source; preserve historical archives. | L01 |
| [ ] L03 | P0 · product + engineering | State hosted-preview scope consistently at `/app`, docs and remote MCP entry points: who operates it, intended use, actual data handling/deletion, known operational limits and support route. Identify missing owner facts explicitly; do not invent retention/backup promises. Keep self-host instructions clear and existing access changes deliberate. | L01, L02 |
| [ ] L04 | P1 · engineering + DevRel | Deliver a durable loopback-only Docker Compose developer environment using existing [#7](https://github.com/crosstabs/likerts/issues/7): PostgreSQL volume, migrations, restricted runtime role, startup/readiness and documented stop/reset. A response survives API restart; secrets stay out of tracked defaults. Clearly separate local development from production deployment. | L02 |
| [ ] L05 | P0 · DevRel + QA | Rehearse the exact anonymous newcomer path in a clean directory: released CLI/npm Web → create/publish → embed → accept → retrieve → identical retry → revoke. Record versions, prerequisites, transcript and cleanup. Fix undocumented steps; npm import checks alone do not close this. | L02, L04 |
| [ ] L06 | P1 · engineering | Automate the published first-response instructions in clean-checkout CI; reuse [#11](https://github.com/crosstabs/likerts/issues/11). No private `.tools`, maintainer credentials or prebuilt local outputs; fail on wrong count, duplicate acceptance or ineffective revocation. | L05 |
| [ ] L07 | P1 · MCP owner + DevRel | Test published npm stdio client recipes for Codex and Claude alongside the remote route: discovery, scoped survey lifecycle and denial with insufficient scopes. Add valid npm metadata to the official registry through an appropriate new immutable registry version; validate schema and package identity first. Account/client dependencies must be recorded. | L02, L05 |
| [ ] L08 | P1 · Web owner + DevRel | Ship one idiomatic Next.js host example using the published npm SDK; reuse [#4](https://github.com/crosstabs/likerts/issues/4). Management token stays server-side, collection token client-side; cleanup on unmount, error/retry handling and real receipt retrieval work. Leave Vue/Svelte as contributor opportunities. | L05 |
| [ ] L09 | P0 · QA | Verify the advertised launch path on desktop/mobile and keyboard: homepage CTAs, docs/copy actions, demo, real walkthrough and install links. Record relevant screenshots and failures. Reuse current evidence when unchanged; keep simulator/device and browser coverage boundaries explicit. | L02, L05, L08 |
| [ ] L10 | P1 · engineering + DevRel | Provide one linked self-host operations guide: local-to-durable setup, roles/secrets, migrations, HTTPS/origins, exports/webhooks, health, backup/recovery responsibilities, upgrades and compatible rollback. Validate documented setup; make unsupported hosted claims conditional on H gates. | L02, L04 |
| [ ] L11 | P1 · marketing + DevRel | Make the existing real collection recording and one-command walkthrough discoverable within one click of the main getting-started path. Clearly label the sample renderer. Assemble a compact launch kit with tested commands, versions, images, limitations and contribution links; no new redesign/video production prerequisite. | L05, L09 |
| [ ] L12 | P1 · CEO + DevRel | Prepare support/troubleshooting and security-intake playbooks using Issues/Discussions and private reporting. Cover auth, origins, schema compatibility, retries, supported versions and fix propagation across releases. Identify the human launch responder and availability as an explicit owner handoff; do not promise staffing/SLA that does not exist. | L03, L05 |
| [ ] L13 | P1 · marketing + DevRel | Create an adoption ledger with a dated baseline and definitions: downloads, opt-in external setup attempts, self-reported first response, setup friction, first reply and contributions. Record unknowns; npm downloads are not unique users. Never collect respondent answers to measure adoption. | L11, L12 |
| [ ] L14 | P0 · chief engineer + QA | Perform final go/no-go review of changed code/artifacts and the actual launch journey. Run required CI and focused checks; bump/publish only changed package/runtime releases, preserve historical assets, verify fresh installs and production pages. Record known limits and confirm no unresolved P0 for the advertised scope. | L01–L13 |
| [ ] L15 | P1 · CEO + marketing | Publish the final readiness record and update already-authorized GitHub release/announcement links. Prepare destination-specific outreach and founder handoffs with current rules, exact assets, named owner and pending/publication status. Record public URLs only after actual publication; external posting is not automatically authorized by a task row. | L14 |

Suggested execution sequence: L01–L03 first; L04–L08 for successful developer setup; L09–L13 for verification, documentation and launch support; L14–L15 for release and communication. Independent work can run in parallel with bounded delegated ownership.

## Hosted-service gates — required before expanding the preview claim

These are genuine outstanding work, kept separate from the self-hosted announcement. L03/L14 must disclose their status. The public-launch goal does not silently declare them complete or imply unrestricted hosted readiness.

| Status / ID | Gate / owner | Deliverable and acceptance evidence | Depends on |
| --- | --- | --- | --- |
| [ ] H01 | P0 before unrestricted signup · QA + backend | Fresh account → workspace → scoped credential → publish/collect/retry/read/export → revoke/delete, without maintainer setup. Use a separate tenant to verify denial across resource IDs, exports, memberships and credentials; record deployment identities and synthetic cleanup. User performs required account authentication. | L03 |
| [ ] H02 | P0 before hosted-data promises · backend + SRE | Reconcile actual lifecycle implementation and deploy scheduled bounded retention/export cleanup where absent. Prove backlog drains, expired objects are physically removed, retry/failure handling and alerts work. An explicit `/v1/retention` route is not a schedule. | L02, owner data-policy facts |
| [ ] H03 | P0 before production-data readiness · SRE + backend | Verify Neon backup/PITR window and access; deploy independent erasure archive/checkpoints with restricted credentials. Restore into quarantine, replay later deletions/revocations, quarantine callbacks/exports, check isolation and safe reopening. Measure results; do not claim the old seven-day/RDS assertions as verified. | H02, provider access |
| [ ] H04 | P0 before unrestricted hosted service · SRE + founder | Name primary/backup human responders; configure scheduled monitor and durable state; prove failure/recovery delivery and human acknowledgment, missing-run/failed-receiver detection and worker/DB/storage/journal checks. Existing status probes and rule tests do not establish active alerting. | Approved receiver and human owner |
| [ ] H05 | P0 before unrestricted traffic · backend + SRE | Verify Upstash plan/quota/region and shared admission configuration; measure bounded Singapore-to-Redis latency, provider exhaustion handling and alerts. Document capacity/cost and fairness limits. Reuse the implemented distributed limiter. Avoid unapproved spending or production load tests. | H04, workload/cost boundary |
| [ ] H06 | P1 before hosted recovery/callback claims · SRE + backend | Rehearse compatible Render rollback and bounded abrupt-instance/expired-lease/DNS drills in isolated resources. Prove export winning fence, callback recovery and denied-address handling; preserve sanitized evidence and restore only owned resources. Graceful restart tests do not establish these failure cases. | H03, H04, owned test resources |
| [ ] H07 | P0 final hosted decision · CEO + engineering | Reassess H01–H06, public data/support disclosures and measured capacity. Publish the exact supported hosted scope; keep unsupported claims out of onboarding. Unresolved account, policy or human-ownership decisions stay explicit. | H01–H06 |

Relevant starting evidence: [operations](infrastructure/OPERATIONS.md), [lifecycle contract](DATA-LIFECYCLE.md), [Render runbook](infrastructure/render/README.md), [failure drill](docs/operations/HOSTED-FAILURE-DRILL.md). Some contain stale text; L02 must reconcile them against current code and provider evidence.

## Publicity, account handoffs and post-launch adoption

| Status / ID | Priority / owner | Task and completion evidence |
| --- | --- | --- |
| [ ] A01 | P1 · founder + marketing | Show HN: founder supplies their own title/comment and login, chooses timing and is available for replies. Current HN rules prohibit AI-generated or AI-edited text. Preserve factual handoff; do not rewrite founder wording with AI or solicit votes. Completion is a real submission URL, not a draft. |
| [ ] A02 | P1 · marketing + DevRel | Select two relevant developer communities, verify their rules and affiliation requirements, prepare useful tailored introductions and obtain specific posting authorization. Capture publication URLs and resulting questions. No unsolicited direct messages or repetitive bulk posts. |
| [ ] A03 | P1 · SEO + domain owner | Verify Search Console property, submit existing sitemap and inspect home/docs/demo/API URLs using owner access. Record receipts and actual inspection results. Submission and search-query absence do not prove indexing or non-indexing. |
| [ ] A04 | P2 · DevRel + SDK owners | Develop Vue/Svelte integrations from [#5](https://github.com/crosstabs/likerts/issues/5)/[#6](https://github.com/crosstabs/likerts/issues/6) when contributors or real integrations warrant them. Close only against each issue's runnable acceptance criteria. |
| [ ] A05 | P2 · SDK + QA | Expand Firefox/WebKit keyboard and RTL checks using [#8](https://github.com/crosstabs/likerts/issues/8)/[#9](https://github.com/crosstabs/likerts/issues/9); add physical-device/offline-host evidence driven by real usage. Keep unsupported coverage explicit. |
| [ ] A06 | P2 · SDK/release owners | Improve native distribution: usable immutable remote Swift package path, Maven Central and pub.dev packages, each installed in a fresh host with required account/signing rights. Consider signed/notarized CLI, SBOM/provenance and additional architectures separately. Source-supported native SDKs already exist. |
| [ ] A07 | P2 · DevRel + marketing | Publish two tested implementation walkthroughs after choosing channels: embedded checkout feedback with metadata, and an agent-managed survey lifecycle. Add concrete integration knowledge rather than paraphrasing the landing page. |
| [ ] A08 | P2 · CEO + DevRel | Pursue 10 real external installations and three outside contributors; review friction and triage on the first, third and seventh days after announcement. These are targets, not invented results or finite goal completion conditions. Do not schedule notifications or contact people without the appropriate authorization. |

An appointed human responder, HN authorship/login, an approved alert receiver, provider account verification and specific outreach destinations are human/external dependencies. Build the concrete handoff first, ask only for the missing decision/action, and continue independent work. Do not ask for passwords, tokens or OTPs in chat.

## Goal completion and release evidence

The tracked goal is the public OSS launch-readiness milestone, L01–L15. It is complete when required deliverables are merged/deployed where applicable, reproducible acceptance evidence is recorded, the advertised scope has no unresolved P0, and human-only announcement/support handoffs are explicit and reviewable. H and A tasks remain open until actually completed; they are not automatically closed when this milestone is achieved.

A human handoff is preparation, not a claimed live support operation or posted announcement. If the advertised launch scope requires an unresolved human/provider action, keep that gate open rather than silently excluding it. No promise of Trending placement, search indexing, adoption, enterprise certification or hosted SLA is a completion criterion.

For every closed task, append a short evidence entry here: ID, date, source/deployment/package version, PR/check/test URL or sanitized artifact, result and remaining limits. The final launch record must distinguish this new work from the verified baseline above.

## Evidence log

- 2026-09-13: Three independent council reviews completed (DevRel, engineering, marketing). This task list is their consolidated work order. No new deployment, operational drill, outreach or adoption is claimed by creating the plan.

- 2026-09-13 — L01: Plan published through [PR #17](https://github.com/crosstabs/likerts/pull/17), merged as `41f1502ae5016abb9d2e21943d38fe15b5037e5a`; [required main checks](https://github.com/crosstabs/likerts/actions/runs/34727311857) passed. Live provider inventory above was read directly; prior launch records link here.
- 2026-09-13 — implementation review: durable Compose persistence and anonymous released-client collection lifecycle passed locally ([rehearsal and sanitized evidence](docs/verification/newcomer.md)). The published Web SDK also passed production-build Next.js browser checks for navigation cleanup, lost-reply retry with one stored response, server retrieval and credential boundaries ([example](examples/nextjs-feedback/README.md)). [Rendered launch-page checks](docs/verification/launch-pages.md) passed locally. Final-source CI and production deployment remain pending.
- 2026-09-13 — L07 progress: official registry schema and published npm identity validated; installed MCP `0.1.0` completed the scoped PostgreSQL lifecycle, denial and revocation tests. Codex CLI `0.154.0` returned without a verified tool completion; Claude Code `2.1.201` required authentication. These client probes are not recorded as successes. Registry `0.1.1` publication is pending protected merge and exact-source checks.
