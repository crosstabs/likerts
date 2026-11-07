# Likerts quiz creator and live games

## Creator and shared quiz candidate

Open `/play/quizzes` on the local server for the quiz library, question editor, JSON import/export and timed scored practice. Quizzes are saved in this browser's local storage; file exchange with the iOS candidate uses the same `likerts.quiz` version 1 document. A quiz has 1–30 questions, 2–4 choices, one correct answer, an optional explanation and a supported timer. Exported files contain the answer key and are intended for creators/hosts. There is no account, automatic library sync or public quiz catalogue.

Choose **Host live** from a saved or sample quiz. Hosting uploads a fixed validated copy; later library edits do not change that room. The observing host needs at least two joined players to start. Players join through `/play` or the matching native client. Invite links contain the room code, without a member credential or answer key. Quiz rooms use **public protocol 2**, `mode: "quiz"`, `modeVersion: 1`. Each player locks one zero-based choice; only that player sees their submission before reveal. The current answer key, explanation, submitted choices and points become shared at the server-owned reveal; future questions stay private. Correct answers earn 1,000 points; wrong or missing answers earn zero, without a speed bonus. The server controls deadlines, scoring and safe retries. The host can reveal early, advance, replay or close; an early-ended match is visibly incomplete. Returning home keeps a place; actual Leave revokes player access and host Close ends the room.

Run the pinned Node runtime and local-development server below, using a dedicated local SQLite path and no provider database environment. No external database or provider credential is needed for local play. The iOS app has the corresponding Quizzes flow; native live testing requires explicit Debug loopback flags, while Release live configuration remains unset. See the [shared live contract](../../M2-CONTRACT.md), [portable quiz contract](../../M1-CONTRACT.md) and [local launch preparation](../../LAUNCH-PREPARATION.md). This isolated design continuation needs its own final source-bound qualification; dated test counts below are not final results for this tree.

The separate `/play` create flow preserves mind-reading: a dedicated host, five-choice subject answers and player predictions, then a shared reveal. Its reviewed English catalogue contains 1,000 rounds. Existing rooms retain **public protocol 1**, catalogue binding and distance-based prediction scoring; quiz scoring does not replace them. Production's configured launch ceiling is 12 players; development can exercise up to 50. These resource bounds are not measured hosted capacity. Pocket Totems assets and native provenance are preserved in `shared/` and `web/assets/`; selected original cast art supports the quiz screens.

Both modes use **storage schema 3**. PostgreSQL transactions explicitly select READ COMMITTED. Older verification documents retain their dated measurements, counts and source hashes; use the final source-bound receipts for this design candidate when available rather than promoting an older store/source hash to a new release claim.

## Run locally

Use **Node 22.23.4**, as pinned in `.node-version`; the supported engine range is `>=22.23.4 <23`. Install and check the runtime from `live-game`:

```sh
npm ci --ignore-scripts
npm run check:runtime
```

For local development, choose a private SQLite file outside the checkout:

```sh
NODE_ENV=development \
LIKERTS_LIVE_SQLITE_PATH="$HOME/.likerts-live/rooms.sqlite" \
npm start
```

Open `http://127.0.0.1:4311/play`. The default development bind is loopback. SQLite is local development storage; production requires a separate dedicated PostgreSQL database. `.env.example` documents configuration and contains no supplied database credential. The executable does not automatically load that file.

```sh
npm test
```

PostgreSQL cases are opt-in. They require an explicitly authorized synthetic local fixture through `LIKERTS_LIVE_TEST_DATABASE_URL`; the tests reject unrelated targets. With that variable absent, those cases skip. No test database or credential is provisioned by these commands.

## Historical pre-quiz verification

The earlier Phase 3 sequential suite passed **266/266**, zero failures, cancellations or skips, on Node 22.23.4 with PostgreSQL 17.10 in the owned **RAM-backed tmpfs functional fixture**. Runtime/source inputs were unchanged through that historical run. Its separately delivered checkpoint contains `final-node-product-result.json`, exact TAP and READ COMMITTED red/green proof; its `START-HERE.md` maps those files. Those local evidence files are not part of this website repository. See [storage v3 design and validation](server/storage-v3.md). These are results for those inputs, not final quiz/design-pass test counts. RAM storage does not qualify physical durability or provider performance.

The earlier host-bind benchmark measured source aggregate **`9a935a9965a8c42eb85a2120e85f9144fdb9c7703287dd6d48c115d2c84ea88c`**, before the final isolation pin. Its source, measurements and resource conditions remain unchanged. Lower measured WAL/storage came with latency-tail and CPU regressions. The separate checkpoint retains single-room/two-worker analyses and a fixture comparison with those exact identities. They are not measurements of the final pinned source. The host-bind startup failure and separate RAM functional results remain distinct. [Repository-local batching notes](server/query-batching.md) retain their dated scope.

## Release boundaries

The following native/Safari journeys and cleanup limitations are historical pre-quiz records. They do not replace final qualification of the changed creator/shared-quiz design tree, and separate scopes must not be combined into a new pass total.

An actual native/browser crossplay case passed both roles, private-answer Home/resume, exact scores and Leave on this backend. A final-source actual Safari/Simulator gameplay case also passed both roles, same-tab Reload/Resume, exact standings and actual Leave (1 pass/0 fail/0 skip). Its game assertions are unchanged through Leave; browser-tab cleanup is a separate capability and remains unavailable in the observed Compact menu. Twelve known QA tabs were retained without entering the grid. Automatic initial header positioning and physical Safari remain unqualified. Native **Release Live remains unconfigured** until the service and remote-data policy are approved. The local test gate is not a hosted release or App Store approval.

Publishing needs the owner's approved dedicated Node/WebSocket service and PostgreSQL resources, verified HTTPS/WSS/TLS and proxy identity, migration/runtime privileges, monitoring and budgets, log/backup retention and restore handling, and truthful online-room privacy/support disclosures. The [operations guide](operations.md) and [deployment drafts](deployment/render.service.draft.yaml) remain proposals; the separate Phase 3 checkpoint includes the concrete owner approval bundle. No cloud resource, credential, domain change, paid deployment or Release endpoint activation is authorized by this source package.

Public hosting remains on hold because an enforceable all-in **US$20/month** cap including usage and applicable tax has not been established. Australia is the supplied billing country; exemption status is unknown. The user's existing approval up to that budget and for a dedicated database login does not establish a capped quote or hosted qualification. Physical-device, real-signing/distribution, actual VoiceOver and App Store qualification remain separate from local browser/Simulator evidence. Operations/server notes now distinguish both modes and retain historical measurements; deployment drafts remain proposals subject to the concrete gates in [launch preparation](../../LAUNCH-PREPARATION.md), not instructions to provision or deploy.
