# Red team: the greenfield stack (2026-10-09)

Conclusion under attack: a one-maintainer studio on an always-on Windows 11 box, paid only by a Claude Max subscription, rebuilt as headless `claude -p` (one process per story, `setup-token` auth) inside Docker Sandboxes microVMs, driven by a small home-grown Windows service, with the Workflow tool for bounded fan-outs, OTel per-story metering, ntfy, a Next.js static front end, and one plugin plus a service installer. Budget: 23 surface calls used, over the 20 allowed (WebSearch 7, WebFetch 3, `gh api` 13 of which 4 returned errors: 1 HTTP/2 protocol error, 3 HTTP 422 "more than five AND/OR/NOT operators"). The overrun came from bundling several `gh api` invocations into two Bash commands; I stopped once I noticed and did not run the three follow-up queries I wanted (`/goal`, `ultrareview`, `--bg` on Windows).

Red-team posture: I received no supporting evidence and no run context. Everything below is what a hostile but fair reader would put against the conclusion. Where the evidence also cuts in the conclusion's favour I say so.

## Findings (strongest first)

### F1. The "Max subscription, never an API key" premise rests on a policy Anthropic changed four times in nine months, and the documented direction of `-p` is API-key-only
- **Attacks:** the economic premise ("paid by a Claude Max subscription (never an API key)"), `setup-token` as the long-lived credential, and "one headless Claude Code per story" in parallel.
- **Evidence:**
  - Anthropic's Claude Code legal page (primary): "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK." / "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications." / "Developers building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication" / "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice." In the conclusion's favour, the same page: "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription". [source: https://code.claude.com/docs/en/legal-and-compliance, Anthropic, undated (a secondary source says the authentication section was rewritten 2026-10-07)]
  - 2026 enforcement timeline (secondary): January technical enforcement against subscription OAuth outside Anthropic apps, with "some user accounts ... accidentally banned"; 2026-02-20 clarification that subscription OAuth is for Claude Code and Claude.ai only; 2026-04-04 subscriptions cut off from third-party agent tools; 2026-05-13 announcement of a separate "Agent SDK" credit pool "billed at API rates" from June 15 that explicitly covered `claude -p`; June 15 change paused with "advance notice before a revised plan takes effect". [sources: https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546, The Register, 2026-02-20; https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch, VentureBeat, 2026-05; https://www.digitalapplied.com/blog/anthropic-claude-credit-overhaul-june-15-2026, Digital Applied (blog), 2026-06]
  - Headless docs (primary): "`--bare` is the recommended mode for scripted and SDK calls, and will become the default for `-p` in a future release." and "In bare mode, Claude Code never reads OAuth credentials or the system keychain." and the bare example says "Set `ANTHROPIC_API_KEY` before running it, because bare mode doesn't use your subscription login". [source: https://code.claude.com/docs/en/headless, Anthropic, undated]
  - `setup-token` is "mint-only" with no list/revoke from the CLI, and is "scoped to inference" and "cannot establish Remote Control sessions" (secondary, citing the authentication docs and issue #48373). [source: https://code.claude.com/docs/en/authentication via search summary; https://github.com/anthropics/claude-code/issues/48373]
- **Weight:** material. Nothing found says a person running the unmodified CLI on their own box with their own seat is forbidden; the attack is that (a) the usage-limit promise is explicitly scoped to "ordinary, individual usage", (b) Anthropic has already once announced moving `claude -p` onto API-rate credits and only paused it, and (c) the documented default-to-be for `-p` is a mode that cannot use a subscription at all. A design that hard-codes "never an API key" has no graceful degradation on the day either (b) or (c) lands.
- **Mitigation the conclusion would need:** make the auth/billing path a swappable adapter (subscription token today, API key with a hard spend cap tomorrow); pin the Claude Code version and detect the bare-mode default flip in the service's preflight; keep parallelism modest enough to look like one person's work; budget for the Agent SDK credit scheme returning.

### F2. Headless runs do not pause on usage limits, every parallel story shares one window, and `--max-budget-usd` caps an estimate, not the window
- **Attacks:** one process per story in parallel; the Workflow tool for fan-outs; `--max-budget-usd` as the safety rail; "share of the subscription window" reporting.
- **Evidence:**
  - Workflows doc (primary): "A run doesn't pause in non-interactive mode with `claude -p` or the Agent SDK, in a background session, or in a Remote Control or agent team teammate session" — "the affected agent fails instead." Even interactively, "When it hits the limit a third time, the agent fails." "Runs count toward your plan's usage and rate limits." With ultracode on, a session "reaches a session or weekly limit sooner than the same work with it off." [source: https://code.claude.com/docs/en/workflows, Anthropic, undated]
  - Issue #89798 "[Bug] Workflow crashes when session limit exceeded and user switches accounts" — open, updated 2026-10-09. [source: https://github.com/anthropics/claude-code/issues/89798, GitHub, 2026]
  - Issue #38335 "[BUG] Claude Max plan session limits exhausted abnormally fast since March 23, 2026 (CLI usage)" — open, 877 comments, updated 2026-10-09. [source: https://github.com/anthropics/claude-code/issues/38335, GitHub, 2026]
  - Weekly limits were introduced specifically against subscribers running Claude Code "continuously in the background, 24/7". [source: https://techcrunch.com/2025/07/28/anthropic-unveils-new-rate-limits-to-curb-claude-code-power-users/, TechCrunch, 2025-07-28]
  - Headless doc: `total_cost_usd` and the per-model breakdown "are client-side estimates and can differ from your actual bill"; the costs page says for Max and Pro the session cost figure "isn't relevant for billing purposes" (secondary summary of https://code.claude.com/docs/en/costs). So `--max-budget-usd` bounds a list-price estimate; it says nothing about how much of the 5-hour or weekly window remains.
  - Issue #100882 "[FEATURE] Include limit-reset grants in the headless get_usage control response (read-only)" — open, 2026-10-09: the headless usage control exists but does not expose reset times. [source: https://github.com/anthropics/claude-code/issues/100882, GitHub, 2026]
- **Weight:** material. The always-on box's throughput is bounded by one person's window, tuned by Anthropic against exactly this pattern, and the native primitives chosen (`-p`, Workflow tool) fail rather than wait when the wall is hit. Fan-outs make N agents hit it together.
- **Mitigation the conclusion would need:** the supervisor owns limit awareness (watch `system/api_retry` with `error: "rate_limit"` in stream-json, poll usage, serialize stories near the wall, re-queue failed agents); treat Workflow runs as fail-fast and idempotent; stop presenting `--max-budget-usd` as a quota guard.

### F3. Docker Sandboxes on Windows is a 0.x product with an active backlog of Windows daemon, mount, and reboot failures — including one that defeats "restart on boot"
- **Attacks:** isolation layer; "restart on boot and crash recovery"; worktrees "inside the microVM".
- **Evidence (all docker/sbx-releases, GitHub, 2026; 56 open issues matched "windows" on 2026-10-09):**
  - #678 "Windows: sandboxd cannot start after a Fast Startup ('Shut down') cycle — nerdbox shims survive hibernate in an unkillable state, every `sbx daemon start` exits silently" (opened 2026-10-07). [https://github.com/docker/sbx-releases/issues/678]
  - #157 "sandboxd v0.30.0 on Windows: in-process moby backend cannot self-connect to its own `docker.sock`" (open since 2026-05-19, 16 comments) and #607 same symptom on v0.43.0 (2026-09-21). [https://github.com/docker/sbx-releases/issues/157, .../607]
  - #608 "Windows v0.43.0: sandbox creation fails with erofs 'No space left on device' (downgrading fixed it)". [.../608]
  - #449 "Mounted workspace repeatedly becomes empty inside sandbox (Windows 11/SBX v0.38.0)"; #498 direct-mounted workspace missing immediately after creation. [.../449, .../498]
  - #31 "Bad I/O performance of the working directory inside the sandbox" (open since 2026-04-09); #266 "CRITICAL: Sandbox filesystem on the mounted volume has a seriously degraded performance". [.../31, .../266]
  - #604 "Windows: intermittent sandboxd startup failure in crash-handler"; #598 chmod EIO / symlink EPERM in a `\\wsl.localhost` workspace "(breaks git config, git init, git clone)". [.../604, .../598]
  - #695 "Claude remote control (server mode) does not work" (open 2026-10-09); #692 "Claude sandbox: /design-login and /login cannot coexist"; #685 kit commands "need a login and a running daemon since v0.47.0"; #652 "Docker Sandbox proxy closes HTTPS requests with Empty reply from server". [.../695, .../692, .../685, .../652]
  - Versions moved from v0.43.0 (2026-09-15) to v0.47.0 by early October; the Docker product page advertises winget install but I found no GA statement. [source: https://www.docker.com/products/docker-sandboxes/, Docker, undated]
- **Weight:** material. The daemon is a single point of failure beneath every story, it is being released weekly, and the one Windows report most relevant to an always-on box (survive a shutdown/hibernate cycle) is open and unanswered. Mounted-workspace performance and emptiness bugs attack "git worktree inside the microVM" if the worktree lives on a host mount.
- **Mitigation the conclusion would need:** disable Fast Startup/hibernate on the box; pin the sbx version with a tested downgrade; supervisor preflight that proves a plain sandbox starts and falls back (queue, or host run without bypass) when it doesn't; keep worktrees on the VM disk and sync results out.

### F4. Paperclip is not an adoptable alternative on Windows with a subscription today, and its credential handling is the pattern the legal page names
- **Attacks:** "Paperclip considered as the adopt-instead alternative".
- **Evidence (paperclipai/paperclip, GitHub, 2026, checked 2026-10-09):** 2,910 open issues; 257 open mention Windows; 538 open mention subscription/OAuth. #14066 and #14350: on Windows the Claude subscription connection "can never verify" (422) because the credential reader is Linux/macOS-only; the fix PR #14359 is open and unmerged. #13725 and #15108: subscription connections stop working ~8–12 h after sign-in while the UI still shows "connected"; the server-side token-renewal PR #15319 is open and unmerged. #15237: reconnect "can silently overwrite a durable Claude credential (setup token) with a short-lived one". [https://github.com/paperclipai/paperclip/issues/14066, .../14350, .../13725, .../15108, .../15237, .../pull/14359, .../pull/15319]
  - Legal page: "developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow." [source: https://code.claude.com/docs/en/legal-and-compliance]
- **Weight:** moderate (it is the alternative branch, not the main line). As a bear case it strengthens the "build a small service" choice rather than weakening it — but it also shows what a subscription-driven orchestrator looks like after a year: most of its open bugs are credential plumbing.
- **Mitigation:** drop Paperclip from the decision or re-evaluate only after #14359/#15319 merge; design the home-grown service so it never stores anything but the `setup-token` value Anthropic itself documents for scripts.

### F5. Headless process hygiene on Windows: twin sessions, orphaned children, hooks that report success on failure, and a stream-json protocol that changes every few releases
- **Attacks:** "one process per story", leases and crash recovery, a "deviation-scoring gate" if it is built on hooks, and any supervisor logic that trusts exit codes.
- **Evidence (anthropics/claude-code, GitHub, all open and updated 2026-10-09 unless noted):**
  - #75761 "`--resume` while the original process is still alive → two live processes of one session act on the repo concurrently (orphaned twin keeps working headless)". [https://github.com/anthropics/claude-code/issues/75761]
  - #76353 "Bash tool leaks orphaned child processes on Windows timeout (runaway ... scans accumulate for hours)". [.../76353]
  - #100891 "onFailure 'block' does not block when a Windows hook exits 0xFFFD0000 (powershell.exe -File <missing script> counted as success)". [.../100891]
  - Headless doc: on SIGTERM "Claude Code leaves the turn that was in progress unfinished and records no result for it"; after the turn a `-p` run "can stay open to wait for background work" up to 10 minutes by default, and for background subagents and workflows "the run stays open until that work completes"; subagent-message forwarding, `capabilities`, `plugin_errors`, `mcp_server_errors`, stdin handling and output flushing are each gated on versions between v2.1.205 and v2.1.295. [source: https://code.claude.com/docs/en/headless]
  - Since fixed (fair to the conclusion): #25979 indefinite hang on stalled streaming (closed; a streaming idle watchdog now exists), #71022 per-turn hooks not firing in `-p` (closed), Windows unreadable-stdin crash (fixed v2.1.211).
- **Weight:** moderate. None is fatal alone; together they mean the "small purpose-built service" must implement process-tree kill, twin detection, lease fencing on the worktree, and its own gate verification — the parts that make small supervisors not small.
- **Mitigation:** pin the CLI version and feature-detect via `system/init.capabilities`; never `--resume` without proving the prior PID is dead; kill process trees on lease expiry; have gates verify artefacts, not hook exit codes.

### F6. The Workflow tool's replay and stall semantics are built for read-only fan-outs, not for anything that writes
- **Attacks:** "Workflow tool only for bounded fan-outs such as review and verification" — fine for review; the risk is scope creep into verification that edits, and the fresh-process model.
- **Evidence (primary, https://code.claude.com/docs/en/workflows):** "If a script starts A, B, C, and D in that order and B fails, relaunching returns A from cache and runs B, C, and D again." A stalled agent restarts up to five times and "Files the stalled attempt already changed stay changed, and the tokens it spent stay in the run's total." "No mid-run user input". Concurrency is "Up to 16 concurrent agents by default, fewer when Claude Code has fewer CPUs available, including inside a CPU-limited container". `Date.now()`, `Math.random()` and `new Date()` throw inside scripts. "In a session you start fresh, Claude has no earlier run to relaunch and starts the workflow over as a new run." In `-p` the launch is approved only by a `Workflow` allow rule, auto mode, bypass, a hook, or a permission host.
- **Weight:** moderate. Inside a small-vCPU microVM the fan-out shrinks; a crashed `-p` process loses resumability; partial edits from stalled attempts persist. Acceptable for review and read-only verification, dangerous beyond that.
- **Mitigation:** keep workflow agents read-only by permission rule; size microVMs for the intended fan-out; make the service treat a workflow result as all-or-nothing.

### F7. OTel "per-story metering on a subscription" can only ever be a list-price estimate, and the attribute propagation the design relies on is unverified
- **Attacks:** OTel export tagged with `OTEL_RESOURCE_ATTRIBUTES=story=…,epic=…`, "share of the subscription window".
- **Evidence:** Anthropic's monitoring docs say OpenTelemetry support "is currently in beta and details are subject to change"; the cost metric is `claude_code.cost.usage` (no `cost_usd`), computed locally at list rates; for Max and Pro the figure "isn't relevant for billing purposes" (secondary summaries of https://docs.anthropic.com/en/docs/claude-code/monitoring-usage and https://code.claude.com/docs/en/costs). OneUptime's integration guide, after showing `OTEL_RESOURCE_ATTRIBUTES` for cost grouping, warns "Anthropic's documentation does not state this outright, so verify it against your own fleet rather than assuming." [source: https://oneuptime.com/docs/telemetry/claude-code, OneUptime, undated]. Subagent attribution appears in trace spans (`agent_id`, `parent_agent_id`) only with `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` [source: https://last9.io/docs/integrations/claude-code/, Last9, undated]. No source found confirming resource attributes reach workflow-agent metrics. Share-of-window is not an OTel quantity; the headless usage control lacks reset grants (#100882, F2).
- **Weight:** moderate. The metering story is buildable but is not what the words promise; "list-price-equivalent dollars" is honest, "share of the subscription window" needs a second, undocumented source.
- **Mitigation:** validate attribute propagation on one tagged story with a subagent before building on it; derive window share from the usage control or `/usage`, not OTel.

### F8. The review gate can silently degrade
- **Attacks:** `/code-review --max-findings` per story as a gate.
- **Evidence:** #88190 "`/code-review --comment` silently degrades to terminal printing when the forked agent lacks the posting tools (repro on 2.1.237, after #84093 closed)" — open, 2026-10-09. [https://github.com/anthropics/claude-code/issues/88190]. I could not run the `ultrareview` query (budget), so cloud-upload and false-negative claims are unexamined.
- **Weight:** weak to moderate — one silent-degradation report, but exactly the class of failure that makes an unattended gate worthless.
- **Mitigation:** the service must check that the review produced structured findings, not that the command exited 0.

### F9. Next.js static export adds nothing a plain HTML page would not, and the "simpler surface" is also currently broken inside sbx
- **Attacks:** "a Next.js static export served by the service over SSE".
- **Evidence:** a static export "cannot use API routes since they require a Node.js server" and rewrites are unsupported [source: https://nextjs.org/docs/messages/api-routes-static-export, Vercel, undated]; EventSource will not reconnect "if the response has an incorrect Content-Type or its HTTP status differs from 301, 307, 200 and 204", and cross-origin credentials need `withCredentials` plus explicit CORS headers [source: https://javascript.info/server-sent-events, javascript.info, undated]. On the other side, Remote Control from inside a sandbox is reported not working (sbx #695, F3), so "use Remote Control instead" is not available today either.
- **Weight:** weak. All solvable; the point is only that the front-end framework choice buys little and the SSE reconnection and cross-port cookie behaviour must be handled explicitly.

## Searched for and not found
- Any Anthropic statement that scripted `claude -p` on one's own machine with one's own subscription is prohibited; the legal page explicitly permits signing in to the unmodified binary, and the "ordinary, individual usage" clause governs limits, not permission.
- Any 2026 report of a subscription suspended solely for parallel or scheduled `claude -p` use; the suspension reports found cite third-party OAuth clients, account sharing, limit evasion, and datacenter IPs.
- A Docker GA statement for Sandboxes, or Anthropic documentation of Claude Code support inside sbx.
- Reports of `/goal` misjudging completion (query not run: budget).
- `ultrareview` false-negative or uncommitted-upload reports (query failed with HTTP 422; not rerun: budget).
- `claude --bg` / `claude agents --json` problems on Windows (query failed with HTTP 422; not rerun: budget). Note the headless doc states `-p` "rejects `--bg`", which is consistent with the conclusion's "convenience only" framing.
- Evidence either way that `OTEL_RESOURCE_ATTRIBUTES` propagate to subagent or workflow-agent metrics.
- Post-mortems of small home-grown supervisors (not searched: budget).
- Credential passthrough of a claude.ai login into a Docker Sandbox microVM: only indirect signals (#692 login conflicts, #642 OAuth refresh 401 through the proxy for a different vendor).

## Sources
| n | url | publisher | pub date | accessed | used for |
|---|-----|-----------|----------|----------|----------|
| 1 | https://code.claude.com/docs/en/legal-and-compliance | Anthropic | undated (secondary: rewritten 2026-10-07) | 2026-10-09 | F1, F4 |
| 2 | https://code.claude.com/docs/en/headless | Anthropic | undated | 2026-10-09 | F1, F2, F5 |
| 3 | https://code.claude.com/docs/en/workflows | Anthropic | undated | 2026-10-09 | F2, F6 |
| 4 | https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546 | The Register | 2026-02-20 | 2026-10-09 (via search) | F1 |
| 5 | https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch | VentureBeat | 2026-05 | 2026-10-09 (via search) | F1 |
| 6 | https://www.digitalapplied.com/blog/anthropic-claude-credit-overhaul-june-15-2026 | Digital Applied (blog) | 2026-06 | 2026-10-09 (via search) | F1 |
| 7 | https://autonomee.ai/blog/claude-code-terms-of-service-explained/ | Autonomee (blog) | 2026, updated 2026-10-07 | 2026-10-09 (via search) | F1 context |
| 8 | https://code.claude.com/docs/en/authentication | Anthropic | undated | 2026-10-09 (via search) | F1 setup-token scope |
| 9 | https://github.com/anthropics/claude-code/issues/48373 | GitHub (anthropics/claude-code) | 2026 | 2026-10-09 (via search) | F1 setup-token mint-only |
| 10 | https://github.com/anthropics/claude-code/issues/38335 | GitHub | 2026-03, updated 2026-10-09 | 2026-10-09 | F2 |
| 11 | https://github.com/anthropics/claude-code/issues/89798 | GitHub | 2026, updated 2026-10-09 | 2026-10-09 | F2 |
| 12 | https://github.com/anthropics/claude-code/issues/100882 | GitHub | 2026-10-09 | 2026-10-09 | F2, F7 |
| 13 | https://techcrunch.com/2025/07/28/anthropic-unveils-new-rate-limits-to-curb-claude-code-power-users/ | TechCrunch | 2025-07-28 | 2026-10-09 (via search) | F2 |
| 14 | https://github.com/docker/sbx-releases/issues/678 | GitHub (docker/sbx-releases) | 2026-10-07 | 2026-10-09 | F3 |
| 15 | https://github.com/docker/sbx-releases/issues/157 | GitHub | 2026-05-19 | 2026-10-09 | F3 |
| 16 | https://github.com/docker/sbx-releases/issues/607 | GitHub | 2026-09-21 | 2026-10-09 | F3 |
| 17 | https://github.com/docker/sbx-releases/issues/608 | GitHub | 2026-09-21 | 2026-10-09 | F3 |
| 18 | https://github.com/docker/sbx-releases/issues/449 | GitHub | 2026-08-15 | 2026-10-09 | F3 |
| 19 | https://github.com/docker/sbx-releases/issues/498 | GitHub | 2026 | 2026-10-09 (via search) | F3 |
| 20 | https://github.com/docker/sbx-releases/issues/31 | GitHub | 2026-04-09 | 2026-10-09 | F3 |
| 21 | https://github.com/docker/sbx-releases/issues/266 | GitHub | 2026-06-24 | 2026-10-09 | F3 |
| 22 | https://github.com/docker/sbx-releases/issues/604 | GitHub | 2026-09-18 | 2026-10-09 | F3 |
| 23 | https://github.com/docker/sbx-releases/issues/598 | GitHub | 2026-09-17 | 2026-10-09 | F3 |
| 24 | https://github.com/docker/sbx-releases/issues/695 | GitHub | 2026-10-09 | 2026-10-09 | F3, F9 |
| 25 | https://github.com/docker/sbx-releases/issues/692 | GitHub | 2026-10 | 2026-10-09 | F3 |
| 26 | https://github.com/docker/sbx-releases/issues/685 | GitHub | 2026-10 | 2026-10-09 | F3 |
| 27 | https://github.com/docker/sbx-releases/issues/652 | GitHub | 2026-09-30 | 2026-10-09 | F3 |
| 28 | https://www.docker.com/products/docker-sandboxes/ | Docker | undated | 2026-10-09 (via search) | F3 |
| 29 | https://github.com/paperclipai/paperclip/issues/14066 | GitHub (paperclipai/paperclip) | 2026 | 2026-10-09 (via search) | F4 |
| 30 | https://github.com/paperclipai/paperclip/issues/14350 | GitHub | 2026 | 2026-10-09 (via search) | F4 |
| 31 | https://github.com/paperclipai/paperclip/issues/13725 | GitHub | 2026 | 2026-10-09 (via search) | F4 |
| 32 | https://github.com/paperclipai/paperclip/issues/15108 | GitHub | 2026 | 2026-10-09 (via search) | F4 |
| 33 | https://github.com/paperclipai/paperclip/issues/15237 | GitHub | 2026 | 2026-10-09 (via search) | F4 |
| 34 | https://github.com/paperclipai/paperclip/pull/14359 | GitHub | 2026 | 2026-10-09 | F4 (open, unmerged) |
| 35 | https://github.com/paperclipai/paperclip/pull/15319 | GitHub | 2026 | 2026-10-09 | F4 (open, unmerged) |
| 36 | https://github.com/anthropics/claude-code/issues/75761 | GitHub | 2026, updated 2026-10-09 | 2026-10-09 | F5 |
| 37 | https://github.com/anthropics/claude-code/issues/76353 | GitHub | 2026, updated 2026-10-09 | 2026-10-09 | F5 |
| 38 | https://github.com/anthropics/claude-code/issues/100891 | GitHub | 2026-10-09 | 2026-10-09 | F5 |
| 39 | https://github.com/anthropics/claude-code/issues/25979 | GitHub | closed 2026-10-09 | 2026-10-09 | F5 (fixed) |
| 40 | https://github.com/anthropics/claude-code/issues/71022 | GitHub | closed 2026-10-09 | 2026-10-09 | F5 (fixed) |
| 41 | https://docs.anthropic.com/en/docs/claude-code/monitoring-usage | Anthropic | undated | 2026-10-09 (via search) | F7 |
| 42 | https://code.claude.com/docs/en/costs | Anthropic | undated | 2026-10-09 (via search) | F2, F7 |
| 43 | https://oneuptime.com/docs/telemetry/claude-code | OneUptime | undated | 2026-10-09 (via search) | F7 |
| 44 | https://last9.io/docs/integrations/claude-code/ | Last9 | undated | 2026-10-09 (via search) | F7 |
| 45 | https://github.com/anthropics/claude-code/issues/88190 | GitHub | 2026, updated 2026-10-09 | 2026-10-09 | F8 |
| 46 | https://nextjs.org/docs/messages/api-routes-static-export | Vercel | undated | 2026-10-09 (via search) | F9 |
| 47 | https://javascript.info/server-sent-events | javascript.info | undated | 2026-10-09 (via search) | F9 |
