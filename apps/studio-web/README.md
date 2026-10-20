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

- **The remembered screen.** `src/screen.ts`: the switch in `App.tsx` is Office / Board / Status, and the screen
  shown is stored per browser under `tk-studio.web.screen` (`rememberedScreen` / `rememberScreen`, the storage
  injectable as `rememberedProject`'s is). Absent, unknown or a storage that throws: Office. One screen is mounted at
  a time, so the Office canvas (the one Pixi Application) exists only on the Office screen, and the one stream stays
  open across the switch.
- **The Status screen.** `src/status/StatusScreen.tsx` renders `statusView` (`src/status/model.ts`, pure, vitest)
  from the one store: the queue's per-state counts and the supervisor's version (the snapshot's `supervisor
  {version, counts}`), the live runs (`state !== null && LIVE_RUN_STATES.has(state)`), the agents with their state
  and reason, the office section (each live run's epic progress and stories, each project's `last_run`, the
  `problems`), and the ledger's last lines or its note (the snapshot's `ledger`, redacted by the supervisor). It
  re-renders on a store change and never polls: the extras ride the snapshot only (contract 0.1.25), so they refresh
  with the next snapshot (the stream's 15 s watchdog reopen on a quiet office), while the live runs follow every
  delta.
- **The read-only page.** The Status screen links `/status` (absolute, because of `<base href="/app/">`): opened in
  the browser it is the supervisor's server-rendered page, which works without JavaScript. `/status` without
  `Accept: text/html` still answers the JSON the bearer API always has.

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
