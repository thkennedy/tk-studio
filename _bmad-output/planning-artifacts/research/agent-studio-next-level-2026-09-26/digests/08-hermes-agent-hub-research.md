# Digest 08 — Hermes Agent (Nous Research) as a hub/orchestrator, web research 2026-09-26

21 searches, ~49 fetches. Grades: [V] fetched primary page, [R] secondary, [U] unverified. `D/` = https://hermes-agent.nousresearch.com/docs/ ; `G` = https://github.com/NousResearch/hermes-agent

## 1. What it is (Sept 2026)

- MIT; **249.2k stars**, 52.9k forks, 5k+ open issues and 5k+ open PRs [V]. Public since 2026-02-25 [R].
- Architecture [V D/developer-guide/architecture]: one `AIAgent` loop shared by CLI, gateway, cron, ACP; 70+ tools in ~28 toolsets; gateway with 25+ platform adapters, allowlists, DM pairing, cron tick; cron jobs are "first-class agent tasks"; SQLite `state.db` with FTS5; `delegate_task` subagents; 7 terminal backends (local, Docker, SSH, Singularity, Modal, Daytona, Vercel Sandbox).
- Cadence [V G/releases]: v0.21.0 "Pantheon" 08-31 (Bot Mode, cron-with-memory, live subagent steering, MCP command center) → 0.21.1 (09-07, 632 PRs) → 0.21.2 (09-11, "state.db reliability campaign addressing corruption") → 0.21.3 → 0.21.4 (09-21, ~1,800 PRs) → 0.21.5 (09-24, ~460 PRs). **Patch every 3–7 days.**
- Nous raising ≥$75M at $1.5B [V techcrunch 2026-07-13]. Teknium orchestrated 1,393 subagents to refactor Hermes itself (1.06M→698k lines, ~$25k, Claude Fable 5.1) [V nousresearch.com, Sep 2026]. Governance flag: blanked plagiarism issue, blocked commenters [V HN 48187581].
- **Paid layer:** **Nous Portal** = "the recommended way to run Hermes Agent": one OAuth to 300+ models incl. Claude Opus/Sonnet/Haiku, GPT-5.x, Gemini + Tool Gateway. Nous's own Hermes-4 models "not recommended for use inside Hermes Agent" [V D/integrations/nous-portal]. Tiers Free / Plus $20 / Super $100 / Ultra $200 [R]. **Hermes Cloud** hosted instance $0.56–1.09/day + inference [V portal.nousresearch.com/cloud]. Nothing functional is paywalled; subscription = billing aggregation + hosting.

## 2. Learning / self-improvement

- Skills [V D/user-guide/features/skills]: agent saves workflows via `skill_manage`; background self-improvement review after a turn can patch skills; `skills.write_approval: true` stages writes for human review; linter + `skills.guard_agent_created`; hub install from official/skills.sh/GitHub; agentskills.io-compatible.
- Memory [V D/user-guide/features/memory]: **`MEMORY.md` 2,200 chars + `USER.md` 1,375 chars**, injected frozen at session start; when full the tool errors; cross-session recall = FTS5 `session_search`; 7 external providers run alongside.
- Curator [V]: on by default, 7-day; agent skills active → stale (14d) → archived (30d); LLM consolidation opt-in; never deletes.
- **"Dreaming" not in core** (issue #25309 open, P3, no maintainer reply) [V]. `hermes-agent-self-evolution` = offline DSPy+GEPA optimizer, PR-proposing, $2–10/run [V].
- Reliability [R aiagentstore 2026-07-12 ranked complaints]: #1 self-evaluation always reports success; #2 auto-improvement overwrites manual skill edits; #8 skill/memory bloat; #9 learned rules omit constraints and fail later; #19 failed tasks persist as memory. HN: "Explicit success criteria fixes most of the self-grading issues" [V]. "Practice Makes Unsafe": all 21 evolved-skill configs produced unsafe artifacts [V arxiv 2608.12851]. Field report: 3 months in, agent "sending my own notes back to me as voice messages" [V substack 2026-05-11].

## 3. Orchestration fitness

- **Driving Claude Code is a bundled skill** [V D/…/autonomous-ai-agents]: `terminal(command="claude -p '…' --allowedTools … --max-turns 10", workdir, timeout)`; `--output-format json` → `session_id`, `total_cost_usd`; interactive mode "requires tmux orchestration"; bypass only in isolated envs. Codex and OpenCode skills too.
- Subagents [V D/…/delegation]: `delegate_task` async, ≤10 concurrent, depth 1, iteration cap 250, **no default wall-clock timeout**, **global delegation model, no per-task model parameter**; leaf children cannot use memory/cron/send_message.
- Cron [V]: NL schedules, deliver to any channel, isolated memoryless sessions (`continuity=True` chains), `max_parallel_jobs`, 60s tick, **requires gateway daemon**.
- API server [V D/…/api-server]: OpenAI-compatible :8642 inside gateway; Runs API (run_id, event stream, stop, approval) + Jobs API (CRUD/pause/resume/run); `max_concurrent_runs: 10` → **HTTP 429; no durable queue**.
- MCP [V]: client stdio + HTTP/SSE with OAuth/PKCE; **`hermes mcp serve`** exposes Hermes as an MCP server (10 messaging tools) so Claude Code can call back.
- Bot Mode [V D/user-guide/bot-mode]: profiles as named bots with own model/skills/memory/credentials; `message_agent` dispatch; group rounds.
- Hub write-ups: dual-stack (Hermes on VPS, Claude Code on Mac, MCP over SSH), 90–180s phone-to-PR; failure modes: 200–400ms per MCP call, **"two cron jobs both dispatch tasks to Claude Code, you get race conditions"** (stagger ≥5 min), silent SSH drops, separate skill libraries [V dev.to 2026-05-21]. Orchestrator guide: Hermes plans/schedules, Claude Code executes, markdown kanban is the queue, "worker never grades its own homework" [V viableedge]. `hermes-claude-code-rc` (`/cc start` from Telegram → `claude remote-control` URL): 4★, 2 commits, needs core patch [V].

## 4. Interfaces

- Gateway: Telegram, Discord, Slack, WhatsApp, Signal, Email built in; Matrix, Teams, SMS, WeCom, BlueBubbles (iMessage), webhook via plugins [V]. Auth: allowlists, 8-char pairing codes with expiry/rate-limit/lockout [V D/user-guide/security].
- **Web dashboard** [V D/…/web-dashboard]: `hermes dashboard` → 127.0.0.1:9119; tabs Status, Chat (TUI over WebSocket), Sessions, Config, Cron, Skills, MCP, Logs, Analytics, Channels, Pairing, Profiles, System, Webhooks. **Auth fails closed**: non-loopback bind requires basic, Nous OAuth, or self-hosted OIDC; Tailscale recommended. REST `/api/status`, `/api/sessions`, bearer tokens. Responsive, no mobile-specific docs.
- Third-party PWA nesquena/hermes-webui 18.6k★, passkeys/OIDC [V]. Hermes Desktop (Electron/MSIX).

## 5. Windows

- Native Win10/11 **Tier 1** via `install.ps1` (pinned Python 3.14, Node, ripgrep, FFmpeg); MSIX Win11 22H2+ [V D/getting-started/platform-support]. "Chat, the gateway, cron, browser tools, and MCP all run natively" [R hermesatlas 2026-09-24].
- **Hard limits**: no fork, /tmp, UNIX sockets, signals, **PTY** → dashboard **/chat tab WSL2-only**, tmux interactive Claude Code unavailable natively; gateway-as-service documented only as systemd-in-WSL + Task Scheduler keepalive [V D/user-guide/windows-wsl-quickstart]. Community guides use WSL2 [R].

## 6. Comparisons, incidents, costs

- vs OpenClaw [V composio 2026-09-15]: "OpenClaw stronger when people need to share and supervise agent sessions. Hermes stronger when you want persistent agents that work together"; OpenClaw CVE-2026-32922 (9.9); Hermes defaults `smart` approval.
- vs Claude Code [V fast.io 2026-05-15]: Hermes treats messaging as primary; CC Remote Control/iOS secondary; "they stack." Hermes children = `AIAgent` threads vs CC fork/worktree [V].
- vs Letta/mem0: Hermes native memory is a 3.5k-char notepad + FTS5, bundles Mem0 as provider [R].
- **Security**: CVE-2026-7396, -7397 (fixed 0.9.0), -6829 (webui); **April 2026 audit: 4 critical** (regex-only shell detection, no read deny-list, containers skip all approvals, persistent skill injection) + 9 high [V CSA 2026-05-04]; CVE-2026-9366 injection [R]; July 2026 attacker ran Hermes YOLO unattended inside Thailand MoF (misuse) [V thehackernews]. Mitigations now: context-file injection scan, SSRF blocking, env stripping, Tirith, `HERMES_WRITE_SAFE_ROOT` [V].
- Costs: VPS $6.49–8.99 + LLM $2–60/mo [R].

## 7. Model flexibility

- Providers [V D/integrations/providers]: Nous Portal, Anthropic API key, **Anthropic OAuth (Claude Max + purchased extra credits only)**, OpenAI/Codex OAuth, OpenRouter, Vertex, Bedrock, Copilot, local (≥64k ctx); `/model` mid-session; `delegation.model` global.
- **Claude-subscription hub is contested**: Anthropic banned third-party subscription OAuth 2026-02-20 [V]; 06-16 rollback says `claude -p`/Agent SDK "continues to work with your subscription"; **#47260 (open, needs-decision): Hermes OAuth still drains extra-usage credits**; Agent SDK provider proposal #25267 blocked/P3 [V]. Practical split in the wild: **hub on API key/Portal/cheap model, `claude -p` worker on its own Max login** [V viableedge, dev.to].

## Fit assessment (agent's synthesis)

**Better than a hand-rolled ClaudeOS runner:** gateway breadth + pairing auth + fail-closed dashboard + cron + OpenAI-compatible API + session search + analytics, maintained at ~1,800 PRs/release; Claude Code delegation is a bundled skill with the right flags; `hermes mcp serve` gives Claude Code a callback path; Bot Mode profiles isolate specialists without a process manager.

**Worse:** **no durable work queue** (in-process threads, 429 past 10 runs, memoryless cron, dual-cron race conditions), so a phase/story pipeline still needs its own queue, locks, idempotency; the learning loop is a liability for a deterministic pipeline (false-success grading, silent overwrites) and gating it removes most of the "Hermes-ness"; native Windows loses the PTY (no dashboard chat, no tmux Claude Code, service via WSL); memory is a 3.5k-char notepad, so BMad artifacts remain the source of truth.

**Three biggest risks:** (1) security surface on the box holding repos and keys (700k-line codebase, 5k issues, critical audit five months ago, internet-facing chat as input, shell + `claude` reach) → Docker backend + `HERMES_WRITE_SAFE_ROOT` + deny rules mandatory; (2) churn (weekly 460–1,800-PR patches, state.db corruption campaign, plugins needing core patches); (3) Claude billing/ToS ambiguity for a Claude-OAuth hub → hub on Portal/API key, Claude Code on its own login.
