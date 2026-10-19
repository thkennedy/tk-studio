---
title: 'The Supervisor Serves the Web'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_revision: '5d53a9973ffc6798a92f770a7a25f49e2bc405eb'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-30/plans/30-2.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The studio web (`apps/studio-web`, 30.1) has no server: the owner cannot open it on the supervisor's origin behind the session cookie, a missing build is invisible, and the release motion archives an ignored `dist` that is absent at the tag (§6.3, D7).

**Approach:** Transcribed from epics.md "### Story 30.2: The Supervisor Serves the Web" (ST-109), verbatim in substance:

As the owner, I want the supervisor to serve the built web on its own origin behind the session cookie, so that the web needs no second server and no second sign-in (§6.3, D7).

- **AC1.** Given `apps/studio-web/dist` present beside the supervisor (built by the release motion's `--app studio-web`, or by hand from the checkout), when a signed-in browser requests `GET /app` or any path under it, then the supervisor serves the file from `dist` with the right content type, or `index.html` for a path with no file (the single-page fallback), never a path outside `dist` (`..` and absolute paths answer 404), and every answer carries the session's cache headers; a request with no session answers the sign-in page of Story 29.1 with a return to the requested path; `GET /` keeps serving the read-only page until Story 30.6 moves the home.
- **AC2.** Given no `dist` beside the supervisor, when `GET /app` is requested, then the answer is 503 `WebNotBuilt` naming the build command, and the read-only page's header says the web is not built; `bun test` covers the directory route, the fallback, the traversal refusal and the missing build.
- **AC3.** Given the release motion, when `tools/release_archive.py run --app studio-web --version X.Y.Z` runs, then it builds `dist` from the tag, zips it, publishes and records it under the roster's `studio-web` component as the other apps are, and the installer's supervisor slot unpacks it beside the supervisor; the runbook §4 gains the web's row.

## Boundaries & Constraints

**Always:**
- Files boundary is the plan's eleven (see Tasks). Any other file is a deviation; growing past eleven files is a HALT (oversize, band L).
- The session's cache headers = exactly `cache-control: no-store` (Story 22.5's set); every `/app` answer carries it (file, fallback, 404, 503). No new header family.
- The web is served under the absolute base `/app/` (`vite.config.ts` `base: "/app/"`); `api.ts` strips trailing slashes so `/app/` arrives as `/app`.
- The sign-in `next` redirect is same-origin only: starts with `/`, not `//` or `/\`, no `\`, no control char, no scheme; else `/`. JSON sign-in bodies still answer `{ok:true, username}`.
- Tests never read the real `apps/studio-web/dist` (ignored, absent in run worktrees); they build a temp dist and pass `web: {dir}`.
- Stdlib-only Python for `tools/release_archive.py`; the release zip's root holds `dist`'s contents (`index.html` at the root), run through `normalize_zip`.

**Block If:**
- `cookieRoute`'s allowlist or the sign-in `next` would need a change to the bearer API, the account JSON answers, or `GET /`'s behaviour beyond the not-built note.
- The Files list must grow past eleven.

**Never:**
- Never edit `plugins/tk-studio/contracts/**` (contract stays 0.1.24; the 0.1.25 bump is 30.5/30.6's), `tools/installer/**` or its rosters.
- Never run the release motion, push, tag or cut a release.
- Never move the home: `GET /` stays the read-only page.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Directory route | cookie or bearer, `GET /app`, `GET /app/` | 200 `index.html`, `text/html; charset=utf-8`, `cache-control: no-store` | — |
| File | `GET /app/assets/app.js`, `/app/sprites/x.png` | 200 file bytes, JS / `image/png` content type, no-store | — |
| SPA fallback | `GET /app/office/deep/path`, `/app/missing.js` | 200 `index.html`, no-store | — |
| Traversal | `/app/%2e%2e/x`, `/app/..%2fx`, `/app/a%5cb`, `/app//etc/passwd`, `/app/C:%5cx`, NUL, bad `%` | 404 `NotFound`, no-store, never the fallback | — |
| Not built | no web root holds `index.html` | 503 `{ok:false,error:"WebNotBuilt",command:"cd apps/studio-web && bun install --frozen-lockfile && bun run build"}`, no-store; `GET /` page shows one note line: web not built + command | — |
| No session | `GET /app/board?x=1`, no cookie/bearer | sign-in page (29.1) with hidden `next=/app/board?x=1` in each form | non-GET or non-`/app` stays 401 JSON; `GET /` stays sign-in |
| Sign-in next | form POST success with `next` | 303 to `next` when safe; `//evil`, `/\evil`, `https://x` → 303 `/` | JSON body answers unchanged |
| Wrong method | `POST /app` with session | 405 `Allow: GET` (bearer) / 401 (cookie, outside allowlist) | — |
| Release | `run --app studio-web --version X` (faked `_run`) | treeish `studio-web--vX:apps/studio-web`; argv `bun install --frozen-lockfile` then `bun run build` with `SOURCE_DATE_EPOCH`; zip root has `index.html` | bun failure raises like `_build_wheel` |

</intent-contract>

## Code Map

The full investigation is `plans/30-2.md` § Code Map (the `context:` entry); anchors re-checked 2026-10-19 against HEAD `5d53a99`. Essentials:

- `apps/supervisor/src/api.ts` -- `createApi(deps)` `:206`; entry handler `:577-592` (`:580` strips trailing slashes; `:588` unauth fall-through: `signIn()` for `GET /`, else 401); `cookieRoute` allowlist `:564-567`; `route()` `:595` (`/` at `:599`, 404 fall-through near `:637`); `signIn()` `:431`; `redirect` `:454`, success redirects `:466` (token) and `:490` (account/sign-in); `json()`/`fail()` `:158-161`, named refusals `:156`; `page()` `:410-413`; route doc `:13-43`.
- `apps/supervisor/src/auth.ts` -- `signInPage({mode, refused, needsHttps, invalid})` `:118`; forms post `/auth/account`, `/auth/signin`, `/auth/token` (`:120,123`): add hidden `next`.
- `apps/supervisor/src/page.ts` -- `PageData` `:67-82`, `gatherPage` `:169`, header `:497`, `.note` `:389`, `note()` `:406`: add `web: {built}` and the not-built note.
- `apps/supervisor/src/web.ts` (new) -- `webRoot(opts)`: `deps.web?.dir` → installed slot `join(import.meta.dir,"..","..","..","current.json")` `"studio-web".path` → checkout `join(import.meta.dir,"..","..","studio-web","dist")`; built ⇔ `index.html` exists. `resolveWebPath(root, urlPath)` → `{file}|{fallback}|{refused}` (decode each segment, refuse `.`/`..`/empty/`/`/`\`/`:`/NUL/decode error, containment check case-folded on Windows). `contentType(file)`.
- `apps/supervisor/test/` -- harness: `account.test.ts:46-85` `call()` helper, fixtures `api.test.ts:66`, `auth.test.ts:47,100` (`tokenSession`), `preload.ts`, `fakes.ts`; `page.test.ts:35`.
- `apps/studio-web/vite.config.ts:8` -- `base: "./"` → `"/app/"`, comment `:5-6`.
- `tools/release_archive.py` -- `APPS` `:83-87` (studio-web row `:86`), `normalize_zip` `:115`, `_build_wheel` `:182-199` (model for `_build_web`), asset name `:252`, roster record `:333-346`, guard `:359-363`, `gh release create` `:375` (unchanged).
- `plugins/tk-studio/lib/tests/test_release_roster.py` -- `ReleaseMotionTestCase` `:888`, fake `_run` `:928`, studio-web runs `:1171/:1182`, treeish pin `:1281-1289`.
- `apps/supervisor/README.md` -- API table `:40-57`, cookie paragraph `:77`. `kb/agent-pc-setup-runbook.md` §4 `:929`, table `:946-949`.
- Read-only: `tools/installer/cli/tk_studio_cli/apps.py` (`unpack` `:436`, `plan_web` `:945`, `apply_slots` `:1124-1220`, `write_current` `:356`) already lands the web slot and `current.json`; `driver-contract.md` 0.1.24.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/web.ts` -- new: `webRoot`, `resolveWebPath`, `contentType`, the `WebNotBuilt` command constant -- one resolver shared by route and page.
- `apps/supervisor/src/api.ts` -- `deps.web?: {dir?}`; `/app` branch in `route()` (GET only, else 405); cookie allowlist admits `/app` and `/app/…`; unauth `GET /app…` answers `signIn()` with `next` (path+query); safe-`next` 303s at `:466`/`:490`; pass web state to `page()`; route doc.
- `apps/supervisor/src/auth.ts` -- `signInPage` gains an escaped hidden `next` field in each form.
- `apps/supervisor/src/page.ts` -- `web: {built}` in `PageData`/`gatherPage`; one `note()` under the header when not built, naming the build command.
- `apps/supervisor/test/web.test.ts` -- new: every row of the I/O matrix through `handler(new Request(...))` with encoding kept, temp dist, no socket.
- `apps/supervisor/test/page.test.ts` -- the not-built note case (and its absence when built).
- `apps/supervisor/README.md` -- `GET /app[/…]` API row; cookie paragraph names `GET /app` and the sign-in's `next`.
- `apps/studio-web/vite.config.ts` -- `base: "/app/"`, comment updated.
- `tools/release_archive.py` -- studio-web row → subtree `apps/studio-web`, kind `"web"`; `_build_web(raw_zip, work, commit_epoch, cwd)` beside `_build_wheel`: extract, `bun install --frozen-lockfile`, `bun run build` with `SOURCE_DATE_EPOCH`, zip `dist/` contents at root, `normalize_zip`.
- `plugins/tk-studio/lib/tests/test_release_roster.py` -- treeish pin → `apps/studio-web`; assert the two bun argv lines and the zip root holds `index.html`.
- `kb/agent-pc-setup-runbook.md` -- §4 table gains a "Studio web" row: where it lives (slot via `current.json`, or `apps\studio-web\dist`), how built, `/app`, `WebNotBuilt`.

**Acceptance Criteria:**
- Given a temp dist and a cookie session, when `bun test` runs `web.test.ts`, then the directory route, a file with content type, the fallback, each traversal form (404), and `cache-control: no-store` on every answer pass (AC1, AC2).
- Given no dist, when `GET /app` and `GET /`, then 503 `WebNotBuilt` with the command, and the page header shows the not-built note (AC2).
- Given no session, when `GET /app/x`, then the sign-in page carries `next=/app/x`; a successful form sign-in 303s there; `GET /` with a session still answers the read-only page (AC1).
- Given the faked `_run`, when the release test drives `--app studio-web`, then the treeish, the bun argv and the zip root are pinned; a real cut is `unverifiable-here`: `uv run python tools/release_archive.py run --app studio-web --version 0.1.0` (AC3).
- Given the built web, `dist/index.html` references `/app/assets/` (AC1 deep paths).

## Spec Change Log

## Review Triage Log

### 2026-10-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 1, medium 1, low 2)
- defer: 0
- reject: 2: (low 2)
- addressed_findings:
  - `[high]` `[patch]` relative `SHEET_URL` (scene.ts:10, outside Files) broke the sprite at `/app` and deep paths under `base: "/app/"`; consult ruled option (a): `vite.config.ts` injects `<base href="/app/">` head-prepend; verify greps it in `dist/index.html`.
  - `[medium]` `[patch]` installed-slot lookup (`current.json` → `studio-web.path`, AC3's reader) was untested and pinned to `import.meta.dir`; `WebOptions.appDir` injectable, six slot/checkout/order tests added.
  - `[low]` `[patch]` symlink inside the web root could escape `dist`; `realpathSync` containment after the textual check, test with file and directory links.
  - `[low]` `[patch]` default `page.test.ts` fixture read the real checkout's `dist` (spec Always); now an isolated built temp dir. Plus consult-1's DO: `_build_web` docstring notes `cwd` unused.
- rejected: the 404 body's `path` field unasserted (plumbing, not named by an AC); `/app/office/` trailing slash 404s (unreachable: `api.ts:580` strips trailing slashes before `resolveWebPath` at `api.ts:432`).

### 2026-10-19 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 1: (medium 1)
- defer: 0
- reject: 5: (low 5)
- addressed_findings:
  - `[medium]` `[patch]` `safeNext` (api.ts:485) refused only C0/DEL. So C1 controls (U+0080–U+009F) passed, against the spec's "no control char". Characters above U+00FF also passed, and the `Location` header then threw, so a verified form sign-in or account creation answered 500. Both reviewers reported it (merged). Fix: refuse anything outside printable ASCII (`/[^\x20-\x7e]/`). Pinned in web.test.ts: the unsafe-next list gains `/app/\u0085x`, `/app/☃`, `/app/日本`, and a new account-creation case expects 303 `/`.
- rejected: other suites read the checkout's `dist` through the default `webRoot` (none of them asserts the note or the header, and page.test.ts is isolated); the vite base / `<base href>` has no unit test (proven by the Verification command `grep '/app/assets/'` and `<base href>` on `dist/index.html`); the installer writing `current.json` `studio-web` (already in the read-only installer, `apps.py:14,1172`); the 404 `path` field unasserted (plumbing, rejected before); the release build needs a standalone subtree and is not reproducible (`apps/studio-web/bun.lock` exists, there are no `workspace:` deps, and reproducibility is not an AC).

## Design Notes

- Traversal is checked on decoded segments because WHATWG `URL` already collapses literal `..`/`%2e%2e`; a refused path is 404, never the fallback. Tests must keep the raw encoding (`new Request` with a URL string that preserves `%2f`, `%5c`).
- AC3's "the installer's supervisor slot unpacks it beside the supervisor" is the installer's existing `studio-web/<ver>/` slot + `current.json` (read-only here) plus this story's reader in `webRoot`.
- Settled shape (SPEC design notes): `components["studio-web"] = {tag, url, sha256, source}`, zip root = `dist` contents.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- In a /tmp copy of exactly the committed files (`git ls-files -co --exclude-standard apps/supervisor apps/studio-web | tar -cT - | tar -xC /tmp/v302`): `cd apps/supervisor && bun install --frozen-lockfile && bun test` -- expected: all pass; `cd apps/studio-web && bun run verify && grep -q '/app/assets/' dist/index.html` -- expected: exit 0.
- `uv run python tools/verify_host.py` -- expected: ok (binding host leg).
- `git diff main --stat -- plugins/tk-studio/contracts tools/installer` -- expected: empty.

## Deviation Summary

### pass 1 (2026-10-19, implementer)

- planned: every traversal form in the matrix (including `/app/%2e%2e/x`) answers 404 `NotFound` with `no-store` / actual: forms the URL parser collapses before the handler (`%2e%2e`, `.%2e`, literal `..`) arrive as `/x`, outside `/app`: bearer gets the existing plain 404 `NotFound`, a cookie session the existing 401; never the fallback or a file outside dist (pinned by a test). Every form that reaches `/app` (`..%2f`, `%5c`, `//`, `C:%5c`, `%00`, bad `%`) gets 404 + no-store. / why: Bun.serve normalizes the request URL before the handler (session probe: raw `GET /app/%2e%2e/x` and `GET /app/../x` both give `req.url = http://h/x`); changing the generic fall-through is outside the story and protected by Block If / may affect: none
- planned: `_build_web(raw_zip, work, commit_epoch, cwd)` builds the artifact / actual: same signature, `cwd` unused (bun runs in the extracted tag tree); `run()` gains a small `kind == "web"` branch renaming the result to `studio-web-X.Y.Z.zip` / why: the published asset must carry the asset name; the build must come from the tag, never the working tree / may affect: none
- planned: each sign-in form gains a hidden `next` / actual: added only when a `next` exists; `GET /` and existing sign-in pages byte-identical / why: keeps `GET /` and the 29.1 pages unchanged / may affect: none

DEVIATION SCORE: 1 (consult: accept-deviation score 1)

DRIFT: `..`/`%2e%2e` traversal forms answer the existing fall-through (bearer 404, cookie 401) instead of 404+no-store — Bun.serve collapses dot segments before the handler, so they never reach `/app` — affects: none
DRIFT: `_build_web` ignores `cwd` and `run()` renames the web zip to the asset name — bun must run in the extracted tag tree and the upload must carry `studio-web-X.Y.Z.zip` — affects: none
DRIFT: hidden `next` emitted only when a `next` exists — keeps `GET /` and the 29.1 sign-in pages byte-identical — affects: none

### pass 2 (2026-10-19, review patches)

DEVIATIONS: none — DEVIATION SCORE: 0

### pass 3 (2026-10-19, follow-up review patch)

DEVIATIONS: none — DEVIATION SCORE: 0

## Consult Log

- 2026-10-19T18:56Z — trigger: deviation-gt-0 — question: accept the implementer's three score-1 deviations (traversal forms normalized before the handler; `_build_web` cwd unused + asset rename; conditional `next`)? — ruling: accept-deviation score 1 — do: accept D1-D3 as local; record D1 as normalized-before-route (bearer 404, cookie 401, never fallback/outside dist, pinned by web.test.ts:138); leave the fall-through and cookie 401 untouched; note on `_build_web` that `cwd` is unused; keep `next` conditional — rule candidate: when a spec I/O row names an input the runtime URL normalizer rewrites before the handler, pin the normalized behaviour in a test and record a score-1 deviation without a consult.
- 2026-10-19T19:02Z — trigger: high-severity-finding — question: relative `SHEET_URL` (scene.ts:10, outside Files) breaks the sprite at `/app` and deep paths under `base: "/app/"`; patch in vite.config.ts via injected `<base href>`, patch scene.ts (12th file, oversize halt), defer to 30-4, or escalate? — ruling: apply — do: in vite.config.ts add an inline plugin whose transformIndexHtml injects {tag:"base", attrs:{href:"/app/"}, injectTo:"head-prepend"} and update the comment; extend verify with `grep -q '<base href="/app/"' dist/index.html`; do not touch scene.ts, no twelfth file — rule candidate: when a story changes a bundler's base/public path, the plan's Files must include every module holding a runtime-relative asset URL, or name an in-config `<base href>` injection as the fix.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a follow-up review pass over story 30-2, which was already implemented and committed at `1088311585dbfe9d0100658f0df8dacdec4f70c6` against baseline `5d53a9973ffc6798a92f770a7a25f49e2bc405eb`. The story is unchanged: the supervisor serves the built web at `GET /app[/…]` behind the session cookie, with the file, SPA fallback, traversal 404, `no-store`, 503 `WebNotBuilt`, and sign-in with a safe `next`. The web builds under `/app/`, and the release motion builds the studio-web zip from the tag. This pass adds one hardening fix: the sign-in `next` must be printable ASCII.

**Files changed in this pass (2, both inside the plan's Files).**
- `apps/supervisor/src/api.ts`: `safeNext` refuses any character outside `\x20-\x7e` (C0, DEL, C1 and non-ASCII), and its doc comment says so.
- `apps/supervisor/test/web.test.ts`: the unsafe-`next` list gains a C1 control, a symbol and a CJK `next`, all checked on both `/auth/signin` and `/auth/token`. A new test checks that a non-ASCII `next` on account creation answers 303 `/`, not 500.

**Review.** Both layers ran (band L). 1 patch applied (medium 1), 0 deferred, 5 rejected (see the Review Triage Log). No consults: deviation 0, no high-severity finding.

**Follow-up review.** Patched this pass: high 0, medium 1, low 0. Score 3×1 + 0 = 3, below 5, and nothing high, so `followup_review_recommended: false`.

**Verification.**
- Lib suite (`plugins/tk-studio/lib`): 1414 tests OK (2 skipped). Conformance: `ok: true`.
- Supervisor, in a /tmp copy of the tracked files (`bun install --frozen-lockfile` OK): `bun test` over web, auth, account, api and page gave 170 pass, 7 skip, 0 fail. `bun run typecheck` exited 0. With the old regex put back (in /tmp only), web.test.ts fails 2 tests, so the new cases catch the bug.
- `git diff main --stat -- plugins/tk-studio/contracts tools/installer` is empty. No `node_modules` or `dist` was left in the worktree.

**unverifiable-here.** These are carried over from the first pass and unchanged. The host leg: `uv run python tools/verify_host.py`, expecting `verify_host: ok (lib suite, conformance, studio-web)`. A real release cut: `uv run python tools/release_archive.py run --app studio-web --version 0.1.0`. A browser check of `/app` and `/app/x/y` once the web is built and signed in.

**Residual risks.** These are carried over from the first pass. The installed-slot lookup has not been tried on a real install. `..` and `%2e%2e` are collapsed by Bun before routing, so they reach the generic fall-through. The relative `SHEET_URL` in scene.ts works only because of the injected `<base href>` (30-4 may switch it to `import.meta.env.BASE_URL`). New in this pass: a `next` carrying raw non-ASCII now returns to `/` instead of the path. Real browsers send the percent-encoded path, so they are not affected.

DRIFT: none in this pass. The five DRIFT lines from the first pass still apply, and the Deviation Summary for passes 1–2 records them.

## Reconcile

- 2026-10-19 — score 1; reconcile not required.

Gate: Part A not-required; Part B story accepted, planned 30-3-the-live-stream-in-the-browser
