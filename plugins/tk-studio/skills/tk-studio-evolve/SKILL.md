---
name: tk-studio-evolve
description: Evolve loop, drafting half — cluster merged observation events into the living proposals ledger, minting stable PROP-NNN rows with impact, named evidence, extracted candidate changes, and issues-ledger cross-links, updating rows in place. Drafts documents only; never applies a change. Use when the user says "draft proposals", "tk evolve", or a job's invoke-skill directive names this skill.
---

# tk-studio-evolve

The consumer half of the evolve loop (ST-041, AD-8/AD-12): merged
`measurements/` observations become `proposals/ledger.md` rows a human can
triage. The deterministic core owns the clustering and the row discipline;
judgment about what a proposal *deserves* — adopt, decline, refine — stays
with you and the operator. `tk-studio-observe` records; this skill drafts;
only a human adopts (D1: the membrane is the gate).

## Behavior (both modes)

1. **Run the core** (never hand-edit machine-owned columns):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/evolve.py" draft --directory <studio-repo-root>
   ```

   It clusters `observation` events by stated-toil similarity (defect-shaped
   events stay `tk-studio-consolidate`'s), then syncs the ledger: new
   clusters append rows with the next stable `PROP-NNN`, impact default,
   status `Draft`, evidence naming the events (count, source machines, date
   span, and the ISS id where the evidence twins an issues-ledger report),
   the candidate change the observation itself states — never one invented —
   and the affected surfaces. Existing rows update in place: Evidence,
   Opened, and Updated refresh from evidence-event dates; operator-owned
   Impact/Status and any hand-edited candidate stand; no row is ever deleted
   or renumbered. Reruns on unchanged data are byte-identical no-ops. A
   `dry_run` payload rides the core's own flag — `draft --dry-run` — which
   clusters and reports without touching the ledger.

2. **Review the result.** Read the created/updated/stranded lists. Refine
   candidates or impacts *in the ledger by hand* where your judgment beats
   the deterministic default (the core will not overwrite your edits).
   Commit `proposals/ledger.md` on a branch and let review ride the normal
   git membrane. A `stranded` row (a cluster merge left it unclaimed) is
   yours to `Declined` by hand — the core never deletes it.

3. **Read-only status** when asked what is drafted:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/evolve.py" status --directory <studio-repo-root>
   ```

4. **Attended:** summarize new and updated proposals, cross-linked issues,
   and which rows await triage. **Headless**, per outcome — never a blanket
   exit-code rule:
   - core refusal (exit 2 — missing directory, not the studio repo root,
     unparseable proposals ledger): end `blocked` with the core's named
     error as `reason`, identically under `dry_run: true` — a refusal is
     never downgraded to `complete`;
   - clean run, including a no-op (no observations, or nothing changed):
     end `complete` — a quiet ledger is a first-class result, not an error;
   - ledger synced but `stranded` rows reported: end `partial` with the
     stranded ids in `reason` — useful work landed, a human still owes a
     ruling;
   - never a prompt (AD-11). End headless runs with the status block:

   ```json
   {"status": "complete", "intent": "tk-studio-evolve", "artifacts": ["proposals/ledger.md"], "reason": null}
   ```

If the deterministic core is unrunnable — a tool call denied by permissions,
`uv`/python unavailable — end `blocked` with the status block naming the
unrunnable core as `reason`: never a question, never a headless run that
ends without the block (AD-11).

## Rules

- **Drafting triggers nothing** (D1, AD-8): this skill writes PROP rows and
  nothing else — no auto-apply, no scaffolding, no follow-on writes, no
  implementation PR. An adopted proposal becomes ordinary planned work by
  human hand.
- Rows update in place, never delete (legacy-council discipline); ids are stable
  and never reused — a wrong proposal is Declined with an edit, never erased.
- Not an emitter: drafting derives from events already emitted by their one
  named emitter each (AD-12, D2); it appends nothing to any ledger but
  `proposals/ledger.md`.
- Status moves to `Adopted`/`Declined` by operator hand or PR review only —
  this skill never sets either.
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
