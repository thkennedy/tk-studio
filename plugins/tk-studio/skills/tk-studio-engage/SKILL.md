---
name: tk-studio-engage
description: The planner leg of an engagement — `reply` reads the engagement's memory (the record, the chat so far, the plan under `_bmad-output/planning-artifacts/`, `kb/` and `kb/confluence/`) and writes the planner's reply line, with optional proposals the owner can press, to the engagement's `chat.jsonl`; `questions` writes at most three multiple-choice clarifying questions, each with a default, for the owner's inbox. Use when a supervisor `engagement-chat` payload names this skill, or the user says "reply in the engagement chat" or "tk engage reply".
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
   memory {plan, kb, confluence}, notes[], written[]}` with the status block
   last. `record` is the engagement record (`engagement.yaml`, JSON text);
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

4. Blocking conditions (exit 2), each named in `reason`: `BadEngagement`
   (not like `ENG-001`), `UnknownEngagement` (no record),
   `EngagementRecordUnreadable` (not JSON, or not this engagement's record),
   `EngagementClosed` (`delivered`, `failed` or `cancelled`), `BodyEmpty`,
   `BodyTooLarge`, `RunIdRequired`, `ProposalInvalid` (naming the index),
   `ChatBusy` (the chat lock held past the wait), `ChatUnwritable` (the
   chat not UTF-8, or the lock or chat file refused by the OS), an unreadable
   `--body-file` or `--proposals-file`. Nothing is appended on a refusal; a
   dry run appends nothing and ends `partial`.

5. Report:
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
  reply, and its `questions.json` (Story 32.3); nothing is committed,
  nothing is promoted.
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
