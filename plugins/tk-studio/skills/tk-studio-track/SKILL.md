---
name: tk-studio-track
description: Tracking verbs on the bound Jira project — `block` moves a story the loop cannot progress, and each dependent story, to "Blocked - Awaiting User" with a comment that @mentions the owner; `reply` posts the owner's answer (or "Done.") with the owner's host-only token and moves the issue to "Block Resolved". Use when the user says "block this story", "tk track block", "put it in the owner's inbox", "reply to the blocked issue", or a supervisor or engagement payload names this skill.
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
   Payload mapping: `story`, `reason`, `resolves` map to their flags;
   `source` adds `--source <source>`; `dry_run` adds `--dry-run` (reads
   only, writes nothing).

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
