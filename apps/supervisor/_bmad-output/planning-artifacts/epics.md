---
status: transcribed
source: "thkennedy/tk-studio _bmad-output/planning-artifacts/epics.md (EP-021, EP-022; ST-063..ST-072)"
inputDocuments:
  - https://github.com/thkennedy/tk-studio/blob/main/_bmad-output/planning-artifacts/briefs/brief-studio-supervisor-2026-09-27/brief.md
  - https://github.com/thkennedy/tk-studio/blob/main/_bmad-output/planning-artifacts/briefs/planning-pass-agent-pc-and-supervisor-2026-09-26.md
note: >-
  The canonical plan for the studio supervisor lives in tk-studio (Phase 1,
  Epics 20-24). This file carries the two epics whose code lands in this repo,
  verbatim with their numbers, so tk-studio-launch can run them here. Change
  a story in tk-studio first, then re-transcribe it here; never edit it here
  alone.
---

# tk-studio-supervisor - Epic Breakdown (transcribed)

Epics 21 and 22 of the tk-studio Phase 1 plan: the durable driver that runs
studio jobs on the agent PC. Epic 20 (the contract changes) and Epic 23
(acceptance on The Universe Awaits) live in tk-studio's plan. Epic 23's branch
and PR story also lands here when it is transcribed.

## Epic 21: A Queued Job Runs to a Guarded, Measured End

The core of Phase 1, in the new supervisor repo (proposed `thkennedy/tk-studio-supervisor`; the name stays plan open item 1 until the operator confirms it). The ClaudeOS driver code at tag `retired-as-driver-2026-09-26` (`connectors/tk-studio/server.ts` 705 lines, `client.ts` 96, `conformance.ts` 453, `scripts/studio-jobs-tick.ts` 307) is lifted as a Bun/TypeScript library and CLI. It is stripped of its ClaudeOS coupling (the `.mcp.json` stdio registration, the Mission Watchdog chaining, the `claudeos-mcp-connector` driver name) and grows the durable parts it never had: a SQLite queue, a lock per checkout, wrapper-enforced guards, a pacer, the two-tier worker under the Max login, cost capture, and crash recovery.

The salvage read of 2026-09-27 found what the lift must change, not just copy. `server.ts` defaults the worker to `--permission-mode bypassPermissions`, which is forbidden on the host; it passes model and effort only inside the payload; it treats `ANTHROPIC_API_KEY` or a working `claude --version` as proof of auth; and it reads the registry file directly. `conformance.ts` has no `evolve` or `launch` entries in its surface and verb maps, and it throws a TypeError on `expect: harness-blocked` drives. The tick handles self-paced jobs only, never calls `account`, has no atomic wake, and strands a run in `queued` forever if it dies between `wake` and `finish`. Everything else it implements is current through 0.1.17: `job.schema.json`, `jobrun.py` and the status schema are unchanged since 0.1.12. The epic is operable from its own CLI; Epic 22 adds reach. Requirements trace: Source, scope items 1–4, acceptance (b) and (c). Repo: the supervisor repo.

### Story 21.1: The Lift Drives the Studio at the Current Contract

As the operator,
I want the ClaudeOS driver code lifted into the supervisor repo and brought current,
So that one job can be woken, invoked headless, and finished from the command line on the agent PC.

**Acceptance Criteria:**

**Given** the four source files at the tag
**When** they are lifted
**Then** the repo carries them with their provenance (tag, path, commit) in its README, `js-yaml` as the only runtime dependency beyond Bun, no ClaudeOS registration, watchdog, or driver-name residue, and no machine path in any tracked file (AD-15): the studio root, store, and plugin root resolve from the environment

**Given** the worker invocation
**When** the lifted code builds the `claude -p` command line
**Then** the host default permission mode is `auto`, a bypass request on the host is refused with a named error before any process starts, the `permissions.deny` list in `~/.claude/settings.json` applies untouched, and the worker's environment never carries `ANTHROPIC_API_KEY` (ruling 3: the Max login pays)

**Given** the auth preflight
**When** the Max login is absent or expired
**Then** the run ends `blocked` naming the missing login — never a silent 401, and never passed on the strength of `claude --version` alone

**Given** a job id for a registered project
**When** it is submitted
**Then** the project is read through the contract's registry read path and the job through the `resolve` verb (0.1.12), never from raw `.tk-studio/jobs/*.json` files

**Given** the shipped `maintenance-conformance` job on tk-studio
**When** it runs `wake` → invoke → `finish` from the CLI
**Then** the status block is captured from the worker's JSON output, `finish` records it, and a `job-run` event lands in the agent PC's ledger

**Given** the repo's test suite
**When** `bun test` runs
**Then** command-line building, status-block extraction (the last balanced JSON object with string `status` and `intent`), and the missing-block case (a named conformance failure, AD-11) are pinned and green

### Story 21.2: Conformance Passes Through the Supervisor

As the operator,
I want the shipped conformance suite driven through the supervisor,
So that acceptance (b) proves the new driver honours the contract (AD-19).

**Acceptance Criteria:**

**Given** `contracts/conformance/manifest.json` from the installed plugin
**When** the lifted `conformance.ts` runs it through the supervisor
**Then** every surface in the manifest is driven, the missing `evolve` and `launch` surface and verb entries are added, and the report names the driver as the studio supervisor

**Given** a drive declared `expect: harness-blocked`
**When** the suite runs without `--harness`
**Then** the drive is reported as skipped with its reason, never a thrown error; with `--harness` it runs under a denying permission profile and is judged per §8

**Given** the supervisor-driven report and `runner.py run` direct, on the same plugin version
**When** they are compared
**Then** both are ok over the same surfaces and check counts, and any divergence fails the story

### Story 21.3: Jobs Survive Restarts in a Durable Queue

As the operator,
I want submitted jobs and their runs held in SQLite with one lock per checkout,
So that nothing is lost or run twice when the supervisor stops, crashes, or two requests race.

**Acceptance Criteria:**

**Given** a job submission
**When** it is accepted
**Then** it is validated against the plugin's `job.schema.json` (an invalid submission is refused with the schema error and nothing is queued) and persisted in `jobs`, `runs`, and `events` tables in a database outside every repo and outside `~/.tk-studio` (which the studio owns), at a path from the supervisor's environment, with atomic state transitions

**Given** two wakes for the same job racing
**When** both reach the queue
**Then** exactly one run is minted in one transaction (idempotent `wake`) and the other caller receives the existing run id

**Given** a run holding a project checkout, including a detached bmad-loop engine the supervisor launched
**When** a second run targets the same checkout
**Then** the second run waits in `queued` with the lock holder named — one engine per checkout

**Given** a supervisor restart
**When** it finds runs left `queued` or `running` by a process that no longer exists
**Then** each is ended `partial` with reason `orphaned: supervisor restart` or re-queued if it never started — never left in `queued` forever — and every transition lands in `events`

### Story 21.4: The Worker Runs on the Right Tier and Reports Its Cost

As the operator,
I want each run executed on the tier its job needs, with model and effort forwarded verbatim and cost captured,
So that no run bypasses permissions on the host and every finish carries what it spent.

**Acceptance Criteria:**

**Given** a run on the host tier (the default; the tier comes from the submission or the supervisor's own per-job config, never from the plugin — AD-2)
**When** the worker starts
**Then** `claude -p` runs under the Max login with `--permission-mode auto` (or `acceptEdits` when the job asks), `--output-format json`, the deny list untouched, and the process console-hosted in the logged-on session — never a headless Task Scheduler spawn (runbook §8)

**Given** a run on the sbx tier
**When** the worker starts
**Then** it runs inside a Docker Sandboxes microVM, where bypass is permitted; a bypass request on the host tier is refused before any process starts and the run ends `blocked` naming the refusal

**Given** model and effort from the resolved job or the submission
**When** the worker starts
**Then** they are forwarded verbatim as contract §5 specifies; the supervisor never chooses a model (AD-14)

**Given** the worker's JSON result
**When** the run ends
**Then** the status block is extracted, `total_cost_usd` is passed to `finish` (Epic 20), and a missing block ends the run with a named conformance failure (AD-11)

**Given** the first sbx-tier run on the agent PC
**When** it completes
**Then** the two runbook §3.5 first-run checks are recorded: bypass works inside the microVM, and `~/.ssh` and cloud-credential folders are not visible inside it

### Story 21.5: Guards and the Pacer Are the Wrapper's Job

As the operator,
I want wall-clock, turn, and token guards enforced by the supervisor, and recurring jobs paced without overlap,
So that no unattended run outlives its budget and no job piles up behind itself.

**Acceptance Criteria:**

**Given** a run past its `max_wall_clock_seconds`
**When** the guard trips
**Then** the worker's whole process tree is killed and the run finishes `partial` with the guard named in `reason`

**Given** a job with `max_turns` or `max_tokens`
**When** the worker completes an iteration
**Then** `account` is called with the turns and tokens read from the worker's transcript, and a tripped guard ends the run `partial` naming it

**Given** a self-paced job with `hint_seconds`
**When** the pacer ticks
**Then** the job is woken only after the hint has elapsed since its last run ended, and never while a run of it is `queued` or `running`

**Given** a job whose `stop.on_status` matches a run's terminal status
**When** that run ends
**Then** the job stops recurring and the stop condition is recorded in `events`

### Story 21.6: A Killed Run Resumes or Ends Partial, Never Lost

As the operator,
I want a run interrupted by a supervisor crash or a silent worker exit to resume from its transcript or end `partial` with the reason named,
So that acceptance (c) holds: no run is ever silently lost.

**Acceptance Criteria:**

**Given** the supervisor is killed mid-run
**When** it restarts
**Then** every run it owned is found in the queue; each resumes with `--resume <session-id>` on the same tier and branch when its session transcript exists and its guards leave budget, and otherwise finishes `partial` naming the guard or `supervisor restart` (superseding Story 21.3's orphan rule for runs that can resume)

**Given** a worker that exits without a status block (runbook §8: silent REPL exit)
**When** the exit is detected
**Then** the same resume-or-partial rule applies, capped at one resume per run by default, and a second failure ends `partial`

**Given** a resume whose transcript the CLI has garbage-collected
**When** the nightly backup holds a copy
**Then** the transcript is restored from the backup before resuming; with no copy, the run ends `partial` naming the missing transcript

**Given** the repo's test suite
**When** it kills the supervisor at three points (after `wake`, mid-invoke, before `finish`)
**Then** each case ends resumed or `partial` with its events recorded, and the suite is green

## Epic 22: Reachable from the Phone

Plan Phase 1 scope items 5–7 and runbook §4. The supervisor answers on the tailnet and starts itself at logon the way this box needs: console-hosted, never a headless Task Scheduler task, and never started from a Claude desktop-app session (the MSIX AppData virtualization). The HTTP API is the seam Hermes will POST to in Phase 2, and the fallback front door if Hermes churns. Requirements trace: scope items 5, 6, 7. Repos: the supervisor repo (Stories 22.1–22.3), tk-studio kb (Story 22.4).

### Story 22.1: The API Answers on the Tailnet Only

As the operator away from the box,
I want the supervisor's HTTP API on the tailnet address behind a bearer token,
So that I can submit, watch, and cancel runs from the phone, iPad, or main PC.

**Acceptance Criteria:**

**Given** the supervisor starts
**When** it binds
**Then** it binds only the Tailscale address named in its environment and refuses to start on `0.0.0.0`, on an address outside `100.64.0.0/10`, or without a bearer token in its environment

**Given** a request without the correct token
**When** it arrives
**Then** it gets 401 and the token never appears in any log

**Given** `POST /jobs` naming a registered project and a declared job, with optional `base_ref`, `tier`, `model`, and `effort`
**When** it is valid
**Then** it is queued through Story 21.3's validation and the response carries the run id; an invalid body gets 400 with the schema error

**Given** `GET /jobs`, `GET /runs/{id}`, `POST /runs/{id}/cancel`, `GET /status`, and `GET /events?since=`
**When** each is called
**Then** each answers from the queue; cancel ends the run `cancelled`, stopping a launched engine gracefully (`tk-studio-launch` verb `stop`, `graceful`); `/events` serves both SSE and plain polling

**Given** the API test suite
**When** it runs
**Then** auth refusal, malformed JSON, unknown project, unknown job, and a double cancel are pinned and green

### Story 22.2: A Read-Only Status Page

As the operator,
I want a small server-rendered page over the queue and `~/.tk-studio`,
So that I can see what the box is doing at a glance while the studio plugin still grows no UI.

**Acceptance Criteria:**

**Given** the status page
**When** it is requested
**Then** it is served on the same bind and behind the same auth as the API, with no client-side framework, and it reads well at phone width

**Given** the page
**When** it renders
**Then** it shows the queue (jobs, and runs with state, reason, and cost), the latest status blocks, run workspaces (`run.json`, `handoff.json`), the tail of this machine's ledger file, and the registry's projects

**Given** any page route
**When** it is exercised in the test suite
**Then** it is a GET that writes nothing to the queue or to `~/.tk-studio`, and it renders no credential-shaped value (NFR5)

### Story 22.3: The Supervisor Starts Itself at Logon

As the operator,
I want the supervisor console-hosted at logon with the box's run hygiene built in,
So that it is always up after a reboot and never runs under the conditions that hang `claude -p`.

**Acceptance Criteria:**

**Given** `start.ps1` in the repo
**When** it runs
**Then** it reads the bind address and token from the user environment, starts the sbx daemon from `$HOME` when it is not already running (so the "Docker Sandboxes daemon" sign-in task can later be retired by the operator), and starts the API and the pacer

**Given** the logon path
**When** the story hands it over
**Then** the operator receives the exact command for the `shell:startup` shortcut (`wt.exe -w studio nt --title supervisor pwsh -NoExit -File <repo>\start.ps1`, runbook §4); nothing registers a "run whether user is logged on or not" task, and nothing starts the supervisor from a Claude desktop-app session

**Given** a run flagged as editor-in-the-loop on a Godot project
**When** it is about to start
**Then** a `robocopy /E` snapshot (never `/MIR`) of the project lands in the work folder and its path is recorded on the run

**Given** any terminal run
**When** it ends
**Then** a notification goes out (ntfy or Telegram, chosen by the environment) naming the run, its status, its reason, and its PR when there is one, and the run's session transcript is copied to the backup folder (the nightly task remains the catch-all)

**Given** a reboot of the agent PC
**When** auto-logon completes
**Then** `curl -H "Authorization: Bearer <token>" http://<tailscale-ip>:<port>/status` from another device answers

### Story 22.4: The Runbook Describes the Supervisor as Built

As an operator provisioning the next agent box,
I want runbook §4 to describe the supervisor as built instead of as a placeholder,
So that the next box is set up from facts.

**Acceptance Criteria:**

**Given** `kb/agent-pc-setup-runbook.md` §4
**When** the story lands
**Then** it names the repo, the clone path under `C:\GitHub`, the environment variables (bind address, token, database path, notification target), `start.ps1`, the Startup shortcut, the retirement of the sbx sign-in task, and the smoke test from another device; §7 gains a smoke row and §8 gains a row for each supervisor failure mode met while building it

**Given** the story's docs-only scope
**When** it lands
**Then** no code, schema, or contract file changes, and the kb index regenerates only if frontmatter moved
