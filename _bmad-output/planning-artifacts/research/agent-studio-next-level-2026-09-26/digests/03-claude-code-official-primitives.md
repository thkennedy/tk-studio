# Digest 03 — Claude Code official primitives for an unattended agent PC (Sept 2026)

Source pass: docs.claude.com / code.claude.com / platform.claude.com / anthropics/claude-code issues. Grades: [GA] shipped, [beta] preview, [gap] not available.

## Findings

1. **Claude Code on the web / cloud sessions [GA]** — runs on Anthropic-managed VMs or a *self-hosted environment* you provide; Pro/Max/Team/Enterprise; `claude --cloud <task>` and `--teleport`; no GPU, no desktop GUI apps; network default-allowlist. Cannot reach a Windows agent PC for Blender/Unity work. https://code.claude.com/docs/en/claude-code-on-the-web.md
2. **Remote Control [GA]** — `claude remote-control` steers a *local* CLI session from claude.ai/code or the mobile app; code stays on your machine. **Requires a TTY; no daemon/headless mode** (feature requests anthropics/claude-code#30447, #29116 open as of Sept 2026). tmux/screen wrapping is the only reported workaround. https://code.claude.com/docs/en/remote-control.md
3. **Claude Agent SDK [GA]** — `claude-agent-sdk` (Python ≥3.10) / `@anthropic-ai/claude-agent-sdk` (TS); same harness and tools as the CLI; sessions resume from transcripts; `--permission-mode`, `--allowedTools`, `--output-format json|stream-json`, `--json-schema`; subagents + hooks; designed for headless. **No computer-use tool in the SDK.** Works on native Windows PowerShell and WSL2. https://code.claude.com/docs/en/agent-sdk/overview
4. **Managed Agents [beta, `managed-agents-2026-04-01`]** — Anthropic-hosted harness + sandbox (April 2026); self-hosted sandboxes exist but require **Linux, bash, Node 22+**. No Windows path. https://platform.claude.com/docs/en/managed-agents/overview
5. **Scheduling** — Cloud *Routines* (research preview; cloud/self-hosted env; ≥1h interval; schedule/API/GitHub triggers) vs *Desktop scheduled tasks* (local; ≥1min; only while the Desktop app is open; one catch-up run on wake). `/loop` needs a live session. Neither gives always-on unattended Windows execution by itself. https://code.claude.com/docs/en/routines.md · https://code.claude.com/docs/en/desktop-scheduled-tasks.md
6. **Computer use [GA in Desktop app, Windows+macOS; CLI macOS-only, interactive-only, not with `-p`]** — screenshot/click/type over the real desktop; per-app approval each session; not a sandbox. No documentation of sustained multi-hour GUI sessions against Blender/Unity. https://code.claude.com/docs/en/computer-use.md
7. **Plugins / skills / hooks / plugin eval [GA]** — plugins bundle skills, agents, hooks, MCP servers; hooks events incl. SessionStart, PreToolUse, PostToolUse, Stop, SubagentStop, SessionEnd, PermissionRequest; **no built-in budget/time-stop enforcement** (must be custom hook logic). `claude plugin eval` (v2.1.269+, 2026-09-11): graders regex/tool_used/tool_order/file_exists/llm/baseline, 3x with/without plugin, JSON+HTML report, `--threshold` gate; metered API calls. https://code.claude.com/docs/en/plugins/overview.md · https://code.claude.com/docs/en/plugin-evals · https://code.claude.com/docs/en/hooks-guide.md
8. **Windows** — native support since July 2025, Desktop overhaul 2026-04-14; PowerShell native (Git Bash no longer required in 2.1.x). **Known unattended failure modes:** silent REPL exit after 10–30 min of dense Bash calls (anthropics/claude-code#55424, May 2026); indefinite hangs until keypress; WSL interop lag from repeated `powershell.exe` spawns (#29672). https://code.claude.com/docs/en/desktop-wsl.md
9. **Cost / limits** — Max plan shares a 5h rolling window + weekly cap across chat, Cowork, and Code; `--output-format json` reports `total_cost_usd` per run; SDK/`-p` use needs `ANTHROPIC_API_KEY` or a cloud provider identity, not claude.ai session credentials. `--permission-mode dontAsk`, `--permission-prompts none` for prompt-free runs. https://code.claude.com/docs/en/costs.md

## Recommended official-primitives stack (agent's synthesis)

- Agent SDK as the unattended loop on the agent PC, wrapped by a custom supervisor (duration cap, cumulative cost cap, graceful shutdown, auto-restart).
- Custom MCP servers on the agent PC for Blender / Godot / Unity via CLI or Python APIs; avoid GUI computer-use on Windows for long runs.
- Package studio knowledge as a plugin (skills + hooks + agents), gated by `claude plugin eval`.
- Web front end talks to the agent PC over HTTP/queue, not over Remote Control (TTY-bound).
- Persist transcripts for `--resume`; isolate dense Bash runs (WSL/Docker) to dodge the PowerShell REPL exit bug.

## Gaps (honest)

- No official headless daemon for Remote Control; no Windows self-hosted Managed Agents; computer-use unproven for multi-hour engine GUI sessions; budget/time stops are DIY; Max-plan bucket is shared with interactive chat.
