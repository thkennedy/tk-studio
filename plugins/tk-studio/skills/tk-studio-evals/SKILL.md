---
name: tk-studio-evals
description: The plugin's eval runner on the sandbox tier (Story 35.5, hole 85) — runs `claude plugin eval` for the eval cases the host cannot run (they need a shell and the repository tree), writes each case's result and a scores.json, and ends with the per-case passes in the status block. Driven headless by the shipped `maintenance-evals` job; use when the payload names eval `cases`, or the user says "run the plugin evals on the sandbox".
---

# tk-studio-evals

A thin wrapper over the deterministic core `lib/evals.py run`. The core does
the work; this session only runs it once and ends with its status block.

## Behavior (headless)

1. Start the core **in the background** (Bash `run_in_background: true`: a
   case runs up to 25 min, past the Bash tool's 10-minute limit), its stdout
   to a file, with the payload's `cases` (a JSON list), `runs`, `directory`
   and `run_id`:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/evals.py" run --cases '<cases as JSON>' --runs <runs> --directory "<directory>" --run-id "<run_id>" > "${TMPDIR:-/tmp}/tk-studio-evals-<run_id>.json" 2>&1
   ```

   The core runs one `claude plugin eval <plugin> --trust-plugin
   --allow-tools Bash Write --no-publish --threshold 0 --case <c> --runs <n>
   --json <out>/<c>.json` per case and rewrites `<out>/scores.json`
   (`{cases: {<c>: {runs, passed, score}}, cli}`) after each case. A case
   scoring below its threshold is a score, not a failure.

2. Poll without ending the turn: `sleep 240` then read that file, one Bash
   call each (well under 10 minutes), until it holds the core's JSON
   status block (its last object). Never end the session while the core runs.

3. End with the core's status block, unchanged (its `artifacts` list
   `scores.json`; its `reason` is `<case> <passed>/<runs>; …`). `finish`
   lands it in the host run's `run.json` and its `job-run` line: that
   `reason` is what the operator reads; `scores.json` is the in-sandbox
   detail (the VM's run workspace).

   ```json
   {"status": "complete", "intent": "tk-studio-evals", "artifacts": ["<out>/scores.json"], "reason": "tk-studio-playable-judge-verdict 3/3; asset-ladder-generated-rung 2/3"}
   ```

   A `blocked` core result (`claude CLI unavailable`, `unknown case`, or a
   case unscored — `case <c>: no result JSON` / `unreadable run verdicts`,
   recorded in `scores.json` beside the scored cases) ends the run `blocked`
   with that reason.

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- Never prompt or ask: everything arrives in the payload; never pass
  `--dangerously-skip-permissions` to anything.
- Never edit the eval cases, the graders or the plugin; the only files this
  session writes are the core's results and its captured stdout file
  (`${TMPDIR:-/tmp}/tk-studio-evals-<run_id>.json`).
- All plugin paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
