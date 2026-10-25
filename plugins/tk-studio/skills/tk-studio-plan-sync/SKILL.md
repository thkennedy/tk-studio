---
name: tk-studio-plan-sync
description: Planning adapter — canonicalize BMad-native planning artifacts (normalize pass, sole id authority) and sync them with the bound planning backend. Use when the user says "sync the plan", "normalize planning artifacts", "tk plan sync", or after stock BMad planning flows produce or change epics/stories.
---

# tk-studio-plan-sync

The adapter side of AD-4: stock BMad planning skills stay untouched; this
skill canonicalizes what they produce. The normalized `_bmad-output/`
planning artifacts are the single canonical local representation under every
binding, and this skill is the **sole id authority** (EP-/ST-/TA-NNN from the
committed per-project counter at `.tk-studio/plan-counter.yaml`).

## Behavior (both modes)

1. Run the full adapter verb through the plugin root:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/plansync.py" sync --directory <project-root>
   ```

   `sync` = normalize → validate → projection → plan index, where only the
   projection step is binding-driven (resolved from `planning.backend`,
   AD-15 order; `--backend NAME` is the runtime override). Under
   `bmad-files` the canonical files are the backend: projection is a clean,
   first-class no-op (FR14). Under `backlog-md` the projection is pull-back
   → promote (AD-5): backend status-class changes (status, assignee) land on
   canonical files first — echo-suppressed against the `external.backlog-md`
   snapshot, both-changed entities surfaced as **conflicts** for a human,
   never resolved silently — then canonical entities project into a
   Backlog.md-compatible `backlog/` (epic → milestone + label linkage;
   story/task → task files, native keys only with the canonical id as the
   first label — Backlog.md 1.48.0 verifiably drops unknown frontmatter
   keys; see `kb/backlog-md-verified-behavior.md`). Under `jira` (AD-7) the
   same pull-back → promote round runs against Atlassian Cloud: the
   **preflight** first proves the API token AND the org-admin API-token
   toggle in one probe (`GET /myself`) and confirms the AD-6 default
   issue-type mapping (epic → Epic, story → Story, task → Sub-task) against
   the org's actual scheme; then pull-back ingests backend status/assignee
   (echo-suppressed via `external.jira`, both-changed = conflict) and
   promote creates/updates issues (canonical id rides as the first label;
   status set by transition into the matching Jira status *category*, which
   keeps mapping round-trip stable). Binding config: `planning.jira.site` +
   `planning.jira.project_key` (tracked). Credentials ride the environment
   **only** — never any config file (AD-3): the agent seat's scoped token
   `TK_ATLASSIAN_AGENT_TOKEN` with `TK_ATLASSIAN_AGENT_EMAIL`, through the
   `https://api.atlassian.com/ex/jira/<TK_ATLASSIAN_CLOUD_ID>` gateway
   (`/rest/api/2` kept); either agent token set without
   `TK_ATLASSIAN_CLOUD_ID` refuses by name, never the site URL. With
   `TK_ATLASSIAN_AGENT_TOKEN` unset, the legacy `JIRA_API_TOKEN` plus
   `JIRA_EMAIL` (or `planning.jira.email`) against the site URL. Auth is
   API-token, never OAuth (legacy-council ISS-008); any gap blocks with
   every cause named — a 401 names the token, its email, its expiry and
   the org toggle; the sandbox proxy's 403 (`Approval required for
   <host>:443`) is the network approval step; any other 403 names the
   missing scope and asks for a new token — never a silent 401 (AD-11).
   `setup --directory <root> [--dry-run] [--owner-account-id <id> |
   --owner-email <email>]` creates the project's tracking from the studio
   template — the Jira project (key from the project id), issue types Epic
   and Story, the statuses `Blocked - Awaiting User` and `Block Resolved`
   with their transition, the "Needs you" filter, the Confluence space
   (`TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN`, gateway only) and its folders
   Brief, GDD, Scope of Work, Decisions and Records — recognising each by
   key first, and records the keys and ids under `planning.jira` and
   `planning.confluence`. What the API refuses becomes the owner's
   numbered steps (`owner_steps[]`) and the run ends `partial`; an
   unregistered project or an absent agent-seat variable ends `blocked`
   before any call; a dry run that would create anything ends `partial`
   too (`would_create[]`). `tk-studio-onboard`'s optional tracking step
   calls it. Payload mapping: `setup: true` runs `plansync.py setup
   --directory <directory>`; `dry_run` adds `--dry-run`; `owner_account_id`
   adds `--owner-account-id <id>`, else `owner_email` adds `--owner-email
   <email>`.
   `publish --directory <root> [--dry-run] [--source <category>=<path>]
   [--attachment-max-bytes <n>]` (Story 31.3) publishes the design pages
   (brief, GDD, scope of work, decisions — never the records folder) to
   the folders setup recorded, by the stable title `<Folder>: <slug>`,
   Markdown converted to Confluence storage format with images attached,
   each page ending with a provenance footer (source file, the last commit
   that touched it, the content hash); an unchanged page is skipped. An
   image over the per-file ceiling (100 MB assumed unless
   `--attachment-max-bytes` supplies the site's smaller setting) is refused
   by name and its page still publishes; `bytes_uploaded` reports the
   upload against Confluence Free's 2 GB. It writes
   `.tk-studio/confluence-pages.json`, from which the `jira` promote adds a
   `Design pages:` line to every epic and story; nothing from Confluence
   changes an entity field (AD-5). An absent agent-seat Confluence variable,
   no `planning.confluence` binding ("run `plansync.py setup` first"), a
   bad `--source` or a duplicate title ends `blocked` before any call; a
   category with no folder, a refused page or image, or a dry run that
   would publish ends `partial`. Payload mapping: `publish: true` runs
   `plansync.py publish --directory <directory>`; `dry_run` adds
   `--dry-run`; `attachment_max_bytes` (the site's Attachment maximum
   size, in bytes) adds `--attachment-max-bytes <n>` — the effective
   ceiling is the smaller of it and 100 MB, and the result's `notes[]`
   says which was used. An image outside the project root (an absolute
   path, a non-http(s) scheme, a `../` escape or a symlink out) is refused
   by name before any read and its page still publishes.
   `sync-back --directory <root> [--dry-run]` (Story 31.4) pulls the
   project's Atlassian state into local memory so that no agent queries
   Atlassian live for context: each tracked issue's status (canonical by
   name first — `Blocked - Awaiting User` and `Block Resolved` are
   `blocked` — then by status category; the Jira original kept under
   `external.jira`, `updated` stamped; no other entity field changes, and
   `plan/index.md` is regenerated local-only when a status changed), its comments
   append-only into `_bmad-output/tracking/<KEY>/comments.jsonl` (a
   comment seen twice is written once; an edit appends a line), its
   attachments as links into `attachments.jsonl` (never downloaded or
   uploaded), and every owner-authored page of the recorded Confluence
   space into `kb/confluence/<slug>.md` with a provenance header (read-only:
   a local edit is overwritten and named in `overwritten[]`). Story 32.4:
   each engagement's scope page (the record's `scope_page.id`, agent-
   published, so never in the owner-page mirror) is read by id; a version
   above the record's `scope_page.version` is mirrored as Markdown into
   `kb/confluence/<slug>.md` (the provenance header plus `engagement:
   ENG-NNN`; its state under `sync-state.json` `engagement_pages`) and,
   while the engagement is `scoping`, replaces its `scope.md` wholesale
   (the page is authoritative, D9) and merges the version into the record;
   in any other state only the mirror is written and `notes[]` says
   `scope edit of ENG-NNN not applied: state <s> (send revise)` once per
   version (no state moves). A page gone (404) is a note; counts gain
   `engagement_pages_mirrored` and `scopes_replaced`. One paged JQL
   search per tick, never a GET per issue — only an issue whose
   `comment.total` exceeds the comments the search returned pages
   `GET /rest/api/2/issue/{key}/comment` (overflow only); the cursor in `_bmad-output/tracking/sync-state.json`
   moves only after every page was read. Nothing local is promoted back.
   The result names `counts`, `newest_comment`, `applied[]`,
   `conflicts[]`, `overwritten[]`, `rate_limit`, `notes[]` and `written[]`.
   No `planning.jira` binding or an absent Jira variable ends `blocked`
   before any call; a failed preflight (unreachable, deactivated, the
   401/403 split, or a preflight answered with another, non-auth status:
   run case `error`) ends `blocked`; an absent
   `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN` (the Jira half still runs), an
   unrecorded `planning.confluence.space_id` (the mirror skipped), no
   recorded owner accountId, a conflict, or a 429 or error that
   interrupted a read ends `partial`. The shipped cron job
   `atlassian-sync-back` runs it every 10 minutes. Payload mapping:
   `sync_back: true` runs `plansync.py sync-back --directory <directory>`;
   `dry_run` adds `--dry-run` (reads only, writes nothing).

   `normalize --directory <root>` runs the canonicalization pass
   alone. Add `--dry-run` to preview without writing (under `jira` a
   dry-run never contacts the backend). The normalize pass:
   - derives/repairs one canonical entity file per epic/story under
     `_bmad-output/planning-artifacts/plan/<ID>.md` from `epics.md` (matched
     across runs by the `source` key — ids never move; `epics.md` itself is
     never rewritten);
   - mints missing ids from the committed counter (document order, counter
     persisted atomically before entity files — a crash leaves a gap, never a
     duplicate);
   - stamps `canonical_id` into matching `implementation-artifacts/story-N.M.md`
     files textually (one line; every other byte preserved);
   - pulls story status from `sprint-status.yaml` when present, mapped onto
     the closed canonical enum (unmappable states reported, never guessed).

   The result names **every file the run wrote** — `written[]` at both
   levels (counter, entity files, story-file stamps, projection writes with
   their canonical snapshot rewrites, index) plus `removed[]` (projection
   files replaced on rename), with `normalize.counter` naming the committed
   id counter — so commit staging derives from the response alone: stage
   exactly the `written[]` and `removed[]` paths, nothing recalled by hand
   (EP-017, PROP-020). A sync blocked at the projection still names
   normalize's landed writes.

2. Blocking conditions (exit 2, nothing written):
   - **duplicate ids** anywhere under `_bmad-output/` — both paths are named;
     a human renumbers, then sync reruns (AD-4: never auto-pick a survivor);
   - **invalid present values** in canonical frontmatter (bad status, id,
     dates) — repair fills only *missing* keys, it never rewrites a present
     value it cannot trust (AD-3 refuse-to-guess);
   - **jira preflight failure** — missing binding config or credentials,
     401/403 (token or org toggle), or an issue-type scheme missing a
     default-mapping target — each gap named (AD-7/AD-11).
   - **publish refusal** — an absent `TK_ATLASSIAN_AGENT_EMAIL`,
     `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN` or `TK_ATLASSIAN_CLOUD_ID`, no
     `planning.confluence` binding, a bad `--source`, or two sources with
     one title — each named, no Atlassian call.
   - **sync-back refusal** — no `planning.jira` binding or an absent Jira
     variable — each named, no Atlassian call.

3. Report:
   - **Attended:** summarize actions (created/repaired/unchanged, minted
     ids, stamps, notes); on a block, show the exact file paths and what to
     fix — never fix ids silently.
   - On **conflicts** (both sides changed since the last sync): list each
     conflicted entity with both values and both file paths; the human picks
     a side by editing one of them, then reruns sync.
   - **Headless:** no prompts (AD-11). End with the status block. When
     the core's result carries its own `status` (`setup`, `publish` and
     `sync-back` do: `complete`, `partial` or `blocked`), relay that
     `status`, its `reason` and its `artifacts` as they are — never infer
     the status from the exit code (`setup`, `publish` and `sync-back`
     exit 0 on `partial`). For `sync`,
     `normalize` and `status`, whose results carry no `status`: `complete`
     on exit 0 (report conflicts as `partial` with the conflict list in
     `reason`), `blocked` on exit 2 with the blocking reason:

     ```json
     {"status": "complete", "intent": "tk-studio-plan-sync", "artifacts": ["_bmad-output/planning-artifacts/plan/"], "reason": null}
     ```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- Only this skill (via `lib/plansync.py`) mints ids or writes canonical
  frontmatter keys — no other skill, stock or studio, ever does (AD-4).
- Entity shape questions resolve against `contracts/interchange/shape.v1.json`
  via `lib/interchange.py` — the single shipped validator.
- Backend projection (promote / status pull-back) is binding-driven;
  `bmad-files` means normalize + validate + index with no projection — a
  first-class no-op, not an error. Every backend, Jira included, is a
  projection of the canonical files, never authoritative (AD-5); no skill
  other than this one ever calls a planning backend (AD-4).
- `plan/index.md` is generated — a foreign index.md in its place is refused,
  never overwritten.
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
