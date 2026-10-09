# Appendix D. User flows

Part of the [studio design spec](README.md). Each flow names who acts, which surface they touch, what each component does, and where it stands today. Surfaces: **phone chat** (Telegram today), **studio web** (the office, the board, the chat panel), **terminal** (a Claude Code session or `tk-studio` CLI), **GitHub** (PRs). Components are the ones in [README §6](README.md#6-the-components).

Flows marked **today** work on TIM-PC-2 now. Flows marked **target** are what the design adds. Where a flow depends on an open decision, the decision is linked.

---

## F1. A newcomer installs the studio (target)

Who: a developer on a fresh Windows 11 or macOS machine with Claude Code signed in on their own subscription.

1. They run one line from the README: the bootstrap script (`install.ps1` or `install.sh`), with its published checksum and a download-verify-run alternative.
2. The bootstrap installs a pinned `uv`, then the `tk-studio` meta-CLI from a hash-pinned wheel, and puts one launcher directory on the PATH. It never clones a repository.
3. `tk-studio install` reads the committed roster (`stable` channel), then:
   - writes the **skills-dir plugin** to `~/.claude/skills/tk-studio/` (plugin manifest, 18 skills, 2 agents) and uninstalls any marketplace copy of `tk-studio` it finds (the shadowing rule; ADR O5);
   - downloads the **supervisor** release zip by tag, verifies its SHA-256, unpacks it into a versioned slot, runs `bun install --frozen-lockfile` with the roster's pinned Bun;
   - downloads the **studio web** export zip into its slot; the supervisor serves whatever slot `current.json` names;
   - writes the User environment (bind address, token, session secret, paths) through the existing `set-supervisor-env.ps1` logic, creates the Startup shortcut, and prints the smoke command.
4. `tk-studio doctor` checks: Claude Code version against the roster floor, the skills-dir plugin version against the roster, folder trust for every registered project root (hole 14 and 15), long paths, the sbx daemon, the certificate age, the PATH.
5. They open `claude` in a project and run `tk onboard`. The drift check (`tk activate`) is clean on four planes, its plugin plane now reading the skills-dir folder and the roster instead of `installed_plugins.json`.

What exists today: steps 3b to 3d exist as hand steps in runbook §3 and §4 and in `set-supervisor-env.ps1`; the release zip and SHA-256 record exist for the plugin only (`tools/release_archive.py`). What is new: the bootstrap, the meta-CLI, the roster, the skills-dir write, the uninstall rule, `doctor`. Decisions: [D1 repository](decisions.md#d1-repository) changes where the three apps' releases are cut, not this flow.

## F2. Tim hires the studio for a piece of work (target; the engagement loop)

Who: Tim as product owner, from the phone or the studio web chat panel.

1. **Intake.** Tim writes a request in plain language ("a roguelike deckbuilder prototype in Godot", or "add a mission board to the studio web"). The chat creates an **engagement** in state `intake` on the supervisor, bound to a project (existing, or a new one the studio will onboard).
2. **Clarifying questions** (`awaiting-answers`). The studio's planner leg reads the project (registry, kb, plan, GDD if a game) and returns at most three high-impact multiple-choice questions with defaults. In the office, the orchestrator desk shows a persistent "needs you" bubble that never expires on its own. If Tim does not answer, the questions become stated assumptions in the scope of work and the engagement waits; nothing runs.
3. **Scope of work** (`scoping`). The planner produces an editable document: goal, deliverables with acceptance signals, exclusions, what the studio needs from Tim (dated dependencies), milestones, and the proposed epics and stories in canonical shape. Tim edits it in place; a revision replaces the plan wholesale.
4. **Quote** (`quoted`). The supervisor computes a 50/85/95 band from the meter's own per-story history for this project and story kind (dollars at list price, wall-clock hours, weekly plan-window share), prices the tail with a hard cap, and states what happens at the cap (stop and report, never silently continue). The quote names the route (which model on which leg) and the autonomy level on offer.
5. **Approval** (`approved`). One dedicated verb, `approve`, with the autonomy level chosen at that moment. No chat message advances the state; leaving planning is an explicit exit, never a timer. Approval creates the epics and stories through the planning adapter and queues the first `run-epic` job.
6. **Execution** (`in-progress`). F5 runs per story. The board shows epic and story progress; the office shows who works on what; the quote band is drawn against actual spend as stories land.
7. **Acceptance** (`delivered`). The PR is the deliverable object; acceptance tests fixed at scope time are the checklist; a per-story cost table is attached. Tim accepts from the phone or the board.
8. **Change request.** Mid-run input is a verb on the live engagement (`question`, `revise`, `go`). After delivery, a change is a new engagement with its own quote.
9. **Blocked or partial** (`paused`, `failed`, `partial`). The state is visible, the question answerable from the phone, and the closeout report says done, not done, and why. This partial-delivery report is the studio's own; no product researched has one.

What exists today: steps 5 to 6 exist as `POST /jobs` plus the loop (F5), without the engagement envelope; `tk-studio-launch` already plans the first story before the readiness check. What is new: the engagement entity and its state machine, the questions and scope steps, the quote band, the approval verb, the closeout report. Evidence: [run 1 §9 B5](../../research/studio-front-end-and-repo-structure-2026-10-09/research.md#9-b5-the-contract-studio-engagement-loop). Decisions: [D2 Hermes](decisions.md#d2-hermes) decides what answers the chat; [D4 quote basis](decisions.md#d4-quote-basis) decides what the quote is denominated in.

## F3. Tim watches the office (target)

Who: Tim on the phone or a desktop browser, signed in with the token cookie (today) or Remote Control (later).

1. The studio web loads from the supervisor on one origin (`https://tim-pc-2.tail8e370a.ts.net:8787/`). One SSE stream per tab carries a snapshot then deltas, with `Last-Event-ID` replay and a heartbeat; the client recreates the stream on `visibilitychange` and re-authenticates on failure.
2. The **office floor** (one PixiJS canvas) shows a desk per registered agent: the orchestrator per project, the session, the implementer, the reviewers, the consult or advisor. Each sprite's state comes from the semantic vocabulary (`offline`, `idle`, `thinking`, `reading`, `typing`, `running`, `waiting-for-human`, `blocked`, with `done` and `failed` overlays), promoted instantly and demoted through a grace timer. A persistent "!" bubble means a human is needed and never auto-expires.
3. The **board** (DOM) shows epics as projects with phased progress bars, stories as phases, review findings as bugs draining out, the engagement's quote band against spend, and a Needs-you / Working / Done triage column. Clicking a desk opens that agent's recent events and, for the orchestrator, the chat panel.
4. The **chat panel** (DOM) is the engagement conversation of F2 for the selected project; the same conversation continues from Telegram by session id.
5. Tapping a run opens its status block, transcript pointer, cost and PR. Cancel needs the CSRF token; a cookie never submits a job.

What exists today: the read-only status page (22.2) over the same data, server-rendered, no office. What is new: the event projection (EP-27), the registry of agents and personas, the web app (EP-28). Decisions: [D5 renderer spike](decisions.md#d5-renderer), [D6 assets](decisions.md#d6-assets), [D7 sign-in](decisions.md#d7-sign-in).

## F4. Tim answers a question or approves from the phone (target)

Who: Tim away from the box.

1. A run or an engagement enters `waiting-for-human` (a consult ruled `escalate`, a reconcile gate, an engagement question or approval).
2. The supervisor notifies through the configured notifier (Telegram via the Hermes bot today, or ntfy) with the run id, the question, and a link.
3. Tim answers in the chat (phone or web). The answer is a typed input on the engagement (`answer`, `approve`, `revise`), never free text that a model interprets as consent (the Cursor and Jules failure modes). For a paused loop story, the answer is written into the spec and the run is re-armed (`resume-run.sh` today; the supervisor's own verb in EP-26).
4. The office clears the "!" bubble when the state changes, not when a message arrives.

What exists today: the notification and the `blocked` block; the answer is a terminal step (`bmad-loop-resolve`). What is new: the typed inputs and the re-arm verb. Decision: [D2](decisions.md#d2-hermes) decides whether Telegram traffic passes through Hermes or through Claude Code channels.

## F5. A story lands (today, with the additions marked)

Who: nobody; the supervisor and the engine.

1. A `run-epic` job is queued (`POST /jobs` or the pacer). The queue validates it against `job.schema.json`, resolves tier, model and effort, refuses host bypass, and takes the checkout lock.
2. **Target (EP-26):** the supervisor creates a `git worktree` for the run from `base_ref` (worktree per run replaces branch per run; hole 16), refuses a dirty tree, refuses an unprotected default branch as base.
3. The worker runs `claude -p "/tk-studio:tk-studio-launch"` on the sbx tier inside the project's Docker Sandbox, which mounts the host skills folder read-only (ADR O5 rule 2). Launch plans the first story on the planner leg, routes it, and starts bmad-loop detached with a pre-minted run id.
4. bmad-loop drives the story: session (monitor), implementer, two reviewers, consult on objective triggers (or the advisor, Epic 24.3), the studio gate with a deviation score, the meter hook pricing the story and copying transcripts out of the microVM.
5. **Target (EP-26):** the supervisor owns the engine's lifetime (no host `sbx exec` to die with; hole 7), follows it through `launch status`, and on completion pushes the worktree branch and opens a PR whose body carries the status block, run id, commits and cost (Story 23.2). A landed-but-paused story gets a close-out (hole 9). A Windows host-tier verify leg runs before the PR exists (holes 11 and 12).
6. The run ends with a status block; `finish` records `total_cost_usd`; one `job-run` event and one `observation` per story land in the ledger; the notifier fires; the transcript is copied to the backup.
7. **Target (hole 18):** the `ended` event with a PR URL triggers a plan-sync status pull-back on the owning project.
8. Tim merges the PR on GitHub (PR-only, protected `main`).

Evidence: runbook §3.8, supervisor README, [Epic 23](../../epics.md#epic-23-the-supervisor-lands-a-story-on-the-universe-awaits).

## F6. Recurring and maintenance jobs (today)

`studio-health` (drift check), `maintenance-conformance`, `research-ecosystem` and `evolve-proposals` run through the pacer on their `hint_seconds`, host tier, under `auto` mode with the repo's allow rule in a trusted folder. Each ends with a status block and a ledger event. Unchanged by the design, except that `doctor` and the office show them.

## F7. Tim updates the studio (target)

1. `tk-studio update` reads the roster's channel, compares each component's installed version, and for each: downloads by tag, verifies, renames the old slot aside, verifies the new one starts, deletes the old on the next successful start.
2. For the supervisor it stops the service tab first (a running executable can only be renamed on Windows) and the Startup shortcut points at the slot pointer, not a path.
3. For the plugin it rewrites the skills-dir folder in place; Claude Code loads it in place with no cache copy.
4. On the dev box (TIM-PC-2), `doctor` recognises "source checkout" mode: the supervisor runs from `C:\GitHub\...`, so `update` only reports and the operator pulls.

## F8. The restructure rehearsal (target, only if D1 signs O2)

The nine steps of [ADR §5](../../briefs/adr-repository-structure-2026-10-09.md#5-migration-plan-the-supervisor-into-appssupervisor), on throwaway clones first: `git filter-repo --to-subdirectory-filter apps/supervisor`, merge with unrelated histories, nested project root proven (`tk activate`, hooks with `CLAUDE_PROJECT_DIR`, folder trust, bmad-loop run workspace), one sandbox serving both loops with worktrees, service cut-over, PR, archive. Rollback before the archive step is "close the PR".

## F9. A game project gets a vertical slice (target, EP-31, the Phase 3 pack)

The F2 engagement with a game project: the scope step runs the GDS quick-flow brief and GDD; approval creates the epics; F5 runs with the `playable-verify` leg (headless run, player-camera screenshots, screenshot-only vision rubric, deterministic multi-seed scenarios, visual-regression baselines) and the asset-manifest ladder (greybox, then pre-mirrored CC0, then paid generation behind a credit cap, each gated by geometry facts and a visual gate); proof media land in the run workspace and the PR. TUA is the reference project.
