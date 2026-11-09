---
title: 'Story 39.1: The Web Has Addresses'
type: 'feature'
created: '2026-11-09'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_revision: '71935592a0ec36c5166ff61d451b531254547106'
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-39/plans/39-1.md'
  - '{project-root}/_bmad-output/planning-artifacts/design/studio-design-spec-2026-11-07-front-end/README.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The studio web has no URLs: `App.tsx` picks its screen from a `localStorage` key, the back button does nothing, and no notice the studio sends links into `/app`, so a link from a notice or a chat reply cannot open the page that answers it (addendum §2, §3.3).

**Approach:** A hand-rolled History-API router under `/app` with the addendum's route table (unbuilt screens render "Not built yet: Story 39.N"); the four named notifier senders attach the absolute URL of the answering route from the supervisor's own origin; a signed-in `GET /` lands on `/app/office`; contract 0.1.34 → 0.1.35 (additive).

### Acceptance criteria (verbatim, epics.md "### Story 39.1")

AC1. **Given** the studio web (`apps/studio-web/src/App.tsx`, whose screen is a `localStorage` key today) **When** Story 39.1 lands **Then** the app has a router over history URLs under `/app` (the supervisor's SPA fallback in `apps/supervisor/src/web.ts:60-83` already serves them): `/app` redirects to `/app/office`; `/app/office/<project>`, `/app/board/<project>`, `/app/story/<ST-id>`, `/app/run/<run-id>`, `/app/inbox`, `/app/inbox/<KEY>`, `/app/chat`, `/app/chat/<engagement-id>`, `/app/checkin/<engagement-id>/<n>`, `/app/status`, `/app/settings` resolve to their screens (the ones not yet built render a named placeholder: "Not built yet: Story 39.N"); the nav sets the URL; back and forward switch screens; the remembered `tk-studio.web.screen` and `tk-studio.web.issue` keys are migrated once and no longer written; `src/screen.test.ts` pins the route table and the redirect.

AC2. **Given** the notifier lines (`apps/supervisor/src/hygiene.ts` one line per terminal run; `approve.ts` and `delivery.ts` the cap and close-out lines; `plugins/tk-studio/lib/track.py block` the Jira block form) **When** a line is sent after this story **Then** it carries the route that answers it (a run's end → `/app/run/<id>`; a block → `/app/inbox/<KEY>`; a cap or close-out → `/app/chat/<engagement-id>`), rendered as an absolute URL from the supervisor's own origin (`TK_SUPERVISOR_TLS_NAME`, else the bind), and the Jira block comment ends with the same URL; a line with no route keeps today's PR or close-out URL; a unit test per sender pins the URL and the contract's notifier section names the field (0.1.35, additive).

AC3. **Given** the home `GET /` (`api.ts`), which serves the built web's `index.html` **When** the owner opens it signed in **Then** it lands on `/app/office`; signed out it lands on the sign-in and returns to the requested route after; the no-JS page at `/status` stays as it is.

## Boundaries & Constraints

**Always:**
- The plan's **Settled shape 1–10** (`plans/39-1.md` §"Settled shape") is the design; implement it as written (router hand-rolled, no new dependency, `package.json`/`bun.lock` unchanged; route table and `PLACEHOLDER` strings exactly; `supervisorOrigin`/`supervisor_origin` rule; `open: <url>` last line of `noticeText`; `\nOpen: <url>` appended inside `track._block_issue` before the skip compare; with no origin every text byte-identical to today).
- Touch only the 25 files of the plan's `## Files`. Any other file is a deviation (consult `file-outside-files`).
- Every new TS pin sets `TK_SUPERVISOR_TLS_NAME`, `TK_SUPERVISOR_BIND`, `TK_SUPERVISOR_PORT` explicitly in its own env (empty string = unset); the Python `SetupTestCase.ENV_KEYS` gains the three.
- Windows host (AGENTS.md): any new text-mode `open()` names `encoding="utf-8"`; no new `path.join`/subprocess; every `bun test` names `--timeout 30000`.
- House rules: stdlib-only Python via `uv run`; atomic writes; credentials never in tracked files.
- Keep `tk-studio.office.project` and `tk-studio.web.chat` keys (not the AC's two).

**Block If:**
- An existing pin outside Files compares a notice / `notified` detail / block comment exactly under a host-inheriting env → consult `file-outside-files`.
- A reader of a block comment other than `inbox.BLOCK_COMMENT_RE`, `_open_blocks`, `sweepdecisions`' answer parser compares the whole body so the trailing `Open:` line breaks it → consult (`bad_spec`).
- The Files list must grow, or the work threatens to need a split → `halt` consult; never split unilaterally.

**Never:**
- Add a router package; change `web.ts`'s SPA fallback; change `/status`; widen any conformance drive; push, tag, PR, or run the release motion; edit `epics.md`, plan files, `stories.yaml`, routing/policy TOML; drop the cookie redirect to satisfy a test.
- Touch notifier lines the AC does not name (claim refusal, auto-resume, stop re-arm, sweep lines).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Landing | `/app`, `/app/`, `/`, `/index.html` | `replaceState` → `/app/office` | — |
| Unbuilt screen | `/app/story/ST-1`, `/app/run/q-1`, `/app/checkin/ENG-001/2`, `/app/settings` | `Not built yet: Story 39.4/39.5/39.7/39.2` | — |
| Chat root | `/app/chat` | strip `Not built yet: Story 39.3` above today's ChatScreen | — |
| Not found | `/app/nope`, `/app/office/a/b`, `/app/story`, `/app/checkin/ENG-001/0`, bad `%` | `No page at <path>` | decode failure → notFound |
| Migration | stored `screen=issue` + valid issue ref, landing route | replace → `/app/inbox/<KEY>?project=<p>`; both keys removed | `removeItem` throw ignored; deep link wins |
| Origin | TLS_NAME `studio.example.ts.net` (port default) | `https://studio.example.ts.net:8787` | bad port → `null` → no route field, text unchanged |
| Origin (bind) | BIND `100.100.1.2`, PORT `9000` | `http://100.100.1.2:9000` | blank values → `null` |
| Run end | terminal run `q-1`, origin set | notice `route_url` = `<origin>/app/run/q-1`, text ends `open: <url>` | PR line stays |
| Cap / close-out | engagement `ENG-001`, project `p` | `route_url` = `<origin>/app/chat/ENG-001?project=p` | close-out reason keeps page URL / `closeout.md` path |
| Jira block | issue `<KEY>-1`, origin set | comment ends `\nOpen: <origin>/app/inbox/<KEY>-1`; same routed body re-block → skipped | no origin → old body |
| Home | cookie `GET /`, built web | `302 location: /app/office`, `cache-control: no-store` | bearer → index.html; unbuilt → page; signed out → 401 sign-in (no `next`); signed-out `/app/<route>` → sign-in with `next` |

</intent-contract>

## Code Map

The investigation is `plans/39-1.md` §"Code Map" (anchors re-read at `81e07286`; HEAD `71935592` adds only loop artifacts). Key anchors:

- `apps/studio-web/src/screen.ts` (:6 `SCREEN_KEY`, :8 `SCREENS`, :23-40 remembered reader/writer) -- becomes the route module (`Route`, `parseRoute`, `routePath`, `PLACEHOLDER`, `NAV`, `createRouter`, `isLanding`, `migrateRemembered`, `issueRefFor`, `engagementRefFor`).
- `apps/studio-web/src/App.tsx` (:31 `officeStore`, :38-52 screen/issue state, :62-83 ternary + nav) -- route-driven rendering via `useSyncExternalStore`.
- `apps/studio-web/vite.config.ts` -- vitest `environment: "node"`: router must take an injected `HistoryLike`.
- `apps/studio-web/src/issue/model.ts` (:22, :37-54), `office/model.ts` (:129-144 keep), `chat/model.ts` (:295-324 keep).
- `OfficeScreen.tsx` (:50, :64-76, :265-272), `BoardScreen.tsx` (:18, :24-38, :78-86), `ChatScreen.tsx` (:30-38, :89-94, :139-155, :268, :299).
- `apps/supervisor/src/api.ts` (:977-1021 `safeNext`/sign-ins, :1097-1137 handler/cookieRoute, :1146 home, :1291 origin in `serve`).
- `apps/supervisor/src/env.ts` (:100-114 `apiBind`/`apiPort`, :202-209 `tlsConfig`).
- `apps/supervisor/src/hygiene.ts` (:144-165 `EndNotice`/`endNotice`, :191-212 `noticeText`, :256-280 notify, :365-376 `notifyEnd`).
- `apps/supervisor/src/approve.ts` (:1315-1321 `defaultNotify`, :1342 scope, :1369-1373 cap notice); `delivery.ts` (:431-462 refusal + close-out).
- `plugins/tk-studio/lib/track.py` `_block_issue` (:419-471; skip compare :448-449, post :460) -- single choke point for every block comment.
- `plugins/tk-studio/lib/tests/test_tracking_setup.py:310-334` `SetupTestCase.ENV_KEYS`.
- `plugins/tk-studio/contracts/driver-contract.md` (line 5 cell + header clause, line 6 rulings, 0.1.34 paragraph :3090-3127, `## 8. Conformance` :3129); `lib/tests/test_driver_contract.py` (59 `**0.1.34**` flips, 11 `assertNotIn("**0.1.35**")` guards deleted, DW-51 test :4002-4057 bound; :2573/:2713 forbid phrase `are a retry, bound or not`).
- Test fixtures: `account.test.ts:61,:166-167` (needs unbuilt `web`), `web.test.ts:76-78,:317-318`, `auth.test.ts:229,:505`, `page.test.ts:208` (unchanged).

## Tasks & Acceptance

**Execution:** exactly the plan's `## Files` list (25 files, none new), each with the action named there and in Settled shapes 1–10:
- `apps/studio-web/src/screen.ts`, `screen.test.ts`, `App.tsx`, `office/OfficeScreen.tsx`, `board/BoardScreen.tsx`, `chat/ChatScreen.tsx`, `issue/model.ts`, `issue/model.test.ts`, `README.md` -- CAP-1 router, nav, migration, resolvers, placeholders.
- `apps/supervisor/src/env.ts`, `hygiene.ts`, `approve.ts`, `delivery.ts`, `api.ts`; `test/hygiene.test.ts`, `approve.test.ts`, `delivery.test.ts`, `web.test.ts`, `account.test.ts`; `README.md` (:71, :324) -- CAP-2 origin + `route_url`, CAP-3 home 302.
- `plugins/tk-studio/lib/track.py`, `tests/test_track.py`, `tests/test_tracking_setup.py` -- `supervisor_origin`, `inbox_route_url`, `with_route` in `_block_issue`; "Story 39.1" cases per plan.
- `plugins/tk-studio/contracts/driver-contract.md`, `lib/tests/test_driver_contract.py` -- 0.1.35 cell, clause, rulings row, paragraph (Settled shape 10), pins incl. `test_0_1_35_story_39_1_the_web_has_addresses`.

**Acceptance Criteria:** AC1–AC3 above, each proven by: AC1 → `screen.test.ts` (route table, redirect, router fake history push/replace/popstate, migration, no writer exported) + `issue/model.test.ts`; AC2 → `hygiene.test.ts`, `approve.test.ts`, `delivery.test.ts`, `test_track.py` "Story 39.1" + `test_driver_contract.py` 0.1.35 test; AC3 → `web.test.ts` "Story 39.1" (+ `account.test.ts` fixture). Live landing/notice/Jira checks are `unverifiable-here` (plan §Verify).

## Spec Change Log

## Review Triage Log

### 2026-11-09 — Review pass
- layers: blind-hunter, edge-case-hunter (band L; both ran on the routed reviewers model claude-opus-5-5, effort medium)
- intent_gap: 0
- bad_spec: 0
- patch: 8 (high 0, medium 3, low 5)
- defer: 0
- reject: 3 (high 0, medium 0, low 3)
- addressed_findings:
  - `[medium]` `[patch]` nav Office/Board on `/app/<screen>/<p>` pushed a duplicate history entry — `navActive` keyed on the screen name, pinned in screen.test.ts
  - `[medium]` `[patch]` Chat project select / unserved reset left the URL naming the closed engagement — `onClose(replace)` → `/app/chat` (push / replace)
  - `[medium]` `[patch]` track.py skip and `validate --fail` compares failed between an unrouted and a routed body (double posts) — `strip_route` on both sides, tests, 0.1.35 wording
  - `[low]` `[patch]` a pasted block comment's `Open:` line answered a question id'd `open` — guard in questions.ts parseAnswers + test (consult: file-outside-files, accepted)
  - `[low]` `[patch]` duplicated EventSource comment in App.tsx — removed
  - `[low]` `[patch]` supervisor README `GET /` row still named "the screen this browser last showed" — reworded to the routed landing
  - `[low]` `[patch]` the Jira link's issue page hid an inbox read failure behind "Not in the inbox" — errors shown, pinned
  - `[low]` `[patch]` a project-less issue link lost its page once the inbox row cleared — resolved project held per key
- rejected: project-less `/app/chat/<id>` falls back to the remembered project before the snapshot — the resolver order is Settled shape 4 as written and the senders always add `?project=`; the studio-web README 30.6 bullet only tagged "replaced" — the plan's Files row asks exactly that; the `tk-studio.web.chat` id no longer seeds an open engagement on `/app/chat` — Settled shape 3 replaces `rememberedEngagement()` with the route's `open`.

### 2026-11-09 — Review pass (follow-up)
- layers: blind-hunter, edge-case-hunter (band L; both on the routed reviewers model claude-opus-5-5, effort medium; the 322 KB diff `71935592..HEAD` minus `_bmad-output/` was handed over as a file path, not inline)
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 2, low 3)
- defer: 0
- reject: 2 (high 0, medium 0, low 2)
- addressed_findings:
  - `[medium]` `[patch]` an address project (deep link, back/forward, notifier link) was shown but never remembered, so nav Board from `/app/office/q` landed on `/app/board/<remembered p>` — Office/Board remember a served address project (`addressProject`), pinned in screen.test.ts
  - `[medium]` `[patch]` a project-less `/app/chat/<id>` loaded before the store snapshot was reset and replaced with `/app/chat` — the served check waits on a null `open.project` (`chatProjectCheck`), pinned
  - `[low]` `[patch]` `/app/office/<unserved>` / `/app/board/<unserved>` fetched a bogus project with a select value missing from its options — replaced (replaceState) by `rememberedProject(projects) ?? projects[0]` once served projects load, pinned
  - `[low]` `[patch]` back/forward to an engagement with a null resolved project opened the id under the previous project — `chatOpenState` opens only under `open.project`, null waits, pinned
  - `[low]` `[patch]` the 0.1.35 paragraph omitted the `parseAnswers` copied-`Open:` guard shipped in pass 2 — one sentence under **The Jira block form:** and two phrase pins in `test_0_1_35_story_39_1_the_web_has_addresses`
- rejected: the `closeout.ts` awaiting-ruling notice carries no route — AC2 names its four senders by file and the spec's Never forbids other notifier lines; an explicit bare `/app/office` on first post-upgrade load takes the migrated screen — Settled shape 5 defines the landing as `office` with no project.

### 2026-11-09 — Review pass (follow-up 2)
- layers: blind-hunter, edge-case-hunter (band L; both on the routed reviewers model claude-opus-5-5, effort medium; the 329 KB diff `71935592..` working tree minus `_bmad-output/` handed over as a file path)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 1, low 3)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` driver-contract §1 rows still described the pre-0.1.35 behaviour: the home row (:111) said a cookie `GET /` serves `index.html`, and the `tk-studio-track` row (:772) omitted the trailing `Open:` line and its `strip_route` compare — additive "0.1.35, Story 39.1" clauses on both rows, with phrase pins in `test_0_1_35_story_39_1_the_web_has_addresses`
  - `[low]` `[patch]` AC1's "`tk-studio.web.issue` no longer written" was asserted by nothing — screen.test.ts "no writer of either key is exported" now checks that `rememberIssue` is not exported from `issue/model` and that no source line `setItem`s the key
  - `[low]` `[patch]` studio-web README's `/app/inbox/<KEY>` route row omitted the inbox-error text (`error <project>: <msg>`) — row matched to `issueRefFor`; the `/app/chat/<engagement-id>` row aligned with the next fix
  - `[low]` `[patch]` `engagementRefFor` fell back to the remembered chat project before the store snapshot arrived, so a project-less `/app/chat/<id>` could open another project's same-numbered engagement first — `undefined` engagements now resolve to project null (wait, via pass 3's `chatOpenState`/`chatProjectCheck`), pinned; App.tsx call-site comment reworded. This reverses pass 1's reject of the same finding (consult 19:06:44Z, accept score 2)

## Design Notes

Why hand-rolled and why `/app/chat` keeps today's ChatScreen under a strip: plan Settled shapes 1–2 and Risks ("Not a Block If"). "The contract's notifier section" does not exist as one section; the field is named in the 0.1.35 paragraph and `apps/supervisor/README.md:324` (Settled shape 9). Band raised S → L by the planner (25 files, ~900 lines); both review layers run.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/studio-web && timeout -k 5 600 bun run verify` -- expected: build + vitest green
- `cd apps/supervisor && timeout -k 5 900 bun test --timeout 30000` (after studio-web build) -- expected: all pass
- `cd apps/supervisor && bunx tsc --noEmit -p .` -- expected: no errors

**Manual checks (unverifiable-here, operator after merge + serve restart):** signed-in `https://<TLS_NAME>:8787/` lands on `/app/office/<project>`; next terminal run's line ends `open: https://<TLS_NAME>:8787/app/run/<id>`; next Jira block comment ends `Open: …/app/inbox/<KEY>`.

## Deviation Summary

### pass 1 (2026-11-09, implementer)

- planned: a block-comment reader outside `BLOCK_COMMENT_RE` / `_open_blocks` / the sweep's answer parser that compares the whole body → stop and consult (`bad_spec`) / actual: found one (`track.validate` `--fail` resume rule, ~`track.py:1541`) and changed it to compare `with_route(follow_body, issue).strip()`; added `Story39_1ValidateRouteTests` and a sentence in the 0.1.35 paragraph / why: fix sits in a listed file and keeps the AC's `Open:` line; without it a repeat `--fail` is no longer refused when an origin is set / may affect: none
- planned: 59 `**0.1.34**` flips, 11 guards deleted, the DW-51 bound / actual: one more pin flipped, the `\*\*0\.1\.34\*\*` regex in `test_carries_its_own_semver_and_change_policy` / why: fails otherwise; the plan's count missed it / may affect: later 39.N stories (none if they stay on 0.1.35)
- planned: `web.test.ts` "Story 39.1" cases / actual: also narrowed the existing "Story 30.6: GET / with a session is index.html" test to bearer only / why: AC3's cookie 302 flips it; the new test pins the cookie case / may affect: none
- planned: `ChatScreen`'s `open` seeds project and id in place of `rememberedEngagement()` / actual: on `/app/chat` (no `open`) the remembered project is still shown, no engagement open / why: avoids a blank project picker until the project list loads / may affect: 39-3-the-studio-chat
- planned: `delivery.ts` sets the same `route_url` as the cap / actual: exported helper `routeOf(deps, project, id)` in `approve.ts`, used from `delivery.ts` / why: one place for the rule / may affect: none

Implementer DEVIATION SCORE: 2

DRIFT: track.validate --fail resume compare routed through with_route — the trailing Open: line otherwise defeats the repeat-fail refusal (a Block If reader) — affects: none
DRIFT: one extra 0.1.34 regex pin flipped in test_driver_contract.py — the plan's count of 59 missed it — affects: none
DRIFT: Story 30.6 web.test.ts cookie GET / case narrowed to bearer — AC3's 302 flips it — affects: none
DRIFT: /app/chat without an open engagement keeps the remembered chat project — avoids an empty picker before projects load — affects: 39-3-the-studio-chat
DRIFT: routeOf helper exported from approve.ts for delivery.ts — one rule for cap and close-out route_url — affects: none

Consult ruling (pass 1): accept-deviation score 2 — the plan's reader list missed the `validate --fail` whole-body compare (`plans/39-1.md:112` checked head-only readers); (B)–(E) local, score 1 each.

### pass 2 (2026-11-09, review patches)

- planned: change only the story's Files / actual: `apps/supervisor/src/questions.ts` (`parseAnswers` copied-`Open:` guard + doc clause) and `apps/supervisor/test/questions.test.ts` (one Story 39.1 case) / why: the block comment's new `Open: <url>` line would answer a question id'd `open` when pasted back, breaking the pinned "a pasted block comment answers nothing" / may affect: none (consult: accept score 1)
- planned: Settled shape 9 — skip compare on `with_route(body)` / actual: `strip_route` on both sides for the `_block_issue` skip and the `validate --fail` repeat refusal; 0.1.35 sentence reworded, three phrase pins replaced / why: an unrouted (no-origin) body never matched its routed copy, so comments and follow-ups were posted twice / may affect: none (consult: accept score 1)
- planned: Settled shape 3 — nav button disabled when `routePath(route)` equals its path / actual: `navActive(route, item)` keyed on the screen name (Office/Board disabled with any project; Inbox/Chat stay enabled on an issue/engagement) / why: on `/app/office/<p>` the literal rule pushed a duplicate history entry (AC1 back/forward) / may affect: 39-3-the-studio-chat (consult: accept score 1)

Pass-2 DEVIATION SCORE: 1 (story overall: 2)

DRIFT: questions.ts parseAnswers guard + questions.test.ts case outside Files — the routed Open: line would answer a question id'd open — affects: none
DRIFT: block skip and validate --fail compares strip the trailing Open: line (strip_route), 0.1.35 wording and three pins updated — a no-origin body never matched its routed copy, double-posting — affects: none
DRIFT: nav active state keyed on the screen name (navActive) instead of the exact path — the literal rule left duplicate history entries on /app/office/<p> — affects: 39-3-the-studio-chat

### pass 3 (2026-11-09, follow-up review patches)

- planned: Settled shape 3 — only the select calls `rememberProject`; the address is replaced only when it has no project / actual: Office and Board also remember a served address project and replace an unserved one by `rememberedProject(projects) ?? projects[0]` (helper `addressProject`, `screen.ts`) / why: the remembered and shown projects drifted (nav Board landed on another project) and an unserved address showed a value missing from the select / may affect: 39-4-the-board-kanban
- planned: Settled shapes 3–4 — `open` seeds and sets `project` and `id`; the served check sat in the `GET /agents` callback / actual: a null `open.project` seeds or sets project null (wait); the served check is its own effect that waits on a null `open.project` (helpers `chatOpenState`, `chatProjectCheck`, `screen.ts`) / why: a project-less `/app/chat/<id>` was closed before the store resolved its project, so AC1's route never opened / may affect: 39-3-the-studio-chat
- planned: `screen.ts` exports as listed in the plan's Files row / actual: three more pure exports (`addressProject`, `chatProjectCheck`, `chatOpenState`) pinned in screen.test.ts / why: testable form of the two fixes above / may affect: 39-3-the-studio-chat, 39-4-the-board-kanban

Implementer DEVIATION SCORE: 1; consult ruling: accept-deviation score 2 (story overall: 2)

DRIFT: address-project and engagement-open resolution moved into screen.ts helpers addressProject / chatOpenState / chatProjectCheck — a served address project is remembered, an unserved one replaced, a null-project engagement link waits instead of closing (Settled shapes 3–4) — affects: 39-3-the-studio-chat, 39-4-the-board-kanban

### pass 4 (2026-11-09, follow-up review 2 patches)

- planned: Settled shape 4 — `/app/chat/<id>`: `?project=`, else the single store project, else the remembered chat project / actual: while the store's engagements snapshot is not in (`undefined`), the project is null and the Chat screen waits; `null`/`[]` still fall back to the remembered project (`engagementRefFor`, screen.ts) / why: engagement ids are per project, so the remembered project's same-numbered engagement opened first / may affect: 39-3-the-studio-chat
- the two additive 0.1.35 clauses on driver-contract §1 rows :111 and :772 (with phrase pins), the `rememberIssue` non-export test and the README rows are no deviation: they bring this story's own unreleased 0.1.35 rows and docs into line with its paragraph and code

Implementer DEVIATION SCORE: 1; consult ruling: accept-deviation score 2 (story overall: 2)

DRIFT: /app/chat/<id> with no ?project= resolves to no project (waits) until the store's engagements snapshot is in; null or [] still falls back to the remembered chat project (engagementRefFor) — ids are per project — affects: 39-3-the-studio-chat

## Consult Log

- 2026-11-09T18:09:08Z — trigger: deviation-gt-0 — question: accept the in-place with_route fix of track.validate's --fail repeat-refusal (a Block If reader) and the four local deviations, or halt bad_spec? — ruling: accept-deviation score 2 — do: keep (A) as written with Story39_1ValidateRouteTests and the 0.1.35 sentence, record the reader as "the plan's reader list missed it"; accept (B)–(E) as score-1 local; add a note to 39-3's plan that /app/chat with no open engagement keeps the remembered project (carried as the DRIFT line's affects: 39-3-the-studio-chat — this session writes only its spec, so it does not edit plans/39-3.md); continue at score 2 — rule candidate: When a Block If guards an appended suffix and the implementer finds a whole-body reader inside a listed file, routing that reader through the same helper the writer uses is accept-deviation score 2 with no consult; halt bad_spec only if the fix needs an unlisted file or would drop the suffix.
- 2026-11-09T18:19:13Z — trigger: file-outside-files — question: fix the review finding that the block comment's new `Open: <url>` line answers a question id'd `open` when the owner pastes the comment back (breaks pinned questions.test.ts:609 "finding 5") in questions.ts/questions.test.ts (outside Files), defer it, or change track.py's line form? — ruling: accept-deviation score 1 — do: add the copied `Open: <url>` guard in questions.ts parseAnswers beside :130-131 plus its doc-comment clause; add one case beside "finding 5" in questions.test.ts (pasted comment with an `open` question → {}; `open: <real option>` still answers); leave track.py's `Open:` line and record both files as a local deviation outside Files (score 1) — rule candidate: when a story adds a line to a Jira block comment, pre-authorise (score 1) the matching copied-line guard in questions.ts parseAnswers plus its test.
- 2026-11-09T18:34:36Z — trigger: deviation-gt-0 — question: accept the review-patch deviations (1) strip_route compares in track.py skip + validate --fail against Settled shape 9, with the reworded 0.1.35 sentence and three replaced phrase pins; (2) navActive keyed on screen name against Settled shape 3? — ruling: accept-deviation score 1 (both) — do: keep the strip_route compares, the reworded paragraph and pins, with the test_track.py row (unrouted newest body → routed re-block skipped; posted comment ends Open:); keep navActive and its screen.test.ts pins; record both against Settled shapes 9 and 3 — rule candidate: a dedup/skip compare on a body with an optional environment-dependent suffix compares with the suffix removed on both sides, and a nav "active" rule keys on the screen name, not the full path.
- 2026-11-09T18:49:55Z — trigger: deviation-gt-0 — question: accept the follow-up patch deviations from Settled shapes 3–4 (addressProject remembers/replaces address projects in Office/Board; chatOpenState/chatProjectCheck make a null-project engagement link wait) and the 0.1.35 sentence on the parseAnswers guard, at score 1, 2, reject, or escalate? — ruling: accept-deviation score 2 — do: keep all four fixes and P5 as written; record one DRIFT line against Settled shapes 3 and 4 at score 2 naming addressProject (affects 39-4-the-board-kanban) and chatOpenState/chatProjectCheck (affects 39-3-the-studio-chat), the three new screen.ts exports being that seam; P5 is no deviation (this story's own unreleased 0.1.35 paragraph, describing the guard accepted at 18:19:13Z) — rule candidate: when a review patch changes how a screen resolves a project or entity from its address and a later story's plan modifies that screen or links that address, score the deviation 2 and name the helper as the seam (observe record: ok)

- 2026-11-09T19:06:44Z — trigger: deviation-gt-0 — question: accept P4 (`engagementRefFor` returns project null while `engagements === undefined`, a refinement of Settled shape 4 that reverses pass 1's reject) at score 1, 2, reject, or escalate? — ruling: accept-deviation score 2 — do: keep P4 as written with its screen.test.ts pins and the App.tsx:56-57 comment; add one DRIFT line against Settled shape 4 (affects 39-3-the-studio-chat) and record the triage as reversing pass 1's reject; count the two additive 0.1.35 contract-row clauses with pins, the rememberIssue test and the README row as no deviation — rule candidate: when an address resolver's fallback chain reads store data that may not have arrived (undefined), returning "unresolved / wait" until it arrives is the plan's own order, not a reorder; accept at score 2 without a consult when a later story's plan links that address or modifies the screen, else score 1 (observe record: ok)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-39-20261109T171223Z-d1df17` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** Second follow-up review pass on Story 39.1. The story was implemented at `ea2f71be` and patched at `4e27b8a9`: the `/app` History-API router, notifier `route_url`s, the cookie `GET /` → `/app/office`, contract 0.1.35. Both layers ran over `71935592..` (working tree). Four patches landed:
- the contract's §1 rows for `GET /` and `tk-studio-track` now carry the 0.1.35 behaviour;
- AC1's "issue key no longer written" is pinned;
- the studio-web README's route rows match the code;
- a project-less `/app/chat/<id>` waits for the store snapshot instead of opening the remembered project's same-numbered engagement.

**Files changed (this pass).**
- `plugins/tk-studio/contracts/driver-contract.md` — additive "0.1.35, Story 39.1" clauses on the §1 home row (:111, cookie 302) and the `tk-studio-track` row (:772, trailing `Open:` line, `strip_route` compare); version cell unchanged.
- `plugins/tk-studio/lib/tests/test_driver_contract.py` — phrase pins for both clauses in `test_0_1_35_story_39_1_the_web_has_addresses`.
- `apps/studio-web/src/screen.ts` — `engagementRefFor` returns project null while `engagements === undefined`; doc comment updated.
- `apps/studio-web/src/screen.test.ts` — pre-snapshot `engagementRefFor` pins; `rememberIssue` not exported, and no source line writes `tk-studio.web.issue`.
- `apps/studio-web/src/App.tsx` — the `engagementRefFor` call-site comment only.
- `apps/studio-web/README.md` — `/app/inbox/<KEY>` row names the inbox-error text; `/app/chat/<engagement-id>` row names the pre-snapshot wait.

**Review findings.** 2 layers (blind-hunter, edge-case-hunter). Patches applied: 4 (medium 1, low 3). Deferred: 0. Rejected: 0.

**Follow-up review recommendation:** true. Patched: high 0, medium 1, low 3. Score 3×1 + 3 = 6 (≥ 5).

**Verification.**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests`: Ran 3120 tests, OK (skipped=5).
- `uv run python ../contracts/conformance/runner.py run`: exit 0, `ok: true`.
- `cd apps/studio-web`: `bun run verify` still fails at `bun install --frozen-lockfile` (EPERM linking, environmental; `package.json`/`bun.lock` unchanged). Its steps were run directly:
  - `node node_modules/typescript/bin/tsc --noEmit` (project tsc 5.9.3): exit 0.
  - `bunx vite build`: OK (implementer).
  - `bunx vitest run`: 200/200 in 12 files. The new pins are assertions inside existing tests.
- `apps/supervisor`: untouched this pass, so its suite and `tsc` were not re-run (pass-1/2 run: 2169 pass, 0 fail).
- Unverifiable here (operator, after the merge and a serve restart):
  - a signed-in `https://<TLS_NAME>:8787/` lands on `/app/office/<project>`;
  - the next terminal run's line ends `open: https://<TLS_NAME>:8787/app/run/<id>`;
  - the next Jira block comment ends `Open: …/app/inbox/<KEY>`.

**Residual risks.** The pre-snapshot wait is unit-tested through the pure helper and reasoned through ChatScreen's `chatOpenState`/`chatProjectCheck` effects. It was never run in a browser. If the live stream never delivers a snapshot, a project-less engagement link waits indefinitely. Senders always add `?project=`, so only hand-typed links are affected. 39-3 plans against these helpers (DRIFT below, consult score 2).

DRIFT: /app/chat/<id> with no ?project= resolves to no project (waits) until the store's engagements snapshot is in; null or [] still falls back to the remembered chat project (engagementRefFor) — ids are per project — affects: 39-3-the-studio-chat


## Reconcile

### 2026-11-09 — adjust-stories

- Score: 2
- Reasoning: Every DRIFT is local to 39.1's own files or its unreleased 0.1.35 paragraph, and no AC changes for a later story. 39.3 and 39.4 plan against the web seams 39.1 reshaped: `/app/chat` mounts today's ChatScreen under the 39.3 strip, not a bare placeholder. Chat project and engagement resolution is in `screen.ts` (`engagementRefFor` waits on an undefined snapshot, `chatOpenState`, `chatProjectCheck`), the nav is keyed on the screen name (`navActive`), and BoardScreen already takes its project from the address (`addressProject`). A note in each `invoke_dev_with` absorbs this. The DRIFT key `39-4-the-board-kanban` means `39-4-the-kanban-and-the-story`.
- Affected: 39-3-the-studio-chat — plans/39-3.md:154 "`/app/chat` renders \"Not built yet: Story 39.3\" until this story" (it renders the strip above ChatScreen's picker)
- Affected: 39-4-the-kanban-and-the-story — plans/39-4.md:351 "`BoardScreen.tsx` (modify): the project from the route" (39.1 already did it, via `addressProject`)
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 39-2-the-sandbox-login-has-a-clock

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-11-09T17:24:14Z | 2026-11-09T17:48:18Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-11-09T17:48:58Z | 2026-11-09T18:35:30Z | 59568c77-4703-4075-a83e-da31ed1fe748 | claude-opus-5-5 | medium | 26130909 | 161563 | 13.2984 | completed |
| review | 1 | 2026-11-09T18:35:31Z | 2026-11-09T18:53:50Z | 8568b8b5-79e1-49f9-8c70-53e2d762c8b7 | claude-opus-5-5 | medium | 9141839 | 72702 | 5.8325 | completed |
| review | 2 | 2026-11-09T18:53:51Z | 2026-11-09T19:10:12Z | 071f3ff6-6c6c-4eb2-8c6c-2408f2b75ef1 | claude-opus-5-5 | medium | 11143903 | 78143 | 6.3782 | completed |
| gate | 1 | 2026-11-09T19:10:13Z | 2026-11-09T19:12:37Z | c775edac-24c9-41bd-a7d1-d5c9b3eb2884 | claude-opus-5-5 | medium | 1883225 | 15006 | 1.5183 | completed |

