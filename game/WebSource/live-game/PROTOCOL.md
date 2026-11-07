# Likerts Live protocol v1

## Current dual-mode scope

The detailed catalogue/subject/prediction rules below are the preserved **mind-reading v1** contract. Implemented creator quiz rooms use **protocolVersion 2**, `mode: "quiz"`, `modeVersion: 1`, defined by the [M2 contract](../../M2-CONTRACT.md) and `server/quiz-protocol.schema.json`. They share admission, scoped credentials, HTTP commands, WebSocket delivery, recovery and terminal cleanup infrastructure; their question, action and scoring shapes are distinct. Do not apply v1's no-upload, five-choice, pause/skip or no-early-reveal rules to quizzes.

Quiz creation adds `{mode:"quiz",modeVersion:1,quiz:<validated likerts.quiz v1 document>,settings:{capacity}}` to the admission envelope. The server freezes that snapshot. Its 69,632-byte creation allowance carries at most 65,536 normalized document bytes; ordinary/default body and frame bounds remain 8,192 and 4,096 bytes. Quiz state contains safe quiz metadata and only the current question/options; before reveal it omits keys, explanations, future questions and others' submissions for every recipient, including host. `quiz-answer` uses a zero-based option; host `quiz-reveal` requires current `roundId`. Correct earns 1,000, wrong/missing zero, with server-owned inclusive deadlines and no speed bonus. Host end/leave/kick aborts the current unfinished round without disclosing its key or scoring it.

Native quiz admission recovery deliberately retains the exact bounded creator upload in protected device-only pending storage until resolved; browser pending admission uses session storage. This creator copy contains its answer key, unlike a player projection. Separate admission tombstones can remain after active room Close until their expiry. Release live configuration remains unset; this local source and its resource ceilings are not public deployment or hosted-capacity qualification. See [launch preparation](../../LAUNCH-PREPARATION.md).

## Mind-reading v1 contract

This local implementation is isolated from survey data, auth and routes. JSON is UTF-8; integers are safe integers. HTTP base /api/live, browser entry /play. API errors are `{error:{code,message}}` with no internal stack/state. Production requires HTTPS/WSS and exact Origin allowlists. No credentials in URLs/cookies/logs. Invite `/play?room=ABCDEF` contains only a random six-character human-friendly admission locator, never an offline LK code or answer.

## Admission and state

`GET /catalogue` returns public picker metadata `{version:1,sha256,locale:"en",topics:[{id,title}],limits?:{maxPlayers,defaultCapacity}}`, never the full question catalogue. Clients tolerate the optional limits field. Production launch has a fixed maximum of12 players per room and default capacity12; room settings can choose2–12. The engine's development ceiling remains50. Development services may expose a lower configured maximum/default; capacity above the service maximum is rejected with `capacity_unavailable`.

`GET /health` returns cached aggregate readiness (200 ready;503 failed or stale), including `checkedAt` and a bounded room count or null. A single-flight background store probe refreshes it; each anonymous request performs no database query. `GET /liveness` is process liveness only and performs no database work. Both have a local response-rate bound. These endpoints do not prove every journey, provider failover, backups or production capacity.

`POST /rooms` body `{admissionId:UUID,recoverySecret:base64url32Bytes,settings:{topic:"mix"|canonicalTopic,cycles:1|2|3,capacity:2..50,answerSeconds:0|30|60|120,predictSeconds:0|30|60|120}}`; defaults mix/1/12/60/60. Returns201 `{code,token,memberId:"host",state}`. Host is a dedicated controller, not a player. Zero seconds is untimed.

`POST /rooms/:code/join` body `{admissionId:UUID,recoverySecret:base64url32Bytes,nickname,acceptRoomSharing:true}` returns201 `{code,token,memberId,state}`. Nicknames are trimmed/NFKC,1–20 Unicode characters, bounded letters/numbers/marks/spaces/apostrophes/dash/underscore, no controls/bidi/HTML; unique case-insensitively. No joined roster lookup without a scoped token. Join only in an unlocked lobby; the match roster freezes at Start. Returning participants resume via token, never via nickname. Room code is not authorization. Each host/player gets an independent32-byte cryptographically random token; store only one-way token verifier.

`GET /rooms/:code` with `Authorization: Bearer <token>` returns `{state}` containing the projected state. `POST /rooms/:code/actions` with bearer and `{requestId:UUID,matchId,roundId?,action,...}` returns `{state}`. `matchId` is mandatory on all actions; roundId mandatory on answer/guess/next/pause/resume/skip. Identical request retries are idempotent; same ID/different payload conflicts. Do not require a matching whole-room revision for simultaneous independent player locks. Bind every submission to the exact match/round and phase. Host transitions may accept optional expectedRevision and must reject it if provided and stale.

Actions: host `start`, `next`, `pause`, `resume`, `skip`, `lock` with `{locked}`, `kick` with `{playerId}`, `end`, `rematch`, `close`; player `answer` or `guess` with `{value:1..5}`, `leave`; either role `heartbeat`. `close` erases active room and revokes sockets. `leave`/kick during a running match finishes it **incomplete**, hides the unfinished round's secret and produces provisional results; no winner claim. In lobby, removal simply removes member; removed tokens are revoked immediately, including existing sockets. Rematch restores remaining members to lobby, resets scores, increments matchId and avoids presented questions until catalogue exhaustion. Existing idempotency safety must survive rematch.

State allowlist (no raw room object):
```
{protocolVersion:1,code,matchId,revision,serverTime,expiresAt,catalogVersion:1,catalogHash,
 role:"host"|"player",self:{id,nickname},phase:"lobby"|"answer"|"predict"|"reveal"|"finished",
 joinLocked,settings:{...},hostConnected,players:[{id,nickname,avatar:1..5,connected}],
 round:null|{id,index,total,subjectId,subjectName,prompt:{id,text,topic,sceneSummary},
   deadline:null|epochMilliseconds,paused,answerLocked,submittedCount,eligibleCount,
   ownAnswer:null|1..5,ownGuess:null|1..5},
 reveal:null|{answer:null|1..5,valid:boolean,reason,guesses:[{playerId,nickname,value:null|1..5,points}],groupAccuracy:null|number},
 leaderboard:[{playerId,nickname,points,opportunities,accuracy:null|number,rank:null|integer}],
 completion:null|"complete"|"incomplete",notice:null|string}
```
`self.id` is host or player UUID. `self.nickname` host label may be "Host". Round indices1-based, total fixed at Start. Roster order and subject rotation are server-randomized once per match. Prompt values are canonical exact catalogue strings, selected by server ID without replacement. No client-submitted questions/AI. Pin catalogue hash for match.

**Before reveal:** host and other guests never receive subject answer, other guesses, scores/distances derived from current secrets, raw internal history or future question order. Subject may receive only their ownAnswer; a predictor only their ownGuess. Both keys null for other recipients. `answerLocked` and counts can be public; these must not depend on answer value. Projections of two different private answers must be identical for unrelated viewers. Reveal contains only the completed current round; no secret on skipped/incomplete round.

## Ambiguous admission recovery

Create/join require a client-generated UUID admissionId and32-byte cryptographically random recoverySecret (base64url). Persist only digests/request fingerprint and membership mapping atomically with room/player creation. Same ID and identical payload never duplicate enrollment/rooms; conflicting ID payload409. Do not cache plaintext capability responses. In v1, client pending admission recovery material uses sessionStorage (web) or device-only Keychain (iOS), for10min, without submitted answers/guesses. Quiz creator-upload recovery is the explicit separate case above.

`POST /admissions/recover` with `{admissionId,recoverySecret}` verifies pending mapping and atomically issues a fresh scoped token (revoking old token and sockets), then returns `{code,token,memberId,state}`. Ten-minute recovery window, bounded request rate, separate ID tombstone expiry up to six hours. Recovery cannot resurrect removed/expired members/rooms or extend TTL. Clients recover after ambiguous response loss instead of blindly creating another room/player. On success clear pending admission; keep only normal scoped resume credential. Close returns `{state:null,closed:true}`, leave returns `{state:null,left:true}`; clients clear local resume material and sockets.

## Rules

Lobby requires2+ players. All registered match players get one subject turn per cycle. Subject first locks a private1–5 answer; others then guess privately. Locked values are immutable. Server reveals/scorers exactly once after all eligible guests lock, or prediction deadline expires. Exact100; each step away costs25; missing prediction0. Subject receives no competitive points. Leaderboard shows prediction average accuracy with opportunities (misses count); ties share rank1,1,3, no speed tiebreak. In a fully completed fixed-roster cycle everyone has equal opportunities. Skipped/subject-timeout rounds are unscored and final completion is incomplete/provisional. Host cannot force early scored reveal. `next` only after reveal; last next finishes. Host can end early (incomplete), rematch or close. Explicit pause stops deadline; resume restores remaining duration. Untimed mode remains useful without a timer.

Disconnect preserves identity/locks/scores; no implicit leave. Host loss leaves current round governed by deadlines, then players wait for host recovery; no unapproved host takeover. Presence is a short-lived lease, not room authority. Reconnect always fetches current revision, even on another worker/restart. Clients retry commands with the original requestId and do not optimistically reveal/score.

## Transport and resources

WebSocket `/api/live/socket`, authenticate within5s with `{type:"authenticate",code,token}`; no secret query parameter. Server sends `{type:"state",state}` or `{type:"error",error:{code,message}}`; optional client `{type:"refresh"}`. Commands stay HTTP for identical web/iOS retry semantics. Backoff+jitter reconnect; HTTP snapshot fallback must have identical projection. Server heartbeat/ping and backpressure limits; revoke/expiry closes subscriptions. Cross-worker notifications contain code+revision only, never secrets, and recipients reload/project authoritative state. SQLite adapter is single-machine development; PostgreSQL adapter uses row transactions/locks and notifications. No production in-memory store fallback.

Production launch defaults permit26 durable socket leases per room: two for each of twelve players and the dedicated host. A replaced worker's leases may persist for45 seconds, so all thirteen members can reconnect before the old leases expire. The per-member ceiling stays two; an excess duplicate is rejected without clearing another member's lease. The64-socket per-process ceiling is separate. Reducing the configurable room ceiling reduces available reconnect overlap.

Hard room life6h; idle expiry2h; finished rooms15min. Explicit close deletes active state. Cleanup is bounded and expiry is enforced on reads/actions even if scheduler has not run. Persistence/backup/log erasure limits remain deployment decisions; no public all-copy erasure promise. Create/join/action/connection admission and frame/body/rate/room/socket ceilings are required, with shared-Wi-Fi-friendly room join allowance. Logs never contain names/answers/guesses/tokens/full links; health exposes aggregate readiness only. Dedicated LIKERTS_LIVE_DATABASE_URL, not the survey DATABASE_URL. Public deployment remains gated.
