---
id: SPEC-epic-26
companions:
  - ../../planning-artifacts/design/studio-design-spec-2026-10-09/README.md
  - ../../planning-artifacts/design/studio-design-spec-2026-10-09/feature-ledger.md
  - ../../../proposals/triage-2026-10-15.md
  - ../../planning-artifacts/briefs/advisor-tool-fit-2026-10-09.md
sources:
  - ../../planning-artifacts/epics.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Epic 26: The Service Owns Lifetime, Part 1: The Studio Side

## Why

A pain plus a mandate. The evolve loop's rulings of 2026-10-15 (`proposals/triage-2026-10-15.md`) adopted thirteen proposals for EP-26; this epic carries the ones that live in the plugin and its pipeline. The loop's own launches and meter keep costing operator passes: a relaunch ends without a status block and names the retired ClaudeOS queue (hole 20), bootstrap output trips the dirty-tree refusal (hole 10), the policy's token cap trails every measured story (hole 4), the planner leaves schema shape as a Block If (hole 19), spec file names near the Windows path limit (hole 6), meter observations die with the sandbox (hole 23), the drafter mints proposals from meter rows (PROP-067), and the canonical plan never learns a story landed elsewhere (hole 18). The routing legs also need an advisor field and explicit effort so Epic 24.3 can run its third arm. This is the second epic of the design spec's build order (README §6.2, §10); Epic 27 carries the supervisor's half, in its own repository, as one design split by repository. Trace: PROP-027, PROP-033, PROP-035, PROP-039, PROP-045, PROP-052, PROP-058, PROP-061, PROP-062, PROP-066, PROP-067; holes 4, 6, 10, 19, 20, 23 (and 18); the advisor fit note; spec §6.2 item 1 and §7.4. Repo: tk-studio (every story).

## Capabilities

- **CAP-1** (26.1)
  - **intent:** A first launch commits its own bootstrap output.
  - **success:** When the bootstrap writes `SPEC.md`, `stories.yaml` and the first plan, the launch commits them on the run branch with one named commit message before its readiness check, so the dirty-tree refusal never fires on its own output; the rule is stated once in the skill text.
- **CAP-2** (26.1)
  - **intent:** A relaunch ends exactly as a fresh launch does.
  - **success:** A relaunch on an epic with stories already `done` and routing already applied ends with the JSON status block as its last output, exactly as on the fresh path; the watch hint names the supervisor's status page and the `status` verb, never ClaudeOS; a conformance drive covers the relaunch case beside the fresh case.
- **CAP-3** (26.1)
  - **intent:** No story runs under a policy limit the budget bands do not cover.
  - **success:** `start` and `check` compare `.bmad-loop/policy.toml` limits (`max_tokens_per_story`, wall-clock, review caps) with `.tk-studio/budget-bands.yaml`; every limit a band ceiling exceeds is a `budget_mismatch` entry carrying both numbers; `check` ends `partial` naming them; `start` refuses to start the engine on a mismatch unless the payload carries `allow_budget_mismatch: true`; the skill never edits the machine-local policy file.
- **CAP-4** (26.1)
  - **intent:** The launch changes are guarded and documented.
  - **success:** Lib suite and conformance are green including the new drives; the driver contract §2 launch row states the bootstrap commit, the relaunch block and the budget check (0.1.21, additive).
- **CAP-5** (26.2)
  - **intent:** The launch planner settles the shape of not-yet-existing artifacts before the first story is dispatched.
  - **success:** When a story's acceptance criteria require a schema entry, file or tag for an artifact only a later story or an operator action produces, `.bmad-loop/plugins/studio-pipeline/task-planning.md` has the planner record the settled shape in the SPEC's design notes (an optional or deferred entry, a per-platform map, a named placeholder rule) citing the constraining design document, never as a Block If or open question; the launch customization's consult scope names schema shape a planner matter when the design documents constrain it, and an operator ruling only when they do not.
- **CAP-6** (26.2)
  - **intent:** Story spec file names stay short enough for Windows.
  - **success:** The dispatch notes `transcribe.py` writes name the executor spec `stories/<id>-spec.md` (the id already carries the title slug); the engine's glob `<id>-*.md` still resolves it; a bare `<id>.md` is still read as pending (hole 1 unchanged); the longest resulting path on this box stays under 200 characters.
- **CAP-7** (26.2)
  - **intent:** Both planner rules are pinned and documented.
  - **success:** Transcription tests pin the new name, a planner-note fixture pins the settled-shape rule, and runbook §3.8 names both.
- **CAP-8** (26.3)
  - **intent:** Every pipeline leg can declare an optional advisor model.
  - **success:** A leg in `[pipeline.legs]` or `.bmad-loop/routing.toml` may carry `advisor = "opus" | "fable" | "off"`; `pipeline.py check|resolve|apply` validate it (default `off`; the advisor must rank at or above the leg's model, a violation is a named refusal); `apply` writes it into `routing.current.json`; the session leg's `claude -p` command carries `--advisor <model>` only when the leg's advisor is not `off`.
- **CAP-9** (26.3)
  - **intent:** Subagent launches carry model, effort and advisor explicitly, and advisor use leaves an audit trail.
  - **success:** Implementer and reviewer launches pass `model`, `effort` and the advisor explicitly (the executor customization reads `routing.current.json`); when an advisor is on, the dispatch note states the consult triggers as advisor instructions ("consult the advisor on: verify-red, halt, deviation above 0, a high-severity finding, a tripwire, a file outside Files, and before declaring the story done"), and a Consult Log entry is appended per advisor call.
- **CAP-10** (26.3)
  - **intent:** The meter prices advisor usage.
  - **success:** When a story's transcripts carry advisor usage, `lib/meter.py` prices it as its own leg `advisor` from the price table (a missing price is a named refusal, never a guess) and the observation names it beside the other legs.
- **CAP-11** (26.3)
  - **intent:** The advisor field is documented and guarded without changing the shipped route.
  - **success:** Driver contract §5 documents the `advisor` field and the pairing rule (0.1.21, additive); the lib suite pins the validation, the command line and the pricing; conformance is green; shipped defaults stay `advisor = "off"` on every leg.
- **CAP-12** (26.4)
  - **intent:** A sandboxed meter's observation survives the sandbox.
  - **success:** The `post_commit` meter hook inside a sandbox, when it prices a landed story, also writes the full observation envelope to `<run_dir>/transcripts/<story>/observation.json` on the mounted checkout beside `metered.json`.
- **CAP-13** (26.4)
  - **intent:** The host harvests sandbox observations into its ledger exactly once.
  - **success:** `meter.py harvest --run-dir <dir>` on the host appends each not-yet-harvested observation file to the host ledger through `observe.record_observation` exactly once (a harvested marker beside the file), reports the story keys and dollars; the seven re-recorded Epic 25 observations of 2026-10-15 are not duplicated (the marker is seeded for them).
- **CAP-14** (26.4)
  - **intent:** The evolve drafter clusters toil, not measurements.
  - **success:** `evolve.py draft` excludes observations whose description starts with `meter:` from clustering and counts them in the result as `measurements_skipped`; PROP-067's cluster is not re-created on a rerun; the lib suite pins the exclusion.
- **CAP-15** (26.4)
  - **intent:** Recreating a sandbox never loses the cost record.
  - **success:** Runbook §3.8's sandbox recreate step says to run the harvest and to export the sandbox's own ledger (`~/.tk-studio/measurements/*.jsonl` inside the microVM) to the host before `sbx rm`, with the exact commands.
- **CAP-16** (26.5)
  - **intent:** A driver can set a canonical story's status-class fields without writing canonical frontmatter itself.
  - **success:** `plansync.py status --directory <root> --id ST-NNN --status <enum> [--note <text>]` on a project whose canonical entity exists sets `status` to the canonical enum value, stamps `updated`, records the note and the caller in the entity's `external.driver` snapshot (never touching `external.<backend>`), re-syncs the projection and the index, and names every written file in its result; a value outside the enum and an unknown id are named refusals.
- **CAP-17** (26.5)
  - **intent:** The pull-back works for stories a loop landed in another repository.
  - **success:** For a transcribed epic's story, the verb called on the owning project with that story's canonical id updates the canonical file there and nothing in the other repository, and the result says which plan it wrote.
- **CAP-18** (26.5)
  - **intent:** The verb is contracted and driven by conformance.
  - **success:** Driver contract §4 documents the verb as additive (0.1.21); the conformance manifest drives it (a headless success and a refused id); the lib suite pins the enum, the snapshot and the projection re-sync; `plan/index.md` reflects the change after a run.

## Constraints

- Every headless path of every surface ends with the AD-11 status block; conformance gates every story (AD-19).
- Driver contract changes are additive: 0.1.20 → 0.1.21, one bump shared by 26.1, 26.3 and 26.5.
- The bands are the single budget truth; the launch reports and refuses, and never edits `.bmad-loop/policy.toml` (machine-local, gitignored).
- AD-4, AD-5: drivers never write canonical frontmatter; the adapter verb is status-class only.
- AD-14: shipped routing defaults change only on a measured verdict; `advisor` ships `off` on every leg until Epic 24.4 records one.
- Pricing never guesses: a missing price is a named refusal.
- The engine's spec glob `<id>-*.md` and the pending read of a bare `<id>.md` (hole 1's fix) stay intact.
- Lib suite tests make no network call.
- Rulings in force and not reopened: 2026-09-26, 2026-10-09, O5, AD-21, AD-22, design spec D1 to D10.

## Non-goals

- Engine lifetime, worktree per run, the PR at the end, the close-out path and the host-tier Windows verify leg (the supervisor's half: Epic 27 and later EP-26 work).
- Calling the status verb from the supervisor (Epic 27 consumes it).
- Switching any shipped leg to an advisor or a cheaper model (Epic 24.3/24.4 measure first).
- Editing a machine-local `policy.toml` to fix a mismatch.

## Success signal

- A relaunch of this epic after it lands ends with the status block and a supervisor watch hint; a fresh launch commits its bootstrap and refuses on a band/policy mismatch unless allowed; a recreated sandbox's meter observations appear once in the host ledger; `plansync.py status` moves a canonical story to `review` and `plan/index.md` shows it; lib suite and conformance are green at contract 0.1.21.

## Assumptions

- Band-to-policy mapping: the largest band's `weighted_tokens` against `max_tokens_per_story`, its `review_cycles_max` against `max_review_cycles`; a policy limit the bands carry no field for (the wall-clock `session_timeout_min`) is listed as not compared, never a mismatch, until the bands carry it.
- The run branch is the checkout's current branch at launch (`loop/epic-<N>`); the bootstrap commit message is `loop(epic-<N>): SPEC, manifest and first-story plan from the launch bootstrap` (the Epic 24 and 25 convention).
- Pairing rank for the advisor: `fable` > `opus` > the smaller models; a leg whose model ranks above its advisor is refused (`briefs/advisor-tool-fit-2026-10-09.md`).
- The caller recorded in `external.driver` comes from an optional `--caller` flag, defaulting to the invoking surface name.

## Design notes (settled shape, planner, 2026-10-15)

- CAP-2: the launch core's every verb result ends with the AD-11 keys `status`, `intent`, `artifacts`, `reason` (the Story 25.5 doctor precedent); the skill ends every path, fresh or relaunch, with the last core result's block. Conformance extends `expect: "status-block"` to surface drives (additive §8), with an optional declared `status`.
- CAP-3: mismatches live in a `budget` result field (`compared`, `budget_mismatch`, `not_compared`), never in `gaps[]`; `start` refuses unless `--allow-budget-mismatch` (the payload's `allow_budget_mismatch: true`).
- Full detail: `plans/26-1.md` "Settled shape".
