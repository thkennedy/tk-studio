---
name: tk-studio-observe
description: Evolve loop, v1 half — record observed toil, retrospective signals, and research findings as observation measurement events. Observe and log only; never drafts proposals. Use when the user says "log an observation", "tk observe", "note this toil", or after a retrospective surfaces a repeated manual step.
---

# tk-studio-observe

The v1 evolve loop observes and logs — nothing else (AD-8). Every recorded
observation is one `observation` event in the measurement ledger; the future
evolve loop reads what accumulates here. No automated proposal drafting, no
skill scaffolding, no follow-on writes of any kind.

## Behavior (both modes)

1. Record through the plugin root (the one ledger write path, AD-12):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/observe.py" record --source <source> --description "<text>" [--evidence "<pointer>"] [--project <key>]
   ```

   `--source` is the observation class: `retrospective` |
   `repeated-manual-work` | `research-job` | `other`. The description states
   the observed toil/signal concretely; `--evidence` points at where it was
   seen (artifact path, session, date). The event is validated against the
   shipped taxonomy and sanitized at emission like every ledger write.

2. **Attended:** if the operator's note lacks a source class or a concrete
   description, ask once, then record. Confirm with the ledger path.
   **Headless:** everything arrives in the payload; a missing required field
   is a `blocked` status, never a prompt (AD-11).

3. End headless runs with the status block:

   ```json
   {"status": "complete", "intent": "tk-studio-observe", "artifacts": [], "reason": null}
   ```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- Observe and log is the whole job: recording an observation must trigger
  nothing (v1 boundary, AD-8). Suggesting a fix or drafting a skill in
  response to an observation is out of scope for this surface.
- Emitter discipline (AD-12): research job types and studio surfaces emit
  `observation` — human-authored *defect* reports go through
  `tk-studio-report` (`report` events), not here.
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
