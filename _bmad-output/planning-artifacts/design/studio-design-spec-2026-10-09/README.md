# tk-studio design spec: the contract studio you hire from your own machine

| | |
|---|---|
| Status | **Rulings recorded 2026-10-14.** Tim ruled D1 to D8 and added four pieces of feedback ([his answers](decisions-answers.md)); this revision folds them in. Two small calls made while folding (D9, D10) are flagged in [Appendix C](decisions.md) for his objection. |
| In force since 2026-10-14 | **D1** one repository, `tk-studio`, per-app releases (O2, AD-21). **D2** Hermes dropped; the studio owns its chat. **D3** order: packaging, Epics 26 and 27, then the restructure (the supervisor only), then the front end (amended 2026-10-16). **D4** quotes in window share with a list-price dollar shadow. **D5** no Next.js; a browser app the supervisor serves, PixiJS for the office, desktop and iPad first, a phone UI later. **D6** our own 2D assets, committed. **D7** one account per studio, username and password, no external providers. **D8** no API-key fallback; the studio is the subscription holder's own seat. **Feedback:** Jira and Confluence track every engagement; blocked work reaches the owner through comments and an inbox; a 3D-tooling resource list is filed. |
| Settled earlier (not reopened) | the 2026-09-26 rulings (engines only in Docker Sandboxes, Max pays, independent supervisor), the 2026-10-09 rulings (office first, no third repo, one installer, the engagement vision), and **O5** (plugin form kept, marketplace dropped, installer-written skills-dir plugin) |
| Evidence | [run 1: front end and repo](../../research/studio-front-end-and-repo-structure-2026-10-09/research.md), [run 2: native overlap and greenfield](../../research/studio-native-overlap-and-greenfield-2026-10-09/research.md), the [repository ADR](../../briefs/adr-repository-structure-2026-10-09.md) (now signed), the [2026-09-26 plan](../../briefs/planning-pass-agent-pc-and-supervisor-2026-09-26.md), the [architecture spine](../../architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md) (AD-21, AD-22 added), the ledgers audited in [Appendix A](feature-ledger.md), the [Hermes digest](../../research/hermes-fit-2026-10-09/digests/H1-hermes-capabilities-2026-10.md) |
| Appendices | [A. Feature ledger](feature-ledger.md) · [B. Hermes fit](hermes-fit.md) (record; ruled B) · [C. Decisions](decisions.md) · [D. User flows](user-flows.md) · [Tim's answers](decisions-answers.md) |

---

## 0. How to read this in five minutes

1. **§1** says what the studio is, in one page.
2. **§2** says what is built, what is owed, and what this revision changed. The detail is [Appendix A](feature-ledger.md).
3. **§3** is the picture: devices, the web app, the supervisor, engines, Atlassian, repositories.
4. **§6** is the component design. **§7** is the data model: engagements, the agent registry, the office vocabulary, comments and the inbox.
5. **§9** records the rulings and the two calls still open to objection.
6. **§10** is the build order as proposed epics; Epic 25 (packaging) is written into the plan in this PR.

---

## 1. What the studio is

**One sentence.** tk-studio is a software studio you hire from your own machine: you describe what you want, it asks the questions a good contractor asks, comes back with a scope of work and a quote, and once you approve it builds the work story by story in isolated sandboxes, lands each story as a pull request, tracks the work in Jira and Confluence, and shows you the whole thing as an animated office where you can see who is working on what.

**Who it is for.** Tim first, as a product owner who wants to go from napkin idea to prototype to finished product without sitting at the keyboard. Then anyone who installs it on a machine of their own with their own Claude subscription. **One studio, one owner:** the account that set the studio up and whose Claude Code is signed in is the user. Multi-user comes later.

**What it is made of (three apps, one installer).**

| App | What it is | Where it runs |
|---|---|---|
| **The plugin** (`tk-studio`) | 18 Claude Code skills, 2 role agents and the driver contract: how to plan, install, drift-check, launch, meter and evolve. Stdlib Python, headless-safe, every surface ends in a status block. | inside every Claude Code session, on the host and in every sandbox, loaded from `~/.claude/skills/tk-studio/` (O5) |
| **The supervisor** | a small Bun service: durable job queue, one lock per checkout, guards, pacer, two worker tiers, crash recovery, HTTP API, SSE event stream, notifications, sign-in. This design adds the engagement state machine, the agent registry, the semantic event projection, worktrees and PR hygiene, the Atlassian sync, the inbox, and the chat route. | console-hosted at logon on the agent PC; tailnet by default |
| **The studio web** | a browser app (Vite, React, TypeScript; one PixiJS v8 canvas for the office floor) built to static files the supervisor serves on the same origin: the office, the board, the inbox, the issue view, the chat panel, status. Desktop and iPad first; a phone UI later. | your browser, same origin as the API |
| **The installer** (`tk-studio` meta-CLI) | a bootstrap script plus a self-updating CLI that reads a committed roster of compatible versions and installs or updates all three apps. Never clones a repository. | the user's machine |

**What it is built on, not instead of.** Claude Code under the owner's Max login (the only thing that runs on the subscription), Docker Sandboxes for bypass isolation on Windows, the BMad method at a pinned version for planning artifacts, bmad-loop as the story engine, GitHub for PR-only delivery, **Atlassian Cloud (Jira and Confluence, free tier) as the tracker and knowledge base for every engagement**, Tailscale for reach. The studio's own code is the part nobody ships: the queue contract and pacer, the story-aware gate and routing, the meter and evolve loop, the drift check against a pinned base, the conformance suite, the engagement loop, the inbox, and the office.

---

## 2. Where things stand

Short form; [Appendix A](feature-ledger.md) has every row with evidence.

**Built and proven on TIM-PC-2.** The plugin at 0.2.16 (18 surfaces, 792 lib tests, 116 conformance checks). The supervisor through Epic 22 (599 tests, live since 2026-10-07, restart proven, phone sign-in over HTTPS). Three Docker Sandboxes; TUA's engine green. The meter and twelve metered stories. A Jira adapter (Epic 8) that promotes entities and pulls status back.

**Planned and still owed.** Epic 23.2 and 23.3 (branch per run, PR at the end, acceptance from the phone). Epic 24.3 and 24.4 (paired runs, the routing verdict, the advisor arm). The Phase 3 vertical-slice pack (nothing started). The 2026-09-01 office decisions. Fourteen supervisor DW entries and two in tk-studio. Loop holes 3, 4, 6, 8 to 12, 15 to 18.

**What the 2026-10-14 rulings changed.**
1. **Hermes is out** (D2). Its Phase 2 items are superseded; Telegram inbound is dropped for now; the supervisor's outbound notifier (Telegram Bot API or ntfy) stays, since it never needed Hermes. A tk-studio-native bot comes later if wanted. The `adopt_external_logins` hazard stands as long as the Hermes gateway keeps running on the box ([Appendix B.4](hermes-fit.md#b4-what-it-costs)).
2. **No Next.js** (D5). The web app is a static bundle the supervisor serves; Vite builds it; React owns the text UI; PixiJS owns the floor.
3. **Atlassian is the tracker and knowledge base for engagements** (feedback 1). Each project gets a Jira project and a Confluence space at setup; the studio publishes there and syncs back on a timer. The existing Jira adapter grows; a Confluence binding is new.
4. **The human channel is comments plus an inbox** (feedback 2). Blocked work moves to a blocked status with an @mention comment; the owner clears it from an inbox; an agent validates the resolution.
5. **One account, username and password** (D7); no external providers, no API-key fallback (D8); the intended-usage statement in §8.
6. **Order** (D3, amended 2026-10-16): packaging, then service and events (Epics 26 and 27), then the restructure (the supervisor moves in; EP-28), then the web and the engagement loop. The restructure was last; after Epic 27 every later epic touches the supervisor, so the two-repository tax (a read-only mount of tk-studio in the supervisor's sandbox, a hand-over file for the tk-studio side, a second pipeline-plugin copy, three PRs per epic, a roster with two sources) is paid once per epic until the move.

---

## 3. The shape

```
 Tim: PC / laptop / iPad ──Tailscale (default) ──▶ TIM-PC-2 (Windows 11, always on, Max login)
   browser ─▶ studio web (office · board · inbox · issue view · chat · status) ── same origin ──┐
                                                                                             ▼
                      ┌──────────── the supervisor (Bun, console-hosted at logon) ─────────────────┐
                      │ sign-in (one account) · engagements ─▶ epics/stories (planning adapter)     │
                      │ durable queue · lock per checkout · worktree per run · pacer · guards        │
                      │ agent registry · semantic event projection ─▶ SSE /events                   │
                      │ chat route ─▶ a claude -p planner session (the studio plugin)                │
                      │ Atlassian sync: publish ─▶ Jira + Confluence; pull back on a timer           │
                      │ inbox: blocked issues with @mentions ─▶ owner replies ─▶ agent validates     │
                      │ notifier: Telegram Bot API or ntfy (outbound only)                           │
                      └─────────────────────────────┬───────────────────────────────────────────────┘
                                                    │ contract §1: claude -p "/tk-studio:<skill>"
                        ┌───────────────────────────┴──────────────────────────┐
                        ▼                                                      ▼
           host tier: auto mode, deny list,                   sbx tier: Docker Sandboxes microVM,
           Godot via $env:GODOT, trusted folders              bypass allowed, bmad-loop + studio pipeline,
                                                              host ~/.claude/skills mounted read-only
                        │                                                      │
                        └────────── ~/.tk-studio (store, registry, runs, ledger) ──────┘
                                    GitHub (PR-only, protected main) · Atlassian Cloud (Jira, Confluence)
```

Three rules hold the picture together and are not open:
- **The supervisor is the only thing that starts work and the only thing that changes an engagement's state.** The web renders; Atlassian mirrors; the plugin publishes the contract.
- **Bypass lives only inside a microVM.** The host tier runs `auto` with the deny list in trusted folders.
- **Every headless run ends with a status block; nothing is done until conformance passes.** (AD-11, AD-19.)

---

## 4. How the apps reach a user (O5 and O2, both ruled)

- **The installer is the only newcomer path.** Bootstrap, then the meta-CLI, then a roster. Flow [F1](user-flows.md#f1-a-newcomer-installs-the-studio-target).
- **The plugin is written, not installed.** `~/.claude/skills/tk-studio/`; Claude Code loads it in place as `tk-studio@skills-dir`; `${CLAUDE_PLUGIN_ROOT}` substitutes (Tim's probe). The installer uninstalls marketplace copies, the repository drops its committed marketplace entries, sandboxes read the host folder through Docker's read-only skills mount, the drift check reads the folder plus the roster.
- **The supervisor and the web ship as release zips** with SHA-256s into versioned slots; the roster pins the set per channel; `make_latest: false`; everything resolves by tag.
- **All three live in `tk-studio`** (D1, AD-21): `plugins/tk-studio`, `apps/supervisor`, `apps/studio-web`, `tools/installer`. The supervisor moves in with `git filter-repo` after a rehearsal ([ADR §5](../../briefs/adr-repository-structure-2026-10-09.md#5-migration-plan-the-supervisor-into-appssupervisor)); until then the installer's roster points at the two repositories' releases.

---

## 5. The user's day

[Appendix D](user-flows.md) has eleven flows. The five that define the product:

| Flow | One line |
|---|---|
| [F1 Install](user-flows.md#f1-a-newcomer-installs-the-studio-target) | one command, three apps, the owner's account created on first visit, `doctor` says what is wrong |
| [F10 Set up a project](user-flows.md#f10-a-project-is-set-up-on-atlassian-target) | a Jira project and a Confluence space from a template; the plan and the kb published; sync-back on a timer |
| [F2 Hire the studio](user-flows.md#f2-tim-hires-the-studio-for-a-piece-of-work-target-the-engagement-loop) | request, questions, scope of work (in Confluence too), quote band, one approval verb, delivery, closeout |
| [F4 The inbox](user-flows.md#f4-blocked-work-reaches-the-owner-through-the-inbox-target) | a blocked story comments with an @mention; the inbox lists it; reply or Done; an agent validates |
| [F3 Watch the office](user-flows.md#f3-tim-watches-the-office-target) | desks per agent, bubbles for "needs you", progress per epic and story, the quote against spend |

---

## 6. The components

### 6.1 The plugin (exists; changes are small)

Keeps every surface. The drift check's plugin plane reads the skills-dir folder and the roster (AD-13 wording amended); the conformance suite's harness-loadable assertion follows; the Jira adapter grows comments and the blocked statuses; a Confluence knowledge binding is new (§6.8). Contract 0.1.19, additive: the studio web is named a consumer; the engagement and inbox verbs are documented as supervisor surfaces, not plugin surfaces (AD-2 unchanged).

### 6.2 The supervisor (exists; grows the differentiators)

Kept as built. It grows, in this order:

1. **Engine lifetime and worktrees** (EP-26 the studio side, EP-27 the supervisor): worktree per run from `base_ref`; the service owns the engine's life; PR at the end (Story 23.2); close-out for a landed-but-paused story (hole 9); launch owns its bootstrap output (hole 10); a host-tier Windows verify leg (holes 11, 12); process-group ownership (DW-3); cost summed across resumes (DW-15); every run starts through the queue (DW-6); the `ended` event with a PR triggers a status pull-back (hole 18).
2. **The supervisor moves in** (EP-28): ADR §5 rehearsed by a script and run once; `apps/supervisor` a nested studio project with its history; one sandbox, one PR flow, one roster source.
3. **One account and the registry and projection** (EP-29): the owner's account (§8); the agent registry (§7.2); the office event stream (§7.3); contract 0.1.19.
4. **Atlassian sync and the inbox** (EP-31): §6.8, §6.9, §7.4.
5. **The engagement state machine and the chat route** (EP-32): §7.1; `POST /engagements`, typed inputs, `GET /engagements/{id}`; `POST /chat/{engagement}` backed by a `claude -p` planner session with the plugin, metered like any run.
6. **Thinner commodity layers** (later): OTel-fed meter with ccusage cross-check; `/code-review` beside the reviewers; the advisor as the consult leg once 24.3 measures it; Remote Control for live steering when wanted.

### 6.3 The studio web (new; shape ruled by D5)

- **Stack.** Vite plus React plus TypeScript, built to static files in `apps/studio-web/dist`; the supervisor serves the tree with a directory route and an `index.html` fallback on the same origin, behind the session cookie; one SSE stream per tab with snapshot-then-deltas, `Last-Event-ID`, a heartbeat under 15 s, and a watchdog on `visibilitychange` (iPad Safari backgrounds streams the way iOS does). No Next.js: nothing needed server rendering, and the Bun service was already the server.
- **Renderer.** Hybrid: one plain PixiJS v8 canvas for the floor and characters (nearest scaling, integer zoom from the device pixel ratio); React DOM for everything with text in it: the HUD, bubbles, the board, the inbox, the issue view, the chat. A first spike settles the pixel-scaling recipe at desktop and iPad pixel ratios ([D5](decisions.md#d5-renderer)).
- **Screens.** Office (floor plus HUD); Board (epics as projects with phased bars, stories as phases, findings draining, the quote band against spend, a Needs-you / Working / Done triage column); Inbox (§6.9); Issue (a Jira-like view of one story with its comments, status, run, PR and cost); Chat (the engagement conversation); Status (what the read-only page shows today). The read-only page stays as the no-JavaScript fallback.
- **Devices.** Desktop and iPad first. A separate phone UI later (EP-34): inbox, approve, status; small by design.
- **Reach.** Tailnet by default, as today. A "public" mode (owner's firewall and DNS, TLS, the same account) is documented as a later option, not built now ([D10](decisions.md#d10-public-exposure)).

### 6.4 The front door and chat (D2: the studio's own)

The engagement conversation has one home, the supervisor's chat route, reachable from the web's chat panel. It is answered by the studio's planner leg (a `claude -p` session with the plugin, the same brain the loop uses), with the engagement record, the project's plan, kb and Confluence pages as its memory. Telegram inbound is dropped for now; the outbound notifier stays; a tk-studio-native bot (Telegram or other) is a later epic if the inbox and the notifier are not enough. Hermes's assessment is kept as a record in [Appendix B](hermes-fit.md).

### 6.5 The installer (new; settled by O5 and the ADR §7)

Bootstrap, meta-CLI, roster. Verbs `install`, `update`, `doctor`, `status`. `doctor` absorbs the runbook's smoke table, the two trust holes (14, 15), the certificate age, and, while a Hermes gateway runs on the box, warns if `adopt_external_logins` is on. Details in [ADR §7](../../briefs/adr-repository-structure-2026-10-09.md#7-installer-design-one-setup-and-updater) with the plugin leg replaced by the skills-dir write. **This is Epic 25**, written into the plan in this PR.

### 6.6 Engines and sandboxes (exist)

bmad-loop at the `bmad.lock` pin plus the studio pipeline, inside one Docker Sandbox per project. The plugin arrives through the read-only skills mount; the service owns lifetime (6.2); the Phase 3 pack adds the `playable-verify` leg and the asset ladder for game projects (EP-33), drawing on the [3D tooling resource list](../../../../kb/agentic-3d-asset-tooling-2026-10.md) Tim filed.

### 6.7 Measurement and the evolve loop (exist)

The ledger, `job-run` and `observation` events, the meter per story, `tk evolve`, the PR membrane. The quote band is computed from this history; advisor tokens are priced; OTel later. Housekeeping: `tk evolve` has never been run over the agent PC's loop-deficiency observations.

### 6.8 Planning and knowledge, now on Atlassian (feedback 1)

- **Why.** Tim's reasoning: free for small teams, strong MCP and API support, unlimited projects and spaces, viewable from any device without the studio site, comments and attachments for free, and the studio stops building a tracker and a wiki. Two seats of the ten: the owner and an agent user with its own API token, so the studio's posts are distinguishable from the owner's.
- **What exists.** The planning adapter (AD-4 to AD-6), the Jira adapter with promote and status pull-back on Jira's status categories (Epic 8), the designed migration (AD-16), the kb with its llms-style index (AD-3), the knowledge promotion gate (Epic 9). AD-7 already names Jira as the first external backend with API tokens, never OAuth, for headless flows.
- **What grows.** (a) **Project setup**: at onboarding the studio creates a Confluence space and a linked Jira project from a template, with the folder structure for docs and the statuses the inbox needs; what the API cannot do is handed to the owner as exact steps or done through the browser. (b) **Publish**: epics and stories promote as today; design pages (brief, GDD, scope of work, decisions) publish to Confluence; the plan stays canonical in `_bmad-output/` (AD-5). (c) **Sync-back on a timer**: a recurring job pulls status, comments, attachments as links, and owner-authored Confluence pages into local memory so agents never query live for context. (d) **Two new statuses** in every studio-managed Jira project: `Blocked - Awaiting User` and `Block Resolved`. (e) A **Confluence knowledge binding** beside the kb: owner-authored pages mirror into `kb/confluence/` as read-only sources with provenance.
- **The one rule to widen.** AD-5 says the backend is a projection and canonical files win. That stays true for entity fields. Comments, attachments and owner-authored Confluence pages are a new class: **backend-authoritative and append-only**, pulled back verbatim, never promoted from local. Flagged as [D9](decisions.md#d9-what-the-backend-owns) and written into AD-22.
- **Verify before building** (open questions in [Appendix C](decisions.md)): the free plans' limits on workflow customisation, project permissions and API rate; whether the Rovo MCP server is needed at all when the REST API with an API token already works (the adapter uses REST today).

### 6.9 The inbox and the human channel (feedback 2)

Tim's model, adopted as written:

1. A story (or any issue) that cannot progress moves to `Blocked - Awaiting User`, and so do its dependents. The reason goes in a comment that @mentions the owner.
2. The sync-back picks the mention up; the owner's **inbox** lists every issue needing attention, sorted by priority then time, in the web and in Jira itself (a saved filter).
3. Opening one shows a Jira-like issue view. The owner replies in text, or, for a simple request ("install X", "run Y as admin"), presses **Done**, which writes the reply for them.
4. The reply moves the issue to `Block Resolved` and clears the inbox item. An agent then **validates the resolution**: if something had to be done, it tests that it can now do the thing; if feedback was needed, it checks the answer is enough. It either continues (back to `To Do` or `In Progress`) or moves the issue back to `Blocked - Awaiting User` with a follow-up comment, which lands in the inbox again.
5. The same mechanism carries the engagement's questions, approvals and the loop's `escalate` rulings: they are issues with comments, so the owner has one inbox for everything.

The office shows a persistent "!" bubble on the desk whose work is blocked; it clears when the status changes, never when a message arrives.

---

## 7. The data model

### 7.1 Engagement → epics → stories → runs → events

```
engagement {id, project, state, request, questions[], assumptions[], scope_page (Confluence), quote{band50,band85,band95,cap,basis}, autonomy, approved_at, closeout}
   └─ epics (canonical EP-NNN, via the adapter; Jira Epic)
        └─ stories (ST-NNN; Jira Story) ── comments (backend-authoritative, append-only)
             └─ queue runs (q-<job>-<ts>-<hex>) ─▶ studio runs (~/.tk-studio/projects/<key>/runs/<id>)
                  └─ events (queued, claimed, woke, worker, accounted, ended, notified, …)  +  journal.jsonl
```

States: `intake → awaiting-answers → scoping → quoted → approved → in-progress → delivered`, with `paused`, `failed`, `partial`, `cancelled` as side exits. Only a typed input moves the state. [F2](user-flows.md#f2-tim-hires-the-studio-for-a-piece-of-work-target-the-engagement-loop) walks it.

### 7.2 The agent registry

The supervisor's own, read-only to every consumer, written by onboarding and the supervisor.

| Field | Owner | Source |
|---|---|---|
| `agent_id`, `role` (orchestrator, session, implementer, reviewer, consult, advisor, planner), `project` | the supervisor | the routing legs and the working set (`orchestrate.py resolve`, `[pipeline.legs]`) |
| `model`, `effort` | tk-studio routing (AD-14) | the resolved route in force for the run |
| `persona` (display name, sprite, voice) | the studio web's presentation overlay | a bindings file keyed by `agent_id`; defaults shipped with our own assets (D6) |
| `live_state` (semantic state, current story, last event) | the supervisor's projection | queue events and the bmad-loop journal |
| `jira_account` | the Atlassian sync | the agent user, so Jira shows who posted |

### 7.3 Semantic agent states (the office vocabulary)

`offline`, `idle`, `thinking`, `reading`, `typing`, `running`, `waiting-for-human`, `blocked`; overlays `done`, `failed`. Promotion is instant; demotion goes through a grace timer; `waiting-for-human` never expires on its own. Progress per story and epic is derived from the journal's terminal kinds over a denominator fixed when stories are validated.

### 7.4 Comments and inbox items

```
comment {issue, author (owner | agent user), body, mentions[], created, source: jira}        append-only, pulled back
inbox_item {issue, priority, blocked_since, reason_comment, state: open | resolved | validating}  derived on every sync-back
```

Statuses added to every studio-managed Jira project: `Blocked - Awaiting User`, `Block Resolved`. The canonical status enum (AD-6) keeps `blocked`; the two Jira statuses map onto it with the original preserved under `external.jira`, as AD-6 already prescribes for unmappable backend states.

---

## 8. Security, intended usage and invariants

Unchanged: never `--dangerously-skip-permissions` on the host; the `permissions.deny` list stays; branch per run, PR-only, protected `main`; the status block ends every headless run; conformance gates "done"; the supervisor lives outside the plugin; credentials only in the per-user store, the OS store or the environment; the supervisor strips credentials from every worker's environment; a cookie never submits a job; the installer verifies every byte it downloads.

New with D7 and D8:
- **One account per studio.** Created on the first visit (username and password, hashed with Bun's built-in password hashing, rate-limited sign-in with lockout). The API bearer token stays for automation. Google and GitHub sign-in are removed from the page; the code is deleted when the account lands.
- **Intended usage, stated in the README and on the sign-in page:** the studio is operated by the person whose Claude subscription is signed in on the box, from their own seat. No token is intermediated, no third-party login is offered, and there is no API-key tier. Sharing the studio login is outside what the studio can or should control. Multi-user is a later design.
- **Tailnet by default.** Public exposure is the owner's choice and configuration, documented later ([D10](decisions.md#d10-public-exposure)).

---

## 9. Rulings and the two open calls

| # | Decision | Ruled 2026-10-14 |
|---|---|---|
| D1 | Repository | **O2**, one repository with per-app releases; ADR §8.2 to §8.7 as recommended |
| D2 | Hermes | **B**, dropped; the studio owns its chat |
| D3 | Order of work | **packaging, then Epics 26 and 27, then the restructure (the supervisor only), then the front end**; amended 2026-10-16 from "packaging, front end, restructure" |
| D4 | Quote basis | **both**, dollars as the shadow figure |
| D5 | Renderer and stack | **PixiJS; no Next.js; desktop and iPad first; phone UI later** |
| D6 | Assets | **our own 2D assets, committed** |
| D7 | Sign-in | **one account, username and password, no external providers** |
| D8 | API-key fallback | **none; the owner's own seat** |
| D9 | What the backend owns (comments, attachments, owner-authored pages are backend-authoritative) | **my call while folding feedback 1; open to objection** |
| D10 | Public exposure (tailnet default; public mode documented later, not built) | **my call while folding D5; open to objection** |

---

## 10. Build order

Proposed epics, numbered after 24. Each is PR-sized work through the studio's own loop, metered. Epic 23.3 and Epic 24.3/24.4 run alongside.

| Epic | Name | Carries | Needs first |
|---|---|---|---|
| **EP-25** | **Packaging: installer, skills-dir plugin, roster** (in the plan now) | O5; ADR §7 minus the marketplace leg; drift check and conformance rebased; marketplace copies uninstalled; sandboxes on the read-only skills mount; `doctor` with the trust checks | nothing |
| EP-26 | The service owns lifetime, part 1: the studio side (in the plan since 2026-10-15) | launch ends every path with the block and owns its bootstrap plus the budget check (holes 10, 20, 4); the planner settles schema shape and the spec file name (holes 19, 6); routing legs carry `advisor` and `effort`; the meter lands on the host and the drafter skips it (hole 23, PROP-067); the adapter's status pull-back verb | EP-25 |
| EP-27 | The service owns lifetime, part 2: the supervisor (in the plan since 2026-10-15; transcribed to the supervisor repo before its launch) | worktree per run plus PR (23.2, hole 16); the supervisor holds and pins the engine and the queue is the only starter (hole 7, DW-3, DW-6); close-out of a paused run whose story landed (hole 9); a host-tier verify leg before any PR (holes 11, 12, 22); the plan follows the run (hole 18) and DW-11, 12, 13, 15, 19, 21, 23 | EP-26; Tim stops the supervisor tab; its sandbox recreated with the skills and work mounts |
| **EP-28** | **Repository restructure (O2): the supervisor moves in** (pulled forward 2026-10-16, D3 amended) | ADR §5 rehearsed by a script with a report, then once for real; `apps/supervisor` a nested studio project with its history (`git filter-repo`); one sandbox mounting the one repository; `release_archive.py` with the second prefix and a roster with one source; the old repository archived, never deleted; `apps/studio-web` is born in place with EP-30 | EP-27 (worktrees); Tim stops the supervisor tab and freezes the old repository |
| EP-29 | One account, the registry, the projection | D7; §7.2, §7.3; contract 0.1.19 | EP-28 |
| EP-30 | Studio web v0: office, board, status | §6.3 with the renderer spike as story 1 (D5); replaces the status page as the home; born in `apps/studio-web` of the one repository | EP-29 |
| EP-31 | Tracking on Atlassian and the inbox | §6.8, §6.9, §7.4; project setup from a template; publish and sync-back; the two statuses; the inbox and issue screens | EP-29; in parallel with EP-30 (the web) |
| EP-32 | The engagement loop v1 | §7.1; chat route; questions, scope (to Confluence), quote band (D4), approval verb, closeout report | EP-31 |
| EP-33 | Vertical-slice pack (Phase 3) | `playable-verify` leg, engine MCP wiring (godot-ai is a new candidate), asset ladder, `run-vertical-slice` job | EP-32 |
| EP-34 | Phone UI | inbox, approve, status at phone width | EP-31 |
| 23.3, 24.3, 24.4 | acceptance on TUA; paired runs with the advisor arm; the verdict | as planned | EP-26 for 23.3 |

Rough size, by analogy with Epics 21, 22, 25, 26 and 27 ($152.75, $69.36, $145.91, $60.73 and $181.88 all-in on Opus 5.5): EP-28, EP-29 and EP-31 are Epic-22-sized (EP-28 is four stories, two of them before the merge); EP-30 and EP-32 are Epic-21-sized or larger; EP-30 is new territory for the loop and starts with the spike.

---

## 11. Risks

| Risk | Why it matters | What the design does |
|---|---|---|
| **The Max-subscription premise** | the legal page says developers "should use API key authentication"; the policy moved four times in 2026 | D8: the owner's own seat, stated; no intermediation; the clause stays on the staleness watch |
| **Headless runs fail at usage limits**; parallel stories share one window | a native daemon does neither | the pacer keeps stories inside the window; the service owns limit detection (EP-26) |
| **Docker Sandboxes on Windows is 0.x** (56 open Windows issues) | holes 7 and 13 are its lived form | the service owns engine lifetime; the glue stays ours |
| **Windows is the recurring tax** | MSIX virtualisation, Task Scheduler hangs, folder trust, CRLF, MAX_PATH, junctions | runbook §8 is a design input; a host-tier verify leg; "prove it on the box" stories |
| **The Hermes gateway still runs with `adopt_external_logins: true`** | it can invalidate the Claude login the workers use, whether or not the studio uses Hermes | Tim sets it `false` or stops the gateway; `doctor` warns |
| **Atlassian free-tier limits** | workflow customisation, permissions, storage and API rate limits on Free are unverified; the design needs two custom statuses | verify in EP-31's first story; the adapter maps onto status categories if custom statuses are unavailable |
| **A second source of truth** | comments and owner pages live in Atlassian; the plan lives in git | D9's rule: fields canonical, comments and owner pages backend-authoritative and append-only; the sync-back is the only reader |
| **Public exposure** if ever enabled | the box holds repositories and a signed-in Claude | tailnet default; public mode only behind TLS, rate limits and lockout, documented later |
| **A web app is new to the loop** | no metered history for EP-30 | the spike first; quote EP-30 after one story lands |

---

*Links to deep dives are in each section and in the appendices. The earliest evidence re-check is 2026-11-01.*
