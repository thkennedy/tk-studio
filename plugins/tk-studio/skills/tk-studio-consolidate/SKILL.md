---
name: tk-studio-consolidate
description: Consolidate merged measurement data into the living issues ledger — cluster defect-shaped events, mint stable ISS-NNN entries with severity, expected-vs-actual, named evidence, and fix candidates, updating rows in place. Use when the user says "consolidate the measurements", "tk consolidate", or a job's invoke-skill directive names this skill.
---

# tk-studio-consolidate

The closing half of the measurement loop (ST-7.2, AD-12): merged
`measurements/` data becomes `issues/ledger.md` entries that lead to
specific fixes — the O1 revision channel. The deterministic core owns the
clustering and the row discipline; judgment about what a cluster *means*
stays with you and the reviewer.

## Behavior (both modes)

1. **Run the core** (never hand-edit machine-owned columns):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/consolidate.py" run --directory <studio-repo-root>
   ```

   It clusters defect-shaped events (install/activation failures,
   conformance headless-failures, drift, blocked job runs, failed
   onboarding stages, operator reports), then syncs the ledger: new
   clusters append rows with the next stable `ISS-NNN`, severity default,
   status `Open`, expected-vs-actual, evidence naming the events (count,
   type, source machines, date span), and a specific fix candidate where
   the evidence makes one clear — including "revise the distribution
   mechanism" when cross-machine drift or install failures point there
   (AD-1). Existing rows update in place: evidence and Updated refresh;
   operator-owned Sev/Status and any hand-edited fix candidate stand;
   no row is ever deleted or renumbered. Reruns on unchanged data are
   byte-identical no-ops.

2. **Review the result.** Read the created/updated entries; refine
   severities or fix candidates *in the ledger by hand* where your judgment
   beats the deterministic default (the core will not overwrite your
   edits). Commit `issues/ledger.md` on a branch and let review ride the
   normal git membrane.

3. **Attended:** summarize new and updated issues and the fix candidates
   worth acting on. **Headless:** a refusal from the core (missing
   directory, not the studio repo, unparseable ledger — exit 2) ends
   `blocked` with the core's error as `reason`; a clean no-op is
   `complete` — never a prompt (AD-11). End headless runs with the status
   block:

   ```json
   {"status": "complete", "intent": "tk-studio-consolidate", "artifacts": ["issues/ledger.md"], "reason": null}
   ```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- Rows update in place, never delete (tk discipline); ids are stable and
  never reused — a wrong finding is corrected with an edit, never erased.
- Not an emitter: consolidation derives from events already emitted by
  their one named emitter each (AD-12); it appends nothing to any ledger
  but `issues/ledger.md`.
- Fixes are *candidates*: consolidation names them, review adopts them —
  no fix is applied from this skill.
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
