---
id: SPEC-epic-29
companions:
  - ../../planning-artifacts/design/studio-design-spec-2026-10-09/README.md
  - ../../planning-artifacts/design/studio-design-spec-2026-10-09/decisions.md
  - ../../planning-artifacts/research/studio-office-ui-2026-09-01/digest-studio-office-ui.md
  - ../../planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md
  - ../../../plugins/tk-studio/contracts/driver-contract.md
sources:
  - ../../planning-artifacts/epics.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Epic 29: One Account, the Registry, the Projection

## Why

A mandate plus a vision. The design spec's §6.2 item 3 is the first epic after the restructure and the one every front-end epic stands on: the owner's single account replaces the Google and GitHub sign-in (D7, D8, spec §8), the supervisor owns an agent registry every consumer reads (§7.2), and the queue's events and the engine's journal are projected into the office vocabulary (§7.3) and streamed the way the studio web of EP-30 needs them (§6.3: snapshot then deltas, `Last-Event-ID`, a heartbeat under 15 s). Nothing here is a web page: the read-only status page stays the no-JavaScript fallback, and EP-30 builds the office on what this epic serves. Trace: spec §6.2 item 3, §6.3, §7.2, §7.3, §8, §9 (D7, D8, D10); the 2026-09-01 office decisions; DW-17. Repo: tk-studio (`apps/supervisor/src`, `apps/supervisor/test`, `apps/supervisor/README.md`, `plugins/tk-studio/contracts/driver-contract.md`, `kb/agent-pc-setup-runbook.md`); Epic-22-sized, four stories.

## Capabilities

- **CAP-1** (29.1)
  - **intent:** The owner creates the studio's one account on the first visit.
  - **success:** With no account, `GET /` with no session offers account creation instead of sign-in: a username (3 to 64 characters, letters, digits, `-`, `_`, `.`) and a password (12 characters or more, checked for length only). `POST /auth/account` creates the account once (a second creation is 409 `AccountExists`), hashes the password with `Bun.password` (argon2id, the default cost), stores the record (`username`, the hash, `created_at`) at `<TK_STUDIO_HOME or ~/.tk-studio>/supervisor/account.json` (never in a checkout, never in the queue file; AD-3), answers with the session cookie, and records a `service_events` row `account-created {username}`.
- **CAP-2** (29.1)
  - **intent:** The intended usage is stated where the owner signs in and in the README.
  - **success:** After creation the page states in one paragraph that the studio is operated by the person whose Claude subscription is signed in on this box, from their own seat, with no token intermediated and no API-key tier (spec §8); `apps/supervisor/README.md` carries the same paragraph.
- **CAP-3** (29.1)
  - **intent:** The owner signs in with username and password, rate-limited with a lockout.
  - **success:** `POST /auth/signin` with the username and password: a match (constant time, `Bun.password.verify`) answers the session cookie Story 22.5 defined (unchanged shape and lifetime); a mismatch answers 401 `SignInRefused` after a fixed delay; five failures within fifteen minutes lock the account for fifteen minutes (423 `AccountLocked`); the lockout and every refusal are `service_events` rows naming the username and never the password. The bearer header still authorises everything and `POST /auth/token` (the token sign-in) stays for the operator's own browser. `bun test` pins creation, sign-in, the lockout window, and that no answer, event or log line carries a password or a hash.
- **CAP-4** (29.1)
  - **intent:** The Google and GitHub providers are deleted, not disabled.
  - **success:** The routes `GET /auth/{google,github}` and their callbacks, the `TK_SUPERVISOR_OAUTH_*` variables, `OAuthNeedsHttps` and the provider code in `apps/supervisor/src/auth.ts` are deleted; a set `TK_SUPERVISOR_OAUTH_*` variable is ignored with one start-time warning naming it; the README's environment table and runbook §4.5 drop the OAuth walk-through and describe the account; `bun test` pins that the removed routes answer 404 and that the worker environment still strips every `TK_SUPERVISOR_*` secret (DW-17).
- **CAP-5** (29.1)
  - **intent:** A locked-out operator, or one who lost the password, has a documented way back in.
  - **success:** The reset is deleting `account.json` from the console (the next visit creates the account again), the bearer token working throughout; runbook §4.5 names it.
- **CAP-6** (29.2)
  - **intent:** The supervisor derives a registry of the agents it can run per project.
  - **success:** On `recover` (every tick) and whenever a run is claimed or ends, the supervisor rebuilds an `agents` table in the queue file: one row per `(project, role)` for the roles `orchestrator`, `session`, `implementer`, `reviewer`, `consult`, `advisor`, `planner` (the legs of contract §5 mapped once, in one table in `apps/supervisor/src/registry.ts`) over the host registry's served roots, with `agent_id` `<project-id>/<role>`, `model`, `effort` and `advisor` from the resolved route (`pipeline.py resolve --directory <root>` with the shipped defaults when no story is live; the run's `routing.current.json` while one is), `persona` from `apps/supervisor/personas.json` (shipped: a display name per role; the sprites are EP-30's), `live_state` (CAP-8; `offline` until then), `current_run` and `current_story` when the role has a live leg, and `jira_account` empty (EP-31's). The table is derived only: the plugin and onboarding are not changed, it is never edited by hand, and a project the host registry drops disappears on the next rebuild.
- **CAP-7** (29.2)
  - **intent:** Every consumer reads the registry by the same route and sees the same ids.
  - **success:** `GET /agents` (bearer or session cookie) and `GET /agents?project=<id>` list the rows with the time of the rebuild; an unknown project answers an empty list; the read-only status page gains an "Agents" section listing them per project; `bun test` pins the mapping from a resolved route, the rebuild on tick, claim and end, and the two routes; `apps/supervisor/README.md` documents the table and the routes.
- **CAP-8** (29.3)
  - **intent:** Each registry agent's state is derived into the office vocabulary by one mapping table.
  - **success:** From the queue's events of a run and the engine's journal in the run's served root (`.bmad-loop/runs/<engine run id>/` at the bmad-loop pin of `bmad.lock`, read from the host side of the worktrees mount, never through the engine; the planner's Code Map names the exact files and kinds), each agent gets one of `offline`, `idle`, `thinking`, `reading`, `typing`, `running`, `waiting-for-human`, `blocked`, with the overlays `done` and `failed` per story, by one mapping table in `apps/supervisor/src/office.ts`: queued or lock-wait `idle`; the launch and planner legs `thinking`; a dev session's implementer `typing` and its reviewers `reading`; the verify and host-verify legs `running`; `paused`, `awaiting-ruling` and an `escalate` `waiting-for-human`; a `blocked` run `blocked`; no run `offline`. Promotion is instant, demotion goes through a grace timer (20 s, injectable), and `waiting-for-human` never expires on its own.
- **CAP-9** (29.3)
  - **intent:** Progress per story and per epic is derived from the journal over a fixed denominator.
  - **success:** Over a run's stories (the spec folder's manifest at the run's base, the denominator fixed when the launch validated it), the journal's terminal kinds (a story landed, failed, deferred) give `done / total` per story and per epic with the current story named; the quote band of §7.1 is not computed here (EP-32's).
- **CAP-10** (29.3)
  - **intent:** A consumer reads the office as a snapshot or follows it as a stream.
  - **success:** `GET /office` answers a snapshot (the agents with their states, the live runs with story and epic progress, the time). `GET /office/events` with `Accept: text/event-stream` sends the snapshot first, then one event per state or progress change (`office.agent`, `office.progress`, `office.run`), honours `Last-Event-ID` (a reconnect replays from that seq, the snapshot again when it is too old), sends a heartbeat comment every 10 s, and closes cleanly on the client's close; the raw `GET /events` stream is unchanged. `bun test` pins the mapping table against recorded event and journal fixtures, the grace timer with an injected clock, the snapshot-then-deltas order, the replay and the heartbeat; the read-only status page shows each live run's agent states as text.
- **CAP-11** (29.4)
  - **intent:** The driver contract names the studio web as a consumer and the new surfaces as the supervisor's.
  - **success:** `plugins/tk-studio/contracts/driver-contract.md` takes a minor (additive) bump, the next after Story 28.6's, that names the studio web among the consumers in §1 and documents, as supervisor surfaces consumed by the web and never plugin surfaces, the account (`POST /auth/account`, `POST /auth/signin`), the registry (`GET /agents`) and the projection (`GET /office`, `GET /office/events`, the three `office.*` event kinds and the eight states); nothing in the plugin's own surfaces changes; conformance is green and the lib suite is green.
- **CAP-12** (29.4)
  - **intent:** The operator's runbook and the supervisor's README match the code.
  - **success:** Runbook §4.5 (the smoke test) signs in with the account and keeps the token path for `curl`; §4.2's table drops the OAuth rows and names nothing new that is a secret (the account record is the store's); §7's smoke table gains the `/agents` and `/office` answers; the README's API table and environment table match the code; `tk-studio doctor` is unchanged.

## Constraints

- Rulings in force, not reopened: the 2026-09-26 and 2026-10-09 rulings, O5, AD-2 (the supervisor stays outside the plugin; the plugin publishes the contract), AD-3 (credentials only in the per-user store, the OS store or the environment), AD-21, AD-22, and the design spec's D1 to D10 (D7 one account, username and password, no external providers; D8 no API-key fallback; D10 tailnet by default).
- Nothing in this epic is a web page: the read-only status page stays the no-JavaScript fallback and gains text sections only; the stream has §6.3's shape (snapshot then deltas, `Last-Event-ID`, a heartbeat under 15 s) so EP-30's web can consume it.
- Credentials: the account record lives only in the per-user store under `supervisor/` (never a checkout, never the queue file); no answer, event, log line, page or worker environment carries a password, a hash, the session secret or the bearer token; the worker environment strips every `TK_SUPERVISOR_*` secret (DW-17: the notifier's credentials never reach a worker, unchanged).
- The registry is derived only (never hand-edited; the plugin and onboarding unchanged); the projection reads the engine's journal from the host side of the worktrees mount, never through the engine; the raw `GET /events` stream is unchanged.
- Driven by the supervisor's own queue on this repository: `POST /jobs` with the declared `run-epic-29` job, a worktree, the engine in `claude-tk-studio`, `tools/verify_host.py` as the host verify leg; `bun test` from `apps/supervisor` is the dev session's own gate (Story 28.6); the supervisor tab keeps running and the engine edits a worktree, never the checkout.
- Every surface ends headless runs with the status block (AD-11); conformance gates every story (AD-19); the contract change is a minor, additive bump and nothing in the plugin's own surfaces changes; the lib suite makes no network call.

## Non-goals

- Web pages and the office renderer, the persona's sprites included (EP-30).
- `jira_account` (EP-31) and the quote band (EP-32).
- A public-exposure mode (D10: documented later, not built).
- Multi-user, sign-in through any external provider, and any API-key tier (D7, D8).
- Changes to the plugin's own surfaces, to onboarding, or to `tk-studio doctor`.

## Success signal

- On the box, the first visit creates the account and a username and password sign the owner in while the old provider routes answer 404; `GET /agents` lists each served project's seven roles with the routed models; while a run moves, `GET /office/events` delivers a snapshot, then `office.*` deltas with a heartbeat every 10 s and a replay on reconnect; the driver contract names the studio web and the supervisor surfaces; `bun test`, `tools/verify_host.py`, the lib suite and conformance are green.

## Assumptions

- The fixed delay on a sign-in mismatch has no number in the input: 500 ms, injectable so `bun test` does not wait; an operator may change it.
- The lockout window is derived from the queue's `service_events` rows (the refusals CAP-3 records) over the last fifteen minutes, so it survives a `serve` restart without a new field in `account.json`, whose record stays exactly `{username, hash, created_at}`.
- Answer shapes for the account routes follow the API's existing split: a browser form submission (`application/x-www-form-urlencoded`) gets the HTML sign-in page with a generic line at the named status, a JSON body gets `{ok:false, error:"<AccountExists|SignInRefused|AccountLocked>"}` as every other refusal; a successful sign-in answers 303 to `/` with the cookie, as `POST /auth/token` does.
- Story 28.6 (contract 0.1.23) has not landed in this tree at launch (the header reads 0.1.22, no 28-6 spec): CAP-11's bump is the next unused patch number in the contract header when 29.4 runs.
- The session cookie's `sub` for an account session is `account:<username>` (token sessions carry `token`); the cookie's shape, flags and 7-day lifetime are Story 22.5's, unchanged.
- `bun` is not on this launch host's PATH; the dev session's `bun test` runs in the engine sandbox provisioned with `WITH_BUN=1` (runbook §3.8); a session without `bun` records that gate `unverifiable-here` with the agent-PC command rather than halting.

## Open Questions

- The epic narrative names the 2026-09-01 office decisions at `research/studio-office-ui-2026-09-01/`; the tree holds them at `_bmad-output/planning-artifacts/research/studio-office-ui-2026-09-01/digest-studio-office-ui.md` (adopted as the companion). Is that the intended file, or is there an unfiled decisions record the mapping of CAP-8 must follow?
- CAP-9's "deferred" terminal kind: if the pinned bmad-loop's journal carries no distinct kind for a deferred story, which queue or spec signal stands in for it in the progress count? (29.3's planner reads the journal at the pin and names the kinds.)
