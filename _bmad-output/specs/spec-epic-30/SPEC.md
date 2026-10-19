---
id: SPEC-epic-30
companions:
  - ../../planning-artifacts/design/studio-design-spec-2026-10-09/README.md
  - ../../planning-artifacts/design/studio-design-spec-2026-10-09/decisions.md
  - ../../planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md
  - ../../../plugins/tk-studio/contracts/driver-contract.md
sources:
  - ../../planning-artifacts/epics.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Epic 30: Studio Web v0: Office, Board, Status

## Why

A vision plus a mandate. The design spec's §6.3 is the first front-end epic, standing on EP-29's account, registry and office projection (contract 0.1.24 §1): a Vite plus React plus TypeScript app born in `apps/studio-web` of the one repository, built to static files the supervisor serves on its own origin behind the session cookie, with one PixiJS v8 canvas for the floor and the characters and React DOM for everything with text in it (D5, ruled 2026-10-14: no Next.js; desktop and iPad first; the phone UI is EP-34). §10's risk table says a web app is new to the loop, so the renderer spike is story 1 and the epic is quoted after it lands. The assets are our own (D6): the spike draws from a placeholder sheet, the asset-authoring story replaces it. This epic ships Office, Board and Status and makes the web the home while the read-only page stays as the no-JavaScript fallback; Inbox, Issue and Chat are EP-31's and EP-32's. The supervisor surfaces it reads are the contract's §1 web surfaces, extended here only by the board's read and the read-only page's new address (AD-2: supervisor surfaces, never plugin surfaces). Repo: tk-studio (`apps/studio-web` new, `apps/supervisor`, `tools/`, `kb/`, `plugins/tk-studio/contracts/driver-contract.md`); seven stories.

## Capabilities

- **CAP-1** (30.1)
  - **intent:** The studio web exists as a buildable, testable nested studio project of the one repository.
  - **success:** `apps/studio-web` is a Vite plus React plus TypeScript project (its own `package.json`, `bun install --frozen-lockfile`, `bun run build` to `apps/studio-web/dist`, `bun run test` with vitest) and a nested studio project like `apps/supervisor` (its own `.tk-studio/config.yaml`, `verify.host` naming its build and tests); `tools/verify_host.py` runs its build and tests when `apps/studio-web` changed; nothing in `apps/supervisor` changes yet.
- **CAP-2** (30.1)
  - **intent:** The pixel-scaling recipe renders crisp tiles at the desktop's and the iPad's pixel ratios.
  - **success:** One PixiJS v8 `Application` fills its container with `resolution` from the device pixel ratio, `TextureSource.scaleMode = "nearest"`, and an integer zoom from the exported `pickZoom(ratio, width, height, tile)` so a 16-pixel tile is a whole number of device pixels at ratio 1, 2 and 3; a floor of tiles and one character sprite from the committed placeholder sheet `apps/studio-web/public/sprites/placeholder.png` (our own pixels, D6) stand on the canvas with crisp edges; a React DOM HUD over the canvas shows the zoom, the ratio and the frame rate; unit tests cover the three ratios and three container sizes.
- **CAP-3** (30.1)
  - **intent:** The spike's findings and the epic's quote are on record.
  - **success:** `kb/studio-web-renderer-spike.md` records the recipe, what each ratio showed on the desktop monitor and the iPad (the operator's attended check, named as such when not yet done), the frame cost of the canvas idle, and the quote for the rest of the epic by analogy with EP-29's per-story price; the design spec's README §6.3 gains one line pointing at the record.
- **CAP-4** (30.2)
  - **intent:** The supervisor serves the built web on its own origin behind the session cookie.
  - **success:** With `apps/studio-web/dist` beside the supervisor, a signed-in `GET /app` or any path under it is served from `dist` with the right content type, `index.html` for a path with no file (the single-page fallback), never a path outside `dist` (`..` and absolute paths answer 404), every answer carrying the session's cache headers; a request with no session answers Story 29.1's sign-in page with a return to the requested path; `GET /` keeps serving the read-only page until 30.6.
- **CAP-5** (30.2)
  - **intent:** A missing build is named, not hidden.
  - **success:** With no `dist` beside the supervisor, `GET /app` answers 503 `WebNotBuilt` naming the build command and the read-only page's header says the web is not built; `bun test` covers the directory route, the fallback, the traversal refusal and the missing build.
- **CAP-6** (30.2)
  - **intent:** The release motion and the installer carry the web as a component.
  - **success:** `tools/release_archive.py run --app studio-web --version X.Y.Z` builds `dist` from the tag, zips it, publishes and records it under the roster's `studio-web` component as the other apps are; the installer's supervisor slot unpacks it beside the supervisor; runbook §4 gains the web's row.
- **CAP-7** (30.3)
  - **intent:** Each tab holds one event stream whose store is exactly what the supervisor knows.
  - **success:** On mount a signed-in tab opens one `EventSource` on `GET /office/events`, applies `event:snapshot` first and every `office.agent`, `office.progress` and `office.run` delta after it into one client store, and reconnects with `Last-Event-ID` after a drop so no delta is lost or applied twice (an id at or below the last applied is ignored).
- **CAP-8** (30.3)
  - **intent:** The stream survives sleeps and backgrounding.
  - **success:** No event for 15 seconds, or `visibilitychange` to visible, closes and reopens the stream with the last id; the HUD shows "reconnecting" until the snapshot arrives; the store's state is never cleared in between.
- **CAP-9** (30.3)
  - **intent:** The store's rules are pinned without a browser.
  - **success:** vitest with a fake `EventSource` covers the snapshot, each delta kind, a duplicate delivery, a gap filled by a resume, and the watchdog's reopen.
- **CAP-10** (30.4)
  - **intent:** The office floor shows each agent as a character whose pose follows its semantic state.
  - **success:** Each agent of `GET /agents?project=<id>` is one character at a desk on the PixiJS floor, named by its role, whose pose is one of the eight §7.3 states (`offline`, `idle`, `thinking`, `reading`, `typing`, `running`, `waiting-for-human`, `blocked`), each a distinct looping frame set from the sheet; a state change swaps the frame set within one frame without a flicker; `waiting-for-human` and `blocked` add a React DOM bubble over the character naming the projection's reason.
- **CAP-11** (30.4)
  - **intent:** A glance at the HUD says what the studio is doing.
  - **success:** The HUD shows the project, the run id and state, the story in flight with its progress (`office.progress`: done, failed and total stories, the current story's phase), the engine run id and the time since the last event; with no live run it shows the last ended run's end state and PR link; a project switcher lists the registry's projects and remembers the choice per browser.
- **CAP-12** (30.4)
  - **intent:** The screen's rules are pinned without WebGL.
  - **success:** vitest covers the state-to-frames mapping for all eight states, the bubble rule, the HUD's fields from a fixture store and the project switcher; the canvas is driven through the renderer's exported scene functions so the tests need no WebGL.
- **CAP-13** (30.5)
  - **intent:** The supervisor serves the plan, the runs, the findings and the spend of a project as one board.
  - **success:** `GET /board?project=<id>` (a new supervisor surface, AD-2, named among the contract §1 web surfaces at 0.1.25) lists the epics with their stories and canonical statuses from the served project's plan directory (`_bmad-output/planning-artifacts/plan/`, the index and the entities), each story's latest run (state, PR, host-verify outcome) when one exists, the open deferred-work entries naming the story (the findings), and per epic the metered spend from the ledger's `job-run` events against the epic's band when `.tk-studio/budget-bands.yaml` names one; the answer is cached per plan-directory mtime and rebuilt on change; a project with no plan directory answers an empty board with the reason.
- **CAP-14** (30.5)
  - **intent:** The Board screen reads the plan, the runs and the money on one screen.
  - **success:** Epics are rows of phased bars whose segments are their stories coloured by status, the findings count drains as entries close, the spend bar sits against the band, and three columns triage every live run: Needs-you (paused, awaiting a ruling, a red host leg), Working (running), Done (ended today); each item links to the run's PR and names the ruling it waits for when there is one.
- **CAP-15** (30.5)
  - **intent:** The board is pinned on both sides.
  - **success:** `bun test` covers the board surface from a fixture plan directory and queue (statuses, findings, spend, the cache); vitest covers the rows, the columns and the links from a fixture answer.
- **CAP-16** (30.6)
  - **intent:** The web is the home and the read-only page is the fallback.
  - **success:** With the web built and a session, `GET /` answers the web's `index.html` (the Office screen opens by default; the last screen is remembered per browser) and the read-only page moves to `GET /status`, linked from the Status screen and answered without JavaScript as today; with no session, `GET /` is the sign-in page; the bearer API and every `/jobs`, `/runs`, `/agents`, `/office` and `/board` route are unchanged.
- **CAP-17** (30.6)
  - **intent:** The Status screen shows what the read-only page shows, from the surfaces the web already reads.
  - **success:** It shows the queue's counts and live runs, the agents, the office section, the ledger's last events and the supervisor's version, each from surfaces the web already reads (no new surface), and refreshes from the store rather than polling.
- **CAP-18** (30.6)
  - **intent:** The contract and the docs follow the move of the home.
  - **success:** Contract §1 names `GET /status` as the read-only page's address and `GET /board` among the web surfaces (0.1.25, additive); runbook §4 and the supervisor README say the web is the home and how to build it; the status page's tests and the conformance suite's status drive follow the new address.
- **CAP-19** (30.7)
  - **intent:** The repository owns every pixel it ships, through a documented, reproducible pipeline.
  - **success:** `apps/studio-web/assets/` holds the source files and `tools/sprites/` a script that exports the committed sheet `apps/studio-web/public/sprites/office.png` plus its JSON atlas (frame names `<role>.<state>.<n>`, 16 by 16 or 32 by 32 tiles, nearest-friendly, no anti-aliased edges); the export is reproducible (the same source gives the same bytes, checked by a test); the sheet carries the floor, one desk, and every role of the registry in every §7.3 office state with at least two frames per looping state; the art tool is the operator's choice, named in the record.
- **CAP-20** (30.7)
  - **intent:** The Office screen draws from our own sheet by name.
  - **success:** The placeholder sheet of 30.1 is deleted, the renderer's frame sets come from the atlas by name, and a missing frame for a (role, state) falls back to the role's `idle` frames with a console warning naming the gap; `kb/studio-web-assets.md` records the tool, the pipeline, the format and the credits (none owed: our own work).

## Constraints

- Rulings in force, not reopened: D5 (no Next.js; Vite plus React plus TypeScript to static files; one PixiJS v8 canvas for the floor and the characters, React DOM for everything with text; desktop and iPad first, the phone UI is EP-34), D6 (our own assets, committed; no third-party packs, no private asset fetch, no share-alike credits), D7/D8 (the one account behind the session cookie; the bearer stays for automation), D10 (tailnet default; no public mode), AD-2 (the board is a supervisor surface, never a plugin surface; the contract bump is minor and additive), AD-3, AD-11, AD-19.
- The web consumes only the supervisor's own surfaces named in contract §1 (0.1.24: the account, `GET /agents`, `GET /office`, `GET /office/events` with its three `office.*` kinds and eight states), extended by this epic with `GET /board` and the read-only page's new address `GET /status` (0.1.25); the Status screen adds no surface; nothing in the plugin's own surfaces changes.
- Same origin, no second server, no second sign-in: `dist` is served by the supervisor behind the session cookie, only from `dist` (traversal answers 404), with the session's cache headers; the read-only page stays the no-JavaScript fallback throughout and is the home until 30.6 moves it to `/status`.
- One event stream per tab with §6.3's shape: snapshot then deltas, `Last-Event-ID` resume with duplicate suppression, a watchdog at 15 s silence and on `visibilitychange` (29.3's heartbeat is 10 s), the store never cleared on reconnect.
- Order and quoting: 30.1 (the spike) lands first and its record quotes the rest of the epic by analogy with EP-29 (§10's risk: a web app is new to the loop); 30.1 changes nothing in `apps/supervisor`; 30.7 replaces the placeholder sheet and deletes it.
- Repo and gates: tk-studio, `apps/studio-web` new beside `apps/supervisor` (both nested studio projects, bun); driven by the supervisor's queue (the `run-epic-30` job, a worktree, the engine in the sandbox, `tools/verify_host.py` as the host leg) with the studio customization's verify gate (lib suite and conformance green) plus `bun test` in `apps/supervisor` and `bun run build` and `bun run test` in `apps/studio-web`; every headless surface ends with the status block (AD-11); the loop never pushes, tags or runs the release motion (30.2 and 30.6 change the release script and the docs, never cut a release).

## Non-goals

- The Inbox, Issue and Chat screens (EP-31, EP-32).
- The quote band's computation (EP-32, §7.1): the board shows spend against the band the yaml names, not the quote.
- The phone UI (EP-34).
- A public-exposure mode (D10).
- Next.js or any server rendering; a second server or a second sign-in.
- Third-party sprite packs (D6).
- `jira_account` and Atlassian (EP-31).
- Changes to the plugin's own surfaces, to onboarding, or to `tk-studio doctor`.

## Success signal

- On the box, a signed-in `GET /` opens the Office where each served project's registry agents stand as characters whose poses follow the projection's states live over one stream that survives an iPad's backgrounding; the Board reads the plan, the runs and the spend per epic from `GET /board`; `GET /status` still answers without JavaScript; `kb/studio-web-renderer-spike.md` carries the recipe and the quote; `bun test`, vitest, the lib suite and conformance are green.

## Assumptions

- `bun` is not on this launch host's PATH; dev sessions run bun (install, build, test) in the engine sandbox provisioned with `WITH_BUN=1` (runbook §3.8) and record the gate `unverifiable-here` with the attended command when the sandbox lacks it (EP-29's precedent).
- `tools/verify_host.py` today runs two fixed gates with no change detection (lib suite, conformance); CAP-1's "when `apps/studio-web` changed" is a path-diff predicate against the run's base ref (the supervisor's `base_ref` of the worktree) with no new config key, running the web gate always when the diff is unavailable; the planner names the exact predicate in 30.1's Code Map.
- The contract header reads 0.1.24 (29.4 landed); 30.5 takes the one bump to 0.1.25 naming `GET /board`, and 30.6 extends that same 0.1.25 entry with `GET /status` instead of a second bump (the epic text names 0.1.25 for both).
- The session's cache headers are the set the supervisor's existing authenticated HTML answers carry (Story 22.5's); the planner names them in 30.2's Code Map.
- The placeholder sheet of 30.1 is authored by the dev session as our own pixels (hand-set or generated by a committed script), and 30.4 extends it with eight placeholder frame sets so every state has a distinct loop before 30.7 replaces the sheet.
- Per-browser memory (the project choice, the last screen) is `localStorage`; the three container sizes of CAP-2's tests are a desktop and the iPad's two orientations, chosen by the planner.
- CAP-13's "the epic's band" is an optional per-epic entry in `.tk-studio/budget-bands.yaml` whose shape the planner settles for 30.5 (task-planning "Settled shape"); absent, the spend bar shows the spend alone; the spend is the sum of the meter's cost on the project's `job-run` events grouped by epic, read from the per-user store's ledger on the host; "ended today" is the supervisor host's local day.

## Open Questions

- 30.7 names the operator's art tool (Adobe Creative Cloud or an agentic/MCP tool) as the operator's choice, and a headless dev session cannot drive Adobe CC: may the loop author the source files in a tool-neutral format its own script can export (layered PNGs or a generator under `tools/sprites/`), recording that as the tool of record, or does 30.7 wait for an attended ruling naming the tool?
- Does the engine sandbox reach the npm registry for `bun install` of pixi.js, react, vite and vitest (30.1 is the first story to need it), or must a package cache be provisioned on the box first (runbook)?
- 30.6 names "the conformance suite's status drive": the contract (0.1.20) documents a CLI doctor drive, and the supervisor's own tests cover the status page; which suite's drive follows the new `/status` address: `apps/supervisor`'s `conformance.ts` self-check, the plugin's runner, or both?
