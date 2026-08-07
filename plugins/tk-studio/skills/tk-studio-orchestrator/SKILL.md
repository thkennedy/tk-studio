---
name: tk-studio-orchestrator
description: The studio's front door — resolve who you are (role, per-user store), what this project needs (confirmed working_set.<role>), and route to resources by name, statelessly. Use when the user says "enter the studio", "tk studio", "orchestrate", "convene the council", or asks what to work on through the studio.
---

# tk-studio-orchestrator

One entry point, any mode (AD-9, AD-11, AD-17). The core is stateless: every
activation resolves fresh from the per-user store and project config — no
session state, no identity machinery. Attended sessions may layer the council
persona shell (ST-5.2) on top; routing never lives in the shell.

## Flow (both modes)

1. **Resolve** (read-only, deterministic):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/orchestrate.py" resolve --directory <project-root> [--role ROLE]
   ```

   Role comes from the per-user store (`--role` is the runtime override);
   the working set comes from tracked config `working_set.<role>` — only the
   caller's role's entry, never another role's.

2. **Attended only — load the council shell** (ST-5.2), after resolution:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/orchestrate.py" shell
   ```

   The shell (`council/shell.md`, `council/convene.md`) is presentation
   data: persona voice and the "convene the council" interaction — routes
   presented as seats, multi-perspective deliberation over installed agents,
   one synthesis. It carries no state, writes nothing, and never alters a
   routing decision. **Headless runs skip this step entirely** and must
   produce identical routing and artifacts.

3. **On `ready`** — present the role framing and route by name-based handoff:
   - `developer` → execution framing: offer the working set's implementation
     workflows (dev-story, code review, sprint status, direct dev).
   - `direction-giver` → delegation/synthesis framing: offer shaping,
     convening, delegation, and synthesis over the working set.
   - Handoff is by resource name — stock BMad skills included, invoked
     untouched (AD-4, zero forks). Routes marked `missing` or
     `known-uninstalled` are surfaced with their note (fix-guided, e.g.
     `tk install`), never silently dropped or substituted.

4. **On `needs-onboarding`** — the gap is named in `gaps[]`; a working set is
   **never invented** (AD-17):
   - **Attended:** route into `tk-studio-onboard` to close the gap (set the
     role in the store config / propose-confirm-record a working set), then
     re-resolve.
   - **Headless:** end `blocked` naming the gap. Never prompt, never guess.

## Report

- **Attended:** who you are (role + source), the framing, then the routes as
  an offer list; notes verbatim.
- **Headless:** act on the routed payload if the invocation named a target;
  end with the status block:

  ```json
  {"status": "blocked", "intent": "tk-studio-orchestrator", "artifacts": [], "reason": "needs-onboarding: working_set.developer unconfirmed"}
  ```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- The core is stateless (AD-9): nothing is written anywhere — no run state,
  no persona state, no cached resolution. Re-invocation re-resolves.
- Routing decisions must be identical attended and headless (AD-11); only
  presentation differs. The shell is presentation.
- This skill never writes `working_set` (that is `recommend.py record`,
  invoked through onboarding on explicit confirmation) and never writes the
  registry (AD-20 — onboard/activate only).
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
