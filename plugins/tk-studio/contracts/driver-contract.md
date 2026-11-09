# tk-studio Driver Contract

| | |
| --- | --- |
| **Contract version** | **0.1.34** (pre-1.0 semver — a new product still stabilizing; see [Change policy](#change-policy). Renumbered 2026-08-07 from the 1.x line, mapped `1.N.0 → 0.1.N` for continuity: 0.1.1 added the `tk-studio-job` surface and the shipped `job.schema.json`, 0.1.2 added `tk-studio-research`, 0.1.3 added `tk-studio-measure-push`, 0.1.4 added `tk-studio-consolidate`, 0.1.5 installed the `jira` planning binding behind `tk-studio-plan-sync`, 0.1.6 added `tk-studio-migrate`, 0.1.7 publishes the Research→Knowledge Lifecycle port (Epic 9): the `tk-studio-session` and `tk-studio-knowledge` surfaces, the research anchor/seed surface, the run-finish capture note, the KB-injection directive, and the `knowledge-promotion` taxonomy event — each additive; 0.1.8 clarifies §2 (the detect row's blocked cell names the in-band `ask` outcome as a refusal; the plan-sync row states both-changed conflicts end `partial`, not blocked) — a clarification, no shape change; 0.1.9 adds `tk-studio-evolve` (EP-010 — the evolve loop's drafting half: merged `observation` events become `proposals/ledger.md` `PROP-NNN` rows; D1 documents only, D2 derive-only with the taxonomy untouched, D3 on-demand verb plus the shipped-undeclared `evolve-proposals` job type) — additive; 0.1.10 clarifies the §2 base-update row (EP-011 ST-043: the install diff commits only after provably churn-only files are reverted, per-class counts in the result JSON `normalized`; a same-version re-affirmation whose diff is empty after normalization ends `complete` reporting the verified no-op — no branch pushed, no PR opened) — a clarification, no shape change; 0.1.11 adds the conformance harness pass (EP-014: `expect: harness-blocked` drives run the surface through the real harness under a denying permission profile and are judged to end in a `blocked` terminal block naming the unrunnable core; opt-in `--harness` because spend-bearing, the report's `harness_pass` field names declared/skipped/ran, and the denied-permissions case for `tk-studio-detect` ships declared) — additive; 0.1.12 adds the `resolve` scheduler verb (EP-015 — PROP-008's resolved-definition read surface: declared jobs served with type extension applied by the studio-side resolver; substrate-side recurring classification reads trigger/cadence from the verb, never from raw `.tk-studio/jobs/<id>.json` instance files) — additive; 0.1.13 adds named-write reporting to the planning adapter result (EP-017 — PROP-020's staging gap: `normalize.counter` names the committed id counter, and `written[]` — normalize-level and the sync-level roll-up over projection and index — names every file a run wrote, counter included, so commit staging derives from the response alone) — additive; 0.1.14 adds `tk-studio-launch` (studio pipeline decision 5, 2026-09-02: the studio's one way to start the execution substrate for a project epic — planner-tier SPEC + first-story task bootstrap, then bmad-loop started detached with a pre-minted run id — plus the shipped `run-epic` one-shot job type) — additive; 0.1.15 adds per-leg execution-pipeline routing to `tk-studio-launch` (§5: `lib/pipeline.py defaults\|check\|resolve\|apply`, the measured pipeline-v2 defaults shipped in the launch resource's `customize.toml` `[pipeline]`, the project overlay `.bmad-loop/routing.toml`, runtime `--set leg.field=value`; the launch flow routes the epic's first story before its readiness check) — additive; 0.1.16 adds the optional `no_normalize` payload to `tk-studio-install` and states its churn normalization (a verified install reverts provably churn-only files and drops installer `*.bak` copies of committed files when the project root is a git top-level with `_bmad/` tracked; paths dirty before the run are never touched; result JSON `normalized` with per-class counts and `remaining`) — additive; 0.1.17 adds studio-managed base patches (BMAD-METHOD#2718: `render_skill.py` halts on a short config token that several modules declare, even with identical values, so bmm + gds cannot render `bmad-build`/`bmad-build-auto`): `tk-studio-install` re-applies every patch declared in `base-patches/patches.json` after verify-at-pin and reports each in the result JSON `base_patches` (`patched`, `applied`, `not-applicable`, or `stale` / `unverified-core` when the upstream text or core version no longer matches — then the file is left untouched), and `tk-studio-activate` reports a missing or stale patch as bmad-base drift — additive; 0.1.18 names the conformant drivers now that ClaudeOS is retired as a driver (ST-062): a driver roster in §1 (the studio supervisor — executing wrapper, status page; Hermes — front door that submits jobs to the supervisor and never executes a run; direct invocation), §2 states the executing wrapper for a run is whichever conformant driver executed its `wake` directive with `account` and `finish` its duty, a §4 `finish` row documenting the optional `total_cost_usd` (ST-061), §1's cross-references corrected (per-skill CLIs in §2, the status block in §3), and the Audience line and §7 rows name the studio supervisor and Hermes in place of ClaudeOS — additive; 0.1.19 moves the drift check's plugin plane to the skills-dir folder and the roster (AD-21, ST-083): §6 states the folder-and-roster rule — the folder `<home>/skills/tk-studio/`'s `plugin.json` against the configured channel's roster `plugin` entry (`--channel`, default `stable`) and, only in a developer checkout, the catalog; the plane's additive `case` field (`ok`, `stale`, `missing`, `shadowed`) with each fix; `installed_plugins.json` read only to detect a shadowing marketplace copy — and §8 documents the conformance runner's `--from-archive <zip>` and the report's `harness_loadable` field — additive; 0.1.20 adds the conformance suite's meta-CLI drive (ST-085): §8 documents the manifest's `cli_drives` section, outside `surfaces`, and the report's top-level `cli_drives` field — the CLI doctor drive runs `tk-studio doctor --json` from the runner's repository checkout in a throwaway home, and is recorded `not run` with a reason when the checkout's CLI is absent — additive; 0.1.21 (Epic 26) states the `tk-studio-launch` row's launch-owns-its-lifetime rules (Story 26.1): every `lib/launch.py` result, refusals included, ends with the §3 block keys in order so every skill path, fresh or relaunch, ends on the core's block; the skill commits its own bootstrap output before its readiness check; `check` and `start` compare `.bmad-loop/policy.toml` limits read-only with `.tk-studio/budget-bands.yaml` (`budget`, `budget_mismatch[]`), `start` refusing a mismatch unless the optional `allow_budget_mismatch` payload acknowledges it — and §8's `expect: status-block` on surface drives, with an optional declared `status` — additive; 0.1.21 (Story 26.3) also gives every §5.1 routing leg an optional `advisor` (`opus` \| `fable` \| `off`, missing = `off`) under the pairing rule (the advisor must rank at or above the leg's model; a violation is a named refusal), carries `--advisor <value>` on an engine-stage leg's `claude -p` command line only when the advisor is not `off`, and gives subagent legs with no resolved effort the session's (`inherited-session`) — additive; 0.1.21 (Story 26.5) adds the planning adapter's status pull-back (§4 [Status pull-back](#status-pull-back-0121-story-265)): `plansync.py status --directory ROOT --id ST-NNN --status ENUM [--note TEXT] [--caller NAME] [--dry-run]` sets one canonical story's `status`, stamps `updated` and records the caller and note in the entity's `external.driver` snapshot, then re-runs `sync` so the projection and `plan/index.md` follow; status-class only (AD-5), the result's `plan_dir` names the plan it wrote — additive; 0.1.22 (Story 28.2) states the nearest-root rule (§1 [Project root](#project-root-0122)): the drift check, `config.py resolve` and `config.py root`, `plansync.py`, `jobrun.py`, `launch.py` and `observe.py`'s default `--project` resolve the nearest ancestor-or-self holding `.tk-studio/config.yaml` (every other `--directory` surface is unchanged), so a nested studio project (`apps/supervisor`) wins over the outer one and a folder with no config above resolves to itself; creation verbs (`config.py standup`, `registry.py register`) take `--directory` literally; `TK_STUDIO_ROOT` keeps meaning the outer repository root, the plugin's home; `config.py root` prints the resolution, and §6's drift-check JSON gains the optional top-level `project_root`, `studio_root`, `nested` and `project_id` — additive; 0.1.23 (Story 28.6) honours the studio supervisor's starter lock in §4 ([Starter lock](#starter-lock-0123-story-286)): `submit` and `wake` refuse with `StarterLocked` — nothing minted — while a live `~/.tk-studio/projects/<key>/starter.lock` names the queue as the checkout's only starter, the `--force-starter` flag and the `TK_STUDIO_IGNORE_STARTER_LOCK=1` variable override it, and the answer gains the optional `starter_lock` field (`forced` or `stale`) — additive; 0.1.24 (Story 29.4) names the studio web (EP-30) among the consumers in §1 — a consumer, not a driver: the Driver roster is unchanged — and documents the surfaces it reads as supervisor surfaces, never plugin surfaces (§1 [Supervisor surfaces the web consumes](#supervisor-surfaces-the-web-consumes-0124), AD-2): the account (`POST /auth/account`, `POST /auth/signin`), the registry (`GET /agents`) and the office projection (`GET /office`, `GET /office/events`, the event kinds `office.agent`, `office.progress` and `office.run`, the eight states); the plugin publishes their description and neither implements nor serves them, and nothing in the plugin's own surfaces changes — additive; 0.1.25 (Story 30.4) extends the office projection of §1 [Supervisor surfaces the web consumes](#supervisor-surfaces-the-web-consumes-0124) additively: an agent row and the `office.agent` delta carry `reason` (what a `waiting-for-human` or `blocked` agent waits for, `null` otherwise), and the `GET /office` snapshot carries `last_run` (each project's newest terminal run `{run_id, state, pr, ended_at}`), which the `office.run` delta of a run leaving the live set terminal carries too, and a project's changed `last_run` with no leaving run gets an `office.run` with `from` `null`; existing fields, kinds and ids are unchanged; Story 30.5 adds `GET /board` to this same 0.1.25 entry; supervisor surfaces, never plugin surfaces, and nothing in the plugin's own surfaces changes — additive; 0.1.25 (Story 30.5) adds the board read `GET /board?project=<id>` to §1 [Supervisor surfaces the web consumes](#supervisor-surfaces-the-web-consumes-0124): a served project's plan epics and stories with their canonical statuses, each story's latest run and open deferred-work findings, per epic the metered `job-run` spend against an optional band, and the Needs-you / Working / Done triage of its runs; no second version bump, a supervisor surface, never a plugin surface — additive; 0.1.25 (Story 30.6) makes the web the home and moves the read-only status page in §1 [Supervisor surfaces the web consumes](#supervisor-surfaces-the-web-consumes-0124): a signed-in `GET /` answers the built web's `index.html`, falling back to the read-only page when the web is not built, the read-only page is at `GET /status` (content-negotiated: `Accept: text/html` the page, any other `Accept` the unchanged `/status` JSON), and the office snapshot carries `supervisor` `{version, counts}` and `ledger` (the host ledger's last lines, redacted), never on a delta; no second version bump, supervisor surfaces, never plugin surfaces — additive; 0.1.26 (Story 31.2) opens Epic 31's entry: the planning adapter gains the `setup` verb, `plansync.py setup --directory ROOT [--dry-run] [--owner-account-id ID | --owner-email EMAIL]`, which creates a registered project's Jira project from the studio template (key from the project id; issue types Epic and Story; the statuses `Blocked - Awaiting User` and `Block Resolved` with their transition), the "Needs you" filter and the linked Confluence space with its five design-page folders, records the keys and ids under `planning.jira` and `planning.confluence` in tracked config, and ends `complete`, `partial` (the owner's numbered steps in `owner_steps[]` and `reason`) or `blocked`, with `found[]`, `created[]` and `written[]` (and `would_create[]`, dry run only) and the §3 block last; a `blocked` setup still lists in `owner_steps[]` (and `reason`) any step the API refused before the error; a `blocked` setup that created an item or left a project or space create to the owner still writes the keys it recorded, naming the config in `written[]`; a key is recorded only for an item found without collision, created, or left to the owner; the 'Needs you' filter is shared with the project, so while the project is an owner step it is created by the rerun; `tk-studio-onboard` gains the optional `tracking` payload that runs it; the Jira binding moves to the `TK_ATLASSIAN_*` agent-seat names through the `api.atlassian.com` gateway (`/rest/api/2` kept), `JIRA_*` and the site URL staying the legacy fallback when `TK_ATLASSIAN_AGENT_TOKEN` is unset; existing verbs and fields are unchanged — additive; 0.1.26 (Story 31.3) adds to this same entry the planning adapter's `publish` verb, `plansync.py publish --directory ROOT [--dry-run] [--source CATEGORY=PATH ...] [--attachment-max-bytes N]`, which converts each design page (brief, GDD, scope of work, decisions; never the records folder) from Markdown to Confluence storage format and creates or updates it by the stable title `<Folder>: <slug>` in the folder `planning.confluence.folders.<category>` records, with a provenance footer naming the source file and the last commit that touched it and a content hash over the title, the storage body and each attachment's sha256, so an unchanged page is skipped; images are attached (PNG re-deflated losslessly) and any over the per-file ceiling (the supplied site setting or 100 MB assumed, capped at 100 MB) is refused by name while its page still publishes (an image outside the project root, by an absolute path, a non-http(s) scheme or a symlink, is refused by name before any read, the same way); the driver supplies the site setting as the plan-sync payload `attachment_max_bytes?`; the result names `found[]`, `created[]`, `updated[]`, `skipped[]`, `refused[]`, `would_publish[]` (dry run), `bytes_uploaded` (against Confluence Free's 2 GB), `notes[]` and `written[]` with the §3 block last, and ends `blocked` (an absent agent-seat Confluence variable, no `planning.confluence` binding, a bad `--source` or a duplicate title, each named before any call), `partial` (a category with no folder, a refused page or image, or a dry run that would publish) or `complete`; it writes `.tk-studio/confluence-pages.json` (ids and paths only), from which the `jira` promote ends every epic's and story's description with a `Design pages:` line inside its content hash; nothing from Confluence changes an entity field (AD-5) — additive; 0.1.26 (Story 31.4) adds to this same entry the planning adapter's `sync-back` verb, `plansync.py sync-back --directory ROOT [--dry-run]`, which pulls the project's Atlassian state into local memory so that no agent queries Atlassian live for context: each tracked issue's status, mapped onto the canonical enum by name first (`Blocked - Awaiting User` and `Block Resolved` are canonical `blocked`) then by status category, stamping `updated`, with the Jira original kept under `external.jira` and no other entity field changed (AD-5) — the same mapping `sync`'s pull-back uses, so the two never flip an entity; its comments append-only into `_bmad-output/tracking/<KEY>/comments.jsonl` (`{issue, id, author: owner | agent, body, mentions[], created, updated, source: jira}`, one line per new `(id, updated)` pair: a comment seen twice is written once, an edit appends a line); its attachments as links into `_bmad-output/tracking/<KEY>/attachments.jsonl` (never downloaded or uploaded); and every owner-authored page of `planning.confluence.space_id` (not one tk-studio published) into `kb/confluence/<slug>.md`, storage XHTML verbatim under a provenance header with `content_hash: sha256:<hex>` — read-only sources: a local edit is overwritten and named in `overwritten[]`; one paged JQL search per tick (`GET /rest/api/2/search/jql`, relative bound `updated >= -<n>m` with a five-minute overlap, `ORDER BY updated ASC`), never a GET per issue — only an issue whose `comment.total` exceeds the comments the search returned pages `GET /rest/api/2/issue/{key}/comment` (overflow only); the cursor in `_bmad-output/tracking/sync-state.json` is the largest issue `updated` seen and moves only after every page was read; a `429` waits `Retry-After`, else backs off 1, 2, 4, 8 and 16 s — a `Retry-After` over 30 s, or a wait past a client's 90 s budget per tick, raises at once so the tick records `last_run` and the `429` well inside the job's 300 s guard — and the observed `RateLimit-*` / `X-RateLimit-*` values and every `429` with its `RateLimit-Reason` are recorded in `rate_limit`; the result names `counts`, `newest_comment`, `applied[]`, `conflicts[]`, `overwritten[]`, `rate_limit`, `notes[]` and `written[]` with the §3 block last, and ends `blocked` (no `planning.jira` binding or an absent Jira variable, each named before any call, or a failed preflight: unreachable, deactivated, the 401/403 split or a preflight answered with another, non-auth status, run case `error`), `partial` (an absent `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN` — the Jira half still runs — an unrecorded `planning.confluence.space_id`, the mirror skipped, no recorded owner accountId, a conflict, or a `429` or error that interrupted a read, the cursor unchanged) or `complete`; a tick that changed a status regenerates `plan/index.md`, local-only; nothing local is promoted back (D9); the driver runs it with the plan-sync payload `sync_back?`; the shipped cron job `atlassian-sync-back` (`*/10 * * * *`, durable, a core target, shipped undeclared) runs it, §4's `{project_root}` core argument naming the submitting project's root; §6's drift check becomes five-plane with the `tracking` plane (`case` `not-bound`, `never-run`, `ok`, `stale`, `token-missing`, `unreachable`, `deactivated` or `auth`, local reads only) — additive; 0.1.26 (Story 31.5) adds to this same entry the `tk-studio-track` surface, `track.py block --directory ROOT --story <ST-NNN | N-M-slug> --reason TEXT --resolves TEXT [--source run|engagement] [--dry-run]`, which moves a story the loop cannot progress, and each dependent story (the entities whose `depends_on` names it), to `Blocked - Awaiting User` by the transition's target name, never its category, through the planning adapter (AD-4), with one agent comment `[~accountid:<owner>] Blocked: <reason>` / `Resolves when: <resolves>` (a dependent's adds `Blocked by: <key>`) that @mentions `planning.jira.owner_account_id`; a transition or comment already in place is skipped and named; it ends `blocked` by name on no `planning.jira` binding or an absent Jira variable (no Atlassian call), no recorded owner accountId, a story never promoted or no transition reaching the status, and `partial` when a dependent fails; nothing else is promoted (D9); the supervisor's paused-run pass calls it for a bound project once per (story key, engine run id), recording a `track-block` event — bmad-loop fires no escalation hook, so the pass is the one caller (DRIFT against the epic's "the engine's escalation hook"); the sync-back's comment-log lines gain `update_author: owner | agent` (the owner's reply is the owner's only when both are) and its search reads `priority`; after a non-dry-run tick that read every page the sync-back derives `_bmad-output/tracking/inbox.json` (`{inbox_version: 1, generated_at, project_key, items:[{issue, entity?, title?, priority, blocked_since, reason_comment: {id, body, created} | null, state: open | resolved | validating}]}`, the state by status name, sorted by priority rank, `null` last, then `blocked_since`); a dry-run, `rate-limited`, `error` or `blocked` tick leaves it untouched; the supervisor serves it at `GET /inbox?project=<id>` (§1, a supervisor surface) and the office projection gains `blocked_issue` — additive; 0.1.26 (Story 31.6) adds to this same entry the `tk-studio-track` surface's `reply` verb, `track.py reply --directory ROOT --issue <KEY> (--body-file PATH | --done) [--dry-run]`, which posts the owner's comment (`--done` writes `Done.`; the body from a file, never the command line) with the owner seat's client (`TK_STUDIO_ATLASSIAN_OWNER_EMAIL` and `TK_STUDIO_ATLASSIAN_OWNER_TOKEN`, host-only — outside the `TK_ATLASSIAN_` prefix the sandbox receives — through the `TK_ATLASSIAN_CLOUD_ID` gateway, `/rest/api/2`, plain text; the 31-1 note's `/rest/api/3` is a DRIFT: the gateway and the cloud id are what make the author the owner), then moves the issue by name to `Block Resolved` through the planning adapter (AD-4); an issue already there skips the transition, named in `skipped[]`; it ends `blocked` by name on an absent owner variable or cloud id, or no `planning.jira` binding (no Atlassian call, the agent's token never stands in), no recorded owner accountId, a created comment whose author is not the owner (nothing moved) or no transition reaching `Block Resolved` (`commented: true` kept), and `partial` with `ok: false` and `retry: true` on a temporary failure; nothing else is promoted (D9); the supervisor serves the issue read at `GET /inbox?project=<id>&issue=<KEY>` and the owner's answer at `POST /inbox/{key}/reply` (§1, supervisor surfaces), and a cookie session's `GET /inbox` carries the session's CSRF token in the `X-CSRF-Token` response header — additive; 0.1.26 (Story 31.7) adds to this same entry the `tk-studio-track` surface's `validate` verb, `track.py validate --directory ROOT --issue <KEY> (--check | --pass --to "To Do"|"In Progress" [--ruling-file PATH --spec PATH] | --fail --follow-up-file PATH) [--dry-run]`, run with the agent seat only (never the owner's variables): `--check` reads the issue's changelog (`GET /rest/api/2/issue/{key}/changelog`, paged) through the planning adapter (AD-4) and reports `owner_resolved` true only when the newest transition into `Block Resolved` carries the recorded `planning.jira.owner_account_id` (an older owner transition never validates a later one, an absent or empty accountId never matches), reads `reason_comment` and `replies[]` (the `comments.jsonl` lines whose `author` and `update_author` are both `owner`, after the newest agent comment) from local memory only and marks the inbox item `validating`; `--pass` writes an owner ruling into the paused story's spec (`**Ruling (owner, <KEY> comment <id>, <date>):** <text>` before `</intent-contract>`, else `</frozen-after-approval>`, never `status:`) and moves the issue by name to `To Do` or `In Progress`; `--fail` re-blocks the issue through the `block` internals with the follow-up as the reason, a new `Blocked:` agent comment; each outcome appends one line to `_bmad-output/tracking/<KEY>/validation.jsonl` (`{issue, outcome: pass | fail, at, transition_id, reply_ids[], to?, ruling?, follow_up_comment_id?}`, local memory, never promoted (D9)); it ends `blocked` by name on a bad key, no `planning.jira` binding or an absent agent variable (no Atlassian call made), no recorded owner accountId, a live status other than `Block Resolved`, no transition reaching the target or an absent spec or block for the ruling, and `partial` with `ok: false` and `retry: true` on a temporary failure, appending no line; the shipped one-shot job `validate-resolution` (§4, a skill target on `tk-studio-track` with `payload.verb: validate`, shipped undeclared) runs the session; the supervisor's resolution pass queues it once per block cycle from `inbox.json` `resolved` items (host tier, the planner leg's model and effort) and resumes the paused run on a `pass` — the 31-4 note's `applied[]` never reaches the supervisor, a DRIFT; the engagement's questions get no call site (EP-32), a DRIFT — additive; 0.1.27 (Story 32.1) opens Epic 32's entry: the engagement record and its states, every surface a supervisor surface (AD-2), none a plugin surface — the four supervisor routes `POST /engagements` `{project, request}` (the bearer, or a session cookie with `X-CSRF-Token`, else `403 CsrfRefused`), `GET /engagements?project=<id>` (newest first), `GET /engagements/{id}` (the record and its chat pointer `chat {route, path, last_seq}`) and `POST /engagements/{id}/input` `{verb, …}` (`answer`, `go`, `revise`, `question`, `approve`, `cancel`, each with its typed payload, else `400 SchemaError`; a verb illegal in the state `409 IllegalInput {state, verb}`, a terminal state `409 EngagementClosed`); the record `_bmad-output/engagements/<ENG-NNN>/engagement.yaml` in the served root (`shape_version: 1`; `id, project, state, request, questions[], assumptions[], scope_page, quote, autonomy, approved_at, closeout`, plus `created`, `updated`, `spend {planning_usd, runs_usd}` and `inputs[]`, the typed-input log), its id minted from the plan counter's new `next.engagement` series in `.tk-studio/plan-counter.yaml` (every other key and `counter_version` preserved, the counter saved before the record lands); the `engagement` supervisor-scope service event `{id, project, state, from, verb?, source}`; `engagements[]` `{id, project, state, title, needs_you}` on the office snapshot and the stream's `event:snapshot` and the `office.engagement` `{id, project, state, from, title, needs_you}` frame; the board's Needs-you engagement items `{engagement, state, title}`; and the one transition table, written in §1 [The engagement state table](#the-engagement-state-table-0127-story-321) from the design spec's §7.1 — additive; 0.1.27 (Story 32.2) adds to this same entry the engagement's chat, a supervisor surface (AD-2), and the plugin's one new surface `tk-studio-engage`: `POST /chat/{engagement}` `{message}` (the bearer, or a session cookie with `X-CSRF-Token`, else `403 CsrfRefused`; the message at most 32 KiB UTF-8) appends the owner's line `{seq, at, author: owner, body}` to `_bmad-output/engagements/<id>/chat.jsonl` and queues one run of the shipped one-shot `engagement-chat` job (host tier, the planner leg's model and effort from the served project's routing, the run's own payload `{engagement, project, project_root, seq}` delivered with its `run_id`, one `chat-queued` service event `{engagement, project, seq, run_id, model, effort}`; a message sent while a chat run is live queues behind it on the checkout lock, never refused), answering `200 {ok, engagement, seq, run_id}` (a terminal engagement `409 EngagementClosed`); `GET /chat/{engagement}?since=<seq>` reads the lines after `seq` as JSON or, with `Accept: text/event-stream`, as the chat stream (`id: <seq>`, `event: chat`, the line as data, `Last-Event-ID` replay, `: heartbeat`); the planner's line `{seq, at, author: planner, body, run_id, proposals[]}` is written by `engage.py reply`, each proposal `{verb, payload, label}` an owner input the planner suggests and never applies; the record `engagement.yaml` is now written as JSON text (a YAML 1.2 document, read unchanged), so stdlib cores read it with `json`; and the chat runs' `job-run` costs are summed into the record's `spend.planning_usd` at the supervisor's `finally` sites, with no `engagement` event — additive; 0.1.27 (Story 32.3) adds to this same entry the engagement's clarifying questions: `engage.py questions --directory <project_root> --engagement ENG-NNN --run-id RUN --questions-file PATH [--dry-run]` writes `_bmad-output/engagements/<id>/questions.json` `{run_id, at, questions: [{id, text, options: [{label, default?: true}], impact}]}` (1 to 3 questions, a fourth refused `TooManyQuestions`, any other bad shape `QuestionInvalid` naming the index, exactly one default per question; `NotIntake`, `EngagementClosed`, `RunIdRequired`), which the supervisor's questions pass applies once per queue `run_id` at its `finally` sites through the state table's event row `questions` (source `planner`, the run id; an invalid file or a state other than `intake` applies nothing and emits one `engagement-questions-skipped {engagement, project, run_id, reason}`, an unparsable file once per engagement); it then blocks one Jira issue per engagement through `track.py block --directory ROOT --engagement ENG-NNN [--dry-run]` (the issue found by its exact summary `ENG-NNN: questions` or created, type `Task`, label `tk-studio-engagement`, moved to `Blocked - Awaiting User` with the open questions as a comment that @mentions the owner; `engagement-issue {engagement, project, issue, action: blocked | closed}`, or `{engagement, project, action: refused, reason}` once per reason for a named `track.py` refusal, with no further call until a later `questions` or `answer` line, or an owner comment that applies nothing (`engagement-answers` with `ids: []`); the find-or-create and the comment held under `_bmad-output/engagements/<id>/track.lock`, a lock held being `retry: true`), reads the owner's Jira reply as `<id>: <option>` lines (the `answer` input with source `supervisor`, once per comment id, `engagement-answers {engagement, project, comment, ids[]}`), and, once the state leaves `awaiting-answers` (every question answered, or `go` turning the open defaults into `assumptions[]`), closes it with the new verb `track.py close --directory ROOT --engagement ENG-NNN [--dry-run]` (`Block Resolved`, then `Done`; no validation leg); a close refusal by name emits `engagement-issue {engagement, project, action: refused, step: close, reason}` once and no further close call (a block's `refused` carries no `step`); the sync-back's search gains `summary`, the `inbox.json` item gains `engagement?` (`{issue, entity?, engagement?, title?, priority, blocked_since, reason_comment, state}`), and the office's `planner` agent takes `blocked_issue` from the first `open` item carrying `engagement`, with or without a run; nothing moves on a timer — additive; 0.1.27 (Story 32.4) adds to this same entry the engagement's scope of work: `engage.py scope --directory <project_root> --engagement ENG-NNN [--scope-file PATH | --revise-at AT] [--dry-run]` (in `scoping` only, else `NotScoping` or `EngagementClosed`) checks the planner's `scope.md` — the `##` sections `Goal`, `Deliverables` (each `### <title>` with an `Acceptance signal:` line, else `DeliverableWithoutSignal: <title>`), `Exclusions`, `What the studio needs from you` (each item dated `YYYY-MM-DD`), `Milestones`, `Proposed epics and stories` (`### Epic <k>: …` / `#### Story <k>.<m>: …` in `epics.md`'s story shape, at least one story), in that order, each non-empty, plus an optional last `Assumptions` naming each `assumptions[]` question id (else `AssumptionUnstated: <id>`); any other shape `ScopeInvalid: <what>` — writes `_bmad-output/engagements/<id>/scope.md` under `scope.lock` and publishes it as the Confluence page `ENG-NNN: Scope of Work` in the folder `Engagements/ENG-NNN` (both folders found by title, else created; 31.3's provenance footer; skipped when the remote content hash matches), then merges `scope_page {id, url, version}` and `updated` into a fresh read of the record (`ConfluenceUnbound`, `ConfluenceEnvMissing` (each absent agent-seat variable named), `PublishRefused`, `ReviseNotFound`, `ScopeUnwritable: <path>: <error>` (`scope.md`, the record or `scope.lock` refused by the OS) refused by name; a 429, a 5xx or a held `scope.lock` is `partial` with `retry: true`, `scope.md` kept and `scope_page` unchanged); the proposed epics and stories are not plan entities (nothing under `plan/`, `_bmad-output/planning-artifacts/` or `.tk-studio/` before approval); `reply`'s memory gains `scope {path, text} | null`; the page is authoritative while `scoping` (D9): the sync-back reads each record's `scope_page.id` page and mirrors a newer version as Markdown into `kb/confluence/<slug>.md` (header plus `engagement`, state under `sync-state.json` `engagement_pages`), replacing `scope.md` wholesale, unchecked, and merging the version while `scoping` (any other state: the mirror and one note per version, no state moves), and the supervisor's scope pass runs `engage.py scope --revise-at <at>` for the newest applied `revise` carrying a `body` while `scoping` (the body verbatim as the new page; the input route's hook now fires after `revise` too); a `revise` in `quoted` voids the quote through the existing table row — additive; 0.1.27 (Story 32.5) adds to this same entry the quote: the trial meter's `observation` payload gains the optional, additive fields `kind: meter`, `story_key`, `epic`, `usd`, `legs.<leg> {usd, usage {input, output, cache_read, cache_write}}` (the key is `usage`, never `tokens`, which the ledger sanitizer redacts), `route` and `prices_date` (the description string unchanged, `observation.json` equal to the ledger line, `harvest` re-emitting them; `events/taxonomy.v1.json`), and `engage.py quote --directory <project_root> --engagement ENG-NNN [--seed N] [--dry-run]` (a `--seed` outside `0 <= seed < 2**53` `BadSeed`, the default seed the first 6 bytes of `sha256("<engagement>:<n>")` so `basis.seed` stays exact through the supervisor's JSON rewrite of the record; in `scoping` only, else `NotScoping` or `EngagementClosed`; no `scope.md`, no proposed story or a repeated `### Epic <k>` number `NoScope`, and so are proposed epics not numbered 1..m in order (an `### Epic 0`, a gap such as 1 and 3), since each keys to `EP-<next + k - 1>`; an unreadable `prices.json` or an unpriced route model `PricesUnreadable`; an OS refusal, an unreadable `measurements/` or a held `scope.lock` (`QuoteUnwritable: _bmad-output/engagements/ENG-NNN/scope.lock is held`; a real quote holds `scope.lock` from its read of `scope.md` through the merge, so the scope it prices is the scope on disk when it lands) `QuoteUnwritable`; nothing written on any of them) resamples the project's structured meter history (every machine's ledger, deduped by `story_key`; a free-text `meter:` line counted as `unstructured`, never parsed) over the scope's proposed story count — a seeded bootstrap of 10,000 resamples, nearest-rank `band50`, `band85`, `band95` each `{tokens, usd, share}` (`share` over `plan.window_tokens` of the user or studio config, else `"share unknown"`), `cap = p95 + one story at p85` in USD; under eight records `basis.thin` with the Opus 5.5 trial's per-story dollars as the prior and band85, band95 and the cap widened ×1.5; `basis.notes` is a list of strings (`thin history: <n> landed stories`, and with no tokens `tokens unknown: thin history (no metered story)` or `tokens unknown: thin history (no usd-per-token ratio)`) — and merges only `quote {band50, band85, band95, cap, basis, computed_at}` and `updated` into a fresh read of the record, and records each proposed epic's p85 dollars in the record as `basis.epics[] {k, title, stories, ep_id, usd_estimate}` (`ep_id` the id `.tk-studio/plan-counter.yaml` predicts, `null` when that counter is unreadable; `usd_estimate` a number, `null` for an epic that proposes no story); the quote neither reads nor writes `.tk-studio/budget-bands.yaml` (DW-46, DW-50): Story 32.6's approve copies each `usd_estimate` onto the minted EP id as `epics.<EP-NNN>.usd_estimate`, so `GET /board`'s `band_usd` follows it once the approve PR merges; the state does not move: the planner proposes `go` and the owner's `go` moves `scoping → quoted` through the existing `quote-present` row; a `scope.md` replaced in `scoping` (by `engage.py scope`, its `revise` body, or the sync-back's page revision) voids a non-null `quote` first (`quote: null` and `updated` merged before `scope.md` is replaced; a void that fails refuses — `ScopeUnwritable` from `scope`, a retry from the sync-back — with `scope.md` untouched), because `scoping + revise → scoping` carries no `void-quote`, so the owner's `go` never passes `quote-present` at an old story count — additive; 0.1.27 (Story 32.6) adds to this same entry approval and the first run: an applied `approve {autonomy, base_ref?}` (the bearer, or a cookie with `X-CSRF-Token`; never a chat line, a planner proposal or a timer) starts the supervisor's approve pass (`apps/supervisor/src/approve.ts`, right after the input and again at the `finally` sites until it is done) on the host, in a dedicated worktree of the served root's repository on the branch `engagement/ENG-NNN` — cut from origin's default branch, or from `origin/engagement/ENG-NNN` while that branch is on origin and not merged (a re-approval after `revise`: one more commit on top whose content replaces the earlier plan wholesale, pushed as a plain fast-forward, never a force push; an open PR carries it) — the served root's checkout never switched or dirtied; its steps, in order, each one `engagement-approve {id, project, step, ok, detail}` service event (a failed step retried at the next pass, never moving the state; the pass writes nothing into the record): `append` (the scope's `## Proposed epics and stories` appended to `epics.md` as `## Epic N`, N the highest `## Epic` number there plus k, first body line `engagement: ENG-NNN`, the stories re-emitted as `### Story N.M:`, each story's As a / I want / So that / Acceptance Criteria found as substrings; refused by name `NoScope`, `StoryShape: <k>.<m>` or `NotApproved`), `sync` (`plansync.py sync --directory <worktree>`: normalize, then the projection with the promote to Jira), `job` (`.tk-studio/jobs/run-epic-N.json`, the existing `run-epic` type, and its id in `.tk-studio/config.yaml`'s `jobs:`, the rest of the file kept byte for byte, `TK_SUPERVISOR_CONFIG` never written; the worktree's `.tk-studio/budget-bands.yaml` given each appended epic's `basis.epics[].usd_estimate` from the record, matched by `k` and never read from the served root's bands file, on the minted EP id in `epic_bands_text`'s byte shape, no other entry removed, an epic with no minted EP id or no `usd_estimate` writing no band and named in the step's `no_band` (`no minted EP id`, `no usd_estimate`)), `commit` (exactly one commit of plansync's `written[]` and the files the pass wrote, pushed; a push origin rejects is `NonFastForward`, retried, never forced), `pr` (`gh pr create --base <default branch> --head engagement/ENG-NNN`, an open one reused; `detail.pr {number, url}`) and `queued` (the first `run-epic-N` queued only once `gh pr view` says `MERGED` and the served checkout is pulled fast-forward-only (`git pull --ff-only origin <base>`, the PR's base; never stashed, reset or cleaned), each refusal retried at the next pass with nothing submitted: `DirtyCheckout: <root> has uncommitted changes (<up to 3 paths>)` (a tracked file modified or staged; untracked files do not count), `NotOnBase: <root> is on <branch>, the PR merged into <base>`, `PullFailed: <stderr>`; with or without `base_ref` — the run cut from `base_ref` when the approval named one, else from the default branch — with `payload {engagement, project}` and the placement in `detail`: the job's own `TK_SUPERVISOR_CONFIG` entry, else the project's highest-numbered `run-epic-*` entry, else the host tier; then `engagement-run-queued {engagement, project, run_id, job, after_run?}`); the engagement-run pass applies `launched` (`approved → in-progress`, once per approval) on a linked run's `launched` queue event, and the autonomy read from `record.autonomy`: `full` the epic end to end, `steady` a graceful stop (`launch.py stop --graceful`) once a story lands and a resubmit with the same payload once that story's PR merges, `ask` the same stop, `run-paused`, a `kind: ask` block of the engagement's issue and, on an owner comment line `continue` (the 32.3 comment-reader rule), `run-resumed` and a resubmit (`engagement-run-stop`, `engagement-continue`); `spend.runs_usd` sums the linked runs' `job-run` `total_cost_usd`, merged alone into a fresh read beside `spend.planning_usd`, and the board draws the copied band against it; at `spend.runs_usd >= quote.cap` in `in-progress` the cap applies `cap` (`in-progress → partial`), stops the live linked run gracefully (a linked run still queued is cancelled), blocks the issue `kind: cap` with `runs_usd`, `cap`, `band85.usd` and `band95.usd`, and sends one notifier line (`engagement-cap`); the owner's `go {cap}` from `partial` (`raise-cap`: the cap replaced by the owner's figure) then resubmits, and `cancel` stops the live run gracefully; `track.py block --engagement` gains `--kind questions \| cap \| ask` with `--reason` (`engagement-issue {action: blocked, kind}`; `cap` and `ask` need no open questions; `UnknownKind`, `ReasonMissing`), and the questions pass closes only a `questions` block; no table row changes — additive; 0.1.27 (Story 32.7) adds to this same entry the Chat screen's one read: `GET /runs/{id}` gains `cost_usd: number \| null`, the ledger `job-run` `total_cost_usd` of the run's `studio_run_id` (`inbox.ts` `runCost` on `ledgerPath`, the last line winning), `null` with no studio run id or no metered line; the studio web reads it lazily per planner chat line's `run_id` on hover or focus, one read in flight per run, a metered cost cached per run, `not metered` when null (a null or a failed read is read again on the next hover or focus); no field is added to the chat line, no CSRF header to another route, no route or table row changes — additive; 0.1.27 (Story 32.8) adds to this same entry delivery and change requests: `POST /engagements` accepts `follows?: "ENG-NNN"` (an engagement id, else `400 SchemaError`; no such record in the same served project `404 UnknownEngagement {engagement}`; a followed record that is unreadable `500 EngagementRecordInvalid {project, engagement, detail}`; a record not `delivered` `409 FollowsNotDelivered {engagement, state}`), the new record in `intake` carrying `follows` (present only when given) with its own quote, the previous record never touched; `tk-studio-engage` gains the verb `closeout` (`lib/engage.py closeout --directory <served root> --engagement ENG-NNN --input-file <path> [--dry-run]`, run by the supervisor's closeout pass only, never by the planner): the supervisor's composition `{run_id, outcome_hint, runs[], stories[], epics[], side_exits[], spend, quote}` rendered as `_bmad-output/engagements/<id>/closeout.md` (the `##` sections `Outcome`, `Deliverables` — each `### <title>` with its acceptance signal and `Verdict: done \| not done — <why>` — `Pull requests`, `Cost per story`, `Spend`, `Quote against actual`, `Side exits`), published as `ENG-NNN: Closeout` in `Engagements/ENG-NNN` beside the scope (`page: null` with a note when the project has no Confluence binding), and `closeout {path, page, outcome, done, not_done, run_id, at}` merged alone into the record; refusals `NoScope`, `EngagementRecordUnreadable`, `CloseoutInputInvalid` (and `NotInProgress`, `EngagementClosed`), a transient failure `retry: true`; the supervisor's closeout pass at the `finally` sites sees the engagement's last run end (terminal, no resubmit, stop, pause or cap block owed), applies `run-ended {outcome: delivered \| partial \| failed}` (every deliverable done `delivered`; else a `blocked` last run `failed`; else `partial`), moves the engagement's issue to `Done` (`track.py close --engagement`, an open cap or ask block closed with it), sends one notifier line `engagement ENG-NNN <outcome>: <page url \| closeout.md path>` and records `engagement-closeout {engagement, project, run_id, outcome, page, ok, notify}` once per last run; a mid-run `revise` (`scoping` with a live linked run) stops each engine gracefully with reason `revise` (a queued run cancelled), never resubmitted; the owner's `question` stays a self-loop with no pass, answered by the planner's next turn; no field is added to the chat line, no new route, no version bump and no state-table row change — additive; 0.1.28 (Story 33.1, additive): `GET /status` carries `log {path, last_lines[]}` — the newest supervisor log file `<TK_SUPERVISOR_WORK>/supervisor/logs/supervisor-<YYYY-MM-DD>.log` (one file per UTC day, the last 14 kept, each line `<ISO time> [serve\|tick\|drain\|keeper\|pacer] <text>`) and its last 20 lines, each redacted by the status page's rule, with `note` (`"no log"` \| `"TK_SUPERVISOR_WORK is not set"`, `path` `null` then) only when `last_lines` is empty for that reason; the HTML status page shows the same lines; the office snapshot is unchanged; opens Epic 33's entry — additive; 0.1.28 (Story 33.2, additive): a queued run the drain cannot claim (the Max-login preflight refuses, the sbx pin fails, the placement is refused — `TierRefused`, `SbxSandboxMissing` — or the checkout lock has a live holder) stays `queued` and gains the queue event `claim-refused {reason, resolves, pass_at}`, one per distinct cause (the event detail carries a stable `key` — `max-login`, `pin-failed:<sandbox>`, `placement:<TierRefused|SbxSandboxMissing>`, `lock:<holder run_id>` — and a repeated key updates `reason`, `resolves` and `pass_at` in place on the same event; `claim_refused`, the live list and `problems[]` do not carry `key`), the notifier sending one line per new reason with the run id and what resolves it; the claim that goes through records `claim-refusal-cleared {reasons, pass_at}`; `GET /runs/{id}` carries `claim_refused` and each run of `GET /status`'s `live` list too (`{reason, resolves, pass_at, since}` or `null`), and the office's `problems[]` a line `run <run_id>: claim refused: <reason> — resolve: <resolves>`; the drift check gains a sixth plane, `sandbox-login` (the engine sandbox's Max login: `ok`, `drift` within 7 days of `refreshTokenExpiresAt`, `error` once expired or logged out, `missing` with no running engine sandbox), appended after the five — additive; 0.1.28 (Story 33.7, additive): `GET /status` carries `pacer {last_tick_ms, last_drain_ms, last_pass_at}` — always present, the last tick's and drain's wall time in ms and the ISO end of the last pacer pass, each `null` until recorded (read from `<TK_SUPERVISOR_WORK>/supervisor/pacer.json`; absent, invalid or the work folder unset, all `null`); the HTML status page opens its "Supervisor log" section with the pacer line — additive; 0.1.28 (Story 33.8, additive): `POST /runs/{id}/verify` (bearer only) and the cli verb `bun src/cli.ts verify <run id>` re-run an ended run's host leg — a fresh worktree from its pushed branch tip, `verify.host` as the close-out runs it, a new `host-verify` event carrying `rerun {by, head, worktree, pr, pr_ready?}`, a draft PR marked ready on green, the run's terminal state unchanged; refusals `RunNotFound`, `ExternalRun`, `RunNotEnded`, `NoBranch`, `VerifyRunning`, `VerifyFailed`; a `host-verify-leg` lease event — additive; 0.1.29 (Story 34.1, additive): `verify.engine` in the project config, the host leg's engine gate, `engine` on `host-verify` — the project's tracked `.tk-studio/config.yaml` at the run's base may declare `verify.engine` (one command line, beside `verify.host`; not `engine.verify_commands`), run after a green `verify.host` in the worktree with the folder of `GODOT` prepended to PATH; every ran `host-verify` carries `engine {verdict: green\|red\|skipped, reason?, command?, argv?, cwd?, exit?, duration_ms?, signal?, guard?, error?, stdout_tail?, stderr_tail?, godot_dir}`; an engine red is a red leg (`partial`, `host_verify: red`, the draft PR); `tk-studio doctor` gains the `engine` row — additive; Story 34.2, additive: `tk-studio-launch check` gains the advisory `playable path` row (never a gap; `not a game project (no verify.engine)`, a `GODOT` or display-session warning, or `ready (<path>)`) — additive; Story 34.3, additive: the `playable-verify` leg — `playable: {scenario, seed, ticks}` in the project config, run after a green engine gate (`playable.py run`, the media in the run's store and the worktree's `.bmad-loop/runs/<engine>/playable/`), then the `tk-studio-playable-judge` skill on the sandbox tier routed by `[pipeline.legs] playable-verify`; every ran `host-verify` carries `playable {verdict: pass\|fail\|skipped, reason?, exit?, status?, failed?, duration_ms?, store?, media?, judge?, findings?, frames?}`; a playable fail is a red leg (`partial`, `host_verify: red`, `host verify red (playable)`, the draft PR with the findings and the frame paths); `job-run` gains `playable_verify_cost_usd` — additive; Story 34.4, additive: the `gds-engine-godot-4` skill and `lib/engine_pin.py check`, `suggests_skills` on the `game-godot` profile and the detect candidate, skill entries with `warnings[]` in the onboard proposal, the `verify commands` row's engine-gate clause — additive; Story 34.5, additive: `editor_in_the_loop` on a job definition, `suggests_mcp` on the detect candidate and `kind: mcp` entries in the onboard proposal, `recommend.py record --mcp`, the supervisor's per-run engine MCP (`engine.mcp` in the project config, `TK_ENGINE_MCP_URL` and `TK_ENGINE_MCP_BEARER` by name, the `engine-mcp-start` and `engine-mcp-stop` events, the `engine-mcp:` refusal keys) — additive; Story 34.6, additive: the asset manifest (`asset-manifest.schema.json`, `assets.manifest` and `assets.art_path` in the project config) and `lib/assets.py check\|greybox\|facts` with `lib/blender/greybox.py`, the greybox rung of the asset ladder — additive; Story 34.7, additive: the asset ladder's cc0 and generated rungs (`lib/assets.py mirror-index\|match\|generate` with `lib/blender/normalise.py` and `lib/blender/render.py`, the manifest's optional `tags`, `prompt` and `camera`, the mirror `TK_ASSETS_MIRROR`, `assets.credit_cap` in the project's budget bands, `TK_ASSETS_MESHY_KEY` by name, the `asset-generation` taxonomy event, node transforms in `facts`) — additive; Story 34.8, additive: the shipped `run-vertical-slice` job type (`run-epic`'s shape; a run is a slice when its resolved definition's `type` or `id` is `run-vertical-slice`), the slice's host leg (`assets {verdict: green\|red\|skipped, reason?, manifest?, art_path?, steps[]}` on `host-verify`, `check`, `greybox` and `match` before the engine gate, never `generate` or `--mirror`; `contact_sheet` and `sampled` on its playable step; `lib/playable.py sheet`), the close-out's host-side commit of the placed art and `.tk-studio/proof/<run_id>/`, the engagement's game path (`engage.py scope --brief-file --gdd-file`, the record's `brief_page`, `gdd_page` and `game`, approval minting `run-epic-N` as `type: run-vertical-slice`) and the closeout's `slices` and `## Slice verdicts` — additive; 0.1.30 (Story 35.1, additive): the host leg's re-run is a whole leg — `POST /runs/{id}/verify` and `bun src/cli.ts verify <run id>` cut `<run worktree>.verify` on the run branch reset to origin's tip (`git worktree add --relative-paths -B supervisor/run-<id> <path> <tip>`, never detached; another worktree holding the branch is `VerifyFailed` naming it); on a slice run, under the close-out's own condition (a ran leg, a green or fault assets step), the re-run commits the placed art and `.tk-studio/proof/<run_id>/` (`host leg: placed assets and proof (run <run_id>)`) and pushes the run branch, never forced; the PR-body rule: an open PR's body is regenerated from the record (`## Launch status block`, engine run, landed commits, recorded cost, the worktree gone the old body's `## Metered cost` carried back unchanged; no new fenced field) with its `## Host verify` the latest leg's section under the one-line history `Legs: <k> — <close-out|re-run> <green|red|skipped> <recorded_at>[ (by <api|cli>)]; …` (the close-out's first body `Legs: 1 — close-out …`), then green marks a draft ready, red turns a ready PR back to a draft (`gh pr ready --undo`) and the event's `reason` names why; `rerun: true` (the `rerun` member's presence) gains `commit?`, `pushed?`, `pr_body?`, `pr_draft?` — additive; 0.1.30 (Story 35.8, additive): every stage leaves a start and a stop — the story spec's append-only `## Stage Log` table (`stage`, `pass`, `started`, `ended`, `session_id`, `model`, `effort`, `tokens_in`, `tokens_out`, `cost_usd`, `outcome`; elapsed never stored, only derived) after `## Consult Log`, written by `plansync.py stage --start\|--stop\|--append\|--from-pass` (the studio-pipeline `post_session` hook, the supervisor, the operator), mirrored by `plansync.py stage-post` as a start and a finish comment and a worklog on the story's Jira issue (`_bmad-output/tracking/stage-posts.json`), the supervisor's stage pass after the merge (`stage-post` queue events, `started_at` on `host-verify`), the `stage` taxonomy event and `lib/report.py rollup` — additive; 0.1.30 (Story 35.2, additive): every story gets its plan and its records — the launch bootstrap plans every manifest entry in list order (`plans/<N>-<M>.md`, a Code Map and the band each; the commit `loop(epic-<N>): SPEC, manifest and story plans from the launch bootstrap`), `launch.py check` refuses the next story with the gap `open questions` while one of its CAPs has an open question and no design note, and the advisory `story plans` row names the stories without a plan; of AC2's either/or the planner picks the refusal: the paused-run pass never relaunches across a story boundary while a graceful stop is in force (`stop-request.json`, or a `stop-request-discarded` journal entry no `run-resume`/`run-start` follows) — one `story-boundary` event, `StoryBoundary`, `graceful_stop: "kept"` — and a resume re-arms the stop (`graceful-stop`); per-story records are not built — additive; 0.1.30 (Story 35.3, additive): the slice path hardened — a tool with its own wall clock (`assets.py --wall`, `playable.py --wall-clock`) runs under that wall plus `TOOL_WALL_MARGIN_S` (30 s), so the tool's own kill writes its report and the leg reads `wall-clock` from it; a crashed, `not-run` or write-back-failed `match` is `fault` and red; the slice proof is committed whenever `report.json` exists in the playable store, this leg's playable step ran (`playable.py` exited 0 or 1) and the assets step is not red (`skipped: no manifest` included), `git check-ignore` first (`skipped_ignored`) and never `<art_path>/.candidates/`; `playable.py sheet --report` samples only the report's `frames[]`; `playable_judge.py rubric` is the rubric ids' one home; a judge that cannot run or answer is `playable.verdict: inconclusive` (`infrastructure: <pin|sbx|status-block|auth|rubric>: <detail>`), the run `partial`, never a rubric fail — additive); 0.1.30 (Story 35.4, additive): the engine MCP before the first flagged run — `engine.mcp.port: 0` is the per-run port (a free `127.0.0.1` port put in for `{port}` in `engine.mcp.start`, and `{ws_port}` when present; no `{port}` is `engine-mcp:no-config`), a positive port stays fixed (one flagged run at a time), and an unset `TK_SUPERVISOR_ENGINE_MCP_PORT` binds the forwarder per run (`:0`); `engine-mcp-start`/`-stop` gain `port`, `forwarder_port` and `ws_port?`, `engine-mcp-start` gains `advisory?`, `pin-released`/`pin-kept` gain `engine_mcp?: "stopped" | "stop pending"`; the start is recorded before the children are let go and a failed record kills all three (`engine-mcp:start-failed`); the optional `engine.mcp.filter` (default `--exclude-domains`) and the verify-only advisory on the launch check's `engine mcp` row and on the start — additive); 0.1.30 (Story 35.5, additive): the sandbox and the host agree — a job definition's optional `requires: {tier: "sbx" | "host"}` (`run-epic`, `run-vertical-slice` and `maintenance-evals` ship `sbx`; an instance's own overrides its type's) and `submit` refusing a placement whose tier differs with `placement:TierRequired` before anything is queued or spawned, its reason naming the supervisor's per-job config entry `jobs.<project-id>/<job-id>` in `TK_SUPERVISOR_CONFIG`, `POST /jobs` 400 by name; the engine step's `godot` shim when `GODOT` is an absolute path to a file (a bare `godot` argv[0] spawned as `$GODOT`, the shim dir first on PATH, `engine.godot_shim`); the `maintenance-evals` job type and the `tk-studio-evals` surface (`lib/evals.py run`, `scores.json`) — additive; 0.1.30 (Story 35.6, additive): the closeout carries the proof — each slice leg's own copy of its `report.json` and sampled frames under `<store>/legs/<stamp>/` (`playable.report?`, `playable.leg_frames?`), each story reading its own leg (not the run's last), the closeout input's `slices[].report?`/`frames?` attached to the page as `<key>-report.json` and `<key>-frame-<name>` with the report's `\| Report \| Value \|` verdict table, the `no verify.engine` playable skip, the engine MCP started in the served root, a flagless `scoping` revise merging `game: true` — additive; 0.1.30 (Story 35.7, additive): the `run-sweep` job type — `tk-studio-launch` verb `sweep` (`launch.py sweep`: `bmad-loop sweep --no-prompt` detached in the run's worktree, the triage read into the block's `triage{…}` and one-line reason), the `sweep-triage` taxonomy event (emitted by `launch.py sweep` alone), one PR per sweep with its `## Sweep` section, the `sweep:` inbox line, the `complete \| partial \| blocked` end, and `plansync.py ledger-resolve` flipping a merged sweep's entries to `resolved … by #N` — additive; 0.1.31 (Story 36.1, additive): the one-verdict rule — the host leg's verdict is derived once and read by the board's `host_verify`, the plan status's rows and so the Stage Log, the rollup and the sweep, `inconclusive` a fourth value beside `green`, `red` and `skipped`; the board files an inconclusive run under `needs_you`; the proof folder's `frames/` directory is one literal — additive; 0.1.31 (Story 36.2, additive): a sweep's records are whole — `meter.py price-run` prices the engine per bundle from the one table into `## Metered cost` (worker turns + engine, one line per bundle), the `job-run` line's `total_cost_usd` and `engine_cost_usd` on the sweep's `ended`; the host emits the `sweep-triage` ledger event; a re-run's judge is its own `job-run` line `<run_id>:verify-<n>`; the ledger pass's `pending` is an uncounted wait; the engine's own end is kept; `## Sweep` survives a re-run from the record; 0.1.31 (Story 36.3, additive): a paused or resumed run is never parked — `track.py unblock` and the `track-unblock` queue event close the block a resume resolved, the resume's graceful-stop re-arm runs on the run's tier, an AD-5 conflict ends the plan-status record `partial`, a failed first render counts as the one snapshot, the bounded stop (`SWEEP_STOP_DEADLINE_MS`) ends a paused sweep `blocked` with its WIP committed, the retrospective's B3/B4 are decided (a story boundary ends the run, 35.2's park superseded) — additive; 0.1.31 (Story 36.4, additive): a host leg's red means the code — every text-mode open under the lib, the installer and the app scripts names its `encoding=` (binary modes exempt; the `e2e_text_encoding` drive fails naming the call site), a bun-suite drive's bound derives from its manifest `timeout` through `_budget.py` — additive; 0.1.31 (Story 36.5, additive): the supervisor's own faults are recorded as its own — `own_block` on a run's end and `run.json` releases the lock of a run with no engine and is skipped by the `stop.on_status` evaluators, `cancel` answers an ended run's unverified lock row, `submit` refuses `skills-store:SkillMissing`, a block missing `intent` is malformed, a core's own `status` lifts into the run `state`, the pin-restart bound is per sandbox, the pin prunes the VM's `/tmp`, `pacer.running` — additive; 0.1.31 (Story 36.6, additive): setup and the launch check by evidence — `plansync.py setup`'s workflow update sends v3-shaped transitions with ids, the `verify commands` row refuses a tracked or unignored policy, the `engine gate` clause reads the sandbox's `WITH_GODOT` marker, a game project's manifest lists `gds`, the `in-progress` plan phase, `stop.after_stories` and `stop-armed` — additive; 0.1.31 (Story 36.7, additive): 36.7: no surface change; the module graph and the docs, the `engine mcp` advisory's wording naming the forwarder port — additive; 0.1.32 (Story 37.1, additive): one id source for the ledger — the `deferred-work` counter in `.tk-studio/plan-counter.yaml`, the verb `plansync.py deferred mint`, the ledger's marker line, the `pre_commit` hook's bump, and `LedgerDuplicateId` refusing a duplicate heading — additive; 0.1.32 (Story 37.2, additive): the Windows classes out of the host leg — the `e2e_windows_semantics` drive, the 30 000 ms host figure on every `bun test` (`--timeout`), and a red leg's `verdicts` on `host-verify`, the PR body and the re-run verb's answer (`verdicts`, `red`) — additive; 0.1.32 (Story 37.3, additive): a timed-out session keeps its stop and its records — a run worktree's policy turns on the engine's own `rollback_on_failure` (the engine's rule, never a main checkout), a paused run's host leg on a clean tree with the PR ready on green (`paused: dirty tree` skips it), the `timeout` Stage Log row and its backfill, the cancel's `finish --total-cost-usd`, `own_block` outside `stop.max_runs`, and a refused figure-1 arming ending the run at the boundary (`arming-refused`) — additive; 0.1.32 (Story 37.4, additive): the status edges and the rhythm for every job — `Block Resolved` is canonical `in-progress` and a promote leaves it for any non-`blocked` canonical (`Blocked - Awaiting User` stays canonical `blocked` and wins while the block stands), the picker's tie broken by the exact name then the lowest numeric transition id, one `plan-status` `story_key` with no `-spec` suffix, the setup's copied transitions carrying `screen` and `rules` with `refused_transitions`, and the launch duties by the job's `target` (`runsStories`), `run-vertical-slice` carrying `after_stories: 1` — additive; 0.1.32 (Story 37.5, additive): the sweep's bugs and cost lines before a fourth sweep — a green re-run holds a sweep's draft while its record names a bundle unfinished (`rerun.pr_ready: "held: …"`) unless `POST /runs/{id}/verify` carries `{ready?: boolean}` `ready: true` (`rerun.ready_override`), the ledger pass's wait bounded by `SWEEP_LEDGER_WAIT_MS` (`ended: "wait"` and one notifier line), the stop deadline's clock started by a once-per-engine-run `engine-probe` note, the engine's own triage priced (`price-run` `triage`, `triage_cost_usd`), the triage emit ordered (`ledger: "emitting"`) and retried by the ledger pass, the judge's `n` derived after its note, and the bare-id cost readers answering own plus `:engine` — additive; 0.1.32 (Story 37.6, additive): one stop path and the gate's blind spots — the engine's stop built once (`engineStopArgv`, `--directory` on both tiers) and run or rendered by every caller, `rearmFailedLine` naming that command, the cycle test scanning dynamic imports with the `enginemcp → api` residual cut, `withMcpStop` pinned, the host gate's named skip lines, and the re-run verb's three exits (0 green; 1 red, inconclusive or skipped; 2 refused) — additive; 0.1.33 (DW-170, additive): the sandbox tier signs itself in again — the `tk-studio-login` verb (`lib/login.py`), the supervisor config's `logins` key, the claim gate's `relogin` on a `not signed in` pin and doctor's `docker-login` check — additive; 0.1.34 (Story 38.1, additive): the host leg's own guard and its measure — `guards.host_verify_seconds` (7200 on the shipped story types, guards merged key-wise), `guard: host_verify_seconds (Ns)`, `suite_durations` and the `== durations:` line, `inconclusive (guard)`, the close-out's `host-verify-leg` lease and `verify_host.py`'s beside-leg refusal (`--beside-leg`) — additive; 0.1.34 (Story 38.2, additive): a run that does no work says so — the `partial` rule (`no story landed: …`) and the `no changes` leg skip, the hole-65 auto-resume keyed on the render signature whatever the status word (`via`, `status_word`) with the ended engine's one relaunch (`paused_stage: "no-story"`), `plan-status {phase: "draft"}`, `stage-carry` and the `halted` Stage Log outcome, and the renderer's `render-skill-reread-fresh-destination` base patch — additive; 0.1.34 (Story 38.3, additive): the sweep's path cleared — the paused-sweep stop deadline measured from the first note of the latest non-`running` streak (`engine-probe {phase: "running"}` resets it), an unanswered stop's `blocked` end holding the lock and the pin until a stop is confirmed or the engine exits (`engine_held`, `engine-released`), a refused `ledger-resolve` ending the ledger pass `{ok: false, settled: true, ended: "refused", reason}` with one notifier line, `LedgerMissingId` (exit 2, the id and the counter), the remedy's absolute verb path and `--directory`, and a bundle's engine passes as rows in the sweep PR body's `## Stage Log` (`plansync.py stage --from-run`) — additive; 0.1.34 (Story 38.4, additive): the owner's decisions have a source and a sink — each triage decision carries `options [{letter, text, key, effect}]` and `default` (lettered studio-side from the skill's own options and recommendation), `track.py block --source sweep` posts one `tk-studio-decision` Task per related group from the sweep's close-out on a bound project (the PR body lists the issue keys), `_bmad-output/tracking/decisions-jira.json` records them, the sync-back tick ingests an answered issue (`<id>: <letter>`, `all: <letter>`, `default`) through `plansync.py ledger-decide` (`decision: <letter> — <text> (<KEY>, <date>)`), replies and moves it to Done or re-blocks it, the engine is answered from the record at the close-out (`sweep-decisions-answered`), the inbox item gains `decision {ids}`, and the promote leaves `Blocked - Awaiting User` once no block stands (edge (a)) — additive; 0.1.34 (Story 38.5, additive): the pause path finished — the pause's notice and block before its leg, the leg in its own pass (`pausedLegs`), one leg per code head (`host-verify.code_head`), no stub policy (`worktree policy: none in the checkout`) and the TOML-aware rollback edit, `stop.max_own_blocks` (default 3), `track.py block --kind engine`, the late close-outs' draft and records, the split spec's exact name first — additive; 0.1.34 (Story 38.6, additive): the gate's coverage widened — both Windows-class drives scan `plugins/tk-studio/skills/*/scripts` and `.bmad-loop/plugins` (`apps/*/scripts` gone), a `config verify commands` step fails a `.tk-studio/config.yaml` `bun test` with no `--timeout` at the host figure, the e2e suite (`command-line.test.ts`) in its own step under `tools/verify_host.py`, and `sbx skills ls` read as the store's plugin folders (the header skipped, `tk-studio` present) with the store folder walk as the skill check — additive; 0.1.34 (DW-51, additive): a re-approval drops the superseded cycle's issues — `tk-studio-track` gains the verb `drop` (`track.py drop --engagement ENG-NNN --issue KEY … --reason TEXT`: each issue moved by name to `DNI` with one `Dropped: <reason>` agent comment, one already dropped skipped), called by the approve pass on a bound project's re-approval cut from `origin/engagement/ENG-NNN` before the second sync, the keys chosen by provenance (the plan entities whose `source` is one of the engagement's own `## Epic N` sections, less any key the default branch carries); the drop also runs before a kept worktree of an earlier cycle whose push never landed is removed, from that worktree (DW-192), a failed drop there failing `append` (`DropFailed`/`DropRefused`) and keeping that worktree; and (DW-49) the approve pass's `append`, before a cycle starts, waits as `WaitOpenPr` — not a failure: retried each pass, told once, `detail.wait: true`, `detail.holder {engagement, pr}` (`pr` null while no PR exists; `unreadable: true` for an unreadable holder record) — while another engagement of the same project holds an open approve cycle (an ok `append` since its newest approve line with no ok `queued` and no `PrClosed` refusal after it, its PR pending or `gh pr view` not answering `MERGED`/`CLOSED`; also held, whatever its newest cycle shows, while its newest ok `pr` of any cycle, with no ok `queued` and no `PrClosed` refusal after it, still answers `OPEN` — an earlier approve PR open after a revise; a cancelled, absent or never-approved holder releases); and (DW-190) the wait check and a starting cycle's `append` through `commit` run under a per-project lockfile, `<TK_SUPERVISOR_WORK>/worktrees/<project>/approve.lock`, so the check-then-append holds across supervisor processes; a pass finding it held elsewhere records nothing and retries next pass — additive) |
| Story / rulings | ST-5.3, ST-6.2, ST-7.1, ST-7.2, ST-8.1, ST-8.2, ST-9.6 (Epic 9, D1–D5 ruled 2026-08-06), ST-040–ST-042 (EP-010, D1–D5 ruled 2026-08-07), ST-061, ST-062, ST-083, ST-085, Story 26.1, Story 26.3, Story 26.5 (Epic 26), Story 28.2, Story 28.6 (Epic 28), Story 29.4 (Epic 29), Story 30.4, Story 30.5, Story 30.6 (Epic 30), Story 31.2, Story 31.3, Story 31.4, Story 31.5, Story 31.6, Story 31.7 (Epic 31), Story 32.1, Story 32.2, Story 32.3, Story 32.4, Story 32.5, Story 32.6, Story 32.7, Story 32.8 (Epic 32), Story 33.1, Story 33.2 (Epic 33), Story 34.1, Story 34.2, Story 34.3, Story 34.4, Story 34.5, Story 34.6, Story 34.7, Story 34.8 (Epic 34), Story 35.1, Story 35.8, Story 35.2, Story 35.3, Story 35.4, Story 35.5, Story 35.6, Story 35.7 (Epic 35), Story 36.1, Story 36.2, Story 36.3, Story 36.4, Story 36.5, Story 36.6, Story 36.7 (Epic 36), Story 37.1, Story 37.2, Story 37.3, Story 37.4, Story 37.5, Story 37.6 (Epic 37), Story 38.1, Story 38.2, Story 38.3, Story 38.4, Story 38.5, Story 38.6 (Epic 38); AD-1, AD-2, AD-3, AD-4, AD-5, AD-7, AD-8, AD-10, AD-11, AD-12, AD-13, AD-14, AD-16, AD-21 |
| Audience | any harness that drives tk-studio unattended — the conformant drivers are the studio supervisor (executing wrapper, status page) and Hermes (front door), plus direct invocation (§1 [Driver roster](#driver-roster-0118)); the studio web (EP-30) is a consumer of the supervisor's own surfaces, not a driver (§1 [Supervisor surfaces the web consumes](#supervisor-surfaces-the-web-consumes-0124)) |
| Companion schemas | `status-block.schema.json`, `events/taxonomy.v1.json`, `registry.schema.json`, `interchange/shape.v1.json`, `job.schema.json` (v1, shipped ST-6.1), `knowledge.schema.json` (v1, shipped ST-9.1 — spine/seed frontmatter, anchors, deltas, queue and promotions-record lines), `asset-manifest.schema.json` (v1, shipped Story 34.6 — the asset manifest, §[Asset manifest](#asset-manifest-0129-story-346)) |

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

A studio **surface** is a skill in `plugins/tk-studio/skills/tk-studio-*/`, and the plugin-shipped engine-knowledge skill `skills/gds-engine-godot-4/` (0.1.29, Story 34.4), which keeps GDS's naming so its engine catalogue stays upstream (AD-1).
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
| the board (Story 30.5, 0.1.25) | `GET /board?project=<id>` | `{ok:true, project, built_at, plan, epics, triage}`: the served project's plan epics with their stories and canonical statuses, each story's latest run (`{run_id, state, pr, host_verify, ended_at}` or `null`; `host_verify` `green`, `red`, `skipped`, `inconclusive` (0.1.31, Story 36.1, additive) or `null`) and open findings, per epic `spend_usd` against `band_usd` (`null` with no band), and `triage` `{needs_you, working, done}`; no `project` is `400 ProjectRequired`, an unregistered one `404 UnknownProject`; a read that writes nothing |
| the home and the read-only page (Story 30.6, 0.1.25) | `GET /`, `GET /status` | `GET /` with a session (the cookie or the bearer) is the web: the built web's `index.html` (as `GET /app`, `cache-control: no-store`), or, while the web is not built, the read-only page with its "not built" note, never a `503`; with no session it is the sign-in page. The read-only page (server-rendered HTML, no script, credentials redacted) is at `GET /status` with an `Accept` naming `text/html`; any other `Accept` (none, `*/*`, `application/json`) answers the `/status` JSON `{ok, counts, live, locks}` unchanged, plus `log {path, last_lines[]}` (0.1.28, Story 33.1: the supervisor log's newest file and its last 20 lines, redacted; `note` `"no log"` or `"TK_SUPERVISOR_WORK is not set"` when empty for that reason) — the read-only page shows the same lines in its "Supervisor log" section; plus `pacer {last_tick_ms, last_drain_ms, last_pass_at}` (0.1.28, Story 33.7: always present, the last tick's and drain's wall time in ms and the ISO end of the last pacer pass, each `null` until recorded) — the read-only page opens its "Supervisor log" section with the pacer line; both carry `vary: Accept`. Each run of `live` carries `claim_refused` (0.1.28, Story 33.2: the latest reason a drain pass could not claim the queued run, else `null`). With no session an HTML `GET /status` is the sign-in page returning to `/status`, any other `401` JSON |
| the inbox (Story 31.5, 0.1.26) | `GET /inbox?project=<id>` | `{ok:true, project, generated_at, items:[…]}`: the served project's `_bmad-output/tracking/inbox.json` items exactly as the sync-back wrote them (`{issue, entity?, engagement?, title?, priority, blocked_since, reason_comment, state: open \| resolved \| validating}`, sorted by priority then time; 0.1.27 (Story 32.3): `engagement` `ENG-NNN` on the item whose summary is `ENG-NNN: questions`, its `title` that summary); a missing file is `items: []` with `generated_at: null`, never a `404`; no `project` is `400 ProjectRequired`, an unregistered one `404 UnknownProject`; readable by the bearer or the cookie; a read that writes nothing. The office projection's agents gain `blocked_issue` `{issue, state} \| null` (set while the agent's current story's issue — or, when there is none and the run is `paused`, the paused story's issue — has an `open` item; the web's "!" follows it alone, never a comment or message event; 0.1.27 (Story 32.3): the project's `planner` agent takes it from the first `open` item carrying `engagement`, with or without a run, while a story block on a run still sets the other agents') — additive 0.1.26 (Story 31.6) adds `GET /inbox?project=<id>&issue=<KEY>` (the Issue screen's read): `{ok:true, project, generated_at, items, issue}` with `items` the matching item only and `issue` `{key, entity, title, status, run, cost_usd, comments[]}` — `entity` the plan entity whose `external.jira.key` is `KEY` (or `null`), `status` its `external.jira.status`, else the item's state, else `null`, `run` the story's latest run as `GET /board` composes it (or `null`), `cost_usd` that run's ledger `job-run` cost (or `null`, unmetered), `comments[]` the last `_bmad-output/tracking/<KEY>/comments.jsonl` line per `id` in `created` order (`{id, author, update_author?, body, created, updated}`); a key not matching `^[A-Z][A-Z0-9]+-\d+$` is `400 BadIssue`, one with no item, no entity and no comment log `404 UnknownIssue`; a registry or board read that fails `500 IssueReadFailed`; any `GET /inbox` on a cookie session carries the session's CSRF token in the `X-CSRF-Token` response header (a bearer answer has none) — additive |
| the owner's reply (Story 31.6, 0.1.26) | `POST /inbox/{key}/reply` | the body `{project, body?, done?: true}` — exactly one of a non-empty `body` (at most 32 KiB UTF-8) or `done: true` (`Done.`), else `400 SchemaError` (a body that is not JSON is `400 MalformedJson`, a malformed key `400 BadIssue` — additive); the bearer, or a cookie session with `X-CSRF-Token`, else `403 CsrfRefused`; with `TK_STUDIO_ATLASSIAN_OWNER_EMAIL`, `TK_STUDIO_ATLASSIAN_OWNER_TOKEN` or `TK_ATLASSIAN_CLOUD_ID` absent from the supervisor's environment (after the User-environment fill) `409 OwnerSeatMissing {missing}` and no spawn; otherwise the supervisor runs `track.py reply --directory <registry root> --issue <KEY> --body-file <tmp>` on the host (the body in a temp file, removed afterwards; the owner's variables never reach the sandbox) and answers `200 {ok, project, issue, commented, transitioned, status}` (`status` is the verb's §3 status — `complete`, or `partial` — never the issue's Jira status), `409 ReplyRefused {reason, commented}` (`blocked`), `503 ReplyRetry {reason, commented}` (`retry: true`) or `500 ReplyFailed` (no JSON, or a spawn failure); an unregistered project is `404 UnknownProject`; it writes no queue event — the item leaves the inbox on the next sync-back, which derives `Block Resolved` as `resolved` — additive |
| the engagement (Story 32.1, 0.1.27) | `POST /engagements` | the body `{project, request, follows?}` (`follows` added in 0.1.27, Story 32.8) — `project` and `request` non-empty strings, `request` at most 32 KiB UTF-8, no other field, else `400 SchemaError` (not JSON `400 MalformedJson`); the bearer, or a cookie session with `X-CSRF-Token`, else `403 CsrfRefused`; an unregistered project `404 UnknownProject`; a registry entry with no root, or a root not on disk, `500 EngagementRootMissing` (nothing is created); the supervisor mints `ENG-NNN` from `next.engagement` in the served root's `.tk-studio/plan-counter.yaml` (default 1, saved atomically before the record; a counter that is not a mapping, or a `next.engagement` that is not an int >= 1, `500 EngagementCounterInvalid`), writes `_bmad-output/engagements/<id>/engagement.yaml` in state `intake` and appends one `engagement` service event `{id, project, state, from: null, source}` (no queue run); `200 {ok, engagement}` — additive; 0.1.27 (Story 32.8): `follows?` names a `delivered` `ENG-NNN` of the same served project — a malformed `follows` (not matching `^ENG-\d{3,}$`) `400 SchemaError`; then no such record `404 UnknownEngagement {engagement}`; a record that is not JSON or not a record `500 EngagementRecordInvalid {project, engagement, detail}`; a record not `delivered` `409 FollowsNotDelivered {engagement, state}` (nothing minted on any of them), see the version entry |
| the engagement (Story 32.1, 0.1.27) | `GET /engagements?project=<id>` | `{ok:true, project, engagements:[…], problems:[…]}`: the served project's records, newest first; a malformed one is skipped and named root-relative in `problems`; no `project` is `400 ProjectRequired`, an unregistered one `404 UnknownProject`; readable by the bearer or the cookie; a read that writes nothing — additive |
| the engagement (Story 32.1, 0.1.27) | `GET /engagements/{id}` | `{ok:true, project, engagement, chat}`: the record as written (its `scope_page` `null` until Story 32.4's `engage.py scope` records `scope_page {id, url, version}` — the scope page's id, its `https://<planning.jira.site>/wiki<webui>` url and its version after the last write or mirrored owner edit; Story 34.8, 0.1.29, additive: a game project's record also carries `brief_page` and `gdd_page`, shaped like `scope_page`, and `game: true` once `engage.py scope` published the game brief and the GDD, each optional); its `quote` `null` until Story 32.5's `engage.py quote` merges `quote {band50, band85, band95, cap, basis, computed_at}` — each band `{tokens, usd, share}`, `cap` a number in USD, `basis` the method, the seed, the history, the route, the autonomy levels and the planning spend, `basis.epics[] {k, title, stories, ep_id, usd_estimate}` (`ep_id` `null` when `.tk-studio/plan-counter.yaml` is unreadable; `usd_estimate` the epic's p85 dollars, the band approve copies) and `basis.notes` a list of strings (`thin history: <n> landed stories`, `tokens unknown: thin history (no metered story)`, `tokens unknown: thin history (no usd-per-token ratio)`) — and `null` again once a `revise` voids it or a replaced `scope.md` voids it first and its chat pointer `chat {route: "/chat/<id>", path: "_bmad-output/engagements/<id>/chat.jsonl", last_seq}` (`last_seq` `0` while Story 32.2 has written no chat); the record is read under `?project=<id>`, else in the one registry project whose served root holds its file (`_bmad-output/engagements/<id>/engagement.yaml`, parsed or not); ids repeat across projects, so with no `?project=` more than one holder is `409 AmbiguousEngagement {engagement, projects[]}` before any record is read, and a client sends `?project=` whenever an id can repeat; an id not like `ENG-001` is `400 BadEngagement`, none found `404 UnknownEngagement`, a file that is not a record (or whose `id` is not its directory's) `500 EngagementRecordInvalid`; readable by the bearer or the cookie — additive |
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
session; the body empty or `{}`; 0.1.32, Story 37.5: or `{ready?: boolean}`) and the cli verb `bun src/cli.ts verify
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
inbox, office) follows the latest `host-verify` (`green`, `red`, `skipped`
or, 0.1.31, `inconclusive`). The route answers `202
{ok, run_id, state, verify: "started", head}` and the leg runs on; the verb
waits and prints `{ok, run_id, state, head, green, skipped?, reason?,
verdicts?, red?, pr, pr_ready?, worktree}` (exit 0 green, 1 red or skipped, 2
a refusal; `verdicts?` and `red?` 0.1.32, Story 37.2).
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
Story 34.2 adds one advisory row to `tk-studio-launch check`: `playable
path`, after `engine sandbox`, `ok` always and never a gap, which reads
`not a game project (no verify.engine)` for a project whose tracked config
declares no `verify.engine`, else `warning: no $env:GODOT (unset or not an
absolute file); playable runs refuse`, `warning: no display session; the
<path> path needs the logged-in desktop` (or `warning: display session
unknown (<error>)`) or `ready (<path>)` for the ruled
rendering path of `plugins/tk-studio/lib/playable.py`, the runner 34.3
drives; the row starts no engine.
Story 34.3 adds the `playable-verify` leg, the host leg's third step. The
same base config may declare `playable: {scenario: "<path relative to the
project root>", seed: <int >= 0>, ticks: <int > 0>}` at its top level. It
runs only after a green engine gate: `uv run
<plugin>/lib/playable.py run --directory <served root> --scenario
<served root>/<scenario> --seed <n> --ticks <t> --out <store> --wall-clock
<guard>` (the plugin from the supervisor's checkout; never `--mode`), its
`--out` the run's store folder (`<studio run dir>/playable/`), its
`report.json`, `log.txt` and `frames/` then copied into the worktree's
ignored `.bmad-loop/runs/<engine run id>/playable/`. On exit 0 with
`verdict: pass` the leg drives the judge: the `tk-studio-playable-judge`
skill as a `claude -p` session on the project's sandbox tier (`sbx exec`,
§1), routed by the `playable-verify` leg of `[pipeline.legs]` (§5.1) with
its own `model` and `effort`, payload `{media: ".bmad-loop/runs/<engine run
id>/playable"}`; it reads only `report.json` and the frames, never the code
or the spec, answers the fixed rubric (`scene-loaded`, `player-visible`,
`no-magenta-or-error-overlay`, `hud-reads`, `moments-shown`) through
`lib/playable_judge.py prepare|verdict`, which writes `<media>/judge.json`
(`{verdict: "pass" | "fail", findings: [{frame, rubric, note?}]}`), and ends
in a status block. Every ran `host-verify` event carries `playable
{verdict: "pass" | "fail" | "skipped", reason?, exit?, status?, failed?,
duration_ms?, store?, media?, judge?: {status, verdict?, cost_usd?, model?,
effort?}, findings?: [{frame, rubric, note?}], frames?: ["<store path>"]}`;
a reader treats a missing `playable` (a leg recorded before 34.3) as not
run. Skip reasons: `no playable`, `playable is malformed: <field>`, `no
verify.engine` (0.1.30, Story 35.6), `engine gate not green`; on a configured project every other non-pass is `fail` (a
harness fail, a `playable.py` refusal, a judge that ended blocked or
failed). The leg's `green` is also playable not `fail`, so a playable fail
is a red leg: the run ends `partial` with `host_verify: red` and the reason
``host verify red (playable): <rubric> at <frame>: <note>``, the PR a
draft whose `## Host verify` section gains `Playable: pass | fail | skipped
(<reason>)` with the findings and every frame's store path, the inbox line
carrying the reason; `POST /runs/{id}/verify` re-runs it with the rest of
the leg. The `job-run` event gains the optional `playable_verify_cost_usd`
(the judge's `total_cost_usd`, also counted in `total_cost_usd`; `jobrun.py
finish --playable-verify-cost-usd`).
Story 34.4 ships the read-only engine-knowledge skill `gds-engine-godot-4`
in the plugin's `skills/` (it reaches every dev session through the skills
mount, like every plugin skill) with its core `lib/engine_pin.py check
--directory <project> [--skill gds-engine-godot-4]`: it reads `project.godot`
`[application]` `config/features` (`features_version`) and `global.json`
`msbuild-sdks."Godot.NET.Sdk"` (`godot_net_sdk`) and `sdk.version`
(`dotnet_sdk`), checks `pinned` (`godot_net_sdk` when it parses as a dotted version, else
`features_version` when that parses; a `Godot.NET.Sdk` value that is not a
version is a warning)
against the skill's `pin.json` range `[min, below)` and prints `{engine,
features_version, godot_net_sdk, dotnet_sdk, pinned, supported, in_range,
warnings[]}` then the status block with `intent: gds-engine-godot-4`
(`complete`, warnings allowed; refusals `no project.godot`, `unknown skill`,
`malformed global.json` end `blocked`, exit 2). The `game-godot` detect
profile gains the optional `suggests_skills` list, passed through on every
`tk-studio-detect` candidate (default `[]`); on a `confident` outcome
`recommend.py propose` adds each as a `kind: skill` entry (`status:
installed` when the plugin ships it) with `detection:` and `engine-pin:`
evidence, and any version warning on the entry's `warnings[]` and in
`notes` prefixed `gds-engine-godot-4: `; `record` is unchanged (only a
confirmed set lands). The `tk-studio-launch check` `verify commands` row's
detail gains, from the tracked config only, `engine gate: sandbox and host
leg (engine.verify_commands, verify.engine)` when an
`engine.verify_commands` entry equals `verify.engine` once stripped (the
host leg runs `verify.engine` whenever it is set), `engine gate: host leg
(verify.engine, Story 34.1)` otherwise, or, with no `verify.engine` and the
skill in a `working_set.<role>`, `engine gate: sandbox list only
(engine.verify_commands; not identified without verify.engine)` when
`engine.verify_commands` has a non-empty entry, else `warning: engine gate:
none (...)`; the clause never turns the row red.
Story 34.5 adds one engine MCP per editor-in-the-loop run. A job definition
may carry the optional boolean `editor_in_the_loop` (default `false`,
validated by `job.py` like `durable`); the supervisor ORs it with the
submission flag (Story 22.3). The detect candidate gains the optional
`suggests_mcp` list (default `[]`), and on a `confident` outcome
`recommend.py propose` adds each as a `kind: mcp` entry with `detection:`
and `kb: kb/engine-mcp-godot.md` evidence, `status: configured` when the
project's `.mcp.json` has `mcpServers.<name>`, else `not-configured`;
`propose` and detection never write `.mcp.json`. `record` gains `--mcp
<name>` (with or without `--role`/`--resources`, both checked before
either write): the one writer of the project root's `.mcp.json`, it merges
`mcpServers.<name> = {"type": "http", "url": "${TK_ENGINE_MCP_URL:-}",
"headers": {"Authorization": "Bearer ${TK_ENGINE_MCP_BEARER:-}"}}` (the
empty default keeps the file parseable in a session where neither is set)
for a name some profile's `suggests_mcp` names (every other server
untouched, idempotent, an entry in the earlier `${VAR}` form rewritten,
`--dry-run`, atomic) and refuses an unknown name or malformed JSON (exit
2). For a flagged sbx run the supervisor reads `engine.mcp: {name, start,
port}` (optional `path`, default `/mcp`) from the tracked
`.tk-studio/config.yaml` at the run's base, starts it on the host with the
pin in the pick's measured launch shape (`hi-godot/godot-ai`,
`kb/engine-mcp-godot.md`: the server with a per-run capability in its
spawn env, `GODOT_AI_HTTP_CAPABILITY` and `GODOT_AI_WS_TOKEN`, telemetry
off; then the editor, `$GODOT --editor --path` the worktree's Godot
folder, `engine-mcp:start-failed` when it holds no `project.godot`),
fronts it on `TK_SUPERVISOR_BIND` (a tailnet address, else
`engine-mcp:start-failed`) port `TK_SUPERVISOR_ENGINE_MCP_PORT` (default
`8788`) behind a per-run bearer through a forwarder that is its own
detached child process (`bun src/enginemcp.ts forward`, the bearer in its
spawn env only, the server's capability put on each request upstream),
passes `TK_ENGINE_MCP_URL` and `TK_ENGINE_MCP_BEARER`
into the sandbox by name only (`sbx exec -e`), records `engine-mcp-start
{name, pid, start, url, forwarder_pid, forwarder_start, editor_pid,
editor_start}` (three pids, the server's, the forwarder's and the
editor's, each with its process start time) and `engine-mcp-stop {name,
pid, forwarder_pid, editor_pid, why}`, and stops all three at release
from any process, the editor before the server (a one-shot `drain` may
have exited since); a
refusal (`engine-mcp:no-config`, `engine-mcp:no-mcp-json`,
`engine-mcp:no-engine`, `engine-mcp:start-failed`) starts nothing and ends
the run `blocked`. The MCP is verify-only in this version: its
scene-editing tools are not exposed to the dev session.
Story 34.6 adds the asset manifest and the greybox rung of the asset
ladder: `asset-manifest.schema.json` (schema 1) at the project config's
`assets.manifest` (default `assets/manifest.yaml`), each entry's file
derived as `<assets.art_path>/<name>.glb` (default art path
`art/greybox`), and `lib/assets.py check|greybox|facts`, each ending in the
status block with `intent: assets` — `check` (an engine verify command)
refuses a manifest outside the schema naming the entry and the field and
fails an entry whose `facts` break its `tri_budget` or its bounds by more
than 1 %, `greybox` writes the missing `.glb` files through headless
Blender on the host (`BLENDER`, else `blender` on PATH) and never
overwrites one, `facts` reads a `.glb` with the stdlib
(§[Asset manifest](#asset-manifest-0129-story-346)).
Story 34.7 adds the ladder's cc0 and generated rungs: `lib/assets.py
mirror-index|match|generate`, the manifest's optional `tags`, `prompt` and
`camera` (schema still 1), `match` replacing a placeholder with a kit asset
from the box's mirror (`--mirror`, else `TK_ASSETS_MIRROR`, else
`C:\agent-work\assets`) and `generate` with a generated one only when the
project's `.tk-studio/budget-bands.yaml` sets `assets.credit_cap` and
`TK_ASSETS_MESHY_KEY` exists as a User environment variable, each through
`lib/blender/normalise.py`, the `facts` gate and a visual gate
(`lib/blender/render.py`), every generator call one `asset-generation`
taxonomy event, and `facts` reading node transforms
(§[Asset manifest](#asset-manifest-0129-story-346)).
Story 34.8 adds the `run-vertical-slice` job and the engagement's game
path: the shipped job type `jobs/run-vertical-slice.json` (`run-epic`'s
shape, no new schema field; a resolved instance keeps its `type`), whose
runs the supervisor treats as slices (the resolved definition's `type` or
`id` is `run-vertical-slice`, decided once and passed to the host leg and
the close-out). A slice's host leg adds the assets step after a green host
command and before the engine gate — `lib/assets.py check`, `greybox`,
`match` (never `generate`, never `--mirror`), recorded as `assets
{verdict: green | red | skipped, reason?, manifest?, art_path?, steps:
[{verb, exit, status, duration_ms, stdout_tail?, stderr_tail?}]}` on every
ran `host-verify` of a slice run, the close-out's and `POST
/runs/{id}/verify`'s alike (a step's `status` is the verb's status block
status, `fault`, or `error` with no status block; a red step is a red leg,
`host verify red (assets)`; a `match` exit 1 is `fault`, not red) — and `lib/playable.py
sheet` after `playable.py run` (the playable step's `contact_sheet` and
`sampled`); after a green assets step the close-out commits the placed art,
the manifest and `.tk-studio/proof/<run_id>/` by name before the push
(`host leg: placed assets and proof (run <run_id>)`), the PR embedding the
contact sheet. A game project's `engage.py scope` takes `--brief-file` and
`--gdd-file`, publishing `ENG-NNN: Game Brief` and `ENG-NNN: GDD` beside
the scope; the record gains `brief_page`, `gdd_page` and `game: true`, and
approval mints that engagement's `run-epic-N` jobs as `type:
run-vertical-slice`; the closeout input gains `slices` and the report `##
Slice verdicts`.
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
| `tk-studio-plan-sync` | `directory`; `backend?` (runtime override); `dry_run?`; `normalize_only?`; `setup?` (0.1.26, with `owner_account_id?` / `owner_email?`) (0.1.31, Story 36.6: the workflow update's transitions are v3-shaped with ids); `publish?` (0.1.26, Story 31.3, with `dry_run?` and `attachment_max_bytes?`, the site's Attachment maximum size in bytes → `--attachment-max-bytes`, the effective ceiling never above 100 MB); `sync_back?` (0.1.26, Story 31.4, with `dry_run?`) | `lib/plansync.py sync|normalize|setup|publish`; `lib/plansync.py sync-back` (0.1.26, Story 31.4); `lib/plansync.py deferred mint` (0.1.32, Story 37.1) | normalized planning artifacts, backend projection (`backlog/` locally; Jira issues under the `jira` binding, AD-7); the result names every file the run wrote — `written[]` (counter, entity files, story-file stamps, projection writes with their canonical snapshot rewrites, index) plus `removed[]` (projection files replaced on rename), with `normalize.counter` naming the committed id counter; a projection-blocked run still names normalize's landed writes — commit staging derives from the response alone | duplicate id (blocks until renumbered, AD-4); `jira` binding preflight failure — missing `planning.jira.site`/`project_key`, missing credentials — the `TK_ATLASSIAN_*` agent seat through the `api.atlassian.com` gateway (`TK_ATLASSIAN_AGENT_EMAIL`, `TK_ATLASSIAN_AGENT_TOKEN`, `TK_ATLASSIAN_CLOUD_ID`; either agent token set without the cloud id refuses by name, never the site URL), or with `TK_ATLASSIAN_AGENT_TOKEN` unset the legacy `JIRA_EMAIL`/`JIRA_API_TOKEN` against the site URL (0.1.26) — a 401 (token, its email, its expiry or org-admin toggle), the sandbox proxy's 403 (the network approval step) or another 403 (the missing scope, a new token), or an issue-type scheme missing a default-mapping target — every gap named, never a silent 401 (AD-7/AD-11). A both-changed promote/pull-back conflict does **not** block: the run ends `partial` with each conflicted entity named in `reason` — a human picks a side by editing one file, then reruns sync (AD-5). `setup` (0.1.26) ends `blocked` on an unregistered project, an absent agent-seat variable (each named, no Atlassian call) or a key collision, and `partial` — never `complete` — while any step the API refused is left to the owner as a numbered step; a dry run that would create anything ends `partial` and names those items in `would_create[]`; a `blocked` setup still lists in `owner_steps[]` (and `reason`) any step the API refused before the error; a `blocked` setup that created an item or left a project or space create to the owner still writes the keys it recorded, naming the config in `written[]`; a key is recorded only for an item found without collision, created, or left to the owner; the 'Needs you' filter is shared with the project, so while the project is an owner step it is created by the rerun; `publish` (0.1.26, Story 31.3) ends `blocked` on an absent `TK_ATLASSIAN_AGENT_EMAIL`, `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN` or `TK_ATLASSIAN_CLOUD_ID`, no `planning.confluence` binding (run `plansync.py setup` first), a bad `--source` or two sources with one title — each named, no Atlassian call — or on the 401/403 split above, and `partial` when a category's folder is not recorded (the category named in `skipped[]`), a page or an image is refused (an image over the per-file ceiling is named in `refused[]` and its page still publishes) or a dry run would publish anything (`would_publish[]`); an unchanged page is named in `skipped[]` and `found[]`, never written; `sync-back` (0.1.26, Story 31.4) ends `blocked` on no `planning.jira` binding or an absent Jira variable — each named, no Atlassian call — or on a failed preflight (unreachable, deactivated, the 401/403 split, or a preflight answered with another, non-auth status: run case `error`), and `partial` on an absent `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN` (the Jira half still runs, the mirror skipped), an unrecorded `planning.confluence.space_id` (the mirror skipped), no recorded owner accountId (comments, attachments and the mirror skipped by name), a conflict, or a 429 or error that interrupted a read (the cursor unchanged, `RateLimit-Reason` named); no recorded owner accountId also leaves the cursor unchanged; it writes only `_bmad-output/tracking/`, `kb/confluence/`, entity `status` (stamping `updated`) with its `external.jira` snapshot, `plan/index.md` (regenerated local-only when a status changed) and (0.1.27, Story 32.4) an engagement's `scope.md` with its record's `scope_page.version` — the engagement scope mirror reads each record's `scope_page.id` page by id and mirrors a version above the recorded one as Markdown into `kb/confluence/<slug>.md` (the header plus `engagement`, state under `sync-state.json` `engagement_pages`), replacing `scope.md` wholesale while the engagement is `scoping` (any other state: the mirror only and one `notes[]` line per version, no state moves; a 404 a note; counts `engagement_pages_mirrored` and `scopes_replaced`) — names each in `written[]`, and never runs promote; it reads one paged JQL search per tick, never a GET per issue — only an issue whose `comment.total` exceeds the comments the search returned pages `GET /rest/api/2/issue/{key}/comment` (overflow only) |
| `tk-studio-track` (0.1.26, Story 31.5) | verb `block` (or, 0.1.27, Story 32.3, `block` with `engagement` (`ENG-NNN`, exclusive with `story`, implying `source: engagement`, no `reason` or `resolves`; Story 32.6: `kind?` (`questions` \| `cap` \| `ask`, default `questions`) with `reason` for `cap` and `ask` only) and `dry_run?`; or `close`, 0.1.27, Story 32.3: `directory`; `engagement`; `dry_run?`; or `reply`, 0.1.26, Story 31.6: `issue`; `body` (written to a temp file, `--body-file`) \| `done?`; `dry_run?`; or `validate`, 0.1.26, Story 31.7: `issue`; `check?` \| `pass?` with `to` (`To Do` \| `In Progress`) and optional `ruling` (temp file, `--ruling-file`) with `spec` \| `fail?` with `follow_up` (temp file, `--follow-up-file`); `dry_run?`); `directory`; `story` (an entity id, or a loop story key `N-M-slug` matched by `source: epics.md#story-N.M`); `reason`; `resolves`; `source?` (`run` \| `engagement`, default `run`); `dry_run?` | `lib/track.py block`; `lib/track.py reply` (Story 31.6, host-only); `lib/track.py validate` (Story 31.7, the agent seat); `lib/track.py block --engagement` and `lib/track.py close` (Story 32.3, the agent seat) | the story's Jira issue and each dependent's (the entities whose `depends_on` names it) moved to `Blocked - Awaiting User` by transition name through `lib/jirabackend.py` (AD-4), each with one agent comment that @mentions the owner (`[~accountid:<owner>] Blocked: <reason>`, `Resolves when: <resolves>`, a dependent's `Blocked by: <key>`; 0.1.34, Story 38.5: `kind?` `engine` with `source: run` — `--kind engine`, an engine-clock pause — comments `Blocked (engine): <reason> — no owner action` with no mention, a dependent's neither, any other `kind` with `story` refused by name); a transition or comment already in place is skipped and named in `skipped[]`; the result `{ok, dry_run, story, source, issues[], notes[], written[]}` with the §3 block last; no local file written, nothing else promoted (D9) | no `planning.jira` binding or an absent `TK_ATLASSIAN_AGENT_EMAIL`, `TK_ATLASSIAN_AGENT_TOKEN` or `TK_ATLASSIAN_CLOUD_ID` — each named, no Atlassian call; no recorded `planning.jira.owner_account_id`; a story with no plan entity or never promoted (no `external.jira.key`); no transition reaching `Blocked - Awaiting User`, or the story's block comment refused by name after it moved (its entry keeps `transitioned: true`); the adapter's 401/403 split. A dependent that fails while the story's issue was blocked ends `partial`; a dependent already `done` or `dropped` is skipped, named in `notes[]`. A temporary failure on the story's own issue, or on a dependent's after the story's issue was blocked (an exhausted 429, a 5xx, the site unreachable), is no refusal: it ends `partial` with `ok: false` and the additive `retry: true`, and the caller calls again on its next pass; the comment is skipped only when the issue was already in the status before the run and its newest agent comment (read live; agent is anyone not the owner) has the same body; `reply` (Story 31.6) posts the owner's comment with the owner seat (`TK_STUDIO_ATLASSIAN_OWNER_EMAIL`, `TK_STUDIO_ATLASSIAN_OWNER_TOKEN`, the `TK_ATLASSIAN_CLOUD_ID` gateway) and moves the issue by name to `Block Resolved` (already there: skipped, named in `skipped[]`), the result `{ok, dry_run, issue, commented, comment_id, transitioned, notes[], skipped[], written[]}` with the §3 block last, and ends `blocked` by name on an absent owner variable or cloud id or no binding (no Atlassian call), no recorded owner accountId, a created comment not authored by the owner (nothing moved) or no transition reaching `Block Resolved` (`commented: true`), `partial` with `ok: false` and `retry: true` on a temporary failure; `validate` (Story 31.7) reads the changelog by status name (`owner_resolved` only for the newest transition into `Block Resolved` by the recorded owner accountId), marks the inbox item `validating` (`--check`), writes a ruling into the paused spec and moves the issue by name to `To Do` or `In Progress` (`--pass`) or re-blocks it with the follow-up (`--fail`), appending one `validation.jsonl` line per outcome, the result `{ok, dry_run, issue, mode, entity, story, owner_resolved, transition, reason_comment, replies[], notes[], written[]}` (plus `outcome` on a pass or fail) with the §3 block last, and ends `blocked` by name on a bad key, no binding or an absent agent variable (no Atlassian call), no recorded owner accountId, a live status other than `Block Resolved`, no transition reaching the target, or an absent spec or block for the ruling, `partial` with `ok: false` and `retry: true` on a temporary failure (no line); `block --engagement` (Story 32.3) finds the issue by its exact summary `ENG-NNN: questions` in `planning.jira.project_key` (`GET /search/jql`) or creates it (`POST /issue`, type `Task`, label `tk-studio-engagement`), moves it to `Blocked - Awaiting User` by name with the same skip rules and comments the record's open questions (`[~accountid:<owner>] Blocked: ENG-NNN needs <n> answer(s)`, `Resolves when: reply with one "<id>: <option>" line per question`, then per question `<id>: <text>`, `Impact: <impact>` and its options `- <label>`, ` (default)` on the default), the result `{ok, dry_run, story: null, engagement, source: "engagement", issues: [{issue, created, transitioned, commented, skipped?}], notes[], written: []}`, and ends `blocked` by name on `EngagementNotFound`, `NoOpenQuestions`, `IssueCreateRefused` (a 400 on the create) or `EngagementLockUnwritable`; Story 32.6's `--kind cap` (the engagement reached its cap) and `--kind ask` (a story landed under `ask` autonomy) need no open questions and block the same issue with the 31.5 prefix kept (`[~accountid:<owner>] Blocked: ENG-NNN <the reason's first line>`, ``Resolves when: reply with `go {cap}` from the web or the API, or `cancel` `` or ``Resolves when: reply `continue` to run the next story``, then the reason's other lines, the figures), the result carrying `kind`, refused by name `UnknownKind` (any other kind) or `ReasonMissing` (`cap` or `ask` without `--reason`), and `--reason` with `--kind questions`, or `--kind` with `--story` (but `--kind engine` with `--source run`, 0.1.34, Story 38.5), refused as a flag mix; `close` (Story 32.3) moves that issue by name to `Block Resolved`, then `Done` (a move already in place named in `skipped[]`), the result `{ok, dry_run, engagement, issue, moved[], skipped[], notes[], written: []}`, `EngagementNotFound` `blocked` when the engagement directory is absent, `NoIssue` `blocked` when the issue is absent, `NoTransition` `blocked` when no transition reaches `Done`, or `Block Resolved` from `Blocked - Awaiting User` (an issue never blocked, e.g. at `To Do`, skips `Block Resolved` when no transition reaches it, named in `skipped[]`), `EngagementLockUnwritable` `blocked` when the lock cannot be written; both hold `_bmad-output/engagements/<id>/track.lock`, a lock already held ending `partial` with `retry: true`, and both end `partial` with `ok: false` and `retry: true` on a temporary failure; 0.1.31 (Story 36.3), verb `unblock` (`story` with `reason` and `source?`, or `engagement` with `kind` `cap`\|`ask` and `reason`; `dry_run?`) → `lib/track.py unblock`, moving a Blocked issue to `Block Resolved` with a `Resolved:` agent comment and no mention, `skipped[]` otherwise, never `Done`; 0.1.34 (DW-51), verb `drop` (`engagement`; `issue` (repeatable, at least one); `reason`; `dry_run?`) → `lib/track.py drop` (the agent seat), a preflight before any write (every issue not yet dropped has a transition reaching `DNI`, else `NoTransition` with nothing moved), then moving each issue by name to `DNI` (`jirabackend.DNI_STATUS`) with one `Dropped: <reason>` agent comment and no mention, an issue already in a dropped status not moved and commented only when its newest agent comment is not that body (else named in `skipped[]`), the result `{ok, dry_run, engagement, issues: [{issue, transitioned, commented}], skipped[], notes[], written: []}`, refused `blocked` by name on `EngagementNotFound`, `NoIssue`, `BadIssue`, `ReasonMissing`, the agent seat's gaps, `NoTransition` or `JiraRefused: <key>: <error>`, `partial` with `ok: false` and `retry: true` on a temporary failure, holding the engagement's `track.lock` |
| `tk-studio-login` (0.1.33, DW-170) | `tool` (`sbx`); `config?` (the supervisor config, default `TK_SUPERVISOR_CONFIG`); `dry_run?` | `lib/login.py <tool>` — the owner's 1Password item named by the config's `logins.<tool>`, read with the 1Password CLI under `OP_SERVICE_ACCOUNT_TOKEN`, piped into the tool's one fixed sign-in argv on stdin | none (the tool's own sign-in state; `written: []`, no ledger events); the answer carries lengths, never a value | `ToolUnknown`, `ConfigMissing`, `LoginNotConfigured`, `OpMissing`, `TokenMissing` (each before any call), `ReadRefused`, `LoginFailed` (the tool's output clipped and scrubbed) — no value in the output |
| `tk-studio-engage` (0.1.27, Story 32.2) | verb `reply` (or `questions`, 0.1.27, Story 32.3: `project_root` as `--directory`; `engagement`; `run_id`; `questions` (a JSON array of `{id, text, options: [{label, default?: true}], impact}`, written to a temp file, `--questions-file`); `dry_run?`); `project_root` (the served registry root, as `--directory`; never `directory`, the run's worktree); `engagement` (`ENG-NNN`); `run_id` (the write); `body` (written to a temp file, `--body-file`); `proposals?` (a JSON array of `{verb, payload, label}`, written to a temp file, `--proposals-file`); `dry_run?`. or `scope`, 0.1.27, Story 32.4: `project_root` as `--directory`; `engagement`; `scope_file?` (default the engagement's `scope.md`) or `revise_at` (the supervisor's scope pass only, `--revise-at`); `brief_file?` and `gdd_file?` (0.1.29, Story 34.8: a game project's quick-flow game brief and GDD, `--brief-file`/`--gdd-file`, both required on a game project — one whose tracked `working_set` holds `gds` or a `gds-` entry and, 0.1.31 Story 36.6, whose `_bmad/_config/manifest.yaml` lists the `gds` module — unless a `revise_at` re-run's record already carries `scope_page` (it keeps whatever doc pages the record holds), refused `GameDocsMissing: brief \| gdd`; refused `NotAGameProject` on any other project; published beside the scope as `ENG-NNN: Game Brief` and `ENG-NNN: GDD`, merging `brief_page`, `gdd_page` and `game: true`); `dry_run?`. Stories 32.5 to 32.8 add the verbs `quote` and `closeout`. or `quote`, 0.1.27, Story 32.5: `project_root` as `--directory`; `engagement`; `seed?` (`--seed`, an integer `0 <= seed < 2**53`, exact as a JSON number; default the first 6 bytes of `sha256("<engagement>:<n>")`); `dry_run?`. or `closeout`, 0.1.27, Story 32.8 (the supervisor's closeout pass only, never the planner): `project_root` as `--directory`; `engagement`; `input` (the supervisor's composition `{run_id, outcome_hint, runs: [{run_id, job, state, studio_run_id, cost_usd, pr}], stories: [{key, run_id, spec_status, pr, pr_state}], epics: [{job, queued}], side_exits: [{at, to, verb, reason}], spend {planning_usd, runs_usd}, quote, slices?}` — Story 34.8, 0.1.29: `slices: [{story, engine, assets, playable, contact_sheet?}]` adds the `## Slice verdicts` section after `Deliverables`, one line `<key> — engine <v>; assets <v>; playable <v>` per story, each contact sheet embedded and uploaded to the page as an attachment; absent with no slice run; Story 35.6, 0.1.30: each entry also carries `report?`, `frames?` (its own leg's `report.json` and sampled frames, paths under the run workspace), attached as `<key>-report.json` and `<key>-frame-<name>`, the report's `\| Report \| Value \|` verdict table embedded under the story — written to a temp file, `--input-file`); `dry_run?` | `lib/engage.py reply`; `lib/engage.py questions` (Story 32.3); `lib/engage.py scope` (Story 32.4); `lib/engage.py quote` (Story 32.5); `lib/engage.py closeout` (Story 32.8) | with no `--body-file`, read-only: the memory `{record, chat[], memory {plan, kb, confluence}}` — the record (`engagement.yaml`, JSON text), the whole chat and three root-relative indexes of `_bmad-output/planning-artifacts/`, `kb/` (without `kb/confluence/`) and `kb/confluence/`, `{root, files: [{path, bytes, title}], truncated}` each (never a file's body); with `--body-file … --run-id`, the planner's line `{seq, at, author: "planner", body, run_id, proposals[]}` appended to `_bmad-output/engagements/<id>/chat.jsonl` under `chat.lock` (the next `seq`), named in `written[]`; the planner moves no state | a bad id (`BadEngagement`), no record (`UnknownEngagement`), a record that is not JSON or not the engagement's (`EngagementRecordUnreadable`), a terminal engagement (`EngagementClosed`), an empty or oversize body (`BodyEmpty`, `BodyTooLarge`, at most 32 KiB UTF-8), no `--run-id` (`RunIdRequired`), a proposal whose verb is not one of the six inputs, whose payload fails that verb's typed rules or whose `label` is empty or over 80 characters (`ProposalInvalid` naming the index), the chat lock held past the wait (`ChatBusy`), the chat not UTF-8, or the lock or chat file refused by the OS (`ChatUnwritable`); nothing is appended on a refusal, a dry run ends `partial`; `questions` (Story 32.3) writes `_bmad-output/engagements/<id>/questions.json` `{run_id, at, questions[]}` atomically (1 to 3 questions, each `id` matching `^[a-z0-9][a-z0-9-]{0,15}$` and unique, `text` and `impact` non-empty, 2 to 6 options with unique labels and exactly one `default: true`), named in `written[]`, the planner still moving no state (the supervisor applies the file once per `run_id`), and refuses by name `TooManyQuestions` (a fourth), `QuestionInvalid` (naming the index), `NotIntake` (any state but `intake`), `EngagementClosed` and `RunIdRequired`, nothing written on a refusal; `scope` (Story 32.4) writes `_bmad-output/engagements/<id>/scope.md` under `scope.lock` and publishes the page `ENG-NNN: Scope of Work` in `Engagements/ENG-NNN` (provenance footer; `page.action` `created`, `updated` or `skipped` when the remote content hash matches and the page is still at the recorded `scope_page.version`; an owner's newer version is overwritten, local wins), merging only `scope_page {id, url, version}` and `updated` into the record: `{ok, dry_run, engagement, mode: "scope", source: planner \| revise, scope, page {id, url, version, action}, written[], notes[]}`, nothing under `plan/`, `_bmad-output/planning-artifacts/` or `.tk-studio/`; it refuses by name `DeliverableWithoutSignal: <title>`, `ScopeInvalid: <what>` (a section missing, empty, out of order or unknown; an undated dependency; no proposed story; an image), `AssumptionUnstated: <question id>`, `NotScoping`, `EngagementClosed`, `ReviseNotFound`, `ConfluenceUnbound`, `ConfluenceEnvMissing` (each absent agent-seat variable named), `PublishRefused` and `ScopeUnwritable: <path>: <error>` (`scope.md`, the record or `scope.lock` refused by the OS; `written[]` names what had already landed), nothing written on a shape or state refusal; a 429, a 5xx or a held `scope.lock` (`ScopeBusy`) ends `partial` with `retry: true` (`scope.md` kept, `scope_page` unchanged); only the planner's scope is shape-checked — a `revise` body (`--revise-at`) is taken verbatim; `quote` (Story 32.5) merges only `quote {band50, band85, band95, cap, basis, computed_at}` and `updated` into a fresh read of the record recording each proposed epic's p85 dollars as `basis.epics[].usd_estimate` (`basis.epics[].ep_id` is `null` on an unreadable `.tk-studio/plan-counter.yaml`; `.tk-studio/budget-bands.yaml` is neither read nor written: approve copies the figures onto the minted EP ids), the record named in `written[]`, holding `scope.lock` from its read of `scope.md` through the merge: `{ok, dry_run, engagement, mode: "quote", quote, bands, written[], notes[]}` (`quote` the computed `{band50, band85, band95, cap, basis, computed_at}`, also on a dry run, `null` on a refusal before it is computed; `bands` `{EP-NNN: usd}`, the estimates recorded in the record, present once computed); the state does not move (the owner's `go` moves `scoping → quoted`); it refuses by name `BadSeed` (a `--seed` outside `0 <= seed < 2**53`), `NotScoping`, `EngagementClosed`, `NoScope` (no `scope.md`, no proposed story, a repeated `### Epic <k>` number, or proposed epics not numbered 1..m in order), `PricesUnreadable` and `QuoteUnwritable` (the record refused by the OS, an unreadable `measurements/`, or a held `scope.lock`: `scope.lock is held`; `written[]` names what had landed), nothing written otherwise; a dry run ends `partial`; `basis.notes` is a list of strings; a `scope.md` replaced in `scoping` (by `scope`, its `revise` body, or the sync-back's page revision) voids a non-null `quote` first (`quote: null` and `updated` merged before `scope.md` is replaced; a failed void refuses `ScopeUnwritable` from `scope` and, from the sync-back, which never raises, ends not applied with `retry: true`, `scope.md` untouched either way; the sync-back's `written[]` names a void that landed before a later failure); a page version whose Markdown equals `scope.md` replaces nothing and keeps the quote, its `scope_page.version` still merged; `closeout` (Story 32.8) writes `_bmad-output/engagements/<id>/closeout.md` atomically — the `##` sections `Outcome`, `Deliverables` (each `### <title>` of `scope.md`'s `## Deliverables` with `Acceptance signal:` and `Verdict: done \| not done — <why>`, the why the first of `no acceptance signal`, `epic not run`, `story <key> not landed`, `PR <url> not merged`; a deliverable's stories the proposed stories naming its title, else every proposed story; owner text unchecked: the signal line, else any line naming `acceptance signal`), `Pull requests`, `Cost per story` (`story \| run \| tokens \| usd` from the meter records by `story_key`, the runs' `job-run` cost, `—` unmetered), `Spend`, `Quote against actual` (`band50`/`band85`/`band95` usd, the cap, the actual, the band hit) and `Side exits` — publishes it as `ENG-NNN: Closeout` in `Engagements/ENG-NNN` (provenance footer; skipped when the footer hash and the recorded version match; no Confluence binding, an absent agent-seat variable or a refused write: `page: null` with a note, never a refusal) and merges only `closeout {path, page {id, url, version} \| null, outcome, done, not_done, run_id, at}` into a fresh read of the record: `{ok, dry_run, engagement, mode: "closeout", outcome, page, closeout, done, not_done, stories_left, written[], notes[]}` (`outcome` every deliverable done `delivered`, else the last run `blocked` `failed`, else `partial`; `stories_left`, 0.1.34 (DW-52, DW-53), additive: the keys, deduplicated in first-seen order, of every story judged `story <key> not landed`, `[]` when every story landed, never merged into the record); the state does not move (the supervisor applies `run-ended`); it refuses by name `NoScope`, `EngagementRecordUnreadable`, `CloseoutInputInvalid` (the input not a composition, or not JSON), `NotInProgress` (any state but `in-progress` or `partial`) and `EngagementClosed`, nothing written; a 429, a 5xx or an OS refusal ends `partial` with `retry: true`; a dry run ends `partial` |
| `tk-studio-migrate` | verb (`run\|status\|clear`); `directory`; `dry_run?` (run); `confirm?` (clear — the recorded operator clearance) | `lib/migrate.py run\|status\|clear` | closed inventory + migration record `.tk-studio/migrations/jira.json` (id map, hashes, verification, clearance state); Jira issues imported via the adapter; cutover flag (`planning.backend: jira` in tracked config) written last; source projection retained read-only | nothing to migrate; canonical export invalid; jira preflight failure (named, AD-7); **any verification mismatch** — counts, id map, content hashes, or spot round-trip — with each discrepancy listed (AD-16); cutover flag overridden by a local overlay; `clear` without `confirm` (no-delete-before-clearance) |
| `tk-studio-research` | `charter` (`{topics[], sources[], max_findings?, notes?}`); `directory`; `run_id?` (job runs) | `lib/research.py charter\|record\|seed\|spine` | `findings.json` + `findings.md` in the run workspace (a finding optionally cites a seed `anchor` — dangling citations are named rejections, per `knowledge.schema.json`); `seed.md` in the run workspace and the project spine `knowledge/spine.md` in the per-user store (aid, not gate — a missing spine is reported, never blocking; anchor ids append-only); `observation` ledger events for recommendation-carrying findings | charter missing/unscoped; run already terminal; invalid knowledge artifact (frontmatter, supersede header, anchor grammar — named rejection) |
| `tk-studio-session` | verb (`handoff\|resume`); `directory`; run selection: exactly one of `run_id` \| `job_id` (`job_id` resolves the job's sole resumable run — zero or several is a named refusal); handoff: `boundary` (`epic\|story\|phase`), `name`, `done[]`, `next[]`, `gotcha?[]`, `artifact?[]`, `delta?[]` (the `knowledge.schema.json` delta shape) | `lib/session.py handoff\|resume` | `handoff.json` in the run workspace — 16 KB budget, one per run, overwritten per boundary; a delta-carrying boundary also captures into the per-project reconciliation queue (best-effort — the handoff never fails on a capture problem); `resume` answers from the workspace alone | unknown or terminal run; ambiguous `job_id` resolution; handoff over the 16 KB budget or the 16-delta cap; dangling, unanchored, or within-handoff-duplicate deltas — named rejections (only the delta-carrying handoff refuses; the run stays resumable and a delta-free handoff always lands) |
| `tk-studio-knowledge` | verb (`check\|draft\|emit`); `directory`; draft: `base?`, `dry_run?`, `no_pr?`, `redraft?`; emit: `dry_run?` | `lib/promote.py check\|draft\|emit` | draft: ONE new dated `kb/reconciliation-<date>.md` on the stable branch `knowledge/<user>-<machine>` + the membrane PR (review is the gate — never a base push, never a merge, nothing auto-applies; D3/AD-12) and a draft line in the per-user promotions record; emit: one `knowledge-promotion` ledger event per batch of newly-merged drafts (at the skill's cadence, one per merged promotion PR), sole emitter this surface, reconciled against the promotions record — exactly-once per draft, never a duplicate (a draft emits nothing) | no routing doc (named rejection — the routing doc is the human's promotion-decision surface); not a git work tree; dirty tree; diverged promotion branch; detached HEAD; sanitization finding (NFR5, blocks pre-commit) |
| `tk-studio-consolidate` | `directory` (studio repo root); `dry_run?` | `lib/consolidate.py run` | `issues/ledger.md` synced in place (stable `ISS-NNN` rows: severity, status, expected-vs-actual, named evidence events, fix candidates — never a deleted row); no ledger events (derives, not emits — AD-12) | directory missing; measurements outside the studio repo (AD-3); unparseable issues ledger (refuses to rewrite what it cannot update in place) |
| `tk-studio-measure-push` | `directory` (studio repo root); `base?`; `dry_run?`; `no_pr?` | `lib/measurepush.py check\|push` | feature branch `measurements/<user>-<machine>` + membrane PR updating `measurements/<user>-<machine>.jsonl` — no ledger events (a mover, not an emitter, AD-12); never a base-branch push, never a merge | not the studio repo root; dirty working tree; sanitization re-check finding (credential-shaped content blocks pre-commit) |
| `tk-studio-playable-judge` (0.1.29, Story 34.3) | `directory` (the served root's VM path); `media` (the folder holding `report.json` and `frames/`, relative to `directory`); `model?`, `effort?` (the `playable-verify` leg) | `lib/playable_judge.py prepare\|verdict` | `<media>/answer.json`, `<media>/judge.json` (`{schema, verdict: pass\|fail, findings[{frame, rubric, note?}], rubric, frames, report_verdict}`); reads only `report.json` and the frames, never the code or the spec | no `report.json`, a malformed report, no frames; an unknown rubric id, a frame not in `frames[]`, a fail with no findings, a malformed answer |
| `tk-studio-evals` (0.1.30, Story 35.5) | `cases` (a JSON list of eval case names; default `tk-studio-playable-judge-verdict`, `asset-ladder-generated-rung`); `runs` (default 3); `directory` and `run_id` (the run workspace's `evals/` folder holds the results), or `out`; `plugin?`, `claude_bin?` (default `CLAUDE_BIN`, else `claude`; a `.py` one runs under the core's interpreter) | `lib/evals.py run` | `<out>/scores.json` (`{cases: {<case>: {runs, passed, score}}, cli: "<claude --version>"}`) and `<out>/<case>.json` (one `claude plugin eval <plugin> --trust-plugin --allow-tools Bash Write --no-publish --threshold 0 --case <case> --runs <n> --json <out>/<case>.json` per case; a case below its threshold is a score, never a refusal); the block's `reason` is `<case> <passed>/<runs>; …`; `scores.json` is rewritten after every case, a stale `<case>.json` deleted before its CLI runs; on the sandbox tier `<out>` is the VM's, the host reading the scores from the block (`run.json`, the `job-run` line) | the claude CLI unavailable; an unknown case; no output folder; a bad invocation; a case unscored (no result JSON, not in it, unreadable run verdicts, the CLI failing to run) is recorded in `scores.json` as `{error}`, the other cases still run, and the block's `reason` names it in that case's place |
| `gds-engine-godot-4` (0.1.29, Story 34.4) | `directory` (the project root); `skill?` (default `gds-engine-godot-4`) | `lib/engine_pin.py check` | none (read-only knowledge; prints `{engine, features_version, godot_net_sdk, dotnet_sdk, pinned, supported, in_range, warnings[]}`; a pin outside the supported range, a features/SDK major.minor disagreement, a `Godot.NET.Sdk` value that is not a version or an unreadable pin is a warning, still `complete`) | no `project.godot`; an unknown skill (no `pin.json`); a malformed `global.json` |
| `tk-studio-observe` | `source` (`retrospective\|repeated-manual-work\|research-job\|other`); `description`; `evidence?`; `project?` | `lib/observe.py record` | ledger line (`observation` event; 0.1.27, Story 32.5: the trial meter's record also carries the optional `kind`, `story_key`, `epic`, `usd`, `legs`, `route` and `prices_date` fields of `events/taxonomy.v1.json`, through `record_observation`'s `fields`; the CLI is unchanged) | required field missing |
| `tk-studio-evolve` | verb (`draft\|status`); `directory` (studio repo root); `dry_run?` (draft) | `lib/evolve.py draft\|status` | `proposals/ledger.md` synced in place (stable `PROP-NNN` rows: impact, status `Draft\|Under-review\|Adopted\|Declined`, evidence naming events and issues-ledger cross-links, the candidate change the observation itself states — never one invented, never a deleted row); drafting triggers nothing beyond the ledger sync — documents only, adoption is human (D1/AD-8); no ledger events (derives, not emits — AD-12, D2); a run that leaves `stranded` rows (a cluster merge) ends `partial` with the ids in `reason` | directory missing; measurements outside the studio repo (AD-3); unparseable proposals ledger (refuses to rewrite what it cannot update in place) |
| `tk-studio-report` | `description`; `surface?`; `project?`; `skill?`; `mode` | `skills/tk-studio-report/scripts/` | ledger line (`report` event) | `description` missing |
| `tk-studio-launch` | verb (`start\|status\|stop\|sweep`, default `start`; `sweep` 0.1.30, Story 35.7, with `max_bundles?`); `directory` (the main checkout); start: `epic` or `spec_folder?` (default `_bmad-output/specs/spec-epic-<N>` — the core's `--epic` applies the same default; `--spec` wins when both are given), `story?` (first story, `<epic>-<story>`; the skill derives it from the epic context / epics file when absent — never the core), `bootstrap?` (default true; skill-level only; 0.1.30, Story 35.2: the bootstrap plans every manifest entry in list order), `allow_budget_mismatch?` (0.1.21; default false — the core's `--allow-budget-mismatch`); status/stop: `run_id?`; stop: `graceful?` | `lib/launch.py check\|start\|status\|stop\|sweep`; `lib/pipeline.py defaults\|check\|resolve\|apply` (0.1.15 — the per-leg route, §5) | start: the routed policy block, subagent-model line and `.bmad-loop/routing.current.json` (`pipeline.py apply`, 0.1.15), the substrate run dir `.bmad-loop/runs/<run-id>/` (engine detached, console-less; its output in the per-user store `projects/<key>/launches/<run-id>.log`), plus any `SPEC.md` (via the project's `bmad-spec`) and `stories.yaml` entries + `plans/<N>-<M>.md` for every entry, in list order (0.1.30, Story 35.2; via the project's `.bmad-loop/plugins/studio-pipeline/task-planning.md`) the planner-tier preparation wrote; `status` is read-only (live runs, per-task phase/attempt/cycle, pause facts, tokens); no ledger events of its own — the `run-epic` job wrapper emits `job-run` (AD-12) (0.1.21) **bootstrap commit:** files the bootstrap wrote are committed on the checkout's current branch in one commit (that branch is the run branch — `loop/epic-<N>` by convention; its name is never checked or switched), message exactly `loop(epic-<N>): SPEC, manifest and story plans from the launch bootstrap` (0.1.30, Story 35.2; every `plans/*.md` written named), after the task bootstrap and before the readiness check — only those files, none on a relaunch, never pushed. **Every path ends with the block:** each `launch.py` result (`check`, `start`, `status`, `stop`, `sweep`, and the exit-2 refusal `{ok: false, error, …}`) ends with `status, intent, artifacts, reason`; `check` is `complete`, `partial` naming each `budget_mismatch`, or `blocked` naming its gaps; `start` is `complete` with `artifacts` = [`run_dir`, `spec_folder`] (never `run_dir_abs` or the store log) or `blocked`; `sweep` (0.1.30, Story 35.7) is `complete` on a read triage (`artifacts` = [`.bmad-loop/runs/<rid>`, `.bmad-loop/runs/<rid>/triage.json`], the one-line reason `bundles: …; blocked: …; decisions: …`) or with `reason: "triage still running"` when the wait elapses with the engine live (`artifacts` = [`.bmad-loop/runs/<rid>`]), else `blocked`: the engine ended or paused before any `triage.json` (the triage escalated, or `sweep: nothing open in the ledger`) or left one that does not parse (`sweep triage unreadable`); a relaunch (stories already `done`, route already applied) ends on the same block as a fresh launch; the watch hint names the supervisor's status page, the `status` verb and `bmad-loop tui`. **Budget check:** `check` and `start` carry `budget: {compared[], budget_mismatch[], not_compared[]}` — the largest band's `weighted_tokens` against `max_tokens_per_story` and `review_cycles_max` against `max_review_cycles`, each mismatch `{limit, policy, band, band_field, band_value}`; limits with no band field (`session_timeout_min`, `max_tokens_per_session`, `max_followup_reviews`) are `not_compared`, and so is a compared limit when any band carries its field with a non-numeric value (reason names the band and field, e.g. `band L weighted_tokens not a number`), and so is a compared limit the policy omits or gives a non-numeric value (reason `absent from policy` / `not a number in policy`); a missing or unparseable input is a named `budget` check entry; a mismatch is never a gap (`ok` unchanged); the `[limits]` of `.bmad-loop/policy.toml` are read only, never edited by the budget check or the launch core (the only launch writes to that file are the routing step's managed block and, 0.1.28, `check`'s `[verify] commands` reconciliation). **Verify commands (0.1.28):** `check` reconciles the policy's `[verify] commands` from the tracked list (`.tk-studio/config.yaml` `engine.verify_commands`, else `plugins/tk-studio/pipeline/verify-commands.toml`) — missing commands appended, the operator's kept — reported in the `verify commands` row and `verify_commands {source, tracked[], added[], kept[], policy}` on every `check` result; an unreadable or unplaceable source or policy is a gap (`engine.verify_commands` is the in-sandbox list; the host leg's engine gate is the separate `verify.engine` key, 0.1.29, Story 34.1: two keys, never merged). **Story plans (0.1.30, Story 35.2):** the advisory `story plans` row (after `playable path`, never a gap) reads `all <n> planned` or `without a plan: <id>, …` (manifest order), plus `; un-noted open questions: CAP-N (<id>), …` for later stories | a readiness gap the session may not close: a live engine already owning the checkout (one engine per checkout — never stopped to make room), `bmad-loop` not on PATH, a failing `bmad-loop validate` (dirty tree, broken policy); a `verify commands` refusal (0.1.28: a tracked list or `.bmad-loop/policy.toml` that does not parse, is not a list of strings, or whose `[verify] commands` cannot be located — the file named, fixed by hand); with `bootstrap` false, a missing `SPEC.md` or empty manifest; the gap `open questions` (0.1.30, Story 35.2: the next story — the first entry with no `stories/<id>-*.md` at `status: done` — has a CAP whose `- CAP-N:` open question no design note names, `<story id>: CAP-N has no design note — <question>`, so `check` is `blocked` naming every CAP; a later story's never is); the project's `bmad-spec` skill or task-planning instructions absent; a launch the engine never acknowledged (no `state.json` within the wait — pid and log named); a `budget_mismatch` at `start` without `allow_budget_mismatch` (exit 2, both numbers named); a `start` refusal after its readiness check that found a mismatch also carries the readiness `budget` object, before the block keys (other refusals keep `{ok: false, error}` + the block); a `sweep` refusal (0.1.30, Story 35.7: `blocked`, exit 2, nothing spawned): no `.bmad-loop/policy.toml`, no `_bmad-output/implementation-artifacts/deferred-work.md`, a live engine owning the checkout (`a run already owns this checkout: <run id> (<status>), …` — never stopped to make room), a dirty tree (`git status --porcelain`, the paths named), an existing run dir |

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
conditions, model/effort; `requires` `{tier}` added at 0.1.30, Story 35.5; `stop.max_own_blocks`, a bound and no stop condition, added at 0.1.34, Story 38.5) shipped with ST-6.1; `lib/jobrun.py` (the
`tk-studio-job` deterministic core, ST-6.2) implements this **verb surface**
on the harness-native substrate:

| Verb | Request | Response | Semantics |
| --- | --- | --- | --- |
| `submit` | the id of a shipped/project job instance (id-only — the definition already lives at the `job.schema.json`-published locations; a full-definition submit form is not part of this surface. DW-1 fold-in, 0.1.7) | `{job_id, run_id, accepted: bool, reason?, starter_lock?}` (0.1.23) | schedule per the job's trigger on the bound substrate; validation rejects a definition missing guards or stop conditions |
| `status` | `{job_id, run_id?}` | `{job_id, runs: [{run_id, state: queued\|running\|complete\|partial\|blocked\|cancelled, status_block?, started?, ended?}]}` | read-only; run state lives in `~/.tk-studio/projects/<key>/runs/<run-id>/` |
| `resolve` | `{job_id?}` (0.1.12) | one entry — `{job_id, source: instance\|type, extends?, path, problems[], resolved}` with `resolved` the merged definition — or, with no `job_id`, `{jobs: [entry...], problems[]}` covering every declared job in config order | read-only. Type extension (an instance extending a shipped type) is applied **studio-side by the one resolver** — a driver classifies recurring work from the `trigger`/`cadence` served here and never merges or raw-reads `.tk-studio/jobs/<id>.json` (PROP-008: an instance inheriting trigger/cadence from its type read as trigger-less through the raw file). A declared job's problems ride its entry named in place — never silently dropped; an unknown id is a named refusal |
| `cancel` | `{job_id, run_id?}` | `{cancelled: bool, reason?}` | stop scheduling; a running run terminates `partial` with reason `cancelled` |
| `wake` | `{job_id}` | `{woken: bool, run_id?, reason?, starter_lock?}` (0.1.23) | fire a self-paced/loop job's next iteration now (the retired ClaudeOS mission-runner "tick" mapped here, historical) |
| `finish` | `{run_id, state, reason?, status_block?, total_cost_usd?}` (0.1.18; CLI `jobrun.py finish --directory DIR --run-id RID --state STATE [--reason R] [--status-block JSON] [--total-cost-usd USD]`) | `{run_id, state, reason, capture?}` | the executing wrapper's terminal-transition verb (§2). `state` is one of `complete\|partial\|blocked\|cancelled` (the run schema's terminal states; the CLI refuses any other); `partial`, `blocked` and `cancelled` require a `reason`, refused by name otherwise. `total_cost_usd` (ST-061) is optional — the worker's `--output-format json` cost — a non-negative, finite number recorded in `run.json`; absent when not given, never zero-filled; an invalid value is refused by name before anything is written (AD-3). On a terminal state the run is finalized (`capture`) and one `job-run` event is emitted, carrying `total_cost_usd` when recorded. One `job-run` event per terminal transition (AD-12). `finish` is single-writer: a concurrent finish on one run is not supported (DW-129, TKSTUDIO-222 A) |

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
- **The shipped `run-vertical-slice` job (0.1.29, Story 34.8):**
  `run-epic`'s shape — a one-shot skill target on `tk-studio-launch` with
  `payload {verb: start, bootstrap: true}`, guards `max_turns` 80 and
  `max_wall_clock_seconds` 3600, `stop.on_status: [blocked]`, effort
  `high` — under its own id and description, no new schema field, shipped
  undeclared. The engine runs the story as `run-epic` does (the planner
  tier per the measured routing). Approval (Story 32.6) mints an
  engagement's `run-epic-N` instances with `type: run-vertical-slice` when
  the record carries `game: true` (else `type: run-epic`; the ids stay
  `run-epic-N`); `lib/job.py` keeps the instance's `type` on the resolved
  definition, and the supervisor treats a run as a slice when that
  definition's `type` or `id` is `run-vertical-slice`. On a slice run the
  host leg runs the assets step and the contact sheet, the close-out
  commits the placed art and the proof media, and the engagement's
  closeout lists the slice's verdicts per story
  (§[Asset manifest](#asset-manifest-0129-story-346)).
- **The shipped `run-sweep` job (0.1.30, Story 35.7):** `run-epic`'s
  shape — a one-shot skill target on `tk-studio-launch` with `payload
  {verb: sweep}` (an instance may add `max_bundles: <int ≥ 1>`),
  `requires: {tier: sbx}`, guards `max_turns` 80 and
  `max_wall_clock_seconds` 3600, `stop.on_status: [blocked]`, effort
  `high` — under its own id and description, no new schema field. The
  supervisor treats a run as a sweep when its resolved definition's `type`
  or `id` is `run-sweep`: one PR per sweep, the host leg once at the
  engine's end, and the ledger flipped after the merge (the 0.1.30 Story
  35.7 note below). Its cost, its host-side `sweep-triage` event, its
  `pending` wait and its re-run body: the 0.1.31 Story 36.2 note below.
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
  project root as canonical absolute paths (case-folded on Windows and
  macOS, as the supervisor's `foldCase`). An unreadable or malformed lock (bad JSON; a missing `starter`, `checkout`
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
`review`, `triage`, `supervise`, `planner`, `playable-verify` (0.1.29, Story
34.3: the host leg's screenshot judge, routed by the supervisor itself, never
an engine stage or a subagent leg). The launch resource ships
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

## Asset manifest (0.1.29, Story 34.6)

Every asset a slice needs is declared once, in the project's asset
manifest, and the asset ladder's first rung (the greybox) makes each one
exist as a placeholder before any art does. The surface is the lib's
`assets.py`, not a skill: no roster row, no new event, no new route.

**The manifest.** `asset-manifest.schema.json` (JSON Schema draft
2020-12, schema 1). It lives at the project config's `assets.manifest`
(default `assets/manifest.yaml`); the art path is `assets.art_path`
(default `art/greybox`; The Universe Awaits sets `art/world/greybox`). Both
are project layout, so they are config keys, never manifest keys. Top-level
keys: `schema` (1), `categories` (optional `#rrggbb` overrides of the
default colours: `prop #8a8a8a`, `character #d98c3f`, `environment
#5b8c5a`, `vehicle #4a78b5`, `ui #c7b84a`, `fx #9a5bb5`) and `assets`, a
list of entries with `name` (`[a-z0-9-]+`, unique, the file stem),
`category` (`prop | character | environment | vehicle | ui | fx`),
`tri_budget` (an integer; `check` refuses one below 12, a cube), `bounds`
(`{x, y, z}` in metres on glTF axes, Y up, each > 0), `origin`
(`base-center | center | base-min-corner`), `collision` (`none | box |
capsule | sphere | mesh`), `licence` (`greybox | cc0 | cc-by | generated |
proprietary`), `rung` (`greybox | cc0 | generated`), `status`
(`placeholder | candidate | accepted`) and an optional `source`
(provenance for the later rungs). The value sets are closed. An entry's
file is derived, never declared: `<art_path>/<name>.glb`.

**The verbs.** `uv run <plugin>/lib/assets.py`, stdlib only, each ending
in the status block (`intent: assets`; exit 0 ok, 1 gate red or a Blender
failure, 2 refusal):

- `check --directory <project> [--manifest PATH] [--art-path PATH]`
  validates the manifest (a value outside the schema is a refusal naming
  the entry and the field) and reports every entry as `{name, rung,
  status, file, present, facts, verdict: pass | fail | missing,
  reasons[]}`. A present file runs the `facts` gate: more triangles than
  `tri_budget`, or a bound off by more than 1 %, is `fail` and the run
  `partial` naming the entry; an absent file is `missing`, not a failure.
  `check` is an engine verify command.
- `greybox --directory <project> [--manifest PATH] [--art-path PATH]
  [--blender PATH] [--wall S]` runs on the host. It finds Blender through
  `--blender`, else `BLENDER`, else `blender` on PATH (none is a refusal
  naming `BLENDER` before anything is written) and, for every entry whose
  `.glb` is absent, writes the label texture `<art_path>/<name>.label.png`
  (256x256 RGB: the category colour, a black border, the name in a 3x5
  font) and calls `<blender> -b --python <plugin>/lib/blender/greybox.py
  -- --spec <json>` with the spec `{name, category, colour, bounds, origin,
  collision, tri_budget, label, output}`. The primitive follows
  `collision` (`box`, `none` and `mesh` a cube, `capsule` a capsule,
  `sphere` a UV sphere), sized to the bounds, its origin per the rule, a
  flat material whose base colour is the label, within `tri_budget`; the
  export is one `.glb` with fixed options. It never overwrites an existing
  `.glb` or label; the whole run is bounded by `--wall` (default 600 s).
  The same manifest gives the same label bytes; the `.glb` bytes are pinned
  to the Blender version (its `asset.generator` string).
  The report lists every entry as `{name, file, label, label_state,
  action, reason}`: `label_state` is `written | kept | stale` (null when
  the entry never reached its label: skipped, not run, or the label could
  not be written), `action` is `written | skipped | failed | not-run`
  (`skipped` when the `.glb` exists or appeared during the run, `not-run`
  once the wall clock is spent) and `reason` is null only when nothing
  needs saying; a row also carries `argv` once Blender was called and
  `exit` (null when the wall clock killed it) with `duration_ms` once it
  returned. A label already present whose decoded image (its pixels, not
  its file bytes) equals this manifest's label is `kept` and reused. A
  label whose decoded image differs from the one this manifest would draw
  (an earlier category or colour), or that cannot be read as a PNG, is
  `stale`: the label's bytes are
  left unchanged, Blender is not run for that entry, no `.glb` is written,
  and the entry is `failed` with a reason naming the label and asking for
  it to be removed first. A Blender output failing the `facts` gate (over
  budget, off bounds or unreadable) fails the entry with a `gate:` reason
  and is not placed. Any `failed` or `not-run` entry makes the run
  `partial` with exit 1; `counts` tallies the four actions.
- `facts <file>` reads a `.glb` itself (the header, the JSON chunk, the BIN
  chunk) and reports `triangles`, `bounds` (`{x, y, z}` extent), `min`,
  `max`, `origin` (`base-center | center | base-min-corner | other`), `uv`
  (`TEXCOORD_0` present) and `materials`; a malformed file is a refusal.

The later rungs (`cc0`, `generated`), `match` and the visual gate are
Story 34.7's; the host leg that runs `greybox` is Story 34.8's (below).

**The cc0 and generated rungs (0.1.29, Story 34.7, additive).** The
manifest gains three optional keys, schema still 1: an entry's `tags` (a
flow list `[a, b]` of `[a-z0-9-]+`, default `[]`), an entry's `prompt` (a
string, read only on the `generated` rung; default the name's words, then
the category, then `low poly game asset`) and a top-level `camera: {yaw,
pitch}` in degrees (default `{yaw: 45, pitch: 30}`, pitch in [-89, 89]).
`source` stays a string: `<kit>/<path>` (relative to the kit root, forward
slashes) on cc0, `meshy:<task id>` on generated. `rung` is the rung the
entry is assigned to; `status` says which file is in place: `placeholder`
(the greybox), `candidate` (a replacement failed a gate, the greybox kept),
`accepted`. Three verbs join, each ending in the status block (`complete |
partial | blocked`; exit 0, 1, 2):

- `mirror-index --kit <dir> --category <cat> [--licence cc0]` writes
  `<kit>/index.json` (`{schema: 1, kit, licence, licence_file, assets:
  [{path, category, tags[]}]}`, sorted by path, written atomically, the
  same kit giving the same bytes). The `.glb`, `.gltf`, `.fbx` and `.obj`
  files are indexed, their tags the lowercase tokens of the path's folders
  and stem (camelCase split, digits dropped); `.blend` files are counted in
  `skipped`, never indexed. A kit without a licence file at its root
  (`LICENSE*` or `LICENCE*` in any case, or a `*license*.txt` or
  `*licence*.txt`) is a refusal. The mirror is a box folder,
  never project layout: `--mirror`, else `TK_ASSETS_MIRROR`, else
  `C:\agent-work\assets` when it exists, one `<kit>/` per kit with its
  licence file and its index; `TK_ASSETS_MIRROR` is read like the key
  (`HKCU\Environment`, then the process env). An index `path` that is
  absolute or has a `..` segment is a refusal naming the kit and the
  path, as is one with a backslash (not a posix path: run `mirror-index`
  on the kit). Downloading the kits is the operator's step.
- `match --directory <project> [--manifest PATH] [--art-path PATH]
  [--mirror DIR] [--blender PATH] [--wall S]` (the cc0 rung) acts on every
  entry with `rung: cc0` and `status: placeholder | candidate`. With no
  mirror it ends `complete`, every such entry `skipped: no mirror`. An
  explicit `--mirror` naming a missing folder is a refusal (exit 2); a
  missing `TK_ASSETS_MIRROR` folder, or a missing default folder, ends
  `complete` with each cc0 entry `skipped` and the reason given. An entry
  whose greybox `.glb` is absent is skipped (`run greybox first`); one whose
  greybox label is `stale` fails with the greybox reason. A kit asset
  matches when it is in the same category with a score `|(tag tokens ∪
  name tokens) ∩ asset tags|` of at least 1 (each tag tokenised as the
  index's tags are: `street-lamp` is `street` and `lamp`, `barrel2` is
  `barrel`); ties go to the higher score, then the kit name, then the
  path. No match is `unmatched`, the placeholder
  kept, not a failure.
- `generate --directory <project> --run-id <id> [--manifest PATH]
  [--art-path PATH] [--blender PATH] [--wall S]` (the generated rung) acts
  on every entry with `rung: generated` and `status: placeholder |
  candidate`. It refuses (exit 2, before any network call or write) unless
  the project's `.tk-studio/budget-bands.yaml` carries a top-level
  `assets: {credit_cap: <Meshy credits > 0>}` (the refusal names
  `assets.credit_cap`; its absence is the rung's off-by-default), then
  unless `TK_ASSETS_MESHY_KEY` exists in `HKCU\Environment` or the process
  env (the refusal names the variable; its value never appears in output,
  a file, the ledger or argv). The cap is per `generate` invocation; Story
  34.8's host leg calls `generate` at most once per run. Before each call,
  when the credits spent plus the per-task charge would pass the cap, that
  entry and every later one is `not-run: credit cap` and the run ends
  `partial`. The check uses the highest charge reported so far in the
  invocation when that is above the estimate; a reported charge counts only
  when it is a number > 0. After a call leaves the credits spent at or over
  the cap, every later entry is `not-run: credit cap`; the pre-check uses
  the estimate, so a call priced above the estimate can overshoot by at
  most one call, and when it does the run ends `partial` with a reason naming
  the overshoot. An `asset-generation` line that does not land ends the run
  `partial` naming the entry, and every later entry is `not-run: ledger
  unwritable` (no further call). The generator is Meshy's text-to-3D preview, called from the
  provider's cloud (the host only downloads and runs Blender); every call,
  failed ones included, is one `asset-generation` ledger event `{run_id,
  asset, provider: "meshy", task_id?, credits, estimated?, state: complete |
  failed, reason?}` (`credits` the provider's reported charge, else the
  per-task estimate with `estimated: true`).

Both rungs normalise the replacement with `<blender> -b --python
<plugin>/lib/blender/normalise.py -- --spec <json>` (spec `{name, input,
bounds, origin, tri_budget, output}`: imported by extension, every transform
applied, joined to one mesh, decimated until the triangles are within
`tri_budget`, scaled non-uniformly to the bounds on glTF axes, the origin
per the rule, exported with greybox's fixed options) and publish it to
`<art_path>/.candidates/<name>.glb`. The `facts` gate runs on those bytes,
then the visual gate: `<blender> -b --python
<plugin>/lib/blender/render.py -- --spec <json>` (spec `{input, camera,
bounds, size, output}`) renders the greybox and the candidate with the
Workbench engine (flat lighting, a single colour, a transparent film,
128x128, an orthographic camera at the manifest's `camera` framed on the
entry's bounds, so both share one frame) to
`.candidates/<name>.greybox.png` and `.candidates/<name>.render.png`; the
masks are alpha > 0 (a render without an alpha channel fails the gate),
and the gate passes when `coverage = |C ∩ G| / |G| >=
0.25` (the floor measured on the box against a Kenney kit, Story 34.7's
operator step; the planner's 0.6 passed only boxy replacements) and
`fill = |C| / 128² >= 0.005` (not blank). Only when both gates
pass, and only after the manifest write-back lands, does `os.replace` move
the candidate over `<art_path>/<name>.glb`, the
one sanctioned replace of a placeholder (greybox still never overwrites a
file); a write-back that fails leaves every placeholder untouched and every
candidate in `.candidates/` (those entries `failed`, the run `partial`).
An accepted row whose manifest write-back fails ends action `failed` with `not placed: the manifest was not rewritten`. A replace failure after the write-back rolls the entry's lines back: a compensating write-back returns its `status`, `licence` and `source` lines to their prior bytes (an inserted `source` line removed), the candidate stays in `.candidates/`, the row is `failed` and the run `partial`; a compensating write that fails is added to the row's reason.
Otherwise the entry becomes `status: accepted` with `licence: cc0` and
`source: <kit>/<path>`, or `licence: generated` and `source: meshy:<task
id>`. A gate failure leaves the placeholder's bytes untouched, sets
`status: candidate` and lists the reasons (the run `partial`, exit 1).
A Blender or normalise failure is action `failed`: the run ends `partial`
(exit 1) and the entry's `status` is left unchanged.
`match` and `generate` rewrite only the `status`, `licence` and `source`
lines of the entries they moved (an absent `source` inserted after
`status` at the entry's indent), keep the rest of the file byte for
byte, and write atomically; a manifest the reader cannot map line by line is a refusal
before any work. `facts` now reads node transforms: the default scene's
nodes (`scene`, else scene 0, else every root node) compose TRS or
`matrix` down the tree, each mesh's POSITION box corners are transformed to
world bounds, and triangles count once per node instancing a mesh; a file
with no nodes keeps the mesh-only reading, and greybox output gives the
same facts as before.

**The slice's host leg (0.1.29, Story 34.8, additive).** On a
`run-vertical-slice` run only, the supervisor's host leg runs the assets
step after a green `verify.host` and before the engine gate (the import
sees the placed files). It reads `assets.manifest` and `assets.art_path`
from the tracked config at the run's base (defaults `assets/manifest.yaml`
and `art/greybox`); a manifest absent in the run's served root is
`skipped` with `no manifest`, the leg continuing. Otherwise it runs
`uv run <plugin>/lib/assets.py check`, then `greybox`, then `match`, each
`--directory <served root> --manifest <m> --art-path <a>` under the leg's
guard. It never passes `--mirror` (the env or the default resolves it;
with no mirror `match` ends `complete`, its entries `skipped: no mirror`)
and calls `generate` zero times, which satisfies "at most once per run".
`check` or `greybox` exiting 1 or 2 (or timing out, or failing to start)
is red; a `match` exit 1 (a Blender or normalise failure, a `candidate`)
is `fault` — recorded, not red, the placeholder kept; any other `match`
non-zero is red; the verbs after a red one are not run. The step is
recorded on `host-verify` as `assets {verdict: green | red | skipped,
reason?, manifest?, art_path?, steps: [{verb, exit, status, duration_ms,
stdout_tail?, stderr_tail?}]}` (`status` the verb's status block status —
`complete | partial | blocked` — or `fault`, or `error` with no block); a
red step skips the engine gate (`assets red`) and makes the leg red
(`host verify red (assets): <reason>`, the run `partial`, `host_verify:
red`). The PR section gains the line `Assets: green | red | skipped
(<reason>)`. After `playable.py run` wrote frames, `playable.py sheet
--frames <store>/frames --out <store>/contact-sheet.png` writes the contact
sheet (at most 16 frames sampled evenly in name order, nearest-neighbour,
8-bit RGB; `intent: playable`), copied with the media and recorded as the
playable step's `contact_sheet` and `sampled` (`contact_sheet` holds the
leg's own copy under `<store>/sheets/`, the shared
`<store>/contact-sheet.png` if the copy fails, so each leg (the
close-out's and each `POST /runs/{id}/verify`) keeps its own sheet and a
recorded `contact_sheet` is never overwritten by a later leg; the proof
folder and the media still
carry the name `contact-sheet.png`). After a green (or fault)
assets step the close-out copies `report.json`, `contact-sheet.png` and the
sampled frames into `.tk-studio/proof/<run_id>/` in the served root and
commits on the run branch, before the push, only `git add -- <art_path>
<manifest> .tk-studio/proof/<run_id>/` (never `-A`) with the message `host
leg: placed assets and proof (run <run_id>)`; a commit failure is the
close-out's `error` (nothing pushed). The PR section then embeds
`![contact sheet](<origin web URL>/blob/<head sha>/.tk-studio/proof/<run_id>/contact-sheet.png?raw=true)`
and lists the committed frames, on pass and fail alike. A non-slice run's
host leg, PR body and close-out are unchanged.

**0.1.30 (Story 35.1, additive).** The re-run is a whole leg (DW-76, hole
88 / DW-82): `POST /runs/{id}/verify` and `bun src/cli.ts verify <run id>`
run the host leg the way the close-out does and leave the PR reading the
latest leg. The cut is `<run worktree>.verify` on the run branch reset to
origin's tip — `git worktree add --relative-paths -B supervisor/run-<id>
<path> <tip sha>`, never detached: a stale local branch a removed
worktree kept is moved to the tip, but a local branch that is not an
ancestor of the tip (unpushed commits) is `500 VerifyFailed` naming the
branch and its `git log --oneline <tip>..<local>`, never moved; another
worktree holding the branch is `500 VerifyFailed` naming that worktree's
path, never removed. A non-slice re-run uses the
same cut and commits nothing. **The re-run's commit:** on a
`run-vertical-slice` run, under exactly the close-out's condition (a ran
leg whose assets step is green, a `match` fault counting green — on
playable pass and fail alike), the re-run commits the placed art, the
manifest and `.tk-studio/proof/<run_id>/` through the close-out's own
proof commit (the leg's own `<store>/sheets/` copy is the committed
`contact-sheet.png`, as on the close-out), with the message `host leg:
placed assets and proof (run <run_id>)`, then `git push origin
supervisor/run-<id>` (never forced, a fast-forward), before any PR call; a
slice re-run whose `verify.host` or engine gate is red (no green assets
step) places and commits nothing, while a playable fail after a green
assets step still commits. A commit or push failure is
`rerun.commit` or `rerun.pushed: "error: …"`: the leg is still recorded,
the body is never edited and green flips nothing, but a red leg still turns
an open ready PR back to a draft (`pr_draft`, `pr_body` unset). A failed
push rolls the supervisor's own proof commit back to the tip the re-run was
cut at, so a retry is not refused as a branch ahead of origin (a failed
rollback appends `; local branch left ahead: …` to `rerun.pushed`). A re-run
on a red leg always attempts the `--undo` whatever earlier step failed; only
the body edit and the green ready flip depend on earlier steps succeeding.
**The PR-body rule:** the PR (the run's
recorded one, else an open PR from the run branch) is read with `gh pr
view --json state,isDraft,body`; an open PR's body is regenerated through the
close-out's renderer from the record — the `## Launch status block` (the
launch's block, re-rendered; no new field in the fenced block), `Engine
run`, the landed commits (`git log --oneline <base_ref>..HEAD` in the cut),
the recorded cost (the run's worktree gone, so no metered cost to read:
the old body's `## Metered cost` section carried back unchanged, the
record-only figure only when the old body has no such section; an
unreadable PR is never edited) — and `gh pr edit --body-file`; its `## Host verify`
section is the latest leg's, its first line the one-line history `Legs:
<k> — ` then one entry per leg oldest first joined by `; ` (`close-out
<green|red|skipped> <recorded_at>`, `re-run <green|red|skipped>
<recorded_at> (by <api|cli>)`), the legs being the run's `host-verify`
events after its latest `launched` plus the one being written; a
close-out's first body carries `Legs: 1 — close-out …`. Then green marks
an open draft ready (`pr_ready: "marked" | "already"`) only once the body
is `edited` — a failed edit leaves the PR as it was, `pr_ready` unset —
while red turns an open
ready PR back to a draft with `gh pr ready <pr> --undo` (`pr_draft:
"undone" | "already"`) and the event's top-level `reason` is the red
reason (`host verify red…`, as the close-out's), skipped flips nothing. A
PR not open is never edited (`pr_ready` or `pr_draft: "not open"`); a
failed edit is `pr_body: "error: …"`, never thrown; a PR whose state
cannot be read is never edited and is `pr_body: "error: gh pr view …"`
whatever the verdict (plus `pr_ready` or `pr_draft` with the same error on
green or red) — after a failed commit or push `pr_body` stays unset and
only a red leg's `pr_draft` carries that error. The `host-verify`
event's `rerun {by, head, worktree, pr, pr_ready?}` stays (its presence is
`rerun: true`; the close-out's leg carries none) and gains `commit?:
{sha, frames, sheet?} | "skipped: <why>" | "error: <clipped>"`, `pushed?:
"<branch>" | "error: <clipped>"`, `pr_body?: "edited" | "error:
<clipped>"` and `pr_draft?: "undone" | "already" | "not open" | "error:
<clipped>"`; the verb prints `rerun: true` beside them. The 0.1.28 rule
"red or skipped never touches the PR" is superseded. The run's terminal
state, its `ended` event and its engine are never touched; every other
field, kind and route is unchanged.

**0.1.30 (Story 35.8, additive).** Every stage leaves a start and a stop.
**The table:** a story's executor spec (`stories/<key>-spec.md`) carries one
`## Stage Log` section with one Markdown table, the columns exactly `stage`,
`pass`, `started`, `ended`, `session_id`, `model`, `effort`, `tokens_in`,
`tokens_out`, `cost_usd`, `outcome` (`—` for an empty cell; `started` and
`ended` ISO-8601 UTC `YYYY-MM-DDTHH:MM:SSZ` from the clock of whoever ran
the stage); elapsed is never stored, only derived, and a gap between a stop
and the next start is reported as a gap, never hidden. The section sits after
`## Consult Log` (created there; with none, before `## Auto Run Result`;
with neither, at the end — never after `## Auto Run Result`); rows are
append-only, one per stage occurrence, except that `stage --stop` completes
its own open row in place. A row's key is
`sha1("<story>|<stage>|<pass>|<started>")[:12]`, derived from the row, never
a column. A row written before the spec exists is buffered in
`<spec_folder>/stages/<key>.jsonl` and flushed into the table, in started
order, by the next write that finds the spec. The epic's planning stage is
one row on the epic's plan entity (`--entity EP-NNN`), carried over
`normalize`'s body refresh. **The verbs** (each ending in the AD-11 status
block, intent `tk-studio-plan-sync`; a refusal exits 2): `plansync.py stage
--start|--stop (--story <key> | --entity <id>) --stage <name> [--pass n]
[--model] [--effort] [--session-id] [--outcome]` (the operator's: `--start`
appends `ended: —`, `outcome: running`; `--stop` with no open row is a
refusal naming it); `stage --append --story <key> --row-json <row | [rows]>`
(the supervisor's; a key already on record is skipped, `appended: 0`); `stage
--from-pass --run-dir <run> --story <key> --role --phase --worktree` (the
studio-pipeline plugin's `[hooks.post_session]`, `meter_hook.py`, exit 0 on
every path: one row for the pass from state.json's latest session record —
its stage from the task label, dev / review / gate, its pass the count of the
story's sessions of that stage — started and ended from the journal's
`session-start` / `session-end` ts, every session — the current and each
earlier one counted — classed by the same evidence: the stage its row was
written with, else the journal's `pre_commit_gate` workflow, else the label,
role and phase; tokens summed from the transcript's usage
lines and its non-consult subagents (`tokens_in` = input + cache-read +
cache-creation, `tokens_out` = output, deduped by `message.id`), `cost_usd`
from `prices.json` (`—` when unpriced), effort from `routing.current.json`;
then one `consult` row per subagent whose first user message opens with
`# Consult: a ruling on one objective trigger`; `--repo-root <root>`, which
the hook passes when `BMAD_LOOP_REPO_ROOT` is not the worktree, flushes the
buffer the planner left under that root too, removing it once moved). The
supervisor's rows (the
host clock; model, effort, tokens and cost `—`): each `host-verify` leg a
`host-leg` row from its `started_at` (new, additive, on a ran
`HostVerifyRan`) to the event, a `re-run` row when it carries `rerun`, each
close-out record on an `ended`, `closed_out` or `paused` event (a paused
close-out — commit, push, draft PR — is recorded on its `paused` transition)
a `close-out` row (one per record: a busy queue's
`closed_out {closeout, pending}` and the `ended` written from it are one),
the merge a `merge` row at gh's `mergedAt` —
appended by the stage pass at the end of every merge pass, into the owner
root's spec, for each run pulled back to `done` by a stage-capable supervisor
(its `done` event carries `stage: true`, new, additive, on the `plan-status`
event); runs merged before 35.8 get no supervisor rows and are never
back-filled. **The comment
shapes:** `plansync.py stage-post --directory <root> --id <ST-NNN> [--story
<key>] [--dry-run]` (the supervisor's, never the sandboxed engine's; the agent
seat by name only, AD-3) posts per row one comment at the start, `Stage
<name> [pass n] started — <row's started>; model: X; effort: Y
[stage:<key> start]`, and once the row is completed one at the stop, `Stage
<name> [pass n] finished — <row's ended>; model: X; effort: Y; tokens:
in/out; cost: $Z [stage:<key> stop]` (`[pass n]` omitted with no pass), so a
comment's server `created` minus the body's own stamp measures relay lag and
skew; **the worklog** at the stop carries the derived span (`timeSpentSeconds`,
`started` in Jira's `YYYY-MM-DDTHH:MM:SS.000+0000`, its comment
`[stage:<key> worklog]`), the secondary record; a span under Jira's 60 s
minimum logs none (`worklog: "skipped: span <60s"`), its comments still
posted. Each post is recorded as it lands in
`_bmad-output/tracking/stage-posts.json` `{<row key>: {start: {id,
created}, stop: {id, created}, worklog: {id}}}` (`worklog` the skip string
for a short span); a marker already on the issue (`GET` comments / worklogs
first) is recorded, never posted twice. A project not bound to Jira posts
nothing (`posted: "skipped: not bound"`). The answer's `unposted` counts the
rows not yet fully mirrored — buffered rows, open rows awaiting their stop,
rows a post is still missing for — and while any remain it is `ok: false`,
`partial`, `retryable: true`; a failed Jira call is `ok: false`, `retryable:
true`; a refusal (several specs match, no `external.jira.key`, no agent
token) carries no `retryable`. The supervisor's `stage-post {story_key, id,
directory, appended, posted, ok, detail?, unposted?, settled?, merged_at?}`
queue event records each attempt: `ok: true` only once nothing is unposted;
rows only buffered at the owner root (bound or not) are an uncounted wait,
never a retry — never counted toward `PLAN_RETRY_LIMIT`, never settled, never
the give-up, recorded once while it lasts (`waiting: true`) — and no lease is
taken while the owner checkout has no
`_bmad-output/specs/*/stories/<key>-*.md`; a tick whose only non-ok outcomes
are waits lets the lease go settled, so the retry window starts again after
it; a refusal
recorded once `settled: true`, never retried; a retry tried again every pass
(an identical failure not recorded twice), bounded at `PLAN_RETRY_LIMIT`
released stage leases, then one settled `gave up after <n> attempts: …`; a
newer `host-verify` (a re-run's leg) re-enters a settled story — never
blocking the run or changing its state.
**The event:** `stage` (taxonomy, additive), emitted by `measurepush.py push`
alone before the push, one per completed row whose `row_key` the ledger lacks:
`{project?, story, stage, pass?, started, ended?, session_id?, model?,
effort?, usage? {input, output}, cost_usd?, outcome?, row_key, source?}` (no
token-named key). The harvest covers the `--directory` studio repo plus every
registry root (DW-96; a missing or unreadable root, or an unreadable registry,
is skipped and reported under `skipped_roots` / `registry_error`, never
fatal); `row_key` is the bare sha12 for the studio repo (the `--directory` and
any registered studio checkout) and `<project_id>:<sha12>` for other registry
roots; a registry root's `project` is its registry id; the result counts per
project under `projects` (label -> `{emitted, already}`; the studio's label is
its config `project_id`, else the matching registry id, else the directory
name); `skipped_roots` entries are `{project_id, root, reason}`, the reason
`missing`, `not a directory`, the read error, or `emit failed: …` (an emit
failing partway through a root, whose partial counts stay in `projects`);
`registry_error` is present only when the registry read fails. **The rollup:**
`lib/report.py rollup --directory <root>
(--story <key> | --epic <N>) [--post --id <EP-NNN>]` (also
`tk-studio-report`'s `report.py rollup`) names per story and per epic the cycle
time (first start to the merge's end), hands-on time (the sum of the spans,
a row lying wholly inside another engine row's span — a consult inside its
review pass — not counted twice, still listed in its stage type),
the planning share, review rounds, re-runs, the gaps, tokens and cost per
stage type, and Jira's stamps beside them with each boundary's skew and the
max named; the epic rollup counts each span once (shared supervisor rows —
`host-leg`, `re-run`, `close-out`, `merge` — matched on stage, pass, started,
ended; a span inside another story's engine span counted as nested); `--post`
adds one rollup comment to the epic's issue, idempotent by
`[stage-rollup:epic-<N>]`. The retrospective reads this rollup instead of PR
timestamps. Every other field, kind and route is unchanged.

**0.1.30 (Story 35.2, additive).** Every story gets its plan and its records.
**The plan per story:** the launch bootstrap (`bootstrap: true`, planner tier,
`task-planning.md` §1) plans every manifest entry in list order, the named
story first — `plans/<N>-<M>.md` with a Code Map and a `band` each — and its
commit is `loop(epic-<N>): SPEC, manifest and story plans from the launch
bootstrap`, naming every plan written. **The open-question refusal:**
`launch.py check` adds the gap `open questions` for the story the launch
would start (the first manifest entry with no `stories/<id>-*.md` at `status:
done`, `findSpec`'s glob) when one of its CAPs (`- **CAP-N** (<N>.<M>)`) has an
open question — any `## Open Questions` bullet naming the CAP: a `- CAP-N:`
line under SPEC.md `## Open Questions` (or a CAP list — `CAP-9 and CAP-10`,
`CAP-11/CAP-12`, `CAP-4, CAP-5` — the line counting for each CAP named, and
only for its lead CAPs), or a bullet naming the CAP anywhere else (`- Is X in
scope for CAP-2?`, `(CAP-2)`; the whole bullet is the question, once per CAP
named) — and no bullet under `## Design notes (settled shape, planner, <date>)`
names that CAP (a CAP-list subject notes each) or the story (`<N>.<M>` or
`<N>-<M>`, which notes all its CAPs); the detail is `<story id>: CAP-N has no
design note — <question, clipped>`, one per question line, `; ` between, so the
block is `blocked` naming every CAP before any dev session. A SPEC with no
`## Open Questions` makes no gap, and a later story's un-noted CAP never
does: the advisory `story plans` row (after `playable path`, `ok` always)
reads `all <n> planned` or `without a plan: <id>, …` (manifest order) plus `;
un-noted open questions: CAP-N (<id>), …`. **The planner's pick (AC2):** the
refusal, never per-story records. A graceful stop is in force for a paused
run when its engine run dir holds `stop-request.json` (existence only, any
content), or its `journal.jsonl` has a `stop-request-discarded` entry with no
`run-resume` or `run-start` entry after it (journal order; a missing or
unreadable journal is no stop) — bmad-loop deletes a pending request on every
exit and journals the discard, so the file alone never survives a pause; the
supervisor reads only the run dir. Read before the archive step: the
paused-run pass's close-out of a landed story with a stop in force still
commits, meters and records the engine cost, but neither archives nor
relaunches; the run stays `paused` and gets one `story-boundary` event
`{story_key, engine_run_id, code: "StoryBoundary", reason: "a graceful stop
is in force (requested <at>): relaunching would start the next story in this
run", graceful_stop: "kept"}` (`<at>` the file's `requested_at`, else `at an
unknown time`; `before the pause, discarded at pause` when read from the
journal) and one notifier line, once since its latest `paused`, the pass
skipping the run after (a resume is refused `StoryLanded`; the operator ends
the run with `POST /runs/{id}/cancel`). `POST /runs/{id}/resume` of a story that
did not land, with a stop in force, re-issues the graceful stop on the
resumed engine once after the pid re-read (`launch.py stop --graceful`) and
records `graceful-stop {engine_run_id, rearmed: true, ok, detail}`; when the
resume never rewrote `engine.pid` (bmad-loop clears `stop-request.json` just
before that write, so an earlier stop could be deleted) no stop is sent and
`graceful-stop {engine_run_id, rearmed: false, ok: false, detail: "engine.pid
not rewritten by the resume: re-arm skipped"}` is recorded; the resume's
answer is unchanged. A skipped re-arm, or one whose stop answers or throws
`ok: false`, also sends one notifier line (the stop was not re-armed on the
resumed engine; re-issue `launch.py stop --graceful` for its engine run id),
its outcome the event's `notify`; a re-arm that holds sends none. The
per-story-records half of AC2 (a gate file, a `## Reconcile` and a `job-run`
line per story, a PR body listing both) is not built: one engine run never
carries two stories under a graceful stop, save after a skipped or failed
re-arm, which that notifier line puts to the operator.
Every other field, kind and route is unchanged.

**0.1.30 (Story 35.3, additive).** The slice path, hardened: a slice
leg's red means the game, not the box (DW-94, DW-88, DW-89, DW-70).
**The walls:** a tool with its own wall clock gets `toolWall = min(max(1,
guard), 86400)` — `assets.py greybox` and `match` as `--wall <toolWall>`
(new in the argv; `check` takes none), `playable.py run` as `--wall-clock
<toolWall>` — and its step runs under `toolWall + TOOL_WALL_MARGIN_S`
(`TOOL_WALL_MARGIN_S = 30`, above `KILL_TREE_TIMEOUT_S` plus the report's
write), so the tool's own kill writes its report first and the leg reads
`wall-clock` from it (assets the block's `reason`, `wall clock: …`;
playable `report.json` `failed.invariant: "wall-clock"`, the finding
`harness: wall-clock`). A guard trip still reads `timed out (guard…)`. The
host, engine, sheet and judge steps keep the guard. **The `match` fault:**
this supersedes the 34.8 paragraph's `match` sentence (a `match` exit 1 is
`fault`, any other non-zero red): a `match` that crashed (a non-zero exit
with no status block), left entries `not-run` (`counts["not-run"] > 0`) or
failed its write-back (`writeback` non-null) is `fault` and red, the
assets reason naming which (`assets.py match crashed (exited <n>, no status
block): <last line>`, `assets.py match fault: <n> not-run: <reason>`,
`assets.py match fault: write-back failed: <writeback>; <reason>`); a
`match` exit 1 whose block shows only ordinary rung outcomes (failed or
candidate rows) keeps the non-red `fault`. A `match` step also records
`reason?`, `writeback?` and `not_run?` from its block. **The proof
commit:** the close-out and the re-run commit a slice leg's proof when the
leg ran, its own playable step ran (not `skipped`, `playable.py` exited 0
or 1), its playable store holds `report.json` (or, the store pruned, the
served root's proof folder already does) and its assets step is not red —
green, a non-red `match` fault, or `skipped: no manifest`; a red assets
step commits nothing, so red art is never placed. The commit stages only
the named paths that exist, runs `git check-ignore` on them first and
skips an ignored one (listed as `skipped_ignored` on the commit's result,
the re-run's `rerun.commit`), and stages the art path with the pathspec
`:(exclude)<art_path>/.candidates` (the add, the diff and the commit
alike), so the ladder's candidates never land; a named path with nothing
staged after the add is left out of the commit, and only a staged sheet and
staged frames are embedded. **The sheet:** `playable.py
sheet --report <store>/report.json` samples only the report's `frames[]`
(each `file` relative to the report's folder) — the judge's citable set,
never every movie frame; its `frames` stay bare file names and `of` counts
the report's frames. **The rubric:** `lib/playable_judge.py rubric` prints
`{ids: [...], rubric: [{id, line}]}` in a `complete` status block, the
rubric ids' one home; the leg runs it once per judge step under the guard
and refuses a finding naming another id (the supervisor keeps no copy).
**`inconclusive`:** a judge that cannot run or answer — no sandbox
recorded, a thrown invoke, the sandbox pin failed (`pin`, `ran: false`),
the auth preflight blocked (`preflight`, `ran: false`), no status block
(`conformance_failure`), or an unreadable `rubric` answer — makes the
playable step `verdict: "inconclusive"` with `reason: "infrastructure:
<pin|sbx|status-block|auth|rubric>: <detail>"`, never a rubric `fail`: the
leg is not green and not red, the run ends `partial` with `host verify
inconclusive (playable): <reason>`, no finding is recorded, and the PR's
line reads `Playable: inconclusive — <reason>`. An inconclusive leg's
`Legs:` entry and its `host_verify` read `inconclusive`, and it flips no
PR: the close-out leaves a draft (a new PR opened `--draft`, an open one
never marked ready) and the re-run marks nothing ready. `inconclusive` is the
supervisor's verdict on the `host-verify` event's `playable`, beside `pass`,
`fail` and `skipped`; it is never the judge's (`judge.json` keeps `pass |
fail`). The judge's own `blocked` with a game cause stays `fail`.
Every other field, kind and route is unchanged.

**0.1.30 (Story 35.4, additive).** The engine MCP before the first flagged
run (the retrospective's B6, B7, AI-5; DW-83's 34.5 debt). **The ports:**
`engine.mcp.port: 0` is the per-run port: at the pin a free `127.0.0.1`
port is resolved and put in for `{port}` in `engine.mcp.start`, and a
second one for `{ws_port}` when the start line carries it; `port: 0` with
no `{port}` in the start line is `engine-mcp:no-config` (`engine.mcp.start
has no {port} for port: 0`), nothing spawned. A positive `engine.mcp.port`
keeps its 0.1.29 meaning — the server listens there, the port is checked
before the start and `{port}` is replaced with it when present — and is
never refused or ignored: a fixed port means one flagged run at a time.
Likewise a set `TK_SUPERVISOR_ENGINE_MCP_PORT` keeps the forwarder fixed;
unset or blank, the forwarder binds `:0` and the supervisor reads its port
from `engine-mcp-forwarder ready <port>`, the URL carrying the port it
bound. This unset-means-per-run reading supersedes 0.1.29's default
`8788`: a box whose sandbox network policy was opened by hand for `:8788`
needs only to set `TK_SUPERVISOR_ENGINE_MCP_PORT` to `8788`. A resolved port is free only at its resolution: the pre-check and
the "another listener answered" check stay the race guards. **The
events:** `engine-mcp-start` and `engine-mcp-stop` gain `port`,
`forwarder_port` and `ws_port?` (the numbers in use, resolved or fixed; a
stop of a start recorded before 0.1.30 carries them `null`), and
`engine-mcp-start` gains `advisory?`. `pin-released` and `pin-kept` gain
`engine_mcp?: "stopped" | "stop pending"`, present only when the run has
an `engine-mcp-start`: `stopped` once its last start has a stop after it,
`stop pending` when the stop is left to a later release or recovery.
**Record before unref:** the start is recorded (`engine-mcp-start`) before
the three children are let go (`unref`) and before the MCP is live in the
starting process; a record that fails kills all three (the forwarder, the
editor, then the server) and is `engine-mcp:start-failed` (`the start
could not be recorded: <clipped>`), a refusal like any other: the
recorder's pin fails and a drained run ends `blocked` with the reason.
**The advisory:** `engine.mcp` gains the optional `filter` (the server's
verify-only allowlist flag, default `--exclude-domains`), matched as the
token `<filter>` or `<filter>=…` in the argv-split start line. `launch.py
check` gains the advisory row `engine mcp` after `story plans`, never a
gap: `not configured (no engine.mcp)`, `verify-only filter <flag>; port
<per-run|fixed <n> (one flagged run at a time)>`, or `warning:
engine.mcp.start has no <flag>; the verify-only rule
(kb/engine-mcp-godot.md) rests on the engine skill alone; port …`; an
`engine.mcp` the pin itself refuses reads `warning: <the pin's reason>;
the pin refuses engine-mcp:no-config`; a config the lib's YAML subset
refuses (flow style) reads `warning: .tk-studio/config.yaml unreadable
by the lib's YAML subset (<err>); write engine.mcp in block style`. At
the pin the same warning is the start's `advisory` and the run proceeds:
the advisory never refuses a start.
**Measured on the box only:** whether the godot-ai add-on in the editor
follows a non-default WebSocket port (`{ws_port}`) is not documented, so
two concurrent real flagged runs are measured on the box only (the fakes'
two-run start is this version's bar), as is the sandbox's reach of the
forwarder (`kb/engine-mcp-godot.md`, `## Reachability proof (Story
35.4)`). Every other field, kind and route is unchanged.

**0.1.30 (Story 35.5, additive).** The sandbox and the host agree (holes
78, 84, 85, 90; DW-78, DW-80, DW-81; the retrospective's C1, C6, C7, AI-7).
**`requires.tier`:** `job.schema.json` `definition.fields` gains the
optional `requires: {tier: "sbx" | "host"}` (an object whose only key is
`tier`; anything else is a definition problem). An instance's own
`requires` overrides its type's (the existing overlay rule). `run-epic`,
`run-vertical-slice` and `maintenance-evals` ship `{tier: "sbx"}`, and
35.7's `run-sweep` ships it too. **`placement:TierRequired`:** the
supervisor's `submit` (the CLI `submit` and `run`, and `POST /jobs`)
resolves the placement as before (explicit ?? stored ?? config ?? the host
default) and, when the definition's `requires.tier` differs from it,
refuses before `queue.enqueue`: nothing is queued and nothing is spawned.
The refusal is named `TierRequired` and reads `TierRequired: job <job-id>
requires tier sbx; placement resolved <tier> (<explicit|stored|config|default>)
— set jobs.<project-id>/<job-id> {tier: "sbx", sandbox: "<name>"} in
TK_SUPERVISOR_CONFIG`; `POST /jobs` answers it 400 by name, and its claim
refusal key is `placement:TierRequired`: a run already queued whose
placement resolves another tier (stored or config) is refused the same way
on the drain's claim path — checked on the run's stored definition before
its claim gate spawns anything, and again on the fresh `resolve`'s before
the claim (no worker started) — recorded `claim-refused` under that key
and left `queued` until its placement is fixed. An approve-minted `run-epic-N`
placed on the host fallback is refused the same way, through the approve
pass's existing `queued` step refusal (no new event shape); `requires` is
never loosened for it. **The `godot` shim:** when `GODOT` is an absolute
path to a file, the host leg's engine step makes a shim dir in its own
`tk-sup-hv-` temp dir holding `godot` (`#!/bin/sh` `exec "$GODOT" "$@"`;
on win32 also `godot.cmd`, `@"%GODOT%" %*`), prepended before the `GODOT`
folder under the same PATH key, so a bare `godot` inside a script the step
runs reaches `$GODOT`; an argv[0] of `godot` or `godot.exe` (any case, no
path separator) is spawned as `$GODOT` itself, since a shell-less spawn on
Windows finds only `.exe`/`.com`. The `engine` member gains `godot_shim?`
(the shim dir), absent when `GODOT` is unset, not absolute or not a file,
where the command runs as in 0.1.29. This supersedes 0.1.29 Story 34.1's
"the leg never resolves `godot` itself" only when `GODOT` is an absolute
path to a file. **`maintenance-evals`:** a shipped one-shot sibling of
`maintenance-conformance` (which stays a host core job), `requires: {tier:
"sbx"}`, `target.skill: "tk-studio-evals"`, payload `{cases:
["tk-studio-playable-judge-verdict", "asset-ladder-generated-rung"], runs:
3}`: the eval cases the host cannot run (they need a shell and the
repository tree) run on the sandbox tier; the operator queues it once.
**The `tk-studio-evals` surface** (§2) runs `lib/evals.py run`: one
`claude plugin eval <plugin> --trust-plugin --allow-tools Bash Write
--no-publish --threshold 0 --case <case> --runs <n> --json <out>/<case>.json`
per case, then `<out>/scores.json` `{cases: {<case>: {runs, passed,
score}}, cli: "<claude --version>"}`; the status block's `artifacts` lists
`scores.json` and its `reason` is `<case> <passed>/<runs>; …`, which
`finish` lands in the run's `run.json` and the run's `job-run` ledger line
carries. The live scores are measured on the box only. Every other field,
kind and route is unchanged.

**0.1.30 (Story 35.6, additive).** The closeout carries the proof (DW-77,
DW-92; the retrospective's B15). **The per-leg proof:** on a slice leg
whose contact sheet is made, the leg copies the store's `report.json` and
the sheet's sampled frames into `<store>/legs/<stamp>/report.json` and
`<store>/legs/<stamp>/frames/<name>`, where `<stamp>` is the same
`<ms>-<pid>-<seq>` as its `<store>/sheets/<stamp>.png`. The `playable`
member gains `report?: "<abs path>"` and `leg_frames?: ["<abs path>", …]`
(the sampled set, in sheet order, at most 16). The copy is best-effort,
like the sheet: a failed copy leaves both fields out and never sets a
verdict. `frames` and `sampled` keep their 0.1.29 meaning; the worktree's
media copy and the committed proof's per-run layout are unchanged. **A
story's own leg:** each story key of a slice run takes the latest
`host-verify` event in its window, which runs from just after the previous
different story's `close-out` up to and including its own `close-out`; the
run's last story (by `close-out` order) also takes every `host-verify`
after its `close-out` (the re-runs on the branch tip); a `landedStory` key
with no `close-out` takes the window after the run's last `close-out`; a
window with no `host-verify` reads `not run`. This supersedes 0.1.29 Story
34.8's "every story of a run taking the verdicts of that run's last
`host-verify` event"; the verdict mapping, one entry per story and the
later linked run's override stay. **The closeout input's media:**
`slices[]` gains `report?: "<abs path>"` and `frames?: ["<abs path>", …]`,
from the chosen leg's `playable.report` and `playable.leg_frames`, both
paths under the run workspace; a `report` that is not a non-empty string or
`frames` that is not a list of non-empty strings is
`CloseoutInputInvalid`. `engage.py closeout` reads them like the sheet:
each file is written beside `closeout.md` and attached to the page, the
report as `<key>-report.json` and each frame as `<key>-frame-<name>`
(`<name>` the frame's basename); an unreadable file is a note and is
dropped. Under the story in `## Slice verdicts`, after its sheet image, the
page has a two-column table `| Report | Value |` with rows `verdict`,
`failed` (`<invariant>: <detail>` or `—`), `ticks`
(`<ticks_run>/<ticks>`), `seed`, `mode`, `moments` (`<name>@<tick>` joined
by `, `, or `—`) and `log errors` (the count), then the line `Frames:
[<name>](<key>-frame-<name>), …; [report.json](<key>-report.json)`. A
report that is not a JSON object gives a note and no table. A slice with
neither field renders exactly as in 0.1.29. **The edges:** a declared
`playable` with no `verify.engine` is skipped `no verify.engine`, not
`engine gate not green` (a red host, a red engine and a malformed
`verify.engine` keep `engine gate not green`); `recommend.py` reads a
`.mcp.json` led by a UTF-8 BOM (`utf-8-sig`, as `engine_pin.py` does); the
harness captures a moment at tick ≥ `--ticks` on the last tick and the
report looks its frame up at `min(tick, ticks - 1)`; the engine MCP's
server, its `project.godot` probe and the editor's `--path` and cwd are the
run's served root (`servedRoot(run)`, `<worktree>/<prefix>`, the folder
whose config it read), `{worktree}` in `engine.mcp.start` keeping its
0.1.29 meaning (the worktree top); a `scoping` revise of a game project
with no doc flags merges `game: true` into the record (an OS refusal is
`ScopeUnwritable`). The published page on a live Confluence and the clamp
under Godot are measured on the box only. Every other field, kind and route
is unchanged.

**0.1.30 (Story 35.7, additive).** The `run-sweep` job type: a deferred-work
sweep through the supervisor (DW-46 to DW-65, DW-85 to DW-87; the planning
finding that no job started a sweep, `[sweep] auto = "never"`). **The
launch verb:** `tk-studio-launch` gains `sweep` (`launch.py sweep
[--run-id <rid>] [--max-bundles <n>] [--triage-wait <s>]`). It refuses,
`blocked` and spawning nothing, a project with no `.bmad-loop/policy.toml`
or no `_bmad-output/implementation-artifacts/deferred-work.md`, a live
engine owning the checkout (one engine per checkout, as `start`: `a run
already owns this checkout: <run id> (<status>), …`), a dirty tree (`git
status --porcelain`, the paths named) and an existing run dir;
otherwise it starts `bmad-loop sweep --project <root> --no-prompt --run-id
<rid> [--max-bundles <n>]` detached, polls for its `state.json` as `start`
does, then waits `--triage-wait` (counted from the call's start) for
`<run dir>/triage.json`: the skill waits 540 s; the core's default stays 1500 s (inside the job's 3600 s
guard) — the skill's call, run under the Bash tool's 600 s cap, must print
its block inside it, and a longer triage ends `complete` / `triage still
running` for the supervisor's watch to record. The block keeps `intent:
tk-studio-launch` and `artifacts: [".bmad-loop/runs/<rid>"]` (plus
`.bmad-loop/runs/<rid>/triage.json` when read), so the supervisor hands
the run to the engine as for `start`; the result carries `triage:
{bundles: [{name, dw_ids}], blocked: [{id, blocker}], decisions: [{id,
question}], already_resolved: [id], skip: [id]}` and the `reason` is one
line, `bundles: <name> (DW-a, DW-b); …; blocked: DW-x, …; decisions: DW-y,
…`, `none` for an empty list. It is `complete` on a read triage or when
the wait elapses with the engine live (`reason: "triage still running"`),
`blocked` when the engine ended or paused before any `triage.json` (the
triage escalated after `max_triage_attempts` — or, when the engine's
`journal.jsonl` holds `sweep-nothing-open`, an empty ledger: the reason
is `sweep: nothing open in the ledger`, never an escalation) or leaving
one that does not parse (`sweep triage unreadable`). `max_bundles` and the
attempt caps are the policy's; `[sweep] auto` stays `never` (an explicit
start ignores it). **The `sweep-triage` event, two records:** the
taxonomy gains `sweep-triage {run_id, bundles, dw_ids[], blocked[],
decisions[], already_resolved[], skip[]}`, emitted through `ledger.emit`
by `launch.py sweep` alone, once per triage read; the supervisor's watch
notes a queue event of the same name once per engine run, the first time
`<served root>/.bmad-loop/runs/<engine id>/triage.json` exists (the served
root is the worktree, below the run's prefix when it has one), after copying
it atomically to `<studioHome>/projects/<key>/runs/<studio_run_id>/sweep/
triage.json` (`{engine_run_id, path, bundles, blocked, decisions,
already_resolved, skip}`; an unparseable file once as `{engine_run_id,
error}`). bmad-loop's own journal `sweep-triage` key is a different store
and is never recorded. **One PR per sweep:** bmad-loop commits each bundle
in place on the run's `supervisor/run-<id>` (`scm.isolation = "none"`),
and one supervisor run is one branch and one PR, so each bundle is one
engine dev pass in the run's worktree, the host leg runs once at the
engine's end over all of them, and the close-out opens one PR whose body
gains a `## Sweep` section before `## Host verify`: one line per bundle,
`- <name> (DW-a, DW-b): landed | not landed — <why>` (landed when the
engine journal holds its bundle ledger-close kind for `dw-<name>`, else
from `tasks/dw-<name>/result.json`; under `[sweep] repeat = true` the
summary also reads each later cycle's `triage-<N>.json`, N = 2, 3, … to
the first missing, its bundles keyed `dw<N>-<name>` and named `(cycle
<N>)`, and blocked, decisions, already-resolved and skip are the union by
id, the latest cycle's entry winning; the `sweep-triage` records stay the
first triage's), `### Blocked` (`- DW-x: <blocker>`
or `none`) and `### Human decisions` (`- DW-y: <question>` or `none`,
skipped unattended; `bmad-loop decisions` answers them). The inbox line
adds `sweep: <landed>/<n> bundles; blocked: DW-x, …; decisions: DW-y, …`
(omitted when the notice's reason line, as composed, already carries it
verbatim).
**The end:** `complete` when every triaged bundle landed (or there were
none) and the host leg is green or skipped; `partial` when some landed and
some did not, or the leg is red or inconclusive; `blocked` with no
`triage.json` ever (the reason `sweep: nothing open in the ledger` when
the engine journaled `sweep-nothing-open`, else `sweep: no triage.json
(the triage escalated)`), or bundles and none landed. A paused sweep is closed
out the same way (its paused bundle `not landed — paused at <stage>`, its
engine stopped), never relaunched through the paused-run pass. The
`job-run` line is the existing `finish`, with `--total-cost-usd` from the
sweep's `run.json` and the end's reason. **The ledger flip:** `plansync.py
ledger-resolve --directory <owner root> --pr <owner/repo#N> --ids
DW-a,DW-b [--date <YYYY-MM-DD>]` rewrites each named entry's `status:`
line from the engine's `done <date>` to `resolved <date> by
<owner/repo>#N (sweep bundle dw-<name>; <the engine's resolution,
clipped>)`, atomically; an entry already closed is `unchanged`, a
still-`open` one `pending`, and it ends in the status block `{ok,
resolved[], pending[], unchanged[]}`. The supervisor's merge pass runs a
ledger pass after the stage pass: for each terminal `run-sweep` run whose
PR is `MERGED`, under a `plan-lease {phase: "ledger"}`, it calls the verb
with the landed bundles' `dw_ids` and the triage's `already_resolved`,
one `ledger-resolve {pr, ids, resolved, pending, ok, settled?, error?,
skipped?, reason?}` event per attempt (`settled` once the pass will not
call again; `error` on a refused or failed call; `skipped` with a `reason`
when the PR closed unmerged or the retries gave up; `reason` alone when
there was nothing to flip), `pending` retried on the next tick and bounded by
`PLAN_RETRY_LIMIT`. The supervisor commits nothing: the rewrite lands at
the owner root as the Stage Log rows do. The real sweep over the open
ledger is the operator's, queued once on the sandbox tier. Every other
field, kind and route is unchanged.

**0.1.31 (Story 36.1, additive).** The one-verdict rule. The host leg's
verdict is derived once, by the supervisor's `legVerdict`, and every
consumer reads that word: the board's `host_verify`, the plan status's
`host-leg` and `re-run` rows and their `outcome` (so the Stage Log), the
PR body's `Legs:` line, and the close-out record's `host_verify`; the
sweep's end state and the rollup follow from it. `inconclusive` (0.1.30,
Story 35.3: the judge's infrastructure failed, the run `partial` without a
rubric fail) is a fourth value beside `green | red | skipped`, never a
green and never a red. **The board:** `GET /board`'s `host_verify` may read
`inconclusive` (additive), and such a run files under `needs_you` by the
rule red already follows: the latest `host-verify` after the run's latest
`launched`, on a live run or a run ended on the host's local day; an older
ended run never needs you. The reason stays in the event; the board carries no
reason field. **The Stage Log and its mirror:** the row's `outcome` cell
reads `inconclusive`; the Jira stage comments and worklog carry no outcome
(0.1.30, Story 35.8's shape), so the mirror reads it through the row it
mirrors, and `plansync.py`'s mirror code is unchanged. **The rollup:**
`report.py rollup` counts rows, never a verdict, so an inconclusive leg
counts as neither green nor red: it lands in `by_stage` and, a re-run, in
`reruns`. **The sweep:** an inconclusive leg ends a sweep `partial`, its
reason starting `host verify inconclusive (playable)`. **The proof folder:**
the `frames/` directory of `.tk-studio/proof/<run_id>/frames/<name>` is one
literal per language (`FRAMES_DIR` in the supervisor, `FRAMES` in
`playable.py`), and `playable.py sheet`'s `frames` stay bare file names,
pinned by tests on both sides. Every other field, kind and route is
unchanged.

**0.1.31 (Story 36.2, additive).** A sweep's records are whole. **The priced
cost:** `meter.py price-run --run-dir <dir> [--routing <routing.current.json>]
--json` answers `{ok, bundles: [{key, usd, source?, bound?, ttl?}], usd_total,
prices_date}` and is the one reader of `prices.json` for an engine run, so
there is one pricing table: `report.py` gains no pricing code, its `cost_usd`
cells came from the same table. Per bundle it takes
`transcripts/<key>/metered.json` `usd_total` (`source: "metered"`), else prices
`state.json` `tasks[key].sessions[].usage` (`source: "sessions"`, `bound:
"upper"`, `ttl: "unknown"`, cache writes at the 5m rate); the model is the one
the session carries, and only when that is empty the routing's model for its
role; a model the table lacks is a named refusal. A bundle with neither reads
`usd: null`, and `usd_total` is null when nothing was priced. The journal's
scalar `tokens` are never priced (Story 24.1). `## Metered cost` reads
`$<worker> (worker turns) + $<engine> (engine) = $<total>`, then one `-
<bundle>: $<usd> (<source>)` line per bundle (`- <bundle>: not metered`). The
`job-run` line's `total_cost_usd` is that sum, plus a first leg's judge cost as
on any run's line, and the sweep's `ended` carries `engine_cost_usd`. Its `sweep` record gains `engine_cost_usd?`,
`engine_cost_error?`, `blocked`, `decisions` and `skip` (every cycle's, merged,
when a triage was recorded) and, per bundle, `cost_usd?` (a number or null) and
`source?`. `engine_cost_usd` and `(engine)` total the bundles only, so the
engine's own `sweep-triage` session is not priced. For a sweep, `(worker turns)`
is the `launched` event's `worker_cost_usd` alone, never the engine's `run.json`
figure, at the close-out and on a re-run alike. A late close-out (a terminal
run, whose `finish` already ran on the worker's cost) emits the priced engine as
its own `job-run` line `{job_id: <same>, run_id: "<run_id>:engine", state:
"complete", total_cost_usd: <engine>}` (always `complete`: the line reports a
cost, not a run transition) and its `closed_out` carries `engine_cost_usd` and
`engine_job_run` (the line's run id, or `error: <why>` or `skipped: <why>` when
no line landed). A cancel that closes a sweep out at once, its engine stop
confirmed dead, prices it the same way: its `ended` keeps state `cancelled`,
carries `sweep`, `engine_cost_usd` and `engine_job_run`, and the line is emitted
whether the worktree was removed or kept, because no late close-out follows. A
sweep close-out that loses the race to a cancel, its `finish` refused, emits the
same line and its raced `closed_out` carries `engine_cost_usd` and
`engine_job_run`; with `finish` succeeded the run's own line holds the sum, so no
`:engine` line is emitted and the note carries `engine_cost_usd` alone. On a late-closed sweep, `runCost` and the `jobRunCosts` readers
keyed by the bare run id return the worker-only own line, so the API and delivery
`cost_usd` read less than the PR body (DW-139). A `price-run` that fails never blocks the close-out: the worker's
cost stands, and the body says `engine not priced: <why>`. **The event:** the
supervisor emits the ledger's `sweep-triage` from the host (`ledger.py emit`)
once per engine run after its first successful copy of `triage.json`, so the
event reaches the host's ledger. The payload is the lib's `{run_id, bundles:
<count>, dw_ids, blocked, decisions, already_resolved, skip}`, a projection of
the queue's richer note, which gains `ledger: "emitted" | "error: <clipped>"`;
`launch.py sweep` still emits in its own process. **A re-run's judge:** a host
re-run whose leg carries `playable.judge.cost_usd` emits its own `job-run` line
`{job_id: <same>, run_id: "<run_id>:verify-<n>", state: "complete",
total_cost_usd: <judge>}`, `n` counting the run's re-run legs, and records it:
`rerun.job_run` holds the line's run id, or `error: <why>` or `skipped: <why>`
when no line landed. The run's own line is unchanged: readers key by `run_id`, so
neither is dropped nor counted twice. **A resumed run:** the fresh `launched`
carries `worker_cost_usd` forward, so its body reads the number. **The ledger
pass:** a `ledger-resolve` answering `pending` is a wait, as the stage pass's:
one `ledger-resolve {…, waiting: true}` while it lasts, the lease released
settled so it is uncounted, and no give-up; only errors count to
`PLAN_RETRY_LIMIT`. The record's `fingerprint` is the owner checkout's
`deferred-work.md` size and mtime: while the last record is waiting and it is unchanged, the pass skips
the run before `gh` and before the lease, so the wait is lease-free after its
first pass; a change runs the pass again, and a wait that goes on moves the one
record's `fingerprint`. This replaces the 0.1.30 note's bounded `pending` retry.
**The flip:** the engine's `resolved by sweep bundle <key>` clause is removed
wherever it stands in a resolution, so the status line names the bundle once: `resolved <date>
by <owner/repo>#N (sweep bundle dw-<name>)`, any other text following the name inside the
parentheses as `; <text>`; only the engine's exact `resolved by sweep bundle <key>`
clause is removed, so a resolution's own other wording stays even if it names the
bundle. **The end rule's order:**
`sweepEndState` applies its `blocked` rules first (no triage, or bundles and
none landed), so a `blocked` end stands over an inconclusive or red leg; then
the host leg's red or inconclusive reason; then the engine's own end: an engine
that ended other than `finished` caps the sweep at `partial`, reason `engine
ended '<status>' after <n>/<m> bundles`, even with every bundle landed. The
supervisor's own stop of a paused sweep is not penalised, on the tick of the stop
or a later one: `engine-stop {engine_run_id, stopped: true | error}` is noted once
per engine run, on a stop that succeeded too, and a `stopped` status with that
note is not capped. A late close-out's `sweep_end` follows the same rule, read
from the engine's terminal status; with no worktree or no terminal status there
is no cap. **The re-run's body:** `## Sweep` and the priced cost are rebuilt from
the run's `ended` (else raced `closed_out`) `sweep` record, its `blocked`,
`decisions` and `skip` first and the `sweep-triage` note for an older record,
never from the removed worktree. Every other field, kind and route is unchanged.

**0.1.31 (Story 36.3, additive).** A paused or resumed run is never parked.
**The re-arm's tier:** a resume's re-arm of a graceful stop runs on the run's
tier as the paused sweep's stop does (`sbx exec <sandbox> uv run …/launch.py stop
--directory <served root> --run-id <id> --graceful`, else the host), and
`graceful-stop` gains `tier`. A refusal (a dead engine's `GracefulStopError`) is
recorded `ok: false` and the resume proceeds, never a retry loop. **The block a
resume resolved:** `track.py unblock --story <key> --reason <text> [--source
run]` moves `Blocked - Awaiting User` to `Block Resolved` with a `Resolved:
<reason>` agent comment and no account mention, moves the dependents `block`
moved (a dependent also blocked by another story moves on the last of them, the
other's issue no longer Blocked), answers `skipped[]` for an issue not blocked, and
`retry: true` on a temporary failure; a dependent refused by name answers `status:
"partial"`, recorded `ok: false` and retried. The resolution pass queues no
`validate-resolution` for an item a `track-unblock` on the project's runs moved (an
`issues[]` entry with its `key` and `to: "Block Resolved"`, its `at` later than the
item's `blocked_since`). Every resume path records one queue event `track-unblock
{story_key, engine_run_id, ok, status, issues: [{key, from, to}], reason, retry?:
true}` per `track-block` since the latest `paused` (a `paused` a failed spawn wrote
keeps the window open, and an `ok: false` block answered by name owes none unless
an `issues[]` entry reads `transitioned: true`: the move landed), once the engine is
spawned.
A failure is recorded `ok: false, retry: true`, notified once and retried by the
run's next resume; it never fails the resume. `unblock --engagement <id> --kind
cap|ask --reason <text>` moves to `Block Resolved`, never `Done`, once per `cap`
or `ask` `blocked` event after the owner's `go` or `continue`, recorded as
`engagement-issue {action: "unblocked", kind}`; the owed questions block closes
after it. **An AD-5 conflict:** a `plan-status` record whose re-sync holds
`sync.projection.conflicts` carries `status: "partial"` and `conflict: [{id,
canonical, backend, fields}]` for the entity it moved (`id` the entity, `canonical`
its local file path, `backend` its issue key, `fields` a line per field naming both
sides; a conflict on another entity neither marks the record nor notifies), with
one notifier line per distinct conflict naming the issue and `fields`, never the
path; a
`done` record keeps `ok: true` and `stage: true`, so its Stage Log rows stay
owed, and is re-asked on later ticks, counted against `PLAN_RETRY_LIMIT`, until
the pull-back answers without one or the give-up record (`gave_up: true`) ends it;
a transient answer to a re-ask keeps the conflict open. The loop never resolves it. **A failed first
render:** a reason naming a `.staging-*` folder and its generation, the generation
empty or absent, counts as the one snapshot of the hole-65 auto-resume: the
leftovers are removed and it resumes once (`attempt: 1`), a second failure
recording `attempt: 2`. `render_skill.py`'s staging rename retries on
`EACCES`/`EPERM`. **The bounded stop:** a paused sweep's stop is retried for
`SWEEP_STOP_DEADLINE_MS` (30 min) from the first `engine-stop` note carrying
`error` (a `{stopped: true}` note starts no clock), then one notifier line and an
explicit `blocked` end that releases the lock and the pin; the worktree is kept,
as the unanswered engine may still run there. **The WIP:** after any
paused-sweep stop the tree is committed as `wip: sweep bundle <key> paused (run
<id>)` on `supervisor/run-<id>`; with WIP the host leg is skipped (`host-verify
{skipped: true, reason: "paused sweep: WIP committed, leg skipped"}`), the PR stays
a draft, the landed bundles flip and the WIP bundle's stay open, and a sweep whose
bundles all landed ends `partial` naming the WIP. A clean tree proceeds as before.
**B3/B4 decided, the boundary ends the run:** a story landed under a graceful stop
commits, meters, runs the host leg (a recorded `host-verify` reused, none for an
engine the supervisor killed), archives and closes out (push, PR, the lock and the
pin released), `story-boundary` gaining `ended: true`. The end follows the leg: green
or skipped, the PR ready and `endEngine("complete", "story boundary: <key> landed
under a graceful stop")`; red, inconclusive or no leg, the PR a draft and `partial`,
that reason plus the leg's. A failed archive ends it `partial` naming it, and an end
that keeps throwing is bounded by `STUDIO_END_RETRY_LIMIT`, then one notifier line
and a recorded `partial` end; never a park. A commit or meter failure under the
stop counts toward the same limit: the commit give-up ends `partial` with no
close-out and the tree kept, and the meter give-up runs the leg, pushes and opens
the PR but skips the archive and the engine cost, ending `partial` naming the meter
with the run dir and the worktree kept for a harvest by hand. This supersedes 0.1.30's "stays `paused`
… `POST /runs/{id}/cancel`" rule. A resume on the ended run answers 409
`StoryLanded` naming the end; a paused run whose story landed with no stop in
force is still refused `StoryLanded` until the paused-run pass closes it out.
**A killed engine:** a close-out that skipped the host verify because the
supervisor killed the engine leaves the PR a draft (returned to one when adopted
ready), and a killed relaunch keeps
`launched.end` with the guard's reason. Every other field, kind and route is
unchanged.

**0.1.31 (Story 36.4, additive).** A host leg's red means the code. **The encoding
rule:** every text-mode `write_text`, `read_text`, `open` and `Path.open` under
`plugins/tk-studio/lib` (its tests included), `tools/installer` and `apps/*/scripts`
names its encoding by the `encoding=` keyword, a positional encoding not counting.
Binary modes, `**kwargs` calls and non-Path openers are exempt, though a
compressed-file opener (`gzip`, `bz2`, `lzma`) in text mode is not; the conformance
drive `e2e_text_encoding.py` (under `tk-studio-activate`) fails naming
`<file>:<line> <call>`. An absent `tools/installer` or `apps/*/scripts` is a
`not_run` step, `ok`; an absent `lib` is red.
**The drive-budget rule:** a conformance drive that runs a bun suite derives its
bound from its manifest `timeout` through the shared `_budget.py`
(`suite_bound(script, *, install_s, other_s, headroom_s)`: `timeout - install - other - headroom`,
`HEADROOM_S` 15, falling back to the runner's default), and keeps no copy of the
timeout. Every other field, kind and route is unchanged.

**0.1.31 (Story 36.5, additive).** The supervisor's own faults are recorded as its
own. **`own_block`:** a run's `ended`/`orphaned` event detail, and through `jobrun.py
finish --own-block <kind>` its `run.json` (`job.schema.json`; `status` answers it),
may carry `own_block`, one of `placement`, `lock`, `pin`, `auth`, `worktree`,
`engine-mcp` or `render` (no code path sets `lock` or `render` today; both are
declared and honoured: a lock refusal leaves the run `queued`, and no supervisor
rename-race end exists): the block is the supervisor's own, set where it was built,
never by matching the reason. An end carrying it, on a run with no `launched` event
and no recorded or named engine and no worker recorded, releases the checkout lock with no launch probe, so
no unverified engine holder stays for later claims to re-probe; a run with an engine
keeps today's path. The supervisor's two stop evaluators and `jobrun.py evaluate_stop`
skip such a run, so `stop.on_status` fires only for the engine's own `blocked`.
**`POST /runs/{id}/cancel`** on a terminal run whose `kind='engine'` lock row names it
with no engine id, and with no engine on the run's record, releases the row
(`lock-released {holder: {id: null}, own_block}`) and answers 200,
`effects.lock_released`; any other terminal run keeps the 409 `RunTerminal`.
**The refusal:** a sandbox-tier job whose target skill is absent from the shared
skills store (`sbx skills ls`, one name per line, first whitespace-separated token;
a listing that lacks the skill also defers to the host store folder; that verb missing,
the host store folder, and the refusal says so) is refused at
`submit`, nothing queued: `skills-store:SkillMissing: <skill> is not in the sbx skills
store (<store path>; plugin <version | unknown>); import the release: tk-studio
update, then sbx skills import --force`, `POST /jobs` 400 by that name. On the
drain's claim path, after `placement:TierRequired`, the same answer is the claim refusal
`skill-missing:<skill>` and the run stays `queued`. With neither source readable
nothing is refused. **A malformed block:** a balanced object with a §3 `status`
(`complete`, `partial`, `blocked`) and no string `intent` is `conformance failure
(AD-11): status block malformed: missing intent`, ended `partial` with no resume; a run with no such object (any other
`status` included) keeps `MISSING_STATUS_BLOCK` and its resume. **The lifted
status:** a core's own `status` (`complete`, `partial`, `blocked`) lifts into the run `state`, `reason` from the block;
`ok: false` with no `status` is `blocked`, reason `core answered ok: false without a
status`; `ok: true` with no `status` stays `complete`. **Guard (d)** of the 0.1.28 pin
restart is per sandbox: any run's `pin-restart` on it whose `probe_after` is not `null`,
later than the sandbox's last healed signal (a `pin-restart` with `probe_after: null`,
or a `pinned` with `probe_clean: true`), forbids the restart, and
`claim-refusal-cleared` no longer reopens it. While such a restart stands open on the
sandbox, a pin that found it not running also probes the login, restarts nothing, and a
clean answer records `probe_clean: true` on `pinned`; with none open a cold pin adds no
probe. **The prune:** after a successful pin,
`sbx exec <sandbox> find /tmp -maxdepth 1 ( -name tk-sup-* -o -name tmp.* ) -mmin +1440
-exec rm -rf -- {} +`, no shell, recorded on `pinned` as `tmp_pruned: true |
"skipped: <why>" | "error: <clipped>"`; a failed prune never fails the pin. **The hold**
is detached and recorded, so any later process adopts it by pid and start time and a
run's `hold` events count its restarts. **`pacer`** gains `running? {tag, started_at,
elapsed_ms, ids}`, written with the slow-pass warning and its one notifier line while
the pass runs, removed at its end. Every other field, kind and route is unchanged.

**0.1.31 (Story 36.6, additive).** Setup and the launch check decide by evidence, and a
story being built reads In Progress. **The setup's workflow update (hole 92, DW-127):**
every transition `POST /workflows/update` carries, copied or new, is v3-shaped: `id` (a
copied one keeps its own; a new one takes a numeric string above the copied maximum), the
uppercase `type`, `toStatusReference` and `links: [{fromStatusReference}]` (empty for a
GLOBAL), with no legacy `from`/`to`; the version comes from the v3 `GET /workflows/search`
and any status in the To Do category fills the `To Do` slot; a rerun reads either shape,
reports found and writes nothing. A copied transition's legacy `screen` and `rules` are not mapped
by this code and are not carried (whether the v3 schema has a place for them is for the operator's
live call to decide): on a successful update, `update_workflow`'s second value names
each copied transition the read showed with one holding a non-empty value at some depth (empty containers name nothing), and `setup` reports them in `notes`
(`workflow update dropped screen/rules from copied transitions: <names>`); none, no note. The site's answer on `statusReference` is the operator's
attended call, recorded through the consult log; a refusal stays the notes and the owner
steps. **The `verify commands` row (DW-62, extends 33.5 and 34.4):** with commands to add
and a `.bmad-loop/policy.toml` git tracks or does not ignore (`pipeline.policy_dirties_tree`:
`unignored_writes`, or `git ls-files --error-unmatch`), nothing is written, `verify_commands.policy`
is `refused`, the row is a gap naming the file and `check` ends `blocked`; with nothing to add it
reads `unchanged`. **The `engine gate` clause (DW-71):** the provisioning's `WITH_GODOT` block
writes `$HOME/.tk-studio/provisioned` in the sandbox (`WITH_GODOT=<version>`, the date). A
clause over a non-empty `engine.verify_commands` reads it with one `sbx exec` per running engine
sandbox: `sandbox <sb>: provisioned WITH_GODOT <ver>`; no marker but a `godot` executable (an
older sandbox) is not warned; neither reads `warning: sandbox <sb> has no WITH_GODOT record; an
engine.verify_commands gate there refuses`. Not running, sbx absent, daemon down or a refused
exec say nothing of Godot; the clause never changes `ok` and never pins or starts a sandbox.
**The game-project rule (DW-90, CAP-15):** a game project is one whose tracked `working_set`
holds `gds` or a `gds-` entry and whose `_bmad/_config/manifest.yaml` lists the `gds` module
installed; the plugin-shipped `gds-engine-godot-4` alone is not enough, and an absent or
unreadable config or manifest is not a game project. **The `in-progress` phase (hole 104,
DW-146):** a `run-epic` run's story gets `plansync.py status --directory <owner root> --id
ST-NNN --status in-progress` once, recorded as a `plan-status` event `{phase: "in-progress",
story_key, id, owner, directory, ok, previous_status?}`, supervisor-side: on the launched path,
on a resume, and from a pass beside the review pass over running launched `run-epic` runs, one
call per new journal `story-start`. The once-only check is the recorded event per `story_key`. A
refusal or a blocked re-sync is one `ok: false` event; an issue a resume finds in `Block Resolved`
is `status: "partial"` with `conflict`, one event, not re-asked; a transient failure records
nothing and is asked again, bounded by `PLAN_RETRY_LIMIT`, then one give-up event; none stops the
launch. `review` at PR open and `done` at the merge follow as before, the phase owes no Stage Log
row, and a block's `Blocked - Awaiting User` wins while it stands. **The rhythm (hole 105,
DW-147):** a job's optional `stop.after_stories` (an integer > 0; a rhythm alone is no stop
condition, so it does not satisfy AD-10's "at least one"; the shipped `run-epic` carries 1, and an
instance's own `stop` replaces the shipped one whole, so an engagement's instance minted from this
story on, which carries `stop` without the field, declares no rhythm, because its autonomy sets it;
a `run-epic-N` file minted before it has no `stop`, is kept on resume and inherits `after_stories: 1`) arms the
engine's graceful stop on the run's tier through `stopEngine`, recorded as one `stop-armed {figure,
engine_run_id, ok, detail, tier}`, a refusal `ok: false` and never retried; a refusal also sends
one notifier line naming the run, the engine id and the re-issue command on the run's tier
(`uv run <studio>/plugins/tk-studio/lib/launch.py stop --directory <root> --run-id <id> --graceful`, on
sbx through `sbx exec <sandbox>` with the VM paths), its outcome the event's additive `notify`.
bmad-loop honours a graceful stop just before it journals `story-start`, so a stop sent earlier ends
the run with no story built, and the arming waits for that entry. Figure 1 arms on the launched path
right after the hold only if this engine's journal shows a `story-start` and the latest `engine-pid`
event does not record an unknown pid (no such event, a non-sbx run, passes); otherwise the pass arms
an engine with no `stop-armed` and no resume of its own on the first tick that shows one, with no
grace wait. A readable journal with no `story-start`, or a missing file, never arms, however long
since the launch; only a journal read that returns `problem` arms blind, five minutes after
`launched`. Figure 1 also arms on a resume with no stop
in force once `engine.pid` is rewritten, the engine's check coming after it finishes the in-flight
story (unrewritten: no arming, one notifier line, for any figure;
a stop in force stays the `graceful-stop` re-arm); a figure N > 1 from the pass, once N-1 of the
queue run's stories have finished (the current journal's `story-done`, and the earlier engines'
from each `close-out` event's `story_key` and additive `stories_done`) and this engine's journal
shows a `story-start` with no `story-done`, `story-deferred` or `story-skipped` after it (a
`story-escalated` leaves its key open), a late tick able to
overshoot. `stop-armed` is once per engine id on a launch, and since the latest `engine-resume` in
figure N > 1's pass and on a resume, so one boundary is not armed twice across a relaunch (an earlier
engine's `ok: false` `stop-armed` or `graceful-stop` does not count: that engine armed nothing) and a stop consumed
before a pause is re-armed. No field: no arming and no event, and `tk-studio-launch check`'s advisory `run rhythm` row says the run goes
to the epic's end, and that an engagement's autonomy can still stop it at a story boundary. A `run-epic` job's type or id selects both duties; a sweep or any other job gets
neither. **The serve process:** `mirror`, `afterCloseOuts` and `resumePaused` run in serve, so the
operator stops the supervisor before `apps/supervisor` is built and restarts it through the
scheduled task after the merge. Every other field, kind and route is unchanged.

**0.1.32 (Story 37.1, additive).** One id source for the deferred-work ledger. The optional counter key
`next.deferred-work` (an int >= 1) sits beside `epic`, `story` and `task` in `.tk-studio/plan-counter.yaml`.
`plansync.py deferred mint --directory <root> [--count N] [--dry-run]` answers `{ok, ids: ["DW-N", …], next,
dry_run, written, status, intent, artifacts, reason}`: it bumps the counter in one atomic write and keeps the marker line
in the ledger's header in a second, naming both files in `written[]` (empty under `--dry-run`). An absent key is seeded
first, the migration, as one past the highest `DW-N` anywhere in the ledger text, the engine's `next_seq` rule; a
counter behind the ledger skips the ids the ledger holds. A bad counter, a bad `--count`, no ledger or a duplicate
heading ends `blocked`, exit 2, nothing written. The marker line reads `<!-- deferred-work counter: last minted DW-<N>;
mint through plansync.py deferred mint -->`: no studio parser reads it as an entry, and the engine's `next_seq` mints
above it, so the harvest on a run branch reserves its block above the counter's last id at the run's base. The
studio-pipeline `pre_commit` hook (`reconcile_gate.py`) sets `next.deferred-work` to the greater of the counter and the
ledger's highest + 1, and the marker to one below that value, after a harvest (the journal's `spec-deferrals-harvested`,
or a heading at or above the counter), so the bump lands in the story commit; it never lowers the counter, never
renumbers a harvested id and never vetoes. **The refusal:** a duplicate `### DW-N:`
heading is refused as `LedgerDuplicateId: DW-N at lines a and b` (`lib/dwledger.py`) by `plansync.py ledger-resolve`
(`blocked`, exit 2, no `retryable`), by `deferred mint`, by the `launch.py sweep` preflight before any engine spawns (the
stock `bmad-loop-sweep` skill is untouched, AD-4), by the engine's gate through a second tracked command in
`pipeline/verify-commands.toml` (`tests.test_dwledger`), and by the `tk-studio-plan-sync` conformance drive over
`fixtures/ledger-duplicate`. The same test reads the real ledger on the host leg, but `tools/verify_host.py` runs on the
run branch without merging `main` in and each branch alone holds one copy of the id, so the colliding PR's own leg stays
green; the duplicate first goes red on the next host leg or engine gate over a tree holding both copies (or at a sweep
preflight or a mint), and the later id is renumbered on the tree that holds both. `measurepush.py` and `runner.py` parse
no ledger, so the drive and the gate command answer for them. **The hand
rule narrows:** a hand mint on `main` while a run is live can still collide with the run's harvest, as a branch cannot
see `main`'s live counter, so no hand-filed entry while a run is live without a renumber at the merge; the refusal is the
catch. The hook's rewrite of `next.deferred-work` and the marker line on a run branch can meet a planning PR or hand mint
landing on `main` as a textual merge conflict on those lines even when no id collided: keep each counter key's higher
value and the marker line naming the higher id; the conflict is not a collision unless a heading is doubled. An entry
closed from inside a run, where no PR number exists yet, reads `by Story N.M`, never `by this story's
PR`, which `test_no_placeholder_pr_number_remains` fails. Every other field, kind and route is unchanged.

**0.1.32 (Story 37.2, additive).** The Windows classes out of the host leg (holes 108, 110). **The
Windows-semantics rule:** the conformance drive `e2e_windows_semantics.py` (under `tk-studio-activate`; a new
drive, the 0.1.31 encoding drive and its steps unchanged) scans `plugins/tk-studio/lib`, `apps/supervisor/src`,
`apps/supervisor/test`, `_bmad/scripts` and `tools` (`*.py` by AST, `*.ts` by line), one step per scope, an absent
scope a `not_run` step, `ok`, and fails naming `<file>:<line>` and the class's rule for (a) a `path.join`/`resolve`
whose result reaches `toVmPath` or an `sbx` argv (the POSIX tail after `toVmPath(studioRoot(env))` is the rule),
(b) an `endswith`/`toEndWith`/`toContain`/`toBe` assertion on a joined path against a POSIX value (a subject
normalised by `.replace("\\", "/")`, `.as_posix()` or `toVmPath` exempt), (c) an `os.rename`/`Path.rename`/
`renameSync` onto a path that may exist with no empty-folder clear (WinError 183; a clear of the same name in the
function, a pid or random part, or a TypeScript `renameSync` from a tmp file (never a dir or folder source) exempt;
a Python `os.rename`/`Path.rename` from a tmp path is not), and (d) a `subprocess.run`/`Popen`/`check_output`/
`check_call`/`call` with `text=True` or `universal_newlines` and no `encoding=` (the host decodes cp1252; `**kwargs`
exempt). The remainder is exempted inline by a `win-ok: <reason>` comment on the line. **The host figure:**
`_budget.HOST_TEST_TIMEOUT_MS = 30_000` (the preload's `setDefaultTimeout`, which on bun 1.4.3 reaches only a
multi-file run's first file, DW-155) and `bun_test_args()`; every conformance drive's `bun test` passes `--timeout`
from it, `tools/verify_host.py` passes its own `SUPERVISOR_TEST_TIMEOUT_MS` (pinned equal by its test) on every
per-file command, a drive's `git` subprocess carries `timeout=` and its bound is spent before the suite's (B7), and
the drive's `bounds` step fails a `bun test` argv with no `--timeout`, a drive `git` call with no `timeout=`, a bun
drive whose derived suite bound (its `BOUND_S = suite_bound(…)`: the manifest `timeout` less `install_s`, `other_s`
and `headroom_s`) is under the figure plus `HEADROOM_S`, and a bun drive with no manifest entry, no
`BOUND_S = suite_bound(…)` or `suite_bound` arguments that are no module constants. No engine gate runs bun (the tracked `[verify]`
commands are lib tests), so the rule applies to `verify_host.py` and the drives. **`verdicts`:** on a red host
command the `host-verify` event (`HostVerifyRan`) carries `verdicts?: string[]`, every suite's own verdict line from
the command's whole stdout (`^== (lib suite|conformance|supervisor|studio-web): `, the `(cwd …)` headers and the
`== <suite> failed (rc=N); last …` tail headers excluded, the scan stopping at the first tail header (the tails
repeat child output); a gate's reason line (`<app> changed since <sha>`, `…; running anyway`) never; the gate-level
`ok`/`FAILED`/`skipped` lines and the supervisor gate's own refusals (the temp folder not created, inside a git
checkout or not removed, no test files) always, a per-file `supervisor` line only with a fail, an `rc=` or a timeout) beside the 20-line tails; absent on a green leg
or a command printing none, so a green leg's shapes are unchanged. The PR body's `## Host verify` red block lists
them under `Verdicts:`, and the re-run verb's answer carries `verdicts` and `red` (the suites whose verdict line is
not `ok` or `skipped`, e.g. `["lib suite", "supervisor"]`) on a red leg only; the route's `202` is unchanged.
**The serve process:** `hostverify.ts` and `cli.ts` run in serve, so the operator stops the supervisor before
`apps/supervisor` is built and restarts it through the scheduled task after the merge. Every other field, kind and
route is unchanged.

**0.1.32 (Story 37.3, additive).** A timed-out session keeps its stop and its records (holes 105, 106; DW-148,
DW-157, DW-161; the Epic 36 retrospective's C3 and C6). **The run worktree's rollback:** `materialise`
(`worktree.ts`) sets `[scm] rollback_on_failure = true` in the run worktree's copy of `.bmad-loop/policy.toml` right
after the copy (the key's value replaced inside `[scm]`, the key added under the header when missing, or the table
appended when absent, the rest of the file unchanged; a tmp file renamed onto the copy, verified with `Bun.TOML.parse`; a copy
that does not parse restored and the materialise refused `worktree policy`); a policy already in the worktree but not
copied is edited the same way, and a worktree with none (the checkout has none) gets one holding only `[scm]
rollback_on_failure = true` (removed again on a refused verification; `copied` never lists it); it is the only writer, so a main checkout keeps
`false`, and a worktree materialised earlier is never upgraded. What is reverted and removed is the engine's rule,
never re-implemented or filtered here (bmad-loop 0.9.1 `verify.py safe_rollback`: `git reset --hard` to the attempt's
baseline, HEAD at its start, so stories landed earlier stay; only the untracked files new since that baseline removed,
ignored files excluded, `.bmad-loop/` and the BMAD artifact folders kept, `policy.toml` restored; the attempt parked on
`attempt-preserve/*` and `refs/attempt-preserve-dirty/*`), documented in `kb/bmad-base-patches.md`
§`run-worktree-rollback` as a policy setting, not a registered patch. **The kept stop:** with the rollback on, a
timed-out dev session is retried while budget is left and deferred after, never paused, so the next item boundary
honours the pending graceful stop and `stop-request-discarded` never follows a timeout; the engine is not edited.
**The paused leg:** a paused run that is not a sweep has the host leg run on its worktree when the tree is clean
(`git status --porcelain` empty outside the engine state, the materialised copies and the BMAD artifact folder
`_bmad-output/`, which the engine itself never counts as an attempt's dirtiness): one `host-verify`, and on green
the PR opens ready (`gh pr create` without `--draft`) or an open draft is marked ready (`gh pr ready`, `gh pr edit`);
red or inconclusive keeps the draft. A paused slice run's leg is the code leg only (no assets step; the slice proof
stays with the final close-out). A dirty paused tree runs no leg (`host-verify {skipped: true, reason: "paused:
dirty tree"}`), commits and stashes nothing, and the PR stays a draft. A PR an earlier green pause made ready that a
later pause finds with no green leg (red, inconclusive, skipped, killed) returns to a draft (`gh pr ready --undo`, its
body regenerated with `gh pr edit`), recorded a draft only when the undo answers. The pause's leg vouches for the pause only: the
engine's later end runs its own (`recordedVerify` reads a `host-verify` after the latest `launched` and `paused`).
This supersedes, for a paused run that is not a sweep, 0.1.31's pause close-out as a draft with no leg (a paused
sweep's WIP rule, "the PR stays a draft", is unchanged). **The `timeout` row:** `plansync.py stage --from-pass` also
writes a row for every earlier session of the story that no Stage Log row names by session id (a timed-out attempt
whose row the reset reverted, or whose hook never wrote; an earlier session with no session id or no start stamp, from
the journal else its transcript, is skipped, as `_backfill_rows` reads it): `outcome` the session's status (`timeout`), tokens from its
transcript else its `state.json` `usage`, cost by `meter.price` else `meter._session_usd`, `—` with no figure;
`report.py rollup` counts it in `by_stage`. The planner's section 3 splits a story whose plan's Files list or
estimated passes exceed the dev clock (`session_timeout_min`): two plans and a follow-on `stories.yaml` entry
`<key>-s2` (`Split: …`), or the halt consult's split candidates under Risks. **The cancel's cost (C6):** a cancelled
skill run's `finish --state partial --reason <cancelled>` carries `--total-cost-usd <x>`, `x` =
`launchedCloseOutInput(…).costUsd` (the metered engine, else the launch worker's `accounted` figure, plus any archived
engine's; a sweep's worker figure alone), the sum the PR body reads, so the `job-run` line and the body agree, else
the worker's `accounted` figure (`Queue.accountedCost(run, "worker")`: a skill run with no `launched` event); no
figure, no flag; a core run's `cancel` is unchanged. Every end of a cancelled run with the `cancelled` reason reads that
one rule (`cancelCostUsd`): the cancel itself and its late re-read, `recordMinted`, `mirror`'s cancelled-meanwhile end and
the recovery's `endCancelledLeftovers`. **`max_runs` (DW-157):** `evaluate_stop` counts toward
`stop.max_runs` only runs without `own_block`, as `on_status` already reads (0.1.31, Story 36.5). **The refused
arming (DW-161):** a run-epic with the one-story rhythm (`stop.after_stories: 1`) whose `stop-armed` for this engine is
`ok: false` is a third graceful stop in force, `StopInForce.source = "arming-refused"` (with its `detail`): the
paused-run pass ends the run at the boundary (`noteStoryBoundary`, `endAtBoundary`) with the end `story boundary:
<key> landed; the one-story stop arming was refused (<detail>)` and one `story-boundary` line, never a relaunch; its
`story-boundary` event records `graceful_stop: "arming-refused"` (no stop was armed, so nothing was kept; a pending
request or a discarded one keeps `"kept"`), and a close-out that gives up at that boundary ends with the same
arming-refused line, never "landed under a graceful stop"; an
`ok: true` arming, another engine's refusal or any other rhythm is unchanged. **The serve process:** `worktree.ts`,
`closeout.ts` and `cli.ts` run in serve, so the operator stops the supervisor before `apps/supervisor` is built and
restarts it through the scheduled task after the merge. Every other field, kind and route is unchanged.

**0.1.32 (Story 37.4, additive).** The status edges and the rhythm for every job (DW-151, DW-159, DW-160; the Epic 36
retrospective's B1, B2 and A4). **The block's resolution (DW-151, B1):** `canonical_status` maps `Blocked - Awaiting
User` onto canonical `blocked` and `Block Resolved` onto canonical `in-progress` (by name, before the category), so the
pull-back and the sync-back read a resolved block as work resumed. This supersedes by statement the 0.1.26 clause
"`Blocked - Awaiting User` and `Block Resolved` are canonical `blocked`" (kept above as history) and 0.1.31's
"an issue a resume finds in `Block Resolved` is `status: "partial"` with `conflict`". `promote` leaves `Block Resolved`
for any non-`blocked` canonical at every phase (`in-progress`, `review`, `done`), even when the snapshot's canonical
status already matches: the transition runs when the backend category differs from the target or the backend status
is `Block Resolved` and the canonical is not `blocked`. `apply_statuses` reads a backend move into `Block Resolved` as
the block's resolution: a local non-`blocked` status wins and stays unpromoted, never a both-changed conflict, so a
later `done` lands `Done` with no AD-5 conflict; a pull-back never re-maps a promoted `review` or `done` off `Block
Resolved` (the snapshot records `Block Resolved` with the local canonical, so the next promote exits it; a promote
that found no route out keeps the local status, and a pass that still finds none leaves the entity file unwritten); a
promoted `draft` or `ready` maps to `in-progress`, work resumed. A still-`blocked` entity whose issue is in `Block Resolved` keeps `blocked` while the
owner's resolution awaits validation (`track.py validate` reads the live `Block Resolved`): the pull-back records
the snapshot's `canonical_status` as `blocked`, raises no conflict, and no promote moves the issue; the exit follows
once the local status is non-`blocked`. `Blocked - Awaiting User` keeps winning while the block stands (a
resume's `track-unblock` moves it to `Block Resolved` first). **The picker's tie (B2):** within a status category the
candidates sort by `(rank, 0 if the name is the exact name else 1, the transition id as an integer when it is all
digits else last)`; the exact name is `Blocked - Awaiting User` for canonical `blocked`, else the category's first
preferred name, so a tie never follows the site's list order. **One `story_key` (A4):** the `in-progress`, `review`
and `done` phases' `plan-status` events spell one `story_key`, the story's key (the journal's `story-start` key):
`doneStories` strips the spec stem's `-spec` suffix; events recorded before 37.4 may carry it, so `ownerSpecPresent`
and `plansync.py stage_story` keep their strip. **The setup's copied transitions (DW-160):** each transition in
the `POST /workflows/update` body also carries its `screen` and `rules` (validators, conditions, post functions) under
the spellings the read returns; this supersedes 0.1.31's "not carried" and its `workflow update dropped screen/rules
from copied transitions` note. A transition whose read holds a key outside the carried set (`id`, `name`,
`description`, `properties`, `type`, `toStatusReference`, `links`, the legacy `to`/`from`, `screen`, `rules`) is
reported by name and left unchanged: nothing is posted for the workflow, `setup` answers `partial` with
`refused_transitions: [<name>, …]`, the note `workflow update not posted: transitions with fields the update does not
accept are left unchanged: <names>` and the owner steps. Whether the live site accepts those spellings stays the
operator's attended `plansync setup` call through the consult log (Story 36.6's CAP-16). **The duties by target
(DW-159):** a run owes the `in-progress` phase, the `stop-armed` rhythm and 37.3's `arming-refused` end when its
resolved definition runs stories — `runsStories(defn)`: `target.skill` is `tk-studio-launch` and `target.payload.verb`
is `start` (`run-epic`, `run-vertical-slice`, any later type that runs stories); a sweep (`verb: "sweep"`) owes none.
This supersedes by statement 0.1.31's "A `run-epic` job's type or id selects both duties" and 37.3's "a run-epic with
the one-story rhythm" in the refused arming: the rule is the job's target, never its type or id, at every site (the
launched path, the resume, the launched pass, the refused arming); `launch.py run_rhythm_row` reads the same rule
(`runs_stories`). The shipped `run-vertical-slice` carries `stop.after_stories: 1`, and the approve pass mints a game
engagement's `run-epic-N` of that type with an explicit `stop {on_status: ["blocked"], after_stories: 1}`; a
`run-epic` mint is unchanged. **The serve process:** `planstatus.ts`, `closeout.ts`, `cli.ts` and `approve.ts` run in
serve, so the operator stops the supervisor before `apps/supervisor` is built and restarts it through the scheduled
task after the merge. Every other field, kind and route is unchanged.

**0.1.32 (Story 37.5, additive).** The sweep's bugs and cost lines before a fourth sweep (the Epic 36 retrospective's
B3, B4 and B5; DW-136, DW-137, DW-138, DW-139, DW-144). **The ready flip (B3):** on a green re-run of a sweep run, an
open draft stays a draft while the run's record (`ended`, else `closed_out`, `sweep`) names a bundle `landed: false`,
records no triage, or the cut tip is a `wip:` commit (Story 36.3's WIP): `rerun.pr_ready` reads `held: <cause>` (`held:
<bundle>[, <bundle>…] not landed`, `held: no triage recorded`, `held: the tip is a WIP commit (<subject>)`) and no `gh pr
ready` runs. The body of `POST /runs/{id}/verify` is `{}` or `{ready?: boolean}` (another key, or a `ready` not a
boolean, is `400 SchemaError`); `ready: true` marks the draft ready whatever the record says and records
`rerun.ready_override: true`. On a sweep run (DW-193) `ready: true` first reverts a cut tip that is a `wip: sweep bundle
…` commit and pushes the revert to the run branch (never forced) before the leg, recording `rerun.wip_drop {wip,
subject, revert, pushed}`; a failed drop (`rerun.wip_drop: "error: …"`) runs the leg at the cut tip and holds the flip,
`held: the WIP commit not dropped (<error>)`, with no `ready_override`; the PR body is not filtered (its commits list the
WIP and its revert). Every bundle landed and no `wip:` tip: marked ready as before; a non-sweep run is never
held. **The ledger wait's bound (B4):** the ledger pass's wait on `pending` ends `SWEEP_LEDGER_WAIT_MS` (60 min) after the
waiting record's `at` on an unchanged fingerprint, checked before the unchanged-fingerprint skip (a changed `pending` set
is a new record and a new clock): one `ledger-resolve {…, waiting: false, settled: true, ended: "wait", pending}` record
under the lease and one notifier line, its outcome on the record's `notify`, never again. The run is then settled and
its entries are never flipped on their own, so the line carries the manual remedy, `uv run
plugins/tk-studio/lib/plansync.py ledger-resolve --directory <root> --pr <pr> --ids <pending>`. The notifier reaches the pass
as a `notify` callback `planstatus.mergePass` injects (`sweep.ts` imports neither `hygiene` nor `worktree`). A missing id
stays `pending` (no `missing[]`). **The stop deadline's clock (B5):** a sweep's status probe answering `unknown` notes
once per engine run `engine-probe {engine_run_id, phase: "unknown", error}`, a new queue event kind of its own that
never stands in for an `engine-stop` note (which `engineEndStatus` reads as the supervisor's own stop); on the probe path
an `engine-stop {engine_run_id, stopped: true}` note is written (once per engine run) only for a stop that answered
`stopped`, so the next tick's `stopped` end is known for the supervisor's own stop (its WIP committed, its end not
penalised); a later tick whose probe still answers `unknown` ends the run `blocked`, with no second stop (asked once
more, then the `blocked` end); `sweepStopPastDeadline` measures
`SWEEP_STOP_DEADLINE_MS` from the earlier of that note and the first `engine-stop` note carrying `error`, so a probe
that answers `unknown` from the start, the engine never paused, reaches the deadline path; a `running` probe never
resets it. Whenever no stop was left unanswered (no `engine-stop` note carrying `error`: never paused nor asked to
stop, the probe path's unanswered stop writing none and ending the run on that tick, or a stop that answered
`stopped`) the deadline's line names the probe, ``sweep <id>: the
status probe answered `unknown` for 30 min — ended blocked, lock and pin released``, never a stop left unanswered.
**The priced triage (DW-136):** `meter.py price-run` prices the engine's own triage sessions
(`tasks["sweep-triage"]`, `sweep-triage-<N>`, `sweep-migrate`) from `state.json` as it prices a bundle's sessions, into
a `triage {usd, source: "sessions", bound: "upper"}` member (never a bundle); `usd_total` includes it, so
`engine_cost_usd`, `(engine)` and `total_cost_usd` do; any triage session with usage that cannot be priced (no model and
no `triage` routing leg, or a model the price table lacks) makes the member read `triage {usd: null}`, never a refusal
of the run and never a partial sum. The `sweep` record gains `triage_cost_usd?` (a number or null) and `## Metered
cost` a `- triage: $<usd> (sessions)` line (`- triage: not metered`). This supersedes by statement the 0.1.31 Story 36.2
sentence that the engine's own `sweep-triage` session is not priced. **The ordered, retried emit (DW-137, DW-144):** the
`sweep-triage` note is patched `ledger: "emitting"` before `ledger.py emit`, then `emitted` or `error: <clipped>` with
`ledger_errors` counting the failures; a crash between the marker and the emit reads `emitting` and is retried (one
possible duplicate line, never a lost one). The ledger pass retries an `emitting` or `error` note on a terminal sweep
run each tick until it lands, under its `plan-lease {phase: "ledger"}` with the note re-read once the lease is taken
(the lease released settled, never counted as a ledger-resolve attempt), so overlapping passes never both emit,
bounded by `PLAN_RETRY_LIMIT` errors, never again after `emitted`; the retry of a note already `emitting` counts
into `ledger_errors` under the same bound, its marker `{ledger: "emitting", ledger_errors: <n + 1>}` patched before the
emit (a marker that fails to patch emits nothing). This supersedes by
statement 36.2's `ledger: "emitted" | "error: <clipped>"`. **The judge's `n` (DW-138):** a re-run's `host-verify` event is
noted first; the judge's `<run_id>:verify-<n>` line is then emitted with `n` the count of the run's re-run legs including
this one, and `rerun` (with `job_run`) patched onto the event whole; a note that fails emits no line, so no `n` is
reused. **The bare-id readers (DW-139):** `runCost` and `jobRunCosts` keyed by the bare run id answer the run's own line
plus its `<run_id>:engine` line (each the last line winning), so a late-closed sweep's API and delivery `cost_usd`
match the PR body; `jobRunCosts` folds the `:engine` line into the bare id's entry and keeps no `<run_id>:engine`
entry (a sum over its entries still counts each dollar once) and `:verify-<n>` lines stay their own. This supersedes by statement 36.2's DW-139 gap. **The serve
process:** `hostleg.ts`, `sweep.ts`, `worktree.ts`, `planstatus.ts`, `api.ts`, `board.ts` and `inbox.ts` run in serve, so
the operator stops the supervisor before `apps/supervisor` is built and restarts it through the scheduled task after the
merge. The fourth sweep's figure, `stop.max_runs` in `.tk-studio/jobs/run-sweep.json`, stays the operator's. Every other
field, kind and route is unchanged.

**0.1.32 (Story 37.6, additive).** One stop path for an engine and the gate's blind spots closed or named (the Epic 36
retrospective's AI-8, A1, A2 and B8; DW-133, DW-162, DW-164). **The one stop argv (AC1):** `runners.ts
engineStopArgv(root, eid, where, {graceful?, env?})` builds `launch.py stop` once, routed by tier, `--directory` always
present: on the host `uv run <plugin>/lib/launch.py stop --directory <root> --run-id <eid> [--graceful]`, on sbx `sbx
exec <sb> uv run <vm studio>/plugins/tk-studio/lib/launch.py stop --directory <vm root> --run-id <eid> [--graceful]`
(the POSIX tail joined after the VM mapping, never a `path.join`). `stopEngineAt` (the sweep's hard stop, no
`--graceful`), `launchStopGraceful` and the arming of `armStop`/`rearmStop` (one helper, the root rule kept:
`engineRoot(run)` for an injected stopper, `servedRoot(run)` otherwise) all execute it; `launchStopGraceful`'s success
on both tiers is exit 0 (`launch.py` exits 0 exactly when `ok: true`), a JSON `error` reading `launch stop refused:
<error>` and any other failure `launch stop failed: …`. `gracefulStopCommand` renders the same argv as text (the
`MSYS_NO_PATHCONV=1` prefix on sbx, quoting and the `<studio-root>` placeholders the text form's alone), and
`rearmFailedLine` names it: a failed or skipped re-arm's line re-issues the builder's command, `--directory` included
(DW-162), no longer a bare `launch.py stop --graceful --run-id <id>`. **The cycle test (A1, DW-164):** a dynamic import
of a sibling (`await import("./x")`, over comment-stripped source) is an edge, and no file in `src` may hold one; the
`enginemcp → api` residual is cut, not allowlisted: `checkBind` and `ApiBindRefused` move to the leaf `bind.ts`
(re-exported from `api.ts`) and `enginemcp.ts` imports it statically. `withMcpStop` is exported and pinned to inject
`stopEngineMcp`. **The named skip (B8):** the host gate (`tools/verify_host.py`) adds `, <S> skip` to a supervisor
file's line when bun skipped any (a file with none reads as before) and prints `== supervisor: <rel> skip: <describe
> test>` for each `(skip)` line bun reports, or one `== supervisor: <rel> skip: <S> test(s), names not reported` when
bun prints the count without the names (an AI-agent env); a skip is never silent, and the skip lines are not verdicts.
**The three exits (DW-133):** `bun src/cli.ts verify <run id>` exits 0 green; 1 red, inconclusive or skipped (the leg
did not pass); 2 refused. This states 0.1.28's exit list with the inconclusive leg (0.1.31) named; the 0.1.28 line
stays as history. **The serve process:** `closeout.ts`, `cli.ts`, `runners.ts`, `enginemcp.ts` and `api.ts` run in
serve, so the operator stops the supervisor before `apps/supervisor` is built and restarts it through the scheduled
task after the merge. Every other field, kind and route is unchanged.

**0.1.33 (DW-170, hole 111, additive).** The sandbox tier signs itself in again. `uv run <plugin>/lib/login.py <tool>
[--config PATH] [--dry-run]` (intent `tk-studio-login`) reads the owner's 1Password item named by the supervisor
config's optional `logins.<tool>` mapping (`item: op://<vault>/<item>`, `username_field`, `secret_field`; the file
`TK_SUPERVISOR_CONFIG` or `--config`) with the 1Password CLI under the service-account token `OP_SERVICE_ACCOUNT_TOKEN`
(a User variable; `TK_OP_BIN` pins the binary) and runs the tool's one fixed argv with the secret on stdin — for `sbx`,
`sbx login --username <username> --password-stdin`. It answers `{ok, tool, dry_run, item, op, username_length,
secret_length, argv (the username masked), exit, output (clipped, the secret, the token and the username scrubbed),
written: [], status, intent, artifacts, reason}`: `complete` on a sign-in or a dry run, else `blocked` (exit 2) by name —
`ToolUnknown`, `ConfigMissing`, `LoginNotConfigured`, `OpMissing`, `TokenMissing`, `ReadRefused`, `LoginFailed` — and
no value ever appears in its output. The supervisor's claim gate, on a `pin-failed` whose text reads `not signed in`,
runs the verb once per drain pass per sandbox, records one `relogin` event per outcome episode (`{sandbox, tool, ok,
reason, pass_at}`, patched in place while `ok` repeats) and pins again on `complete`; the `pin-failed:<sandbox>`
refusal's `resolves` names the verb. The supervisor config gains the top-level `logins` key (an unknown key beside
`jobs` and `logins` is still `SupervisorConfigInvalid`). `tk-studio doctor` gains the `docker-login` check, read from the
sandbox-login check's own `sbx ls`. Every other field, kind and route is unchanged.

**0.1.34 (Story 38.1, additive).** The host leg's own guard and its measure (DW-174, hole 113). **The key:**
`job.schema.json` gains `guards.host_verify_seconds` (a number > 0): the host verify leg's own wall clock, read in place
of the worker's guard by the close-out and the re-run; it bounds the leg, never the job, so it does not satisfy the
at-least-one guard rule (AD-10). The shipped `run-epic`, `run-vertical-slice` and `run-sweep` types carry `7200` (run-sweep
by the run-epic shape). Type extension now merges `guards` key-wise (instance keys win), so an instance may override the
key and a job without one gets its type's. **The readers:** every caller of the leg — the close-out's boundary leg
(`closeout.ts`), the engine sweep's tail (`worktree.ts`) and the re-run (`hostleg.ts`) — reads `legGuard(<the run's
definition snapshot>)`: `guards.host_verify_seconds`, else `guards.max_wall_clock_seconds` (a snapshot taken before
38.1), else 600; the run's `worker_guard_s` is never read by the leg and stays the worker's (as does `sbxDeadline`).
**The guard text:** every step of the leg names its trip `guard: <key> (<N>s)` — `guard: host_verify_seconds (<N>s)`,
`max_wall_clock_seconds` only for a definition without the key; the worker's own trip (`guard: max_wall_clock_seconds
(<N>s)`) is unchanged. **The lease (a run in its close-out):** before a close-out leg (boundary or sweep tail) the
supervisor notes `host-verify-leg {owner: {pid, host, nonce, start?}, by: "close-out"}` (DW-184: plus `guard_s` and
`deadline`), closed by the leg's own
`host-verify` exactly as the re-run's `takeVerifyLeg` lease is. **The measure:** `tools/verify_host.py` prints one `==
durations: <suite>=<N>s, …` line (the suites that ran, in run order — `lib suite`, `conformance`, `supervisor`,
`studio-web` — integer seconds) immediately before its final `verify_host: ok|FAILED (…)` line, after every failure
tail; the leg records `suite_durations: {"<suite>": <int seconds>}` on the `host-verify` event beside `verdicts`, on
green, red and guard alike — from the last `== durations:` line, else (a guard kill) from the gate-level `ok|FAILED … in
Ns` suite lines before the first tail header — absent when none printed; the PR body's `## Host verify` reads
`Durations: <suite> <N>s, …`, and `bun src/cli.ts verify` answers `suite_durations`. **`inconclusive (guard)`:** a host
step ended on the guard after at least one gate-level suite verdict, none red, is inconclusive (Story 35.3's shape, beside
the judge's): the run ends `partial` with the reason `host verify inconclusive (guard): timed out (guard:
host_verify_seconds (<N>s)) with every verdict so far green; unrun: <suites with no gate-level line, ", "-joined |
none>`; the PR body reads ``**Timed out:** `<command>` — <guard> (<secs>); every verdict so far green; unrun: <list>``,
never "failed" and never "Red" outside the fences; it is a draft, never marked ready, flips nothing on a re-run, and the
re-run verb's exit 1 covers it. A trip with no suite verdict (a generic command, the first suite still running) and an
engine-step trip stay red. On an `inconclusive (guard)` leg (any host step ended on the guard) the skipped engine
step's (and a slice run's skipped assets step's) reason is `verify.host timed out`, added to the skip reasons beside
`verify.host red`, so the PR body's `Engine gate:`/`Assets:` lines say timed out, never red. **The beside-leg refusal:** `tools/verify_host.py` reads the queue read-only before its first
gate (`queue.db` at `TK_SUPERVISOR_DB`, opened `file:<Path.as_uri()>?mode=ro`; the API serves no `GET /runs` list): a
live leg is a run's latest `host-verify-leg` with a non-null `owner` and no later `host-verify` (DW-184: and no
`deadline`, or one still ahead). While one is live it
refuses, exit 2: `verify_host: refused: a host leg is live on this box: queue run <id> (by <by>, since <at>)[; …]; two
gates on one box halve each other (hole 113): wait for its host-verify event (GET /runs/<id>), or pass --beside-leg to
run anyway`; `--beside-leg` prints `verify_host: WARNING: --beside-leg: running beside the live host leg of queue run
<id>[, <id>]; both gates slow each other and the leg may run out its guard (hole 113)` and runs the gates. No queue (the
variable unset or its file absent) is no check and no line; an unreadable one prints `verify_host: the queue at <path>
was not read (<error>); running without the beside-leg check` and runs; the leg's own run (`TK_SUPERVISOR_HOST_LEG=<run
id>`, set by the leg) never reads it; no owner pid is probed. **The narrowed leg:** a leg narrowed to the suites a diff
can affect (the whole leg at the epic's end) is Tim's open question, recorded with the measured `suite_durations` as its
evidence; nothing narrows the leg. **The serve process:** `closeout.ts`, `worktree.ts`, `hostleg.ts`, `hostverify.ts` and
`cli.ts` run in serve, so the operator stops the supervisor before `apps/supervisor` is built and restarts it through
the scheduled task after the merge. Every other field, kind and route is unchanged.

**0.1.34 (Story 38.2, additive).** A run that does no work says so (hole 114, DW-180, the 37 retrospective's C3/AI-2). **The
partial rule:** a run whose engine ends with no commits ahead of its base and its story's spec not `done` ends `partial` with
the reason `no story landed: story <key> ended <word> after <n> dev attempt(s): <HALT text>; engine ended '<status>'`; no host
leg runs on a tree equal to its base (`host-verify {skipped: true, reason: "no changes"}`). The rule is read on the engine
sweep's tail (`worktree.ts`, an engine that ended on its own: not paused, not a sweep, not killed, no PR open): the commits are
`git log --oneline <base_ref>..HEAD` (`commitsAhead`, factored from the close-out; a failed probe runs the leg as before); the
skip is noted before the leg's `host-verify-leg` lease, so a skipped leg notes no lease; the story is the latest `story-start` of
the engine journal's current segment, its word the spec's frontmatter `status` (the spec found in the worktree, else the copy the
engine stashed on the defer, `<run dir>/deferred/<key>/`), else the last session's `result_json.status`, else `unknown`; the HALT
text its last `Blocking condition:`, else the first line of its `## Auto Run Result` that is not `Status:`, else the last
`dev-decision` reason (clipped to 300); the attempts its `dev-decision` entries. A run with no `story-start` keeps its end, the leg
still skipped. The end notice reads `supervisor: run <id> ended partial` / `reason: no story landed: …`, and `finish` carries the
close-out's cost, else the worker's `accounted` figure. **The render signature:** the hole-65 auto-resume (Story 33.6, 36.3) is
keyed on the render failure's signature over the paused reason and the spec's `## Auto Run Result` — exactly one
`_bmad/render/<skill>/<slug>/<generation>` folder named, and a renderer message, `render_skill.py` or an unreadable entry
(`?????????`, `No such file or directory`, `Permission denied`, `ENOENT`, `EACCES`, `cannot access|open|read`, `unreadable`) — at
any paused stage and whatever status word the session wrote (`halted` included), the spec found (or stashed) and not `done`,
untracked, the folder under the served root's `_bmad/render/` and ready (the 33.6/36.3 folder check, unchanged); the stage, the
`CRITICAL escalation from dev session` prefix and the `blocked` word are no longer required. The `auto-resume` record gains `via:
"resume" | "relaunch"` and `status_word`. **The ended path:** a `halted` word never pauses the engine (only `blocked` escalates), so
a no-story end whose spec carries the signature over a ready snapshot, with no `attempt: 1` for the story (or one with no `attempt:
2` after it), is paused by the supervisor itself — the worktree and branch kept, `paused` detail `{engine: {…, paused_story_key,
paused_stage: "no-story", paused_reason: <the no-story reason>}, no_story: {story_key, word, attempts}, …}` — and the paused-run pass
relaunches the epic once through the 27.3 relaunch (an ended engine is never resumed): the archive, the rebuild, the `paused` →
`running` move with a `close-out` event `{reason: "stale-render-view", halted_story, archive}` that names no `story_key` (so the
rhythm's finished-story count never counts it), the drive. A second occurrence records `attempt: 2` with the operator's line and
stays paused, as before. The pause also carries the HALT text unclipped (`no_story.halt_text`), which the pass signs in place of
the clipped `paused_reason`, and the supervisor pauses only a no-story end whose spec was found and is untracked (else the
`partial` end stands); the operator's `POST /runs/{id}/resume` of a pause over an ended engine (`engine.status` ended, or
`paused_stage: "no-story"`) is refused `RunNotPaused` naming the ended engine — a resume never re-drives an ended engine; the
operator cancels the run. This answers the retrospective's open question (a HALT on a render failure as a CRITICAL escalation) on
the supervisor's side; the engine is never edited (AD-4). **`plan-status {phase: "draft"}`:** a terminal run with no PR (never
`external`) returns each story it marked `in-progress` (`ok`) to `draft`, once, under the per-story lease `draft:<key>`, on the entity
its `in-progress` event names, with the note `run <id> ended without a PR: <the run's reason, clipped to 200>`; a transient failure
is retried, bounded by `PLAN_RETRY_LIMIT`. A plan entry never reads `in-progress` for a story no run holds. The draft is guarded three ways: only when the run's last
close-out reported `no_changes`, only when no later run marked the story `in-progress`, `review` or `done`, and never for a story any
run marked `review` or `done`. **`stage-carry` and the
`halted` outcome:** a Stage Log row's outcome is the session's status unless a `completed` session's `result_json.status` is a word
other than `done`, `in-review` or `ready-for-dev` — then that word (`halted`) — in the hook's row and the 37.3 backfilled row alike;
at a no-story end (and the ended path's pause) the supervisor runs `plansync.py stage --from-pass --run-dir <served>/.bmad-loop/runs/<eid>
--story <key> --worktree <root>` once on the host before the close-out, which buffers the rows in the root's `<spec folder>/stages/<key>.jsonl`
until the spec lands there, and records one `stage-carry {story_key, ok, rows?, buffered?, error?}`; it never blocks the end. **The
render patch:** both tracked copies of `_bmad/scripts/render_skill.py` carry `tk-studio base patch render-skill-reread-fresh-destination`:
after the staging rename lands (and after the race path's `_verify_existing`) every output and `manifest.json` is stat-ed and re-read
byte for byte; on a failure the generation is removed (else renamed onto a fresh `<generation>.stale-<pid>`), the outputs written
straight into a fresh destination (the manifest last) and re-read once more; a second failure raises `failed to verify <path> after a
direct write: <error>`, which the signature keys on. It is registered beside DW-110's patch in `kb/bmad-base-patches.md`, with no
`patches.json` entry until an upstream issue URL exists. **The serve process:** `worktree.ts`, `closeout.ts` and `planstatus.ts` run in
serve, so the operator stops the supervisor before `apps/supervisor` is built and restarts it through the scheduled task after the
merge. Every other field, kind and route is unchanged. **The resumed segment:** a resumed engine's segment with no `story-start`
(`resolve --resume` appends `run-resume` and re-arms the story without journaling one) reads the story from the whole journal's latest
`story-start`, its attempts the `dev-decision`s for the key from that entry onward (the pre-resume attempts count).

**0.1.34 (Story 38.3, additive).** The sweep's path cleared (the 37 retrospective's AI-3: B1, B2, B4; DW-165). **The deadline's
streak (B1):** a paused sweep's stop deadline (`SWEEP_STOP_DEADLINE_MS`, 30 min) runs from the first note of the latest
non-`running` streak: an `engine-probe {engine_run_id, phase: "unknown", error}` (an older `engine-probe` with no `phase` reads
as non-`running`) or an `engine-stop` carrying `error`, after the latest `engine-probe {engine_run_id, phase: "running"}`. A sweep's
`running` probe writes that note only while a streak is open, so a `running` probe resets the clock and a healthy engine writes
nothing per tick; the `unknown` note and the paused branch's `error` note are written once per streak, and `answered` and `asked`
read the latest streak only (`engineEndStatus` is unchanged). The deadline is a wall-clock window, not a probe count. This
supersedes by statement 37.5's "a `running` probe never resets it". **The held end:** an unanswered stop's `blocked` end with no
stop answered `stopped` in the streak holds the lock and the pin: `endEngine {holdEngine: <engine_run_id>}` keeps the checkout lock
as the engine's (`detail.lock = {handed_to_engine}`), no pin release, `ended.detail.engine_held {engine_run_id}`, and the lines end
``paused sweep <id>: stop unanswered for 30 min — ended blocked, lock and pin held until a stop is confirmed or the engine exits``
and ``sweep <id>: the status probe answered `unknown` for 30 min — ended blocked, lock and pin held until a stop is confirmed or the
engine exits``. Each engine-end sweep tick, `releaseHeldEngines` probes the held engine on its kept worktree: `ended` (or the
worktree gone) releases the lock (`lock-released`), then the pin, then notes `engine-released {engine_run_id, by: "exit", engine}`;
`running`/`paused` gets one stop, whose `stopped` releases the same way with `by: "stop"`; `unknown` releases nothing (fail closed;
no timer releases it). A release left half-done (the lock freed, the pin perhaps too, the `engine-released` note not written) is
finished on a later tick without a probe: the pin is released (again, idempotent) and `engine-released {engine_run_id, by, resumed: true}` is noted, `by` read
back from the `lock-released` reason, with no `engine` field. `sandboxHolders` counts another ended run whose engine is held (`heldEngine`), so another run's release never
stops the sandbox under it. A probe-path stop that already answered `stopped` keeps ``… — ended blocked, lock and pin released``
and releases at once; the raced path (a cancel won) keeps the cancel's handling. This supersedes by statement 37.5's "lock and pin
released" on an unanswered stop. `engine-released` is a new queue event kind and `engine-probe` gains `phase: "running"`.
**The refused pass (B2):** a non-retryable `ledger-resolve` refusal is noted `ledger-resolve {pr, ids, resolved, pending, ok:
false, settled: true, ended: "refused", reason, error}` and sends one line through the injected notifier, ``sweep <run_id>: the
ledger pass was refused and flipped nothing: <reason>; fix the owner ledger (a duplicate heading: renumber one; a missing id: use
its entry's current id), then flip by hand: <remedy>``, its outcome patched on the record as `notify` (`{ok: false, skipped: "no
notifier injected"}` with none) — never a silent settle. The CLOSED skip and the `PLAN_RETRY_LIMIT` give-up stay silent. **The
missing id (B4):** `ledger-resolve` refuses an id with no `### DW-N:` heading by name before any write (a `--dry-run` too):
``LedgerMissingId: DW-9[, DW-12] not in the ledger (the counter's next id: DW-<n>)``, `n` by `deferred mint`'s rule
(`max(next.deferred-work, highest id + 1)`), ``(the counter unreadable: <error>)`` when the counter cannot be read; `blocked`,
exit 2, no `retryable`. `pending` keeps only `open` entries. This supersedes by statement 37.5's "A missing id stays `pending` (no
`missing[]`)" and 0.1.30's "a still-`open` one `pending`" for an absent one, which is now refused. **The remedy:** both the wait
end's line and the refused end's carry one builder's command, `uv run --no-project python "<studio root>/plugins/tk-studio/lib/plansync.py"
ledger-resolve --directory "<run root>" --pr <pr> --ids <ids>` (`ledgerResolveCommand`, rendered by `ledgerRemedyText`), runnable
from any cwd; the path is a host path joined natively (never `toVmPath`), `<studio-root>` when `TK_STUDIO_ROOT` is unset. This
supersedes by statement 37.5's relative `uv run plugins/tk-studio/lib/plansync.py …` remedy. **The bundle's rows (DW-165):**
`plansync.py stage --from-run --run-dir D --worktree W` (read only, a fifth `stage` mode) answers `{ok: true, columns, bundles:
[{key, rows}], written: []}` plus the status block, one row per bundle session in `state.json` order by the `--from-pass` row
logic (an unreadable `state.json` is `blocked`, exit 2). The supervisor puts the rows on each bundle of the sweep record
(`stage_rows`, or `stage_error`), so a re-run's body rebuilds, and renders `## Stage Log` after `## Sweep` and before `## Host
verify`: per bundle `### <name>[ (cycle N)] (<dw ids>)` and the story-doc table (stage | pass | started | ended | session_id |
model | effort | tokens_in | tokens_out | cost_usd | outcome), `no engine pass recorded`, or `Stage Log not read: <error>`. A
bundle has no Jira issue, so no Jira row is owed; the triage sessions get no table. **The serve process:** `sweep.ts`,
`worktree.ts`, `queue.ts`, `sandbox.ts` and `cli.ts` run in serve, so the operator stops the supervisor before `apps/supervisor`
is built and restarts it through the scheduled task after the merge. Every other field, kind and route is unchanged.

**0.1.34 (Story 38.4, additive).** The owner's decisions have a source and a sink (hole 112, DW-171; EP-36 B1, the 37
retrospective's B3/AI-4). **The decision shape:** `launch.py triage_summary` and `sweep.ts parseTriage` project each triage
decision as `{id, question, context, options: [{letter, text, key, effect}], default}` — the stock skill's own `options [{key,
label, effect, intent?, resolution?}]` lettered `A`, `B`, … in its order (AD-4: the skill is never forked), `text` the label then
` — <intent or resolution>` on one line clipped to 200, `default` the letter whose `key` is the `recommendation` (else null; no
options: `options: []`, `default: null`); the `sweep-triage` note carries the shape (additive), its ledger payload and the
reason stay ids. **The grouping:** decisions whose normalised question and option list (lowercased, whitespace collapsed, every
`DW-\d+` removed; the options as `(label, effect)` plus the recommendation's index) are equal share one issue, at most 30 ids
(chunked past that), groups ordered by their lowest DW number. **The issue form:** a `Task` labelled `tk-studio-decision`,
`assignee` the recorded owner, summary `Decision: DW-87 — <question>` / `Decisions: DW-12, DW-13 — <question>` (past 6 ids
`DW-12, …, DW-17 +N`, within 255), the description `Sweep <studio run id> (engine <engine run id>) needs <n> decision(s).
Answer in one comment: …` then per id the question, the context, `A) <text>` lines and `Default: <letter|none>`; then
`Blocked - Awaiting User` by name and the mention comment `[~accountid:<owner>] Blocked: <n> sweep decision(s) need your
answer: <ids>` / `Resolves when: reply with one "<id>: <letter>" line per decision, "all: <letter>", or "default"`. **The
source verb:** `uv run track.py block --directory ROOT --source sweep --triage PATH [--triage PATH …] --run-id RID [--ask DW-N
…] [--dry-run]` (exclusive with `--story`, `--engagement`, `--reason`, `--resolves` and `--kind`, each mix refused by name,
exit 2, no call; a later `--triage` wins by id) answers `{ok, dry_run, source: "sweep", run_id, issues: [{issue, ids, created,
transitioned, commented, skipped?, error?}], skipped[], notes, written}` plus the status block; an id asked on an open record
issue or answered is skipped (`DW-n: already asked on KEY` / `DW-n: answered on KEY`) unless `--ask` names it (its block then
reads `Earlier answer: <letter> (<KEY>) no longer matches these options`), and once an `--ask` id is open on a record issue
other than the one its answer names, a repeated `--ask` is idempotent (`DW-n: already re-asked on KEY`, no second issue); a
legacy entry whose `status` is `Done` is not asked; an open record issue whose block did not complete
(`blocked: false`) has its move and mention finished on the next call, its ids not skipped; refusals are `block --engagement`'s plus
`TriageUnreadable`; a temporary failure is `partial`, `ok: false`, `retry: true`; a dry run creates and writes nothing and
names each group (`dry run: would create "<summary>" …`), `partial`. The sweep's close-out (`sweepCloseOutSummary`, every
site) calls it on a bound project only (`jiraBound`, moved to `planseams.ts` and re-exported from `closeout.ts`), one
`sweep-decisions-posted {engine_run_id, ok, status, issues, skipped, retry?, error?}` note per call, and the PR body's
`### Human decisions` lists `- <KEY>: <ids>` in place of the bare questions (the sweep record's `decision_issues`); an
unbound project makes no call and keeps the bare questions — so the README/contract wording "skipped unattended: `bmad-loop
decisions` answers them" is superseded by statement for a bound project. **The record:**
`_bmad-output/tracking/decisions-jira.json` at the project root (local tracking memory, atomic, UTF-8, never committed): `{version: 1, issues: {<KEY>: {ids,
run_id, engine_run_id, posted_at, state: open|done, blocked, decisions: {<DW>: {question, options, default}}, cycles: [{block_comment,
at, ingested, missing}]}}, answers: {<DW>: {letter, text, key, label, effect, issue, date}}}` (`blocked: false` from the create
until the move and the mention are done; an entry without it is taken as blocked); a legacy entry (the 2026-11-05
hand posting's) is kept as it is and read only for its `DW-\d+` ids (that file is keyed by group name — `DW-32`, `R1`,
`HUD`, … — each entry naming its `issue`: it is indexed under that issue, its group name kept in the entry's `group`; a `DW-n`
name is never taken for an issue key), its ingest cycles in a top-level `legacy_cycles` beside it,
every other top-level value of the file kept verbatim (a name the record uses under `legacy: {<name>: value}`, a top-level
list as it is under `legacy`; a record's unrecognised keys kept likewise),
its options read from the live description (none readable: `not ingested: options unreadable` and a re-block, never
invented). **The grammar and the `default` rule:** the owner's comments after the newest agent `Blocked:` comment, in order;
a line trimmed, a leading `-`/`*` stripped, matched case-insensitively: `<DW-n>: <letter>`, `all: <letter>`, `default`; an id's
own line, then `all:`, then (only with a `default` line) its default; a later line wins; a letter outside the options is
`DW-n: no option X`, `DW-n: <letter> <more>` is `qualified answer, not ingested`, a `default` with no default is `no default`,
an id `ledger-decide` refuses is `ledger refused`, each left open. **The `decision:` line and its verb:** `uv run plansync.py ledger-decide --directory ROOT --id DW-N --letter L
--text TEXT --issue KEY [--date YYYY-MM-DD] [--dry-run]` inserts `decision: <letter> — <text> (<KEY>, <YYYY-MM-DD>)` directly
after the entry's `status:` line (one atomic write; a line with the same letter, text and KEY already there, whatever its
date, is `unchanged`; `status:` never touched) and
answers `{ok, ledger, id, line, decided, unchanged, dry_run, written}` plus the status block; a bad id, letter, key or date,
`LedgerDuplicateId`, `LedgerMissingId`, an entry with no `status:` line or no ledger is refused (`blocked`, exit 2). The engine's own `decision:` line beside it
is kept. **The engine answer:** at the sweep's close-out (the one time its run dir still holds the triage), `answerDecisions`
matches each recorded answer to the triage's options by `(effect, normalised label)`, else by `key` with an equal label, else
(a hand-posted issue's answer, with no `key` and no `effect`) by its label equal, normalised, to an option's lettered `text`
(a miss goes to the post's `--ask`; an id whose triage options are unreadable is neither matched nor asked), then on the sbx tier runs `sbx exec <sb> sh -c '"$HOME/.local/bin/bmad-loop" decisions --json
--project <vm>'` and, while the leading pending ids have matched answers, `printf "%s\n" <keys> | … decisions --project <vm>`
(`<vm>` is `toVmPath` of the served root; each key checked against `^[A-Za-z0-9_-]{1,16}$`; the EOF after the last key ends the
verb non-zero, as expected), judged by a second `--json` read; the engine commits its line and store on the run branch, in the
sweep's PR. One `sweep-decisions-answered {engine_run_id, answered, left, ok, error?}` note per engine run; a failure never
blocks the close-out; with no open sweep record the record's `answers` waits for the next sweep's close-out. **The ingest, the
reply and the re-block:** right after `inbox.derive`, under its gate, `sweepdecisions.ingest` takes each `resolved` item
carrying `decision`, once per `(issue, reason_comment.id)`: the parse, `ledger_decide` per answered id, the record's `answers`,
one agent reply `Ingested: DW-87: B — <text>; …` / `Still open: DW-129 (no answer line), …` (`none` when complete), then a
by-name move to `Done` (the entry `state: done`) or `_block_issue` with `[~accountid:<owner>] Blocked: <n> sweep decision(s)
still need your answer: <missing ids>` (`repost_after_owner`); counts `decisions_ingested`, `decisions_reblocked`,
`decisions_done`; only a temporary failure (`track.transient`) records no cycle and none of the item's `answers` when it
comes before the reply (`partial`, `retry: true`; retried next tick); one after the reply (the `Done` move or the re-block)
records the cycle with `move_pending: true` (`partial`, `retry: true`), and the next tick retries only that move — never a
second reply — then clears the marker; any other failure (a refused reply, a `Done` move or a re-block refused or
with no route) still records the cycle `{block_comment, at, ingested, missing}`, the failure in `notes` (`ingested` the ids
whose ledger line was written, merged into `answers`; `missing` the rest; never retried, so never a second reply); an item
with no `reason_comment` id is skipped before `ledger_decide` and the reply, with a note, and records nothing. **The inbox field:**
`SEARCH_FIELDS` gains `labels`; an item whose pulled labels hold `tk-studio-decision` carries `decision: {ids}` (the record's
entry, else the summary's `DW-N` tokens; kept from the previous item when labels were not pulled), its `title` the summary;
the resolution pass skips it beside `engagement` (no `validate-resolution` run); the studio web lists decision rows in `open`
and `resolved` with their `state` and a `Decision` tag (no new screen; DW-178's check-in UI is not built here). **The block
edge (option (a), named here):** the promote leaves `Blocked - Awaiting User` for a canonical `in-progress` or `review` when no
block stands — (i) the snapshot's `canonical_status` is `blocked` (a driver's status call moved the entity off the block it
recorded) or (ii) in `<root>/_bmad-output/tracking/<KEY>/comments.jsonl` an owner comment is newer than the newest agent
`Blocked:` comment — by the category move, else by name to `Block Resolved` and then the category move, else a note with the
file untouched; a block that still stands keeps winning. Option (b), `track unblock` on every cancel and re-drive path, is not
taken: no cancel or re-drive path changes. **The serve process:** `sweep.ts`, `planseams.ts`, `closeout.ts` and
`resolution.ts` run in serve, so the operator stops the supervisor before `apps/supervisor` is built and restarts it through
the scheduled task after the merge. Every other field, kind and route is unchanged.

**0.1.34 (Story 38.5, additive).** The pause path finished (the 37 retrospective's B5 to B8, AI-5; DW-166, DW-176, DW-177).
**The order and the leg's own pass:** the engines loop (`sweepEngines`) runs no host leg for a non-sweep pause: it closes the
pause out (push, PR) reusing only a leg already recorded for the run's code head, else with no verify (a draft, 0.1.31's pause
close-out), and writes `paused`; `closeOutPaused` then sends the `awaiting-ruling` notice and the issue's block exactly as
before. A new pass `pausedLegs` (`closeout.ts`), the last pass of every recover, drain and run (after `sweepEnds`, before the
queue closes), takes at most one paused non-sweep run per pass (its latest `paused` oldest first) whose worktree exists, whose
engine the supervisor did not kill, whose landing owes nothing unsent (an `awaiting-ruling` landing once its ruling is recorded
and no block is owed; a story that did not land once the block it owes is recorded; never a `close-out` landing, which
`boundaryLeg` owns; never a `no-story` pause) and with no leg recorded for its code head. Under `takeForCloseOut` (released in
`finally`; a resume meanwhile answers `RunNotPaused`, "held by a live process") a dirty tree notes one `host-verify {skipped:
true, reason: "paused: dirty tree", code_head}` and nothing else; else the code leg runs (38.1's `legGuard`, the close-out's
lease noted first, no assets verb), the PR the pause recorded is flipped — green (ran, `green: true`, not inconclusive): `gh pr
ready` then `gh pr edit`; red, inconclusive or skipped: `gh pr ready --undo` then `gh pr edit` — and one `host-verify` is noted:
the leg + `code_head` + `paused_leg: {pr?, flip: "ready" | "draft" | "error: <…>" | "none"}`. The flip is recorded there, never
on a `closed_out` (a late close-out's `takeEndedCloseOut` would refuse) nor by rewriting `paused`. **One leg per code head:**
`codeHead` (`worktree.ts`) is `git -C <worktree> log -1 --format=%H -- . <the engine state> <the BMAD artifact exclude>` (the
`treeClean` pathspecs, argv only, bracketed globs): the newest commit touching anything but the engine state, the materialised
copies and `_bmad-output/`, so a harvest commit holding only `_bmad-output/` does not move it (the harvest is a `git add -A`:
one that also commits code the engine left uncommitted moves it, and a fresh leg runs); undefined on any failure. Every leg the supervisor
records (`sweepEngines`, `boundaryLeg`, `pausedLegs`) carries `host-verify.code_head`. `recordedVerify(events, codeHead?)`:
with a code head, the latest ran (not skipped) leg recorded for it at any position; else the position rule over records with no
`code_head` or an equal one; with no head known (the late close-out, a worktree gone), the position rule as before. The engines
loop (paused or ended, non-sweep) and `boundaryLeg` (after the harvest commit) pass the code head, so one commit set gets one leg
across a pause and the boundary. Three exceptions: a `paused: dirty tree` skip is never reused and never vouches; a pause reuses
a head's leg only on a clean tree (a dirty one closes out with no verify, a draft, and `pausedLegs` notes its skip once, its
eligibility reading only the records since the latest `paused`); and a `run-vertical-slice` run's end (`recordedVerify(…,
slice)`) never reuses a ran leg with no `assets` record (`pausedLegs`' code-only leg), so its assets, contact sheet and proof
commit get their own leg. The late close-out's vouching skips are by-design ones only (`no verify.host`, a host-tier run, no
changes), never a dirty-tree or `paused sweep: …` skip. **The policy:** a run worktree with no `.bmad-loop/policy.toml` after the copy is refused
`WorktreeFailed("policy", "none in the checkout")` (message `worktree policy: none in the checkout`; the run ends `blocked` as
every prepare step), never given a stub; `launch.py sweep`'s gap check is unchanged and now agrees. **The TOML-aware edit:** the
policy is parsed first (`Bun.TOML.parse`; one that does not parse is refused untouched, `does not parse`); already
`scm.rollback_on_failure = true` is not written; else one targeted line edit by the form that defines the key — a bare boolean
or a quoted value under `[scm]` (the value token replaced, indentation and a trailing comment kept; the key absent there:
inserted under the header), a dotted root key `scm.rollback_on_failure` (replaced; other `scm.` dotted keys only: inserted after
the last), a one-line inline table `scm = { … }` (replaced inside the braces, else appended before `}`), no `scm` at all: the
table appended — accepted only when `Bun.TOML.parse` of the candidate deep-equals the original with that one key set; any other
form (a multi-line inline table, an `[scm.<sub>]`-only definition) is re-serialised with `Bun.TOML.stringify` (declared by the
pinned `bun-types@1.4.2`; comments and layout not kept, every value kept) under the same check, refused by name when absent (`no
in-place form and no TOML serialiser`) or when the check fails; `scm` that is not a table is refused. Then the 37.3 write (a tmp
file renamed onto the file) and a parse after the write; a failure restores the original and refuses by name. CRLF is kept by the
line edit. **`stop.max_own_blocks`:** `job.schema.json` `stop.fields` gains `max_own_blocks` (an integer > 0, default 3, a bound
and no stop condition: it does not satisfy the at-least-one rule, as `after_stories`); `evaluate_stop`, for a job whose trigger
is not `one-shot`, stops scheduling once the trailing streak of counted runs carrying `own_block` reaches it, the line `stop:
max_own_blocks (<n>) reached — the last <n> runs ended on the supervisor's own block (<kind>)`, checked after `max_runs` and
before `until`; no `cli.ts` change (the wake's refusal is the stop, as `max_runs`). **The engine-clock pause:** a pause whose
`paused_reason` names a `session timeout`, or whose engine journal's segment after its latest `run-start`/`run-resume` has its
latest `session-end` before `run-paused` reading `status: "timeout"` (`engineClockPause`, read only), is blocked on the
`escalationBlocked` path with `track.py block --story <key> --reason "engine clock: <paused_reason>" --resolves "the supervisor
resumes the run (POST /runs/<id>/resume)" --source run --kind engine`; its `track-block` gains `kind: "engine"`; no
`awaiting-ruling`, no notifier line; the resume's `track.py unblock` clears it as any block. `track.py block --story … --kind
engine` comments `Blocked (engine): <reason> — no owner action` / `Resolves when: <resolves>` with no `[~accountid:…]` (a
dependent's neither), the transition, the skip rules, the owner-id refusal and the dependents unchanged; any other `--kind`
with `--story` is refused by name (exit 2), and `--source sweep` keeps refusing `--kind` (38.4). **The late close-outs (DW-64's
remainder):** a close-out with no leg opens or marks a PR ready only on a `complete` end a recorded green or skipped leg vouches
for, or for a run that launched no engine (no `launched` event, no engine run id); otherwise it passes `killed: true` (an open PR
stays or returns to a draft, `gh pr ready --undo`; a new one opens `--draft`). The late terminal close-out: `killed` unless the
run ended `complete` and the rule holds (the position rule); `closeOutNow` gains the end state (the run's end passes its terminal
state, else `blocked`; the drive failure `blocked`): `killed` unless `complete` and no engine launched; the cancel passes
`cancelled`: always a draft. Each leaves its records: `closeout.result: "draft PR"` with `pr` on its event (the late one's
`closed_out`, `closeOutNow`'s and the cancel's `ended.detail`) — the stage pass's `close-out` row and the plan-status review
pass's PR source — and one `job-run` line (the cancel's `finish` with `--total-cost-usd`, the run's own `finish`, none extra from
a late non-sweep close-out). **The split spec:** one rule in three places — `plansync._stage_target`, `closeout.findSpec`
(`implementation-artifacts/spec-<key>.md` still first) and task-planning.md section 3 (both copies): the exact
`stories/<key>-spec.md` first (one hit wins; several folders: the ambiguity answer), else the prefix glob `<key>.md` /
`<key>-*.md` with every name whose rest after `<key>-` matches `^(s|r)\d+(-.*)?\.md$` excluded, used only when exactly one file
matches (`_stage_target` keeps its `PlanSyncError` for several). The engine's own `<id>-*.md` glob is outside this repo: a
remediation re-drive of a first half after its `-s2` landed is the engine's residue. **Superseded by statement:** 0.1.32's
(Story 37.3) paused leg in the engines loop, its stub policy and its position-only `recordedVerify` are superseded by the rules
above (that paragraph is not edited). **The serve process:** `worktree.ts`, `closeout.ts` and `cli.ts` run in serve, so the
operator stops the supervisor before `apps/supervisor` is built and restarts it through the scheduled task after the merge.
Every other field, kind and route is unchanged.

**0.1.34 (DW-51, additive).** A re-approval drops the superseded cycle's issues (TKSTUDIO-217, owner decision A). **The
verb:** `uv run track.py drop --directory ROOT --engagement ENG-NNN --issue KEY [--issue KEY …] --reason TEXT [--dry-run]`
(the agent seat) first checks, before any write, that every issue not already in a `DROPPED_STATUS_NAMES` status has a
transition reaching `DNI` (`jirabackend.DNI_STATUS`, the dropped status setup creates; no new configuration), else
`NoTransition` with nothing moved or commented; it then moves each such issue by name to `DNI` and posts one agent comment
`Dropped: <reason>` with no account mention; an issue already dropped is not moved, and gets the comment only when its newest
agent comment is not that same body (a retry after a failed comment posts it), else it is named in `skipped[]` — so a retry
never comments twice. It
answers `{ok, dry_run, engagement, issues: [{issue, transitioned, commented}], skipped[], notes[], written: []}` with the §3
status block last; refusals end `blocked` (exit 2) by name: `EngagementNotFound` (a bad id or no engagement directory),
`NoIssue` (no `--issue`), `BadIssue` (a malformed key), `ReasonMissing`, the agent seat's gaps (as `close`),
`NoTransition` (no transition reaches `DNI`) and `JiraRefused: <key>: <error>` (any other non-transient Jira error, e.g. a
404 on a deleted issue); a temporary failure is `partial`, `ok: false`, `retry: true`; it holds
`_bmad-output/engagements/<id>/track.lock` as `close` does. **The caller:** the supervisor's approve pass, on a re-approval
after `revise` cut from `origin/engagement/ENG-NNN` (the earlier PR still open) of a bound project (`jiraBound`), after the
worktree is added and before the tree is reset and the second `plansync sync` runs: the keys are `external.jira.key` from the
frontmatter at HEAD (before the reset) of the plan entities chosen by provenance — those whose `source` is `epics.md#epic-N`
or starts `epics.md#story-N.` for each `## Epic N` section of `epics.md` at HEAD whose first body line is `engagement: <ENG>`,
leaving out any key a plan entity on the default branch also carries (no merge-base diff: a second re-approval never drops
another engagement's issues the first reset pulled in), deduped and sorted, a failed read failing `append` with `DropFailed: …`;
no keys, no call — with the reason `<ENG> re-approved
after revise (approve <since>): the earlier plan this issue came from is replaced wholesale`; `complete` puts `dropped: [keys]`
on the ok `append` step's detail, a temporary failure fails `append` with `DropFailed: …` and a refusal with `DropRefused:
<reason>`, both retried at the next pass. **The serve process:** `approve.ts` runs in serve, so the operator stops the
supervisor before `apps/supervisor` is built and restarts it through the scheduled task after the merge. Every other field,
kind and route is unchanged.

**0.1.34 (DW-52, DW-53, additive).** A refused close-out is retried every pass; a `go` after an unstopped end resubmits or
re-closes (TKSTUDIO-218, owner decision ENG-B, option A). **The result:** `engage.py closeout` adds `stories_left` to its
result — the keys, deduplicated in first-seen order, of every story it judges `story <key> not landed` (each proposed story of
a queued epic whose landed entry is missing or not `spec_status: done`, under the key that verdict shows; with no proposed
stories, each landed entry not `done`), `[]` when every story landed; a PR not merged alone leaves it empty. The record's
`closeout` merge is unchanged. The supervisor copies it onto the ok `engagement-closeout` event as `stories_left` (an array of
strings, else `[]`), and onto the `run-ended` line's detail, whence the transient-close retry (no lib run) takes the event's. **The retry:** done for a last run is an ok `engagement-closeout` event naming its `run_id` with no `go`
line in the record at or after it while the record sits in `in-progress` (in `partial`, as after a `go` the run pass re-capped, any ok event counts); an `ok: false` event never counts, so the closeout pass calls `engage.py closeout` again at
every pass while the lib refuses by name, writing the `ok: false` event and one notice only when the refusal's `reason`
differs from the newest `ok: false` event for that run with no ok event after it (none yet counts as different); the same
reason again writes no event and sends no notice. **The `go` rule:** a `go` after an unstopped end (the record `in-progress`,
the newest link of this cycle terminal, no ok stop and no `after_run` naming it, an ok close-out event for it and a `go` line
after that event, under the cap): when its `stories_left`, filtered to the job's epic (a key starting `N-` for a job name
ending in the digits `N`, any key otherwise; a missing or non-array field counts as none), is not empty, the run pass's step 7
resubmits the job exactly as for a stopped run (the same submit, `base_ref`, payload and `engagement-run-queued` with
`after_run`) and the closeout pass never re-closes the run; else step 7 resubmits nothing and the same tick's closeout pass
composes, runs `engage.py closeout`, applies `run-ended` from `in-progress` and tells again (a new ok event for the same
`run_id`). The transient-close path and the `run-ended` once guard count only a `run-ended` line newer than the newest `go`
line. **The serve process:** `approve.ts` and `delivery.ts` run in serve, so the operator stops the supervisor before
`apps/supervisor` is built and restarts it through the scheduled task after the merge. No state-table row, route or version
changes; every other field, kind and route is unchanged.

**0.1.34 (DW-27, DW-128, DW-129, clarification).** `finish` emits its event exactly once, is single-writer, and the starter
lock folds case on macOS (TKSTUDIO-222). A terminal `finish` whose summary write raises still emits its one `job-run` event
before the error propagates to the caller (DW-128, AD-12), so no terminal run is left without its event. `finish` is
single-writer: a concurrent finish on one run is not supported (DW-129, TKSTUDIO-222 A) — its pre-check and the run update
are not atomic, so two racing calls can both emit; the owner accepted this with no lock. The starter lock's matching folds
case on Windows and on macOS, to match the supervisor's `foldCase` (DW-27): a mixed-case macOS root now matches a live lock.
No verb, field, route or version changes.

**0.1.34 (DW-184, DW-195, additive).** The host leg's lease carries its deadline; a hand `bun test` refuses beside a live
leg (hole 118). **The lease:** every `host-verify-leg` lease carrying an owner — the close-out's (`noteCloseOutLease`,
boundary and sweep tail) and the re-run's (`takeVerifyLeg`) — also records `guard_s` (the leg's guard,
`legGuard(...).seconds`) and `deadline` (ISO 8601, the lease's start plus `guard_s` seconds). **The live-leg rule:** a
live leg is a run's latest `host-verify-leg` with a non-null `owner`, no later `host-verify`, and either no `deadline` (a
lease written before DW-184: live, as before) or a `deadline` still ahead; an unparsable `deadline` reads as none, and a
lease without one is never treated as stale. A lease past its deadline is stale, so a crashed serve's lease no longer
refuses every later `tools/verify_host.py` run. `tools/verify_host.py` (`live_legs`) and `apps/supervisor/src/liveleg.ts`
read the same SQL and rule, read-only (`mode=ro`; `{ readonly: true }`); no owner pid is probed. **The test refusal:**
`apps/supervisor/test/preload.ts` refuses a `bun test` beside a live leg before any test runs, exit 2: `bun test: refused:
a host leg is live on this box: queue run <id> (by <by>, since <at>)[; …]; a hand test beside the leg slows its bounded
drives (hole 118): wait for its host-verify event (GET /runs/<id>), or set TK_VERIFY_BESIDE_LEG=1 to run anyway`, unless
`TK_VERIFY_BESIDE_LEG=1`. No queue (`TK_SUPERVISOR_DB` unset or its file absent) is no check; an unreadable one writes one
stderr note and the tests run; the leg's own run (`TK_SUPERVISOR_HOST_LEG` set) never reads it. The host leg's command env
carries `TK_VERIFY_BESIDE_LEG=1`, and `verify_host.py --beside-leg` sets it for its gates' children. **The serve
process:** `closeout.ts`, `worktree.ts`, `hostleg.ts`, `hostverify.ts` and `queue.ts` run in serve, so the operator stops
the supervisor before `apps/supervisor` is built and restarts it through the scheduled task after the merge. The refusal
and warning wording of `verify_host.py` is unchanged; no verb, route or version changes.

**0.1.34 (Story 38.6, additive).** The gate's coverage widened (AI-7; the 37 retrospective's B9, B10, A5, C7; DW-167,
DW-172, DW-173, DW-183). **The drives' roots (B9):** `e2e_windows_semantics.py` and `e2e_text_encoding.py` both scan
`plugins/tk-studio/skills/*/scripts` (every `skills/*/scripts` folder under the plugin root) and `.bmad-loop/plugins`
(under the checkout); an absent scope is a `not_run` step, `ok`. The Windows-semantics steps run `plugins/tk-studio/lib`,
`apps/supervisor/src`, `apps/supervisor/test`, `_bmad/scripts`, `tools`, `plugins/tk-studio/skills/*/scripts`,
`.bmad-loop/plugins`, `bounds`, `config verify commands`; the encoding steps run `lib`, `tools/installer`,
`plugins/tk-studio/skills/*/scripts`, `.bmad-loop/plugins`, and the vacuous `apps/*/scripts` step (0.1.31) is gone. The
nested `apps/supervisor/.bmad-loop` copy is never scanned (pinned equal to, or rendered from, the root copy). **The
verify-command step:** `config verify commands` reads every `.tk-studio/config.yaml` under the checkout (else the plugin
root; `node_modules`, `.git`, `.venv` and every dot-folder but `.tk-studio` pruned) line by line, comment lines skipped
(no YAML parse: stdlib-only); a line running `bun test` with no `--timeout N`, or `N` under
`_budget.HOST_TEST_TIMEOUT_MS`, fails naming `<rel>:<line>` and the 30 000 ms host figure; a trailing
`# win-ok: <reason>` exempts the line. `apps/supervisor/.tk-studio/config.yaml` reads `host: bun test --timeout 30000`.
**The e2e step (DW-167):** `tools/verify_host.py`'s supervisor gate runs `bun test --timeout 30000
./test/command-line.test.ts` after the per-file suites and before tsc, under `SUPERVISOR_E2E_TIMEOUT` (1800 s) with the
per-file env (`TK_STUDIO_ROOT` at the repo under verification, the seats stripped, the per-run temp folder); it prints the
per-file line, `== supervisor: test/command-line.test.ts N pass, M fail[, S skip] in Ns[ rc=N| (timed out after 1800s)]`
(37.6's named skip lines too), its timing and counts join the gate's, a red result fails the gate with its tail, and an
absent file prints `== supervisor: test/command-line.test.ts skip: e2e suite absent`. The real-submit store test runs
there: its describe defaults `TK_STUDIO_ROOT` to its own checkout and skips only without `uv`. **The skills listing
(DW-183):** `parseSkillsList` drops the `SKILL  STORE` header and takes each remaining line's first token as a store
entry (the 2026-11-06 capture gives `synced`, `tk-studio`); `skillInStore` decides in order: the store folder walk
(`<store>/<skill>/`, `<store>/<plugin>/skills/<skill>/`) is the skill check (`in_store: true`); a listing that answered
without `tk-studio` refuses, `via: "sbx skills ls"`, its text naming "the listing names no tk-studio plugin folder"; a
readable store folder whose walk lacks the skill refuses, `via: "store folder"`; a listing naming `tk-studio` with no
readable store folder is `unknown` (`the listing names the tk-studio plugin folder, not skills; no store folder at
<shown>`); neither source is `unknown`, as before. The listing never answers `true` alone; the 0.1.31 listing-lacks-skill
refusal with no readable store folder is re-pinned to `unknown` when the listing names `tk-studio` (the 2026-10-31
ruling's own re-pin clause). `sandbox.ts` runs in serve, so the operator stops the supervisor before `apps/supervisor` is
built and restarts it through the scheduled task after the merge. Every other field, kind and route is unchanged.

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

A drive's own `timeout` in the manifest overrides the runner's cap, and a drive
that runs a bun suite derives its suite's bound from that `timeout` through
`_budget.py`; `e2e_text_encoding.py` fails a text-mode open with no `encoding=`
(0.1.31, Story 36.4); `e2e_windows_semantics.py` fails the Windows classes and a
`bun test` with no `--timeout` from the 30 000 ms host figure (0.1.32, Story
37.2). From 0.1.34 (Story 38.6) both drives also scan the skills' scripts and
`.bmad-loop/plugins`, and the Windows-semantics drive also reads every
`.tk-studio/config.yaml` verify command.

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
