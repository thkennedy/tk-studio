# Appendix D. User flows

Part of the [studio design spec](README.md). Each flow names who acts, which surface they touch, what each component does, and where it stands today. Surfaces: **studio web** (office, board, inbox, issue view, chat, status), **Jira and Confluence** (the owner may act there directly), **terminal** (a Claude Code session or the `tk-studio` CLI), **GitHub** (PRs). Components are the ones in [README §6](README.md#6-the-components).

Flows marked **today** work on TIM-PC-2 now. Flows marked **target** are what the design adds. Revised 2026-10-14 for the rulings (no Hermes, no Next.js, Atlassian tracking, the inbox, one account).

---

## F1. A newcomer installs the studio (target)

Who: a developer on a fresh Windows 11 or macOS machine with Claude Code signed in on their own subscription.

1. They run one line from the README: the bootstrap script (`install.ps1` or `install.sh`), with its published checksum and a download-verify-run alternative.
2. The bootstrap installs a pinned `uv`, then the `tk-studio` meta-CLI from a hash-pinned wheel, and puts one launcher directory on the PATH. It never clones a repository.
3. `tk-studio install` reads the committed roster (`stable` channel), then:
   - writes the **skills-dir plugin** to `~/.claude/skills/tk-studio/` and uninstalls any marketplace copy of `tk-studio` it finds;
   - downloads the **supervisor** release zip by tag, verifies its SHA-256, unpacks it into a versioned slot, runs `bun install --frozen-lockfile` with the roster's pinned Bun;
   - downloads the **studio web** bundle into its slot; the supervisor serves whatever slot `current.json` names;
   - writes the User environment (bind address, token, session secret, paths), creates the Startup shortcut, and prints the smoke command.
4. `tk-studio doctor` checks: Claude Code version against the roster floor, the plugin folder against the roster, folder trust for every registered project root, long paths, the sbx daemon, the certificate age, the PATH, and warns if a Hermes gateway on the box has `adopt_external_logins` on.
5. They open the studio web for the first time and **create the owner's account** (username and password). The intended-usage statement is on that page.
6. They open `claude` in a project and run `tk onboard`, which now also offers the Atlassian setup (F10).

What exists today: steps 3b to 3d as hand steps in runbook §3 and §4 and in `set-supervisor-env.ps1`; the release zip and SHA-256 record for the plugin only. New: the bootstrap, the meta-CLI, the roster, the skills-dir write, `doctor`, the account page.

## F10. A project is set up on Atlassian (target)

Who: the owner, from `tk onboard` or the web's project screen; a new project from a GitHub repository or local files, or an existing one.

1. The studio asks for the Atlassian site, the owner's account and the agent user's API token (stored in the per-user store, never in a tracked file, AD-3). The preflight checks both tokens and the site's API-token setting (AD-7).
2. It creates a **Confluence space** and a **linked Jira project** from the studio's template: the space's folder structure (brief, design, decisions, references, scope of work per engagement), the Jira issue types (Epic, Story, Sub-task), and the two statuses the inbox needs (`Blocked - Awaiting User`, `Block Resolved`). What the API cannot do is handed to the owner as exact steps, or a template they apply once per site.
3. The project's config records the bindings (`planning.backend: jira`, the new `knowledge.confluence` binding); the registry entry gains the space and project keys.
4. The first **publish** promotes the canonical plan (epics and stories) and the kb's index pages. The first **sync-back** runs, and the recurring sync job is declared on the project with a configurable interval.
5. From then on the owner may read and comment anywhere in Jira or Confluence from any device; the sync-back brings it into local memory so agents read locally and never query live for context.

What exists today: the Jira adapter (promote plus status pull-back), the planning adapter, the kb. New: project and space creation from a template, the Confluence binding, comments and attachments in the pull-back, the two statuses, the sync job.

## F2. Tim hires the studio for a piece of work (target; the engagement loop)

Who: Tim as product owner, from the studio web's chat panel (desktop or iPad).

1. **Intake.** Tim writes a request in plain language. The chat creates an **engagement** in state `intake` on the supervisor, bound to a project (existing, or one set up through F10). The planner leg answers the chat: a `claude -p` session with the plugin, holding the project's plan, kb and synced Confluence pages.
2. **Clarifying questions** (`awaiting-answers`). At most three high-impact multiple-choice questions with defaults. They are posted as a Jira issue with an @mention and appear in the inbox (F4); the office shows a "needs you" bubble. Unanswered questions become stated assumptions; nothing runs.
3. **Scope of work** (`scoping`). An editable Confluence page under the engagement's folder: goal, deliverables with acceptance signals, exclusions, what the studio needs from Tim (dated dependencies), milestones, and the proposed epics and stories. Tim edits it there or in the web; a revision replaces the plan wholesale; references and images go on the page.
4. **Quote** (`quoted`). A 50/85/95 band from the meter's history for this project and story kind, shown as plan-window share with a list-price dollar shadow (D4), the tail priced with a hard cap and what happens at the cap. The quote names the route and the autonomy level on offer.
5. **Approval** (`approved`). One dedicated verb, `approve`, with the autonomy level chosen at that moment. No chat message advances the state; leaving planning is an explicit exit, never a timer. Approval creates the epics and stories through the planning adapter, publishes them to Jira, and queues the first `run-epic` job.
6. **Execution** (`in-progress`). F5 runs per story. The board and Jira show progress; the office shows who works on what; the quote band is drawn against actual spend.
7. **Acceptance** (`delivered`). The PR is the deliverable object; the acceptance signals fixed at scope time are the checklist; a per-story cost table is attached to the engagement's page.
8. **Change request.** Mid-run input is a typed verb on the live engagement (`question`, `revise`, `go`). After delivery, a change is a new engagement with its own quote.
9. **Blocked or partial** (`paused`, `failed`, `partial`). Visible in the inbox, answerable from any device, and the closeout report says done, not done, and why.

What exists today: steps 5 to 6 as `POST /jobs` plus the loop, without the engagement envelope. Evidence: [run 1 §9 B5](../../research/studio-front-end-and-repo-structure-2026-10-09/research.md#9-b5-the-contract-studio-engagement-loop).

## F4. Blocked work reaches the owner through the inbox (target)

Who: the owner, from the web's inbox or from Jira on any device. Tim's model, adopted as written.

1. A story cannot progress (a consult ruled `escalate`, a reconcile gate, a missing fact, "install X", "run Y as admin"). The supervisor moves the issue and its dependents to `Blocked - Awaiting User` and posts a comment with the reason, @mentioning the owner. The notifier pushes a one-line message with the link.
2. The sync-back picks the mention up. The **inbox** lists every issue needing attention, sorted by priority then time; the same list is a saved Jira filter.
3. The owner opens the issue (a Jira-like view in the web, or Jira itself) and replies in text, or presses **Done** for a simple request, which writes the reply for them.
4. The reply moves the issue to `Block Resolved` and clears the inbox item.
5. An agent **validates the resolution**: if something had to be done, it tests that it can now do the thing; if feedback was needed, it checks the answer is enough to continue. It moves the issue back to `To Do` or `In Progress` (and re-arms the paused run), or back to `Blocked - Awaiting User` with a follow-up comment, which lands in the inbox again.
6. The office clears the "!" bubble when the status changes, not when a message arrives.

What exists today: the notification and the `blocked` block; the answer is a terminal step (`bmad-loop-resolve`). New: the two statuses, the mention comment, the inbox, the Done shortcut, the validation leg, the re-arm verb on the supervisor.

## F3. Tim watches the office (target)

Who: Tim on a desktop or iPad browser, signed in with the owner's account.

1. The studio web loads from the supervisor on one origin. One SSE stream per tab carries a snapshot then deltas, with `Last-Event-ID` replay and a heartbeat; the client recreates the stream on `visibilitychange` (iPad Safari backgrounds streams) and re-authenticates on failure.
2. The **office floor** (one PixiJS canvas) shows a desk per registered agent. Each sprite's state comes from the semantic vocabulary, promoted instantly and demoted through a grace timer. A persistent "!" bubble means the owner is needed and never auto-expires.
3. The **board** (DOM) shows epics as projects with phased progress bars, stories as phases, review findings as bugs draining out, the engagement's quote band against spend, and a Needs-you / Working / Done triage column. Clicking a desk opens that agent's recent events and, for the orchestrator, the chat panel.
4. The **inbox** and **issue view** are F4's screens. The **chat panel** is F2's conversation for the selected project.
5. Tapping a run opens its status block, transcript pointer, cost and PR. Cancel needs the CSRF token; a cookie never submits a job.

What exists today: the read-only status page over the same data. New: the event projection, the registry, the web app.

## F5. A story lands (today, with the additions marked)

1. A `run-epic` job is queued (`POST /jobs`, the pacer, or an approval in F2). The queue validates it, resolves tier, model and effort, refuses host bypass, and takes the checkout lock.
2. **Target (EP-26):** the supervisor creates a `git worktree` for the run from `base_ref`, refuses a dirty tree, refuses an unprotected default branch as base.
3. The worker runs `claude -p "/tk-studio:tk-studio-launch"` on the sbx tier inside the project's Docker Sandbox, which mounts the host skills folder read-only. Launch plans the first story on the planner leg, routes it, and starts bmad-loop detached with a pre-minted run id.
4. bmad-loop drives the story: session, implementer, two reviewers, consult on objective triggers (or the advisor), the studio gate with a deviation score, the meter hook pricing the story and copying transcripts out of the microVM.
5. **Target (EP-26):** the supervisor owns the engine's lifetime, follows it through `launch status`, and on completion pushes the worktree branch and opens a PR whose body carries the status block, run id, commits and cost (Story 23.2). A landed-but-paused story gets a close-out (hole 9). A Windows host-tier verify leg runs before the PR exists (holes 11 and 12).
6. The run ends with a status block; `finish` records `total_cost_usd`; one `job-run` event and one `observation` per story land in the ledger; the notifier fires; the transcript is copied to the backup.
7. **Target (EP-26, hole 18):** the `ended` event with a PR URL triggers a status pull-back on the owning project and, **target (EP-30)**, a publish to Jira (status, PR link, cost in a comment by the agent user).
8. Tim merges the PR on GitHub (PR-only, protected `main`).

## F6. Recurring and maintenance jobs (today, plus the sync job)

`studio-health`, `maintenance-conformance`, `research-ecosystem` and `evolve-proposals` run through the pacer on the host tier under `auto` mode in a trusted folder. **Target (EP-30):** `atlassian-sync` joins them per project on its configurable interval. Each ends with a status block and a ledger event; `doctor` and the office show them.

## F7. Tim updates the studio (target)

1. `tk-studio update` reads the roster's channel, compares each component's installed version, and for each: downloads by tag, verifies, renames the old slot aside, verifies the new one starts, deletes the old on the next successful start.
2. For the supervisor it stops the service tab first; the Startup shortcut points at the slot pointer, not a path.
3. For the plugin it rewrites the skills-dir folder in place.
4. On the dev box, `doctor` recognises "source checkout" mode and `update` only reports.

## F8. The restructure rehearsal (target, EP-32, D1 ruled O2)

The nine steps of [ADR §5](../../briefs/adr-repository-structure-2026-10-09.md#5-migration-plan-the-supervisor-into-appssupervisor), on throwaway clones first. Rollback before the archive step is "close the PR".

## F9. A game project gets a vertical slice (target, EP-33)

The F2 engagement with a game project: the scope step runs the GDS quick-flow brief and GDD (published to Confluence); approval creates the epics; F5 runs with the `playable-verify` leg and the asset-manifest ladder; proof media land in the run workspace, the PR and the engagement's page. TUA is the reference project. Candidate tools are listed in the [3D tooling note](../../../../kb/agentic-3d-asset-tooling-2026-10.md).

## F11. Tim checks in from the phone (target, EP-34, later)

A separate phone-width UI: the inbox (reply, Done), approve or revise an engagement, the status view. No office floor. Until it exists, Jira's own mobile app and the notifier's links cover the phone.
