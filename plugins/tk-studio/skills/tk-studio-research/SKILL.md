---
name: tk-studio-research
description: Run a chartered research pass — survey the topics a charter scopes, grade every finding by evidence, land the findings in the run workspace, and emit observation events for recommendation-worthy ones. Use when the user says "run the ecosystem watch", "tk research", or a research job's invoke-skill directive names this skill.
---

# tk-studio-research

The research half of the evolve loop's input engine (ST-6.4, AD-8: observe
and log only — findings feed recommendations, they never trigger changes).
The deterministic core keeps a run honest at both ends: no charter, no run;
no evidence grade, no finding.

## Behavior (both modes)

1. **Charter first.** The scope arrives in the payload (a job run carries it
   at `target.payload.charter`); validate it before any research:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/research.py" charter --charter '{"topics": ["..."], "sources": ["..."]}'
   ```

   Topics and sources are required and non-empty — an unscoped "go
   research" ends `blocked` (headless) or asks once for scope (attended).

2. **Seed the run (when anchors matter).** If the run's findings will cite
   or correct standing assumptions, author a per-run seed and land it
   through the core before researching (knowledge.schema.json shape —
   `tier: seed`, the verbatim supersede header, `[SEED-<run-id>-A<n>]`
   anchors, `inherits:` listing any project-spine anchors reused):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/research.py" seed --directory <root> --run-id <rid> --file <seed.md>
   ```

   The core validates via `lib/knowledge.py`, verifies `inherits` against
   the project spine when one exists, and reports a missing spine without
   blocking — aid, not gate. A run that cites no anchors needs no seed.

3. **Research within budget.** Survey the chartered topics through the
   chartered sources only. When running as a job (an `invoke-skill`
   directive from tk-studio-job), call `jobrun.py account --turns 1` every
   iteration and stop the moment it answers `within_budget: false`. Cap
   output at the charter's `max_findings` — depth beats sprawl.

4. **Grade everything.** Every finding carries an evidence grade and its
   trail: **A** primary source, verified directly; **B** multiple
   independent sources agree; **C** single credible source; **D** inference
   or speculation. A finding worth acting on carries a `recommendation`
   with a concrete action. A finding about a seeded assumption cites it:
   optional `anchor` = a bare anchor id from the seed's available set
   (defined + inherited) — dangling citations are named rejections.

5. **Land and emit through the core** (never hand-write the artifacts):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/research.py" record --directory <root> --run-id <rid> --findings-file <findings.json>
   ```

   The core validates the grades (and any anchor citations against the
   seed), lands `findings.json` + `findings.md` in the run workspace,
   reports project-spine presence, and emits one `observation` event per
   recommendation-carrying finding (source `research-job`) — this surface's
   own events; the job wrapper's `job-run` event stays the wrapper's
   (AD-12). Then end the run via `jobrun.py finish`.

6. **Attended:** summarize the graded findings and where they landed.
   **Headless:** a missing/invalid charter ends `blocked`, a budget hit
   ends `partial` with the guard named — never a prompt (AD-11). End
   headless runs with the status block:

   ```json
   {"status": "complete", "intent": "tk-studio-research", "artifacts": ["findings.json", "findings.md"], "reason": null}
   ```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## The spine flavor (project scope)

A chartered research run may be charged with authoring or growing the
**project research spine** — the broad once-per-project assumption map that
seeds inherit. Same discipline, different scope: research the project's
actual systems and invariants within the charter, then land through the
core (never hand-write into the store):

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/lib/research.py" spine --directory <root> --run-id <rid> --file <spine.md>
```

The artifact carries `tier: spine`, the verbatim supersede header, and
`[SPINE-A<n>]` anchors; it lands at `~/.tk-studio/projects/<key>/knowledge/spine.md`
(per-user store, D2 — provisional knowledge never lands on the project
VCS). Anchor ids are append-only: re-authoring must keep every existing
id, or the core refuses — queued deltas cite identity.

## Rules

- Observe and log is the boundary (AD-8): findings and observations only —
  never draft skills, edit configs, or open PRs from a research run.
- Ungraded or evidence-free claims don't land: grades A–C require a
  non-empty evidence trail; only D may stand bare, marked speculative.
- Recommendation-worthy = carries a concrete `recommendation.action`; that
  is what emits an observation, nothing else.
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
