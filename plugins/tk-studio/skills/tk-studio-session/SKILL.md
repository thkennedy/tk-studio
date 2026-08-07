---
name: tk-studio-session
description: Session discipline as a surface — land a boundary handoff (optionally carrying knowledge deltas) and end the session, or resume a fresh session from a run workspace alone. Use when the user says "hand off this run", "tk session", "resume the run", or a boundary/budget trigger says the session must split.
---

# tk-studio-session

Long work splits at declared boundaries (ST-6.6, spine conventions); this
skill is that discipline as an invocable surface (ST-9.2, Epic 9). Two
verbs: `handoff` lands the compact resume point and directs the session to
END; `resume` gives a fresh session everything it needs from the run
workspace alone — never by replaying history. Ending the *session* never
ends the *run*.

## Behavior (both modes)

1. Every verb goes through the deterministic core:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/session.py" handoff --directory <root> (--run-id <rid> | --job-id <id>) --boundary epic|story|phase|budget --name <boundary> --done ... --next ... [--gotcha ...] [--artifact ...] [--delta '<json>' ...]
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/session.py" resume  --directory <root> (--run-id <rid> | --job-id <id>)
   ```

   Exactly one selector: `--run-id` names the run; `--job-id` resolves the
   job's **sole** resumable run (zero or several is a named refusal, never
   a guess) — for drivers that submitted a job and never saw the minted
   run id.

2. **Handoffs carry corrections.** `--delta` (repeatable) attaches one
   structured delta — the closed `contracts/knowledge.schema.json` shape
   `{anchor, verdict: WRONG|STALE|CONFIRMED, reality, evidence, tier:
   run-local|spine}` — validated by `lib/knowledge.py` against the run
   workspace's `seed.md` (anchors defined + inherited). Unanchored,
   dangling, and duplicate deltas (same anchor + verdict + reality twice in
   one handoff — one correction, stated once) are **named rejections, never
   silently dropped**; a workspace with no seed has no anchors, so any
   delta against it dangles.
   Aid, not gate: only the delta-carrying handoff refuses — the run stays
   resumable, and a handoff without deltas lands regardless of seed state.

3. **Compact is enforced.** The 16 KB budget did not grow for deltas
   (ST-9.2 ruling): deltas share it, the list is capped at 16, and
   `reality`/`evidence` are pointers (`path:line`, a URL), not essays. Past
   either limit the handoff refuses — point at artifacts instead of
   inlining them. One `handoff.json` per run, overwritten each boundary;
   the latest boundary is the resume point.

4. **After `handoff`: END the session.** Relay the core's directive and
   stop — a handoff that keeps working is a history replay in the making.
   **After `resume`:** continue from `handoff.next` with the run record's
   checkpoint; nothing outside the workspace is required (success
   criterion 8). Surface any `deltas[]` to the operator — they are
   corrections, not decoration: a delta-carrying handoff is captured into
   the per-project reconciliation queue at the boundary (ST-9.4,
   `lib/reconcile.py`, deduped — the response's `capture` key is the
   evidence), and the wrapper's `finish` captures again at run close.

5. **Attended:** summarize the boundary, what landed, and (on resume) the
   next steps before continuing. **Headless:** an unknown/terminal run, an
   ambiguous `--job-id`, a rejected delta, or a budget overrun ends
   `blocked` with the gap named — never a prompt (AD-11). End headless
   runs with the status block:

   ```json
   {"status": "complete", "intent": "tk-studio-session", "artifacts": ["~/.tk-studio/projects/<key>/runs/<run-id>/handoff.json"], "reason": null}
   ```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- The workspace is the resumable truth: resume reads `run.json` +
  `handoff.json` + the file listing, nothing else — never replay history.
- Deltas cite identity, not location: an anchor id from the seed's
  available set, verbatim. Never invent, renumber, or "fix" an anchor to
  make a delta pass — a dangling delta means the seed moved or the claim
  is unanchored, and that is worth surfacing, not papering over.
- Provisional knowledge stays in the per-user store (AD-3): `seed.md`
  lives in the workspace, deltas ride `handoff.json` — nothing here
  touches project `kb/` (promotion is ST-9.5's PR membrane, D3).
- The contract's §2 row for this surface lands with the 1.7.0 bump
  (ST-9.6); until then the conformance manifest row is the driver-visible
  definition.
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
