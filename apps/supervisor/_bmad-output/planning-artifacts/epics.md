---
status: transcribed
source: "thkennedy/tk-studio _bmad-output/planning-artifacts/epics.md (EP-021, EP-022; ST-063..ST-072; Story 22.5 = ST-080; EP-027 transcribed 2026-10-15, ST-093..ST-097)"
inputDocuments:
  - https://github.com/thkennedy/tk-studio/blob/main/_bmad-output/planning-artifacts/briefs/brief-studio-supervisor-2026-09-27/brief.md
  - https://github.com/thkennedy/tk-studio/blob/main/_bmad-output/planning-artifacts/briefs/planning-pass-agent-pc-and-supervisor-2026-09-26.md
note: >-
  The canonical plan for the studio supervisor lives in tk-studio (Phase 1,
  Epics 20-24, then Epics 26-27). This file carries the epics whose code lands in this repo,
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

**Given** a declared one-shot job whose target is the read-only `tk-studio-activate` surface (the story adds it to this repo as `.tk-studio/jobs/studio-health.json`)
**When** it runs `wake` → invoke → `finish` from the CLI
**Then** the status block is captured from the worker's JSON output, `finish` records it, and a `job-run` event lands in the agent PC's ledger

**Given** the shipped core-target `maintenance-conformance` job
**When** the supervisor wakes it
**Then** `wake` runs the core itself and ends the run (no worker session, no `finish`), and the supervisor records the run's outcome from `status` — corrected 2026-09-28 after the Epic 21 launch found core-target jobs never reach `finish`

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

Plan Phase 1 scope items 5–7 and runbook §4. The supervisor answers on the tailnet and starts itself at logon the way this box needs: console-hosted, never a headless Task Scheduler task, and never started from a Claude desktop-app session (the MSIX AppData virtualization). The HTTP API is the seam Hermes will POST to in Phase 2, and the fallback front door if Hermes churns. Requirements trace: scope items 5, 6, 7. Repos: the supervisor repo (Stories 22.1–22.3), tk-studio kb (Story 22.4). Story 22.5 was added on 2026-10-06 from DW-20, after the first four had landed: the page signs the operator in from a phone browser (supervisor repo, runbook §4.5 follows in tk-studio).

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

### Story 22.5: Sign In from the Phone

As the operator on the phone,
I want the status page to sign me in with the token, with Google, or with GitHub, and keep me signed in with a cookie,
So that I can watch and cancel runs from a phone browser, which cannot send the bearer header (DW-20).

**Acceptance Criteria:**

**Given** a browser request to the page with neither a bearer header nor a valid session cookie
**When** it is answered
**Then** it gets a sign-in page on the same bind: a form that takes the API token, and "Continue with Google" and "Continue with GitHub"; nothing else of the page is served, and the API's JSON routes still answer 401 as in Story 22.1

**Given** the correct token on the form, or an OAuth callback whose verified identity is on the allow list named in the environment (one Google account, one GitHub login, never a wildcard)
**When** sign-in completes
**Then** an `HttpOnly`, `Secure`, `SameSite=Lax` session cookie is set, signed with a session secret from the environment and carrying an expiry; an identity off the allow list, a bad token, or a failed OAuth state check is refused with no cookie and no detail

**Given** a signed-in browser
**When** it opens `GET /` and the API's GET routes
**Then** they answer as the bearer header would; `POST /runs/{id}/cancel` from a cookie session also needs the CSRF token the page embeds, and a cookie never authorises `POST /jobs`

**Given** Google's rule that a redirect URI is `https` on anything but localhost
**When** the supervisor serves the sign-in
**Then** it serves `https` on the tailnet address with the machine's Tailscale certificate for its MagicDNS name (`tailscale cert`), the bind rule of Story 22.1 is unchanged, and the hand-over names the operator's two steps: enable HTTPS certificates once in the Tailscale admin console, and register the Google and GitHub OAuth apps with that callback URL, their client ids and secrets set under the `TK_SUPERVISOR_OAUTH_*` names the story fixes

**Given** the OAuth client secrets, the session secret and every cookie value
**When** anything logs, renders, notifies or spawns a worker
**Then** none of them appears (NFR5) and `buildWorkerEnv` drops them; the test suite pins the form path, both OAuth callbacks against a faked provider, the allow-list refusal, the state-check refusal, cookie expiry and the CSRF refusal

## Epic 27: The Service Owns Lifetime, Part 2: The Supervisor

The supervisor's half of the design spec's §6.2 item 1, built in `thkennedy/tk-studio-supervisor` by the loop in `claude-tk-studio-supervisor` after this epic is transcribed there (the Epic 21 and 22 pattern: change a story here first, then re-transcribe). It makes the supervisor the only thing that starts work and the owner of every engine's life: a worktree per run that the sandbox can see, the engine held and pinned by the service itself, a close-out for a run that paused after its story landed, a host-tier verify leg before any PR opens, the plan pulled back when a run lands, and the deferred work the ledger assigned to it. Two preconditions are the operator's: the supervisor tab is stopped from the console before the loop builds the supervisor itself (the single-checkout decision of 2026-10-06), and the supervisor's sandbox is recreated with the read-only skills mount, `WITH_BUN=1`, and a second read-write mount of `TK_SUPERVISOR_WORK` so worktrees are visible inside the microVM. Requirements trace: Story 23.2 (superseded here), PROP-025, PROP-036, PROP-038, PROP-040, PROP-041, PROP-053, PROP-055, PROP-064, PROP-065 (adopted 2026-10-15), loop holes 7, 9, 11, 12, 16, 18, 22; DW-3, DW-6, DW-11, DW-12, DW-13, DW-15, DW-19, DW-21, DW-23 of the supervisor's ledger; spec §6.2 item 1. Repo: the supervisor repo (every story); tk-studio only for the runbook rows.

### Story 27.1: Every Run Gets Its Own Worktree and Ends in a PR

As the operator,
I want each run to work in a git worktree of the project cut from its base, and to end as a pull request against that base,
So that two loops never share a working tree, a run never switches the branch under a running service, and all agent work arrives PR-only (hole 16; supersedes Story 23.2).

**Acceptance Criteria:**

**Given** a submission with `base_ref`
**When** the run is claimed
**Then** the supervisor creates `git worktree add <TK_SUPERVISOR_WORK>/worktrees/<project>/<run_id> -b supervisor/run-<run_id> <base_ref>` from the project checkout, refuses a `base_ref` that is the repository's default branch when that branch is not protected on GitHub (`blocked`, naming it), and records the worktree path on the queue run; the checkout itself is never switched

**Given** the untracked runtime the engine needs in a worktree (`_bmad/` at the pin, `.bmad-loop/policy.toml` and `routing.current.json`, the project's local config overlay)
**When** the worktree is prepared
**Then** the supervisor materialises them by the studio's own motions (`tk install` at the pin inside the worktree; the policy and routing files copied from the checkout; never a junction into the checkout), `tk activate` is clean inside the worktree, and the engine's `--project` is the worktree

**Given** a run that launched an engine
**When** the engine completes, pauses, or is stopped
**Then** the supervisor pushes the run branch and opens a PR against `base_ref` whose body carries the launch status block, the engine run id, the landed commits and the metered cost, records the PR URL on the `ended` event, opens no PR when no commit landed ("no changes" recorded), never force-pushes and never merges; the worktree is removed after the PR opens unless the run is paused (a paused run keeps it for the resume)

**Given** the supervisor's test suite on the Windows host and the Linux engine
**When** it runs
**Then** worktree creation, the unprotected-base refusal, the runtime materialisation and the PR body are pinned against a fake `gh` and a real throwaway repository, and the live acceptance on the-universe-awaits (Story 23.3) is re-planned against this story

### Story 27.2: The Supervisor Holds the Engine and Nothing Else Starts One

As the operator,
I want the supervisor itself to start, hold, pin and release every engine sandbox, and the queue to be the only way a run starts,
So that an engine never dies with a host-side shell (hole 7) and the pacer never overlaps a run it cannot see (DW-6, DW-3).

**Acceptance Criteria:**

**Given** an sbx-tier run
**When** the worker starts
**Then** the supervisor runs `sbx run -d --name <sandbox>` to pin the sandbox, holds its own `sbx exec` for the engine's lifetime from the console session (never a Claude desktop-app session), records the in-VM engine pid and the sandbox name on the run, and releases the pin (`sbx stop`) when the run ends and no other run holds the sandbox

**Given** a cancel or a tripped guard on an sbx run
**When** it fires
**Then** the engine's process group inside the microVM is killed by name of the recorded pid through `sbx exec` (argv only, no shell), the kill is recorded, and a kill that leaves the pid alive after its wait holds the run as DW-3 specifies

**Given** `jobrun.py submit|wake` run by hand or through the MCP `tk_job` surface on a project the supervisor serves
**When** it would start a run
**Then** the supervisor's lock file for the checkout names the queue as the only starter, the hand-started run is recorded as `external` on the next tick with its studio run id, and the pacer counts it as live until it ends (DW-6 closed)

**Given** the supervisor's test suite
**When** it runs
**Then** the pin, hold, release, kill-by-pid and external-run detection are pinned with a fake `sbx`, on both hosts

### Story 27.3: A Paused Run Whose Story Landed Is Closed Out by the Service

As the operator,
I want the supervisor to close out a run that paused after its story's work was committed, once a verdict exists,
So that the attended recipe of 2026-10-14 (verdict, harvest commit, meter, archive, relaunch) is the service's job (hole 9).

**Acceptance Criteria:**

**Given** a run that paused at the commit gate or on an escalation with the story's spec at `status: done` and a `reconcile_verdict` other than `escalate` recorded
**When** the supervisor's tick sees it
**Then** it commits the engine's staged harvest on the run branch with a named message, harvests the story's meter observation to the host ledger (Story 26.4's `meter.py harvest`), archives the run (`bmad-loop archive`, through `sbx exec`), relaunches the epic through `tk-studio-launch` (which skips done stories) under the same queue run with a `close-out` event, and never re-implements the story

**Given** the same run with no verdict, or `escalate`
**When** the tick sees it
**Then** it stays paused, one notification names the story and the reason, and the run's page row says "awaiting a ruling"

**Given** a story that halted before any commit
**When** the tick sees it
**Then** nothing is closed out; the run stays paused for the resume path (`bmad-loop resolve`), which the supervisor exposes as `POST /runs/{id}/resume` with an optional restore patch

**Given** the supervisor's test suite
**When** it runs
**Then** all three cases are pinned with a fake engine, on both hosts

### Story 27.4: A Host-Tier Verify Leg Runs Before Any PR Opens

As the operator,
I want the project's own verify command run on the Windows host, in the run's worktree, after the engine completes and before the PR opens,
So that Windows-only defects stop reaching branches (holes 11, 12 and 22).

**Acceptance Criteria:**

**Given** a project's tracked `.tk-studio/config.yaml` with `verify.host: <command>` (tk-studio: the lib suite and conformance; the supervisor: `bun test`; the-universe-awaits: its verify script)
**When** an sbx-tier run's engine completes
**Then** the supervisor runs that command on the host tier in the worktree, console-hosted, under the same guards as a host-tier worker, and records its exit, duration and the last lines of output on a `host-verify` event; the command comes from the project's config, never from the plugin (AD-2)

**Given** a red host verify
**When** the PR would open
**Then** the run ends `partial` naming the failing command, the branch is still pushed, the PR opens as a draft whose body carries the host failures, and the notification names them

**Given** a project with no `verify.host`
**When** a run ends
**Then** the PR opens as before and the event says the leg was skipped with the reason

**Given** the supervisor's test suite and the runbook
**When** the story closes
**Then** green, red and absent commands are pinned on both hosts, and runbook §3.8 retires the "attended host run before each PR" rule in favour of this leg

### Story 27.5: The Plan Follows the Run, and the Deferred Work Is Paid

As the operator,
I want the canonical plan to reflect a run's landing, and the supervisor's own deferred work closed,
So that the plan index stops under-reporting what is built (hole 18) and the queue is honest about cost, cancels, time and certificates (DW-11, DW-12, DW-13, DW-15, DW-19, DW-21, DW-23).

**Acceptance Criteria:**

**Given** a run that opens a PR
**When** the `ended` event is written
**Then** the supervisor calls the planning adapter's status verb (Story 26.5) on the project that owns the plan (the registry names it; a transcribed epic names its owner) for every story the run's spec marked done, setting `review`; the next tick that sees the PR merged sets `done`; both are recorded on the run's events, and a refused call never changes the run's state

**Given** a run resumed after a restart
**When** it finishes
**Then** `run.json`'s `total_cost_usd` is the sum across every iteration (per-iteration cost recorded as `accounted` events; DW-15)

**Given** a cancel racing a claim or a late studio-run record
**When** both happen
**Then** the cancel ends the studio run it finds on a re-read inside the end transaction, or the next recovery ends it, and no run is left unended (DW-12, DW-13); an ended run that keeps its lock counts as live for the pacer (DW-11)

**Given** the worker record on win32
**When** it is written
**Then** the pid lands before the start time, and the start time is read natively (`GetProcessTimes` through `bun:ffi` or an equivalent that takes under 50 ms), so a supervisor killed inside the window still leaves a usable record (DW-19)

**Given** the TLS certificate and a refused `finish`
**When** the certificate is within 14 days of expiry, or a skill run finished itself
**Then** the keeper renews the certificate and restarts `serve` once, outside a live run, with an event (DW-21); and a refused `finish` on an already-terminal studio run leaves the run's reason as the worker's own status-block reason, never the refusal text (DW-23)

**Given** the supervisor's test suite
**When** the story closes
**Then** every case above is pinned on both hosts, the deferred-work entries are closed with their evidence, and the runbook §4 names the new events and the certificate rule
