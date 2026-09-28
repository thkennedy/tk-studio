# Task planning: seed the epic's manifest, plan a story just in time

This file runs on the planner tier (see the `planner` leg in `.bmad-loop/routing.current.json`) and is invoked two ways:

- **Bootstrap.** `tk-studio-launch` step 4 invokes it as "bootstrap story `<epic>-<story>`" when the epic's `stories.yaml` is missing or empty. Do sections 1, 3 and 4.
- **Story boundary.** Invoked from the studio gate's Part B, when the gate is enabled and the unit just committed was a story. Do sections 2, 3 and 4.

Adapted on 2026-09-28 from the ClaudeOS original (tag `retired-as-driver-2026-09-26`) to the pipeline this project runs. That pipeline is The Universe Awaits' v2, measured in `kb/execution-pipeline-model-routing.md`. **A unit is a whole story.** The stories in `_bmad-output/planning-artifacts/epics.md` are already sized and carry their acceptance criteria, so `stories.yaml` lists them 1:1 and nothing here breaks a story into smaller tasks. The plan file you write is the investigation a dev session would otherwise repeat blind.

You are headless (AD-11): never ask, never wait. Every uncertainty is resolved here, or it becomes a recorded `escalate`.

## 0. Inputs

- The epic's spec folder: the directory that holds (or will hold) `stories.yaml`. `plans/` and `stories/` sit beside it. It also holds `SPEC.md` and the companions named in its frontmatter.
- `_bmad-output/planning-artifacts/epics.md`: the `## Epic <N>:` narrative, which carries scope, rulings and the repo each story targets, plus every `### Story <N>.<M>:` section.
- `_bmad-output/implementation-artifacts/replan-queue.md`, when it exists.
- `.tk-studio/budget-bands.yaml`, for the S/M/L bands. It is operator-tunable, so never hard-code its numbers.
- The architecture spine (`_bmad-output/planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md`) and `plugins/tk-studio/contracts/driver-contract.md`. Read them for constraints; do not re-derive the plan from them.

## 1. Bootstrap: transcribe the epic, then plan its first story

If `stories.yaml` already has `- id:` entries, skip straight to section 3 for the named story.

Otherwise, from the project root, run:

```bash
uv run --no-project python .bmad-loop/plugins/studio-pipeline/transcribe.py --root . --epic <N> --spec-folder <spec folder, project-relative>
```

It writes one entry per story of the epic, in document order. The ids are `<N>-<M>-<slug>`, and each `invoke_dev_with` points at the story's section; the script prints JSON. On `ok: false`, end `blocked` with its `error` verbatim. Never hand-write a manifest in its place: the transcription is deterministic on purpose.

Then plan the story the launch named in section 3. That is the epic's first story unless the payload named another.

## 2. Story boundary (gate Part B): accept the finished story

Skip this section when bootstrapping.

**Audit.** The finished story is the unit that was just committed. Read its spec (`stories/<key>-*.md`): the Auto Run Result, the Deviation Summary, and the `DRIFT:` lines. Also read its `plans/<N>-<M>.md` and its acceptance criteria in `epics.md`. Judge each criterion as one of:

- `met`
- `met-with-deviation`
- `unmet`
- `unverifiable-here` (only a live or end-to-end check can confirm it; name that check)

Cite the evidence for each: a test, a file, or an Auto Run Result line. Then append to the plan:

```markdown
## Acceptance — <date>

- AC1: met — <evidence>
- AC2: unmet — <what is missing>
- Verdict: accepted | remediation | escalate
```

**Remediation.** If any criterion is `unmet`, count the story's existing remediation entries (ids `<key>-r<n>`).

- **Fewer than two:** append one entry to `stories.yaml`. Its id is `<key>-r<n>`, its description starts `Remediation:` and names exactly the unmet criteria and their evidence, and its `invoke_dev_with` points at the same story section and this plan. Record `Verdict: remediation` and go to section 4.
- **Two already:** record `Verdict: escalate` and set `reconcile_verdict: escalate` on the current unit's spec, with the reason `acceptance of <key> not converging after 2 remediation entries`. The commit gate then pauses the run. Stop there.

`unverifiable-here` criteria never block acceptance on their own. List them, and the human sees them.

**Replan queue.** For every `Status: open` entry that names an unstarted story (one with no `stories/<key>-*.md` yet), revise that entry's `invoke_dev_with` in place with the suggested adjustment. Never touch a started entry. Then set the queue entry to `Status: closed — <what you did>`.

**Next story.** It is the first entry in `stories.yaml` with no spec file and no plan. If none remains, record `epic complete: no next story` and stop. Otherwise, plan it in section 3.

## 3. Write the story plan

Read the story's section in `epics.md`, the epic narrative, `SPEC.md` and its companions, and the code the story touches. Investigate yourself, or through foreground subagents that return distilled summaries. Never read a subagent's transcript or output file.

Size the story in a band from `budget-bands.yaml`. If it plainly exceeds the largest band, do not split it here. Record `oversize` under Risks, and add a note to its `invoke_dev_with` asking the dev session to halt if the Files list grows past the band.

Create `plans/<N>-<M>.md` (a sibling of `stories.yaml`, outside `stories/`):

```markdown
---
story: "<N>-<M>"
key: "<the stories.yaml id>"
title: <story title>
status: planned
planned: <date>
band: <S|M|L>
repo: <the repo the epic narrative names for this story>
---

## Intent
<two or three sentences: the story's problem and approach, from its section and the epic narrative>

## Acceptance Criteria
<the story's criteria, verbatim, numbered AC1…>

## Code Map
<annotated paths, symbols, reuse points and read-only seams: the investigation, so the dev session does not repeat it>

## Files
<the files the story will create or modify, each marked (new) or (modify); anything outside this list is a deviation the session must record>

## Verify
<the exact commands: the project gate from the studio customization, plus any story-specific checks>

## Risks and open decisions
<anything a dev session must not decide alone, phrased as a Block If>
```

Every entry's `invoke_dev_with` already names `plans/<N>-<M>.md`, so the dev session starts from this Code Map.

## 4. Validate

Run `bmad-loop validate --project <project root> --spec <spec folder, project-relative>`. A dirty working tree is expected mid-run, so ignore that line. Fix any manifest finding. A manifest that does not parse must never be left behind: restore the previous entries and record `planning failed: <reason>` instead.

Finish with one line for the gate or launch record:

- `transcribed <n> stories, planned <key>`
- `story accepted, planned <key>`
- `remediation entry <id> appended`
- `epic complete: no next story`
