# Handoff — pick up on the agent PC (boundary 2026-09-26)

> **Superseded for machine state by
> [handoff-agent-pc-2026-09-27.md](handoff-agent-pc-2026-09-27.md)**: the
> agent PC is provisioned and Phase 0 is done. The plan and rulings below
> still stand.

Written for a fresh Claude Code session on the dedicated Windows 11 agent PC,
with nothing but this repo cloned. The main PC's memory notes are not here;
this file is the handoff.

## Where things stand

- **Decision made and accepted:** tk-studio's next level is "describe a
  prototype from any device, let the agent box build a playable Godot slice."
  Research, rulings and guidance:
  `_bmad-output/planning-artifacts/research/agent-studio-next-level-2026-09-26/research.md`
  (§4 recommendation, §6 rulings, §7 hub guidance). Evidence: `digests/01..08`.
- **Rulings:** engine **Godot** · payer **Max plan** (worker `claude -p` under
  the Max login; hub bills to Nous Portal) · driver **independent supervisor**
  on this box, HTTP over Tailscale · hub **split** (extract the driver, Hermes
  is front door only, ClaudeOS retired as driver).
- **Plan:** `_bmad-output/planning-artifacts/briefs/planning-pass-agent-pc-and-supervisor-2026-09-26.md`
  (Phases 0–4, acceptance criteria, contract impact, risks, open items).
- **Provisioning runbook:** `kb/agent-pc-setup-runbook.md` (this box, from a
  clean Windows 11 install to the §7 smoke checklist).
- **Repo state:** PR thkennedy/tk-studio#61 merged into `main` with the docs
  above; plugin 0.2.12, contract 0.1.15, 691 lib tests, conformance ok over 18
  surfaces. No code changed. A separate session was fixing the stale README
  version header (0.2.8 / 0.1.13 → 0.2.12 / 0.1.15); if `README.md` lines 9–10
  still show the old numbers, that branch was never merged.
- **ClaudeOS (main PC):** retired as the studio driver 2026-09-26. All four
  scheduled tasks disabled, processes stopped, repo pushed and tagged
  `retired-as-driver-2026-09-26` at github.com/thkennedy/ClaudeOS. The
  salvage sources for Phase 1 live there:
  `connectors/tk-studio/{server,client,conformance}.ts` and
  `scripts/studio-jobs-tick.ts` (1,561 lines, contract 0.1.12 consumer, never
  scheduled). Clone ClaudeOS on this box only to lift those files.
- **Hermes:** the main PC has an idle 0.18.0 install in the old `~/.hermes`
  layout. Install fresh here per runbook §3.7 (0.21.x, `%LOCALAPPDATA%\hermes`).

## First hour on this box

1. Follow the runbook top to bottom as the standard `agent` user; stop at each
   *verify on first run* mark and confirm it. Record anything that differs as a
   `tk observe` note or a runbook fix on a branch.
2. Open this repo in Claude Code, trust it, accept the marketplace and plugin
   prompts, then "tk activate" and follow the store standup it prints. This
   repo itself resolves `needs-onboarding` for the developer working set; run
   "tk onboard" here once so the front door routes.
3. Run the smoke checklist (runbook §7). Phase 0 is done when it is all green
   and the first `job-run` event lands in this machine's ledger after Phase 1.

## Next work (Phase 1: the supervisor)

Extract the four ClaudeOS files into a new Bun/TypeScript repo (name is open
item 1 in the plan). Add: SQLite durable queue, per-checkout lock, pacer
honouring `hint_seconds`, wrapper-enforced guards, `claude -p` under the Max
login with `--permission-mode auto` on the host tier and Docker Sandboxes for
bypass, HTTP API on the tailnet IP with bearer auth, a read-only status page
over `~/.tk-studio`, console-hosted start from the `agent` Startup folder,
transcript backup, `robocopy` snapshot before editor runs. Contract bump
0.1.15 → 0.1.16 is a doc patch (§7 row 6 names the supervisor and Hermes as
consumers; §2 driver roster). Acceptance is in plan §3 Phase 1: `run-epic`
against `slice-zero` from the phone, conformance through the driver, crash
mid-run resumes or ends `partial`.

Plan the work through the studio: `gds`/`bmm` planning skills for the brief
and epics, `tk plan sync`, then the launch pipeline. Measure every acceptance
run into the ledger before starting the next phase.

## Gotchas that cost time on the main PC

- Bash-tool heredocs mangle non-ASCII (em dashes, arrows) and collapse `\\`;
  write files with the Write tool, or keep scripts ASCII and use `chr(0x2014)`.
- PowerShell `Set-Content`/`Out-File` write a BOM that breaks canonical
  frontmatter; never touch canonical plan files with them.
- `git grep ':!path'` fails on Git for Windows; use `':(exclude)path'`.
- Plugin updates need the scoped form:
  `claude plugin update tk-studio@tk-studio --scope project`.
- `claude -p` launched from a headless Task Scheduler job hangs with no console
  (anthropics/claude-code#96932): the supervisor must start from the
  interactive session. Silent REPL exits after long dense Bash runs are real
  (#55424): resume from the `.jsonl`.
- Never `--dangerously-skip-permissions` on the host; that tier is `sbx` only.
- Hermes must never spawn `claude -p` for pipeline work and must not run on
  Claude OAuth (NousResearch/hermes-agent#47260).

## Open items for the operator (plan §6)

Supervisor repo name; one Telegram bot per box or Bot Mode profiles; drive
convention (`D:\agent-work` assumed); whether any ClaudeOS dashboard stays on
the main PC; when to retire the main PC's Hermes install.
