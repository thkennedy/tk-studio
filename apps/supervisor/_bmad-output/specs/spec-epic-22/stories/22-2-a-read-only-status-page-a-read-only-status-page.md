---
title: 'A Read-Only Status Page'
type: 'feature'
created: '2026-09-28'
status: 'done'
baseline_revision: 'd611bf0c630e199e80293c1f308b31a88d9fd546'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-22/operator-decisions.md'
  - '{project-root}/_bmad-output/specs/spec-epic-22/plans/22-2.md'
warnings: [oversized]
deferred:
  - summary: >-
      A run resumed after a supervisor restart loses the cost of its pre-restart iterations, so the page's cost (run.json `total_cost_usd`) under-reports it.
    evidence: |-
      `finishRun` keeps the iteration sum in a local `cost` (src/cli.ts:1375, :1416) and writes it only at `finish` (:1518, :1528). A restart resumes the run in a new process (`recoverWithResume`, src/cli.ts:403) whose sum starts empty, and no queue event records per-iteration cost. The 21-6 dispatch note names "cost summed across resumed iterations" (deferral class a). Fixing it needs src/cli.ts or src/queue.ts, outside this story's Files.
    location: >-
      src/cli.ts:1375-1528 finishRun
    severity: medium
---

<intent-contract>

## Intent

**Story (epics.md, Story 22.2, verbatim):** As the operator, I want a small server-rendered page over the queue and `~/.tk-studio`, so that I can see what the box is doing at a glance while the studio plugin still grows no UI.

**Problem:** The 22.1 API answers only JSON. The operator has nothing to glance at from a browser, and the studio plugin grows no UI.

**Approach:** Add one server-rendered HTML page (`GET /`) to the 22.1 handler in `src/api.ts`. It uses the same bind and the same bearer check, and it has no `<script>` and no client framework. A new `src/page.ts` gathers from the queue, the per-user store and the registry's published read path. All of these are reads. It then renders escaped HTML with inline CSS and a viewport meta, and redacts credential-shaped values.

## Boundaries & Constraints

**Always:**
- AC1: **Given** the status page, **when** it is requested, **then** it is served on the same bind and behind the same auth as the API, with no client-side framework, and it reads well at phone width.
- AC2: **Given** the page, **when** it renders, **then** it shows the queue (jobs, and runs with state, reason, and cost), the latest status blocks, run workspaces (`run.json`, `handoff.json`), the tail of this machine's ledger file, and the registry's projects.
- AC3: **Given** any page route, **when** it is exercised in the test suite, **then** it is a GET that writes nothing to the queue or to `~/.tk-studio`, and it renders no credential-shaped value (NFR5).
- Dispatch note, 21-6 reconcile:
  - Show `held` runs and ended runs that keep a lock, each with the lock holder and the deadline.
  - Show each run's resume count (`Queue.resumeCount`).
  - Show each run's cost summed across resumed iterations. That is `run.json` `total_cost_usd`, which the supervisor sums over every iteration before `finish`. With no value, the cost shows as absent.
  - Reasons can be long (`orphaned: supervisor restart; guard: ...`). Wrap them and never cut them.
- Dispatch note, 22-1 reconcile:
  - Read kept locks only through `Queue.locks()`/`LockRow`, and name the holder as `/status` does (`holderOf`). Never query the locks table beside them.
  - Show a deadline only where one exists: an sbx worker's in-VM deadline from `recordedWorker(run, false)`.
  - A lock kept for a live driver after a cancel (`driverLive`, no recorded worker) shows its holder and the text "kept for its live driver".
  - Render event kinds, including `worker-kill` and `lock-released`, as stored, never from a fixed list.
- Every rendered string is HTML-escaped and passed through the redaction.
- A missing or unreadable store file, or a registry failure, renders as a short note in its section. It never causes a 500 or a thrown page.
- Paths in notes are store-relative, never absolute machine paths (AD-15).
- The store root is `TK_STUDIO_HOME` when set, else `homedir()/.tk-studio`.

**Block If:**
- A stock phone browser would need a second auth scheme (cookie, query token, Basic auth, login form). Build only the bearer check, and record the limitation under unverifiable-here. Block only if the work would require building one.
- A needed datum is reachable only through a writing verb.
- The Files list would grow past the five in Tasks.

**Never:**
- No `<script>`, no client framework, and no write route.
- No change to the 22.1 JSON routes' answers.
- Never call `claim`, `recover`, `end`, `drain`, `enqueue`, `recordedWorker(…, true)`, or any writing `Queue` method from the page.
- Never read the registry file directly. Use `registryShow` only.
- Never copy plugin code, such as `classify.py` patterns (AD-2).
- Never read the whole ledger file. Read only its tail.
- Nothing from Story 22.3 (`start.ps1`, notifier, snapshot).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Happy path | `GET /` with a valid bearer | 200 `text/html`, viewport meta, no `<script`, every AC2 section | none |
| No token | `GET /` with no bearer or a wrong one | 401 (the existing `authorized` gate) | none |
| Wrong method | `POST /` | 405 with `Allow: GET` | none |
| Ended run keeps its lock | Terminal run holds a `kind:"run"` lock, sbx worker recorded | Row shows the holder and the deadline | none |
| Kept for live driver | Cancelled run holds its lock, no worker recorded | Row shows the holder and "kept for its live driver", with no deadline | none |
| Long reason | Reason of more than 300 characters | Rendered whole, wrapped by CSS | none |
| Missing store files | No `studio_run_id`, no workspace, bad JSON, no ledger | Section note naming the store-relative path tried | never a 500 |
| Registry fails | `registryShow` throws | Registry section shows a note | never a 500 |
| Credentials planted | API token, `TK_SUPERVISOR_*TOKEN*` value, `Bearer x`, `sk-ant-…`, `ghp_…`, credential-named JSON keys | None of these values appears in the body | redacted |

</intent-contract>

## Code Map

- `src/api.ts`: the 22.1 handler, where the page plugs in.
  - `ApiDeps` :55 is the injection seam. Add optional page deps: store root/env, a registry reader defaulting to `registryShow`, and the ledger identity.
  - `holderOf` :108: export it and reuse it. Do not re-derive it.
  - `createApi` :127. `redact` :146 strips only the API token.
  - The route dispatch is at :260-293. `authorized(req)` runs first, and the `allow()` 405 pattern is at :266.
  - `serve()` :297 passes the page deps.
- `src/queue.ts`, read-only:
  - `get` :664, `runs()` :668, `events(runId?, since?)` :673, `jobs()` :682.
  - `locks()` :693, with `LockRow` :484 and `Holder` :489.
  - `recordedWorker(run, false)` :767 returns `worker.deadline` on sbx.
  - `resumeCount(runId)` :1094 and `isTerminal`.
  - `end`'s `driverLive` :1197-1225: a lock kept with no recorded worker is the live-driver case.
  - The store-root rule is at :131.
  - `RecoverReport.held`: held runs surface as events and kept locks, not as a state.
- `src/server.ts:65` `registryShow()`: the registry's projects through `registry.py show`. It spawns `uv`, so inject it in tests.
- `src/server.ts:735` `readProjectConfig(root)`: the `project_id` of a project.
- The project key rule (`src/cli.ts:267` `projectIdOf`, private: `project_id ?? basename(root)`): use the queue run's own `project_id`, else `readProjectConfig(root).config.project_id`, else `basename(root)`. Do not touch `src/cli.ts` (outside Files). The workspace key is that id with `[^A-Za-z0-9._\-]` replaced by `_`.
- Store layout (read-only):
  - The workspace is `projects/<key>/runs/<studio_run_id>/`. It holds `run.json` (`state`, `reason`, `status_block`, `total_cost_usd`, `started`/`ended`) and `handoff.json`, which may be absent.
  - The ledger is `measurements/<user>-<machine>.jsonl`.
    - `<user>` follows getpass order: env `LOGNAME`, `USER`, `LNAME`, `USERNAME`, then `os.userInfo().username`.
    - `<machine>` is `os.hostname()`.
    - Both go through the same `safe_name` replacement.
- "Latest status blocks" are the `status_block` values from the newest runs' `run.json`, newest first.
- `src/env.ts:28-105`: the env getters. Add a `studioHome(env)` getter here, so the environment has one surface (AD-15).
- `test/api.test.ts:36` `fixture()`: the temp queue plus `createApi` pattern. `test/queue.test.ts:18-40` `fakeProbes`.
- `README.md:39` `## HTTP API`: add the page route.

## Tasks & Acceptance

**Execution:**
- `src/env.ts`: add `studioHome(env)`, which returns `TK_STUDIO_HOME` or `homedir()/.tk-studio`. This keeps a single env surface.
- `src/page.ts` (new):
  - `gatherPage(deps)`, which only reads: jobs; runs with state, reason, cost, resume count and events; kept locks with holder and deadline or "kept for its live driver"; the latest status blocks; `run.json`/`handoff.json` per run; the ledger tail (last N lines read from the file's end); registry projects.
  - `renderPage(data)`: escaped HTML, inline CSS (`overflow-wrap:anywhere`, mobile-first), a viewport meta, no script.
  - `redactCredentials(text, env, token)`: the supervisor's own redaction.
- `src/api.ts`:
  - Add the `GET /` route inside `createApi`, after `authorized`. Any other method gets 405 with `Allow: GET`.
  - Add the page deps to `ApiDeps`, and wire them in `serve()`.
  - Export `holderOf`.
- `test/page.test.ts` (new): prove AC1–AC3 and every row of the I/O matrix. Use a temp `TK_STUDIO_HOME` and an injected registry reader.
- `README.md`: add the page route to `## HTTP API`.

**Acceptance Criteria:**
- Given `GET /` with a valid token, when it is served, then the body is `text/html`, carries `<meta name="viewport"`, contains no `<script`, and holds every AC2 section, with resume count, summed cost and kept locks.
- Given a snapshot of the queue db bytes, `max(seq)` of events, and a recursive listing with the mtime and hash of every file under the temp `TK_STUDIO_HOME`, when several page GETs run, then every snapshot is unchanged.
- Given credential-shaped values planted in `run.json`, `handoff.json`, the ledger and a run reason, when the page renders, then none of those values appears in the body.

## Spec Change Log

## Review Triage Log

### 2026-09-28 — Review pass
- layers: blind-hunter, edge-case-hunter (band L, both ran)
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 4, low 3)
- defer: 1 (high 0, medium 1, low 0)
- reject: 3 (high 0, medium 0, low 3)
- addressed_findings:
  - `[medium]` `[patch]` Telegram tokens directly after `bot` in an API URL escaped the key-shape redaction; the boundary is now `(?<![0-9])` (NFR5).
  - `[medium]` `[patch]` Credential-named keys widened to `private_key`/`privateKey`, `cookie(s)`, `session_key`/`session_token`; `session_id` stays visible (NFR5).
  - `[medium]` `[patch]` JSON embedded in a string leaf (e.g. `{"password": "x"}` inside a run.json field) rendered its value after stringify; string leaves now go through the text redaction (NFR5).
  - `[medium]` `[patch]` A terminal run's kept lock read "kept for its live driver" even when the owner was dead; the page now asks the queue's read-only owner probe and names a dead driver's lock as freeable.
  - `[low]` `[patch]` The ledger tail decoded each 8 KiB chunk separately, corrupting a multi-byte character across a boundary; bytes are joined, then decoded once.
  - `[low]` `[patch]` An sbx lock past its in-VM deadline still read "kept until" the deadline; `recordedWorker(run, false).mayRun` now names it as passed, and the deadline is still shown.
  - `[low]` `[patch]` `api.ts` ↔ `page.ts` import cycle; `holderOf` moved into `src/page.ts`.
- rejected:
  - The `unreadable` store-file branch has no dedicated test: plumbing under the same catch as the tested missing and bad-JSON notes; the named behaviour ("never a 500") is asserted.
  - `TK_STUDIO_HOME` is trimmed: it matches the queue's own store rule (`src/queue.ts:132`), which the Code Map pinned.
  - Multi-word unquoted secrets and nested objects in free text: speculative; no planted credential shape survives the AC3 test.

### 2026-09-29 — Review pass (follow-up)
- layers: blind-hunter, edge-case-hunter (band L, both ran)
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 2, low 1)
- defer: 0
- reject: 3 (high 0, medium 0, low 3)
- addressed_findings:
  - `[medium]` `[patch]` An ended host-tier run's kept lock read "kept while its recorded worker may run" without probing the worker. The page now asks `recordedWorker(run, false)` (the read-only pid+start probe) and names a gone worker's lock as freeable. A throwing probe reads "liveness unknown" (host) or "deadline unknown" (sbx), with no deadline shown.
  - `[medium]` `[patch]` The registry failure note embedded `registry show`'s error/stderr verbatim, which can carry absolute machine paths (AD-15). `machinePathsOut` now rewrites the store root to `~/.tk-studio`, `TK_STUDIO_ROOT` to `<studio>` and `homedir()` to `~`, longest first, in both separator forms.
  - `[low]` `[patch]` The default ledger identity (getpass order, `hostname()`, `safeName`) and the `projectKey` fallbacks (`.tk-studio/config.yaml` `project_id`, then basename) had no test. Five tests now read the ledger and workspace through the defaults.
- rejected:
  - Cost is not summed over resumed iterations: the spec pins the cost to `run.json` `total_cost_usd`. The per-process summing gap is already deferred (frontmatter `deferred`, ledger DW-15).
  - The registry read has no page-side time limit: `registryShow` goes through `runUv`, which has a 120 s default timeout (`src/server.ts:340`), so a hang is bounded and ends in the section note.
  - No page test for an engine-held lock: the holder form is `holderOf`, shared with `/status`, and the engine "kept" text is plumbing that no criterion names.

### 2026-09-29 — Review pass (second follow-up)
- layers: blind-hunter, edge-case-hunter (band L, both ran)
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 2, low 3)
- defer: 0
- reject: 6 (high 0, medium 0, low 6)
- addressed_findings:
  - `[medium]` `[patch]` Credentials inside escaped JSON in free text rendered: `{"detail":"{\"password\":\"x\"}"}` in a reason showed `x`. `redactKeyValues`/`credentialValue` (`src/page.ts:310`, `:329`) now match keys and values whose quotes carry any escape depth, and scan inside a non-credential value (NFR5).
  - `[medium]` `[patch]` `credentialKey` missed camelCase keys that start with the credential word (`secretKey`, `SecretAccessKey`, `tokenValue`). A third rule (`src/page.ts:265`) counts them, except count-shaped ones (`tokenCount`, `tokensUsed`) (NFR5).
  - `[low]` `[patch]` `machinePathsOut` missed Windows paths as a Python repr prints them (doubled backslashes, other drive-letter case). Both forms are now scrubbed from the registry note (AD-15).
  - `[low]` `[patch]` `machinePathsOut` replaced bare prefixes (`/home/timothy` → `~othy`). It now substitutes only where a path ends.
  - `[low]` `[patch]` The AC2 test proved jobs and run states only by words anywhere in the body. It now slices the Jobs and Runs sections and asserts each job card and each run's state badge.
- rejected:
  - Absolute paths inside stored reasons, event details, run.json, handoff.json and ledger lines: the spec pins store-relative paths for the page's own notes only; stored data renders as stored, and AD-15 governs tracked files.
  - Engine-held locks show no run state and no engine liveness: no criterion names either; already a recorded residual risk.
  - AC3 read-only proof uses an injected registry, and a hung `registry.py show` would hang the page: `registryShow` is the studio's published read path and `runUv` bounds it at 120 s (triaged the same way in the previous pass).
  - Page-load cost (whole run history loaded, per-run events, sync file reads, quadratic `tailLines` recount on long lines): performance plumbing no criterion names.
  - README row does not state the caps: the page notes every hidden count itself, and the caps are recorded as DRIFT.
  - Tests leave temp dirs and open SQLite handles: the same fixture convention as `test/api.test.ts`; plumbing.

## Design Notes

- The route is `GET /`, the bind's front door, because `/status` is already the JSON route.
- A phone's address bar cannot send a bearer header. The page stays behind the same auth, per AC1, and the operator uses a client that sends the header.
- The plan's band is L, so both review layers run.

## Verification

**Commands:**
- `bun install --frozen-lockfile`: expected no lockfile change.
- `bun test`: expected all green, `test/page.test.ts` included.
- `bunx tsc --noEmit`: expected exit 0.

**Manual checks:**
- unverifiable-here: the page opened from the phone over the tailnet on the real bind. The operator runs `curl -H "Authorization: Bearer $TK_SUPERVISOR_TOKEN" http://$TK_SUPERVISOR_BIND:8787/`.

## Deviation Summary

### pass 1 (2026-09-28, implementer)

- planned: `gatherPage` shows every queue run with all of its events / actual: it shows the newest 50 runs, the last 30 events per run and the latest 5 status blocks, with a note saying how many older items are hidden. The ledger tail is 20 lines (the spec left N open). Kept locks are listed in full from `Queue.locks()`, so no held run is hidden / why: keeps the page usable at phone width as the queue grows / may affect: none

DEVIATION SCORE: 1

DRIFT: the page caps the runs (50), the events per run (30) and the status blocks (5), and notes the hidden count; kept locks are never capped — a page over an unbounded queue stays readable at phone width — affects: none

### pass 2 (2026-09-28, implementer, consult DO lines)

- The kept-lock card now shows the run's reason, and a test covers more than 50 runs where the oldest keeps its lock. DEVIATIONS: none. DEVIATION SCORE: 0.
- Verify (this session): `bun install --frozen-lockfile` no changes; `bun test` 487 pass, 0 fail; `bunx tsc --noEmit` exit 0.
- Matrix test audit: every row is covered by a test in `test/page.test.ts` that ran and passed (:120, :131, :141, :188, :197, :227, :244, :268, :299).

### pass 3 (2026-09-28, implementer, review patches)

- planned: use the queue's owner-liveness probe on the lock's owner / actual: `src/page.ts:194` calls the public `Queue.ownerAlive(run)` with the lock row's `owner_pid`/`owner_host`/`owner_nonce`/`owner_start` spliced over the run / why: the per-owner `ownerLive` is private and `src/queue.ts` is outside Files; the spliced object makes the same check `claim` makes on a terminal holder with no worker / may affect: none
- planned: `holderOf` exported from `src/api.ts` (Code Map) / actual: `holderOf` moved to `src/page.ts` and imported by `src/api.ts` (review patch 7, the plan's "move it beside the page code") / why: removes the api↔page import cycle; `/status` answers unchanged / may affect: none

DEVIATION SCORE: 1

- Verify (this session): `bun install --frozen-lockfile` no changes; `bun test` 494 pass, 0 fail; `bunx tsc --noEmit` exit 0.

DRIFT: the page calls the public `Queue.ownerAlive` with the lock's owner fields spliced over the run, to tell a live driver's kept lock from a dead one's — `ownerLive` is private and `src/queue.ts` is outside the Files — affects: none

### pass 4 (2026-09-29, implementer, follow-up review patches)

- The kept-lock probe now covers ended host-tier runs as well (`src/page.ts:196`). A running sbx run is still probed, as before, so its in-VM deadline stays on its card. The implementer scored this 1; the consult ruled it story-required behaviour (score 0) and asked for a pinning test (`test/page.test.ts:486`). DEVIATIONS: none. DEVIATION SCORE: 0.
- Verify (this session): `bun install --frozen-lockfile` no changes; `bun test` 504 pass, 0 fail; `bunx tsc --noEmit` exit 0.

### pass 5 (2026-09-29, implementer, second follow-up review patches)

- The five patches above landed in `src/page.ts` and `test/page.test.ts` only. The implementer scored three local points 1 (the count-word exclusion in `credentialKey`, single-quoted values rendering as `'[redacted]'`, the home-boundary test using the real `homedir()`). The consult ruled them forced by the patch instructions (reject-deviation). A single-quoted free-text credential test was added per its DO line (`test/page.test.ts:651`). DEVIATIONS: none. DEVIATION SCORE: 0.
- Verify (this session): `bun install --frozen-lockfile` no changes; `bun test` 511 pass, 0 fail; `bunx tsc --noEmit` exit 0.

## Consult Log

- 2026-09-28T23:43:51Z — trigger: deviation-gt-0 — question: accept the page's recency caps (50 runs, 30 events per run, 5 status blocks, 20 ledger lines)? — ruling: accept-deviation score 1 — do: keep the caps as the N the spec left open; add the run's reason to the kept-lock card; add a test with more than 50 runs where the oldest keeps a lock (holder, state, reason, and the "older runs not shown" note) — rule candidate: Read-only views may cap lists by recency when each cap is a named constant with a "N older not shown" note and anything the story calls out explicitly is listed from its own uncapped source; score 1, no consult.
- 2026-09-28T23:53:07Z — trigger: deviation-gt-0 — question: accept the page calling public `Queue.ownerAlive` with the lock's owner fields spliced over the run (read-only? same answer as claim?) — ruling: accept-deviation score 1 — do: keep `src/page.ts:194` as written and leave `src/queue.ts` untouched; record it as a local deviation; have a test inject `Probes.ownerAlive` false and assert the "kept by a driver no longer alive" label (already present: `test/page.test.ts:34` fixture probe, test :380) — rule candidate: A read-only surface may call public read-only `Queue` probes (`ownerAlive`, `recordedWorker(run, false)`) with row fields spliced into the argument without a consult; changing `src/queue.ts` still needs the file in Files.
- 2026-09-29T00:01:55Z — trigger: deviation-gt-0 — question: accept the follow-up patch probing a running sbx run's recorded worker (`src/page.ts:196`, pre-existing behaviour kept so the in-VM deadline stays on its lock card)? — ruling: apply — do: keep `src/page.ts:196` as written and withdraw the deviation (score 0, story-required behaviour); ensure one test pins both halves (a running sbx run's lock card shows its in-VM deadline; a running host-tier run with a worker makes no `probeWorker` call), adding it only if not already covered — rule candidate: A read-only surface's probe is "used" whenever any rendered field (label or deadline) reads its result; probing through public kill=false Queue probes to fill a spec-required field is not a deviation and needs no consult.

- 2026-09-29T00:15:08Z — trigger: deviation-gt-0 — question: accept the review-patch pass's three local points (count-word exclusion list in `credentialKey` `src/page.ts:265`; single-quoted values render as `'[redacted]'`; the home-boundary test uses the real `homedir()`)? — ruling: reject-deviation — do: keep `src/page.ts:265`, `:310`, `:329` and the boundary test as written; record the pass as "DEVIATIONS: none. DEVIATION SCORE: 0"; ensure one test plants a single-quoted credential in free text (`password='x'`) and asserts the value absent from the body, adding it only if not already covered — rule candidate: Implementation choices a review-patch instruction forces (helper regexes or exclusion lists meeting its named examples, the rendered form of a redaction when the spec only requires the value absent, testing through a non-injectable dependency's real value) are score 0 and need no consult.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmad-loop; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** a second follow-up review of the read-only status page (`GET /`: same bind, same bearer check, server-rendered, no script, credential-redacted, writes nothing). It closed two NFR5 redaction gaps and three smaller issues:
- Credentials inside escaped JSON in free text (reasons, non-JSON ledger lines) are now redacted at any escape depth.
- camelCase keys starting with a credential word (`secretKey`, `SecretAccessKey`, `tokenValue`) now count as credential-named; count-shaped keys (`tokenCount`, `tokensUsed`) stay visible.
- The registry note's machine-path scrub now covers Python-repr Windows paths and stops mangling longer sibling paths.
- The AC2 test now asserts the Jobs cards and each run's state badge inside their own sections.

**Files changed (this pass):**
- `src/page.ts`: `credentialKey`'s camelCase rule (`:265`), the escape-aware `redactKeyValues`/`credentialValue` scanner (`:310`, `:329`), and the boundary-checked, repr-aware `machinePathsOut` (`:95`).
- `test/page.test.ts`: the tightened AC2 test, and 7 new tests (escaped JSON once/twice, single-quoted free text, camelCase keys unit and page-level, Windows repr paths, path boundaries).

**Review:** both layers ran (band L).
- Patches applied: 5 (high 0, medium 2, low 3).
- Deferred: 0.
- Rejected: 6 (reasons in the Review Triage Log).
- Follow-up review recommended: true. The patched counts are high 0, medium 2, low 3, so the score is 3×2 + 3 = 9, which is 5 or more.
- One consult (`deviation-gt-0`) ruled `reject-deviation`: the implementer's three local points were forced by the patch instructions (score 0). One test was added per its DO line. It is in the Consult Log.

**Verification** (run by this session after the last change):
- `bun install --frozen-lockfile`: no changes.
- `bun test`: 511 pass, 0 fail across 11 files.
- `bunx tsc --noEmit`: exit 0.

**unverifiable-here:** opening the page from the phone over the tailnet, on the real bind. With `serve` running from the console on the agent PC, the operator runs `curl -H "Authorization: Bearer $TK_SUPERVISOR_TOKEN" http://$TK_SUPERVISOR_BIND:8787/` from another device. It should answer 200 `text/html`, and 401 without the header. A stock phone browser cannot send the bearer header, and no second auth scheme was built.

**Residual risks:**
- A resumed run's cost is under-reported after a supervisor restart. This is already deferred (DW-15).
- Engine-held lock labels do not check whether the engine is alive.
- Each page view spawns `uv` (`registry.py show`), bounded by `runUv`'s 120 s timeout, and loads the run history synchronously.
- Stored free text (reasons, event details, workspace JSON, ledger lines) renders any absolute path it carries; only the page's own notes are scrubbed.
- Redaction is pattern-based. A credential under a key name no rule knows, or in an unkeyed free-text shape, would still show.

DRIFT: the page caps the runs (50), the events per run (30) and the status blocks (5), and notes the hidden count; kept locks are never capped — a page over an unbounded queue stays readable at phone width — affects: none
DRIFT: the page calls the public `Queue.ownerAlive` with the lock's owner fields spliced over the run, to tell a live driver's kept lock from a dead one's — `ownerLive` is private and `src/queue.ts` is outside the Files — affects: none

## Reconcile

- 2026-09-29 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 22-3-the-supervisor-starts-itself-at-logon
