---
name: tk-studio-job
description: Run declared jobs on the harness's own scheduling primitives — submit, status, cancel, and wake per the driver contract, with budget guards and stop conditions enforced. Use when the user says "submit a job", "tk job", "job status", "cancel that job", or wants recurring/unattended work scheduled.
---

# tk-studio-job

Jobs are data (contracts/job.schema.json, ST-6.1); this skill is the
execution wrapper (AD-10, O8 hybrid): it drives the §4 scheduler verbs and
binds recurring work to whatever the *harness* natively offers — scheduled
tasks/cron for `cron` triggers, loop primitives for fixed `loop` cadence,
self-paced wakeups for `self-paced` — never a bespoke runner. Run state
lives in resumable run workspaces under the per-user store.

## Behavior (both modes)

1. Every verb goes through the deterministic core (the one §4 surface):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/jobrun.py" submit --directory <root> --id <job-id>
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/jobrun.py" status --directory <root> --job-id <id> [--run-id <rid>]
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/jobrun.py" cancel --directory <root> --job-id <id> [--run-id <rid>]
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/jobrun.py" wake   --directory <root> --job-id <id>
   ```

   `submit` validates (a job missing guards or stop conditions is rejected,
   `accepted: false`), gates on stop conditions, and answers with a
   **directive**. Core-target one-shots execute immediately, wall-clock
   guarded. An `accepted`/`woken` `false` is an answer — relay the reason.

2. **Bind the directive to the harness.** `{"kind": "cron", "schedule": ...}`
   → the harness's scheduled-task primitive; `{"kind": "loop", ...}` /
   `{"kind": "self-paced", ...}` → its loop/wakeup primitives; `{"kind":
   "invoke-skill", ...}` → invoke the named skill with the payload, then
   report the outcome with `finish`. Each firing of a recurring job is one
   `wake`.

3. **Skill-target runs stay honest.** While executing an `invoke-skill`
   directive, call `account --run-id <rid> --turns 1 [--tokens N]` every
   iteration; the moment it answers `within_budget: false`, end the run
   `partial` with the guard named:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/jobrun.py" finish --directory <root> --run-id <rid> --state partial --reason "guard: max_turns"
   ```

   `finish` records the terminal state and emits the run's `job-run` event —
   this wrapper alone emits job-level events; the target skill emits its own
   surface events, never both for one failure (AD-12).

4. **Durability is surfaced, never silently lost.** A `durable: true`
   recurring job on this session-scoped substrate gets a
   `durability_constraint` in the submit response: relay it verbatim
   (attended) or include it in the status block `reason` context (headless).
   Bind durable jobs to a cloud routine or an external harness via the
   driver contract; otherwise they must be re-submitted each session.

5. **Attended:** confirm before binding schedules; summarize directive,
   guards, and stop conditions. **Headless:** everything arrives in the
   payload; an unknown job id or invalid definition ends `blocked`, a guard
   or stop condition hit ends `partial` with the reason named — never a
   prompt (AD-11). End headless runs with the status block:

   ```json
   {"status": "complete", "intent": "tk-studio-job", "artifacts": ["~/.tk-studio/projects/<key>/runs/<run-id>/"], "reason": null}
   ```

## Rules

- The job model is data; never invent, widen, or hot-patch a definition —
  instances live in `.tk-studio/jobs/<id>.json`, listed in config `jobs[]`.
- Guards and stop conditions are contracts, not suggestions: obey `account`
  verdicts immediately; a job never runs away (AD-10).
- Run workspaces are the resumable truth: a fresh session continues a
  `queued|running` run from `run.json` alone (snapshot + checkpoint).
- Every terminal run leaves `summary.json` in its workspace (core runs also
  land the full parsed result as `output.json`); point the operator there,
  never paste whole reports into chat.
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
