# Reconcile: evaluate a unit's deviations and record exactly one verdict

Ported from The Universe Awaits (which took it from ClaudeOS `agentic-pipeline-2026-09-02.md` §4, step 6.4) and adapted to tk-studio.

Your first job is to **evaluate, not rewrite**. Most deviations change nothing downstream. Only a verdict that names affected later work leads to any change. Even then, you never edit a story that is in flight, and you never edit `epics.md`: changing the plan is the operator's `bmad-correct-course`.

## 1. Locate the unit

Resolve the unit's spec file, in this order:

1. `_bmad-output/implementation-artifacts/spec-<key>.md`
2. the single file matching `_bmad-output/specs/*/stories/<key>-*.md`

If neither exists, or more than one file matches, stop and report `spec not found for <key>`. The gate then ends `blocked`.

## 2. Read the deviation score

Read the spec's frontmatter `deviation_score` (0 none, 1 small, 2 medium, 3 large), its `## Deviation Summary`, and every `DRIFT:` line.

When the score is missing:

- **No `DRIFT:` lines either:** treat the score as 0.
- **`DRIFT:` lines present:** score 1 if every line says `affects: none`, otherwise 2.

**Score 0–1:** set frontmatter `reconcile_verdict: not-required` and append:

```markdown
## Reconcile

- <date> — score <n>; reconcile not required.
```

Then stop. Read nothing else: this path must stay cheap.

## 3. Evaluate (score 2–3)

Read only what exists, in this order:

1. The spec's `## Deviation Summary`, its `DRIFT:` lines and its `## Spec Change Log`.
2. The unit's own story section in `_bmad-output/planning-artifacts/epics.md` (`### Story N.M:`), plus its epic's narrative. This is the contract the deviation is measured against.
3. The later stories that could depend on this one: every later entry of `stories.yaml`, and the later epics' sections that name this story, its files, or a surface it changed. For each, look for any of these:
   - a story that assumes a verb, field, event or file this unit changed
   - a Given/When/Then that no longer holds
   - an epic narrative that names this story's outcome
4. The binding constraints:
   - the architecture spine (`_bmad-output/planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md`, AD-1 … AD-20)
   - `plugins/tk-studio/contracts/driver-contract.md` and the schemas beside it
   - the rulings recorded in the planning passes under `_bmad-output/planning-artifacts/briefs/`
5. `_bmad-output/implementation-artifacts/replan-queue.md`, if it exists.

For each deviation, decide whether a later story was planned against the thing that changed. Cite the story key and the sentence that no longer holds. A deviation that touches nothing later work relies on is **not** affecting, however large it looks.

## 4. Verdict: exactly one

| Verdict | When | Action |
|---|---|---|
| `no-impact` | No later story relies on anything that changed. | Record only. |
| `adjust-stories` | One or more later stories are affected, but notes in their `invoke_dev_with` can absorb it (a renamed file, a moved seam). | Queue one entry per affected story (section 5). |
| `escalate` | Any one of these: the deviation contradicts an AD, a published contract surface or schema, or a recorded ruling; the score is 3; a later story's acceptance criteria would have to change (that is `bmad-correct-course`, the operator's call); or you cannot determine the impact from the files above. | Record why. The commit gate pauses the run so a human decides. |

When two verdicts apply, the more conservative wins: `escalate` > `adjust-stories` > `no-impact`.

## 5. Record

1. Set frontmatter `reconcile_verdict: <verdict>` on the spec.
2. Append a `## Reconcile` section to the spec, creating it if absent:

```markdown
## Reconcile

### <date> — <verdict>

- Score: <n>
- Reasoning: <2–5 sentences>
- Affected: <story key — the sentence that no longer holds> (one per line; `none` for no-impact)
- Invariant: <AD / contract section / ruling contradicted, or `none`>
```

3. For `adjust-stories`, append one entry per affected story to `_bmad-output/implementation-artifacts/replan-queue.md`, newest last. If the file is absent, create it with the heading `# Replan queue`.

```markdown
## <affected story key> — scope: stories — from <this unit key> — <date>

- What changed: <one line>
- What no longer holds: <the quoted sentence>
- Suggested adjustment: <one or two lines for its invoke_dev_with — a suggestion, not a decision>
- Status: open
```

For `escalate`, also append one entry with `scope: operator` and `Status: open — needs bmad-correct-course`.

Part A never edits any of these: `stories.yaml`, `epics.md`, or any other unit's spec. The queue is the whole hand-off.
