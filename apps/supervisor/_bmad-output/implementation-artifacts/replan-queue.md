# Replan queue

## 21-3 — scope: stories — from 21-1-the-lift-drives-the-studio-at-the-current-contract — 2026-09-28

- What changed: see the 21-1 spec Reconcile section
- Suggested adjustment: Replan (21-1 reconcile, 2026-09-28): one-shot jobs start via jobrun `submit`, recurring ones via `wake` (the lifted CLI does both); idempotent minting covers both verbs. Timeout recovery adopts only a run started within 2s before the caller began: keep that rule when the queue owns minting.
- Status: closed — applied to the unstarted 21-3 entry's invoke_dev_with by the planning session (2026-09-28)

## 21-4 — scope: stories — from 21-1-the-lift-drives-the-studio-at-the-current-contract — 2026-09-28

- What changed: see the 21-1 spec Reconcile section
- Suggested adjustment: Replan (21-1 reconcile, 2026-09-28): a host-tier bypass request is refused before any run exists (HostBypassRefused, exit 2, reported `blocked`); read this story's "the run ends blocked" as the submission refused `blocked` with no run minted. The worker prompt is the argument after `-p` (no stdin, no shell retry: an injection risk); keep it.
- Status: closed — applied to the unstarted 21-4 entry's invoke_dev_with by the planning session (2026-09-28)

## 21-6 — scope: stories — from 21-1-the-lift-drives-the-studio-at-the-current-contract — 2026-09-28

- What changed: see the 21-1 spec Reconcile section
- Suggested adjustment: Replan (21-1 reconcile, 2026-09-28): resume and orphan handling must respect the lifted CLI's rule that only a run started within 2s before the caller began is adopted after a wake/submit timeout; one-shot runs are minted by `submit`.
- Status: closed — applied to the unstarted 21-6 entry's invoke_dev_with by the planning session (2026-09-28)

## 21-4 — scope: stories — from 21-2-conformance-passes-through-the-supervisor — 2026-09-28

- What changed: the worker command's `deny_profile` seam (see the 21-2 spec's Reconcile section)
- Suggested adjustment: Replan (21-2 reconcile, 2026-09-28): the lifted worker command takes a `deny_profile` input: an absolute path, validated by `validateDenyProfile` (a relative or unreadable profile is `DenyProfileRefused`) and forwarded as `--settings <path>`. The host tier passes the operator's deny-list settings through it unchanged and never widens them.
- Status: closed — applied to the unstarted 21-4 entry's invoke_dev_with by the planning session (2026-09-28)

## 21-4 — scope: stories — from 21-3-jobs-survive-restarts-in-a-durable-queue — 2026-09-28

- What changed: runs are queued (SQLite) and may be driven later by `drain`/the tick; per-run caller options live on the queue run (`runs.permission_mode`); the verb timeout is uncapped; the summary `run_id` is the queue id.
- What no longer holds: "the tier comes from the submission or the supervisor's own per-job config"
- Suggested adjustment: Replan (21-3 reconcile, 2026-09-28): store the submitted tier on the queue run like `runs.permission_mode` (nullable column, event, explicit ?? stored ?? config ?? host). Re-check it at drive time with the same validator. A caller's host bypass is refused before enqueue, and a stored option that fails its re-check after the claim ends the queue run `blocked`. `finish` (with `total_cost_usd`) gets `studio_run_id`, never the queue id. Build on the exported `startRun`/`finishRun`/`guardsFor`.
- Status: closed — applied to the unstarted 21-4 entry's invoke_dev_with by the 21-3 gate (2026-09-28)

## 21-5 — scope: stories — from 21-3-jobs-survive-restarts-in-a-durable-queue — 2026-09-28

- What changed: the tick runs the restart rule once at start and wakes through the queue-backed `runJob`; a core job runs inside `wake`/`submit` under a supervisor timeout of the job's uncapped guard + 120 s, and `--timeout-cap-s` caps only the skill invocation; DW-3 (a worker outliving a killed supervisor) names 21-5 for the tree kill.
- What no longer holds: "the worker's whole process tree is killed and the run finishes `partial` with the guard named in `reason`" (a core job's guard is today the verb timeout, not a named guard) and "never while a run of it is `queued` or `running`" (the pacer must read the queue)
- Suggested adjustment: Replan (21-3 reconcile, 2026-09-28): the pacer reads `queued`/`running` from the queue db (`TK_SUPERVISOR_DB`), keeps the tick's start-of-tick recovery, and keeps the counts (`StartError` refused, lock wait/already-running skipped). The wall-clock guard replaces the `wake`/`submit` verb timeout (guard + 120 s) and the capped skill invocation with a named guard that kills the process tree (closes DW-1; with 21-6, DW-3). Record `stop.on_status` in the queue's `events` table. `finishArgsFor`/`knowledgeOf` in tick.ts are unused.
- Status: closed — applied to the unstarted 21-5 entry's invoke_dev_with by the 21-3 gate (2026-09-28)

## 21-6 — scope: stories — from 21-3-jobs-survive-restarts-in-a-durable-queue — 2026-09-28

- What changed: 21-3's restart rule: `Queue.recover({end, find})`; owner = hostname + pid + nonce + start time (Linux /proc, win32 PowerShell); `verb_started` + stored snapshot; restart adoption = the earliest studio run absent from the snapshot and minted at/after `verb_started` (an ambiguous or unreadable lookup ends `partial` `orphaned: supervisor restart; studio run lookup failed: …`); recovery runs on `run`/tick start/`recover`/`drain`, not `submit`; post-claim start errors and `not-woken` end the queue run `blocked`; DW-3 deferred here.
- What no longer holds: the stories.yaml replan note "only a run started within 2s before the caller began is adopted" (consult 10:52:44Z: superseded by the snapshot rule); AC1's "superseding Story 21.3's orphan rule" now supersedes the `verb_started` rule above
- Suggested adjustment: Replan (21-3 reconcile, 2026-09-28): replace the 2-second sentence with this. A run is adopted after a wake/submit failure or a restart only if it is absent from the pre-verb snapshot (stored at `verb_started`) and minted at or after `verb_started`; the earliest wins, and an ambiguous lookup fails. Resume extends `Queue.recover({end, find})` and its nonce owner identity. The queue run id and `studio_run_id` stay separate. DW-3 is yours: a worker that outlives a killed supervisor must hold the checkout lock, or be killed, before `recover` releases it.
- Status: closed — applied to the unstarted 21-6 entry's invoke_dev_with by the 21-3 gate (2026-09-28), replacing the superseded 2s sentence

## 22-1 — scope: stories — from 21-3-jobs-survive-restarts-in-a-durable-queue — 2026-09-28

- What changed: the queue owns the run id (`q-<job>-<ts>-<hex>`), and the studio's id is `studio_run_id`; `submit`/`drain`/`not-woken` answers carry the queue id; the queue's terminal states include `cancelled`.
- What no longer holds: "it is queued through Story 21.3's validation and the response carries the run id" (read: the queue run id; `GET /runs/{id}` and cancel take it)
- Suggested adjustment: Replan (21-3 reconcile, 2026-09-28): API run ids are queue run ids. Answers also carry `studio_run_id`. Cancel ends the queue run `cancelled` through a `Queue.end` transition with its event, and the studio run through `jobrun cancel` or launch `stop`. Epic 22 has no manifest yet; apply this when it is transcribed.
- Status: open
