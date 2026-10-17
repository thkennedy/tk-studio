---
id: SPEC-epic-28
companions:
  - ../../planning-artifacts/briefs/adr-repository-structure-2026-10-09.md
  - ../../planning-artifacts/design/studio-design-spec-2026-10-09/decisions.md
  - ../../planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md
sources:
  - ../../planning-artifacts/epics.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Epic 28: The Supervisor Moves In: One Repository

## Why

A pain plus a mandate. Tim pulled this epic forward on 2026-10-16 (design spec D3 as amended) because after Epic 27 every later epic touches the supervisor, and the two-repository tax is paid once per epic until the move: a read-only mount of tk-studio in the supervisor's sandbox, a hand-over file for the tk-studio side, a second copy of the studio pipeline plugin with `$TK_STUDIO_ROOT` paths, three PRs per epic, an installer roster with two sources. AD-21 (signed 2026-10-14, D1 ruling O2) puts the supervisor in this repository as `apps/supervisor`, a nested studio project. The motion is the ADR's §5: rehearse on throwaway clones until every check passes, then cut over once for real. Hole 16 (worktrees, landed in Story 27.1) was the precondition the ADR named for one sandbox serving both loops. Trace: D1 (O2, AD-21), D3 as amended 2026-10-16, ADR §5 and §6. Repo: tk-studio (every story), plus one commit on the old repository's README before it is archived.

## Capabilities

- **CAP-1** (28.1)
  - **intent:** The supervisor's history is rewritten under `apps/supervisor/` and merged into a tk-studio clone by a script, on throwaway clones only.
  - **success:** `tools/restructure/rehearse.py`, on a fresh `git clone --no-local` of the supervisor repository and a fresh clone of tk-studio in a scratch folder it creates, runs `git filter-repo --to-subdirectory-filter apps/supervisor`; asserts no tags, no signed commits and no `node_modules` path anywhere in the rewritten history; fetches the rewrite into the tk-studio clone on branch `restructure/supervisor-into-monorepo`; merges it with `--allow-unrelated-histories`; asserts the merge produced no conflict (every path is new).
- **CAP-2** (28.1)
  - **intent:** The merged clone's checks are run and each result is recorded.
  - **success:** The report records exit code, duration and last output lines for: `tk activate` clean from the nested root `apps/supervisor` (the plugin's own entry point); `bmad-loop` finding its run workspace from the nested root; the supervisor's `bun test` passing from `apps/supervisor`; `tools/verify_host.py` passing from the repository root; the four loop hooks of `apps/supervisor/.claude/settings.json` firing with `$CLAUDE_PROJECT_DIR` equal to the nested root; the clone's size after the merge (the design spec's open question).
- **CAP-3** (28.1)
  - **intent:** A check the script's host cannot run is reported honestly.
  - **success:** A Windows-only check inside the Linux engine, or a hook-firing check where no Claude session can start, is listed under `unverifiable-here` with the exact command for the agent PC, never as a pass; the exit status does not count it as failed.
- **CAP-4** (28.1)
  - **intent:** The rehearsal ends in a report and a verdict, and is pinned.
  - **success:** The report `_bmad-output/implementation-artifacts/restructure-rehearsal-<date>.md` follows ADR §5 steps 1 to 5 in order and ends with a one-line verdict (`rehearsal passed` or the first failed step); the script exits non-zero when any step or check failed; it never touches `C:\GitHub\tk-studio`, the live supervisor checkout or any remote; the lib suite pins it against a fake pair of small repositories (a fake `git-filter-repo` only where the real one is unavailable).
- **CAP-5** (28.2)
  - **intent:** Every surface resolves the nearest studio project root.
  - **success:** From a working directory inside `apps/supervisor`, activation and the drift check, `config.py resolve`, `plansync`, `jobrun`, `meter`, `observe`, the registry and the launch skill all pick the nearest ancestor holding `.tk-studio/config.yaml` (the nested root), never the outer one; `TK_STUDIO_ROOT` keeps meaning the outer repository root, the plugin's home; activation reports both and names the project nested.
- **CAP-6** (28.2)
  - **intent:** The nested project keeps its own identity, registry entry and store.
  - **success:** With the supervisor's tracked `.tk-studio/config.yaml` carrying `project_id: supervisor` and its registry `root` amended to the nested root (`registry.py amend`), `registry.py show`, activation and the launch skill agree on the root; store paths stay per project (`~/.tk-studio/projects/supervisor/`); the nested project's plan counter and `plansync` never mint into the outer project's counter; nothing of the outer project's store is read or written from the nested root.
- **CAP-7** (28.2)
  - **intent:** A Claude session or the engine started in the nested root runs without `$TK_STUDIO_ROOT` inside the microVM.
  - **success:** `$CLAUDE_PROJECT_DIR` is the nested root and the hooks resolve their scripts relative to it; the nested `apps/supervisor/.bmad-loop/plugins/studio-pipeline/` copy names the spine and the driver contract by paths relative to the nested root (`../../_bmad-output/...`, `../../plugins/tk-studio/contracts/...`); the two copies of `task-planning.md`, `consult.md`, `gate.md` and `reconcile.md` differ only in those paths and the project's name, and a lib test pins that.
- **CAP-8** (28.2)
  - **intent:** The nearest-root rule is guarded and contracted.
  - **success:** The lib suite pins nested-root resolution for every CAP-5 surface with a fixture holding an outer and a nested project; the drift check reports a nested root distinctly; the driver contract states the nearest-root rule in a minor bump; conformance is green.
- **CAP-9** (28.3)
  - **intent:** Nothing in the merged tree points at the old repository.
  - **success:** With the merge on `main` through the attended PR: the root `.gitignore` carries the supervisor's ignore entries under `apps/supervisor/`; `README.md`, runbook §3.8 and §4 and the offline-install runbook point at `apps/supervisor`; `tools/release_archive.py --app supervisor` reads `apps/supervisor` in this repository (the second prefix, ADR §6); both rosters' supervisor entries drop their foreign `source`; `tk-studio update` on each channel still resolves every component against the rosters' digests.
- **CAP-10** (28.3)
  - **intent:** One engine sandbox serves both loops from one mount.
  - **success:** `claude-tk-studio` is recreated with one read-write mount of `C:\GitHub\tk-studio` and the read-only skills store; `launch-epic.sh` and `resume-run.sh` take `ROOT=/c/GitHub/tk-studio/apps/supervisor` for a supervisor epic and the repository root for a plugin epic; the `tk-studio:ro` second mount is gone from the runbook and the provisioning (`WITH_BUN=1` provisions bun for the nested project); `check-skills-mount.sh` holds; `claude-tk-studio-supervisor` is retired from the runbook. (Correct-course 2026-10-17: the serialisation of the two loops on one checkout lock is CAP-16, Story 28.5; the supervisor keyed its lock by project root and 28.3's Files excluded `apps/supervisor/src`.)
- **CAP-11** (28.3)
  - **intent:** A supervisor run driven by the supervisor itself serves the nested project.
  - **success:** The project served is the nested root and its `verify.host` (`bun test`) is the one read at the run's base (correct-course 2026-10-17: this live clause is CAP-16's subpath rule, Story 28.5; DW-25); `apps/supervisor/_bmad-output/planning-artifacts/epics.md` stays the nested project's transcription (Epics 21 to 23 and 27 keep their numbers) and the repository root's plan stays canonical; the supervisor's `TK_STUDIO_ROOT` is still the outer root.
- **CAP-12** (28.3)
  - **intent:** Both host gates pass on the merged tree and the old repository points forward.
  - **success:** `tools/verify_host.py` from the root and `bun test` from `apps/supervisor` are green on both hosts (the Windows run attended); the old repository's README (one commit there, before archiving) points at `tk-studio/apps/supervisor`.
- **CAP-13** (28.4)
  - **intent:** The tooling checks the service cut-over on the box.
  - **success:** With the Startup shortcut retargeted to `C:\GitHub\tk-studio\apps\supervisor\start.ps1` by Tim and `bun install --frozen-lockfile` run in `apps/supervisor`, `tk-studio doctor` on the agent PC reports the supervisor's root as the nested root, the registry root in agreement, folder trust for the nested root (trust has no inheritance; runbook §4.1), and the Startup shortcut's target (read from the `.lnk`), each `ok` or named; the checks are pinned with fakes in the lib suite and run for real on the box by the attended session.
- **CAP-14** (28.4)
  - **intent:** The service runs from its new root.
  - **success:** The supervisor started from the console from its new root passes `curl /status` from another device and one queued job to a guarded end; the results are recorded in the PR; `TK_STUDIO_ROOT`, `TK_SUPERVISOR_*` and `set-supervisor-env.ps1` are unchanged.
- **CAP-15** (28.4)
  - **intent:** The record is complete before the old repository is archived.
  - **success:** Runbook §3.8 and §4 describe the one-repository layout and sandbox; the handoff names the cut-over date and the archive; the spine's AD-21 carries a dated "done" note; the observation ledger has every hole found during rehearsal; `thkennedy/tk-studio-supervisor` is archived by Tim (`gh repo archive`), never deleted.
- **CAP-16** (28.5; added by correct-course 2026-10-17, carved out of CAP-10)
  - **intent:** A nested project and its repository share one checkout lock.
  - **success:** The supervisor keys its checkout lock by the canonical, case-folded git top-level of the project root (`git rev-parse --show-toplevel`, resolved once per submission and recorded on the run), never the project root itself; a root outside any git checkout keys by itself as today; the lock row and the status page still name the project root that holds it; a queued run for `apps/supervisor` and one for the repository root never run at once (`holder` names the first); `bun test` from `apps/supervisor` pins it with a nested fixture, the case-folded spelling included on win32; runbook §4's lock row says per git checkout. Widened 2026-10-17 (DW-25): a run prepared for a project below its git top-level serves `<worktree>/<prefix>` (`git rev-parse --show-prefix` of the root) as the worker's cwd, `payload.directory`, the sbx VM path and the root whose `verify.host` is read at the base, never the worktree top level; a project at its top level is unchanged; `bun test` pins both cases; DW-25 closes with it.
- **CAP-17** (28.6; added 2026-10-17 after the cut-over: the plugin's half of Story 27.2's "the queue is the only starter", handed over in `apps/supervisor/_bmad-output/implementation-artifacts/tk-studio-side-epic-27.md` §27.2)
  - **intent:** The queue is the only starter on both sides of the one repository; a hand start is a deliberate, visible act.
  - **success:** `jobrun.py submit` and `wake` refuse (in their own §4 answer shapes, `accepted: false` / `woken: false`, reason `StarterLocked: …` naming `since`, the supervisor pid and `POST /jobs`) and mint nothing when the store's `projects/<key>/starter.lock` names the queue as starter, its `checkout` is the project's root (canonical, case-folded on Windows) and the lock is live: `supervisor_pid` alive (POSIX `os.kill(pid, 0)`; Windows `OpenProcess` + `GetExitCodeProcess` through `ctypes`, never `os.kill`) or `since` under `STARTER_LOCK_STALE_S` = 900 s; `--force-starter` or `TK_STUDIO_IGNORE_STARTER_LOCK=1` mints with `"starter_lock": "forced"`; a stale lock mints with `"starter_lock": "stale"`; a malformed, foreign-starter or other-checkout lock is no lock. `serve` rewrites every served project's lock every 60 s so the lock stays live while the supervisor is up and goes stale within the window after it is down; the supervisor passes `--force-starter` on the verbs it runs for a claimed run and nothing on its MCP `tk_job` route; the driver contract bumps to 0.1.23 documenting flag, variable, refusal and field; the lib suite and `bun test` pin every case (the win32 probe terminating nothing included); runbook §3.8's "Hand starts" row and the supervisor's DW-6 close with it.

## Constraints

- ADR §5 motion: rehearse on throwaway clones until every check passes, then once for real through protected `main`; the real cut-over replays a passed rehearsal, never improvises. The old repository is archived, never deleted; its PR discussions stay there.
- The rehearsal script is stdlib Python; `git` and `uvx git-filter-repo` run through subprocess argv, never a shell; it never touches `C:\GitHub\tk-studio`, the live supervisor checkout or any remote.
- An unverifiable check is never reported as a pass.
- AD-21 layout: `apps/supervisor` is a nested studio project keeping its own `_bmad/`, `_bmad-output/` (Epics 21 to 23 and 27 keep their numbers), `.tk-studio/config.yaml`, `.bmad-loop/` and `.claude/settings.json`; the plugin stays sealed in `plugins/tk-studio`.
- `TK_STUDIO_ROOT` always means the outer repository root; `TK_STUDIO_ROOT`, `TK_SUPERVISOR_*` and `set-supervisor-env.ps1` are unchanged by the cut-over.
- Two launches: Stories 28.1 and 28.2 before the merge change only tk-studio; the attended merge PR (ADR §5 steps 1 to 3 and 7) is replayed by the operator on the host from the passed rehearsal; Stories 28.3 and 28.4 run on the merged tree.
- Operator-only steps (freeze with no run in flight and every PR merged on both repositories, stop the supervisor tab, retarget the Startup shortcut, archive the old repository) are Tim's; sandbox recreation and Windows-only checks are the attended session's; the loop performs none of them.
- Every headless surface path ends with the AD-11 status block; conformance gates every story (AD-19); driver contract changes are a minor, additive bump; lib suite tests make no network call.
- Rulings in force, not reopened: D1 (O2, AD-21), D3 as amended 2026-10-16, ADR §5 and §6, O5, AD-22.

## Non-goals

- `apps/studio-web` (born in place with EP-30).
- Moving the old repository's PR discussions, or deleting the old repository.
- CI and required checks (ADR §6; a separate story).
- Front-end and meta-CLI release tags.
- The ADR §5 step 4 single-root fallback (planning artifacts merged, counters reconciled), taken only on a failed rehearsal by operator ruling.

## Success signal

- `rehearse.py` ends `rehearsal passed` on throwaway clones with every non-Windows check green and the Windows-only ones listed with their commands; after the merge, `tk activate` from `apps/supervisor` names a nested project, both loops launch from the one `claude-tk-studio` mount, `tools/verify_host.py` and `bun test` are green on both hosts, `tk-studio doctor` reports the cut-over `ok`, and `thkennedy/tk-studio-supervisor` is archived with its README pointing at `tk-studio/apps/supervisor`.

## Assumptions

- 28.1's acceptance is the script plus its lib-suite pin against fake repositories; a passed rehearsal on the real repositories is expected only once 28.2's nested-root resolution lands (`tk activate` from the nested root depends on it).
- `rehearse.py` takes the supervisor and tk-studio source locations as arguments (the engine sandbox may not mount the supervisor checkout); no path is hard-coded beyond the forbidden-target guard.

## Open Questions

- Before the merge `apps/supervisor` does not exist in tk-studio: where does 28.2's lib test pin the two studio-pipeline copies (`task-planning.md`, `consult.md`, `gate.md`, `reconcile.md`) — a fixture or rendered template in tk-studio, with the real nested copy landing in the merge PR or 28.3? Planner to settle if the ADR constrains it, else an operator ruling.
- The manifest transcribes all four stories but the first launch covers only 28.1 and 28.2: what stops the run before 28.3 (an operator stop after 28.2, the gate escalating on 28.3's merged-tree precondition, or a manifest limited to the first launch)?

## Design notes (settled shape, planner, 2026-10-16)

- CAP-2/CAP-3 (28.1) — the four loop hooks of `apps/supervisor/.claude/settings.json`: named placeholder rule — the rehearsal enumerates whatever hooks the merged file declares and records their count and names (a count other than four is a failed check naming it); the static resolution of each hook's script path under `$CLAUDE_PROJECT_DIR` = the nested root is the verifiable check, the live firing is always `unverifiable-here` in the engine with the agent-PC command — per `../../planning-artifacts/briefs/adr-repository-structure-2026-10-09.md` §5 step 4. Detail: `plans/28-1.md` "Settled shape".
