---
name: tk-studio-launch
description: Launch, inspect, or stop the execution substrate (bmad-loop) for one project epic through the studio — distill the epic's SPEC, bootstrap the first story's task manifest at the planner tier, then start the engine detached with a pre-minted run id. Use when the user says "launch epic N", "tk launch", "start the run for this epic", "run status", "stop the run", or a `run-epic` job's invoke-skill directive names this skill.
---

# tk-studio-launch

The studio's only way to start a run (studio pipeline decision 5: driver →
orchestrator → substrate). A conformant driver — the studio supervisor, Hermes
submitting to it, or direct invocation (driver contract §1) — runs a `run-epic`
job; the job wrapper invokes this surface; this surface does the planner-tier preparation and then
hands the epic to bmad-loop through `lib/launch.py`, the one deterministic
core that talks to the substrate (CLI only, never imported — AD-2). Ending
this session never ends the run: the engine is detached and owns the
checkout until it finishes, pauses, or is stopped.

## Payload

- `verb` — `start` (default) | `status` | `stop`
- `directory` — the project root (the nested root for a supervisor epic, never an engine worktree); `lib/launch.py` walks `--directory` up to the nearest folder holding `.tk-studio/config.yaml` (driver contract 0.1.22), so a nested project launches against its own root and store
- `epic` — epic number (`start`; required unless `spec_folder` is given)
- `spec_folder?` — project-relative epic spec folder; default `_bmad-output/specs/spec-epic-<N>`
- `story?` — the first story to bootstrap as `<epic>-<story>` (default: the epic's first story)
- `bootstrap?` — `true` (default) prepares SPEC.md and the first story's tasks when absent; `false` refuses instead
- `allow_budget_mismatch?` — `start`: `true` acknowledges a `budget_mismatch` and launches anyway (passed to the core as `--allow-budget-mismatch`); default `false` refuses it
- `run_id?` — `status`/`stop`: the run to address (default: the live run)
- `graceful?` — `stop` after the current unit instead of immediately

## Behavior (both modes)

### `start`

0. **Resolve the inputs before anything runs** (headless: a gap here ends `blocked`, never a guess):
   - `<root>` = the `project_root` printed by `uv run "${CLAUDE_PLUGIN_ROOT}/lib/config.py" root --directory <directory>` (the payload's `directory` walked up to the nearest folder holding `.tk-studio/config.yaml`, driver contract 0.1.22). Every later `<root>` — in every step here and in `status` / `stop`, which resolve it the same way first — is that resolved root, never the raw `directory`.
   - `<spec_folder>` = the payload's `spec_folder`, else `_bmad-output/specs/spec-epic-<epic>` (the core's `--epic` flag applies the same default); with neither `epic` nor `spec_folder`, end `blocked`: `spec folder unresolvable: neither epic nor spec_folder given`.
   - `<story>` = the payload's `story`, else the first entry under `## Stories` in `<root>/_bmad-output/implementation-artifacts/epic-<epic>-context.md` (`Story N.M: …` → `N-M`), else the first `### Story N.M` heading of the epic's section in `<root>/_bmad-output/planning-artifacts/epics.md`; with none of these, end `blocked`: `first story unresolvable for epic <epic>`.

1. **Route the epic's first story** — the model and effort every leg of the run uses (the session, its implementer / reviewer / consult subagents, the seam check, the review and triage stages, the supervisor pass), resolved runtime > the project's `.bmad-loop/routing.toml` > the shipped measured defaults in this skill's `customize.toml` `[pipeline]` (AD-14; `kb/execution-pipeline-model-routing.md` carries the numbers). Run:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/pipeline.py" apply --directory <root> --story <epic>-<story>
   ```

   It writes exactly the managed block in `.bmad-loop/policy.toml`, the subagent-model line in the tracked Claude profile when the project has one, and `.bmad-loop/routing.current.json`; nothing else. Read `writes` and `unignored[]`. A non-empty `unignored[]` names a file this write would leave dirty in the tree — the engine's preflight refuses a dirty tree — so end `blocked` naming it (`routing write not gitignored: <path>`); never add the ignore line yourself in a headless run, and never launch around it. A refusal (`ok: false` — the policy is missing, the project's routing table is invalid) ends `blocked` with its `error` verbatim: the route is never invented. Report the route's session / implementer / reviewers / consult models in the launch report.

2. **Readiness first, and never guess around a gap.** Run:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/launch.py" check --directory <root> --spec <spec_folder>
   ```

   Read `gaps[]`. Gaps you may close in this session (only when `bootstrap` is true): a missing `SPEC.md` (step 3) and an empty or missing task manifest (step 4). Every other gap — a live engine already on the checkout, `bmad-loop` not installed, a failing `bmad-loop validate` (a dirty tree, a broken policy) — ends the run `blocked` with the gap verbatim in `reason`. Never stop another run to make room; never clean a tree.

   Read `budget` too: the core compares the engine's `.bmad-loop/policy.toml` limits with `.tk-studio/budget-bands.yaml` and names each limit the bands exceed in `budget.budget_mismatch[]` (`{limit, policy, band, band_field, band_value}`). A mismatch is not a gap — `check` ends `partial` naming it — but step 6's `start` refuses it unless the payload carries `allow_budget_mismatch: true`. Report it with both numbers; never edit its `[limits]` to clear it (the limit is the operator's machine-local setting; step 1's managed routing block is the only launch write to that file).

   The advisory rows never become a gap: `studio-pipeline plugin` (present or absent) and, after it, `engine sandbox` (Story 33.3). That row reads the supervisor config's engine sandboxes (`TK_SUPERVISOR_CONFIG` `jobs.*.sandbox`), runs `sbx daemon status` and then `sbx ls`, and nothing else. A sandbox listed as running with no supervisor pin record (`<store>/sandboxes/<sandbox>.pin`) reads `warning: <sandbox> started outside the supervisor; the next pin restarts it` — report it; never stop or start the sandbox yourself. Otherwise it reads `pinned by the supervisor`, `not running`, `no engine sandbox configured`, `sbx absent` or `daemon down`.

   **Relaunch.** When `SPEC.md` and the manifest already exist (the epic launched before: stories already `done`, the route already applied), steps 3 and 4 write nothing and step 5 makes no commit; go straight to step 6. A relaunch ends exactly as a fresh launch does — on the core's block (see Status block).

3. **Epic SPEC (when missing).** Invoke the project's own `bmad-spec` skill by name, headless, on the epic: input = the epic's section of `_bmad-output/planning-artifacts/epics.md` plus `_bmad-output/implementation-artifacts/epic-<N>-context.md` when present; slug `epic-<N>`, so it lands at `<spec_folder>/SPEC.md`. Express mode: gaps become `open_questions[]`, never invented answers. The stock skill is invoked untouched (AD-4); if it is not installed in the project, end `blocked` naming it.

4. **First story's tasks (when the manifest is empty).** The task-planning instructions are a **project resource**: `<root>/.bmad-loop/plugins/studio-pipeline/task-planning.md` (the studio pipeline's gate plugin). Read it and follow it as "bootstrap story `<epic>-<story>`" — it appends the story's tasks to `<spec_folder>/stories.yaml` and writes `<spec_folder>/plans/<epic>-<story>.md`, then validates with `bmad-loop validate`. This is planner-tier work and the reason this surface's model default is the top tier. If the file is absent, end `blocked` naming it: this surface never invents a task breakdown of its own.

5. **Commit the bootstrap output** — the one rule for the launch's own writes, so the dirty-tree refusal never fires on them. When steps 3–4 wrote files, commit exactly those files (`<spec_folder>/SPEC.md`, `<spec_folder>/.memlog.md`, `<spec_folder>/stories.yaml`, `<spec_folder>/plans/<epic>-<story>.md`, and any canonical plan files the transcription wrote) on the checkout's current branch at launch — that branch is the run branch (`loop/epic-<N>` by convention; a supervisor worktree may name it otherwise, and this surface never checks the name or switches branches) — in one commit with exactly this message:

   ```text
   loop(epic-<N>): SPEC, manifest and first-story plan from the launch bootstrap
   ```

   Name those paths, only the ones that exist, in both commands — `git add -- <paths>` then `git commit -m '<message>' -- <paths>` (a pathspec commit records only those paths, whatever else is staged) — never `git add -A`, never anything else. If `git add` or `git commit` fails, end `blocked` with the git error verbatim in `reason`. When nothing was written (a relaunch), make no commit. Never push. This happens after step 4 and before step 6's `check`.

6. **Launch.** Re-run `check`; when it answers `ok`, start the engine (add `--allow-budget-mismatch` only when the payload carries `allow_budget_mismatch: true`):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/launch.py" start --directory <root> --spec <spec_folder> [--allow-budget-mismatch]
   ```

   A `budget_mismatch` without the acknowledgement is a refusal (exit 2, `blocked`, both numbers in `reason`, the `budget` object carried in the refusal): report it and do not launch. The core mints the run id, spawns `bmad-loop run --spec … --run-id …` detached and console-less with its output in `~/.tk-studio/projects/<key>/launches/<run-id>.log`, and answers `ok` only once the engine has written `.bmad-loop/runs/<run-id>/state.json`. A launch it could not confirm answers `ok: false` with the pid and log named — report that as `blocked` with the reason; do not launch again.

7. **Report.** Attended and headless alike: the run id, the spec folder, the first story planned (none on a relaunch), the route (session / implementer / reviewers / consult models and where each came from), any `budget_mismatch` with both numbers, and how to watch it — the studio supervisor's status page, `launch.py status` (this surface's `status` verb), and `bmad-loop tui`. Then end with the status block (below).

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

Every path — `start` fresh or relaunch, `status`, `stop`, attended or headless — ends with the block (§3 of the driver contract) as its final line of output. The core ends every result, refusals included, with the block's keys in order (`status`, `intent`, `artifacts`, `reason`), so the rule is one: print the last core result's block as the final line, adding to `artifacts` only the SPEC/plan files this session wrote (never `run_dir_abs` or the store `log` path — §3 forbids absolute local paths). A `start` that launched ends:

```json
{"status": "complete", "intent": "tk-studio-launch", "artifacts": [".bmad-loop/runs/20260903-101500-ab12", "_bmad-output/specs/spec-epic-2"], "reason": null}
```

`blocked` names the gap verbatim: the readiness check's `gaps[]`, an unacknowledged `budget_mismatch`, the missing project resource, an unconfirmed launch. A path that ends before any core call (an unresolvable input, an unignored routing write, a missing `bmad-spec`) prints the same block shape itself, `blocked` with the gap. `partial` is the core's `check` naming a `budget_mismatch`.

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- One engine per checkout: the core refuses a launch while any run owns the checkout; this skill never stops one to make room.
- The core never writes into the project tree: run state is the engine's, launch logs live in the per-user store (AD-3).
- SPEC.md comes from `bmad-spec`, the task manifest from the project's task-planning instructions — this surface authors neither.
- The route comes from `lib/pipeline.py` — the shipped legs are measured defaults (AD-14 resource tier); a project overrides them in `.bmad-loop/routing.toml`, a driver per invocation with `--set leg.field=value`. Escalation is deliberate: this surface never routes a leg onto a larger model than the resolved value, and never launches a subagent on the planner tier.
- Job-level events belong to the job wrapper (`job-run`); this surface emits none of its own (AD-12).
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
