# Brief — The nightly hygiene pass: the timer, the model pin, the bounds (2026-11-09)

The research charter behind `research.md`, kept as the record of what was asked.

## Decision being served

**Epic 41: the nightly hygiene ("dreaming") pass.** Tim on DW-86 (TKSTUDIO-219, 2026-11-05): no slice and no crusade; duplicate consolidation becomes the incremental work of a scheduled self-evolution pass, nightly to begin with, that takes the safe low-hanging fruit the way an engineer who comes across a duplicate does. Tim on DW-179 (TKSTUDIO-260, 2026-11-09): "A - Let's plan for it to be epic 41. Also let's plan on using Fable 5.2 for it". The plan needs two things settled from the repository before its stories can be written: what would start a job by the clock (hole 126: nothing does), and what "using Fable 5.2" changes, for the runs that build the epic and for the pass itself.

## Dimensions

1. **What fires a job today.** The directive a job's cadence resolves to, the supervisor's pacer and tick step, the queue rules a timer can lean on (the idempotent mint, the checkout lock, the host verify leg's lease, the service events), and what is missing for a declared `cron` job to run with nobody posting it. File and line at `97ce4051`.
2. **How a model and an effort are chosen**, for a worker session and for an engine leg: the tiers, the files, the lists that accept or refuse an id, the price table, and where `claude-fable-5-2` stands in each. Whether a per-job pin exists or must be built.
3. **Prior art in this repository** for a bounded, unattended maintenance run: `maintenance-evals`, `run-sweep` and `launch.py sweep`, the evolve, consolidate and knowledge loops, Story 36.7's shared homes, and DW-86's remaining list.
4. **The pass's shape and its bounds**: one class a night, where the callers are few and the tests cover them; what keeps it off a live run's checkout and away from a live host leg; what it reports; what holds it when nobody has looked; how its cost reaches Epic 40's store.

## Knobs in force

Preset light: one pass over the repository at `97ce4051` in a worktree, read-only, no subagent. No web source was read: this pass ran with no network beyond `git` and `gh` against this repository, so no external claim is made and the one external fact the plan needs (Fable 5.2's list price) is carried as a question. No test suite and no supervisor, sandbox or queue command was run (a run was live on the box). The supervisor's own config on the agent PC was not read.

## Research firewall

Nothing external entered. The owner's words are quoted from the ledger (DW-86, DW-179) and the two tickets; everything else is the repository's own code and records, with file and line.

## Output

`research.md`: an executive summary, one section per dimension, the choices made and the caveats, what the pass could not verify, and a staleness map.
