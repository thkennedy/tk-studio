# tk-studio Driver Contract

| | |
| --- | --- |
| **Contract version** | **1.6.0** (semver — see [Change policy](#change-policy); 1.1.0 added the `tk-studio-job` surface and the shipped `job.schema.json`, 1.2.0 added `tk-studio-research`, 1.3.0 added `tk-studio-measure-push`, 1.4.0 added `tk-studio-consolidate`, 1.5.0 installed the `jira` planning binding behind `tk-studio-plan-sync`, 1.6.0 adds `tk-studio-migrate` — each additive, MINOR) |
| Story / rulings | ST-5.3, ST-6.2, ST-7.1, ST-7.2, ST-8.1, ST-8.2; AD-2, AD-7, AD-10, AD-11, AD-12, AD-13, AD-14, AD-16 |
| Audience | any harness that drives tk-studio unattended — first consumer: the ClaudeOS MCP connector (ClaudeOS-side, later) |
| Companion schemas | `status-block.schema.json`, `events/taxonomy.v1.json`, `registry.schema.json`, `interchange/shape.v1.json`, `job.schema.json` (v1, shipped ST-6.1) |

This document is everything a connector needs to drive the studio **without
reading studio internals** (AD-2: tk-studio never imports the harness; the
harness consumes only this contract). Every studio capability works with no
connector attached — direct headless invocation (§2) is itself a conforming
driver and is how the shipped conformance suite (`conformance/`, ST-5.4)
drives every surface until a connector exists.

## Change policy

The contract carries its own semver, independent of the plugin version:

- **MAJOR** — any breaking change: removing/renaming a verb, skill intent, or
  status field; changing a payload field's meaning or type; tightening a
  required field. A consumer pinned to `1.x` must never be broken by a `1.y`.
- **MINOR** — additive: new skills in the surface table, new optional payload
  fields, new verbs, new event types.
- **PATCH** — clarifications and examples; no shape changes.

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

## 2. Skill invocation surface (v1.6.0)

Payload fields map 1:1 onto the named CLI's flags. "Artifacts out" lists
what a `complete` run reports in `artifacts[]`; every skill may instead end
`blocked` with the conditions listed.

| Skill (intent) | Payload in | Deterministic core | Artifacts out | Blocked when (headless) |
| --- | --- | --- | --- | --- |
| `tk-studio-activate` | `directory`; `guided?` | `skills/tk-studio-activate/scripts/drift_check.py` | none (read-only; emits `drift-detection` event) | store/config unreadable |
| `tk-studio-install` | `directory`; `modules?` (subset); `dry_run?`; `timeout?` (s, default 900) | `skills/tk-studio-install/scripts/install_base.py` | `_bmad/` install at the `bmad.lock` pin | installer failure, manifest≠pin after install, timeout |
| `tk-studio-base-update` | `core?` (version), `pin?` (`MODULE=TAG`, repeatable), `directory` (studio repo), `dry_run?`, `no_pr?` | `skills/tk-studio-base-update/scripts/` | bumped `bmad.lock`, integration branch/PR | target missing from payload; install-at-new-pin failure |
| `tk-studio-detect` | `directory`; `out?` | `lib/inventory.py scan`, `lib/detect.py scan` | none unless `out` given (read-only) | project root unreadable |
| `tk-studio-onboard` | `directory`; `vcs?`; `project_id?`; `role?`; `resources?` (explicit confirmed list) | `lib/{store,config,registry,kb,vault,recommend}.py` | `.tk-studio/config.yaml` (+local), registry entry, `kb/`, vault links; `working_set.<role>` only when `resources` present | `project_id` collision; classification refusal (AD-3); recording requested without explicit `resources` |
| `tk-studio-orchestrator` | `directory`; `role?`; `target?` (route to act on) | `lib/orchestrate.py resolve` | whatever the routed resource produces; none for resolve alone | `needs-onboarding` (missing role / unconfirmed `working_set.<role>`) — gap named in `reason` |
| `tk-studio-job` | verb (`submit\|status\|cancel\|wake`); `directory`; `id`/`job_id`; `run_id?` | `lib/jobrun.py submit\|status\|cancel\|wake` (plus `account`/`finish` for the executing wrapper) | run workspace `~/.tk-studio/projects/<key>/runs/<run-id>/`; `job-run` ledger events | unknown or invalid job id (a stop-condition refusal is `accepted: false`, an answer — not blocked) |
| `tk-studio-plan-sync` | `directory`; `backend?` (runtime override); `dry_run?`; `normalize_only?` | `lib/plansync.py sync|normalize` | normalized planning artifacts, backend projection (`backlog/` locally; Jira issues under the `jira` binding, AD-7) | duplicate id (blocks until renumbered, AD-4); promote/pull-back conflict (human conflict, AD-5); `jira` binding preflight failure — missing `planning.jira.site`/`project_key`, missing `JIRA_EMAIL`/`JIRA_API_TOKEN`, 401/403 (token or org-admin toggle), or an issue-type scheme missing a default-mapping target — every gap named, never a silent 401 (AD-7/AD-11) |
| `tk-studio-migrate` | verb (`run\|status\|clear`); `directory`; `dry_run?` (run); `confirm?` (clear — the recorded operator clearance) | `lib/migrate.py run\|status\|clear` | closed inventory + migration record `.tk-studio/migrations/jira.json` (id map, hashes, verification, clearance state); Jira issues imported via the adapter; cutover flag (`planning.backend: jira` in tracked config) written last; source projection retained read-only | nothing to migrate; canonical export invalid; jira preflight failure (named, AD-7); **any verification mismatch** — counts, id map, content hashes, or spot round-trip — with each discrepancy listed (AD-16); cutover flag overridden by a local overlay; `clear` without `confirm` (no-delete-before-clearance) |
| `tk-studio-research` | `charter` (`{topics[], sources[], max_findings?, notes?}`); `directory`; `run_id?` (job runs) | `lib/research.py charter\|record` | `findings.json` + `findings.md` in the run workspace; `observation` ledger events for recommendation-carrying findings | charter missing/unscoped; run already terminal |
| `tk-studio-consolidate` | `directory` (studio repo root); `dry_run?` | `lib/consolidate.py run` | `issues/ledger.md` synced in place (stable `ISS-NNN` rows: severity, status, expected-vs-actual, named evidence events, fix candidates — never a deleted row); no ledger events (derives, not emits — AD-12) | directory missing; measurements outside the studio repo (AD-3); unparseable issues ledger (refuses to rewrite what it cannot update in place) |
| `tk-studio-measure-push` | `directory` (studio repo root); `base?`; `dry_run?`; `no_pr?` | `lib/measurepush.py check\|push` | feature branch `measurements/<user>-<machine>` + membrane PR updating `measurements/<user>-<machine>.jsonl` — no ledger events (a mover, not an emitter, AD-12); never a base-branch push, never a merge | not the studio repo root; dirty working tree; sanitization re-check finding (credential-shaped content blocks pre-commit) |
| `tk-studio-observe` | `source` (`retrospective\|repeated-manual-work\|research-job\|other`); `description`; `evidence?`; `project?` | `lib/observe.py record` | ledger line (`observation` event) | required field missing |
| `tk-studio-report` | `description`; `surface?`; `project?`; `skill?`; `mode` | `skills/tk-studio-report/scripts/` | ledger line (`report` event) | `description` missing |

Additions land as MINOR bumps; the conformance suite discovers surfaces from
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
| `submit` | a job definition (or the id of a shipped/project job instance) | `{job_id, run_id, accepted: bool, reason?}` | schedule per the job's trigger on the bound substrate; validation rejects a definition missing guards or stop conditions |
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

The AD-13 activation check — three-way, loud, read-only:

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
| 4 | ClaudeOS mechanics to bridge: mission tick ↔ `wake` (§4); missions.json ↔ job definitions (`job.schema.json`, ST-6.1 seam); handoff protocol ↔ resumable run workspaces (`~/.tk-studio/projects/<key>/runs/`); auth preflight (§1); runner sharp edges (e.g. dirty-tree silent-skip) stay connector-side | **Covered/seamed** — mappings named; Research→Knowledge Lifecycle port is **deferred** (spine Deferred list: runner-side halves move council-side behind this contract, ClaudeOS as first driver) and is landing story-by-story as Epic 9: the session surface (`tk-studio-session`, ST-9.2 — handoff/resume with `deltas[]` per `knowledge.schema.json`) ships plugin-side with its conformance manifest row as its driver-visible definition; its §2 row and the knowledge surfaces arrive with the deliberate 1.7.0 MINOR bump (ST-9.6, DW-1/DW-3 fold in) |
| 5 | O8 linkage: generalized runner lands council-side, ClaudeOS first driver | **Covered** — AD-10 hybrid ruled; §4 is the substrate-neutral surface the runner binds to |
| 6 | ClaudeOS remains the multi-project UI; the studio grows no UI | **Covered** — this contract exposes machine-readable status only (status blocks, verbs, registry/ledger schemas); dashboards read, studio serves |

## 8. Conformance

A surface is not done until the shipped suite (`conformance/`, ST-5.4)
proves it against this contract: valid terminal status block, no interactive
prompt, auth preflight before any external call, `blocked` (not a hang) on
ambiguity. Failures emit `headless-failure` events naming surface and
assertion (taxonomy §`headless-failure`). A connector implementing this
contract SHOULD run the same suite through itself — passing it is the
definition of a conforming driver.
