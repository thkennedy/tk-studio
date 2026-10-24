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

### DW-14: Follow-up review still recommended for 25-6-sandboxes-read-the-host-skills-folder after the damping cap was spent
origin: review-budget-followup
source_spec: `25-6-sandboxes-read-the-host-skills-folder-sandboxes-read-the-host-skills-folder.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261014-221445-84de; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-15: roster_guard refuses a file:// plugin URL, so the offline route (a) (a local roster + `tk-studio install --roster <path>`) cannot run; the runbook documents route (b), a manual extract, instead
origin: spec-deferred fd9d78aa9946
source_spec: `25-7-the-docs-and-the-release-say-the-installer-is-the-way-in-the-docs-and-the-release-say-the-installer-is-the-way-in.md`
location: tools/installer/cli/tk_studio_cli/roster_guard.py:140
severity: low
reason: tools/installer/cli/tk_studio_cli/plugin_leg.py:153-163 → roster_guard.py:140-145 (https://github.com/.../releases/download only); plugin_leg.py:86-87 default_fetch accepts file://
status: open

### DW-16: Follow-up review still recommended for 25-7-the-docs-and-the-release-say-the-installer-is-the-way-in after the damping cap was spent
origin: review-budget-followup
source_spec: `25-7-the-docs-and-the-release-say-the-installer-is-the-way-in-the-docs-and-the-release-say-the-installer-is-the-way-in.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261014-221445-84de; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-17: doctor's hermes-logins check cannot read Hermes's config.yaml (miniyaml refuses the flow mapping `{}`), so it warns instead of reporting `auth.adopt_external_logins`
origin: attended host verification 2026-10-15 (first `tk-studio doctor --json` on TIM-PC-2 after Epic 25)
source_spec: `25-5-doctor-says-what-is-wrong-doctor-says-what-is-wrong.md`
location: tools/installer/cli/tk_studio_cli/doctor.py (hermes-logins check); tools/installer/cli/tk_studio_cli/miniyaml.py (copy of plugins/tk-studio/lib/miniyaml.py)
severity: low
reason: Hermes's `config.yaml` carries flow-style values (`{}`) that the stdlib-only miniyaml does not parse ("unsupported YAML construct: '{}'"), so the check ends `warn: config.yaml unreadable` and never reads the setting it exists for. The operator set the flag to `false` by hand on 2026-10-14, so nothing is at risk today. Fix candidate: a targeted line scan for `adopt_external_logins:` under the `auth:` block when the full parse fails, or teach miniyaml the empty flow mapping; cover with a fixture copied from a real Hermes config.
status: open

### DW-18: Follow-up review still recommended for 26-1-launch-ends-every-path-with-the-block-and-owns-its-bootstrap after the damping cap was spent
origin: review-budget-followup
source_spec: `26-1-launch-ends-every-path-with-the-block-and-owns-its-bootstrap-launch-ends-every-path-with-the-block-and-owns-its-bootstrap.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261015-192821-0e4a; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-19: `_bmad/custom/bmad-build-auto.toml:67` still tells the executor to name the spec `<entry id>-<slug of the title>.md`, contradicting the dispatch note's `stories/<id>-spec.md` (transcribe.py:141).
origin: spec-deferred a31b80ebdcd5
source_spec: `26-2-the-planner-settles-schema-shape-and-the-spec-file-name-the-planner-settles-schema-shape-and-the-spec-file-name.md`
location: _bmad/custom/bmad-build-auto.toml:67
severity: medium
reason: The dispatch note sends the executor session to `_bmad/custom/bmad-build-auto.toml` for its project rules, and l.67 there keeps the doubled slug that hole 6 targets. The stock bmad-build-auto step-01 also derives `{story_id}-{slug}.md` under folder+id dispatch. Both names resolve by the `<id>-*.md` glob, so nothing breaks, but the shortening may never happen in practice. The story's intent-contract Never list forbids editing the toml (consult ruling `apply`, 2026-10-15). Fix: change the l.67 naming sentence only, keeping the glob and pending clauses. Owner: the next planner or the operator. Deferral criterion (a).
status: closed 2026-10-15 — attended fix before the Epic 26 PR: `_bmad/custom/bmad-build-auto.toml` now names the executor spec `<entry id>-spec.md`, matching the dispatch notes Story 26.2 writes; the engine resolves it by the same `<id>-*.md` glob

### DW-20: The consult `scope` sentence added for AC1 reaches `routing.current.json` as `consult_scope`, but nothing reads it, so the consult never sees it.
origin: spec-deferred 508f612745bc
source_spec: `26-2-the-planner-settles-schema-shape-and-the-spec-file-name-the-planner-settles-schema-shape-and-the-spec-file-name.md`
location: plugins/tk-studio/lib/pipeline.py:322; .bmad-loop/plugins/studio-pipeline/consult.md
severity: medium
reason: `pipeline.py:322` writes `consult_scope`. No other code or customization reads that key: `bmad-build-auto.toml` reads only `consult_triggers`. The consult subagent's prompt is `.bmad-loop/plugins/studio-pipeline/consult.md` followed by the question, and consult.md carries its own fixed scope list. So the schema-shape-as-planner-matter rule exists as text only. The wiring gap predates this story. Deferral criterion (a): this is the behaviour AC1's consult-scope clause names.
status: open

### DW-21: Follow-up review still recommended for 26-5-the-adapter-takes-a-status-pull-back-from-a-driver after the damping cap was spent
origin: review-budget-followup
source_spec: `26-5-the-adapter-takes-a-status-pull-back-from-a-driver-the-adapter-takes-a-status-pull-back-from-a-driver.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261015-192821-0e4a; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-22: Follow-up review still recommended for 28-2-a-nested-studio-project-is-a-first-class-root after the damping cap was spent
origin: review-budget-followup
source_spec: `28-2-a-nested-studio-project-is-a-first-class-root-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261016-204648-7e02; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-23: rehearse.py refused the real supervisor repository: a release tag and GitHub-signed merges that the ADR premise (2026-10-09) never anticipated
origin: attended-closeout
source_spec: `28-1-the-rehearsal-is-a-script-with-a-report-spec.md`
location: tools/restructure/rehearse.py (Step 2, Step 3)
severity: medium
reason: The first rehearsal on the agent PC (2026-10-16) failed at Step 2 "tags present": the supervisor carries `supervisor--v0.1.0` since the Epic 25 release of 2026-10-15, and 11 of its 58 commits are GitHub-signed web merges, so the next check would have failed too. Both AC premises came from the ADR section 5 text written before either existed. Attended fix on loop/epic-28: release tags (`supervisor--vX.Y.Z`) are carried (filter-repo rewrites them, Step 3 fetches `--tags`, a check asserts they resolve in the merged clone and names the push for the real merge); any other tag still fails; signatures are recorded as an `info` check, never a failure. ADR section 5 step 2 and the Story 28.1 AC amended with the date. Tests: test_release_tag_is_carried, test_unsigned_history_is_a_plain_pass; test_signed_commit and test_mergetag_commit now expect the informational pass.
status: resolved

### DW-24: the nearest-root rule took the default per-user store for a project root on Windows (host gate red, engine green)
origin: attended-closeout
source_spec: `28-2-a-nested-studio-project-is-a-first-class-root-spec.md`
location: plugins/tk-studio/lib/config.py (_holds_config)
severity: high
reason: Only the configured store ($TK_STUDIO_HOME) was excluded from `_holds_config`; with that variable set the default `~/.tk-studio/config.yaml` still counted, and on Windows every temp folder and every project under the profile resolved to the profile folder itself (17 failures and 2 errors in the lib suite, one conformance drive red on the agent PC; the Linux engine never sees it because /tmp is outside $HOME). Attended fix on loop/epic-28: `_is_store` marks a `.tk-studio/` holding a store-only folder (`registry/`, `measurements/`, `projects/`) or matching a configured or default store root; `test_the_default_home_store_never_marks_a_project_root_either` reproduces it on every OS. Also fixed attended: the rehearsal test module was skipped whole on Windows (symlink shim; now a copy-or-folder fallback) and three host-only fixture assumptions (core.longpaths in the isolated gitconfig, shlex-quoted paths in a report assertion, an existing live file used as a never-written probe).
status: resolved

### DW-25: A supervisor-queued run of the nested project apps/supervisor serves the outer tk-studio root, not apps/supervisor, so AC3's live clause ("the project served is the nested root and its verify.host is
origin: spec-deferred 09bb86a90ae3
source_spec: `28-3-the-merged-tree-builds-releases-and-launches-from-one-root-spec.md`
location: apps/supervisor/src/worktree.ts:110-111, :254; apps/supervisor/src/cli.ts:79, :373
severity: high
reason: The supervisor cuts `git worktree add` of the whole repository from the project checkout and makes the worktree root the run's payload.directory and sbx VM path; nothing in apps/supervisor/src maps a project that sits below its git top-level (no --show-prefix / subpath handling). Pre-existing Epic 27 code, untouched by this story; the intent contract's Never forbids editing apps/supervisor/src. Consult ruling 2026-10-17 (high-severity-finding): defer under DEFERRAL DISCIPLINE (a).
status: closed 2026-10-17 — Story 28.5: the run records the root's `git rev-parse --show-prefix` at submission and serves `<worktree>/<prefix>` (worker cwd, payload.directory, sbx VM path, materialise, engine `.bmad-loop`, `verify.host` read at `<base>:<prefix>.tk-studio/config.yaml`); the worktree top stays for the git motions. The checkout lock is keyed by the git top-level, so 28.3's AC2 (the serialisation) and AC3's live clause (the project served) are satisfied by reference to Story 28.5; the attended Windows check stays unverifiable-here

### DW-26: A nested run live across the upgrade still holds its lock under its project-root key, so a new repository-root run claims under the git top-level key and the two can run at once until it ends.
origin: spec-deferred 3c21365dfc42
source_spec: `28-5-one-checkout-lock-for-a-nested-project-and-its-repository-spec.md`
location: apps/supervisor/src/queue.ts lockKeyOf / ADDED_RUN_COLUMNS migration
severity: low
reason: lockKeyOf falls back to run.checkout for rows minted before the lock_checkout column (spec Always); a pre-migration live run of apps/supervisor keeps locks.checkout = checkoutKey(apps/supervisor) while a post-migration repo-root run keys checkoutKey(<repo>). Transient: needs a live nested run across the supervisor restart that migrates. DEFERRAL DISCIPLINE (a): AC2's serialisation. Edge-case-hunter, review pass 2026-10-17.
status: open

### DW-27: On darwin the supervisor case-folds the starter lock's checkout (foldCase folds win32 and darwin) while jobrun.py folds only on win32, so a mixed-case macOS root never matches and a live lock never re
origin: spec-deferred 7fe7d7ddae7e
source_spec: `28-6-the-plugin-side-honours-the-queues-starter-lock-spec.md`
location: plugins/tk-studio/lib/jobrun.py checkout match / apps/supervisor/src/queue.ts foldCase
severity: low
reason: apps/supervisor/src/queue.ts foldCase lowercases on win32 and darwin; the story (AC1) pins the plugin's compare as "case-folded on Windows", so folding darwin would extend the story. Supervisor hosts are the Windows agent PC and the Linux engine today. DEFERRAL DISCIPLINE (a): AC1's checkout match. Edge-case-hunter, review pass 2026-10-17.

### DW-28: Follow-up review still recommended for 29-3-the-office-projection-semantic-states-progress-and-its after the damping cap was spent
origin: review-budget-followup
source_spec: `29-3-the-office-projection-semantic-states-progress-and-its-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261018-010738-a250; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-29: A run entering the live set after the snapshot shows the HUD's current-story phase as "—" until that story next changes.
origin: spec-deferred 19add04c7f42
source_spec: `30-4-the-office-screen-spec.md`
location: plugins/tk-studio/contracts/driver-contract.md:151; apps/studio-web/src/office/model.ts hudModel
severity: medium
reason: Category (a), a defect in behaviour AC2 names ("the current story's phase"). driver-contract.md:151 pins "A run new to the live set sends an epic-only office.progress beside its office.run", so the store holds no stories for that run. A consult (pass 2) ruled it a contract or operator decision (an additive per-story office.progress for a new run), not a 30-4 patch. A reconnect snapshot fills it.
status: open

### DW-30: A run that becomes live, or reaches `launched`, after the page's snapshot keeps the HUD's engine run id at "—" until a reconnect snapshot brings it.
origin: spec-deferred 4fdab8eaa859
source_spec: `30-4-the-office-screen-spec.md`
location: apps/supervisor/src/office.ts:663; apps/studio-web/src/live/store.ts:151; plugins/tk-studio/contracts/driver-contract.md (office.run delta)
severity: medium
reason: Category (a), a defect in behaviour AC2 names ("the engine run id"). The `office.run` delta has the pinned shape {run_id, project, state, from} with no engine_run_id, and the hub emits it only on a state change (apps/supervisor/src/office.ts:663). The web store's applyRun creates new rows with engine_run_id null and never updates it (apps/studio-web/src/live/store.ts:151). The fix is an additive delta field, so it is a contract or operator decision, the same class as the existing phase deferral. Found by follow-up review pass 4.
status: open

### DW-31: Follow-up review still recommended for 30-4-the-office-screen after the damping cap was spent
origin: review-budget-followup
source_spec: `30-4-the-office-screen-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261019-195216-0564; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-32: An open, focused Board tab with no run deltas keeps yesterday's Done items past local midnight.
origin: spec-deferred 21ebd940c6e4
source_spec: `30-5-the-board-screen-spec.md`
location: apps/studio-web/src/board/BoardScreen.tsx
severity: low
reason: Category (a), AC2 "Done (ended today)". The Board refetches on project-scoped office.run/office.progress deltas, window focus and visibility, never on a timer (spec Never). A tab that stays focused and visible across midnight with no run activity is not refetched until the next delta or focus change. Raised by both review layers.
status: open

### DW-33: Follow-up review still recommended for 30-5-the-board-screen after the damping cap was spent
origin: review-budget-followup
source_spec: `30-5-the-board-screen-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261019-212444-d031; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-34: office.json is compared byte-for-byte with LF output, but .gitattributes does not pin it to eol=lf, so a Windows checkout with core.autocrlf=true would make the reproducibility test and --check fail.
origin: spec-deferred bb2825ce3b72
source_spec: `30-7-our-own-assets-spec.md`
location: .gitattributes
severity: medium
reason: .gitattributes:3,7 pin eol=lf only for measurements/*.jsonl and tools/installer/install.*. Story criterion (a): AC1 says the export is reproducible, checked by a test. A fix outside the plan's 17-entry Files list was ruled out by consult (Consult Log). Operator fix: add `apps/studio-web/public/sprites/office.json text eol=lf` to .gitattributes.
status: open

### DW-35: Follow-up review still recommended for 31-1-the-free-tier-verified after the damping cap was spent
origin: review-budget-followup
source_spec: `31-1-the-free-tier-verified-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261024-165853-5939; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-36: kb/atlassian-free-tier.md §1 step 5 omits the Confluence write:space and write:folder scopes that tracking setup's space and folder creates need.
origin: spec-deferred f19d1703ed46
source_spec: `31-2-project-setup-from-a-template-spec.md`
location: kb/atlassian-free-tier.md:21
severity: medium
reason: confluence.py:31-32 sends POST /spaces and the folder creates as needing write:space:confluence and write:folder:confluence. kb §1 step 5 (and §2 Q3) lists only the read/write page, read space and attachment scopes for TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN. A token built from the record therefore meets a scope 403 on the first live setup's space create (AC1). Setup names the missing scope as designed, but the operator's instructions are incomplete. The fix belongs in 31.1's record, outside 31-2's Files.
status: open

### DW-37: Follow-up review still recommended for 31-2-project-setup-from-a-template after the damping cap was spent
origin: review-budget-followup
source_spec: `31-2-project-setup-from-a-template-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261024-180647-0fb9; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-38: Core job runs map only "no JSON" to run state blocked; a core's own `status` is never lifted into the run `state`, so `stop.on_status: ["blocked"]` on atlassian-sync-back (and every shipped core cron
origin: spec-deferred ba9345de7ba2
source_spec: `31-4-sync-back-on-a-timer-spec.md`
location: plugins/tk-studio/lib/jobrun.py execute_core; plugins/tk-studio/jobs/atlassian-sync-back.json
severity: medium
reason: jobrun.execute_core marks any parsed JSON output `complete`; a sync-back refusal (exit 2, status blocked) is recorded as a complete run, with `blocked` visible only in summary.json's lifted `status`. Consult ruling (option b): a runner-wide seam, not patched in a feature story. Meets (b): a contract/schema invariant left unpinned.
status: open

### DW-39: Follow-up review still recommended for 31-4-sync-back-on-a-timer after the damping cap was spent
origin: review-budget-followup
source_spec: `31-4-sync-back-on-a-timer-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261024-202524-0409; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-40: Follow-up review still recommended for 31-5-the-two-statuses-and-the-inbox-items after the damping cap was spent
origin: review-budget-followup
source_spec: `31-5-the-two-statuses-and-the-inbox-items-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261024-214054-7ffb; this entry preserves the lingering recommendation for a deliberate later review.
status: open
