---
title: 'technical research: what fires a job by the clock, how a model is pinned per job, and the bounds of a nightly hygiene pass'
type: 'technical + select'
topic: 'the nightly hygiene pass: the timer the supervisor lacks, the model and effort pins, the prior art for a bounded maintenance run, the shape of the pass'
decision: 'Epic 41: what the supervisor must gain to start a declared timed job, what "use Fable 5.2 for it" changes for the runs that build the epic and for the pass itself, and how a nightly consolidation run stays bounded, off the checkout of a live run, and visible.'
source: 'native run: one read-only pass over the repository at 97ce4051 in a worktree; the ledger entries DW-86, DW-179 and DW-211; the tickets TKSTUDIO-219, TKSTUDIO-260 and TKSTUDIO-262 as quoted in the ledger and the runbook; no web source'
status: complete
preset: 'light'
validation: 'normal for the repository claims (each carries file and line at 97ce4051); no external claim is made; what was not verified is listed in §6'
claims: { repository: 46, external: 0, unconfirmed: 6 }
created: '2026-11-09'
updated: '2026-11-09'
---

# Research: what fires a job by the clock, how a model is pinned per job, and the bounds of a nightly hygiene pass

**Decision this research serves:** Epic 41, the nightly hygiene ("dreaming") pass, on Tim's decisions on DW-86 (TKSTUDIO-219, 2026-11-05) and DW-179 (TKSTUDIO-260, 2026-11-09: "A - Let's plan for it to be epic 41. Also let's plan on using Fable 5.2 for it").

Every claim about the studio names its file and line at `97ce4051`. This pass read no web page (it ran with no network beyond `git` and `gh` against this repository), so it states no external fact; the one the plan needs, the list price of Fable 5.2, is a question for the owner.

## 1. Executive summary

- **Nothing in the studio owns a clock.** A job's cadence resolves to a directive for "the substrate" to bind, and the supervisor binds only one kind: self-paced loops. A declared `cron` job runs when someone posts it and at no other time (hole 126). The hourly sync-back the owner chose on TKSTUDIO-262 would never run by itself; the nightly pass would not either. So the epic's first story is the timer, and it is useful alone.
- **The timer is small because the queue already has the hard parts**: an idempotent mint, one lock per checkout, a drain that drives a queued run, one submit path, service events for refusals. What is missing is a cron evaluator (the repository has none; `job.py` only counts five fields), a place to remember the last instant fired, and the rules for a late pass and a busy checkout.
- **A per-job model pin exists, in two halves, and neither is new.** A job definition's own `model` and `effort` pin the worker session; a `[[rules]]` table in `.bmad-loop/routing.toml` pins the engine legs by story key. What does not exist is the model: `claude-fable-5-2` is in no list the studio accepts, has no price row, a job's `model` is not checked against any list, and the settings page Epic 39 builds shows only `[defaults]`.
- **The pass can be built from parts that exist.** `launch.py sweep` already starts a bounded engine run in the run's worktree with refusals; a one-story spec rendered from a ledger row puts a consolidation through the same build, review, gate, host leg and PR as any story, with its cost metered. The engine and the base do not change.
- **Biggest caveat:** the price of Fable 5.2 is in no record here. Every cost figure for Epic 41 and for a night is unknown until a sourced row exists; the plan refuses to guess one and holds the nights while the model is unpriced.

## 2. What fires a job today, and what does not

**The directive.** `plugins/tk-studio/lib/jobrun.py:10`: "Nothing here owns a clock". `jobrun.py:291` `_directive` answers `{"kind": "cron", "schedule": ...}` for `trigger: cron`, the interval for a fixed loop and `self-paced` for a dynamic one. `job.py:166-168` checks that a cron schedule has five fields and nothing more; `job.py:174` says `cadence.schedule` is cron-only. There is no cron parser anywhere in `plugins/` or `apps/`.

**The pacer.** `apps/supervisor/start.ps1:406-408` loops `bun src/tick.ts`, `bun src/cli.ts drain`, then sleeps `-IntervalSeconds` (60 by default, `:63`). `apps/supervisor/src/tick.ts:95` `declaredJobsFrom` enumerates each served project's declared jobs through the contract's `resolve`; `:302` skips every job that is not self-paced (`:111` `isSelfPaced`); `:138` `shouldWake` and `:202` `tickJob` pace the self-paced ones. `tick.ts:58` says it in words: "Cron and fixed-interval loop jobs are NOT ticked here".

**The jobs that carry a schedule.** Two shipped types: `plugins/tk-studio/jobs/atlassian-sync-back.json` (`*/10 * * * *`, 300 s) and `maintenance-conformance.json` (`0 6 * * 1-5`). tk-studio declares neither at `97ce4051`; the owner's `SYNC: A` (TKSTUDIO-262) declares the sync-back hourly at Story 39.2's landing, and `kb/agent-pc-setup-runbook.md` (hole 126's row) records that the declaration alone changes nothing and that a hand `post_job.py tk-studio atlassian-sync-back` at each landing stands in.

**What a timer can lean on.** `apps/supervisor/src/queue.ts:1163` `enqueue` mints nothing while a run of the same job and checkout is live, so a double fire cannot make two runs. `cli.ts:1025` `submitJob` is the one submit path (`POST /jobs` and the `submit` verb both use it; `api.ts:244` `SUBMIT_FIELDS`), so a timer that calls it gets the same validation, placement and stop conditions. `cli.ts:963` `drainQueue` drives ownerless queued runs in the same pass. `queue.ts:951` `pacing`, `:1761` `takeVerifyLeg` and `:1780` `verifyLegLive` give the busy signals; `:684`, `:2154` and `:2160` are the service events a refusal can be recorded in once per cause, as Story 33.2 does for claim refusals.

**What is missing.** A cron evaluator; a row per timed job that remembers the last instant fired (the queue file is the natural home: it is the supervisor's one store); a rule for a pass that comes late (the pass is synchronous: a worker session of up to 3600 s and a host verify leg of up to 7200 s run inside it, so a due instant can be seen hours late and several instants can pass unseen); a rule for a checkout that is busy; a mark on the run that says the schedule started it. Story 41.1 names each.

**A timezone is a choice.** The queue stamps UTC. A schedule read in UTC never meets a daylight-saving gap or a doubled hour. The plan reads schedules in UTC and has the README give the local hour; the owner may prefer local time.

## 3. How a model and an effort are chosen, and where `claude-fable-5-2` stands

**The worker session.** `jobrun.py:331` `_job_routing` calls `routing.resolve_routing` (`plugins/tk-studio/lib/routing.py:65`): the job definition's own `model` and `effort` (the runtime tier), then the project's config, then the skill's `customize.toml [model]`, then `STUDIO_FLOOR` (`routing.py:41`: `claude-sonnet-5`, `low`). `job.py:294-298` accepts any non-empty string as `model` and `low | medium | high` as `effort` (`job.py:78`). The supervisor's per-job config accepts `tier`, `permission_mode` and `sandbox` only (`apps/supervisor/src/config.ts:47`) and never chooses a model (AD-14).

**The engine legs.** `plugins/tk-studio/lib/pipeline.py:20-25`: a runtime `--set`, then `.bmad-loop/routing.toml` (`[stories."<key>"]`, then the first `[[rules]]` whose `match` fits the story key by `fnmatch`, `:286`, then `[defaults]`), then the shipped `customize.toml [pipeline.legs]`. `pipeline.py:89-90` `MODELS` lists five ids; `:169-170` refuses a route that names any other; `:97` `MODEL_RANK` ranks Fable 5.1 at 3 and the Opus models at 2 for the advisor pairing. `.bmad-loop/routing.toml` at `97ce4051` sets every leg to `claude-opus-5-5` under `[defaults]` and has no rule.

**So the pin exists.** For Epic 41's own stories (keys `41-<n>-<slug>`): one rule `match = "41-*"` for the legs and a `model` field on `.tk-studio/jobs/run-epic-41.json` for the launch session. For the pass (keys `hygiene-<nnn>`, Story 41.4): one rule `match = "hygiene-*"` and the job type's `model` and `effort` fields. Nothing new is needed to pin; four things are needed for the id to be usable and the pin to be honest:

| Gap | Where | Taken by |
| --- | --- | --- |
| `claude-fable-5-2` is not an accepted model, and has no rank | `pipeline.py:89-90`, `:97` | Story 41.2 |
| No price row, so the meter names the model as missing or reports `usd: null` | `plugins/tk-studio/lib/prices.json` (dated 2026-09-28); `meter.py:503-505`, `:882`, `:892` | Story 41.2, from the owner's sourced figure |
| A job's `model` is any non-empty string: a mistyped pin is found at spawn | `job.py:294-296` | Story 41.2 |
| The settings page (39.8) reads and writes `[defaults]` only, so a rule overrides what it shows | Epic 39's plan, `GET` and `PUT /settings/routing` | Story 41.2 (`rules[]`, read-only, in words) |

**The price.** `prices.json` names its `source`: the Claude API reference bundled with Claude Code (the `claude-api` skill). The copy bundled on this box on 2026-11-09 has no Fable 5.2 row. Fable 5.1 is 10 and 50 USD per million tokens in and out against 4 and 20 for Opus 5.5 (`prices.json`; `.bmad-loop/routing.toml:5-9`). If Fable 5.2 lists like 5.1, a story or a night costs about 2.5 times what the same tokens cost today; that is an "if", not a figure.

**Effort.** The studio's enum is `low | medium | high` in both places (`job.py:78`, `pipeline.py:91`). The plan leaves efforts as the route has them and does not widen the enum.

**The first run's distil.** DW-211: an epic's first run pays the whole SPEC distil in the launch session (Epic 39: 72.75 USD, 2.99 M tokens, 36 minutes), outside every band. Under the plan's default the first run (41.1) is on the route in force; under the alternative (a chore PR before the first POST) the distil is paid on Fable 5.2.

**The bands.** `.tk-studio/budget-bands.yaml` (S 4.5, M 8.5, L 13 USD) was measured on the route in force. A story built on a dearer model will read over its band on Epic 40's pages until the bands are measured again; Story 41.7 records the figures and leaves the bands to the owner.

## 4. Prior art in this repository

- **`maintenance-evals`** (`plugins/tk-studio/jobs/maintenance-evals.json`): the shape DW-179 names. Sandbox tier, `max_turns` 80, 3600 s, `stop.on_status: [blocked]`, one-shot.
- **`run-sweep` and `launch.py sweep`** (`launch.py:2036`; its block `:2166`): an engine run started detached in the run's worktree, with refusals (no policy, no ledger, a live engine, a dirty tree), ending as a PR. It copies the spawn-and-await block of `start` (`launch.py:1827`), which is itself a DW-86 class. The hygiene verb is this shape with a rendered one-story spec in place of a bundle.
- **The evolve loop** (`evolve.py`): observations become `PROP` rows; documents only, never applied by the loop. **The consolidate loop** (`consolidate.py`): measurements become `ISS` rows. **The knowledge promotion gate**: a draft on a branch behind a PR; only a human writes canonical. All three keep a ledger with states and put a person between the proposal and `main`. The hygiene ledger and "the pass never merges its own PR" follow them. None of them changes code, so none of them is the pass.
- **Story 36.7** (#319) took the first classes of DW-86 by hand and made the shared homes a later consolidation lands in: `plugins/tk-studio/lib/_core.py`, `lib/_proc.py`, `apps/supervisor/src/gitshow.ts`. The `status` line of DW-86 lists what it left: about twenty classes, from the installer's user-env copies to the four ISO-8601 parsers.
- **A name already taken.** `apps/supervisor/src/hygiene.ts` is Story 22.3's run hygiene (the snapshot, the end notification `:274`, the transcript copy), and Epics 36 to 38 were called "loop hygiene". The plan keeps the owner's word for the pass, names its Python module `hygiene.py` (no such file exists) and puts its supervisor code in a new `night.ts`.
- **ClaudeOS** has an older "Dream" task. It is out of scope by the owner's rule (TKSTUDIO-223): not read, not ported, not changed.

## 5. The pass's shape and its bounds

**The unit of work is one ledger row.** The list in DW-86 is a paragraph; a run needs rows with sites, callers, tests and a state. A deterministic `next` (state open, few sites, tests present, inside three roots, the DW-86 rows first) makes the night's choice a fact that can be read before the night, and a `skipped` row with its reason keeps the pass from trying an unsafe class every night.

**The run is a story.** Rendering a one-story spec from the row and starting the engine as `start` does puts the consolidation through the dev, review and gate legs, the host verify leg, the close-out PR and the meter with no new path. The acceptance criteria are fixed text: one class, one shared home, no public signature, CLI flag, JSON key, exit code or message changed, the callers' tests unchanged but for imports, or `skip` with a reason. A mechanical check (`hygiene.py check-diff`, run by `tools/verify_host.py` on a hygiene branch) fails a diff that strays from the row's files or passes the size of band S.

**The bounds, and where each lives.**

| Bound | Mechanism | Story |
| --- | --- | --- |
| Turns and wall clock | The job's guards: 80 turns, 3600 s of engine, 7200 s of host leg | 41.4 |
| Size | Band S through `check-diff`: at most 3 files plus the callers, 150 new lines | 41.3, 41.4 |
| One class, one PR a night | One row per run; `stop.while_pr_open` holds the next night while the last PR is open | 41.4, 41.5 |
| Spend | `stop.spend {window_days, usd_max}` from the queue's `accounted` events; an unpriced run counts as over | 41.5 |
| Never beside a live host leg, never against a live run | `cadence.on_busy: skip`: the night is skipped when the checkout's lock is held, a run is queued for it, or a host verify leg is live on the box | 41.1, 41.6 |
| Nothing silent | A PR with `## Hygiene`, or a `hygiene-night` event and one notifier line when there is no PR; no push to `main`; the pass never merges | 41.4, 41.5 |
| Cost visible | Epic 40's store takes hygiene runs as rows of their own source, outside the band medians | 41.6 |

**Spend arithmetic, as far as it goes.** Band S is 4.5 USD on today's route. At the ratio of Fable 5.1 to Opus 5.5 a night would be about 11 USD and seven nights about 80. The plan's shipped default ceiling is 60 USD in seven days, which would hold the pass after about five such nights; the figure is the owner's to set.

**What the first nights will find.** Several of the DW-86 rows will not be eligible under the default rules (TypeScript copies with one test file between them, classes with more than six sites). That is the rule working: they stay open with the reason `next` gives, and widening the rules is the owner's decision after the first weeks.

## 6. Choices made, caveats, and what this research does not settle

**Choices the plan makes, each a question on the plan's PR:**

1. "Using Fable 5.2 for it" is read as both the model that builds Epic 41 and the model the pass runs on. Default: from Story 41.3 on (41.1 and 41.2 on the route in force). Alternative: a chore PR before the first POST so all seven run on it.
2. Schedules are read in UTC.
3. A timed job waits when its checkout is busy (the sync-back) or skips (the pass). The hourly sync-back will therefore run late during a long story run; a lock exemption for it is not planned.
4. The pass never merges its own PR; the landing routine merges it on green like any other run's.
5. DW-86 closes into the hygiene ledger's rows at Story 41.3; DW-179 closes at the first night.
6. The ceilings: 60 USD in seven days, six sites, two tries a row.
7. No design addendum: the epic adds one read-only list to the settings page and words to two label maps.

**Not verified by this pass:**

- The list price of `claude-fable-5-2`, and that the sandbox's Claude Code accepts the id (this pass's own session ran on it, which shows the id exists, not that the sandbox's build takes it).
- The supervisor's per-job config on the agent PC (not read, by rule), so the placement steps are written as operator steps.
- How `atlassian-sync-back` is declared at Story 39.2's landing (39.2 had not landed at `97ce4051`), and hole 126's ledger id (minted with that landing's docs).
- Which run states hold the checkout's `run` lock while a detached engine works; Story 41.1 names the lock, whatever holds it.
- `run-epic-41.json` against `job.py validate` (not run; the file is the shape of `run-epic-40.json` with the epic number changed).
- No test suite was run; the plan's line numbers are as read at `97ce4051` and will move as Epics 39 and 40 land.

## 7. Staleness map

| Claim | Goes stale when |
| --- | --- |
| Line numbers in `tick.ts`, `queue.ts`, `cli.ts`, `api.ts`, `job.py`, `pipeline.py`, `launch.py` | Epics 39 and 40 land (both touch the supervisor and the lib) |
| "No price row for Fable 5.2" | The bundled API reference or the owner gives one |
| "The settings page writes `[defaults]` only" | Story 39.8 lands with a different shape |
| The columns of the `stories` and `changes` tables | Story 40.1 lands with a different shape |
| The remaining list in DW-86 | Any story consolidates a class by hand before 41.3 (41.3 re-reads the sites at its base) |
