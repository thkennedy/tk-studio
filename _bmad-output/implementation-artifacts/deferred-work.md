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

### DW-41: Follow-up review still recommended for 31-7-validation-of-a-resolution after the damping cap was spent
origin: review-budget-followup
source_spec: `31-7-validation-of-a-resolution-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261025-012645-0c9e; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-42: Follow-up review still recommended for 32-2-the-planner-leg-behind-the-chat-route after the damping cap was spent
origin: review-budget-followup
source_spec: `32-2-the-planner-leg-behind-the-chat-route-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261025-050704-6024; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-43: Follow-up review still recommended for 32-3-clarifying-questions-through-the-inbox after the damping cap was spent
origin: review-budget-followup
source_spec: `32-3-clarifying-questions-through-the-inbox-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261025-070741-b0dd; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-44: Follow-up review still recommended for 32-4-the-scope-of-work-on-confluence after the damping cap was spent
origin: review-budget-followup
source_spec: `32-4-the-scope-of-work-on-confluence-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261025-090544-b945; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-45: Follow-up review still recommended for 32-5-the-quote-band after the damping cap was spent
origin: review-budget-followup
source_spec: `32-5-the-quote-band-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261025-104418-de9f; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-46: The served root's uncommitted budget-bands.yaml (left by 32.5's quote) can block the plan pull-back after the approve PR merges, so the queued step keeps retrying.
origin: spec-deferred cba1228d3bf4
source_spec: `32-6-approval-autonomy-and-the-first-run-spec.md`
location: apps/supervisor/src/approve.ts queueStep
severity: medium
reason: The approve PR changes .tk-studio/budget-bands.yaml; the served root holds the quote's uncommitted copy of it, and queueStep submits against the served root, which the pass never pulls (ruling (c)). Recorded against SPEC Open Question 3 / plans/32-6.md risk.
status: open

### DW-47: Nothing closes a cap or ask block after go or continue, and the questions pass will not close an owed questions block while the newest block is cap or ask.
origin: spec-deferred 668eb901a685
source_spec: `32-6-approval-autonomy-and-the-first-run-spec.md`
location: apps/supervisor/src/approve.ts runStep; apps/supervisor/src/questions.ts closeStep
severity: medium
reason: runStep only blocks (step 5); questions.ts closeStep skips while the newest block kind is cap/ask. The issue stays Blocked - Awaiting User after the owner answers. Meets DEFERRAL DISCIPLINE (a).
status: open

### DW-48: ask autonomy on a project not bound to Jira pauses with no question to the owner and no route to continue.
origin: spec-deferred f1785296bde4
source_spec: `32-6-approval-autonomy-and-the-first-run-spec.md`
location: apps/supervisor/src/approve.ts runStep steps 5-6
severity: medium
reason: The ask block is skipped when !jiraBound(root), and run-resumed is applied only from a Jira owner comment `continue`; paused takes only run-resumed, revise or cancel. Meets DEFERRAL DISCIPLINE (a).
status: open

### DW-49: Two engagements approved before either PR merges both run plansync sync from the same default-branch counter and mint the same EP/ST ids.
origin: spec-deferred 2f814336d68a
source_spec: `32-6-approval-autonomy-and-the-first-run-spec.md`
location: apps/supervisor/src/approve.ts reservedEpics / the sync step
severity: medium
reason: plansync's plan-counter.yaml is branch-local; reservedEpics reserves only ## Epic numbers, so the second PR adds the same EP-<n>.md (an add/add conflict GitHub surfaces, not a silent duplicate). Pre-existing property of plansync's counter across unmerged branches. Meets DEFERRAL DISCIPLINE (b): AD-4 id uniqueness at risk.
status: open

### DW-50: Two engagements quoted before either approves predict the same EP id, so the shared budget-bands.yaml entry holds only the later quote's estimate and the re-key can move the other engagement's figure.
origin: spec-deferred 27739241dd4d
source_spec: `32-6-approval-autonomy-and-the-first-run-spec.md`
location: apps/supervisor/src/approve.ts rekeyBands call in the job step
severity: medium
reason: 32.5's quote writes epics.<predicted EP>.usd_estimate into the served root's shared bands file and basis.epics[] carries no per-epic usd, so approve's rekeyBands reads the shared entry. Pre-existing in 32.5. Meets DEFERRAL DISCIPLINE (a): AC2's band re-key.
status: open

### DW-51: A re-approval after revise, before the first PR merges, resets the approve worktree to the default branch's tree, so the second plansync sync promotes fresh EP/ST entities to Jira and the first cycle'
origin: spec-deferred 4ec1b6eb659c
source_spec: `32-6-approval-autonomy-and-the-first-run-spec.md`
location: apps/supervisor/src/approve.ts re-approval cut (read-tree reset) and the sync step
severity: medium
reason: approve.ts re-approval path (operator ruling (2), pass 5): `git read-tree -u --reset origin/<default>` drops the first cycle's entity files holding external.jira.key and resets plan-counter.yaml; the following `plansync.py sync` mints keyless entities and jirabackend.promote POSTs a new issue for each. Consequence of ruling (2)'s wholesale replacement; reconciling the earlier promote (drop/transition the orphans, or carry keys forward) needs an operator decision. Meets DEFERRAL DISCIPLINE (a): AC1's plansync sync (the promote to Jira).
status: open

### DW-52: A named engage.py closeout refusal records engagement-closeout ok:false and is never retried, so the record stays in-progress/partial with the issue open; a manual engage.py closeout rerun writes the
origin: spec-deferred 8106661dadd5
source_spec: `32-8-delivery-the-closeout-report-and-change-requests-spec.md`
location: apps/supervisor/src/delivery.ts:274
severity: medium
reason: Blind Hunter; delivery.ts closeoutStep records the run_id on refusal (counts as done, accepted by consult 1 as deviation 4); the lib never moves state. Deferral class (a): AC1's state/issue/notifier outcome is not reached after a refusal.
status: open

### DW-53: After a closeout leaves an engagement partial for a run that ended unstopped, an owner go {cap} moves it to in-progress with no run queued and no new closeout, so it stays in-progress indefinitely.
origin: spec-deferred fcebc307be1b
source_spec: `32-8-delivery-the-closeout-report-and-change-requests-spec.md`
location: apps/supervisor/src/delivery.ts (lastRunEnded / closeoutStep); apps/supervisor/src/approve.ts runStep step 7
severity: medium
reason: Edge Case Hunter; step 7 resubmits only cap-stopped runs and the closeout pass treats the engagement-closeout event for that run_id as done. Deferral class (a): the go-past-a-cap input named by AC2 leaves no run and no report.
status: open

### DW-54: Follow-up review still recommended for 32-8-delivery-the-closeout-report-and-change-requests after the damping cap was spent
origin: review-budget-followup
source_spec: `32-8-delivery-the-closeout-report-and-change-requests-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261026-144134-5b90; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-55: tk-studio doctor's "newest log's last stopped/uncaught line" is usually a routine `[tick]`/`[drain] stopped (exit 0)` tee line, so it hides a keeper/serve death while the pacer keeps stepping.
origin: spec-deferred dde29a7d69c8
source_spec: `33-1-the-supervisors-log-file-spec.md`
location: tools/installer/cli/tk_studio_cli/doctor.py (check_supervisor_log, _last_end)
severity: medium
reason: The tee writes `stopped (exit <code>)` around every tick and drain step (src/log.ts), about every 60 s; `_last_end` in doctor.py takes the last line starting with `stopped`/`uncaught`, whatever the tag or code. AC2 names that literal line, so the code meets the criterion; ranking process-level ends (keeper/pacer/serve, or non-zero exits) first needs a planner ruling. The same noise shortens the 20-line /status tail. Meets deferral (a): a defect in behaviour the story's criteria name.
status: open

### DW-56: The pin-restart episode is bounded only by claim-refusal-cleared or run start, so a run whose restart healed at its claim cannot be restarted at a later relaunch or resume.
origin: spec-deferred ea7728db7fd4
source_spec: `33-3-the-pin-restarts-a-logged-out-sandbox-spec.md`
location: apps/supervisor/src/sandbox.ts openPinRestart
severity: medium
reason: clearClaimRefusals writes claim-refusal-cleared only when refusals were open (queue.ts:2202-2211); openPinRestart then still finds the old pin-restart; the run ends blocked naming the renewal (fail-safe). Consult ruling B, deferral criterion (a).
status: open

### DW-57: The launch check treats any .pin file as pinned by the supervisor, so a record left by a manual sbx stop, reboot or kept release hides AC2's started-outside warning.
origin: spec-deferred 9c932b6c59fb
source_spec: `33-3-the-pin-restarts-a-logged-out-sandbox-spec.md`
location: plugins/tk-studio/lib/launch.py engine_sandbox_row
severity: low
reason: The record is removed only when pin-released stopped the sandbox (Settled shape 3); engine_sandbox_row reads presence only. Proposed: treat a .pin whose supervisor_pid is dead or whose since predates the sandbox start as absent. Consult ruling D, deferral criterion (a).
status: open

### DW-58: Several queued runs on one sandbox that stays logged out (a token no restart heals) restart it once per run, one per drain pass, because guard (d) reads only the gated run's own episode.
origin: spec-deferred c443898760e1
source_spec: `33-3-the-pin-restarts-a-logged-out-sandbox-spec.md`
location: apps/supervisor/src/sandbox.ts openPinRestart / pinWithRestart
severity: medium
reason: openPinRestart reads queue.events(runId) only and the per-pass set is fresh each pass: runs A, B, C queued on S give a stop/start in pass 1 (A), pass 2 (B) and pass 3 (C), each able to cut off an operator's interactive `/login` renewal. Spec-conformant (Settled shape 2 guards (c)/(d) verbatim), so not a patch; deferral criterion (a), AC1's "stops and starts the sandbox once". Proposed: bound guard (d) per sandbox across the queue (any run's open pin-restart on S since S's last healed probe).
status: open

### DW-59: `tk-studio-launch check` has no inode warning for the engine sandbox, so a /tmp filling up again (hole 70: 1.3 M inodes while 33-1 ran) is seen only when the engine fails to write.
origin: spec-deferred 33-4 (plans/33-4.md Settled shape 6, the replan suggestion from 33-1)
source_spec: `33-4-the-host-leg-runs-the-supervisors-suites-spec.md`
location: plugins/tk-studio/lib/launch.py (the advisory rows of `check`)
severity: low
reason: Evidence hole 70: the supervisor suites' `tk-sup-*` leak filled the engine sandbox's /tmp to 1.3 M inodes during 33-1. Story 33.4 removes the cause (`apps/supervisor/test/tmp.ts` cleans every suite's folders under every exit) but not the symptom check. Proposed: an advisory `check` row that warns below 50,000 free inodes, read with `df -i /` through `sbx exec`. Outside 33-4's AC1/AC2 and its oversize band, so deferred. DRIFT: the inode warning deferred — affects: none.
status: open

### DW-60: The supervisor's pin (`pinBeforeClaim`) does not prune the engine sandbox's /tmp, so `tk-sup-*` and `tmp.*` leftovers from earlier runs (hole 70) accumulate until removed by hand.
origin: spec-deferred 33-4 (plans/33-4.md Settled shape 6, the replan suggestion from 33-1)
source_spec: `33-4-the-host-leg-runs-the-supervisors-suites-spec.md`
location: apps/supervisor/src/cli.ts (pinBeforeClaim), apps/supervisor/src/sandbox.ts (the pin, reshaped by 33-3)
severity: low
reason: Evidence hole 70 (1.3 M inodes in the sandbox's /tmp while 33-1 ran). Story 33.4's `tmp.ts` stops new leaks from the suites; folders left by older runs, killed processes or other tools stay. Proposed: when the pin starts or adopts the sandbox, prune `/tmp/tk-sup-*` and `/tmp/tmp.*` older than a day through `sbx exec` (argv only, never a shell glob from the host). Outside 33-4's AC1/AC2 and its oversize band, and the pin was reshaped by 33-3, so deferred. DRIFT: the /tmp prune at the pin deferred — affects: none.
status: open

### DW-61: Follow-up review still recommended for 33-4-the-host-leg-runs-the-supervisors-suites after the damping cap was spent
origin: review-budget-followup
source_spec: `33-4-the-host-leg-runs-the-supervisors-suites-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261026-223210-ba4c; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-62: launch.py check writes .bmad-loop/policy.toml even when git does not ignore it, so a served project whose policy is tracked gets a dirty tree that the engine's preflight then blocks.
origin: spec-deferred 2b9ce18e8959
source_spec: `33-5-the-roster-gate-inside-the-engine-tracked-spec.md`
location: plugins/tk-studio/lib/launch.py (reconcile_verify_commands)
severity: medium
reason: reconcile_verify_commands has no pipeline.unignored_writes guard (pipeline.py:415 reports this hazard for apply). tk-studio ignores the file (.gitignore:8), but a served project that opts in through engine.verify_commands with a tracked policy would be dirtied. Meets deferral (a): it is a defect in the reconciliation the criteria name. Refusing or reporting it is a design choice the plan does not settle.
status: open

### DW-63: A pacer pass that hangs or runs long is invisible until it ends: the slow-pass warning, the notifier line and pacer.json are written only when the child closes.
origin: spec-deferred 9d30780dcdae
source_spec: `33-7-a-resumed-engines-graceful-stop-ends-complete-and-the-pacers-spec.md`
location: apps/supervisor/src/log.ts (runUnderLog finish)
severity: medium
reason: Criterion (a), AC2's slow-pass visibility. Settled shape 3/4 write at pass end, which meets AC2 as written; a 30-minute tick is still seen only at minute 30, and a tick that never returns leaves `pacer` on stale values. Consult ruling 2026-10-27: reject as a 33.7 fix, record as deferred.
status: open

### DW-64: A resumed or relaunched engine the supervisor killed, whose host verify was skipped, still has its open PR marked ready even though the run ends partial.
origin: spec-deferred 0f1fc9058132
source_spec: `33-7-a-resumed-engines-graceful-stop-ends-complete-and-the-pacers-spec.md`
location: apps/supervisor/src/worktree.ts closeOut (the !input.verify branch, ~:480-483)
severity: medium
reason: Criterion (a), AC1's "the PR not a draft" tied to a complete end. Pre-existing at baseline c5749a6: closeOut's skipped-verify branch runs `gh pr ready` whatever the end state. Pinned as today's behaviour by the closeout.test.ts killed-resumed test comment.
status: open

### DW-65: A killed relaunch whose engine handled TERM and reads stopped ends `relaunched engine ended 'stopped'` instead of keeping launched.end (the guard trip's reason is lost).
origin: spec-deferred c8ff9ff15f87
source_spec: `33-7-a-resumed-engines-graceful-stop-ends-complete-and-the-pacers-spec.md`
location: apps/supervisor/src/worktree.ts sweepEngines (the relaunched predicate)
severity: medium
reason: Criterion (a), the story's rule "a killed relaunch keeps launched.end". Pre-existing at baseline: the `relaunched` predicate tests only st.detail.killed, set only when the probe did not read ended; killedEngine() is not consulted. Pinned by the closeout.test.ts killed-relaunch test comment.
status: open

### DW-66: Follow-up review still recommended for 34-2-spike-a-playable-run-on-the-box after the damping cap was spent
origin: review-budget-followup
source_spec: `34-2-spike-a-playable-run-on-the-box-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261027-072100-dd0a; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-67: A 33.8 `verify` re-run (POST /runs/{id}/verify) runs the playable-verify judge, but its cost never reaches the `job-run` ledger (there is no `finish` on that path).
origin: spec-deferred 7a69cf579b3c
source_spec: `34-3-the-playable-verify-leg-spec.md`
location: apps/supervisor/src/hostleg.ts runLeg
severity: medium
reason: consult ruling 2026-10-27 (deviation-gt-0); AC3 "the leg's cost lands in the ledger's job-run as its own line" holds on the close-out path only; worktree.ts finishStudio
status: open

### DW-68: The judge's "reads only report.json and the frames, never the code or the spec" rests on the SKILL.md instruction alone; the session runs with the whole worktree mounted and no deny profile.
origin: spec-deferred 61e45ce3bee5
source_spec: `34-3-the-playable-verify-leg-spec.md`
location: apps/supervisor/src/hostverify.ts defaultJudge; plugins/tk-studio/skills/tk-studio-playable-judge/SKILL.md
severity: medium
reason: Review pass 1 (blind hunter). AC1 names the read-only rule; enforcing it needs a deny-profile design for invokeSkill's `deny_profile`, which this story's plan does not settle. Deferral class (a).
status: open

### DW-69: A 33.8 re-run on an ended run pins (starts) the stopped sandbox for the judge and nothing releases it; it carries no pin record, so the launch check warns "started outside the supervisor" until the ne
origin: spec-deferred b5240c800ca2
source_spec: `34-3-the-playable-verify-leg-spec.md`
location: apps/supervisor/src/hostverify.ts defaultJudge pin; apps/supervisor/src/hostleg.ts runLeg
severity: low
reason: Consult ruling 2026-10-27 (high-severity-finding, option A), sandbox.ts:22-31. Deferral class (c): a safety/resource rule on the box.
status: open

### DW-70: Headless conformance drives ignore a manifest `timeout` (runner.py _run_drive uses DEFAULT_TIMEOUT 60); 34.1's e2e_engine_gate.py declares 120 and its 50+40 s bounds overrun the real 60 s cap. Also me
origin: spec-deferred d7abdbe1ec63
source_spec: `34-3-the-playable-verify-leg-spec.md`
location: plugins/tk-studio/contracts/conformance/e2e_engine_gate.py; plugins/tk-studio/contracts/conformance/manifest.json
severity: low
reason: Consult ruling 2026-10-27 (deviation-gt-0, patch pass): runner.py:92, :210-211, :236, :520, :831-832. Deferral class (b): the AD-19 conformance invariant.
status: resolved 2026-10-29 by this story's PR (35.3: `runner.py` honours a manifest `timeout` since 35.1's fix-forward; `e2e_engine_gate.py` now asserts its 50 + 40 s bounds under its manifest `timeout: 120` as `e2e_vertical_slice.py` does under 240, `test_playable_judge.py` pins both drives' worst case below the `timeout` read from `manifest.json`, and the stale "below the runner's 60 s" comments and manifest notes are fixed; contract 0.1.30)

### DW-71: The launch check's engine-gate clause cannot tell whether the engine sandbox was provisioned WITH_GODOT, so a gate in engine.verify_commands on a sandbox without Godot gets no warning.
origin: spec-deferred d688aa7fdcf8
source_spec: `34-4-engine-knowledge-pinned-per-project-spec.md`
location: plugins/tk-studio/lib/launch.py engine_gate_clause
severity: low
reason: Edge/blind review of 34-4; consult 11:12:22Z ruled no change in this story: nothing in the tracked config records how the sandbox was provisioned, so the WITH_GODOT rule is text in the skill and the kb row only.
status: open

### DW-72: Once an operator confirms gds-engine-godot-4 into working_set.<role>, orchestrate.py routing shows it as kind unknown, status missing ("re-run onboarding or install it"), because inventory.py has no p
origin: spec-deferred c0a1e6088bbb
source_spec: `34-4-engine-knowledge-pinned-per-project-spec.md`
location: plugins/tk-studio/lib/orchestrate.py _resolve_routes; plugins/tk-studio/lib/inventory.py planes
severity: low
reason: Plan 34-4 Risks and the spec's Never rule ("Widen inventory.py/orchestrate.py routing (recorded as a deferral instead)") require this deferral; follow-up blind review found it unrecorded. Class (a): the routing display of AC1's confirmed skill. Display only: the skills mount does not depend on it.
status: open

### DW-73: Follow-up review still recommended for 34-4-engine-knowledge-pinned-per-project after the damping cap was spent
origin: review-budget-followup
source_spec: `34-4-engine-knowledge-pinned-per-project-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261027-105550-228c; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-74: assets.py facts reads bounds and triangles from POSITION accessor min/max and meshes only, ignoring node transforms and instancing.
origin: spec-deferred e213416e493c
source_spec: `34-6-the-asset-manifest-and-the-greybox-rung-spec.md`
location: plugins/tk-studio/lib/assets.py (facts_of)
severity: medium
reason: Edge and blind layers: a .glb with a scaled, offset or instanced node gets wrong bounds, origin and triangle facts, so the gate judges cc0 and generated rung files wrongly. Greybox output (identity transforms) is unaffected. Plan 34-6 §7 chose accessor min/max; deferral category (a), behaviour AC2 names (facts bounds from the glTF), needed before 34.7 gates third-party files.
status: resolved 2026-10-27 by Story 34.7 (thkennedy/tk-studio#216): `facts_of` walks node transforms and instancing (assets.py docstring :850-855; 34-7 spec :118); closed on the EP-34 retro's finding C6

### DW-75: Follow-up review still recommended for 34-7-the-cc0-mirror-and-the-paid-rung-behind-a-cap after the damping cap was spent
origin: review-budget-followup
source_spec: `34-7-the-cc0-mirror-and-the-paid-rung-behind-a-cap-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261027-160949-d39b; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-76: A green slice re-run (POST /runs/{id}/verify) marks the PR ready without committing the placed art or the proof.
origin: spec-deferred aae84adbccd3
source_spec: `34-8-the-run-vertical-slice-job-and-the-engagements-game-path-spec.md`
location: apps/supervisor/src/hostleg.ts:155-180
severity: medium
reason: hostleg.ts runLeg runs hostVerify with { slice } in the detached .verify worktree, where greybox/match write the placed art. It then calls removeWorktree, and markReady when the leg is green. proofCommit (worktree.ts) runs only at the close-out. If the close-out's assets step was red (no host commit) and the re-run is green, the PR goes ready while its branch has no greybox art, no .tk-studio/proof/<run_id>/ and no embedded sheet. The consult ruled that this cannot be fixed here: the contract fixes the re-run as verify-only and marks green PRs ready (driver-contract.md:385-390). Operator to decide: skip pr_ready for slice runs, or have the re-run commit and push.
status: resolved 2026-10-27 by this story's PR (35.1: the re-run is a whole leg — a slice re-run cut on the run branch with `-B` commits the placed art and `.tk-studio/proof/<run_id>/` through `worktree.ts proofCommit` under the close-out's condition and pushes before the PR is touched; contract 0.1.30)

### DW-77: The engagement's closeout page carries each slice's contact sheet and verdicts, but not the sampled frames or report.json.
origin: spec-deferred 408ccad7fc6f
source_spec: `34-8-the-run-vertical-slice-job-and-the-engagements-game-path-spec.md`
location: apps/supervisor/src/delivery.ts composeCloseout; plugins/tk-studio/lib/engage.py closeout
severity: low
reason: AC2 lists the proof media (the frames, a contact sheet, the report) landing on the run workspace, the PR body and the engagement's page. Plan shape 7/8 distributes them: the closeout input carries only slices[].contact_sheet (delivery.ts composeCloseout) and engage.py closeout copies and attaches only <key>-contact-sheet.png. A consult (second follow-up review) ruled the plan's distribution holds for this story. Attaching the sampled frames and report.json to ENG-NNN: Closeout is an open enhancement that changes the published 0.1.29 closeout input, so it needs a contract bump through planning.
status: resolved 2026-10-29 by this story's PR (35.6: each slice leg copies its `report.json` and sampled frames to `<store>/legs/<stamp>/` (`playable.report`, `playable.leg_frames`), `composeCloseout` carries them as `slices[].report`/`frames` from each story's own leg, and `engage.py closeout` writes and attaches them as `<key>-report.json` and `<key>-frame-<name>` with the report's `| Report | Value |` verdict table under the story; the `e2e_closeout_media.py` drive; contract 0.1.30)

### DW-78: The host leg's engine gate resolves a project's bare `godot` to WinGet's GUI link and hangs (hole 78).
origin: operator ledger, hole 78 (2026-10-27T07:09Z)
source_spec: `34-1-the-engine-gate-on-the-host-leg-spec.md`
location: apps/supervisor/src/hostverify.ts (the engine step's PATH); The Universe Awaits scripts/engine-gate.sh
severity: medium
reason: Story 34.1's leg prepends the folder of GODOT to the step's PATH, but that folder holds the console exe under its full name and no file named `godot`, so a project's bare `godot` resolves further down PATH to WinGet's `godot.exe` link (the GUI build), whose `--headless --import --quit` never returns under a hidden window (45 minutes, killed by the operator). TUA's script now names `$GODOT`; the fix to make is a tk-studio-side shim (a `godot` on the step's PATH that execs GODOT) or a leg that refuses a bare `godot` with the reason.
status: open

### DW-79: The launch bootstrap writes a plan for the first story only; a relaunched story with open SPEC questions reaches its dev session with no plan (hole 81).
origin: operator ledger, hole 81 (2026-10-27T14:06Z); retro C5
source_spec: `34-6-the-asset-manifest-and-the-greybox-rung-spec.md`
location: plugins/tk-studio/skills/tk-studio-launch (bootstrap); .bmad-loop/plugins/studio-pipeline (the gate's plan writing)
severity: medium
reason: Epic 34's bootstrap wrote plans/34-1.md only; the gates wrote 34-2 to 34-5 as they went, but 34.5's relaunch moved straight to 34.6 with no plans/34-6.md and no design note for CAP-11/CAP-12, so the session escalated six questions and paused; the operator wrote the plan by hand (dfa1ab2). Fix: the bootstrap writes every story's plan, and the gate refuses a story whose SPEC open questions have no design note (retro AI-9).
status: resolved 2026-10-29 by this story's PR (35.2: the launch bootstrap plans every manifest entry in list order (`task-planning.md` §1, the commit `loop(epic-<N>): SPEC, manifest and story plans from the launch bootstrap`); `launch.py check` refuses the next story with the gap `open questions` while one of its CAPs has an open question and no design note, the status block `blocked` naming every CAP; the advisory `story plans` row names the stories still without a plan; contract 0.1.30)

### DW-80: The engine's own `bun test` in the sandbox reports 15 Story 32.8 delivery tests red at baseline while the host passes all 1,494 (hole 84).
origin: operator ledger, hole 84 (2026-10-27T22:02Z); retro C6, Open questions
source_spec: `34-8-the-run-vertical-slice-job-and-the-engagements-game-path-spec.md`
location: apps/supervisor/test/delivery.test.ts (the Story 32.8 closeout-pass block); the sandbox's bun at ~/.bun/bin
severity: medium
reason: Identical names fail at 6f836df in the Linux sandbox (25 on the full suite); the test fakes inject `uv`, so it is not a missing tool; the cause is not reproduced. Until it is, the engine cannot use the full supervisor suite as its gate (the host leg is). Fix: reproduce in the sandbox, then make the block platform-neutral or name it host-only in the plugin's sandbox notes.
status: open

### DW-81: Two of Story 34.8's three eval cases cannot run on the Windows host: the eval child can neither grant a shell nor read the plugin's docs (hole 85).
origin: operator ledger, hole 85 + addendum (2026-10-27T22:1xZ); retro C7, AI-1
source_spec: `34-8-the-run-vertical-slice-job-and-the-engagements-game-path-spec.md`
location: plugins/tk-studio/evals/tk-studio-playable-judge-verdict, evals/asset-ladder-generated-rung; kb/acceptance-record-34-8-vertical-slice-on-tua.md step 7
severity: low
reason: `claude plugin eval` refuses a Bash/Write grant on the box (the Windows sandbox gate is off, `sandbox.failIfUnavailable` set) and, without one, Glob/Grep are refused in don't-ask mode and the plugin cache is denied by the kept deny list: pinned-facts 3 of 3, the judge and asset-ladder cases 0 of 3, measuring the host. Fix: run those cases on the sandbox tier (a job, or the maintenance path) or carry their facts in the skill text; the record names the tier per case. The sandbox setting stays the owner's.
status: open

### DW-82: A green host-leg re-run (`POST /runs/{id}/verify`) never refreshes the PR body's `## Host verify` section, which keeps the first leg's Red (hole 88).
origin: operator ledger, hole 88 (2026-10-27T23:2xZ); retro C2, AI-9
source_spec: `33-8-the-verify-verb (Epic 33)`
location: apps/supervisor/src/hostleg.ts:20, :108 (the verify verb edits no body)
severity: medium
reason: 4 of Epic 34's 7 story PR bodies (#201, #206, #213, #216) read Red at merge while the verify verb had gone green; the green sits in a PR comment or only in the handoff. Fix: the verify verb rewrites the body's Host verify section and the status block with the latest leg's result, as the close-out does on the first open.
status: resolved 2026-10-27 by this story's PR (35.1: the re-run regenerates an open PR's body through `prBody` from the record, its `## Host verify` the latest leg's under a `Legs:` history line, then marks a draft ready on green or `gh pr ready --undo` on red; contract 0.1.30)

### DW-83: The 34.5 amend episode built two stories in one run and left 34-5 without a gate file, a `## Reconcile`, a review-budget DW entry or a metered cost (hole 89); the recommended follow-up review for 34-5 is this entry.
origin: operator ledger, hole 89 (2026-10-27T23:2xZ); retro C4
source_spec: `34-5-one-engine-mcp-per-run-started-by-the-pin-spec.md`
location: the resume path (apps/supervisor src/resume.ts, closeout.ts); .bmad-loop/plugins/studio-pipeline (gate files per story); the ledger's job-run line for PR #213
severity: medium
reason: Halt (60cbc36) → operator answer amended (c5a212e) → pause → `reconcile_verdict: not-required` by hand (54780c8) → the relaunch moved to 34.6: 34-5 has no gate file, no Reconcile, no DW review-budget entry although `followup_review_recommended: true`, and PR #213 is not metered (ledger line 732 has no total_cost_usd). Rules recorded (never amend after a resume; runbook :1556). Fix: a resumed run that lands more than one story writes a gate file and a cost line per story, or the studio refuses a resume that would cross a story boundary; and 34.5's follow-up review (the engine MCP: B6, B7, AI-5) is owed.
status: resolved 2026-10-29 by this story's PR (35.2: the planner picked the refusal — while a graceful stop is in force (`stop-request.json` in the engine run dir, or a journal `stop-request-discarded` no `run-resume`/`run-start` follows) the paused-run pass commits and meters the landed story but never archives or relaunches across the story boundary (one `story-boundary` event, `StoryBoundary`, `graceful_stop: "kept"`, one notifier line), and `POST /runs/{id}/resume` re-arms the stop on the resumed engine (`graceful-stop`); per-story records are not built; contract 0.1.30. 34.5's owed follow-up review (the engine MCP: B6, B7, AI-5) is left to the operator, outside this story)

### DW-84: `kb.py index` titles kb/index.md after the checkout folder, so every run that regenerates it restores the header by hand.
origin: retro C6 (asked for in 34-4 spec :181, :189, :225)
source_spec: `34-4-engine-knowledge-pinned-per-project-spec.md`
location: plugins/tk-studio/lib/kb.py (index title)
severity: low
reason: In a run worktree the folder is `q-run-epic-34-…`, so the regenerated index is titled after the run and the implementer restored `tk-studio` by hand in 34.1, 34.4, 34.5 and 34.6 (a DRIFT line each). Fix: `kb.py index` takes the project name from the tracked config (project_id, else the repository's basename at the base ref), never the worktree folder.
status: open

### DW-85: Two import cycles introduced by Epic 34: `assets` ↔ `playable` (lib) and `enginemcp` → `hostverify` → `sandbox` → `enginemcp` (supervisor).
origin: retro epic-34 (_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md), A1
source_spec: `_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md`
location: plugins/tk-studio/lib/assets.py:111, lib/playable.py:749, :781-784; apps/supervisor/src/enginemcp.ts:60, hostverify.ts:92, :489, sandbox.ts:44
severity: medium
reason: `assets.py` imports `playable` for `kill_tree` while `playable.py` lazily imports `assets` for the PNG codec; the supervisor's MCP stop reaches back through sandbox.ts, and hostverify.ts dodges a third cycle with a dynamic `./registry` import. Neither existed at 458b0e8. Fix: a shared `lib/_proc.py` / `_png.py` and a one-way seam for the MCP stop.
status: open

### DW-86: Duplication across the epic's stories: user-env reads ×3, engine/Blender resolution ×5 with three rule sets, base-ref `git show` ×2, status-block scaffolding ×4, `_write_atomic` ×6, run_engine/run_blender, e2e `_checkout` ×3, judge validation ×2.
origin: retro epic-34 (_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md), A3
source_spec: `_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md`
location: plugins/tk-studio/lib (apps.py, assets.py, playable.py, engine_pin.py, playable_judge.py, doctor.py); apps/supervisor/src (server.ts, hostverify.ts, enginemcp.ts); contracts/conformance/e2e_*.py
severity: low
reason: See the retro's A3 row for the line ranges. Fix: one consolidation story: `lib/_core.py` for the status block, atomic writes and the HKCU-then-env read; one base-ref reader in the supervisor; one engine/Blender resolver with one rule set.
status: open

### DW-87: `assets.py` grew to 2,439 lines and twelve concerns; `enginemcp.ts` is also a process entry; `engage.py scope` grew 149 → 224 lines.
origin: retro epic-34 (_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md), A4
source_spec: `_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md`
location: plugins/tk-studio/lib/assets.py; apps/supervisor/src/enginemcp.ts:345-361; plugins/tk-studio/lib/engage.py:1150-1373
severity: low
reason: `assets.py` holds a YAML-subset reader beside the imported `miniyaml`, the validator, a PNG codec, a GLB parser, two Blender runners, the kit indexer, the matcher, two gates, the manifest rewriter, a Meshy client and the CLI. Fix: split `assets.py` by section before the next ladder story.
status: open

### DW-88: The judge's rubric ids live three times with no cross-pin.
origin: retro epic-34 (_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md), B5
source_spec: `34-3-the-playable-verify-leg-spec.md`
location: apps/supervisor/src/hostverify.ts:478; plugins/tk-studio/lib/playable_judge.py:51-60; plugins/tk-studio/skills/tk-studio-playable-judge/SKILL.md:38-42
severity: low
reason: A rubric line added or renamed in one place drifts silently from the other two. Fix: one source (the core's list) that the supervisor reads and a test that pins the SKILL.md list to it.
status: resolved 2026-10-29 by this story's PR (35.3: the core's `RUBRIC` is the one home — `playable_judge.py rubric` prints `{ids, rubric: [{id, line}]}` in a `complete` block, `hostverify.ts` runs it once per judge step and validates findings against it (`PLAYABLE_RUBRIC` removed), and `test_playable_judge.py` pins `RUBRIC_IDS` to the `SKILL.md` table, parsed, and to the contract's 34.3 sentence; contract 0.1.30)

### DW-89: A judge infrastructure failure reads as a failed game: a pin failure, an `sbx exec` outage or a missing status block becomes `playable.verdict: fail`.
origin: retro epic-34 (_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md), B10
source_spec: `34-3-the-playable-verify-leg-spec.md`
location: apps/supervisor/src/hostverify.ts:426, :619-630
severity: medium
reason: The run ends `partial` and the PR a draft for a cause that says nothing about the game. Fix: an `inconclusive` verdict that ends the leg `partial` with the infrastructure reason named, distinct from a rubric fail.
status: resolved 2026-10-29 by this story's PR (35.3: no sandbox, a thrown invoke, the pin (`pin`, `ran: false`), the auth preflight (`preflight`, `ran: false`), no status block (`conformance_failure`) or an unreadable rubric make `playable.verdict: inconclusive` with `infrastructure: <pin|sbx|status-block|auth|rubric>: <detail>`; the leg is neither green nor red, the run ends `partial` with `host verify inconclusive (playable): <reason>`, no finding recorded; the judge's own `blocked` stays `fail`; contract 0.1.30)

### DW-90: `is_game_project` is a `gds-` name prefix on the working set, so confirming the plugin-shipped `gds-engine-godot-4` alone makes every `scope` refuse `GameDocsMissing`.
origin: retro epic-34 (_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md), B11, Open questions
source_spec: `34-8-the-run-vertical-slice-job-and-the-engagements-game-path-spec.md`
location: plugins/tk-studio/lib/engage.py:797-799
severity: medium
reason: Now that the plugin itself ships a `gds-` skill, the prefix no longer means the gds module is installed. Fix: decide whether a game project requires the `gds` module (registry evidence) rather than a name; the contract's CAP-15 rule follows.
status: open

### DW-91: Regression gaps on the slice path: the sweep → `closeOut` `slice` flag has no end-to-end test; the sheet on a passing slice run is asserted nowhere; the bare-name contract between `sheet`'s `frames` and `proofCommit` is pinned by two independent literals.
origin: retro epic-34 (_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md), B14
source_spec: `34-8-the-run-vertical-slice-job-and-the-engagements-game-path-spec.md`
location: apps/supervisor/src/worktree.ts:917, :848, :445-448; apps/supervisor/test/hostverify.test.ts:902-909
severity: medium
reason: Every `host_commit` assertion calls `closeOut` directly and the one sheet test always harness-fails. Fix: one test story that drives the sweep to a slice close-out with a passing playable run and pins the frame-name contract in one place.
status: open

### DW-92: Smaller slice-path edges: `playable` without `verify.engine` reads `skipped: engine gate not green`; a `.mcp.json` with a BOM is refused; a moment at tick ≥ `--ticks` is never captured; `enginemcp.ts` reads the config at `run.prefix` but starts in the top level; the closeout page takes the last `host-verify`'s sheet; the `scoping` revise path never gains `game: true`.
origin: retro epic-34 (_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md), B15
source_spec: `_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md`
location: apps/supervisor/src/hostverify.ts:420-421, enginemcp.ts:398-426, delivery.ts:240-245; plugins/tk-studio/lib/recommend.py:528, playable.py:302-314, engage.py:1190-1196
severity: low
reason: Six one-line fixes the retro's lenses found, none exercised by a run yet. Fix: one hygiene story.
status: resolved 2026-10-29 by this story's PR (35.6: a declared `playable` with no `verify.engine` is skipped `no verify.engine`; `recommend.py` reads `.mcp.json` as `utf-8-sig` in `_mcp_status` and `record_mcp`; `PlayableHarness.cs` captures a moment at tick ≥ `--ticks` on the last tick and looks its report frame up at `Math.Min(tick, ticks - 1)`; `startEngineMcp` starts the server and the editor in `servedRoot(run)`; each story's closeout slice takes its own leg's sheet; a flagless `scoping` revise merges `game: true`; each with a test; contract 0.1.30)

### DW-93: The visual gate's shape after the box measurement: the floor stays `VISUAL_COVERAGE_MIN = 0.25`; a per-entry `coverage_min` override and a collision-aware rule are parked until a real slice needs them.
origin: retro epic-34 (_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md), C8, AI-4 (operator decision 2026-10-27)
source_spec: `34-7-the-cc0-mirror-and-the-paid-rung-behind-a-cap-spec.md`
location: plugins/tk-studio/lib/assets.py (VISUAL_COVERAGE_MIN); plugins/tk-studio/contracts/driver-contract.md (the visual gate paragraph); kb/asset-ladder.md:300-332
severity: low
reason: Five measured points (the crate 1.0, a synthetic pole 0.28, Kenney's lamp post 0.38, bench 0.52, pine 0.34) showed coverage of a real asset scaled into its box greybox is its fill of that box, so 0.25 keeps the gate a mis-framed-or-wrong-shape check (#219). Recorded as an accepted deviation so later retros stop re-flagging it; reopened only by a slice that fails the gate on a correct asset.
status: accepted 2026-10-27 (operator decision, EP-34 retro AI-4); no code change owed

### DW-94: Slice-path hardening (the retro's fix-now set, AI-2): the wall-clock tie, `match` fault by exit code alone, `.candidates/` staged by `proofCommit`, `sheet` sampling every movie frame, no proof without a green assets step, drive bounds above the runner cap, the Windows tree-kill branch untested.
origin: retro epic-34 (_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md), B1-B4, B8, B12, B13, AI-2
source_spec: `34-8-the-run-vertical-slice-job-and-the-engagements-game-path-spec.md`
location: apps/supervisor/src/hostverify.ts:445, :449, :547-549; src/worktree.ts:461-465, :547; plugins/tk-studio/lib/playable.py:392-400, :756-757; lib/assets.py:172, :1845-1877, :1917-1923; contracts/conformance/e2e_vertical_slice.py:43-44, e2e_engine_gate.py:44,48, runner.py:92
severity: medium
reason: One dev-loop story (band M): wall-clock margins (the leg's guard above the tool's `--wall`); `fault` read from the status block's reason/writeback/not-run; `.candidates` excluded and `git check-ignore` before staging; `sheet --report` samples the report's frames; the proof folder committed whenever a report exists; the drive bound asserts; the nt `taskkill /T /F` path tested where it runs. Filed here so the next epic's planner or a sweep reads it; the retro's rows carry the detail.
status: resolved 2026-10-29 by this story's PR (35.3: the tools' walls under `TOOL_WALL_MARGIN_S = 30` (assets `--wall`, playable `--wall-clock`); a crashed, `not-run` or write-back-failed `match` is `fault` and red; `proofCommit` runs `git check-ignore`, skips ignored paths (`skipped_ignored`) and stages the art path with `:(exclude)<art_path>/.candidates`, committed whenever `report.json` exists and the assets step is not red (`skipped: no manifest` included); `playable.py sheet --report` samples the report's `frames[]`; the drive bounds asserted (DW-70); the nt `taskkill /T /F` path of `kill_tree` tested on nt (`skipUnless`, the operator runs it on the host); contract 0.1.30)

### DW-95: The plan status dropped has no Jira status: promote skips a dropped entry and the pull-back would read a Done-category status as done.
origin: owner decision (Tim, 2026-10-28): a DNI status in the Done category instead of deleting issues
source_spec: Story 31.4 (jira promote / pull-back), the TKSTUDIO workflow
location: plugins/tk-studio/lib/jirabackend.py:752 (promote skips dropped); the pull-back status map (plansync.py SPRINT_STATUS_MAP, the category mapping)
severity: low
reason: Deleting a Jira issue is the owner's action and the Delete option is permission-gated on a company-managed project, so an orphan or an abandoned entry needs a terminal status instead: the owner adds DNI (Done category, a global transition) by hand. The studio should round-trip it: promote transitions a dropped entry's existing issue to DNI (and creates nothing for a dropped entry without one), the pull-back maps DNI to dropped rather than done, and setup creates DNI with its global transition on a new project. First case: TKSTUDIO-6, an orphan twin of EP-006 from the interrupted first sync.
status: open

### DW-96: `measurepush.py push` harvests Stage Log rows only from the studio repo it is given, so rows in other registered project roots never become `stage` events.
origin: spec-deferred 2d886fb1f616
source_spec: `35-8-every-stage-leaves-a-start-and-a-stop-spec.md`
location: plugins/tk-studio/lib/measurepush.py:300
severity: medium
reason: harvest_stages(directory) is called with the push's single --directory (the studio repo root); AC3 says a stage event carries each row. Deferral class (a): behaviour the criteria name.
status: open

### DW-97: Follow-up review still recommended for 35-8-every-stage-leaves-a-start-and-a-stop after the damping cap was spent
origin: review-budget-followup
source_spec: `35-8-every-stage-leaves-a-start-and-a-stop-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261028-234105-ee1e; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-98: Story 35.2's spec and plan pinned two contradictions into its intent contract; both were fixed in its review, the source wording is still wrong.
origin: review of 35-2-every-story-gets-its-plan-and-its-records (consult: accept-deviation, score 2)
source_spec: `35-2-every-story-gets-its-plan-and-its-records-spec.md`
location: _bmad-output/specs/spec-epic-35/plans/35-2.md (Settled shape, Code Map); _bmad-output/specs/spec-epic-35/SPEC.md (CAP-3 design note); the 35-2 spec's Boundaries & Constraints
severity: low
reason: (1) "Change nothing else in that file" left `task-planning.md` §2's "Next story" as "the first entry with no spec file and no plan", so once the bootstrap plans every entry the first story boundary would record `epic complete` while stories remain; (2) the open-question shape was pinned as the single-CAP `^- CAP-(\d+):`, which misses the real Epic 34 SPEC's `- CAP-9 and CAP-10:` and `- CAP-4 and CAP-5:` lines (the plan asked the parser to handle those SPECs). The review fixed both (§2: the next story is the first entry with no spec file, an existing bootstrap plan re-checked and refreshed; the parser takes CAP lists in questions and design-note subjects) and limited the bootstrap's open-question block to the named/next story (a later story's unsettled CAP is a Block If in its plan). Fix: correct the plan's and SPEC's wording at the next spec pass.
status: open

### DW-99: Follow-up review still recommended for 35-2-every-story-gets-its-plan-and-its-records after the damping cap was spent
origin: review-budget-followup
source_spec: `35-2-every-story-gets-its-plan-and-its-records-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261029-024051-cdae; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-100: The board and the plan status misread an inconclusive host-verify leg: green on the board, red in planstatus.
origin: review of 35-3-the-slice-path-hardened
source_spec: `35-3-the-slice-path-hardened-spec.md`
location: apps/supervisor/src/board.ts:262 (hostVerifyOf); apps/supervisor/src/planstatus.ts:444
severity: medium
reason: `apps/supervisor/src/board.ts hostVerifyOf` (~:262) and `planstatus.ts` (~:444) show an inconclusive host-verify leg as green (board, files the run under done instead of needs_you) or red (planstatus); the contract says they read the latest host-verify through `green`. Found by 35.3's review; outside 35.3's Files.
status: open

### DW-101: board.ts hostVerifyOf and planstatus.ts misread an inconclusive host-verify leg (green on the board, filed under done; red in planstatus).
origin: spec-deferred ad45d836e227
source_spec: `35-3-the-slice-path-hardened-spec.md`
location: apps/supervisor/src/board.ts:262
severity: medium
reason: Both review layers: board.ts ~:262 uses isRed(d) ? "red" : "green"; planstatus.ts ~:444 uses green ? "green" : "red". 35.3 made isRed false for an inconclusive leg. Both files are outside the plan's Files; the consult ruled to defer (DW-100). Meets deferral class (a): behaviour AC3 names (the run ends partial).
status: open

### DW-102: Follow-up review still recommended for 35-3-the-slice-path-hardened after the damping cap was spent
origin: review-budget-followup
source_spec: `35-3-the-slice-path-hardened-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261029-045514-f337; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-103: The tk-studio-playable-judge-verdict eval case cannot reach its media fixture from the eval harness's working directory
origin: operator run q-maintenance-evals-20261029T121940Z-40fe02 (hole 99, 2026-10-29)
source_spec: `35-5-the-sandbox-and-the-host-agree-spec.md`
location: plugins/tk-studio/evals/tk-studio-playable-judge-verdict/
severity: medium
reason: On the sandbox tier (claude 2.1.312, plugin 0.3.8) all three `with` runs ended `blocked`, judge votes FAIL x3: the prompt's `{media: "media"}` resolves against the eval harness's temp working directory (`/tmp/claude-eval-*/`), which holds no fixture, so the skill reports the media folder absent and never judges; the case measures the harness, not the skill (as hole 85's host runs measured the host). Fix: the case carries its fixture into the working directory (the eval's setup, or an absolute path under the plugin root the prompt names), then the maintenance-evals job runs again and the acceptance record's row is re-read.
status: open

### DW-104: Follow-up review still recommended for 35-7-the-run-sweep-job-type after the damping cap was spent
origin: review-budget-followup
source_spec: `35-7-the-run-sweep-job-type-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261029-135846-4d12; this entry preserves the lingering recommendation for a deliberate later review.
status: open
