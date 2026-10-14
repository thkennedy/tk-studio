# Deferred Work

## Deferred from: code review of feat/tk-studio-connector (2026-08-06)

- ~~**DW-1**~~ — **Resolved 2026-08-07 (ST-039, contract 0.1.7 — shipped as 1.7.0, renumbered to pre-1.0 the same day):** §4 `submit` now reads id-only ("the id of a shipped/project job instance — a full-definition submit form is not part of this surface"), folded into the deliberate 1.7.0 MINOR bump as planned. *(Original: contract §4 `submit` admitted "a job definition (or the id …)" but the CLI/skill surface was id-only.)*
- **DW-2** — Connector test suite (`ClaudeOS/connectors/tk-studio/server.test.ts`) is live-integration by design: it asserts against the real registry and studio install, so it cannot run on a machine without an onboarded tk-studio. Acceptable for the personal ClaudeOS repo (no CI); add a fixture/mock path only if the repo ever grows CI.

## Deferred from: AD-11/AD-13 hardening PRs (2026-08-06)

- ~~**DW-3**~~ — **Resolved 2026-08-07 (ST-039, contract 0.1.7):** §8 names the suite's `unrunnable-core` assertion and §6 reads four-plane (base, plugin incl. harness loadability, store, vault), folded into the 1.7.0 bump with DW-1. *(Original: PATCH-level wording drift — behavior had already shipped and been asserted by the suite.)*

### DW-4: Pre-existing platform-dependent failure: test_job.JobTestCase.test_target_rules expects "C:/abs/path.py" refused as absolute; accepted on Linux
origin: spec-deferred ef269254c0b5
source_spec: `20-1-finish-records-what-the-run-cost-finish-records-what-the-run-cost.md`
location: plugins/tk-studio/lib/tests/test_job.py:177
severity: low
reason: Reproduces on clean git archive of baseline 0c984107dcaf136f8a6049acf0ac39f281b99744; outside story Files (consult ruling 2026-09-28T09:02:24Z)
status: resolved 2026-09-28 by thkennedy/tk-studio#77 (core path judged under both path flavors; lib suite green on Linux)

### DW-5: A repeat finish in the same terminal state overwrites run.json fields (now including total_cost_usd) and emits a second job-run event.
origin: spec-deferred 58cb8430e7bb
source_spec: `20-1-finish-records-what-the-run-cost-finish-records-what-the-run-cost.md`
location: plugins/tk-studio/lib/jobrun.py finish / plugins/tk-studio/lib/job.py:570
severity: low
reason: job.update_run allows new_state == record state on a terminal run (job.py:570), and finish always calls _finalize_run, which emits. This behaviour predates this story for reason/status_block. It touches the AD-12 one-event-per-terminal-transition invariant (deferral class (b)). Raised by the edge-case-hunter review layer.
status: open

### DW-6: The contract names no executing wrapper for a one-shot run started from the invoke-skill directive that `submit` returns, and gives no path for Hermes (which submits but never executes) to hand that d
origin: spec-deferred a6391be903d9
source_spec: `20-2-contract-0-1-18-names-the-supervisor-and-hermes-contract-0-1-18-names-the-supervisor-and-hermes.md`
location: plugins/tk-studio/contracts/driver-contract.md §2 executing-wrapper paragraph and the §1 roster Hermes row
severity: medium
reason: AC3 pins the wrapper as "whichever conformant driver executed its `wake` directive" (transcribed verbatim, so not extended here). But lib/jobrun.py submit() also creates the run and returns an invoke-skill directive for one-shot skill-target jobs (e.g. run-epic), and §4's KB-injection section says directives come from "submit/wake". Deferral class (b): a contract invariant left unpinned. Raised by both review layers.
status: resolved 2026-09-28 in the 0.1.18 release: the executing wrapper is whichever driver executed the invoke-skill directive from wake or, for one-shot skill targets, submit; Hermes hands jobs to the supervisor and never calls submit

### DW-7: `job.schema.json` `run.fields` does not list `total_cost_usd`, although Story 20.1 records it in `run.json` and the 0.1.18 §4 `finish` row now tells drivers it is recorded there.
origin: spec-deferred 88fba205925c
source_spec: `20-2-contract-0-1-18-names-the-supervisor-and-hermes-contract-0-1-18-names-the-supervisor-and-hermes.md`
location: plugins/tk-studio/contracts/job.schema.json run.fields
severity: medium
reason: grep finds no `total_cost_usd` in plugins/tk-studio/contracts/job.schema.json. The run fields list `reason`, `status_block`, `ended` and others, but not the cost. 20-1 (2d68213) added the field to run.json and jobrun.py without the schema, so this predates 20-2. AD-19 says a contract-surface change updates its schemas in the same story. Deferral class (b): a contract or schema invariant left unpinned. Raised by the edge-case-hunter layer in the follow-up review.
status: resolved 2026-09-28 in the 0.1.18 release: job.schema.json run.fields lists total_cost_usd

### DW-8: Follow-up review still recommended for 24-1-every-landed-story-carries-its-price-and-its-time after the damping cap was spent
origin: review-budget-followup
source_spec: `24-1-every-landed-story-carries-its-price-and-its-time-every-landed-story-carries-its-price-and-its-time.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20260928-093644-829a; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-9: Follow-up review still recommended for 25-1-the-roster-and-the-release-motion-for-every-app after the damping cap was spent
origin: review-budget-followup
source_spec: `25-1-the-roster-and-the-release-motion-for-every-app-the-roster-and-the-release-motion-for-every-app.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261014-195634-b06c; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-10: Follow-up review still recommended for 25-2-the-installer-writes-the-skills-dir-plugin after the damping cap was spent
origin: review-budget-followup
source_spec: `25-2-the-installer-writes-the-skills-dir-plugin-the-installer-writes-the-skills-dir-plugin.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261014-204241-9620; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-11: consolidate.py's drift-category fix text still names the retired marketplace flow ("tk install / /plugin marketplace update").
origin: spec-deferred b64f5df6107d
source_spec: `25-3-the-drift-check-and-conformance-read-the-folder-and-the-the-drift-check-and-conformance-read-the-folder-and-the-roster.md`
location: plugins/tk-studio/lib/consolidate.py:246
severity: low
reason: plugins/tk-studio/lib/consolidate.py:246-247 builds the fix "run the guided fix on the affected machine (tk install / /plugin marketplace update)". Story 25-3 removed that flow from the drift check, SKILL.md, driver-contract §6 (pinned by test_driver_contract assertNotIn("/plugin marketplace update")) and amended AD-13 to the folder and the roster. Under AD-21 a marketplace copy is the `shadowed` condition, so evolve proposals built from drift-detection events give guidance that contradicts the plane's own fixes. The text pre-dates this story and the file is outside its Files boundary. Deferral criterion (b): an AD rule (AD-13 as amended) left contradicted by a shipped fix text.
status: open

### DW-12: A studio-web update while the supervisor leg is `reported` (source checkout) or `skipped` renames the live studio-web slot aside with nothing restarted, so a running supervisor may serve a renamed pat
origin: spec-deferred 8afffc622e6a
source_spec: `25-4-the-bootstrap-and-the-meta-cli-the-bootstrap-and-the-meta-cli.md`
location: tools/installer/cli/tk_studio_cli/apps.py apply_slots / run_legs
severity: medium
reason: apply_slots computes restart = live_sup only when the supervisor leg is `unchanged`; for `reported`/`skipped` restart is None, must_start is False, and swap() still renames the old web slot to .<version>.previous. Consult 2026-10-14 ruled a `reported` studio_web status out of scope for a review patch (AC3 is supervisor-only, spec Design Notes; a new leg status needs a planned I/O-matrix entry). Deferral rule (a): behaviour AC2 names (the supervisor serves the studio-web slot). Reader: 25-5.
status: open

### DW-13: Follow-up review still recommended for 25-4-the-bootstrap-and-the-meta-cli after the damping cap was spent
origin: review-budget-followup
source_spec: `25-4-the-bootstrap-and-the-meta-cli-the-bootstrap-and-the-meta-cli.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261014-221445-84de; this entry preserves the lingering recommendation for a deliberate later review.
status: open
