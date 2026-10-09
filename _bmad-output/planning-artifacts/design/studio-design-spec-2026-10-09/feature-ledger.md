# Appendix A. Feature ledger: everything planned, what is built, what is owed, and where it lands

Part of the [studio design spec](README.md). Audited 2026-10-09 against the plan files, the two deferred-work ledgers, the handoffs, the proposals ledger, the host observation ledger and the Hermes install on TIM-PC-2.

**How to read the Status column.** `built` is proven on the box. `built, story open` means the work exists but the canonical story was never closed (the plan files still say `draft`). `open` is planned and not started. `superseded` means a later ruling replaced it. The "Lands in" column names the spec component (see [README §6](README.md#6-the-components)) or the proposed epic (see [README §10](README.md#10-build-order)) that carries it forward.

## A.1 The 2026-09-26 plan: four phases

Source: [planning pass 2026-09-26](../../briefs/planning-pass-agent-pc-and-supervisor-2026-09-26.md) §3.

| Phase | Deliverable | Status | Lands in |
|---|---|---|---|
| 0. Agent PC provisioning | runbook §7 smoke green | **built** (TIM-PC-2 live since 2026-10-07; survived the 10-08 reboot) | kept; the installer's `doctor` verb takes over the smoke table |
| 1. Supervisor extraction | queue, pacer, guards, tiers, API, status page, logon start, contract 0.1.18 | **built** (Epics 20 to 22; 599 tests) | C2 Supervisor, kept and extended |
| 2. Hermes front door | 0.21.x install, Telegram, dashboard on the tailnet, learning gated, `tk-submit` and `tk-status` skills, one cron, `hermes mcp serve` | **about one third built**, see A.5 | C7 Front door, pending [decision D2](decisions.md#d2-hermes) |
| 3. Vertical-slice pack | `playable-verify` leg, engine MCP wiring, asset-manifest ladder, `run-vertical-slice` job, contract bump, eval cases | **open**, nothing started | EP-31 Vertical-slice pack (game projects) |
| 4. ClaudeOS retirement | disable the last task, push, tag, remove the worktree | one elevated-shell step left (runbook §9) | operator step; not in the design |

## A.2 Epics 20 to 24 (the Phase 1 plan, story by story)

Source: [epics.md](../../epics.md) Epics 20 to 24; [plan index](../../plan/index.md); handoffs of 09-29, 10-07 and 10-09.

| Story | Title | Status | Evidence | Lands in |
|---|---|---|---|---|
| 20.1 | Finish records what the run cost | built | contract 0.1.18, `total_cost_usd` in `job-run` | kept |
| 20.2 | Contract 0.1.18 names the supervisor and Hermes | built | [driver-contract.md §1 roster](../../../../plugins/tk-studio/contracts/driver-contract.md) | the roster gains the front end as a consumer (contract 0.1.19, EP-27) |
| 21.1 to 21.6 | The queue, tiers, guards, pacer, resume | built | supervisor PRs #1 to #3; DW-10 kill-and-restart passed live 2026-10-09 | C2, kept; open DW items in A.4 |
| 22.1 | API on the tailnet | built | `POST /jobs`, `GET /events` SSE, cancel | C2; the event stream is the office's feed |
| 22.2 | Read-only status page | built | server-rendered, dark theme | **superseded by C3 Studio web**; the page stays as the no-JavaScript fallback |
| 22.3 | Starts itself at logon, snapshot, notify | built | `start.ps1`, Telegram through the Hermes bot | C2, kept |
| 22.4 | Runbook §4 as built | built | tk-studio #85, #88, #91 | the installer's `doctor` and the runbook stay in step |
| 22.5 | Sign in from the phone | built | token form live; Google and GitHub built, not configured | **narrowed**: token sign-in and the cookie stay; the OAuth walk-through is dropped unless a browser-only path is still wanted (greenfield R3) |
| 23.1 | The engine has a home that never bypasses on the host | built in substance, story open | sandboxes provisioned, runbook §3.8, TUA engine green 2026-09-28 | close the story with the runbook as evidence |
| 23.2 | Every run gets its own branch and ends in a PR | **open** | the supervisor stores `base_ref` and cuts no branch (README "HTTP API") | **EP-26 Service owns lifetime**: branch per run becomes worktree per run (hole 16) plus the PR at the end |
| 23.3 | Acceptance from the phone, measured | **open** | needs 23.2 and the supervisor | runs as the acceptance of EP-26 |
| 24.1 | Every landed story carries its price and its time | built | `lib/meter.py`, one observation per story | C8 Measurement; feed from OTel later (greenfield R4) |
| 24.2 | The supervisor is built on the trial route | data collected, story open | [kb routing doc, trial section](../../../../kb/execution-pipeline-model-routing.md); the 09-29 handoff table (Epic 21 $152.75, Epic 22 $69.36) | close the story by writing the kb trial record |
| 24.3 | Paired runs on TUA | **open** | two throwaway branches to cut | kept as planned, plus the advisor arm (A.6) |
| 24.4 | The verdict sets the defaults | **open** | | kept as planned |

**Housekeeping found by this audit.** The canonical plan files (`plan/ST-061.md` to `ST-072.md`) still read `draft` for stories the loop landed in the supervisor repository. The loop writes its own sprint state; nothing pulls status back into tk-studio's plan. Recorded as loop hole 18 in the ledger (see A.7).

## A.3 The 2026-09-01 office decisions (recovered 2026-10-09)

Source: [office UI digest](../../research/studio-office-ui-2026-09-01/digest-studio-office-ui.md) §4 and §5.

| Decision | Status | Lands in |
|---|---|---|
| tk-studio owns resource selection and routing (which agents and skills form the team, model and effort per leg) | standing | C1 Plugin: `working_set.<role>`, `orchestrate.py resolve`, `[pipeline.legs]` |
| The front end owns the presentation overlay (persona bindings keyed to tk-studio resource names; cached resolve; surface drift) | standing, not built | **C3 Studio web** and the **agent registry** in [README §7.2](README.md#72-the-agent-registry) |
| Hermes profiles own live state (memory, sessions); policy overrides own execution config at spawn | **this is the "agents registered so Hermes can see them" requirement** | [decision D2](decisions.md#d2-hermes); the registry is designed so either Hermes profiles or the supervisor's own records can back it |
| Roadmap stage C: office view as a new route, SSE agent-state stream, GDT grammar, hiring modal over personas | not built | C3 Studio web, EP-27 and EP-28 |
| Depends on A (event source) and B (a chattable orchestrator per project) | A exists (`/events`, journals); B does not | EP-27 (A as a semantic projection); D2 decides B |

## A.4 Deferred work still open

**Supervisor repository** ([deferred-work.md](https://github.com/thkennedy/tk-studio-supervisor/blob/main/_bmad-output/implementation-artifacts/deferred-work.md)):

| DW | What | Severity | Lands in |
|---|---|---|---|
| DW-3 (narrowed) | a worker that outlives a killed supervisor; four residual cases | high | EP-26: process-group ownership per run |
| DW-6 | runs started outside the queue are invisible to the pacer | medium | EP-26: the queue is the only way to start a run |
| DW-10 (narrowed) | transcript restore from backup never run live | high | Epic 23 acceptance |
| DW-11 | pacer does not treat an ended run that keeps its lock as live | low | EP-26 |
| DW-12, DW-13 | cancel races with claim and with a late studio-run record | medium | EP-26 |
| DW-15 | cost lost across a resume | medium | EP-26 (the meter sums per iteration) |
| DW-19 | half-second PowerShell start-time read on win32 | medium | EP-26 (native `GetProcessTimes`) |
| DW-21 | TLS certificate renewed only at start | medium | C4 Installer `doctor` warns; service reload in EP-26 |
| DW-23 | "finish failed: terminal states are immutable" as reason text | low | EP-26 |
| DW-2, 4, 9, 14, 16, 18 | follow-up reviews recommended after the damping cap | low | one deliberate review pass before the restructure |

**tk-studio** ([deferred-work.md](../../../implementation-artifacts/deferred-work.md)): DW-5 (a repeat `finish` emits a second `job-run` event, low), DW-8 (a follow-up review on 24.1, low). DW-2 concerns the retired ClaudeOS suite and is moot.

## A.5 Phase 2, Hermes front door, item by item (checked on the box 2026-10-09)

| Planned item (runbook §3.7, plan §3 Phase 2) | On the box | Status |
|---|---|---|
| Fresh install at 0.21.x in `%LOCALAPPDATA%\hermes` | 0.21.5+3807 (2026-09-24), git install | built |
| Telegram gateway with allowlist | `platforms.telegram.enabled: true`, home channel set; gateway task running | built |
| Hub model on Nous Portal, never Claude OAuth | provider `nous`, model `anthropic/claude-opus-5.5` | built |
| Dashboard on the tailnet with basic auth | nothing listens on 9119 | **not running** |
| Learning gated (`skills.write_approval`, `memory.write_approval`, `cron_mode: deny`) | `memory.write_approval: true` and `skills.write_approval: true` are set; `approvals.cron_mode` is unset and defaults to `deny` | built |
| (not in the plan) `auth.adopt_external_logins` | **`true`** (also the default): Hermes may borrow and refresh Claude Code's OAuth credentials and can invalidate the Max login the supervisor's workers use | **hazard**: set `false`; see [Appendix B.4](hermes-fit.md#b4-what-it-costs) |
| (not in the plan) bundled `claude-code` skill | installed by default; teaches Hermes to drive `claude -p` | disable or allow-list out under any option that keeps Hermes |
| `tk-submit` skill (conversation to job JSON to `POST /jobs`) | no user-authored skill mentions the studio | **not written** |
| `tk-status` skill and one status cron | none | **not written** |
| `hermes mcp serve` for Claude Code call-back | not configured | **not done** |
| Bot used as the supervisor's notifier | yes (operator decision §6) | built |

So Hermes today is a running Telegram gateway with its learning gated, used as a notifier channel. Nothing in it knows the studio, and one default setting puts the Claude login at risk. Whether to finish Phase 2 or replace it is [decision D2](decisions.md#d2-hermes); [Appendix B](hermes-fit.md) carries the evidence.

## A.6 Proposals and fit notes not yet acted on

| Item | Source | Status | Lands in |
|---|---|---|---|
| Advisor as a third arm in Epic 24.3 (Sonnet 5.5 main, Opus 5.5 advisor), `advisor` field on routing legs, meter prices advisor tokens | [advisor fit note](../../briefs/advisor-tool-fit-2026-10-09.md) | proposed, observation recorded | Epic 24.3 and 24.4 as planned; routing story in EP-26 |
| Google and GitHub OAuth walk-through | 10-09 handoff "still deferred" | deferred | dropped in favour of Remote Control unless Tim wants it ([decision D7](decisions.md#d7-sign-in)) |
| `tk evolve` over the loop-deficiency observations | 16 entries in the host ledger, no PROP rows since PROP-023 | **never run on the agent PC's ledger** | run once before EP-26 so the holes become proposals |
| API-key fallback leg designed, not built | greenfield red team (standing risk) | open | [README §11](README.md#11-risks) and the ADR header |
| Anthropic usage-policy reading recorded in the ADR | run 2 R8 | open | the ADR header, at signature |

## A.7 Loop holes (the dev-loop deficiency list)

Numbers follow the handoffs. Each is an `observation` in the host ledger (`~/.tk-studio/measurements/tim-Tim-PC-2.jsonl`, "Loop deficiency").

| # | Hole | State | Lands in |
|---|---|---|---|
| 1, 2, 5 | spec file name stall; auto-mode nudge; CRLF through mounts | fixed | |
| 3 | footer tips re-arm the stall grace | open, upstream (bmad-loop) | watch bmad-loop releases |
| 4 | `max_tokens_per_story` too low | open; set by hand in a local `policy.toml` | EP-26: budget truth in one place (bands) |
| 6 | 150-character spec file names | open | EP-26 |
| 7, 13 | engine dies with the host `sbx exec`; auto-started daemon from a Claude session | mitigated (`sbx run -d`, `start.ps1`, runbook rules) | EP-26: the service owns engine lifetime |
| 8 | signal tests passed once at the gate | open | one deliberate review pass |
| 9 | no close-out for a landed-but-paused story | open, "next to plug" | EP-26 |
| 10 | three launches, three behaviours on bootstrap output | open | EP-26: launch owns its bootstrap output |
| 11, 12 | no Windows leg in the verify gate | open; host run attended before each PR | EP-26: a host-tier verify leg |
| 14 | folder trust gates project permission rules | rule in the runbook | C4 Installer: `doctor` checks `hasTrustDialogAccepted` per registered root |
| 15 | onboarding and drift should check trust per registered root | candidate | C4 Installer `doctor`; drift check |
| 16 | two loops on one checkout; nested project roots | candidate | EP-26: worktree per run; proven in the restructure rehearsal |
| 17 | **new, this session:** the research charter and the ADR template read no standing-plan inventory, so the ADR folded in none of the above | recorded 2026-10-09 | the deep-recon charter and the ADR template gain a mandatory inventory step; this ledger is its first instance |
| 18 | **new, this session:** the canonical plan is not updated when the loop lands a story in another repository | recorded 2026-10-09 | EP-26: the supervisor's `ended` event with a PR triggers a plan-sync status pull-back |

## A.8 Deferred in the architecture spine (still deferred, unchanged by this design)

Cross-project knowledge and the promotion gate (v2, AD-8); Linear and Confluence adapters; execution roles beyond developer; the persona overlay; distribution hardening and public distribution (the installer is a step toward it, not the whole); beads. Source: [ARCHITECTURE-SPINE.md "Deferred"](../../architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md).

## A.9 What the research recommended that this design adopts, and what it leaves

From [run 1 recommendations](../../research/studio-front-end-and-repo-structure-2026-10-09/research.md#12-recommendations) and [run 2 recommendations](../../research/studio-native-overlap-and-greenfield-2026-10-09/research.md#9-recommendations):

| Recommendation | In this design |
|---|---|
| R1 one repository (run 1) | pending ruling [D1](decisions.md#d1-repository); the design works under either answer, with the cost difference stated |
| R2 `git filter-repo` migration, R3 per-app tags, R4 fan-in gate, R6 layout | adopted as written in the ADR, conditional on D1 |
| R5 installer, R1 skills-dir plugin (run 2) | **adopted; O5 ruled by Tim 2026-10-09** |
| R7 Next.js static export served by Bun, hybrid DOM plus one PixiJS canvas | adopted; renderer confirmed by a phone spike ([D5](decisions.md#d5-renderer)) |
| R8 event contract (Pixel Agents vocabulary plus story, epic, engagement), R9 SSE transport | adopted (EP-27) |
| R10 Hermes loopback API server, key held by the supervisor, server-to-server | the shape of option A in [D2](decisions.md#d2-hermes); not yet decided |
| R11 assets (LimeZu out of git, LPC credits shipped) | adopted ([D6](decisions.md#d6-assets)) |
| R12 engagement loop as a state machine with the Jules enum and a dedicated approval verb | adopted (EP-29) |
| R2 (run 2) no Jev router | adopted |
| R3, R4, R5 (run 2) thin the commodity layers: Remote Control for steering, OTel for the meter, `/code-review` beside the reviewers | adopted as later moves, after the engagement loop exists |
| R8 (run 2) read the usage policy and record it | open, at ADR signature |
