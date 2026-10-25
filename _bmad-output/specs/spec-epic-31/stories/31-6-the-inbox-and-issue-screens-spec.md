---
title: 'The Inbox and Issue Screens'
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_revision: 'dfc33143980a561422eadd6c9cfcc2bc3f61ca3c'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-31/plans/31-6.md'
  - '{project-root}/_bmad-output/specs/spec-epic-31/SPEC.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** As the owner, I want the web's Inbox to list what needs me and its Issue view to let me reply or press Done, so that I answer from the desktop or the iPad without opening Jira (§6.9 items 2 to 4). Canonical: ST-120.

**Approach:** The web gains an Inbox screen over 31.5's `GET /inbox` and an Issue screen over `GET /inbox?project=<id>&issue=<KEY>`, with a reply box and **Done**. Both post through a new supervisor surface `POST /inbox/{key}/reply`, which runs a new host-side `tk-studio-track reply` verb with the owner's host-only token; the verb comments as the owner and moves the issue to `Block Resolved` through `jirabackend` (AD-4). Contract 0.1.26 stays additive (AD-2, AD-19).

## Acceptance Criteria (verbatim, epics.md Story 31.6)

- **AC1:** **Given** `GET /inbox` and the tracked issues **When** the Inbox screen renders **Then** it lists open items sorted as served, each with the project, the issue key and title, the priority, how long it has waited and the reason's first line; the web's nav gains Inbox and Issue; the count sits on the nav item.
- **AC2:** **Given** one item **When** the Issue screen opens **Then** it shows the issue Jira-like (status, the run and PR when the plan links one, the cost from the ledger when known, the comments in order with author and time), a reply box, and a **Done** button for a simple request; sending a reply, or Done (which writes "Done." as the owner), posts the comment through the supervisor (`POST /inbox/{key}/reply`, the owner's token, never the agent's) and moves the issue to `Block Resolved`; the item leaves the list on the next sync-back; vitest covers the list, the view and the two actions with a fixture.

## Boundaries & Constraints

**Always:**
- Carried notes (binding): the owner seat is `TK_STUDIO_ATLASSIAN_OWNER_TOKEN` + `TK_STUDIO_ATLASSIAN_OWNER_EMAIL`, host-only (outside the `TK_ATLASSIAN_` prefix, never passed into the sandbox), used through the gateway `https://api.atlassian.com/ex/jira/<cloud id>` so the author accountId is the owner's. Either absent → refuse by name, never post with another identity.
- `GET /inbox?project=<id>` serves `inbox.json` v1 as written; list only `state === "open"` items, in served order; the nav badge counts those. A missing file / empty inbox is not an error. `OfficeAgent.blocked_issue` is `{issue, state}` or `null`.
- The plan's four Settled shapes (plans/31-6.md, mirrored in SPEC.md Design notes CAP-11/CAP-12) are the binding design: the issue read, `POST /inbox/{key}/reply`, `track.py reply`, and the web.
- House rules: stdlib-only Python via `uv run`; atomic writes; every headless surface ends with the §3 JSON status block; credentials never in tracked files, events or command lines (the reply body goes in a temp file); nothing in the plugin imports the supervisor. Tests use fake Atlassian REST only.
- Touch only the plan's Files list.

**Block If:**
- The owner's token would have to reach the sandbox, or any surface would post as the owner with the agent's token.
- The reply needs an Atlassian write outside `jirabackend` (AD-4), or the supervisor would call Jira itself.
- The Issue view needs a supervisor surface besides `GET /inbox` (with `issue`) and `POST /inbox/{key}/reply`.
- The Files list must grow past the plan's list.

**Never:** edit `released-roster.json`, `epics.md`, `stories.yaml`, SPEC.md, plan files, `.bmad-loop/routing.toml`/`policy.toml`, or anything under `supervision/`; push, tag, or run the release motion; office changes; promote anything local to Atlassian beyond the reply and its transition; write a queue event from the reply.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Inbox list | `inbox.json` with open, resolved, validating items over 2 projects | rows = open items only, served order per project, projects in `projectsFrom` order; badge = row count | missing file → no rows, no badge |
| Issue read | `GET /inbox?project=p&issue=ST-1` | `{ok, project, generated_at, items:[match], issue:{key, entity, title, status, run, cost_usd, comments[]}}`; comments last line per `id`, `created` order; cookie session gets `X-CSRF-Token` header | bad key → 400 `BadIssue`; no item/entity/log → 404 `UnknownIssue` |
| Reply | `POST /inbox/ST-1/reply {project, body}` with CSRF | runs `track.py reply --body-file <tmp>`; 200 `{ok, project, issue, commented, transitioned, status}` | owner var/cloud id absent → 409 `OwnerSeatMissing {missing}` no spawn; no CSRF → 403 `CsrfRefused`; both/neither body/done or >32 KiB → 400 `SchemaError`; verb blocked → 409 `ReplyRefused`; retry → 503 `ReplyRetry`; no JSON → 500 `ReplyFailed`; unknown project → 404 `UnknownProject` |
| Done | `{project, done: true}` | comment body `Done.`, then transition | as Reply |
| Verb, no env | `track.py reply --issue ST-1 --done`, owner vars unset | `blocked`, exit 2, names the absent variables, "no Atlassian call made" | — |
| Verb, wrong seat | created comment `author.accountId` ≠ `owner_account_id` | `blocked`, named, no transition | — |
| Verb, already resolved | issue in `Block Resolved` | comment posted, transition in `skipped[]` | — |
| Verb, no transition | no transition reaches `Block Resolved` | `blocked`, `commented: true` | — |
| Verb, transient | 429/5xx | `partial`, `ok: false`, `retry: true` | — |

</intent-contract>

## Code Map

The plan's Code Map (`plans/31-6.md` §Code Map) is the investigation and is binding; anchors re-checked 2026-10-24:
- `plugins/tk-studio/lib/jirabackend.py` -- L66-72 env names + the "owner names never read" comment (change it); `JiraClient.for_gateway` L373 (agent env names hard-coded; add an owner-seat builder passing owner `token_env`/`email_env`); `_current_status` L636; `RESOLVED_STATUS` L970; `transition_to_name` L1077; `add_comment` L1103 (returns created comment with `author.accountId`).
- `plugins/tk-studio/lib/track.py` -- `_result` L59, `_finish` L64, `resolve_story` L109, `main` L300, `block` subparser L306 (add `reply` beside it); env/binding gaps via `plansync` helpers as `block` does.
- `plugins/tk-studio/lib/syncback.py` `log_comments` L236 and `inbox.py` -- read-only; comment-log and inbox v1 shapes.
- `apps/supervisor/src/api.ts` -- route doc header, `csrfGiven` L664, `cookieRoute` L672 (POST branch beside cancel), `/inbox` route L748; `ApiDeps` seams (`issueRead?`, `reply?`); `deps.inbox` root lookup to factor out. `auth.ts` `csrfToken` L72.
- `apps/supervisor/src/office.ts` `INBOX_REL`/`InboxFile`/`readInbox` (import into new `inbox.ts`); `board.ts` `readPlan`, `boardFor`, `jobRunCosts`, `ledgerPath`.
- Subprocess pattern: `closeout.ts` `trackBlock` (`uvRunner`, `studioScript(deps,"lib","track.py")`, `lastJsonObject`); `server.ts` `runUv`, `userEnvFromRegistry` (fill the three reply vars when absent).
- Web: `screen.ts` L7 `SCREENS`, `screen.test.ts`; `App.tsx` `SCREEN_LABEL`, nav, switch; copy `board/model.ts` (`fetchBoard`, `FetchLike`, refetch key) and `office/model.ts` (`projectsFrom`, `rememberedProject`, `StorageLike`, `safeHref`). Vitest is `environment: "node"`: pure model functions; `.tsx` is composition only.
- Contract: `driver-contract.md` header 0.1.26 entry (append 31.6 clause), §1 inbox row (+`issue` query, CSRF header), new reply row, §2 `tk-studio-track` row (+`reply`); `conformance/manifest.json` `tk-studio-track` (no-env `reply` drive).
- Tooling: `PATH="$HOME/.bun/bin:$PATH"`; `bun node_modules/typescript/bin/tsc --noEmit`, `bun node_modules/vitest/vitest.mjs run` (no `.bin` links).

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/jirabackend.py` -- owner-seat client builder `(client | None, gaps)` reading the owner vars + `TK_ATLASSIAN_CLOUD_ID`; update L71 comment -- Settled shape 3.
- `plugins/tk-studio/lib/track.py` -- `reply` verb, refusals, result `{ok, dry_run, issue, commented, comment_id, transitioned, status, notes[], skipped[], written[]}` + §3 block -- Settled shape 3.
- `plugins/tk-studio/skills/tk-studio-track/SKILL.md` -- document `reply`.
- `plugins/tk-studio/contracts/driver-contract.md`, `conformance/manifest.json` -- 31.6 clause, rows, `reply` drive (AD-19).
- `plugins/tk-studio/lib/tests/test_track.py`, `test_jirabackend.py`, `test_driver_contract.py` -- reply (comment, transition, skip, each refusal, wrong seat, transient, dry run), owner client env names/gaps, contract clause/rows.
- `apps/supervisor/src/inbox.ts` (new), `src/api.ts`, `README.md`, `test/inbox.test.ts` (new), `test/api.test.ts` -- Settled shapes 1-2 and the I/O matrix rows.
- `apps/studio-web/src/screen.ts`, `screen.test.ts`, `App.tsx`, `inbox/{model.ts,model.test.ts,InboxScreen.tsx,fixture.ts}`, `issue/{model.ts,model.test.ts,IssueScreen.tsx}` -- Settled shape 4; fixture = one `inbox.json`-shaped answer + one issue answer.

**Acceptance Criteria:**
- Given the fixture, when the Inbox model derives rows, then only open items appear in served order with project, key, title, priority, waited and the reason's first line, and the nav count equals the row count (vitest).
- Given the issue fixture, when the Issue model builds the view, then status, run state + PR link, cost (or "not metered") and comments in order with author and time are present (vitest).
- Given a reply or Done, when `postReply` runs, then it POSTs `/inbox/{key}/reply` with the CSRF header and body `{project, body}` or `{project, done: true}`, never throws, and names the supervisor's `error` (vitest).
- Given the supervisor, when `POST /inbox/{key}/reply` is called, then each I/O row's status code holds (bun test) and the verb's env holds the owner vars only on the host.
- Given the lib, when `track.py reply` runs against fake REST, then each verb row of the I/O matrix holds (unittest).

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- Layers: blind-hunter and edge-case-hunter (band L). Raw findings: 7 + 4; after deduplication, 8.
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 1, medium 2, low 3)
- defer: 0
- reject: 2 (medium 1, low 1)
- addressed_findings:
  - `[high]` `[patch]` The owner seat vars, set in the supervisor's env, reached host-tier workers. `buildWorkerEnv` now strips `TK_STUDIO_ATLASSIAN_OWNER_*`, with a `tier.test.ts` test. Consult: accept-deviation score 2, Files +2.
  - `[medium]` `[patch]` A retry after a transient transition failure, or a second Done, posted a duplicate owner comment. `reply` now skips an identical owner comment standing after the newest agent comment (read live), named in `skipped[]`. The 503 body carries `commented`.
  - `[medium]` `[patch]` The Issue screen kept the reply text, notice and CSRF across an issue change. All are now reset on change, and a late answer is dropped.
  - `[low]` `[patch]` Send and Done were enabled before the view and CSRF had loaded. Now gated by `canAct`/`canSendReply` (tested).
  - `[low]` `[patch]` After a successful reply, the buttons re-enabled. They now stay disabled with the "sent" notice until the issue changes.
  - `[low]` `[patch]` `issueRead` let registry and board failures escape. Now `500 IssueReadFailed` (redacted detail), in the contract §1 row and tests.
- rejected:
  - Reply moves an issue to `Block Resolved` from any status. Settled shape 3's refusal list is the settled design: the screen is reached from an open inbox item, and a missing workflow transition already refuses by name.
  - The Inbox refetch misses a sync-back. The key moves with a project's runs, and every `atlassian-sync-back` tick is a queue run, so the key moves on each sync-back.

### 2026-10-25 — Review pass (follow-up)
- Layers: blind-hunter and edge-case-hunter (band L), over `git diff dfc33143980a561422eadd6c9cfcc2bc3f61ca3c -- apps plugins` (2,710 lines, handed over as a file path because of its size; the blind hunter was told to read nothing else). Raw findings: 6 + 1. None duplicated, so 7.
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 0, low 5)
- defer: 0
- reject: 2 (medium 1, low 1)
- addressed_findings:
  - `[low]` `[patch]` Every `500 ReplyFailed` detail and passed-through reason returned child stderr and messages unredacted. `inbox.ts` `redactReply` now replaces the owner seat values and every `TOKEN`/`SECRET`/`PASSWORD` env value, plus `redactCredentials`, before the clip (inbox.test.ts).
  - `[low]` `[patch]` Every Inbox reason showed raw `[~accountid:…]` mention markup. `inbox/model.ts` `reasonLine` strips Jira mention tokens, then takes the first non-empty line, else `—` (model.test.ts; consult accepted at score 1).
  - `[low]` `[patch]` The `reply` dry run predicted a post that the real run would skip. The dry run now makes the same read-only `owner_reply_in_place` check and names the skip in `skipped[]` (test_track.py).
  - `[low]` `[patch]` A `GET /agents` error was erased by the next inbox refetch. `useInbox` keeps it in its own state, listed before the inbox errors.
  - `[low]` `[patch]` Two concurrent replies to one issue both posted. `postReply` now runs one at a time per `(project, key)`: a failure does not block the next call, and the map entry is dropped when the chain drains (inbox.test.ts).
- rejected:
  - `[medium]` The reply does not check that the issue is blocked or that its key matches the project. Same as the first pass: Settled shape 3's refusal list is the settled design. The request is the owner's own authenticated action with their own token, and the screen is reached from an open inbox item.
  - `[low]` The reply child gets the supervisor's whole env and runs `uv run` in the project root. This is the same env and cwd as every host-side studio-script spawn (`server.ts` `runUv`), so it was not caused by this story. The 00:26 consult limited the owner-var strip to `buildWorkerEnv` and left the reply child's env alone.

### 2026-10-25 — Review pass (second follow-up)
- Layers: blind-hunter and edge-case-hunter (band L), over `git diff dfc33143980a561422eadd6c9cfcc2bc3f61ca3c -- . ':(exclude)_bmad-output'` (2,840 lines, handed over as a file path because of its size; the blind hunter was told to read nothing else). Raw findings: 5 + 6. After deduplication, 10 (the key-vs-project check was reported by both).
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 0, low 4)
- defer: 0
- reject: 6 (medium 3, low 3)
- addressed_findings:
  - `[low]` `[patch]` The Issue screen marked a comment as the owner's from `author` alone, against the 31.5 clause "owner only when both are". `issue/model.ts` `commentAuthor` now needs `update_author` absent or `owner` too (model.test.ts).
  - `[low]` `[patch]` A refusal after the comment landed (wrong seat, or no transition) re-enabled Send and Done, so each press posted another comment. `409 ReplyRefused` now carries `commented`. The web treats a failure with `commented: true` as sent (`sentAfter`) and keeps the actions disabled until another issue is chosen (inbox.test.ts, model.test.ts; contract §1 row, README, api.ts header; consult accepted at score 1).
  - `[low]` `[patch]` The Inbox said "Nothing needs you." before `/agents` and the first inbox read had answered. `useInbox` now reports `loaded`, and `inboxNotice` shows "Loading…" until then (inbox/model.test.ts).
  - `[low]` `[patch]` A cookie session's `GET /inbox` `400 ProjectRequired` carried no `X-CSRF-Token`, against the contract's "any `GET /inbox`". It now goes through the same header step; a bearer 400 still has none (api.test.ts).
- rejected:
  - `[medium]` The reply does not check that the key belongs to the project or the project's inbox (both layers). This is the third time: Settled shape 3's refusal list is the settled design.
  - `[medium]` The reply moves an issue that is not `Blocked - Awaiting User` back to `Block Resolved`. Same settled design, rejected in pass 1.
  - `[low]` Send and Done are not gated on the item's state being `open`. This is the same claim made at the web layer: the screen is reached from an open inbox item, and Settled shape 3 settles the verb's refusals.
  - `[low]` The Inbox refetch misses a sync-back that resolves an item not tied to an agent's current story. Rejected in pass 1: the key includes each project's runs, and every `atlassian-sync-back` tick is a queue run.
  - `[low]` After a reply, the nav count and the list are not refetched at once. AC2 says the item leaves the list on the next sync-back, and the screen says so.
  - `[medium]` An agent token in the owner variable posts as the agent before the author check refuses. The I/O matrix row "Verb, wrong seat" (post, then check the created comment's author, nothing moved) is the intent contract's design.

## Design Notes

- The 31-1 carry says `/rest/api/3`; the adapter's prefix is `/rest/api/2` (`jirabackend.API_PREFIX`), which the contract keeps. The plan's Settled shape 3 rules `/rest/api/2`, plain-text body: the gateway and cloud id are what make the author the owner. Recorded as a DRIFT.
- The item leaves the Inbox on the next sync-back because 31.5 derives `Block Resolved` as `resolved`; the web shows "sent; it leaves the Inbox on the next sync-back" and writes no local state.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green except the 3 released-roster guard tests (red by design, unverifiable-here).
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`, incl. the `reply` drive.
- `env -u TK_STUDIO_ATLASSIAN_OWNER_EMAIL -u TK_STUDIO_ATLASSIAN_OWNER_TOKEN -u TK_ATLASSIAN_CLOUD_ID uv run plugins/tk-studio/lib/track.py reply --directory . --issue ST-1 --done` -- expected: `blocked`, exit 2, names the variables, "no Atlassian call made".
- `cd apps/supervisor && bun test <file>` (one file at a time, private TMPDIR, `TK_STUDIO_ROOT` set) and `bun node_modules/typescript/bin/tsc --noEmit` -- expected: green.
- `cd apps/studio-web && bun node_modules/vitest/vitest.mjs run` and `bun run build` -- expected: green.
- `git grep -n -E "ATATT3|_TOKEN=[^ ]" -- plugins/ apps/ _bmad-output/specs/spec-epic-31/` -- expected: only pattern text.
- `git status --porcelain` -- expected: only the Files list.

**Manual checks (unverifiable here):**
- Operator sets the two owner variables on the host, replies to a blocked issue from the Inbox (desktop and iPad), checks in Jira that the comment author is the owner and the status is `Block Resolved`; after the next sync-back the item has left the Inbox.

## Deviation Summary

### pass 1 (2026-10-25, implementer)

- planned: refusal order binding, then owner env, then owner_account_id / actual: the owner-variable check runs first / why: the spec's Verify command runs on the repo root, which has no `planning.jira` binding, and must still name the variables / may affect: none
- planned: run the verb through `uvRunner`/`runUv` like `trackBlock` / actual: `inbox.ts` calls `runProcess("uv", …)` with an explicit env behind a `ReplyRunner` seam / why: `runUv` always passes `process.env`, so the User-environment fill for the three reply variables could not reach the child / may affect: none
- planned: cost via `board.ts` `jobRunCosts`/`ledgerPath` / actual: `ledgerPath` reused; a new `runCost` in `inbox.ts` reads the `job-run` line / why: `jobRunCosts` folds unmetered into 0, and `board.ts` is outside Files / may affect: none
- planned: reply result `{…, status, …}` plus the §3 block / actual: one `status` key, the §3 status, passed through by the supervisor's 200 / why: the names collide; Settled shape 3 gives no separate Jira-status field / may affect: none
- planned: reply route answers per the I/O matrix / actual: also `400 BadIssue` (malformed key) and `400 MalformedJson` (non-JSON body) / why: same guards as the issue read and `POST /jobs`; additive / may affect: none
- planned: §2 `tk-studio-track` row extended with `reply` / actual: reply's result and refusals appended to the row's last cell / why: keeps the row layout / may affect: none
- planned (carried note): `…/rest/api/3` / actual: `/rest/api/2` plain text via the gateway, per plan Settled shape 3 / why: `jirabackend.API_PREFIX` and the contract's 31.2 clause / may affect: none

DEVIATION SCORE: 1

DRIFT: track.py reply checks the owner variables before the binding — the no-binding Verify command must still name the variables — affects: none
DRIFT: the supervisor spawns `track.py reply` via `runProcess` with an explicit env, not `runUv` — `runUv` passes only `process.env`, so the User-environment fill could not reach the child — affects: none
DRIFT: `inbox.ts` `runCost` reads the ledger `job-run` cost itself, reusing only `ledgerPath` — `jobRunCosts` folds unmetered into 0 and `board.ts` is outside Files — affects: none
DRIFT: the reply result's `status` is the §3 status (no separate Jira-status field) — key collision; Settled shape 3 names one `status` — affects: none
DRIFT: `POST /inbox/{key}/reply` also answers `400 BadIssue` and `400 MalformedJson` — the issue-read and `POST /jobs` guards; additive — affects: none
DRIFT: the §2 tk-studio-track row carries `reply` in its last cell — layout only — affects: none
DRIFT: the owner reply goes through `/rest/api/2` on the gateway, not the carried note's `/rest/api/3` — the adapter's prefix and the contract's 31.2 clause; plan Settled shape 3 — affects: none


### pass 2 (2026-10-25, review patches)

- planned: Files per plan / actual: `apps/supervisor/src/server.ts` (`buildWorkerEnv` strips `TK_STUDIO_ATLASSIAN_OWNER_*`) and `apps/supervisor/test/tier.test.ts` added / why: SPEC Assumptions pin "never hands that token to a worker"; the plan's L31 seam proved only "never the sandbox" (consult ruling, score 2) / may affect: later stories adding host-only secrets
- planned: `reply` skips only the transition when already resolved / actual: also skips an identical owner comment standing after the newest agent comment (read live), named in `skipped[]`, documented in SKILL.md / why: a retry or a second Done otherwise double-posts; scoped to the block cycle so 31-7's re-block reply still posts (consult ruling, score 1) / may affect: 31-7
- planned: route answers per the I/O matrix / actual: also `500 IssueReadFailed`, and `commented` in `503 ReplyRetry`; README and contract rows list both / why: review patch P6/P2; additive / may affect: none

DEVIATION SCORE: 2

DRIFT: `buildWorkerEnv` (server.ts, outside Files) strips `TK_STUDIO_ATLASSIAN_OWNER_*`, tested in tier.test.ts — without it a host-tier worker inherits the owner token, against SPEC's "never hands that token to a worker" (consult: score 2) — affects: any later story adding a host-only secret
DRIFT: `track.py reply` skips an identical owner comment standing after the issue's newest agent comment (read live) — a 503 retry or a second Done otherwise posts a duplicate — affects: 31-7
DRIFT: `GET /inbox?issue=` answers `500 IssueReadFailed` on a registry or board failure, and `503 ReplyRetry` carries `commented` — additive named errors in place of an escaped exception — affects: none

### pass 3 (2026-10-25, follow-up review patches)

- planned: the Inbox reason is the first line of `reason_comment.body` / actual: Jira mention tokens are stripped from the whole body, then the first non-empty line is taken, else `—` / why: the 31.5 block comment starts with `[~accountid:<owner>]`; display cleanup only, the served field is unchanged (consult: score 1) / may affect: none
- planned: `bun run build` / actual: `bun node_modules/vite/bin/vite.js build` (exit 0) / why: no `node_modules/.bin` links, so `vite` is not on PATH; this is a local tooling issue, not a story deviation (consult) / may affect: none

DEVIATION SCORE: 1

DRIFT: the Inbox row's reason strips Jira mention markup before it takes the first non-empty line — the 31.5 block comment leads with `[~accountid:<owner>]` on every row; display only — affects: none

### pass 4 (2026-10-25, second follow-up review patches)

- planned: plan Settled shape 2 pinned `409 ReplyRefused {reason}` / actual: widened additively to `{reason, commented}`, the same shape as 503 ReplyRetry, so a refusal that already commented cannot be posted twice; the contract §1 reply row, README, the api.ts route header and test_driver_contract.py follow, no version bump / why: review patch P2; the verb already reports `commented: true` on the wrong-seat and no-transition refusals (consult: score 1) / may affect: none
- planned: none / actual: `useInbox` returns `loaded` and `InboxScreen` takes a `loaded` prop (wired in App.tsx); `issue/model.ts` adds `sentAfter(r)` and `commentAuthor` / why: review patches P3, P2, P1; web-internal / may affect: none

DEVIATION SCORE: 1

DRIFT: `409 ReplyRefused` carries `commented` beside `reason` (plan Settled shape 2 pinned `{reason}`) — a refusal after the comment landed otherwise lets each retry post a duplicate — affects: none

## Consult Log

- 2026-10-25T00:13:05Z — trigger: deviation-gt-0 — question: accept the implementer's seven pass-1 deviations (env-before-binding, runProcess with explicit env, single §3 status key, additive 400s, /rest/api/2) at score 1? — ruling: accept-deviation score 1 — do: keep all seven DRIFT lines; in the driver-contract §1 reply row, state that the 200 `status` is the §3 status, not the Jira status, and list the additive 400s (BadIssue, MalformedJson) — rule candidate: when a result JSON carries the §3 status block, a domain status takes a field name other than `status` (e.g. `jira_status`)
- 2026-10-25T00:26:05Z — trigger: high-severity-finding + file-outside-files — question: the owner seat vars, set in the supervisor's env, reach host-tier workers via buildWorkerEnv; patch server.ts (outside Files), defer, or escalate? — ruling: accept-deviation score 2 — do: in server.ts buildWorkerEnv delete every TK_STUDIO_ATLASSIAN_OWNER_* key beside the TK_SUPERVISOR_* strip (only that function; not runUv or the inbox.ts reply child); add a test in tier.test.ts or auth.test.ts that both owner vars are gone and TK_ATLASSIAN_CLOUD_ID survives; grow Files by exactly those two paths and record it as a correction to the plan's L31 claim — rule candidate: a story adding a host-only secret lists server.ts (buildWorkerEnv strip) and its strip test in Files
- 2026-10-25T00:31:03Z — trigger: deviation-gt-0 — question: accept the reply duplicate-skip narrowed to an identical owner comment after the newest agent comment, and must SKILL.md/contract name it? — ruling: accept-deviation score 1 — do: keep the narrowed skip; add one sentence to the SKILL.md reply paragraph (skip named in skipped[] with commented: true and the existing comment_id, only when an identical owner comment stands after the newest agent comment, read live; a reply to a later re-block always posts); leave driver-contract §2 as is — rule candidate: an idempotency skip a track verb adds against live Jira comments is scoped to the current block cycle, named in skipped[] and written in the verb's SKILL.md paragraph (score 1, no consult)
- 2026-10-25T00:48:21Z — trigger: deviation-gt-0 — question: accept the follow-up patch making the Inbox reason strip Jira mention tokens from the whole body, then take the first non-empty line (and the direct vite build entry)? — ruling: accept-deviation score 1 — do: keep `reasonLine` as written; ensure model.test.ts pins the canonical, mention-only-first-line and mention-only cases (it does: L50, L52, L53); record the vite build workaround as tooling, the build gate passed — rule candidate: in display-only text derivations, "first line" means the first non-empty line after display cleanup; score-1 local, no consult, while the served or stored field is unchanged
- 2026-10-25T00:58:13Z — trigger: deviation-gt-0 — question: accept pass 4's patches at score 1 (409 ReplyRefused widened to {reason, commented} in the unreleased 0.1.26 reply row, no version bump; useInbox `loaded`; sentAfter/commentAuthor)? — ruling: accept-deviation score 1 — do: keep P2 as applied (inbox.ts, contract §1 row, README, api.ts header, test_driver_contract.py), no contract version bump, keep P1/P3/P4; record "plan Settled shape 2 pinned `409 ReplyRefused {reason}`; widened additively to `{reason, commented}`, the same shape as 503 ReplyRetry, so a refusal that already commented cannot be posted twice" — rule candidate: an additive field on a supervisor error body that the current story introduced inside the still-unreleased contract entry, matching a sibling error's existing shape, is score 1 with no version bump and needs no consult (observe record ok)

## Auto Run Result

Status: done
Blocking condition: none

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** This was the second follow-up review pass on the finished story; the last pass recommended one (score 5). The story lets the owner answer a blocked story from the web without opening Jira:
- The Inbox screen lists open `GET /inbox` items, and the nav shows their count.
- The Issue screen shows the issue the way Jira does, with a reply box and **Done**. Both post through `POST /inbox/{key}/reply`.
- The supervisor runs the host-side `tk-studio-track reply` verb with the owner seat. It comments as the owner and moves the issue to `Block Resolved` through `jirabackend`. Contract 0.1.26 stays additive.

This pass applied 4 low-severity patches:
- A comment counts as the owner's only when both `author` and `update_author` are the owner.
- A refusal that already commented now carries `commented`, and the web then keeps Send and Done disabled.
- The Inbox shows "Loading…" until its first read has answered.
- A cookie session's `400 ProjectRequired` now carries the CSRF header.

**Files changed in this pass:**
- `apps/studio-web/src/issue/model.ts`: `commentAuthor` (honours `update_author`); the failed `ReplyResult` carries `commented`; `sentAfter`.
- `apps/studio-web/src/issue/IssueScreen.tsx`: a failure with `commented: true` marks the issue sent, clears the box and reads the issue again.
- `apps/studio-web/src/issue/model.test.ts`: the author cases, `commented` on 409 and 503, and the `sentAfter`/`canAct` gate.
- `apps/studio-web/src/inbox/model.ts`: `inboxNotice` with the loading and empty texts.
- `apps/studio-web/src/inbox/InboxScreen.tsx`: `useInbox` reports `loaded`; the screen shows `inboxNotice`.
- `apps/studio-web/src/inbox/model.test.ts`: the `inboxNotice` cases.
- `apps/studio-web/src/App.tsx`: passes `loaded` to the Inbox screen.
- `apps/supervisor/src/inbox.ts`: `409 ReplyRefused {reason, commented}`.
- `apps/supervisor/src/api.ts`: `400 ProjectRequired` gets the CSRF header step; the route doc header names the 409 body.
- `apps/supervisor/test/inbox.test.ts`, `apps/supervisor/test/api.test.ts`: the 409 `commented` cases; the cookie 400 with the header, the bearer 400 without.
- `apps/supervisor/README.md`, `plugins/tk-studio/contracts/driver-contract.md` (§1 reply row), `plugins/tk-studio/lib/tests/test_driver_contract.py`: `ReplyRefused {reason, commented}`, no version bump.

All of these are in the plan's Files list. The story-wide file list is in the first pass's record, in git history at 01132eaf2a73166033a2f59555cc54add8e5c7f3.

**Review:**
- Both layers ran (band L): 11 raw findings, 10 after deduplication.
- Patches: 4 (high 0, medium 0, low 4). Deferred: 0. Rejected: 6.
- Follow-up review recommended: false. The score is 3×0 + 1×4 = 4, below the threshold of 5.

**Verification** (run by this session after the patches):
- **Lib suite:** 1775 run, OK, 2 skipped.
- **Conformance:** `ok: true`.
- **No-env `track.py reply --directory . --issue ST-1 --done`:** `blocked`, exit 2. It names all three variables and says "no Atlassian call made".
- **Supervisor,** one file at a time on a private `/tmp` TMPDIR with `TK_STUDIO_ROOT` set and every `TK_ATLASSIAN_*`/`TK_STUDIO_ATLASSIAN_*` var unset: `inbox` 14, `api` 64, `tier` 44, `guards` 57, `office` 64 and `queue` 90, all passing.
- **Typecheck:** `tsc --noEmit` is clean in both apps.
- **studio-web:** vitest 10 files, 134 tests passed. `bun node_modules/vite/bin/vite.js build` exits 0 (chunk-size warning only).
- **Token grep:** pattern text in the plans and specs, plus placeholders in files this story did not touch (`apps/supervisor/.claude/skills/wds-6-asset-generation/…`, `test_installer_apps.py`). No credentials.
- **`git status`:** only Files-list paths and this spec.

**Unverifiable here:**
- `closeout.test.ts`, `worktree.test.ts` and `command-line.test.ts` were not rerun, because inodes on the root overlay are scarce (the first pass recorded ENOSPC failures in these files). This pass touched nothing they cover. The operator reruns them with `cd apps/supervisor && TK_STUDIO_ROOT=$PWD/../.. bun test test/closeout.test.ts test/worktree.test.ts test/command-line.test.ts`.
- **A live reply and Done on the site, and the screens on the desktop and the iPad:** the operator sets `TK_STUDIO_ATLASSIAN_OWNER_EMAIL` and `TK_STUDIO_ATLASSIAN_OWNER_TOKEN` on the host. They reply to a blocked issue from the Inbox, then check in Jira that the comment's author is the owner and the status is `Block Resolved`. After the next sync-back, the item has left the Inbox.

**Residual risks:**
- The owner-comment and transition REST shapes are pinned only in fakes.
- A reply on a non-blocked issue, or on a key outside the project, still posts and transitions. This has now been rejected three times as settled design.
- The reply serialisation lives in one supervisor process. Replies through two supervisors could still race.
- The reply child inherits the supervisor env and the project-root cwd, as `runUv` does.

DRIFT: `409 ReplyRefused` carries `commented` beside `reason` (plan Settled shape 2 pinned `{reason}`) — a refusal after the comment landed otherwise lets each retry post a duplicate — affects: none

## Reconcile

### 2026-10-25 — adjust-stories

- Score: 2
- Reasoning: Ten of the twelve distinct DRIFT lines are local (additive named errors on the unreleased 0.1.26 rows, the single §3 `status` key, `/rest/api/2` on the gateway, web display cleanup) and nothing later relies on them. Two touch later work. The `buildWorkerEnv` owner-seat strip means a host-tier worker never holds the owner token, so 31-7's `validate-resolution` job (host tier) must act on the agent seat only and cannot call `track.py reply`. The reply verb's duplicate skip is scoped to the block cycle: 31-7's follow-up must be a new agent comment (via `track.py block`), so the owner's next reply posts. No acceptance criterion changes, so a note in 31-7's `invoke_dev_with` absorbs both. The server.ts strip enforces SPEC's "never hands that token to a worker" and contradicts no AD.
- Affected: 31-7-validation-of-a-resolution — "the session reads the reason and the reply" (a repeated identical owner reply is skipped, not posted, and the validation worker holds no owner seat)
- Invariant: none


Gate: Part A adjust-stories; Part B story accepted, planned 31-7-validation-of-a-resolution
