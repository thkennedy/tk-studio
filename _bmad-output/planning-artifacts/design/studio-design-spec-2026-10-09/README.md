# tk-studio design spec: the contract studio you hire from your phone

| | |
|---|---|
| Status | **Draft for Tim's review, 2026-10-09.** Nothing here is in force until the decisions in [Appendix C](decisions.md) are ruled. |
| Written because | Tim refused to sign the repository ADR until the design folded in every feature already planned and settled what Hermes is for. This document does that: it is the one place that names what the studio is, what exists, what is owed, how it fits together, and what is left to decide. |
| Settled inputs (not reopened) | the 2026-09-26 rulings (engines only in Docker Sandboxes, Max pays, independent supervisor, Hermes never executes), the 2026-10-09 rulings (office first, no third repo, one installer, Next.js first, the engagement vision), and **O5: the plugin keeps its form and drops the marketplace** (Tim, 2026-10-09) |
| Evidence | two deep-recon runs ([run 1: front end and repo](../../research/studio-front-end-and-repo-structure-2026-10-09/research.md), [run 2: native overlap and greenfield](../../research/studio-native-overlap-and-greenfield-2026-10-09/research.md)), the [repository ADR](../../briefs/adr-repository-structure-2026-10-09.md), the [greenfield brief](../../briefs/greenfield-studio-2026-10-09.md), the [2026-09-26 plan](../../briefs/planning-pass-agent-pc-and-supervisor-2026-09-26.md), the [architecture spine](../../architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md), and the ledgers audited in [Appendix A](feature-ledger.md) |
| Appendices | [A. Feature ledger](feature-ledger.md) (every planned feature and where it lands) · [B. Hermes fit](hermes-fit.md) · [C. Decisions that need Tim](decisions.md) · [D. User flows](user-flows.md) |

---

## 0. How to read this in five minutes

1. **§1** says what the studio is, in one page.
2. **§2** says what is built and what is owed. The detail is [Appendix A](feature-ledger.md).
3. **§3** is the picture: devices, front door, supervisor, engines, repositories, and where Hermes sits.
4. **§6** is the component design. **§7** is the data model, including the agent registry that answers the "registered so Hermes can see them" point.
5. **§9** lists the decisions only Tim can make, one line each; [Appendix C](decisions.md) has the options and the recommendation for each.
6. **§10** is the build order as proposed epics.

Everything else is supporting detail with links out.

---

## 1. What the studio is

**One sentence.** tk-studio is a software studio you hire from your phone: you describe what you want, it asks the questions a good contractor asks, comes back with a scope of work and a quote, and once you approve it builds the work story by story in isolated sandboxes, lands each story as a pull request, and shows you the whole thing as an animated office where you can see who is working on what.

**Who it is for.** Tim first, as a product owner who wants to go from napkin idea to prototype to finished product without sitting at the keyboard. Then anyone who installs it on their own machine with their own Claude subscription.

**What it is made of (three apps, one installer).**

| App | What it is | Where it runs |
|---|---|---|
| **The plugin** (`tk-studio`) | 18 Claude Code skills, 2 role agents and the driver contract: how to plan, install, drift-check, launch, meter and evolve. Stdlib Python, headless-safe, every surface ends in a status block. | inside every Claude Code session, on the host and in every sandbox, loaded from `~/.claude/skills/tk-studio/` (O5) |
| **The supervisor** | a small Bun service: durable job queue, one lock per checkout, guards, pacer, two worker tiers, crash recovery, HTTP API, SSE event stream, notifications. This design adds the engagement state machine, the agent registry, the semantic event projection, worktrees and PR hygiene. | console-hosted at logon on the agent PC, on the tailnet over HTTPS |
| **The studio web** | a Next.js static export the supervisor serves: the office floor, the mission board, the chat panel, the status view. | your browser, phone or desktop, same origin as the API |
| **The installer** (`tk-studio` meta-CLI) | a bootstrap script plus a self-updating CLI that reads a committed roster of compatible versions and installs or updates all three apps. Never clones a repository. | the user's machine |

**What it is built on, not instead of.** Claude Code under the Max login (the only thing that runs on the subscription), Docker Sandboxes for bypass isolation on Windows, the BMad method at a pinned version for planning artifacts, bmad-loop as the story engine, GitHub for PR-only delivery, Tailscale for reach. The studio's own code is the part nobody ships: the queue contract and pacer, the story-aware gate and routing, the meter and evolve loop, the drift check against a pinned base, the conformance suite, and now the engagement loop and the office.

---

## 2. Where things stand

Short form; [Appendix A](feature-ledger.md) has every row with evidence.

**Built and proven on TIM-PC-2.**
- The plugin at 0.2.16: 18 surfaces, 792 lib tests, 116 conformance checks, drift check clean on three projects.
- The supervisor: Epics 20 to 22 complete (599 tests), live since 2026-10-07, survived the 10-08 reboot, kill-and-restart proven live 2026-10-09, phone sign-in over HTTPS working, Telegram notifications through the Hermes bot.
- The engines: three Docker Sandboxes provisioned; TUA's engine green (1030 xunit tests, 137 engine tests); tk-studio's own Epics 20 and 24, and the supervisor's Epics 21 and 22, were built by the loop in sandboxes and metered per story.
- The meter (Story 24.1) and the Opus 5.5 trial data for twelve stories.

**Planned and still owed (the ones this design must carry).**
- **Epic 23**: branch per run and a PR at the end (23.2), acceptance from the phone (23.3). Not built; the supervisor stores `base_ref` and cuts no branch.
- **Epic 24.3 and 24.4**: the paired runs and the routing verdict, plus the advisor arm from the fit note.
- **Phase 2, Hermes**: installed, on Telegram, learning gated, used as the notifier; but no studio skill, no status cron, no dashboard, and a default setting that lets Hermes borrow and invalidate the Claude login ([Appendix B.4](hermes-fit.md#b4-what-it-costs)). About one third done.
- **Phase 3, the vertical-slice pack**: `playable-verify` leg, engine MCP wiring, asset ladder, `run-vertical-slice` job. Nothing started.
- **The 2026-09-01 office decisions**: the front end owns presentation and persona bindings; Hermes profiles own live agent state. Never built.
- **Open deferred work**: fourteen supervisor DW entries, two in tk-studio; loop holes 3, 4, 6, 8 to 12, 15, 16, and two found by this audit (17: research without a plan inventory; 18: the plan is not updated when the loop lands a story elsewhere).

**What this design changes about the standing plan.** Three things, each argued in [Appendix C](decisions.md):
1. Phase 2 becomes "a chat the supervisor owns, with Hermes as the first inbound adapter" rather than "Hermes shapes the job" (D2).
2. The read-only status page is superseded by the studio web; the page stays as the no-JavaScript fallback.
3. The order of work is packaging, then service and events, then the office and the engagement loop, then the restructure (D3).

---

## 3. The shape

```
 Tim: phone / iPad / main PC ──Tailscale──▶ TIM-PC-2 (Windows 11, always on, Max login)
                                              │
   Telegram ─▶ inbound adapter (Hermes today) ─┤  relays messages; decides nothing
   browser  ─▶ studio web (office · board · chat · status) ── same origin ──┐
                                              │                            │
                                              ▼                            ▼
                         ┌──────────── the supervisor (Bun, console-hosted at logon) ────────────┐
                         │ engagements ─▶ epics/stories (via the planning adapter)               │
                         │ durable queue · lock per checkout · worktree per run · pacer · guards │
                         │ agent registry · semantic event projection ─▶ SSE /events            │
                         │ chat route ─▶ a claude -p planner session (the studio plugin)          │
                         └──────────────────────────────┬───────────────────────────────────────┘
                                                        │ contract §1: claude -p "/tk-studio:<skill>"
                              ┌─────────────────────────┴──────────────────────────┐
                              ▼                                                    ▼
                 host tier: auto mode, deny list,                 sbx tier: Docker Sandboxes microVM,
                 Godot via $env:GODOT, trusted folders            bypass allowed, bmad-loop + studio pipeline,
                                                                  host ~/.claude/skills mounted read-only
                              │                                                    │
                              └──────────────── ~/.tk-studio (store, registry, runs, ledger) ───────┘
                                               GitHub (PR-only, protected main) · status blocks · proof media
```

Three rules hold the picture together and are not open:
- **The supervisor is the only thing that starts work and the only thing that changes an engagement's state.** Chat adapters relay; the office renders; the plugin publishes the contract.
- **Bypass lives only inside a microVM.** The host tier runs `auto` with the deny list in trusted folders.
- **Every headless run ends with a status block; nothing is done until conformance passes.** (AD-11, AD-19.)

---

## 4. How the apps reach a user (settled by O5, shaped by D1)

- **The installer is the only newcomer path.** Bootstrap, then the meta-CLI, then a roster. Flow [F1](user-flows.md#f1-a-newcomer-installs-the-studio-target).
- **The plugin is written, not installed.** `~/.claude/skills/tk-studio/` with its manifest, skills and agents; Claude Code loads it in place as `tk-studio@skills-dir`; `${CLAUDE_PLUGIN_ROOT}` substitutes (Tim's probe). The installer uninstalls marketplace copies (they shadow the folder), the repository drops its committed `extraKnownMarketplaces` and `enabledPlugins`, sandboxes read the host folder through Docker's read-only skills mount, and the drift check's plugin plane reads the folder plus the roster. The in-repo marketplace stays only for developers who clone, pinned to a tag.
- **The supervisor and the web ship as release zips** with SHA-256s, into versioned slots; the roster pins the compatible set per channel (`stable`, `latest`); `make_latest: false` on every release; everything resolves by tag.
- **Where the apps live in git** is [D1](decisions.md#d1-repository). Under O2 they share `tk-studio` (`plugins/tk-studio`, `apps/supervisor`, `apps/studio-web`, `tools/installer`); under O1 the supervisor and the web stay in `tk-studio-supervisor`. The installer and the roster work either way; only the release script's source paths differ.

---

## 5. The user's day

[Appendix D](user-flows.md) has nine flows step by step. The four that define the product:

| Flow | One line |
|---|---|
| [F1 Install](user-flows.md#f1-a-newcomer-installs-the-studio-target) | one command, three apps, `doctor` says what is wrong |
| [F2 Hire the studio](user-flows.md#f2-tim-hires-the-studio-for-a-piece-of-work-target-the-engagement-loop) | request, questions, scope of work, quote band, one approval verb, delivery, closeout report |
| [F3 Watch the office](user-flows.md#f3-tim-watches-the-office-target) | desks per agent, bubbles for "needs you", progress bars per epic and story, the quote against spend |
| [F5 A story lands](user-flows.md#f5-a-story-lands-today-with-the-additions-marked) | queue, worktree, sandbox, loop, gate, meter, PR, notification, plan status pulled back |

---

## 6. The components

### 6.1 The plugin (exists; changes are small)

Keeps every surface. Changes: the drift check's plugin plane reads the skills-dir folder and the roster (AD-13 wording "catalog lockstep" amended); the conformance suite's harness-loadable assertion follows; the contract gains the studio web as a named consumer and the engagement verbs the supervisor exposes are documented as a consumer surface, not a plugin surface (AD-2 unchanged: the plugin imports no driver). Contract bump 0.1.19, additive.

### 6.2 The supervisor (exists; grows the differentiators)

What exists is kept as built (queue, lock, tiers, guards, pacer, resume, API, notifications, sign-in). It grows, in this order:

1. **Engine lifetime and worktrees** (EP-26). A run gets a `git worktree` from `base_ref`; the service owns the engine's life (no host `sbx exec` to die with); PR at the end (Story 23.2); close-out for a landed-but-paused story (hole 9); launch owns its bootstrap output (hole 10); a host-tier Windows verify leg before the PR (holes 11, 12); process-group ownership (DW-3); cost summed across resumes (DW-15); every run starts through the queue (DW-6); the `ended` event with a PR URL triggers a plan-sync status pull-back (hole 18).
2. **The agent registry and the semantic event projection** (EP-27). §7.2 and §7.3. A second SSE stream, or the same stream with a `kind: office` family, carrying `{agentId, state, detail, story, epic, engagement}`.
3. **The engagement state machine** (EP-29). §7.1. Verbs: `POST /engagements`, `POST /engagements/{id}/input` (typed: `answer`, `revise`, `approve`, `question`, `go`), `GET /engagements/{id}`; the chat route `POST /chat/{engagement}` backed by a `claude -p` planner session with the studio plugin, metered like any run.
4. **Thinner commodity layers** (later). Remote Control for steering; OTel-fed meter with ccusage cross-check; `/code-review` beside the reviewers; the advisor as the consult leg once 24.3 measures it.

### 6.3 The studio web (new)

Next.js with `output: 'export'`, served by the supervisor on one origin behind the existing session cookie; hybrid renderer: DOM for the HUD, bubbles, board and chat, one plain PixiJS v8 canvas for the floor and characters (confirmed by the [D5](decisions.md#d5-renderer) phone spike); one SSE stream per tab with snapshot-then-deltas, `Last-Event-ID`, a heartbeat under 15 s, and a watchdog on `visibilitychange`. The grammar: desk = agent; "!" bubble = needs you and never auto-expires; epic = project with phased progress; story = phase; findings = bugs draining; the quote band drawn against spend. Assets per [D6](decisions.md#d6-assets). The read-only page stays as the fallback.

### 6.4 The front door and chat (decision D2)

The engagement conversation has one home, the supervisor's chat route, reachable from the studio web's chat panel and from Telegram through an inbound adapter. The adapter relays; the supervisor decides. Hermes is the first adapter because it is installed and already carries the notifications. What Hermes could add beyond relaying (memory, cron, 25 platforms, its own voice) and what it costs is weighed in [Appendix B](hermes-fit.md); the recommendation is [D2 option C](decisions.md#d2-hermes).

### 6.5 The installer (new, settled in shape by O5 and the ADR §7)

Bootstrap → meta-CLI → roster. Verbs `install`, `update`, `doctor`, `status`. `doctor` absorbs the runbook's smoke table and the two trust holes (14, 15). Details in [ADR §7](../../briefs/adr-repository-structure-2026-10-09.md#7-installer-design-one-setup-and-updater) with the plugin leg replaced by the skills-dir write.

### 6.6 Engines and sandboxes (exist)

bmad-loop at the `bmad.lock` pin plus the studio pipeline (routing legs, consult on objective triggers, the deviation-scoring gate, the meter hook), inside one Docker Sandbox per project. Changes: the plugin arrives through the read-only skills mount instead of a per-sandbox install; the service owns lifetime (6.2); the Phase 3 pack adds the `playable-verify` leg and the asset ladder for game projects (EP-31).

### 6.7 Measurement and the evolve loop (exist)

The per-machine JSONL ledger, `job-run` and `observation` events, the meter per story, `tk evolve` from observations to proposals, the PR membrane. Changes: the quote band is computed from this history; advisor tokens are priced; OTel later. One housekeeping item: `tk evolve` has never been run over the agent PC's sixteen loop-deficiency observations.

### 6.8 Planning and knowledge (exist)

BMad artifacts normalised by the planning adapter; Backlog.md projection; the registry; kb per project. The engagement loop creates epics and stories **through the adapter** (AD-4), never directly.

---

## 7. The data model

### 7.1 Engagement → epics → stories → runs → events

```
engagement {id, project, state, request, questions[], assumptions[], scope_doc, quote{band50,band85,band95,cap,basis}, autonomy, approved_at, closeout}
   └─ epics (canonical EP-NNN, via the adapter)
        └─ stories (ST-NNN)
             └─ queue runs (q-<job>-<ts>-<hex>) ─▶ studio runs (~/.tk-studio/projects/<key>/runs/<id>)
                  └─ events (queued, claimed, woke, worker, accounted, ended, notified, …)  +  journal.jsonl (bmad-loop)
```

States, from the Jules enum and the queue's own: `intake → awaiting-answers → scoping → quoted → approved → in-progress → delivered`, with `paused`, `failed`, `partial`, `cancelled` as side exits. Only a typed input moves the state. [F2](user-flows.md#f2-tim-hires-the-studio-for-a-piece-of-work-target-the-engagement-loop) walks it.

### 7.2 The agent registry

The answer to "with Hermes the agents need to be registered so it can see them", made general so it holds under every D2 option.

| Field | Owner | Source |
|---|---|---|
| `agent_id`, `role` (orchestrator, session, implementer, reviewer, consult, advisor, planner), `project` | the supervisor | derived from the routing legs and the working set (`orchestrate.py resolve`, `[pipeline.legs]`) |
| `model`, `effort` | tk-studio routing (AD-14) | the resolved route in force for the run |
| `persona` (display name, sprite or avatar, voice) | the studio web's presentation overlay | a bindings file keyed by `agent_id`; defaults shipped |
| `live_state` (semantic state, current story, last event) | the supervisor's projection | queue events and the bmad-loop journal |
| `memory` (optional) | the chat adapter (a Hermes profile per project, if Hermes is kept) or the project kb | exported from the registry; never the source of truth |

The registry is read-only to every consumer. Onboarding and the supervisor write it. If Hermes is the adapter, an exporter writes Hermes profiles or Bot Mode entries from it, so the office and Hermes see the same agents.

### 7.3 Semantic agent states (the office vocabulary)

`offline`, `idle`, `thinking`, `reading`, `typing`, `running`, `waiting-for-human`, `blocked`; overlays `done`, `failed`. Promotion is instant; demotion goes through a grace timer; `waiting-for-human` never expires on its own. Progress per story and epic is derived from the journal's terminal kinds over a denominator fixed when stories are validated. The base vocabulary is Pixel Agents' `ServerMessage` subset, extended with `story`, `epic`, `engagement` identifiers.

---

## 8. Security and invariants (unchanged)

Never `--dangerously-skip-permissions` on the host; the `permissions.deny` list stays; branch per run, PR-only, protected `main` on every repository; the status block ends every headless run (AD-11); conformance gates "done" (AD-19); the supervisor and every adapter live outside the plugin (AD-2); credentials only in the per-user store, the OS store or the environment, never in a tracked file or an event (AD-3); the supervisor strips credentials from every worker's environment; a cookie never submits a job; the installer verifies every byte it downloads; Hermes (if kept) never runs `claude -p` and its learning loop stays gated.

---

## 9. Decisions only Tim can make

One line each; [Appendix C](decisions.md) has options, benefits and drawbacks, and a recommendation.

| # | Decision | Recommendation |
|---|---|---|
| D1 | Repository: one (O2) or stay split (O1) | O2, sequenced after the first engagement slice |
| D2 | Hermes: chat brain (A), dropped (B), or first adapter behind a supervisor-owned chat (C) | C |
| D3 | Order of work | packaging → service and events → office and engagement → restructure |
| D4 | Quote basis | window share with a list-price dollar shadow |
| D5 | Renderer | hybrid DOM plus PixiJS, confirmed by a phone spike |
| D6 | Assets | LimeZu out of git via the installer; LPC or PixelLab for anything committed |
| D7 | Sign-in | drop the OAuth walk-through; token cookie plus Remote Control |
| D8 | API-key fallback | design now, build on trigger; record the terms reading in the ADR |

The ADR's own §8 rulings 2 to 7 (admin exemption, front-end tag, nested project, archive, meta-CLI wheel) follow the ADR's recommendations and are listed there.

---

## 10. Build order

Proposed epics, numbered after 24. Each is PR-sized work through the studio's own loop, metered. Epic 23's acceptance and Epic 24.3/24.4 run alongside, unchanged.

| Epic | Name | Carries | Needs first |
|---|---|---|---|
| EP-25 | **Packaging: installer, skills-dir plugin, roster** | O5; ADR §7 minus the marketplace leg; drift check and conformance rebased; marketplace copies uninstalled; sandboxes on the read-only skills mount; `doctor` with trust checks (holes 14, 15) | nothing |
| EP-26 | **The service owns lifetime** | Story 23.2 as worktree per run plus PR; holes 9, 10, 11/12, 16, 18; DW-3, 6, 11, 12, 13, 15, 19, 21, 23; the `advisor` routing field; `tk evolve` over the loop observations | EP-25 (so the sandbox plugin path is final) |
| EP-27 | **Agent registry and semantic event projection** | §7.2, §7.3; contract 0.1.19 naming the web as a consumer | EP-26 |
| EP-28 | **Studio web v0: office, board, status** | §6.3; replaces the status page as the home; D5 spike first | EP-27 |
| EP-29 | **The engagement loop v1** | §7.1; chat route; questions, scope, quote band (D4), approval verb, closeout report; Telegram through the first adapter (D2) | EP-27, and EP-28 for the panel |
| EP-30 | **Repository restructure** (if D1 signs O2) | ADR §5 rehearsal and cut-over; `apps/studio-web` moves in | EP-26 (worktrees), EP-29 (so the move does not delay the surface) |
| EP-31 | **Vertical-slice pack** (Phase 3) | `playable-verify` leg, engine MCP wiring, asset ladder, `run-vertical-slice` job, eval cases | EP-29 (an engagement on a game project is its entry) |
| 23.3, 24.3, 24.4 | acceptance on TUA; paired runs with the advisor arm; the verdict | as planned | EP-26 for 23.3; nothing for 24.3 |

Rough size, by analogy with Epics 21 and 22 ($152.75 and $69.36 all-in on Opus 5.5): EP-25 and EP-27 are Epic-22-sized; EP-26 and EP-29 are Epic-21-sized or larger; EP-28 is unmeasured territory (a web app is new to the loop) and should start with the D5 spike as its first story.

---

## 11. Risks

| Risk | Why it matters | What the design does |
|---|---|---|
| **The Max-subscription premise** | the legal page says developers "should use API key authentication"; the policy moved four times in 2026; `--bare` may become the `-p` default | D8: an API-key worker tier designed now; the reading recorded in the ADR; a staleness watch |
| **Headless runs fail at usage limits**; parallel stories share one window | a native daemon does neither | the pacer keeps stories inside the window; the service owns limit detection and rescheduling (EP-26) |
| **Docker Sandboxes on Windows is 0.x** (56 open Windows issues) | holes 7 and 13 are its lived form | the service owns engine lifetime; the glue stays ours; stability on the refresh work order |
| **Windows is the recurring tax** | MSIX virtualisation, Task Scheduler hangs, folder trust, CRLF, MAX_PATH, junctions | runbook §8 is a design input; a host-tier verify leg; every adoption gets a "prove it on the box" story |
| **Hermes churn and surface** if kept | about 25,000 commits in two months, weekly stable releases, this install tracks `main`; a second agent runtime between the phone and the box | D2 option C keeps it replaceable behind the adapter seam; learning gated; never executes |
| **Hermes can invalidate the Claude login** | `auth.adopt_external_logins: true` on the box lets Hermes borrow and refresh Claude Code's OAuth token; the supervisor's workers run on that login | one-line fix handed to Tim (`false`); the installer's `doctor` checks it when Hermes is present |
| **Research blind spots** (hole 17) | this spec exists because the ADR missed the standing plan | the deep-recon charter and the ADR template gain a mandatory plan-inventory step; Appendix A is the first |
| **A web app is new to the loop** | no metered history for EP-28 | the D5 spike first; quote EP-28 after one story lands |

---

*Links to deep dives are in each section and in the appendices. The staleness map for the evidence is in each research report's last section; the earliest re-check is 2026-11-01.*
