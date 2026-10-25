---
title: 'The Planner Leg Behind the Chat Route'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '290ee9916bfcb76bd2aa3ee1f0a66cc3d2a8476b'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-32/plans/32-2.md'
  - '{project-root}/_bmad-output/specs/spec-epic-32/SPEC.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The owner has no way to talk to the studio about an engagement. 32.1 laid the record and its states, but there is no chat route, no planner session behind it, and nothing meters the planning spend (§6.4, D2; F2 step 1).

**Approach:** Add the supervisor's own chat route. `POST /chat/{engagement}` appends the owner's line to `chat.jsonl` and queues one host-tier `engagement-chat` run. `GET /chat/{engagement}` reads the chat as JSON or as a live stream. The run is a `claude -p` session driven by the new plugin surface `tk-studio-engage` (`lib/engage.py reply`). The session reads the memory and writes the planner's reply with optional `proposals[]`. The planner moves nothing. A spend pass sums the chat runs' costs into `spend.planning_usd`. Everything is additive on contract 0.1.27.

User story: As the owner, I want to talk to the studio about an engagement from the web, so that the same brain the loop uses answers with the project's plan, kb and Confluence pages as its memory (§6.4, D2; F2 step 1).

Acceptance criteria (verbatim from epics.md Story 32.2):

- **AC1. Given** an engagement that is not terminal **When** `POST /chat/{engagement} {message}` arrives (the bearer or a cookie with `X-CSRF-Token`; the body at most 32 KiB UTF-8) **Then** the message is appended to `_bmad-output/engagements/<id>/chat.jsonl` as `{seq, at, author: owner, body}` and the supervisor queues one run of the shipped job `engagement-chat` (one-shot; host tier; the planner leg's model and effort from the project's routing, passed at enqueue as `validate-resolution`'s are; payload `{engagement, seq}`; `guards.max_turns` 80, `max_wall_clock_seconds` 1800): a `claude -p` session on the host in the served project's root with the plugin, driven by the new contract surface `tk-studio-engage` (`lib/engage.py`), which reads the record, the chat so far, the plan under `_bmad-output/planning-artifacts/`, `kb/` and `kb/confluence/` and writes the reply with `engage.py reply` as `{seq, at, author: planner, body, run_id, proposals[]}`; the run's `job-run` event carries the cost like any run and the record's `spend.planning_usd` sums it (scoping is metered; the quote says so, 32.5); the answer is 200 `{ok, engagement, seq, run_id}`; a message sent while a chat run is live is queued behind it on the checkout lock, never refused; a terminal engagement is 409 EngagementClosed
- **AC2. Given** the chat **When** `GET /chat/{engagement}?since=<seq>` is read (JSON, or `Accept: text/event-stream` with the office stream's id, replay and heartbeat conventions) **Then** the lines after `seq` are returned and the planner's reply reaches an open stream without a reload; a `proposals[]` entry is `{verb, payload, label}` (an input the planner suggests, which the web renders as a button and the owner sends through 32.1: the planner itself has no bearer and no CSRF token and moves nothing); the chat session's environment is a worker's (`buildWorkerEnv`: every `TK_SUPERVISOR_*` secret and the owner seat stripped); `bun test` covers the append, the queueing behind a live run, the stream and the refusals with a fake planner; the lib suite covers `engage.py reply` (the memory it assembles, the reply line, the proposal shape) with a fixture project

## Boundaries & Constraints

**Always:**
- Use the plan's Settled shapes 1 to 5 (`plans/32-2.md` §Settled shape; SPEC Design notes) exactly as written:
  1. The record is serialized as JSON text.
  2. `stack: true`, the per-run payload `{engagement, project, seq}` with the run's `run_id`, and the `chat-queued` service event.
  3. The `chat.jsonl` line shapes, with `chat.lock` (exclusive create, stale after 30 s) and the re-read of the last `seq` inside the lock.
  4. A proposal is `{verb, payload, label}`, with the payload checked by 32.1's per-verb rules. An invalid one is `ProposalInvalid` naming the index.
  5. The spend pass at the `finally` sites. It emits no `engagement` event.
- Replan (from 32-1): resolve the chat route's engagement with `locateEngagement` (api.ts:455) as-is. Accept `?project=`. Ambiguity is 409 AmbiguousEngagement, never the first hit. `GET /engagements/{id}` keeps answering `{ok, project, engagement, chat {route, path, last_seq}}`.
- Contract: extend 0.1.27 additively. The header clause is `0.1.27 (Story 32.2) adds to this same entry …` and there is never a `**0.1.28**`. Keep every string `test_driver_contract.py` `test_0_1_27_opens_the_engagement_entry` pins, and add a 32.2 pin test.
- The planner session runs with `buildWorkerEnv` unchanged. Assert it for a chat run.
- Every existing `enqueue` caller keeps today's idempotent adoption. `stack` is opt-in.
- House rules: stdlib-only `engage.py` run via `uv run`; atomic writes; the AD-11 status block (exit 2 on `blocked`); credentials never land in files or events; nothing in the plugin imports a driver or the supervisor.
- Stay within the plan's Files list (20 files).

**Block If:**
- The Files list must grow beyond the plan's list: HALT naming the file (oversize gate, 2026-10-25).
- Settled shape 1's JSON serialization breaks a 32.1 test or contract text that pins block-YAML layout, and the fix needs a file outside Files: HALT naming the test and the file.
- `stack` would change the adoption rule for any job other than `engagement-chat`: HALT.
- The session cannot learn its run id from the overlaid payload (the invoke-skill directive does not reach the skill with `run_id`): HALT with the directive the skill received.

**Never:**
- The planner moves no state. There is no chat-driven input and no `questions`, `scope`, `quote` or `closeout` verb (32.3 to 32.8).
- No change to `apps/studio-web/**`, `miniyaml.py`, `plansync.py`, `track.py`, `inbox.ts`, `board.ts`, `office.ts`, `closeout.ts`, `released-roster.json`, `.bmad-loop/**` or `_bmad-output/planning-artifacts/**`.
- No change to `buildWorkerEnv`.
- No push, tag, release motion or version-gate bump.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| send | bearer `POST /chat/ENG-001 {message}`, `intake` | line `{seq:1, at, author:"owner", body}` appended; one `engagement-chat` run minted (host, planner leg); `chat-queued` event; 200 `{ok, engagement, seq, run_id}` | — |
| send while live | a chat run is `running` for the checkout | a second run is minted (`stack`) and waits on the checkout lock | never refused, never adopted |
| cookie, no CSRF | cookie session, no `X-CSRF-Token` | nothing appended | 403 CsrfRefused |
| terminal | `delivered` / `failed` / `cancelled` | nothing appended | 409 EngagementClosed |
| oversize / bad body | > 32 KiB UTF-8, empty, extra field, non-JSON | nothing appended | 400 SchemaError / MalformedJson |
| ambiguous id | the same `ENG-NNN` in two roots, no `?project=` | — | 409 AmbiguousEngagement |
| bad / unknown id | `foo` / a missing `ENG-NNN` | — | 400 BadEngagement / 404 UnknownEngagement |
| read | `GET /chat/ENG-001?since=1` | JSON lines with `seq > 1` | — |
| stream | `Accept: text/event-stream`, `Last-Event-ID: 2` | frames `id: <seq>`, `event: chat`, data = the line, after seq 2; `: heartbeat`; a new planner line arrives without a reload | cleanup on abort |
| wrong method | `PUT /chat/ENG-001` | — | 405 `Allow: GET, POST` |
| reply memory | `engage.py reply --directory <root> --engagement ENG-001` | `ok`: the record, the chat, three capped indexes `{path, bytes, title}` with `truncated` | — |
| reply write | `--body-file --proposals-file --run-id` | the planner line appended under the lock with the next seq | — |
| bad proposal | an unknown verb, a bad payload or a label over 80 characters | nothing appended | `blocked` ProposalInvalid naming the index |
| unreadable / terminal | a non-JSON record, a missing record, a terminal state, an oversize body | nothing appended | `blocked` with a named reason (`EngagementRecordUnreadable`, …) |

</intent-contract>

## Code Map

The plan's Code Map (`_bmad-output/specs/spec-epic-32/plans/32-2.md` §Code Map) is the investigation, with line anchors. The orchestrator re-checked the anchors at 290ee99. The implementer reads the Code Map in full. In summary:

- `apps/supervisor/src/engagement.ts`:
  - reuse `readEngagement` :405, `writeEngagement` :417, `engagementPath` :366, `TERMINAL_STATES` :33, `chatPointer` :508 and `REPLY_MAX_BYTES`;
  - export `atomicWrite` :370;
  - switch the serialization to JSON text.
- `apps/supervisor/src/api.ts`:
  - `route(…, csrf?, via)` :953 and the `/engagements` branches;
  - `locateEngagement` :455, `decodeId` :292 and `allow()`;
  - `cookieRoute` :909-923: add the read route and the CSRF POST;
  - `postInputRoute` :527 is the POST model;
  - the office SSE :675-719 and `/events` :618-673 are the stream models. Write a third handler.
- `apps/supervisor/src/resolution.ts`: `queueResolved` :207-250 and `plannerLeg` :64 are the enqueue model. Generalise `withStoredPayload` :263 and `withQueuedPayload` :273. They are called at cli.ts:1121, :1127 and :1531.
- `apps/supervisor/src/queue.ts`:
  - `enqueue` :1062-1109 (adoption);
  - `claim` :1165 (lock-wait :1244);
  - `serviceEvent` / `serviceEvents` :1982-1988.
- Cost readers:
  - `runCost` (inbox.ts:146);
  - `jobRunCosts` and `ledgerPath` (board.ts:194, :219);
  - the `finally` sites (cli.ts:690-712; `underBunTest()`).
- `apps/supervisor/src/server.ts:580`: `buildWorkerEnv`, read-only.
- Plugin:
  - `lib/track.py` :894-984 and `skills/tk-studio-track/SKILL.md` are the CLI and skill models (the exact "If the deterministic core is unrunnable…" sentence checked by `runner.py:187`);
  - `jobs/validate-resolution.json` is the job model;
  - the `manifest.json` track entry :411-436 is the conformance model;
  - `driver-contract.md` header :5-6, §1 :114-117, §2 :376-396 and §4 :466;
  - `test_driver_contract.py` :964;
  - `test_job.py` :208 and :238.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/engagement.ts` -- write the record as `JSON.stringify(record, null, 2) + "\n"` and export the atomic write -- Settled shape 1.
- `apps/supervisor/src/queue.ts` -- add the opt-in `stack` to `enqueue` and store the payload per run in the `enqueued` event detail -- AC1 queued behind a live run.
- `apps/supervisor/src/resolution.ts` -- generalise the payload overlays to `engagement-chat` with the per-run payload plus `run_id` -- AC1.
- `apps/supervisor/src/chat.ts` (new) -- the chat lock, append and read-since; the enqueue (planner leg, `stack`, `chat-queued`); the stream line source; the spend pass -- AC1 and AC2.
- `apps/supervisor/src/api.ts` -- add `POST` and `GET /chat/{engagement}` (JSON and SSE), the cookie allowances and the `ApiDeps` chat dependency -- AC1 and AC2.
- `apps/supervisor/src/cli.ts` -- wire the production chat deps, the overlay call sites and the spend pass at the `finally` sites -- AC1.
- `plugins/tk-studio/lib/engage.py` (new) and `skills/tk-studio-engage/SKILL.md` (new) -- the `reply` verb in two modes (memory, write) with the status block -- AC1 and AC2.
- `plugins/tk-studio/jobs/engagement-chat.json` (new) -- the shipped one-shot job as the plan specifies -- AC1.
- `plugins/tk-studio/contracts/conformance/manifest.json`, `contracts/driver-contract.md` -- the `tk-studio-engage` entry; the §1 chat rows, the §2 row, the §4 job bullet and the 0.1.27 (Story 32.2) clause -- the contract surface.
- Tests:
  - `apps/supervisor/test/chat.test.ts` (new), `test/api.test.ts`, `test/queue.test.ts` and `test/engagement.test.ts`, with a fake planner -- every matrix row; `stack` mints behind a live run while other jobs still adopt; the per-run payload; the JSON round trip; the spend sum; `buildWorkerEnv` for a chat run.
  - `plugins/tk-studio/lib/tests/test_engage.py` (new), with the fixture `tests/fixtures/engage-project/` -- the memory, the reply line and the proposal shape.
  - `test_job.py` -- the new job validates.
  - `test_driver_contract.py` -- a 32.2 pin, with the 32.1 pins kept.
- `apps/supervisor/README.md` -- document the two chat routes, the job and the spend pass.

**Acceptance Criteria:**
- Given an `engagement-chat` run minted by the chat route, when its definition is resolved at run start, then the skill receives `{verb: "reply", engagement, project, seq, run_id}` and the enqueue carried the routing's `planner.{model, effort}` with tier `host`.
- Given two `chat-queued` runs with `job-run` costs 0.5 and 0.25 in the ledger, when the spend pass runs, then `spend.planning_usd` is 0.75 and no `engagement` event is emitted.
- Given the verify gate, when it runs, then the lib suite is green (except the three released-roster guards, which are `unverifiable-here` until the release motion), conformance is `ok: true` with `tk-studio-engage`, `bun test` is green and `tsc` is clean.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- Layers: blind-hunter (6 findings) and edge-case-hunter (5 findings), both on claude-opus-5-5 at medium effort. The diff went to both as a file path, `/tmp/…/review-32-2.diff` (2571 lines). After dedup, 8 unique findings remained (edge 1 = blind 5, edge 4 = blind 4, edge 2 and 3 are one claim).
- intent_gap: 0
- bad_spec: 0 (consult routed the high finding as patch: the spec is right, the code was wrong)
- patch: 8 (high 1, medium 3, low 4)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` The planner wrote `chat.jsonl` in the run's worktree, not the served root (cli.ts:1174, :2049). Fix: the payload carries `project_root` and SKILL.md maps it to `--directory`. The contract, README and job description name it, and a real drive-path test was added.
  - `[medium]` `[patch]` The studio run id overwrote the queue `run_id` at the invoke site (cli.ts:2050). Fix: `engagement-chat` keeps the overlaid queue `run_id`; every other job is unchanged.
  - `[medium]` `[patch]` The spend pass could overwrite a concurrent state change. Fix: a fresh re-read right before the atomic write, merging only `spend.planning_usd`. A test covers it; the residual window is recorded as a risk.
  - `[medium]` `[patch]` A failed mint left an owner line with no run. Fix: the append and the mint run under `chat.lock`; the line is rolled back and the answer is `500 ChatQueueFailed`. A minted run whose `chat-queued` event failed is cancelled.
  - `[low]` `[patch]` The POST's lock wait blocked the server (`sleepSync`). Fix: `withChatLockAsync`.
  - `[low]` `[patch]` Stale-lock takeover race in both writers. Fix: rename to a unique name, then retry the exclusive create.
  - `[low]` `[patch]` `GET /chat` `last_seq` echoed `since`. Fix: it is now the file's last seq.
  - `[low]` `[patch]` A block-YAML record from 32.1 was unreadable by `engage.py`. Fix: POST rewrites it as JSON text before minting.

### 2026-10-25 — Review pass (follow-up, review_loop_iteration 0)
- Layers: blind-hunter (7 findings) and edge-case-hunter (1 finding), both on claude-opus-5-5 at medium effort. The diff `290ee99..HEAD` went to both as a file path, `/tmp/rv-32-2-f62c69/diff.patch` (2986 lines, executor spec excluded). After dedup, 8 unique findings remained.
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 1, low 3)
- defer: 0
- reject: 4 (each with a one-line reason below)
- addressed_findings:
  - `[medium]` `[patch]` `engage.py` `append_line`: an `OSError` or `UnicodeDecodeError` from the chat lock, a non-UTF-8 `chat.jsonl` read, or the atomic write ended `reply` in a traceback with no AD-11 status block. Fix: a named refusal `blocked` `ChatUnwritable`, listed in the module docstring and, per the consult, in the contract's `tk-studio-engage` row. Test: `test_engage.py` `test_an_unwritable_chat_is_chat_unwritable_and_appends_nothing` covers a non-UTF-8 file and `PermissionError` from `atomic_write_text` and `os.open`.
  - `[low]` `[patch]` `chat.ts` `chatSpendPass` grouped runs by the queue run's root (`resolveJob`'s `v.root`), not the served root where the record lives. Fix: group by the run payload's `project_root`, falling back to the run root. Test: a `chat.test.ts` case whose fake `resolveJob` returns a subdirectory root.
  - `[low]` `[patch]` The README and contract §4 said a state change "survives" the spend pass unconditionally. Fix: both now state the residual fresh-read→rename window, in line with the `chatSpendPass` risk comment.
  - `[low]` `[patch]` Doc consistency:
    - The contract 0.1.27 header clause omitted `project_root` from the chat payload. It now reads `{engagement, project, project_root, seq}`.
    - The `engage.py` docstring and `SKILL.md`:11 said the session runs "in the served project's root". They now say the run's worktree, with `project_root` as `--directory`.
- rejected:
  - A failed or refused turn writes no chat line or event: the intent (AC1/AC2) names no failure surface, and the run's end is already on the queue's run events.
  - `engage.py` state check outside `chat.lock`: state writes never take `chat.lock`, so a re-check inside it cannot close the window, and a reply line moves no state.
  - `runJob`'s payload-overlay call sites are not driven by a test: plumbing. The overlay helpers and the drive path are tested, and 31.7's `resolveQuietly` sites set the same precedent.
  - `chatSpendQuietly` at the `finally` sites is not driven by a test: plumbing. The pass itself is tested, and the same 31.7 precedent applies.

### 2026-10-25 — Review pass (follow-up 2, review_loop_iteration 0)
- Layers: blind-hunter (3 findings) and edge-case-hunter (3 findings), both on claude-opus-5-5 at medium effort. The diff `290ee99..HEAD` went to both as a file path, `/tmp/rv2-32-2-f62c69/diff.patch` (3050 lines, executor spec excluded). After dedup, 6 unique findings remained.
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 1, low 4)
- defer: 0
- reject: 1
- addressed_findings:
  - `[medium]` `[patch]` `SKILL.md` never said where indexed memory paths are based. They are relative to the served root, but the session's cwd is the run's worktree, so the planner could read a worktree copy and miss untracked `kb/confluence/` (AC1's memory). Fix: SKILL.md:36-40 and :72-74 now say every indexed `path` is read at `<project_root>/<path>`, never relative to the cwd. `engage.py`'s output shape is unchanged.
  - `[low]` `[patch]` SKILL.md's blocking-conditions list left out `ChatUnwritable`, which the contract row names. Fix: added at SKILL.md:86-87.
  - `[low]` `[patch]` The contract rule that a chat invoke keeps the queue `run_id` (cli.ts:2019 `payloadRunId`) was tested only inside `describe.skipIf(!canRunEngage)`. Fix: an always-run `finishRun` test with a fake `invoke` (chat.test.ts:346). It asserts that `engagement-chat` keeps the queue `run_id` and `project_root`, and that `studio-health` gets the studio run id.
  - `[low]` `[patch]` `chatSpendPass` treated any ledger read error as an empty ledger, so a transient EACCES or EISDIR overwrote a correct `spend.planning_usd` with 0. Fix: only ENOENT counts 0; any other read error skips the pass without writing (chat.ts:248-252, header :19-21). Test: chat.test.ts:275 (EISDIR, 0.75 kept).
  - `[low]` `[patch]` `engage.py` `read_chat` accepted a NaN or Infinity `seq`, and `append_line`'s `int()` then crashed with no AD-11 status block. Fix: a non-finite `seq` is skipped like a torn line (engage.py:179-186). Test: `test_a_seq_that_is_not_finite_is_skipped_like_a_torn_line` (test_engage.py:333).
- rejected:
  - Stacked chat turns still queued when the engagement goes terminal run a session that ends `blocked` `EngagementClosed`. The intent names terminal refusal only at `POST /chat` (409). The run moves nothing, and its cost is real spend.

## Design Notes

- The released-roster guards (`test_release_roster.py` `test_repo_roster_rides_the_version_gate` and the two `test_drift_check.py` `SkillsDirPlaneTestCase` real-repo cases) go red by design when a new skill folder appears (the 31-5 precedent). Record them as `unverifiable-here` with a DRIFT naming `tk-studio-engage`. Never edit `released-roster.json`.
- The checkout lock is shared by every job on the served root, so a chat turn waits behind any live run there, including `run-epic` (relevant to 32.8). This is not a Block If.
- A proposal may carry any of the six verbs, `approve` included. It is only a button the owner presses.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green except the 3 released-roster guards
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`, `tk-studio-engage` listed
- `cd apps/supervisor && PATH=~/.bun/bin:$PATH bun test test/chat.test.ts test/api.test.ts test/queue.test.ts test/engagement.test.ts test/resolution.test.ts`, then `bun test` -- expected: green
- `cd apps/supervisor && PATH=~/.bun/bin:$PATH bunx tsc --noEmit` -- expected: clean
- `grep -n "0.1.27 (Story 32.2)" plugins/tk-studio/contracts/driver-contract.md` hits; `grep -c "\*\*0.1.28\*\*" plugins/tk-studio/contracts/driver-contract.md` is 0; `grep -n "/chat/" plugins/tk-studio/contracts/driver-contract.md apps/supervisor/README.md` hits both
- `git status --porcelain` -- expected: only the plan's Files

## Deviation Summary

### pass 1 (2026-10-25, implementer)

- planned: `stack` as an opt-in flag on `enqueue` (queue.ts) / actual: the SQLite partial unique index `runs_one_live` also excludes `engagement-chat`, with a migration on open; `enqueue` honours `stack` only for `engagement-chat` and ignores it for every other job / why: the database enforced one live run per (job, checkout), so a stacked mint failed on a UNIQUE constraint; limiting it to `engagement-chat` keeps every other job's adoption rule (Block If) / may affect: 32-3, 32-8
- planned: the skill receives "the driven run's own `run_id`" / actual: `run_id` is the queue run id (the id `chat-queued` carries), not the studio run id; the spend pass maps queue run → `studio_run_id` → ledger `job-run` / why: only the queue run id is known where the payload is laid over at run start / may affect: 32-7, 32-8
- planned: the route refusals in the I/O matrix; no JSON shape named for `GET /chat` / actual: added `500 ChatJobUnresolved` (nothing appended) and `503 ChatBusy` (lock held past 5 s); `GET` JSON answers `{ok, project, engagement, since, last_seq, lines}`; the spend pass does not bump `updated` / why: the cases needed a named answer and the GET shape was unspecified / may affect: 32-7

DEVIATION SCORE: 2

DRIFT: runs_one_live index excludes engagement-chat (migration on open); stack honoured only for engagement-chat — the DB enforced one live run per (job, checkout) — affects: 32-3, 32-8
DRIFT: the chat payload's run_id is the queue run id, mapped to the studio run id for spend — only the queue id is known at overlay time — affects: 32-7, 32-8
DRIFT: GET /chat JSON shape {ok, project, engagement, since, last_seq, lines}; 500 ChatJobUnresolved and 503 ChatBusy added — the plan left them open — affects: 32-7

### pass 2 (2026-10-25, implementer, review patches)

- planned: per-run payload `{engagement, project, seq}` / actual: `{engagement, project, project_root, seq}`, with `project_root` mapped to `--directory` / why: the session runs in the run's worktree, while the chat and the record live untracked in the served root (consult, score 2) / may affect: 32-3..32-8
- planned: `finishRun` overlays the studio run id for every job / actual: `engagement-chat` keeps the overlaid queue `run_id` / why: the contract says every chat `run_id` is the queue run id (consult) / may affect: 32-7, 32-8
- planned: the POST refusals in the matrix plus ChatJobUnresolved/ChatBusy / actual: adds `500 ChatQueueFailed` (the owner line is rolled back under the lock, a minted run is cancelled); a block-YAML record is rewritten as JSON on POST / why: review findings 4 and 8 / may affect: 32-7
- planned: the spend pass rewrites the record when the sum changed / actual: it re-reads fresh right before the write and merges only `spend.planning_usd` / why: review finding 3; 32.1 has no cross-process record lock to reuse / may affect: 32-5
- Risk (consult): a sub-millisecond read→rename window against `POST /engagements/{id}/input` remains. A reverted `planning_usd` is corrected by the next pass; a state change overwritten inside the window is not. A shared `engagement.yaml` lock is left to 32-5/32-8.

DEVIATION SCORE: 2

DRIFT: engagement-chat payload gains project_root, mapped to --directory — runs execute in a worktree while chat.jsonl and the record live in the served root — affects: 32-3, 32-4, 32-5, 32-6, 32-7, 32-8
DRIFT: finishRun keeps the overlaid queue run_id for engagement-chat — the contract names the queue run id for every chat run_id — affects: 32-7, 32-8
DRIFT: POST /chat adds 500 ChatQueueFailed with owner-line rollback, and rewrites a block-YAML record as JSON — no owner line without a run; engage.py reads JSON only — affects: 32-7
DRIFT: spend pass merges only planning_usd into a fresh read, with a residual sub-ms window — no shared record lock exists in 32.1 — affects: 32-5, 32-8

### follow-up review pass (2026-10-25, implementer)
- Four patches, scored 1 by the implementer. The consult accepted them at score 1 with no DRIFT. The new refusal `ChatUnwritable` is in the story's own unreleased 0.1.27 row. The frontmatter `deviation_score` stays 2 (the story's prior DRIFTs).

### follow-up review pass 2 (2026-10-25, implementer)
- Five patches. Three scored 0 (SKILL.md text and one test). Two scored 1: the spend pass skips on a non-ENOENT ledger read error, and `read_chat` skips a non-finite `seq`. The consult accepted them at score 1 with no DRIFT. No verb, field, refusal, event or schema changed. The frontmatter `deviation_score` stays 2, from the story's prior DRIFTs.

## Consult Log

- 2026-10-25T05:33:37Z — trigger: deviation-gt-0 — question: accept the three implementer deviations (runs_one_live excludes engagement-chat; run_id is the queue run id; ChatJobUnresolved/ChatBusy and the GET shape)? — ruling: accept-deviation score 2 — do: keep all three; state in driver-contract.md (§1 POST /chat row, §4 engagement-chat bullet) that every chat run_id is the queue run id and the spend pass maps it via studio_run_id to the ledger job-run payload.run_id; add the same sentence plus "the spend pass does not bump updated" to the README POST /chat row, then run conformance — rule candidate: any chat or engagement surface that publishes a run_id publishes the queue run id, names that in the contract, and a ledger-reading pass maps it via studio_run_id
- 2026-10-25T05:44:34Z — trigger: high-severity-finding — question: route the worktree-directory finding (the planner writes chat.jsonl in the run's worktree, not the served root; cli.ts:2050 overwrites the queue run_id) as patch or bad_spec, and is a project_root payload field acceptable? — ruling: accept-deviation score 2 — do: route as patch; add project_root (served registry root) to the engagement-chat payload, map it to --directory in SKILL.md, name it in the contract §4 bullet and the README row; keep the queue run_id at the invoke site and add a real-drive-path test; stay in Files or HALT — rule candidate: a queued job whose skill touches untracked served-root state carries project_root and maps it to --directory; the invoke site never overwrites a payload run_id the contract declares to be the queue run id
- 2026-10-25T06:03:23Z — trigger: deviation-gt-0 (pass 2) — question: accept 500 ChatQueueFailed with owner-line rollback, the YAML→JSON rewrite on POST, and the spend pass's fresh-read merge with a residual sub-ms window? — ruling: accept-deviation score 2 — do: keep A and B as built; record the window as a risk in the deviation log and the chatSpendPass header; no lock in 32-2; rerun bun test and conformance — rule candidate: a non-serve pass rewriting engagement.yaml re-reads right before its atomic write, merges only the fields it owns and records the window as a risk until a shared record lock exists; a route rolling back its own chat line does it in the same synchronous chat.lock callback

- 2026-10-25T06:21:05Z — trigger: deviation-gt-0 (follow-up review pass) — question: accept the four follow-up patches (ChatUnwritable refusal in engage.py, spend pass grouped by payload project_root, honest read→rename wording, project_root in the 0.1.27 header and worktree wording) at score 1, 2, or reject? — ruling: accept-deviation score 1 — do: add `ChatUnwritable` after `ChatBusy` in the tk-studio-engage row blocked cell (driver-contract.md:389), no version bump; keep the other three fixes, record no DRIFT; rerun conformance and the lib suite — rule candidate: a refusal reason added to a lib surface whose contract row is in the story's own unreleased version is named in that row's blocked cell in the same patch, scored 1 with no DRIFT; in a released version it is 2 with a DRIFT
- 2026-10-25T06:39:14Z — trigger: deviation-gt-0 (follow-up review pass 2) — question: accept the two score-1 patches (the spend pass skips on a non-ENOENT ledger read error; `read_chat` skips a non-finite seq) at score 1, 2, or reject? — ruling: accept-deviation score 1 — do: keep both patches with no DRIFT line; leave the README and driver-contract.md spend-pass wording unchanged (neither mentions a ledger read error); finish the pass once conformance passes — rule candidate: a review patch that only makes an error path inside the story's own unreleased contract surface safer (skip, no write, no throw), adds no shape and contradicts no doc sentence is score 1 with no DRIFT and needs no consult

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version); run the release motion: bump plugin.json, marketplace.json, and released-roster.json in lockstep (version gate + skill roster together); routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5 (effort medium, advisor off on every leg; `pipeline.py resolve`); knowledge spine absent

**Summary.** A second follow-up review pass on the committed 32-2 implementation (HEAD 2f0375e). Blind-hunter and edge-case-hunter reviewed `290ee99..HEAD` and gave 6 unique findings. Five were patched and one rejected. No verb, payload, refusal name, schema or version changed.
- The skill now tells the planner to read every indexed memory file at `<project_root>/<path>`, the served root, not its worktree cwd. It also lists `ChatUnwritable`.
- The spend pass no longer zeroes `spend.planning_usd` on a ledger read error other than ENOENT. It skips the pass.
- `engage.py` skips a chat line with a non-finite `seq` instead of crashing without a status block.
- The queue-`run_id` rule at the invoke site has an always-run test.

**Files changed**
- `plugins/tk-studio/skills/tk-studio-engage/SKILL.md`: the `<project_root>/<path>` read base; `ChatUnwritable` in the blocking conditions.
- `plugins/tk-studio/lib/engage.py`: `read_chat` skips a non-finite `seq`.
- `plugins/tk-studio/lib/tests/test_engage.py`: covers the NaN and Infinity `seq` lines in both modes.
- `apps/supervisor/src/chat.ts`: only ENOENT on the ledger counts 0; any other read error skips the pass.
- `apps/supervisor/test/chat.test.ts`: the EISDIR ledger case, and an always-run `finishRun` queue-`run_id` test.

**Review.** blind-hunter gave 3 findings and edge-case-hunter 3, for 6 unique. Patched: 5 (medium 1, low 4). Deferred: 0. Rejected: 1 (stacked turns after a terminal state; the intent names the terminal refusal only at POST). One consult ran, on deviation-gt-0, and ruled accept-deviation score 1, with no DRIFT.
Follow-up review: recommended (true). Patched medium 1 and low 4, for a score of 3×1 + 4 = 7, which is at least 5.

**Verification** (run by this session after the patches)
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib): 1838 ran, 3 failed, 2 skipped. The 3 failures are exactly the released-roster guards, red by design: `test_release_roster` `test_repo_roster_rides_the_version_gate`, and `test_drift_check` `SkillsDirPlaneTestCase` `test_plane_carries_the_case_and_maps_its_status` and `test_plane_stays_ok_on_the_real_repo_with_the_folder_linked`. They stay unverifiable-here until the operator runs the release motion (`tools/release_archive.py`, `claude plugin tag`).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `bun test` (apps/supervisor, `~/.bun/bin` on PATH, `TK_STUDIO_ROOT` set, `TK_ATLASSIAN_*` unset): 1263 pass, 5 skip, 0 fail, across 27 files.
- The implementer also ran `bun test test/chat.test.ts` without `TK_STUDIO_ROOT`: 17 pass, 1 skip (the gated real drive). The new `finishRun` test runs.
- `bun node_modules/typescript/bin/tsc --noEmit`: clean.
- `0.1.27 (Story 32.2)` is present in `driver-contract.md` once, and `**0.1.28**` counts 0. `/chat/` hits both the contract (4) and the README (5). `git status` named only plan Files.

**Residual risks**
- The spend pass's fresh-read→rename window against `POST /engagements/{id}/input` remains. A shared record lock is left to 32-5/32-8.
- A stacked chat turn still queued when the engagement goes terminal starts a session that ends `blocked` `EngagementClosed`. That costs one short metered run and moves nothing.
- The planner's use of `<project_root>/<path>` is a prompt instruction, not enforced code. The live planner turn stays an attended check after 32.8.
- Carried from earlier passes: a chat turn waits behind any live run on the served root. A failed or refused turn has no chat-level signal.

## Reconcile

### 2026-10-25 — adjust-stories

- Score: 2
- Reasoning: Every DRIFT is additive on the story's own unreleased 0.1.27 entry, and a consult accepted each one. The changes are `stack` only for `engagement-chat`, the queue `run_id`, `project_root`, the GET /chat shape and its refusals, and the fresh-read merge for the spend pass. No AD, schema or recorded ruling is contradicted, and no later acceptance criterion has to change. Six unstarted stories build on these seams and can take them as `invoke_dev_with` notes.
- Affected: 32-3-clarifying-questions-through-the-inbox — "the planner writes `engage.py questions`" (the session runs in a worktree; the served root is `project_root` → `--directory`; the record is JSON; a next planner turn is an `engagement-chat` mint with `stack`)
- Affected: 32-4-the-scope-of-work-on-confluence — "the planner writes `engage.py scope` from the turn's `scope.md`" (same `project_root` rule)
- Affected: 32-5-the-quote-band — "whether scoping was billable (the planning spend so far)" (that is `spend.planning_usd` from the spend pass; a record write re-reads fresh and merges only its own fields)
- Affected: 32-6-approval-autonomy-and-the-first-run — "`spend.runs_usd` sums the engagement's runs' `job-run` costs" (map queue run → `studio_run_id` → ledger `job-run`, merge-only like `planning_usd`)
- Affected: 32-7-the-chat-screen — "the planner's run cost on hover" and "a message box (`POST /chat/{id}`)" (the line's `run_id` is the queue run id; GET /chat is `{ok, project, engagement, since, last_seq, lines}`; refusals 409/500/503)
- Affected: 32-8-delivery-the-closeout-report-and-change-requests — "the planning spend" and "`engage.py closeout`" (same `project_root` and run-id mapping; no shared record lock yet)
- Invariant: none
- Gate: Part A adjust-stories; Part B story accepted, planned 32-3-clarifying-questions-through-the-inbox
