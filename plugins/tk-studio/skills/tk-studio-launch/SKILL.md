---
name: tk-studio-launch
description: Launch, inspect, or stop the execution substrate (bmad-loop) for one project epic through the studio — distill the epic's SPEC, bootstrap the first story's task manifest at the planner tier, then start the engine detached with a pre-minted run id. Use when the user says "launch epic N", "tk launch", "start the run for this epic", "run status", "stop the run", or a `run-epic` job's invoke-skill directive names this skill.
---

# tk-studio-launch

The studio's only way to start a run (studio pipeline decision 5: ClaudeOS →
orchestrator → substrate). ClaudeOS submits a `run-epic` job; the job wrapper
invokes this surface; this surface does the planner-tier preparation and then
hands the epic to bmad-loop through `lib/launch.py`, the one deterministic
core that talks to the substrate (CLI only, never imported — AD-2). Ending
this session never ends the run: the engine is detached and owns the
checkout until it finishes, pauses, or is stopped.

## Payload

- `verb` — `start` (default) | `status` | `stop`
- `directory` — the project root (the main checkout, never an engine worktree)
- `epic` — epic number (`start`; required unless `spec_folder` is given)
- `spec_folder?` — project-relative epic spec folder; default `_bmad-output/specs/spec-epic-<N>`
- `story?` — the first story to bootstrap as `<epic>-<story>` (default: the epic's first story)
- `bootstrap?` — `true` (default) prepares SPEC.md and the first story's tasks when absent; `false` refuses instead
- `run_id?` — `status`/`stop`: the run to address (default: the live run)
- `graceful?` — `stop` after the current unit instead of immediately

## Behavior (both modes)

### `start`

0. **Resolve the inputs before anything runs** (headless: a gap here ends `blocked`, never a guess):
   - `<spec_folder>` = the payload's `spec_folder`, else `_bmad-output/specs/spec-epic-<epic>` (the core's `--epic` flag applies the same default); with neither `epic` nor `spec_folder`, end `blocked`: `spec folder unresolvable: neither epic nor spec_folder given`.
   - `<story>` = the payload's `story`, else the first entry under `## Stories` in `<root>/_bmad-output/implementation-artifacts/epic-<epic>-context.md` (`Story N.M: …` → `N-M`), else the first `### Story N.M` heading of the epic's section in `<root>/_bmad-output/planning-artifacts/epics.md`; with none of these, end `blocked`: `first story unresolvable for epic <epic>`.

1. **Readiness first, and never guess around a gap.** Run:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/launch.py" check --directory <root> --spec <spec_folder>
   ```

   Read `gaps[]`. Gaps you may close in this session (only when `bootstrap` is true): a missing `SPEC.md` (step 2) and an empty or missing task manifest (step 3). Every other gap — a live engine already on the checkout, `bmad-loop` not installed, a failing `bmad-loop validate` (a dirty tree, a broken policy) — ends the run `blocked` with the gap verbatim in `reason`. Never stop another run to make room; never clean a tree.

2. **Epic SPEC (when missing).** Invoke the project's own `bmad-spec` skill by name, headless, on the epic: input = the epic's section of `_bmad-output/planning-artifacts/epics.md` plus `_bmad-output/implementation-artifacts/epic-<N>-context.md` when present; slug `epic-<N>`, so it lands at `<spec_folder>/SPEC.md`. Express mode: gaps become `open_questions[]`, never invented answers. The stock skill is invoked untouched (AD-4); if it is not installed in the project, end `blocked` naming it.

3. **First story's tasks (when the manifest is empty).** The task-planning instructions are a **project resource**: `<root>/.bmad-loop/plugins/studio-pipeline/task-planning.md` (the studio pipeline's gate plugin). Read it and follow it as "bootstrap story `<epic>-<story>`" — it appends the story's tasks to `<spec_folder>/stories.yaml` and writes `<spec_folder>/plans/<epic>-<story>.md`, then validates with `bmad-loop validate`. This is planner-tier work and the reason this surface's model default is the top tier. If the file is absent, end `blocked` naming it: this surface never invents a task breakdown of its own.

4. **Launch.** Re-run `check`; when it answers `ok`, start the engine:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/launch.py" start --directory <root> --spec <spec_folder>
   ```

   The core mints the run id, spawns `bmad-loop run --spec … --run-id …` detached and console-less with its output in `~/.tk-studio/projects/<key>/launches/<run-id>.log`, and answers `ok` only once the engine has written `.bmad-loop/runs/<run-id>/state.json`. A launch it could not confirm answers `ok: false` with the pid and log named — report that as `blocked` with the reason; do not launch again.

5. **Report.** Attended: the run id, the spec folder, the first story planned, and how to watch it (`bmad-loop tui`, the ClaudeOS Queue). Headless: end with the status block — `artifacts[]` names the run dir (the core's project-relative `run_dir`, never `run_dir_abs` or the store `log` path — §3 forbids absolute local paths in artifacts), the spec folder, and any SPEC/plan files this session wrote.

### `status`

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/lib/launch.py" status --directory <root> [--run-id <id>]
```

Relay the live runs and the named run's phase/attempt/cycle per task, its pause (stage, reason, story) when paused, and its token totals. Read-only.

### `stop`

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/lib/launch.py" stop --directory <root> --run-id <id> [--graceful]
```

Attended: confirm before an immediate stop (work in the current unit is preserved by the engine's attempt-preserve refs, but the unit is interrupted). Headless: stop as instructed; never ask.

### Status block

Every headless run ends with the block (§3 of the driver contract):

```json
{"status": "complete", "intent": "tk-studio-launch", "artifacts": [".bmad-loop/runs/20260903-101500-ab12", "_bmad-output/specs/spec-epic-2"], "reason": null}
```

`blocked` names the gap verbatim: the readiness check's `gaps[]`, the missing project resource, an unconfirmed launch. Nothing here ends `partial`.

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- One engine per checkout: the core refuses a launch while any run owns the checkout; this skill never stops one to make room.
- The core never writes into the project tree: run state is the engine's, launch logs live in the per-user store (AD-3).
- SPEC.md comes from `bmad-spec`, the task manifest from the project's task-planning instructions — this surface authors neither.
- Job-level events belong to the job wrapper (`job-run`); this surface emits none of its own (AD-12).
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
