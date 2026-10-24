---
id: SPEC-epic-31
companions:
  - ../../planning-artifacts/design/studio-design-spec-2026-10-09/README.md
  - ../../planning-artifacts/design/studio-design-spec-2026-10-09/decisions.md
  - ../../planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md
  - ../../../plugins/tk-studio/contracts/driver-contract.md
sources:
  - ../../planning-artifacts/epics.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Epic 31: Tracking on Atlassian and the Inbox

## Why

A mandate plus a pain. The design spec's §6.8 (feedback 1) moves planning and knowledge onto Atlassian's free tier: Jira for the tracker, Confluence for the wiki, two seats of the ten (the owner and an agent user with its own API token, so the studio's posts are distinguishable from the owner's), so the studio stops building a tracker and a wiki and the plan is readable from any device without the studio site. §6.9 (feedback 2) makes the human channel one inbox, Tim's model adopted as written. The plan stays canonical in `_bmad-output/` for entity fields (AD-5); comments, attachments and owner-authored Confluence pages are a new class, backend-authoritative and append-only, pulled back verbatim and never promoted from local (D9, AD-22). The base is the planning adapter (AD-4 to AD-6), the Jira adapter with promote and status pull-back (Epic 8, REST v2) and the knowledge promotion gate (Epic 9); AD-7 keeps API tokens, never OAuth. The next epic after EP-30 in the build order, planned 2026-10-20. The web screens (Inbox, Issue) extend EP-30's app; the office's "!" bubble is the only office change. Attended: the Atlassian accounts, the two seats and their tokens are Tim's to create; the studio hands him exact steps for what the API cannot do. Repo: tk-studio (`plugins/tk-studio/lib` and skills, `apps/supervisor`, `apps/studio-web`, `kb/`, the contract, the design spec's `decisions.md`); seven stories, 31.1 verifying the free tier before anything is built on it.

## Capabilities

- **CAP-1** (31.1)
  - **intent:** The free plans' limits are checked on a live site before anything is built on them.
  - **success:** Given an Atlassian site on the free plans with the owner seat and the agent user seat (created by Tim, attended; the story names the exact steps and the two API tokens' environment variables, never the values), the research runs (the `tk-studio-research` surface, a digest to disk) and `kb/atlassian-free-tier.md` records, with the source and the date: whether a Free Jira project allows the two custom statuses and a workflow transition between them; the project-permission model available (who can transition, comment, attach); the REST API's rate limits and the token's scope; Confluence Free's space, page and attachment limits; and whether the Rovo MCP server adds anything the REST API with an API token does not (the adapter uses REST today); each finding ends in "fits", "fits with a workaround (named)" or "does not fit".
- **CAP-2** (31.1)
  - **intent:** The record decides the epic and the stories carry its workarounds.
  - **success:** A "does not fit" on the statuses or the API halts the epic with the alternative named; when the story closes, `decisions.md` Appendix C's open questions are answered by reference to the record, and stories 31.2 to 31.7 carry the workarounds it names as a story-level note, never a silent change.
- **CAP-3** (31.2)
  - **intent:** Onboarding a project creates its Confluence space and its linked Jira project from the studio template.
  - **success:** Given a registered project, the site's URL and the two tokens in the environment, `tk-studio-onboard`'s new optional tracking-setup step (refused with a named reason when the tokens are absent) has the planning adapter's Jira binding create the Jira project from the template (key from the project id, issue types epic and story, the workflow with `To Do`, `In Progress`, `Blocked - Awaiting User`, `Block Resolved`, `Done`), the linked Confluence space with the folder structure for the design pages (brief, GDD, scope of work, decisions, records), the saved filter "Needs you" (`status = "Blocked - Awaiting User" ORDER BY priority DESC, updated ASC`), and records the keys and ids under `.tk-studio/config.yaml`'s planning binding; every step the API cannot do on the free plan (31.1's findings) is printed as an exact, numbered instruction for the owner and the run ends `partial` naming them, never `complete`.
- **CAP-4** (31.2)
  - **intent:** Setup is safe to run again.
  - **success:** Run again, existing space, project, statuses and filter are recognised by key and left as they are, and the result names what it found; `bun test`-free: the lib suite covers the template, the idempotence and the refusals with a fake Atlassian REST.
- **CAP-5** (31.3)
  - **intent:** The design pages publish to the project's Confluence space while epics and stories promote to Jira as today.
  - **success:** Given the planning artifacts under `_bmad-output/planning-artifacts/` and the design folder, `plansync.py sync` with the Jira binding (today's promote) and the new `publish` verb create or update each design page in the space's folder by a stable title, with a provenance footer naming the source file and the commit, Markdown converted to Confluence storage format (headings, lists, tables, code, links; images attached), unchanged pages skipped by content hash; epics and stories promote as before, now with a link to their design pages; the plan stays canonical (AD-5): nothing from Confluence changes an entity field.
- **CAP-6** (31.3)
  - **intent:** Publish is pinned and named in the contract.
  - **success:** The lib suite covers the conversion, the hashing, the idempotence and the provenance with a fake Confluence REST; the contract's §2 names `publish` (additive).
- **CAP-7** (31.4)
  - **intent:** A timer pulls each issue's status, comments, attachment links and the owner's Confluence pages into local memory so no agent queries Atlassian live for context.
  - **success:** The shipped job `atlassian-sync-back` (cron, every 10 minutes by default; `durable`) pulls each tracked issue's status (mapped onto the canonical enum per AD-6, the Jira original kept under `external.jira`), its comments (append-only into `_bmad-output/tracking/<key>/comments.jsonl`: `{issue, author: owner | agent, body, mentions[], created, source: jira}`), its attachments as links, and every owner-authored Confluence page into `kb/confluence/<slug>.md` with a provenance header (read-only sources: a local edit is overwritten and reported); nothing local is promoted back; the run's record names counts and the newest comment seen.
- **CAP-8** (31.4)
  - **intent:** The sync-back is pinned and its health is visible.
  - **success:** The lib suite covers the status mapping, the append-only comment log (a comment seen twice is written once), the attachment links, the page mirror and the overwrite report, with a fake REST; `tk-studio-activate`'s drift check gains a `tracking` plane that says when the last sync-back ran and whether the binding is reachable.
- **CAP-9** (31.5)
  - **intent:** Every issue that cannot progress sits in `Blocked - Awaiting User` with its reason, and so do its dependents.
  - **success:** Given a story the loop cannot progress (a dev session's `blocked` end, a `paused` run awaiting a ruling, an engagement question), the loop's report moves the issue and each dependent story (by the plan's links) to `Blocked - Awaiting User` with a comment that @mentions the owner and names the reason and what resolves it: a `tk-studio-track block` verb the supervisor's paused-run pass and the engine's escalation hook call.
- **CAP-10** (31.5)
  - **intent:** The inbox is derived from that status and shown where the owner looks.
  - **success:** The sync-back reads the mentions and derives `inbox_item {issue, priority, blocked_since, reason_comment, state: open | resolved | validating}` for every issue in that status, sorted by priority then time, into `_bmad-output/tracking/inbox.json`; the supervisor serves it at `GET /inbox` (a supervisor surface the web consumes, contract 0.1.26 additive); the office shows a persistent "!" bubble on the desk whose work is blocked, cleared when the status changes, never when a message arrives.
- **CAP-11** (31.6)
  - **intent:** The web's Inbox lists what needs the owner.
  - **success:** Given `GET /inbox` and the tracked issues, the Inbox screen lists open items sorted as served, each with the project, the issue key and title, the priority, how long it has waited and the reason's first line; the web's nav gains Inbox and Issue; the count sits on the nav item.
- **CAP-12** (31.6)
  - **intent:** The Issue view lets the owner reply or press Done from the desktop or the iPad without opening Jira.
  - **success:** The Issue screen shows the issue Jira-like (status, the run and PR when the plan links one, the cost from the ledger when known, the comments in order with author and time), a reply box, and a **Done** button for a simple request; sending a reply, or Done (which writes "Done." as the owner), posts the comment through the supervisor (`POST /inbox/{key}/reply`, the owner's token, never the agent's) and moves the issue to `Block Resolved`; the item leaves the list on the next sync-back; vitest covers the list, the view and the two actions with a fixture.
- **CAP-13** (31.7)
  - **intent:** An agent validates a resolved block before the story continues.
  - **success:** When the sync-back sees an issue in `Block Resolved`, the supervisor queues a `validate-resolution` job for the project (host tier, the planner leg's model): the session reads the reason and the reply and either tests the thing it had to be able to do (a command, a path, a sign-in) or judges whether the answer is enough; a pass moves the issue back to `To Do` or `In Progress` and the loop re-arms the story (the supervisor's paused run resumes with the ruling written into the spec, or the job's next tick re-runs it); a fail moves it to `Blocked - Awaiting User` with a follow-up comment that lands in the inbox again.
- **CAP-14** (31.7)
  - **intent:** The owner has one inbox for everything: blocked stories, the engagement's questions and approvals, and the loop's rulings.
  - **success:** The engagement's questions and approvals and the loop's `escalate` rulings are each an issue with comments in the same project; the supervisor's `awaiting-ruling` writes the block instead of a Telegram note alone; a reply that carries a ruling is written into the spec by the validation session; the lib suite and `bun test` cover the queueing, the two outcomes and the ruling write with fakes.

## Constraints

- Rulings in force, not reopened: D9/AD-22 (entity fields stay canonical-authoritative through the adapter, AD-4/AD-5 unchanged; comments, attachments as links and owner-authored Confluence pages are a second class, backend-authoritative and append-only, pulled back verbatim, never promoted from local), AD-6 (the canonical enum keeps `blocked`; `Blocked - Awaiting User` and `Block Resolved` map onto it with the original under `external.jira`), AD-7 (API tokens, never OAuth; the REST API with an API token unless 31.1 shows the Rovo MCP server is needed), AD-3 (tokens in the environment or the per-user store, never a config file or the worktree), AD-2 (`GET /inbox` and `POST /inbox/{key}/reply` are supervisor surfaces, never plugin surfaces; contract bumps minor and additive), AD-11 (every headless surface ends on the status block), D10 (tailnet default).
- Order and the halt: 31.1 lands first on a live free site and every later story is designed against its record; a "does not fit" on the statuses or the API halts the epic with the alternative named (an operator ruling, never a silent redesign); the workarounds it names reach 31.2 to 31.7 as story-level notes.
- Two seats, two tokens: the studio's posts come from the agent user; the owner's reply and Done are posted with the owner's token through the supervisor, never the agent's; a comment's author is `owner` or `agent`, nothing else. Secrets reach the engine sandbox only as `TK_ATLASSIAN_*` variables passed by name (`sbx exec -e NAME`; the supervisor fills them from the User environment registry); no value on a command line, in an event or in a file the worktree could carry; the scoped token works only through the `api.atlassian.com` gateway with the cloud id (runbook).
- Setup, publish and the adapter: what the free plan's API cannot do is printed as exact numbered instructions and the setup run ends `partial`, never `complete`; setup and publish are idempotent (recognised by key; skipped by content hash); every write to Atlassian goes through the planning adapter (AD-4: no skill calls the API directly); the saved filter is the Jira-side inbox (§6.9 item 2).
- Sync-back: a shipped `durable` cron job, every 10 minutes by default; agents read local memory (`_bmad-output/tracking/<key>/comments.jsonl`, `inbox.json`, `kb/confluence/<slug>.md`) and never query Atlassian live for context; the comment log is append-only (a comment seen twice is written once); a local edit to a mirrored page is overwritten and reported; the office's "!" bubble clears on a status change, never on a message.
- The web screens (Inbox, Issue) extend EP-30's app and nav and consume only supervisor surfaces named in contract §1 (`GET /inbox`, `POST /inbox/{key}/reply` at 0.1.26); the office's "!" bubble is the only office change.
- Repo and gates: tk-studio; driven by the supervisor's queue (the `run-epic-31` job, a worktree, the engine in the sandbox, `tools/verify_host.py` as the host leg) with the studio customization's verify gate (lib suite and conformance green) plus `bun test` in `apps/supervisor` and vitest in `apps/studio-web` where a story touches them; every test fake is a fake Atlassian REST, no live call in a test; the loop never pushes, tags or runs the release motion.

## Non-goals

- The Chat screen and the engagement loop's conversation (EP-32).
- The phone UI (EP-34).
- OAuth, or the Rovo MCP server as the transport (31.1 showing it needed is a ruling, not a story).
- Promoting comments, attachments or Confluence pages from local to Atlassian; mirroring comments into the canonical story files (D9's rejected alternative).
- A studio-built tracker or wiki.
- Office changes beyond the "!" bubble.
- Telegram inbound (D2); Linear; a public-exposure mode (D10).
- Changes to the designed migration (AD-16) beyond what setup records in the binding.

## Success signal

- On the box with the site and the two seats, `kb/atlassian-free-tier.md` answers Appendix C's two questions with "fits" or a named workaround; onboarding sets a project up (or hands the owner the exact steps and ends `partial`); publish lands the four design pages with provenance; every 10 minutes the sync-back mirrors statuses, comments, attachment links and the owner's pages into local memory; a story the loop cannot progress appears in the web's Inbox, in the "Needs you" filter and as a "!" bubble on its desk; a reply or Done from the iPad moves it to `Block Resolved`, and the `validate-resolution` job re-arms the story or returns it to the inbox with a follow-up; the lib suite, conformance, `bun test` and vitest are green.

## Assumptions

- The agent seat's variables are the ones the runbook and the supervisor README already name (`TK_ATLASSIAN_SITE`, `TK_ATLASSIAN_AGENT_EMAIL`, `TK_ATLASSIAN_AGENT_TOKEN`, `TK_ATLASSIAN_CLOUD_ID`); 31.1 names the owner's token variable as the story text says; the two seats' Atlassian account ids are recorded in the planning binding at setup so a pulled comment's author resolves to `owner` or `agent` by account id.
- The shipped job type is named `atlassian-sync-back` as the epic text has it (AD-22 says `atlassian-sync`); it ships under `plugins/tk-studio/jobs/` beside `run-epic` and is declared per project in `.tk-studio/config.yaml`'s `jobs` list; its 10-minute cron is the shipped default and the project instance may override it.
- `tk-studio-track` is a new studio skill (a lib core plus a skill folder, registered in the plugin manifest so conformance discovers it) with a `block` verb; 31.5 adds its §2 row. One contract bump, 0.1.26, carries the epic's additive changes (`publish` in §2 by 31.3; `GET /inbox`, `POST /inbox/{key}/reply` and the `tk-studio-track` row by 31.5 and 31.6; the `validate-resolution` job type by 31.7), extending the same entry as EP-30 did at 0.1.25.
- The supervisor serves `GET /inbox` from the served project's `_bmad-output/tracking/inbox.json` in its checkout (as `GET /board` reads the plan directory), and the "!" bubble rides an additive field of the office projection derived from that file; the supervisor posts the owner's reply on the host with the owner's token and never hands that token to a worker.
- Dependents "by the plan's links" are the canonical entities whose `depends_on[]` names the blocked story (AD-6); the inbox's priority is the Jira issue's priority as pulled, promoted from the canonical `priority` (`P0`–`P3`) when set.
- `bun` is not on the launch host's PATH; dev sessions run `bun test` and vitest in the engine sandbox provisioned with `WITH_BUN=1` (runbook §3.8) and record the gate `unverifiable-here` with the attended command when the sandbox lacks it (EP-29/EP-30 precedent).
- The `validate-resolution` job is a shipped job type run by the supervisor's queue on the host tier with the planner leg's model, queued once per `Block Resolved` transition the sync-back observes (not once per tick); "the ruling written into the spec" is the paused story's SPEC.md, the same write `bmad-loop-resolve` makes.

## Open Questions

- Adapter auth: the Jira adapter as built reads `JIRA_API_TOKEN`, `JIRA_EMAIL` and `planning.jira.site` and calls `<site>/rest/api/2`; the runbook says the scoped `TK_ATLASSIAN_AGENT_TOKEN` works only through `https://api.atlassian.com/ex/{jira|confluence}/<cloud id>/`. Does 31.2 move the binding onto `TK_ATLASSIAN_*` and the gateway (dropping or aliasing `JIRA_*`), or keep both paths? 31.1 names the variables; the adapter's transport is the planner's call unless the operator rules.
- The owner's token: the supervisor forwards every `TK_ATLASSIAN_*` into the engine sandbox by name. Should the owner's token stay host-only (a name outside the prefix, or an exclusion in the pass-through), since only the supervisor's `POST /inbox/{key}/reply` uses it, or may it reach the sandbox?
- Is tracking set up live for tk-studio itself during this epic (31.2 run attended against the site, the keys recorded in this repository's `.tk-studio/config.yaml`), or does the epic end with the fake-REST proof and the live setup as an operator step afterwards? 31.1 and the sync-back's drift plane need a live site either way.
- Do the mirrored `kb/confluence/<slug>.md` pages register in `kb/index.md` (the llms-style index, AD-3) and pass through the knowledge promotion gate (Epic 9), or sit beside the kb as a separate read-only binding (AD-22: "a Confluence knowledge binding beside the kb")?
- Which issues are the sync-back's "tracked issues": every promoted entity of the project, or only stories with a live or paused run? The cost of a 10-minute pull over a whole project against the free plan's rate limit is 31.1's to measure.

## Design notes (settled shape, planner, 2026-10-24)

- CAP-1/CAP-2 — owner token variable: named placeholder rule: a name outside the `TK_ATLASSIAN_` prefix, host-only, read by the supervisor; the record names it — per `apps/supervisor/README.md` §Secrets into the sandbox, `kb/agent-pc-setup-runbook.md` §3.8 "Engine secrets"
- CAP-2 — story-level notes: deferred entry: one replan-queue entry per affected unstarted story, `Status: open`, the workaround as its Suggested adjustment; the gate folds it into `invoke_dev_with` — per `.bmad-loop/plugins/studio-pipeline/task-planning.md` §2
- CAP-3 — the tracking binding in `.tk-studio/config.yaml`: optional entry: `planning.jira.{site, project_key, project_id, filter_id, owner_account_id, agent_account_id}` and `planning.confluence.{space_key, space_id, folders: {brief, gdd, scope-of-work, decisions, records}}`; ids and keys only, never a credential; written by 31.2's setup and read by 31.3 to 31.7. AD-22's `knowledge.confluence` binding (the owner-page mirror) is left to 31.4 (Open Question 4) — per `_bmad-output/planning-artifacts/epics.md` Story 31.2 AC1, `ARCHITECTURE-SPINE.md` AD-22
- CAP-3 — the owner seat's accountId: named placeholder rule: `planning.jira.owner_account_id`, taken from the recorded value, else `--owner-account-id`, else `--owner-email` looked up under `read:jira-user`, else a numbered owner step and the run is `partial`; an absent or empty value never matches in 31.5 and 31.7 — per `kb/atlassian-free-tier.md` §1 step 6
