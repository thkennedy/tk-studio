---
title: 'The Studio Chat'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_revision: 'c9f5132abec7aa18a8c52279abc3dadb6884a723'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-39/plans/39-3.md'
  - '{project-root}/_bmad-output/planning-artifacts/design/studio-design-spec-2026-11-07-front-end/README.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The owner can talk to one engagement in the page (`/app/chat/<id>`), but not to the studio itself, so he still gives the studio its instructions through the Claude Code app (addendum §0, §2, §3.8; AD-11).

**Approach:** A shipped one-shot `studio-chat` job runs the orchestrator core headless per owner line; `POST /chat` / `GET /chat` (JSON and SSE with `chat-delta` frames tapped from the worker's stream-json stdout) carry the conversation; a `StudioChatScreen` at `/app/chat` shows the streaming reply and turns each proposal into a button that sends a request the supervisor already knows; a lib test proves terminal and page resolve identically.

### Acceptance criteria (verbatim, epics.md "### Story 39.3: The Studio Chat")

AC1. **Given** the shipped jobs in `plugins/tk-studio/jobs/` and the `engagement-chat` pattern (`apps/supervisor/src/chat.ts`, `plugins/tk-studio/lib/engage.py reply`) **When** Story 39.3 lands **Then** a shipped one-shot job `studio-chat` exists (planner tier, host, `claude -p` with the plugin, `--output-format stream-json`): its session runs the `tk-studio-orchestrator` core headless (`orchestrate.py resolve` for the owner's role and working set; the council shell loaded as presentation and never a routing input), reads the owner's line and the chat so far from `_bmad-output/tracking/studio-chat.jsonl`, answers questions of state from the same reads the pages use (`GET /board`, `GET /runs/{id}`, `GET /office`, the ledger, the queue) and writes one reply record with `proposals[]` whose kinds are `queue {project, job}`, `answer {id, letter, note}`, `open {route}`, `engagement {title}`, `stop-after-story`, `open-studio` (the last two land in 39.7 and are refused by name until then); the job's `.json` names its description, the tier and `stop {max_runs: 1}`; `job.py validate` resolves it.

AC2. **Given** the supervisor API (`api.ts`) and the chat SSE of Story 32.7 **When** the owner posts a line **Then** `POST /chat {project, text}` (cookie + CSRF, or bearer) appends the line to `studio-chat.jsonl`, queues one `studio-chat` run (a second line while one runs queues behind it and the answer says so: "Queued behind the reply to '…'"), records a `chat-queued` service event and answers `{run_id, seq}`; `GET /chat?project=` returns the lines and replies as JSON, or, with `Accept: text/event-stream`, the same `event: chat` frames as the engagement chat plus `event: chat-delta` frames carrying the reply text as the session produces it (the worker tails the session's stream-json stdout; the delta carries text only); the record on disk is the whole reply once the run ends; the contract names both routes (0.1.35, additive); `api.test.ts` covers the post, the queueing, the delta frame and the refusal of a line over 4,000 characters by name.

AC3. **Given** the Chat screen (`apps/studio-web/src/chat/*`) **When** `/app/chat` is opened **Then** it shows the studio conversation (the engagement chats stay at `/app/chat/<id>`), the owner's line, the streaming reply with a cursor, the pending label "Waiting for the planner's reply (about a minute)" with the queue position when queued behind another, and each proposal as a button whose press sends the typed request the supervisor already knows (`POST /jobs` for `queue`, `POST /inbox/{key}/reply` for `answer`, navigation for `open`, `POST /engagements` for `engagement`); a pressed proposal is recorded as the owner's line "pressed: …"; `src/chat/model.test.ts` pins the delta assembly and the proposal mapping; `apps/studio-web/README.md` records the story.

AC4. **Given** the attended orchestrator in a terminal and the same words typed in the page **When** both resolve **Then** the routing payload (`orchestrate.py resolve`) is identical (AD-11), pinned by a test in `plugins/tk-studio/lib/tests` that runs the resolve through the job's entry and through the skill's documented command and compares the JSON.

## Boundaries & Constraints

**Always:**
- The plan `plans/39-3.md` "Settled shape" 1–15 is the binding design (SPEC.md design notes CAP-8..CAP-11 record the same rulings). Implement each shape as written there; the plan's Files list (28 files) is the boundary.
- `studio-chat.json` ships `stop {until: 9999-12-31T23:59:59Z}`, not `max_runs: 1` (plan correction 1, SPEC design note "CAP-8 — studio-chat.json"); AC1 is recorded `met-with-deviation`, naming `jobrun.py evaluate_stop`.
- The cookie's `POST /jobs` is admitted only proposal-bound with CSRF (shape 11); without `proposal` it stays 401, so `auth.test.ts` and `account.test.ts` pins hold unchanged.
- Gate replan (39-1, 2026-11-09): `App.tsx` mounts `StudioChatScreen` at `/app/chat` (`route.name === "chat"`) in place of both the `PLACEHOLDER.chat` strip and the `ChatScreen` there. `ChatScreen`, `engagementRefFor` (fallback order unchanged), `chatOpenState`, `chatProjectCheck` and `navActive` stay as they are, serving `/app/chat/<id>` (`route.name === "engagement"`). Navigate only through 39.1's `router.navigate` (`go`/`routePath` in `App.tsx`); pass a navigate callback into `StudioChatScreen` for the `open` press.
- Two `screen.test.ts` pins flip, named here: (a) the `PLACEHOLDER` pin "the placeholders name the story that builds each screen" no longer lists `chat` (remove `chat` from `PLACEHOLDER` in `screen.ts`; keep `settings: "Not built yet: Story 39.8"` and the others); (b) the `chatOpenState` pin whose title ends "/app/chat opens none" is retitled and commented so its null case reads as "no engagement ref keeps the project and opens none" (`/app/chat` now mounts the studio chat, not `ChatScreen`); `chatOpenState`'s body is unchanged.
- Python: stdlib only, run via `uv run`; every text open names `encoding="utf-8"`; `sys.stdout.reconfigure(encoding="utf-8")`; atomic writes; every CLI ends with the AD-11 status block. TS paths on the host are `join`ed, never VM paths; every `bun test` names `--timeout`.
- The contract grows additively under `**0.1.35**` (shape 14), with `test_0_1_35_story_39_3_the_studio_chat`; 39.2's test is re-bounded at 39.3's clause/paragraph (local, score 1).

**Block If:**
- The installed `claude` refuses `-p --output-format stream-json --verbose --include-partial-messages`, or the result line is not the last JSON object of its stdout (never fall back to `json` silently).
- A change to `orchestrate.py`, the orchestrator `SKILL.md`, `council/*` or `engage.py`'s existing verbs appears necessary (AD-4: invoked as installed).
- 39.1's router exposes no navigate helper for the `open` press (it does today: `router.navigate`).
- The Files list must grow beyond the plan's 28 files.

**Never:**
- No second router; no refactor of `chat.ts`, `ChatScreen.tsx`, `engage.py` existing verbs, or the engagement SSE handler (`studioChatSse` is a fourth handler, never factored with `sse()`/`officeSse()`/`chatSse()`).
- Never widen the cookie beyond a recorded, matching `queue` proposal; a cookie press never sets `tier`, `model`, `effort`, `base_ref` or `editor_in_the_loop`.
- The session holds no bearer and no CSRF token and moves no state; `stop-after-story` and `open-studio` are refused by name (`ProposalNotYet`) until 39.7.
- No push, tag, PR, or release motion; no edits to epics.md, plan files, stories.yaml, routing/policy toml, or `supervision/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| First line | `POST /chat {project, text:"what is running"}` | line appended (seq n), run minted host/planner leg/stacked on `<checkout>#studio-chat`, reads file written, `chat-queued {chat:"studio",…}`; `200 {ok, project, seq, run_id, behind:null, note:null}` | failed mint/event → line + reads removed, `500 ChatQueueFailed` |
| Second line while first pending | another `POST /chat` | `behind {seq, run_id}`, `note "Queued behind the reply to '<excerpt ≤40 cps…>'"` | — |
| Line too long | 4,001 code points (4,000 accepted) | — | `400 LineTooLong {limit:4000, length}` |
| Cookie without CSRF | `POST /chat` with cookie only | — | `403 CsrfRefused` |
| Press | `POST /chat {project, pressed:{seq,index}}` | press line `pressed: <label>`, `run_id:null` | `404 UnknownProposal`; `409 ProposalNotYet {kind}` for 39.7 kinds |
| Press, `queue` (consult note, review pass 3) | `POST /chat {project, pressed:{seq,index}}` for a `queue` proposal | the press line comes from the cookie `POST /jobs` row (written under `studio-chat.lock` before the submit, marked `unqueued: true` in place (seq kept) on a non-2xx or thrown submit); the web posts no press line for `queue` | `409 ProposalAlreadyPressed` once the gate has recorded it; `409 ProposalViaJobs` for a `queue` proposal not yet pressed (consult note, review pass 4) |
| Cookie `POST /jobs` | with matching `proposal {chat, seq, index}` + CSRF | `postJobs({project, job})` runs | mismatch/extra field → `403 ProposalRefused`; no `proposal` → `401` |
| SSE | `GET /chat?project=` `Accept: text/event-stream`, a running run with a stream file | `retry: 5000`, `event: chat` frames, `event: chat-delta {run_id, reply_to, from, text}` (no `id:`), none once reply landed | malformed web delta ignored |
| Reply write | `studiochat.py reply` | reply `{seq, at, author:"planner", body, run_id, reply_to, proposals[]}` | `AlreadyAnswered`, `ProposalInvalid: <i>: <why>`, `ProposalNotYet: <kind> lands in Story 39.7`, `BodyEmpty`, `BodyTooLarge`, `UnknownLine`, `ChatBusy` |
| Run fails | terminal run, no reply naming run_id | studio-chat pass appends one failure reply (`failed: true`), removes stream + reads files | idempotent |
| Context on missing chat | `studiochat.py context --seq 1` empty sandbox | status block `blocked` `UnknownLine` (conformance drive) | — |

</intent-contract>

## Code Map

The investigation is `plans/39-3.md` "## Code Map" (anchors re-read at `81e07286`) plus its "## Refresh — 39-2 gate" (current anchors after 39.2). Re-grep every anchor by text. Key points:

- `apps/supervisor/src/chat.ts` -- the engagement-chat pattern (record, lock, `mintChatTurn`, `chatSpendPass`); import `takeOverStale` only, do not refactor.
- `apps/supervisor/src/api.ts` -- `route()` (`path === "/chat"` before the `/chat/{id}` match), `cookieRoute` (~:1189; read list adds `/chat`, CSRF POST list adds `/chat` beside `/sandbox/login/*`; shape 11's `POST /jobs` gate kept separate), `postJobs`, `chatSse` (frame pattern), `board`/`inbox`/`officeSnapshot`/`queue.runs()` for the reads file.
- `apps/supervisor/src/queue.ts` -- `ENGAGEMENT_CHAT_JOB`, `LIVE_INDEX`/`widenLiveIndex`, `enqueue` `stack`, `claim`.
- `apps/supervisor/src/server.ts` -- `runProcess` stdout (tap seam), `buildWorkerCommand` `--output-format json`, `lastJsonObject`/`parseWorkerResult` (unchanged; NDJSON's last object is the result), `invokeSkill`/`runClaude`.
- `apps/supervisor/src/cli.ts` -- `chatDeps` (model for `studioChatDeps`), `chatSpendQuietly` finally sites, `recordedRefusal` (~:1451; guard on `run.job_id === STUDIO_CHAT_JOB` so sandbox-login refusals of sbx runs still record), `payloadRunId`, the invoke call.
- `apps/supervisor/src/resolution.ts` (`PAYLOAD_JOBS`, `withStoredPayload`), `hygiene.ts` (`notifyEnd`; leave `sandboxLoginPass` alone).
- `plugins/tk-studio/lib/engage.py` -- import `Refused`, `_take_over_stale`, `atomic_write_text`, `BODY_MAX_BYTES`, `LABEL_MAX`; no edits. `orchestrate.py` `resolve`/`load_shell` -- call, never edit. `tests/test_orchestrate.py:60-82` -- hermetic fixture. `tests/test_job.py` engagement-chat test -- mirror. `job.py validate --file`.
- `plugins/tk-studio/contracts/driver-contract.md` -- header `**0.1.35**` cell ending in 39.2's clause; `**0.1.35 (Story 39.2, additive).**` paragraph before `## 8. Conformance`; §2 engagement chat rows; `tk-studio-engage` row; §4 `engagement-chat` bullet. `tests/test_driver_contract.py` 39.2 test (re-bound).
- `apps/studio-web/src/App.tsx:81-89` -- the `chat || engagement` branch with the `PLACEHOLDER.chat` strip (replace per Always); `go`/`router.navigate` :48. `src/screen.ts:30-35` `PLACEHOLDER`; `src/screen.test.ts:133-141` (PLACEHOLDER pin) and `:329-333` (chatOpenState pin).
- `apps/studio-web/src/chat/model.ts` (`postEngagement`, `postChat`, `mergeLines`), `stream.ts` (`isLine`, `openChatStream`, `chatUrl`), `issue/model.ts` `postReply`, `inbox/model.ts` `csrfOf`, `office/model.ts` `projectsFrom`/`fetchAgents`/`rememberedProject`.

## Tasks & Acceptance

**Execution:** (the plan's Files list, in its order (i) lib → (ii) supervisor → (iii) web; each item's content is the named shape)
- `plugins/tk-studio/jobs/studio-chat.json` -- create (shape 1) -- AC1.
- `plugins/tk-studio/lib/studiochat.py` -- create `context`/`reply` (shapes 2, 3, 8) -- AC1, AC4.
- `plugins/tk-studio/lib/tests/test_studiochat.py` -- create (record/lock, proposals and refusals, `AlreadyAnswered`, voice, `UnknownLine`, dry run, `TerminalAndPageResolveAlike` per shape 15) -- AC1, AC4.
- `plugins/tk-studio/lib/tests/test_job.py` -- add `test_studio_chat_ships_as_a_one_shot_host_engage_job` -- AC1.
- `plugins/tk-studio/skills/tk-studio-engage/SKILL.md` -- `studio-reply` section, Rules line, description (≤ 1,024 chars) -- AC1.
- `plugins/tk-studio/contracts/conformance/manifest.json` -- one `blocked-on-ambiguity` drive (`UnknownLine`) -- AC1.
- `plugins/tk-studio/contracts/driver-contract.md` + `lib/tests/test_driver_contract.py` -- shape 14 and its test; 39.2 test re-bound -- AC2.
- `apps/supervisor/src/studiochat.ts` (new), `api.ts`, `queue.ts`, `server.ts`, `cli.ts`, `resolution.ts`, `hygiene.ts` -- shapes 5, 6, 7, 9, 11, 12 -- AC2, AC3 (press gate).
- `apps/supervisor/test/studiochat.test.ts` (new), `test/api.test.ts` (`describe("Story 39.3: the studio chat (contract 0.1.35 additive)")`), `test/queue.test.ts` -- plan Files 16–18 -- AC2.
- `apps/supervisor/README.md` -- route rows and the pass bullet -- AC2.
- `apps/studio-web/src/chat/model.ts`, `model.test.ts`, `stream.ts`, `stream.test.ts`, `StudioChatScreen.tsx` (new) -- shapes 4, 6 (web assembly), 10, 13 -- AC3.
- `apps/studio-web/src/App.tsx`, `src/screen.ts`, `src/screen.test.ts` -- the gate replan mount and the two named pin flips -- AC3.
- `apps/studio-web/README.md` -- `## The studio chat (Story 39.3)` after `## The Chat screen (Story 32.7)` -- AC3.

**Acceptance Criteria:**
- Given the repo after the story, when `uv run python job.py validate --file ../jobs/studio-chat.json` runs in `plugins/tk-studio/lib`, then it answers `ok: true` and `test_job.py` pins one-shot, host, `tk-studio-engage`/`studio-reply`, guards and `stop == {"until": …}`.
- Given the lib suite, when `tests.test_studiochat` runs, then each proposal kind validates, both 39.7 kinds are refused `ProposalNotYet` by name, and `TerminalAndPageResolveAlike` shows `json.loads(terminal) == context["routing"]` for ready, needs-onboarding, and council versus plain.
- Given `api.test.ts`, when the 39.3 describe runs, then it covers the post, the queueing note, the `chat-delta` frame, `LineTooLong` at 4,001 code points, the cookie/CSRF/bearer cases, the press, and the proposal-bound cookie `POST /jobs` gate.
- Given `apps/studio-web`, when vitest runs, then `model.test.ts` pins `applyDelta`, `proposalAction` for every kind, `pendingLabel` at positions 1 and 3, and `screen.test.ts` carries both flipped pins; `/app/chat` renders `StudioChatScreen`, `/app/chat/<id>` renders `ChatScreen`.
- Given the contract, when `runner.py run` and `test_driver_contract.py` run, then `ok: true` and the 39.3 paragraph's subheads and phrases are pinned.

## Spec Change Log

## Review Triage Log

### 2026-11-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 2, low 3)
- defer: 0
- reject: 1 (low 1) — `studioChatPass` and each SSE tick rescan every `chat-queued` event: efficiency only, the engagement chat's existing pass pattern, no criterion or contract rule affected.
- addressed_findings:
  - `[medium]` `[patch]` a recorded `queue` proposal could be submitted by the cookie without limit — `api.ts` refuses an already-pressed proposal (`403 ProposalRefused`) and a duplicate press (`409 ProposalAlreadyPressed`); contract §2 row, 0.1.35 paragraph, its test pin and the supervisor README name both; api tests added (both layers).
  - `[medium]` `[patch]` web: a 2xx request whose press line then failed left the button live, so a second press repeated the request — `press` returns `sent`, the screen disables that proposal and shows the error; pinned in `model.test.ts`.
  - `[low]` `[patch]` a failed first `GET /chat` was never retried — the screen retries on wake while `readError` is set and no read has succeeded.
  - `[low]` `[patch]` `tk-studio-engage` SKILL step 3 said the reply is the session's last text, contradicting the record write and the closing status block — reworded (AD-11).
  - `[low]` `[patch]` `studiochat.py reply` crashed with a traceback on a non-string `kind` — refused `ProposalInvalid`; tests added.

### 2026-11-10 — Review pass (follow-up, review_loop_iteration 0)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 2, low 2)
- defer: 0
- reject: 1 (low 1) — an owner line whose mint and drop both fail stays pending: a double failure already named in the `500 ChatQueueFailed` detail; no criterion or contract rule changed.
- addressed_findings:
  - `[medium]` `[patch]` one press per `queue` proposal held only on the client (a reload after a failed press line, or two tabs, submitted the job twice) — the cookie `POST /jobs` gate records the press line under `studio-chat.lock` before the submit and drops it on a non-2xx; `503 ChatBusy` when held; the web posts no press line for `queue`, `answer`/`engagement` `sent` persists in `sessionStorage`; contract, README and api/model tests updated (both layers).
  - `[medium]` `[patch]` an `answer` note could carry `DW-n: X` / `all: X` / `default` lines that `parse_answers` records — `_check_fields` refuses them (`ProposalInvalid`), `answerBody` drops them; contract text, `test_studiochat.py` and `model.test.ts` pin it.
  - `[low]` `[patch]` the shared `readError` let the agents read hide a failed chat read and stop the wake retry — split into `agentsError`/`chatError`; retry keyed on `!chatLoaded`.
  - `[low]` `[patch]` a project switch during an in-flight send/press landed the note/`sent` state on the new project — the project is captured before the await and those writes skipped on a mismatch.

### 2026-11-10 — Review pass (follow-up 2, review_loop_iteration 0)
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 2, low 3)
- defer: 0
- reject: 2 (low 2) — `studioChatPass` waits on `studio-chat.lock` synchronously (`withStudioLock`): in serve the route's lock section is synchronous, so only another process or a crash leftover can hold it, the same as the engagement chat's `withChatLock`; the quiet-lane-wait test skips without `TK_STUDIO_ROOT`: the repo's drained-test pattern (`drain.test.ts`, `registry.test.ts`), and `tools/verify_host.py` sets `TK_STUDIO_ROOT`, so the host leg runs it.
- addressed_findings:
  - `[medium]` `[patch]` `POST /chat {pressed}` for a `queue` proposal wrote a press line with no submit, after which the cookie `POST /jobs` gate refused that proposal forever — refused by name `409 ProposalViaJobs` (after the `ProposalAlreadyPressed` check), nothing written; contract §2 row, 39.3 text, README, pins and api tests (both layers).
  - `[medium]` `[patch]` the gate's rollback deleted a press line SSE may already have streamed, so the next append reused its seq and open pages skipped the real line (maybe the planner's reply) — the line is now marked `unqueued: true` in place (`markUnqueuedHeld`), seq never reused; `pressLine` and web `pressedKeys` ignore a marked line, so the proposal can be pressed again; contract, README, pins, api/studiochat/model tests (edge-case-hunter).
  - `[low]` `[patch]` a stream frame arriving before the next render merged into a stale `linesRef` and could wipe the history — `linesRef.current = ans.lines` set before the stream opens (blind-hunter).
  - `[low]` `[patch]` `studioChatPass` re-read the whole chat for every terminal studio turn ever queued — each root read once per pass, the cache updated after an append (blind-hunter).
  - `[low]` `[patch]` a resumed studio-chat worker got a fresh tap that overwrote the stream file with shorter text, so the SSE sliced it from a stale offset — one tap per run (closed once after the loop); the SSE resends `from: 0` when the stream text shrinks; studiochat and api tests (edge-case-hunter).

## Design Notes

- Planned deviations from the AC text (each a planner ruling recorded in SPEC.md; the session records them as DRIFT lines at the end): `stop {until}` instead of `stop {max_runs: 1}` (AC1); `answer` gains `issue` (additive: the reply route's `{key}` needs it); the cookie gains a proposal-bound `POST /jobs` (design spec 2026-10-09 §8 narrowed, not an AD); 39.2's contract test re-bounded (local).
- Sandbox: `bun run verify` hit EPERM at `bun install` on 39.1/39.2. Run its steps directly (`tsc --noEmit`, `vite build`, `vitest run`); the host leg (`tools/verify_host.py`) is the proof. If `bun`/`claude` are unavailable in the sandbox, record the exact commands as unverifiable-here.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- `cd plugins/tk-studio/lib && uv run python job.py validate --file ../jobs/studio-chat.json` -- expected: `ok: true`.
- `cd apps/supervisor && bun test --timeout 30000 && bun x tsc --noEmit` -- expected: green.
- `cd apps/studio-web && bun run verify` (or its steps directly) -- expected: green.

**Manual checks (unverifiable-here, operator):** restart the supervisor through the scheduled task after the merge; `curl` `POST /chat` and `GET /chat` SSE per plan "Verify" steps 1–5; open `/app/chat` on desktop and iPad; time the first turn against "about a minute".

## Deviation Summary

- DRIFT (planned, AC1): `studio-chat.json` ships `stop {until: 9999-12-31T23:59:59Z}`, not `stop {max_runs: 1}` — `jobrun.py evaluate_stop` counts every run of the job, so `max_runs: 1` would refuse every line after the first. AC1 is `met-with-deviation`.
- DRIFT (planned, AC1/AC3): the `answer` proposal gains `issue` (additive: `POST /inbox/{key}/reply` needs the key).
- DRIFT (planned, AC3): the cookie gains a proposal-bound `POST /jobs` (CSRF + a recorded matching `queue` proposal, `{project, job}` only; without `proposal` still 401) — design spec 2026-10-09 §8 narrowed.
- DRIFT (planned, local): `test_0_1_35_story_39_2_the_sandbox_login_has_a_clock` re-bounded at 39.3's clause and paragraph.
- Local: `test_0_1_27_story_32_2_adds_the_chat_and_the_engage_surface` pinned the engage surface's drives after the first as exactly the 35.6 closeout drive; relaxed to `drives[1:2]` so the 39.3 `UnknownLine` drive can follow it (appended last).
- Local (supervisor): the lane key is `<lockCheckout || checkoutKey(root)>#studio-chat`; `studioChatPass` also skips a run whose line already has any reply (at most one reply per line); `servedRootOf`'s `500 EngagementRootMissing` is reused for a registry entry without a root; the tap adds a deferred flush when throttled; the drained lane-wait test runs only with `TK_STUDIO_ROOT` set.
- Local (web): `refusalText` gains `LineTooLong` and `ProposalNotYet`; the README's 39.1 route row for `/app/chat` updated; `answer`/`engagement` presses go through one `sendRequest` with `postReply`'s/`postEngagement`'s URL and body; the `/app/chat` vs `/app/chat/<id>` mount is enforced by `App.tsx`'s switch (no DOM test harness).
- Unverifiable-here: `bun run verify` (EPERM at `bun install`); its steps ran directly (tsc, vite build, vitest). The live `claude -p … stream-json` turn, the restarted serve process and the page on desktop/iPad are the operator's manual checks.

### pass 1 (2026-11-10, implementer's DEVIATIONS block)

- planned: the drives pin in `test_0_1_27_story_32_2_adds_the_chat_and_the_engage_surface` unchanged / actual: relaxed from `drives[1:]` to `drives[1:2]`; the new `UnknownLine` drive appended last on `tk-studio-engage` / why: the pin required the closeout drive to be the only drive after the first / may affect: none
- planned: lane key `<resolved lockCheckout ?? root>#studio-chat` / actual: `<lockCheckout || checkoutKey(root)>#studio-chat` / why: uses the queue's own checkout key when no lock checkout resolves / may affect: none
- planned: `studioChatPass` appends the failure reply when no reply names the `run_id` / actual: also skips when any reply already answers that line / why: at most one reply per line / may affect: none
- planned: `POST /chat`/`GET /chat` refusals as listed in shape 5 / actual: also `500 EngagementRootMissing` from reusing `servedRootOf` / why: reuse of the existing served-root helper / may affect: none
- planned: tap writes at most every 250 ms plus a flush in `close()` / actual: also a deferred flush when throttled / why: otherwise text stalls until the next chunk / may affect: none
- planned: a drained lane-wait test with no `claim-refused` / actual: written, runs only with `TK_STUDIO_ROOT`, `uv` and the shipped job present / why: `runJob` re-validates the job through `uv` / may affect: none
- planned: web `refusalText` and the 39.1 README `/app/chat` row untouched / actual: `refusalText` gains `LineTooLong`, `ProposalNotYet`; the stale row updated / why: show `LineTooLong` by name; the row described the placeholder / may affect: none
- planned: `answer`/`engagement` presses use `postReply`/`postEngagement` / actual: one `sendRequest` with the same URL and body / why: a single tested press path returning the refusal name / may affect: none
- planned: a test that `/app/chat` renders `StudioChatScreen` and `/app/chat/<id>` renders `ChatScreen` / actual: enforced by the `route.name` switch in `App.tsx`; no render test / why: vitest runs in a node environment with no DOM harness / may affect: none
- planned: `bun run verify` / actual: its steps run directly (tsc, vite build, vitest) / why: EPERM at `bun install` in the sandbox / may affect: none

DEVIATION SCORE: 1

DRIFT: 32.2 contract test's drives pin relaxed to `drives[1:2]` — the new `UnknownLine` drive follows the closeout drive — affects: none
DRIFT: studio-chat lane key falls back to `checkoutKey(root)` — the queue's own key when no lock checkout resolves — affects: none
DRIFT: `studioChatPass` skips a line already answered — at most one reply per line — affects: none
DRIFT: `/chat` routes may answer `500 EngagementRootMissing` — reuse of `servedRootOf` — affects: none
DRIFT: the tap adds a deferred throttled flush — text would stall until the next chunk — affects: none
DRIFT: the drained lane-wait test is env-gated (`TK_STUDIO_ROOT`) — `runJob` re-validates through `uv` — affects: none
DRIFT: web `refusalText` and the README `/app/chat` row updated — `LineTooLong` shown by name; the row described the placeholder — affects: none
DRIFT: `answer`/`engagement` presses share one `sendRequest` — single tested press path — affects: none
DRIFT: the `/app/chat` mount has no render test — node vitest, no DOM harness — affects: none
DRIFT: `bun run verify` run as its steps — EPERM at `bun install` in the sandbox — affects: none

### pass 3 (2026-11-10, follow-up review patches)

- planned: a `queue` press is the cookie `POST /jobs`, then `POST /chat {pressed}` (CAP-10) / actual: the cookie `POST /jobs` gate takes `studio-chat.lock`, re-checks the press, writes the `queue` press line itself before `postJobs`, and drops it on a non-2xx submit; a held lock answers `503 ChatBusy`; the web posts no press line for `queue` (a later `POST /chat {pressed}` answers `409 ProposalAlreadyPressed`); `answer`/`engagement` `sent` keys persist per project in `sessionStorage`; contract §2 row and 0.1.35 39.3 paragraph updated (additive) / why: review patch — one press per proposal was enforced only by the client (reload or two tabs could submit the job twice) / may affect: 39-7-messages-both-ways-and-the-check-in
- planned: an `answer` note is any string up to 2,000 characters / actual: a note holding a line `sweepdecisions.parse_answers` reads as a decision (`DW-n: X`, `all: X`, `default`) is `ProposalInvalid`; the web's `answerBody` drops such lines; contract text names the rule / why: review patch — a button labelled with one answer could record others / may affect: none
- planned: web `PressResult.seq` is the press line's seq / actual: `null` for a `queue` press / why: the gate writes the line, so the client never learns its seq / may affect: none
- Local (web): `readError` split into `agentsError`/`chatError`, the wake retry keyed on the chat read alone; `send`/`onPress` skip their post-await writes when the shown project changed (no DOM test harness: tsc/build only).

DEVIATION SCORE: 2 (consult: accept-deviation score 2)

DRIFT: the cookie `POST /jobs` gate takes `studio-chat.lock` (`503 ChatBusy` when held), writes the `queue` press line itself and drops it on a non-2xx submit; the web posts no `POST /chat {pressed}` for `queue` — departs from CAP-10's "then `POST /chat {pressed}`"; one press per proposal was client-only — affects: 39-7-messages-both-ways-and-the-check-in
DRIFT: an `answer` note holding a decision-shaped line is `ProposalInvalid` (web drops such lines) — a press could record decisions its label never named — affects: none
DRIFT: web `PressResult.seq` may be `null` for a `queue` press — the gate writes the press line — affects: none

### pass 4 (2026-11-10, follow-up review 2 patches)

- planned: the gate drops the `queue` press line again on a non-2xx submit / actual: it marks the line `unqueued: true` in place (seq, author, body and `pressed` kept) on a non-2xx or thrown submit; a marked line is still a press line (never a pending turn) but no press, so `pressLine` and web `pressedKeys` ignore it / why: review patch — a dropped line SSE had already streamed let the next append reuse its seq, and open pages skipped the real line / may affect: 39-7-messages-both-ways-and-the-check-in
- planned: `POST /chat {pressed}` refusals `UnknownProposal`, `ProposalNotYet`, `ProposalAlreadyPressed` / actual: also `409 ProposalViaJobs {project, seq, index, kind, detail}` for a `queue` proposal not yet pressed; nothing written / why: review patch — such a press recorded a line with no job, and the gate then refused the proposal forever / may affect: none
- planned: the studio-chat tap per worker spawn / actual: one tap per run, closed once after the loop; the SSE resends a `chat-delta` with `from: 0` when the stream text shrinks (the published `from` replace semantics) / why: review patch — a resumed worker's fresh tap overwrote the stream and the SSE sliced from a stale offset / may affect: none
- Local: `linesRef.current` set before the stream opens; `studioChatPass` reads each root's chat once per pass.

DEVIATION SCORE: 2 (consult: accept-deviation score 2)

DRIFT: a failed cookie `POST /jobs` queue submit marks the press line `unqueued: true` in place instead of dropping it (new optional record field; seq never reused) — a dropped line SSE had already streamed let its seq be reused and open pages skip the real line — affects: 39-7-messages-both-ways-and-the-check-in
DRIFT: `POST /chat {pressed}` answers `409 ProposalViaJobs` for a `queue` proposal not yet pressed — such a press recorded a line with no job and the gate then refused the proposal forever (0.1.35, additive) — affects: none
DRIFT: the SSE resends a `chat-delta` `from: 0` when the stream text shrinks, and the tap is one per run — a resumed worker's tap otherwise garbled the streamed reply — affects: none

## Consult Log

- 2026-11-10T02:49:11Z — trigger: deviation-gt-0 — question: accept the follow-up-2 pass's three deviations (a failed queue submit marks the press line `unqueued: true` in place instead of dropping it; `409 ProposalViaJobs` on `POST /chat {pressed}` for an unpressed queue proposal; SSE `from: 0` resend on a shrunk stream with one tap per run), and at what score? — ruling: accept-deviation score 2 — do: keep all three patches; record deviation 1 `affects: 39-7-messages-both-ways-and-the-check-in` score 2, deviations 2 and 3 `affects: none` score 1, this pass's `DEVIATION SCORE: 2`; amend the I/O-matrix Press row (`unqueued: true` in place, seq kept, on a non-2xx or thrown submit; `409 ProposalViaJobs` for an unpressed `queue` proposal) — rule candidate: a review-pass amendment to a contract clause the same unreleased story introduced is a deviation, not a published-surface change; score it by the `affects:` of the DRIFT line whose seam it touches, no consult when that score is unchanged (observation recorded)

- 2026-11-10T01:33:19Z — trigger: deviation-gt-0 — question: accept the implementer's 10 local deviations (score 1) and the planner-settled AC deviations (stop until vs max_runs:1, answer.issue, proposal-bound cookie POST /jobs), and at what score? — ruling: accept-deviation score 1 — do: keep deviation_score 1; accept all 10 pass-1 deviations and the three planned AC deviations, DRIFT lines and AC1 met-with-deviation as recorded; do not escalate; leave the epics.md AC1 wording to the planner's sync-back — rule candidate: deviation_score scores only the implementer's deviations; an AC deviation settled by SPEC design notes before implementation with no contrary owner ruling is a planned DRIFT and does not fire deviation-gt-0
- 2026-11-10T02:22:36Z — trigger: deviation-gt-0 — question: accept the follow-up pass's three deviations (the cookie `POST /jobs` gate records the `queue` press line itself under `studio-chat.lock`; an `answer` note with a decision-shaped line is `ProposalInvalid`; web `PressResult.seq` may be null), and at what score? — ruling: accept-deviation score 2 — do: keep all three patches; rewrite deviation 1's DRIFT to `affects: 39-7-messages-both-ways-and-the-check-in`, naming the lock, `503 ChatBusy`, the press-line write and its drop on a non-2xx submit, and the departure from CAP-10's "then `POST /chat {pressed}`" for `queue`; keep deviations 2 and 3 at `affects: none`, set this pass's `DEVIATION SCORE: 2`; add one I/O-matrix note under the Press row (for `queue`, `POST /chat {pressed}` now answers `409 ProposalAlreadyPressed`; the press line comes from the cookie `POST /jobs` row); do not revert — rule candidate: a deviation that changes a route or gate an earlier DRIFT line in the same spec marks `affects: <story>` (new refusals, locks or writes) inherits that `affects:` and scores 2; `affects: none` only when no seam named in the Deviation Summary is touched

### pass 2 (2026-11-10, review patches)

- planned: `POST /chat` press refusals as shape 5 lists / actual: also `409 ProposalAlreadyPressed {project, seq, index, pressed_seq, detail}`; the cookie `POST /jobs` gate also refuses an already-pressed proposal (`403 ProposalRefused`); contract §2 row and 0.1.35 paragraph name both (additive) / why: review patch — one recorded proposal could otherwise submit the job without limit / may affect: none
- planned: the studio chat's lines effect keyed on `[project]` / actual: `[project, retry]`, state reset on a project change only / why: review patch — retry a failed first read on wake / may affect: none

DEVIATION SCORE: 1

DRIFT: `POST /chat` adds `409 ProposalAlreadyPressed` and the cookie `POST /jobs` gate refuses an already-pressed proposal — one recorded proposal could submit a job without limit; the contract names both (0.1.35, additive) — affects: none
DRIFT: the studio chat's read effect retries on wake after a failed first read — no recovery without a reload otherwise — affects: none

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-39-20261110T005020Z-71acd5` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a second follow-up review pass on the studio chat committed at 223d9bc1d66611c9604d8fc99289c3946ec762e8. Both layers ran (blind-hunter and edge-case-hunter, band L) over the diff since c9f5132abec7aa18a8c52279abc3dadb6884a723: 28 files, about 3,800 lines. The implementer was relaunched and applied five patches:
- A `queue` proposal is no longer pressable through `POST /chat {pressed}`. Such a press now answers `409 ProposalViaJobs` and writes nothing. Before, it wrote a press line with no job, and the gate then refused the proposal forever.
- A failed gate submit now marks the press line `unqueued: true` in place, and its seq is never reused. Before, the line was deleted after SSE might already have streamed it, so open pages skipped the next real line.
- The page's `linesRef` is set before the stream opens.
- `studioChatPass` reads each chat once per pass.
- A resumed studio-chat worker keeps one tap per run, and the SSE resends `from: 0` when the stream text shrinks.

The story's earlier result still holds: AC1 met-with-deviation (`stop {until}`, not `max_runs: 1`); AC2, AC3 and AC4 met. Contract 0.1.35, additive.

**Files changed in this pass (11, all in the plan's Files list).**
- `apps/supervisor/src/api.ts`:
  - `409 ProposalViaJobs` on the `pressed` branch.
  - `pressLine` skips `unqueued` lines.
  - The gate's rollback marks the line instead of dropping it.
  - The SSE resends `from: 0` on a shrunk stream.
  - The header and doc comments.
- `apps/supervisor/src/studiochat.ts`: `markUnqueuedHeld`; `StudioLine.unqueued?`; a per-root chat cache in `studioChatPass`.
- `apps/supervisor/src/cli.ts`: the studio-chat tap is created once before the worker loop and closed once after it.
- `apps/supervisor/test/api.test.ts`: the `ProposalViaJobs` refusal; presses of an `open` proposal; the marked-line rollback (seq kept, next line N+1, re-press allowed); the `from: 0` resend.
- `apps/supervisor/test/studiochat.test.ts`: `markUnqueuedHeld`; a silent exit and resume whose stream file only grows. Run against HEAD's `cli.ts`, this test fails.
- `apps/supervisor/README.md`: the `POST /chat` row and the gate's marked rollback.
- `apps/studio-web/src/chat/StudioChatScreen.tsx`: `linesRef.current` is set before `openChatStream`.
- `apps/studio-web/src/chat/model.ts`: `pressedKeys` ignores `unqueued` lines; `StudioLine.unqueued?`.
- `apps/studio-web/src/chat/model.test.ts`: `pressedKeys` ignores a marked line.
- `plugins/tk-studio/contracts/driver-contract.md`: the §2 `POST /chat` row and the 0.1.35 39.3 text (`ProposalViaJobs`, the `unqueued` marker, `from: 0` on a shrunk stream).
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: phrase pins for the new text.

**Review findings.**
- Patches applied: 5 (high 0, medium 2, low 3).
- Deferred: 0.
- Rejected: 2.
  - The pass's synchronous lock wait. Only another process or a crash leftover can hold the lock while the pass runs. This mirrors `withChatLock`.
  - The quiet-lane-wait test skips without `TK_STUDIO_ROOT`. This is the repo's drained-test pattern, and `verify_host.py` sets the variable.
- One consult (deviation-gt-0): accept-deviation, score 2.

Note: an earlier pass rejected the pass-rescan cost as "efficiency only". This pass patched it after all: the fix is cheap and the cost grows quadratically with the chat's age.

**Follow-up review recommendation:** true. Patched: high 0, medium 2, low 3. Score 3×2 + 3 = 9 (≥ 5).

**Verification (after the patches, re-run by this session).**
- `plugins/tk-studio/lib`:
  - `uv run python -m unittest discover tests`: OK, 3165 tests (skipped=5).
  - `runner.py run`: `ok: true`.
  - `job.py validate --file ../jobs/studio-chat.json`: `ok: true`.
- `apps/supervisor`: `bun test --timeout 30000` 2239 pass, 0 fail, 88 skip; `bun x tsc --noEmit` exit 0.
- `apps/studio-web`: `bun run verify` hits EPERM at `bun install` in the sandbox, so its steps ran directly. `bun x tsc --noEmit` exit 0, `vite build` built, `vitest run` 234 passed. The host leg (`tools/verify_host.py`) is the proof.

**Residual risks / unverifiable-here (operator).**
- **A page already open when a press fails** keeps showing that press line, with no marker, as "Pressed" until a reload. The SSE sends only seq > last. The server still accepts the re-press.
- **A resumed session that emits `<reply>` again** can make the streamed text look garbled until the recorded reply replaces it. The stream file only grows.
- **No direct test for a thrown submit** on the gate. `postJobs` turns submit errors into status codes, so only the non-2xx path is exercised.
- **No render tests for the screen patches** (`linesRef`, and the earlier passes'), because vitest runs in node with no DOM harness. They are checked only by `tsc` and the build.
- **No live turn has run.** Stop the supervisor tab before building `apps/supervisor`, and restart it through the scheduled task after the merge. Then:
  - `curl -sS -H "Authorization: Bearer $TK_SUPERVISOR_TOKEN" -H 'content-type: application/json' -d '{"project":"tk-studio","text":"what is running"}' https://$TK_SUPERVISOR_TLS_NAME:8787/chat`
  - `curl -N -H "Authorization: Bearer $TK_SUPERVISOR_TOKEN" -H 'Accept: text/event-stream' "https://$TK_SUPERVISOR_TLS_NAME:8787/chat?project=tk-studio"`
  - Open `/app/chat` on the desktop and the iPad, and time the first turn against "about a minute".
- **epics.md AC1 still reads `max_runs: 1`**; correcting it is left to the planner's sync-back.

Deviations (score 2; consult accepted):
DRIFT: AC1's `stop {max_runs: 1}` shipped as `stop {until: 9999-12-31T23:59:59Z}` — `jobrun.py evaluate_stop` would refuse every line after the first (planner's SPEC design note) — affects: none
DRIFT: the `answer` proposal gains `issue` — `POST /inbox/{key}/reply` needs the key (planner's SPEC design note) — affects: 39-7-messages-both-ways-and-the-check-in
DRIFT: the cookie gains a proposal-bound `POST /jobs` (design spec 2026-10-09 §8 narrowed; still 401 without `proposal`) — AC3's `queue` press is `POST /jobs` (planner's SPEC design note) — affects: 39-7-messages-both-ways-and-the-check-in
DRIFT: the cookie `POST /jobs` gate takes `studio-chat.lock` (`503 ChatBusy` when held), writes the `queue` press line itself (marked `unqueued: true` in place on a non-2xx or thrown submit); the web posts no `POST /chat {pressed}` for `queue` — departs from CAP-10's "then `POST /chat {pressed}`"; one press per proposal was client-only — affects: 39-7-messages-both-ways-and-the-check-in
DRIFT: a failed cookie `POST /jobs` queue submit marks the press line `unqueued: true` in place instead of dropping it (new optional record field; seq never reused) — a dropped line SSE had already streamed let its seq be reused and open pages skip the real line — affects: 39-7-messages-both-ways-and-the-check-in
DRIFT: `POST /chat {pressed}` answers `409 ProposalViaJobs` for a `queue` proposal not yet pressed — such a press recorded a line with no job and the gate then refused the proposal forever (0.1.35, additive) — affects: none
DRIFT: the SSE resends a `chat-delta` `from: 0` when the stream text shrinks, and the tap is one per run — a resumed worker's tap otherwise garbled the streamed reply — affects: none
DRIFT: an `answer` note holding a decision-shaped line is `ProposalInvalid` (web drops such lines) — a press could record decisions its label never named — affects: none
DRIFT: web `PressResult.seq` may be `null` for a `queue` press — the gate writes the press line — affects: none
DRIFT: `POST /chat` adds `409 ProposalAlreadyPressed` and the cookie `POST /jobs` gate refuses an already-pressed proposal — one recorded proposal could submit a job without limit; the contract names both (0.1.35, additive) — affects: none
DRIFT: the studio chat's read effect retries on wake after a failed first read — no recovery without a reload otherwise — affects: none
DRIFT: 39.2's contract test re-bounded at 39.3's clause and paragraph — the 0.1.35 entry grows in story order — affects: none
DRIFT: 32.2 contract test's drives pin relaxed to `drives[1:2]` — the new `UnknownLine` drive follows the closeout drive — affects: none
DRIFT: studio-chat lane key falls back to `checkoutKey(root)` — the queue's own key when no lock checkout resolves — affects: none
DRIFT: `studioChatPass` skips a line already answered — at most one reply per line — affects: none
DRIFT: `/chat` routes may answer `500 EngagementRootMissing` — reuse of `servedRootOf` — affects: none
DRIFT: the tap adds a deferred throttled flush — text would stall until the next chunk — affects: none

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-11-09T17:24:14Z | 2026-11-09T17:48:18Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-11-09T22:53:21Z | 2026-11-09T22:54:03Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-11-10T00:52:33Z | 2026-11-10T02:00:40Z | 6ca8f7f7-a063-4808-88f9-7d896827dcc1 | claude-opus-5-5 | medium | 39674748 | 263485 | 20.5205 | completed |
| review | 1 | 2026-11-10T02:00:41Z | 2026-11-10T02:24:04Z | 18211d97-a898-4f0f-b7e5-e489f7cbdfda | claude-opus-5-5 | medium | 13362562 | 98676 | 8.0012 | completed |
| review | 2 | 2026-11-10T02:24:04Z | 2026-11-10T02:50:30Z | f147872e-3573-4fc7-8940-063020260289 | claude-opus-5-5 | medium | 12831946 | 103799 | 7.8755 | completed |
| gate | 1 | 2026-11-10T02:50:30Z | 2026-11-10T02:53:12Z | b64728f4-9bd6-4fe2-bec4-95af20a48816 | claude-opus-5-5 | medium | 2888831 | 15626 | 1.7628 | completed |
| host-leg | 1 | 2026-11-10T02:53:26Z | 2026-11-10T04:08:02Z | — | — | — | — | — | — | green |
| close-out | 1 | 2026-11-10T04:08:02Z | 2026-11-10T04:08:10Z | — | — | — | — | — | — | PR |
| merge | — | 2026-11-10T04:09:11Z | 2026-11-10T04:09:11Z | — | — | — | — | — | — | merged |

## Reconcile

### 2026-11-10 — adjust-stories

- Score: 2
- Reasoning: The planned AC deviations (`stop {until}`, `answer.issue`, the proposal-bound cookie `POST /jobs`) are SPEC design notes (CAP-8..CAP-11) and touch no AD or ruling; the contract changes are 0.1.35 additive and land in this story. Only 39.7 is planned against what changed: its `message` inbox items read `studio-chat.jsonl` lines, which now include gate-written `queue` press lines that may carry `unqueued: true`, and its `stop-after-story`/`open-studio` presses replace 39.3's `ProposalNotYet` refusals, which live in three places, not only `apps/studio-web/src/chat/*`. Notes in 39.7's `invoke_dev_with` absorb both; no AC changes.
- Affected: 39-7-messages-both-ways-and-the-check-in — plans/39-7.md:108 "The `stop-after-story` and `open-studio` proposals are refused by name in 39.3's proposal mapping (`apps/studio-web/src/chat/*`). This story replaces those two refusals."
- Affected: 39-7-messages-both-ways-and-the-check-in — plans/39-7.md:299 "`message`. One per line of the last fifty `studio-chat.jsonl` lines (39.3's reader)." (press lines, `unqueued: true` marker)
- Invariant: none
- Gate: Part A adjust-stories; Part B story accepted, planned 39-4-the-kanban-and-the-story
