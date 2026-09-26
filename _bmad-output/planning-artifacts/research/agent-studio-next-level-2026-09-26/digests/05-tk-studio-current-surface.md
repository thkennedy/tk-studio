# Digest 05 — tk-studio's current surface for unattended runs, game dev, and constraining decisions (local map, 2026-09-26)

Source: repo at `D:\Code\tk-studio` (Explore pass). This digest is the one non-web input; it maps constraints, not truth about the outside world.

## 1. Unattended / headless execution today

- **Job = data** (AD-10). `lib/job.py` validates against `plugins/tk-studio/contracts/job.schema.json` (v1): `id`, target (`skill`+payload or deterministic `core` argv), trigger `one-shot|cron|loop`, cadence `fixed|self-paced`, **required** budget guards (`max_tokens|max_turns|max_wall_clock_seconds`) and stop conditions (`max_runs|until|on_status`), optional `durable|model|effort`.
- Shipped job types in `plugins/tk-studio/jobs/`: `maintenance-conformance`, `research-ecosystem`, `evolve-proposals`, `run-epic` (one-shot → `tk-studio-launch`). Project instances: `.tk-studio/jobs/<id>.json`, listed in `.tk-studio/config.yaml jobs[]`.
- **No clock of its own.** `lib/jobrun.py submit|status|resolve|cancel|wake|account|finish` returns a directive (`immediate|at|cron|loop|self-paced|invoke-skill|unbind`); the skill binds it to "the harness's scheduled-task primitive". No specific primitive (CronCreate, scheduled-tasks MCP, schtasks) is named anywhere. `durable: true` returns a `durability_constraint`: bind to a cloud routine or external harness, or re-submit each session. The de facto durable driver is ClaudeOS's `studio-jobs-tick` (PROP-008, EP-015), outside this repo.
- Guards: wall-clock enforced on core targets; turns/tokens rely on the executing agent calling `account`. Guard hit → run ends `partial`.
- **Run workspaces:** `~/.tk-studio/projects/<key>/runs/<run-id>/` with `run.json`, `summary.json`, `output.json`, `handoff.json`, `seed.md`; launch logs in `.../launches/<run-id>.log`; bmad-loop state in `<project>/.bmad-loop/runs/<run-id>/state.json`; `TK_STUDIO_HOME` redirects.
- **Status:** every headless run ends with the status block (`contracts/status-block.schema.json`); `finish` emits a `job-run` event into `~/.tk-studio/measurements/<user>-<machine>.jsonl`; `launch.py status` reports phase/attempt/cycle/pause/tokens. **There is no UI.**
- **Session:** `lib/session.py handoff|resume` — `handoff.json` (16 KB, ≤16 deltas) at a boundary; resume from `run.json` + `handoff.json` only.
- **Launch pipeline** (contract 0.1.14–0.1.15): `pipeline.py apply` routes legs `session, implementer, reviewers, consult, seam, review, triage, supervise, planner` (precedence `--set` > `.bmad-loop/routing.toml` > shipped `customize.toml [pipeline.legs]`); `launch.py check`; `bmad-spec` → SPEC.md; tasks from `.bmad-loop/plugins/studio-pipeline/task-planning.md`; `bmad-loop run` detached with a pre-minted run id; one engine per checkout. bmad-loop pinned v0.9.1. Measured cost ≈ $8.6 per story on a C#/Godot project (`kb/execution-pipeline-model-routing.md`). Launch/pipeline have no EP/ST entries (came from a ClaudeOS-side "studio pipeline decision 5", 2026-09-02).

## 2. Game-dev capability (GDS, from the pin, not vendored)

- `gds v0.6.0` in `bmad.lock`; `_bmad/gds/config.yaml primary_platform: unity, unreal, godot, other`; 33 `gds-*` skills (`_bmad/gds/module-help.csv`).
- Agents: game-architect, game-designer, game-dev (dev+QA+SM), game-solo-dev, tech-writer.
- Workflows span pre-production (brainstorm, domain-research, game-brief), design (gdd, narrative, ux, prd), technical (game-architecture, project-context, epics+stories, readiness, test-framework/design), production (sprint, story, dev-story, code-review, retro, investigate, quick-dev, correct-course), game test (test-automate, e2e-scaffold, playtest-plan, performance-test, test-review).
- Engine knowledge: Godot, Unity, Unreal, Phaser, Roblox (`gds-game-architecture/knowledge/`); test knowledge for Unity/Unreal/Godot.
- **Engine MCP is a recommendation catalogue only**: `.claude/skills/gds-game-architecture/engine-mcps.yaml` (Unity ×3, Unreal ×2, Godot ×5 with GoPeak default, Roblox official, Context7). Nothing installed or wired.
- **Zero Blender, zero 3D/asset pipeline.** Only asset workflow is WDS UI assets (`wds-6-asset-generation`).
- Studio detect profiles: `tk-studio-detect/profiles/game-{godot,unity,unreal}.json` → suggest `gds` + `tea`.

## 3. Constraining decisions (ARCHITECTURE-SPINE.md AD-1..20; NFR1-10 in epics.md:79-88)

| AD | Gloss | Bites on |
|---|---|---|
| AD-1 | Plugin via git marketplace; BMad pinned, **never forked** (also NFR1) | GDS changes only via `_bmad/custom` overrides or upstream |
| AD-2 | Studio never imports ClaudeOS; integration only through the driver contract | web UI / remote host = contract consumer |
| AD-3 | Every write classified (per-user store, kb/, repo, planning backend, credentials) | screenshots/remote state = working data; creds never tracked |
| AD-4 | Planning access only through the adapter; stock skills untouched | MCP ban is planning-MCP only |
| AD-9 | Stateless orchestrator; shell only attended | UI may not hold routing state |
| AD-10 | Jobs are data; guards required; durable needs cloud/external harness | remote runner = substrate binding |
| AD-11 | Attended/headless parity; status block; no prompts; auth preflight | computer-use must end `blocked`, never ask |
| AD-12 | Per-user-per-machine JSONL ledger; PR membrane | remote machine gets its own ledger |
| AD-14 | `customize.toml` model defaults | all new resources |
| AD-15 | Three config scopes; no machine paths tracked | remote paths |
| AD-17 | Role before routing; recommendations evidence-backed + confirmed | MCP suggestions are recommendations |
| AD-18 | Recommender suggests tooling, "chiefly MCP servers" | engine/Blender MCP fits here |
| AD-19 | Conformance ships; not done until it passes | all |
| AD-20 | Registry single-writer, absolute root per machine | one store per machine |

**Explicit no-UI rule:** driver contract §7 row 6 "the studio grows no UI"; `epics.md:102` "no UI of its own; dashboards stay ClaudeOS"; brief `addendum.md:149` "ClaudeOS remains the multi-project UI". A web front end conflicts with the charter unless it lives outside the plugin as a contract consumer, or the charter is amended.

## 4. Contract, tests, gate

- Contract **0.1.15** (`plugins/tk-studio/contracts/driver-contract.md`), pre-1.0 semver: additive = patch, breaking = 0.2.0; new skill needs a §2 row.
- Lib tests: 691 across 38 files (`cd plugins/tk-studio/lib && uv run python -m unittest discover tests`).
- Conformance: `contracts/conformance/runner.py run [--harness]`; manifest 18 surfaces / 44 drives; checks registered, status-block, unrunnable-core paragraph, auth-preflight, headless drives; discovers from `skills/` so an unregistered skill fails.
- Lockstep gate: `plugin.json`, `marketplace.json`, `released-roster.json` all 0.2.12; guard `lib/tests/test_release_roster.py` via `drift_check.py`; archive via `tools/release_archive.py`; motion in `kb/offline-install-runbook.md`.
- **README header table is stale** (says plugin 0.2.8 / contract 0.1.13).

## 5. Prior mentions in ledgers/plans

- Web UI: none except the no-UI statements above and review finding #11 (`reviews/review-reconcile-inputs.md:113`).
- Remote machine / agent PC / Blender / computer use: **zero hits**.
- Unity/Godot/Unreal: `briefs/upstream-issue-draft-bmad-method-2026-08-08.md` (primary_platform bug, ISS-001); `kb/execution-pipeline-model-routing.md:47`.
- MCP: PROP-006 (Declined; ClaudeOS MCP connector conformance → ISS-002); PROP-013 (Declined; MCP 2026-07-28 spec no headless auth); ST-032/FR15/task-32 Jira via Atlassian MCP.
- Vertical slice: only upstream GDS guidance (`gds-gdd/references/facilitation-guide.md:79`).
- PROP-009 (Adopted): Claude CLI ≥ 2.1.223 for automation. DW-2: connector tests live-integration only.
