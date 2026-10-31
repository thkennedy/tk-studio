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

- `verb` — `start` (default) | `status` | `stop` | `sweep` (Story 35.7, the `run-sweep` job type)
- `directory` — the project root (the nested root for a supervisor epic, never an engine worktree); `lib/launch.py` walks `--directory` up to the nearest folder holding `.tk-studio/config.yaml` (driver contract 0.1.22), so a nested project launches against its own root and store
- `epic` — epic number (`start`; required unless `spec_folder` is given)
- `spec_folder?` — project-relative epic spec folder; default `_bmad-output/specs/spec-epic-<N>`
- `story?` — the first story to bootstrap as `<epic>-<story>` (default: the epic's first story)
- `bootstrap?` — `true` (default) prepares SPEC.md, the epic's manifest and a plan for every story in it (list order) when absent; `false` refuses instead
- `allow_budget_mismatch?` — `start`: `true` acknowledges a `budget_mismatch` and launches anyway (passed to the core as `--allow-budget-mismatch`); default `false` refuses it
- `max_bundles?` — `sweep`: an integer ≥ 1 bounding the sweep's bundles (passed as `--max-bundles`; default: the policy's `[sweep] max_bundles`)
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

   Read `gaps[]`. Gaps you may close in this session (only when `bootstrap` is true): a missing `SPEC.md` (step 3) and an empty or missing task manifest (step 4). Story 35.2: the gap `open questions` refuses the story the launch would start (the first manifest entry with no `stories/<id>-*.md` at `status: done`) — one of its CAPs has a `- CAP-N:` line under SPEC.md `## Open Questions` and no design note names that CAP or the story; its detail is `<story id>: CAP-N has no design note — <question>` (`; ` between CAPs). This session never answers it (the planner's task planning notes it or escalates): end `blocked` with the gap verbatim, every CAP named, before any dev session. A later story's un-noted CAP is never a gap. Every other gap — a live engine already on the checkout, `bmad-loop` not installed, a failing `bmad-loop validate` (a dirty tree, a broken policy) — ends the run `blocked` with the gap verbatim in `reason`. Never stop another run to make room; never clean a tree.

   Read `budget` too: the core compares the engine's `.bmad-loop/policy.toml` limits with `.tk-studio/budget-bands.yaml` and names each limit the bands exceed in `budget.budget_mismatch[]` (`{limit, policy, band, band_field, band_value}`). A mismatch is not a gap — `check` ends `partial` naming it — but step 6's `start` refuses it unless the payload carries `allow_budget_mismatch: true`. Report it with both numbers; never edit its `[limits]` to clear it (the limit is the operator's machine-local setting; step 1's managed routing block and `check`'s `[verify] commands` reconciliation are the only launch writes to that file).

   Read `verify_commands` too (Story 33.5): `check` reconciles the policy's `[verify] commands` from the tracked list (`.tk-studio/config.yaml` `engine.verify_commands`, else `plugins/tk-studio/pipeline/verify-commands.toml`) and reports it there and in the `verify commands` row: `verify_commands.policy` is `written`, `unchanged`, `skipped (…)` or `refused`, and the row's detail reads `added <n> from <source>; kept <m> operator commands`, `unchanged (…)`, `skipped (…)` or `refused: … — fix it by hand`; a refusal is a gap the session never closes by hand — end `blocked` with it verbatim.

   Story 36.6: a tracked or unignored `.bmad-loop/policy.toml` with commands to add is refused (nothing written, `verify_commands.policy: "refused"`, a gap naming the file: add them by hand), and the row's engine-gate clause over a non-empty `engine.verify_commands` names each running engine sandbox: `sandbox <sb>: provisioned WITH_GODOT <ver>`, or `warning: sandbox <sb> has no WITH_GODOT record; an engine.verify_commands gate there refuses`, advisory. The advisory `run rhythm` row names the `run-epic` instance's `stop.after_stories` (the supervisor arms the graceful stop from it and marks each story In Progress; never issue that stop by hand, except the command a refused arming's notifier line gives), or says the run goes to the epic's end when none is declared.

   The advisory rows never become a gap: `studio-pipeline plugin` (present or absent) and, after it, `engine sandbox` (Story 33.3). That row reads the supervisor config's engine sandboxes (`TK_SUPERVISOR_CONFIG` `jobs.*.sandbox`), runs `sbx daemon status` and then `sbx ls`. A sandbox listed as running with no live supervisor pin record (`<store>/sandboxes/<sandbox>.pin`) reads `warning: <sandbox> started outside the supervisor; the next pin restarts it` — report it; never stop or start the sandbox yourself. A record is live only when it parses (`supervisor_pid` an integer, `since` an ISO-8601 instant), its `supervisor_pid` is a running process on this host, and its `since` is not older than the sandbox's start (host-now minus `sbx exec <sandbox> cat /proc/uptime`, run only for a live pid) by more than a 120-second clock-skew tolerance. A record therefore reads as absent when it is unreadable, its `supervisor_pid` is not a live process, or its `since` predates the sandbox's start beyond that tolerance — e.g. after a supervisor exit, a reboot or a manual stop/start; a kept pin under a live supervisor is still a legitimate pin (the record is removed only when a release stops the sandbox). An uptime that cannot be read leaves the pid verdict. Otherwise it reads `pinned by the supervisor`, `not running`, `no engine sandbox configured`, `sbx absent` or `daemon down`. Right after it comes `engine sandbox inodes`, advisory too: for each running engine sandbox it runs `sbx exec <sandbox> df -i /` and reads `<n> free inodes on /`, `warning: <sandbox> has <n> free inodes on / (below 50000); the engine may fail to write`, or `<sandbox>: inodes unknown` when the read fails or does not parse (several sandboxes are each named `<sandbox>: …`, joined by `; `); otherwise the same `not running`, `no engine sandbox configured`, `sbx absent` or `daemon down`. Report a low reading; never prune or restart the sandbox yourself. After it comes `playable path` (Story 34.2), advisory too: for a project whose tracked `.tk-studio/config.yaml` declares `verify.engine`, it reads `warning: no $env:GODOT (unset or not an absolute file); playable runs refuse`, `warning: no display session; the <path> path needs the logged-in desktop` (or `warning: display session unknown (<error>)`) or `ready (<path>)`, where `<path>` is the ruled rendering path; any other project reads `not a game project (no verify.engine)`. Report it; never start the engine. After it comes `story plans` (Story 35.2), advisory too: `all <n> planned` or `without a plan: <id>, …` (manifest order; a plan is `<spec_folder>/plans/<N>-<M>.md`), plus `; un-noted open questions: CAP-N (<id>), …` for the stories after the next one. Report it. After it comes `engine mcp` (Story 35.4), advisory too, from the tracked `.tk-studio/config.yaml`: `not configured (no engine.mcp)`, or `verify-only filter <flag>; port <per-run|fixed <n> (one flagged run at a time)>; forwarder <…>; a host:port sandbox policy needs the fixed forwarder port (runbook)` when `engine.mcp.start` carries the server's verify-only allowlist flag (`engine.mcp.filter`, default `--exclude-domains`), else `warning: engine.mcp.start has no <flag>; the verify-only rule (kb/engine-mcp-godot.md) rests on the engine skill alone; port …`; an `engine.mcp` the pin's `parseEngineMcp` refuses (`port: 0` with no `{port}` in `start`, a missing or non-integer port, an empty or multi-token `filter`, …) reads `warning: <the pin's reason, e.g. engine.mcp.start has no {port} for port: 0>; the pin refuses engine-mcp:no-config` (the flagged run would end `blocked`); a config the lib's YAML subset refuses reads `warning: .tk-studio/config.yaml unreadable by the lib's YAML subset (<err>); write engine.mcp in block style`. Report it; the run proceeds, and never edit the project's config yourself.

   **Relaunch.** When `SPEC.md` and the manifest already exist (the epic launched before: stories already `done`, the route already applied), steps 3 and 4 write nothing and step 5 makes no commit; go straight to step 6. A relaunch ends exactly as a fresh launch does — on the core's block (see Status block).

3. **Epic SPEC (when missing).** Invoke the project's own `bmad-spec` skill by name, headless, on the epic: input = the epic's section of `_bmad-output/planning-artifacts/epics.md` plus `_bmad-output/implementation-artifacts/epic-<N>-context.md` when present; slug `epic-<N>`, so it lands at `<spec_folder>/SPEC.md`. Express mode: gaps become `open_questions[]`, never invented answers. The stock skill is invoked untouched (AD-4); if it is not installed in the project, end `blocked` naming it.

4. **The manifest and every story's plan (when the manifest is empty).** The task-planning instructions are a **project resource**: `<root>/.bmad-loop/plugins/studio-pipeline/task-planning.md` (the studio pipeline's gate plugin). Read it and follow it as "bootstrap story `<epic>-<story>`" — it transcribes the epic into `<spec_folder>/stories.yaml` and writes `<spec_folder>/plans/<N>-<M>.md` for every entry in list order (`<epic>-<story>` first; a Code Map and the band each), then validates with `bmad-loop validate`. When the named (next) story has a SPEC open question (`CAP-N`) it cannot settle into a design note, it ends `blocked` naming the CAPs, never plans around it (step 6's `check` also refuses it with the gap `open questions`). A later story's unsettled CAP never blocks the launch: it stays un-noted, recorded as a Block If under that story's plan's Risks, named in the `story plans` row, re-checked at that story's boundary and refused by `check` once that story is next. This is planner-tier work and the reason this surface's model default is the top tier. If the file is absent, end `blocked` naming it: this surface never invents a task breakdown of its own.

5. **Commit the bootstrap output** — the one rule for the launch's own writes, so the dirty-tree refusal never fires on them. When steps 3–4 wrote files, commit exactly those files (`<spec_folder>/SPEC.md`, `<spec_folder>/.memlog.md`, `<spec_folder>/stories.yaml`, every `<spec_folder>/plans/<N>-<M>.md` step 4 wrote, and any canonical plan files the transcription wrote) on the checkout's current branch at launch — that branch is the run branch (`loop/epic-<N>` by convention; a supervisor worktree may name it otherwise, and this surface never checks the name or switches branches) — in one commit with exactly this message:

   ```text
   loop(epic-<N>): SPEC, manifest and story plans from the launch bootstrap
   ```

   Name those paths, only the ones that exist, in both commands — `git add -- <paths>` then `git commit -m '<message>' -- <paths>` (a pathspec commit records only those paths, whatever else is staged) — never `git add -A`, never anything else. If `git add` or `git commit` fails, end `blocked` with the git error verbatim in `reason`. When nothing was written (a relaunch), make no commit. Never push. This happens after step 4 and before step 6's `check`.

6. **Launch.** Re-run `check`; when it answers `ok`, start the engine (add `--allow-budget-mismatch` only when the payload carries `allow_budget_mismatch: true`):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/launch.py" start --directory <root> --spec <spec_folder> [--allow-budget-mismatch]
   ```

   A `budget_mismatch` without the acknowledgement is a refusal (exit 2, `blocked`, both numbers in `reason`, the `budget` object carried in the refusal): report it and do not launch. The core mints the run id, spawns `bmad-loop run --spec … --run-id …` detached and console-less with its output in `~/.tk-studio/projects/<key>/launches/<run-id>.log`, and answers `ok` only once the engine has written `.bmad-loop/runs/<run-id>/state.json`. A launch it could not confirm answers `ok: false` with the pid and log named — report that as `blocked` with the reason; do not launch again.

7. **Report.** Attended and headless alike: the run id, the spec folder, the stories planned (none on a relaunch) and the `story plans` row, the route (session / implementer / reviewers / consult models and where each came from), any `budget_mismatch` with both numbers, and how to watch it — the studio supervisor's status page, `launch.py status` (this surface's `status` verb), and `bmad-loop tui`. Then end with the status block (below).

### `sweep`

Story 35.7: one deferred-work sweep through the studio (the `run-sweep` job type). Resolve `<root>` as `start` step 0 does, then run — no route, no bootstrap, no `check` (the core refuses on its own):

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/lib/launch.py" sweep --directory <root> --triage-wait 540 [--max-bundles <max_bundles>]
```

Run it with the Bash tool timeout set to 600000 ms: the status block must print inside the tool's 600 s cap (the wait counts from the call's start), so the skill waits 540 s; the core's default stays 1500 s. A longer triage ends `complete` / `triage still running` and the supervisor's watch records it.

The core refuses before spawning anything (`blocked`, the gap named): no `.bmad-loop/policy.toml`, no `_bmad-output/implementation-artifacts/deferred-work.md`, a live engine owning the checkout (one engine per checkout, as `start`: the run ids and statuses named — never stopped to make room, never a second engine), a dirty tree (`git status --porcelain`, the paths named), an existing run dir. Otherwise it starts `bmad-loop sweep --project <root> --no-prompt --run-id <rid> [--max-bundles <n>]` detached (the triage pass: `bmad-loop-sweep` partitions the ledger; `max_bundles` and the attempt caps come from the policy, whose `[sweep] auto` stays `never` — an explicit start ignores it), waits for its `state.json`, then for `.bmad-loop/runs/<rid>/triage.json` (`--triage-wait`: the skill waits 540 s; the core's default stays 1500 s). A read triage is emitted once as the `sweep-triage` ledger event and returned as `triage {bundles: [{name, dw_ids}], blocked: [{id, blocker}], decisions: [{id, question}], already_resolved: [id], skip: [id]}`. Never clean the tree, never edit the policy or the ledger, never answer a decision: under `--no-prompt` they are skipped unattended and listed for `bmad-loop decisions`.

Report the bundles, the blocked entries and the human decisions, then end on the core's block. The bundles run in the engine afterwards; the supervisor closes the run out (one PR per sweep) and flips the ledger after the merge.

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

A `sweep` ends on its block: `complete` with `artifacts: [".bmad-loop/runs/<rid>", ".bmad-loop/runs/<rid>/triage.json"]` and the one-line reason `bundles: <name> (DW-a, DW-b); …; blocked: DW-x, …; decisions: DW-y, …` (`none` for an empty list); `complete` with `artifacts: [".bmad-loop/runs/<rid>"]` and `reason: "triage still running"` when the wait elapsed with the engine live (the supervisor's watch records the triage later); `blocked` when the engine ended or paused before any `triage.json` (the triage escalated — or, when the engine's journal holds `sweep-nothing-open`, `reason` names `sweep: nothing open in the ledger`) or leaving a `triage.json` that does not parse (`sweep triage unreadable`, no full wait), or a refusal.

`blocked` names the gap verbatim: the readiness check's `gaps[]` (an `open questions` gap naming every CAP of the next story that has no design note), an unacknowledged `budget_mismatch`, the missing project resource, an unconfirmed launch. A path that ends before any core call (an unresolvable input, an unignored routing write, a missing `bmad-spec`) prints the same block shape itself, `blocked` with the gap. `partial` is the core's `check` naming a `budget_mismatch`.

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- One engine per checkout: the core refuses a launch while any run owns the checkout; this skill never stops one to make room.
- The core never writes into the project tree: run state is the engine's, launch logs live in the per-user store (AD-3).
- SPEC.md comes from `bmad-spec`, the task manifest from the project's task-planning instructions — this surface authors neither.
- The route comes from `lib/pipeline.py` — the shipped legs are measured defaults (AD-14 resource tier); a project overrides them in `.bmad-loop/routing.toml`, a driver per invocation with `--set leg.field=value`. Escalation is deliberate: this surface never routes a leg onto a larger model than the resolved value, and never launches a subagent on the planner tier.
- Job-level events belong to the job wrapper (`job-run`); this surface emits none of its own (AD-12) except `sweep-triage`, which the core's `sweep` verb alone emits once per triage read (Story 35.7).
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
