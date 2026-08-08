# tk-studio Driver Contract

| | |
| --- | --- |
| **Contract version** | **0.1.9** (pre-1.0 semver — a new product still stabilizing; see [Change policy](#change-policy). Renumbered 2026-08-07 from the 1.x line, mapped `1.N.0 → 0.1.N` for continuity: 0.1.1 added the `tk-studio-job` surface and the shipped `job.schema.json`, 0.1.2 added `tk-studio-research`, 0.1.3 added `tk-studio-measure-push`, 0.1.4 added `tk-studio-consolidate`, 0.1.5 installed the `jira` planning binding behind `tk-studio-plan-sync`, 0.1.6 added `tk-studio-migrate`, 0.1.7 publishes the Research→Knowledge Lifecycle port (Epic 9): the `tk-studio-session` and `tk-studio-knowledge` surfaces, the research anchor/seed surface, the run-finish capture note, the KB-injection directive, and the `knowledge-promotion` taxonomy event — each additive; 0.1.8 clarifies §2 (the detect row's blocked cell names the in-band `ask` outcome as a refusal; the plan-sync row states both-changed conflicts end `partial`, not blocked) — a clarification, no shape change; 0.1.9 adds `tk-studio-evolve` (EP-010 — the evolve loop's drafting half: merged `observation` events become `proposals/ledger.md` `PROP-NNN` rows; D1 documents only, D2 derive-only with the taxonomy untouched, D3 on-demand verb plus the shipped-undeclared `evolve-proposals` job type) — additive) |
| Story / rulings | ST-5.3, ST-6.2, ST-7.1, ST-7.2, ST-8.1, ST-8.2, ST-9.6 (Epic 9, D1–D5 ruled 2026-08-06), ST-040–ST-042 (EP-010, D1–D5 ruled 2026-08-07); AD-2, AD-3, AD-7, AD-8, AD-10, AD-11, AD-12, AD-13, AD-14, AD-16 |
| Audience | any harness that drives tk-studio unattended — first consumer: the ClaudeOS MCP connector (ClaudeOS-side, later) |
| Companion schemas | `status-block.schema.json`, `events/taxonomy.v1.json`, `registry.schema.json`, `interchange/shape.v1.json`, `job.schema.json` (v1, shipped ST-6.1), `knowledge.schema.json` (v1, shipped ST-9.1 — spine/seed frontmatter, anchors, deltas, queue and promotions-record lines) |

This document is everything a connector needs to drive the studio **without
reading studio internals** (AD-2: tk-studio never imports the harness; the
harness consumes only this contract). Every studio capability works with no
connector attached — direct headless invocation (§2) is itself a conforming
driver and is how the shipped conformance suite (`conformance/`, ST-5.4)
drives every surface until a connector exists.

## Change policy

The contract carries its own semver, independent of the plugin version.
**Pre-1.0 (current):** this is a new product; the compatibility line a
consumer pins is `0.MINOR` (today: `0.1`):

- **Breaking** — removing/renaming a verb, skill intent, or status field;
  changing a payload field's meaning or type; tightening a required field —
  bumps the minor: `0.1.x` → `0.2.0`. A consumer pinned to the `0.1` line
  must never be broken by a `0.1.y`.
- **Additive** — new skills in the surface table, new optional payload
  fields, new verbs, new event types — bumps the patch: `0.1.8` → `0.1.9`.
- **Clarifications** — wording and examples, no shape changes — also bump
  the patch; the version-history line names which kind each bump was.

At `1.0.0` the standard MAJOR/MINOR/PATCH mapping resumes (breaking/
additive/clarifying respectively). Renumbered 2026-08-07: versions before
the renumber shipped as `1.1.0`–`1.7.0`, mapped `1.N.0 → 0.1.N` — old
references to `1.N.0` in merged PRs and planning history mean `0.1.N`.

Schema files named above version independently (each carries its own
version); this contract pins which versions it speaks. Extending the event
taxonomy or status schema rides the same PR membrane as everything else
(AD-12).

## 1. Invocation model

A studio **surface** is a skill in `plugins/tk-studio/skills/tk-studio-*/`.
Skills are invoked **by name with a payload**, in a project root, in one of
two modes with identical behavior (AD-11):

- **Attended** — an interactive session; the skill may converse.
- **Headless** — non-interactive; the skill **never prompts**. Ambiguity or
  a missing payload field ends the run `blocked` with the gap named in
  `reason` — never a hang, never a guess.

Headless invocation, v1 (direct-invocation driver):

```bash
claude -p "/tk-studio:<skill-name> <payload as flags or JSON>" --output-format text
```

The deterministic core of every skill is a stdlib-only Python CLI under the
plugin (`lib/*.py`, `skills/*/scripts/*.py`), run via `uv run`; a driver MAY
call those CLIs directly for pure-data steps (they are listed per skill in
§3 and emit JSON on stdout), but the *skill* is the contract surface — the
CLI flags echo the skill's payload fields.

**Every headless run terminates with the JSON status block** (§4) as the
last JSON object on stdout. `artifacts[]` paths are relative to the project
root unless absolute-by-nature (per-user store paths are never emitted
unsanitized — AD-3/NFR5).

### Auth preflight

Every headless run begins with an auth preflight — silent-401 is the #1
historical failure. A driver MUST ensure before invoking:

1. Harness auth: `ANTHROPIC_API_KEY` set or `claude setup-token` completed;
   a 401 fails the run immediately as `blocked`, never silently.
2. Backend auth, when the flow will touch an external planning backend
   (AD-7): API tokens, **not OAuth** (MCP OAuth cannot complete
   non-interactively — legacy-council ISS-008), and the org-admin API-token toggle
   verified enabled. Verification failure → `blocked` before any backend
   call.

## 2. Skill invocation surface (v0.1.9)

Payload fields map 1:1 onto the named CLI's flags. "Artifacts out" lists
what a `complete` run reports in `artifacts[]`; every skill may instead end
`blocked` with the conditions listed (a cell may also name a condition that
ends `partial` rather than blocked — the row states which).

| Skill (intent) | Payload in | Deterministic core | Artifacts out | Blocked when (headless) |
| --- | --- | --- | --- | --- |
| `tk-studio-activate` | `directory`; `guided?` | `skills/tk-studio-activate/scripts/drift_check.py` | none (read-only; emits `drift-detection` event) | store/config unreadable |
| `tk-studio-install` | `directory`; `modules?` (subset); `dry_run?`; `timeout?` (s, default 900) | `skills/tk-studio-install/scripts/install_base.py` | `_bmad/` install at the `bmad.lock` pin | installer failure, manifest≠pin after install, timeout |
| `tk-studio-base-update` | `core?` (version), `pin?` (`MODULE=TAG`, repeatable), `directory` (studio repo), `dry_run?`, `no_pr?` | `skills/tk-studio-base-update/scripts/` | bumped `bmad.lock`, integration branch/PR | target missing from payload; install-at-new-pin failure |
| `tk-studio-detect` | `directory`; `out?` | `lib/inventory.py scan`, `lib/detect.py scan` | none unless `out` given (read-only) | project root unreadable; an `ask` outcome (`ambiguous — ask` / `unknown — ask` — the core exits 0, the ask is in-band) is a refusal to guess and ends `blocked` with the ask named in `reason` (§1: ambiguity never downgrades to `complete`) |
| `tk-studio-onboard` | `directory`; `vcs?`; `project_id?`; `role?`; `resources?` (explicit confirmed list) | `lib/{store,config,registry,kb,vault,recommend}.py` | `.tk-studio/config.yaml` (+local), registry entry, `kb/`, vault links; `working_set.<role>` only when `resources` present | `project_id` collision; classification refusal (AD-3); recording requested without explicit `resources` |
| `tk-studio-orchestrator` | `directory`; `role?`; `target?` (route to act on) | `lib/orchestrate.py resolve` | whatever the routed resource produces; none for resolve alone | `needs-onboarding` (missing role / unconfirmed `working_set.<role>`) — gap named in `reason` |
| `tk-studio-job` | verb (`submit\|status\|cancel\|wake`); `directory`; `id`/`job_id`; `run_id?` | `lib/jobrun.py submit\|status\|cancel\|wake` (plus `account`/`finish` for the executing wrapper) | run workspace `~/.tk-studio/projects/<key>/runs/<run-id>/`; `job-run` ledger events | unknown or invalid job id (a stop-condition refusal is `accepted: false`, an answer — not blocked) |
| `tk-studio-plan-sync` | `directory`; `backend?` (runtime override); `dry_run?`; `normalize_only?` | `lib/plansync.py sync|normalize` | normalized planning artifacts, backend projection (`backlog/` locally; Jira issues under the `jira` binding, AD-7) | duplicate id (blocks until renumbered, AD-4); `jira` binding preflight failure — missing `planning.jira.site`/`project_key`, missing `JIRA_EMAIL`/`JIRA_API_TOKEN`, 401/403 (token or org-admin toggle), or an issue-type scheme missing a default-mapping target — every gap named, never a silent 401 (AD-7/AD-11). A both-changed promote/pull-back conflict does **not** block: the run ends `partial` with each conflicted entity named in `reason` — a human picks a side by editing one file, then reruns sync (AD-5) |
| `tk-studio-migrate` | verb (`run\|status\|clear`); `directory`; `dry_run?` (run); `confirm?` (clear — the recorded operator clearance) | `lib/migrate.py run\|status\|clear` | closed inventory + migration record `.tk-studio/migrations/jira.json` (id map, hashes, verification, clearance state); Jira issues imported via the adapter; cutover flag (`planning.backend: jira` in tracked config) written last; source projection retained read-only | nothing to migrate; canonical export invalid; jira preflight failure (named, AD-7); **any verification mismatch** — counts, id map, content hashes, or spot round-trip — with each discrepancy listed (AD-16); cutover flag overridden by a local overlay; `clear` without `confirm` (no-delete-before-clearance) |
| `tk-studio-research` | `charter` (`{topics[], sources[], max_findings?, notes?}`); `directory`; `run_id?` (job runs) | `lib/research.py charter\|record\|seed\|spine` | `findings.json` + `findings.md` in the run workspace (a finding optionally cites a seed `anchor` — dangling citations are named rejections, per `knowledge.schema.json`); `seed.md` in the run workspace and the project spine `knowledge/spine.md` in the per-user store (aid, not gate — a missing spine is reported, never blocking; anchor ids append-only); `observation` ledger events for recommendation-carrying findings | charter missing/unscoped; run already terminal; invalid knowledge artifact (frontmatter, supersede header, anchor grammar — named rejection) |
| `tk-studio-session` | verb (`handoff\|resume`); `directory`; run selection: exactly one of `run_id` \| `job_id` (`job_id` resolves the job's sole resumable run — zero or several is a named refusal); handoff: `boundary` (`epic\|story\|phase`), `name`, `done[]`, `next[]`, `gotcha?[]`, `artifact?[]`, `delta?[]` (the `knowledge.schema.json` delta shape) | `lib/session.py handoff\|resume` | `handoff.json` in the run workspace — 16 KB budget, one per run, overwritten per boundary; a delta-carrying boundary also captures into the per-project reconciliation queue (best-effort — the handoff never fails on a capture problem); `resume` answers from the workspace alone | unknown or terminal run; ambiguous `job_id` resolution; handoff over the 16 KB budget or the 16-delta cap; dangling, unanchored, or within-handoff-duplicate deltas — named rejections (only the delta-carrying handoff refuses; the run stays resumable and a delta-free handoff always lands) |
| `tk-studio-knowledge` | verb (`check\|draft\|emit`); `directory`; draft: `base?`, `dry_run?`, `no_pr?`, `redraft?`; emit: `dry_run?` | `lib/promote.py check\|draft\|emit` | draft: ONE new dated `kb/reconciliation-<date>.md` on the stable branch `knowledge/<user>-<machine>` + the membrane PR (review is the gate — never a base push, never a merge, nothing auto-applies; D3/AD-12) and a draft line in the per-user promotions record; emit: one `knowledge-promotion` ledger event per batch of newly-merged drafts (at the skill's cadence, one per merged promotion PR), sole emitter this surface, reconciled against the promotions record — exactly-once per draft, never a duplicate (a draft emits nothing) | no routing doc (named rejection — the routing doc is the human's promotion-decision surface); not a git work tree; dirty tree; diverged promotion branch; detached HEAD; sanitization finding (NFR5, blocks pre-commit) |
| `tk-studio-consolidate` | `directory` (studio repo root); `dry_run?` | `lib/consolidate.py run` | `issues/ledger.md` synced in place (stable `ISS-NNN` rows: severity, status, expected-vs-actual, named evidence events, fix candidates — never a deleted row); no ledger events (derives, not emits — AD-12) | directory missing; measurements outside the studio repo (AD-3); unparseable issues ledger (refuses to rewrite what it cannot update in place) |
| `tk-studio-measure-push` | `directory` (studio repo root); `base?`; `dry_run?`; `no_pr?` | `lib/measurepush.py check\|push` | feature branch `measurements/<user>-<machine>` + membrane PR updating `measurements/<user>-<machine>.jsonl` — no ledger events (a mover, not an emitter, AD-12); never a base-branch push, never a merge | not the studio repo root; dirty working tree; sanitization re-check finding (credential-shaped content blocks pre-commit) |
| `tk-studio-observe` | `source` (`retrospective\|repeated-manual-work\|research-job\|other`); `description`; `evidence?`; `project?` | `lib/observe.py record` | ledger line (`observation` event) | required field missing |
| `tk-studio-evolve` | verb (`draft\|status`); `directory` (studio repo root); `dry_run?` (draft) | `lib/evolve.py draft\|status` | `proposals/ledger.md` synced in place (stable `PROP-NNN` rows: impact, status `Draft\|Under-review\|Adopted\|Declined`, evidence naming events and issues-ledger cross-links, the candidate change the observation itself states — never one invented, never a deleted row); drafting triggers nothing beyond the ledger sync — documents only, adoption is human (D1/AD-8); no ledger events (derives, not emits — AD-12, D2); a run that leaves `stranded` rows (a cluster merge) ends `partial` with the ids in `reason` | directory missing; measurements outside the studio repo (AD-3); unparseable proposals ledger (refuses to rewrite what it cannot update in place) |
| `tk-studio-report` | `description`; `surface?`; `project?`; `skill?`; `mode` | `skills/tk-studio-report/scripts/` | ledger line (`report` event) | `description` missing |

Additions land as additive bumps (patch-position while pre-1.0); the conformance suite discovers surfaces from
the plugin manifest, so an unregistered skill fails conformance rather than
silently extending this table (ST-5.4).

### Example — orchestrator, headless, blocked on an unconfirmed set

```bash
uv run "$PLUGIN_ROOT/lib/orchestrate.py" resolve --directory /work/proj
```

```json
{"ok": true, "outcome": "needs-onboarding", "gaps": ["working_set.developer"], "...": "..."}
```

→ the run ends:

```json
{"status": "blocked", "intent": "tk-studio-orchestrator", "artifacts": [], "reason": "needs-onboarding: working_set.developer unconfirmed"}
```

## 3. JSON status schema

Normative schema: [`status-block.schema.json`](status-block.schema.json)
(BMad-style). Shape:

```json
{
  "status": "complete | partial | blocked",
  "intent": "tk-studio-<skill>",
  "artifacts": ["path-or-identifier", "..."],
  "reason": "required non-null when status is partial or blocked"
}
```

`partial` is a guard hit mid-run (budget, stop condition) with useful work
already landed; `blocked` is a refusal to guess. A driver may rely on: the
block is the **last** JSON object on stdout of every headless run, and a
process exit without one is itself a conformance failure (`headless-failure`
event, ST-5.4).

## 4. Job model and scheduler verbs

Jobs are **data**; the substrate executes (AD-10, O8 hybrid ruling). The job
definition schema (`job.schema.json` v1 — id, target skill + payload, trigger
`one-shot|cron|loop`, cadence fixed|self-paced, budget guards, stop
conditions, model/effort) shipped with ST-6.1; `lib/jobrun.py` (the
`tk-studio-job` deterministic core, ST-6.2) implements this **verb surface**
on the harness-native substrate:

| Verb | Request | Response | Semantics |
| --- | --- | --- | --- |
| `submit` | the id of a shipped/project job instance (id-only — the definition already lives at the `job.schema.json`-published locations; a full-definition submit form is not part of this surface. DW-1 fold-in, 0.1.7) | `{job_id, run_id, accepted: bool, reason?}` | schedule per the job's trigger on the bound substrate; validation rejects a definition missing guards or stop conditions |
| `status` | `{job_id, run_id?}` | `{job_id, runs: [{run_id, state: queued\|running\|complete\|partial\|blocked\|cancelled, status_block?, started?, ended?}]}` | read-only; run state lives in `~/.tk-studio/projects/<key>/runs/<run-id>/` |
| `cancel` | `{job_id, run_id?}` | `{cancelled: bool, reason?}` | stop scheduling; a running run terminates `partial` with reason `cancelled` |
| `wake` | `{job_id}` | `{woken: bool, run_id?}` | fire a self-paced/loop job's next iteration now (the mission-runner "tick" maps here) |

Guarantees a driver can rely on:

- Budget guards and stop conditions terminate a run `partial` with the
  guard named in `reason` — a job never runs away (AD-10).
- Local harness schedules are session-scoped; a job declared
  durable-recurring records that requirement and the binding **surfaces the
  constraint** (cloud routine or external harness needed) instead of
  silently losing the schedule.
- Job-level events are emitted by the job wrapper alone; a skill emits its
  own surface events — never both for one failure (AD-12).
- **Run-finish capture (0.1.7):** the executing wrapper's every terminal
  transition (`finish`, `cancel`, core close) captures the run handoff's
  `deltas[]` into the per-project reconciliation queue
  (`~/.tk-studio/projects/<key>/knowledge/reconciliation-queue.jsonl`,
  deduped per `knowledge.schema.json`). Boundary handoffs capture too
  (`tk-studio-session`), so both hooks are idempotent by the dedupe key; a
  capture problem never fails the run — no new driver verb is required,
  capture rides `finish`.

### KB-injection directive (0.1.7)

An `invoke-skill` directive (submit/wake above) names the run's
provisional-knowledge artifacts in a `knowledge` field:

```json
"knowledge": {
  "spine": {"path": "~/.tk-studio/projects/<key>/knowledge/spine.md", "present": true},
  "seed":  {"path": "~/.tk-studio/projects/<key>/runs/<run-id>/seed.md", "present": false}
}
```

A driver SHOULD inject the contents of each `present` artifact into the
prompt/context of the segment it executes — provisional knowledge
supersedes canonical in-flight, and the artifact carries its own supersede
header (`knowledge.schema.json`). The injection *act* stays driver-side
(AD-2): the studio names the paths and never renders another harness's
prompts. Aid, not gate: an absent, stale, or invalid artifact is never a
reason to skip, delay, or fail the run.

## 5. Model & effort override API

Every studio resource declares conservative defaults in its
`customize.toml` (AD-14):

```toml
[model]
default = "claude-sonnet-5"
effort  = "medium"
```

Resolution precedence, first hit wins: **runtime override > project config >
resource default**. A driver sets the runtime override per invocation by
payload (`model`, `effort`) or config override (`--set model.default=...`,
`--set model.effort=...` through `lib/config.py` resolution); project config
may pin per-project values under the same keys. Escalation is always
deliberate — a driver MUST NOT default to a larger model than the resolved
value.

## 6. Drift-check invocation

The AD-13 activation check — four-plane (bmad-base; plugin, including
harness loadability; store; vault), loud, read-only (DW-3 wording fold-in,
0.1.7):

```bash
uv run "$PLUGIN_ROOT/skills/tk-studio-activate/scripts/drift_check.py" --directory <project-root> [--guided]
```

Output (stdout JSON): `{ok, result: "clean"|"drift", planes: [{plane:
"bmad-base"|"plugin"|"store"|"vault", status, detail, fix?}], fixes: [...]}`.
The check never mutates; fixes are guidance (`tk install`,
`/plugin marketplace update`), applied only by an operator or an explicitly
invoked skill. Each run emits a `drift-detection` measurement event
(taxonomy §`drift-detection`); `--guided` marks the onboarding-funnel
variant. A driver SHOULD run it at session/connector start and surface
`fixes[]` verbatim.

## 7. ClaudeOS integration dossier coverage (A7)

Every dossier item the connector must consume, covered or deferred with a
named seam:

| # | Dossier item | Disposition |
| --- | --- | --- |
| 1 | Ownership: connector is a ClaudeOS plugin; tk-studio never imports ClaudeOS | **Covered** — AD-2 boundary; this contract is the entire interface |
| 2 | The driver contract surface: per-skill headless invocation, status schema, job/scheduler model, model/effort API, drift-check | **Covered** — §2, §3, §4, §5, §6 |
| 3 | Reference-harness role: mission runner is the conformance target; direct headless invocation until then | **Covered** — §1 (direct invocation is a conforming driver); suite in `conformance/` (ST-5.4) |
| 4 | ClaudeOS mechanics to bridge: mission tick ↔ `wake` (§4); missions.json ↔ job definitions (`job.schema.json`, ST-6.1 seam); handoff protocol ↔ resumable run workspaces (`~/.tk-studio/projects/<key>/runs/`); auth preflight (§1); runner sharp edges (e.g. dirty-tree silent-skip) stay connector-side | **Covered** (0.1.7) — mappings named; the Research→Knowledge Lifecycle port (spine Deferred list: runner-side halves move council-side behind this contract, ClaudeOS as first driver), deferred through 0.1.6, landed story-by-story as Epic 9 and is published here at 0.1.7 (ST-9.6): the session surface (`tk-studio-session` §2 row — handoff/resume with `deltas[]` per `knowledge.schema.json`), the research anchor surface (changed `tk-studio-research` §2 row — `research.py seed\|spine`, findings optionally citing seed anchors), run-finish capture riding the wrapper's terminal transitions (§4 note — no new verb), the KB-injection directive (§4 — spine/seed paths named on `invoke-skill` directives, the injection act driver-side per AD-2), and the promotion gate (`tk-studio-knowledge` §2 row — drafts behind the membrane PR; `emit` the sole `knowledge-promotion` emitter, exactly once per merged promotion PR, reconciled against the promotions record) |
| 5 | O8 linkage: generalized runner lands council-side, ClaudeOS first driver | **Covered** — AD-10 hybrid ruled; §4 is the substrate-neutral surface the runner binds to |
| 6 | ClaudeOS remains the multi-project UI; the studio grows no UI | **Covered** — this contract exposes machine-readable status only (status blocks, verbs, registry/ledger schemas); dashboards read, studio serves |

## 8. Conformance

A surface is not done until the shipped suite (`conformance/`, ST-5.4)
proves it against this contract: valid terminal status block, no interactive
prompt, auth preflight before any external call, `blocked` (not a hang) on
ambiguity, and the suite's `unrunnable-core` assertion — every SKILL.md
carries the canonical unrunnable-core discipline paragraph (a denied or
unavailable deterministic core ends `blocked` with the block naming it,
never a question; DW-3 fold-in, 0.1.7). Failures emit `headless-failure`
events naming surface and
assertion (taxonomy §`headless-failure`). A connector implementing this
contract SHOULD run the same suite through itself — passing it is the
definition of a conforming driver.
