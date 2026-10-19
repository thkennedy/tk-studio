# tk-studio Driver Contract

| | |
| --- | --- |
| **Contract version** | **0.1.25** (pre-1.0 semver — a new product still stabilizing; see [Change policy](#change-policy). Renumbered 2026-08-07 from the 1.x line, mapped `1.N.0 → 0.1.N` for continuity: 0.1.1 added the `tk-studio-job` surface and the shipped `job.schema.json`, 0.1.2 added `tk-studio-research`, 0.1.3 added `tk-studio-measure-push`, 0.1.4 added `tk-studio-consolidate`, 0.1.5 installed the `jira` planning binding behind `tk-studio-plan-sync`, 0.1.6 added `tk-studio-migrate`, 0.1.7 publishes the Research→Knowledge Lifecycle port (Epic 9): the `tk-studio-session` and `tk-studio-knowledge` surfaces, the research anchor/seed surface, the run-finish capture note, the KB-injection directive, and the `knowledge-promotion` taxonomy event — each additive; 0.1.8 clarifies §2 (the detect row's blocked cell names the in-band `ask` outcome as a refusal; the plan-sync row states both-changed conflicts end `partial`, not blocked) — a clarification, no shape change; 0.1.9 adds `tk-studio-evolve` (EP-010 — the evolve loop's drafting half: merged `observation` events become `proposals/ledger.md` `PROP-NNN` rows; D1 documents only, D2 derive-only with the taxonomy untouched, D3 on-demand verb plus the shipped-undeclared `evolve-proposals` job type) — additive; 0.1.10 clarifies the §2 base-update row (EP-011 ST-043: the install diff commits only after provably churn-only files are reverted, per-class counts in the result JSON `normalized`; a same-version re-affirmation whose diff is empty after normalization ends `complete` reporting the verified no-op — no branch pushed, no PR opened) — a clarification, no shape change; 0.1.11 adds the conformance harness pass (EP-014: `expect: harness-blocked` drives run the surface through the real harness under a denying permission profile and are judged to end in a `blocked` terminal block naming the unrunnable core; opt-in `--harness` because spend-bearing, the report's `harness_pass` field names declared/skipped/ran, and the denied-permissions case for `tk-studio-detect` ships declared) — additive; 0.1.12 adds the `resolve` scheduler verb (EP-015 — PROP-008's resolved-definition read surface: declared jobs served with type extension applied by the studio-side resolver; substrate-side recurring classification reads trigger/cadence from the verb, never from raw `.tk-studio/jobs/<id>.json` instance files) — additive; 0.1.13 adds named-write reporting to the planning adapter result (EP-017 — PROP-020's staging gap: `normalize.counter` names the committed id counter, and `written[]` — normalize-level and the sync-level roll-up over projection and index — names every file a run wrote, counter included, so commit staging derives from the response alone) — additive; 0.1.14 adds `tk-studio-launch` (studio pipeline decision 5, 2026-09-02: the studio's one way to start the execution substrate for a project epic — planner-tier SPEC + first-story task bootstrap, then bmad-loop started detached with a pre-minted run id — plus the shipped `run-epic` one-shot job type) — additive; 0.1.15 adds per-leg execution-pipeline routing to `tk-studio-launch` (§5: `lib/pipeline.py defaults\|check\|resolve\|apply`, the measured pipeline-v2 defaults shipped in the launch resource's `customize.toml` `[pipeline]`, the project overlay `.bmad-loop/routing.toml`, runtime `--set leg.field=value`; the launch flow routes the epic's first story before its readiness check) — additive; 0.1.16 adds the optional `no_normalize` payload to `tk-studio-install` and states its churn normalization (a verified install reverts provably churn-only files and drops installer `*.bak` copies of committed files when the project root is a git top-level with `_bmad/` tracked; paths dirty before the run are never touched; result JSON `normalized` with per-class counts and `remaining`) — additive; 0.1.17 adds studio-managed base patches (BMAD-METHOD#2718: `render_skill.py` halts on a short config token that several modules declare, even with identical values, so bmm + gds cannot render `bmad-build`/`bmad-build-auto`): `tk-studio-install` re-applies every patch declared in `base-patches/patches.json` after verify-at-pin and reports each in the result JSON `base_patches` (`patched`, `applied`, `not-applicable`, or `stale` / `unverified-core` when the upstream text or core version no longer matches — then the file is left untouched), and `tk-studio-activate` reports a missing or stale patch as bmad-base drift — additive; 0.1.18 names the conformant drivers now that ClaudeOS is retired as a driver (ST-062): a driver roster in §1 (the studio supervisor — executing wrapper, status page; Hermes — front door that submits jobs to the supervisor and never executes a run; direct invocation), §2 states the executing wrapper for a run is whichever conformant driver executed its `wake` directive with `account` and `finish` its duty, a §4 `finish` row documenting the optional `total_cost_usd` (ST-061), §1's cross-references corrected (per-skill CLIs in §2, the status block in §3), and the Audience line and §7 rows name the studio supervisor and Hermes in place of ClaudeOS — additive; 0.1.19 moves the drift check's plugin plane to the skills-dir folder and the roster (AD-21, ST-083): §6 states the folder-and-roster rule — the folder `<home>/skills/tk-studio/`'s `plugin.json` against the configured channel's roster `plugin` entry (`--channel`, default `stable`) and, only in a developer checkout, the catalog; the plane's additive `case` field (`ok`, `stale`, `missing`, `shadowed`) with each fix; `installed_plugins.json` read only to detect a shadowing marketplace copy — and §8 documents the conformance runner's `--from-archive <zip>` and the report's `harness_loadable` field — additive; 0.1.20 adds the conformance suite's meta-CLI drive (ST-085): §8 documents the manifest's `cli_drives` section, outside `surfaces`, and the report's top-level `cli_drives` field — the CLI doctor drive runs `tk-studio doctor --json` from the runner's repository checkout in a throwaway home, and is recorded `not run` with a reason when the checkout's CLI is absent — additive; 0.1.21 (Epic 26) states the `tk-studio-launch` row's launch-owns-its-lifetime rules (Story 26.1): every `lib/launch.py` result, refusals included, ends with the §3 block keys in order so every skill path, fresh or relaunch, ends on the core's block; the skill commits its own bootstrap output before its readiness check; `check` and `start` compare `.bmad-loop/policy.toml` limits read-only with `.tk-studio/budget-bands.yaml` (`budget`, `budget_mismatch[]`), `start` refusing a mismatch unless the optional `allow_budget_mismatch` payload acknowledges it — and §8's `expect: status-block` on surface drives, with an optional declared `status` — additive; 0.1.21 (Story 26.3) also gives every §5.1 routing leg an optional `advisor` (`opus` \| `fable` \| `off`, missing = `off`) under the pairing rule (the advisor must rank at or above the leg's model; a violation is a named refusal), carries `--advisor <value>` on an engine-stage leg's `claude -p` command line only when the advisor is not `off`, and gives subagent legs with no resolved effort the session's (`inherited-session`) — additive; 0.1.21 (Story 26.5) adds the planning adapter's status pull-back (§4 [Status pull-back](#status-pull-back-0121-story-265)): `plansync.py status --directory ROOT --id ST-NNN --status ENUM [--note TEXT] [--caller NAME] [--dry-run]` sets one canonical story's `status`, stamps `updated` and records the caller and note in the entity's `external.driver` snapshot, then re-runs `sync` so the projection and `plan/index.md` follow; status-class only (AD-5), the result's `plan_dir` names the plan it wrote — additive; 0.1.22 (Story 28.2) states the nearest-root rule (§1 [Project root](#project-root-0122)): the drift check, `config.py resolve` and `config.py root`, `plansync.py`, `jobrun.py`, `launch.py` and `observe.py`'s default `--project` resolve the nearest ancestor-or-self holding `.tk-studio/config.yaml` (every other `--directory` surface is unchanged), so a nested studio project (`apps/supervisor`) wins over the outer one and a folder with no config above resolves to itself; creation verbs (`config.py standup`, `registry.py register`) take `--directory` literally; `TK_STUDIO_ROOT` keeps meaning the outer repository root, the plugin's home; `config.py root` prints the resolution, and §6's drift-check JSON gains the optional top-level `project_root`, `studio_root`, `nested` and `project_id` — additive; 0.1.23 (Story 28.6) honours the studio supervisor's starter lock in §4 ([Starter lock](#starter-lock-0123-story-286)): `submit` and `wake` refuse with `StarterLocked` — nothing minted — while a live `~/.tk-studio/projects/<key>/starter.lock` names the queue as the checkout's only starter, the `--force-starter` flag and the `TK_STUDIO_IGNORE_STARTER_LOCK=1` variable override it, and the answer gains the optional `starter_lock` field (`forced` or `stale`) — additive; 0.1.24 (Story 29.4) names the studio web (EP-30) among the consumers in §1 — a consumer, not a driver: the Driver roster is unchanged — and documents the surfaces it reads as supervisor surfaces, never plugin surfaces (§1 [Supervisor surfaces the web consumes](#supervisor-surfaces-the-web-consumes-0124), AD-2): the account (`POST /auth/account`, `POST /auth/signin`), the registry (`GET /agents`) and the office projection (`GET /office`, `GET /office/events`, the event kinds `office.agent`, `office.progress` and `office.run`, the eight states); the plugin publishes their description and neither implements nor serves them, and nothing in the plugin's own surfaces changes — additive; 0.1.25 (Story 30.4) extends the office projection of §1 [Supervisor surfaces the web consumes](#supervisor-surfaces-the-web-consumes-0124) additively: an agent row and the `office.agent` delta carry `reason` (what a `waiting-for-human` or `blocked` agent waits for, `null` otherwise), and the `GET /office` snapshot carries `last_run` (each project's newest terminal run `{run_id, state, pr, ended_at}`), which the `office.run` delta of a run leaving the live set terminal carries too, and a project's changed `last_run` with no leaving run gets an `office.run` with `from` `null`; existing fields, kinds and ids are unchanged; Story 30.5 adds `GET /board` to this same 0.1.25 entry; supervisor surfaces, never plugin surfaces, and nothing in the plugin's own surfaces changes — additive; 0.1.25 (Story 30.5) adds the board read `GET /board?project=<id>` to §1 [Supervisor surfaces the web consumes](#supervisor-surfaces-the-web-consumes-0124): a served project's plan epics and stories with their canonical statuses, each story's latest run and open deferred-work findings, per epic the metered `job-run` spend against an optional band, and the Needs-you / Working / Done triage of its runs; no second version bump, a supervisor surface, never a plugin surface — additive; 0.1.25 (Story 30.6) makes the web the home and moves the read-only status page in §1 [Supervisor surfaces the web consumes](#supervisor-surfaces-the-web-consumes-0124): a signed-in `GET /` answers the built web's `index.html`, falling back to the read-only page when the web is not built, the read-only page is at `GET /status` (content-negotiated: `Accept: text/html` the page, any other `Accept` the unchanged `/status` JSON), and the office snapshot carries `supervisor` `{version, counts}` and `ledger` (the host ledger's last lines, redacted), never on a delta; no second version bump, supervisor surfaces, never plugin surfaces — additive) |
| Story / rulings | ST-5.3, ST-6.2, ST-7.1, ST-7.2, ST-8.1, ST-8.2, ST-9.6 (Epic 9, D1–D5 ruled 2026-08-06), ST-040–ST-042 (EP-010, D1–D5 ruled 2026-08-07), ST-061, ST-062, ST-083, ST-085, Story 26.1, Story 26.3, Story 26.5 (Epic 26), Story 28.2, Story 28.6 (Epic 28), Story 29.4 (Epic 29), Story 30.4, Story 30.5, Story 30.6 (Epic 30); AD-2, AD-3, AD-4, AD-5, AD-7, AD-8, AD-10, AD-11, AD-12, AD-13, AD-14, AD-16, AD-21 |
| Audience | any harness that drives tk-studio unattended — the conformant drivers are the studio supervisor (executing wrapper, status page) and Hermes (front door), plus direct invocation (§1 [Driver roster](#driver-roster-0118)); the studio web (EP-30) is a consumer of the supervisor's own surfaces, not a driver (§1 [Supervisor surfaces the web consumes](#supervisor-surfaces-the-web-consumes-0124)) |
| Companion schemas | `status-block.schema.json`, `events/taxonomy.v1.json`, `registry.schema.json`, `interchange/shape.v1.json`, `job.schema.json` (v1, shipped ST-6.1), `knowledge.schema.json` (v1, shipped ST-9.1 — spine/seed frontmatter, anchors, deltas, queue and promotions-record lines) |

This document is everything a connector needs to drive the studio **without
reading studio internals** (AD-2: tk-studio never imports the harness; the
harness consumes only this contract). Every studio capability works with no
connector attached — direct headless invocation (§2) is itself a conforming
driver and is how the shipped conformance suite (`conformance/`, ST-5.4)
drives every surface. The conformant drivers are named in the §1 driver
roster (0.1.18).

## Change policy

The contract carries its own semver, independent of the plugin version.
**Pre-1.0 (current):** this is a new product; the compatibility line a
consumer pins is `0.MINOR` (today: `0.1`):

- **Breaking** — removing/renaming a verb, skill intent, or status field;
  changing a payload field's meaning or type; tightening a required field —
  bumps the minor: `0.1.x` → `0.2.0`. A consumer pinned to the `0.1` line
  must never be broken by a `0.1.y`.
- **Additive** — new skills in the surface table, new optional payload
  fields, new verbs, new event types — bumps the patch: `0.1.9` → `0.1.10`.
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
§2 and emit JSON on stdout), but the *skill* is the contract surface — the
CLI flags echo the skill's payload fields.

**Every headless run terminates with the JSON status block** (§3) as the
last JSON object on stdout. `artifacts[]` paths are relative to the project
root unless absolute-by-nature (per-user store paths are never emitted
unsanitized — AD-3/NFR5).

### Driver roster (0.1.18)

Any conformant driver may execute a run; the studio imports none of them
(AD-2) and grows no UI of its own. The drivers that drive the studio:

| Driver | Role |
| --- | --- |
| the studio supervisor | the **executing wrapper** for the runs it executes — it executes `wake` directives and carries `account`/`finish` (§2; `finish` in §4) — and the **status page**, the UI a human reads run state through |
| Hermes | the **front door**: a human-facing entry that hands jobs to the studio supervisor (the supervisor calls §4 `submit`) and **never executes a run** |
| direct invocation | headless invocation by name with a payload (above) — **a conforming driver per §1**, and how the shipped conformance suite drives every surface |

ClaudeOS, the first consumer named through 0.1.17, is retired as a driver.

**Consumers (0.1.24).** Beside the drivers, **the studio web** (EP-30, the
office) is a consumer, not a driver: it never executes a run, never submits
through §4 and never calls a plugin surface. It reads only the studio
supervisor's own surfaces, below, so it is not a row of the roster. The
studio itself (the plugin) still grows no UI.

### Supervisor surfaces the web consumes (0.1.24)

These are supervisor surfaces (AD-2): the plugin publishes their description
but neither implements nor serves them. They are the studio supervisor's
(`apps/supervisor`, outside the plugin), consumed by the studio web and the
supervisor's own status page — never plugin surfaces, and no plugin verb,
skill, schema or status block changes with them. The answer shapes in full
are in `apps/supervisor/README.md` (**HTTP API**, **The agent registry
(Story 29.2)**, **The office projection (Story 29.3)**); the summary here is
what a consumer may rely on. The two account routes answer before any auth
check; the reads take the bearer header
(`Authorization: Bearer <TK_SUPERVISOR_TOKEN>`) or a session cookie.

| Surface | Route | What it answers |
| --- | --- | --- |
| the account (Story 29.1) | `POST /auth/account` | creates the owner's one account, once (username and password; a second creation is `409 AccountExists`); the record lives in the per-user store (`<TK_STUDIO_HOME or ~/.tk-studio>/supervisor/account.json`, AD-3), never a checkout or the queue; deleting that record from the console is the reset, and the next visit creates the account again (runbook §4.5); `303` to `/` with the session cookie, or `{ok:true, username}` to a JSON body. A bad field is `400 AccountInvalid` naming the field |
| the account (Story 29.1) | `POST /auth/signin` | the username and password: a match sets the session cookie (`303` to `/` to a form body, `{ok:true, username}` to a JSON body); a mismatch is `401 SignInRefused` after a fixed delay; five refusals within fifteen minutes lock the account fifteen minutes (`423 AccountLocked`). No answer, event or log line carries a password or a hash. `POST /auth/token` (the bearer token as a form) stays for the operator's browser. For both account routes: without TLS or the session secret they are refused `401 SignInRefused`, as the token form is; a JSON body (`application/json`) that is not JSON is `400 MalformedJson` (distinct from `400 AccountInvalid`); an `account.json` that is not an account record is `500 AccountRecordInvalid`, never "no account" (the rest in the README's **Sign-in from the phone**) |
| the registry (Story 29.2) | `GET /agents`, `GET /agents?project=<id>` | `{ok:true, rebuilt_at, agents:[…]}`: one derived row per served project and role (`orchestrator`, `session`, `implementer`, `reviewer`, `consult`, `advisor`, `planner`), `agent_id` `<project-id>/<role>`, with the routed `model`, `effort` and `advisor`, `persona`, `live_state`, `current_run`, `current_story`, `jira_account`; an unknown project is an empty list |
| the projection (Story 29.3) | `GET /office` | the snapshot `{ok:true, at, agents, runs, problems, id}`: every registry agent once with its state, the live runs with story and epic progress, the time and the id of the latest delta; 0.1.25 (Story 30.6) adds `supervisor` `{version, counts}` (the supervisor's version and the per-state queue counts) and `ledger` (the host ledger's last lines, redacted); a read that writes nothing |
| the projection (Story 29.3) | `GET /office/events` | with `Accept: text/event-stream`, the stream below; without it, the JSON snapshot |
| the board (Story 30.5, 0.1.25) | `GET /board?project=<id>` | `{ok:true, project, built_at, plan, epics, triage}`: the served project's plan epics with their stories and canonical statuses, each story's latest run (`{run_id, state, pr, host_verify, ended_at}` or `null`) and open findings, per epic `spend_usd` against `band_usd` (`null` with no band), and `triage` `{needs_you, working, done}`; no `project` is `400 ProjectRequired`, an unregistered one `404 UnknownProject`; a read that writes nothing |
| the home and the read-only page (Story 30.6, 0.1.25) | `GET /`, `GET /status` | `GET /` with a session (the cookie or the bearer) is the web: the built web's `index.html` (as `GET /app`, `cache-control: no-store`), or, while the web is not built, the read-only page with its "not built" note, never a `503`; with no session it is the sign-in page. The read-only page (server-rendered HTML, no script, credentials redacted) is at `GET /status` with an `Accept` naming `text/html`; any other `Accept` (none, `*/*`, `application/json`) answers the `/status` JSON `{ok, counts, live, locks}` unchanged; both carry `vary: Accept`. With no session an HTML `GET /status` is the sign-in page returning to `/status`, any other `401` JSON |

**The states.** Every agent is in exactly one of eight states: `offline`,
`idle`, `thinking`, `reading`, `typing`, `running`, `waiting-for-human`,
`blocked`. A story carries `overlay` `"done"`, `"failed"` or `null`.
Promotion is instant; a demotion holds a grace period first, and
`waiting-for-human` never expires on its own.

**The stream.** The first frame is `event:snapshot` with the `GET /office`
answer; then one frame per change, of the kinds `office.agent` (`{agent_id,
state, from, at, current_run, current_story}`), `office.progress` (`{run_id,
epic, story?}`) and `office.run` (`{run_id, project, state, from}`). `office.agent` fires
when an agent's state, `current_run` or `current_story` changes, its `from`
`null` for the agent's first appearance. `office.run` fires when a run
appears in the live set (`from` `null`), changes state, or leaves the live
set (`state` its queue state, `null` when the run is gone; `from` its last
live state). Every
frame has an id `<boot>-<seq>`. A reconnect's `Last-Event-ID` of the same
boot, still inside the buffer, replays exactly the deltas after it; an id
too old, of another boot or malformed gets the snapshot again. A `:
heartbeat` comment is sent every 10 s; the client's close ends the stream.
The raw `GET /events` stream is unchanged.

**0.1.25 (Story 30.4, additive).** Every agent row of the snapshot and
every `office.agent` delta carry `reason`: what a `waiting-for-human` or
`blocked` agent waits for (the awaited ruling's or the pause's reason, or
the blocked run's queue reason), `null` in every other state or when
nothing names it; a change of `reason` alone fires `office.agent`. The
snapshot carries `last_run`, keyed by project: each project's newest
terminal run `{run_id, state, pr, ended_at}` (`pr` `null` with no PR,
`ended_at` an ISO time); a project that never ended a run has no entry.
The `office.run` delta of a run leaving the live set terminal carries
that run's `last_run` when that run is its project's `last_run`. A
project whose `last_run` changes in any field with no leaving run
carrying it (a run created and ended between two refreshes, a run never
seen live, or a PR arriving after the run ended) gets one `office.run`
`{run_id, project, state, from: null, last_run}` for that run. Such an
`office.run` (`from` `null`, a terminal `state`, carrying `last_run`) is
not a live-set entry: a consumer counts a run as live only when its
`state` is a live state. Existing fields, kinds, ids and the rules below
are unchanged.

Story 30.5 adds `GET /board?project=<id>` to this same 0.1.25 entry (no
second bump): a served project's plan directory read as epics with their
stories and canonical statuses, each story's latest run `{run_id, state,
pr, host_verify, ended_at}` (`null` with none), the open deferred-work
entries that name the story, per epic the metered `job-run` spend
(`spend_usd`) against the epic's optional band (`band_usd`, `null` when
`.tk-studio/budget-bands.yaml` names none), and `triage` with three
columns, `needs_you`, `working` and `done`, each item `{run_id, state,
story_key, pr, ruling}`. Every live run of the project is in exactly one
of Needs-you and Working; Done holds the runs ended on the supervisor
host's local day, except that a terminal run ended that day with a red host
leg is in Needs-you instead. A project with no plan directory answers an
empty board with `plan.reason`. The plan part is cached and rebuilt when
the plan directory or an entity changes.

Story 30.6 adds to this same 0.1.25 entry (no second bump): the snapshot
(`GET /office`, the JSON `GET /office/events` and the stream's
`event:snapshot`) carries `supervisor` `{version, counts}` (the
supervisor's package version, and the per-state counts over every queue
run, as `GET /status` counts them) and `ledger` (`{path, lines}`, the last
lines of the host ledger the read-only page shows, each line redacted, or
`{path, note}` when the file is missing or unreadable). They ride the
snapshot only, never a delta, and are not an event; a consumer refreshes
them from the next snapshot. The web is the home at `GET /`, and the
read-only page moves to `GET /status` (an HTML `Accept`; any other `Accept`
keeps the `/status` JSON). Every other field, kind, id and route is
unchanged.

**The rules a consumer may rely on** (the landed Story 29.3 rules, stated
in full in the README's "The office projection (Story 29.3)" bullet):

- **Emission.** `office.agent` may repeat a state when only `current_run`
  or `current_story` changed. A run new to the live set sends an epic-only
  `office.progress` beside its `office.run`. An agent that leaves the
  registry gets no event: only the next snapshot drops it.
- **Run selection, per project.** The newest `paused` live run, else the
  newest live run that is not `queued`, else the newest `queued` live run,
  else, with no live run, the latest run when it is `blocked`.
- **Two predicates.** The launch leg's `thinking` covers a run with no
  `launched` event yet, or none since the latest `close-out` or
  `engine-resume`. The host-verify `running` needs a `launched` with no
  `host-verify` after the latest one.
- **Progress** is `done / total` per story and per epic. The denominator
  is fixed at the run's first `stories-validated`. `done` comes from the
  engine journal's terminal kinds and, after a relaunch, from a manifest
  story whose story spec reads `status: done`; the journal wins over the
  spec file.

### Project root (0.1.22)

A studio project's root is the **nearest** ancestor-or-self of the given
folder holding `.tk-studio/config.yaml` (Story 28.2, AD-21). A nested studio
project — `apps/supervisor` inside tk-studio — therefore wins over the outer
one from any folder beneath it, and nothing of the outer project's store or
plan counter is read or written from there. A folder with no
`.tk-studio/config.yaml` anywhere above resolves to itself (not yet
onboarded); a `--directory` that is itself a root resolves to itself; a
`--directory` that does not exist is taken literally (no walk-up).

- **Surfaces that walk up:** the drift check (§6), `config.py resolve
  --directory` and `config.py root`, `plansync.py`, `jobrun.py`,
  `launch.py`, and `observe.py`'s default `--project` (the nearest project's
  id when the working directory sits inside one). The meter keys a story by
  the run's repository root, which is already the nested root. Every other
  surface taking a project `--directory` (`job.py`, `detect.py`,
  `orchestrate.py`, `reconcile.py`, `recommend.py`, `kb.py`, `inventory.py`)
  is unchanged and takes it literally.
- **Creation verbs never walk up:** `config.py standup` and `registry.py
  register` take `--directory` literally, so a nested project can be stood
  up from inside the outer one. `register` keys by `--project-id`, else the
  tracked config's `project_id`, else the basename. Without `--project-id`,
  a directory already registered is re-affirmed under its existing key; with
  an explicit `--project-id` naming a different key it exits 2 (use or amend
  that entry instead); the registry schema is unchanged.
- **Re-pointing:** `registry.py amend --project-id ID --root DIR` re-points an
  existing identity's `root` (writer-gated onboard|activate; exit 2 unless DIR
  holds `.tk-studio/config.yaml` whose project identity (tracked
  `project_id`, else the folder name — the AD-20 rule) is ID, and exit 2 when
  another entry already holds DIR as its root). Additive, same 0.1.22 bump;
  the registry schema is unchanged.
- **Identity:** `project_id` is the tracked config's `project_id`, else the
  root's basename; the per-user store paths follow it
  (`~/.tk-studio/projects/<project_id>/`).
- **The studio root** keeps meaning the outer repository root, the plugin's
  home: `$TK_STUDIO_ROOT` when set, else the nearest ancestor-or-self of the
  project root holding `plugins/tk-studio/`, else none. It is never the
  plugin's own folder (a skills-dir install is not a checkout).
- `uv run "$PLUGIN_ROOT/lib/config.py" root [--directory DIR]` prints
  `{ok, project_root, studio_root, nested, project_id}`; `nested` is true
  when a strict ancestor of the project root also holds
  `.tk-studio/config.yaml`.
- a `.tk-studio/` that is the per-user store (`$TK_STUDIO_HOME` or
  `~/.tk-studio`) never marks a project root.

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

## 2. Skill invocation surface (v0.1.16)

Payload fields map 1:1 onto the named CLI's flags. "Artifacts out" lists
what a `complete` run reports in `artifacts[]`; every skill may instead end
`blocked` with the conditions listed (a cell may also name a condition that
ends `partial` rather than blocked — the row states which).

**The executing wrapper (0.1.18):** the executing wrapper for a run is
whichever conformant driver (§1 driver roster) executed its `invoke-skill`
directive — the one `wake` returns, or, for a one-shot skill-target job,
the one `submit` returns; `account` (budget counters every iteration) and
`finish` (the terminal transition, §4) are that wrapper's duty. A driver
that submits but never executes (Hermes) does not call the studio's
`submit` itself: it hands the job to the studio supervisor, which submits
and executes it, so every run has exactly one executing wrapper.

| Skill (intent) | Payload in | Deterministic core | Artifacts out | Blocked when (headless) |
| --- | --- | --- | --- | --- |
| `tk-studio-activate` | `directory`; `guided?` | `skills/tk-studio-activate/scripts/drift_check.py` | none (read-only; emits `drift-detection` event). The bmad-base plane also reports a declared base patch that is missing, stale or unverified at the pinned core as drift (0.1.17) | store/config unreadable |
| `tk-studio-install` | `directory`; `modules?` (subset); `dry_run?`; `timeout?` (s, default 900); `no_normalize?` (0.1.16) | `skills/tk-studio-install/scripts/install_base.py` | `_bmad/` install at the `bmad.lock` pin. After verify-at-pin passes, the reinstall's provably churn-only files are reverted to their committed copy and installer `*.bak` copies of committed files are dropped (0.1.16 — only when the project root is a git top-level with `_bmad/` tracked; paths dirty before the run are never touched; `no_normalize` keeps the raw upstream output). The result JSON `normalized` carries per-class counts and `remaining` (entries still differing from HEAD — 0 is a verified no-op against the committed tree), or `skipped` naming why it did not run. Before normalizing, the studio's declared base patches are re-applied (0.1.17): `base_patches` lists each patch's `id`, `target`, `status` and `upstream_issue`; a patch lands only on the exact upstream text and core versions it declares, never blind | installer failure, manifest≠pin after install, timeout |
| `tk-studio-base-update` | `core?` (version), `pin?` (`MODULE=TAG`, repeatable), `directory` (studio repo), `dry_run?`, `no_pr?` | `skills/tk-studio-base-update/scripts/` | bumped `bmad.lock`, integration branch/PR. The install diff commits only after the verify step reverts provably churn-only files (per-class revert counts in the result JSON `normalized`); real changes and unknown churn always show. A same-version re-affirmation whose install diff is empty after normalization ends `complete` reporting the verified no-op — no branch pushed, no PR opened | target missing from payload; install-at-new-pin failure |
| `tk-studio-detect` | `directory`; `out?` | `lib/inventory.py scan`, `lib/detect.py scan` | none unless `out` given (read-only) | project root unreadable; an `ask` outcome (`ambiguous — ask` / `unknown — ask` — the core exits 0, the ask is in-band) is a refusal to guess and ends `blocked` with the ask named in `reason` (§1: ambiguity never downgrades to `complete`) |
| `tk-studio-onboard` | `directory`; `vcs?`; `project_id?`; `role?`; `resources?` (explicit confirmed list) | `lib/{store,config,registry,kb,vault,recommend}.py` | `.tk-studio/config.yaml` (+local), registry entry, `kb/`, vault links; `working_set.<role>` only when `resources` present | `project_id` collision; classification refusal (AD-3); recording requested without explicit `resources` |
| `tk-studio-orchestrator` | `directory`; `role?`; `target?` (route to act on) | `lib/orchestrate.py resolve` | whatever the routed resource produces; none for resolve alone | `needs-onboarding` (missing role / unconfirmed `working_set.<role>`) — gap named in `reason` |
| `tk-studio-job` | verb (`submit\|status\|resolve\|cancel\|wake`); `directory`; `id`/`job_id`; `run_id?` | `lib/jobrun.py submit\|status\|resolve\|cancel\|wake` (plus `account`/`finish` for the executing wrapper) | run workspace `~/.tk-studio/projects/<key>/runs/<run-id>/`; `job-run` ledger events; `resolve` is read-only — declared jobs served fully resolved, no artifacts | unknown or invalid job id (a stop-condition refusal is `accepted: false`, an answer — not blocked; `resolve` of an unknown id is a named refusal) |
| `tk-studio-plan-sync` | `directory`; `backend?` (runtime override); `dry_run?`; `normalize_only?` | `lib/plansync.py sync|normalize` | normalized planning artifacts, backend projection (`backlog/` locally; Jira issues under the `jira` binding, AD-7); the result names every file the run wrote — `written[]` (counter, entity files, story-file stamps, projection writes with their canonical snapshot rewrites, index) plus `removed[]` (projection files replaced on rename), with `normalize.counter` naming the committed id counter; a projection-blocked run still names normalize's landed writes — commit staging derives from the response alone | duplicate id (blocks until renumbered, AD-4); `jira` binding preflight failure — missing `planning.jira.site`/`project_key`, missing `JIRA_EMAIL`/`JIRA_API_TOKEN`, 401/403 (token or org-admin toggle), or an issue-type scheme missing a default-mapping target — every gap named, never a silent 401 (AD-7/AD-11). A both-changed promote/pull-back conflict does **not** block: the run ends `partial` with each conflicted entity named in `reason` — a human picks a side by editing one file, then reruns sync (AD-5) |
| `tk-studio-migrate` | verb (`run\|status\|clear`); `directory`; `dry_run?` (run); `confirm?` (clear — the recorded operator clearance) | `lib/migrate.py run\|status\|clear` | closed inventory + migration record `.tk-studio/migrations/jira.json` (id map, hashes, verification, clearance state); Jira issues imported via the adapter; cutover flag (`planning.backend: jira` in tracked config) written last; source projection retained read-only | nothing to migrate; canonical export invalid; jira preflight failure (named, AD-7); **any verification mismatch** — counts, id map, content hashes, or spot round-trip — with each discrepancy listed (AD-16); cutover flag overridden by a local overlay; `clear` without `confirm` (no-delete-before-clearance) |
| `tk-studio-research` | `charter` (`{topics[], sources[], max_findings?, notes?}`); `directory`; `run_id?` (job runs) | `lib/research.py charter\|record\|seed\|spine` | `findings.json` + `findings.md` in the run workspace (a finding optionally cites a seed `anchor` — dangling citations are named rejections, per `knowledge.schema.json`); `seed.md` in the run workspace and the project spine `knowledge/spine.md` in the per-user store (aid, not gate — a missing spine is reported, never blocking; anchor ids append-only); `observation` ledger events for recommendation-carrying findings | charter missing/unscoped; run already terminal; invalid knowledge artifact (frontmatter, supersede header, anchor grammar — named rejection) |
| `tk-studio-session` | verb (`handoff\|resume`); `directory`; run selection: exactly one of `run_id` \| `job_id` (`job_id` resolves the job's sole resumable run — zero or several is a named refusal); handoff: `boundary` (`epic\|story\|phase`), `name`, `done[]`, `next[]`, `gotcha?[]`, `artifact?[]`, `delta?[]` (the `knowledge.schema.json` delta shape) | `lib/session.py handoff\|resume` | `handoff.json` in the run workspace — 16 KB budget, one per run, overwritten per boundary; a delta-carrying boundary also captures into the per-project reconciliation queue (best-effort — the handoff never fails on a capture problem); `resume` answers from the workspace alone | unknown or terminal run; ambiguous `job_id` resolution; handoff over the 16 KB budget or the 16-delta cap; dangling, unanchored, or within-handoff-duplicate deltas — named rejections (only the delta-carrying handoff refuses; the run stays resumable and a delta-free handoff always lands) |
| `tk-studio-knowledge` | verb (`check\|draft\|emit`); `directory`; draft: `base?`, `dry_run?`, `no_pr?`, `redraft?`; emit: `dry_run?` | `lib/promote.py check\|draft\|emit` | draft: ONE new dated `kb/reconciliation-<date>.md` on the stable branch `knowledge/<user>-<machine>` + the membrane PR (review is the gate — never a base push, never a merge, nothing auto-applies; D3/AD-12) and a draft line in the per-user promotions record; emit: one `knowledge-promotion` ledger event per batch of newly-merged drafts (at the skill's cadence, one per merged promotion PR), sole emitter this surface, reconciled against the promotions record — exactly-once per draft, never a duplicate (a draft emits nothing) | no routing doc (named rejection — the routing doc is the human's promotion-decision surface); not a git work tree; dirty tree; diverged promotion branch; detached HEAD; sanitization finding (NFR5, blocks pre-commit) |
| `tk-studio-consolidate` | `directory` (studio repo root); `dry_run?` | `lib/consolidate.py run` | `issues/ledger.md` synced in place (stable `ISS-NNN` rows: severity, status, expected-vs-actual, named evidence events, fix candidates — never a deleted row); no ledger events (derives, not emits — AD-12) | directory missing; measurements outside the studio repo (AD-3); unparseable issues ledger (refuses to rewrite what it cannot update in place) |
| `tk-studio-measure-push` | `directory` (studio repo root); `base?`; `dry_run?`; `no_pr?` | `lib/measurepush.py check\|push` | feature branch `measurements/<user>-<machine>` + membrane PR updating `measurements/<user>-<machine>.jsonl` — no ledger events (a mover, not an emitter, AD-12); never a base-branch push, never a merge | not the studio repo root; dirty working tree; sanitization re-check finding (credential-shaped content blocks pre-commit) |
| `tk-studio-observe` | `source` (`retrospective\|repeated-manual-work\|research-job\|other`); `description`; `evidence?`; `project?` | `lib/observe.py record` | ledger line (`observation` event) | required field missing |
| `tk-studio-evolve` | verb (`draft\|status`); `directory` (studio repo root); `dry_run?` (draft) | `lib/evolve.py draft\|status` | `proposals/ledger.md` synced in place (stable `PROP-NNN` rows: impact, status `Draft\|Under-review\|Adopted\|Declined`, evidence naming events and issues-ledger cross-links, the candidate change the observation itself states — never one invented, never a deleted row); drafting triggers nothing beyond the ledger sync — documents only, adoption is human (D1/AD-8); no ledger events (derives, not emits — AD-12, D2); a run that leaves `stranded` rows (a cluster merge) ends `partial` with the ids in `reason` | directory missing; measurements outside the studio repo (AD-3); unparseable proposals ledger (refuses to rewrite what it cannot update in place) |
| `tk-studio-report` | `description`; `surface?`; `project?`; `skill?`; `mode` | `skills/tk-studio-report/scripts/` | ledger line (`report` event) | `description` missing |
| `tk-studio-launch` | verb (`start\|status\|stop`, default `start`); `directory` (the main checkout); start: `epic` or `spec_folder?` (default `_bmad-output/specs/spec-epic-<N>` — the core's `--epic` applies the same default; `--spec` wins when both are given), `story?` (first story, `<epic>-<story>`; the skill derives it from the epic context / epics file when absent — never the core), `bootstrap?` (default true; skill-level only), `allow_budget_mismatch?` (0.1.21; default false — the core's `--allow-budget-mismatch`); status/stop: `run_id?`; stop: `graceful?` | `lib/launch.py check\|start\|status\|stop`; `lib/pipeline.py defaults\|check\|resolve\|apply` (0.1.15 — the per-leg route, §5) | start: the routed policy block, subagent-model line and `.bmad-loop/routing.current.json` (`pipeline.py apply`, 0.1.15), the substrate run dir `.bmad-loop/runs/<run-id>/` (engine detached, console-less; its output in the per-user store `projects/<key>/launches/<run-id>.log`), plus any `SPEC.md` (via the project's `bmad-spec`) and `plans/<epic>-<story>.md` + `stories.yaml` entries (via the project's `.bmad-loop/plugins/studio-pipeline/task-planning.md`) the planner-tier preparation wrote; `status` is read-only (live runs, per-task phase/attempt/cycle, pause facts, tokens); no ledger events of its own — the `run-epic` job wrapper emits `job-run` (AD-12) (0.1.21) **bootstrap commit:** files the bootstrap wrote are committed on the checkout's current branch in one commit (that branch is the run branch — `loop/epic-<N>` by convention; its name is never checked or switched), message exactly `loop(epic-<N>): SPEC, manifest and first-story plan from the launch bootstrap`, after the task bootstrap and before the readiness check — only those files, none on a relaunch, never pushed. **Every path ends with the block:** each `launch.py` result (`check`, `start`, `status`, `stop`, and the exit-2 refusal `{ok: false, error, …}`) ends with `status, intent, artifacts, reason`; `check` is `complete`, `partial` naming each `budget_mismatch`, or `blocked` naming its gaps; `start` is `complete` with `artifacts` = [`run_dir`, `spec_folder`] (never `run_dir_abs` or the store log) or `blocked`; a relaunch (stories already `done`, route already applied) ends on the same block as a fresh launch; the watch hint names the supervisor's status page, the `status` verb and `bmad-loop tui`. **Budget check:** `check` and `start` carry `budget: {compared[], budget_mismatch[], not_compared[]}` — the largest band's `weighted_tokens` against `max_tokens_per_story` and `review_cycles_max` against `max_review_cycles`, each mismatch `{limit, policy, band, band_field, band_value}`; limits with no band field (`session_timeout_min`, `max_tokens_per_session`, `max_followup_reviews`) are `not_compared`, and so is a compared limit when any band carries its field with a non-numeric value (reason names the band and field, e.g. `band L weighted_tokens not a number`), and so is a compared limit the policy omits or gives a non-numeric value (reason `absent from policy` / `not a number in policy`); a missing or unparseable input is a named `budget` check entry; a mismatch is never a gap (`ok` unchanged); the `[limits]` of `.bmad-loop/policy.toml` are read only, never edited by the budget check or the launch core (the only launch write to that file is the routing step's managed block) | a readiness gap the session may not close: a live engine already owning the checkout (one engine per checkout — never stopped to make room), `bmad-loop` not on PATH, a failing `bmad-loop validate` (dirty tree, broken policy); with `bootstrap` false, a missing `SPEC.md` or empty manifest; the project's `bmad-spec` skill or task-planning instructions absent; a launch the engine never acknowledged (no `state.json` within the wait — pid and log named); a `budget_mismatch` at `start` without `allow_budget_mismatch` (exit 2, both numbers named); a `start` refusal after its readiness check that found a mismatch also carries the readiness `budget` object, before the block keys (other refusals keep `{ok: false, error}` + the block) |

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
| `submit` | the id of a shipped/project job instance (id-only — the definition already lives at the `job.schema.json`-published locations; a full-definition submit form is not part of this surface. DW-1 fold-in, 0.1.7) | `{job_id, run_id, accepted: bool, reason?, starter_lock?}` (0.1.23) | schedule per the job's trigger on the bound substrate; validation rejects a definition missing guards or stop conditions |
| `status` | `{job_id, run_id?}` | `{job_id, runs: [{run_id, state: queued\|running\|complete\|partial\|blocked\|cancelled, status_block?, started?, ended?}]}` | read-only; run state lives in `~/.tk-studio/projects/<key>/runs/<run-id>/` |
| `resolve` | `{job_id?}` (0.1.12) | one entry — `{job_id, source: instance\|type, extends?, path, problems[], resolved}` with `resolved` the merged definition — or, with no `job_id`, `{jobs: [entry...], problems[]}` covering every declared job in config order | read-only. Type extension (an instance extending a shipped type) is applied **studio-side by the one resolver** — a driver classifies recurring work from the `trigger`/`cadence` served here and never merges or raw-reads `.tk-studio/jobs/<id>.json` (PROP-008: an instance inheriting trigger/cadence from its type read as trigger-less through the raw file). A declared job's problems ride its entry named in place — never silently dropped; an unknown id is a named refusal |
| `cancel` | `{job_id, run_id?}` | `{cancelled: bool, reason?}` | stop scheduling; a running run terminates `partial` with reason `cancelled` |
| `wake` | `{job_id}` | `{woken: bool, run_id?, reason?, starter_lock?}` (0.1.23) | fire a self-paced/loop job's next iteration now (the retired ClaudeOS mission-runner "tick" mapped here, historical) |
| `finish` | `{run_id, state, reason?, status_block?, total_cost_usd?}` (0.1.18; CLI `jobrun.py finish --directory DIR --run-id RID --state STATE [--reason R] [--status-block JSON] [--total-cost-usd USD]`) | `{run_id, state, reason, capture?}` | the executing wrapper's terminal-transition verb (§2). `state` is one of `complete\|partial\|blocked\|cancelled` (the run schema's terminal states; the CLI refuses any other); `partial`, `blocked` and `cancelled` require a `reason`, refused by name otherwise. `total_cost_usd` (ST-061) is optional — the worker's `--output-format json` cost — a non-negative, finite number recorded in `run.json`; absent when not given, never zero-filled; an invalid value is refused by name before anything is written (AD-3). On a terminal state the run is finalized (`capture`) and one `job-run` event is emitted, carrying `total_cost_usd` when recorded. One `job-run` event per terminal transition (AD-12) |

Guarantees a driver can rely on:

- Budget guards and stop conditions terminate a run `partial` with the
  guard named in `reason` — a job never runs away (AD-10).
- Local harness schedules are session-scoped; a job declared
  durable-recurring records that requirement and the binding **surfaces the
  constraint** (cloud routine or external harness needed) instead of
  silently losing the schedule.
- Job-level events are emitted by the job wrapper alone; a skill emits its
  own surface events — never both for one failure (AD-12).
- Substrate-side discovery reads declared jobs through `resolve` (0.1.12):
  a raw instance file may legitimately omit `trigger`/`cadence` (type
  inheritance) and is not a driver surface — classifying from it silently
  skips inheriting jobs (PROP-008).
- **Run-finish capture (0.1.7):** the executing wrapper's every terminal
  transition (`finish`, `cancel`, core close) captures the run handoff's
  `deltas[]` into the per-project reconciliation queue
  (`~/.tk-studio/projects/<key>/knowledge/reconciliation-queue.jsonl`,
  deduped per `knowledge.schema.json`). Boundary handoffs capture too
  (`tk-studio-session`), so both hooks are idempotent by the dedupe key; a
  capture problem never fails the run — no new driver verb is required,
  capture rides `finish`.

### Starter lock (0.1.23, Story 28.6)

The studio supervisor (Epic 27) writes an advisory starter lock per project
its queue serves, `~/.tk-studio/projects/<key>/starter.lock` (the run
records' key; `TK_STUDIO_HOME` honoured) = `{starter, checkout, since,
supervisor_pid}` with `starter` = `tk-studio-supervisor queue` — the queue
is the only starter of runs on that checkout. `submit` and `wake` honour it:

- **Judged after every other refusal, before anything is minted.** A
  definition problem, `wake` on a one-shot or a stop condition answers as
  before; only then is the lock read, and a refusal mints nothing (no run
  record, no `job-run` event, no directive).
- **Matching lock.** `starter` is the queue's and `checkout` equals the
  project root as canonical absolute paths (case-folded on Windows). An
  unreadable or malformed lock (bad JSON; a missing `starter`, `checkout`
  or `supervisor_pid`; a pid that is not a positive integer; an unparsable
  `since`), a foreign `starter` or another checkout is **no lock** — it
  never refuses.
- **Live** when `supervisor_pid` is a running process on this host (POSIX
  `kill(pid, 0)`; Windows `OpenProcess` + `GetExitCodeProcess` =
  `STILL_ACTIVE`, never a signal) **or** `since` is less than
  `STARTER_LOCK_STALE_S` (900 s) old; otherwise **stale**. The supervisor
  rewrites every served project's lock from `serve` every 60 s with a fresh
  `since`, so the lock is live while it is up and goes stale within 900 s of
  it going down. `since` is therefore a heartbeat, not the queue's start
  time: only that refresh stamps it fresh, while the supervisor's per-tick
  and per-claim rewrites keep the previous `since`.
- **`StarterLocked` refusal.** Under a live lock, without an override,
  `submit` answers `{job_id, run_id: null, accepted: false, reason}` and
  `wake` answers `{woken: false, run_id: null, reason}`, the reason being
  `StarterLocked: tk-studio-supervisor's queue is the only starter on this
  checkout (since <since>, supervisor pid <pid>) — submit the job to the
  supervisor (POST /jobs or bun src/cli.ts submit)`. A refusal is an answer
  (exit 0). The MCP `tk_job` surface calls the same verbs and inherits it.
- **Override.** The `--force-starter` flag (on `submit` and `wake` only) or
  the `TK_STUDIO_IGNORE_STARTER_LOCK` variable set exactly to `1` mints as
  before. The supervisor passes `--force-starter` on the verbs it runs for
  a claimed run; a forced hand start is recorded `external` by the queue.
- **`starter_lock` answer field** (optional): `"forced"` when a live lock was
  overridden, `"stale"` when the matching lock is stale (forced or not);
  absent when there is no lock. The run record is unchanged.

### Status pull-back (0.1.21, Story 26.5)

A driver never writes canonical frontmatter itself (AD-4, AD-5). When a run
lands a story — in this repository or in another one that holds a transcribed
epic — the driver tells the owning project's planning adapter:

```
uv run lib/plansync.py status --directory ROOT --id ST-NNN --status ENUM [--note TEXT] [--caller NAME] [--dry-run]
```

- **Status-class only, AD-5.** The verb writes the story's `status`, stamps
  `updated`, and replaces the entity's `external.driver` snapshot whole;
  every other key and every other `external.<name>` entry (`jira`,
  `backlog-md`, …) is left as it was by the verb's own write.
- **Enum.** `ENUM` is the canonical closed enum of `interchange/shape.v1.json`:
  `draft`, `ready`, `in-progress`, `blocked`, `review`, `done`, `dropped`.
- **Snapshot.** `external.driver` = `{key, synced_at, content_hash, caller,
  status, note, previous_status}`: `key` and `caller` are the caller
  (`--caller`, default `tk-studio-plan-sync`), `synced_at` equals the
  `updated` the verb stamps (a projecting binding's promote may re-stamp
  `updated` during the re-sync), `content_hash` is the sha256 hex where
  `id`, `status` and `note` are each UTF-8 encoded and each followed by one
  NUL byte (the `backlogmd._content_hash` construction), `note` is `""`
  when absent, and
  `previous_status` is the story's status before the call. The verb always
  writes, even when the status is unchanged — each call is a driver event.
- **Refusals** (`{"ok": false, "error"}`, exit 2, nothing written):
  `status '<v>' is not in the canonical enum (draft, ready, in-progress,
  blocked, review, done, dropped)`; `unknown id <ID>: no canonical entity in
  <plan dir>` (also when the plan directory is absent); `<ID> is a <type>,
  not a story — status takes a story id`; `caller must be a non-empty
  string` (also when the caller is not a single line); `note must be a
  single line` (any line-break character `str.splitlines` breaks on — `\n`,
  `\r`, `\x0b`, `\x0c`, `\x1c`–`\x1e`, `\x85`, U+2028, U+2029); `status of <ID> is pinned to
  '<s>' by <sprint-status path> — update that file or remove the entry` when
  the project's `implementation-artifacts/sprint-status.yaml` maps the story
  to a different status (the re-sync would otherwise revert it); and
  `duplicate ids block sync until renumbered (AD-4): <errors>` when any id is
  duplicated under `_bmad-output` (checked before the entity write, as
  `normalize` does); and `<plan dir>/index.md exists but was not generated by
  plansync.py — refusing to overwrite; move or delete it and rerun` when a
  foreign `plan/index.md` is present (checked before the entity write, on
  dry and real runs alike).
- **Re-sync.** After the entity write the verb runs the existing `sync`
  as-is, so the binding's projection and `plan/index.md` follow. The result is
  `{ok, id, status, previous_status, caller, note, path, plan_dir, dry_run,
  sync, written, removed}`: `path` is the entity file, `sync` the sync result,
  `written` the entity file then sync's writes (deduped), `removed` sync's.
  A blocked sync (e.g. the jira preflight) returns `ok: false`,
  `blocked: true` and the sync `reason`, and `written` still names the landed
  entity write; so does a sync that raises an unexpected exception after
  the entity write (e.g. an `OSError`) — `blocked: true`, `reason` the error,
  `written` the entity file (the only write the verb can vouch for),
  `removed: []`, `sync: null`.
  When the re-sync's binding pull-back overwrites the status just set (a
  pending board edit while the canonical status equals the last-promoted
  one), the result is `ok: false`, `blocked: true`, `reason` `status of <ID>
  was reverted to '<s>' by the re-sync (<binding> pull-back) — resolve the
  board edit and call again`, with `written`, `removed` and `sync` still
  reported. `--dry-run` writes nothing
  and names what it would write: the entity, `plan/index.md` when the
  status changes and the sync is not blocked, and sync's dry-run list computed over the on-disk state (projection files whose
  content depends only on the new status may not be listed).
- **`plan_dir`.** Only `--directory` is touched: a story a loop landed in
  another repository is found by its canonical id in the owning project's
  plan, nothing in the other repository changes, and `plan_dir` names the
  plan the verb wrote.
- **Consumer.** Epic 27's studio supervisor calls it — `review` when a run
  opens its PR, `done` when the PR merges.

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

### 5.1 Execution-pipeline legs (0.1.15)

The execution substrate (bmad-loop) is routed per **leg** of a story rather
than per resource: `session`, `implementer`, `reviewers`, `consult`, `seam`,
`review`, `triage`, `supervise`, `planner`. The launch resource ships
measured defaults for every leg in its `customize.toml` `[pipeline.legs]`
(plus the consult policy in `[pipeline.consult]`); the same three tiers
apply per leg and field, first hit wins:

- **runtime** — `--set <leg>.<field>=<value>` on `lib/pipeline.py`
- **project** — `<root>/.bmad-loop/routing.toml`: `[stories."<key>"]` >
  the first matching `[[rules]]` (`fnmatch` on the story key) > `[defaults]`
- **resource default** — the shipped `[pipeline.legs]`

```bash
uv run "$PLUGIN_ROOT/lib/pipeline.py" defaults
uv run "$PLUGIN_ROOT/lib/pipeline.py" check   --directory <root>
uv run "$PLUGIN_ROOT/lib/pipeline.py" resolve --directory <root> [--story <key>] [--set leg.field=value ...]
uv run "$PLUGIN_ROOT/lib/pipeline.py" apply   --directory <root> --story <key> [--set ...] [--dry-run]
```

`resolve` answers `{ok, story, matched_rule, story_override, route{leg:{model,
effort?, ...}}, sources{leg:{field: tier}}, consult_policy, consult_source}`
with the winning tier named per field. `apply` writes exactly three
things — the managed block at the end of `.bmad-loop/policy.toml`
(`[adapter.dev|review|triage]` model + `--effort`), `CLAUDE_CODE_SUBAGENT_MODEL`
in `.bmad-loop/profiles/claude.toml` when that tracked profile exists, and
`.bmad-loop/routing.current.json` (every leg + the consult policy, read by
the dev session to pass `model:` explicitly per subagent) — and reports
`writes{policy, profile, current}` as `written|unchanged|skipped (…)` plus
`unignored[]`, the written files the project has not gitignored. A missing
policy, an invalid routing table, an unknown leg, model or effort is a
refusal (`ok: false`, exit 2); nothing is invented. Model ids and effort
levels are validated against a closed set; a subagent leg is never routed
onto the planner tier by the shipped defaults.

**Advisor (0.1.21, Story 26.3).** Every leg takes an optional `advisor`
field: `opus`, `fable` or `off`, and a missing field means `off`. The
pairing rule: the advisor must rank at or above the leg's model, where
`claude-fable-5-1` and `fable` rank 3, `claude-opus-5-5`, `claude-opus-5`
and `opus` rank 2, and every other model ranks 1; `off` is never ranked.
`check`, `resolve` and `apply` validate it per table, `resolve` (and so
`apply`) again on the overlaid route, and `check` on the defaults-only
effective route (resource legs overlaid by the project `[defaults]`, into
`problems[]`). A violation is the named refusal `<where>.<leg>: advisor
'<a>' ranks below model '<m>' (the advisor must rank at or above the leg's
model)`. `apply` writes `advisor` into `routing.current.json` with every
leg, and the managed policy block adds `"--advisor", "<value>"` to an
engine-stage leg's `extra_args` (after `--effort`, when present) only when
that leg's advisor is not `off`. In `resolve`, a subagent leg (`implementer`,
`reviewers`, `consult`) that resolves no `effort` takes the session's,
source `inherited-session`, so the session passes `model`, `effort` and the
advisor explicitly on every launch. The advisor on a subagent leg is steering,
not a switch: the harness applies the session's configured advisor to
subagents, and a subagent leg's advisor reaches the subagent only as its
prompt's `Advisor:` first line. The shipped defaults keep `advisor = "off"` on
every leg (AD-14).

## 6. Drift-check invocation

The AD-13 activation check — four-plane (bmad-base; plugin, read from the
skills-dir folder against the roster; store; vault), loud, read-only (DW-3
wording fold-in, 0.1.7; folder-and-roster rule, 0.1.19):

```bash
uv run "$PLUGIN_ROOT/skills/tk-studio-activate/scripts/drift_check.py" --directory <project-root> [--guided] [--channel stable|latest] [--claude-home <dir>]
```

Output (stdout JSON): `{ok, result: "clean"|"drift", planes: [{plane:
"bmad-base"|"plugin"|"store"|"vault", status, detail, fix?, case?}],
fixes: [...], project_root?, studio_root?, nested?, project_id?}` —
`case?` on the plugin plane only. The four optional roots keys (0.1.22) name
the nearest project root `--directory` resolved to (§1 [Project
root](#project-root-0122)), the studio root (`null` when unresolved),
whether the project is nested, and its `project_id`.
The check never mutates; fixes are guidance (`tk install`,
`tk-studio update`, `tk-studio install`), applied only by an operator or an
explicitly invoked skill. Each run emits a `drift-detection` measurement
event (taxonomy §`drift-detection`); `--guided` marks the onboarding-funnel
variant. A driver SHOULD run it at session/connector start and surface
`fixes[]` verbatim.

**The plugin plane's folder-and-roster rule (0.1.19, AD-21).** The plugin is
the installer-written skills-dir folder `<home>/skills/tk-studio/`, where
`<home>` is `--claude-home`, else `CLAUDE_CONFIG_DIR`, else `~/.claude`; a
live link or junction counts as the folder, a dangling one does not, and the
installer's siblings (`.tk-studio.new`, `.tk-studio.previous`,
`.tk-studio.retired`) are never the plugin. The plane reads the folder's
`.claude-plugin/plugin.json` version and compares it with the configured
channel's roster `plugin` entry — `--channel` (default `stable`, the
installer's default) selects the project's
`tools/installer/rosters/<channel>.json`, never the network — and, only in a
developer checkout (`<project-root>/.claude-plugin/marketplace.json`
present with a `tk-studio` entry), with that entry. A catalog that lists no
`tk-studio` entry is another project's own marketplace, not a developer
checkout: the catalog comparison is skipped, never `error`. With no roster
in the project the version comparison is "not checkable from this project"
(ok); a
roster without a `plugin` entry means not shipped in that channel, never
stale. The plugin plane carries an additive `case` field naming one of:

| `case` | Means | `status` | Fix |
| --- | --- | --- | --- |
| `ok` | the folder is present, at the roster (and catalog) version, unshadowed | `ok` | — |
| `stale` | the folder version differs from the roster's `tk-studio--vX.Y.Z` tag or the developer catalog | `drift` | `tk-studio update` (`--channel <channel>` added when `--channel` is not the default `stable`) |
| `missing` | no folder, a dangling link, or a folder with no `.claude-plugin/plugin.json`; the detail names an installer sibling found | `missing` | `tk-studio install` |
| `shadowed` | a marketplace copy is installed beside the folder | `drift` | `claude plugin uninstall tk-studio@<m> --scope user` per copy, plus `claude plugin marketplace remove tk-studio` when the marketplace is known |

When several apply, precedence is `missing` > `shadowed` > `stale` > `ok`,
and the detail names every condition found. `installed_plugins.json` is
never the source of the version or of loadability: it is read, with
`known_marketplaces.json` and `<home>/settings.json`
(`enabledPlugins`, `extraKnownMarketplaces`), only to detect a shadowing
copy — the user-scope `tk-studio@<m>` records the installer's cleanup
removes, never `tk-studio@skills-dir`. An unreadable folder `plugin.json`,
record file or marketplace catalog (one that is not a JSON object with a
`plugins` list, or whose `tk-studio` entry carries no string `version`,
included) makes the plane `error`, naming the file (no `case`). `case` is the folder-and-roster verdict alone: the release
guards (`released-roster.json`, the installer roster shape and gate ×4) fold
into the same plane's `status` and `detail` and can raise `status` without
changing `case`; a plane whose `status` is `error` carries no `case`.

## 7. Driver integration dossier coverage (A7 — the retired ClaudeOS dossier)

Every item of the A7 integration dossier (written for ClaudeOS, now retired
as a driver — its names below are historical), covered or deferred with a
named seam; the consumers today are the §1 driver roster:

| # | Dossier item | Disposition |
| --- | --- | --- |
| 1 | Ownership: each driver (the studio supervisor, Hermes) lives outside the plugin; tk-studio never imports a driver | **Covered** — AD-2 boundary; this contract is the entire interface |
| 2 | The driver contract surface: per-skill headless invocation, status schema, job/scheduler model, model/effort API, drift-check | **Covered** — §2, §3, §4, §5, §6 |
| 3 | Reference-harness role (named for the retired ClaudeOS mission runner, historical): mission runner is the conformance target; direct headless invocation until then | **Covered** — §1 (direct invocation is a conforming driver); suite in `conformance/` (ST-5.4) |
| 4 | Driver mechanics to bridge (named for the retired ClaudeOS runner, historical): mission tick ↔ `wake` (§4); missions.json ↔ job definitions (`job.schema.json`, ST-6.1 seam); handoff protocol ↔ resumable run workspaces (`~/.tk-studio/projects/<key>/runs/`); auth preflight (§1); runner sharp edges (e.g. dirty-tree silent-skip) stay connector-side | **Covered** (0.1.7) — mappings named; the Research→Knowledge Lifecycle port (spine Deferred list: runner-side halves move council-side behind this contract, then with ClaudeOS as first driver — retired; the executing wrapper is now whichever conformant driver executed the run's `wake`, §2), deferred through 0.1.6, landed story-by-story as Epic 9 and is published here at 0.1.7 (ST-9.6): the session surface (`tk-studio-session` §2 row — handoff/resume with `deltas[]` per `knowledge.schema.json`), the research anchor surface (changed `tk-studio-research` §2 row — `research.py seed\|spine`, findings optionally citing seed anchors), run-finish capture riding the wrapper's terminal transitions (§4 note — no new verb), the KB-injection directive (§4 — spine/seed paths named on `invoke-skill` directives, the injection act driver-side per AD-2), and the promotion gate (`tk-studio-knowledge` §2 row — drafts behind the membrane PR; `emit` the sole `knowledge-promotion` emitter, exactly once per merged promotion PR, reconciled against the promotions record) |
| 5 | O8 linkage: generalized runner lands council-side, the studio supervisor its executing driver (ClaudeOS, named first driver before 0.1.18, retired) | **Covered** — AD-10 hybrid ruled; §4 is the substrate-neutral surface the runner binds to |
| 6 | The studio supervisor (status page), the studio web (EP-30, reading the supervisor's own surfaces, §1) and Hermes (front door) are the consumers that carry UI; the studio grows no UI | **Covered** — this contract exposes machine-readable status only (status blocks, verbs, registry/ledger schemas); dashboards read, studio serves |

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

The suite also carries an opt-in **harness pass** (EP-014, 0.1.11):
manifest drives declared `expect: harness-blocked` run the surface through
the real harness (`claude -p <prompt>`, with the drive's `settings`
profile denying the deterministic core's tool calls) and the transcript
must end in a schema-valid terminal status block — `blocked`, intent
naming the surface, the reason naming the unrunnable core, the declared
marker (if any) inside that reason. A question with no block, free text,
a `complete` block under denial, or a hang past the bound each fail with
the gap named — the PROP-005 live-failure shape is exactly what this pass
catches. Harness drives are spend-bearing and never run in the default
pass: `runner.py run --harness` opts in, each unrun drive is reported as
a named skip, and the report's top-level `harness_pass` field names
`{declared, state}` (`none declared` / `skipped: --harness not given` /
`ran` / `not run: the skills-dir folder is not harness-loadable` — under
`--from-archive`, when the extracted folder fails harness-loadable and no
surface is driven) — never a silent cap. The child runs against an isolated
throwaway store (`TK_STUDIO_HOME`), wall-clock bounded by the harness
timeout (per-drive `timeout` overrides it; the CLI `--timeout` governs
core drives only). A missing claude CLI fails the drive loud — a named
failure, never a crash. The shipped manifest declares one such case:
`tk-studio-detect` under a profile denying `Bash` and `PowerShell`
(`fixtures/harness-deny-core.settings.json`), proven live 2026-08-09.

The suite cannot pass against the repository tree for the wrong reason
(0.1.19, AD-21): `runner.py run --from-archive <zip>` safe-extracts the
built plugin zip into `<tmp>/config/skills/tk-studio/` — refusing any
absolute or `..` member by name, and turning any unreadable, encrypted
or unsupported-compression archive into an error naming it (exit 2,
`{ok: false, error}`) — sets
`CLAUDE_CONFIG_DIR=<tmp>/config` in every drive's environment, discovers
the surfaces, the manifest, the drive scripts and the status-block schema
from that folder (an archive shipping no `contracts/status-block.schema.json`
is an error naming it, never judged against the repository copy), and
runs harness drives from a cwd outside the repository. The archive
config carries only a symlinked `.credentials.json` — linked, for harness
drives, from the operator's config dir (`CLAUDE_CONFIG_DIR`, else
`~/.claude`) when one exists there, never copied (NFR5); without it a
harness drive runs and fails as `Not logged in`. A suite-level
`harness-loadable` check reads the folder's `.claude-plugin/plugin.json`
(name `tk-studio` and a version) and a `skills/` tree at the folder root —
judged before any surface is driven, so a wrapped zip is this named failure
with no surface driven, never a "skills tree missing" exit 2 — and requires
the folder's skills set to equal the surfaces discovered; a failure is a
named entry in `failures[]`.
The report's top-level `harness_loadable` field is `{state, folder?,
version?}` — `ok`, `failed`, or, without the flag,
`skipped: --from-archive not given`: a named skip, never a pass, and a
default run never falls back to the repository tree for it.

The suite also drives the meta-CLI (0.1.20, ST-085), which is not a skill:
the manifest's `cli_drives` section — outside `surfaces`, so surface
discovery is unchanged — declares drives `{assertion, cli, module, argv,
intent, expect}`, `{repo}` in `argv` substituting the checkout root. The
CLI is located from the runner's repository checkout
(`tools/installer/cli`), never the plugin tree. The CLI doctor drive runs
`python -m tk_studio_cli doctor --json --roster
<repo>/tools/installer/rosters/latest.json` with `TK_STUDIO_HOME`,
`CLAUDE_CONFIG_DIR`, `XDG_DATA_HOME`, `LOCALAPPDATA`, `APPDATA` and `HOME`
in a throwaway directory, `TK_SUPERVISOR_*` stripped, the inherited
`PYTHONPATH` replaced by the checkout's CLI path, and a PATH holding no
`claude`, `sbx` or `git`. The isolation covers environment variables and
home directories only: on Windows the CLI still reads the real HKCU
user-environment store and HKLM `LongPathsEnabled`, so the drive asserts
only the output's shape and terminal status, never a host-dependent check
verdict. `expect: status-block` asserts stdout is exactly one JSON object
whose last keys are `status, intent, artifacts, reason`, that projection
validates against `status-block.schema.json` with the declared intent, and
that the CLI exited 0 with `status` `complete`. A failure is a named entry
in `failures[]` (surface `tk-studio-cli`). The report's top-level
`cli_drives` field lists each drive's `{assertion, ok, detail}`, plus an
optional `state`; when the checkout's CLI is absent (a runner outside a
repository checkout) the drive does not run and is recorded `not run` with
a reason — `{assertion, ok: true, state: "not run", detail}` — never a
failure, never a silent pass.

Surface drives may declare `expect: status-block` too (0.1.21, Story
26.1), judged by the same check: stdout is exactly one JSON object whose
last keys are `status, intent, artifacts, reason`, whose projection
validates against `status-block.schema.json` with the drive's `intent`
(default: the surface name). A drive may declare `status` (the expected
block status); without it any schema-valid status passes. A drive may
declare a `marker` too: stdout must then name it, proving the drive
reached the state it targets. Either way the
core must exit 0 (an answer) or 2 (a refusal) — exit 1 is an unexpected
failure. The shipped manifest declares two such `tk-studio-launch` drives:
fresh (`launch.py check` on a missing spec folder, declared `blocked`)
and relaunch (`launch.py check` on `fixtures/launch-relaunch/` — SPEC,
a two-entry manifest, a `done` story and an applied route; status
undeclared, since it depends on whether the drive box has `bmad-loop`;
marker `2 entries`, named only once the fixture's two-entry manifest
resolved and was counted — absent when the spec folder or `stories.yaml`
is missing).
