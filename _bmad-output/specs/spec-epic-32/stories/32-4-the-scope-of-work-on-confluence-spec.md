---
title: 'The Scope of Work on Confluence'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '126730a5473517d188c3d42fc220554ca345cf06'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-32/plans/32-4.md'
  - '{project-root}/_bmad-output/specs/spec-epic-32/SPEC.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** In `scoping` the engagement has no scope of work: nothing writes `scope.md`, nothing publishes it to Confluence, `scope_page` stays `null`, and an owner edit or a `revise` body changes nothing (Story 32.4, ST-125; F2 step 3; B5 items 1 and 3).

**Approach:** Add `engage.py scope` (check the six-section `scope.md`, refuse by name, publish it as `Engagements/ENG-NNN` › `ENG-NNN: Scope of Work` from 31.3's helpers, record `scope_page`), a reverse converter `mdstorage.to_markdown`, a sync-back step mirroring the scope page back and replacing `scope.md` while `scoping`, and a supervisor scope pass that turns a `revise` body into the new page.

Story 32.4 acceptance criteria (verbatim, authoritative):

- **AC1** — **Given** `scoping` **When** the planner writes `engage.py scope` from the turn's `scope.md` (the sections, in order: goal; deliverables, each with its acceptance signal; exclusions; what the studio needs from the owner, each dependency dated; milestones; proposed epics and stories in `epics.md`'s story shape) **Then** 31.3's publish puts the page in the engagement's Confluence folder (`Engagements/ENG-NNN/Scope of Work`; provenance footer; skipped by content hash when unchanged) and `scope_page {id, url, version}` is recorded; the proposed epics and stories are not plan entities yet (nothing under `plan/` before approval, 32.6); a scope with a deliverable lacking an acceptance signal is refused by name
- **AC2** — **Given** the owner edits the page in Confluence, or sends `revise` with a body from the Chat screen **When** the next sync-back mirrors the page (31.4, `kb/confluence/`) or the input arrives **Then** the revision replaces `scope.md` wholesale (the page is authoritative while `scoping`, D9; a `revise` body becomes the new page), a `revise` in `quoted` returns the state to `scoping` and voids the quote, and the planner's next turn reads the new scope; the lib suite covers the round trip (Markdown to storage format to mirrored Markdown keeps every section), the replace rule and the refusal with a fake Confluence REST

The plan's **Settled shape** 1–5 (`plans/32-4.md`, mirrored in SPEC.md CAP-8/CAP-9 bullets) is the binding shape of `scope.md`, the page, the mirror-back, the `revise` body and the `## Assumptions` section.

## Boundaries & Constraints

**Always:**
- `engage.py scope --directory <project_root>` (the served root, not the worktree) writes `scope.md` and `scope_page` there; the record is JSON text; the record update re-reads it fresh and merges only `scope_page` and `updated` (chatSpendPass rule, 32-2 replan). `scope.lock` serialises scope writers (the `chat.lock` helper pattern).
- Only the planner path (`--scope-file`) is shape-checked; an owner page edit or `revise` body is taken verbatim (D9).
- Stdlib-only Python via `uv run`; atomic writes; every headless surface ends with the JSON status block; no credential in tracked files or events; the plugin imports no driver/supervisor/Hermes.
- Contract changes stay additive inside 0.1.27 (`0.1.27 (Story 32.4)` clause); every 32.1/32.2/32.3 pin in `test_driver_contract.py` is kept.
- Files boundary = the plan's 18 Files (Tasks below). Any other file is a deviation.

**Block If:**
- Applying an owner edit or a `revise` body needs a `TRANSITIONS` row, effect or guard change in `engagement.ts`.
- The scope publish can only be built by changing `plansync.publish()` for the fixed categories, or by writing `.tk-studio/confluence-pages.json`.
- A sync-back change alters `mirror_pages`' existing owner-page results (counts, paths, notes) for a project with no engagement.
- The Files list must grow beyond the plan's list (oversize gate).

**Never:**
- Nothing written under `plan/`, `_bmad-output/planning-artifacts/` or `.tk-studio/` by a scope.
- No edit to `engagement.ts`, `questions.ts`, `chat.ts`, `queue.ts`, `office.ts`, `apps/studio-web/**`, `plansync.py`, `jirabackend.py`, `track.py`, `inbox.py`, `miniyaml.py`, the shared fakes in `test_publish.py`/`test_tracking_setup.py`.
- No `**0.1.28**`, no push, tag, PR or release motion.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Planner publish | `scoping`, valid `scope.md`, bound Confluence | folders `Engagements`/`ENG-NNN` found or created; page `ENG-NNN: Scope of Work` created with footer; `scope_page {id,url,version}` merged; `page.action: created` | — |
| Unchanged | same scope again | `action: skipped`, no PUT | — |
| Changed | edited scope | `action: updated` at version + 1 | — |
| No signal | a `### deliverable` with no `Acceptance signal:` line | `blocked` `DeliverableWithoutSignal: <title>`, nothing written | exit 2 |
| Bad shape | section missing/empty/out of order/unknown; undated dependency; no story; image | `blocked` `ScopeInvalid: <what>` | exit 2 |
| Assumptions | record `assumptions[]` non-empty, id not in `## Assumptions` | `blocked` `AssumptionUnstated: <id>` | exit 2 |
| Wrong state / unbound | not `scoping` / terminal / no `space_id` / env gaps | `NotScoping` / `EngagementClosed` / `ConfluenceUnbound` / gap names | exit 2 |
| Transient | 429/5xx, or `scope.lock` held | `partial`, `retry: true`; `scope.md` kept, `scope_page` unchanged | — |
| Revise body | `--revise-at <at>` naming a `revise` input with `payload.body` | body written verbatim as `scope.md`, published, not shape-checked | `ReviseNotFound` |
| Owner edit, `scoping` | page version > `scope_page.version` at a sync-back tick | mirror `kb/confluence/<slug>.md` (header + `engagement`); `scope.md` replaced wholesale; version merged | 404 → note; `ConfluenceError` → `partial` |
| Owner edit, other state | e.g. `quoted` | mirror only; note `scope edit of ENG-NNN not applied: state <s> (send revise)` once per version; no state moves | — |
| Supervisor pass | applied `revise` with body while `scoping` | `engagement-scope {…, action: published, page}` once; refused/skipped once; transient → nothing, retried; newest body wins | never throws |

</intent-contract>

## Code Map

The investigation is the plan's `## Code Map` and `## Settled shape` (`_bmad-output/specs/spec-epic-32/plans/32-4.md` lines 18–130); anchors spot-checked 2026-10-25 and current. Key points:

- `apps/supervisor/src/engagement.ts` (read-only) -- `TRANSITIONS` already map `scoping`+`revise`→`scoping` and `quoted`+`revise`→`scoping` with `void-quote`; `checkInputBody` checks `revise {body?}`; `test/engagement.test.ts:184-195` pins the voided quote.
- `plugins/tk-studio/lib/plansync.py` (import only) -- `page_hash` :1643, `page_footer` :1649, `_provenance` :1626, `FOOTER_HASH_RE` :1533, `_webui` :1685, `_recorded` :908; skip rule as `publish()` :1852-1866. Never change `publish()`.
- `plugins/tk-studio/lib/confluence.py` -- `find_folders` :235, `create_folder` :244 (add `parent_id`→`parentId`), add `find_child_folder` (the `find_page` :259 pattern over `/folders/{id}/direct-children`, `type == "folder"`); `get_page`/`page_body`/`page_version`/`create_page`/`update_page` :269-305; `env_gaps` :89.
- `plugins/tk-studio/lib/mdstorage.py` -- `convert` :331; add `to_markdown(storage)` on `html.parser` for the subset `convert` emits; unknown elements keep text; footer paragraph dropped.
- `plugins/tk-studio/lib/engage.py` -- `_result`/`_finish` :120-125, `engagement_dir` :145, `read_record` :153, `_take_over_stale` :471, `_with_chat_lock` :497, `reply` :558 (memory mode gains `scope: {path, text} | null`), `_questions_main` :605 and `main` :626 as CLI model; add verb `scope` and `apply_page_revision(root, engagement, page, now)`.
- `plugins/tk-studio/lib/syncback.py` -- `tick` :472 step 3 runs `mirror_pages` :396; add `mirror_engagement_pages` right after it, state under `sync-state.json` `engagement_pages`; reuse `slug_for` :318, `_header` :322, `MIRROR_REL`, `jirabackend._atomic_write`; counts `engagement_pages_mirrored`, `scopes_replaced`.
- `apps/supervisor/src/questions.ts` (read-only model) -- targets from `chat-queued` roots :399-413, `serialised` :159-165, `track()` `lastJsonObject` :188-194; `uvRunner`, `studioScript`.
- `apps/supervisor/src/cli.ts` -- `questionsQuietly` :737-740, `RunOptions` :304-305, `finally` sites :655/:852/:1213, `afterEngagementInput` :745-748.
- `apps/supervisor/src/api.ts` `postInputRoute` :536-568 -- hook condition :564 adds `revise`; `test/api.test.ts:1502` pins "never after other verbs".
- Fakes -- `test_publish.py:59` `FakeConfluencePublish` (subclass in `test_engage.py`); `test_syncback.py:61` `FakeSyncBack` (extend in `test_syncback.py`); `test/questions.test.ts` helpers :38-106 to copy.
- Contract -- `driver-contract.md` line 5/6 clause, §2 `tk-studio-engage` row :389, §2 `tk-studio-plan-sync` row :387, §1 `GET /engagements/{id}` :114-117; `test_driver_contract.py` 32.3 pin :1062-1116 as pattern. `engagement-scope` event goes in the supervisor README only.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/confluence.py` -- `create_folder(..., parent_id=None)`, `find_child_folder` -- nested `Engagements/ENG-NNN` folder.
- `plugins/tk-studio/lib/mdstorage.py` -- `to_markdown` -- mirror-back and round trip.
- `plugins/tk-studio/lib/engage.py` -- verb `scope` (args `--directory --engagement --scope-file|--revise-at --dry-run`; order: state refusal → shape check (planner only) → `scope.lock` → atomic `scope.md` → publish → fresh-read merge of `scope_page`/`updated`; result `{ok, dry_run, engagement, mode: "scope", source, scope, page {id,url,version,action}, written[], notes[]}`), the named refusals of the matrix, `apply_page_revision`, `scope` in `reply`'s memory -- AC1, AC2.
- `plugins/tk-studio/lib/syncback.py` -- `mirror_engagement_pages` after step 3 -- AC2 owner edit.
- `apps/supervisor/src/scope.ts` (new) -- `scopePass(queue, deps = {}, only?)`, never throws, emits `engagement-scope` once per `revise_at` -- AC2 revise body.
- `apps/supervisor/src/cli.ts` -- `scopeQuietly` at the three `finally` sites (`underBunTest()` skip, `RunOptions.scope`), `afterEngagementInput` runs it after the questions pass.
- `apps/supervisor/src/api.ts` -- hook fires after an applied `revise` too, fire-and-forget.
- `plugins/tk-studio/skills/tk-studio-engage/SKILL.md`, `plugins/tk-studio/skills/tk-studio-plan-sync/SKILL.md`, `apps/supervisor/README.md` -- document `scope`, the mirror-back, the scope pass and `engagement-scope`.
- `plugins/tk-studio/contracts/driver-contract.md`, `plugins/tk-studio/lib/tests/test_driver_contract.py` -- the additive `0.1.27 (Story 32.4)` clause and rows; a 32.4 pin after 32.3's.
- `plugins/tk-studio/lib/tests/test_engage.py`, `test_mdstorage.py`, `test_syncback.py`, `apps/supervisor/test/scope.test.ts` (new), `apps/supervisor/test/api.test.ts` -- the plan's "Tests to cover" (refusals, publish with fake REST incl. skip/update/429, not-plan-entities byte-identity, round trip incl. editor noise, replace rule incl. `quoted` note/unchanged/404, revise path lib and bun, `reply` memory `scope`).

**Acceptance Criteria:**
- Given AC1 and AC2 above, when the lib suite and the bun suite run, then each clause is proven by a named test (the plan's "Tests to cover" list), with a fake Confluence REST for the publish, the replace rule and the refusal.
- Given a project with no engagement, when the sync-back ticks, then `mirror_pages`' results are unchanged (existing `test_syncback.py` cases stay green unmodified).

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 2, low 2)
- defer: 0
- reject: 5 (high 0, medium 0, low 5)
- addressed_findings:
  - `[medium]` `[patch]` the scope publish skipped on a matching footer hash even when the owner had bumped the page version, so `scope.md` and the page diverged and the tick never mirrored the edit; it now skips only when the remote version equals the recorded `scope_page.version`, else PUTs (local wins, plan Risks) — both layers
  - `[medium]` `[patch]` `apply_page_revision` did not re-check the version under `scope.lock`, so a stale owner revision could overwrite a newer publish and downgrade `scope_page.version`; it now applies nothing when the fresh record is at or past it — both layers
  - `[low]` `[patch]` `scope.lock` reused chat.lock's 30 s stale rule around network I/O; now `SCOPE_LOCK_STALE_S = 900` with token-owned release
  - `[low]` `[patch]` `**Acceptance signal**:` (colon outside the bold) was refused as `DeliverableWithoutSignal`; both bold forms accepted
- rejected (one line each): page moved by the owner out of `Engagements/ENG-NNN` (the plan pins find-by-title on each publish); default `--scope-file` is the live `scope.md` (plan-pinned; engage.py itself writes nothing on a refusal); prose dependencies not date-checked (Settled shape 1 defines a dependency as a list item); `to_markdown` leaves literal Markdown characters unescaped (the sections survive; wording-only, no criterion named); a soft-wrapped signal fails after a mirror (owner text is not shape-checked; the SKILL asks for a blank line before the signal)

### 2026-10-25 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 1, low 3)
- defer: 0
- reject: 4 (high 0, medium 0, low 4)
- addressed_findings:
  - `[medium]` `[patch]` an owner edit noted outside `scoping` (mirror written, `engagement_pages` version recorded) was never applied after a bodiless `revise` returned the state to `scoping`, because the tick skipped the known version; `mirror_engagement_pages` now re-applies a known version still above `scope_page.version` once the state is `scoping` (no mirror rewrite, no count, no repeated note) — both layers
  - `[low]` `[patch]` a web image (`https://…`, `//…`) became an `ri:url` with no attachment and passed `check_scope`; it is now `ScopeInvalid: an image (<src>)` (matrix "Bad shape … image") — blind-hunter
  - `[low]` `[patch]` `apply_page_revision`'s `replace()` re-checked only the version under `scope.lock`; it now also requires `state == scoping` and the same `scope_page.id` — both layers
  - `[low]` `[patch]` the `scope` verb's `write_and_publish()` did not re-check the state under `scope.lock`; it now reads the fresh record first and refuses `EngagementClosed`/`NotScoping` before writing `scope.md` — edge-case-hunter
- rejected (one line each): images in a `revise` body are not uploaded (the body is owner text taken verbatim, D9; nothing is read from disk, so no `outside` read happens); an older `revise` body republished after a transient failure overwrites a newer planner publish (AC2: a `revise` body becomes the new page; the owner's revise is the newest owner instruction, and the planner reads it from `scope.md`, which is written before the publish); the sync-back GETs each engagement's scope page every tick, in every state (the matrix mirrors in any other state; that is one GET per engagement with a page, not per issue); an HTTP 409 on the PUT when the owner edits mid-publish is `PublishRefused`, not transient (the window is the GET→PUT gap, the refusal is named, and a rerun or a resent revise succeeds)

### 2026-10-25 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 2, low 0)
- defer: 0
- reject: 4 (high 0, medium 0, low 4)
- addressed_findings:
  - `[medium]` `[patch]` `mdstorage.to_markdown` lost editor markup from an owner edit. A date-picker `<time datetime>` rendered as nothing, so a dependency dated with the picker came back undated and the planner's next `scope` was refused. An `ac:task-list` turned into one paragraph with the task ids and statuses mixed into the text. `time` now renders as its `datetime` (falling back to its text), and a task list renders as `- [ ]`/`- [x]` lines — blind-hunter
  - `[medium]` `[patch]` an `OSError` in `scope()`'s locked write path (the `scope.md` write, the `engagement.yaml` merge, the `scope.lock` open) escaped as a traceback with no status block (AD-11). It is now the named refusal `blocked` `ScopeUnwritable: <path>: <error>`, with `written[]` naming what had already landed, as `reply`'s `ChatUnwritable` does — blind-hunter
- rejected (one line each): a sync-back that reads the studio's own PUT after its response was lost treats it as an owner edit. The proposed footer-hash guard is unsound, because an owner edit keeps the old footer hash and so would be ignored, and the cost is only a round trip of the studio's own text, which AC2's round trip keeps section-complete. A dependency date on an indented continuation line is refused, but only the planner's own file is checked, the refusal is named and the planner can fix the file. An owner page title that slugs like `ENG-NNN: Scope of Work` would share one mirror file, but titles are unique per space (Design Notes) and the clash needs an owner page named like the studio's. The "not applied … (send revise)" note also shows in terminal states, but the matrix pins that note for every non-`scoping` state, and the `revise` is then refused by name (`409 EngagementClosed`)

## Design Notes

- Titles are unique per Confluence space, so the page is `ENG-NNN: Scope of Work` inside folder `Engagements/ENG-NNN` (Settled shape 2); `url` = `https://<planning.jira.site>/wiki<_links.webui>`, else the relative webui.
- The scope page is agent-authored, so 31.4's `mirror_pages` never mirrors it; the new step keeps its state under `engagement_pages` so `mirror_pages`' "gone or no longer the owner's" note never fires for it.
- Owner edit in a non-`scoping` state never moves the state (only typed inputs do); the owner sends `revise`.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green; only the 3 released-roster guards may be red (`unverifiable-here` until the release motion).
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- `cd apps/supervisor && bun test test/scope.test.ts test/questions.test.ts test/api.test.ts test/engagement.test.ts test/chat.test.ts`, then `bun test` (`~/.bun/bin` on PATH, `TK_STUDIO_ROOT` set, `TK_ATLASSIAN_*` unset) -- expected: 0 fail.
- `cd apps/supervisor && bunx tsc --noEmit` -- expected: clean.
- `grep -n "0.1.27 (Story 32.4)" plugins/tk-studio/contracts/driver-contract.md` hits; `grep -c "\*\*0.1.28\*\*" plugins/tk-studio/contracts/driver-contract.md` is 0.
- `git status --porcelain` -- expected: only the Files above.

## Deviation Summary

### pass 1 (2026-10-25, implementer)

- planned: "the env gaps by name" with no refusal name given / actual: refusal named `ConfluenceEnvMissing: <gap>; <gap>` / why: every refusal needs a leading name for the `reason` convention / may affect: none
- planned: sync-back state `engagement_pages[<page id>] = {path, version, content_hash}` / actual: each entry also carries `engagement` / why: lets a reader see which record the mirror belongs to without reading the header / may affect: none
- planned: each story "with the As a / I want / So that lines and **Acceptance Criteria:**" / actual: checked as substrings anywhere in the story's text, not at line starts; the `Acceptance signal:` line may also carry a leading bullet or bold / why: `convert` joins consecutive lines into one paragraph, so a line-start check would fail the AC2 round trip / may affect: 32-6 (approve parses the proposed stories)
- planned: `apply_page_revision(root, engagement, page, now) -> dict` with no fields named / actual: returns `{applied, retry, note, markdown, written[]}`; syncback writes the mirror from `markdown`, engage writes `scope.md` and the record / why: keeps the record write in engage.py while the mirror stays in syncback / may affect: none
- planned: `afterEngagementInput(queue, root, id, deps?: Partial<QuestionsDeps>)` / actual: `deps?: Partial<QuestionsDeps & ScopeDeps>`, running the questions pass then the scope pass / why: one hook serves both passes / may affect: none

DEVIATION SCORE (implementer): 1

DRIFT: the env-gap refusal is named `ConfluenceEnvMissing: <gaps>` — the plan named no leading token and every refusal reason leads with one — affects: none
DRIFT: `engagement_pages` entries carry `engagement` beside `{path, version, content_hash}` — additive field for traceability — affects: none
DRIFT: `scope.md`'s proposed stories match `As a`/`I want`/`So that`/`Acceptance Criteria` and `Acceptance signal:` as substrings inside the story or deliverable text, because an owner edit or `revise` mirrored back through `mdstorage.to_markdown` can join them into one paragraph; 32-6's approve parse must not assume line starts — the AC2 round trip fails a line-start check — affects: 32-6
DRIFT: `apply_page_revision` returns `{applied, retry, note, markdown, written[]}` — the plan left the dict's fields open — affects: none
DRIFT: `afterEngagementInput` deps widen to `Partial<QuestionsDeps & ScopeDeps>` — one hook serves both passes — affects: none

Consult (deviation-gt-0): accept-deviation score 2 — items 1, 2, 4, 5 local; item 3 a seam 32-6 relies on.

### pass 2 (2026-10-25, review patches)

- planned: edit the contract and SKILL only if they state the changed rule / actual: the §2 `tk-studio-engage` row (`driver-contract.md:389`) and `tk-studio-engage/SKILL.md` now state the version-aware skip and the accepted signal forms / why: both stated the old rule / may affect: none
- planned: decline a stale revision in `apply_page_revision` / actual: `syncback.py` still writes its `kb/confluence` mirror from the older page and records that version / why: outside the four findings / may affect: none

DEVIATION SCORE (pass 2): 1 — consult: accept-deviation score 1. Residual: a mirror written from a version that `apply_page_revision` declined keeps that older text until the page's next version; `scope.md` and `scope_page.version` stay authoritative.

DRIFT: the §2 `tk-studio-engage` row and the engage SKILL state the publish skip as hash-match AND remote version = recorded `scope_page.version` (an owner's newer version is overwritten) — review patch changed the rule both stated — affects: none
DRIFT: a `kb/confluence` scope mirror written from a declined stale revision keeps the older text until the page's next version — the sync-back mirror rule writes on any newer-than-recorded read — affects: none

### pass 3 (2026-10-25, follow-up review patches)

- planned: tests for the four patches in the existing test files / actual: `test_engage.py` (`test_a_web_image_is_scope_invalid_too`, `test_a_state_that_left_scoping_before_the_lock_is_not_scoping`) and `test_syncback.py` (`test_an_edit_noted_in_quoted_is_applied_once_back_in_scoping`, `test_a_state_or_page_changed_before_the_lock_applies_nothing`, plus a `set_page_id` helper) / why: that is where the fakes live / may affect: none

DEVIATION SCORE (pass 3): 0. Every change is inside the plan's Files. There is no new state field, no contract or SKILL change and no consult.

### pass 4 (2026-10-25, follow-up 2 review patches)

- planned: add `ScopeUnwritable` to the contract and SKILL only where they already list `scope`'s refusals / actual: all three places list them, so it was added to the line-5 `0.1.27 (Story 32.4)` clause, the §2 `tk-studio-engage` row and `tk-studio-engage/SKILL.md`; no version change, and `**0.1.28**` appears 0 times / why: AD-11 needs a named refusal, and the lists would otherwise be incomplete / may affect: none (`apps/supervisor/src/scope.ts` passes any `blocked` reason through without branching on its name)
- planned: two tests for `ScopeUnwritable` / actual: three tests, the third covering an `engagement.yaml` merge failure after `scope.md` landed (`written == [scope.md]`), plus a `notes[]` line saying the page was published but `scope_page` was not updated / why: it shows `written[]` reports honestly / may affect: none

DEVIATION SCORE (pass 4): 1. Consult: accept-deviation score 1.

DRIFT: `engage.py scope` gains the refusal `ScopeUnwritable: <path>: <error>`, listed in the `0.1.27 (Story 32.4)` clause, the §2 `tk-studio-engage` row and the engage SKILL — an `OSError` in the write path had no status block (AD-11) — affects: none

## Consult Log

- 2026-10-25T09:33Z — trigger: deviation-gt-0 — question: accept the implementer's five deviations (score 1), incl. substring-matching of the story shape and `Acceptance signal:` (may affect 32-6)? — ruling: accept-deviation score 2 — do: accept all five, items 1/2/4/5 local, record item 3 as a DRIFT naming 32-6 (approve parse must not assume line starts); fix driver-contract.md:5's 0.1.27 (Story 32.4) clause to name `ConfluenceEnvMissing` (each absent agent-seat variable named) — rule candidate: a shape rule checked after an mdstorage round trip says "contains", not "a line that starts", and later parsers of that file are listed as dependent seats (score 2) in the plan
- 2026-10-25T09:48Z — trigger: deviation-gt-0 (review patch pass) — question: accept the contract/SKILL rule-text updates and the stale-mirror residual after declining a stale revision? — ruling: accept-deviation score 1 — do: keep the contract row and SKILL edits; accept the stale mirror as a local residual and record it; no further patch — rule candidate: when a review patch changes a rule the story's own contract row or SKILL already states, updating that text inside the story's own contract clause is a score-1 deviation, not a contract change
- 2026-10-25T10:12Z — trigger: deviation-gt-0 (follow-up 2 review patches) — question: accept adding `ScopeUnwritable` to the `0.1.27 (Story 32.4)` clause, the §2 `tk-studio-engage` row and the engage SKILL, plus the extra merge-failure test and `notes[]` line (implementer score 1)? — ruling: accept-deviation score 1 — do: keep the `ScopeUnwritable` additions at driver-contract.md:5, :389 and SKILL.md:166, with no version bump; keep the third test and the `notes[]` line and record both as local; make no further patch — rule candidate: when a review patch turns an uncaught exception on a headless verb into a named `blocked` refusal, listing that name inside the story's own contract clause is score 1 when downstream consumers pass `reason` through without branching on it


## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version); routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5 (effort medium, advisor off on every leg; `pipeline.py resolve`); knowledge spine absent

**Summary.** This was the second follow-up review pass on the done story 32.4. It reviewed the whole diff from the baseline `126730a5473517d188c3d42fc220554ca345cf06` (17 files, +2408/−31). Both layers ran, because the plan's band is L.

What the story built is unchanged:
- `engage.py scope` publishes the checked six-section `scope.md` as `ENG-NNN: Scope of Work` in `Engagements/ENG-NNN` and records `scope_page`.
- `mdstorage.to_markdown` reverses the converter.
- The sync-back mirrors the scope page and, while `scoping`, replaces `scope.md` wholesale.
- The supervisor scope pass publishes an applied `revise` body.

This pass hardened two places:
- `to_markdown` now keeps a date-picker date (`<time datetime>`) and renders an editor task list as checkbox lines.
- An OS write failure in `scope()` now ends `blocked` with `ScopeUnwritable`, where it used to raise a traceback with no status block.

**Files changed (this pass)**
- `plugins/tk-studio/lib/mdstorage.py`: `time` renders as its `datetime` (falling back to its text); `ac:task-list` renders as `- [ ]`/`- [x]` lines; `ac:task-id`/`ac:task-status` are dropped; the docstring is updated.
- `plugins/tk-studio/lib/engage.py`: `scope()` maps an `OSError` on the `scope.md` write, the record merge or the `scope.lock` open to `ScopeUnwritable: <path>: <error>`, with `written[]` naming what had already landed; the docstring is updated.
- `plugins/tk-studio/contracts/driver-contract.md`: `ScopeUnwritable` is added to the `0.1.27 (Story 32.4)` clause and the §2 `tk-studio-engage` row (additive, no version change).
- `plugins/tk-studio/skills/tk-studio-engage/SKILL.md`: `ScopeUnwritable` is added to the `scope` refusals.
- `plugins/tk-studio/lib/tests/test_mdstorage.py`: three tests, `test_a_date_picker_time_keeps_its_date`, `test_a_task_list_is_checkbox_lines_without_id_or_status` and `test_a_dependency_dated_by_the_date_picker_passes_the_date_rule`.
- `plugins/tk-studio/lib/tests/test_engage.py`: three tests, `test_a_scope_md_the_os_refuses_is_scope_unwritable`, `test_a_record_merge_the_os_refuses_is_scope_unwritable_after_scope_md` and `test_a_scope_lock_the_os_refuses_is_scope_unwritable`.
- This spec.

Every file is inside the plan's 18 Files.

**Review.** The blind-hunter returned 3 findings and the edge-case-hunter 3, 6 unique in all.
- Patched: 2 (high 0, medium 2, low 0).
- Deferred: 0.
- Rejected: 4 (low).
- Consults: 1 (deviation-gt-0, accept-deviation score 1).

Follow-up review: recommended (true). The patch score is 3×2 + 1×0 = 6, which is at least 5.

**Verification** (run by this session after the patches)
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib): 1908 tests, OK (2 skipped).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- The contract has `0.1.27 (Story 32.4)` once and `**0.1.28**` 0 times.
- `git status --porcelain` named only the six files above and this spec.
- No TypeScript changed in this pass, so `bun test` and `tsc` were not rerun.

**Residual risks**
- Live Confluence is proven only against fakes. Nested `POST /folders` with `parentId` and the live editor's storage markup are `unverifiable-here` until the attended first engagement after 32.8.
- `to_markdown` covers the editor markup seen so far, but not everything:
  - A user mention (`ri:user`) carries no display name in storage, so it still mirrors back as nothing.
  - Other editor macros keep only their text.
- If the response to a studio PUT is lost and a sync-back tick runs before the planner's rerun, `scope.md` is replaced by the round trip of its own text (sections kept; formatting may change).
- The re-apply of an owner edit made outside `scoping` still depends on a sync-back tick running before the planner's next publish (local wins).
- A mirror written from a declined stale revision keeps the older text until the page's next version.

DRIFT: the env-gap refusal is named `ConfluenceEnvMissing: <gaps>` — the plan named no leading token and every refusal reason leads with one — affects: none
DRIFT: `engagement_pages` entries carry `engagement` beside `{path, version, content_hash}` — additive field for traceability — affects: none
DRIFT: `scope.md`'s proposed stories match `As a`/`I want`/`So that`/`Acceptance Criteria` and `Acceptance signal:` as substrings inside the story or deliverable text, because an owner edit or `revise` mirrored back through `mdstorage.to_markdown` can join them into one paragraph; 32-6's approve parse must not assume line starts — the AC2 round trip fails a line-start check — affects: 32-6
DRIFT: `apply_page_revision` returns `{applied, retry, note, markdown, written[]}` — the plan left the dict's fields open — affects: none
DRIFT: `afterEngagementInput` deps widen to `Partial<QuestionsDeps & ScopeDeps>` — one hook serves both passes — affects: none
DRIFT: the §2 `tk-studio-engage` row and the engage SKILL state the publish skip as hash-match AND remote version = recorded `scope_page.version` (an owner's newer version is overwritten) — review patch changed the rule both stated — affects: none
DRIFT: a `kb/confluence` scope mirror written from a declined stale revision keeps the older text until the page's next version — the sync-back mirror rule writes on any newer-than-recorded read — affects: none
DRIFT: `engage.py scope` gains the refusal `ScopeUnwritable: <path>: <error>`, listed in the `0.1.27 (Story 32.4)` clause, the §2 `tk-studio-engage` row and the engage SKILL — an `OSError` in the write path had no status block (AD-11) — affects: none

## Reconcile

### 2026-10-25 — adjust-stories

- Score: 2
- Reasoning: Seven of the eight DRIFT lines are local (`affects: none`). One more is a narrower publish skip (hash AND version), which still meets AC1's "skipped by content hash when unchanged". The contract additions (`ConfluenceEnvMissing`, `ScopeUnwritable`) sit inside the story's own additive `0.1.27 (Story 32.4)` clause, as the epic narrative allows. The DRIFT that matters is the shape-match rule: `scope.md` stays unchecked after an owner edit or a `revise` (D9), and after an `mdstorage.to_markdown` round trip the `As a`/`I want`/`So that`/`**Acceptance Criteria:**` and `Acceptance signal:` markers can sit inside a joined paragraph instead of at line starts. The `###`/`####` headings survive the round trip, so 32-5's story count is unaffected. 32-6 and 32-8 both parse that body text, and a note in each `invoke_dev_with` covers it. No acceptance criterion has to change.
- Affected: 32-6-approval-autonomy-and-the-first-run — "the scope's proposed epics and stories appended to `epics.md` as `## Epic N` sections" (the approve parse must not assume line starts)
- Affected: 32-8-delivery-the-closeout-report-and-change-requests — "each deliverable's acceptance signal checked against the landed stories' specs and PRs" (the signal parse must not assume line starts; the `ENG-NNN: Closeout` publish reuses 32.4's folder and skip helpers)
- Invariant: none
- Gate: Part A adjust-stories; Part B story accepted, planned 32-5-the-quote-band
