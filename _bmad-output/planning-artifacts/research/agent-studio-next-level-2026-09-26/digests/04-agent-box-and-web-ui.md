# Digest 04 — Always-on Claude Code "agent box" driven from web/mobile: 2025–2026 practice

Grades: [V] verified primary page, [R] reported/secondary, [U] unverified or not found.

## 1. Web UIs, dashboards, first-party remotes

| Tool | Runs where | Network UI | Queue / sessions / PR | Status, license |
|---|---|---|---|---|
| siteboon/claudecodeui "CloudCLI" [V] https://github.com/siteboon/claudecodeui | your machine (npm) or Docker | yes, `[ip]:3001`, mobile-responsive | auto-discovers `~/.claude` sessions; optional Task Queue plugin; experimental `sbx` sandbox; wraps Claude Code, Cursor CLI, Codex, OpenCode; tools off by default | active, 13.8k stars, AGPL-3.0 |
| sugyan/claude-code-webui [V] | local | `--host 0.0.0.0`, no auth | history | archived 2026-05-29, MIT |
| Vibe Kanban [V] https://github.com/BloopAI/vibe-kanban | local / Docker | yes | worktree+branch per task, dev server per workspace, PR open/review/merge, 10+ agents | company shut 2026-04-10, community-maintained, Apache-2.0 |
| Claude Squad [V] | local TUI | no (tmux) | worktree per agent | no Windows, AGPL-3.0, 8.5k |
| Conductor [R] | Mac only | no | worktree per workspace | free |
| Happy Coder [V] https://github.com/slopus/happy | CLI wrapper + relay | iOS/Android/web, E2E encrypted, push on permission prompts | multi-machine, Claude Code + Codex | active, 23.9k, MIT |
| Omnara [V] https://github.com/omnara-ai/omnara | self-host (Compose) or cloud | web/mobile/watch | now "managed agent" infra (Blaxel/Daytona/Modal) | active, 2.9k, Apache-2.0 |
| Terragon [V] | cloud | — | sandbox per task → PR | shut down Jan 2026 |
| OpenCode `serve`/`web` [R] | your machine | 127.0.0.1 default; `OPENCODE_SERVER_PASSWORD`; mDNS | HTTP API | active |
| Codex cloud [V] | OpenAI sandbox | web/Slack/Linear/GitHub | parallel tasks, PR | no self-host |
| Cursor Cloud Agents [V] | isolated cloud VMs | iOS/web/Slack/API | computer-use browser, Tailscale to private nets, **spend limit required** | paid; not your machine |
| Devin / Factory Droid / Jules [R] | cloud (Droid: hybrid/on-prem) | | PRs | |

**Anthropic first-party [V]:**
- Remote Control https://code.claude.com/docs/en/remote-control — `claude remote-control` keeps execution local; phone/web is "a window into that local session"; the `claude` process must keep running; Pro/Max/Team/Enterprise; no API keys/Bedrock; transcript stored on Anthropic servers; `--permission-mode` per server; `remoteControlAtStartup`; push notifications for permission prompts.
- Channels (research preview) https://code.claude.com/docs/en/channels — Telegram/Discord/iMessage plugins push messages into a running session via MCP; pairing-code allowlist; works with `-p`; "for an always-on setup you run Claude in a background process or persistent terminal"; permission-relay lets allowlisted senders approve tools remotely.
- Claude in Slack — spawns a **cloud** session, GitHub-only; not a route to a local box.
- Dispatch (Cowork) — phone → Claude Desktop (Windows x64), routes dev tasks to Claude Code; machine awake, app open; Pro/Max.
- Scheduling https://code.claude.com/docs/en/scheduled-tasks — `/loop` (session-scoped, 7-day expiry), Desktop scheduled tasks (local macOS/Windows), cloud Routines (no local files).

## 2. Agent-box patterns and autonomous loops

- Spare box + Tailscale + tmux/mosh is the dominant DIY pattern; OpenReplay guide 2026-07-06 [V] https://blog.openreplay.com/remote-box-agentic-coding-setup/ — SSH keys only, never bind agent to 0.0.0.0, tmux for interactive vs systemd for services, `LoadCredential=` for secrets.
- Ralph Wiggum loop (official plugin) [V] https://github.com/anthropics/claude-code/blob/main/plugins/ralph-wiggum/README.md — Stop hook re-feeds the prompt; `--max-iterations` is "your primary safety mechanism"; `--completion-promise` exact-match only; write escape-hatch logic into the prompt.
- continuous-claude (MIT) [V] https://github.com/AnandChowdhary/continuous-claude — PR per iteration, waits on `gh pr checks`, merges; `--max-runs`, `--max-cost`, `--max-duration`, `--stall-threshold`; state in `SHARED_TASK_NOTES.md`.
- Headless bounding [V] https://code.claude.com/docs/en/headless · https://code.claude.com/docs/en/cli-reference — `--max-budget-usd` (subagent spend counted, v2.1.217+), `--max-turns`, `--permission-prompts none` (v2.1.259+), `--bare` (skips hooks/MCP/CLAUDE.md), `--output-format json` → `total_cost_usd`; resume by session id or `.jsonl` path; SIGTERM → exit 143; background subagent wait capped 10 min.
- GitHub Issues as queue with ~$5 per-invocation cap and PR-only output [R].

## 3. Isolation for bypass-permissions runs

- Anthropic sandbox comparison [V] https://code.claude.com/docs/en/sandbox-environments — "Always run `--dangerously-skip-permissions` sessions inside a container, a VM, or the sandbox runtime"; Bash sandbox "does not support native Windows"; native Windows row: **"A container or VM, or run the Bash sandbox inside WSL2."** Auto mode's classifier "is a per-action control, not an isolation boundary." CLI refuses bypass as root.
- Reference devcontainer [V] https://code.claude.com/docs/en/devcontainer — `init-firewall.sh` default-deny egress, non-root; warns malicious repo can exfiltrate `~/.claude` creds; `permissions.disableBypassPermissionsMode`.
- Docker Sandboxes [V] https://docs.docker.com/ai/sandboxes/install/ — microVM own kernel; **Windows 11 via Windows Hypervisor Platform**, `winget install -h Docker.sbx`, free; blocks `~/.ssh`, `~/.aws` by default; `--branch` worktree isolation. **No GPU.**
- Hyper-V Windows VM: glslang/agent-sandbox-vm (GPL-3) [V] — scripted Gen2 VM, snapshots, Isolated/Internet vSwitch toggle. **No GPU passthrough.**
- Native Windows separate user: fmuecke/claude-win-sandbox (MIT) [V] — low-privilege `ClaudeSandbox` account, ACLs, firewall; "mitigation, not hard containment"; archived Aug 2026 → `agent-win-sandbox`. Windows Sandbox (.wsb) writeups: none [U].
- Hard stops surviving bypass [V] https://code.claude.com/docs/en/permission-modes — `rm`/`rmdir` on critical paths 2-min countdown then deny (v2.1.281+); `Remove-Item` on drive roots/home denied in every mode; `cmd /c rd /s /q` on system paths denied (v2.1.283+). Auto mode default since v2.1.283 (~2026-08-14 [R]).
- Sandbox escapes disclosed April 2026 (symlink out of workspace; worktree write to `~/.zshenv`) [R].

## 4. Driving Windows GUI apps unattended

- Anthropic computer use on Windows (Cowork + Claude Code) launched 2026-04-03, Pro/Max research preview; "connectors first, then GUI"; prompt-injection exfil demonstrated [V-secondary] https://winbuzzer.com/2026/04/04/anthropic-claude-desktop-control-windows-cowork-dispatch-xcxwbn/
- Microsoft UFO2/UFO³ [V] https://arxiv.org/abs/2504.14603 · https://microsoft.github.io/UFO/ — HostAgent/AppAgent, UIA+vision, Picture-in-Picture virtual desktop for concurrent use; 27.9% Windows Agent Arena vs Operator 20.8% [R].
- **Unity official [V]:** Unity MCP (2026-05-11, Unity 6+) https://unity.com/blog/unity-ai-mcp-how-to-get-started ; Unity CLI + Pipeline (2026-08-13, connects to running Editor, eval C# → command → screenshot → verify) https://unity.com/resources/unity-pipeline-cli-technical-walkthrough ; **Unity plugin for Claude Code (2026-09-09, 29 skills incl. `/unity-cli`)** https://unity.com/blog/unity-plugin-for-claude-code . Headless tests `-batchmode -nographics` [R]. Community: CoplayDev/unity-mcp, CoderGamester/mcp-unity [R].
- Blender: blender-mcp → 3D-Agent, davrous/blenderagent [R]. No credible writeup of driving Unity Editor purely by screenshots [U]; every Unity source treats screenshots as verification, control via API.

## 5. Orchestration and observability

- Notifications: Stop/Notification hooks → ntfy/Pushover/Discord (claude-ntfy; claude-ntfy-hook adds Allow/Deny from phone) [R]; Remote Control native push [V].
- Cost: `total_cost_usd`; `ccusage session` over `~/.claude/projects/*.jsonl` [R].
- Transcripts: **back up `~/.claude/projects`** — startup GC silently deleted ~2,300 transcripts (v2.1.149, 2026-05-24, anthropics/claude-code#62041) [V].
- Windows service/scheduler: `claude -p` from Task Scheduler hangs with no console window-station (anthropics/claude-code#96932, v2.1.281, open 2026-09-25) [V]; tibberous/claude-code-elevated drains a file queue from a SYSTEM task or NSSM [V]; `--bg` refused until bypass warning accepted interactively once [V].

## 6. What goes wrong

- Windows junctions: `os.path.islink()` false for 614 junctions → 48,218 live files deleted in 103 s (2026-09-25, r/ClaudeAI via AndroidHeadlines) [V-secondary].
- `rm -rf ... ~/` wiped a Mac (2025-12-08); Cowork deleted 15–27k photos (Jan 2026); anthropics/claude-code#12637 `~` expansion [V via Docker post].
- Compaction: timeout retries → frozen session (#2423); compaction thrash on tool-heavy transcripts; post-compaction rule amnesia [R].
- Windows: native installer resolves `bash` to WSL stub (#37634; fix `CLAUDE_CODE_GIT_BASH_PATH`) [R]; unreadable stdin crashes before v2.1.211 [V].
- GPU contention agent-Unity vs other engine work: no reports [U].

## Reference architecture (agent's synthesis): Windows gamedev agent box behind a web UI

1. Dedicated Windows 11 Pro box (engines need the real GPU; Docker Sandboxes / Hyper-V scripts have no GPU passthrough). Low-privilege `AgentUser` owning only its profile + `D:\agent-work`; main profile, `~/.ssh`, cloud creds ACL-denied.
2. Two work tiers: (a) code/asset scripts in Docker Sandboxes (`sbx run claude`) or WSL2 Bash sandbox with bypass; (b) Editor-in-the-loop on host as `AgentUser` in auto mode, never bypass.
3. Tailscale only; no forwarded ports; ACL to your devices.
4. Front end: `claude remote-control` primary (push, phone approval); CloudCLI on the Tailscale IP for multi-session/file/git view; Channels Telegram with allowlist for chat dispatch.
5. Supervision: logged-in `AgentUser` session with a console-hosted supervisor started at logon (avoid headless Task Scheduler, #96932); NSSM only for the queue drainer.
6. Queue: GitHub Issues labelled `agent` → supervisor → `claude -p --bare --permission-mode auto --permission-prompts none --max-budget-usd N --max-turns M --output-format json`; branch per run, PR-only, protected `main`, required CI.
7. Loops: Ralph or continuous-claude with iteration/cost/duration caps and escape-hatch prompt text; state in a notes file.
8. Unity: official Unity MCP + Unity CLI on a second Unity instance/project copy in the worktree; `-batchmode -nographics` tests; screenshots verify only.
9. Blender: headless `blender -b --python` or blender-mcp; no GUI automation.
10. GUI fallback: computer use / UFO³ only in a dedicated virtual desktop.
11. Egress: Windows Firewall outbound allowlist for `AgentUser` (Anthropic, GitHub, Unity licensing, registries).
12. Observability: hooks → ntfy/Discord; nightly `~/.claude/projects` backup + ccusage; per-run `total_cost_usd` ledger.
13. Rollback: worktree per run + robocopy snapshot of the Unity project before Editor runs; weekly Hyper-V checkpoint of the box.
14. Deny rules: recursive deletes, `git push --force`, `git clean`; `permissions.blockReadsOutsideWorkingDirectories`; leave the dangerous-rm timeout on.

**Top 5 risks → mitigations:** mass deletion via junctions/`~` → never bypass on host, deny recursive deletes, snapshot; exfil via prompt injection → egress allowlist, separate user, `--bare`, scoped tokens; runaway cost → `--max-budget-usd`/`--max-turns`/loop caps/ledger alerts; session death → externalized notes, `--resume <jsonl>`, console-hosted supervisor, transcript backups; GUI flakiness → API-first Unity MCP/CLI, batchmode tests, isolated instance.
