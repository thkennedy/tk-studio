---
id: SPEC-epic-22
companions:
  - operator-decisions.md
  - ../../planning-artifacts/epics.md
  - ../../implementation-artifacts/deferred-work.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Epic 22: Reachable from the Phone

## Why

This epic captures an opportunity and fixes a pain. Epic 21 left the supervisor operable only from its own CLI on the agent PC, so an operator away from the box cannot submit, watch, or cancel a run. Epic 22 puts the supervisor on the tailnet behind a bearer token. It adds a read-only status page and starts the supervisor at logon the way this box needs. The HTTP API is also the seam Hermes will POST to in Phase 2, and the fallback front door if Hermes churns. Requirements trace: plan Phase 1 scope items 5, 6 and 7, and runbook §4.

## Capabilities

- **CAP-1**
  - **intent:** The operator can submit, watch, and cancel runs over the tailnet from the phone, iPad, or main PC through an authenticated HTTP API.
  - **success:**
    - The supervisor binds only the Tailscale address named in its environment. It refuses to start on `0.0.0.0`, on an address outside `100.64.0.0/10`, or without a bearer token in its environment.
    - A request without the correct token gets 401, and the token never appears in any log.
    - A valid `POST /jobs` names a registered project and a declared job, with optional `base_ref`, `tier`, `model` and `effort`. It is queued through Story 21.3's validation, and the response carries the run id. An invalid body gets 400 with the schema error.
    - `GET /jobs`, `GET /runs/{id}`, `POST /runs/{id}/cancel`, `GET /status` and `GET /events?since=` each answer from the queue.
    - Cancel ends the run `cancelled`. A launched engine is stopped gracefully through `tk-studio-launch` verb `stop` with `graceful`.
    - `/events` serves both SSE and plain polling.
    - The API test suite pins auth refusal, malformed JSON, unknown project, unknown job, and a double cancel, and it is green. (Story 22.1)
- **CAP-2**
  - **intent:** The operator can see what the box is doing at a glance on a read-only status page.
  - **success:**
    - The page is server-rendered on the API's bind and behind its auth, with no client-side framework, and it reads well at phone width.
    - It shows the queue (jobs, and runs with state, reason and cost), the latest status blocks, run workspaces (`run.json`, `handoff.json`), the tail of this machine's ledger file, and the registry's projects.
    - In the test suite, every page route is a GET that writes nothing to the queue or to `~/.tk-studio`, and it renders no credential-shaped value (NFR5). (Story 22.2)
- **CAP-3**
  - **intent:** The supervisor starts itself at logon and is reachable after a reboot.
  - **success:**
    - `start.ps1` reads the bind address and token from the user environment. It starts the sbx daemon from `$HOME` when the daemon is not running, then starts the API and the pacer. This lets the operator later retire the "Docker Sandboxes daemon" sign-in task.
    - The operator receives the exact `shell:startup` shortcut command: `wt.exe -w studio nt --title supervisor pwsh -NoExit -File <repo>\start.ps1` (runbook §4).
    - After a reboot and auto-logon, `curl -H "Authorization: Bearer <token>" http://<tailscale-ip>:<port>/status` from another device answers. (Story 22.3)
- **CAP-4**
  - **intent:** The box's run hygiene is built into the supervisor.
  - **success:**
    - Before a run flagged editor-in-the-loop on a Godot project starts, a `robocopy /E` snapshot of the project lands in the work folder, and its path is recorded on the run.
    - When any run reaches a terminal state, a notification goes out through ntfy or Telegram, as the environment chooses. It names the run, its status, its reason, and its PR when there is one.
    - The run's session transcript is copied to the backup folder. The nightly task remains the catch-all. (Story 22.3)
- **CAP-5**
  - **intent:** The next agent box can be provisioned from a runbook that describes the supervisor as built.
  - **success:**
    - `kb/agent-pc-setup-runbook.md` §4 names the repo and the clone path under `C:\GitHub`. It names the environment variables (bind address, token, database path, notification target), `start.ps1`, the Startup shortcut, the retirement of the sbx sign-in task, and the smoke test from another device.
    - §7 gains a smoke row, and §8 gains a row for each supervisor failure mode met while building the epic.
    - The kb index regenerates only if frontmatter moved. (Story 22.4)

- **CAP-6**
  - **intent:** The operator signs in to the status page from a phone browser, which cannot send the bearer header, with the token, with Google or with GitHub, and stays signed in with a cookie. (Added 2026-10-06 from DW-20, by the operator's decision.)
  - **success:**
    - A browser request with neither a bearer header nor a valid session cookie gets a sign-in page on the same bind: a form for the API token, "Continue with Google" and "Continue with GitHub". Nothing else of the page is served, and the API's JSON routes still answer 401 as in Story 22.1.
    - The correct token on the form, or an OAuth callback whose verified identity is on the allow list named in the environment (one Google account, one GitHub login, never a wildcard), sets an `HttpOnly`, `Secure`, `SameSite=Lax` session cookie signed with a session secret from the environment and carrying an expiry. An identity off the allow list, a bad token or a failed OAuth state check is refused with no cookie and no detail.
    - A signed-in browser reads `GET /` and the API's GET routes as the bearer header would. `POST /runs/{id}/cancel` from a cookie session also needs the CSRF token the page embeds, and a cookie never authorises `POST /jobs`.
    - The sign-in is served over `https` on the tailnet address with the machine's Tailscale certificate for its MagicDNS name (`tailscale cert`). The bind rule of Story 22.1 is unchanged. The hand-over names the operator's two steps: enable HTTPS certificates once in the Tailscale admin console, and register the Google and GitHub OAuth apps with that callback URL, their client ids and secrets set under the `TK_SUPERVISOR_OAUTH_*` names the story fixes.
    - The OAuth client secrets, the session secret and every cookie value never appear in logs, pages, notifications or worker environments (NFR5), and `buildWorkerEnv` drops them. The test suite pins the form path, both OAuth callbacks against a faked provider, the allow-list refusal, the state-check refusal, cookie expiry and the CSRF refusal. (Story 22.5)

## Constraints

- The API is tailnet-only and token-gated. It never binds `0.0.0.0` or an address outside `100.64.0.0/10`, and it never starts without a bearer token. The token never appears in any log.
- The status page shares the API's bind and auth. Its routes are GET-only, write nothing to the queue or `~/.tk-studio`, and render no credential-shaped value (NFR5). The page uses no client-side framework.
- The API submits through Story 21.3's validation path and answers from the queue. It adds no second submission path.
- Cancel reuses the queue's existing `cancelled` terminal state.
- The supervisor is console-hosted at logon. Nothing registers a "run whether user is logged on or not" task, and nothing starts the supervisor from a Claude desktop-app session (MSIX AppData virtualization).
- Editor-in-the-loop snapshots use `robocopy /E`, never `/MIR`.
- The browser sign-in of Story 22.5 adds a cookie session beside the bearer header, never instead of it: the bearer header stays the API's auth, the bind rule stays, and only allow-listed identities sign in.
- Stories 22.1–22.3 and 22.5 land in the supervisor repo. Story 22.4 lands in tk-studio kb and is docs-only: no code, schema or contract file changes. The engine sandbox mounts tk-studio read-only, so 22.4 is built there after 22.1–22.3 and is absent from `stories.yaml`.

## Non-goals

- Hermes integration itself (Phase 2). This epic only provides the API it will POST to.
- Any UI inside the studio plugin.
- Exposure beyond the tailnet.
- Headless Task Scheduler hosting of the supervisor.
- Changes to the driver contract or plugin (Epic 20, in tk-studio).
- Acceptance on The Universe Awaits (Epic 23).

## Success signal

- After a reboot of the agent PC, the operator uses the phone over the tailnet to submit a job, watch it on the status page, and cancel it or see it end, and receives its notification. An unauthenticated request gets 401.

## Assumptions

- The bind address, port, token, database path and notification target are supervisor environment variables (AD-15), following the existing `TK_SUPERVISOR_*` naming.
- Per-story acceptance criteria stay authoritative in `epics.md`, adopted as a companion. The reconcile rulings from Epic 21 live in each entry's `invoke_dev_with` in `stories.yaml`, as dispatch notes.

## Open Questions

All five are answered in `operator-decisions.md` (attended session, 2026-09-28; provisional until the operator's review). They are kept here as asked.

The operator accepted all five as built on 2026-10-06 and decided DW-20 the same day (`operator-decisions.md` §6 and §7).

- Which environment variable names carry the bind address, port, token and notification target, and which selects ntfy or Telegram?
- Which port does the API bind? The epic fixes the address rule, not the port.
- How is a run flagged editor-in-the-loop, and how is a project known to be Godot (registry field, job field, or detection)?
- Is the per-run transcript backup folder the same `TK_SUPERVISOR_TRANSCRIPT_BACKUP` folder the nightly task writes?
- Only the Windows host can verify some checks: logon start, the reboot smoke curl, robocopy, the sbx daemon start, and the win32 end-to-end suites for DW-5 and DW-10. Who records them?
