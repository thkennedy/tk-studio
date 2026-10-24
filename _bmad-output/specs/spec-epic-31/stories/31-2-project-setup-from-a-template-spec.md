---
title: 'Project Setup From a Template'
type: 'feature'
created: '2026-10-24'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: adjust-stories
baseline_revision: '6ef38d37368b03740b761c454e75c94f2b7275bb'
context:
  - '{project-root}/_bmad-output/specs/spec-epic-31/plans/31-2.md'
  - '{project-root}/kb/atlassian-free-tier.md'
warnings: [oversized]
deferred:
  - summary: >-
      kb/atlassian-free-tier.md §1 step 5 omits the Confluence write:space and write:folder scopes that tracking setup's space and folder creates need.
    evidence: |-
      confluence.py:31-32 sends POST /spaces and the folder creates as needing write:space:confluence and write:folder:confluence. kb §1 step 5 (and §2 Q3) lists only the read/write page, read space and attachment scopes for TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN. A token built from the record therefore meets a scope 403 on the first live setup's space create (AC1). Setup names the missing scope as designed, but the operator's instructions are incomplete. The fix belongs in 31.1's record, outside 31-2's Files.
    location: >-
      kb/atlassian-free-tier.md:21
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Story 31.2 (epics.md, ST-116): "As the operator, I want onboarding a project to create its Confluence space and its linked Jira project from a studio template, so that every studio-managed project has the same folders, the same statuses and the same two users (§6.8 a)." Today the Jira adapter speaks only `JIRA_*` against the site URL, which a scoped token cannot use (kb/atlassian-free-tier.md §2 Q3), and there is no Confluence client and no setup step.

**Approach:** A `plansync.py setup` verb (the planning adapter's front door, AD-4) sequences `jirabackend` (moved onto the `TK_ATLASSIAN_*` names and the `api.atlassian.com` gateway, legacy `JIRA_*` kept) and a new `lib/confluence.py`. Each step is recognised by key first and created only when absent. Whatever the API refuses becomes a numbered owner step and the run ends `partial`. `tk-studio-onboard` gains the optional "Set up tracking" step that calls the verb and relays its block. The contract goes to 0.1.26.

**Acceptance criteria (verbatim, epics.md Story 31.2):**
- AC1: **Given** a registered project, the site's URL and the two tokens in the environment **When** `tk-studio-onboard` is asked to set up tracking (a new optional step, refused with a named reason when the tokens are absent) **Then** the planning adapter's Jira binding creates the Jira project from the template (key from the project id, issue types epic and story, the workflow with `To Do`, `In Progress`, `Blocked - Awaiting User`, `Block Resolved`, `Done`), the linked Confluence space with the folder structure for the design pages (brief, GDD, scope of work, decisions, records), the saved filter "Needs you" (`status = "Blocked - Awaiting User" ORDER BY priority DESC, updated ASC`), and records the keys and ids under `.tk-studio/config.yaml`'s planning binding; every step the API cannot do on the free plan (31.1's findings) is printed as an exact, numbered instruction for the owner and the run ends `partial` naming them, never `complete`
- AC2: **Given** a project set up **When** setup runs again **Then** it is idempotent: existing space, project, statuses and filter are recognised by key and left as they are, and the result names what it found; `bun test`-free: the lib suite covers the template, the idempotence and the refusals with a fake Atlassian REST

**Story notes carried from 31-1 (gate 2026-10-24, binding):**
- "The two tokens in the environment" means one token per seat. Setup uses only the agent seat's variables: `TK_ATLASSIAN_SITE`, `TK_ATLASSIAN_AGENT_EMAIL`, `TK_ATLASSIAN_AGENT_TOKEN` (Jira), `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN` and `TK_ATLASSIAN_CLOUD_ID` (kb §1 step 7). It never reads the owner's token. A refusal names each absent variable.
- Routing:
  - Jira goes through `https://api.atlassian.com/ex/jira/<cloud id>`.
  - Confluence goes through `https://api.atlassian.com/ex/confluence/<cloud id>/wiki/api/v2`, and never the site URL.
  - Either agent token set without `TK_ATLASSIAN_CLOUD_ID` refuses by name. It never falls back to the site URL.
  - `JIRA_*` plus the site URL remain the legacy path, used only when `TK_ATLASSIAN_AGENT_TOKEN` is unset.
- Error reporting:
  - A 401 is named as the token, its email, its expiry or the org API-token toggle, never as a missing scope.
  - A 403 whose body is the proxy's `Approval required for <host>:443` is the network approval step.
  - Any other 403 on a create names the missing scope and asks for a new token.
- Setup records the owner seat's `accountId` (31.5 and 31.7 depend on it).
- The two statuses and their transition are created over REST on a company-managed project. On a team-managed project, or on any refusal, setup prints the exact numbered browser steps for that project's type and verifies them with `GET statuses/search`.

## Boundaries & Constraints

**Always:**
- Stdlib-only Python run via `uv run` (NFR9).
- Writes are atomic.
- Every CLI `main()` calls `sys.stdout.reconfigure(encoding="utf-8")`.
- Exit codes: 0 ok, 2 refusal, 1 error. Never prompt, and every result ends with the AD-11 status block.
- No token value in a command, event, file, exception message or test fixture of a real form.
- Before the binding is written, `configlib.assert_tracked_safe` checks it.
- Every Atlassian call goes through `jirabackend`/`confluence` behind `plansync.py` (AD-4).
- Keep `/rest/api/2` through the gateway (plan ruling).
- `JiraClient`'s current constructor keeps working for `migrate.py` and `plansync.py`.
- Contract 0.1.26 is additive and updated in this story (AD-19).
- Each refusal ends `blocked` before any Atlassian call: an unregistered project, an absent agent token, an absent cloud id, or `TK_ATLASSIAN_SITE` absent on first setup.

**Block If:**
- The AC can be met only by a write that bypasses the adapter (AD-4), by reading the owner's token in the sandbox, or by writing a token to config (AD-3).
- The Files list in plans/31-2.md must grow past its 13 entries.
- The conformance runner cannot be made deterministic for onboard's new drive without changing `runner.py`.

**Never:**
- Move promote to REST v3.
- Make `sync` fall back to `TK_ATLASSIAN_SITE`.
- Change `pull_back`/`promote` behaviour.
- Read `TK_STUDIO_ATLASSIAN_OWNER_*`.
- Touch `apps/**`, `migrate.py` (beyond a forced one-line call update, which would be DRIFT), this repo's own `.tk-studio/config.yaml` (no live setup), `runner.py`, epics.md, stories.yaml or the planning artifacts.
- Make a live network call in a test.
- Add publish logic to `confluence.py` (31.3 owns it).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First setup, company-managed | registered project `tk-studio`, five agent vars, fake REST empty | project `TKSTUDIO` created (software, company-managed), Epic/Story found, two statuses + transition created, filter "Needs you" created with the AC JQL verbatim, space `TKSTUDIO` + folders Brief, GDD, Scope of Work, Decisions, Records created, owner id resolved; binding written; `complete` only if every step created or found | `created[]`, `found[]`, `written[]` |
| Re-run | same state after a first setup | nothing created; `found[]` names project, statuses, filter, space, folders; config unchanged | `created: []` |
| Team-managed project, or a refused status/transition/project/space/folder create | fake answers team-managed, or 4xx on create | numbered browser steps for that project type in `owner_steps[]` and in `reason`; statuses verified via `GET statuses/search`; run ends `partial` | never `complete` |
| Owner id unknown | none recorded, no `--owner-account-id`, no `--owner-email` | numbered owner step (read id from profile, rerun with `--owner-account-id`) | `partial` |
| Owner id paths | recorded value / `--owner-account-id` / `--owner-email` lookup via `_find_account` | that order wins | lookup miss → owner step, `partial` |
| Refusals | unregistered project; any of the agent vars absent; cloud id absent with a token set | `blocked`, reason names each absent variable or the registry gap | exit 2, zero transport calls |
| 401 | fake answers 401 | names token, `TK_ATLASSIAN_AGENT_EMAIL`, expiry, org toggle; never "scope" | error by name |
| Proxy 403 | 403 body `Approval required for api.atlassian.com:443` | names the network approval step (kb §1 step 8) | error by name |
| Scope 403 | other 403 on a create | names the missing scope, asks for a new token | error by name |
| Dry run | `--dry-run` | no POST/PUT, no config write | `written: []` |
| Legacy Jira | `TK_ATLASSIAN_AGENT_TOKEN` unset, `JIRA_*` set | today's site-URL path unchanged | existing tests green |

</intent-contract>

## Code Map

The investigation is `_bmad-output/specs/spec-epic-31/plans/31-2.md` §Code Map. Read it in full: it has the line anchors, the setup sequence (steps 1-9), the endpoints to pin in the fake, the refusals, the onboard, contract and conformance edits, the test environment and the conventions. The anchors were re-checked on 2026-10-24.

- `plugins/tk-studio/lib/jirabackend.py`: the constants are at :53-55 and `JiraClient.__init__` at :138. `_http` (:147) and `request` (:165) carry the 401/403 split. `preflight` (:192) captures the `accountId`. `_find_account` (:355) is the owner lookup. `_resolve_settings` (:489) reads the `TK_ATLASSIAN_*` names with the legacy fallback.
- `plugins/tk-studio/lib/plansync.py`: `main` is at :846 and the sub-parsers at :853-863 (add `setup`). The caller `jirabackend.project` is at :648.
- `plugins/tk-studio/lib/migrate.py:252-282` (`_flip_binding`) and `lib/recommend.py:175-245` (`record`) are the text-edit write patterns. `lib/config.py:72` is `assert_tracked_safe`, `:279-314` is `_TRACKED_TEMPLATE`, and `lib/registry.py:85` is `read_project`. All three are read-only except the template comment.
- `plugins/tk-studio/lib/tests/test_jirabackend.py`: `FakeJira` is at :39-120 and routes on `API_PREFIX`. `ENV_KEYS` is at :124, and the test at :189 must stay green. `test_migrate.py:49` has the same `ENV_KEYS`. Clear all five agent names in both.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: the `**0.1.25**` header asserts at :378, :463, :507 and :559 move to 0.1.26. The earlier clauses stay in order.
- `plugins/tk-studio/contracts/driver-contract.md`: the header is at :5, the onboard row at ~:282 and the plan-sync row at ~:285.
- `plugins/tk-studio/contracts/conformance/manifest.json:72-86`: the onboard entry. `runner.py:197` (an `auth_preflight` of "none" is refused when `external_calls` is true) and `:225` (`os.environ`) are read-only.
- `plugins/tk-studio/skills/tk-studio-onboard/SKILL.md`: the steps are at :30-39, the report at :73-83, and the unrunnable-core paragraph at :85 (keep it). `skills/tk-studio-plan-sync/SKILL.md:43-46`: the auth names.
- The SPEC.md Design notes already carry Settled shapes 1 and 2 (CAP-3 bullets), so SPEC.md needs no edit.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/jirabackend.py`: add the gateway base (`for_gateway` or a keyword) and the agent env names, the refusals by name, and the 401 / proxy-403 / scope-403 split. Capture the agent `accountId` in `preflight`, and add the setup helpers (project, issue types, statuses and transition, filter). This is the Jira half of AC1.
- `plugins/tk-studio/lib/confluence.py` (new): the gateway-only `ConfluenceClient` with the same transport seam and error split, plus find-or-create for the space and folders. It has no publish logic. This is the Confluence half of AC1.
- `plugins/tk-studio/lib/plansync.py`: the `setup` verb (`--directory`, `--dry-run`, `--owner-account-id`, `--owner-email`) implements plan steps 1-9. Its result carries `found[]`, `created[]`, `owner_steps[]` and `written[]`, ending `complete`, `partial` or `blocked`. It writes the binding under `planning.jira` and `planning.confluence` (Settled shape 1). This covers AC1 and AC2.
- `plugins/tk-studio/lib/config.py`: update the `_TRACKED_TEMPLATE` comment to the `TK_ATLASSIAN_*` names and the new keys.
- `plugins/tk-studio/lib/tests/test_tracking_setup.py` (new): `FakeAtlassian` (subclasses `FakeJira` and adds Confluence v2 routes) drives every row of the I/O matrix. This is AC2's "lib suite covers".
- `plugins/tk-studio/lib/tests/test_jirabackend.py`: add the five names to `ENV_KEYS`, plus the gateway URL, the cloud-id refusal, the legacy fallback and the 401/403 split cases.
- `plugins/tk-studio/lib/tests/test_migrate.py`: `ENV_KEYS` only.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: the 0.1.26 header and the new clause and rows.
- `plugins/tk-studio/skills/tk-studio-onboard/SKILL.md`: the optional "Set up tracking" step (payload `tracking: true`) calls `plansync.py setup` and relays its block, with `partial` and the owner steps verbatim. The report gains the `partial` path.
- `plugins/tk-studio/skills/tk-studio-plan-sync/SKILL.md`: the auth names and the `setup` verb.
- `plugins/tk-studio/contracts/driver-contract.md`: the 0.1.26 header clause (additive; it opens the epic's entry), the onboard row (`tracking?`, the core, the binding, the refusals) and the plan-sync row (`setup`, the `TK_ATLASSIAN_*` gateway auth with the legacy fallback).
- `plugins/tk-studio/contracts/conformance/manifest.json`: onboard gets `external_calls: true` and a real `auth_preflight`, plus a `blocked-on-ambiguity` drive `plansync.py setup --directory {sandbox}` whose marker is the unregistered-project refusal.

**Acceptance Criteria:**
- Given the five agent names unset, when `uv run plugins/tk-studio/lib/plansync.py setup --directory .` runs from the root, then it ends `blocked`, names each absent variable and makes no network call.
- Given the fake REST, when the lib suite runs, then the template, the idempotence, every refusal, the 401/403 split, the `partial` paths, the owner-id paths and the dry run are each asserted.
- Given the contract at 0.1.26, when conformance runs, then `ok: true`.

## Spec Change Log

## Review Triage Log

### 2026-10-24 — Review pass
- layers: blind-hunter (10 findings) and edge-case-hunter (9 findings) both ran (band L); 14 after deduplication
- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 0, medium 6, low 6)
- defer: 0
- reject: 2: (high 0, medium 1, low 1)
- addressed_findings:
  - `[medium]` `[patch]` the five-status template workflow was never verified (`TEMPLATE_STATUSES` unused); a missing `To Do`/`In Progress`/`Done` is now a numbered owner step and the run ends `partial`
  - `[medium]` `[patch]` `POST /statuses` sent scope PROJECT on company-managed; now GLOBAL per kb §2 Q1, and the rerun recognises global and owner-made statuses
  - `[medium]` `[patch]` `find_workflow` took `values[0]` of a substring search and could update another project's workflow; now requires an exact name match, otherwise it writes nothing and emits the transition owner steps
  - `[medium]` `[patch]` a binding-write failure escaped the AD-11 status block (a traceback on `ClassificationError`); now ends `blocked` with the block, naming every id created this run; a `planning:` block not in two-space steps is refused before any call
  - `[medium]` `[patch]` the proxy's `Approval required for` arriving as a CONNECT `URLError` was reported as "cannot reach"; it is now the network approval step in both clients
  - `[medium]` `[patch]` paged lists (Confluence direct-children and spaces; Jira statuses, workflows and filters) read only the first page, so folders could be duplicated on rerun; cursors are now followed
  - `[low]` `[patch]` the plan-sync skill derived `complete` from exit 0; it now relays the core's own `status` and maps the `setup?` payload to the verb's flags
  - `[low]` `[patch]` a dry run that would create things ended `complete`; it now ends `partial` and names them in `would_create[]` (published in contract 0.1.26 per the consult)
  - `[low]` `[patch]` "Needs you" was adopted by name alone; it now needs the exact JQL and prefers the agent seat's filter
  - `[low]` `[patch]` the owner email lookup did not name `read:jira-user` on a 403 and reused promote's note; a dedicated `lookup_owner` fixes both
  - `[low]` `[patch]` added tests for a refused `POST /filter` and for missing Epic/Story issue types, each becoming owner steps (`partial`)
  - `[low]` `[patch]` a 200 `POST /statuses` without the requested names counted as created; the names are now confirmed, and any missing become owner steps
- rejected:
  - `[medium]` no transition into `Blocked - Awaiting User` or out of `Block Resolved`: the story text pins "the two statuses and their transition" (a single transition between them). Adding more would extend the intent, so it is listed as a residual risk for 31.5 and 31.7.
  - `[low]` team-managed with both statuses present ends `complete` without verifying the transition: the story note names `GET statuses/search` as the team-managed check, and that is what runs.

### 2026-10-24 — Review pass (follow-up, review_loop_iteration 0)
- layers: blind-hunter (15 findings) and edge-case-hunter (4 findings) both ran (band L); 19 after deduplication (edge-case's exit-code finding duplicates blind-hunter's)
- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 0, medium 3, low 9)
- defer: 0
- reject: 7: (high 0, medium 3, low 4)
- addressed_findings:
  - `[medium]` `[patch]` a site-GLOBAL `Blocked - Awaiting User`/`Block Resolved` counted as found on a team-managed project (which cannot use global statuses), so it could end `complete` without them; `_in_scope` now takes the team-managed flag and counts only PROJECT-scoped entries there (`test_team_managed_ignores_site_global_statuses`)
  - `[medium]` `[patch]` "Needs you" was created private to the agent seat; it is now shared with the project (`sharePermissions`), and the refused-filter owner step asks the owner to share it with the project (DRIFT, consult-ruled: while the project is an owner step, the filter is created by the rerun)
  - `[medium]` `[patch]` a later error dropped the owner steps collected before it; a `blocked` setup now keeps them in `owner_steps[]` and `reason` (`test_blocked_after_owner_steps_keeps_them`)
  - `[low]` `[patch]` the project and space owner steps now grant the agent seat (`TK_ATLASSIAN_AGENT_EMAIL`'s account) access, so the rerun can see what the owner made
  - `[low]` `[patch]` the company status steps said "create" for statuses that already exist; existing ones are now "add the existing status"
  - `[low]` `[patch]` the `create_statuses` docstring claimed a canonical `blocked` mapping by category; corrected (both are In Progress; the mapping is left to 31.5/31.7; pull_back/promote unchanged)
  - `[low]` `[patch]` a gateway 401 named `api.atlassian.com` for the org-admin API-token toggle; it now names the site
  - `[low]` `[patch]` `--owner-account-id` with `--owner-email` silently ignored the email; both together now refuse by name (JSON block, exit 2, no call)
  - `[low]` `[patch]` `written[]`/`artifacts` held an absolute path; now project-root-relative (`.tk-studio/config.yaml`)
  - `[low]` `[patch]` onboard's relay now sets `intent: tk-studio-onboard` on the relayed block
  - `[low]` `[patch]` a non-JSON 2xx raised an uncaught `ValueError` (traceback, no AD-11 block); both clients now raise a named error, and setup ends `blocked` with the ids
  - `[low]` `[patch]` a project id leaving one character gave an impossible one-character key; `project_key_for` returns None below 2 characters, reaching the existing no-key refusal
- rejected:
  - `[medium]` `POST /workflows/update` request shape: the Design Notes leave the REST shapes ungraded and pinned in the fake, and a live refusal becomes owner steps (`partial`), never `complete`; already a residual risk.
  - `[medium]` no exit 1 for backend errors: `driver-contract.md:763` and the plan-sync skill's blocking conditions classify a 401/403 failure as an exit-2 named block; exit 1 is an unexpected failure.
  - `[medium]` promote may move an in-progress story into the new In Progress statuses / no canonical `blocked` mapping: the intent's Never forbids changing pull_back/promote; the false docstring is patched, and the risk is recorded for 31.5/31.7.
  - `[low]` read-call 403s name no scope: the story names the scope for a 403 on a create, not on reads.
  - `[low]` plan-sync conformance entry not updated: its `auth_preflight` names no variables and stays true; the setup refusal drive sits under onboard, as the plan pins.
  - `[low]` onboard inputs lack the payload keys: `SKILL.md:73-86` names `tracking`, `owner_account_id` and `owner_email`.
  - `[low]` gateway test classes after `if __name__ == "__main__"`: the verify gate runs `discover`, which collects them; plumbing.

### 2026-10-24 — Review pass (second follow-up, review_loop_iteration 0)
- layers: blind-hunter (7 findings) and edge-case-hunter (3 findings) both ran (band L); 9 after deduplication (the unverified `space_key` finding came from both)
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 3, low 4)
- defer: 1: (high 0, medium 1, low 0)
- reject: 1: (high 0, medium 0, low 1)
- addressed_findings:
  - `[medium]` `[patch]` `planning.confluence.space_key` was recorded before any space check, so after a Jira create followed by an error, a rerun silently adopted a foreign space with the same key. This bypassed the contract's key-collision refusal. `project_key` and `space_key` are now recorded only when the item is found without collision, created, or left to the owner (`test_space_key_unrecorded_when_the_space_lookup_errors`, `test_project_key_unrecorded_on_a_collision`).
  - `[medium]` `[patch]` a `blocked` run whose project create was refused recorded nothing. The owner then made the project as told, and the rerun refused it as a collision, which broke AC2's rerun. A blocked run that leaves the owner a project or space create now writes the binding (`test_blocked_run_records_the_project_handed_to_the_owner`). Named in contract 0.1.26 per the consult.
  - `[medium]` `[patch]` the project and space owner steps asked the owner to grant the agent seat the Administrators role or space admin, which Free cannot customise (kb §2 Q2, Q4). Both groups now hold only their create step (`test_project_and_space_steps_are_create_steps_only`).
  - `[low]` `[patch]` a column-0 comment inside `planning:` (the template's own comment style) ended `_block_extent` early, so a second `jira:` mapping was inserted. Comment-only lines are now skipped (`test_column_zero_comment_inside_planning_keeps_one_jira_mapping`).
  - `[low]` `[patch]` onboard relayed setup's `artifacts` unchanged and dropped what onboard itself wrote. Onboard's own artifacts are now merged with setup's, deduplicated.
  - `[low]` `[patch]` no test covered the Confluence space key collision named in both contract rows. Added `test_space_key_collision_with_a_space_setup_did_not_create`.
  - `[low]` `[patch]` `test_owner_seat_variables_are_never_read` cleared the agent variables, so it passed whatever the code did. It now runs a full setup with both seats' fake values set, and asserts every Authorization header is the agent's and no owner value appears anywhere.
- deferred:
  - `[medium]` kb §1 step 5's Confluence token scopes omit the `write:space:confluence` / `write:folder:confluence` that setup's space and folder creates need. Deferral criterion (a): AC1's live setup, run with a token built from the record, meets a scope 403. The fix is in 31.1's kb record, outside this story's Files.
- rejected:
  - `[low]` `planning.jira.site` is read from resolved config (local and user layers included), so the tracked file may lack it. The Design Notes say "only when config lacks it", and the code follows that literally. A site placed in local config is the operator's choice.

## Design Notes

- Project key derivation: uppercase, alphanumerics only, starting with a letter, at most 10 characters (`tk-studio` → `TKSTUDIO`). A key collision with a project setup did not create refuses by name. The Confluence space key equals the Jira key.
- Binding keys (Settled shape 1):
  - `planning.jira.{site, project_key, project_id, filter_id, owner_account_id, agent_account_id}`
  - `planning.confluence.{space_key, space_id, folders: {brief, gdd, scope-of-work, decisions, records}}`
  - Setup writes `planning.jira.site` from `TK_ATLASSIAN_SITE` only when config lacks it.
- Owner id source order (Settled shape 2): the recorded value, then `--owner-account-id`, then `--owner-email` via `_find_account`, then the owner step and `partial`.
- The new statuses map onto canonical `blocked` by category (AD-6). `pull_back` is unchanged.
- The template, project-create, status, workflow-update, space and folder REST shapes are ungraded. Pin them in the fake. Any live refusal becomes an owner step, which AC1 already specifies.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests`: expected green.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run`: expected `ok: true`.
- `env -u TK_ATLASSIAN_SITE -u TK_ATLASSIAN_AGENT_EMAIL -u TK_ATLASSIAN_AGENT_TOKEN -u TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN -u TK_ATLASSIAN_CLOUD_ID uv run plugins/tk-studio/lib/plansync.py setup --directory .`: expected `blocked`, with each missing name in the reason.
- `git grep -n -E "ATATT3|_TOKEN=[^ ]" -- plugins/ _bmad-output/specs/spec-epic-31/`: expected only pattern text in plans/specs, and no value.
- `git status --porcelain`: expected only the plan's Files.

**Unverifiable here:** a live setup against the site. It needs the operator's network approval (kb §1 step 8). The attended command is `uv run plugins/tk-studio/lib/plansync.py setup --directory <project> --owner-email <owner email>`.

## Deviation Summary

### pass 1 (2026-10-24, implementer)

- planned: the owner accountId is resolved at step 7, after the Confluence steps / actual: resolved right after the `GET /myself` preflight / why: project creation needs `leadAccountId` "the owner's when known" / may affect: none
- planned: `test_migrate.py` changes only `ENV_KEYS` / actual: also two `setUp` lines (here and in `test_jirabackend.py`) that pop the five agent names / why: `ENV_KEYS` only saves and restores; the sandbox's real values would switch these tests to the gateway path / may affect: none
- planned: the 401/403 split, "today's site-URL path unchanged" / actual: the split also applies to the legacy client (a legacy 403 now reads as missing scope or proxy approval; the legacy 401 still names `JIRA_API_TOKEN` and the toggle) / why: one shared `request` path, and the spec asks for the split there / may affect: none
- planned: a key collision "refuses by name" / actual: also a pre-call refusal when a recorded `planning.jira.project_key` or `planning.confluence.space_key` differs from the derived key / why: otherwise setup would quietly build a second project beside a hand-made binding / may affect: none

DEVIATION SCORE: 1

DRIFT: owner accountId resolved after the preflight, not at step 7 — project create needs leadAccountId as the owner's when known — affects: none
DRIFT: test_migrate.py and test_jirabackend.py setUp also pop the five agent names — ENV_KEYS only saves and restores, so the sandbox values would leak in — affects: none
DRIFT: the 401/403 split also covers the legacy JIRA_* client — one shared request path — affects: none
DRIFT: an extra pre-call refusal when a recorded project or space key differs from the derived key — prevents a second project beside a hand-made binding — affects: none

### pass 2 (2026-10-24, implementer, per the consult ruling)

- planned: `migrate.py` untouched (not in the plan's Files) / actual: its two-line `JiraClient(...)` call is now `jirabackend.client_for(settings)`, plus one `test_migrate` case (`test_agent_seat_names_route_the_migrate_client_through_the_gateway`) / why: consult ruling; with `TK_ATLASSIAN_AGENT_TOKEN` set, migrate sent the scoped token to the site URL; the plan's read-only-seams clause permits this one-line call update as DRIFT / may affect: none

DEVIATION SCORE: 1

DRIFT: migrate.py one-line call update to jirabackend.client_for(settings) — _resolve_settings now returns gateway settings when TK_ATLASSIAN_AGENT_TOKEN is set, so the site-URL client would send a scoped token to the site — affects: none

### pass 3 (2026-10-24, implementer, review patches)

- planned: statuses recognised with `GET /statuses/search?projectId=<id>` only (plan step 4) / actual: also `GET /statuses/search` with no project (only the two new names count) and `GET /project/<KEY>/statuses` / why: review findings 1-2; global and template statuses are not returned by the projectId search; kb §2 Q1 names both reads / may affect: none
- planned: `POST /statuses` scope PROJECT (plan step 4, plans/31-2.md:55) / actual: scope GLOBAL on company-managed / why: kb §2 Q1 (kb/atlassian-free-tier.md:45) supersedes the plan: GLOBAL for company-managed, PROJECT for team-managed / may affect: none
- planned: result carries `found[]`, `created[]`, `owner_steps[]`, `written[]` / actual: adds `would_create[]` (dry run only); a dry run that would create anything ends `partial` / why: review finding 8; named in the contract's 0.1.26 clause and plan-sync row per the consult / may affect: none named (a result seam `tk-studio-onboard` relays)
- planned: refusals are the unregistered project, the absent variables, the key gaps / actual: adds a pre-call refusal by name for a `planning:` block not indented in two-space steps / why: review finding 4; the text edit must never insert a second `jira:` mapping / may affect: none

DEVIATION SCORE: 2 (consult ruling: 1 for the first, second and fourth, 2 for `would_create[]`)

DRIFT: status recognition reads three endpoints, not only statuses/search?projectId — global and template statuses must be found on a rerun — affects: none
DRIFT: POST /statuses sends scope GLOBAL on company-managed, not the plan's PROJECT — kb §2 Q1 gives GLOBAL for company-managed and supersedes plan step 4 — affects: none
DRIFT: setup's result gains would_create[] and a dry run that would create anything ends partial — complete must mean every step created or found — affects: none
DRIFT: a planning: block not indented in two-space steps is refused before any call — the text edit must never insert a second jira: mapping — affects: none

### pass 4 (2026-10-24, implementer, follow-up review patches)

- planned: setup creates "Needs you" in the same run / actual: the filter is shared with the project, so when the project create was refused (an owner step) the filter waits and the rerun creates it; the run still ends `partial` / why: a shared filter needs the project id, and an unshared one would be adopted on reruns and never shared (consult: score 2, 31.5/31.7 rely on it) / may affect: 31-5, 31-7 (they get a project-shared filter)
- planned: `owner_steps[]` on `partial` / actual: a `blocked` setup also carries the owner steps collected before the error, named in the 0.1.26 header clause and the plan-sync row (no version bump, per the consult) / why: the owner must see steps the API refused before the error / may affect: none
- planned: — / actual: `auth_failure`, `JiraClient.for_gateway`/`__init__` and `ConfluenceClient` gain an optional `site` argument, and `create_filter` requires `project_id` (internal signatures) / why: carry the site into the 401 message and the project id into the share / may affect: none

DEVIATION SCORE: 2 (consult ruling: 2 for the filter wait, 1 for the other two)

DRIFT: "Needs you" is created shared with the project, and waits for the rerun while the project is an owner step — an unshared filter would be invisible to the owner and never shared on reruns — affects: 31-5, 31-7
DRIFT: a blocked setup keeps the owner steps collected before the error, named in contract 0.1.26 without a bump — the owner must see the steps the API refused — affects: none
DRIFT: internal site/project_id arguments on auth_failure, the gateway clients and create_filter — carry the site to the 401 message and the project id to the share — affects: none

### pass 5 (2026-10-24, implementer, second follow-up review patches)

- planned: the binding's `project_key` and `space_key` are set from the derived key (Settled shape 1) / actual: each is recorded only when the item is found without collision, created, or left to the owner. A dry run's `binding` omits them for items it would create. / why: an unverified `space_key` let a rerun adopt a foreign space / may affect: none
- planned: on an error, write the binding only when this run created something / actual: also when the run left the owner a project or space create, so a `blocked` setup can carry `written: [".tk-studio/config.yaml"]`. Named in contract 0.1.26 (header clause and plan-sync row) with no bump, per the consult. / why: otherwise the owner-made project is refused as a collision on rerun / may affect: none (a result seam that `tk-studio-onboard` relays)
- planned: project and space owner steps include an access grant for the agent seat (pass 4) / actual: removed / why: kb §2 Q2 and Q4 say Free cannot customise permissions, so the step cannot be carried out / may affect: none

DEVIATION SCORE: 2 (consult ruling: 1 for the first and third, 2 for the blocked-run write)

DRIFT: project_key and space_key are recorded only for an item found without collision, created, or left to the owner — an unverified space_key let a rerun adopt a foreign space — affects: none
DRIFT: a blocked setup that created an item or left a project or space create to the owner writes the binding, named in contract 0.1.26 without a bump — otherwise the owner-made project is refused as a collision on rerun — affects: none
DRIFT: the project and space owner steps no longer grant the agent seat a role or space admin — Free cannot customise permissions (kb §2 Q2, Q4) — affects: none

## Consult Log

- 2026-10-24T19:10Z — trigger: deviation-gt-0 — question: accept the third review pass's deviations ((a) project_key/space_key recorded only when found without collision, created, or handed to the owner; (b) a `blocked` setup that handed the owner a project or space create writes the binding; (c) the project/space access-grant owner steps removed per kb §2 Q2/Q4), and must (b) be named in contract 0.1.26 (AD-19)? — ruling: accept-deviation score 2 — do: record all three as DRIFT lines, (a) score 1, (b) score 2, (c) score 1; in driver-contract.md, with no version bump, add to the plan-sync row's `setup` outcome (:285) and repeat in the 0.1.26 header clause (:5), right after the existing blocked `owner_steps[]` text: "a `blocked` setup that created an item or left a project or space create to the owner still writes the keys it recorded, naming the config in `written[]`; a key is recorded only for an item found without collision, created, or left to the owner"; rerun the lib suite and conformance — rule candidate: when a story changes which files a non-`complete` terminal status writes, or which binding keys it records, the change names that in the version's contract header clause and the §2 row of each surface that relays it, with no version bump if additive within the open version
- 2026-10-24T18:55Z — trigger: deviation-gt-0 — question: accept the follow-up review pass's three deviations ((a) "Needs you" waits for the project it is shared with when the project create was refused; (b) a `blocked` setup keeps earlier `owner_steps[]`; (c) internal `site`/`project_id` signature additions), and must (a)/(b) be named in contract 0.1.26 (AD-19)? — ruling: accept-deviation score 2 — do: accept all three as DRIFT lines, (a) score 2 (31.5/31.7 rely on the filter being shared with the project), (b) and (c) score 1, do not create the filter unshared; in driver-contract.md, with no version bump, add to the plan-sync row's `setup` outcome (:285) and repeat in the 0.1.26 header clause (:5) "a `blocked` setup still lists in `owner_steps[]` (and `reason`) any step the API refused before the error" and "the 'Needs you' filter is shared with the project, so while the project is an owner step it is created by the rerun"; rerun the lib suite and conformance — rule candidate: when a story moves a result field onto another terminal status, or makes one step wait for another across runs, the same change names it in that version's contract header clause and its §2 row
- 2026-10-24T18:37Z — trigger: deviation-gt-0 — question: accept the review-pass deviations (three status reads, GLOBAL scope, would_create[] with dry-run partial, two-space-indent refusal), and must would_create[] be named in the contract (AD-19)? — ruling: accept-deviation score 2 — do: accept all four (score 1 for 1, 2 and 4, score 2 for would_create[]); name would_create[] (dry run only) beside found[]/created[]/written[] in the 0.1.26 header clause and add the dry-run partial sentence to the plan-sync row's setup outcome, with no version bump, then rerun the suite and conformance; record that kb §2 Q1 GLOBAL supersedes plan step 4's PROJECT — rule candidate: a story that adds a result field or terminal-status path names both in that version's contract header clause and §2 row in the same change
- 2026-10-24T18:23Z — trigger: deviation-gt-0 — question: accept the implementer's four score-1 deviations, and does the migrate.py site-URL client (now fed gateway settings by _resolve_settings) need the plan's one-line fix? — ruling: accept-deviation score 1 — do: keep all four deviations as DRIFT lines, score 1; at migrate.py:356-357 replace the `jirabackend.JiraClient(settings["site"], settings["email"], settings["token"])` call with `jirabackend.client_for(settings)`, record DRIFT, touch nothing else in migrate; add one test_migrate case (gateway target, or a by-name refusal without TK_ATLASSIAN_CLOUD_ID), rerun the suite and conformance — rule candidate: when a story changes what a shared resolver returns, the plan lists every caller that builds a client from it and routes each through the shared factory, recorded as DRIFT

## Auto Run Result

Status: done
Blocking condition: none

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Run:** the second follow-up review of the `done` story (`review_loop_iteration: 0`). The diff runs from `6ef38d37368b03740b761c454e75c94f2b7275bb` to the working tree, covering commits `0b297a5dc8294b266ff81d9e68678cce870bb6aa` and `cef63107153d858da6f26f9a3938a5d850ecce4a` plus this pass's patches. The reviewers saw the `plugins/` diff (3081 lines); this executor spec was left out of the review content.

**Summary:** Tracking setup from a studio template, behind the planning adapter (AD-4). `plansync.py setup` creates or finds the Jira project, its five-status workflow, the shared "Needs you" filter, and the Confluence space with its five folders. It records keys and ids under `planning.jira`/`planning.confluence`, turns refusals into numbered owner steps (`partial`), and is idempotent on rerun. This pass hardened the binding and the owner steps:
- A project or space key is recorded only when that item was found without collision, created, or left to the owner. A rerun can no longer silently adopt a foreign Confluence space.
- A `blocked` run that left the owner a project or space create now writes the binding, so the rerun adopts what the owner made instead of refusing it as a collision.
- The owner steps no longer ask for permission grants that Free cannot make.
- Column-0 comments inside `planning:` no longer cause a duplicate `jira:` mapping.
- Onboard's headless block merges setup's artifacts with its own.

**Files changed (this pass):**
- `plugins/tk-studio/lib/plansync.py`: keys recorded only when earned, the `handed_over` binding write on `blocked`, create-only project and space owner steps, and `_block_extent` skipping comment-only lines.
- `plugins/tk-studio/lib/tests/test_tracking_setup.py`: `ThirdReviewTests` (four cases), the space key collision test, the create-only owner-steps test, and the rewritten owner-seat test, which now drives a real run.
- `plugins/tk-studio/skills/tk-studio-onboard/SKILL.md`: the relayed `artifacts` are merged with onboard's own and deduplicated, and the Report's `partial` line is aligned to match.
- `plugins/tk-studio/contracts/driver-contract.md`: one sentence in the 0.1.26 header clause and in the plan-sync row (a blocked setup writes the keys it recorded; when a key is recorded), with no version bump, per the consult.
- `_bmad-output/specs/spec-epic-31/stories/31-2-project-setup-from-a-template-spec.md`: this executor spec.

**Review:**
- Both layers ran: blind-hunter (7 findings) and edge-case-hunter (3), 9 after deduplication.
- Patches applied: 7 (high 0, medium 3, low 4).
- Deferred: 1, medium. kb §1 step 5 omits the Confluence `write:space`/`write:folder` scopes (criterion (a)). It is recorded in frontmatter `deferred`.
- Rejected: 1 (low). See the Review Triage Log.
- Follow-up review recommended: true. The score is 3×3 + 1×4 = 13, with no high.

**Verification:**
- Lib suite: `Ran 1516 tests`, OK (2 skipped), after the contract edit.
- Conformance: `ok: true`.
- `plansync.py setup --directory .` with the five agent names unset ended `blocked`, exit 2. The reason names the unregistered worktree project id and each absent variable. No call is made.
- Token-pattern `git grep` matched only pattern text in plans and specs, plus the existing `test_installer_apps.py:1005` fixture. No token value.
- `git status` before the commit showed the four files above plus this spec, all in the plan's Files.

**Unverifiable here:** a live setup against the site. It needs the operator's network approval (kb §1 step 8: `sbx policy allow network --sandbox claude-tk-studio "api.atlassian.com,<site>.atlassian.net"`). After that, the operator runs `uv run plugins/tk-studio/lib/plansync.py setup --directory <project> --owner-email <owner email>`, or first adds `--dry-run`. Before running it, the agent's Confluence token needs `write:space:confluence` and `write:folder:confluence` (deferred above).

**Residual risks:**
- The create request shapes are pinned only in the fake. A live mismatch becomes owner steps (`partial`), never a silent `complete`.
- Both new statuses are in the In Progress category. Mapping them to canonical `blocked` is left to 31.5/31.7, since this story's Never forbids changing pull_back/promote.
- A dry run's `binding` no longer lists `project_key`/`space_key` for items it would create. Nothing is written on a dry run.
- This repo's own `.tk-studio/config.yaml` is not set up (SPEC Open Question 3).

DRIFT: owner accountId resolved after the preflight, not at step 7 — project create needs leadAccountId as the owner's when known — affects: none
DRIFT: test_migrate.py and test_jirabackend.py setUp also pop the five agent names — ENV_KEYS only saves and restores, so the sandbox values would leak in — affects: none
DRIFT: the 401/403 split also covers the legacy JIRA_* client — one shared request path — affects: none
DRIFT: an extra pre-call refusal when a recorded project or space key differs from the derived key — prevents a second project beside a hand-made binding — affects: none
DRIFT: migrate.py one-line call update to jirabackend.client_for(settings) — _resolve_settings now returns gateway settings when TK_ATLASSIAN_AGENT_TOKEN is set, so the site-URL client would send a scoped token to the site — affects: none
DRIFT: status recognition reads three endpoints, not only statuses/search?projectId — global and template statuses must be found on a rerun — affects: none
DRIFT: POST /statuses sends scope GLOBAL on company-managed, not the plan's PROJECT — kb §2 Q1 gives GLOBAL for company-managed and supersedes plan step 4 — affects: none
DRIFT: setup's result gains would_create[] and a dry run that would create anything ends partial, published in contract 0.1.26 — complete must mean every step created or found — affects: none
DRIFT: a planning: block not indented in two-space steps is refused before any call — the text edit must never insert a second jira: mapping — affects: none
DRIFT: "Needs you" is created shared with the project, and waits for the rerun while the project is an owner step — an unshared filter would be invisible to the owner and never shared on reruns — affects: 31-5, 31-7
DRIFT: a blocked setup keeps the owner steps collected before the error, named in contract 0.1.26 without a bump — the owner must see the steps the API refused — affects: none
DRIFT: internal site/project_id arguments on auth_failure, the gateway clients and create_filter — carry the site to the 401 message and the project id to the share — affects: none
DRIFT: project_key and space_key are recorded only for an item found without collision, created, or left to the owner — an unverified space_key let a rerun adopt a foreign space — affects: none
DRIFT: a blocked setup that created an item or left a project or space create to the owner writes the binding, named in contract 0.1.26 without a bump — otherwise the owner-made project is refused as a collision on rerun — affects: none
DRIFT: the project and space owner steps no longer grant the agent seat a role or space admin — Free cannot customise permissions (kb §2 Q2, Q4) — affects: none

## Reconcile

### 2026-10-24 — adjust-stories

- Score: 2
- Reasoning: The contract-facing DRIFTs (would_create[], owner_steps[] on blocked, the blocked-run binding write, recorded-only-when-earned keys) were each ruled by consult and named in 0.1.26 without a bump. Later stories read none of them except the binding keys, which are unchanged after a complete setup. The "Needs you" wait (DRIFT affects 31-5, 31-7) gives those stories a project-shared filter, and neither story's text relies on the filter existing in the same run. One gap does reach later work. Setup creates `Blocked - Awaiting User` and `Block Resolved` in the In Progress category, and the unchanged category pull-back maps them to canonical `in-progress`, so the Design Notes line "The new statuses map onto canonical blocked by category (AD-6)" does not hold. Also, promoting a canonical status by category (`_transition_to_category`) cannot choose between three In Progress statuses. AD-22 and SPEC Constraints still require the `blocked` mapping, which no story has built yet. 31-4, 31-5 and 31-7 absorb it as notes, so no AC changes.
- Affected: 31-4-sync-back-on-a-timer — "pulls each tracked issue's status (mapped onto the canonical enum per AD-6, the Jira original kept under `external.jira`)": category mapping yields `in-progress` for both new statuses
- Affected: 31-5-the-two-statuses-and-the-inbox-items — "the issue … moves to `Blocked - Awaiting User`": a category transition cannot target it
- Affected: 31-7-validation-of-a-resolution — "a pass moves the issue back to `To Do` or `In Progress` … a fail moves it to `Blocked - Awaiting User`": same, and `Block Resolved` must read as `blocked`, not `in-progress`
- Invariant: none (AD-22/AD-6 mapping not yet built, not contradicted; 31.2's Never kept pull_back unchanged)

Gate: Part A adjust-stories; Part B story accepted, planned 31-3-publish-design-pages-to-confluence
