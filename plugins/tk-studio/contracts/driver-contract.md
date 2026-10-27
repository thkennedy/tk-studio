# tk-studio Driver Contract

| | |
| --- | --- |
| **Contract version** | **0.1.29** (pre-1.0 semver — a new product still stabilizing; see [Change policy](#change-policy). Renumbered 2026-08-07 from the 1.x line, mapped `1.N.0 → 0.1.N` for continuity: 0.1.1 added the `tk-studio-job` surface and the shipped `job.schema.json`, 0.1.2 added `tk-studio-research`, 0.1.3 added `tk-studio-measure-push`, 0.1.4 added `tk-studio-consolidate`, 0.1.5 installed the `jira` planning binding behind `tk-studio-plan-sync`, 0.1.6 added `tk-studio-migrate`, 0.1.7 publishes the Research→Knowledge Lifecycle port (Epic 9): the `tk-studio-session` and `tk-studio-knowledge` surfaces, the research anchor/seed surface, the run-finish capture note, the KB-injection directive, and the `knowledge-promotion` taxonomy event — each additive; 0.1.8 clarifies §2 (the detect row's blocked cell names the in-band `ask` outcome as a refusal; the plan-sync row states both-changed conflicts end `partial`, not blocked) — a clarification, no shape change; 0.1.9 adds `tk-studio-evolve` (EP-010 — the evolve loop's drafting half: merged `observation` events become `proposals/ledger.md` `PROP-NNN` rows; D1 documents only, D2 derive-only with the taxonomy untouched, D3 on-demand verb plus the shipped-undeclared `evolve-proposals` job type) — additive; 0.1.10 clarifies the §2 base-update row (EP-011 ST-043: the install diff commits only after provably churn-only files are reverted, per-class counts in the result JSON `normalized`; a same-version re-affirmation whose diff is empty after normalization ends `complete` reporting the verified no-op — no branch pushed, no PR opened) — a clarification, no shape change; 0.1.11 adds the conformance harness pass (EP-014: `expect: harness-blocked` drives run the surface through the real harness under a denying permission profile and are judged to end in a `blocked` terminal block naming the unrunnable core; opt-in `--harness` because spend-bearing, the report's `harness_pass` field names declared/skipped/ran, and the denied-permissions case for `tk-studio-detect` ships declared) — additive; 0.1.12 adds the `resolve` scheduler verb (EP-015 — PROP-008's resolved-definition read surface: declared jobs served with type extension applied by the studio-side resolver; substrate-side recurring classification reads trigger/cadence from the verb, never from raw `.tk-studio/jobs/<id>.json` instance files) — additive; 0.1.13 adds named-write reporting to the planning adapter result (EP-017 — PROP-020's staging gap: `normalize.counter` names the committed id counter, and `written[]` — normalize-level and the sync-level roll-up over projection and index — names every file a run wrote, counter included, so commit staging derives from the response alone) — additive; 0.1.14 adds `tk-studio-launch` (studio pipeline decision 5, 2026-09-02: the studio's one way to start the execution substrate for a project epic — planner-tier SPEC + first-story task bootstrap, then bmad-loop started detached with a pre-minted run id — plus the shipped `run-epic` one-shot job type) — additive; 0.1.15 adds per-leg execution-pipeline routing to `tk-studio-launch` (§5: `lib/pipeline.py defaults\|check\|resolve\|apply`, the measured pipeline-v2 defaults shipped in the launch resource's `customize.toml` `[pipeline]`, the project overlay `.bmad-loop/routing.toml`, runtime `--set leg.field=value`; the launch flow routes the epic's first story before its readiness check) — additive; 0.1.16 adds the optional `no_normalize` payload to `tk-studio-install` and states its churn normalization (a verified install reverts provably churn-only files and drops installer `*.bak` copies of committed files when the project root is a git top-level with `_bmad/` tracked; paths dirty before the run are never touched; result JSON `normalized` with per-class counts and `remaining`) — additive; 0.1.17 adds studio-managed base patches (BMAD-METHOD#2718: `render_skill.py` halts on a short config token that several modules declare, even with identical values, so bmm + gds cannot render `bmad-build`/`bmad-build-auto`): `tk-studio-install` re-applies every patch declared in `base-patches/patches.json` after verify-at-pin and reports each in the result JSON `base_patches` (`patched`, `applied`, `not-applicable`, or `stale` / `unverified-core` when the upstream text or core version no longer matches — then the file is left untouched), and `tk-studio-activate` reports a missing or stale patch as bmad-base drift — additive; 0.1.18 names the conformant drivers now that ClaudeOS is retired as a driver (ST-062): a driver roster in §1 (the studio supervisor — executing wrapper, status page; Hermes — front door that submits jobs to the supervisor and never executes a run; direct invocation), §2 states the executing wrapper for a run is whichever conformant driver executed its `wake` directive with `account` and `finish` its duty, a §4 `finish` row documenting the optional `total_cost_usd` (ST-061), §1's cross-references corrected (per-skill CLIs in §2, the status block in §3), and the Audience line and §7 rows name the studio supervisor and Hermes in place of ClaudeOS — additive; 0.1.19 moves the drift check's plugin plane to the skills-dir folder and the roster (AD-21, ST-083): §6 states the folder-and-roster rule — the folder `<home>/skills/tk-studio/`'s `plugin.json` against the configured channel's roster `plugin` entry (`--channel`, default `stable`) and, only in a developer checkout, the catalog; the plane's additive `case` field (`ok`, `stale`, `missing`, `shadowed`) with each fix; `installed_plugins.json` read only to detect a shadowing marketplace copy — and §8 documents the conformance runner's `--from-archive <zip>` and the report's `harness_loadable` field — additive; 0.1.20 adds the conformance suite's meta-CLI drive (ST-085): §8 documents the manifest's `cli_drives` section, outside `surfaces`, and the report's top-level `cli_drives` field — the CLI doctor drive runs `tk-studio doctor --json` from the runner's repository checkout in a throwaway home, and is recorded `not run` with a reason when the checkout's CLI is absent — additive; 0.1.21 (Epic 26) states the `tk-studio-launch` row's launch-owns-its-lifetime rules (Story 26.1): every `lib/launch.py` result, refusals included, ends with the §3 block keys in order so every skill path, fresh or relaunch, ends on the core's block; the skill commits its own bootstrap output before its readiness check; `check` and `start` compare `.bmad-loop/policy.toml` limits read-only with `.tk-studio/budget-bands.yaml` (`budget`, `budget_mismatch[]`), `start` refusing a mismatch unless the optional `allow_budget_mismatch` payload acknowledges it — and §8's `expect: status-block` on surface drives, with an optional declared `status` — additive; 0.1.21 (Story 26.3) also gives every §5.1 routing leg an optional `advisor` (`opus` \| `fable` \| `off`, missing = `off`) under the pairing rule (the advisor must rank at or above the leg's model; a violation is a named refusal), carries `--advisor <value>` on an engine-stage leg's `claude -p` command line only when the advisor is not `off`, and gives subagent legs with no resolved effort the session's (`inherited-session`) — additive; 0.1.21 (Story 26.5) adds the planning adapter's status pull-back (§4 [Status pull-back](#status-pull-back-0121-story-265)): `plansync.py status --directory ROOT --id ST-NNN --status ENUM [--note TEXT] [--caller NAME] [--dry-run]` sets one canonical story's `status`, stamps `updated` and records the caller and note in the entity's `external.driver` snapshot, then re-runs `sync` so the projection and `plan/index.md` follow; status-class only (AD-5), the result's `plan_dir` names the plan it wrote — additive; 0.1.22 (Story 28.2) states the nearest-root rule (§1 [Project root](#project-root-0122)): the drift check, `config.py resolve` and `config.py root`, `plansync.py`, `jobrun.py`, `launch.py` and `observe.py`'s default `--project` resolve the nearest ancestor-or-self holding `.tk-studio/config.yaml` (every other `--directory` surface is unchanged), so a nested studio project (`apps/supervisor`) wins over the outer one and a folder with no config above resolves to itself; creation verbs (`config.py standup`, `registry.py register`) take `--directory` literally; `TK_STUDIO_ROOT` keeps meaning the outer repository root, the plugin's home; `config.py root` prints the resolution, and §6's drift-check JSON gains the optional top-level `project_root`, `studio_root`, `nested` and `project_id` — additive; 0.1.23 (Story 28.6) honours the studio supervisor's starter lock in §4 ([Starter lock](#starter-lock-0123-story-286)): `submit` and `wake` refuse with `StarterLocked` — nothing minted — while a live `~/.tk-studio/projects/<key>/starter.lock` names the queue as the checkout's only starter, the `--force-starter` flag and the `TK_STUDIO_IGNORE_STARTER_LOCK=1` variable override it, and the answer gains the optional `starter_lock` field (`forced` or `stale`) — additive; 0.1.24 (Story 29.4) names the studio web (EP-30) among the consumers in §1 — a consumer, not a driver: the Driver roster is unchanged — and documents the surfaces it reads as supervisor surfaces, never plugin surfaces (§1 [Supervisor surfaces the web consumes](#supervisor-surfaces-the-web-consumes-0124), AD-2): the account (`POST /auth/account`, `POST /auth/signin`), the registry (`GET /agents`) and the office projection (`GET /office`, `GET /office/events`, the event kinds `office.agent`, `office.progress` and `office.run`, the eight states); the plugin publishes their description and neither implements nor serves them, and nothing in the plugin's own surfaces changes — additive; 0.1.25 (Story 30.4) extends the office projection of §1 [Supervisor surfaces the web consumes](#supervisor-surfaces-the-web-consumes-0124) additively: an agent row and the `office.agent` delta carry `reason` (what a `waiting-for-human` or `blocked` agent waits for, `null` otherwise), and the `GET /office` snapshot carries `last_run` (each project's newest terminal run `{run_id, state, pr, ended_at}`), which the `office.run` delta of a run leaving the live set terminal carries too, and a project's changed `last_run` with no leaving run gets an `office.run` with `from` `null`; existing fields, kinds and ids are unchanged; Story 30.5 adds `GET /board` to this same 0.1.25 entry; supervisor surfaces, never plugin surfaces, and nothing in the plugin's own surfaces changes — additive; 0.1.25 (Story 30.5) adds the board read `GET /board?project=<id>` to §1 [Supervisor surfaces the web consumes](#supervisor-surfaces-the-web-consumes-0124): a served project's plan epics and stories with their canonical statuses, each story's latest run and open deferred-work findings, per epic the metered `job-run` spend against an optional band, and the Needs-you / Working / Done triage of its runs; no second version bump, a supervisor surface, never a plugin surface — additive; 0.1.25 (Story 30.6) makes the web the home and moves the read-only status page in §1 [Supervisor surfaces the web consumes](#supervisor-surfaces-the-web-consumes-0124): a signed-in `GET /` answers the built web's `index.html`, falling back to the read-only page when the web is not built, the read-only page is at `GET /status` (content-negotiated: `Accept: text/html` the page, any other `Accept` the unchanged `/status` JSON), and the office snapshot carries `supervisor` `{version, counts}` and `ledger` (the host ledger's last lines, redacted), never on a delta; no second version bump, supervisor surfaces, never plugin surfaces — additive; 0.1.26 (Story 31.2) opens Epic 31's entry: the planning adapter gains the `setup` verb, `plansync.py setup --directory ROOT [--dry-run] [--owner-account-id ID | --owner-email EMAIL]`, which creates a registered project's Jira project from the studio template (key from the project id; issue types Epic and Story; the statuses `Blocked - Awaiting User` and `Block Resolved` with their transition), the "Needs you" filter and the linked Confluence space with its five design-page folders, records the keys and ids under `planning.jira` and `planning.confluence` in tracked config, and ends `complete`, `partial` (the owner's numbered steps in `owner_steps[]` and `reason`) or `blocked`, with `found[]`, `created[]` and `written[]` (and `would_create[]`, dry run only) and the §3 block last; a `blocked` setup still lists in `owner_steps[]` (and `reason`) any step the API refused before the error; a `blocked` setup that created an item or left a project or space create to the owner still writes the keys it recorded, naming the config in `written[]`; a key is recorded only for an item found without collision, created, or left to the owner; the 'Needs you' filter is shared with the project, so while the project is an owner step it is created by the rerun; `tk-studio-onboard` gains the optional `tracking` payload that runs it; the Jira binding moves to the `TK_ATLASSIAN_*` agent-seat names through the `api.atlassian.com` gateway (`/rest/api/2` kept), `JIRA_*` and the site URL staying the legacy fallback when `TK_ATLASSIAN_AGENT_TOKEN` is unset; existing verbs and fields are unchanged — additive; 0.1.26 (Story 31.3) adds to this same entry the planning adapter's `publish` verb, `plansync.py publish --directory ROOT [--dry-run] [--source CATEGORY=PATH ...] [--attachment-max-bytes N]`, which converts each design page (brief, GDD, scope of work, decisions; never the records folder) from Markdown to Confluence storage format and creates or updates it by the stable title `<Folder>: <slug>` in the folder `planning.confluence.folders.<category>` records, with a provenance footer naming the source file and the last commit that touched it and a content hash over the title, the storage body and each attachment's sha256, so an unchanged page is skipped; images are attached (PNG re-deflated losslessly) and any over the per-file ceiling (the supplied site setting or 100 MB assumed, capped at 100 MB) is refused by name while its page still publishes (an image outside the project root, by an absolute path, a non-http(s) scheme or a symlink, is refused by name before any read, the same way); the driver supplies the site setting as the plan-sync payload `attachment_max_bytes?`; the result names `found[]`, `created[]`, `updated[]`, `skipped[]`, `refused[]`, `would_publish[]` (dry run), `bytes_uploaded` (against Confluence Free's 2 GB), `notes[]` and `written[]` with the §3 block last, and ends `blocked` (an absent agent-seat Confluence variable, no `planning.confluence` binding, a bad `--source` or a duplicate title, each named before any call), `partial` (a category with no folder, a refused page or image, or a dry run that would publish) or `complete`; it writes `.tk-studio/confluence-pages.json` (ids and paths only), from which the `jira` promote ends every epic's and story's description with a `Design pages:` line inside its content hash; nothing from Confluence changes an entity field (AD-5) — additive; 0.1.26 (Story 31.4) adds to this same entry the planning adapter's `sync-back` verb, `plansync.py sync-back --directory ROOT [--dry-run]`, which pulls the project's Atlassian state into local memory so that no agent queries Atlassian live for context: each tracked issue's status, mapped onto the canonical enum by name first (`Blocked - Awaiting User` and `Block Resolved` are canonical `blocked`) then by status category, stamping `updated`, with the Jira original kept under `external.jira` and no other entity field changed (AD-5) — the same mapping `sync`'s pull-back uses, so the two never flip an entity; its comments append-only into `_bmad-output/tracking/<KEY>/comments.jsonl` (`{issue, id, author: owner | agent, body, mentions[], created, updated, source: jira}`, one line per new `(id, updated)` pair: a comment seen twice is written once, an edit appends a line); its attachments as links into `_bmad-output/tracking/<KEY>/attachments.jsonl` (never downloaded or uploaded); and every owner-authored page of `planning.confluence.space_id` (not one tk-studio published) into `kb/confluence/<slug>.md`, storage XHTML verbatim under a provenance header with `content_hash: sha256:<hex>` — read-only sources: a local edit is overwritten and named in `overwritten[]`; one paged JQL search per tick (`GET /rest/api/2/search/jql`, relative bound `updated >= -<n>m` with a five-minute overlap, `ORDER BY updated ASC`), never a GET per issue — only an issue whose `comment.total` exceeds the comments the search returned pages `GET /rest/api/2/issue/{key}/comment` (overflow only); the cursor in `_bmad-output/tracking/sync-state.json` is the largest issue `updated` seen and moves only after every page was read; a `429` waits `Retry-After`, else backs off 1, 2, 4, 8 and 16 s — a `Retry-After` over 30 s, or a wait past a client's 90 s budget per tick, raises at once so the tick records `last_run` and the `429` well inside the job's 300 s guard — and the observed `RateLimit-*` / `X-RateLimit-*` values and every `429` with its `RateLimit-Reason` are recorded in `rate_limit`; the result names `counts`, `newest_comment`, `applied[]`, `conflicts[]`, `overwritten[]`, `rate_limit`, `notes[]` and `written[]` with the §3 block last, and ends `blocked` (no `planning.jira` binding or an absent Jira variable, each named before any call, or a failed preflight: unreachable, deactivated, the 401/403 split or a preflight answered with another, non-auth status, run case `error`), `partial` (an absent `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN` — the Jira half still runs — an unrecorded `planning.confluence.space_id`, the mirror skipped, no recorded owner accountId, a conflict, or a `429` or error that interrupted a read, the cursor unchanged) or `complete`; a tick that changed a status regenerates `plan/index.md`, local-only; nothing local is promoted back (D9); the driver runs it with the plan-sync payload `sync_back?`; the shipped cron job `atlassian-sync-back` (`*/10 * * * *`, durable, a core target, shipped undeclared) runs it, §4's `{project_root}` core argument naming the submitting project's root; §6's drift check becomes five-plane with the `tracking` plane (`case` `not-bound`, `never-run`, `ok`, `stale`, `token-missing`, `unreachable`, `deactivated` or `auth`, local reads only) — additive; 0.1.26 (Story 31.5) adds to this same entry the `tk-studio-track` surface, `track.py block --directory ROOT --story <ST-NNN | N-M-slug> --reason TEXT --resolves TEXT [--source run|engagement] [--dry-run]`, which moves a story the loop cannot progress, and each dependent story (the entities whose `depends_on` names it), to `Blocked - Awaiting User` by the transition's target name, never its category, through the planning adapter (AD-4), with one agent comment `[~accountid:<owner>] Blocked: <reason>` / `Resolves when: <resolves>` (a dependent's adds `Blocked by: <key>`) that @mentions `planning.jira.owner_account_id`; a transition or comment already in place is skipped and named; it ends `blocked` by name on no `planning.jira` binding or an absent Jira variable (no Atlassian call), no recorded owner accountId, a story never promoted or no transition reaching the status, and `partial` when a dependent fails; nothing else is promoted (D9); the supervisor's paused-run pass calls it for a bound project once per (story key, engine run id), recording a `track-block` event — bmad-loop fires no escalation hook, so the pass is the one caller (DRIFT against the epic's "the engine's escalation hook"); the sync-back's comment-log lines gain `update_author: owner | agent` (the owner's reply is the owner's only when both are) and its search reads `priority`; after a non-dry-run tick that read every page the sync-back derives `_bmad-output/tracking/inbox.json` (`{inbox_version: 1, generated_at, project_key, items:[{issue, entity?, title?, priority, blocked_since, reason_comment: {id, body, created} | null, state: open | resolved | validating}]}`, the state by status name, sorted by priority rank, `null` last, then `blocked_since`); a dry-run, `rate-limited`, `error` or `blocked` tick leaves it untouched; the supervisor serves it at `GET /inbox?project=<id>` (§1, a supervisor surface) and the office projection gains `blocked_issue` — additive; 0.1.26 (Story 31.6) adds to this same entry the `tk-studio-track` surface's `reply` verb, `track.py reply --directory ROOT --issue <KEY> (--body-file PATH | --done) [--dry-run]`, which posts the owner's comment (`--done` writes `Done.`; the body from a file, never the command line) with the owner seat's client (`TK_STUDIO_ATLASSIAN_OWNER_EMAIL` and `TK_STUDIO_ATLASSIAN_OWNER_TOKEN`, host-only — outside the `TK_ATLASSIAN_` prefix the sandbox receives — through the `TK_ATLASSIAN_CLOUD_ID` gateway, `/rest/api/2`, plain text; the 31-1 note's `/rest/api/3` is a DRIFT: the gateway and the cloud id are what make the author the owner), then moves the issue by name to `Block Resolved` through the planning adapter (AD-4); an issue already there skips the transition, named in `skipped[]`; it ends `blocked` by name on an absent owner variable or cloud id, or no `planning.jira` binding (no Atlassian call, the agent's token never stands in), no recorded owner accountId, a created comment whose author is not the owner (nothing moved) or no transition reaching `Block Resolved` (`commented: true` kept), and `partial` with `ok: false` and `retry: true` on a temporary failure; nothing else is promoted (D9); the supervisor serves the issue read at `GET /inbox?project=<id>&issue=<KEY>` and the owner's answer at `POST /inbox/{key}/reply` (§1, supervisor surfaces), and a cookie session's `GET /inbox` carries the session's CSRF token in the `X-CSRF-Token` response header — additive; 0.1.26 (Story 31.7) adds to this same entry the `tk-studio-track` surface's `validate` verb, `track.py validate --directory ROOT --issue <KEY> (--check | --pass --to "To Do"|"In Progress" [--ruling-file PATH --spec PATH] | --fail --follow-up-file PATH) [--dry-run]`, run with the agent seat only (never the owner's variables): `--check` reads the issue's changelog (`GET /rest/api/2/issue/{key}/changelog`, paged) through the planning adapter (AD-4) and reports `owner_resolved` true only when the newest transition into `Block Resolved` carries the recorded `planning.jira.owner_account_id` (an older owner transition never validates a later one, an absent or empty accountId never matches), reads `reason_comment` and `replies[]` (the `comments.jsonl` lines whose `author` and `update_author` are both `owner`, after the newest agent comment) from local memory only and marks the inbox item `validating`; `--pass` writes an owner ruling into the paused story's spec (`**Ruling (owner, <KEY> comment <id>, <date>):** <text>` before `</intent-contract>`, else `</frozen-after-approval>`, never `status:`) and moves the issue by name to `To Do` or `In Progress`; `--fail` re-blocks the issue through the `block` internals with the follow-up as the reason, a new `Blocked:` agent comment; each outcome appends one line to `_bmad-output/tracking/<KEY>/validation.jsonl` (`{issue, outcome: pass | fail, at, transition_id, reply_ids[], to?, ruling?, follow_up_comment_id?}`, local memory, never promoted (D9)); it ends `blocked` by name on a bad key, no `planning.jira` binding or an absent agent variable (no Atlassian call made), no recorded owner accountId, a live status other than `Block Resolved`, no transition reaching the target or an absent spec or block for the ruling, and `partial` with `ok: false` and `retry: true` on a temporary failure, appending no line; the shipped one-shot job `validate-resolution` (§4, a skill target on `tk-studio-track` with `payload.verb: validate`, shipped undeclared) runs the session; the supervisor's resolution pass queues it once per block cycle from `inbox.json` `resolved` items (host tier, the planner leg's model and effort) and resumes the paused run on a `pass` — the 31-4 note's `applied[]` never reaches the supervisor, a DRIFT; the engagement's questions get no call site (EP-32), a DRIFT — additive; 0.1.27 (Story 32.1) opens Epic 32's entry: the engagement record and its states, every surface a supervisor surface (AD-2), none a plugin surface — the four supervisor routes `POST /engagements` `{project, request}` (the bearer, or a session cookie with `X-CSRF-Token`, else `403 CsrfRefused`), `GET /engagements?project=<id>` (newest first), `GET /engagements/{id}` (the record and its chat pointer `chat {route, path, last_seq}`) and `POST /engagements/{id}/input` `{verb, …}` (`answer`, `go`, `revise`, `question`, `approve`, `cancel`, each with its typed payload, else `400 SchemaError`; a verb illegal in the state `409 IllegalInput {state, verb}`, a terminal state `409 EngagementClosed`); the record `_bmad-output/engagements/<ENG-NNN>/engagement.yaml` in the served root (`shape_version: 1`; `id, project, state, request, questions[], assumptions[], scope_page, quote, autonomy, approved_at, closeout`, plus `created`, `updated`, `spend {planning_usd, runs_usd}` and `inputs[]`, the typed-input log), its id minted from the plan counter's new `next.engagement` series in `.tk-studio/plan-counter.yaml` (every other key and `counter_version` preserved, the counter saved before the record lands); the `engagement` supervisor-scope service event `{id, project, state, from, verb?, source}`; `engagements[]` `{id, project, state, title, needs_you}` on the office snapshot and the stream's `event:snapshot` and the `office.engagement` `{id, project, state, from, title, needs_you}` frame; the board's Needs-you engagement items `{engagement, state, title}`; and the one transition table, written in §1 [The engagement state table](#the-engagement-state-table-0127-story-321) from the design spec's §7.1 — additive; 0.1.27 (Story 32.2) adds to this same entry the engagement's chat, a supervisor surface (AD-2), and the plugin's one new surface `tk-studio-engage`: `POST /chat/{engagement}` `{message}` (the bearer, or a session cookie with `X-CSRF-Token`, else `403 CsrfRefused`; the message at most 32 KiB UTF-8) appends the owner's line `{seq, at, author: owner, body}` to `_bmad-output/engagements/<id>/chat.jsonl` and queues one run of the shipped one-shot `engagement-chat` job (host tier, the planner leg's model and effort from the served project's routing, the run's own payload `{engagement, project, project_root, seq}` delivered with its `run_id`, one `chat-queued` service event `{engagement, project, seq, run_id, model, effort}`; a message sent while a chat run is live queues behind it on the checkout lock, never refused), answering `200 {ok, engagement, seq, run_id}` (a terminal engagement `409 EngagementClosed`); `GET /chat/{engagement}?since=<seq>` reads the lines after `seq` as JSON or, with `Accept: text/event-stream`, as the chat stream (`id: <seq>`, `event: chat`, the line as data, `Last-Event-ID` replay, `: heartbeat`); the planner's line `{seq, at, author: planner, body, run_id, proposals[]}` is written by `engage.py reply`, each proposal `{verb, payload, label}` an owner input the planner suggests and never applies; the record `engagement.yaml` is now written as JSON text (a YAML 1.2 document, read unchanged), so stdlib cores read it with `json`; and the chat runs' `job-run` costs are summed into the record's `spend.planning_usd` at the supervisor's `finally` sites, with no `engagement` event — additive; 0.1.27 (Story 32.3) adds to this same entry the engagement's clarifying questions: `engage.py questions --directory <project_root> --engagement ENG-NNN --run-id RUN --questions-file PATH [--dry-run]` writes `_bmad-output/engagements/<id>/questions.json` `{run_id, at, questions: [{id, text, options: [{label, default?: true}], impact}]}` (1 to 3 questions, a fourth refused `TooManyQuestions`, any other bad shape `QuestionInvalid` naming the index, exactly one default per question; `NotIntake`, `EngagementClosed`, `RunIdRequired`), which the supervisor's questions pass applies once per queue `run_id` at its `finally` sites through the state table's event row `questions` (source `planner`, the run id; an invalid file or a state other than `intake` applies nothing and emits one `engagement-questions-skipped {engagement, project, run_id, reason}`, an unparsable file once per engagement); it then blocks one Jira issue per engagement through `track.py block --directory ROOT --engagement ENG-NNN [--dry-run]` (the issue found by its exact summary `ENG-NNN: questions` or created, type `Task`, label `tk-studio-engagement`, moved to `Blocked - Awaiting User` with the open questions as a comment that @mentions the owner; `engagement-issue {engagement, project, issue, action: blocked | closed}`, or `{engagement, project, action: refused, reason}` once per reason for a named `track.py` refusal, with no further call until a later `questions` or `answer` line, or an owner comment that applies nothing (`engagement-answers` with `ids: []`); the find-or-create and the comment held under `_bmad-output/engagements/<id>/track.lock`, a lock held being `retry: true`), reads the owner's Jira reply as `<id>: <option>` lines (the `answer` input with source `supervisor`, once per comment id, `engagement-answers {engagement, project, comment, ids[]}`), and, once the state leaves `awaiting-answers` (every question answered, or `go` turning the open defaults into `assumptions[]`), closes it with the new verb `track.py close --directory ROOT --engagement ENG-NNN [--dry-run]` (`Block Resolved`, then `Done`; no validation leg); a close refusal by name emits `engagement-issue {engagement, project, action: refused, step: close, reason}` once and no further close call (a block's `refused` carries no `step`); the sync-back's search gains `summary`, the `inbox.json` item gains `engagement?` (`{issue, entity?, engagement?, title?, priority, blocked_since, reason_comment, state}`), and the office's `planner` agent takes `blocked_issue` from the first `open` item carrying `engagement`, with or without a run; nothing moves on a timer — additive; 0.1.27 (Story 32.4) adds to this same entry the engagement's scope of work: `engage.py scope --directory <project_root> --engagement ENG-NNN [--scope-file PATH | --revise-at AT] [--dry-run]` (in `scoping` only, else `NotScoping` or `EngagementClosed`) checks the planner's `scope.md` — the `##` sections `Goal`, `Deliverables` (each `### <title>` with an `Acceptance signal:` line, else `DeliverableWithoutSignal: <title>`), `Exclusions`, `What the studio needs from you` (each item dated `YYYY-MM-DD`), `Milestones`, `Proposed epics and stories` (`### Epic <k>: …` / `#### Story <k>.<m>: …` in `epics.md`'s story shape, at least one story), in that order, each non-empty, plus an optional last `Assumptions` naming each `assumptions[]` question id (else `AssumptionUnstated: <id>`); any other shape `ScopeInvalid: <what>` — writes `_bmad-output/engagements/<id>/scope.md` under `scope.lock` and publishes it as the Confluence page `ENG-NNN: Scope of Work` in the folder `Engagements/ENG-NNN` (both folders found by title, else created; 31.3's provenance footer; skipped when the remote content hash matches), then merges `scope_page {id, url, version}` and `updated` into a fresh read of the record (`ConfluenceUnbound`, `ConfluenceEnvMissing` (each absent agent-seat variable named), `PublishRefused`, `ReviseNotFound`, `ScopeUnwritable: <path>: <error>` (`scope.md`, the record or `scope.lock` refused by the OS) refused by name; a 429, a 5xx or a held `scope.lock` is `partial` with `retry: true`, `scope.md` kept and `scope_page` unchanged); the proposed epics and stories are not plan entities (nothing under `plan/`, `_bmad-output/planning-artifacts/` or `.tk-studio/` before approval); `reply`'s memory gains `scope {path, text} | null`; the page is authoritative while `scoping` (D9): the sync-back reads each record's `scope_page.id` page and mirrors a newer version as Markdown into `kb/confluence/<slug>.md` (header plus `engagement`, state under `sync-state.json` `engagement_pages`), replacing `scope.md` wholesale, unchecked, and merging the version while `scoping` (any other state: the mirror and one note per version, no state moves), and the supervisor's scope pass runs `engage.py scope --revise-at <at>` for the newest applied `revise` carrying a `body` while `scoping` (the body verbatim as the new page; the input route's hook now fires after `revise` too); a `revise` in `quoted` voids the quote through the existing table row — additive; 0.1.27 (Story 32.5) adds to this same entry the quote: the trial meter's `observation` payload gains the optional, additive fields `kind: meter`, `story_key`, `epic`, `usd`, `legs.<leg> {usd, usage {input, output, cache_read, cache_write}}` (the key is `usage`, never `tokens`, which the ledger sanitizer redacts), `route` and `prices_date` (the description string unchanged, `observation.json` equal to the ledger line, `harvest` re-emitting them; `events/taxonomy.v1.json`), and `engage.py quote --directory <project_root> --engagement ENG-NNN [--seed N] [--dry-run]` (a `--seed` outside `0 <= seed < 2**53` `BadSeed`, the default seed the first 6 bytes of `sha256("<engagement>:<n>")` so `basis.seed` stays exact through the supervisor's JSON rewrite of the record; in `scoping` only, else `NotScoping` or `EngagementClosed`; no `scope.md`, no proposed story or a repeated `### Epic <k>` number `NoScope`, and so are proposed epics not numbered 1..m in order (an `### Epic 0`, a gap such as 1 and 3), since each keys to `EP-<next + k - 1>`; an unreadable `prices.json` or an unpriced route model `PricesUnreadable`; an OS refusal, an unparseable `budget-bands.yaml` or a top-level `epics:` scalar other than empty, `~`, `null` or `{}`, an unreadable `measurements/` or a held `scope.lock` (`QuoteUnwritable: _bmad-output/engagements/ENG-NNN/scope.lock is held`; a real quote holds `scope.lock` from its read of `scope.md` through the merge, so the scope it prices is the scope on disk when it lands) `QuoteUnwritable`; nothing written on any of them) resamples the project's structured meter history (every machine's ledger, deduped by `story_key`; a free-text `meter:` line counted as `unstructured`, never parsed) over the scope's proposed story count — a seeded bootstrap of 10,000 resamples, nearest-rank `band50`, `band85`, `band95` each `{tokens, usd, share}` (`share` over `plan.window_tokens` of the user or studio config, else `"share unknown"`), `cap = p95 + one story at p85` in USD; under eight records `basis.thin` with the Opus 5.5 trial's per-story dollars as the prior and band85, band95 and the cap widened ×1.5; `basis.notes` is a list of strings (`thin history: <n> landed stories`, and with no tokens `tokens unknown: thin history (no metered story)` or `tokens unknown: thin history (no usd-per-token ratio)`) — and merges only `quote {band50, band85, band95, cap, basis, computed_at}` and `updated` into a fresh read of the record, and writes `epics.<EP-NNN>.usd_estimate` (each proposed epic's p85 dollars, keyed by the id `.tk-studio/plan-counter.yaml` predicts: `basis.epics[] {k, title, stories, ep_id}`, `ep_id` `null` when that counter is unreadable, and then no `epics` band is written) into `.tk-studio/budget-bands.yaml`, every byte outside the top-level `epics:` block kept, other epics' entries kept and this quote's entries overwritten, so `GET /board`'s `band_usd` follows it; the state does not move: the planner proposes `go` and the owner's `go` moves `scoping → quoted` through the existing `quote-present` row; a `scope.md` replaced in `scoping` (by `engage.py scope`, its `revise` body, or the sync-back's page revision) voids a non-null `quote` first (`quote: null` and `updated` merged before `scope.md` is replaced; a void that fails refuses — `ScopeUnwritable` from `scope`, a retry from the sync-back — with `scope.md` untouched), because `scoping + revise → scoping` carries no `void-quote`, so the owner's `go` never passes `quote-present` at an old story count — additive; 0.1.27 (Story 32.6) adds to this same entry approval and the first run: an applied `approve {autonomy, base_ref?}` (the bearer, or a cookie with `X-CSRF-Token`; never a chat line, a planner proposal or a timer) starts the supervisor's approve pass (`apps/supervisor/src/approve.ts`, right after the input and again at the `finally` sites until it is done) on the host, in a dedicated worktree of the served root's repository on the branch `engagement/ENG-NNN` — cut from origin's default branch, or from `origin/engagement/ENG-NNN` while that branch is on origin and not merged (a re-approval after `revise`: one more commit on top whose content replaces the earlier plan wholesale, pushed as a plain fast-forward, never a force push; an open PR carries it) — the served root's checkout never switched or dirtied; its steps, in order, each one `engagement-approve {id, project, step, ok, detail}` service event (a failed step retried at the next pass, never moving the state; the pass writes nothing into the record): `append` (the scope's `## Proposed epics and stories` appended to `epics.md` as `## Epic N`, N the highest `## Epic` number there plus k, first body line `engagement: ENG-NNN`, the stories re-emitted as `### Story N.M:`, each story's As a / I want / So that / Acceptance Criteria found as substrings; refused by name `NoScope`, `StoryShape: <k>.<m>` or `NotApproved`), `sync` (`plansync.py sync --directory <worktree>`: normalize, then the projection with the promote to Jira), `job` (`.tk-studio/jobs/run-epic-N.json`, the existing `run-epic` type, and its id in `.tk-studio/config.yaml`'s `jobs:`, the rest of the file kept byte for byte, `TK_SUPERVISOR_CONFIG` never written; `.tk-studio/budget-bands.yaml` re-keyed from each `basis.epics[].ep_id` to the minted EP id in `epic_bands_text`'s byte shape, a `null` `ep_id` writing no band and named in the step's `no_band`), `commit` (exactly one commit of plansync's `written[]` and the files the pass wrote, pushed; a push origin rejects is `NonFastForward`, retried, never forced), `pr` (`gh pr create --base <default branch> --head engagement/ENG-NNN`, an open one reused; `detail.pr {number, url}`) and `queued` (the first `run-epic-N` queued only once `gh pr view` says `MERGED`, with or without `base_ref` — the run cut from `base_ref` when the approval named one, else from the default branch — with `payload {engagement, project}` and the placement in `detail`: the job's own `TK_SUPERVISOR_CONFIG` entry, else the project's highest-numbered `run-epic-*` entry, else the host tier; then `engagement-run-queued {engagement, project, run_id, job, after_run?}`); the engagement-run pass applies `launched` (`approved → in-progress`, once per approval) on a linked run's `launched` queue event, and the autonomy read from `record.autonomy`: `full` the epic end to end, `steady` a graceful stop (`launch.py stop --graceful`) once a story lands and a resubmit with the same payload once that story's PR merges, `ask` the same stop, `run-paused`, a `kind: ask` block of the engagement's issue and, on an owner comment line `continue` (the 32.3 comment-reader rule), `run-resumed` and a resubmit (`engagement-run-stop`, `engagement-continue`); `spend.runs_usd` sums the linked runs' `job-run` `total_cost_usd`, merged alone into a fresh read beside `spend.planning_usd`, and the board draws the re-keyed band against it; at `spend.runs_usd >= quote.cap` in `in-progress` the cap applies `cap` (`in-progress → partial`), stops the live linked run gracefully (a linked run still queued is cancelled), blocks the issue `kind: cap` with `runs_usd`, `cap`, `band85.usd` and `band95.usd`, and sends one notifier line (`engagement-cap`); the owner's `go {cap}` from `partial` (`raise-cap`: the cap replaced by the owner's figure) then resubmits, and `cancel` stops the live run gracefully; `track.py block --engagement` gains `--kind questions \| cap \| ask` with `--reason` (`engagement-issue {action: blocked, kind}`; `cap` and `ask` need no open questions; `UnknownKind`, `ReasonMissing`), and the questions pass closes only a `questions` block; no table row changes — additive; 0.1.27 (Story 32.7) adds to this same entry the Chat screen's one read: `GET /runs/{id}` gains `cost_usd: number \| null`, the ledger `job-run` `total_cost_usd` of the run's `studio_run_id` (`inbox.ts` `runCost` on `ledgerPath`, the last line winning), `null` with no studio run id or no metered line; the studio web reads it lazily per planner chat line's `run_id` on hover or focus, one read in flight per run, a metered cost cached per run, `not metered` when null (a null or a failed read is read again on the next hover or focus); no field is added to the chat line, no CSRF header to another route, no route or table row changes — additive; 0.1.27 (Story 32.8) adds to this same entry delivery and change requests: `POST /engagements` accepts `follows?: "ENG-NNN"` (an engagement id, else `400 SchemaError`; no such record in the same served project `404 UnknownEngagement {engagement}`; a followed record that is unreadable `500 EngagementRecordInvalid {project, engagement, detail}`; a record not `delivered` `409 FollowsNotDelivered {engagement, state}`), the new record in `intake` carrying `follows` (present only when given) with its own quote, the previous record never touched; `tk-studio-engage` gains the verb `closeout` (`lib/engage.py closeout --directory <served root> --engagement ENG-NNN --input-file <path> [--dry-run]`, run by the supervisor's closeout pass only, never by the planner): the supervisor's composition `{run_id, outcome_hint, runs[], stories[], epics[], side_exits[], spend, quote}` rendered as `_bmad-output/engagements/<id>/closeout.md` (the `##` sections `Outcome`, `Deliverables` — each `### <title>` with its acceptance signal and `Verdict: done \| not done — <why>` — `Pull requests`, `Cost per story`, `Spend`, `Quote against actual`, `Side exits`), published as `ENG-NNN: Closeout` in `Engagements/ENG-NNN` beside the scope (`page: null` with a note when the project has no Confluence binding), and `closeout {path, page, outcome, done, not_done, run_id, at}` merged alone into the record; refusals `NoScope`, `EngagementRecordUnreadable`, `CloseoutInputInvalid` (and `NotInProgress`, `EngagementClosed`), a transient failure `retry: true`; the supervisor's closeout pass at the `finally` sites sees the engagement's last run end (terminal, no resubmit, stop, pause or cap block owed), applies `run-ended {outcome: delivered \| partial \| failed}` (every deliverable done `delivered`; else a `blocked` last run `failed`; else `partial`), moves the engagement's issue to `Done` (`track.py close --engagement`, an open cap or ask block closed with it), sends one notifier line `engagement ENG-NNN <outcome>: <page url \| closeout.md path>` and records `engagement-closeout {engagement, project, run_id, outcome, page, ok, notify}` once per last run; a mid-run `revise` (`scoping` with a live linked run) stops each engine gracefully with reason `revise` (a queued run cancelled), never resubmitted; the owner's `question` stays a self-loop with no pass, answered by the planner's next turn; no field is added to the chat line, no new route, no version bump and no state-table row change — additive; 0.1.28 (Story 33.1, additive): `GET /status` carries `log {path, last_lines[]}` — the newest supervisor log file `<TK_SUPERVISOR_WORK>/supervisor/logs/supervisor-<YYYY-MM-DD>.log` (one file per UTC day, the last 14 kept, each line `<ISO time> [serve\|tick\|drain\|keeper\|pacer] <text>`) and its last 20 lines, each redacted by the status page's rule, with `note` (`"no log"` \| `"TK_SUPERVISOR_WORK is not set"`, `path` `null` then) only when `last_lines` is empty for that reason; the HTML status page shows the same lines; the office snapshot is unchanged; opens Epic 33's entry — additive; 0.1.28 (Story 33.2, additive): a queued run the drain cannot claim (the Max-login preflight refuses, the sbx pin fails, the placement is refused — `TierRefused`, `SbxSandboxMissing` — or the checkout lock has a live holder) stays `queued` and gains the queue event `claim-refused {reason, resolves, pass_at}`, one per distinct cause (the event detail carries a stable `key` — `max-login`, `pin-failed:<sandbox>`, `placement:<TierRefused|SbxSandboxMissing>`, `lock:<holder run_id>` — and a repeated key updates `reason`, `resolves` and `pass_at` in place on the same event; `claim_refused`, the live list and `problems[]` do not carry `key`), the notifier sending one line per new reason with the run id and what resolves it; the claim that goes through records `claim-refusal-cleared {reasons, pass_at}`; `GET /runs/{id}` carries `claim_refused` and each run of `GET /status`'s `live` list too (`{reason, resolves, pass_at, since}` or `null`), and the office's `problems[]` a line `run <run_id>: claim refused: <reason> — resolve: <resolves>`; the drift check gains a sixth plane, `sandbox-login` (the engine sandbox's Max login: `ok`, `drift` within 7 days of `refreshTokenExpiresAt`, `error` once expired or logged out, `missing` with no running engine sandbox), appended after the five — additive; 0.1.28 (Story 33.7, additive): `GET /status` carries `pacer {last_tick_ms, last_drain_ms, last_pass_at}` — always present, the last tick's and drain's wall time in ms and the ISO end of the last pacer pass, each `null` until recorded (read from `<TK_SUPERVISOR_WORK>/supervisor/pacer.json`; absent, invalid or the work folder unset, all `null`); the HTML status page opens its "Supervisor log" section with the pacer line — additive; 0.1.28 (Story 33.8, additive): `POST /runs/{id}/verify` (bearer only) and the cli verb `bun src/cli.ts verify <run id>` re-run an ended run's host leg — a fresh worktree from its pushed branch tip, `verify.host` as the close-out runs it, a new `host-verify` event carrying `rerun {by, head, worktree, pr, pr_ready?}`, a draft PR marked ready on green, the run's terminal state unchanged; refusals `RunNotFound`, `ExternalRun`, `RunNotEnded`, `NoBranch`, `VerifyRunning`, `VerifyFailed`; a `host-verify-leg` lease event — additive; 0.1.29 (Story 34.1, additive): `verify.engine` in the project config, the host leg's engine gate, `engine` on `host-verify` — the project's tracked `.tk-studio/config.yaml` at the run's base may declare `verify.engine` (one command line, beside `verify.host`; not `engine.verify_commands`), run after a green `verify.host` in the worktree with the folder of `GODOT` prepended to PATH; every ran `host-verify` carries `engine {verdict: green\|red\|skipped, reason?, command?, argv?, cwd?, exit?, duration_ms?, signal?, guard?, error?, stdout_tail?, stderr_tail?, godot_dir}`; an engine red is a red leg (`partial`, `host_verify: red`, the draft PR); `tk-studio doctor` gains the `engine` row — additive) |
| Story / rulings | ST-5.3, ST-6.2, ST-7.1, ST-7.2, ST-8.1, ST-8.2, ST-9.6 (Epic 9, D1–D5 ruled 2026-08-06), ST-040–ST-042 (EP-010, D1–D5 ruled 2026-08-07), ST-061, ST-062, ST-083, ST-085, Story 26.1, Story 26.3, Story 26.5 (Epic 26), Story 28.2, Story 28.6 (Epic 28), Story 29.4 (Epic 29), Story 30.4, Story 30.5, Story 30.6 (Epic 30), Story 31.2, Story 31.3, Story 31.4, Story 31.5, Story 31.6, Story 31.7 (Epic 31), Story 32.1, Story 32.2, Story 32.3, Story 32.4, Story 32.5, Story 32.6, Story 32.7, Story 32.8 (Epic 32), Story 33.1, Story 33.2 (Epic 33), Story 34.1 (Epic 34); AD-2, AD-3, AD-4, AD-5, AD-7, AD-8, AD-10, AD-11, AD-12, AD-13, AD-14, AD-16, AD-21 |
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
| the projection (Story 29.3) | `GET /office` | the snapshot `{ok:true, at, agents, runs, problems, id}`: every registry agent once with its state, the live runs with story and epic progress, the time and the id of the latest delta; 0.1.25 (Story 30.6) adds `supervisor` `{version, counts}` (the supervisor's version and the per-state queue counts) and `ledger` (the host ledger's last lines, redacted); 0.1.27 (Story 32.1) adds `engagements[]` `{id, project, state, title, needs_you}` (below); a read that writes nothing |
| the projection (Story 29.3) | `GET /office/events` | with `Accept: text/event-stream`, the stream below; without it, the JSON snapshot |
| the board (Story 30.5, 0.1.25) | `GET /board?project=<id>` | `{ok:true, project, built_at, plan, epics, triage}`: the served project's plan epics with their stories and canonical statuses, each story's latest run (`{run_id, state, pr, host_verify, ended_at}` or `null`) and open findings, per epic `spend_usd` against `band_usd` (`null` with no band), and `triage` `{needs_you, working, done}`; no `project` is `400 ProjectRequired`, an unregistered one `404 UnknownProject`; a read that writes nothing |
| the home and the read-only page (Story 30.6, 0.1.25) | `GET /`, `GET /status` | `GET /` with a session (the cookie or the bearer) is the web: the built web's `index.html` (as `GET /app`, `cache-control: no-store`), or, while the web is not built, the read-only page with its "not built" note, never a `503`; with no session it is the sign-in page. The read-only page (server-rendered HTML, no script, credentials redacted) is at `GET /status` with an `Accept` naming `text/html`; any other `Accept` (none, `*/*`, `application/json`) answers the `/status` JSON `{ok, counts, live, locks}` unchanged, plus `log {path, last_lines[]}` (0.1.28, Story 33.1: the supervisor log's newest file and its last 20 lines, redacted; `note` `"no log"` or `"TK_SUPERVISOR_WORK is not set"` when empty for that reason) — the read-only page shows the same lines in its "Supervisor log" section; plus `pacer {last_tick_ms, last_drain_ms, last_pass_at}` (0.1.28, Story 33.7: always present, the last tick's and drain's wall time in ms and the ISO end of the last pacer pass, each `null` until recorded) — the read-only page opens its "Supervisor log" section with the pacer line; both carry `vary: Accept`. Each run of `live` carries `claim_refused` (0.1.28, Story 33.2: the latest reason a drain pass could not claim the queued run, else `null`). With no session an HTML `GET /status` is the sign-in page returning to `/status`, any other `401` JSON |
| the inbox (Story 31.5, 0.1.26) | `GET /inbox?project=<id>` | `{ok:true, project, generated_at, items:[…]}`: the served project's `_bmad-output/tracking/inbox.json` items exactly as the sync-back wrote them (`{issue, entity?, engagement?, title?, priority, blocked_since, reason_comment, state: open \| resolved \| validating}`, sorted by priority then time; 0.1.27 (Story 32.3): `engagement` `ENG-NNN` on the item whose summary is `ENG-NNN: questions`, its `title` that summary); a missing file is `items: []` with `generated_at: null`, never a `404`; no `project` is `400 ProjectRequired`, an unregistered one `404 UnknownProject`; readable by the bearer or the cookie; a read that writes nothing. The office projection's agents gain `blocked_issue` `{issue, state} \| null` (set while the agent's current story's issue — or, when there is none and the run is `paused`, the paused story's issue — has an `open` item; the web's "!" follows it alone, never a comment or message event; 0.1.27 (Story 32.3): the project's `planner` agent takes it from the first `open` item carrying `engagement`, with or without a run, while a story block on a run still sets the other agents') — additive 0.1.26 (Story 31.6) adds `GET /inbox?project=<id>&issue=<KEY>` (the Issue screen's read): `{ok:true, project, generated_at, items, issue}` with `items` the matching item only and `issue` `{key, entity, title, status, run, cost_usd, comments[]}` — `entity` the plan entity whose `external.jira.key` is `KEY` (or `null`), `status` its `external.jira.status`, else the item's state, else `null`, `run` the story's latest run as `GET /board` composes it (or `null`), `cost_usd` that run's ledger `job-run` cost (or `null`, unmetered), `comments[]` the last `_bmad-output/tracking/<KEY>/comments.jsonl` line per `id` in `created` order (`{id, author, update_author?, body, created, updated}`); a key not matching `^[A-Z][A-Z0-9]+-\d+$` is `400 BadIssue`, one with no item, no entity and no comment log `404 UnknownIssue`; a registry or board read that fails `500 IssueReadFailed`; any `GET /inbox` on a cookie session carries the session's CSRF token in the `X-CSRF-Token` response header (a bearer answer has none) — additive |
| the owner's reply (Story 31.6, 0.1.26) | `POST /inbox/{key}/reply` | the body `{project, body?, done?: true}` — exactly one of a non-empty `body` (at most 32 KiB UTF-8) or `done: true` (`Done.`), else `400 SchemaError` (a body that is not JSON is `400 MalformedJson`, a malformed key `400 BadIssue` — additive); the bearer, or a cookie session with `X-CSRF-Token`, else `403 CsrfRefused`; with `TK_STUDIO_ATLASSIAN_OWNER_EMAIL`, `TK_STUDIO_ATLASSIAN_OWNER_TOKEN` or `TK_ATLASSIAN_CLOUD_ID` absent from the supervisor's environment (after the User-environment fill) `409 OwnerSeatMissing {missing}` and no spawn; otherwise the supervisor runs `track.py reply --directory <registry root> --issue <KEY> --body-file <tmp>` on the host (the body in a temp file, removed afterwards; the owner's variables never reach the sandbox) and answers `200 {ok, project, issue, commented, transitioned, status}` (`status` is the verb's §3 status — `complete`, or `partial` — never the issue's Jira status), `409 ReplyRefused {reason, commented}` (`blocked`), `503 ReplyRetry {reason, commented}` (`retry: true`) or `500 ReplyFailed` (no JSON, or a spawn failure); an unregistered project is `404 UnknownProject`; it writes no queue event — the item leaves the inbox on the next sync-back, which derives `Block Resolved` as `resolved` — additive |
| the engagement (Story 32.1, 0.1.27) | `POST /engagements` | the body `{project, request, follows?}` (`follows` added in 0.1.27, Story 32.8) — `project` and `request` non-empty strings, `request` at most 32 KiB UTF-8, no other field, else `400 SchemaError` (not JSON `400 MalformedJson`); the bearer, or a cookie session with `X-CSRF-Token`, else `403 CsrfRefused`; an unregistered project `404 UnknownProject`; a registry entry with no root, or a root not on disk, `500 EngagementRootMissing` (nothing is created); the supervisor mints `ENG-NNN` from `next.engagement` in the served root's `.tk-studio/plan-counter.yaml` (default 1, saved atomically before the record; a counter that is not a mapping, or a `next.engagement` that is not an int >= 1, `500 EngagementCounterInvalid`), writes `_bmad-output/engagements/<id>/engagement.yaml` in state `intake` and appends one `engagement` service event `{id, project, state, from: null, source}` (no queue run); `200 {ok, engagement}` — additive; 0.1.27 (Story 32.8): `follows?` names a `delivered` `ENG-NNN` of the same served project — a malformed `follows` (not matching `^ENG-\d{3,}$`) `400 SchemaError`; then no such record `404 UnknownEngagement {engagement}`; a record that is not JSON or not a record `500 EngagementRecordInvalid {project, engagement, detail}`; a record not `delivered` `409 FollowsNotDelivered {engagement, state}` (nothing minted on any of them), see the version entry |
| the engagement (Story 32.1, 0.1.27) | `GET /engagements?project=<id>` | `{ok:true, project, engagements:[…], problems:[…]}`: the served project's records, newest first; a malformed one is skipped and named root-relative in `problems`; no `project` is `400 ProjectRequired`, an unregistered one `404 UnknownProject`; readable by the bearer or the cookie; a read that writes nothing — additive |
| the engagement (Story 32.1, 0.1.27) | `GET /engagements/{id}` | `{ok:true, project, engagement, chat}`: the record as written (its `scope_page` `null` until Story 32.4's `engage.py scope` records `scope_page {id, url, version}` — the scope page's id, its `https://<planning.jira.site>/wiki<webui>` url and its version after the last write or mirrored owner edit); its `quote` `null` until Story 32.5's `engage.py quote` merges `quote {band50, band85, band95, cap, basis, computed_at}` — each band `{tokens, usd, share}`, `cap` a number in USD, `basis` the method, the seed, the history, the route, the autonomy levels and the planning spend, `basis.epics[] {k, title, stories, ep_id}` (`ep_id` `null` when `.tk-studio/plan-counter.yaml` is unreadable) and `basis.notes` a list of strings (`thin history: <n> landed stories`, `tokens unknown: thin history (no metered story)`, `tokens unknown: thin history (no usd-per-token ratio)`) — and `null` again once a `revise` voids it or a replaced `scope.md` voids it first and its chat pointer `chat {route: "/chat/<id>", path: "_bmad-output/engagements/<id>/chat.jsonl", last_seq}` (`last_seq` `0` while Story 32.2 has written no chat); the record is read under `?project=<id>`, else in the one registry project whose served root holds its file (`_bmad-output/engagements/<id>/engagement.yaml`, parsed or not); ids repeat across projects, so with no `?project=` more than one holder is `409 AmbiguousEngagement {engagement, projects[]}` before any record is read, and a client sends `?project=` whenever an id can repeat; an id not like `ENG-001` is `400 BadEngagement`, none found `404 UnknownEngagement`, a file that is not a record (or whose `id` is not its directory's) `500 EngagementRecordInvalid`; readable by the bearer or the cookie — additive |
| the engagement's input (Story 32.1, 0.1.27) | `POST /engagements/{id}/input` | the body `{verb, …}`: `answer {answers: {<question id>: <option>}}`, `go {cap?: number > 0}`, `revise {body?}` (at most 32 KiB UTF-8), `question {text}`, `approve {autonomy: ask \| steady \| full, base_ref?}` or `cancel {reason?}`, any other body `400 SchemaError`; the bearer, or a cookie session with `X-CSRF-Token`, else `403 CsrfRefused`; exactly one row of [the engagement state table](#the-engagement-state-table-0127-story-321) applies, the input is appended to `inputs[]` with its time and source (`bearer` \| `cookie`) and one `engagement` service event carrying `from` follows: `200 {ok, engagement, from, to}`; a verb illegal in the state is `409 IllegalInput {state, verb, detail?}`, a terminal state `409 EngagementClosed {state, verb}`; the record is found as for `GET /engagements/{id}` (`?project=<id>`, else the one holder: more than one is `409 AmbiguousEngagement {engagement, projects[]}` and nothing is written), with its `400 BadEngagement`, `404 UnknownEngagement` and `500 EngagementRecordInvalid`; nothing else moves `state` (no chat message, no planner reply, no timer); Story 32.6: an applied `approve` starts the approve pass (the plan appended to `epics.md`, `plansync sync`, the `run-epic-N` job declared, one commit on `engagement/ENG-NNN` opened as a PR, the first run queued once that PR merges, cut from `base_ref` when given), an applied `go` from `partial` the engagement-run pass that resubmits, both fire-and-forget after the answer (the 0.1.27 Story 32.6 clause) — additive |
| the engagement's chat (Story 32.2, 0.1.27) | `POST /chat/{engagement}` | the body `{message}` — a non-empty string at most 32 KiB UTF-8, no other field, else `400 SchemaError` (not JSON `400 MalformedJson`); the bearer, or a cookie session with `X-CSRF-Token`, else `403 CsrfRefused`; the engagement is found as for `GET /engagements/{id}` (`?project=<id>`, else the one holder: more than one is `409 AmbiguousEngagement {engagement, projects[]}`), with its `400 BadEngagement`, `404 UnknownEngagement` and `500 EngagementRecordInvalid`; a terminal engagement (`delivered`, `failed`, `cancelled`) is `409 EngagementClosed {state}` and nothing is appended. The supervisor resolves the shipped `engagement-chat` job for the served root (a refusal `500 ChatJobUnresolved`, nothing appended), then under `chat.lock` re-reads the record (one still in block YAML is rewritten as JSON text first), appends the owner's line `{seq, at, author: "owner", body}` to `_bmad-output/engagements/<id>/chat.jsonl` (`chat.lock`: exclusive create in the engagement's directory, stale after 30 s and taken over by an atomic rename to a unique name, the last `seq` re-read inside it; held past the wait `503 ChatBusy`, the wait never blocking the server), mints one `engagement-chat` run (one-shot, `tier: host`, the planner leg's `model` and `effort` from the served root's `.bmad-loop/routing.current.json`, the run's own payload `{engagement, project, project_root, seq}` on its `enqueued` event — `project_root` the served registry root, where the record and the chat live untracked, mapped by the skill to `--directory` (the session runs in the run's worktree) — delivered at run start as `{verb: "reply", engagement, project, project_root, seq, run_id}`) and appends one `chat-queued` service event `{engagement, project, seq, run_id, model, effort}`: `200 {ok, engagement, seq, run_id}`. A mint that fails removes the owner's line again under the lock (no owner line survives without a run) and is `500 ChatQueueFailed`. A message sent while a chat run is live mints a second run that waits on the checkout lock — never refused, never adopted. The planner's reply is a `claude -p` session of `tk-studio-engage` with a worker's environment; it writes `{seq, at, author: "planner", body, run_id, proposals[]}` (each proposal `{verb, payload, label}`, a button the owner sends through `POST /engagements/{id}/input`); nothing the chat writes moves `state`. The chat runs' ledger `job-run` costs are summed into the record's `spend.planning_usd` at the supervisor's `finally` sites (no `engagement` event). Every chat `run_id` (the `200` answer, `chat-queued`, the payload and the planner line) is the queue run id; the spend pass maps it through the run's `studio_run_id` to the ledger `job-run` `payload.run_id` — additive |
| the engagement's chat (Story 32.2, 0.1.27) | `GET /chat/{engagement}?since=<seq>` | `{ok:true, project, engagement, since, last_seq, lines:[…]}`: the chat lines with `seq` after `since` (`last_seq` the file's last line's `seq`, `0` while absent, as `GET /engagements/{id}` `chat.last_seq`) (default `0`; not a non-negative integer `400 SchemaError`); with `Accept: text/event-stream` the chat stream instead — frames `id: <seq>`, `event: chat`, `data: <the line>`, first the lines after `Last-Event-ID` (a numeric one wins over `since`) or `since`, then each new line as it lands (the planner's reply reaches an open stream without a reload), and a `: heartbeat` comment every 10 s; the client's close ends it. The engagement is found as for the POST (`409 AmbiguousEngagement`, `400 BadEngagement`, `404 UnknownEngagement`); readable by the bearer or the cookie; a read that writes nothing. Any other method `405` with `Allow: GET, POST` — additive |

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

**0.1.26 (Story 31.5, additive).** Every agent row of the snapshot and
every `office.agent` delta carry `blocked_issue`: `{issue, state}` while
the agent's current story's issue has an `open` item in the served
project's `_bmad-output/tracking/inbox.json` (when the current story gives
none and the run is `paused`, the story it paused on is read instead: the
queue `paused` event's `paused_story_key`, else the standing journal
`story-escalated` key; `current_story` itself is unchanged), `null` otherwise (always on
the wire, never omitted); a change of `blocked_issue` alone fires
`office.agent`, recomputed when the inbox file changes and never moved by
a comment or a message. Every other field, kind and id is unchanged.

**0.1.27 (Story 32.1, additive).** The snapshot (`GET /office`, the JSON
`GET /office/events` and the stream's `event:snapshot`) carries
`engagements[]` `{id, project, state, title, needs_you}`: every engagement
record under each served project's root, newest first per project,
`title` the request's first line (80 characters), `needs_you` true in
`awaiting-answers` and `quoted`; a malformed record is a `problems[]`
line naming it root-relative. A new frame kind, `office.engagement`
`{id, project, state, from, title, needs_you}`, fires when a record
appears (`from` `null`), changes state, title or `needs_you`, and with
`state` `null` when it is gone; it carries `project` as an additive field
next to `{id, state, from}` and is keyed by project plus id, because each
served root mints its own `ENG-NNN` series. `GET /board`'s `triage.needs_you` gains
the project's engagements in `awaiting-answers` and `quoted` as items
`{engagement, state, title}`, after the run items (a consumer that reads
only `run_id` items drops them). The records are the truth; the
`engagement` service event is the signal. Every other field, kind and id
is unchanged.

**0.1.28 (Story 33.1, additive).** `GET /status` (the JSON answer, any
`Accept` but `text/html`) carries `log {path, last_lines[]}`: `path` the
supervisor's newest log file, `<TK_SUPERVISOR_WORK>/supervisor/logs/supervisor-<YYYY-MM-DD>.log`
(today's UTC file, else the newest present; one file per UTC day, the
last 14 kept), and `last_lines` its last 20 lines, each
`<ISO time> [serve|tick|drain|keeper|pacer] <text>` and each redacted by
the status page's own rule (every `TK_SUPERVISOR_*TOKEN*`/`*SECRET*`
value, `Bearer`/`Basic` credentials, credential-named keys' values and
key-shaped strings become `[redacted]`), applied when the line is written
and again when it is read. When `last_lines` is empty for that reason,
`note` says why: `"no log"` (no folder or no day file; `path` is today's
file), or `"TK_SUPERVISOR_WORK is not set"` (`path` `null`). The HTML
status page shows the same lines in its "Supervisor log" section. The
office snapshot carries no `log`. Every other field and route is
unchanged.

**0.1.28 (Story 33.2, additive).** A queued run the drain cannot claim says
why on the run, never only on the console. The refusals are the Max-login
preflight, the sbx pin (`sbx run -d --name <sandbox>`, which now runs
before the claim), a refused placement (`TierRefused`,
`SbxSandboxMissing`) and a checkout lock with a live holder. The run stays
`queued` and gains the queue event `claim-refused {reason, resolves,
pass_at}`, one per distinct cause since its latest
`claim-refusal-cleared`: the event detail carries a stable `key`
(`max-login`, `pin-failed:<sandbox>`,
`placement:<TierRefused|SbxSandboxMissing>`, `lock:<holder run_id>`), and
a repeated key updates `reason`, `resolves` and `pass_at` in place on that
same event (its `seq` and `at` unchanged), never a second event;
`claim_refused`, the live list and `problems[]` do not carry `key`. The
notifier sends one line per new reason, `supervisor: run <run_id> stays
queued, claim refused: <reason> — resolve: <resolves>`, and its outcome
lands on the event as `notify`. When the reason clears, the next pass
claims the run and records `claim-refusal-cleared {reasons, pass_at}`.
`GET /runs/{id}` carries `claim_refused`, and so does each run of
`GET /status`'s `live` list: the latest open refusal (the one a pass met
last) as `{reason, resolves, pass_at, since}`, else `null`. The office's
`problems[]` carries one line per such queued run, `run <run_id>: claim
refused: <reason> — resolve: <resolves>`. A broken registry entry, a
`resolve` refusal or `problems[]` still end the run `blocked`. No event,
line or answer carries a token. The drift check's sixth plane,
`sandbox-login`, is described in §6. Its `missing` (`no-sandbox`, a box
with no engine sandbox) aggregates to `result: drift` (exit 1), like every
`missing` plane, and so does its `expiring` (`drift`); only its `expired`
(`error`) reaches `result: error` (exit 2). Every other field, kind and
route is unchanged.

**0.1.28 (Story 33.3, additive).** The supervisor's sbx pin restarts a
sandbox that came up without its Max login (one started outside the
supervisor, such as a session's `sbx exec` on a stopped sandbox). Both pin
sites (the drain's pin before the claim, and the drive's pin for run mode,
relaunch and resume) read `sbx ls` before `sbx run -d --name <sandbox>`.
Only when the sandbox was listed as running (its first column is the
sandbox exactly and its status is `running`; a failed `sbx ls` reads as
not running) does the pin probe the login (`sbx exec <sandbox> env -u
ANTHROPIC_API_KEY claude auth status --json`). When the probe says not
logged in, the pin stops and starts the sandbox once (`sbx stop`, `sbx run
-d --name`), probes again, and records the queue event `pin-restart
{sandbox, probe_before, probe_after, pass_at}` on the run; each probe is
`null` (the claude.ai login is present) or the preflight's gap text, never
stdout or a token. The restart happens only when this pass has not
restarted that sandbox, the run's open episode (since its latest
`claim-refusal-cleared`, else the run's start) carries no `pin-restart`
for it, and no other run holds it `running`, `paused` or `external` nor
does an ended run's engine still live there; a repeat in the same episode
updates that event in place, never a second event. The caller's
Max-login preflight then judges: a drained run still logged out stays
`queued` through the existing `max-login` refusal, and a relaunch or
resume ends `blocked` as before. A failed `sbx stop` or `sbx run` during
the restart is a pin failure (`sbx pin failed: …`, the same `pin-failed`
episode and `pin-failed:<sandbox>` key). The supervisor also keeps a pin
record, `~/.tk-studio/sandboxes/<sandbox>.pin` (`TK_STUDIO_HOME`
honoured) = `{sandbox, since, run_id, supervisor_pid}`, written on every
pin and removed when the release (`pin-released`) stopped the sandbox; it
is advisory, like the starter lock (§4). `tk-studio-launch check` reads
it: an engine sandbox `sbx ls` lists as running with no record is named in
the advisory `engine sandbox` row as `warning: <sandbox> started outside
the supervisor; the next pin restarts it`, never a gap. No new
`claim-refused` key, no new drift-check plane. Every other field, kind and
route is unchanged.

**0.1.28 (Story 33.5, additive).** `tk-studio-launch check` (and so
`start`, which runs it before the spawn) reconciles the engine policy's
`[verify] commands` (`.bmad-loop/policy.toml`, the gitignored overlay)
from a tracked list: the project's `.tk-studio/config.yaml`
`engine.verify_commands` when the key is present (no value = nothing
tracked), else `plugins/tk-studio/pipeline/verify-commands.toml`
`commands` (tk-studio's list: `uv run --directory plugins/tk-studio/lib
python -m unittest tests.test_release_roster`); `config.local.yaml` and
the user tier are never read for it. A tracked command the policy lacks is
appended after the operator's, which are kept in order; nothing to add
leaves the file byte-identical; the write is atomic and re-read with
`tomllib` (the original bytes restored on any mismatch); a new `[verify]`
table goes before the managed routing block. `check` gains the row
`verify commands` (`added <n> from <source>; kept <m> operator commands`,
`unchanged (<n> tracked, <m> operator)`, `skipped (no tracked list)`,
`skipped (no .bmad-loop/policy.toml; bmad-loop init creates it)`) and the
result key `verify_commands {source, tracked[], added[], kept[], policy}`
(`source` the project-relative file, `.tk-studio/config.yaml
engine.verify_commands`, or `null`; `kept[]` the operator commands not
tracked; `policy` `written | unchanged | skipped (…) | refused`), on every
`check` result including its early returns. A source or policy that does
not parse, a list that is not strings, or a `commands` the placement
cannot locate (a dotted key, an inline table) is a named gap (`blocked`,
the detail naming the file and "fix it by hand"); no tracked list or no
policy is advisory. `[limits]` stays read-only. Every other field, verb
and outcome is unchanged.

**0.1.28 (Story 33.6, additive).** The paused-run pass gains the queue
event `auto-resume` (hole 65: a stale sandbox view of a fresh render
snapshot). A run paused at stage `escalation` whose engine `paused_reason`
is a dev session's CRITICAL escalation quoting a `render_skill.py` message
(or naming `render_skill.py`) and exactly one snapshot folder
`_bmad/render/<skill>/<slug>/<generation>` that resolves under the served
root, whose story's spec is `status: blocked` and untracked, and whose
folder the host sees complete (every `manifest.json` output present and
non-empty; no hash compared), is handled before the Story 31.5 block. Once
per story, under any engine run id: the folder and the draft spec are
removed, the run resumed through `POST /runs/{id}/resume`'s path, and one
`auto-resume {reason: "stale-render-view", snapshot, story_key,
engine_run_id, attempt: 1, resumed, notify}` recorded (`error`
`"<code>: <detail>"` when the resume refused; the run then stays
`paused`), with one notifier line (`supervisor: run <run_id> auto-resumed:
story <key> halted on a stale render view of <snapshot> (attempt 1)`, or
the `stays paused: … refused: <error>` line). A second such pause of the
same story records one `auto-resume {…, attempt: 2, resumed: false,
first_at}` and one line per pause (`supervisor: run <run_id> stays paused
for the operator: … again after the auto-resume at <first_at>`), removes
and resumes nothing, and the Story 31.5 block follows unchanged. `snapshot`
is relative to the served root with `/` separators; `notify` is the send's
outcome (`{ok: false, skipped: …}` with no notifier). The pass's answer
and every other field, kind and route is unchanged.

**0.1.28 (Story 33.7, additive).** A resumed run (its engine resumed by
`POST /runs/{id}/resume`) or a relaunched one (by the paused-run pass)
whose engine ends `stopped` (a graceful stop) is ended by the engine-end
sweep from the engine journal (`<served root>/.bmad-loop/runs/<engine run
id>/journal.jsonl`, read before the close-out): when the latest
`story-start`/`story-done` entry after the latest `run-start` or
`run-resume` is a `story-done` with a non-empty `story_key`, the run ends
`complete` with `reason: null` and its PR is marked ready, exactly as a
first engine's graceful stop; otherwise (or with no journal) it ends
`partial`, `resumed|relaunched engine ended 'stopped'`, as before.
`interrupted` and `crashed` stay `partial`, a red host verify still ends
it `partial` naming the command, an engine the supervisor killed never
ends `complete` this way, and a killed relaunch keeps its launch's
recorded end, except one whose engine handled TERM and reads `stopped`,
which ends `partial`, `relaunched engine ended 'stopped'` (DW-65); the
`ended` event's detail is unchanged. `GET /status` (the
JSON answer) carries `pacer {last_tick_ms, last_drain_ms, last_pass_at}`,
always present: the last tick's and drain's wall time in ms and the ISO
end of the last pacer pass, each `null` until recorded (read from
`<TK_SUPERVISOR_WORK>/supervisor/pacer.json`; absent, invalid or the work
folder unset, all `null`). Each pacer pass logs `pass: <ms> ms, exit
<code>` to the supervisor log under its tag; a pass over 10 minutes also
logs `warning: pass <tick|drain> took <ms> ms (over 10 min), driving <run
ids>` and sends that line once through the notifier (no token). The HTML
status page opens its "Supervisor log" section with the pacer line. Every
other field, kind and route is unchanged.

**0.1.28 (Story 33.8, additive).** An ended run's host leg is re-runnable
in one motion: `POST /runs/{id}/verify` (bearer only, never a cookie
session; the body empty or `{}`) and the cli verb `bun src/cli.ts verify
<run id>`. The supervisor cuts a fresh detached worktree
(`<run worktree>.verify`) at the tip of the run's pushed branch
`supervisor/run-<id>` on origin, materialises it as a run's worktree is,
runs the project's `verify.host` there exactly as the close-out does (the
command read at the run's `base_ref` in the checkout, under the job's
wall-clock guard), removes the worktree, and records a new `host-verify`
event: the leg's detail plus `rerun {by: "api"|"cli", head, worktree:
"removed"|"kept: <why>", pr, pr_ready?}`. On green with a PR (the run's
recorded one, else an open PR from the run branch) an open draft is marked
ready (`pr_ready: "marked"`; `"already"`, `"not open"` or `"error: …"`
otherwise); red or skipped never touches the PR. The run's terminal state
and its `ended` event never change; the derived `host_verify` (board,
inbox, office) follows the latest `host-verify`. The route answers `202
{ok, run_id, state, verify: "started", head}` and the leg runs on; the verb
waits and prints `{ok, run_id, state, head, green, skipped?, reason?, pr,
pr_ready?, worktree}` (exit 0 green, 1 red or skipped, 2 a refusal).
Refusals: `404 RunNotFound`; `409 ExternalRun`, `409 RunNotEnded`
(`queued`, `running`, `paused`), `409 NoBranch` (no recorded worktree, the
branch not on origin, or `git ls-remote` failing), `409 VerifyRunning`;
`400 SchemaError | MalformedJson`; `500 VerifyFailed` (the work folder
unset, or the cut or materialise failed: no `host-verify`). The new
`host-verify-leg {owner, by}` event is the re-run's lease (`{owner: null,
released}` when let go of; the `host-verify` closes it; a dead owner's
lease is taken over). Every other field, kind and route is unchanged.

**0.1.29 (Story 34.1, additive).** The host leg gains the engine gate. The
project's tracked `.tk-studio/config.yaml`, read at the run's `base_ref`
as `verify.host` is, may declare `verify.engine` beside it: `verify: {host:
"<one command line>", engine: "<one command line>"}` (TUA's is `bash
scripts/engine-gate.sh`), split into argv as `verify.host` is, never a
shell. `verify.engine` is the host leg's command; `engine.verify_commands`
(0.1.28, Story 33.5) is the in-sandbox list: two keys, never merged. The
engine command runs only after `verify.host` is green, in the same
worktree, through the same capture wrapper, under the full worker guard
again, on the close-out and on the `POST /runs/{id}/verify` re-run alike.
Its PATH is the host step's with the folder of `GODOT` (the supervisor's
environment) prepended under the key the environment spells; the leg never
resolves `godot` itself. Every ran `host-verify` event carries `engine
{verdict: "green" | "red" | "skipped", reason?, command?, argv?, cwd?,
exit?, duration_ms?, signal?, guard?, error?, stdout_tail?, stderr_tail?,
godot_dir}` (`godot_dir` the prepended folder, `null` when `GODOT` is
unset or not an absolute path: the command still runs); a skipped leg (`{skipped: true, reason}`)
carries none. Skip reasons: `no verify.engine`, `verify.engine is not a
non-empty string`, `verify.host red`. The leg's `green` is the host command
green and the engine not red, so an engine red is a red leg exactly as a
red `verify.host` is: the run ends `partial` with `host_verify: red` and
the reason ``host verify red (engine): `<engine command>` …``, the PR a
draft, and the board, inbox and office read it through the same `green`.
The PR body's `## Host verify` section gains an `Engine gate: green | red |
skipped (<reason>)` line. `tk-studio doctor` gains the `engine` row
(`skipped` `no engine` when `GODOT` is unset or names no file, `pass` with
the path and the first line `godot --version` prints, `fail` otherwise).
Every other field, kind and route is unchanged.

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

### The engagement state table (0.1.27, Story 32.1)

The one transition table of an engagement, exported as `TRANSITIONS` from
`apps/supervisor/src/engagement.ts` and tested there row by row; its source
is the design spec's §7.1 (`studio-design-spec-2026-10-09/README.md`, the
engagement states). The states are `intake → awaiting-answers → scoping →
quoted → approved → in-progress → delivered`, with the side exits
`paused`, `failed`, `partial` and `cancelled`; `delivered`, `failed` and
`cancelled` are terminal. Only these rows move `state`: the owner's typed
inputs of `POST /engagements/{id}/input` (source `bearer` or `cookie`) and
the supervisor-observed event rows (applied by the exported `applyEvent`,
logged in `inputs[]` with source `supervisor`, or `planner` for the
`questions` row; the supervisor's passes apply them in 0.1.27, never a
route — Story 32.3 wires `questions`, Story 32.6 `launched`, `run-paused`,
`run-resumed` and `cap` (`apps/supervisor/src/approve.ts`), and Story 32.8
wires `run-ended`). A `(state, verb)` cell with no row is `409 IllegalInput
{state, verb}`; every verb and event in a terminal state is `409
EngagementClosed`; an `answer` naming a question id the record does not
hold is `400 SchemaError`. Rows of one cell are tried in order: the first
whose guard holds applies. Every applied row appends one `inputs[]` line
`{at, verb, source, payload?, from, to, run_id?, detail?}` and emits the
`engagement` service event carrying `from`.

| from | input | to | guard | effect | source |
| --- | --- | --- | --- | --- | --- |
| `intake` | `go` | `scoping` | — | — | bearer \| cookie |
| `intake` | event `questions` | `awaiting-answers` | — | `questions[]` filled from the planner's written questions | planner |
| `awaiting-answers` | `answer` | `scoping` | every `questions[]` entry has an `answer` (after this one) | each answer lands in its `questions[].answer` | bearer \| cookie \| supervisor (a Jira comment, 0.1.27 Story 32.3) |
| `awaiting-answers` | `answer` | `awaiting-answers` (stays) | — | each answer lands in its `questions[].answer` | bearer \| cookie \| supervisor (a Jira comment, 0.1.27 Story 32.3) |
| `awaiting-answers` | `go` | `scoping` | — | each unanswered question's default becomes an `assumptions[]` entry `{question, text, assumed}` | bearer \| cookie |
| `scoping` | `go` | `quoted` | `quote` non-null, else 409 IllegalInput `detail: "no quote"` | — | bearer \| cookie |
| `scoping` | `revise` | `scoping` (stays) | — | — | bearer \| cookie |
| `quoted` | `revise` | `scoping` | — | `quote` set `null` (voided) | bearer \| cookie |
| `quoted` | `approve` | `approved` | — | `autonomy` and `approved_at` recorded | bearer \| cookie |
| `approved` | `revise` | `scoping` | — | `quote` set `null` (voided) | bearer \| cookie |
| `approved` | event `launched` | `in-progress` | — | — | supervisor |
| `in-progress` | `revise` | `scoping` | — | `quote` set `null` (voided) | bearer \| cookie |
| `in-progress` | event `run-paused` | `paused` | — | — | supervisor |
| `in-progress` | event `cap` | `partial` | — | — | supervisor |
| `in-progress` | event `run-ended` | `delivered` | `outcome: delivered` | — | supervisor |
| `in-progress` | event `run-ended` | `partial` | `outcome: partial` | — | supervisor |
| `in-progress` | event `run-ended` | `failed` | `outcome: failed` | — | supervisor |
| `paused` | `revise` | `scoping` | — | `quote` set `null` (voided) | bearer \| cookie |
| `paused` | event `run-resumed` | `in-progress` | — | — | supervisor |
| `partial` | `go` | `in-progress` | — | `{cap}` recorded on `quote.cap` when a quote exists (else on the input only) | bearer \| cookie |
| `partial` | `revise` | `scoping` | — | `quote` set `null` (voided) | bearer \| cookie |
| `partial` | event `run-ended` | `delivered` | `outcome: delivered` | — | supervisor |
| `partial` | event `run-ended` | `partial` (stays) | `outcome: partial` | — | supervisor |
| `partial` | event `run-ended` | `failed` | `outcome: failed` | — | supervisor |
| `intake` | `question` | `intake` (stays) | — | — | bearer \| cookie |
| `awaiting-answers` | `question` | `awaiting-answers` (stays) | — | — | bearer \| cookie |
| `scoping` | `question` | `scoping` (stays) | — | — | bearer \| cookie |
| `quoted` | `question` | `quoted` (stays) | — | — | bearer \| cookie |
| `approved` | `question` | `approved` (stays) | — | — | bearer \| cookie |
| `in-progress` | `question` | `in-progress` (stays) | — | — | bearer \| cookie |
| `paused` | `question` | `paused` (stays) | — | — | bearer \| cookie |
| `partial` | `question` | `partial` (stays) | — | — | bearer \| cookie |
| `intake` | `cancel` | `cancelled` | — | — | bearer \| cookie |
| `awaiting-answers` | `cancel` | `cancelled` | — | — | bearer \| cookie |
| `scoping` | `cancel` | `cancelled` | — | — | bearer \| cookie |
| `quoted` | `cancel` | `cancelled` | — | — | bearer \| cookie |
| `approved` | `cancel` | `cancelled` | — | — | bearer \| cookie |
| `in-progress` | `cancel` | `cancelled` | — | — | bearer \| cookie |
| `paused` | `cancel` | `cancelled` | — | — | bearer \| cookie |
| `partial` | `cancel` | `cancelled` | — | — | bearer \| cookie |
| `delivered`, `failed`, `cancelled` | any verb or event | — | — | — | `409 EngagementClosed` |

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
| `tk-studio-onboard` | `directory`; `vcs?`; `project_id?`; `role?`; `resources?` (explicit confirmed list); `tracking?` (0.1.26 — set up tracking; with `owner_account_id?` or `owner_email?`) | `lib/{store,config,registry,kb,vault,recommend}.py`; `lib/plansync.py setup` when `tracking` (0.1.26) | `.tk-studio/config.yaml` (+local), registry entry, `kb/`, vault links; `working_set.<role>` only when `resources` present; with `tracking`, the Jira project, filter and Confluence space from the studio template and their keys and ids under `planning.jira` and `planning.confluence` (0.1.26), relayed from the setup block — `partial` with the owner's numbered steps verbatim | `project_id` collision; classification refusal (AD-3); recording requested without explicit `resources`; with `tracking`: an unregistered project, or any absent `TK_ATLASSIAN_SITE` (first setup), `TK_ATLASSIAN_AGENT_EMAIL`, `TK_ATLASSIAN_AGENT_TOKEN`, `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN` or `TK_ATLASSIAN_CLOUD_ID`, each named, before any Atlassian call; a 401 (the token, its email, its expiry or the org toggle), the sandbox proxy's 403 (the network approval step) or a scope 403 (a new token), each by name; a key collision with a project setup did not create |
| `tk-studio-orchestrator` | `directory`; `role?`; `target?` (route to act on) | `lib/orchestrate.py resolve` | whatever the routed resource produces; none for resolve alone | `needs-onboarding` (missing role / unconfirmed `working_set.<role>`) — gap named in `reason` |
| `tk-studio-job` | verb (`submit\|status\|resolve\|cancel\|wake`); `directory`; `id`/`job_id`; `run_id?` | `lib/jobrun.py submit\|status\|resolve\|cancel\|wake` (plus `account`/`finish` for the executing wrapper) | run workspace `~/.tk-studio/projects/<key>/runs/<run-id>/`; `job-run` ledger events; `resolve` is read-only — declared jobs served fully resolved, no artifacts | unknown or invalid job id (a stop-condition refusal is `accepted: false`, an answer — not blocked; `resolve` of an unknown id is a named refusal) |
| `tk-studio-plan-sync` | `directory`; `backend?` (runtime override); `dry_run?`; `normalize_only?`; `setup?` (0.1.26, with `owner_account_id?` / `owner_email?`); `publish?` (0.1.26, Story 31.3, with `dry_run?` and `attachment_max_bytes?`, the site's Attachment maximum size in bytes → `--attachment-max-bytes`, the effective ceiling never above 100 MB); `sync_back?` (0.1.26, Story 31.4, with `dry_run?`) | `lib/plansync.py sync|normalize|setup|publish`; `lib/plansync.py sync-back` (0.1.26, Story 31.4) | normalized planning artifacts, backend projection (`backlog/` locally; Jira issues under the `jira` binding, AD-7); the result names every file the run wrote — `written[]` (counter, entity files, story-file stamps, projection writes with their canonical snapshot rewrites, index) plus `removed[]` (projection files replaced on rename), with `normalize.counter` naming the committed id counter; a projection-blocked run still names normalize's landed writes — commit staging derives from the response alone | duplicate id (blocks until renumbered, AD-4); `jira` binding preflight failure — missing `planning.jira.site`/`project_key`, missing credentials — the `TK_ATLASSIAN_*` agent seat through the `api.atlassian.com` gateway (`TK_ATLASSIAN_AGENT_EMAIL`, `TK_ATLASSIAN_AGENT_TOKEN`, `TK_ATLASSIAN_CLOUD_ID`; either agent token set without the cloud id refuses by name, never the site URL), or with `TK_ATLASSIAN_AGENT_TOKEN` unset the legacy `JIRA_EMAIL`/`JIRA_API_TOKEN` against the site URL (0.1.26) — a 401 (token, its email, its expiry or org-admin toggle), the sandbox proxy's 403 (the network approval step) or another 403 (the missing scope, a new token), or an issue-type scheme missing a default-mapping target — every gap named, never a silent 401 (AD-7/AD-11). A both-changed promote/pull-back conflict does **not** block: the run ends `partial` with each conflicted entity named in `reason` — a human picks a side by editing one file, then reruns sync (AD-5). `setup` (0.1.26) ends `blocked` on an unregistered project, an absent agent-seat variable (each named, no Atlassian call) or a key collision, and `partial` — never `complete` — while any step the API refused is left to the owner as a numbered step; a dry run that would create anything ends `partial` and names those items in `would_create[]`; a `blocked` setup still lists in `owner_steps[]` (and `reason`) any step the API refused before the error; a `blocked` setup that created an item or left a project or space create to the owner still writes the keys it recorded, naming the config in `written[]`; a key is recorded only for an item found without collision, created, or left to the owner; the 'Needs you' filter is shared with the project, so while the project is an owner step it is created by the rerun; `publish` (0.1.26, Story 31.3) ends `blocked` on an absent `TK_ATLASSIAN_AGENT_EMAIL`, `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN` or `TK_ATLASSIAN_CLOUD_ID`, no `planning.confluence` binding (run `plansync.py setup` first), a bad `--source` or two sources with one title — each named, no Atlassian call — or on the 401/403 split above, and `partial` when a category's folder is not recorded (the category named in `skipped[]`), a page or an image is refused (an image over the per-file ceiling is named in `refused[]` and its page still publishes) or a dry run would publish anything (`would_publish[]`); an unchanged page is named in `skipped[]` and `found[]`, never written; `sync-back` (0.1.26, Story 31.4) ends `blocked` on no `planning.jira` binding or an absent Jira variable — each named, no Atlassian call — or on a failed preflight (unreachable, deactivated, the 401/403 split, or a preflight answered with another, non-auth status: run case `error`), and `partial` on an absent `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN` (the Jira half still runs, the mirror skipped), an unrecorded `planning.confluence.space_id` (the mirror skipped), no recorded owner accountId (comments, attachments and the mirror skipped by name), a conflict, or a 429 or error that interrupted a read (the cursor unchanged, `RateLimit-Reason` named); no recorded owner accountId also leaves the cursor unchanged; it writes only `_bmad-output/tracking/`, `kb/confluence/`, entity `status` (stamping `updated`) with its `external.jira` snapshot, `plan/index.md` (regenerated local-only when a status changed) and (0.1.27, Story 32.4) an engagement's `scope.md` with its record's `scope_page.version` — the engagement scope mirror reads each record's `scope_page.id` page by id and mirrors a version above the recorded one as Markdown into `kb/confluence/<slug>.md` (the header plus `engagement`, state under `sync-state.json` `engagement_pages`), replacing `scope.md` wholesale while the engagement is `scoping` (any other state: the mirror only and one `notes[]` line per version, no state moves; a 404 a note; counts `engagement_pages_mirrored` and `scopes_replaced`) — names each in `written[]`, and never runs promote; it reads one paged JQL search per tick, never a GET per issue — only an issue whose `comment.total` exceeds the comments the search returned pages `GET /rest/api/2/issue/{key}/comment` (overflow only) |
| `tk-studio-track` (0.1.26, Story 31.5) | verb `block` (or, 0.1.27, Story 32.3, `block` with `engagement` (`ENG-NNN`, exclusive with `story`, implying `source: engagement`, no `reason` or `resolves`; Story 32.6: `kind?` (`questions` \| `cap` \| `ask`, default `questions`) with `reason` for `cap` and `ask` only) and `dry_run?`; or `close`, 0.1.27, Story 32.3: `directory`; `engagement`; `dry_run?`; or `reply`, 0.1.26, Story 31.6: `issue`; `body` (written to a temp file, `--body-file`) \| `done?`; `dry_run?`; or `validate`, 0.1.26, Story 31.7: `issue`; `check?` \| `pass?` with `to` (`To Do` \| `In Progress`) and optional `ruling` (temp file, `--ruling-file`) with `spec` \| `fail?` with `follow_up` (temp file, `--follow-up-file`); `dry_run?`); `directory`; `story` (an entity id, or a loop story key `N-M-slug` matched by `source: epics.md#story-N.M`); `reason`; `resolves`; `source?` (`run` \| `engagement`, default `run`); `dry_run?` | `lib/track.py block`; `lib/track.py reply` (Story 31.6, host-only); `lib/track.py validate` (Story 31.7, the agent seat); `lib/track.py block --engagement` and `lib/track.py close` (Story 32.3, the agent seat) | the story's Jira issue and each dependent's (the entities whose `depends_on` names it) moved to `Blocked - Awaiting User` by transition name through `lib/jirabackend.py` (AD-4), each with one agent comment that @mentions the owner (`[~accountid:<owner>] Blocked: <reason>`, `Resolves when: <resolves>`, a dependent's `Blocked by: <key>`); a transition or comment already in place is skipped and named in `skipped[]`; the result `{ok, dry_run, story, source, issues[], notes[], written[]}` with the §3 block last; no local file written, nothing else promoted (D9) | no `planning.jira` binding or an absent `TK_ATLASSIAN_AGENT_EMAIL`, `TK_ATLASSIAN_AGENT_TOKEN` or `TK_ATLASSIAN_CLOUD_ID` — each named, no Atlassian call; no recorded `planning.jira.owner_account_id`; a story with no plan entity or never promoted (no `external.jira.key`); no transition reaching `Blocked - Awaiting User`, or the story's block comment refused by name after it moved (its entry keeps `transitioned: true`); the adapter's 401/403 split. A dependent that fails while the story's issue was blocked ends `partial`; a dependent already `done` or `dropped` is skipped, named in `notes[]`. A temporary failure on the story's own issue, or on a dependent's after the story's issue was blocked (an exhausted 429, a 5xx, the site unreachable), is no refusal: it ends `partial` with `ok: false` and the additive `retry: true`, and the caller calls again on its next pass; the comment is skipped only when the issue was already in the status before the run and its newest agent comment (read live; agent is anyone not the owner) has the same body; `reply` (Story 31.6) posts the owner's comment with the owner seat (`TK_STUDIO_ATLASSIAN_OWNER_EMAIL`, `TK_STUDIO_ATLASSIAN_OWNER_TOKEN`, the `TK_ATLASSIAN_CLOUD_ID` gateway) and moves the issue by name to `Block Resolved` (already there: skipped, named in `skipped[]`), the result `{ok, dry_run, issue, commented, comment_id, transitioned, notes[], skipped[], written[]}` with the §3 block last, and ends `blocked` by name on an absent owner variable or cloud id or no binding (no Atlassian call), no recorded owner accountId, a created comment not authored by the owner (nothing moved) or no transition reaching `Block Resolved` (`commented: true`), `partial` with `ok: false` and `retry: true` on a temporary failure; `validate` (Story 31.7) reads the changelog by status name (`owner_resolved` only for the newest transition into `Block Resolved` by the recorded owner accountId), marks the inbox item `validating` (`--check`), writes a ruling into the paused spec and moves the issue by name to `To Do` or `In Progress` (`--pass`) or re-blocks it with the follow-up (`--fail`), appending one `validation.jsonl` line per outcome, the result `{ok, dry_run, issue, mode, entity, story, owner_resolved, transition, reason_comment, replies[], notes[], written[]}` (plus `outcome` on a pass or fail) with the §3 block last, and ends `blocked` by name on a bad key, no binding or an absent agent variable (no Atlassian call), no recorded owner accountId, a live status other than `Block Resolved`, no transition reaching the target, or an absent spec or block for the ruling, `partial` with `ok: false` and `retry: true` on a temporary failure (no line); `block --engagement` (Story 32.3) finds the issue by its exact summary `ENG-NNN: questions` in `planning.jira.project_key` (`GET /search/jql`) or creates it (`POST /issue`, type `Task`, label `tk-studio-engagement`), moves it to `Blocked - Awaiting User` by name with the same skip rules and comments the record's open questions (`[~accountid:<owner>] Blocked: ENG-NNN needs <n> answer(s)`, `Resolves when: reply with one "<id>: <option>" line per question`, then per question `<id>: <text>`, `Impact: <impact>` and its options `- <label>`, ` (default)` on the default), the result `{ok, dry_run, story: null, engagement, source: "engagement", issues: [{issue, created, transitioned, commented, skipped?}], notes[], written: []}`, and ends `blocked` by name on `EngagementNotFound`, `NoOpenQuestions`, `IssueCreateRefused` (a 400 on the create) or `EngagementLockUnwritable`; Story 32.6's `--kind cap` (the engagement reached its cap) and `--kind ask` (a story landed under `ask` autonomy) need no open questions and block the same issue with the 31.5 prefix kept (`[~accountid:<owner>] Blocked: ENG-NNN <the reason's first line>`, ``Resolves when: reply with `go {cap}` from the web or the API, or `cancel` `` or ``Resolves when: reply `continue` to run the next story``, then the reason's other lines, the figures), the result carrying `kind`, refused by name `UnknownKind` (any other kind) or `ReasonMissing` (`cap` or `ask` without `--reason`), and `--reason` with `--kind questions`, or `--kind` with `--story`, refused as a flag mix; `close` (Story 32.3) moves that issue by name to `Block Resolved`, then `Done` (a move already in place named in `skipped[]`), the result `{ok, dry_run, engagement, issue, moved[], skipped[], notes[], written: []}`, `EngagementNotFound` `blocked` when the engagement directory is absent, `NoIssue` `blocked` when the issue is absent, `NoTransition` `blocked` when no transition reaches `Done`, or `Block Resolved` from `Blocked - Awaiting User` (an issue never blocked, e.g. at `To Do`, skips `Block Resolved` when no transition reaches it, named in `skipped[]`), `EngagementLockUnwritable` `blocked` when the lock cannot be written; both hold `_bmad-output/engagements/<id>/track.lock`, a lock already held ending `partial` with `retry: true`, and both end `partial` with `ok: false` and `retry: true` on a temporary failure |
| `tk-studio-engage` (0.1.27, Story 32.2) | verb `reply` (or `questions`, 0.1.27, Story 32.3: `project_root` as `--directory`; `engagement`; `run_id`; `questions` (a JSON array of `{id, text, options: [{label, default?: true}], impact}`, written to a temp file, `--questions-file`); `dry_run?`); `project_root` (the served registry root, as `--directory`; never `directory`, the run's worktree); `engagement` (`ENG-NNN`); `run_id` (the write); `body` (written to a temp file, `--body-file`); `proposals?` (a JSON array of `{verb, payload, label}`, written to a temp file, `--proposals-file`); `dry_run?`. or `scope`, 0.1.27, Story 32.4: `project_root` as `--directory`; `engagement`; `scope_file?` (default the engagement's `scope.md`) or `revise_at` (the supervisor's scope pass only, `--revise-at`); `dry_run?`. Stories 32.5 to 32.8 add the verbs `quote` and `closeout`. or `quote`, 0.1.27, Story 32.5: `project_root` as `--directory`; `engagement`; `seed?` (`--seed`, an integer `0 <= seed < 2**53`, exact as a JSON number; default the first 6 bytes of `sha256("<engagement>:<n>")`); `dry_run?`. or `closeout`, 0.1.27, Story 32.8 (the supervisor's closeout pass only, never the planner): `project_root` as `--directory`; `engagement`; `input` (the supervisor's composition `{run_id, outcome_hint, runs: [{run_id, job, state, studio_run_id, cost_usd, pr}], stories: [{key, run_id, spec_status, pr, pr_state}], epics: [{job, queued}], side_exits: [{at, to, verb, reason}], spend {planning_usd, runs_usd}, quote}`, written to a temp file, `--input-file`); `dry_run?` | `lib/engage.py reply`; `lib/engage.py questions` (Story 32.3); `lib/engage.py scope` (Story 32.4); `lib/engage.py quote` (Story 32.5); `lib/engage.py closeout` (Story 32.8) | with no `--body-file`, read-only: the memory `{record, chat[], memory {plan, kb, confluence}}` — the record (`engagement.yaml`, JSON text), the whole chat and three root-relative indexes of `_bmad-output/planning-artifacts/`, `kb/` (without `kb/confluence/`) and `kb/confluence/`, `{root, files: [{path, bytes, title}], truncated}` each (never a file's body); with `--body-file … --run-id`, the planner's line `{seq, at, author: "planner", body, run_id, proposals[]}` appended to `_bmad-output/engagements/<id>/chat.jsonl` under `chat.lock` (the next `seq`), named in `written[]`; the planner moves no state | a bad id (`BadEngagement`), no record (`UnknownEngagement`), a record that is not JSON or not the engagement's (`EngagementRecordUnreadable`), a terminal engagement (`EngagementClosed`), an empty or oversize body (`BodyEmpty`, `BodyTooLarge`, at most 32 KiB UTF-8), no `--run-id` (`RunIdRequired`), a proposal whose verb is not one of the six inputs, whose payload fails that verb's typed rules or whose `label` is empty or over 80 characters (`ProposalInvalid` naming the index), the chat lock held past the wait (`ChatBusy`), the chat not UTF-8, or the lock or chat file refused by the OS (`ChatUnwritable`); nothing is appended on a refusal, a dry run ends `partial`; `questions` (Story 32.3) writes `_bmad-output/engagements/<id>/questions.json` `{run_id, at, questions[]}` atomically (1 to 3 questions, each `id` matching `^[a-z0-9][a-z0-9-]{0,15}$` and unique, `text` and `impact` non-empty, 2 to 6 options with unique labels and exactly one `default: true`), named in `written[]`, the planner still moving no state (the supervisor applies the file once per `run_id`), and refuses by name `TooManyQuestions` (a fourth), `QuestionInvalid` (naming the index), `NotIntake` (any state but `intake`), `EngagementClosed` and `RunIdRequired`, nothing written on a refusal; `scope` (Story 32.4) writes `_bmad-output/engagements/<id>/scope.md` under `scope.lock` and publishes the page `ENG-NNN: Scope of Work` in `Engagements/ENG-NNN` (provenance footer; `page.action` `created`, `updated` or `skipped` when the remote content hash matches and the page is still at the recorded `scope_page.version`; an owner's newer version is overwritten, local wins), merging only `scope_page {id, url, version}` and `updated` into the record: `{ok, dry_run, engagement, mode: "scope", source: planner \| revise, scope, page {id, url, version, action}, written[], notes[]}`, nothing under `plan/`, `_bmad-output/planning-artifacts/` or `.tk-studio/`; it refuses by name `DeliverableWithoutSignal: <title>`, `ScopeInvalid: <what>` (a section missing, empty, out of order or unknown; an undated dependency; no proposed story; an image), `AssumptionUnstated: <question id>`, `NotScoping`, `EngagementClosed`, `ReviseNotFound`, `ConfluenceUnbound`, `ConfluenceEnvMissing` (each absent agent-seat variable named), `PublishRefused` and `ScopeUnwritable: <path>: <error>` (`scope.md`, the record or `scope.lock` refused by the OS; `written[]` names what had already landed), nothing written on a shape or state refusal; a 429, a 5xx or a held `scope.lock` (`ScopeBusy`) ends `partial` with `retry: true` (`scope.md` kept, `scope_page` unchanged); only the planner's scope is shape-checked — a `revise` body (`--revise-at`) is taken verbatim; `quote` (Story 32.5) merges only `quote {band50, band85, band95, cap, basis, computed_at}` and `updated` into a fresh read of the record and writes `epics.<EP-NNN>.usd_estimate` into `.tk-studio/budget-bands.yaml` (every byte outside the top-level `epics:` block kept, other epics' entries kept, this quote's entries overwritten; no `epics` band when `basis.epics[].ep_id` is `null`, an unreadable `.tk-studio/plan-counter.yaml`), named in `written[]`, holding `scope.lock` from its read of `scope.md` through the merge: `{ok, dry_run, engagement, mode: "quote", quote, bands, written[], notes[]}` (`quote` the computed `{band50, band85, band95, cap, basis, computed_at}`, also on a dry run, `null` on a refusal before it is computed; `bands` `{EP-NNN: usd}`, the estimates written, present once computed); the state does not move (the owner's `go` moves `scoping → quoted`); it refuses by name `BadSeed` (a `--seed` outside `0 <= seed < 2**53`), `NotScoping`, `EngagementClosed`, `NoScope` (no `scope.md`, no proposed story, a repeated `### Epic <k>` number, or proposed epics not numbered 1..m in order), `PricesUnreadable` and `QuoteUnwritable` (the record or the bands refused by the OS, an unparseable `budget-bands.yaml`, a top-level `epics:` scalar other than empty, `~`, `null` or `{}`, an unreadable `measurements/`, or a held `scope.lock`: `scope.lock is held`; `written[]` names what had landed), nothing written otherwise; a dry run ends `partial`; `basis.notes` is a list of strings; a `scope.md` replaced in `scoping` (by `scope`, its `revise` body, or the sync-back's page revision) voids a non-null `quote` first (`quote: null` and `updated` merged before `scope.md` is replaced; a failed void refuses `ScopeUnwritable` from `scope` and, from the sync-back, which never raises, ends not applied with `retry: true`, `scope.md` untouched either way; the sync-back's `written[]` names a void that landed before a later failure); a page version whose Markdown equals `scope.md` replaces nothing and keeps the quote, its `scope_page.version` still merged; `closeout` (Story 32.8) writes `_bmad-output/engagements/<id>/closeout.md` atomically — the `##` sections `Outcome`, `Deliverables` (each `### <title>` of `scope.md`'s `## Deliverables` with `Acceptance signal:` and `Verdict: done \| not done — <why>`, the why the first of `no acceptance signal`, `epic not run`, `story <key> not landed`, `PR <url> not merged`; a deliverable's stories the proposed stories naming its title, else every proposed story; owner text unchecked: the signal line, else any line naming `acceptance signal`), `Pull requests`, `Cost per story` (`story \| run \| tokens \| usd` from the meter records by `story_key`, the runs' `job-run` cost, `—` unmetered), `Spend`, `Quote against actual` (`band50`/`band85`/`band95` usd, the cap, the actual, the band hit) and `Side exits` — publishes it as `ENG-NNN: Closeout` in `Engagements/ENG-NNN` (provenance footer; skipped when the footer hash and the recorded version match; no Confluence binding, an absent agent-seat variable or a refused write: `page: null` with a note, never a refusal) and merges only `closeout {path, page {id, url, version} \| null, outcome, done, not_done, run_id, at}` into a fresh read of the record: `{ok, dry_run, engagement, mode: "closeout", outcome, page, closeout, done, not_done, written[], notes[]}` (`outcome` every deliverable done `delivered`, else the last run `blocked` `failed`, else `partial`); the state does not move (the supervisor applies `run-ended`); it refuses by name `NoScope`, `EngagementRecordUnreadable`, `CloseoutInputInvalid` (the input not a composition, or not JSON), `NotInProgress` (any state but `in-progress` or `partial`) and `EngagementClosed`, nothing written; a 429, a 5xx or an OS refusal ends `partial` with `retry: true`; a dry run ends `partial` |
| `tk-studio-migrate` | verb (`run\|status\|clear`); `directory`; `dry_run?` (run); `confirm?` (clear — the recorded operator clearance) | `lib/migrate.py run\|status\|clear` | closed inventory + migration record `.tk-studio/migrations/jira.json` (id map, hashes, verification, clearance state); Jira issues imported via the adapter; cutover flag (`planning.backend: jira` in tracked config) written last; source projection retained read-only | nothing to migrate; canonical export invalid; jira preflight failure (named, AD-7); **any verification mismatch** — counts, id map, content hashes, or spot round-trip — with each discrepancy listed (AD-16); cutover flag overridden by a local overlay; `clear` without `confirm` (no-delete-before-clearance) |
| `tk-studio-research` | `charter` (`{topics[], sources[], max_findings?, notes?}`); `directory`; `run_id?` (job runs) | `lib/research.py charter\|record\|seed\|spine` | `findings.json` + `findings.md` in the run workspace (a finding optionally cites a seed `anchor` — dangling citations are named rejections, per `knowledge.schema.json`); `seed.md` in the run workspace and the project spine `knowledge/spine.md` in the per-user store (aid, not gate — a missing spine is reported, never blocking; anchor ids append-only); `observation` ledger events for recommendation-carrying findings | charter missing/unscoped; run already terminal; invalid knowledge artifact (frontmatter, supersede header, anchor grammar — named rejection) |
| `tk-studio-session` | verb (`handoff\|resume`); `directory`; run selection: exactly one of `run_id` \| `job_id` (`job_id` resolves the job's sole resumable run — zero or several is a named refusal); handoff: `boundary` (`epic\|story\|phase`), `name`, `done[]`, `next[]`, `gotcha?[]`, `artifact?[]`, `delta?[]` (the `knowledge.schema.json` delta shape) | `lib/session.py handoff\|resume` | `handoff.json` in the run workspace — 16 KB budget, one per run, overwritten per boundary; a delta-carrying boundary also captures into the per-project reconciliation queue (best-effort — the handoff never fails on a capture problem); `resume` answers from the workspace alone | unknown or terminal run; ambiguous `job_id` resolution; handoff over the 16 KB budget or the 16-delta cap; dangling, unanchored, or within-handoff-duplicate deltas — named rejections (only the delta-carrying handoff refuses; the run stays resumable and a delta-free handoff always lands) |
| `tk-studio-knowledge` | verb (`check\|draft\|emit`); `directory`; draft: `base?`, `dry_run?`, `no_pr?`, `redraft?`; emit: `dry_run?` | `lib/promote.py check\|draft\|emit` | draft: ONE new dated `kb/reconciliation-<date>.md` on the stable branch `knowledge/<user>-<machine>` + the membrane PR (review is the gate — never a base push, never a merge, nothing auto-applies; D3/AD-12) and a draft line in the per-user promotions record; emit: one `knowledge-promotion` ledger event per batch of newly-merged drafts (at the skill's cadence, one per merged promotion PR), sole emitter this surface, reconciled against the promotions record — exactly-once per draft, never a duplicate (a draft emits nothing) | no routing doc (named rejection — the routing doc is the human's promotion-decision surface); not a git work tree; dirty tree; diverged promotion branch; detached HEAD; sanitization finding (NFR5, blocks pre-commit) |
| `tk-studio-consolidate` | `directory` (studio repo root); `dry_run?` | `lib/consolidate.py run` | `issues/ledger.md` synced in place (stable `ISS-NNN` rows: severity, status, expected-vs-actual, named evidence events, fix candidates — never a deleted row); no ledger events (derives, not emits — AD-12) | directory missing; measurements outside the studio repo (AD-3); unparseable issues ledger (refuses to rewrite what it cannot update in place) |
| `tk-studio-measure-push` | `directory` (studio repo root); `base?`; `dry_run?`; `no_pr?` | `lib/measurepush.py check\|push` | feature branch `measurements/<user>-<machine>` + membrane PR updating `measurements/<user>-<machine>.jsonl` — no ledger events (a mover, not an emitter, AD-12); never a base-branch push, never a merge | not the studio repo root; dirty working tree; sanitization re-check finding (credential-shaped content blocks pre-commit) |
| `tk-studio-observe` | `source` (`retrospective\|repeated-manual-work\|research-job\|other`); `description`; `evidence?`; `project?` | `lib/observe.py record` | ledger line (`observation` event; 0.1.27, Story 32.5: the trial meter's record also carries the optional `kind`, `story_key`, `epic`, `usd`, `legs`, `route` and `prices_date` fields of `events/taxonomy.v1.json`, through `record_observation`'s `fields`; the CLI is unchanged) | required field missing |
| `tk-studio-evolve` | verb (`draft\|status`); `directory` (studio repo root); `dry_run?` (draft) | `lib/evolve.py draft\|status` | `proposals/ledger.md` synced in place (stable `PROP-NNN` rows: impact, status `Draft\|Under-review\|Adopted\|Declined`, evidence naming events and issues-ledger cross-links, the candidate change the observation itself states — never one invented, never a deleted row); drafting triggers nothing beyond the ledger sync — documents only, adoption is human (D1/AD-8); no ledger events (derives, not emits — AD-12, D2); a run that leaves `stranded` rows (a cluster merge) ends `partial` with the ids in `reason` | directory missing; measurements outside the studio repo (AD-3); unparseable proposals ledger (refuses to rewrite what it cannot update in place) |
| `tk-studio-report` | `description`; `surface?`; `project?`; `skill?`; `mode` | `skills/tk-studio-report/scripts/` | ledger line (`report` event) | `description` missing |
| `tk-studio-launch` | verb (`start\|status\|stop`, default `start`); `directory` (the main checkout); start: `epic` or `spec_folder?` (default `_bmad-output/specs/spec-epic-<N>` — the core's `--epic` applies the same default; `--spec` wins when both are given), `story?` (first story, `<epic>-<story>`; the skill derives it from the epic context / epics file when absent — never the core), `bootstrap?` (default true; skill-level only), `allow_budget_mismatch?` (0.1.21; default false — the core's `--allow-budget-mismatch`); status/stop: `run_id?`; stop: `graceful?` | `lib/launch.py check\|start\|status\|stop`; `lib/pipeline.py defaults\|check\|resolve\|apply` (0.1.15 — the per-leg route, §5) | start: the routed policy block, subagent-model line and `.bmad-loop/routing.current.json` (`pipeline.py apply`, 0.1.15), the substrate run dir `.bmad-loop/runs/<run-id>/` (engine detached, console-less; its output in the per-user store `projects/<key>/launches/<run-id>.log`), plus any `SPEC.md` (via the project's `bmad-spec`) and `plans/<epic>-<story>.md` + `stories.yaml` entries (via the project's `.bmad-loop/plugins/studio-pipeline/task-planning.md`) the planner-tier preparation wrote; `status` is read-only (live runs, per-task phase/attempt/cycle, pause facts, tokens); no ledger events of its own — the `run-epic` job wrapper emits `job-run` (AD-12) (0.1.21) **bootstrap commit:** files the bootstrap wrote are committed on the checkout's current branch in one commit (that branch is the run branch — `loop/epic-<N>` by convention; its name is never checked or switched), message exactly `loop(epic-<N>): SPEC, manifest and first-story plan from the launch bootstrap`, after the task bootstrap and before the readiness check — only those files, none on a relaunch, never pushed. **Every path ends with the block:** each `launch.py` result (`check`, `start`, `status`, `stop`, and the exit-2 refusal `{ok: false, error, …}`) ends with `status, intent, artifacts, reason`; `check` is `complete`, `partial` naming each `budget_mismatch`, or `blocked` naming its gaps; `start` is `complete` with `artifacts` = [`run_dir`, `spec_folder`] (never `run_dir_abs` or the store log) or `blocked`; a relaunch (stories already `done`, route already applied) ends on the same block as a fresh launch; the watch hint names the supervisor's status page, the `status` verb and `bmad-loop tui`. **Budget check:** `check` and `start` carry `budget: {compared[], budget_mismatch[], not_compared[]}` — the largest band's `weighted_tokens` against `max_tokens_per_story` and `review_cycles_max` against `max_review_cycles`, each mismatch `{limit, policy, band, band_field, band_value}`; limits with no band field (`session_timeout_min`, `max_tokens_per_session`, `max_followup_reviews`) are `not_compared`, and so is a compared limit when any band carries its field with a non-numeric value (reason names the band and field, e.g. `band L weighted_tokens not a number`), and so is a compared limit the policy omits or gives a non-numeric value (reason `absent from policy` / `not a number in policy`); a missing or unparseable input is a named `budget` check entry; a mismatch is never a gap (`ok` unchanged); the `[limits]` of `.bmad-loop/policy.toml` are read only, never edited by the budget check or the launch core (the only launch writes to that file are the routing step's managed block and, 0.1.28, `check`'s `[verify] commands` reconciliation). **Verify commands (0.1.28):** `check` reconciles the policy's `[verify] commands` from the tracked list (`.tk-studio/config.yaml` `engine.verify_commands`, else `plugins/tk-studio/pipeline/verify-commands.toml`) — missing commands appended, the operator's kept — reported in the `verify commands` row and `verify_commands {source, tracked[], added[], kept[], policy}` on every `check` result; an unreadable or unplaceable source or policy is a gap (`engine.verify_commands` is the in-sandbox list; the host leg's engine gate is the separate `verify.engine` key, 0.1.29, Story 34.1: two keys, never merged) | a readiness gap the session may not close: a live engine already owning the checkout (one engine per checkout — never stopped to make room), `bmad-loop` not on PATH, a failing `bmad-loop validate` (dirty tree, broken policy); a `verify commands` refusal (0.1.28: a tracked list or `.bmad-loop/policy.toml` that does not parse, is not a list of strings, or whose `[verify] commands` cannot be located — the file named, fixed by hand); with `bootstrap` false, a missing `SPEC.md` or empty manifest; the project's `bmad-spec` skill or task-planning instructions absent; a launch the engine never acknowledged (no `state.json` within the wait — pid and log named); a `budget_mismatch` at `start` without `allow_budget_mismatch` (exit 2, both numbers named); a `start` refusal after its readiness check that found a mismatch also carries the readiness `budget` object, before the block keys (other refusals keep `{ok: false, error}` + the block) |

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
- **The shipped `validate-resolution` job (0.1.26, Story 31.7):** a
  one-shot skill target on `tk-studio-track` with `payload.verb:
  validate` (guards `max_turns` 60 and `max_wall_clock_seconds` 1800,
  `stop.until: 9999-12-31T23:59:59Z` — never `on_status`, so one blocked
  validation never halts every later one — effort `high`, no `model`), shipped
  undeclared. The supervisor's resolution pass enqueues it with the
  payload `{verb: "validate", project_root, issues: [{issue, story,
  paused_run, spec}]}` and the run options `tier: host` plus the served
  project's planner leg's model and effort, recording one `validate-queued`
  service event per block cycle key `(project, issue, reason_comment.id ??
  blocked_since)` from the `resolved` (or `validating`) inbox items. When
  that run is terminal with no `validation.jsonl` line newer than its
  creation, the pass records one `validate-expired` service event `{key,
  run_id, issue, state}` and queues the key again — at most 3 times: a key
  with 3 `validate-expired` events stays recorded and records no further
  expiry (only a re-block, a new agent `Blocked:` comment, is a new key).
  After a `pass` line the pass resumes the paused run, recording one
  `validate-resumed` service event; a `ResumeFailed` refusal is retried on
  later passes, at most 3 attempts per run and issue. The session runs
  `track.py validate` per issue and commits nothing; `--pass` refuses when
  `owner_resolved` is false, `--fail` does not.
- **The shipped `engagement-chat` job (0.1.27, Story 32.2):** a one-shot
  skill target on `tk-studio-engage` with `payload.verb: reply` (guards
  `max_turns` 80 and `max_wall_clock_seconds` 1800, `stop.until:
  9999-12-31T23:59:59Z` — never `on_status` — no `model`, no `effort`),
  shipped undeclared. The supervisor's chat route enqueues one run per
  owner line with the run options `tier: host` plus the served project's
  planner leg's model and effort, opt-in `stack` (a run minted even while
  another run of the job on the checkout is live; it waits on the checkout
  lock, never refused, never adopted — every other caller keeps the
  idempotent mint) and the run's own payload `{engagement, project,
  project_root, seq}` (`project_root` the served registry root, where the
  record and `chat.jsonl` live untracked; the skill maps it to
  `--directory`, never the worktree's `directory`), stored on its
  `enqueued` event and delivered at run start with the run's queue
  `run_id` (the invoke keeps it: it is never replaced by the studio run
  id), recording one `chat-queued` service event `{engagement,
  project, seq, run_id, model, effort}`. At each `finally` site a
  chat-spend pass sums the ledger `job-run` `total_cost_usd` of the runs
  an engagement's `chat-queued` events name (a run with none yet counts 0)
  into its record's `spend.planning_usd`, rewriting the record only when
  the sum changed (from a fresh read right before the write, only
  `spend.planning_usd` merged, so a state change written between the
  pass's first read and that fresh read survives; one written inside the
  remaining window between the fresh read and the atomic rename is not
  corrected — there is no shared record lock yet, left to Stories
  32.5/32.8); it emits no `engagement` event. Every chat `run_id`
  (the `200` answer, `chat-queued`, the payload and the planner line) is
  the queue run id; the spend pass maps it through the run's
  `studio_run_id` to the ledger `job-run` `payload.run_id`.
- **The `{project_root}` core argument (0.1.26, Story 31.4):** an argument
  of a core target's `core[1:]` that is exactly `{project_root}` is
  replaced by the submitting project's root when `submit` or `wake`
  executes the run (the shipped `atlassian-sync-back` job runs
  `lib/plansync.py sync-back --directory {project_root}`); no other
  templating, and a definition without the token runs exactly as before.
  A core run's `summary.json` also names the core's `status`, `counts` and
  `newest_comment` when its result carries them — additive.
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

The AD-13 activation check — six-plane (bmad-base; plugin, read from the
skills-dir folder against the roster; store; vault; tracking, 0.1.26 Story
31.4; sandbox-login, 0.1.28 Story 33.2), loud, read-only (DW-3 wording
fold-in, 0.1.7, then four-plane, five-plane at 0.1.26; folder-and-roster
rule, 0.1.19):

```bash
uv run "$PLUGIN_ROOT/skills/tk-studio-activate/scripts/drift_check.py" --directory <project-root> [--guided] [--channel stable|latest] [--claude-home <dir>]
```

Output (stdout JSON): `{ok, result: "clean"|"drift"|"error", planes: [{plane:
"bmad-base"|"plugin"|"store"|"vault"|"tracking"|"sandbox-login", status,
detail, fix?, case?, last_run?}], fixes: [...], project_root?,
studio_root?, nested?, project_id?}` — `case?` on the plugin, tracking and
sandbox-login planes only, `last_run?` on the tracking plane only. The
plane list is fixed at six, in that order; a consumer that knows five
ignores the sixth. The four optional roots keys (0.1.22) name
the nearest project root `--directory` resolved to (§1 [Project
root](#project-root-0122)), the studio root (`null` when unresolved),
whether the project is nested, and its `project_id`.
The check never mutates; fixes are guidance (`tk install`,
`tk-studio update`, `tk-studio install`), applied only by an operator or an
explicitly invoked skill. Each run emits a `drift-detection` measurement
event (taxonomy §`drift-detection`); `--guided` marks the onboarding-funnel
variant. A driver SHOULD run it at session/connector start and surface
`fixes[]` verbatim.

**The tracking plane (0.1.26, Story 31.4).** It reports the Atlassian
sync-back — when the last tick ran and whether the binding was reachable
(the last tick's observed outcome) — from `.tk-studio/config.yaml` and
`_bmad-output/tracking/sync-state.json` alone, never a network call (the
check stays read-only and `external_calls: false`). Its `case`:
`not-bound` (no `planning.jira` binding; status `ok`), `never-run` (bound,
no state; `missing`, the fix `plansync.py sync-back --directory <root>`
and declaring the `atlassian-sync-back` job), `ok` (the last tick
`complete` or `partial` within 30 minutes), `stale` (older; `drift`),
`token-missing` (the last tick named an absent variable; `drift`, the fix
names it), `unreachable` (a connection error or 5xx on preflight, the
last tick `blocked`; `drift`), `deactivated` (the gateway answered preflight 404 or 410;
`drift`, the fix the owner's sign-in, kb/atlassian-free-tier.md §1 step
10) and `auth` (the 401/403 split; `drift`, the fix its own text) — a
missing token, an unreachable site and a deactivated site are each their
own state, never "no changes". `last_run` carries the tick's record.
That record is `{at, status, case, counts, newest_comment, reason}`; its
`case` may also be `rate-limited` (an exhausted `429`) or `error` (a
non-network request error: a `400` on the search, another `4xx`, a pager
that never ended), which the plane reads as `ok` or `stale` by age and
status, never as a ninth plane case; so does an `unreachable` run case
not on preflight (a later search page's, the comment overflow's or the
mirror's 5xx, the tick `partial`). A recent tick that ended `blocked`
with one of those cases is `stale` with its fix naming the recorded
status, case and `reason`, never "has not ticked".

**The sandbox-login plane (0.1.28, Story 33.2).** It reports the engine
sandbox's Max login: the global `anthropic` sbx secret, renewed from inside
the sandbox with `/login`. The sandboxes are the distinct `jobs.*.sandbox`
values of the supervisor config (`TK_SUPERVISOR_CONFIG`); there is no other
source and no default. The plane runs `sbx daemon status` first and no
other sbx command until it passes, then `sbx ls`, and `sbx exec` only on a
sandbox `sbx ls` lists as running. Through `sbx exec` it reads only
`loggedIn` (`claude auth status --json`, the supervisor's own probe) and
`refreshTokenExpiresAt` from the sandbox's `~/.claude/.credentials.json`
(milliseconds since the epoch), never a token. It reuses the plane statuses,
never a new one; its `case`:

| `case` | Means | `status` | Fix |
| --- | --- | --- | --- |
| `ok` | logged in, more than 7 days before `refreshTokenExpiresAt` | `ok` | — |
| `expiring` | logged in, 7 days or fewer remain (the warning; the detail names the expiry instant), or the expiry could not be read, or the login probe failed | `drift` | `sbx run --name <sandbox>` → `/login` → `/exit` |
| `expired` | the instant has passed, or the sandbox reports logged out (the failed check) | `error` | `sbx run --name <sandbox>` → `/login` → `/exit` |
| `no-sandbox` | no sandbox configured, sbx not on PATH, the daemon down, or the sandbox not running; the detail names which | `missing` | names the condition (a box with no engine is never in error here) |

With several sandboxes the plane reports the worst (`expired` >
`expiring` > `ok` > `no-sandbox`) and its detail names each. The plane
aggregates like every other: its `missing` (`no-sandbox`, a box with no
engine sandbox) and its `drift` (`expiring`) make `result: drift` (exit 1),
like every `missing` or `drift` plane; only its `error` (`expired`) makes
`result: error` (exit 2). Its sbx calls share one total budget (20 s, well
below the conformance runner's 60 s bound), each given the time left; a
spent budget reads `no-sandbox` like a daemon that is down, the detail
naming the timeout. `tk-studio doctor` reads the same way as its
`sandbox-login` check (`pass`, `warn`, `fail`, `skipped`; a spent budget is
`skipped`).

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
