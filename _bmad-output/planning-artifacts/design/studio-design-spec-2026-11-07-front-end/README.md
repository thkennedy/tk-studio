# The studio front end: the owner works in the web (design addendum, 2026-11-07)

An addendum to the studio design spec of 2026-10-09 (`../studio-design-spec-2026-10-09/README.md`). It is the brief and the UX notes for Epic 39. Nothing here overrides a ruling of that spec (D1 to D10 stand); it extends §6.3 (the studio web), §6.4 (front door and chat), §6.9 (the inbox) and §7.2 to §7.4 (the office model) with what the owner asked for on 2026-11-07, and it records the choices Epic 39 makes so that the stories can cite them.

## 0. The owner's words (2026-11-07)

> "I would like to change focus a bit to build out the web UI: animated studio, agents/sub-agents as characters, user messaging system, kanban, task progress, studio chat interface, model and effort settings, etc. I want to start interacting with the studio in the way that a user normally would. This will inform many other decisions which I feel like are being created somewhat in a vacuum with no real user feedback loop. Being able to interact and resolve deferred work in Jira is nice and all but we need to put a front end on the studio so that we can start unifying inputs and outputs. Also I just want to start being able to see and interact with the studio as it works now that we've established a working base. I'd rather not have to continue to give instructions via the claude code app as my primary means of interaction."

Three asks sit in that: **see** the studio work (the office, progress, the run), **talk** to it (chat, messages, decisions, settings) without the Claude Code app, and **unify** inputs and outputs in one place so the feedback loop is real. Epic 39 is measured against those three.

## 1. What exists (the base Epic 39 stands on)

Epics 29 to 32 built, and `main` carries (file:line as of 17a6f3f2):

- **The web app** `apps/studio-web`: Vite + React + TypeScript, one PixiJS v8 canvas for the floor and the characters, React DOM for everything with text (D5), served by the supervisor at `/app` behind the session cookie (`apps/supervisor/src/web.ts:44-83`). Six screens behind a bottom-left nav: Office, Board, Status, Inbox, Issue, Chat (`src/screen.ts:8-9`, `src/App.tsx`). The screen is a `localStorage` key; there are no URLs.
- **The office** (`src/office/*`, `src/renderer/scene.ts`): one desk per registered role per project (`orchestrator, session, implementer, reviewer, consult, advisor, planner`, `apps/supervisor/src/registry.ts:18-32`), eight looping states (`offline, idle, thinking, reading, typing, running, waiting-for-human, blocked`) with `done`/`failed` overlays, a `!` bubble when the owner is needed. The states come from one table over the queue's events and the engine's journal, `OFFICE_MAP` (`apps/supervisor/src/office.ts:88-109`), streamed as `GET /office/events` (snapshot, then `office.agent|progress|run|engagement` deltas, heartbeat, `Last-Event-ID` replay).
- **The board** `GET /board?project=` (`apps/supervisor/src/board.ts`): epics → stories → latest run, PR, findings, spend against the band; the Board screen draws rows per epic with status-coloured story segments and triage columns.
- **The inbox and the issue view**: `GET /inbox?project=[&issue=KEY]` over the sync-back's `_bmad-output/tracking/inbox.json`; `POST /inbox/{key}/reply` (a reply or Done, posted with the owner's Jira seat; `apps/supervisor/src/inbox.ts`). Items are Jira issues in `Blocked - Awaiting User`; the Epic 38 decisions verb (38.4) adds the sweep's decision Tasks to it.
- **The engagement chat**: `POST /chat/{id}` queues one planner run per owner line (`apps/supervisor/src/chat.ts`), `GET /chat/{id}` reads it as JSON or an `event: chat` SSE; typed verbs over `POST /engagements/{id}/input` (`answer, go, revise, question, approve, cancel`). The Chat screen renders the stepper, question cards, the quote band, Approve with autonomy. The chat is scoped to one engagement; there is no studio-wide chat.
- **The sprite pipeline**: text pixel grids in `apps/studio-web/assets/` (a palette, the floor, the desk, two or more frames per role per state), exported byte-reproducibly by `tools/sprites/export.py` to `public/sprites/office.png` + `office.json` (D6, our own pixels).
- **Outbound notices**: one ntfy or Telegram line per terminal run and per cap or close-out (`apps/supervisor/src/hygiene.ts`, `delivery.ts`), carrying a PR or close-out URL, never a link into `/app`.
- **The data**: the plan store (`_bmad-output/planning-artifacts/plan/*.md`, canonical statuses `draft, ready, in-progress, blocked, review, done, dropped`), the queue (`runs`, `events`, `service_events`, `agents` with `model, effort, live_state, current_run, current_story`), the engine journal (`.bmad-loop/runs/<id>/journal.jsonl`: `session-start/end` by `task_id` and role `dev|review|triage`), the Stage Log table per story spec (stage, start, stop, model, tokens, cost) mirrored to Jira by `plansync.py stage-post`.
- **Model and effort** live in tk-studio routing (AD-14): `plugins/tk-studio/skills/tk-studio-launch/customize.toml` `[pipeline.legs]` (the shipped defaults), the project's `.bmad-loop/routing.toml` `[defaults]`, the resolved `.bmad-loop/routing.current.json` per leg `{model, effort, advisor}` written by `plugins/tk-studio/lib/pipeline.py`, the engine's managed block in `.bmad-loop/policy.toml` `[adapter.dev|review|triage]`, the bands in `.tk-studio/budget-bands.yaml`. `GET /agents` shows them; nothing over HTTP changes them.

## 2. What is missing, against the owner's list

| The owner's item | The gap today |
|---|---|
| Animated studio, agents and sub-agents as characters | One figure per role, pose swaps only. A session (the engine's dev, review or triage session) and the sub-agents it spawns (the Claude Code `Agent` tool) leave no signal the supervisor reads, so N parallel workers are one still figure. Nothing moves between desks. A desk cannot be clicked. The studio has no "closed" look. |
| User messaging system | Outbound: inbox items and notifier lines. Inbound: a reply on a Jira-backed item, a chat line inside one engagement, typed verbs. No message that is not a Jira issue or an engagement; no reply to a running run; no link from a notice into the page that answers it. `continue` under the `ask` autonomy is a Jira comment (DW-178, DW-48). |
| Kanban | A row board. No column-per-status view, no card, no detail of a story (its Stage Log, run, PR, Jira key, cost) in the web; the Stage Log is served by nothing. |
| Task progress | A HUD count (`done/failed/total`) and the Status screen's snapshot. No run timeline (claimed → launched → sessions → review passes → host leg → close-out), no per-stage timing and cost, no guard clock, no queue view. |
| Studio chat interface | A chat per engagement, answered by a planner run per line, the reply landing when the run ends. No chat to the studio itself (the orchestrator), no streaming, no way to say "queue 38.2", "what is running", "answer DW-87 with A" from the web. |
| Model and effort settings | Read-only in `GET /agents`. No screen, no route; the knobs are four files. |

## 3. The shape Epic 39 gives it

### 3.1 Principles (the rulings restated for this surface)

1. **The supervisor is the only writer** (D9, spec §3 :88). Every change the web makes is a request to the supervisor, which runs the studio's own verb on the host (`plansync.py`, `pipeline.py`, `track.py`, `engage.py`) and records a service event. The web never edits a file; the page re-reads after the verb returns.
2. **One origin, one account, one cookie** (D7, §8). New routes sit beside the existing ones in `apps/supervisor/src/api.ts`, cookie + CSRF for the owner's browser, bearer for tools; the contract grows additively (0.1.35).
3. **The office is a projection, not a second truth** (§7.3). New signals (sessions, sub-agents, the studio's open/closed state) enter through `OFFICE_MAP`'s inputs: queue events and the engine journal. A character is drawn from an event; no character is drawn from a timer.
4. **The chat routes like the terminal does** (AD-11). The studio chat is the `tk-studio-orchestrator` core run headless by a one-shot job; the web is its presentation. The same words produce the same routing in a terminal and in the page.
5. **Routing owns model and effort** (AD-14). The settings screen edits the project's routing through `pipeline.py` and shows the resolved route; it never writes `policy.toml` itself.
6. **Our own pixels** (D6). New characters and states extend the text-grid sheet; no third-party sprite pack.
7. **Every pending state says what it is waiting for** (the owner's 2026-11-05 rule: no bare "—"; "Loading…", "Waiting for the planner's reply (about a minute)", "The studio is closed").

### 3.2 The owner's day (the flows this epic serves)

- **F-A, a glance.** Open `/app` on the desktop or the iPad: the office shows who is at work right now (one character per live session, the sub-agents beside it), the current story and stage in the HUD, the run's clock against its guard, a `!` if anyone waits on the owner. One click on a character opens what it is doing (its last events, its cost so far).
- **F-B, a decision.** A notice arrives (ntfy or Telegram) with a link. The link opens the one page that answers it: an inbox item with its options, a check-in with what there is to evaluate and continue / stop, a question card in a chat. Answer there. Jira receives the same answer as the record, not as the channel.
- **F-C, a conversation.** Open the chat, type "queue 38.2 after the docs PR lands" or "what did 38.1 cost" or "answer DW-87 with A" or "plan an epic for X". The orchestrator answers in the page, streaming, and where an action follows it proposes it as a button (queue, answer, start an engagement, open a page). Nothing runs without the press.
- **F-D, the board.** Open the kanban: columns per status, cards per story with the epic, band, Jira key, PR, cost and the current stage; a card opens the story: its plan text, its Stage Log, its runs, its PR and findings. A card dragged from `draft` to `ready` is a status request the supervisor applies through `plansync`; every other column is written by the loop.
- **F-E, the settings.** Open Settings: the legs with their model and effort, the bands with their estimates and caps, the default autonomy and the per-band follow-up cap (38.7). Change a model; the page shows the resolved route the next run will take and the service event that recorded it.
- **F-F, closing time.** Say "stop after this story" in the chat or press Stop on a check-in: the studio finishes the running story, the office empties desk by desk, the lights go off, the notifier says so (DW-178 (3)). Say "open up" and the office lights come back with the first claim.

### 3.3 Information architecture

Routes under `/app` (the SPA fallback already serves them; the app gains a router):

| Route | Screen |
|---|---|
| `/app` → `/app/office` | the office (home) |
| `/app/office/<project>` | the office of one project |
| `/app/board/<project>` | the kanban |
| `/app/story/<ST-id>` | a story: plan text, Stage Log, runs, PR, findings |
| `/app/run/<run-id>` | a run's timeline |
| `/app/inbox`, `/app/inbox/<KEY>` | the inbox and one item |
| `/app/chat` | the studio chat |
| `/app/chat/<engagement-id>` | an engagement's chat (today's Chat screen) |
| `/app/checkin/<engagement-id>/<n>` | a check-in: what there is to evaluate, continue / stop |
| `/app/status` | status and the queue |
| `/app/settings` | model, effort, bands, autonomy |

Every notice the studio sends (an inbox block, a check-in, a run's end, a cap) carries the one route that answers it. The page is reachable on the tailnet only (D10).

### 3.4 The office model: sessions and sub-agents as characters

Today a role has one figure at one desk. Epic 39 adds the **session** as a thing with a character:

- A session is an engine session (`session-start` in the journal, role `dev|review|triage`) or the supervisor's own host-side legs (the launch verb, the host-verify leg, the close-out) — each a `session` row in the office snapshot: `{id, role, kind, started_at, state, story, run_id, cost_usd}`. A session's character sits at its role's desk; a second concurrent session of the same role sits at a second chair.
- A **sub-agent** is a Claude Code sub-agent spawned by a session's `Agent` tool. The sandbox session's hook plugin (`.bmad-loop/plugins/studio-pipeline`, which already runs `meter_hook.py`) gains a `SubagentStart`/`SubagentStop` hook that appends one line per sub-agent to the run's journal-side file (`.bmad-loop/runs/<id>/agents.jsonl`: `{at, session, agent_id, description, event}`), which the office projection reads as it reads the journal. A sub-agent is a smaller character beside its parent's desk, present from start to stop; its description is its name tag.
- States stay the eight of §7.3; a session's state comes from its latest tool activity where the hook reports it (`PreToolUse` kind → `reading` for Read/Grep/Glob, `typing` for Edit/Write, `running` for Bash/tests, `thinking` otherwise), demoted by the grace timer as today. The hook writes nothing a secret could be in: tool names only, never arguments.
- **Click** a desk or a character: a side panel with the last twenty events of that session or role, the story and stage, the cost so far, and a link to the run's timeline.
- **The studio's open/closed state** is a queue-level fact (`service_events` `studio-open`/`studio-closed`, set by the stop flow in 39.6): closed, the office draws no one, the lights are off, the HUD says "The studio is closed since <time>; open it from the chat".
- Movement: a character walks between its desk and the door on start and stop (a short tween, the only motion not driven by a state change); everything else stays a pose. Movement is presentation and can be turned off in Settings.

### 3.5 The message model: one inbox, two directions

An **item** in the inbox is anything that waits on the owner or informs them, in one list sorted by "needs you" then time:

| Kind | Source | The owner can | Where the answer goes |
|---|---|---|---|
| `decision` | a Jira Task in `Blocked - Awaiting User` (the sweep's, 38.4; the operator's) | pick an option, write a note | the Jira comment and `Block Resolved` (today's path), then the decisions verb |
| `question` | an engagement's questions (32.3) | answer the cards | `POST /engagements/{id}/input answer` |
| `checkin` | a reached check-in point (3.6) | continue / stop, a note | the engagement record; stop closes the studio |
| `notice` | a run's end, a cap, a close-out, a pause | open the run or PR, dismiss | nothing (read) |
| `message` | the owner's own line to the studio chat and its reply | continue in the chat | the chat |

Outbound: every item that needs the owner also goes out as the notifier line with the item's route (3.3). Inbound: every answer is a request to the supervisor that runs the owning verb; Jira is written as the record where an issue exists.

### 3.6 The check-in model (DW-178)

At approval the owner and the planner agree the **check-in points** of an engagement: a list in the engagement record, each `{kind: milestone|budget|proof, when: <story key | usd | proof name>, what_to_show}`; the default proposal is one check-in at the first landed story, one at half the quote band, one at the end. A reached check-in pauses the engagement's queueing after the running story, sends the `checkin` item with `what_to_show` rendered (the PR, the board slice, the proof's record, the spend) and the route `/app/checkin/<id>/<n>`. **Continue** resumes; **Stop** ends the engagement visibly (3.4's closed state, the notifier line "stopped at check-in n by the owner"). The Jira comment `continue` stays as the fallback only. DW-48's Jira-less pause falls out of this.

### 3.7 Settings (the scope, and its edge)

In scope: per leg model and effort (the project's `routing.toml` `[defaults]` through `pipeline.py`), the bands' estimates and caps (`budget-bands.yaml`), the default autonomy at approval, the per-band follow-up-review cap (38.7's `[limits.by_band]`), the presentation toggles (movement, sound off by default, HUD detail). Out of scope: secrets, the supervisor's own environment, the per-job placement (`TK_SUPERVISOR_CONFIG`), the shipped defaults in `customize.toml`. A write shows the resolved `routing.current.json` and the service event; a write while a run is live applies to the next run and the page says so.

### 3.8 The studio chat

`/app/chat` is a conversation with the studio, not with an engagement. One owner line queues one `studio-chat` run (a shipped one-shot job in the mould of `engagement-chat`: planner tier, host, `claude -p` with the plugin, the `tk-studio-orchestrator` core resolving the owner's role and working set, the council shell loaded as presentation), whose reply streams to the page over the existing chat SSE as it is produced. The reply carries `proposals[]` as today: `queue <job>`, `answer <id>: <letter>`, `open <route>`, `start an engagement`, `stop after this story`, `open the studio`; a pressed proposal is the typed request the supervisor already knows how to run. Lines and replies are kept in `_bmad-output/tracking/studio-chat.jsonl` (the record) and shown as `message` items in the inbox. The chat answers questions about state from the same reads the pages use (the board, the runs, the ledger), so "what is running" costs a read, not a plan.

## 4. Choices made here (for the owner's review)

1. **Sessions and sub-agents are characters; roles keep their desks.** The registry stays per role (AD-14's routing table); people come and go at the desks. The alternative (a row per session in the registry) was rejected as a second truth.
2. **Sub-agent visibility comes from the session's own hooks**, not from parsing transcripts after the fact: it is live, it is cheap, and the hook plugin already exists. It reports tool names only.
3. **The kanban writes one transition** (`draft → ready`) and reads the rest; the loop owns every other status. More writes come when the owner asks for them in the page.
4. **The studio chat is the orchestrator**, so the terminal and the page cannot drift (AD-11). Streaming is of the reply text; the routing decision is made once at the start of the run.
5. **The phone is a responsive pass of the text screens** (inbox, chat, check-in, status), not the separate phone UI the spec deferred (D5): the owner is away from the desk most of the day and the notifier's links must open on a phone. The office stays desktop and iPad.
6. **Notices link into `/app`** from this epic on; Jira remains the record and the fallback channel, never the primary one.

## 5. Open questions for the owner (asked through the plan PR, not blocking)

- Q1 The characters' look: keep the role sheet's figures and add the session and sub-agent variants in the same style, or redraw the cast once (an attended pixel-art session, our own pixels either way)?
- Q2 The chat's voice: the council shell (persona seats) or a plain studio voice? The default here is plain, with the council available when asked for.
- Q3 Sound: off by default; is a single "needs you" chime wanted?
- Q4 The check-in defaults (first landed story, half the band, the end): right for the first engagement?

## 6. Not in this epic

A public mode (D10), a second account, voice, a separate native phone app, editing plan text in the web, the nightly hygiene pass (DW-179), the game asset pipeline, any change to the engine's own loop. The follow-up-review entries and the owner's open Tasks (TKSTUDIO-233 to 236) are not this epic's.
