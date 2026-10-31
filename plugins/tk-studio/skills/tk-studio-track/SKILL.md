---
name: tk-studio-track
description: Tracking verbs on the bound Jira project — `block` moves a story the loop cannot progress, and each dependent story, to "Blocked - Awaiting User" with a comment that @mentions the owner (or, with `--engagement`, one engagement's questions issue, which `close` later moves to "Done"); `reply` posts the owner's answer (or "Done.") with the owner's host-only token and moves the issue to "Block Resolved"; `validate` checks that resolution and passes the issue back to work or re-blocks it with a follow-up. Use when the user says "block this story", "tk track block", "put it in the owner's inbox", "reply to the blocked issue", "validate the resolution", or a supervisor or engagement payload names this skill.
---

# tk-studio-track

The owner's one inbox starts here (§6.9 items 1 and 2, §7.4): a story the
loop cannot progress — a dev session's `blocked` end, a `paused` run
awaiting a ruling, an engagement question — sits in Jira's
`Blocked - Awaiting User` with its reason, and so does every story that
depends on it. The sync-back then derives `_bmad-output/tracking/inbox.json`
from those statuses. Every Atlassian write goes through the planning adapter
(`lib/jirabackend.py`, AD-4); nothing else is promoted (D9).

## Behavior (both modes)

1. Run the verb through the plugin root:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/track.py" block --directory <project-root> \
     --story <ST-NNN | N-M-slug> --reason "<why it cannot progress>" \
     --resolves "<what resolves it>" [--source run|engagement] [--dry-run]
   ```

   `block` resolves the story's plan entity (an entity id, or a loop story
   key `N-M-…` matched by the entity's `source: epics.md#story-N.M`) and its
   `external.jira.key`, plus each dependent story — the story entities whose
   `depends_on` names it (a dependent already `done` or `dropped` is
   skipped, named in `notes[]`). Each issue moves to `Blocked - Awaiting User` by
   the transition's target **name** (never its category: `Block Resolved`
   shares it), skipped for an issue already there, and gets one agent
   comment (REST v2 wiki mention):

   ```text
   [~accountid:<owner>] Blocked: <reason>
   Resolves when: <resolves>
   Blocked by: <story's key>        (a dependent's comment only)
   ```

   The comment is skipped only when the issue was already in
   `Blocked - Awaiting User` before the run (no transition made) and its
   newest agent comment (read live, `GET /issue/<KEY>/comment`; agent is
   anyone not the owner) has the same body — a re-block after `Block
   Resolved` always comments. The
   result is `{ok, dry_run, story, source, issues:[{issue, entity, role:
   story|dependent, transitioned, commented, skipped?, error?}], notes[],
   written[], retry?}` with the status block last; no local file is written.
   `--source engagement` fixes the shape for the engagement loop's questions
   (EP-32); the supervisor's paused-run pass calls it with `--source run`.

   An engagement's questions (Story 32.3) block one issue per engagement
   instead of a story's; the supervisor's questions pass calls both verbs on
   the host:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/track.py" block --directory <project-root> \
     --engagement <ENG-NNN> [--dry-run]
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/track.py" close --directory <project-root> \
     --engagement <ENG-NNN> [--dry-run]
   ```

   `--engagement` is exclusive with `--story`, implies `--source
   engagement` and takes no `--reason` or `--resolves`. `block` finds the
   issue by its exact summary `ENG-NNN: questions` in
   `planning.jira.project_key` (`GET /search/jql`) or creates it (`POST
   /issue`, type `Task`, label `tk-studio-engagement`, the request's first
   line as its description), moves it to `Blocked - Awaiting User` by name
   with the skip rules above, and comments the record's open questions:

   ```text
   [~accountid:<owner>] Blocked: ENG-NNN needs <n> answer(s)
   Resolves when: reply with one "<id>: <option>" line per question

   <id>: <text>
   Impact: <impact>
   - <label> (default)
   - <label>
   ```

   The result is `{ok, dry_run, story: null, engagement, source:
   "engagement", issues: [{issue, created, transitioned, commented,
   skipped?}], notes[], written: [], retry?}`; its refusals add
   `EngagementNotFound`, `NoOpenQuestions`, `IssueCreateRefused` (a 400
   on the create, e.g. no `Task` type) and `EngagementLockUnwritable`. `close` (the agent seat) moves the
   issue by name to `Block Resolved` (unless it is there or at `Done`), then
   to `Done` — no validation leg: the planner's next turn judges the
   answers; a move already in place is named in `skipped[]`, an absent issue
   is `NoIssue`, a move no transition makes `NoTransition` (an issue never
   blocked, e.g. at `To Do`, skips `Block Resolved` when no transition
   reaches it, named in `skipped[]`); the result is `{ok, dry_run, engagement, issue, moved[],
   skipped[], notes[], written: [], retry?}`.
   Both verbs hold `_bmad-output/engagements/<id>/track.lock` (exclusive
   create, stale after 300 s; a dry run takes none): a lock held ends
   `partial` with `retry: true`, so two callers never create two issues. A
   re-block after an owner reply that answered nothing posts the comment
   again, even with the same body.

   Story 32.6 adds the engagement block's kind; the supervisor's
   engagement-run pass calls it on the host:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/track.py" block --directory <project-root> \
     --engagement <ENG-NNN> [--kind questions|cap|ask] [--reason "<text>"] [--dry-run]
   ```

   `--kind questions` (the default) is the block above and takes no
   `--reason`. `--kind cap` (the engagement reached its quote's cap) and
   `--kind ask` (a story landed under `ask` autonomy) need `--reason` and no
   open questions; they block the same `ENG-NNN: questions` issue with the
   31.5 prefix kept — `[~accountid:<owner>] Blocked: ENG-NNN <the reason's
   first line>`, then ``Resolves when: reply with `go {cap}` from the web or
   the API, or `cancel` `` (cap) or ``Resolves when: reply `continue` to run
   the next story`` (ask), then the reason's other lines (the figures). The
   result carries `kind`; more refusals by name before any call:
   `UnknownKind` and `ReasonMissing`, and `--kind` is refused with
   `--story`.
   Payload mapping: `story`, `reason`, `resolves` map to their flags;
   `kind` (with `engagement`) adds `--kind <kind>`;
   `source` adds `--source <source>`; `dry_run` adds `--dry-run` (reads
   only, writes nothing).

   The `unblock` verb (Story 36.3) closes a block that was resolved by the
   operator's resume, or by the owner's `go` or `continue`; the supervisor
   calls it on the host, with the agent seat:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/track.py" unblock --directory <project-root> \
     --story <ST-NNN | N-M-slug> --reason "<text>" [--source run] [--dry-run]
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/track.py" unblock --directory <project-root> \
     --engagement <ENG-NNN> --kind cap|ask --reason "<text>" [--dry-run]
   ```

   An issue in `Blocked - Awaiting User` gets one `Resolved: <reason>` agent
   comment with no account mention and moves by name to `Block Resolved`; any
   other status is named in `skipped[]`, with no move and no comment. `--story`
   also moves the dependents `block` moved (one blocked by something else is
   skipped). `--engagement` moves its issue to `Block Resolved`, never `Done`.
   The result is `{ok, dry_run, story, source, issues: [{issue, entity, role,
   from, to, transitioned, commented, skipped?, error?}], skipped[], notes[],
   written: [], retry?}`, plus `engagement` and `kind` on the engagement form.
   Refusals end `blocked` as `block`'s do, with `NoIssue`, `UnknownKind` and
   `ReasonMissing` by name; a temporary failure ends `partial` with `ok: false`
   and `retry: true`.

   The `reply` verb (Story 31.6) is the owner's answer from the web's
   Issue screen; only the supervisor's `POST /inbox/{key}/reply` calls it,
   on the host:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/track.py" reply --directory <project-root> \
     --issue <KEY> (--body-file <path> | --done) [--dry-run]
   ```

   It posts the comment (`--done` writes `Done.`; the body comes from a
   UTF-8 file, never the command line) with the **owner** seat's client
   (`TK_STUDIO_ATLASSIAN_OWNER_EMAIL` and `TK_STUDIO_ATLASSIAN_OWNER_TOKEN`,
   host-only — outside the `TK_ATLASSIAN_` prefix the sandbox receives —
   through the `TK_ATLASSIAN_CLOUD_ID` gateway, REST v2, plain text), then
   moves the issue by name to `Block Resolved`; an issue already there
   skips the transition, named in `skipped[]`. The comment is skipped — named in `skipped[]`, with `commented: true` and the existing `comment_id` — only when an owner comment with the same body already stands after the issue's newest agent comment (read live); a reply to a later re-block always posts. The result is `{ok, dry_run,
   issue, commented, comment_id, transitioned, notes[], skipped[],
   written[], retry?}` with the status block last; no local file is written
   and nothing else is promoted. Payload mapping: `issue` maps to
   `--issue`; `body` is written to a temp file passed as `--body-file`;
   `done: true` adds `--done`; `dry_run` adds `--dry-run`. Its refusals
   (exit 2), each named: an absent owner variable or cloud id, or no
   `planning.jira` binding (no Atlassian call made — the agent's token never
   stands in); no recorded `planning.jira.owner_account_id`; a created
   comment whose author is not the owner (another seat's token: nothing
   moved); no transition reaching `Block Resolved` (the comment stays,
   `commented: true`). A temporary failure ends `partial` with `ok: false`
   and `retry: true`.

   The `validate` verb (Story 31.7, §6.9 items 4 and 5) checks a
   resolution before the story continues, with the **agent** seat only
   (never the owner's variables, never `reply`):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/track.py" validate --directory <project-root> \
     --issue <KEY> (--check | --pass --to "In Progress"|"To Do" \
       [--ruling-file <path> --spec <paused spec>] \
       | --fail --follow-up-file <path>) [--dry-run]
   ```

   `--check` reads the changelog: `owner_resolved` is true only when the
   newest transition into `Block Resolved` carries the recorded owner
   accountId (an older owner transition never validates a later one; an
   absent or empty id never matches). It reads `reason_comment` and
   `replies[]` (the owner's comments after the newest agent comment;
   `Done.` is a valid answer) from local memory only, and marks the inbox
   item `validating`. The result is `{ok, dry_run, issue, mode, entity,
   story, owner_resolved, transition, reason_comment, replies[], notes[],
   written[], retry?}` with the status block last. `--pass` refuses when
   `owner_resolved` is false; it checks a transition reaches `--to` before
   writing anything, writes the ruling when given (`**Ruling (owner, <KEY>
   comment <id>, <date>):** <text>` just before the spec's
   `</intent-contract>` line, else `</frozen-after-approval>`; never
   `status:`), then moves the issue by name to `--to`. `--fail` (whatever
   `owner_resolved` says) re-blocks the issue with the follow-up as the
   reason (a new `Blocked:` agent comment — back in the Inbox); a retried
   `--fail` whose move into `Blocked - Awaiting User` already landed posts
   the missing comment without moving the issue again, and a retried
   `--pass` whose move into `--to` already landed (newer than the owner's
   newest move into `Block Resolved`) writes the ruling (idempotent) and
   the line without moving it again. A ruling the pass wrote is taken back
   out when the pass then ends refused. Each
   outcome appends one line to `_bmad-output/tracking/<KEY>/validation.jsonl`
   (the supervisor's evidence for the resume), named in `written[]`.
   Refusals (exit 2), each named: a bad key; no `planning.jira` binding or
   an absent agent variable (no Atlassian call made); no recorded owner
   accountId; a live status other than `Block Resolved`; a `--pass` when
   `owner_resolved` is false; no transition reaching the target; an absent spec or block for the ruling. A temporary
   failure ends `partial` with `ok: false` and `retry: true`, appends no
   line — call again.

   **Session procedure for `payload.verb: validate`** (the shipped
   `validate-resolution` job; the payload is `{verb, project_root,
   issues:[{issue, story, paused_run, spec}]}`): for each payload issue,
   run `--check` with `--directory <project_root>`. On
   `owner_resolved: false`, take `--fail` with a follow-up asking the owner
   to resolve it from the Inbox. Otherwise read `reason_comment` and
   `replies[]`: when the reason names something runnable on the host — a
   command, a path, a sign-in — test it; else judge whether the replies are
   enough. Pass → `--pass --to "In Progress"` (`--to "To Do"` when the
   story's run never started), adding `--ruling-file <a temp file holding
   the reply verbatim> --spec <spec>` when the reply carries a ruling (the
   block's resolves text names "a ruling in the spec") and the payload
   names a `spec`. Fail → `--fail --follow-up-file <a temp file>` saying
   what is still missing. On `retry: true`, call the same verb again. End
   on the status block; commit nothing.

2. Blocking conditions of `block` (exit 2), each named in `reason`:
   - no `planning.jira` binding (run `plansync.py setup` first), or an
     absent agent-seat variable (`TK_ATLASSIAN_AGENT_EMAIL`,
     `TK_ATLASSIAN_AGENT_TOKEN`, `TK_ATLASSIAN_CLOUD_ID`) — no Atlassian
     call made;
   - no recorded `planning.jira.owner_account_id` — the mention needs it;
     an absent or empty accountId never matches;
   - a story with no plan entity, or never promoted (no
     `external.jira.key`);
   - no transition reaching `Blocked - Awaiting User` on the story's issue,
     or its block comment refused by name after the transition (the entry
     keeps `transitioned: true` and names `block comment refused`);
   - the 401/403 split of the adapter (the token, its email, its expiry or
     the org toggle; the sandbox proxy's network approval step; a missing
     scope).

   A temporary failure (an exhausted 429, a 5xx, the site unreachable) on
   the story's own issue, or on a dependent's after the story's issue was
   blocked (the other dependents still run), is no refusal: it ends
   `partial` with `ok: false` and `retry: true` (exit 0), and the caller
   calls again on its next pass. A dependent that fails otherwise while the
   story's issue was blocked ends `partial`, naming it; a dry run that would move or comment ends
   `partial` too.

3. Report:
   - **Attended:** show each issue moved or skipped and the comment text.
   - **Headless:** no prompts (AD-11). Relay the core's `status`, `reason`
     and `artifacts` as they are — never infer the status from the exit
     code (`partial` exits 0):

     ```json
     {"status": "complete", "intent": "tk-studio-track", "artifacts": [], "reason": null}
     ```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- No skill other than this one and `tk-studio-plan-sync` writes to Jira,
  and both only through `lib/jirabackend.py` (AD-4).
- Only the status move and the block comment (or the owner's reply) are written; entity fields
  stay canonical (AD-5, D9) — the sync-back pulls the new status back.
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
