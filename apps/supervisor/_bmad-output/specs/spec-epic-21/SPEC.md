---
id: SPEC-epic-21
companions:
  - salvage-findings.md
  - ../../planning-artifacts/epics.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Epic 21: A Queued Job Runs to a Guarded, Measured End

## Why

This epic fixes a pain and meets a mandate. ClaudeOS stopped being the studio's driver on 2026-09-26, so nothing on the agent PC runs studio jobs durably. The code it left behind also breaks host rules: it bypasses permissions, bills the wrong account, and strands runs. The operator needs a driver that lives outside the plugin (AD-2) and runs one job at a time from queue to a guarded, costed finish. It must survive restarts and pass the driver contract's conformance suite. This epic delivers Phase 1 acceptance (b), conformance through the new driver, and (c), no run ever silently lost. It is operable from its own CLI. Epic 22 adds remote reach.

## Capabilities

- **CAP-1**
  - **intent:** The operator can wake, invoke headless, and finish one studio job from the supervisor CLI, using ClaudeOS driver code lifted and brought current.
  - **success:** The shipped `maintenance-conformance` job on tk-studio runs `wake` → invoke → `finish` from the CLI. A `job-run` event lands in the agent PC's ledger, and the README records the provenance (tag, path, commit) of each lifted file.
- **CAP-2**
  - **intent:** The supervisor reads projects and jobs only through the contract.
  - **success:** Projects are read through the registry read path and jobs through the `resolve` verb (0.1.12). No code path reads raw `.tk-studio/jobs/*.json`.
- **CAP-3**
  - **intent:** Every run's outcome is captured from the worker's status block, or the run fails loudly.
  - **success:** The status block is the last balanced JSON object in the worker's JSON output with string `status` and `intent`. `finish` records it along with `total_cost_usd`. A missing block ends the run with a named conformance failure (AD-11). `bun test` pins command-line building, block extraction and the missing-block case.
- **CAP-4**
  - **intent:** A run without a valid Max login stops before doing work and names the cause.
  - **success:** When the login is absent or expired, the run ends `blocked` naming the missing login. It never ends in a silent 401, and the preflight never passes on `claude --version` alone.
- **CAP-5**
  - **intent:** The shipped conformance suite passes when driven through the supervisor.
  - **success:** Every surface in `contracts/conformance/manifest.json` is driven, including the added `evolve` and `launch` entries. The report names the studio supervisor as the driver. `harness-blocked` drives are skipped with a reason when `--harness` is absent; with it, they run under a denying permission profile and are judged per contract §8. Surfaces and check counts match `runner.py run` on the same plugin version, and any divergence fails the story.
- **CAP-6**
  - **intent:** Submitted jobs and runs survive restarts and races, and nothing runs twice.
  - **success:**
    - Submissions are validated against `job.schema.json`. An invalid one is refused with the schema error, and nothing is queued.
    - Jobs, runs and events persist in SQLite with atomic transitions.
    - When two wakes race, one run is minted and the other caller gets its id.
    - A second run on a held checkout waits `queued` and names the lock holder. Detached bmad-loop engines count as holders.
    - On restart, orphaned runs end `partial` (`orphaned: supervisor restart`) or are re-queued if they never started. Every transition is logged in `events`.
- **CAP-7**
  - **intent:** Each run executes on the tier its job needs, with the job's model and effort, and never bypasses permissions on the host.
  - **success:**
    - On the host tier (the default), `claude -p` runs under the Max login with `--permission-mode auto`, or `acceptEdits` when the job asks for it, and with `--output-format json`. The process is console-hosted in the logged-on session.
    - On the sbx tier, the worker runs inside a Docker Sandboxes microVM, where bypass is allowed.
    - Model and effort are forwarded verbatim per contract §5.
    - The first sbx run records both runbook §3.5 checks: bypass works, and `~/.ssh` and cloud-credential folders are not visible.
- **CAP-8**
  - **intent:** No unattended run outlives its budget, and no recurring job piles up behind itself.
  - **success:**
    - When a run passes `max_wall_clock_seconds`, the worker's whole process tree is killed and the run ends `partial` naming the guard.
    - `max_turns` and `max_tokens` are checked through `account`, using counts from the transcript, and a trip ends the run `partial` naming the guard.
    - A self-paced job wakes only after `hint_seconds` have passed since its last run ended, and never while one of its runs is `queued` or `running`.
    - When `stop.on_status` matches a run's terminal status, the job stops recurring and the stop is recorded in `events`.
- **CAP-9**
  - **intent:** A run interrupted by a supervisor crash or a silent worker exit resumes from its transcript or ends `partial` with the reason named. It is never lost.
  - **success:**
    - A run resumes with `--resume <session-id>` on the same tier and branch when its transcript exists and its guards leave budget. This rule supersedes CAP-6's orphan rule for runs that can resume.
    - Resumes are capped at one per run by default.
    - A transcript the CLI has garbage-collected is restored from the nightly backup. When no copy exists, the run ends `partial` naming the missing transcript.
    - The test suite kills the supervisor after `wake`, mid-invoke, and before `finish`. Each case ends resumed or `partial` with its events recorded.

## Constraints

- The host tier never runs `bypassPermissions`. A bypass request on the host is refused with a named error before any process starts, and the run ends `blocked`.
- `permissions.deny` in `~/.claude/settings.json` applies untouched.
- The worker environment never carries `ANTHROPIC_API_KEY`, because the Max login pays (ruling 3).
- No tracked file contains a machine path (AD-15). The studio root, store and plugin root resolve from the environment.
- `js-yaml` is the only runtime dependency beyond Bun.
- No ClaudeOS residue remains: no `.mcp.json` registration, no Mission Watchdog chaining, no `claudeos-mcp-connector` driver name.
- The queue database lives outside every repo and outside `~/.tk-studio`, which the studio owns. Its path comes from the supervisor's environment.
- The tier comes from the submission or from the supervisor's per-job config, never from the plugin (AD-2).
- The supervisor never chooses a model (AD-14).
- The host-tier worker is console-hosted in the logged-on session. It is never spawned headless by Task Scheduler (runbook §8).
- One engine runs per checkout.
- The lift fixes the defects listed in `salvage-findings.md`. It does not copy them.

## Non-goals

- Reach over the tailnet or from the phone, including the HTTP submit API (Epic 22).
- Changes to the driver contract or plugin, including `finish` accepting cost (Epic 20, in tk-studio).
- Acceptance on The Universe Awaits, and Epic 23's branch and PR story.
- The supervisor choosing or escalating models.
- Registration as an MCP server, or any other ClaudeOS integration.

## Success signal

- On the agent PC, a job submitted to the supervisor CLI runs to `finish` with its status block and cost recorded. The conformance suite driven through the supervisor matches `runner.py run` direct. Killing the supervisor at any of the three points leaves every run resumed or `partial` with its reason, never stuck `queued`.

## Assumptions

- The repo is `thkennedy/tk-studio-supervisor`. The plan still lists the name as open item 1.
- Per-story acceptance criteria stay authoritative in `epics.md`, which is adopted as a companion and transcribed from tk-studio. This SPEC restates them at capability level only.

## Open Questions

- Has the operator confirmed the repo name `thkennedy/tk-studio-supervisor` (plan open item 1)?
- CAP-3 and CAP-7 need Epic 20's `finish` to accept `total_cost_usd`. Is Epic 20 released in the installed plugin, or must Story 21.4 handle its absence?
- Is the ClaudeOS repo at tag `retired-as-driver-2026-09-26` reachable from the dev environment, so the lift can copy the source files?
- For CAP-9, what is the nightly transcript backup: where does it live, what mechanism makes it, and does the supervisor own it or an existing host job?
- Some checks need the agent PC: Story 21.1's `maintenance-conformance` run, the sbx first-run checks in 21.4, and the Max-login preflight. Are these verifiable only live, and who records them?
