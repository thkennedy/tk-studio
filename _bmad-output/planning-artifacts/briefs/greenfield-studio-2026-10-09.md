# Greenfield studio: how we would build it from scratch today, and what that means for what exists (2026-10-09)

Proposal, not a decision. Answers Tim's question of 2026-10-09: "if we were to write this entire thing from scratch right now with no constraints or dependencies and using what we've learned from what we've built so far, how should we go about it? What tech out there already exists and what doesn't?" Evidence: `research/studio-native-overlap-and-greenfield-2026-10-09/research.md` (dimensions C3 to C6) and the run-1 report. The greenfield red team's digest (`digests/C5-redteam-1.md`) was still running when this was written; the handoff says whether it changed anything.

## 1. The short answer

- **The shape stays.** An outside assistant, given only the goal and the constraints, proposed a stack that is the current studio's shape: Claude Code headless in Docker Sandboxes microVMs under a durable service that meters, notifies and serves an event-stream front end. The inside record (C6) reaches the same shape from the other direction. **No rewrite.**
- **The commodity layers get thinner.** Everything the ecosystem now covers is on the studio's "would rather not own" list: session hosting and crash restart (agent view daemon), the consult leg (advisor), phone steering and approvals (Remote Control, channels), raw metering (OTel, `/usage`), review fan-out (`/code-review`, `ultrareview`), research fan-out (`/deep-research`), sign-in (Remote Control instead of OAuth pages), the plugin release plane (the installer), transcript parsing (ccusage).
- **The spend moves to the three things nothing provides:** the quote-before-run engagement loop; per-story metering under a subscription (list-price-equivalent plus window share); the story-aware office with partial-delivery reporting. A fourth, the deviation-scoring gate, stays ours.
- **Two constraints the outside world keeps ignoring:** Windows (Paperclip, bmad-loop's README, the built-in sandbox, `sandbox-runtime` and most routers skip native Windows) and the Max subscription (Managed Agents, the Agent SDK quickstart, every Jev router and most research tools assume an API key). Every adoption below carries a "prove it on the box" step.

## 2. The layers: adopt, wrap, keep, build

| Layer | Today | From scratch | Verdict | Why |
|---|---|---|---|---|
| Agent runtime | `claude -p` under the Max login inside sbx | the same, with `--permission-prompts none`, stream-json, `--json-schema`, a `setup-token` token in the sandbox | keep | the documented cross-language route; nothing else runs on the subscription |
| Isolation | Docker Sandboxes microVM, bypass only inside | the same | keep | Anthropic's unattended guidance; native Windows has no built-in sandbox; Docker's headless contract and credential passthrough are undocumented, so keep the provisioning glue until they are |
| Story engine | bmad-loop (pinned) plus the studio pipeline (routing legs, consult, gate, meter hook) | bmad-loop plus the studio delta; workflows for bounded fan-outs; `/goal` as an option for "keep going until" | keep, converge | bmad-loop is the loop and is landing native Windows; workflows take no mid-run input and fail at usage limits headless |
| Supervisor | Bun service: SQLite queue, lock per checkout, pacer, recovery, tiers, status page, notifications | the same, owning engine lifetime and a worktree per run; `claude agents --json` as an observation source | keep, thin | no GA native supervisor on a subscription; the daemon is a research preview that stops at shutdown and has no queue API |
| Routing and escalation | routing table per leg, consult subagent on objective triggers, gate with deviation score | table plus effort levels, `opusplan`, the advisor as the consult leg, fallback chains; Jev only as a shadow oracle later | keep, adopt advisor | no native auto-routing exists; routers intermediate the token and break the meter |
| Review | two adversarial reviewer subagents, gate, reconcile | the same plus `/code-review --max-findings` per story and `ultrareview --json` at milestones, metered; `claude-code-action` with a setup-token on PRs | adopt alongside | subscription-billed, scriptable |
| Meter | transcript parsing per story | OTel per process tagged with story and epic plus stream-json usage; ccusage parsing as the cross-check; story keying and bands stay | wrap | only near-real-time stream; cost is notional on Max, so quote in tokens and window share with a list-price shadow |
| Ledger and evolve loop | JSONL ledger, `tk evolve`, proposals to PRs | the same, fed from hook events | keep | no equivalent anywhere; it is the mechanism with the best evidence of worth |
| Drift and pins | drift check, `bmad.lock`, catalog lockstep, base patches | the same, plus `claude doctor` and `daemon status` version skew; plugin plane rebased on the installer's roster (ADR O5) | keep | no tool pins a third-party skill base |
| Planning | BMad artifacts, adapter to backlog-md and Jira, registry | the same; Backlog.md as the local target; no Jira until a consumer exists | keep | no adapter exists; the Jira and migrate adapters were built ahead of any consumer (C6) |
| Notifications and phone | Telegram via Hermes bot, ntfy, HTTPS status page with token and OAuth sign-in | ntfy plus Remote Control and channels for steering and approvals; the sign-in page stays only for the status view | thin | Remote Control covers phone control on Max; the OAuth walk-through can be dropped |
| Front end | planned Next.js static export served by the supervisor over SSE | the same; the office as a projection of the job table and journal; Pixel Agents' vocabulary extended with story, epic and engagement states (run 1) | build | no gamified or story-aware primitive exists |
| Engagement loop | vision only | a state machine with the Jules enum, a dedicated approval verb, questions as a state, a 50/85/95 quote band from the meter's history, partial-delivery closeout (run 1 B5) | build | nothing exists, official or not |
| Packaging | marketplace plugin, pinned zip, separate supervisor repo | one repository (ADR O2), installer-written skills-dir plugin (ADR O5), the service and front end from release zips with a roster | adopt the ADR | the two runs' verdicts |

## 3. What we learned that the design must honour

From the internal record (C6), in priority order:

1. **Verify where production runs.** The gate is Linux-only while Windows is the host; three Windows-only defects reached branches. The from-scratch gate runs on Windows (a host-tier verify leg) before a PR exists.
2. **Own engine lifetime and the project model in the service.** Engines died with a host `sbx exec` and a daemon's start context; one lock per checkout and project root equal to checkout root block two loops on one tree. Worktree per run; nested project roots proven in rehearsal (ADR §5).
3. **Keep the status-block discipline.** Every self-inflicted outage was diagnosed from a `blocked` block; surfaces that asked questions or ended `complete` on a refusal were the recurring defect class. Every new surface, including the engagement loop, ends headless runs with the block.
4. **Respect the Windows envelope.** MSIX virtualisation, Task Scheduler hangs, silent REPL exits, transcript GC, folder trust per repo root, CRLF through mounts, MAX_PATH, `.cmd` spawning, junctions: the runbook's section 8 is a design input, not an appendix.
5. **Billing is the subscription; bypass lives in the microVM; the deny list is never routed around.** Any primitive that needs an API key or a token relay is out.
6. **Measure before routing.** The meter and the review-share lever changed shipped routing twice; the Opus 5.5 trial's escapes located the gate's gap, not a model gap.

## 4. What does not exist (build list) and what we stop owning (thin list)

**Build (nothing exists):** the engagement loop (intake, clarifying questions as a state, scope of work, quote band, approval verb, milestones, acceptance, partial-delivery report); story-keyed metering and budget bands on a subscription; the story-aware office; the deviation-scoring gate; a conformance suite for headless behaviour (`plugin eval` asserts nothing about `-p`).

**Stop owning (an equivalent exists or the need goes away):** Google and GitHub OAuth sign-in (Remote Control); the plugin release plane (the installer and roster); transcript parsing (OTel plus ccusage); sandbox keepalive and daemon glue as far as the service can own it; miniyaml's edge cases (a vendored parser is a separate decision); patches over upstream bmad-loop behaviour as its releases close the holes.

## 5. How to go about it

Not a rewrite: four moves, each a PR-sized epic with its own measurement, in this order.

1. **Packaging and repository** (ADR O2 plus O5): one repository, the installer, the skills-dir plugin, the roster. Rehearsed migration (ADR §5). Removes the plugin release plane and the marketplace clone.
2. **Service owns lifetime** (hole 16 and the C6 structural list): worktree per run, nested project roots, engine lifetime in the service, verify leg on Windows, `claude agents --json` as an observation source.
3. **Thin the commodity layers**: advisor as the consult leg (Epic 24.3's third arm), OTel-fed meter with ccusage cross-check, `/code-review` and `ultrareview` beside the reviewers, Remote Control and channels for phone steering, ntfy kept.
4. **Build the differentiators**: the front end (office plus board plus chat, run-1 brief) and the engagement loop as one data model projected into both.

## 6. Open items that could change this

- **The subscription premise is the fragile part (greenfield red team, material).** Anthropic's legal page says developers "including those using the Agent SDK, should use API key authentication" while permitting own-seat sign-in to the unmodified binary; the policy moved four times in 2026, and `--bare` (which never reads OAuth credentials) "will become the default for `-p` in a future release". Design an API-key fallback leg now, build it only if the clause moves again, and record the current reading in the ADR.
- **Headless runs fail at usage limits and every parallel story shares one window.** The service owns limit detection, rescheduling to the window reset, and the pacer that keeps parallel stories inside the window (a native daemon does neither).
- **Docker Sandboxes on Windows is 0.x with 56 open Windows issues** (sandboxd after Fast Startup, empty mounts, I/O). The sandbox tier stays; its glue stays ours; stability goes on the refresh work order.
- Paperclip stores Claude tokens server-side (named as prohibited) and its Windows fixes are unmerged: borrow ideas only.
- The plugin verdict's red team added three rules (ADR O5): uninstall marketplace copies and drop the committed marketplace entries; sandboxes read the host skills folder through Docker's readonly agent-skills mount; accept the "development path" positioning with a deprecation watch.
- Whether a skills-dir plugin receives `${CLAUDE_PLUGIN_ROOT}` (Tim's probe) and whether `plugin eval` runs on it.
- Whether OTel `cost_usd` is populated on Max and whether resource attributes reach subagents.
- Anthropic's usage policy on unattended, multi-sandbox use of one Max subscription; the reading goes in the ADR.
- Docker Sandboxes' documented agent support and credential passthrough.
- bmad-loop's native-Windows release and Paperclip's Windows status.
