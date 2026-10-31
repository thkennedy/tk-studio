# Deferred Work

### DW-124: Contract §4 `submit` admitted a full job definition but the CLI/skill surface was id-only
origin: migrated from legacy ledger ("Deferred from: code review of feat/tk-studio-connector (2026-08-06)"), 2026-10-29
location: plugins/tk-studio/contracts/driver-contract.md §4 submit
reason: Legacy item DW-1. Contract §4 `submit` admitted "a job definition (or the id …)" but the CLI/skill surface was id-only; the wording fix was deferred to fold into the deliberate 1.7.0 MINOR contract bump.
status: done 2026-08-07
resolution: Resolved 2026-08-07 (ST-039, contract 0.1.7, shipped as 1.7.0 and renumbered to pre-1.0 the same day): §4 `submit` now reads id-only ("the id of a shipped/project job instance — a full-definition submit form is not part of this surface"), folded into the 1.7.0 MINOR bump as planned.

### DW-125: Connector test suite is live-integration only and cannot run without an onboarded tk-studio
origin: migrated from legacy ledger ("Deferred from: code review of feat/tk-studio-connector (2026-08-06)"), 2026-10-29
location: ClaudeOS/connectors/tk-studio/server.test.ts
reason: Legacy item DW-2. The connector test suite is live-integration by design: it asserts against the real registry and studio install, so it cannot run on a machine without an onboarded tk-studio. Acceptable for the personal ClaudeOS repo (no CI); add a fixture/mock path only if the repo ever grows CI.
status: open

### DW-126: Contract §8/§6 PATCH-level wording drift (unrunnable-core assertion, four-plane health)
origin: migrated from legacy ledger ("Deferred from: AD-11/AD-13 hardening PRs (2026-08-06)"), 2026-10-29
location: plugins/tk-studio/contracts/driver-contract.md §6, §8
reason: Legacy item DW-3. PATCH-level wording drift: the behavior had already shipped and been asserted by the suite, but §8 did not name the suite's `unrunnable-core` assertion and §6 did not read four-plane.
status: done 2026-08-07
resolution: Resolved 2026-08-07 (ST-039, contract 0.1.7): §8 names the suite's `unrunnable-core` assertion and §6 reads four-plane (base, plugin incl. harness loadability, store, vault), folded into the 1.7.0 bump together with legacy DW-1 (now DW-124).

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
status: resolved 2026-10-29 by thkennedy/tk-studio#290 (sweep bundle dw-job-finish-idempotence; resolved by sweep bundle dw-job-finish-idempotence)
resolution: resolved by sweep bundle dw-job-finish-idempotence

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
status: resolved 2026-10-29 by thkennedy/tk-studio#290 (sweep bundle dw-studio-drift-and-routing-text; resolved by sweep bundle dw-studio-drift-and-routing-text)
resolution: resolved by sweep bundle dw-studio-drift-and-routing-text

### DW-12: A studio-web update while the supervisor leg is `reported` (source checkout) or `skipped` renames the live studio-web slot aside with nothing restarted, so a running supervisor may serve a renamed pat
origin: spec-deferred 8afffc622e6a
source_spec: `25-4-the-bootstrap-and-the-meta-cli-the-bootstrap-and-the-meta-cli.md`
location: tools/installer/cli/tk_studio_cli/apps.py apply_slots / run_legs
severity: medium
reason: apply_slots computes restart = live_sup only when the supervisor leg is `unchanged`; for `reported`/`skipped` restart is None, must_start is False, and swap() still renames the old web slot to .<version>.previous. Consult 2026-10-14 ruled a `reported` studio_web status out of scope for a review patch (AC3 is supervisor-only, spec Design Notes; a new leg status needs a planned I/O-matrix entry). Deferral rule (a): behaviour AC2 names (the supervisor serves the studio-web slot). Reader: 25-5.
status: resolved 2026-10-29 by thkennedy/tk-studio#293 (sweep; already resolved: Commit 603192a (Story 30-2, 2026-10-19, after the deferral): the supervisor resolves the studio-web root per request — apps/supervisor/src/ap…)
resolution: already resolved: Commit 603192a (Story 30-2, 2026-10-19, after the deferral): the supervisor resolves the studio-web root per request — apps/supervisor/src/api.ts:926 web() calls webRoot() (apps/supervisor/src/web.ts:44-51), which reads current.json's "studio-web".path fresh each time (slotRoot, web.ts:31-41), so after swap() rewrites current.json (tools/installer/cli/tk_studio_cli/apps.py swap) a running supervisor serves the new slot without a restart; a source-checkout supervisor serves apps/studio-web/dist and never the renamed slot.

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
status: resolved 2026-10-29 by thkennedy/tk-studio#293 (sweep bundle dw-doctor-hermes-config-fallback; resolved by sweep bundle dw-doctor-hermes-config-fallback)
resolution: resolved by sweep bundle dw-doctor-hermes-config-fallback

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
status: resolved 2026-10-29 by thkennedy/tk-studio#290 (sweep bundle dw-consult-scope-wiring; resolved by sweep bundle dw-consult-scope-wiring)
resolution: resolved by sweep bundle dw-consult-scope-wiring

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
status: resolved 2026-10-29 by thkennedy/tk-studio#293 (sweep bundle dw-office-json-eol-pin; resolved by sweep bundle dw-office-json-eol-pin)
resolution: resolved by sweep bundle dw-office-json-eol-pin

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
status: resolved 2026-10-29 by thkennedy/tk-studio#290 (sweep bundle dw-atlassian-round-trip; resolved by sweep bundle dw-atlassian-round-trip)
resolution: resolved by sweep bundle dw-atlassian-round-trip

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
status: resolved 2026-10-31 by this story's PR (36.5: a core's own `status` lifts into the run `state`; `ok: false` with no status is `blocked`)

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
status: resolved 2026-10-31 by this story's PR (36.3: `approve.ts runStep` calls `track.py unblock --engagement --kind cap|ask` once per block after the owner's go or continue, recording `unblocked`; `questions.ts closeStep` closes the owed questions block after it)

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
status: resolved 2026-10-31 by this story's PR (36.5: `_last_end` ranks a keeper, pacer or serve end, any `uncaught` and a non-zero exit above the routine tee lines)

### DW-56: The pin-restart episode is bounded only by claim-refusal-cleared or run start, so a run whose restart healed at its claim cannot be restarted at a later relaunch or resume.
origin: spec-deferred ea7728db7fd4
source_spec: `33-3-the-pin-restarts-a-logged-out-sandbox-spec.md`
location: apps/supervisor/src/sandbox.ts openPinRestart
severity: medium
reason: clearClaimRefusals writes claim-refusal-cleared only when refusals were open (queue.ts:2202-2211); openPinRestart then still finds the old pin-restart; the run ends blocked naming the renewal (fail-safe). Consult ruling B, deferral criterion (a).
status: resolved 2026-10-31 by this story's PR (36.5: the bound reads `Queue.openPinRestartOn`, a healed signal reopens it, so a healed restart no longer lingers)

### DW-57: The launch check treats any .pin file as pinned by the supervisor, so a record left by a manual sbx stop, reboot or kept release hides AC2's started-outside warning.
origin: spec-deferred 9c932b6c59fb
source_spec: `33-3-the-pin-restarts-a-logged-out-sandbox-spec.md`
location: plugins/tk-studio/lib/launch.py engine_sandbox_row
severity: low
reason: The record is removed only when pin-released stopped the sandbox (Settled shape 3); engine_sandbox_row reads presence only. Proposed: treat a .pin whose supervisor_pid is dead or whose since predates the sandbox start as absent. Consult ruling D, deferral criterion (a).
status: resolved 2026-10-29 by thkennedy/tk-studio#290 (sweep bundle dw-launch-check-advisories; resolved by sweep bundle dw-launch-check-advisories)
resolution: resolved by sweep bundle dw-launch-check-advisories

### DW-58: Several queued runs on one sandbox that stays logged out (a token no restart heals) restart it once per run, one per drain pass, because guard (d) reads only the gated run's own episode.
origin: spec-deferred c443898760e1
source_spec: `33-3-the-pin-restarts-a-logged-out-sandbox-spec.md`
location: apps/supervisor/src/sandbox.ts openPinRestart / pinWithRestart
severity: medium
reason: openPinRestart reads queue.events(runId) only and the per-pass set is fresh each pass: runs A, B, C queued on S give a stop/start in pass 1 (A), pass 2 (B) and pass 3 (C), each able to cut off an operator's interactive `/login` renewal. Spec-conformant (Settled shape 2 guards (c)/(d) verbatim), so not a patch; deferral criterion (a), AC1's "stops and starts the sandbox once". Proposed: bound guard (d) per sandbox across the queue (any run's open pin-restart on S since S's last healed probe).
status: resolved 2026-10-31 by this story's PR (36.5: guard (d) is per sandbox across the queue, any run's open `pin-restart` counting)

### DW-59: `tk-studio-launch check` has no inode warning for the engine sandbox, so a /tmp filling up again (hole 70: 1.3 M inodes while 33-1 ran) is seen only when the engine fails to write.
origin: spec-deferred 33-4 (plans/33-4.md Settled shape 6, the replan suggestion from 33-1)
source_spec: `33-4-the-host-leg-runs-the-supervisors-suites-spec.md`
location: plugins/tk-studio/lib/launch.py (the advisory rows of `check`)
severity: low
reason: Evidence hole 70: the supervisor suites' `tk-sup-*` leak filled the engine sandbox's /tmp to 1.3 M inodes during 33-1. Story 33.4 removes the cause (`apps/supervisor/test/tmp.ts` cleans every suite's folders under every exit) but not the symptom check. Proposed: an advisory `check` row that warns below 50,000 free inodes, read with `df -i /` through `sbx exec`. Outside 33-4's AC1/AC2 and its oversize band, so deferred. DRIFT: the inode warning deferred — affects: none.
status: resolved 2026-10-29 by thkennedy/tk-studio#290 (sweep bundle dw-launch-check-advisories; resolved by sweep bundle dw-launch-check-advisories)
resolution: resolved by sweep bundle dw-launch-check-advisories

### DW-60: The supervisor's pin (`pinBeforeClaim`) does not prune the engine sandbox's /tmp, so `tk-sup-*` and `tmp.*` leftovers from earlier runs (hole 70) accumulate until removed by hand.
origin: spec-deferred 33-4 (plans/33-4.md Settled shape 6, the replan suggestion from 33-1)
source_spec: `33-4-the-host-leg-runs-the-supervisors-suites-spec.md`
location: apps/supervisor/src/cli.ts (pinBeforeClaim), apps/supervisor/src/sandbox.ts (the pin, reshaped by 33-3)
severity: low
reason: Evidence hole 70 (1.3 M inodes in the sandbox's /tmp while 33-1 ran). Story 33.4's `tmp.ts` stops new leaks from the suites; folders left by older runs, killed processes or other tools stay. Proposed: when the pin starts or adopts the sandbox, prune `/tmp/tk-sup-*` and `/tmp/tmp.*` older than a day through `sbx exec` (argv only, never a shell glob from the host). Outside 33-4's AC1/AC2 and its oversize band, and the pin was reshaped by 33-3, so deferred. DRIFT: the /tmp prune at the pin deferred — affects: none.
status: resolved 2026-10-31 by this story's PR (36.5: the pin prunes `tk-sup-*` and `tmp.*` from the VM's `/tmp`, recorded as `tmp_pruned`)

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
status: resolved 2026-10-31 by this story's PR (36.6: the `verify commands` row refuses a tracked or unignored policy before the write, `pipeline.policy_dirties_tree`)

### DW-63: A pacer pass that hangs or runs long is invisible until it ends: the slow-pass warning, the notifier line and pacer.json are written only when the child closes.
origin: spec-deferred 9d30780dcdae
source_spec: `33-7-a-resumed-engines-graceful-stop-ends-complete-and-the-pacers-spec.md`
location: apps/supervisor/src/log.ts (runUnderLog finish)
severity: medium
reason: Criterion (a), AC2's slow-pass visibility. Settled shape 3/4 write at pass end, which meets AC2 as written; a 30-minute tick is still seen only at minute 30, and a tick that never returns leaves `pacer` on stale values. Consult ruling 2026-10-27: reject as a 33.7 fix, record as deferred.
status: resolved 2026-10-31 by this story's PR (36.5: the slow-pass warning, the notifier line and `pacer.running` are written while the pass runs)

### DW-64: A resumed or relaunched engine the supervisor killed, whose host verify was skipped, still has its open PR marked ready even though the run ends partial.
origin: spec-deferred 0f1fc9058132
source_spec: `33-7-a-resumed-engines-graceful-stop-ends-complete-and-the-pacers-spec.md`
location: apps/supervisor/src/worktree.ts closeOut (the !input.verify branch, ~:480-483)
severity: medium
reason: Criterion (a), AC1's "the PR not a draft" tied to a complete end. Pre-existing at baseline c5749a6: closeOut's skipped-verify branch runs `gh pr ready` whatever the end state. Pinned as today's behaviour by the closeout.test.ts killed-resumed test comment.
status: resolved 2026-10-31 by this story's PR (36.3: `closeOut`'s `killed` keeps the PR a draft when `sweepEngines` skipped the verify for a killed engine; the remainder stays open: the late terminal close-out, `closeOutNow` and `cancel` still mark a draft ready without a verify)

### DW-65: A killed relaunch whose engine handled TERM and reads stopped ends `relaunched engine ended 'stopped'` instead of keeping launched.end (the guard trip's reason is lost).
origin: spec-deferred c8ff9ff15f87
source_spec: `33-7-a-resumed-engines-graceful-stop-ends-complete-and-the-pacers-spec.md`
location: apps/supervisor/src/worktree.ts sweepEngines (the relaunched predicate)
severity: medium
reason: Criterion (a), the story's rule "a killed relaunch keeps launched.end". Pre-existing at baseline: the `relaunched` predicate tests only st.detail.killed, set only when the probe did not read ended; killedEngine() is not consulted. Pinned by the closeout.test.ts killed-relaunch test comment.
status: resolved 2026-10-31 by this story's PR (36.3: `relaunched` requires `notKilled`, so a killed relaunch keeps `launched.end` and the guard's reason)

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
status: resolved 2026-10-30 by this story's PR (36.2: `hostleg.ts runLeg` emits the judge's cost as its own `job-run` line, `<run_id>:verify-<n>`)

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
status: resolved 2026-10-31 by this story's PR (36.6: `provision-engine.sh` writes `~/.tk-studio/provisioned`; `engine_gate_clause` reads it over `sbx exec` and warns on a gate without it)

### DW-72: Once an operator confirms gds-engine-godot-4 into working_set.<role>, orchestrate.py routing shows it as kind unknown, status missing ("re-run onboarding or install it"), because inventory.py has no p
origin: spec-deferred c0a1e6088bbb
source_spec: `34-4-engine-knowledge-pinned-per-project-spec.md`
location: plugins/tk-studio/lib/orchestrate.py _resolve_routes; plugins/tk-studio/lib/inventory.py planes
severity: low
reason: Plan 34-4 Risks and the spec's Never rule ("Widen inventory.py/orchestrate.py routing (recorded as a deferral instead)") require this deferral; follow-up blind review found it unrecorded. Class (a): the routing display of AC1's confirmed skill. Display only: the skills mount does not depend on it.
status: resolved 2026-10-29 by thkennedy/tk-studio#290 (sweep bundle dw-studio-drift-and-routing-text; resolved by sweep bundle dw-studio-drift-and-routing-text)
resolution: resolved by sweep bundle dw-studio-drift-and-routing-text

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
status: resolved 2026-10-29 by thkennedy/tk-studio#267 (35.5: when `GODOT` is an absolute path, the engine step makes a per-step shim dir holding `godot` (and `godot.cmd` on win32) that execs `$GODOT`, prepended to the step's PATH, and an argv[0] `godot` is spawned as `$GODOT` (`engine.godot_shim`); contract 0.1.30; the runbook's hole 78 row says `shim`)

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
status: resolved 2026-10-29 by thkennedy/tk-studio#267 (35.5: the cause was the sandbox's unset `TK_STUDIO_ROOT`, inherited by the tests' `{...process.env}` fake env on the host only and swallowed by `closeoutPass`; the tests' injected env now carries it; `plugins/tk-studio/README.md` `## Sandbox notes for the suites` names the rule, the bun path and the known residual)

### DW-81: Two of Story 34.8's three eval cases cannot run on the Windows host: the eval child can neither grant a shell nor read the plugin's docs (hole 85).
origin: operator ledger, hole 85 + addendum (2026-10-27T22:1xZ); retro C7, AI-1
source_spec: `34-8-the-run-vertical-slice-job-and-the-engagements-game-path-spec.md`
location: plugins/tk-studio/evals/tk-studio-playable-judge-verdict, evals/asset-ladder-generated-rung; kb/acceptance-record-34-8-vertical-slice-on-tua.md step 7
severity: low
reason: `claude plugin eval` refuses a Bash/Write grant on the box (the Windows sandbox gate is off, `sandbox.failIfUnavailable` set) and, without one, Glob/Grep are refused in don't-ask mode and the plugin cache is denied by the kept deny list: pinned-facts 3 of 3, the judge and asset-ladder cases 0 of 3, measuring the host. Fix: run those cases on the sandbox tier (a job, or the maintenance path) or carry their facts in the skill text; the record names the tier per case. The sandbox setting stays the owner's.
status: resolved 2026-10-29 by thkennedy/tk-studio#267 (35.5: the shipped `maintenance-evals` job (`requires: {tier: sbx}`, the `tk-studio-evals` surface over `lib/evals.py run`) runs the two cases on the sandbox tier and the record's step 7 names the tier per case; run twice on 2026-10-29 (holes 98, 99): `asset-ladder-generated-rung` 3/3; the judge case's half is carried by DW-103 (its media fixture is unreachable from the eval harness's working directory))

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
status: resolved 2026-10-29 by thkennedy/tk-studio#293 (sweep bundle dw-kb-index-title; resolved by sweep bundle dw-kb-index-title)
resolution: resolved by sweep bundle dw-kb-index-title

### DW-85: Two import cycles introduced by Epic 34: `assets` ↔ `playable` (lib) and `enginemcp` → `hostverify` → `sandbox` → `enginemcp` (supervisor).
origin: retro epic-34 (_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md), A1
source_spec: `_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md`
location: plugins/tk-studio/lib/assets.py:111, lib/playable.py:749, :781-784; apps/supervisor/src/enginemcp.ts:60, hostverify.ts:92, :489, sandbox.ts:44; Epic 35: apps/supervisor/src/sweep.ts:49, :53 ↔ planstatus.ts:102, worktree.ts:94; closeout.ts:114 → sweep.ts:49 → planstatus.ts:98 → closeout; plugins/tk-studio/lib/report.py:285 (`plansync._stage_target`)
severity: medium
reason: `assets.py` imports `playable` for `kill_tree` while `playable.py` lazily imports `assets` for the PNG codec; the supervisor's MCP stop reaches back through sandbox.ts, and hostverify.ts dodges a third cycle with a dynamic `./registry` import. Neither existed at 458b0e8. Fix: a shared `lib/_proc.py` / `_png.py` and a one-way seam for the MCP stop. Epic 35 (retro-epic-35 A1): three more supervisor cycles, all through the one new module — `sweep ⇄ worktree` (`sweep.ts:53` ↔ `worktree.ts:94`), `sweep ⇄ planstatus` (`sweep.ts:49` ↔ `planstatus.ts:102`), `closeout → sweep → planstatus → closeout` (`closeout.ts:114`, `sweep.ts:49`, `planstatus.ts:98`); the static SCC grew from 8 to 11 modules; the `registerSweepLine` dodge (`hygiene.ts:159-172`, `sweep.ts:283`) covers one of four edges into sweep, and 35.2 added a third dynamic-import dodge (`closeout.ts:919 → cli`). In lib, `plansync.py` became cross-cutting (in-degree 3 → 5: `measurepush.py:46`, `report.py:52-54`) and `report.py:285` reaches the private `plansync._stage_target`. The Epic 34 cycles are unchanged. Fix, added: sweep's edges into worktree and planstatus go one way (the pass-registry pattern `registerSweepLine` already uses), and a `stagelog.py` seam (DW-87) removes the private reach.
status: resolved 2026-10-31 by this story's PR (36.7: `sweep ⇄ worktree`, `sweep ⇄ planstatus` and `closeout → sweep → planstatus → closeout` cut through `src/runners.ts`, `src/planseams.ts` and `queue.ts`; the `registerSweepLine` dodge and the `hostverify.ts → ./registry` dynamic import gone (`src/route.ts`), `closeout.ts → ./cli` already gone by 36.3; `hygiene ⇄ server` gone (`env.ts`); the MCP stop one way (`SandboxDeps.stopEngineMcp`, `src/enginemcp-kinds.ts`); `assets ⇄ playable` gone (`lib/_proc.py`, `lib/_png.py`); pinned by `apps/supervisor/test/cycles.test.ts` and `lib/tests/test_import_cycles.py`. Residuals stated, allowlisted exactly in those tests: `queue ⇄ sandbox`, `api ⇄ cli`, the board…registry SCC {board, engagement, inbox, log, office, page, registry} and, in the lib, `inbox ⇄ syncback`. Not taken: the `enginemcp.ts → ./api` dynamic import; `report.py`'s private reach into `plansync._stage_target` goes with DW-87's `stagelog.py`)

### DW-86: Duplication across the epic's stories: user-env reads ×3, engine/Blender resolution ×5 with three rule sets, base-ref `git show` ×2, status-block scaffolding ×4, `_write_atomic` ×6, run_engine/run_blender, e2e `_checkout` ×3, judge validation ×2.
origin: retro epic-34 (_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md), A3
source_spec: `_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md`
location: plugins/tk-studio/lib (apps.py, assets.py, playable.py, engine_pin.py, playable_judge.py, doctor.py); apps/supervisor/src (server.ts, hostverify.ts, enginemcp.ts); contracts/conformance/e2e_*.py; Epic 35: plansync.py:2174-2206, :2974-3140, :3207, jirabackend.py:1248-1257, :1274-1294, report.py:81-89, :312-339, launch.py:1278-1310, :1362, :1441-1512, evals.py:80-99; apps/supervisor/src/hostverify.ts:871-881, planstatus.ts:330-349, :454, :488-495, :568-626, sweep.ts:132-137, :187-202, :381-426, hostleg.ts:172-204, closeout.ts:418-426
severity: low
reason: See the retro's A3 row for the line ranges. Fix: one consolidation story: `lib/_core.py` for the status block, atomic writes and the HKCU-then-env read; one base-ref reader in the supervisor; one engine/Blender resolver with one rule set. Epic 35 (retro-epic-35 A2, the EP-35 retro's A2 row has the line ranges): four ISO-8601 → UTC parsers beside `jirabackend._parse_stamp`; the leg verdict derived three times (`hostverify.ts:871-872`, `:881`, `planstatus.ts:454`) and only the first two know `inconclusive` (DW-100); `hostleg.ts` re-wrote the close-out's commit read, push and proof-URL lines inline, so 35.3 edited both `sheetUrl` copies; `launch.py sweep` copies `start`'s spawn-and-await block and `_sweep_engine_phase` re-reads what `status()` returns; `LEDGER_REL` defined twice by one story; four new JSON/JSONL readers beside `meter.py:142-166`; the `[stage:<key> …]` marker text ×5 and the find-or-post sequence ×2; `list_worklogs` copies `issue_comments`; the lease/retry loop inlined twice beside `leased()`; two more `gh pr view` merge-state probes; `callStage` beside `callStatus`; two more journal line loops; this entry's classes got worse (`evals._write_atomic`, a TS `writeAtomic` beside the exported one, `evals.with_block` = `launch.with_block`, two more `_finish*` builders). Fix, added: one `legVerdict`, one timestamp helper, one `_spawn_and_await`, one lease loop, one merge-state probe.
status: open — narrowed 2026-10-31 by this story's PR (36.7: `lib/_core.py` holds the status block (`BLOCK_KEYS`, `with_block`, six modules keep a wrapper), `_write_atomic` (assets, playable, playable_judge), `user_env`/`_hkcu_value` and `resolve_binary` (playable, assets, launch); `lib/_proc.py` holds `kill_tree` and `run_logged` (run_engine, run_blender); `src/gitshow.ts` holds the base-ref `git show` (hostverify, enginemcp, planstatus, delivery); the supervisor's user-env read was already one `server.ts` export `inbox.ts` imports; remaining: the installer's user-env (`apps.py`) and binary (`doctor.py`) copies, the TS resolver copies (`enginemcp.ts`, `hostverify.ts`), `measurepush.py _file_at_ref` and `promote.py`'s `cat-file`, the `_finish` variants (engage, report, track, plansync), the differing `_write_atomic`s (`evals.py` text, `launch.py` copymode), e2e `_checkout` ×3, judge validation ×2 and the Epic 35 rows of this entry; `src/gitshow.ts` holds two readers (`showAtBase`, `atRef`) with different not-found rules; `gitshow.ts` and `runners.ts` carry their own small error-text and redact helpers beside `worktree.ts`'s)

### DW-87: `assets.py` grew to 2,439 lines and twelve concerns; `enginemcp.ts` is also a process entry; `engage.py scope` grew 149 → 224 lines.
origin: retro epic-34 (_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md), A4
source_spec: `_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md`
location: plugins/tk-studio/lib/assets.py; apps/supervisor/src/enginemcp.ts:345-361; plugins/tk-studio/lib/engage.py:1150-1373; Epic 35: plugins/tk-studio/lib/plansync.py:2116-3301 (the stage log and `ledger-resolve`), lib/report.py (no `test_report.py`); apps/supervisor/src/planstatus.ts (the stage pass), hostverify.ts (no section markers)
severity: low
reason: `assets.py` holds a YAML-subset reader beside the imported `miniyaml`, the validator, a PNG codec, a GLB parser, two Blender runners, the kit indexer, the matcher, two gates, the manifest rewriter, a Meshy client and the CLI. Fix: split `assets.py` by section before the next ladder story. Epic 35 (retro-epic-35 A3): `plansync.py` 2,138 → 3,508 lines (126 defs/classes, 12 sections), 99 % of the growth the stage log (`:2116-3202`, 35.8) and `ledger-resolve` (`:3205-3301`, 35.7) — two products inside the plan-sync module, consumed as a sub-API by report.py, measurepush.py, `planstatus.ts` and the engine hook, the `# ---- stage log` marker the natural seam; `planstatus.ts` 369 → 631, the stage pass 42 % of the file and the one supervisor pass not in its own module (the shape 35.7 chose for `ledgerPass`); `hostverify.ts` 735 → 943 with five step kinds, the judge-process layer and the PR renderer and no section markers; `report.py` test-to-code ≈ 0.4. Fix, added: `lib/stagelog.py` (the stage log and `ledger-resolve` out of plansync.py, which also closes DW-85's private reach) and `src/stagepass.ts` beside `sweep.ts`; section markers in `hostverify.ts`; a `test_report.py`. Lands before Epic 36 adds surface on `sweep.ts`/`planstatus.ts` (AI-10).
status: open — narrowed 2026-10-31 by this story's PR (36.7: `assets.py` split along `lib/_png.py`, `lib/_proc.py`, `lib/_core.py` and `lib/_glb.py`; `engage.py scope` back under 149 lines, its two closures lifted to module level; remaining: the assets manifest reader and validator, the generator/index/mirror/match/write-back/placement split (blocked by the tests' patch targets through `assets.`), `plansync.py` → `lib/stagelog.py`, `src/stagepass.ts`, `hostverify.ts` section markers, a `test_report.py`, `report.py`'s reach into `plansync._stage_target`, `enginemcp.ts` as a process entry)

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
status: resolved 2026-10-31 by this story's PR (36.6: `is_game_project` also needs the manifest's `gds` module)

### DW-91: Regression gaps on the slice path: the sweep → `closeOut` `slice` flag has no end-to-end test; the sheet on a passing slice run is asserted nowhere; the bare-name contract between `sheet`'s `frames` and `proofCommit` is pinned by two independent literals.
origin: retro epic-34 (_bmad-output/specs/spec-epic-34/RETROSPECTIVE.md), B14
source_spec: `34-8-the-run-vertical-slice-job-and-the-engagements-game-path-spec.md`
location: apps/supervisor/src/worktree.ts:917, :848, :445-448; apps/supervisor/test/hostverify.test.ts:902-909
severity: medium
reason: Every `host_commit` assertion calls `closeOut` directly and the one sheet test always harness-fails. Fix: one test story that drives the sweep to a slice close-out with a passing playable run and pins the frame-name contract in one place.
status: resolved 2026-10-30 by this story's PR (36.1: `sweepEngines` driven to `closeOut` with `slice: true` on a passing playable run asserts the sheet; `FRAMES_DIR` is the one literal `MEDIA`, `legProof` and `proofCommit` read, the bare-name contract with `playable.py sheet` pinned on both sides)

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
reason: One dev-loop story (band M): wall-clock margins (the leg's guard above the tool's `--wall`); `fault` read from the status block's reason/writeback/not-run; `.candidates` excluded and `git check-ignore` before staging; `sheet --report` samples the report's frames; the proof folder committed when this leg's playable step ran (exit 0 or 1) and left a `report.json` (narrowed from "whenever a report exists" by the 35.3 review, pass 2: a stale earlier leg's proof is never committed as this leg's); the drive bound asserts; the nt `taskkill /T /F` path tested where it runs. Filed here so the next epic's planner or a sweep reads it; the retro's rows carry the detail.
status: resolved 2026-10-29 by this story's PR (35.3: the tools' walls under `TOOL_WALL_MARGIN_S = 30` (assets `--wall`, playable `--wall-clock`); a crashed, `not-run` or write-back-failed `match` is `fault` and red; `proofCommit` runs `git check-ignore`, skips ignored paths (`skipped_ignored`) and stages the art path with `:(exclude)<art_path>/.candidates`, committed when this leg's playable step ran (not skipped; exit 0 or 1) and left `report.json`, the assets step not red (`skipped: no manifest` included); `playable.py sheet --report` samples the report's `frames[]`; the drive bounds asserted (DW-70); the nt `taskkill /T /F` path of `kill_tree` tested on nt (`skipUnless`, the operator runs it on the host); contract 0.1.30)

### DW-95: The plan status dropped has no Jira status: promote skips a dropped entry and the pull-back would read a Done-category status as done.
origin: owner decision (Tim, 2026-10-28): a DNI status in the Done category instead of deleting issues
source_spec: Story 31.4 (jira promote / pull-back), the TKSTUDIO workflow
location: plugins/tk-studio/lib/jirabackend.py:752 (promote skips dropped); the pull-back status map (plansync.py SPRINT_STATUS_MAP, the category mapping)
severity: low
reason: Deleting a Jira issue is the owner's action and the Delete option is permission-gated on a company-managed project, so an orphan or an abandoned entry needs a terminal status instead: the owner adds DNI (Done category, a global transition) by hand. The studio should round-trip it: promote transitions a dropped entry's existing issue to DNI (and creates nothing for a dropped entry without one), the pull-back maps DNI to dropped rather than done, and setup creates DNI with its global transition on a new project. First case: TKSTUDIO-6, an orphan twin of EP-006 from the interrupted first sync. Hole 100 (2026-10-29): until the promote picker skipped `DNI`, every canonical `done` landed there (five stories, moved back to `Done` by hand); the picker now skips `DROPPED_STATUS_NAMES`, the DNI round trip (pull-back to `dropped`, setup creating it) stays open here. Remaining scope (EP-35 retro C7, AI-5): done are `dropped` → `DNI` on promote (#254) and the picker skipping `DROPPED_STATUS_NAMES` with a note on an issue whose only route into the category is a dropped status (#275); still owed are the pull-back mapping `DNI` to canonical `dropped` (today a Done-category status reads `done`, so a dropped issue comes back `done`), `setup` creating `DNI` with its global transition on a new project (with DW-107's workflow fixes), and the loud-note rule for a snapshot whose backend status is not the category's canonical name (DW-114).
status: resolved 2026-10-29 by thkennedy/tk-studio#290 (sweep bundle dw-atlassian-round-trip; resolved by sweep bundle dw-atlassian-round-trip)
resolution: resolved by sweep bundle dw-atlassian-round-trip

### DW-96: `measurepush.py push` harvests Stage Log rows only from the studio repo it is given, so rows in other registered project roots never become `stage` events.
origin: spec-deferred 2d886fb1f616
source_spec: `35-8-every-stage-leaves-a-start-and-a-stop-spec.md`
location: plugins/tk-studio/lib/measurepush.py:300
severity: medium
reason: harvest_stages(directory) is called with the push's single --directory (the studio repo root); AC3 says a stage event carries each row. Deferral class (a): behaviour the criteria name.
status: resolved 2026-10-29 by thkennedy/tk-studio#293 (sweep bundle dw-measurepush-registered-roots; resolved by sweep bundle dw-measurepush-registered-roots)
resolution: resolved by sweep bundle dw-measurepush-registered-roots

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
status: resolved 2026-10-29 by thkennedy/tk-studio#281 (EP-35 retro hygiene, AI-6: `plans/35-2.md`'s Code Map, Settled shape, Files and constraint now read the review's shape — §2's next story is the first entry with no spec file, an existing bootstrap plan re-checked and refreshed; the open-question parser takes CAP lists — and the SPEC's CAP-3 design note says the same)

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
reason: `apps/supervisor/src/board.ts hostVerifyOf` (~:262) and `planstatus.ts` (~:444) show an inconclusive host-verify leg as green (board, files the run under done instead of needs_you) or red (planstatus); the contract says they read the latest host-verify through `green`. Found by 35.3's review; outside 35.3's Files. EP-35 retro (B1, AI-1): every consumer outside 35.3's Files misreads it — `board.ts:262` `isRed(d) ? "red" : "green"` shows an inconclusive leg green; `planstatus.ts:454` writes the leg's Stage Log row as `red`, which `stage-post` mirrors to Jira and `report.py` counts (a new consumer: #255 merged before #261 widened the verdict); the verdict is derived three times (`hostverify.ts:871-872`, `:881` inline, `planstatus.ts:454`) and only the first two know `inconclusive`; no test feeds an inconclusive leg to board, planstatus or sweep (`planstatus.test.ts:462-700` covers green/red/skipped). Fix: one exported `legVerdict` read by `hostVerifyOf`, `supervisorRows` and the sweep; tests feeding an inconclusive leg to each. DW-101 was the same finding filed twice by the run (both review layers); merged into this entry by the EP-35 retro hygiene (C7).
status: resolved 2026-10-30 by this story's PR (36.1: board, plan status, `legHistory` and the sweep's end state read `legVerdict`; the board files an inconclusive run under `needs_you`)

### DW-101: board.ts hostVerifyOf and planstatus.ts misread an inconclusive host-verify leg (green on the board, filed under done; red in planstatus).
origin: spec-deferred ad45d836e227
source_spec: `35-3-the-slice-path-hardened-spec.md`
location: apps/supervisor/src/board.ts:262
severity: medium
reason: Both review layers: board.ts ~:262 uses isRed(d) ? "red" : "green"; planstatus.ts ~:444 uses green ? "green" : "red". 35.3 made isRed false for an inconclusive leg. Both files are outside the plan's Files; the consult ruled to defer (DW-100). Meets deferral class (a): behaviour AC3 names (the run ends partial).
status: resolved 2026-10-29 by thkennedy/tk-studio#281 (duplicate of DW-100; merged by the EP-35 retro hygiene, C7)

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
status: resolved 2026-10-29 by thkennedy/tk-studio#293 (sweep bundle dw-judge-eval-media-fixture; resolved by sweep bundle dw-judge-eval-media-fixture)
resolution: resolved by sweep bundle dw-judge-eval-media-fixture

### DW-104: Follow-up review still recommended for 35-7-the-run-sweep-job-type after the damping cap was spent
origin: review-budget-followup
source_spec: `35-7-the-run-sweep-job-type-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261029-135846-4d12; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-105: An engine job absent from the supervisor's per-job config claimed on the host tier; the blocked run's stale checkout lock and the job's `on_status [blocked]` stop then refused the resubmission (hole 90).
origin: operator ledger, hole 90 (2026-10-27T23:3xZ, two records); retro-epic-35 C6, AI-5
source_spec: `kb/agent-pc-setup-runbook.md` fixes row "hole 90"; `handoff-phase1-loop-2026-10-09.md` 2026-10-28 03:2xZ addendum
location: apps/supervisor/src (the checkout lock a run that blocked before any engine started keeps as an unverified engine holder; `cancel` answering `RunTerminal`; the `stop.on_status [blocked]` check at submit); kb/agent-pc-setup-runbook.md §4.6 planning checklist
severity: medium
reason: The host-tier claim half is done: Story 35.5 (#267) made `run-epic`, `run-vertical-slice`, `maintenance-evals` and `run-sweep` declare `requires: {tier: sbx}` and `submit` refuse a host placement `placement:TierRequired` before anything is queued; the runbook's §4.6 checklist carries the config entry to add before an engine job's first `POST /jobs`. Still owed: the first launch ran the launch skill as a host `claude -p` for five turns (1.26 USD) before blocking, then kept the checkout lock as an unverified engine holder that every claim re-probed on the host, `cancel` answered `RunTerminal`, and the operator deleted the lock row by hand; and the job's `stop.on_status [blocked]` refused the next submission (`not-woken`) after a block the loop itself caused — again after hole 93 (#249, #250) — lifted only through the instance's `max_runs` (`stop: {}` is refused by AD-10). Fix: a run that ends before its engine started releases its checkout lock (or `cancel` on a terminal run releases it, named in the answer), and an `on_status [blocked]` stop distinguishes a block before the engine started (infrastructure: tier, materialise, render) from the engine's own `blocked`, or the README's lift rule becomes a verb.
status: resolved 2026-10-31 by this story's PR (36.5: `own_block` releases the lock of a run with no engine, `cancel` answers an ended run's unverified lock row, all three stop evaluators skip it)

### DW-106: `plansync setup` could not adopt the owner's Confluence space (the key compare was exact, the API answers lowercase) nor list its folders (two scopes missing, the 401 folded into a token message) (hole 91).
origin: operator ledger, hole 91 (2026-10-28); retro-epic-35 C6, AI-5
source_spec: `kb/agent-pc-setup-runbook.md` fixes row "hole 91"; `handoff-phase1-loop-2026-10-09.md` 2026-10-28 23:3xZ addendum
location: plugins/tk-studio/lib/plansync.py setup (the space adoption and the folder listing); the kb's Confluence scope list
severity: low
reason: Confluence's space-children endpoint wants `read:hierarchical-content:confluence` and `read:custom-content:confluence` beside the five scopes the kb named; three keys were made to find it. Filed for the record so the sweep and the next retro read the hole from the ledger, not the runbook alone.
status: resolved 2026-10-28 by thkennedy/tk-studio#247 (with #245, #246: the key compare is case-insensitive; a scope-refused listing creates the folders without adoption and says so; the kb names every Confluence scope measured on the box; the owner's key carries `read:hierarchical-content`)

### DW-107: `plansync setup`'s Jira workflow update is refused (`Invalid value for field workflows.[0].transitions.[0].type`) and it asks for a status literally named `To Do` (hole 92).
origin: operator ledger, hole 92 (2026-10-28); retro-epic-35 C6, AI-5, AI-10
source_spec: `kb/agent-pc-setup-runbook.md` fixes row "hole 92"; `handoff-phase1-loop-2026-10-09.md` 2026-10-28 23:3xZ addendum
location: plugins/tk-studio/lib/plansync.py setup / plugins/tk-studio/lib/jirabackend.py (the workflow update: `GET /workflow/search` copied into `POST /workflows/update`; the To Do status lookup)
severity: low
reason: The setup copies the transitions from `GET /workflow/search`, whose types come back lowercase, into `POST /workflows/update`, which takes `INITIAL`/`GLOBAL`/`DIRECTED`, and that search carries no workflow version; and the simplified workflow's To Do category holds `Backlog`, not `To Do`. The owner edited the TKSTUDIO workflow by hand instead (the three statuses, the Blocked → Block Resolved transition, two global transitions into To Do and Blocked). Fix: uppercase the copied types, read the version from the v3 workflows search, accept any status in the To Do category, and make setup add the global transitions it needs (and, with DW-95, create `DNI`).
status: resolved 2026-10-29 by thkennedy/tk-studio#290 (sweep bundle dw-atlassian-round-trip; resolved by sweep bundle dw-atlassian-round-trip)
resolution: resolved by sweep bundle dw-atlassian-round-trip

### DW-108: Binding the project to Jira made every fresh run worktree fail activation: the `tracking` plane read the served checkout's untracked sync-back state, which a worktree never has (hole 93).
origin: operator ledger, hole 93 (2026-10-28); retro-epic-35 C6, AI-5
source_spec: `kb/agent-pc-setup-runbook.md` fixes row "hole 93"; `handoff-phase1-loop-2026-10-09.md` 2026-10-28 23:3xZ addendum
location: apps/supervisor/src/worktree.ts (materialise's activate drift check; the `tracking` plane)
severity: medium
reason: `_bmad-output/tracking/sync-state.json` is untracked, so materialise refused the 35.8 worktree (`activate drift: tracking: missing`) and the run blocked before an engine started; the job's `on_status [blocked]` stop then refused the resubmission (the hole-90 residual, DW-105). Filed for the record.
status: resolved 2026-10-28 by thkennedy/tk-studio#250 (materialise ignores the `tracking` plane as it ignores `sandbox-login` (hole 75), the supervisor being the sync-back's runner on the checkout; the instance keeps `max_runs: 12` for the epic, #249)

### DW-109: The supervisor's one-minute tick respawns the sbx engine hold every minute: the hold it spawns dies with the tick's process and the next tick respawns it as `respawned: "supervisor restart"` (hole 94).
origin: operator ledger, hole 94 (2026-10-29T02:4xZ); retro-epic-35 C6, AI-5, AI-10
source_spec: `kb/agent-pc-setup-runbook.md` fixes row "hole 94"; `handoff-phase1-loop-2026-10-09.md` 2026-10-29 02:4xZ addendum
location: apps/supervisor/src (the tick's restart rule `recoverQueue` → `respawnHolds`; the serve process's own holds)
severity: medium
reason: The tick runs the restart rule in its own short-lived process, so the `sbx exec <sandbox> tail --pid=<engine>` hold it spawns dies with the tick: 133 `hold` events on the 35.8 run, 82 on 35.1, one per tick, the engine unheld for most of every minute though the supervisor never restarted between 23:41Z and 02:32Z (the sandbox stayed up because the engine's own processes keep it busy). Fix: the tick never respawns holds (the serve process, which lives, owns them), or the tick's holds are detached and recorded so the serve process adopts them; one test that a tick beside a live serve spawns no hold.
status: resolved 2026-10-31 by this story's PR (36.5: the hold is detached and recorded, later processes adopt it by pid and start time; the win32 proof is the operator's)

### DW-110: The first render of `bmad-build-auto` in a fresh run worktree fails inside the sandbox with `[Errno 13] Permission denied` on `render_skill.py`'s staging rename, and the auto-resume does not fire on a failed first render (hole 95).
origin: operator ledger, hole 95 (2026-10-29T02:52Z, the 35.2 run); retro-epic-35 C6, AI-5, AI-10
source_spec: `kb/agent-pc-setup-runbook.md` fixes row "hole 95"; `handoff-phase1-loop-2026-10-09.md` 2026-10-29 04:5xZ addendum
location: the BMad base's `render_skill.py` (the `_bmad/render/<skill>/<slug>/.staging-* -> <generation>` rename across the sbx mount; a studio-managed base patch); apps/supervisor/src (the hole-65 auto-resume's snapshot rule)
severity: medium
reason: The dev session writes a `blocked` spec and bmad-loop pauses the run on a CRITICAL escalation before any work runs, the graceful stop discarded with it. Hole 65's second flavour: a failed first render, not a stale view of a complete one, so the auto-resume does not fire (the reason names two folders, the staging and the generation, and the snapshot is empty). The operator path worked (remove the empty snapshot folder and the untracked `blocked` draft spec, `POST /runs/{id}/resume`, re-arm the stop). The retro's C6 counts hole 95 as filed under DW-95; DW-95 is the `DNI` status, so this is the hole's first entry. Fix: `render_skill.py` retries the rename on EACCES/EPERM a few times (a studio-managed base patch, as d044471), and the auto-resume treats a failed first render (an empty or absent generation named beside its staging folder) as the one snapshot and resumes once.
status: narrowed: patch registration owed the upstream issue URL (36.3: the failed first render auto-resumes once and the staging-rename retry ships in both `render_skill.py` copies; the `base-patches/patches.json` entry waits for a filed BMAD-METHOD issue, so `tk install` does not re-apply the retry yet)

### DW-111: A host-suite test pinned the exact state of a planning artifact under `_bmad-output` (the live epic-35 SPEC's design-note set), so the loop's own planner turned the host leg red (hole 96).
origin: operator ledger, hole 96 (2026-10-29T06:53Z, 35.3's first leg); retro-epic-35 C1, C6, AI-8
source_spec: `kb/agent-pc-setup-runbook.md` fixes row "hole 96"; `handoff-phase1-loop-2026-10-09.md` 2026-10-29 08:0xZ addendum
location: plugins/tk-studio/lib/tests/test_launch.py (`test_spec_open_questions_reads_the_real_spec_shapes`); every other lib-suite read of the live `_bmad-output/specs/` and `_bmad-output/planning-artifacts/`
severity: low
reason: The 35.3 gate noted CAP-7 and CAP-8 while planning 35.4, the test failed one in 2432, the run ended `partial` with a draft PR and 27 min of host leg were lost; fixed forward on the run branch (`4025c42`: the epic-35 branch of the test checks a subset, as its epic-34 branch did). The rule is enforced nowhere. Fix: no host-suite test pins the exact state of a planning artifact under `_bmad-output` (the planner rewrites them every story); shape tests read fixtures, and a real-artifact test asserts only what cannot change (the capability count, the story map); a guard (a test or a review check) that finds exact-set assertions over live spec folders.
status: resolved 2026-10-31 by this story's PR (36.4: no host-suite test pins a live planning artifact: `test_planning_pins_guard.py` fails naming an exact-set assertion over one, lib AST and supervisor textual; the question-set shape reads `fixtures/open-questions/SPEC.md`)

### DW-112: Host legs and hand gates go red on test budgets, not code: a conformance drive's bun suite bound under the runner's cap, and tests that spawn git or uv under bun's 5 s default (hole 97 and its recurrence).
origin: operator ledger, hole 97 (2026-10-29T07:23Z, 35.3's second leg; recurrence 14:0xZ on #275's hand gate); retro-epic-35 C1, C6, AI-8
source_spec: `kb/agent-pc-setup-runbook.md` fixes row "hole 97"; `handoff-phase1-loop-2026-10-09.md` 2026-10-29 08:0xZ and 14:0xZ addenda
location: plugins/tk-studio/contracts/conformance/ (every e2e drive that runs a growing bun suite: `e2e_playable_verify.py`, `e2e_engine_gate.py`, the launch drive); apps/supervisor/test (the git- and uv-spawning tests at bun's default timeout; no preload default); tools/verify_host.py (the gate's tail)
severity: medium
reason: `e2e_playable_verify.py` ran `bun test test/hostverify.test.ts -t "Story 34.3"` under a 30 s suite bound inside the runner's 60 s default; 35.3 put four cases inside the Story 34.3 describe block (17 tests, 28 s idle) and under the leg's load the drive reported `hung past 30s` — fixed forward (`3ce0f52`: manifest `timeout: 120`, the suite bounded at 75 s, the lib pin reading the manifest entry). Then the hole-100 fix's hand gate went red three times on the launch drive because the Story 34.8 approve test 'a record without game' serves two git repos per case under bun's default 5 s (5.2 s idle beside a running engine); that test now carries 60 s (`7fbd76b`). Each fix was one test or one drive; the class stays. Fix: every drive that runs a growing bun suite budgets from its manifest timeout with headroom; a story that adds tests inside another story's describe block re-checks that block's drive budget (a gate check on `-t` filters); the supervisor suite's preload sets a default timeout above 5 s for tests that spawn git or uv; and the gate's tail names the failing test.
status: resolved 2026-10-31 by this story's PR (36.4: every bun-suite drive's bound derives from its manifest `timeout` through `_budget.py`; the preload default stands at 30 s, hole 108's, reaching only the first file of a multi-file `bun test` on bun 1.4.3, so the two multi-file drives pass `--timeout 30000` and a hand run of the whole suite stays at 5 s past its first file, tracked as DW-155; two fix items are not built and stay stated here, not in the AC: the gate's tail naming the failing test, and the gate check on `-t` filters when a story adds tests inside another story's describe block)

### DW-113: A sandbox-tier job whose target skill is new on main ends `partial` after two one-turn workers: the engine sandboxes load skills from sbx's shared skills store, a copy of the released plugin, and nothing checks it at submit (hole 98).
origin: operator ledger, hole 98 (2026-10-29T11:52Z, the first `maintenance-evals` run); retro-epic-35 C6, AI-5
source_spec: `kb/agent-pc-setup-runbook.md` fixes row "hole 98"; `handoff-phase1-loop-2026-10-09.md` 2026-10-29 12:4xZ addendum
location: apps/supervisor/src/cli.ts `submit` (the placement resolve, beside `TierRequired`); apps/supervisor/src/worktree.ts (materialise's drift check judges the worktree's base, never the store); the supervisor's status-block reader (a `blocked` block without `intent` or `artifacts` read as no block)
severity: medium
reason: The store was at 0.3.7 (the last `sbx skills import --force`), so the sandbox's claude had no `/tk-studio:tk-studio-evals`; the worker answered a `blocked` block without `intent` or `artifacts`, which the supervisor reported as no status block (`resume cap reached (1)`, 0.27 USD). The operator released plugin 0.3.8 on the motion, updated the box and re-imported the store. Fix: `submit` refuses a sandbox-tier job whose target skill is absent from the skills store (`sbx skills ls` or the store's `plugin.json` skills), naming the release and the import; a story that ships a new skill says in its spec that the job waits for the release; a block missing `intent` is reported as malformed, not absent.
status: resolved 2026-10-31 by this story's PR (36.5: `submit` refuses `skills-store:SkillMissing`, a claim refuses `skill-missing:<skill>`, a block missing `intent` is malformed, not resumed; the real `sbx skills ls` capture is the operator's)

### DW-114: A landed story's pull-back snapshot whose backend status is not the category's canonical name reads as a silent `done`: five stories sat in Jira `DNI` while the plan read `done` (hole 100).
origin: operator ledger, hole 100 (2026-10-29T13:5xZ); retro-epic-35 C6, C9, AI-5
source_spec: `kb/agent-pc-setup-runbook.md` fixes row "hole 100"; `handoff-phase1-loop-2026-10-09.md` 2026-10-29 14:0xZ addendum
location: plugins/tk-studio/lib/plansync.py (the pull-back's status snapshot and category mapping); plugins/tk-studio/lib/jirabackend.py `_transition_to_category` (the picker, fixed in #275)
severity: medium
reason: `_transition_to_category` took the first transition into the target category, which since the owner's `DNI` status (2026-10-28, DW-95) was `DNI`, so TKSTUDIO-184, 185, 186, 187 and 189 (35.2, 35.3, 35.5, 35.6, 35.8) were moved to `DNI` instead of `Done`; `DNI` maps to `done` by category, the plan files read `status: DNI` beside `canonical_status: done`, and nothing flagged it — the mirror, not the loop, found it (retro C9). Repaired by hand through the API (TKSTUDIO-6, the owner's own `DNI` move, kept); the picker now skips `DROPPED_STATUS_NAMES` and notes an issue whose only route into the category is a dropped status (#275). The `DNI` round trip (pull-back to `dropped`, setup creating it) is DW-95's. Fix here: a landed story's pull-back snapshot whose backend status name differs from the category's canonical name is a loud note on the pull-back result and in the plan file, never a silent `done`.
status: resolved 2026-10-29 by thkennedy/tk-studio#290 (sweep bundle dw-atlassian-round-trip; resolved by sweep bundle dw-atlassian-round-trip)
resolution: resolved by sweep bundle dw-atlassian-round-trip

### DW-115: A story-boundary refusal parks the run: after the harvest commit the run stays `paused` with its lock and pin, the relaunch skipped every pass, `resume` answering `StoryLanded`, the only exit `POST /runs/{id}/cancel`.
origin: retro-epic-35, B4
source_spec: `_bmad-output/specs/spec-epic-35/RETROSPECTIVE.md`
location: apps/supervisor/src/queue.ts:1254 (the lock and pin kept); apps/supervisor/src/closeout.ts:818 (the relaunch skipped), :939 (`StoryLanded`); apps/supervisor/test/closeout.test.ts:1437-1470 (asserts the park)
severity: medium
reason: Nothing clears a stop the engine never runs again to discard. Reached only when a paused run is resumed with a stop in force and pauses again after landing — not hit in this epic (35.2's CAP-4 refusal by design, DW-83). Fix: end the run at the boundary (push, PR, release), as the retro's open question B3/B4 asks, or repeat the `story-boundary` notifier line each pass so the park stays visible; the owner's answer to that question decides which.
status: resolved 2026-10-31 by this story's PR (36.3: a landed story under a graceful stop archives and ends at the boundary, with push, PR, lock and pin released, and `story-boundary` carries `ended: true`; B3/B4 decided in the contract's 0.1.31 paragraph)

### DW-116: The `sweep-triage` ledger event lands in the sandbox's own ledger, which the host's `measurepush.py push` never reads and which dies with the sandbox.
origin: retro-epic-35, B6, AI-3
source_spec: `_bmad-output/specs/spec-epic-35/RETROSPECTIVE.md`
location: plugins/tk-studio/lib/launch.py:1576 (the emit into the process's `ledger_path()`, ledger.py:167); apps/supervisor/src/sweep.ts:8-13 (the queue event's payload) vs plugins/tk-studio/contracts/taxonomy.v1.json
severity: medium
reason: `run-sweep` requires the sbx tier, so the event lives in the VM's `~/.tk-studio/measurements/` unless exported by hand (runbook `:769-784`); the same name in the queue store carries a different payload. Fix: emit the ledger event from the host side (the supervisor's watch has the payload when it copies `triage.json`), or have the host's push read the sandbox's ledger; one payload shape for both records. Until then the first real sweep's operator exports the sandbox's ledger (AI-3).
status: resolved 2026-10-30 by this story's PR (36.2: `sweep.ts emitTriage` emits the lib-shaped `sweep-triage` from the host once per engine run; the queue note gains `ledger`)

### DW-117: The re-run refuses the runs it exists for: `git worktree add -B` is refused when the run branch is held by another worktree (an ended run whose close-out kept its worktree on error), and a local branch left ahead by a failed push is refused too.
origin: retro-epic-35, B7
source_spec: `_bmad-output/specs/spec-epic-35/RETROSPECTIVE.md`
location: apps/supervisor/src/hostleg.ts:253-262 (the `-B` refusal), :217-232 (the branch ahead); apps/supervisor/src/worktree.ts:652 (the worktree kept on error); apps/supervisor/test/hostleg.test.ts:727 (pins the refusal, not its origin)
severity: medium
reason: 35.1's CAP-2 cut (`supervisor/run-<id>` reset to origin's tip, never detached) holds for a slice re-run that must commit, but a non-slice re-run after a close-out error meets the run's own kept worktree. Fix: cut detached when no slice commit is due; name the kept worktree in the `VerifyFailed` reason (and offer its removal); a test whose refusal comes from a close-out that kept its worktree.
status: open

### DW-118: The sweep's end rule overrides the engine's own end: `sweepEndState` applies whenever a summary exists and the engine was not killed, so an engine that ended `failed`/`blocked` after its last bundle reads `complete` by bundle count.
origin: retro-epic-35, B9, AI-2
source_spec: `_bmad-output/specs/spec-epic-35/RETROSPECTIVE.md`
location: apps/supervisor/src/worktree.ts:1078; apps/supervisor/test/sweep.test.ts:184-189, :325, :377 (pin bundles and the leg only)
severity: low
reason: CAP-16's end state is by bundles and the leg; the engine's own terminal state is not an input. Fix: keep the engine's `failed`/`blocked` end (`partial` at best when every bundle landed), one test with a failed engine after a landed bundle. Before the first real sweep (AI-2).
status: resolved 2026-10-30 by this story's PR (36.2: `sweepEndState` caps an engine that ended other than `finished` at `partial`, naming its status and n/m)

### DW-119: A resumed run's worker cost is lost: PR #258's `## Metered cost` reads `not metered` and the 35.2 run's `job-run` line carries no `total_cost_usd` (the hole-95 resume path; EP-34's C4 shape on 34.5).
origin: retro-epic-35, C5
source_spec: `_bmad-output/specs/spec-epic-35/RETROSPECTIVE.md`
location: apps/supervisor/src/closeout.ts (the meter on a resumed run's close-out); the ledger's `job-run` line for `run-epic-35-20261029T023931Z` (04:50:44Z); PR #258's body
severity: low
reason: The engine cost is in the Stage Log (35.8), so the loss is the worker's launch-session cost only, but the `job-run` line is what `measurepush` and the per-run table read, and DW-83's resume shape (34.5, PR #213) lost it the same way. Fix: a resumed run meters its worker session(s) at the close-out as a first-launch run does (the resumed session's transcript, or the sum of the sessions), and the PR body reads the number.
status: resolved 2026-10-30 by this story's PR (36.2: `handBack` carries `worker_cost_usd` forward, so the resumed run's body and `job-run` line read the number)

### DW-120: The resume's stop re-arm runs on the host for a sandbox run: `closeout.ts` calls `launchStopGraceful`, which is `launch.py stop` through `uv` on the host and needs `bmad-loop` on the host PATH, while every `run-epic` is sbx-tier since 35.5.
origin: retro-epic-35, B2, AI-2
source_spec: `_bmad-output/specs/spec-epic-35/RETROSPECTIVE.md`
location: apps/supervisor/src/closeout.ts:919 (`launchStopGraceful`); plugins/tk-studio/lib/launch.py:213-226; apps/supervisor/src/sweep.ts:334-347 (`stopSweepEngine`'s `sbx exec … launch.py stop` route); apps/supervisor/test/closeout.test.ts:1536-1592 (injects `launchStop`, so the routing is never exercised)
severity: medium
reason: Hole 95's resume of 35.2 was spared only because bmad-loop honoured the stop on its own. Fix: route the re-arm by tier as `stopSweepEngine` does; one test without the injection. Before the first real sweep (AI-2).
status: resolved 2026-10-31 by this story's PR (36.3: `stopEngine` routes by tier and `--graceful`; `launchStopGraceful`, `approve.ts` and `cancelRun` pass `where`; `graceful-stop` carries `tier`)

### DW-121: A paused sweep is either stuck or stripped: a stop that does not answer `stopped` is retried every tick with no bound, and a sweep is never kept paused, so a bundle that paused mid-pass gets the host leg on its half-written tree and `git worktree remove --force` with no record of the WIP.
origin: retro-epic-35, B3, AI-2, Open questions
source_spec: `_bmad-output/specs/spec-epic-35/RETROSPECTIVE.md`
location: apps/supervisor/src/worktree.ts:1012-1021 (the unbounded stop retry: the run holding its checkout lock, worktree and sandbox pin, one `engine-stop` note, no notifier line), :1029 (never kept paused), :1042-1046, :662 (`remove --force`); apps/supervisor/test/sweep.test.ts:252-289 (passes only by flipping the fake; commits `a.txt` first)
severity: medium
reason: bmad-loop's `stop` on a run with no live process is unverified from this tree (the retro's open question B3). Fix before the first real sweep: bound the stop retry (a count or a deadline, then a notifier line and a `blocked` end that releases the lock and the pin), and keep a paused bundle's WIP out of the leg (commit it as WIP on the run branch, or keep the sweep paused for the operator); one test each.
status: resolved 2026-10-31 by this story's PR (36.3: `SWEEP_STOP_DEADLINE_MS` bounds the stop from the first `engine-stop` note carrying `error`, then one line and a `blocked` end; `wipCommit` commits the stopped tree, the leg is skipped and the PR stays a draft)

### DW-122: Two rules for one wait: "the owner checkout has not pulled the merge" is an uncounted, lease-free wait in the stage pass but a counted retry in the ledger pass, bounded by `PLAN_RETRY_LIMIT = 24` ticks.
origin: retro-epic-35, B5, AI-2, AI-3
source_spec: `_bmad-output/specs/spec-epic-35/RETROSPECTIVE.md`
location: apps/supervisor/src/planstatus.ts:513 (`waiting: true`); apps/supervisor/src/sweep.ts:414-420 (the counted retry); apps/supervisor/test/sweep.test.ts:423-424 (pins the give-up)
severity: medium
reason: Pull within about 24 minutes of a sweep merge or the ledger flip gives up for good, although `ledger-resolve`'s `pending` is retried, never refused, by design. Fix: treat a `pending`-only answer as the stage pass's wait (uncounted, no lease) and keep the retry count for errors; until then the first real sweep's operator pulls the merge inside the window (AI-3).
status: resolved 2026-10-30 by this story's PR (36.2: `pending` is an uncounted wait, one `waiting: true` record and the lease released settled; errors still count; the flip's status line names the bundle once)

### DW-123: A sweep PR loses `## Sweep` on a re-run: `rewriteBody` renders `prBody` without `sweep`; the close-out alone passes it.
origin: retro-epic-35, B10, AI-2
source_spec: `_bmad-output/specs/spec-epic-35/RETROSPECTIVE.md`
location: apps/supervisor/src/hostleg.ts:209 (`rewriteBody`); apps/supervisor/src/worktree.ts:973 (the close-out passes `sweep`); apps/supervisor/test/hostleg.test.ts (builds no sweep run), test/sweep.test.ts (re-runs no leg)
severity: low
reason: The 35-7 spec names it a residual risk; no test. Fix: pass `sweepSummary(queue, run)` when `isSweep`; one test that re-runs a sweep's leg and reads `## Sweep` back. Before the first real sweep (AI-2).
status: resolved 2026-10-30 by this story's PR (36.2: `rewriteBody` renders `## Sweep` and the priced cost from `summaryFromRecord`)

### DW-127: The `POST /workflows/update` transitions keep the legacy `from`/`to` keys copied from `GET /workflow/search` and new GLOBAL transitions carry no `id`; the live endpoint may want `toStatusReference`/`l
origin: spec-deferred af7f5c7070ac
source_spec: `spec-dw-atlassian-round-trip.md`
location: plugins/tk-studio/lib/jirabackend.py update_workflow
severity: medium
reason: Both review layers flagged it. The test fake checks only uppercase types and the version, so any transition shape passes. The spec's Design Notes kept the body shape ungraded (kb §2 Q1 grade C), so the first live setup may still be refused and fall back to the owner steps. Deferral class (a): a defect in the workflow-update behaviour DW-107 names.
status: resolved 2026-10-31 by this story's PR (36.6: every transition in `POST /workflows/update` is v3-shaped with an id, no `from`/`to`; the site's answer is the operator's attended rerun)

### DW-128: A _land_summary failure inside _finalize_run raises before _emit_job_event, leaving a terminal run with no job-run event; with DW-5 a same-state retry no longer repairs it.
origin: spec-deferred 10fc2e0ce39e
source_spec: `spec-dw-5-job-finish-idempotence.md`
location: plugins/tk-studio/lib/jobrun.py:375
severity: low
reason: update_run persists the terminal state before _finalize_run; _finalize_run guards only capture, and _land_summary (write_workspace_json) can raise before the emit. Before DW-5 a repeat finish re-ran _finalize_run. The intent mandates the no-op, so the fix belongs in _finalize_run ordering or a finalized marker (deferral class b, AD-12 exactly-once).
status: open

### DW-129: Two concurrent finish calls on the same non-terminal run can both pass the pre-read and both emit a job-run event.
origin: spec-deferred a597f7911645
source_spec: `spec-dw-5-job-finish-idempotence.md`
location: plugins/tk-studio/lib/jobrun.py:701
severity: low
reason: The read_run check in finish and the write in update_run are separate, unlocked steps, and update_run accepts a same-state terminal rewrite (job.py:586). This race predates DW-5 (which only closes the sequential repeat); closing it needs a check inside update_run or a lock, which the DW-5 spec forbids changing (deferral class b, AD-12).
status: open

### DW-130: A block the operator resolved by resuming the run leaves its Jira issue in `Blocked - Awaiting User`: no resume path transitions out of the block, and the Done promotion then holds as an AD-5 conflict with the owner still tagged (hole 101).
origin: hole 101 (Story 35.2's run, 2026-10-29 02:52Z; noticed by the owner 19:xxZ)
source_spec: `_bmad-output/specs/spec-epic-35/stories/35-2-every-story-gets-its-plan-and-its-records-spec.md` (the block's spec); `kb/agent-pc-setup-runbook.md` (the hole-101 row)
location: apps/supervisor/src/closeout.ts (`track.py block` on a `blocked` end, the one `track-block` event per pause); apps/supervisor/src/api.ts (`POST /runs/{id}/resume`) and the hole-65 auto-resume (no counterpart call); plugins/tk-studio/lib/track.py (story-side verbs: `block` in, nothing out — `close` is engagement-only, `reply` is the owner's, `validate --pass` needs the owner's transition); plugins/tk-studio/lib/jirabackend.py `pull_back` (canonical `done` vs backend `Blocked - Awaiting User` with the promoted `draft` is a conflict, held until a human picks a side) and the supervisor's plan-status pass (`ok: true` with the conflict in the projection notes)
severity: medium
reason: Story 35.2's run paused on hole 95 (02:52Z); `track.py block` moved TKSTUDIO-183 to `Blocked - Awaiting User` and tagged the owner (comment 10006). The operator resumed the run at 02:54Z (the hole-65 path); the story landed in #258 at 04:51Z and the plan went `done`, but every plan-status pass since promoted nothing for ST-147 (`pull-back conflict — not promoted until a human picks a side (AD-5)`), so the issue read Blocked with the owner tagged for 17 hours while the other seven EP-35 stories read Done. Repaired by hand 19:5xZ: the agent seat commented (10104) and moved the issue `Block Resolved` → `Done`; the next `sync` refreshed the snapshot (`external.jira.status: Done`). Fix: (1) a story-side `track.py unblock --story <key> --reason` (Blocked → `Block Resolved` with a `Resolved:` agent comment, idempotent) and the two resume paths call it once per `track-block` since the latest `paused`, recorded as `track-unblock`; (2) the plan-status pass ends `partial` (notified) when the projection holds a conflict for the story it just moved, never `ok: true`; (3) the "Needs you" tag is withdrawn by the unblock comment naming the resolution.
status: resolved 2026-10-31 by this story's PR (36.3: `track.py unblock` and `track-unblock`, once per block on every resume path; an AD-5 conflict ends the plan-status record `partial`, notified and re-asked up to `PLAN_RETRY_LIMIT`; deferred remainder: a story whose issue reads `Block Resolved` can still hold an AD-5 conflict at `done`, notified and `partial`; the side stays the owner's)

### DW-131: A sweep's engine cost is unmetered: `## Metered cost` and the job-run line carry the worker's turns only, and a bundle has no Jira story for a stage log, so the sweep's real spend (millions of weighted tokens) is invisible to the quota pacing and the rollup (hole 102).
origin: hole 102 (the second run-sweep, q-run-sweep-20261029T174706Z-da84bd, PR #290, 2026-10-29 20:02Z)
source_spec: `_bmad-output/specs/spec-epic-35/stories/35-7-the-run-sweep-job-type-spec.md` (the close-out's PR body); `kb/agent-pc-setup-runbook.md` (the hole-102 row)
location: apps/supervisor/src/closeout.ts and hostleg.ts (`## Metered cost` from the worker's `accounted` events only); plugins/tk-studio/lib/jobrun.py finish (`total_cost_usd` from the worker); plugins/tk-studio/lib/plansync.py stage-post (posts per story issue; a bundle has none); the engine run's `journal.jsonl` / `state.json` (per-bundle token totals, priced by nothing)
severity: medium
reason: The second sweep landed five bundles in 1 h 42 min of engine time (7,036,449 weighted tokens, 46,573,870 raw incl. cache reads per the engine's ATTENTION line) and reported `$0.7246 (total_cost_usd)`: the worker's three turns. A story run's engine cost reaches the stage log through its Jira issue (35.5: the 35.7 run's 34.52 USD); a sweep's bundles post nowhere. Fix: the close-out reads the engine run's journal (per-bundle token totals) and prices them with the routing's model rates into `## Metered cost` (worker + engine, one line per bundle) and the job-run line's cost; the stage log posts a sweep's bundles to the rollup page or the measurements ledger instead of a story issue; the sweep's `ended` event carries `engine_cost_usd`.
status: resolved 2026-10-30 by this story's PR (36.2: `meter.py price-run` prices the engine per bundle into `## Metered cost`, the `job-run` total and `ended.engine_cost_usd`; a bundle's Jira stage-log row is not part of this fix; the engine's own `sweep-triage` session stays unpriced, DW-136)

### DW-132: The sandbox gate passes a test that writes non-ASCII text through `Path.write_text` (or `open`) with no encoding, and the Windows host leg fails it: Linux defaults to UTF-8, the host to cp1252, so a bundle green in the engine lands red on the host (hole 103).
origin: hole 103 (the third run-sweep, q-run-sweep-20261029T200840Z-2846e6, PR #293, 2026-10-29 22:43Z)
source_spec: `_bmad-output/specs/sweeps/spec-dw-17-doctor-hermes-config-fallback.md` (the bundle whose tests failed); `kb/agent-pc-setup-runbook.md` (the hole-103 row)
location: plugins/tk-studio/lib/tests/test_installer_doctor.py `Hermes.hermes` (the write, fixed by hand in 961bc20); plugins/tk-studio/lib/tests/test_conformance.py (no encoding rule); AGENTS.md (no pitfall line); plugins/tk-studio/lib and tools/installer at large (`write_text(`/`read_text(`/`open(` without `encoding=`)
severity: medium
reason: The DW-17 bundle's Hermes tests rewrite a fixture that holds an em dash through `write_text(text)`; the engine's gate ran them on Linux and passed, the close-out's host leg ran them on Windows and twelve failed (`'utf-8' codec can't decode byte 0x97`), so the sweep ended `partial` on a red leg with every bundle sound, and the operator fixed one line and re-ran the leg (`POST /runs/{id}/verify`). The host leg is the gate of record, but a difference the engine cannot see should not cost a leg. Fix: a conformance rule that rejects `write_text`, `read_text`, `open` and `Path.open` without an explicit `encoding=` under `plugins/tk-studio/lib`, `tools/installer` and `apps/*/scripts` (text mode only; binary calls exempt), and a pitfall line in AGENTS.md so the engine never writes one; optionally the sandbox runs the lib suite with `PYTHONUTF8=0` and `LC_ALL=C` once to shake out the rest.
status: resolved 2026-10-31 by this story's PR (36.4: the `e2e_text_encoding` drive fails a text-mode open with no `encoding=` naming the call site; the 147 lib-test sites fixed; `AGENTS.md` carries the pitfall line)

### DW-133: The re-run verb exits 1 on an inconclusive leg, but no contract note states it: the re-run exit list in the 0.1.28 note still reads "1 red or skipped".
origin: review of story 36-1
source_spec: `36-1-one-verdict-for-every-consumer-spec.md`
location: apps/supervisor/src/cli.ts:2658, :2667; plugins/tk-studio/contracts/driver-contract.md:396
severity: low
reason: `cli.ts` derives `green` from the leg and returns `green ? 0 : 1`, so an inconclusive leg exits 1, and no contract note states this. The contract's re-run exit list (`driver-contract.md:396`, in the 0.1.28 note) still reads "1 red or skipped"; that note is history and stays as written, so the statement belongs in a current version's note.
status: open

### DW-134: The 0.1.31 note says an inconclusive leg ends a sweep `partial` unconditionally, while `sweepEndState`'s `blocked` rules (no triage, no bundle landed) apply first.
origin: spec-deferred 6a5dfd428d7c
source_spec: `36-1-one-verdict-for-every-consumer-spec.md`
location: plugins/tk-studio/contracts/driver-contract.md:2114
severity: medium
reason: Edge Case Hunter; `apps/supervisor/src/sweep.ts:311-314` return `blocked` before the verdict is read. Meets deferral rule (b), a contract statement left imprecise. The consult ruled the 0.1.31 paragraph is not edited in this story; a later 36.x clause can state the precedence.
status: resolved 2026-10-30 by this story's PR (36.2: the 36.2 contract paragraph states the order: `blocked` rules first, then the leg's reason, then the engine's end)

### DW-135: The re-run verb exits 1 on an inconclusive leg, but no contract note states it. Filed as DW-133.
origin: spec-deferred 96c53f15da28
source_spec: `36-1-one-verdict-for-every-consumer-spec.md`
location: apps/supervisor/src/cli.ts:2667
severity: low
reason: `apps/supervisor/src/cli.ts:2658, :2667`; `driver-contract.md:396` reads "1 red or skipped" and is 0.1.28 history. Meets deferral rule (b).
status: open

### DW-136: A sweep's engine cost leaves out the engine's own `sweep-triage` session: `engine_cost_usd` and `(engine)` total the bundles only, so they understate the engine's full spend.
origin: consult ruling 2026-10-30 (deviation-gt-0) on story 36-2
source_spec: `36-2-the-sweeps-records-are-whole-spec.md`
location: plugins/tk-studio/lib/meter.py price-run (keys: triaged bundles, then other `dw*-` tasks and transcripts); apps/supervisor/src/sweep.ts `BUNDLE_KEY_RE`, `withEngineCost`
severity: medium
reason: Both pinned texts say per bundle, and the triage session is no bundle, so `price-run` never names it and the body, the `job-run` total and `ended.engine_cost_usd` omit its spend. The consult ruled against a triage line and against widening `BUNDLE_KEY_RE` in 36.2; the 36.2 contract paragraph states the exclusion. Fix: price the triage session under its own line and add it to the engine total.
status: open

### DW-137: `emitTriage` appends the ledger's `sweep-triage` line before patching the note, so a failed patch re-emits on the next tick, against the contract's "once per engine run".
origin: review of story 36-2
source_spec: `36-2-the-sweeps-records-are-whole-spec.md`
location: apps/supervisor/src/sweep.ts emitTriage
severity: low
reason: `ledgerEmit` runs, then `queue.patchEventDetail(note.seq, {ledger: …})`; a busy queue throws at the patch, `emitTriage` swallows it, and the note still has no `ledger`, so the next tick emits a second line. Deferred from this story by the review's order.
status: open

### DW-138: `judgeJobRun` derives `n` from recorded `host-verify` events but emits before that event is noted, so a failed note reuses a `run_id` on the next re-run and last-line-wins readers drop the earlier judge's cost.
origin: review of story 36-2
source_spec: `36-2-the-sweeps-records-are-whole-spec.md`
location: apps/supervisor/src/hostleg.ts judgeJobRun, runLeg
severity: low
reason: `runLeg` emits `<id>:verify-<n>` and then notes the leg; when that note throws, the count does not move, the next re-run emits the same `<id>:verify-<n>`, and `jobRunCosts` and `runCost` keep only the last line, so the earlier judge's cost is lost to them. Deferred from this story by the review's order.
status: open

### DW-139: On a late-closed sweep, `runCost` and the `jobRunCosts` readers keyed by the bare run id return the worker-only own line, so the API and delivery `cost_usd` read less than the PR body.
origin: consult ruling 2026-10-30 on story 36-2
source_spec: `36-2-the-sweeps-records-are-whole-spec.md`
location: apps/supervisor/src/inbox.ts runCost; apps/supervisor/src/board.ts jobRunCosts; apps/supervisor/src/api.ts:1263; apps/supervisor/src/delivery.ts:247
severity: medium
reason: A late close-out emits the priced engine as its own `job-run` line under `<run_id>:engine`, leaving the run's own line at the worker's cost, while these readers match `run_id` exactly, so they miss the engine line that the PR body's total includes. The consult left the readers and `spendByEpic` unchanged in 36.2; the 36.2 contract paragraph states the gap. Deferred from this story.
status: open

### DW-140: The engine's own `sweep-triage` session is not priced, so `engine_cost_usd` and `total_cost_usd` understate a sweep's full engine spend. Filed as DW-136.
origin: spec-deferred 82ccef92b342
source_spec: `36-2-the-sweeps-records-are-whole-spec.md`
location: plugins/tk-studio/lib/meter.py:95
severity: medium
reason: `meter.py` `BUNDLE_KEY_RE`; ordered by the first consult. Meets deferral rule (b): the contract paragraph states the exclusion, and the open question is the operator's.
status: open

### DW-141: `emitTriage` appends the ledger line before patching the note, so a failed patch re-emits on the next tick. Filed as DW-137.
origin: spec-deferred cd694828ef9c
source_spec: `36-2-the-sweeps-records-are-whole-spec.md`
location: apps/supervisor/src/sweep.ts emitTriage
severity: low
reason: Both review layers. Meets deferral rule (b): the contract says once per engine run.
status: open

### DW-142: `judgeJobRun` derives `n` from `host-verify` events but emits before that event is noted, so a failed note reuses a `run_id` and last-line-wins readers drop the earlier judge's cost. Filed as DW-138.
origin: spec-deferred 82b6a7cd8e20
source_spec: `36-2-the-sweeps-records-are-whole-spec.md`
location: apps/supervisor/src/hostleg.ts judgeJobRun
severity: low
reason: Both review layers. Meets deferral rule (a): AC1 names the re-run judge's own line.
status: open

### DW-143: On a late-closed sweep, `runCost` and the bare-id `jobRunCosts` readers return the worker-only own line, so API and delivery `cost_usd` read less than the PR body. Filed as DW-139.
origin: spec-deferred 783a1b339cea
source_spec: `36-2-the-sweeps-records-are-whole-spec.md`
location: apps/supervisor/src/inbox.ts runCost
severity: medium
reason: Ordered by the second consult, with one sentence in the contract paragraph. Meets deferral rule (a): AC1 names the job-run cost.
status: open

### DW-144: A failed host `sweep-triage` emit is never retried: `emitTriage` notes `ledger: "error: …"`, and every later tick answers `seen`, so one transient failure keeps the event out of the host's ledger.
origin: spec-deferred 5b3442e01081
source_spec: `36-2-the-sweeps-records-are-whole-spec.md`
location: apps/supervisor/src/sweep.ts emitTriage
severity: medium
reason: Blind Hunter, confirmed at `sweep.ts emitTriage`. The failure is recorded as the matrix asks, and the queue note still holds the payload, but no later pass delivers it. Meets deferral rule (a): AC2 names the host's event.
status: open

### DW-145: Follow-up review still recommended for 36-2-the-sweeps-records-are-whole after the damping cap was spent
origin: review-budget-followup
source_spec: `36-2-the-sweeps-records-are-whole-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261030-204855-1dd5; this entry preserves the lingering recommendation for a deliberate later review.

### DW-146: A story being built never reads In Progress in Jira: the plan-status pass sets `review` when the run's PR opens and `done` at the merge, nothing at the launch, so the issue reads Backlog for the whole build (hole 104).
origin: hole 104 (found by the owner 2026-10-30 20:3xZ while Epic 36's run 1, q-run-epic-36-20261030T201456Z-e76900, built 36.1 with TKSTUDIO-191 in Backlog)
source_spec: `_bmad-output/planning-artifacts/epics.md` Story 36.6 (the added acceptance criterion; first placed in 36.3, moved 2026-10-31 because 36.3 was already being built from the bootstrapped plan); `kb/agent-pc-setup-runbook.md` (the hole-104 row)
location: apps/supervisor/src/planstatus.ts (`Phase = "review" | "done"`, Story 27.5); plugins/tk-studio/skills/tk-studio-launch and `launch.py` (no status call at the engine's start); plugins/tk-studio/lib/plansync.py `status` (the verb exists; `in-progress` is a canonical status, `TO_BACKEND_CATEGORY` maps it to the indeterminate category); plugins/tk-studio/lib/jirabackend.py
severity: medium
reason: The owner reads Jira to see what is being worked on; the loop's only mid-run In Progress-category status is a block, so a healthy build looks idle for about two hours a story and a blocked one looks busy. The verb and the mapping exist (the review phase proves the round trip); what is missing is one call at the launch. Fix (Story 36.6): the launch calls `plansync.py status --status in-progress` for the story it starts, recorded as a `plan-status` event with `phase: in-progress`; a refusal never stops the launch; the review and done phases follow as now; the contract names the third phase.
status: resolved 2026-10-31 by this story's PR (36.6: the `in-progress` plan phase from the launched path, the resume and `launchedPass`)

### DW-147: The `run-epic` job declares one story per run with a graceful stop after each, but nothing in the loop arms that stop: the operator issues `launch.py stop --graceful` inside the sandbox after every POST by hand, and a missed arming builds several stories in one run (hole 105).
origin: hole 105 (Epic 36's run 1, q-run-epic-36-20261030T201456Z-e76900, 2026-10-30 23:5xZ: the operator missed the arming, the engine built 36.1 and 36.2 and started 36.3 in one run, three hours with no PR and no pull-back)
source_spec: `_bmad-output/planning-artifacts/epics.md` Story 36.6 (the added acceptance criterion); `kb/agent-pc-setup-runbook.md` (the hole-105 row)
location: plugins/tk-studio/lib/launch.py (`stop(…, graceful=True)` exists; `launch`/`submit` never calls it); plugins/tk-studio/jobs/run-epic.json and `.tk-studio/jobs/run-epic-N.json` (the rhythm lives in the description's prose, no field); apps/supervisor/src/queue.ts (the launched path records `launched` and `engine-pid`, arms nothing); the handoff's "with the stop armed" lines (day-7k to 7t, an operator step every launch)
severity: medium
reason: The one-story-per-run rhythm is what gives every story its own PR, host leg, pull-back and stage rows; it held through Epic 35 only because the operator armed the stop by hand after each POST (the host has no `bmad-loop`, so the arming runs as `sbx exec claude-tk-studio uv run …/launch.py stop --directory <worktree> --run-id <engine> --graceful`). Fix (Story 36.6): the job declaration carries the rhythm as a field; the launch arms the graceful stop itself at the engine's start and records a `stop-armed` event; the launch check names a `run-epic` job without a rhythm; the contract names the field and the event.
status: resolved 2026-10-31 by this story's PR (36.6: `stop.after_stories` on the job; the launched path, the resume and `launchedPass` arm the stop, recorded `stop-armed`; the `run rhythm` check row)

### DW-148: A dev session that hits the engine's clock with its work uncommitted parks the run for a manual `git reset` (`rollback_on_failure false`), discards the pending graceful stop, and closes the run out as a draft PR with no host leg for the stories already landed on the branch (hole 106).
origin: hole 106 (Epic 36's run 1, q-run-epic-36-20261030T201456Z-e76900, 2026-10-31 01:15Z: Story 36.3's first dev attempt, band L, 23:44 to 01:14Z, 6.3M tokens, `session-end status timeout expired_clock both`)
source_spec: `kb/agent-pc-setup-runbook.md` (the hole-106 row); the engine journal's `rollback-manual-required`, `run-paused`, `stop-request-discarded` lines
location: .bmad-loop/policy.toml (`session_timeout_min = 90`, `max_dev_attempts = 2`, `[scm] rollback_on_failure = false`, whose comment warns about a main checkout the run's own worktree never is); apps/supervisor/src/closeout.ts (the pause close-out: a draft PR, the worktree kept, no host leg for the landed commits, the stop request not re-armed); apps/supervisor/src/queue.ts (`cancel` on a paused sbx run calls the launch core's stop on the host, refused `bmad-loop is not on PATH`, DW-120); the planner (a band-L story planned over the dev clock)
severity: medium
reason: The pause cost the operator the sanctioned path: the engine asked for a hand `git reset --hard` in its worktree, the stop request it was holding was discarded, the two stories already built sat in a draft PR with no gate for an hour, and the story's issue was blocked with the owner tagged (hole 101). The operator cancelled the run, removed the kept worktree by hand, re-ran the host leg over `POST /runs/{id}/verify` and re-queued the story. Fix to make: `rollback_on_failure true` for a run's own worktree (nothing pre-existing to protect there; the auto-rollback keeps a resolved escalation's re-drive path), or the pause close-out runs the host leg for the landed commits and keeps the stop request so the resume stops where it was told; the planner splits a story whose plan exceeds the dev clock (the band-L stories 36.3 and 36.6 are the first candidates); the paused run's issue block says `no owner action` when the pause is an engine clock.
status: open

### DW-149: Deferred-work ids are minted from the ledger's highest heading on whichever branch writes, so an engine run harvesting deferrals on its branch and an operator docs pass filing on `main` mint the same ids and collide at the merge (hole 107).
origin: hole 107 (PR 302, 2026-10-31 01:3xZ: the engine filed DW-133 to DW-145 on the run branch while the operator filed DW-133 and DW-134 on `main` in PRs #298 and #300)
source_spec: `kb/agent-pc-setup-runbook.md` (the hole-107 row); the merge commit 90a2dfb on the run branch (the operator's entries renumbered DW-146 and DW-147 with every reference)
location: .bmad-loop's spec-deferrals harvest (`spec-deferrals-harvested`, ids from the ledger's maximum at the run's base); the operator's hand-filed entries (the docs pass reads the same maximum from `main`); `_bmad-output/implementation-artifacts/deferred-work.md` (no duplicate-heading check at parse); plugins/tk-studio/lib (no ledger tool that renumbers an entry and rewrites its references)
severity: medium
reason: Two writers, one counter, two branches: every run that harvests while the operator files guarantees a collision, and the resolution is a hand renumbering across epics.md, the plan entries, the runbook, the handoff and the Jira descriptions, with the story specs on the branch already citing the engine's ids. Fix to make: one id source for both writers (a counter file like `.tk-studio/plan-counter.yaml` bumped through a ledger verb both the harvest and the operator call), or ids reserved per writer (the engine mints from the base commit's maximum plus a run-local offset; the merge renumbers through a ledger tool that rewrites references); the ledger's parse refuses a duplicate heading so the collision fails the gate, never the merge.
status: open

### DW-150: Time bounds sized on the Linux gate fail on the Windows host leg, whose git is slower: a supervisor test with several git-backed fixtures past bun's 5 s default, and the run-sweep conformance drive's 60 s suite bound once 36.2 widened its filter to three stories (hole 108, hole 103's sibling).
origin: hole 108 (PR 302's re-run host legs, 2026-10-31 01:58Z and 02:41Z: `sweep.test.ts` "the late close-out: `finished` is no cap …" at 5001 ms; then `e2e_run_sweep.py` "bun test test/sweep.test.ts hung past 60s", which also failed the two lib tests that run the real conformance suite)
source_spec: `kb/agent-pc-setup-runbook.md` (the hole-108 row); the fix commits on the run branch (cd2ba54 the per-test timeout; the bound commit after it)
location: apps/supervisor/test/sweep.test.ts (the four-fixture test, now `30_000`); apps/supervisor/test/worktree.test.ts:1055 (the precedent, 2026-10-16); apps/supervisor/test/preload.ts (bunfig.toml's `[test] preload`; bunfig has no timeout key); tools/verify_host.py (`bun test ./<file>` per file with no `--timeout`); plugins/tk-studio/contracts/conformance/e2e_run_sweep.py (`BOUND_S`, now 240) and `e2e_engine_gate.py` (50 s), `e2e_playable_verify.py` (75 s), manifest.json's entry timeouts; the planner's test guidance (no win32 figure)
severity: medium
reason: Each recurrence costs a 40-minute host leg and a hand fix on the run branch, and the sandbox gate will never catch it because its git is fast enough; the second case cost two legs because the first leg's tail showed only the supervisor failure. Fix: a suite-wide default for the supervisor tests (`setDefaultTimeout(30_000)` in the preload, which every runner that loads it honours; bunfig has no timeout key) with the per-test `30_000` lines kept; the conformance drives' bounds sized from the host's measured figure with headroom (a drive that bounds a `bun test` names the host figure beside the bound) and the manifest entries following; the host leg's event keeping every suite's own verdict line, not only the last twenty lines; the planner's test guidance naming the host figure so fixture-heavy tests and widened drive filters are written with it.
status: open

### DW-151: After a successful unblock the issue reads `Block Resolved`, canonical `blocked`, so a later `done` can still hold an AD-5 conflict for a block already closed.
origin: spec-deferred 7ccf327dfa9d
source_spec: `36-3-a-paused-or-resumed-run-is-never-parked-spec.md`
location: plugins/tk-studio/lib/jirabackend.py:609
severity: medium
reason: `jirabackend.canonical_status` maps both template statuses to `blocked`; `pull_back` conflicts when the backend status moved since the snapshot and canonical `done` differs. The hand repair of hole 101 moved the issue to `Done` and re-synced; DW-130's fix as written does not. Meets deferral (a): behaviour AC1 names; AC1 pins the target status and AD-5 keeps the side-pick human.
status: open

### DW-152: Follow-up review still recommended for 36-3-a-paused-or-resumed-run-is-never-parked after the damping cap was spent
origin: review-budget-followup
source_spec: `36-3-a-paused-or-resumed-run-is-never-parked-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261031-042417-65bc; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-153: The Jira promote's category picker took the first transition into the target category, and the setup's global transitions list `Blocked - Awaiting User` before `In Progress`, so every review promotion at PR open landed the story's issue in the block status until the merge (hole 109).
origin: hole 109 (found 2026-10-31 04:2xZ answering the owner's question why nothing ever read In Progress: TKSTUDIO-191 and 192 Backlog → Blocked - Awaiting User at 01:20Z, TKSTUDIO-189 on 2026-10-29, every Epic 35 story since the first sync)
source_spec: `kb/agent-pc-setup-runbook.md` (the hole-109 row); `plugins/tk-studio/lib/tests/test_jirabackend.py` `BlockStatusPickTests`
location: plugins/tk-studio/lib/jirabackend.py `_transition_to_category` (`PREFERRED_STATUS_NAMES`; the block statuses a route only for canonical `blocked`); plugins/tk-studio/lib/plansync.py (the caller passes the canonical status)
severity: medium
reason: The owner reads Jira to see what is being worked on; the loop's only mid-run statuses were a block it never meant and the Done at merge, so hole 101's "Blocked for 17 hours" was partly this picker and the owner's question of 2026-10-30 (hole 104) had a second cause. The pull-back mapped the block status by category to `in-progress`, so the plan never flagged it. Fixed forward by hand (this PR): the picker prefers the canonical's own name (`In Progress` for `review` and `in-progress`, `Done`, `To Do`/`Backlog`), never a block status unless the canonical is `blocked`, and notes an entity whose only route into the category is a block status; four tests. Story 36.6's CAP-22 (the launch-time `in-progress` phase) builds on it.
status: resolved 2026-10-31 by the hole-109 hotfix PR (the picker prefers the canonical's own name)

### DW-154: Two more Windows-only faults the Linux sandbox gate passed and the host leg caught (hole 110, hole 103's class): a `path.join` feeding `toVmPath` from a POSIX studio root, and a rename retry over the empty directory a failed rename leaves behind.
origin: hole 110 (Story 36.3's close-out host leg, run q-run-epic-36-20261031T042139Z-d85b61, 2026-10-31 07:48Z, red after 42 min; both fixed by hand on the run branch, bcfa691)
source_spec: `kb/agent-pc-setup-runbook.md` (the hole-110 row); `kb/bmad-base-patches.md` (the staging-rename retry's note)
location: apps/supervisor/src/sweep.ts `stopEngineAt` (now `toVmPath(studioRoot(env))` + the POSIX tail, as sandbox.ts:119); `_bmad/scripts/render_skill.py` and `apps/supervisor/_bmad/scripts/render_skill.py` `_publish` (the retry clears an empty destination before the next try; a Windows rename refuses an existing directory, WinError 183, a POSIX rename replaces an empty one); apps/supervisor/test/sweep.test.ts (the test's `/studio` root is POSIX by design); plugins/tk-studio/lib/tests/test_basepatch.py
severity: medium
reason: The engine's gate runs on Linux and the host leg on Windows; every class of difference so far (encoding, hole 103; time bounds, hole 108; path joins and rename semantics, hole 110) costs a 40-minute red leg and a hand fix on the run branch, and the leg's 20-line tail hides earlier suites' failures behind the last one. Fix to make (Story 36.4, the host leg goes red for code only): the engine's gate runs a Windows-semantics check for the known classes (a `path.join`/`resolve` whose result reaches `toVmPath` or an `sbx exec` argv; `os.rename`/`Path.rename` onto a path that may exist; text-mode opens without an encoding; `bun test` bounds under the host figure), or the planner's test guidance names them with the host figures; the leg's event keeps every suite's own verdict line.
status: open

### DW-155: A bare multi-file `bun test` reads bun's 5 s past its first file on bun 1.4.3: the preload's `setDefaultTimeout` reaches only the first file, and a bunfig `[test] timeout` does not help.
origin: spec-deferred, consult ruling 2026-10-31T09:48:21Z (deviation-gt-0) on Story 36.4's preload default
source_spec: `36-4-the-host-leg-goes-red-for-code-only-spec.md`
location: apps/supervisor/test/preload.ts (`setDefaultTimeout(30_000)`); apps/supervisor (any bare multi-file `bun test`); plugins/tk-studio/contracts/conformance/e2e_paused_exits.py and e2e_vertical_slice.py (the two multi-file drives, which pass `--timeout 30000`)
severity: medium
reason: Measured on bun 1.4.3 outside the repo: 3 files of 6 s tests under the preload, the first file passes and the next two time out at 5000 ms; `[test] timeout = 30000` in a throwaway `bunfig.toml` still failed all three at 5000 ms. So a git- or uv-spawning test past a run's first file reads bun's 5 s unless the run passes `--timeout`. May affect 36-5 and 36-7, whose plans run the whole suite. Fix to make: run the whole suite with an explicit `--timeout`, or per file, or re-measure on a later bun.
status: open

### DW-156: Follow-up review still recommended for 36-4-the-host-leg-goes-red-for-code-only after the damping cap was spent
origin: review-budget-followup
source_spec: `36-4-the-host-leg-goes-red-for-code-only-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261031-091634-c382; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-157: Runs carrying own_block still count toward stop.max_runs in evaluate_stop, so repeated supervisor faults can stop a job through max_runs.
origin: spec-deferred 8209a52f4be7
source_spec: `36-5-the-supervisors-own-faults-spec.md`
location: plugins/tk-studio/lib/jobrun.py evaluate_stop
severity: medium
reason: evaluate_stop's new filter applies only to on_status; counted still includes own-marked runs. AC1 names on_status, so whether max_runs should change is outside this story; deferral rule (a), the criterion's "next submission is woken".
status: open

### DW-158: Follow-up review still recommended for 36-5-the-supervisors-own-faults after the damping cap was spent
origin: review-budget-followup
source_spec: `36-5-the-supervisors-own-faults-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261031-122053-c9d8; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-159: `run-vertical-slice` game-project runs get no In Progress and no rhythm: the launched duties filter on `isRunEpic`.
origin: spec-deferred, consult ruling 2026-10-31T17:47:31Z (deviation-gt-0) on Story 36.6's job filter
source_spec: `36-6-setup-and-the-launch-check-by-evidence-spec.md`
location: apps/supervisor/src/closeout.ts `isRunEpic`
severity: medium
reason: `isRunEpic` is true only when a run's resolved definition has `type` or `id` `run-epic`, so a `run-vertical-slice` run on a game project takes neither the `in-progress` plan call nor the `stop.after_stories` rhythm. The story's M24 keeps the field off that job, so the gap is outside 36.6.
status: open

### DW-160: `plansync setup` posts copied transitions without their `screen` and `rules`, which can erase a site's configuration, and the v3 update schema may have spellings that would carry them.
origin: spec-deferred d598570a16ed
source_spec: `36-6-setup-and-the-launch-check-by-evidence-spec.md`
location: plugins/tk-studio/lib/jirabackend.py:1638
severity: medium
reason: Deferral class (a), AC1. `_v3_transition` sends a whitelist, so `POST /workflows/update` omits them, and the loss is named only afterwards in `notes` with the setup still `complete`. From a reviewer's and this session's memory, not verified (Atlassian's docs page answered 403 here), the v3 schema has `conditions`, `validators`, `actions`, `triggers` and `transitionScreen`. The consult of 2026-10-31T17:47:31Z ruled that a loss or a v3 spelling found by the operator's live call becomes a follow-up. The legacy rule shapes do not map one to one, so a mapping needs the site's real read.
status: open

### DW-161: A figure 1 run whose arming was refused still relaunches at close-out, so one queue run can build a second story.
origin: spec-deferred 9e39164515b6
source_spec: `36-6-setup-and-the-launch-check-by-evidence-spec.md`
location: apps/supervisor/src/closeout.ts:577
severity: medium
reason: Deferral class (a), AC5's "never builds two stories in one run". `closeOutLanded` reads only `gracefulStopInForce` and `storyBoundaryRecorded`, never the job's rhythm. It needs a double fault: a refused stop, which already sends one notifier line, and then a pause that lands the story. The fix means ending at a boundary with no stop in force, and the `story-boundary` event's `graceful_stop` and `StopInForce.source` have no value for that today.
status: open

### DW-162: `rearmFailedLine` still prints a `launch.py stop` command with no `--directory`, which fails argument parsing.
origin: spec-deferred 37db24c63664
source_spec: `36-6-setup-and-the-launch-check-by-evidence-spec.md`
location: apps/supervisor/src/closeout.ts:1068
severity: low
reason: Deferral class (a), filed by the consult of 2026-10-31T19:40:00Z. `launch.py stop` declares `--directory` as required, and on the sbx tier the host has no `bmad-loop`. The line predates this story; `armRefusedLine` was fixed here and `gracefulStopCommand` is the form to reuse.
status: open

### DW-163: Follow-up review still recommended for 36-6-setup-and-the-launch-check-by-evidence after the damping cap was spent
origin: review-budget-followup
source_spec: `36-6-setup-and-the-launch-check-by-evidence-spec.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20261031-170810-6825; this entry preserves the lingering recommendation for a deliberate later review.
status: open

### DW-164: `withMcpStop` in `cli.ts` is not checked to inject `stopEngineMcp`; only its call sites and `sbxDeps` are pinned.
origin: spec-deferred 9ed3801f2c8f
source_spec: `36-7-the-cycles-cut-and-the-docs-caught-up-spec.md`
location: apps/supervisor/src/cli.ts:626
severity: low
reason: Category (b), a contract line left partly unpinned: "the run's engine MCP stops at its release". The patch's `releaseWiringFaults` covers the callers, so removing the injection from `withMcpStop`'s body fails no test.
status: open
