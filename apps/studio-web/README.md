# studio-web

The studio web (design spec §6.3, D5): Vite plus React plus TypeScript, built to static files in
`dist/`, one PixiJS v8 canvas for the floor and the characters and React DOM for everything with
text in it. A nested studio project of the one repository, like `apps/supervisor`
(`.tk-studio/config.yaml`, `project_id: studio-web`).

## What is here now: the renderer spike (Story 30.1)

The page draws a floor of 16-pixel tiles and one character from the office sheet
`public/sprites/office.png` at an integer zoom, crisp at device pixel ratio 1, 2 and 3, with a
HUD showing the zoom, the ratio and the frame rate. The recipe is `pickZoom(ratio, width, height,
tile)` in `src/renderer/pickZoom.ts`; the scene builders (`createApp`, `drawFloor`,
`placeCharacter`) are in `src/renderer/scene.ts`. The record is
[`kb/studio-web-renderer-spike.md`](../../kb/studio-web-renderer-spike.md).

## The sheet (Story 30.7)

The office sheet is our own pixels (D6). Its sources are text pixel grids in `assets/` (a palette
plus one file per region: the floor, the desk and every registry role, two or more looping frames
per office state); `tools/sprites/export.py` (stdlib Python) exports them byte-reproducibly to
`public/sprites/office.png` and its Pixi v8 spritesheet atlas `public/sprites/office.json`, frame
names `floor.0`, `desk.0` and `<role>.<state>.<n>`. A `<region>.png` in `assets/` replaces that
region's `.txt` (an attended tool's export). `loadSheet` loads the atlas and `sheetFromAtlas`
builds each role's frame sets by name. The record (the tool, the format, the credits) is
[`kb/studio-web-assets.md`](../../kb/studio-web-assets.md).

## The live stream (Story 30.3)

Each tab opens exactly one `EventSource` on the supervisor's `GET /office/events` (Story 29.3) in
`src/live/stream.ts` and folds it into one client store, `src/live/store.ts`; the HUD shows
`stream live` / `connecting` / `reconnecting` with the agent and live-run counts.

- **The URL is absolute: `/office/events`.** The page carries `<base href="/app/">` (Story 30.2), so
  a relative `office/events` would resolve to `/app/office/events` and get the SPA fallback's HTML.
  No query parameter is added.
- **The store's rules.** Ids are `<boot>-<seq>` (split on the last `-`). A snapshot replaces the
  view atomically (never cleared first), rebases the last id and sets `live`. A delta
  (`office.agent`, `office.progress`, `office.run`) applies only when its boot equals the last id's
  boot and its seq is greater, so a duplicate or a stale boot is ignored; unknown kinds and
  malformed ids are ignored too. A new agent's project and role come from its `<project>/<role>`
  id; a progress for an unseen run creates the row (state unknown until its `office.run`); an
  `office.run` whose state is null or not `queued|running|paused|external` drops the run.
- **A drop** (`error` with `readyState` CONNECTING) is the browser's own retry on the same object:
  it resends `Last-Event-ID`, the supervisor replays the deltas after it, and the store ignores the
  overlap. Status is `reconnecting` until a delta or a snapshot applies.
- **The watchdog** (`WATCHDOG_MS = 15_000`, re-armed on every event) and `visibilitychange` to
  visible close the source and open a new one (the old is closed first; one open source at a
  time). A fresh `EventSource` cannot send `Last-Event-ID`, so the supervisor answers with a
  snapshot; the store keeps its view and last id until that snapshot rebases it, so nothing is
  blanked and no delta is applied twice. The HUD shows `reconnecting` until the snapshot arrives.
- **The backoff.** `error` with `readyState` CLOSED (the browser gave up: 401, 503) reopens after
  1 s, doubling to a 30 s cap, reset by a snapshot.
- **The heartbeat is a comment.** The supervisor's `: heartbeat` every 10 s is an SSE comment and
  never fires a listener, so on a quiet office the watchdog reopens every 15 s (one snapshot, a
  brief `reconnecting`). Accepted for v0.

## The Office screen (Story 30.4)

`src/office/OfficeScreen.tsx` is the page's canvas now: for the selected project, each registry
agent (`GET /agents?project=<id>`, absolute because of `<base href="/app/">`) is one character at a
desk on the PixiJS floor, labelled with its role, in registry row order. The rules are pure
functions in `src/office/model.ts` (vitest, `environment: "node"`); the canvas goes through
`src/renderer/scene.ts` only. The spike's zoom / ratio / fps / stream lines stay as debug lines in
`App.tsx`, which keeps the one store and the one stream.

- **The pose.** A desk's state is the store's agent with the same `agent_id`, else the row's
  `live_state`, else `offline`. `framesFor(sheet, role, state)` returns the role's frame set for
  that state. When the sheet carries the role but not that pose, it returns the role's `idle` set
  and warns once per gap on the console, naming `<role>.<state>` (Story 30.7); a role the sheet
  does not carry gets the shared set for the state (the first registry role's).
- **No flicker.** `placeDesks(world, sheet, agents)` adds one `AnimatedSprite` and one desk per
  agent. A state change calls `setPose(sprite, frames)`: `sprite.textures = frames; play()` on the
  same sprite, so the new set's first frame shows in the next frame. A pose change never destroys
  or re-adds a sprite and never calls `layoutScene`; a resize rebuilds the world and the desks.
- **The bubble.** `waiting-for-human` and `blocked` get a React DOM bubble over the character
  naming the projection's `reason` (contract 0.1.25); a null reason says `waiting` / `blocked`.
  Every other state has none.
- **The HUD.** `hudModel(state, project, now)`: with a live run (the one the project's agents point
  at, else its newest live row), the project, the run id and state (`pending` while the row's state
  is null), the current story and its phase, done / failed / total, the engine run id (`—` while
  null) and the time since the last applied event (`lastEventAt`, ticking every second). With no
  live run, the project's `last_run` end state and PR link (`no PR` when null), else `no run yet`.
  A failed `/agents` read is named in the HUD and the floor stays empty.
- **The switcher.** The projects are the distinct projects of `GET /agents`; the choice is stored
  in `localStorage` (`tk-studio.office.project`) and restored when still listed, else the first
  project. A storage that throws keeps the choice in memory only.

## The Board screen (Story 30.5)

`src/board/BoardScreen.tsx` is the second screen: a minimal Office / Board switch in `App.tsx` (bottom left)
mounts one screen at a time, both fed by the one store and the one stream (30.6 adds the remembered screen, the
Status screen and the home, below). The board reads only the supervisor's `GET /board?project=<id>` (absolute, because of `<base
href="/app/">`; contract 0.1.25), plus the `/agents` project list the Office already reads; the project choice is
the Office's (`tk-studio.office.project`). The rules are pure functions in `src/board/model.ts` (vitest).

- **The rows.** One row per epic: a phased bar whose segments are its stories in key order, each coloured by its
  canonical status (`draft`, `ready`, `in-progress`, `blocked`, `review`, `done`, `dropped`; an unknown status
  reads as `draft`), linking the story's latest run's PR; the open findings count (it drains as entries close);
  and the spend bar filled against the epic's band (`$spend / $band`, red when over). A `null` band shows the
  spend alone, with no fill.
- **The columns.** Needs you, Working, Done, straight from the answer's `triage`: each item names its run, state
  and story, links its PR and names the ruling it waits for (`waits for: <reason>`) when there is one.
- **Links.** A PR is a link only when it is `http(s)://` (`safeHref`); anything else is no link.
- **The read.** `fetchBoard` never throws: a non-200 (naming the supervisor's `error`), a network error or a
  malformed body (no `plan` object, an epic with no `stories` array, a story with no `findings` array, a triage
  column that is not an array) is `{ok:false, error}`, shown on the screen. The board is fetched on a project change, again
  whenever the selected project's runs or `last_run` change in the store (an `office.run` or `office.progress`
  delta, `refetchKey`; another project's delta does not refetch), and when the window regains focus or the page
  becomes visible again (a closed finding, a plan edit, new spend or a new local day send no delta), never on a timer.
  The `/agents` project list is read on mount and again on each such wake while no project is chosen (a failed
  read, or no project served yet).
- **No plan.** A project with no plan directory shows the answer's `plan.reason` and the columns.

## The Status screen and the home (Story 30.6)

The web is the home: a signed-in `GET /` on the supervisor answers this web's `index.html` (as `GET /app` does; the
absolute `/app/` asset base and the `<base href="/app/">` make it load from `/`). Until the web is built, `GET /`
answers the supervisor's read-only status page with its "not built" note. Build it with
`cd apps/studio-web && bun install --frozen-lockfile && bun run build` (the supervisor's `WEB_BUILD_COMMAND`).

- **The remembered screen** (replaced by the addresses, Story 39.1, below: the key is migrated once and no longer written). `src/screen.ts`: the switch in `App.tsx` is Office / Board / Status, and the screen
  shown is stored per browser under `tk-studio.web.screen` (`rememberedScreen` / `rememberScreen`, the storage
  injectable as `rememberedProject`'s is). Absent, unknown or a storage that throws: Office. One screen is mounted at
  a time, so the Office canvas (the one Pixi Application) exists only on the Office screen, and the one stream stays
  open across the switch.
- **The Status screen.** `src/status/StatusScreen.tsx` renders `statusView` (`src/status/model.ts`, pure, vitest)
  from the one store: the queue's per-state counts and the supervisor's version (the snapshot's `supervisor
  {version, counts}`), the live runs (`state !== null && LIVE_RUN_STATES.has(state)`), the agents with their state
  and reason, the office section (each live run's epic progress and stories, each project's `last_run`, the
  `problems`), and the ledger's last lines or its note (the snapshot's `ledger`, redacted by the supervisor). It
  re-renders on a store change and never polls on a timer: the extras ride the snapshot only (contract 0.1.25), so they
  refresh with the next snapshot (the stream's 15 s watchdog reopen on a quiet office), while the live runs follow every
  delta. Story 39.5: the Queue section also reads `GET /status` (JSON) and each live run's `GET /runs/{id}`, only when
  the store's live runs change (below); its 1 s tick moves the clocks and reads nothing.
- **The read-only page.** The Status screen links `/status` (absolute, because of `<base href="/app/">`): opened in
  the browser it is the supervisor's server-rendered page, which works without JavaScript. `/status` without
  `Accept: text/html` still answers the JSON the bearer API always has.

## The Chat screen (Story 32.7)

The engagement conversation (design spec §6.3 Chat, F2): intake, questions, scope, quote and approval from the
desktop or the iPad, without a terminal. The switch gains Chat (`src/screen.ts`); the rules are pure functions in
`src/chat/model.ts` (vitest, `environment: "node"`, against `src/chat/fixture.ts`), the composition is
`src/chat/ChatScreen.tsx`, the live transcript `src/chat/stream.ts`.

- **What it reads and sends.** `GET /engagements?project=`, `GET /engagements/{id}?project=`, `GET /chat/{id}?project=`
  and `GET /runs/{id}` (its `cost_usd`, contract 0.1.27); it posts `POST /engagements` (the New engagement form),
  `POST /chat/{id}` (the message box) and `POST /engagements/{id}/input` (each typed input). Every engagement read and
  post carries `?project=<id>` (a repeated id is 409 AmbiguousEngagement without it). Every post carries the CSRF token
  the project's `GET /inbox?project=<id>` answered (read again when the project changes), as the Issue screen's reply
  does; with no token every send is disabled. Fetches and posts never throw; a refusal is shown by its error name
  (409 IllegalInput names the state and the verb, 503 ChatBusy is retryable with the text kept, 500
  ChatJobUnresolved / ChatQueueFailed say no line was kept).
- **The open engagement.** The state as a stepper (`intake → awaiting-answers → scoping → quoted → approved →
  in-progress → delivered`; a side exit `paused`, `partial`, `failed` or `cancelled` marked against the step it left,
  read from the newest `inputs[]` line entering it, else the closest main step); the transcript with owner and planner
  lines (the planner's run cost read per `run_id` on hover or focus, one read in flight per run, a metered cost
  cached; `not metered` when null, and a null or a failed read is read again on the next hover or focus); the question cards with their options and the default pre-selected (Answer sends `answer`); the scope page's
  link and a Revise box (`revise`); the quote as the band (50/85/95 as dollars and share of the weekly window, the
  cap, the autonomy levels) with Approve and the autonomy choice (`approve {autonomy, base_ref?}`); Go (with a
  positive cap in `partial`), Ask (`question`) and Cancel. `ACTIONS` mirrors the supervisor's `TRANSITIONS` verb
  cells: a control outside its state's cell is never rendered, and a planner proposal outside it is a disabled button
  naming the state; a proposal sends exactly `{verb, ...payload}`. `approved` reads "approved; the run starts when the
  plan PR merges" (no PR link: the record carries none); `paused` says to reply `continue` on the engagement's Jira
  issue (there is no web verb for it).
- **Live.** The chat stream (`event: chat`, one line per seq, a duplicate seq ignored) has the office stream's
  watchdog: 15 s of silence or `visibilitychange` to visible reopens it after the last seq, and a browser that gives
  up is retried after a 1–30 s backoff. The record and the list refetch on focus and on visibility, and when the office
  store's rows for the project change (an id or a state; the open engagement's state for the record), never on a
  timer. A record read started before a post's applied record is dropped.
- **The nav count.** The office store keeps the snapshot's `engagements[]` and the `office.engagement` deltas (keyed by
  project and id, `state: null` removes the row); the Chat nav item counts the rows in `awaiting-answers` or `quoted`
  across projects (none: no count). The open engagement is remembered per browser under `tk-studio.web.chat` as
  `{project, id}`.

## The studio chat (Story 39.3)

`/app/chat` is a conversation with the studio itself (addendum §3.8, F-C), not with an engagement: the engagement
chats stay at `/app/chat/<id>` (the Chat screen above). `src/App.tsx` mounts `src/chat/StudioChatScreen.tsx` for the
route `chat` (in place of 39.1's "Not built yet: Story 39.3" strip, so `PLACEHOLDER` no longer lists `chat`) and
`ChatScreen` for the route `engagement`. The rules are the `// the studio chat (Story 39.3)` section of
`src/chat/model.ts` (vitest, `environment: "node"`); the stream is `src/chat/stream.ts` without an `id`.

- **What it reads and sends.** A served project (`GET /agents`, the remembered office project), its CSRF token (`GET
  /inbox?project=`; with none, Send and every press are disabled), the lines (`GET /chat?project=`, then the stream
  `GET /chat?project=&since=<last seq>`). Send posts `POST /chat {project, text}`: the text is at most 4,000
  characters (code points), its count shown past 3,500; a `400 LineTooLong` is shown by name and the text is kept. The
  answer's `note` ("Queued behind the reply to '…'") is shown under the line. One line "Engagement chats:" links each
  of the project's engagements (`GET /engagements?project=`) to `/app/chat/<id>`.
- **The conversation.** The owner's lines, the planner's replies (a failure reply in red), the press lines `pressed:
  <label>`, the streaming reply ending in a cursor `▍` until its reply lands, and the pending label: position 1
  "Waiting for the planner's reply (about a minute)", position n ≥ 2 "… — queued behind the reply to '<excerpt>'
  (position <n>)", the excerpt the previous pending line's body with whitespace collapsed, cut at 40 code points with
  `…` (`excerpt`, the supervisor's fixtures).
- **The stream.** `event: chat` lines as the engagement chat's, plus `event: chat-delta` `{run_id, reply_to, from,
  text}` (no `id:`; a malformed delta ignored). `applyDelta` is `text.slice(0, from) + delta.text` while `from` is
  within the text (in order, an overlap, from 0 after a reconnect); a `from` past the end is ignored. The record is
  authoritative: a reply with `reply_to` R drops R's streaming text, and a later delta for R is dropped.
- **The proposals.** Each proposal is a button (`proposalAction`): `queue` → `POST /jobs {project, job, proposal:
  {chat, seq, index}}` with the CSRF token (the cookie is admitted only for a recorded matching proposal); `answer` →
  `POST /inbox/{issue}/reply {project, body}` with the body `<id>: <letter>` and the note on its own line when it is
  not blank; `open` → the router's navigation to its `/app` route; `engagement` → `POST /engagements?project=`
  `{project, request: title}`. On a 2xx (for `open`, before navigating) the screen posts `POST /chat {project,
  pressed: {seq, index}}` and the supervisor records the press line; a pressed proposal renders disabled ("Pressed").
  `stop-after-story` and `open-studio` render disabled, "Not built yet: Story 39.7".

## The addresses (Story 39.1)

The web has URLs under `/app` (addendum §3.3), served by the supervisor's single-page fallback. `src/screen.ts` is the
route module, pure and vitest-driven: `parseRoute(pathname, search)`, `routePath(route)` and a hand-rolled router over
the History API (`createRouter(win)`, the browser's `window` or a fake; no router package, so `bun.lock` is unchanged).
`App.tsx` builds one router at module level beside the one store and reads it with `useSyncExternalStore`.

| Path | Screen |
|---|---|
| `/app`, `/app/`, any path outside `/app` (`/`, `/index.html`) | replaced (`replaceState`) by `/app/office` |
| `/app/office`, `/app/office/<project>` | the Office; with no project, the remembered one replaces the address |
| `/app/board`, `/app/board/<project>` | the Board (its row view), the same project rule |
| `/app/story/<ST-id>` | `Not built yet: Story 39.4` |
| `/app/run/<run-id>` | `Not built yet: Story 39.5` |
| `/app/inbox` | the Inbox |
| `/app/inbox/<KEY>[?project=]` | the Issue screen; the project is `?project=`, else the open inbox row's (`Loading the inbox…` while it loads; with none, the failed inbox reads `error <project>: <msg>`, one per line, when a read failed, else `Not in the inbox: <KEY>`) |
| `/app/chat` | the studio chat (Story 39.3; until then the engagement Chat screen under the strip `Not built yet: Story 39.3`) |
| `/app/chat/<engagement-id>[?project=]` | the Chat screen opened on it; the project is `?project=`, else the store's single project for the id, else (once the store's snapshot is in; before it, no project: the screen waits) the remembered chat project |
| `/app/checkin/<engagement-id>/<n>[?project=]` (`n` ≥ 1) | `Not built yet: Story 39.7` |
| `/app/status` | the Status screen |
| `/app/settings` | the Settings screen: the Sandbox login card first, then `Model and effort: Not built yet: Story 39.8` |
| anything else under `/app` | `No page at <path>` |

- **The rules.** Segments are `decodeURIComponent`-decoded (a bad escape is not found); trailing slashes are dropped;
  `routePath` encodes each segment and appends `?project=<id>` when the route carries one.
- **The nav** is Office, Board, Status, Inbox (its count), Chat (its count), Settings; each pushes its path, and the
  button for the current address is disabled. Issue leaves the nav: an issue is `/app/inbox/<KEY>`. Back and forward
  (`popstate`) switch screens. A project chosen in the Office or the Board pushes its address; picking an engagement in
  the Chat pushes `/app/chat/<id>?project=<p>`; an Inbox row pushes `/app/inbox/<KEY>?project=<p>`.
- **The migration.** At load, `migrateRemembered` reads `tk-studio.web.screen` and `tk-studio.web.issue` once, removes
  both and carries the screen (`issue` with a stored issue: `/app/inbox/<KEY>?project=<p>`) onto the landing only — a
  deep link wins. Nothing writes either key again. `tk-studio.office.project` and `tk-studio.web.chat` are kept.

## The Settings screen: the sandbox login card (Story 39.2)

`/app/settings` mounts `src/settings/SettingsScreen.tsx` in place of 39.1's placeholder: the Sandbox login card first,
then `Model and effort: Not built yet: Story 39.8` (`PLACEHOLDER.settings` now names 39.8's part). The card's rules are
`src/settings/login.ts` (pure, vitest-driven in `login.test.ts`); its React is `src/settings/LoginCard.tsx`.

- **The clock.** The card reads `GET /sandbox/login` (the default sandbox: the one configured) and `GET /status` when
  shown, every minute while open (`POLL_MS`), and once more after a renewal. Its line: `Checking the login…` while
  reading; `Login valid for N days (until <date and time, local>)` when `ok`; amber `Renew soon: N days left` (`1 day
  left`, `less than a day left`) when `expiring`; red `Expired: every run on the sandbox waits for a renewal` when
  `expired`; for `unknown` the reason in words (`The sandbox is stopped: the login is read while it runs`, with the last
  read when one is known, else `Login not read: <reason>`); a failed read `Login not read: <url> answered <status> <error>`.
- **Renew** is disabled with its reason shown: no CSRF token yet (`Waiting for the page's session`), a live run in
  `running`, `paused` or `external` on the sandbox (`A run holds the sandbox (run <id>, <state>): Renew opens when it
  ends`), this card's own sign-in still open (`A sign-in is open: paste its code, or wait until <time>`, until its
  `expires_at`), a renewal started elsewhere (`A renewal is in progress elsewhere until <time>`, learnt from the start's
  `LoginInProgress`), the sandbox stopped, or a request in flight (`Working…`). Only the closing answers to the code
  clear the open login (its link and its field): `200`, `CodeRefused` with `tries_left` 0, `LoginExpired`,
  `LoginFailed`, `SandboxStopped`, `UnknownLogin` and `LoginClosed`. A network failure or any other error keeps the link and the field.
- **The two steps.** Renew → `POST /sandbox/login/start` → the `Open sign-in` link (a new tab, `noopener noreferrer`:
  approve on whichever device holds the claude.ai session), the field `Paste the code claude.ai shows after you approve`
  and Send (disabled while blank) → `POST /sandbox/login/code`. Both POSTs carry `X-CSRF-Token` and the session cookie.
  The result line is `Renewed: valid until <date>` or the refusal in words (`CodeRefused` with a new sign-in swaps the
  link; an incomplete code keeps it; a second refusal, `LoginExpired` or a closed login asks for Renew again).
- **Nothing kept.** The sign-in URL and the code live in the component's state only: never `localStorage`, never a
  console line.

## The kanban and the story (Story 39.4)

`/app/board/<project>` opens on the kanban (addendum §3.1.7); `?view=rows` is the row view and triage above,
unchanged. The toggles (`?view=`, `?epic=<EP-id>|all`) keep the address project and navigate with `replace`. The rules
are the `// Story 39.4: the kanban` section of `src/board/model.ts`; the view is `src/board/KanbanView.tsx`.

- **The columns** are the canonical seven in enum order (`Draft`, `Ready`, `In progress`, `Blocked`, `Review`, `Done`,
  `Dropped`); a story with any other status sits in Draft, showing its word. The cards show one epic: the last plan epic
  neither `done` nor `dropped` (else the last), or every epic with `?epic=all`.
- **A card** shows the `EP-NNN` badge (titled with the epic), `N.M · ST-NNN` and the title, `band M` | `no band`, the
  Jira key | `no Jira key`, `PR #N` (a link) | `no PR`, the cost (the Stage Log total) | `no cost yet`, the stage (the
  live store story's `phase` while it is `current`, `starting` with none) and `Needs you`. Every field comes from the one
  `GET /board` (0.1.35's `band`, `jira_key`, `cost_usd`, `needs_you`); there is no per-card read. A click opens
  `/app/story/<id>?project=<project>` through the router.
- **The drag** is HTML5 drag and drop (desktop, and iPadOS Safari by long-press; no dependency). While a card is held
  the strip reads "Requests plansync status ready; the loop owns every other column". `draft → ready` posts `POST
  /stories/<id>/status?project=<p> {status: "ready"}` with the CSRF token `GET /inbox` answers, then reads `Ready: <id>
  (was <previous>)` and refetches the board, or names the refusal (`StoryLeaseHeld: the loop holds <id> (run …)`, the
  column's owner, the verb's reason). The same column does nothing; any other drop is refused in the page with
  `Refused: <from> → <to>. <who writes that column>. Only draft → ready is yours.` and never posts.

`/app/story/<id>` mounts `src/story/StoryScreen.tsx` (no longer 39.1's placeholder; `PLACEHOLDER` drops `story`). It
reads `GET /stories/<id>?project=` (the project from `?project=`, else the board's remembered choice) and shows, in
order: the header (badge, key, id, title, status, band, the Jira key linking its issue, the PR), the "Needs you" strip
(the inbox item linking `/app/inbox/<KEY>`, else `run <id> waits on you` linking `/app/run/<id>`), the plan text (as
text, pre-wrapped, never HTML), the Stage Log table (stage and pass, the local start, the span or `running`, model and
effort or `host`, tokens, cost, the outcome, `posted to Jira` | `not posted`), its total line, the runs (each linking
`/app/run/<id>`) and the open findings. A pending read says "Loading the story…"; a refusal reads `<error>: <detail>`.
It refetches on mount, on focus or visibility, and when the project's runs in the store change; never on a timer. The
rules are `src/story/model.ts`, pinned by `src/story/model.test.ts`.

## The run page and the progress in view (Story 39.5)

`/app/run/<id>` mounts `src/run/RunScreen.tsx` (no longer 39.1's placeholder; `PLACEHOLDER` drops `run`). The rules are
`src/run/model.ts`, pinned by `src/run/model.test.ts`; every function is pure and takes its `now`.

- **The reads.** `GET /runs/{id}` (the run row, its queue events, `cost_usd`) on mount and whenever the store's row for
  the run changes (its state, `stage` or `leg`: `runRowKey`), never on a timer and never once the run has ended; `GET /stories/<ST id>?project=`
  when the run's latest `plan-status` event names an `ST-NNN` story (39.4's Stage Log rows). A pending page reads
  `Loading the run…`; a 404 `No run <id> in the queue`.
- **The leg** (operator ruling 2026-11-10, additive): the store's row carries `leg`, the open host-verify leg
  (`{since}` while the close-out's or a re-run's lease is held, else `null`), on the snapshot and on every
  `office.progress`. The engine's end already moves `stage` to `host verify leg`, so the lease that follows changes
  only `leg`: its `since` is in every re-read key (the run page's `runRowKey`, the Status screen's `liveSignature`, the
  office HUD's `hudRunKey`), so the page re-reads `GET /runs/{id}` on it and the clock turns to the leg's guard. There is
  no fetch timer: `leg` is the signal, the clock still comes from the run's events.
- **The page, in order:** the header (job, project, state, the story linking `/app/story/<id>`, else `no story yet`);
  the clock; the timeline; the cost; Cancel (or the ended run's final state in words, `Complete: <reason>`); the events,
  each a folded `<details>` (`<seq> · <local time> · <kind>` and ` · <from> → <to>` when the state moved, the detail as
  JSON).
- **The timeline** (`runTimeline`): queued (`waiting for the checkout lock` after a `lock-wait`), launch (or `worker`
  with no `launched` at all), engine, its sessions, the host leg (or a `re-run`) with its outcome and 38.1's per-suite
  seconds as sub-cells, close-out, paused (with its reason), ended (an `ended` or an `orphaned` event: the clock and
  the cost window end there too, and an ended run's clock reads `in all` even after a lease with no `host-verify`). Before Story 39.6 the queue events carry no engine
  session boundaries: the sessions are the Stage Log rows starting inside the engine span (`dev attempt <p>`,
  `review pass <p>`, `studio gate`, `triage`), and a live run's open session is labelled by the store's `stage`.
- **The clock** (`runClock`, shared by the page, the Status queue and the office HUD): against the open host leg's own
  guard (its lease's `guard_s`, else the definition's `host_verify_seconds`), else the worker's (`worker.guard_s`, else
  `worker_guard_s`, else `max_wall_clock_seconds`, else 600), as `01:12:40 of 02:00:00` (`(over the guard)` past it);
  unguarded it reads in words (`queued (no guard until a worker starts)`, `since the claim (…)`, `paused`,
  `in close-out`, `in all, claim to end`).
- **The cost** (`costView`): per stage from the Stage Log rows inside the run's claim-to-end window
  (`Cost by stage, from the Stage Log of ST-NNN`), else the run total with the reason named, else `Not metered yet`;
  `Loading the Stage Log…` while the story read is pending (a run with no project never reads it: the run total).
- **Cancel** names its consequence first (`Cancel…` reveals the sentence and `Cancel run <id>`), then posts
  `POST /runs/{id}/cancel` with the CSRF token `GET /inbox?project=` answers (`requestCancel`, shared with the Status
  queue: no project, a failed inbox read or no token posts nothing and says why); every answer reads in words
  (`Cancelled.`, `Already ended: <state>`, the external run's words, `reload the page`, not found).

The Status screen's **Queue** section (`queueRows`, `src/status/model.ts`) precedes the counts: every live run of
`GET /status`, grouped queued, claimed (a running run with neither worker nor engine), running, paused, then external,
by `created` within a group; each row links `/app/run/<id>` and shows its job, its story (`no story yet`), its start and
its clock (`Loading the start…` / `Loading the clock…` until its `GET /runs/{id}` is read; a failed re-read keeps the
last answer, a run never read names the failure), Cancel, a refused claim's
reason, and for a paused run `Paused: <reason>` with the inbox item (`/app/inbox/<KEY>`) that resolves it. The old
"Live runs" list is the queue now.

The office HUD shows the run's `stage` (`office.progress.stage`, contract 0.1.35), its clock and a phased bar
(`phasedBar`, `src/office/model.ts`): the epic is the project bar (`done / total`), its stories the phases (done,
deferred and failed full and coloured apart, the current one half, the rest empty, padded to `total`), and the epic's
open findings from `GET /board` a count to drain (`Loading the findings…` while pending). The board is re-read on a
project change and when the run's `epic.done` or `stage` changes, the run's `GET /runs/{id}` when the live run, its
state, stage or `leg` changes (`hudRunKey`, `runRowKey` on the live row); a failed read names itself
(`The clock could not be read: …`).
Every HUD value is held at least 1 s (`hold`, `HOLD_MS`; the clock's mode, guard and elapsed seconds as one value, so a
guard hand-over changes them together; each phase by its position, so a story replacing a placeholder lerps) and the clock and the bars lerp over 0.5 s (`tween`,
`valueAt`, `LERP_MS`; `hudMotion` applies both); the screen's `now` runs on `requestAnimationFrame` while a tween is in
flight and on the 1 s timer otherwise. `src/office/model.test.ts` pins the hold.

## Commands (from `apps/studio-web`)

```bash
bun install --frozen-lockfile   # dependencies from the committed bun.lock
bun run dev                     # the page on Vite's dev server (open it on the desktop and the iPad)
bun run build                   # static files to dist/ (ignored, never committed)
bun run test                    # vitest
bun run verify                  # frozen install, build, then test: the project's verify.host
bun run sprites                 # export assets/ to public/sprites/office.png + office.json (same bytes each run; needs uv)
```

From the repository root, `uv run python tools/verify_host.py` runs `bun run verify` here when
`apps/studio-web` changed since the merge base with `main`.
