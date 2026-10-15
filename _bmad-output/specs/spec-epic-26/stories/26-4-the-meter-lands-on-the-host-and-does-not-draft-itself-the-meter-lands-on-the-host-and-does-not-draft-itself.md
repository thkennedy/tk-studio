---
title: 'The Meter Lands on the Host and Does Not Draft Itself'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_revision: '81823ad5b76cfb5701012022018d5ebb9d719a2f'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-26/plans/26-4.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The `post_commit` meter inside a microVM records its observation only in the sandbox's own ledger, so recreating the sandbox loses the cost record (hole 23). Separately, `evolve.py draft` clusters `meter:` observations into proposals (PROP-067).

**Approach:** The meter also writes the emitted envelope as `observation.json` beside `metered.json` on the mounted checkout. A host-side `meter.py harvest` appends each envelope to the host ledger once, guarded by a `harvested.json` marker. `evolve.py draft` skips `meter:` observations and counts them. Runbook §3.8 gains the recreate step. The shape is settled in `plans/26-4.md` "Settled shape" items 1–4, which this spec adopts verbatim.

User story (epics.md §Story 26.4): As the operator, I want every landed story's meter observation to reach the host ledger even when the engine runs in a microVM, and the evolve drafter to leave measurements alone, So that recreating a sandbox never loses the cost record again (hole 23) and proposals are minted from toil, not from meter rows (PROP-067).

Acceptance criteria (transcribed verbatim):

- AC1: **Given** the `post_commit` meter hook inside a sandbox **When** it prices a landed story **Then** it also writes the full observation envelope to `<run_dir>/transcripts/<story>/observation.json` on the mounted checkout beside `metered.json`, so the record survives the sandbox.
- AC2: **Given** `meter.py harvest --run-dir <dir>` run on the host **When** it finds observation files not yet harvested **Then** it appends each to the host ledger through `observe.record_observation` exactly once (a harvested marker beside the file), reports the story keys and dollars, and the seven re-recorded Epic 25 observations of 2026-10-15 are not duplicated (the marker is seeded for them).
- AC3: **Given** `evolve.py draft` **When** it clusters observations **Then** observations whose description starts with `meter:` are excluded from clustering and counted in the result as `measurements_skipped`; PROP-067's cluster is not re-created on a rerun, and the lib suite pins the exclusion.
- AC4: **Given** runbook §3.8 **When** the story closes **Then** the sandbox recreate step says to run the harvest and to export the sandbox's own ledger (`~/.tk-studio/measurements/*.jsonl` inside the microVM) to the host before `sbx rm`, with the exact commands.

## Boundaries & Constraints

**Always:**
- Use stdlib only and write atomically with `_atomic_write_text`.
- `metered.json` stays the last write, the done marker.
- In `harvest`, the append comes before the marker.
- Validate every candidate file before anything is appended.
- Lib tests isolate the store with `TK_STUDIO_HOME` and make no network call.
- Plan Files are the boundary: `meter.py`, `evolve.py`, `tests/test_meter.py`, `tests/test_evolve.py`, `kb/agent-pc-setup-runbook.md`.

**Block If:**
- A criterion needs an edit to `epics.md`, `SPEC.md` or its companions, `stories.yaml`, `proposals/ledger.md`, `measurements/*.jsonl`, `.bmad-loop/routing.toml` or `.bmad-loop/policy.toml`, a run dir or archive under `.bmad-loop/`, bmad-loop itself, or `/home/agent/.claude/skills/tk-studio`.
- AC1 turns out to need sandbox detection in `meter_hook.py`.

**Never:**
- Run `harvest` against a real `.bmad-loop/runs/*` dir in this sandbox. Use temp dirs only.
- Run `evolve.py draft` against the repo without `--dry-run`.
- Edit `meter_hook.py`, the driver contract or the conformance manifest.
- Append the SPEC.md design-notes bullet.
- Fold in 26-2's deferrals or the `advisor_message` placeholder.
- Have `harvest` write `meter-refusal.json`.
- Dedupe across ledgers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Metered run | `story` with record | `observation.json` equals the ledger envelope line and is written before `metered.json` | — |
| `--no-record` | `story --no-record` | Neither file is written | — |
| Harvest, new sandbox file | Envelope user/machine is not this ledger | Appended once through `record_observation`, `harvested.json` written with how=appended, reported in `harvested` with `usd_total` | — |
| Harvest rerun | `harvested.json` present | Reported in `already_harvested`, nothing appended | — |
| Seeded key | Key in `HARVEST_SEEDED` (the seven 25-x keys) | Marker written with how=seeded, nothing appended, reported in `seeded` | — |
| Host-emitted | Envelope `<user>-<machine>.jsonl` equals `ledger_path().name` | Marker written with how=in-ledger, nothing appended | — |
| Pre-26.4 dir | Only `metered.json` | Ignored and not reported | — |
| Bad file | Not JSON, or no string `description`/`source` | `{"ok": false, "error": "observation <path> is unreadable: <why>"}`, exit 2 | Nothing appended |
| Missing dir | `--run-dir` absent | `run dir <dir> does not exist`, exit 2 | — |
| Draft with meter rows | `meter:` observations present | Not clustered, `measurements_skipped` = count; a row keyed by their slug is not re-created, updated or `stranded` | — |
| Draft, no measurements | — | `measurements_skipped: 0` | — |

</intent-contract>

## Code Map

The full map is in `plans/26-4.md` "Code Map", verified at HEAD `81823ad`. The anchors still hold:

- `plugins/tk-studio/lib/meter.py`:
  - `MARKER` l.69 and `REFUSAL` l.70.
  - `_atomic_write_text` l.80.
  - `record()` l.534: the `record_observation` call at l.548 discards the envelope. Keep it, and write `observation.json` before `metered.json`.
  - `meter_story` l.560.
  - `main` l.640: subparsers at l.644. Dispatch is not keyed on `args.command`. Add a `harvest` parser and branch on it.
- `plugins/tk-studio/lib/observe.py` `record_observation` l.30 returns the envelope.
- `plugins/tk-studio/lib/ledger.py`: `ledger_path()` l.166, `_safe_name` l.162, `emit` l.201.
- `plugins/tk-studio/lib/evolve.py`:
  - `_slug` l.155.
  - `cluster` l.178.
  - `draft` l.359: early return l.368, `clusters = cluster(events)` l.380, `stranded` l.451.
  - Trap: PROP-067's row (`proposals/ledger.md:105`) would become `stranded` once meter rows are excluded. Exclude meter slugs from `stranded`.
- `plugins/tk-studio/lib/tests/test_meter.py`: `setUp` l.52, `run_cli` l.104, `ledger_lines` l.112, `basic_story` l.122.
- `plugins/tk-studio/lib/tests/test_evolve.py`: `_obs` l.35, `_write`/`_rows`/`_seed` l.66–95.
- `kb/agent-pc-setup-runbook.md` §3.8 (l.590):
  - The create command is at l.603–606.
  - The `MSYS_NO_PATHCONV=1 sbx exec` form is at l.647–652.
  - The "sandbox store" paragraph is at l.654–670.
  - "Running an epic" is at l.720, item 4 at about l.732.
- `.bmad-loop/plugins/studio-pipeline/meter_hook.py` is read-only. It calls `meter.py story`, so AC1 rides `record()`.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/meter.py`, which carries Settled shape 1–2:
  - Add `OBSERVATION`, `HARVESTED` and `HARVEST_SEEDED`. `HARVEST_SEEDED` is a frozenset of the seven 25-x keys with the provenance comment.
  - Make `record()` write `observation.json`.
  - Add `harvest(run_dir) -> dict` with cases (a)–(d), validation first, append before marker, and `usd_total` from `metered.json`.
  - Wire the `harvest` subparser into `main` with the `{"ok": ...}` exit 0/2 convention.
  - Update the docstring CLI block.
- `plugins/tk-studio/lib/evolve.py`, which carries Settled shape 3:
  - Split off `meter:` observations before `cluster()`.
  - Add `measurements_skipped`, including on the early return.
  - Exclude their slugs from `stranded`, and leave those rows untouched.
- `plugins/tk-studio/lib/tests/test_meter.py`: test every meter/harvest row of the I/O matrix. Include exactly-once across two harvests, and assert that `HARVEST_SEEDED` holds exactly the seven keys.
- `plugins/tk-studio/lib/tests/test_evolve.py` must cover four cases:
  - The exclusion and its count.
  - The PROP-067 case: a seeded row keyed by a meter slug is not re-created, updated or stranded on a rerun.
  - `measurements_skipped: 0` on the early return.
  - A non-`meter:` observation that mentions "meter" still clusters.
- `kb/agent-pc-setup-runbook.md`, which carries Settled shape 4:
  - Add the **"Recreating a sandbox without losing the cost record"** paragraph after the sandbox-store paragraph. It has three steps: export (exact command), harvest (exact command), then `sbx rm` and recreate.
  - Add one sentence on merging the exported file and on the double-count note.
  - Add one sentence to item 4.

**Acceptance Criteria:**
- Given AC1–AC3, when the lib suite runs, then the new tests in `test_meter.py` and `test_evolve.py` pass and pin each behaviour.
- Given the repo, when `evolve.py draft --directory . --dry-run` runs, then `measurements_skipped: 7`, `created: []`, `stranded: []` and `wrote: false`.
- Given AC4, when `kb/agent-pc-setup-runbook.md` §3.8 is grepped, then it shows the export command, the `meter.py harvest` command and `sbx rm`, in that order.

## Spec Change Log

## Design Notes

The settled shape is in `plans/26-4.md` items 1–4, and it is binding. Three points matter most:

- The harvested copy carries the host's `ts`, `user` and `machine`. The original stays in `observation.json`.
- A crash between append and marker can re-append once. This is accepted and documented in the docstring.
- 26-1 to 26-3 of this run have only `metered.json`. They are recovered only through the AC4 export.

## Verification

**Commands** (from `plugins/tk-studio/lib`):
- `uv run python -m unittest discover tests`: green.
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- From the repo root, `uv run --no-project python plugins/tk-studio/lib/evolve.py draft --directory . --dry-run`: `measurements_skipped: 7`, `created: []`, `stranded: []`.
- `grep -n "harvest\|sbx rm\|measurements/\*.jsonl" kb/agent-pc-setup-runbook.md`: shows the recreate steps in §3.8.

## Deviation Summary

### pass 1 (2026-10-15, implementer)

- planned: one sentence on merging the exported file and the double-count note / actual: three sentences (extra file never pushed, merging is the operator's call; double count; what the export carries) / why: plan Settled shape 4 asks for all three points / may affect: none
- planned: harvest step's exact command uses `--run-dir .bmad-loop/runs/<run-id>` / actual: copied verbatim from the plan, framed "from the tk-studio checkout, once per run dir" / why: the spec adopts the plan verbatim; the path resolves only for tk-studio's own runs / may affect: none

DEVIATION SCORE: 1

Consult ruling (accept-deviation score 1): entry 1 is withdrawn, because plan Settled shape 4 asks for all three points. Entry 2 is corrected to an absolute project path.

DRIFT: runbook §3.8 harvest command uses `--run-dir /c/GitHub/<project>/.bmad-loop/runs/<run-id>` instead of the plan's tk-studio-relative `.bmad-loop/runs/<run-id>`: the relative path resolves only for tk-studio's own runs, which breaks AC4's exact command for any other project's sandbox (consult ruling) — affects: none

### pass 2 (2026-10-15, implementer, consult fix)

DEVIATIONS: none (the step-2 `--run-dir` was changed as the consult directed).

### pass 3 (2026-10-15, implementer, review patches)

The implementer reported two entries at score 1:
1. The pre-check also covers a blank description and a non-string `project`.
2. A non-string user or machine falls to the append branch.

The consult rejected both: they are within the brief and Settled shape 2. The pass scores 0 and adds no DRIFT line.

### pass 4 (2026-10-15, implementer, follow-up review patches)

DEVIATIONS: none. The patches are prose only, inside the §3.8 recreate paragraph, and every command is byte-for-byte unchanged. DEVIATION SCORE: 0.

## Consult Log

- 2026-10-15T20:58:15Z — trigger: deviation-gt-0 — question: accept, reject or fix the two runbook §3.8 deviations (three sentences instead of one; tk-studio-relative harvest `--run-dir`) — ruling: accept-deviation score 1 — do: withdraw entry 1 (plan Settled shape 4 asks for all three points); change the step-2 harvest command to `--run-dir /c/GitHub/<project>/.bmad-loop/runs/<run-id>`, still run from the tk-studio checkout, and record that as the sole DRIFT at score 1; change nothing else in the paragraph — rule candidate: Runbook commands that a plan writes for a generic `<project>` sandbox must use absolute `/c/GitHub/<project>/…` paths, not paths relative to the tk-studio checkout.

- 2026-10-15T21:04:40Z — trigger: deviation-gt-0 (review-patch pass) — question: are the extra pre-checks (blank description, non-string project) and the non-string user/machine fall-through deviations? — ruling: reject-deviation — do: drop both score-1 entries, score the pass 0, add no DRIFT line, keep the code and tests — rule candidate: When a brief says to pre-check what a downstream call rejects, pre-checking the rejections that call actually raises is in scope and scores 0. So does falling through to the plan's default branch when a match key cannot be built. Neither needs a DRIFT line.

## Review Triage Log

### 2026-10-15 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 2, low 2)
- defer: 0
- reject: 3: (high 0, medium 1, low 2)
- addressed_findings:
  - `[medium]` `[patch]` `_read_observation` did not pre-check everything `record_observation`/`emit` reject (unknown source, non-string evidence/project, blank description), so a later bad file could be refused after earlier ones were appended and marked. Fixed: all four are pre-checked, and tests extend the bad-file case (blind-hunter + edge-case-hunter, deduped).
  - `[medium]` `[patch]` The in-ledger check rebuilt the ledger file name without `_safe_name`, so a host envelope with a rewritten user or machine would be appended twice. Fixed: `_ledger_name_of` uses `ledger._safe_name`, and `test_harvest_in_ledger_check_uses_safe_names` pins it.
  - `[low]` `[patch]` A corrupted `observation.json` in an already-harvested dir refused every later harvest of that run dir. Fixed: marked dirs go to `already_harvested` unread; tested.
  - `[low]` `[patch]` The runbook export could be empty before `sbx rm`. Fixed: step 1 gains a `test -s … && wc -l …` check and the same-day overwrite note.
- rejected:
  - `[medium]` A failed `observation.json` write after the emit re-emits on retry. The window between emit and marker predates this story, and Settled shape 1 fixes the order.
  - `[low]` A `HARVEST_SEEDED` key in a future run dir is only marked. This is by design: the seeded constant is Settled shape 2(b).
  - `[low]` The runbook does not name which machine harvests. It already says "all from the host".

### 2026-10-15 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 1, low 1)
- defer: 0
- reject: 4: (high 0, medium 1, low 3)
- addressed_findings:
  - `[medium]` `[patch]` The §3.8 export file name is per day, so a second recreate of the same sandbox on the same day overwrites the first sandbox's only exported ledger copy (blind-hunter). Fixed: the overwrite sentence now tells the operator to rename or merge the earlier export before exporting again. The command is unchanged.
  - `[low]` `[patch]` The runbook gave no recovery path when `meter.py harvest` refuses (blind-hunter). Fixed: step 2 now says a refusal names the unreadable `observation.json` and appends nothing, to fix or move the file aside and rerun, and that run dirs live on the host checkout under `/c/GitHub/<project>/.bmad-loop/runs/` and survive the recreate.
- rejected:
  - `[low]` `HARVEST_SEEDED` matches the bare story key, so a relaunched Epic 25 story would only be marked (blind-hunter and edge-case-hunter, deduped). AC2 names a seeded marker for those keys, and the prior pass already rejected this as Settled shape 2(b).
  - `[medium]` A harvest run inside the sandbox stamps `in-ledger` markers that a host harvest then skips. AC2 scopes harvest to the host ("run on the host"), and the runbook says "all from the host".
  - `[low]` The `in-ledger` branch compares only the ledger file name. This is Settled shape 2(c), and a host/sandbox user-machine collision is not a planned path.
  - `[low]` `_read_observation` does not check `event == "observation"` or the `meter:` prefix. `record()` is the file's only writer and always writes a meter observation envelope.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5 (effort medium, advisor off on every leg); knowledge spine absent

**Run type.** Follow-up review pass. The prior run recommended one, with score 8. The implementation (commit 9f4ede1) stands as summarized in that run:
- The meter writes `transcripts/<story>/observation.json` before `metered.json` (AC1).
- `meter.py harvest --run-dir <dir>` appends each unharvested envelope once through `observe.record_observation`, behind a `harvested.json` marker, and seeds the seven Epic 25 keys (AC2).
- `evolve.py draft` skips `meter:` observations and counts them as `measurements_skipped` (AC3).
- Runbook §3.8 gains the export → harvest → `sbx rm` recreate step, and item 4 names `observation.json` (AC4).

**Files changed in this pass:**
- `kb/agent-pc-setup-runbook.md`: §3.8 recreate paragraph. The same-day overwrite sentence now covers a second recreate (rename or merge the earlier export). Step 2 gains the harvest-refusal recovery note. Prose only; every command is unchanged.

**Review:** both layers ran (band M). Patches applied: 2 (medium 1, low 1). Deferred: 0. Rejected: 4.

**Follow-up review recommended:** false. The patched counts are high 0, medium 1, low 1, so the score is 3×1 + 1×1 = 4, which is below 5.

**Verification:**
- `uv run python -m unittest discover tests`: 1209 tests OK (1 skipped).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `evolve.py draft --directory . --dry-run`: `clusters: 66`, `unchanged: 66`, `measurements_skipped: 7`, `created: []`, `stranded: []`, `wrote: false`.
- The patched §3.8 text was inspected: the export, check, harvest and `sbx rm` commands are intact and in order.

**Residual risks / operator actions (carried forward):**
- 26-1 to 26-3 of this run have only `metered.json`. Their meter rows survive only through the §3.8 export, which must run before any `sbx rm claude-tk-studio`:
  `MSYS_NO_PATHCONV=1 sbx exec claude-tk-studio bash -lc 'cat ~/.tk-studio/measurements/*.jsonl' > ~/.tk-studio/measurements/sandbox-claude-tk-studio-$(date +%Y%m%d).jsonl`
- The harvest is an operator action on the host (unverifiable-here): `uv run --no-project python plugins/tk-studio/lib/meter.py harvest --run-dir /c/GitHub/tk-studio/.bmad-loop/runs/<run-id>`.
- Meter rows can be double counted across an exported file and the harvested ledger. This is documented, not deduped.
- The SPEC.md CAP-12/CAP-13 design-notes bullet (text in `plans/26-4.md`) is still unappended. It is left for the operator or the next attended planning pass.

DRIFT: runbook §3.8 harvest command uses `--run-dir /c/GitHub/<project>/.bmad-loop/runs/<run-id>` instead of the plan's tk-studio-relative `.bmad-loop/runs/<run-id>`: the relative path resolves only for tk-studio's own runs, which breaks AC4's exact command for any other project's sandbox (consult ruling, prior run) — affects: none

## Reconcile

- 2026-10-15 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 26-5-the-adapter-takes-a-status-pull-back-from-a-driver
