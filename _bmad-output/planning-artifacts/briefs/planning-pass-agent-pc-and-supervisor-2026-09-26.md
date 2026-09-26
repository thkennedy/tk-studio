# Agent PC, studio supervisor, and the vertical-slice studio — planning pass

**Date:** 2026-09-26 · **Status:** ruled 2026-09-26 (four operator rulings, §1); plans only, no code
**Against:** research run `_bmad-output/planning-artifacts/research/agent-studio-next-level-2026-09-26/`
(research.md §4 recommendation, §6–§7 rulings and hub guidance, digests 01–08) ·
ARCHITECTURE-SPINE.md AD-1, AD-2, AD-3, AD-10, AD-11, AD-12, AD-14, AD-15, AD-18, AD-19, AD-20 ·
driver-contract.md 0.1.15 §1–§8 (esp. §7 row 6 "the studio grows no UI") ·
kb/execution-pipeline-model-routing.md (measured cost per story) ·
kb/agent-pc-setup-runbook.md (the provisioning half of this plan)

This is the plan the operator asked for after accepting the research
recommendation: move development of the studio's next level onto a dedicated
Windows 11 agent PC, retire ClaudeOS as the driver, and build toward "describe
a prototype from any device, let the box cook a playable Godot slice." It
states what is ruled, the target shape, the phases with acceptance criteria,
what each phase does to the contract, and what is still open.

---

## 1. Rulings (2026-09-26)

| # | Question | Ruling |
|---|---|---|
| 1 | Hub: keep/clean ClaudeOS, Hermes-centred, or studio-specific? | **Split the three jobs** (research.md §7): extract the driver into a standalone supervisor; Hermes is front door and dispatcher only; ClaudeOS retired as driver and frozen as a loopback personal dashboard. Accepted by the operator. |
| 2 | Engine for the first slice | **Godot** (measured pipeline data at ~$8.6/story on C#/Godot; richest open verify loops; no licensing friction). |
| 3 | Who pays | **Max plan.** The worker (`claude -p`, interactive sessions) runs under the Max login. No API-key Agent SDK path. The Hermes hub bills to the existing Nous Portal subscription. |
| 4 | Where the durable driver lives | **Independent supervisor**, installed and served on the remote Windows 11 PC, reached over HTTP from the main PC, iPad and phone. |

Charter consequence: the supervisor and Hermes are **driver-contract
consumers outside the plugin** (AD-2), so §7 row 6 stays true in substance;
its wording ("ClaudeOS remains the multi-project UI") is patched, not amended
(§4.1).

## 2. Target shape

```
 you: main PC / iPad / phone ──Tailscale──▶ agent PC (Windows 11 Pro, real GPU)
                                            │
   Telegram ─▶ Hermes gateway (Nous Portal) ─┤ intent → job JSON → POST /jobs
   browser  ─▶ Hermes dashboard :9119        │ (look, don't drive)
   browser  ─▶ supervisor status page/API    │
                                            ▼
                              studio supervisor (Bun/TS, console-hosted at logon)
                              durable queue · locks · guards · pacer · HTTP API
                                            │ contract §1/§4: claude -p "/tk-studio:<skill>"
                                            ▼
                     Claude Code (Max login) + tk-studio plugin + BMad base at pin
                     ├─ host tier: auto/acceptEdits, Godot + Blender headless, screenshots
                     └─ sbx tier: Docker Sandboxes microVM, bypass allowed, no GPU
                                            │
                          ~/.tk-studio (store, registry, run workspaces, ledger)
                          GitHub repos (PR-only) · status blocks · proof media
```

Three layers, mostly adopted, effort concentrated on the studio's own gates:

- **A. Agent box = the AD-10 external durable harness.** Provisioned per the
  runbook. Engines and Blender run on the host because no sandbox passes a GPU.
- **B. Studio pack = plugin content.** GDS from the pin for design artifacts;
  engine and Blender bridges adopted (godot-agent-loop, official Blender
  connector or headless bpy); tk-studio builds the `playable-verify` leg, the
  asset-manifest ladder, and the `run-vertical-slice` job type.
- **C. Front door = Hermes over Tailscale**, replaceable by Remote Control +
  Channels + the supervisor's status page because the supervisor's HTTP API is
  the seam.

## 3. Phases

Each phase ends with a status the operator can verify, a contract statement,
and a measurement into the ledger. Order is fixed by dependency; durations are
working estimates for a solo operator, not commitments.

### Phase 0 — Agent PC provisioning (runbook)

- **Deliverable:** the box passes the runbook §7 smoke checklist as the
  standard `agent` user: Claude Code on Max, `tk activate` clean, lib tests +
  conformance green from the clone, Godot and Blender headless, `sbx` tier
  working, Tailscale + RDP scoped, Hermes gateway on Telegram, dashboard on the
  tailnet with basic auth.
- **Contract:** none. **Store:** a new per-machine store and ledger file
  (AD-12, AD-20); no machine paths land in tracked files (AD-15).
- **Acceptance:** smoke table all green; first `job-run` event appears in the
  agent PC's ledger after Phase 1.
- **Estimate:** one evening plus reboots.

### Phase 1 — Studio supervisor extraction

- **Source:** ClaudeOS `connectors/tk-studio/server.ts` (705 lines),
  `client.ts` (96), `conformance.ts` (453), `scripts/studio-jobs-tick.ts`
  (307) — 1,561 lines that already implement §1 headless invoke with auth
  preflight and status-block extraction, §2 `finish`, §4
  `submit/status/resolve/cancel/wake` and knowledge injection, §5 model/effort
  passthrough, §6 drift check, §8 conformance through the driver. They target
  contract 0.1.12 and were never scheduled.
- **New repo** (name open, §6): Bun/TypeScript so the code lifts as-is; a
  Python rewrite to sit beside `lib/` is a later option, not a blocker.
- **Scope to add:**
  1. **Durable queue** (SQLite): `jobs`, `runs`, `events`; survives restarts;
     idempotent `wake`; one engine per checkout lock (bmad-loop already
     requires it).
  2. **Pacer** for self-paced jobs honouring `hint_seconds`, no overlap.
  3. **Guards enforced by the wrapper**: `max_wall_clock_seconds` kills and
     ends `partial`; `max_turns`/`max_tokens` via `account` each iteration.
  4. **Worker invocation under the Max login**: host tier
     `--permission-mode auto` (or `acceptEdits`) with the deny list; `sbx`
     tier for bypass; `--output-format json` cost captured into `finish`;
     resume from the `.jsonl` on crash.
  5. **HTTP API** on the tailnet IP with bearer auth: `POST /jobs`,
     `GET /jobs`, `GET /runs/{id}`, `POST /runs/{id}/cancel`, `GET /status`,
     `GET /events?since=` (SSE or poll).
  6. **Read-only status page** over `~/.tk-studio`: status blocks, run
     workspaces, ledger tail, registry. Small, server-rendered; this is the
     "UI" the charter permits because it lives in a consumer.
  7. **Console-hosted start** at logon (Startup-folder shortcut), transcript
     backup, `robocopy` snapshot of a Godot project before any
     editor-in-the-loop run, ntfy or Telegram notification on `Stop`.
  8. Contract bump **0.1.15 → 0.1.16**: doc patch to §7 row 6 (supervisor
     and Hermes named as consumers), driver roster entry, and a §2 note that
     the executing wrapper may be any conformant driver. Additive, patch-level.
- **Acceptance:** (a) from the phone, `curl -X POST …/jobs` with the existing
  `run-epic` job against `slice-zero` → run appears → `claude -p` executes →
  status block captured → PR opened on GitHub; (b) `runner.py run` passes
  through the new driver (§8); (c) kill the supervisor mid-run, restart, run
  resumes or ends `partial` with the guard named, never silently lost;
  (d) `job-run` event lands in the agent PC's ledger with `total_cost_usd`.
- **Estimate:** one to two weeks of evenings; the lift is small, the queue and
  the resume path are the work.

### Phase 2 — Hermes front door

- **Scope:** fresh install on the agent PC at 0.21.x in the `%LOCALAPPDATA%`
  layout; Telegram gateway with allowlist; dashboard on the tailnet with basic
  auth; learning gated (`skills.write_approval`, `memory.write_approval`,
  `cron_mode: deny`); hub model on Nous Portal, never Claude OAuth.
- **Two Hermes skills, user-authored, reviewed:** `tk-submit` (conversation →
  validated job JSON against `job.schema.json` → `POST /jobs`, echo the run id)
  and `tk-status` (poll `GET /status` and summarise). One cron reporting open
  runs on a schedule you choose. `hermes mcp serve` so a Claude Code session
  can message you back through Hermes.
- **Hard rule:** Hermes never runs `claude -p` for pipeline work; no
  `delegate_task` into repos. Reasons on record: no durable queue, global
  delegation model versus §5 passthrough, no wall-clock guard, dual-dispatch
  races, self-grading learning loop (research digest 08).
- **Acceptance:** from the iPad over Telegram, "start slice zero" produces a
  run in the supervisor and a status reply; the dashboard shows the session
  and cron; nothing was written to skills or memory without approval.
- **Estimate:** two to three evenings.

### Phase 3 — Studio pack: the vertical-slice loop

Plugin content, gated by conformance (AD-19) and `claude plugin eval`.

1. **`playable-verify` pipeline leg.** Routed leg in `customize.toml
   [pipeline.legs]` with its own measured model. Seed: the ClaudeOS
   mission-runner's Godot functional verification (`scripts/mission-runner.ts`
   ~L1127–1212: find the bundled `*_console.exe`, run the project headless,
   capture dotnet/Godot output, fail closed). Extend with: player-camera
   screenshots, a screenshot-only vision rubric (never sees code), deterministic
   multi-seed input scenarios with tick invariants, visual-regression baselines
   via godot-agent-loop. Ends with a status block; conformance drive added.
2. **Engine MCP wiring.** The `game-godot` detect profile recommends
   godot-agent-loop (or gdai) through the AD-18 recommender and writes the
   project `.mcp.json` **only on confirmation**; one engine MCP per run, paired
   with a SKILL.md that pins the Godot version. The catalogue in
   `gds-game-architecture/engine-mcps.yaml` stays upstream-owned (AD-1).
3. **Asset-manifest ladder skill.** Manifest schema (name, category, tri
   budget, bounds, origin rule, collision, license tag); tiers greybox →
   pre-mirrored CC0 (Kenney, Quaternius, Poly Haven) → Meshy/Tripo behind a
   per-run credit cap; headless `blender -b --python` normalisation and glTF
   export; geometry `facts` gate; visual gate (Workbench/Cycles renders);
   placeholder kept until the replacement passes both gates. Headless,
   deterministic, status-blocked (AD-11).
4. **`run-vertical-slice` job type.** Shipped in `plugins/tk-studio/jobs/`:
   GDS quick-flow brief + GDD → epics → launch pipeline with the new leg →
   asset ladder → proof screenshots/video into the run workspace. Guards and
   stop conditions required by the schema; planner tier per the measured
   routing.
5. **Contract 0.1.17+** for the new skill rows and job type; plugin eval cases
   for the three new skills; README and kb updates; observations logged via
   `tk observe` so the evolve loop mints proposals.
- **Acceptance:** one Telegram message → a playable greybox Godot slice with
  placeholder assets, proof media, a status block, and a measured cost in the
  ledger; conformance green over every surface; eval threshold met.
- **Estimate:** the real work; several weeks, one story at a time through the
  studio's own pipeline.

### Phase 4 — ClaudeOS retirement (main PC)

- **Done 2026-09-26:** `ClaudeOS Dream`, `ClaudeOS Mission Watchdog`,
  `ClaudeOS Review Watcher` disabled; supervisor process tree (vite :8081,
  voice-lab :8099) stopped.
- **Left:** disable `ClaudeOS Supervisor` from an elevated shell (S4U
  principal refuses unelevated changes; runbook §9); push the 19 unpushed
  commits and tag `pre-retirement`; `git worktree remove` the stale
  `D:\Code\ClaudeOS-studio-pipeline`.
- **Salvage into the studio:** the driver code (Phase 1); the Godot functional
  verification (Phase 3.1); the `context-tripwire` and `precompact-handoff`
  hooks, compared against `tk-studio-session` before adopting either.
- **Keep, loopback-only, optional:** usage/cost aggregator, memory graph,
  Review Watcher (work-related, unrelated to game dev). The Hermes page is
  redundant once Hermes's own dashboard is on the tailnet.

## 4. Cross-cutting

### 4.1 Contract and architecture

- AD-2 holds: nothing in the plugin imports the supervisor or Hermes; both
  consume the contract. §7 row 6 wording patched in 0.1.16.
- AD-10 holds: jobs remain data with required guards; the supervisor is the
  external durable harness the `durability_constraint` already names.
- AD-11 holds: every headless run ends with the status block; the supervisor
  treats a missing block as a named conformance failure; computer-use is not in
  scope for unattended runs (it ends `blocked`, never asks).
- AD-14/§5: the supervisor forwards model and effort verbatim; Hermes has no
  say in routing.
- AD-19: no new skill or job type is done until `runner.py run` passes; the
  release gate stays lockstep ×3.

### 4.2 Security model (two tiers)

| Tier | Where | Permission mode | Used for |
|---|---|---|---|
| host | `agent` standard user session | `auto` / `acceptEdits` + deny list | Godot runs, Blender headless, screenshots, anything needing the GPU |
| sbx | Docker Sandboxes microVM | bypass allowed | dense scripted code/asset work, dependency installs |

Never bypass on the host. Tailscale only. PR-only merges. Snapshots before
editor runs. Nightly transcript backup.

### 4.3 Cost model

Max plan is one shared bucket (5-hour window + weekly cap) across your chat,
Cowork and every `claude -p` the supervisor runs. Measured baseline: about
$8.6 all-in per reviewed story on C#/Godot; the autonomous systems in the field
produce a greybox slice for $5–8. Budget guards are enforced by the wrapper;
Hermes bills to Nous Portal; Meshy/Tripo credits are capped per run.

### 4.4 Measurement

The agent PC gets its own per-user-per-machine ledger file; `finish` emits
`job-run` events; `tk measure push` moves them through the membrane PR. Every
phase's acceptance run is measured before the next phase starts.

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Windows unattended failures (no-console hang, silent REPL exit, transcript GC) | auto-logon + console-hosted supervisor; resume from `.jsonl`; nightly backup; dense work in `sbx` |
| Mass deletion via junctions or `~` expansion | standard user, deny list, no bypass on host, no junctions in worktrees, `robocopy` snapshots |
| Prompt injection through Telegram/web reaching a shell | Hermes cannot run `claude -p`; supervisor validates job JSON against the schema; egress allowlist later |
| Hermes churn (weekly 460–1,800-PR releases, state.db corruption campaign) | the supervisor API is the seam; Remote Control + Channels is the fallback front door |
| Max-plan bucket exhausted by unattended runs | guards + `--max-budget-usd`; run windows scheduled off your interactive hours |
| Game feel and runtime verification remain weak (GameXpert-Bench) | Phase 3 spends its effort on the verify leg, not on more agents; the human plays the slice |

## 6. Open items (operator's call, not blocking Phase 0–1)

1. Supervisor repo name and whether it lives under `thkennedy/`.
2. Whether Hermes gets its own Telegram bot per box or one bot with per-box
   profiles (Bot Mode).
3. Drive convention on the agent PC (`D:\agent-work` assumed).
4. Whether to keep any ClaudeOS dashboard running on the main PC at all.
5. When to retire the main PC's Hermes install (0.18.0, idle since July).

## 7. Where things live

| Thing | Location |
|---|---|
| This plan | `_bmad-output/planning-artifacts/briefs/planning-pass-agent-pc-and-supervisor-2026-09-26.md` |
| Provisioning runbook | `kb/agent-pc-setup-runbook.md` |
| Research and evidence | `_bmad-output/planning-artifacts/research/agent-studio-next-level-2026-09-26/` |
| Contract to patch | `plugins/tk-studio/contracts/driver-contract.md` §2, §7 row 6 |
| Job schema and shipped job types | `plugins/tk-studio/contracts/job.schema.json`, `plugins/tk-studio/jobs/` |
| Pipeline legs | `plugins/tk-studio/skills/tk-studio-launch/customize.toml`, `lib/pipeline.py` |
| Detect profiles (engine MCP wiring) | `plugins/tk-studio/skills/tk-studio-detect/profiles/game-godot.json` |
| Salvage sources (ClaudeOS, main PC) | `D:\ClaudeOS\connectors\tk-studio\`, `D:\ClaudeOS\scripts\studio-jobs-tick.ts`, `D:\ClaudeOS\scripts\mission-runner.ts` |
