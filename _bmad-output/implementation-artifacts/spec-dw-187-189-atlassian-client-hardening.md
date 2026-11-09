---
title: 'DW-187, DW-189: Atlassian client hardening (connect retry, published scopes)'
type: 'bugfix'
created: '2026-11-08'
status: 'done'
baseline_revision: '781376e4bc96d7116b6b6f9fbe63425c6733ca22'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deviation_score: 1
deferred: []
reconcile_verdict: not-required
---

<intent-contract>

## Intent

**Problem:** (DW-187) One transient connection-level failure to api.atlassian.com (URLError, socket timeout, WinError 10060) makes the plan-status pass write `blocked` with no retry — a false alarm, and the story's `in-progress` never reaches Jira. (DW-189) Four setup/publish calls carry the wrong scope, so a 403 names a scope the token already has and the operator recreates a token that fails the same way.

**Approach:** Retry connection-level failures inside the Jira client's default HTTPS transport a bounded number of times with a short back-off before raising `cannot reach …`, naming the retry count in the reason when it still fails. Put the published scope on each of the four calls; the 403 message shape is unchanged.

## Boundaries & Constraints

**Always:** stdlib only; the retry is bounded (2 retries, back-off 1 s then 2 s, via `self.sleep` so tests never wait); an HTTP status answer (HTTPError: 4xx/5xx incl. 429) is never retried by this loop (429 keeps its existing `send_with_retry`); the proxy-approval refusal (`proxy_refusal`) is never retried and never gains a retry count; a non-JSON 2xx is not retried; the 403 text produced by `auth_failure` keeps its exact shape (`… the <TOKEN_ENV> token lacks <scope> — create a new scoped token …`); every `open()`/subprocess in touched code names `encoding="utf-8"` (AGENTS.md).

**Block If:** the fix needs a change to `apps/supervisor/src/planstatus.ts` or the driver contract/conformance schemas (it should not: only the reason text changes).

**Never:** edit the deferred-work ledger; change Confluence's transport (DW-187 names the Jira plan-status call only); retry inside `send_with_retry`; change `auth_failure`'s wording; touch remotes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Transient | urlopen raises URLError(WinError 10060) once, then answers 200 | request returns 200 data; one sleep of 1 s | none |
| Persistent | urlopen raises URLError / `TimeoutError` / `socket.timeout` on every attempt | 3 attempts, sleeps [1, 2]; `JiraError("cannot reach <site> after 2 retries: <exc>")` | plan-status reason carries `after 2 retries` |
| Proxy refusal | URLError with `Approval required for api.atlassian.com:443` | 1 attempt, no sleep; network-approval reason, no `cannot reach`, no retry count | unchanged |
| HTTP error | urlopen raises HTTPError 403/500 | 1 attempt; status returned as today | unchanged |
| 403 on `/statuses/search`, `POST /project` | 403 body | reason names `manage:jira-configuration` | message shape unchanged |
| 403 on `/workflow/search` | 403 body | reason names `manage:jira-project` | message shape unchanged |
| 403 on v1 attachment PUT | 403 body | reason names `write:attachment:confluence` and `read:content-details:confluence` | message shape unchanged |

</intent-contract>

## Code Map

- `plugins/tk-studio/lib/jirabackend.py:1309-1313` -- scope constants (`SCOPE_PROJECT`=manage:jira-project, `SCOPE_CONFIGURATION`=manage:jira-configuration, `SCOPE_READ`=read:jira-work).
- `plugins/tk-studio/lib/jirabackend.py:226-260` -- `auth_failure`: 403 text `lacks {scope}` (read-only; do not change).
- `plugins/tk-studio/lib/jirabackend.py:263-273` -- `proxy_refusal` (read-only).
- `plugins/tk-studio/lib/jirabackend.py:434-460` -- `JiraClient._http`: urlopen(timeout=30); `except (URLError, OSError)` → proxy check → `JiraError("cannot reach {self.site}: {exc}")`. The retry loop goes here (HTTPError is caught earlier and returns; `JiraError` from non-JSON 2xx is not an OSError). `self.sleep` (set in `__init__`, :408) is the injectable wait.
- `plugins/tk-studio/lib/jirabackend.py:290-296` -- retry constants area: add e.g. `CONNECT_RETRY_DELAYS = (1, 2)` beside `RETRY_DELAYS`.
- `plugins/tk-studio/lib/jirabackend.py:1584-1585` -- `create_project` `POST /project` scope `SCOPE_PROJECT` → `SCOPE_CONFIGURATION`.
- `plugins/tk-studio/lib/jirabackend.py:1642-1644` -- `find_statuses` both `/statuses/search` calls `SCOPE_READ` → `SCOPE_CONFIGURATION` (leave `/project/{key}/statuses` at `SCOPE_READ`).
- `plugins/tk-studio/lib/jirabackend.py:1704-1707` -- `find_workflow` `/workflow/search` `SCOPE_READ` → `SCOPE_PROJECT`.
- `plugins/tk-studio/lib/confluence.py:39-42,359-367` -- `upload_attachment` v1 PUT uses `SCOPE_ATTACHMENT`; add a constant naming both (e.g. `SCOPE_ATTACHMENT_V1 = "write:attachment:confluence and read:content-details:confluence"`) and use it there only.
- `plugins/tk-studio/lib/plansync.py:871-980` -- `status_pull_back` (the `status` verb = plan-status) → `sync()` → Jira backend via `jirabackend.client_for` (:1218); failures surface as `reason` — no change needed, the retry lives in the client.
- `plugins/tk-studio/lib/tests/test_jirabackend.py:1175-1211` -- `ProxyConnectRefusalTests`; `test_other_connect_failure_still_cannot_reach` now retries — set `client.sleep` to a recorder so it never really sleeps.
- `plugins/tk-studio/lib/tests/test_tracking_setup.py:1104,1117`, `tests/test_publish.py:364`, `tests/test_drift_check.py:565` -- other tests patching `urllib.request.urlopen`; check each that raises URLError through a JiraClient and keep them from really sleeping (patch `jirabackend.CONNECT_RETRY_DELAYS`/`time.sleep` or the client's sleep) and still green.
- `plugins/tk-studio/lib/tests/test_tracking_setup.py:191,204` -- fake transport serving `/statuses/search`, `/workflow/search`; tests there or in `test_jirabackend.py` can pin the scope via a 403 answer.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/jirabackend.py` -- add `CONNECT_RETRY_DELAYS = (1, 2)`; in `JiraClient._http` loop over attempts: on `URLError`/`OSError` that is not a proxy refusal, sleep `CONNECT_RETRY_DELAYS[i]` via `self.sleep` and retry; after the last, raise `JiraError(f"cannot reach {self.site} after {n} retries: {exc}")`; change the four scopes listed in the Code Map -- DW-187, DW-189.
- `plugins/tk-studio/lib/confluence.py` -- v1 attachment upload names both scopes -- DW-189.
- `plugins/tk-studio/lib/tests/test_jirabackend.py` -- tests for every I/O-matrix row: transient-then-ok, persistent (assert attempt count 3, sleeps `[1, 2]`, reason contains `cannot reach` and `after 2 retries`), `TimeoutError`/`socket.timeout` retried, proxy refusal not retried (1 attempt, no sleep), HTTPError not retried; a 403 scope pin for each of `find_statuses` (`manage:jira-configuration`), `create_project` (`manage:jira-configuration`), `find_workflow` (`manage:jira-project`), each also asserting the unchanged shape (`token lacks <scope> — create a new scoped token`) -- pin the fix.
- `plugins/tk-studio/lib/tests/test_publish.py` (or the existing Confluence test module) -- 403 on `upload_attachment` names `write:attachment:confluence` and `read:content-details:confluence` with the unchanged shape -- pin DW-189.
- Any other test that now really sleeps or changes outcome because of the retry -- inject a no-op sleep; keep assertions.

**Acceptance Criteria:**
- Given the plan-status pass (`plansync.py status`) whose Jira call hits a connection failure on every attempt, when it ends, then the result is `blocked` with a reason containing `cannot reach` and `after 2 retries`, and the Jira client made 3 attempts.
- Given one transient connection failure followed by success, when the plan-status Jira call runs, then it does not end `blocked` on that failure.
- Given the full lib suite and conformance, when run, then both pass.

## Spec Change Log

## Review Triage Log

### 2026-11-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1 (high 0, medium 1, low 0)
- defer: 0
- reject: 3 (high 0, medium 0, low 3)
- addressed_findings:
  - `[medium]` `[patch]` Connect retry re-sent non-idempotent writes after a response-phase (bare) timeout/OSError (blind-hunter + edge-case-hunter). Fix: `URLError` (connect/send phase) retried for every method; bare OSError/timeout retried only for GET/HEAD (`IDEMPOTENT_METHODS`), otherwise `cannot reach <site>: <exc>` at once; two POST tests added.
- rejected: SSL/unknown-URL `URLError` also retried (low: 3 s, reason still names the error); OSError in `exc.read()` now reads `cannot reach` (low: was an uncaught traceback); many requests each timing out once could pass the 300 s guard (low: every request is individually bounded, a pass-level cap is a design number outside this intent); "DW-188 missing" (the bundle is DW-187 and DW-189 only).

## Design Notes

The retry lives in `JiraClient._http` (the default transport), not in `send_with_retry`, because injected test transports answer `(status, body)` and never raise connection errors; the default transport is the only place a URLError originates. Worst case per failing request is 3×30 s urlopen timeout + 3 s back-off, inside the job's 300 s guard. Confluence's client is left alone: DW-187 names only the Jira plan-status call.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && timeout -k 5 900 uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && timeout -k 5 900 uv run python ../contracts/conformance/runner.py run` -- expected: `"ok": true`

## Deviation Summary

### pass 1 (2026-11-08)

- planned: the retry loop goes inside `JiraClient._http` / actual: `_http` is the retry loop; the single urlopen attempt moved to a new private `JiraClient._http_once`; transport behaviour unchanged / why: keeps HTTPError and non-JSON paths outside the loop so neither can be retried / may affect: none
- planned: test edits = new tests plus no-op sleeps, existing assertions kept / actual: `tests/test_tracking_setup.py::test_scope_403_on_a_create_names_the_scope` assertion changed `manage:jira-project` → `manage:jira-configuration` / why: it pinned the old wrong `POST /project` scope the spec changes / may affect: none
- planned: tests for I/O-matrix rows and scope pins / actual: also a non-JSON-2xx-not-retried test, two `status_pull_back` end-to-end tests, and a `_urlopen_over` helper in `test_jirabackend.py` / why: Boundaries and ACs need them / may affect: none

DRIFT: `_http` split into retry loop + `_http_once` — keeps non-retryable paths out of the loop — affects: none
DRIFT: `test_scope_403_on_a_create_names_the_scope` now pins `manage:jira-configuration` — it pinned the scope DW-189 corrects — affects: none
DRIFT: extra tests (non-JSON 2xx, plan-status end-to-end, helper) — needed to prove Boundaries and ACs — affects: none

consult: accepted, score 1

## Consult Log

- 2026-11-08T22:07:14Z — trigger: deviation-gt-0 — question: accept the implementer's three score-1 deviations (`_http_once` split, corrected create-project scope assertion, extra tests)? — ruling: accept-deviation score 1 — do: Keep all three entries as implemented, with no undo and no relaunch; Record the ruling in the spec's Deviation Summary as "consult: accepted, score 1". — rule candidate: In deferred-work specs, "existing assertions kept" never covers an assertion that pins the exact value the spec corrects. Updating such an assertion to the corrected value is in scope and not a deviation.

### pass 2 (2026-11-08, review patch)

DEVIATIONS: none (score 0)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261108T202640Z-af3d56` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** DW-187: `JiraClient._http` now retries a connection-level failure twice (back-off 1 s, 2 s) before `cannot reach <site> after 2 retries: <exc>`. A `URLError` is retried for any method; a bare response-phase timeout/OSError only for GET/HEAD. The proxy refusal, HTTP answers and non-JSON 2xx are never retried. The plan-status pass (`plansync status`) inherits this. DW-189: `/statuses/search` and `POST /project` carry `manage:jira-configuration`, `/workflow/search` carries `manage:jira-project`, and the Confluence v1 attachment PUT names `write:attachment:confluence and read:content-details:confluence`. The 403 message shape is unchanged.

**Files changed:**
- `plugins/tk-studio/lib/jirabackend.py`: `CONNECT_RETRY_DELAYS`, `IDEMPOTENT_METHODS`, `_http` retry loop over the new `_http_once`, four scope corrections.
- `plugins/tk-studio/lib/confluence.py`: `SCOPE_ATTACHMENT_V1` on the v1 upload.
- `plugins/tk-studio/lib/tests/test_jirabackend.py`: `ConnectRetryTests`, `ConnectRetryPlanStatusTests` (end-to-end through `status_pull_back`), `PublishedScopeTests`, a no-op sleep in an existing test.
- `plugins/tk-studio/lib/tests/test_publish.py`: `AttachmentScopeTests`.
- `plugins/tk-studio/lib/tests/test_tracking_setup.py`: the create-project 403 assertion now pins `manage:jira-configuration`.

**Review:** 1 patch applied (medium), 0 deferred, 3 rejected. Follow-up review: patched high 0, medium 1, low 0; score 3×1+0 = 3 → `followup_review_recommended: false`.

**Verification:** `uv run python -m unittest discover tests` → 3061 tests OK (4 skipped); `uv run python ../contracts/conformance/runner.py run` → `ok: true`. Every I/O-matrix row has a passing test.

DRIFT: `_http` split into retry loop + `_http_once` — keeps non-retryable paths out of the loop — affects: none
DRIFT: `test_scope_403_on_a_create_names_the_scope` now pins `manage:jira-configuration` — it pinned the scope DW-189 corrects — affects: none
DRIFT: extra tests (non-JSON 2xx, plan-status end-to-end, helper) — needed to prove Boundaries and ACs — affects: none

**Residual risks:** a request whose connect phase keeps failing now takes up to ~93 s (3×30 s timeout + 3 s back-off); a pass where many requests each time out once could approach the job's 300 s guard. The Confluence client keeps its single-attempt transport (out of DW-187's scope). The scope corrections follow the published scope lists (kb/atlassian-free-tier.md item 5) and were not exercised against a live token here.

## Reconcile

- 2026-11-08 — score 1; reconcile not required.
- Spec resolution: unit key `dw-atlassian-client-hardening` has no `spec-<key>.md`; used the engine's recorded `spec_file` for this unit (run 20261108-202816-6452 state.json), `spec-dw-187-189-atlassian-client-hardening.md`.
- Part B note: this unit is a sweep DW bundle (DW-187, DW-189), not a `stories.yaml` story. No manifest entry, plan file or `epics.md` story section names it, so task-planning §2–4 has nothing to act on. Spot-check of the spec's ACs instead: AC1 `ConnectRetryPlanStatusTests.test_persistent_failure_blocks_after_two_retries` (test_jirabackend.py:1373) plus `ConnectRetryTests.test_persistent_failure_names_the_retry_count` (:1270, 3 attempts, sleeps [1, 2]); AC2 `test_one_transient_failure_does_not_block` (:1385) and `test_transient_failure_then_ok_returns_the_data` (:1260); AC3 per the Auto Run Result (3061 OK, conformance `ok: true`), plus this session's rerun of `tests.test_jirabackend`, `tests.test_publish`, `tests.test_tracking_setup` (263 OK). DW-189 scope pins: `PublishedScopeTests` (:1420–1432), `AttachmentScopeTests` (test_publish.py:445). The scopes against a live token are unverifiable-here.
Gate: Part A not-required (score 1); Part B not applicable: sweep DW bundle, not a stories.yaml story (no manifest entry, no plan, no next story to plan); the spec's ACs were spot-checked as met (focused suites rerun green)
