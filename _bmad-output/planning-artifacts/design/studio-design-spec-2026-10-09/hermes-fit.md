# Appendix B. Hermes: what it was for, what it offers now, and whether it still earns its place

Part of the [studio design spec](README.md). Evidence: a fresh digest of the installed Hermes checkout and its own docs, written 2026-10-09 ([H1 digest](../../research/hermes-fit-2026-10-09/digests/H1-hermes-capabilities-2026-10.md), 72 sourced bullets), plus the September hub research ([digest 08](../../research/agent-studio-next-level-2026-09-26/digests/08-hermes-agent-hub-research.md)) and the October integration round ([run 1 §7 B3](../../research/studio-front-end-and-repo-structure-2026-10-09/research.md#7-b3-events-sse-projection-hermes-chat-hosting)). The ruling is [decision D2](decisions.md#d2-hermes).

## B.1 How Hermes was meant to be used, in the plan's own words

| Date | Plan | Source |
|---|---|---|
| 2026-09-26 | **Front door and dispatcher only, never the runner.** Telegram intake; the dashboard on the tailnet "for looking"; one skill `tk-submit` that turns a conversation into job JSON and POSTs it to the supervisor; one skill `tk-status`; one cron reporting open runs; `hermes mcp serve` so a Claude Code session can message Tim back; learning gated. Reasons for "never the runner" on record: no durable queue, a global delegation model against the contract's per-leg routing, no wall-clock guard, dual-dispatch races, a self-grading learning loop. | [planning pass §3 Phase 2](../../briefs/planning-pass-agent-pc-and-supervisor-2026-09-26.md), [next-level research §7.2](../../research/agent-studio-next-level-2026-09-26/research.md) |
| 2026-09-01 (recovered 2026-10-09) | **Hermes profiles own live agent state** (memory, sessions); the front end owns presentation (persona bindings); tk-studio owns routing. "Hermes is generalised by extraction, not rebuilt: profiles give isolated memory and sessions per agent; the Pantheon persona YAML is a complete agent-config schema; `CoreMode` already drives state-to-animation." Roadmap stage C depended on "a chattable orchestrator per project", meaning Hermes with one profile per project. | [office digest §4, §5](../../research/studio-office-ui-2026-09-01/digest-studio-office-ui.md) |
| 2026-10-09 | "The gamified studio front end is the surface he will use most, **and it wraps the Hermes agent**." | [10-09 handoff](../../../implementation-artifacts/handoff-phase1-loop-2026-10-09.md) |
| 2026-10-09, research run 1 | Hermes consumed server-to-server through its API server (loopback, key held by the supervisor), re-emitted as a studio-shaped SSE stream; never embed the dashboard chat. | [run 1 R10](../../research/studio-front-end-and-repo-structure-2026-10-09/research.md#12-recommendations) |

So the plan was consistent: Hermes talks, the supervisor runs. What the research never did was check the plan against what Hermes actually is in October 2026, which is what Tim objected to. B.2 to B.4 do that.

## B.2 What "the agents need to be registered so Hermes can see them" means

In Hermes an **agent is a profile**: a directory under the Hermes home holding one agent's config, memory, skills, credentials and sessions. Everything that enumerates agents (Bot Mode, the kanban orchestrator, bot-to-bot `message_agent`, cross-machine peers) enumerates profiles. A registered profile gets: routing from chat (`-p <profile>`, a URL prefix on the API server), its own `.env` and key, isolated memory and skills and sessions, kanban assignability, and visibility in the roster that Bot Chat injects into every system prompt.

What that means for the studio, with the evidence:

- **The supervisor and `claude -p` workers cannot be registered as Hermes agents.** A profile is a Hermes agent; there is no mechanism to register a non-Hermes process as a roster member. The kanban's "external CLI worker lane" for Claude Code is documented as "not yet a paved path". The only external-agent registration is A2A (Agent2Agent, port 9900), which requires the external side to run an A2A server, and inbound A2A tasks run as a Hermes session anyway. (H1 §1.)
- **Every dispatch surface Hermes exposes runs a Hermes turn.** API server runs, inbound webhooks, kanban workers and A2A all execute a Hermes agent with Hermes tools. "Hermes never runs `claude -p`" is enforceable only by convention (toolset limits, approval mode, an `approvals.deny` glob), not by architecture, and the bundled `claude-code` skill that teaches Hermes to drive Claude Code is installed by default on this box. (H1 §1, §4.)
- **On this box there is only the default profile.** No `profiles/` directory exists; nothing in Hermes knows the studio, a project, or a role. (H1 §1.)

Conclusion for the design: if Hermes is to "see" the studio's agents, the studio must create a Hermes profile per agent (or per project) and keep it in step with the studio's routing. That is a mirror, not a source of truth. The [agent registry in README §7.2](README.md#72-the-agent-registry) is therefore the supervisor's, with an exporter that writes Hermes profiles when Hermes is the adapter. The 2026-09-01 statement "Hermes profiles own live state" is narrowed to "Hermes profiles own Hermes's conversational memory"; live work state comes from the queue and the journal, which Hermes never sees.

## B.3 What Hermes offers that the studio would otherwise build

Checked against the installed version (0.21.5+3807, 2026-09-24) and the 0.21.6 release of 2026-10-08.

| Capability | What it is | Would the studio build it otherwise? |
|---|---|---|
| **Telegram gateway** with allowlists, DM pairing codes, a home channel; 25 platforms behind one adapter model | configured and running on this box today | **Yes.** Without Hermes, inbound Telegram needs Claude Code channels (research preview, needs a live session and Bun) or the studio's own bot with pairing and allowlists. This is the one capability with no cheap substitute. |
| **`hermes send`** | posts to Telegram from any process, no gateway, no model | useful today: the supervisor can shell out to it for pushes; it already uses the bot's token directly, so this is a convenience, not a gap |
| **Cron with deliver-to-channel**; `--no-agent --script` runs a script with no model turn | status nudges to Telegram | the studio has jobs and a pacer; delivery to Telegram is what it lacks, which `hermes send` or the notifier covers |
| **Memory**: MEMORY.md (2,200 characters), USER.md (1,375), FTS5 session search; write approval on | a product-owner conversation remembers about 1,300 tokens of notes plus searchable transcripts | partly: the studio's memory of a project is its kb, plan and ledger, which are larger and already exist; the conversational notepad is cheap to replicate |
| **Skills** as slash commands, with `.env`-backed secrets the model never sees | `tk-submit` could `curl` the supervisor with the bearer from `.env` | no; the chat route on the supervisor makes this unnecessary |
| **API server** (loopback, keyed): `/v1/runs` with SSE events, approvals, stop, 24-hour idempotency keys; sessions REST with `/chat/stream` | the documented path for a custom UI to talk to Hermes | only if Hermes is the chat brain (option A); the supervisor's own chat route replaces it under B and C |
| **Kanban**: durable SQLite board, dispatcher, review loop, dependency graph, dashboard REST and WebSocket | a second work queue | **no, and it conflicts**: it is profile-only, its dashboard REST is unauthenticated by design, and the supervisor already owns the queue |
| **Bot Mode / profiles / peers / A2A** | multi-agent roster across machines | no; the studio's roster is the routing table and the registry |
| **Dashboard** (loopback, fails closed off loopback) | sessions, cron, config, logs, analytics; the chat tab's native-Windows status is contradictory in the same docs build | no; the studio web is the dashboard |
| **Nous Portal** as the hub's model bill | one subscription for 300 models plus a tool gateway (web, images, TTS) | only the chat brain would use it; the studio's brain is Claude under the Max login |

## B.4 What it costs

- **A second always-on agent runtime** (Python, Scheduled Task) with its own auth boundaries (API key, webhook HMAC, dashboard token) and, on native Windows, a `local` terminal backend with no sandbox and no Tirith scanner. Hermes's own security policy says the only boundary against an adversarial model is the OS.
- **Churn.** About 25,000 commits in two months, weekly stable releases, 0.21.6 rolling up 2,106 PRs with four dashboard-auth fixes (rate-limit bypass, session takeover via login redirect). This install tracks `main`, not stable.
- **A live credential hazard on this box.** `auth.adopt_external_logins: true` (set, and the default) lets Hermes borrow and refresh Claude Code's OAuth credentials; both programs use single-use rotating refresh tokens, so whichever refreshes first invalidates the other's copy. That is the Max login the supervisor's workers depend on. The fix is one line (`auth.adopt_external_logins: false`) and is listed for Tim in the reply, since it touches credential handling.
- **The forbidden capability ships enabled.** The bundled `claude-code` skill is installed by default. Under any option that keeps Hermes it is disabled or allow-listed out.
- **Billing stance.** Hermes documents Claude OAuth as "Claude Max with purchased extra-usage credits only, always billed as extra usage"; the runbook's rule to keep the hub on Nous Portal stands.

Corrections to the ledger from this digest: the learning gates **are** set on this box (`memory.write_approval: true`, `skills.write_approval: true`; `approvals.cron_mode` defaults to `deny`). The dashboard is not running and the API server is not enabled in `config.yaml` (`.env` was not opened, by rule).

## B.5 Three options, scored

| | A. Hermes is the chat brain, wrapped by the office | B. Drop Hermes | C. Hermes as the first inbound adapter behind a supervisor-owned chat |
|---|---|---|---|
| Keeps "the supervisor is the only thing that runs `claude -p`" | by convention only (toolset limits, deny globs); the API server, webhooks, kanban and A2A all run Hermes turns | by construction | by construction: Hermes is reached only through surfaces the supervisor controls (`hermes send`, a webhook route with `deliver: telegram`, optionally `/v1/runs` for a brainstorming turn) |
| Telegram inbound | yes, today | needs Claude Code channels (preview) or our own bot | yes, but an inbound Telegram message is still a Hermes turn: Hermes runs a relay skill that forwards the text to the supervisor's engagement input and returns the reply |
| Memory for the conversation | Hermes notepad plus FTS5 | the engagement record, the kb and the ledger | the engagement record; Hermes memory optional per profile |
| Who answers the product owner | Hermes (Nous Portal model), with the studio's planner behind a skill | the studio's planner leg (`claude -p` with the plugin) | the studio's planner leg; Hermes relays |
| The registry | Hermes profiles would have to mirror every agent by hand | the supervisor's | the supervisor's, exported to Hermes profiles when wanted |
| Queue | two (Hermes kanban and the supervisor) | one | one |
| Ops | two processes, two auth boundaries, weekly churn, the credential hazard | one process | two processes, guardrails required: `adopt_external_logins: false`, the `claude-code` skill disabled, API server and dashboard loopback-only, `approvals.mode: manual` for the Telegram toolset |
| Fit with the 2026-10-09 wording "wraps the Hermes agent" | literal | changes the wording, keeps the intent (one conversation from the phone and the office) | the office wraps the studio chat; Hermes carries the phone leg |
| Cost to adopt | low to start, medium to keep prompts and toolsets pinned across updates, ongoing ops | medium one-off (Telegram bot, notifications), lowest ongoing | low to medium; replaceable |

**What the evidence says.** Nothing in the engagement loop depends on a Hermes-only primitive. The one thing Hermes has that is expensive to replace is the Telegram gateway with pairing and allowlists, and that is exactly the piece option C keeps. Option A makes Hermes a second brain with a second queue and a convention-enforced "never runs `claude -p`" rule, which is the shape the September research rejected as a runner for the same reasons. Option B is cleanest to own and loses only the gateway and the notepad.

**Recommendation: C**, with two triggers to revisit: if Claude Code channels leave research preview on Windows, B becomes cheaper than keeping Hermes; if Tim wants Hermes's conversational memory and voice as the studio's personality, A's chat path (the API server, loopback, key held by the supervisor) is the documented route and the registry exporter makes the profiles.

## B.6 If C is ruled: the Hermes work that remains (small)

1. Guardrails on the box (Tim, from the console, since they touch auth): `auth.adopt_external_logins: false`; disable the bundled `claude-code` skill or allow-list the Telegram toolset without `terminal` and `execute_code`; `approvals.mode: manual` for messaging; keep the API server and the dashboard on loopback.
2. One user skill, `tk-relay`: forward the message to `POST /engagements/{id}/input` (or open an engagement) with the bearer from `.env` via `required_environment_variables`, return the reply. Replaces the planned `tk-submit` and `tk-status`.
3. The supervisor pushes through the notifier as today, or `hermes send` where a richer message is wanted.
4. The registry exporter (one profile per project) only if Tim wants Hermes memory per project.
5. Drop the dashboard-on-the-tailnet step; the studio web is the dashboard.
