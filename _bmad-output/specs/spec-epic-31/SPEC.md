---
id: SPEC-epic-31
companions:
  - ../../planning-artifacts/design/studio-design-spec-2026-10-09/README.md
  - ../../planning-artifacts/design/studio-design-spec-2026-10-09/decisions.md
  - ../../planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md
  - ../../../plugins/tk-studio/contracts/driver-contract.md
  - ../../../kb/agent-pc-setup-runbook.md
sources:
  - ../../planning-artifacts/epics.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Epic 31: Tracking on Atlassian and the Inbox

## Why

A vision plus a mandate. The design spec's §6.8 and §6.9 are the build order's next epic after EP-30: planning and knowledge move onto Atlassian's free tier (Jira for the tracker, Confluence for the wiki, two seats: the owner and an agent user with its own API token) and the human channel becomes one inbox. The plan stays canonical in `_bmad-output/` for entity fields (AD-5); comments, attachments and owner-authored Confluence pages are a new class, backend-authoritative and append-only, pulled back verbatim and never promoted from local (D9, AD-22). The base is the planning adapter (AD-4 to AD-6), the Jira adapter with promote and status pull-back (Epic 8) and the knowledge promotion gate (Epic 9); AD-7 keeps API tokens, never OAuth. Tim's inbox model (§6.9) is adopted as written. The web screens here (Inbox, Issue) extend EP-30's `apps/studio-web`; the office's "!" bubble is the only office change. Attended: the Atlassian accounts, the two seats and their tokens are Tim's to create; the studio hands him exact steps for what the API cannot do. Repo: tk-studio (`plugins/tk-studio/lib`, `apps/supervisor`, `apps/studio-web`, `kb/`, `plugins/tk-studio/contracts/driver-contract.md`).

## Capabilities

- **CAP-1** (31.1)
  - **intent:** The free plans' limits are verified and recorded before anything is built on them.
  - **success:** With an Atlassian site on the free plans holding the owner seat and the agent user seat (created by Tim, attended), the research runs through the `tk-studio-research` surface (a digest to disk) and `kb/atlassian-free-tier.md` records, with the source and the date: whether a Free Jira project allows the two custom statuses and a workflow transition between them; the project-permission model available (who can transition, comment, attach); the REST API's rate limits and the token's scope; Confluence Free's space, page and attachment limits; and whether the Rovo MCP server adds anything the REST API with an API token does not (the adapter uses REST today). Each finding ends in "fits", "fits with a workaround (named)" or "does not fit"; a "does not fit" on the statuses or the API halts the epic with the alternative named.
- **CAP-2** (31.1)
  - **intent:** The owner knows exactly what to create by hand and how the studio reads it.
  - **success:** The story names the exact attended steps for the site, the two seats and the two API tokens, and the tokens' environment variable names, never the values.
- **CAP-3** (31.1)
  - **intent:** The record settles the design spec's open questions and reaches the later stories.
  - **success:** When the story closes, `decisions.md` Appendix C's two Atlassian open questions are answered by reference to the record, and Stories 31.2 to 31.7 carry the workarounds it names as a story-level note, never a silent change.
- **CAP-4** (31.2)
  - **intent:** Onboarding a project creates its Confluence space and its linked Jira project from the studio template.
  - **success:** Given a registered project, the site's URL and the two tokens in the environment, `tk-studio-onboard`'s new optional set-up-tracking step (refused with a named reason when the tokens are absent) has the planning adapter's Jira binding create the Jira project from the template (key from the project id, issue types epic and story, the workflow `To Do`, `In Progress`, `Blocked - Awaiting User`, `Block Resolved`, `Done`), the linked Confluence space with the folder structure for the design pages (brief, GDD, scope of work, decisions, records), the saved filter "Needs you" (`status = "Blocked - Awaiting User" ORDER BY priority DESC, updated ASC`), and records the keys and ids under `.tk-studio/config.yaml`'s planning binding; every step the API cannot do on the free plan (31.1's findings) is printed as an exact, numbered instruction for the owner and the run ends `partial` naming them, never `complete`.
- **CAP-5** (31.2)
  - **intent:** Setup is safe to run again.
  - **success:** A second run is idempotent: existing space, project, statuses and filter are recognised by key and left as they are, and the result names what it found; the story is `bun test`-free: the lib suite covers the template, the idempotence and the refusals with a fake Atlassian REST.
- **CAP-6** (31.3)
  - **intent:** The design pages publish to Confluence and epics and stories promote to Jira, with the plan still canonical.
  - **success:** Given the planning artifacts under `_bmad-output/planning-artifacts/` and the design folder, `plansync.py sync` with the Jira binding (today's promote) and the new `publish` verb create or update each design page in the space's folder by a stable title, with a provenance footer naming the source file and the commit, Markdown converted to Confluence storage format (headings, lists, tables, code, links; images attached), and unchanged pages skipped by content hash; epics and stories promote as before, now with a link to their design pages; nothing from Confluence changes an entity field (AD-5).
- **CAP-7** (31.3)
  - **intent:** The publish is pinned and named in the contract.
  - **success:** The lib suite covers the conversion, the hashing, the idempotence and the provenance with a fake Confluence REST; the contract's §2 names `publish` (additive).
- **CAP-8** (31.4)
  - **intent:** Status, comments, attachment links and the owner's pages are in local memory, so no agent queries Atlassian live for context.
  - **success:** The shipped job `atlassian-sync-back` (cron, every 10 minutes by default; `durable`) pulls each tracked issue's status (mapped onto the canonical enum per AD-6, the Jira original kept under `external.jira`), its comments (append-only into `_bmad-output/tracking/<key>/comments.jsonl`: `{issue, author: owner | agent, body, mentions[], created, source: jira}`), its attachments as links, and every owner-authored Confluence page into `kb/confluence/<slug>.md` with a provenance header (read-only sources: a local edit is overwritten and reported); nothing local is promoted back; the run's record names counts and the newest comment seen.
- **CAP-9** (31.4)
  - **intent:** The sync-back is pinned and its health is visible.
  - **success:** The lib suite covers the status mapping, the append-only comment log (a comment seen twice is written once), the attachment links, the page mirror and the overwrite report, with a fake REST; `tk-studio-activate`'s drift check gains a `tracking` plane that says when the last sync-back ran and whether the binding is reachable.
- **CAP-10** (31.5)
  - **intent:** Every issue the loop cannot progress sits in `Blocked - Awaiting User` with its reason.
  - **success:** When the loop reports a story it cannot progress (a dev session's `blocked` end, a `paused` run awaiting a ruling, an engagement question), the issue and each dependent story (by the plan's links) move to `Blocked - Awaiting User` with a comment that @mentions the owner and names the reason and what resolves it: a `tk-studio-track block` verb the supervisor's paused-run pass and the engine's escalation hook call.
- **CAP-11** (31.5)
  - **intent:** One list, derived from that status, says what needs the owner.
  - **success:** The sync-back reads the mentions and derives `inbox_item {issue, priority, blocked_since, reason_comment, state: open | resolved | validating}` for every issue in that status, sorted by priority then time, into `_bmad-output/tracking/inbox.json`; the supervisor serves it at `GET /inbox` (a supervisor surface the web consumes, contract 0.1.26 additive); the office shows a persistent "!" bubble on the desk whose work is blocked, cleared when the status changes, never when a message arrives.
- **CAP-12** (31.6)
  - **intent:** The web's Inbox lists what needs the owner.
  - **success:** The Inbox screen lists the open items of `GET /inbox` sorted as served, each with the project, the issue key and title, the priority, how long it has waited and the reason's first line; the web's nav gains Inbox and Issue; the count sits on the nav item.
- **CAP-13** (31.6)
  - **intent:** The owner answers from the desktop or the iPad without opening Jira.
  - **success:** The Issue screen shows one item Jira-like (status, the run and PR when the plan links one, the cost from the ledger when known, the comments in order with author and time), a reply box, and a **Done** button for a simple request; sending a reply, or Done (which writes "Done." as the owner), posts the comment through the supervisor (`POST /inbox/{key}/reply`, the owner's token, never the agent's) and moves the issue to `Block Resolved`; the item leaves the list on the next sync-back; vitest covers the list, the view and the two actions with a fixture.
- **CAP-14** (31.7)
  - **intent:** An agent validates a resolved block before the story continues.
  - **success:** When the sync-back sees an issue in `Block Resolved`, the supervisor queues a `validate-resolution` job for the project (host tier, the planner leg's model): the session reads the reason and the reply and either tests the thing it had to be able to do (a command, a path, a sign-in) or judges whether the answer is enough; a pass moves the issue back to `To Do` or `In Progress` (the loop re-arms the story: the supervisor's paused run resumes with the ruling written into the spec, or the job's next tick re-runs it); a fail moves it to `Blocked - Awaiting User` with a follow-up comment that lands in the inbox again.
- **CAP-15** (31.7)
  - **intent:** The owner has one inbox for everything, rulings included.
  - **success:** The engagement's questions and approvals and the loop's `escalate` rulings are each an issue with comments in the same project; the supervisor's `awaiting-ruling` writes the block instead of a Telegram note alone, and a reply that carries a ruling is written into the spec by the validation session; the lib suite and `bun test` cover the queueing, the two outcomes and the ruling write with fakes.

## Constraints

- Rulings in force, not reopened: D9/AD-22 (comments, attachments as links and owner-authored Confluence pages are backend-authoritative and append-only, pulled back verbatim, never promoted from local, never mirrored into canonical story files), AD-5 unchanged for entity fields (the plan canonical in `_bmad-output/`, status-class pull-back only), AD-6 (the two Jira statuses map onto canonical `blocked` with the original under `external.jira`), AD-7 (API tokens, never OAuth; the org-admin token toggle is part of the preflight), AD-3 (tokens in the environment or the per-user store, never a file in a checkout), AD-4 (the backend only through the adapter front door, `plansync`), AD-2 (`GET /inbox` and `POST /inbox/{key}/reply` are supervisor surfaces, never plugin surfaces), AD-11 (headless ends on the status block, never a prompt).
- Verify before building: 31.1 lands first and every later story is designed against what the record says Free allows; a "does not fit" on the statuses or the API halts the epic with the alternative named; the workarounds the record names reach 31.2 to 31.7 as story-level notes, never a silent change.
- Two seats, two writers: the agent user writes as the agent (its variables reach the engine sandbox by name only: `TK_ATLASSIAN_SITE`, `TK_ATLASSIAN_AGENT_EMAIL`, `TK_ATLASSIAN_AGENT_TOKEN`, per the runbook and the supervisor README; no value on a command line, in an event or in a file a worktree could carry); the owner's replies and Done go through the supervisor with the owner's token, never the agent's; the site, the seats and the tokens are created by Tim, attended.
- Every studio-managed Jira project carries the five-status workflow (`To Do`, `In Progress`, `Blocked - Awaiting User`, `Block Resolved`, `Done`) and the saved filter "Needs you"; the inbox is derived from the `Blocked - Awaiting User` status on every sync-back, never from a message's arrival.
- What the API cannot do on the free plan is handed to the owner as exact, numbered instructions and the run ends `partial` naming them, never `complete`; the loop never drives a browser to do it.
- Agents read locally and never query Atlassian live for context: the sync-back on a timer (10 minutes by default, `durable`) is the only reader of comments, attachments and pages, into `_bmad-output/tracking/` and `kb/confluence/` (read-only mirrors with provenance; a local edit is overwritten and reported).
- The web screens (Inbox, Issue) extend EP-30's `apps/studio-web` and consume only supervisor surfaces; the office's "!" bubble is the only office change; the contract bump is 0.1.26, additive (`GET /inbox` and `POST /inbox/{key}/reply` among §1's web surfaces; `publish` in §2); a story that changes a contract surface updates `driver-contract.md` and its schemas in the same story (AD-19).
- Repo and gates: tk-studio (`plugins/tk-studio/lib`: `jirabackend.py`, `plansync.py`, the new Confluence and tracking modules; `apps/supervisor`; `apps/studio-web`; `kb/`; the contract); driven by the supervisor's queue (the `run-epic-31` job, a worktree, the engine in the sandbox, `tools/verify_host.py` as the host leg) with the studio customization's verify gate (lib suite and conformance green) plus `bun test` in `apps/supervisor` and `bun run build` and `bun run test` in `apps/studio-web` where those apps change; every lib test uses a fake Atlassian REST, never the live site; every headless surface ends with the status block (AD-11); the loop never pushes, tags or cuts a release.

## Non-goals

- OAuth, or the Rovo MCP server as the adapter's transport (REST with API tokens, AD-7/AD-22), unless 31.1's record shows REST cannot do a needed thing, and then only as a story-level note.
- Promoting comments, attachments or Confluence pages from local to the backend, or mirroring comments into canonical story files (D9's rejected alternative).
- A studio-built tracker or wiki.
- Creating the Atlassian site, the seats or the tokens (Tim's, attended).
- Chat (EP-32), the phone UI (EP-34), Linear.
- Changes to AD-5's entity-field rule or to the plan's canonical home.
- A public-exposure mode (D10).

## Success signal

- On the box with the site and the two seats, `tk-studio-onboard` sets up a project's Jira project and Confluence space from the template (or ends `partial` with numbered attended steps), `publish` lands the design pages with provenance, `atlassian-sync-back` mirrors status, comments, attachment links and owner pages locally every 10 minutes, a story the loop cannot progress appears in the web's Inbox and as the "!" bubble on its desk, the owner's reply or Done moves it to `Block Resolved`, and a `validate-resolution` job re-arms the story or returns it to the inbox with a follow-up; `kb/atlassian-free-tier.md` stands behind each design choice; lib suite, conformance, `bun test` and vitest are green.

## Assumptions

- The agent seat's three variables are the runbook's (`TK_ATLASSIAN_SITE`, `TK_ATLASSIAN_AGENT_EMAIL`, `TK_ATLASSIAN_AGENT_TOKEN`), already passed into the sandbox by the supervisor (PR #159); 31.1 names the owner token's variable under the same prefix family; the Epic 8 adapter reads `JIRA_API_TOKEN` / `JIRA_EMAIL` today, and the planner settles for 31.2 whether the binding reads the `TK_ATLASSIAN_*` names directly or aliases them (a settled shape, not a Block If).
- The job is named `atlassian-sync-back` as the epic text says (AD-22 wrote `atlassian-sync` on 2026-10-14; the epic, planned 2026-10-20, is later) and the comment log lives at `_bmad-output/tracking/<key>/comments.jsonl` per the epic, not in the story files as AD-22's phrase "the story files' comment logs" suggests.
- 31.1's "research surface, a digest to disk": the dev session runs `tk-studio-research`'s charter-and-graded-findings discipline (the core lands `findings.json` / `findings.md` in the run workspace of the per-user store) and the story writes `kb/atlassian-free-tier.md` from those findings, each carrying its source and date; the live-site probes use the agent seat's variables in the sandbox when they are set, and name "attended check not yet done" per the EP-30 record convention when they are not.
- The contract header reads 0.1.25 (30.6 landed); 31.3 (`publish`), 31.5 (`GET /inbox`) and 31.6 (`POST /inbox/{key}/reply`) land in one 0.1.26 entry extended per story, the first to land taking the bump (EP-30's precedent for 0.1.25).
- 31.2 records `planning.jira.*` (site, project key, the owner and agent account emails as identity) and a `knowledge.confluence.*` binding (space key, folder page ids) under the tracked `.tk-studio/config.yaml`, never a token (AD-3); the planner settles the exact keys for 31.2 in the plan's Settled shape.
- "`bun test`-free" in 31.2 means the story changes nothing in `apps/supervisor` or `apps/studio-web` (the lib suite is its whole gate); "the plan's links" in 31.5 are the dependency fields the canonical interchange shape carries (`interchange/shape.v1.json`), the planner naming the field; the Issue screen's cost is the `job-run` spend the board already reads (30.5); priority is the Jira issue priority field pulled on sync-back; `kb/confluence/<slug>.md` follows the kb frontmatter (`title`, `description`, `rank`) plus the page id, version, author and pulled date, and `kb/index.md` is regenerated.
- `validate-resolution` (31.7) is a shipped supervisor job type on the host tier like `run-epic`, routed on the planner leg of `.bmad-loop/routing.current.json`; "the supervisor's `awaiting-ruling`" is the paused-run pass that today sends the Telegram note.

## Open Questions

- AD-22 says Confluence publishing of `kb/` "leaves Deferred and lands here", while 31.3 publishes the design pages (brief, GDD, scope of work, decisions) only: is `kb/` publishing in this epic (which story), or deferred to a later one?
- The owner's token (31.6: replies and Done post with the owner's token, never the agent's): where does it live and under what name? The supervisor passes every `TK_ATLASSIAN_*` variable into the engine sandbox by name, so an owner token under that prefix would reach the agents too; does 31.1 name it under another prefix (host-only, read by the supervisor alone), or is the passthrough list to exclude it?
- Does the engine sandbox's `balanced` network policy reach the Atlassian site (`<site>.atlassian.net`, `api.atlassian.com`) for 31.1's live verification of the free plans, or do the live probes run attended on the host (the lib tests use fakes either way)?
- 31.1's "does not fit" on the statuses or the API halts the epic with the alternative named: who rules on the alternative, the record (the dev session) or Tim through the inbox the epic has not built yet (today: the supervisor's `awaiting-ruling` note)?

## Design notes (settled shape, planner, 2026-10-24)

- CAP-2 — owner token variable: named placeholder rule: a name outside the `TK_ATLASSIAN_` prefix, host-only, read by the supervisor; the record names it — per `apps/supervisor/README.md` §Secrets into the sandbox, `kb/agent-pc-setup-runbook.md` §3.8
- CAP-3 — story-level notes: deferred entry: one replan-queue entry per affected unstarted story, `Status: open`, the workaround as its Suggested adjustment; the gate folds it into `invoke_dev_with` — per `.bmad-loop/plugins/studio-pipeline/task-planning.md` §2
