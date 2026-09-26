# Digest 06 — Local Hermes Agent install (`C:\Users\tim\.hermes`), inspected 2026-09-26

Read-only inspection. Secrets not opened; key-like values reported as "present" only.

## Provenance and run state

- Nous Research `hermes-agent`, MIT, git checkout at `~/.hermes/hermes-agent`; `pyproject.toml` version **0.18.0**, HEAD `7e8f50a` (2026-07-04). `origin/main` fetched today is `d0288be`; newest upstream tag `v0.21.4+canary.20260926…` → **about three minor versions behind**. Bootstrapped 2026-06-27, updated once 2026-07-04.
- Old `~/.hermes` layout (current Windows default is `%LOCALAPPDATA%\hermes`); `HERMES_HOME` set explicitly. Venv CPython 3.11.2 (uv). Gateway runs under system `pythonw.exe` with PYTHONPATH → venv, not the venv interpreter.
- **Runs continuously:** Scheduled Task `\Hermes_Gateway` at logon (30 s delay) → `gateway-service\Hermes_Gateway.vbs/.cmd` → `pythonw -m hermes_cli.main gateway run`. Gateway PID alive since 2026-09-25 15:07, 0 active agents, not listening on any port. Cron ticker heartbeat every minute.

## Configured surfaces (config.yaml, redacted)

- Model provider **`nous` (Nous Portal subscription, inference-api.nousresearch.com)**, model `anthropic/claude-fable-5`; no fallbacks. Past sessions used gpt-5.5 (Codex backend) and claude-opus-4.6. Mixture-of-agents preset: gpt-5.5 + deepseek-v4-pro refs, claude-opus-4.8 aggregator.
- Nous Tool Gateway on for web (Firecrawl), browser (browser-use cloud), TTS/STT, image gen, video gen; aux keys present.
- **Messaging:** only Discord configured and it **has never connected** (~10,000 `PrivilegedIntentsRequired` failures; retry 298 today); every start logs "no connected platforms"; 0 channels.
- **Cron:** no `cron/jobs.json` → 0 jobs; `approvals.cron_mode: deny`.
- **Tools:** browser, clarify, code_execution, computer_use, context_engine, cronjob, delegation, file, homeassistant, image_gen, memory, session_search, skills, spotify, terminal, todo, tts, video, video_gen, vision, web, x_search. **No MCP servers configured.**
- Delegation: orchestrator on, ≤3 concurrent children, depth 1, 50 iterations each. Kanban: gateway dispatch, auto_decompose on, 0 tasks.
- Memory: built-in file memory, nudge every 10 turns. Skills: create-nudge every 15 turns, no write approval, no guard; curator weekly, consolidation off. `SOUL.md` stock persona.
- Windows: `terminal.backend: local`, `persistent_shell: true`, approvals manual. Dashboard (port 9119) not running; port 8081 is a `bun` process (likely ClaudeOS).

## What the framework offers (source evidence)

| Capability | File |
|---|---|
| Tool modules | `tools/`: terminal, file, browser (+CDP), code_execution, computer_use, delegate/async_delegation, cronjob, kanban, memory, session_search, skills/skill_manager/skills_hub/skills_guard, mcp_tool/mcp_oauth, send_message, image/video gen, tts, vision, web, x_search, todo, clarify, tool_search, tirith_security |
| **MCP client** (stdio + HTTP) | `tools/mcp_tool.py`; docs `features/mcp.md`; `optional-mcps/` incl. **unreal-engine**, linear, n8n |
| **MCP server** (expose Hermes to Claude Code/Cursor/Codex) | `mcp_serve.py` (`hermes mcp serve`) |
| Subagents | `tools/delegate_tool.py`, `features/delegation.md` |
| Cron | `cron/scheduler.py`, `tools/cronjob_tools.py` |
| Self-authoring skills + curator ("learning") | `tools/skill_manager_tool.py`, `hermes_cli/curator.py`, `features/curator.md` |
| Memory providers | `plugins/memory/`: honcho, mem0, supermemory, hindsight, byterover, holographic, openviking, retaindb |
| Gateway platforms | `plugins/platforms/`: telegram, discord, slack, whatsapp, signal, matrix, mattermost, email, sms, teams, google_chat, homeassistant, irc, line, **ntfy**, feishu, dingtalk, wecom, simplex, photon, raft |
| **Web dashboard** | `hermes_cli/web_server.py` (FastAPI, `hermes web`, port 9119), `features/web-dashboard.md` |
| Batch / headless / API | `batch_runner.py`, `hermes_cli/oneshot.py` (`-z`), `features/batch-processing.md`, `features/api-server.md` |
| **Driving Claude Code / Codex / OpenCode** | bundled skills `skills/autonomous-ai-agents/{claude-code,codex,opencode}` (Claude Code via `claude -p` or tmux); Codex app-server runtime; ACP adapter `acp_adapter/` |
| Other | Kanban multi-agent board, mixture-of-agents, LSP, checkpoints; optional skills `optional-skills/creative/blender-mcp`, `gaming/` |

## Skills present (77 SKILL.md; 72 shipped, 5 user-provided)

User-provided: `claude-os` (connects Hermes to the ClaudeOS dashboard at localhost:8081), `dream` (symlink → `D:\ClaudeOS\skills\dream`), `graphify`, `personas` (pantheon loader), `productivity/optimize-mission` (goals → ClaudeOS Mission Control JSON). **None created by the agent** (`created_by` empty for all 73 tracked). Nothing mentions tk-studio, Godot, or Blender (Blender only as an uninstalled optional skill). `missions.json` here comes from ClaudeOS.

## State of use

- 5 sessions / 111 messages, all CLI, **2026-06-26 → 2026-07-04; none since**. **0 memories.** Skill usage: dream 4, graphify 2, obsidian 1; 71 skills marked stale. Curator ran 11× (last 2026-09-20, "no changes"). Kanban 0 tasks. Logs since 2026-08-16 almost entirely Discord reconnect errors.
- Summary: gateway running, idle; real use stopped early July.

## Windows fitness

- Native Windows officially supported without WSL (`website/docs/user-guide/windows-native.md`, feature matrix lines 85–102). Terminal tool runs via Git Bash (`HERMES_GIT_BASH_PATH`). Gateway managed via Scheduled Task with Startup-folder fallback (`hermes_cli/gateway_windows.py`).
- Limitations: dashboard embedded `/chat` terminal needs WSL (lines 99–102); web TUI PTY needs WSL (`AGENTS.md:485`); no Ctrl+Z; Matrix encryption, Google Meet v1, Stripe Link skill don't work. `scripts/check-windows-footguns.py` exists.
