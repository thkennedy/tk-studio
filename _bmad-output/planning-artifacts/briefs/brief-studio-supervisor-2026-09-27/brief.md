---
title: "Product Brief: the studio supervisor (plan Phase 1)"
status: draft
created: 2026-09-27
updated: 2026-09-27
inputs:
  - _bmad-output/planning-artifacts/briefs/planning-pass-agent-pc-and-supervisor-2026-09-26.md (§1 rulings, §3 Phase 1, §4 cross-cutting)
  - _bmad-output/planning-artifacts/research/agent-studio-next-level-2026-09-26/research.md (§4, §6, §7)
  - _bmad-output/implementation-artifacts/handoff-agent-pc-2026-09-27.md (PR #70)
  - kb/agent-pc-setup-runbook.md (§3.4–§4, §8)
mode: headless fast path; [ASSUMPTION] tags mark inferences for operator review
---

# Product Brief: the studio supervisor

## Executive Summary

The studio supervisor is the durable driver for tk-studio on the agent PC
(TIM-PC-2). It is a small Bun/TypeScript service in its own repo. It takes job
requests over HTTP on the tailnet, queues them durably, and runs each one as a
headless `claude -p "/tk-studio:<skill>"` session under the Max login. For each
run it enforces the job's guards, captures the terminal status block, and
records a measured `job-run` event in the box's ledger. It is a driver-contract consumer outside
the plugin (AD-2), so the studio itself grows no UI and no daemon.

It exists because the studio can describe work (jobs are data, AD-10) but
nothing on this box can *run* that work unattended. ClaudeOS held the driver
code (about 1.5k lines against contract 0.1.12) but never scheduled it, and
ClaudeOS is retired. Hermes is the front door but is ruled out as a runner.
Every later phase depends on this seam: Phase 2's Hermes skills POST to it, and
Phase 3's `run-vertical-slice` job runs through it.

## The Problem

- The agent PC is provisioned and verified (Phase 0), yet there is no way to
  start a studio job from the phone, iPad or main PC and trust that it runs to
  a verifiable end.
- Unattended runs on Windows fail in known ways: `claude -p` from Task Scheduler
  hangs, the REPL exits silently under dense Bash, transcripts get
  garbage-collected, and desktop-app sessions write into a private MSIX AppData
  copy (runbook §8). A driver that ignores these loses runs silently.
- The job wrapper already computes a `durability_constraint` that names an
  external durable harness. That harness does not exist yet.

## The Solution

A console-hosted process started at logon that owns four things and nothing
else:

1. **A durable queue** (SQLite `jobs`, `runs`, `events`) with idempotent
   `wake`, a one-engine-per-checkout lock, and a pacer for self-paced jobs.
2. **The worker seam**: the contract's §1 headless invoke with auth preflight,
   model and effort forwarded verbatim (§5), guards enforced by the wrapper,
   the host tier in `auto`/`acceptEdits` permission mode with the deny list,
   the sbx tier for bypass, cost captured from `--output-format json`, and
   resume from the `.jsonl` transcript after a crash.
3. **An HTTP API and a read-only status page**, both bound to the tailnet IP
   with bearer auth; the page reads only what the contract already exposes
   under `~/.tk-studio`.
4. **Run hygiene**: a branch per run, a PR at the end, a snapshot before any
   editor-in-the-loop run, transcript backup, and a notification on stop.

## Who This Serves

- **Tim, away from the box:** starts a job from the phone or iPad with one
  request, sees it on a status page, and gets a PR and a notification.
- **Hermes (Phase 2):** a client that turns conversation into job JSON and
  POSTs it; it needs a stable, schema-validated API and nothing else.
- **The studio's evolve loop:** needs measured `job-run` events with cost, so
  routing and budget decisions rest on data.

## Rulings it stands on (closed, 2026-09-26)

- **Engine:** Godot.
- **Payer:** Max plan (`claude -p` under the Max login; Hermes bills to Nous
  Portal).
- **Driver:** an independent supervisor served on this box over HTTP via
  Tailscale.
- **Hub split:** the supervisor is extracted from ClaudeOS; Hermes is front
  door only and never runs `claude -p`; ClaudeOS is retired (tag
  `retired-as-driver-2026-09-26`) and is cloned only to lift
  `connectors/tk-studio/{server,client,conformance}.ts` and
  `scripts/studio-jobs-tick.ts`.

## Phase 1 scope and acceptance (plan §3, verbatim)

> - **Source:** ClaudeOS `connectors/tk-studio/server.ts` (705 lines),
>   `client.ts` (96), `conformance.ts` (453), `scripts/studio-jobs-tick.ts`
>   (307) — 1,561 lines that already implement §1 headless invoke with auth
>   preflight and status-block extraction, §2 `finish`, §4
>   `submit/status/resolve/cancel/wake` and knowledge injection, §5 model/effort
>   passthrough, §6 drift check, §8 conformance through the driver. They target
>   contract 0.1.12 and were never scheduled.
> - **New repo** (name open, §6): Bun/TypeScript so the code lifts as-is; a
>   Python rewrite to sit beside `lib/` is a later option, not a blocker.
> - **Scope to add:**
>   1. **Durable queue** (SQLite): `jobs`, `runs`, `events`; survives restarts;
>      idempotent `wake`; one engine per checkout lock (bmad-loop already
>      requires it).
>   2. **Pacer** for self-paced jobs honouring `hint_seconds`, no overlap.
>   3. **Guards enforced by the wrapper**: `max_wall_clock_seconds` kills and
>      ends `partial`; `max_turns`/`max_tokens` via `account` each iteration.
>   4. **Worker invocation under the Max login**: host tier
>      `--permission-mode auto` (or `acceptEdits`) with the deny list; `sbx`
>      tier for bypass; `--output-format json` cost captured into `finish`;
>      resume from the `.jsonl` on crash.
>   5. **HTTP API** on the tailnet IP with bearer auth: `POST /jobs`,
>      `GET /jobs`, `GET /runs/{id}`, `POST /runs/{id}/cancel`, `GET /status`,
>      `GET /events?since=` (SSE or poll).
>   6. **Read-only status page** over `~/.tk-studio`: status blocks, run
>      workspaces, ledger tail, registry. Small, server-rendered; this is the
>      "UI" the charter permits because it lives in a consumer.
>   7. **Console-hosted start** at logon (Startup-folder shortcut), transcript
>      backup, `robocopy` snapshot of a Godot project before any
>      editor-in-the-loop run, ntfy or Telegram notification on `Stop`.
>   8. Contract bump **0.1.15 → 0.1.16**: doc patch to §7 row 6 (supervisor
>      and Hermes named as consumers), driver roster entry, and a §2 note that
>      the executing wrapper may be any conformant driver. Additive, patch-level.
> - **Acceptance:** (a) from the phone, `curl -X POST …/jobs` with the existing
>   `run-epic` job against `slice-zero` → run appears → `claude -p` executes →
>   status block captured → PR opened on GitHub; (b) `runner.py run` passes
>   through the new driver (§8); (c) kill the supervisor mid-run, restart, run
>   resumes or ends `partial` with the guard named, never silently lost;
>   (d) `job-run` event lands in the agent PC's ledger with `total_cost_usd`.

## Reconciled with the box as built (2026-09-27)

The plan predates provisioning. These deltas change *how*, not *what*:

| Plan text | As built / as found | Consequence for Phase 1 |
|---|---|---|
| Contract bump 0.1.15 → 0.1.16 | Contract is already **0.1.16** (install `no_normalize`, PR #64) | The supervisor's patch is **0.1.17**; Phase 3's "0.1.17+" becomes 0.1.18+ |
| Acceptance against `slice-zero` | Standing decision: **the-universe-awaits (TUA) on a throwaway branch**; no blank project | Acceptance (a) runs a TUA `run-epic` instance; the PR targets the throwaway branch, never `main` |
| `job-run` event "with `total_cost_usd`" | The taxonomy's `job-run` payload has **no cost field**, and `jobrun.py` records none | Additive optional `total_cost_usd` on `finish` and on `job-run`, inside the 0.1.17 bump |
| "PR opened on GitHub" | TUA has never had a branch or PR; its loop commits on the checkout | Branch per run and the PR come from the supervisor, not the engine |
| `run-epic` runs the engine | `run-epic` is one-shot: the job ends when bmad-loop detaches | The supervisor follows the launched engine run to its end before opening the PR |
| The engine (bmad-loop) | **Not provisioned on TIM-PC-2.** On the main PC it ran in WSL with its own login, and TUA's tracked `.bmad-loop/profiles/claude.toml` runs sessions with `bypassPermissions` and a main-PC `TK_STUDIO_ROOT` | Blocks acceptance (a) until the engine has a home that never bypasses on the host (open question 2) |
| `agent` standard user, `D:\agent-work` | Single account `tim` (runbook §1.6), `C:\agent-work`, repos in `C:\GitHub` | Paths come from the environment, never from tracked files (AD-15) |

## Non-negotiables

- Never `--dangerously-skip-permissions` on the host; bypass only inside Docker
  Sandboxes.
- The `permissions.deny` list in `~/.claude/settings.json` stays and is never
  routed around.
- Branch per run, PR-only, `main` protected on every repo the supervisor
  touches.
- The supervisor and Hermes stay outside the plugin (AD-2).
- Every headless run ends with the status block, and a missing block is a
  named failure (AD-11).
- Nothing is done until `runner.py run` passes (AD-19).
- The supervisor is never started from a Claude desktop-app session (MSIX).
- The supervisor runs Godot only through `$env:GODOT`.

## Success Criteria

Phase 1 is done when acceptance (a)–(d) pass as reconciled above, each run is
measured into `~/.tk-studio/measurements/tim-Tim-PC-2.jsonl` (the first
`job-run` event there also closes Phase 0), and conformance is green through
the new driver. Operational signals after that: zero runs lost across
restarts, and every terminal run carries a status block and a cost.

## Scope

**In:** the lift of the four ClaudeOS files to contract 0.1.16, then 0.1.17;
the eight scope items above; the tk-studio side of the contract bump
(§2, §7 row 6, the driver roster, the cost field); runbook §4 rewritten from
placeholder to as-built; the acceptance run and its measurement.

**Out:** Hermes skills and cron (Phase 2); `playable-verify`, the asset
ladder and `run-vertical-slice` (Phase 3); any UI beyond the read-only status
page; a Python rewrite; multi-box or multi-user operation; exposing anything
beyond the tailnet.

## Open Questions for the Operator

1. **Repo name** (plan §6.1). [ASSUMPTION] Proposed:
   `thkennedy/tk-studio-supervisor`, private.
2. **Engine placement for `run-epic` on this box.** [ASSUMPTION] Proposed:
   run bmad-loop inside the sbx tier, where its `bypassPermissions` is
   permitted and headless Godot needs no GPU. If bmad-loop runs natively on
   Windows, the fallback is the host tier, with the throwaway branch's loop
   profile swapped to `--permission-mode auto` plus the deny list. WSL on the
   host with bypass is not an option under the hard rules.
3. **Acceptance spend cap.** [ASSUMPTION] Proposed: stop the engine gracefully
   after the first story's commit (through `POST /runs/{id}/cancel`), so
   acceptance costs one story (measured at about $8.6) rather than a whole epic.

## Vision

The supervisor becomes the one seam every front door uses: Hermes on
Telegram today, Remote Control, Channels or a plain `curl` tomorrow. By
Phase 3, one message from the phone becomes a `run-vertical-slice` job that the
supervisor paces, guards, measures and lands as a PR with proof media, while
the studio plugin stays a pure contract publisher.
