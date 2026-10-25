---
name: tk-studio-engage
description: The planner leg of an engagement — `reply` reads the engagement's memory (the record, the chat so far, the plan under `_bmad-output/planning-artifacts/`, `kb/` and `kb/confluence/`) and writes the planner's reply line, with optional proposals the owner can press, to the engagement's `chat.jsonl`; `questions` writes at most three multiple-choice clarifying questions, each with a default, for the owner's inbox; `scope` writes and publishes the scope of work; `quote` prices the scope as a seeded 50/85/95 band with a hard cap from the studio's own history and proposes `go`. Use when a supervisor `engagement-chat` payload names this skill, or the user says "reply in the engagement chat" or "tk engage reply".
---

# tk-studio-engage

The owner talks to the studio about one engagement through the supervisor's
own chat route (design spec §6.4, D2; user flow F2 step 1). Each owner line
queues one run of the shipped one-shot `engagement-chat` job: a `claude -p`
session of the planner leg, on the host, in the run's worktree, with this
plugin; it reads and writes the served project's root (the payload's
`project_root`, where `chat.jsonl` and the record live untracked). The session answers from the project's memory and writes its
reply through this surface. **The planner moves nothing**: it holds no
bearer and no CSRF token, it never sends a typed input, and nothing it
writes changes the engagement's state. A proposal is a button the owner
presses through the supervisor's `POST /engagements/{id}/input`.

## Behavior (both modes)

1. Read the memory through the plugin root:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/engage.py" reply --directory <project-root> \
     --engagement <ENG-NNN>
   ```

   The result is `{ok, dry_run, engagement, mode: "memory", record, chat[],
   memory {plan, kb, confluence}, scope, notes[], written[]}` with the
   status block last. `scope` (Story 32.4) is the engagement's current
   `scope.md` as `{path, text}`, or `null` while none is written: read it
   before writing a new scope, since an owner edit in Confluence or a
   `revise` body may have replaced it since your last turn. `record` is the engagement record (`engagement.yaml`, JSON text);
   `chat[]` every chat line so far; each `memory` entry an index `{root,
   files: [{path, bytes, title}], truncated}` of
   `_bmad-output/planning-artifacts/`, `kb/` (without `kb/confluence/`) and
   `kb/confluence/` (the synced Confluence pages), root-relative, sorted,
   capped. The index never carries a file's body: read the files the turn
   needs. Every indexed `path` is relative to the served root (the
   payload's `project_root`, the same value passed as `--directory`), not
   to the session's cwd: read each file at `<project_root>/<path>`, never
   relative to the run's worktree (the untracked `kb/confluence/` and any
   uncommitted plan edits exist only under the served root).

2. Write the reply:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/engage.py" reply --directory <project-root> \
     --engagement <ENG-NNN> --body-file <path> [--proposals-file <path>] \
     --run-id <run_id> [--dry-run]
   ```

   The body (at most 32 KiB UTF-8) comes from a file, never the command
   line. The proposals file is a JSON array of `{verb, payload, label}`:
   `verb` one of `answer`, `go`, `revise`, `question`, `approve`, `cancel`;
   `payload` that verb's typed payload (`answer {answers: {<question id>:
   <option>}}`, `go {cap?}`, `revise {body?}`, `question {text}`, `approve
   {autonomy: ask | steady | full, base_ref?}`, `cancel {reason?}`, no other
   field); `label` the button's text, at most 80 characters. The line
   `{seq, at, author: "planner", body, run_id, proposals[]}` is appended
   under the chat lock with the next `seq`. The result is `{ok, dry_run,
   engagement, mode: "write", line, notes[], written[]}` with the status
   block last.

   Payload mapping (the `engagement-chat` job's payload is `{verb: "reply",
   engagement, project, project_root, seq, run_id}`): `project_root` (the
   served registry root, where `chat.jsonl` and the record live untracked)
   maps to `--directory` — never `directory`, which is the run's worktree;
   `engagement` maps to `--engagement`, `run_id` (the queue run id) to
   `--run-id`; `seq` is the owner line the turn answers.

   **Session procedure for `payload.verb: reply`:** run mode 1; read the
   owner's line `seq` and the chat before it; read the record (the state,
   the request, the questions, the scope page, the quote) and whichever
   plan, kb and Confluence files the question needs, each at
   `<project_root>/<path>` (the index's `path` joined to the payload's
   `project_root`, never to the cwd or the worktree); answer in plain
   language, naming the files you relied on. When a typed input would move
   the engagement on (for example `go` in `intake`), offer it as a proposal
   rather than taking it. Write the body and the proposals to temp files
   and run mode 2 with the payload's `run_id`. End on the status block;
   commit nothing.

3. Ask clarifying questions (Story 32.3, user flow F2 step 2) — only in
   `intake`, and only when the turn finds gaps that **no default can
   cover**: a choice the scope or the quote turns on and the memory does not
   settle. Ask **at most three**; each has options and exactly one default.
   When a sensible default covers a gap, do not ask: proceed on it and state
   it as an assumption in the reply. Write the questions to a temp file (a
   JSON array) and run:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/engage.py" questions --directory <project_root> \
     --engagement <ENG-NNN> --run-id <run_id> --questions-file <path> [--dry-run]
   ```

   Each question is `{id, text, options: [{label, default?: true}],
   impact}`: `id` matching `^[a-z0-9][a-z0-9-]{0,15}$` and unique, `text`
   the question, `impact` what the answer changes (the scope, the quote),
   2 to 6 options with unique labels and exactly one `"default": true`.
   `--directory` is the payload's `project_root` (never the worktree),
   `--run-id` the payload's `run_id`. It writes
   `_bmad-output/engagements/<id>/questions.json`; the planner still moves
   no state: when the run ends, the supervisor applies the file
   (`intake → awaiting-answers`, recorded with source `planner` and the run
   id), puts the questions in the owner's inbox (one Jira issue per
   engagement) and reads the answers back. Then write the reply (mode 2)
   telling the owner what you asked and why. Its refusals (exit 2), each
   named: `TooManyQuestions` (a fourth), `QuestionInvalid` (naming the
   index), `NotIntake`, `EngagementClosed`, `RunIdRequired`, plus the
   record's (`BadEngagement`, `UnknownEngagement`,
   `EngagementRecordUnreadable`) and an unreadable `--questions-file`. A dry
   run writes nothing and ends `partial`.

4. Write the scope of work (Story 32.4, user flow F2 step 3) — only in
   `scoping`. Write `_bmad-output/engagements/<id>/scope.md` (or a temp
   file) with these `##` sections, in this order, each non-empty:

   1. `## Goal`
   2. `## Deliverables` — each deliverable a `### <title>` holding a line
      that starts `Acceptance signal:` (or `**Acceptance signal:**` /
      `**Acceptance signal**:`) followed by how the owner will know
      it is done. Keep the signal on its own paragraph (a blank line before
      it).
   3. `## Exclusions`
   4. `## What the studio needs from you` — a list; each item carries the
      date it is needed by, `YYYY-MM-DD`.
   5. `## Milestones`
   6. `## Proposed epics and stories` — `### Epic <k>: <title>` and
      `#### Story <k>.<m>: <title>`, each story in `epics.md`'s shape (the
      `As a … / I want … / So that …` lines and `**Acceptance Criteria:**`);
      the numbers are local (approval renumbers them); at least one story.
   7. `## Assumptions` (last; required when the record's `assumptions[]` is
      non-empty) — name each assumption's `question` id.

   A `#` title before `## Goal` is fine; no other `##` section and no image.
   Then publish it:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/engage.py" scope --directory <project_root> \
     --engagement <ENG-NNN> [--scope-file <path>] [--dry-run]
   ```

   `--scope-file` defaults to the engagement's own `scope.md`. It checks the
   shape, writes `scope.md` (under `scope.lock`), publishes it as the page
   `ENG-NNN: Scope of Work` in the Confluence folder `Engagements/ENG-NNN`
   (with the provenance footer; an unchanged scope on a page still at the
   recorded version is `skipped`, an owner's unmirrored edit is overwritten) and
   records `scope_page {id, url, version}` in the record. The result is
   `{ok, dry_run, engagement, mode: "scope", source, scope, page {id, url,
   version, action: created | updated | skipped}, written[], notes[]}` with
   the status block last. The proposed epics and stories are **not** plan
   entities: nothing is written under `plan/`,
   `_bmad-output/planning-artifacts/` or `.tk-studio/` until the owner
   approves (32.6). While `scoping` the page is the owner's to edit (D9):
   an edit there (mirrored by the next sync-back) or a `revise` body from
   the Chat screen replaces `scope.md` wholesale, unchecked — read `scope`
   from the memory first and rewrite it into shape on your next turn. The
   supervisor runs `engage.py scope --revise-at <at>` itself for a `revise`
   body; the planner never does. Its refusals (exit 2), each named:
   `DeliverableWithoutSignal: <title>`, `ScopeInvalid: <what>` (a section
   missing, empty, out of order or unknown; an undated dependency; no
   proposed story; an image), `AssumptionUnstated: <question id>`,
   `NotScoping`, `EngagementClosed`, `ReviseNotFound`, `ConfluenceUnbound`
   (no `planning.confluence.space_id`), `ConfluenceEnvMissing` (an absent
   agent-seat variable, named), `PublishRefused`, `ScopeUnwritable:
   <path>: <error>` (`scope.md`, the record or `scope.lock` refused by the
   OS; `written` names what had already landed), plus the record's; a
   held `scope.lock` (`ScopeBusy`), a 429 or a 5xx ends `partial` with
   `retry: true` (`scope.md` kept, `scope_page` unchanged): run it again.
   Then write the reply (mode 2) with the page's link.

5. Quote the scope (Story 32.5, user flow F2 step 4) — only in `scoping`,
   on the turn after the scope is written (or by hand):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/engage.py" quote --directory <project_root> \
     --engagement <ENG-NNN> [--seed N] [--dry-run]
   ```

   It counts the proposed stories of `scope.md` by their headings, reads
   the project's structured meter records from the store's ledgers, and
   resamples their per-story tokens and dollars over that count: a seeded
   bootstrap (10,000 resamples) giving `band50`, `band85` and `band95`, each
   `{tokens, usd, share}` (`share` over the user config's
   `plan.window_tokens`, else `"share unknown"`), and `cap = p95 + one story
   at p85` in USD. Under eight metered stories the band says "thin history"
   (`basis.thin`) and is widened ×1.5 from the Opus 5.5 trial's per-story
   dollars; with none, the tokens are `null` and the dollars carry. It
   merges `quote {band50, band85, band95, cap, basis, computed_at}` into
   the record (`basis` names the seed, the history, the route, the
   autonomy levels on offer, `planning_usd` and `scoping_billable`, and
   `at_cap`: the run pauses `partial`, the engagement's issue blocks with
   the figures, the owner decides) and writes each proposed epic's
   `epics.<EP-NNN>.usd_estimate` (its p85 dollars) into
   `.tk-studio/budget-bands.yaml`. **The state does not move**: write the
   reply (mode 2) stating the band, the cap and what happens at the cap,
   never a bare number (say "thin history" when `basis.thin`), with the
   proposal `{"verb": "go", "payload": {}, "label": "Accept the quote"}`;
   the owner's `go` moves `scoping → quoted`. A `revise` voids the quote
   (`quote: null`), and so does any replaced `scope.md` while `scoping`
   (your `scope`, a `revise` body, or the owner's page edit mirrored by
   the sync-back voids a non-null `quote` first, before `scope.md` is
   replaced; a void that fails leaves `scope.md` untouched — your `scope`
   refuses `ScopeUnwritable`, the sync-back retries on its next tick; a
   page save whose text equals `scope.md` keeps the quote): quote again
   after the new scope. `--seed` is an integer `0 <= N < 2**53` (default
   the first 6 bytes of `sha256("<engagement>:<n>")`). Its refusals
   (exit 2), each named: `BadSeed` (a `--seed` out of that range),
   `NotScoping`, `EngagementClosed`, `NoScope` (no
   `scope.md`, no proposed story, a repeated `### Epic <k>` number, or
   proposed epics not numbered 1..m in order), `PricesUnreadable` (an
   unreadable `prices.json` or an unpriced route model), `QuoteUnwritable`
   (the record or the bands refused by the OS, an unparseable
   `budget-bands.yaml` or a top-level `epics:` scalar other than empty,
   `~`, `null` or `{}`, an unreadable `measurements/`, or `scope.lock is
   held` — the quote holds it from reading `scope.md` through the merge;
   `written` names what had landed), plus the record's.
   A dry run writes nothing and ends `partial`.

6. Blocking conditions (exit 2), each named in `reason`: `BadEngagement`
   (not like `ENG-001`), `UnknownEngagement` (no record),
   `EngagementRecordUnreadable` (not JSON, or not this engagement's record),
   `EngagementClosed` (`delivered`, `failed` or `cancelled`), `BodyEmpty`,
   `BodyTooLarge`, `RunIdRequired`, `ProposalInvalid` (naming the index),
   `ChatBusy` (the chat lock held past the wait), `ChatUnwritable` (the
   chat not UTF-8, or the lock or chat file refused by the OS), an unreadable
   `--body-file` or `--proposals-file`. Nothing is appended on a refusal; a
   dry run appends nothing and ends `partial`.

7. Report:
   - **Attended:** show the reply line and its proposals.
   - **Headless:** no prompts (AD-11). Relay the core's `status`, `reason`
     and `artifacts` as they are — never infer the status from the exit
     code (`partial` exits 0):

     ```json
     {"status": "complete", "intent": "tk-studio-engage", "artifacts": [], "reason": null}
     ```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- The planner never moves state, never sends an input, and never holds a
  bearer or a CSRF token; its session runs with a worker's environment
  (every `TK_SUPERVISOR_*` secret and the owner seat stripped).
- The only files written are the engagement's `chat.jsonl`, one line per
  reply, its `questions.json` (Story 32.3), and its `scope.md` with the
  record's `scope_page` and the Confluence scope page (Story 32.4), and the
  record's `quote` with `.tk-studio/budget-bands.yaml`'s `epics` entries
  (Story 32.5); nothing is committed, nothing is promoted.
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
