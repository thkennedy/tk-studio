---
title: "Acceptance record: Story 34.8, the run-vertical-slice job and the engagement's game path, proved on The Universe Awaits"
description: "Story 34.8's TUA proof: the operator's steps on the agent PC (TUA's config gains playable, assets.art_path and assets/manifest.yaml through a TUA PR; one POST /jobs for a TUA run-vertical-slice instance ending in a merged PR with a playable greybox scene, the contact sheet and the frames; the job-run ledger line with the cost read back; claude plugin eval on the three eval cases at 2 of 3 runs each) and the Evidence section the operator fills; unverifiable in the engine's sandbox."
rank: 100
scope: project
---

# Acceptance record: Story 34.8, the run-vertical-slice job and the engagement's game path, proved on The Universe Awaits

The record AC3 asks for: one `POST /jobs` (or one chat message) on TUA ends in a merged PR with a playable greybox scene, the frames in the PR, a `job-run` ledger line with the cost, conformance green over every surface (the contract at 0.1.29), the three new skills' eval cases above the threshold, and this record under `kb/`. The engine that built Story 34.8 runs in a Linux sandbox with no Godot, no Blender, no Confluence and no model, so the proof is `unverifiable-here`: the steps below are the operator's, on the agent PC, and the operator fills `## Evidence`. Until that answer lands in the consult log the design spec's feature ledger reads Phase 3 `**built, TUA acceptance pending**`; the operator's evidence flips it to `**built** (Epic 34; acceptance: kb/acceptance-record-34-8-vertical-slice-on-tua.md)`.

What landed (tk-studio, contract 0.1.29, extended additively):

- **The job type.** `plugins/tk-studio/jobs/run-vertical-slice.json` has `run-epic.json`'s shape (target `tk-studio-launch`, payload `{verb: start, bootstrap: true}`, one-shot, guards `max_turns` 80 and `max_wall_clock_seconds` 3600, `stop.on_status: [blocked]`, effort `high`) under its own id and description. `lib/job.py` keeps an instance's `type` on the resolved definition; the supervisor treats a run as a slice when that definition's `type` or `id` is `run-vertical-slice`.
- **The engagement's game path.** A project whose tracked `working_set` holds `gds` or a `gds-` entry is a game project (`engage.py` decides). Its `scope` takes `--brief-file` and `--gdd-file` (the planner's `gds-create-game-brief` Fast path and `gds-gdd` Express path, SKILL step 4a) and publishes `ENG-NNN: Game Brief` and `ENG-NNN: GDD` beside the scope; the record gains `brief_page`, `gdd_page` and `game: true`, and approval mints the epics' `run-epic-N` jobs with `type: run-vertical-slice`.
- **The slice's host leg.** After a green `verify.host`: the assets step (`assets.py check`, `greybox`, `match`; never `--mirror`, never `generate`), then the engine gate (34.1), then `playable.py run` (34.3) and `playable.py sheet` (the contact sheet), then the judge. The close-out commits the placed art, the manifest and `.tk-studio/proof/<run_id>/` (the report, the sheet, the sampled frames) by name before the push; the PR embeds the sheet and lists the frames; the closeout report (32.8) gains `## Slice verdicts` with the sheet attached to the page.
- **The evals.** `evals/gds-engine-godot-4-pinned-facts/` (34.4), `evals/tk-studio-playable-judge-verdict/` (a fixture report and two frames, one magenta: the judge must fail it on `no-magenta-or-error-overlay` and read nothing outside `media/`) and `evals/asset-ladder-generated-rung/` (the ladder ships as `assets.py`, no skill: the cap in `budget-bands.yaml`, `TK_ASSETS_MESHY_KEY` as a User variable never in a file, the per-invocation cap).

In the sandbox the slice is covered by the lib suite (`test_job`, `test_engage`, `test_playable`, `test_driver_contract`), `bun test test/approve.test.ts test/hostverify.test.ts test/worktree.test.ts test/delivery.test.ts` (fakes for every git remote, gh, assets.py, playable.py, Blender and judge call) and the conformance drive `e2e_vertical_slice.py`.

## Operator steps (on the agent PC)

1. **The box.** `GODOT` (the 4.7.2 Mono console exe) and `BLENDER` (5.2.2 or newer) are User environment variables, and the supervisor was restarted after both were set (`tk-studio doctor --json`: the `engine` row `pass`). Optional: `TK_ASSETS_MIRROR` names a CC0 mirror with at least one indexed kit (`assets.py mirror-index`), so `match` has something to place; without one `match` ends `complete`, its entries `skipped: no mirror`.
2. **TUA declares the slice.** Through a TUA PR (TUA's `main` changes only through its own PRs), TUA's `.tk-studio/config.yaml` gains, beside the `verify` keys 34.1 added:

   ```yaml
   playable:
     scenario: scenarios/smoke.json
     seed: 7
     ticks: 600
   assets:
     manifest: assets/manifest.yaml
     art_path: art/world/greybox
   ```

   and the PR adds `assets/manifest.yaml` (schema 1, a few entries the greybox scene needs, `rung: greybox` or `cc0`) and the scenario file. Merge it, so the keys are on the `base_ref` the run reads.
3. **One job.** A TUA job instance `.tk-studio/jobs/run-epic-<N>.json` `{job_schema_version: 1, id: "run-epic-<N>", type: "run-vertical-slice", target: {payload: {epic: <N>}}}` declared in TUA's `jobs:` (approval writes exactly this for a game engagement; by hand it goes through the same TUA PR), then one `POST /jobs` with the bearer naming it (or one chat message on a TUA engagement that runs through scope, quote and approval). Wait for the run to end.
4. **Read the run back.** `GET /runs/<id>/events`: the `host-verify` event carries `assets.verdict` `green` with three steps, `engine.verdict` `green`, `playable.verdict` `pass` with `contact_sheet` and `sampled`; the close-out record carries `host_commit`. The PR (merged after review) has the commit `host leg: placed assets and proof (run <id>)`, the `## Host verify` section with `Assets: green`, the embedded contact sheet and the frame list, and the greybox `.glb` files under `art/world/greybox`.
5. **The cost.** The `job-run` line for the run's studio run id in the ledger (`measurements/<user>-<machine>.jsonl`): `total_cost_usd` and `playable_verify_cost_usd`.
6. **Conformance.** From `plugins/tk-studio/lib`: `uv run python ../contracts/conformance/runner.py run` reports `ok: true`, with `e2e_vertical_slice.py` running its suite step (bun on PATH).
7. **The evals.** Three runs of each case, each passing its grader on at least 2 of 3 runs, on the tier per case (Story 35.5, hole 85):
   - `gds-engine-godot-4-pinned-facts`: on the **host**, `claude plugin eval plugins/tk-studio --trust-plugin --case gds-engine-godot-4-pinned-facts` (its facts ship in the skill text).
   - `tk-studio-playable-judge-verdict` and `asset-ladder-generated-rung`: on the **sandbox tier**, through the shipped `maintenance-evals` job (the `tk-studio-evals` surface: the sandbox has the tree and a shell). The operator queues it once: the per-job entry `jobs."<project-id>/maintenance-evals": {tier: sbx, sandbox: <name>}` in `TK_SUPERVISOR_CONFIG` (the runbook's `### Planning checklist (Story 35.5)`), the project's `jobs:` declaring `maintenance-evals`, then one `POST /jobs` `{project: "<project-id>", job: "maintenance-evals"}`. Fill the eval row from the run's status-block `reason` (`<case> <passed>/<runs>; …`), which `finish` lands in the host run's `run.json` and the run's `job-run` ledger line carries. `scores.json` (`{cases: {<case>: {runs, passed, score}}, cli}`, named in the block's `artifacts`) is the in-sandbox detail: it is written in the VM's run workspace, not on the host.

   The threshold (2 of 3) is the planner's default, with no design source; retune it here if the runs say so.

## Evidence

Filled by the operator session on the box:

| Item | Value |
|---|---|
| Date, box | 2026-10-27, Tim-PC-2 (the operator session; steps 1, 2, 6 and 7 done; 3 to 5 PARKED on Tim's decision of 2026-10-28) |
| TUA PR adding `playable`, `assets` and the manifest (URL, merge commit) | `playable`: TUA PR 9 (Story 34.3); `assets` + `assets/manifest.yaml` (six entries: two greybox, four cc0 with tags): https://github.com/thkennedy/the-universe-awaits/pull/11, merged f49d3fd; `assets.py check` on the fresh manifest: ok, 6 missing, `complete` |
| The job instance and the `POST /jobs` answer (run id) | PARKED (Tim, 2026-10-28): TUA's engine gate is red (12 `Phone.ConversationTest` failures, the owner's since 34.3) and the slice's host leg runs that gate after the assets step, so a slice run today ends `partial` with the playable proof skipped. Tim keeps those failures as they are: they are the studio's real "needs the owner's input" fixture (Blocked - Awaiting User, the Needs-you filter, the chat route, the stage log's gaps), and TUA work not needed to test tk-studio stays separate. The proof waits on no one; it runs when Tim wants TUA's gate green |
| `host-verify` `assets` (verdict, steps); `engine.verdict`; `playable.verdict`, `contact_sheet` | parked with the run |
| Close-out `host_commit`; the PR (URL, merged commit) | parked with the run |
| The PR's embedded contact sheet and frame list (present?) | parked with the run |
| The playable greybox scene (what the sheet shows) | parked with the run |
| `job-run` ledger line (`total_cost_usd`, `playable_verify_cost_usd`) | parked with the run |
| Conformance (`ok`, the drive's suite step) | ok: the 34.8 host leg's conformance ran `e2e_vertical_slice.py` green (queue event seq 4085 of `q-run-epic-34-20261027T200732Z-3113ff`, host verify green in 1075 s), and the operator's hand gate on main after the merge (`tools/verify_host.py`) |
| Eval runs (case: passes of 3) | on the Windows host, 3 runs each: `gds-engine-godot-4-pinned-facts` 3 of 3; `tk-studio-playable-judge-verdict` 0 of 3; `asset-ladder-generated-rung` 0 of 3. The host's eval child cannot grant a shell (the Windows sandbox gate is off) and, without one, cannot read the plugin's docs (Glob/Grep refused in don't-ask mode, the plugin cache denied by the kept deny list), so the two failures measure the host, not the skills (hole 85); they need the sandbox tier; on the sandbox tier, 3 runs each (the operator's `maintenance-evals` run `q-maintenance-evals-20261029T121940Z-40fe02`, 2026-10-29 12:20Z to 12:27Z, sandbox `claude-tk-studio`, claude 2.1.312, plugin 0.3.8; read from the run's result files `evals/<case>.json`, kept as the lib fixtures `tests/fixtures/claude-plugin-eval/`, because the core's parser refused the CLI's shape, hole 99, fixed forward; the status-block route proves itself at the next release): `tk-studio-playable-judge-verdict` 0 of 3 with the plugin (0 of 3 without), `asset-ladder-generated-rung` **3 of 3** with the plugin (1 of 3 without). The playable-judge 0 of 3 measures the harness, not the skill: every run ended `blocked` because the prompt's `media` folder is absent from the eval's temp working directory (DW-103) |
| Threshold kept at 2 of 3, or retuned to | kept at 2 of 3: `asset-ladder-generated-rung` clears it on the sandbox tier (3 of 3); `tk-studio-playable-judge-verdict` stays unmeasured until its case reaches its fixture (DW-103) |
