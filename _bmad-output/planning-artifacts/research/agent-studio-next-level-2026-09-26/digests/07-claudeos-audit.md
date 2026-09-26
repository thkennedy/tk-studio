# Digest 07 — ClaudeOS audit (`D:\ClaudeOS`, worktree `D:\Code\ClaudeOS-studio-pipeline`, runtime `~/.claude-os`), 2026-09-26

Read-only; two pure test files run (44 pass). Full suite not run (creates temp git repos).

## What it is

Fork of Jack Roberts' "Claude OS" (read-only AI-stack console) grown into a local control plane with seven parts: usage/cost/ROI dashboard, daily **Dream** review, **Hermes agent page** (personas, chat, voice), **Mission runner** (autonomous `claude -p` story executor), PR review drafting, bmad-loop run visibility, and the **tk-studio MCP connector**. Stack: Bun + TypeScript, TanStack Start/Router, React 19, Vite 7, Tailwind/shadcn, three.js. The whole backend is Vite dev-server middleware in `vite.config.ts` (**11,474 lines, ~50 `/__*` endpoints**).

Entry points: `bun run dev` (:8081), `scripts/aggregate.ts`, `scripts/run-dream.ts`, `scripts/mission-runner.ts`, `scripts/review-watcher.ts`, `scripts/supervisor.ts`, `scripts/studio-jobs-tick.ts`, `connectors/tk-studio/server.ts` (stdio MCP), `voice-lab/server.ts` (:8099).

Windows scheduled tasks (live): **Supervisor** (boot/logon; keeps vite + voice-lab alive), **Dream** (daily 07:00, **failing 12 days**, last good 2026-09-14, `JSON Parse error`), **Mission Watchdog** (hourly, "nothing to do"), **Review Watcher** (15 min).

## Size and shape

- 2,646 tracked files (1,946 are vendored `.claude/` skills, 117 `_bmad/`). First-party code ~131k lines across 266 files: `src` ~52.6k, `scripts` ~34.5k, tests ~29.7k, `vite.config.ts` 11.5k. 15 routes, 77 components (46 shadcn), 65 non-test scripts.
- Dead code (grep-by-basename method): orphaned scripts `batch-generate.ts`, `gen-cadence-images.ts`, `gen-dream-images.ts`, duplicate `dream-audit.{py,ts}`; orphaned components `agent-core-3d`, `memory-constellation`, `memory-graph-mini`, `stat-card`, `theme-toggle`; 37 of 46 shadcn `ui/*` unused; hooks `session-handoff-inject.ts`, `session-budget-stop.ts` referenced only by tests/docs. **~5–8% of first-party modules orphaned.**

## Health signals

- Git: 343 commits, 2026-06-26 → **2026-09-02** (nothing in 24 days); 86 commits/30d, 288/90d; two identities both Tim; local `main` **19 commits ahead of origin, unpushed**; 3 live extra worktrees, ~13 stale branches.
- Tests: `bun run check` chains typecheck, `check:contract`, `check:bmad-config`, `bun test`, `check:endpoints`; Playwright e2e; live connector tests quarantined. Last recorded full run 1,177 pass / 2 skip / 0 fail on 2026-09-01.
- Markers: TODO/FIXME/HACK only 6; "legacy" 198× across 29 files (`mission-runner` is the legacy runner; Epic 4 plans its deletion); 17 `.bak` in `_bmad/`. **29 files >1,000 lines** (vite.config 11.5k, `routes/agents.hermes.tsx` 8.6k, `routes/index.tsx` 5.2k, `aggregate.ts` 5.1k, `hermes-mission-control.tsx` 4.4k, `mission-runner.ts` 3.4k).
- **Parallel implementations:** 4 runners (mission-runner, bmad-loop, tk-studio launch/jobrun, plus ad-hoc `claude -p` spawners in review-watcher / run-fix-exec / run-dream); 2 project registries (`~/.claude-os/projects.json` vs `~/.tk-studio/registry/projects.yaml`); 2 knowledge lifecycles (ClaudeOS spine/seed/delta + reconciliation queue vs tk-studio knowledge/session/reconcile ported at 0.1.7); 2 handoffs; 2 model-routing systems (`.bmad-loop/profiles/claude.toml` vs `pipeline.py apply`); 4 config formats (JSON/YAML/TOML/.env); 2 epics files and 2 architecture spines.
- Stale docs: README macOS-first; `INTEGRATION.md` old merge notes; `connectors/tk-studio/DESIGN.md` consumes **0.1.12** while the studio publishes 0.1.15; vite comment cites a deleted `scripts/server.ts`; `WINDOWS-SETUP.md` from 07-05.
- Runtime: missions 63 goals all merged, last activity 86 days ago; Hermes last active 91 days ago.

## Coupling to tk-studio (all via the published contract; no internals imported)

| Point | File | Contract |
|---|---|---|
| Registry read | `connectors/tk-studio/server.ts` `tk_projects` | `registry.schema.json` |
| Contract gate | `tk_contract` | reads driver-contract version; consumes 0.1.12 |
| Drift check | `tk_drift_check` | §6 |
| Jobs | `tk_job` | §4 submit/status/resolve/cancel/wake, §2 finish via `jobrun.py` |
| Headless invoke | `tk_invoke` | §1 `claude -p "/tk-studio:<skill>"` bypassPermissions, §3 status block, §1 auth preflight, §5 model/effort |
| KB injection | `server.ts` + `studio-jobs-tick.ts knowledgeOf` | §4 `directive.knowledge` |
| Self-paced pacer | `scripts/studio-jobs-tick.ts` | resolve → status (`hint_seconds`) → wake → tk_invoke → finish |
| Conformance | `connectors/tk-studio/conformance.ts` | §8 manifest, `TK_STUDIO_HOME` sandbox |
| Job instance | `.tk-studio/jobs/run-epic-2.json` | `run-epic` (0.1.14) |
| bmad-loop gate | `.bmad-loop/plugins/studio-pipeline/*` | advisory; tk-studio does not ship it |

**Two gaps:** (1) **the studio tick is not actually scheduled** — `mission-watchdog-run.cmd` (Jun 28) runs only `mission-runner`; the newer installer would add the tick but was never re-run; `~/.tk-studio/projects/` holds one run total (2026-08-08); `run-epic-2` never submitted. (2) **No dashboard reads `~/.tk-studio`** (status blocks, run workspaces, measurements, registry); planned for Epic 2; the watchdog UI reads bmad-loop `state.json` instead.

`D:\Code\ClaudeOS-studio-pipeline` is a **stale git worktree** of ClaudeOS (branch `studio-pipeline`, 8 commits from 2026-09-02, all merged into main, 4 behind). It housed the pipeline design doc (`agentic-pipeline-2026-09-02.md`) and project-side bmad-loop plugin/profiles/budget bands. It is **not** an extraction of tk-studio's `lib/pipeline.py`, which was written studio-side (2026-09-15).

## Coupling to Claude Code and other agents

- `claude -p` spawned by run-dream, run-fix-exec (`acceptEdits`), mission-runner, review-watcher (`--dangerously-skip-permissions` + deny-list), tk-studio connector (`bypassPermissions`). **Agent SDK: none.**
- Parses `~/.claude/projects/**/*.jsonl` (99 projects, ~73k messages) in aggregate/mission-project-join/review-watcher/setup/vite; reads `~/.claude/skills`, settings, tasks; installs `/dream` into `~/.claude/skills`.
- Hooks: bmad-loop relay on SessionStart/Stop/SessionEnd/PreCompact; mission-runner injects `context-tripwire` + `precompact-handoff` via `--settings`.
- **Hermes deeply embedded: 85 files, ~2.7k references** — 17 `/__hermes_*` endpoints, `hermes` CLI spawn (`hermes-chat-exec.ts`), Dream engine option, missions authored as Hermes `/goal` runs, voice brain. Codex: usage + `codex exec` Dream engine. OpenClaw/Gemini/Antigravity detection only. Ollama Dream engine.

## UI

TanStack Start SSR on Vite dev; binds **127.0.0.1:8081** (+ voice :8099); `isLoopback()` + Host allow-list; mutations need `x-claude-os-token`. **Not reachable from another device.** Routes: `/` KPIs/usage/Dream, `/setup`, `/memory` (3D graph), `/codegraph`, `/skills`, `/activity`, `/settings`, `/share`, `/workspaces/*`, `/projects/$id` (watchdog, bmad-loop runs, missions, reviews), `/agents/hermes` (personas, chat, Mission Control, voice), `/agents/claude-code`, `/agents/openclaw`.

## Replaceability

**Minimum a replacement driver must provide (contract terms):**
1. §1 headless invocation of `/tk-studio:<skill>` in a no-prompt mode, with harness + Jira auth preflight; missing §3 status block = named conformance failure.
2. §4 scheduler substrate: `resolve`; a recurring host pacing self-paced jobs (no overlap, `hint_seconds`) calling `wake`; act as §2 executing wrapper (`tk_invoke` with `run_id` + `max_wall_clock_seconds`, then `finish`; timeout → `partial`); bind cron/fixed at `submit`; expose `status`/`cancel`.
3. §4 KB injection from `directive.knowledge`. 4. §5 forward model/effort verbatim; §6 drift check at start; §8 pass conformance through the driver. 5. Registry + contract-version resolution (`TK_STUDIO_ROOT` or unique registry entry). 6. Ship/copy the `studio-pipeline` bmad-loop plugin into projects.

**Most of this already exists in ~1.2k lines** (`connectors/tk-studio/{server,client}.ts`, `scripts/studio-jobs-tick.ts`), liftable largely as-is, and it is not scheduled today anyway.

**No tk-studio equivalent (would be lost if ClaudeOS retired):** Dream daily audit (broken); usage/cost/ROI aggregator; memory graph + graphify ingest; Hermes pantheon/chat/voice; Review Watcher (GitHub/Perforce/Jira, work-related); mission-runner extras (Godot functional verification for The Peeps, fail-closed merge gate, epic-boundary review); model-intel refresh; context-cycling hooks; supervisor; per-project dashboard. No non-dev personal automations exist.
