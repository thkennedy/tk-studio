# Epic 22: operator decisions on the SPEC's open questions

Recorded by the attended session on the agent PC, 2026-09-28, so the run does not pause on them. **They are provisional.** Tim reviews them in the pull request and may change any of them before merge. Each one is a name or a default, so a change is mechanical.

A dev session treats these as decided. It does not reopen them, and it does not consult on them.

## 1. Environment variables

All follow the existing `TK_SUPERVISOR_*` names (`TK_SUPERVISOR_DB`, `TK_SUPERVISOR_CONFIG`, `TK_SUPERVISOR_TRANSCRIPT_BACKUP`).

| Variable | Meaning | Required |
|---|---|---|
| `TK_SUPERVISOR_BIND` | The Tailscale address the API binds. Must be inside `100.64.0.0/10`. | yes |
| `TK_SUPERVISOR_PORT` | The API's port. | no, default in section 2 |
| `TK_SUPERVISOR_TOKEN` | The bearer token. Never logged, never rendered. | yes |
| `TK_SUPERVISOR_NOTIFY` | Which notifier runs: `ntfy` or `telegram`. Unset means no notification is sent, and the run's `events` record that none was configured. | no |
| `TK_SUPERVISOR_NTFY_URL` | The full ntfy topic URL. Read when the notifier is `ntfy`. | with `ntfy` |
| `TK_SUPERVISOR_TELEGRAM_TOKEN` | The Telegram bot token. Credential-shaped: never logged, never rendered. | with `telegram` |
| `TK_SUPERVISOR_TELEGRAM_CHAT` | The Telegram chat id that receives the message. | with `telegram` |
| `TK_SUPERVISOR_WORK` | The work folder that holds editor-in-the-loop snapshots. | for a flagged run |

A notifier that is selected but lacks its own variables is a named start error, like a missing token.

## 2. Port

The default is `8787`. `TK_SUPERVISOR_PORT` overrides it. Nothing on the agent PC listened in the 8000 range on 2026-09-28.

## 3. Editor-in-the-loop runs and Godot projects

- **The flag** comes from the submission: `editor_in_the_loop: true` in the `POST /jobs` body, and `--editor-in-the-loop` on the CLI's `submit`. It is stored on the queue run, like `tier`.
- **A Godot project** is one with a `project.godot` file in the project root or in one of its first-level folders. The Universe Awaits keeps it in `game/`.
- **The snapshot** lands under `<TK_SUPERVISOR_WORK>/snapshots/<project id>/<queue run id>/`. A flagged run with no `TK_SUPERVISOR_WORK` is refused before it is queued, with a named error.
- A flagged run on a project that is not a Godot project takes no snapshot and records why in `events`.

## 4. The per-run transcript backup

It goes to the same folder `TK_SUPERVISOR_TRANSCRIPT_BACKUP` names, in the layout the nightly task writes (runbook §6: a copy of `~/.claude/projects`). Story 21.6's restore reads that folder, so a per-run copy is found by the same code. The nightly task stays the catch-all.

## 5. Checks only the Windows host can run

The dev session lists them under `unverifiable-here` in the story's Auto Run Result. The attended session on the agent PC, or the operator, runs them and records the results in the pull request and in `deferred-work.md` (DW-5, DW-10). They are:

- the logon start and the smoke `curl` after a reboot
- the `robocopy /E` snapshot
- the sbx daemon start from `start.ps1`
- the win32 end-to-end suites

The supervisor is never started from a Claude desktop-app session. Checks that need it running are the operator's, from the console.

## 6. The notifier (decided 2026-10-06)

Both notifiers are configured in the User environment and `TK_SUPERVISOR_NOTIFY=telegram` is the default. Telegram uses the same bot as Hermes: the setup script (`C:\agent-work\tools\set-supervisor-env.ps1`) reads the token and the home chat from Hermes' own `.env`, so nothing is copied by hand and a reply to a run's message reaches Hermes. ntfy stays one variable away (`TK_SUPERVISOR_NOTIFY=ntfy`; the topic in `TK_SUPERVISOR_NTFY_URL` is the secret).

## 7. DW-20: the page signs you in (decided 2026-10-06)

Tim confirmed sections 1 to 5 as built on 2026-10-06 and decided DW-20: **a login form that sets an HttpOnly session cookie, with Google and GitHub sign-in as well as the token.** It is tk-studio Story 22.5. Constraints the story inherits:

- **HTTPS is required.** Google refuses `http://` redirect URIs on anything but localhost. The page therefore needs a certificate: Tailscale HTTPS (`tailscale cert`) on the MagicDNS name, which the operator enables once in the Tailscale admin console (`CertDomains` was empty on 2026-10-06). GitHub accepts `http://` but gets the same `https://` URL.
- **The operator registers the two OAuth apps** (Google Cloud console, GitHub developer settings) and sets their client ids and secrets in the User environment under names the story fixes (`TK_SUPERVISOR_OAUTH_*`). Only allow-listed identities sign in: his Google account and his GitHub login, named in the environment, never a wildcard.
- **The bearer header keeps working** for `curl` and every API route. The cookie authorises the browser only. Once a cookie can authorise `POST /runs/{id}/cancel`, that route needs CSRF protection (SameSite plus a token in the form).
- **The bind does not change.** The API still listens on the tailnet address only (22.1's NFR). HTTPS may terminate in `Bun.serve` with the Tailscale certificate, or in `tailscale serve` in front of it; the story decides, and the runbook §4.5 follows.
- Secrets stay out of logs, pages and worker environments, as in §1: the OAuth client secrets and the session secret join `buildWorkerEnv`'s drop list.
