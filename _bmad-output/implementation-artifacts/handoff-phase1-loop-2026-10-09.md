# Handoff: the supervisor runs; the front end and the repo question are in research (boundary 2026-10-09)

Written for a fresh Claude Code session on the agent PC (TIM-PC-2). It supersedes `handoff-phase1-loop-2026-10-07.md` for the state of Phase 1. Engine mechanics: the 09-28 handoff and runbook §3.8. The starter prompt is at the end.

## Update at the end of session 2b (2026-10-09, later still): the plugin question, Jev, overlap and greenfield

Tim asked, after reading the ADR: is being a Claude Code plugin still worth it; research "jev" auto-model routing; what else we built is already out there; how we would build from scratch. A second deep-recon run answered all four and is closed: `_bmad-output/planning-artifacts/research/studio-native-overlap-and-greenfield-2026-10-09/` (`research.md`, six digests C1 to C6, two red-team digests, `.memlog.md`; ledger 18 verified, 39 unverified; citations clean; staleness earliest 2026-11-01). Everything is on branch `research/synthesis-adr` (PR #102) with the run-1 close-out.

- **Plugin or not (ADR O5, scored, awaiting Tim):** keep the plugin form, drop the marketplace. The installer writes a skills-dir plugin at `~/.claude/skills/tk-studio/` (loads as `tk-studio@skills-dir`, namespaced, agents bundled, in place, no clone). Anthropic's docs say skills, agents, hooks and MCP work without a plugin; the plugin-only surface is nothing the studio uses; the marketplace is what costs (whole-repo clone, cache per version, no auto-update, the Windows issue stream). Red team added three rules: uninstall every marketplace copy of `tk-studio` (this box has it at user and project scope and it would silently shadow the skills-dir copy); sandboxes read the host folder through Docker's experimental `agent-skills` mount set readonly; the form is documented as the "develop without a marketplace" path, accepted with a deprecation watch. **Open:** whether `${CLAUDE_PLUGIN_ROOT}` substitutes in a skills-dir plugin. Tim's probe, in PowerShell:

  ```powershell
  $P = "$HOME\.claude\skills\zzprobe"; New-Item -ItemType Directory -Force "$P\.claude-plugin","$P\skills\probe" | Out-Null
  Set-Content -NoNewline -Encoding ascii "$P\.claude-plugin\plugin.json" '{"name":"zzprobe","version":"0.0.1"}'
  Set-Content -Encoding ascii "$P\skills\probe\SKILL.md" @("---","name: probe","description: probe","---",'Reply with exactly: ROOT=${CLAUDE_PLUGIN_ROOT} SKILLDIR=${CLAUDE_SKILL_DIR}')
  claude -p "/zzprobe:probe" --model haiku --max-turns 1
  Remove-Item -Recurse -Force $P
  ```

  **Result (Tim, 2026-10-09, from `C:\GitHub\the-universe-awaits`):** `ROOT=C:/Users/tim/.claude/skills/zzprobe SKILLDIR=C:/Users/tim/.claude/skills/zzprobe/skills/probe`. Both variables substitute, forward slashes, so O5 stands as written and the ten skills need no change. The probe folder was removed.
- **Jev:** TypeSafe AI's typed decision model; the Claude Code routers are OAuth-forwarding proxies, the legal page forbids intermediating session tokens, no per-model Max quota weighting exists, measured capture was 3 percent. Not for routing; a possible shadow-mode oracle for sizing and finding severity later. R2.
- **Overlap map:** official Claude Code covers session hosting (agent view daemon, research preview), the consult leg (advisor), phone steering (Remote Control, channels), raw metering (OTel, `/usage`), review (`/code-review`, `ultrareview`) and research fan-out; nothing official or unofficial covers the queue contract, pacer and bands, the story-aware gate, the ledger and evolve loop, the drift check against a pinned base, the adapter, the conformance suite, the office or the engagement loop. Third-party: converge on bmad-loop (landing native Windows), ccusage for parsing, Backlog.md, claude-code-action as a cheap PR reviewer; Paperclip is borrow-ideas only (no Windows, server-side token storage).
- **Greenfield (`briefs/greenfield-studio-2026-10-09.md`):** no rewrite; the from-scratch stack is the current shape with thinner commodity layers (sign-in to Remote Control, transcript parsing to OTel, the plugin release plane to the installer) and the spend moved to the engagement loop, story-keyed metering and the office. Four moves in order: packaging and repo (O2 plus O5), service owns engine lifetime and worktrees (hole 16), thin the commodity layers (advisor arm, OTel meter, review surfaces), build the differentiators.
- **Standing risk (greenfield red team, material):** the Max-subscription premise. The legal page says developers "including those using the Agent SDK, should use API key authentication"; the policy moved four times in 2026; `--bare` (never reads OAuth) "will become the default for `-p`". Nothing forbids own-seat scripted `claude -p` today. Design an API-key fallback leg; record the reading in the ADR; watch the clause. Also: headless runs fail rather than wait at usage limits (the pacer's job), and Docker Sandboxes on Windows is 0.x with 56 open Windows issues (holes 7 and 13 are its lived form).
- **Denied in-session:** a local skills-dir probe (writes under `~/.claude`, runs `claude -p`) was declined by the permission mode and not retried; a scratch `--plugin-dir` probe from the red team remains in the session scratchpad (harmless).

**Next session, in order:** A sanity; Tim's probe result and his rulings on ADR §8 plus O5 (eight rulings now); merge PR #102; record the rulings in the ADR header and the spine (AD-21, and the AD-1 amendment); then the front-end brief; then packaging and repo (O2 plus O5, rehearsal first) or the first front-end epic as Tim decides; then Epic 24.3/24.4 with the advisor arm, Epic 23, holes 9, 10, 11, 16.

## Update at the end of session 2 (2026-10-09, later the same day)

- **The research run is closed.** `research.md` is complete (decision-first summary, benefits and drawbacks per approach, red-team contrary evidence, twelve recommendations, 266-row appendix, computed staleness map with the earliest re-check on 2026-11-01; ledger per `recon_kit.py tally`: 36 verified, 50 unverified, 5 disputed, 1 overturned). Verify digests for A1 and B1 to B5, `A-redteam-1.md` and `citation-check.md` are on disk. All of it is in **PR #102** (`research/synthesis-adr`).
- **The ADR awaits Tim's ruling:** `briefs/adr-repository-structure-2026-10-09.md` (proposed AD-21). It recommends one repository with per-app releases and one installer, scores four options against the six gates and six weights, and lists seven rulings in its §8. Nothing is in force until signed. Design rules the red team forced: the plugin reaches users as the pinned zip, never by cloning the monorepo (Claude Code clones the whole marketplace repository on every install and refresh; a plugin shipped from a product repository fails at MAX_PATH on this Windows build today); `make_latest: false` on every release; `git filter-repo`, not `subtree add`; a fan-in gate that asserts `success`; bypass lists do not exist on a user-owned repository.
- **Facts read live:** tk-studio is public; the supervisor and TUA are private; all three repositories have PR-required (0 approvals), admins exempt, no required checks, no rulesets and no CI workflows; the supervisor is itself an onboarded studio project (Epics 21 to 23, `.bmad-loop`, hooks), so the migration keeps it a nested project root, to be proven in rehearsal; `core.longpaths` is unset on the box.
- **Holes recorded in the ledger:** 15 (onboarding and drift should check the trust dialog per registered root) and 16 (two loops on one checkout need worktrees; nested project roots).
- **Next, in order:** Tim rules; merge #102 (record the ruling in the ADR header and add AD-21 to the spine); the front-end brief; then the restructure (rehearsal first, ADR §5) or the first front-end epic as he decides; then Epic 24.3/24.4 with the advisor arm, Epic 23, holes 9, 10, 11.

## Where things stand

**The supervisor is live.** Tim started it from the console on 2026-10-07; it restarted itself after the Windows-update reboot of 2026-10-08 04:31 (Startup shortcut, auto-logon); `start.ps1` brings the sbx daemon up, so the "Docker Sandboxes daemon" task is retired. API and status page on `https://tim-pc-2.tail8e370a.ts.net:8787` (TLS from the Tailscale certificate, 7-day session cookie, token sign-in confirmed from the main PC, dark theme live). Telegram notifications go through the Hermes bot. Tim's main PC is on the tailnet (its Tailscale MSI needed `ROOTDRIVE="C:\"` because Windows Installer had picked a per-user G: drive).

**Everything from the 09-29 and 10-07 handoffs is merged.** Zero open PRs on tk-studio, tk-studio-supervisor and the-universe-awaits at the time of writing. TUA `main` is protected like the other two.

| Closed on 2026-10-09 | How |
|---|---|
| DW-10 kill-and-restart | live: real `claude -p` worker, whole supervisor tree killed with `taskkill /T /F`, restart rule resumed the session, carried cost, notified, copied the transcript, no orphan (supervisor #7, #8) |
| DW-20 phone sign-in | Story 22.5 landed (`f8a26c2`, #5); Tim signed in over https from another device (#9) |
| DW-22 host tier denied `uv run` | root cause was **folder trust**, not the mode: a repo's `.claude/settings.json` permission rules apply only after the trust dialog was accepted in that folder on the box; Tim trusted the supervisor and TUA repos; `permissions.allow: ["Bash(uv run:*)"]` is tracked in both repos (#7, tk-studio #94); first host-tier `studio-health` run complete (runbook §4.1/§4.6/§8, tk-studio #95) |

Still deferred: DW-21 (certificate renews only at start), DW-23 (self-finishing skill run leaves "finish failed: terminal states are immutable" as the reason text), the transcript-restore check and the robocopy snapshot (both ride with Epic 23), the Google/GitHub OAuth walk-through (Tim asked for detailed instructions later).

## Decisions Tim made on 2026-10-09 (do not reopen)

1. **The gamified studio front end is the surface he will use most, and it wraps the Hermes agent.** The September research is recovered in `research/studio-office-ui-2026-09-01/` (tk-studio #96).
2. **No third repository.** "If the first step was to clone three repos I don't think I would go any further." He is reconsidering one repository, tk-studio, with separate releases per app, and wants the question **put to bed in writing with evidence** before any front-end work. A full rewrite is acceptable if it offers clear benefits. A **single installer/setup/updater** that abstracts cloning and compatible releases is a hard gate.
3. **Next.js first** for the front end (his website runs on it) unless it costs materially more.
4. **Research depth: deep; thoroughness over speed; results as clear benefits and drawbacks per approach.**
5. **Product vision:** hire the studio like a contract development studio from a product owner's seat: request, clarifying questions, nail down details, proposed scope of work and rough timeline, clear can/cannot and what they need from him, price negotiation, contract, then napkin idea to prototype or vertical slice to full development to finished product.
6. Earlier the same day: operator-decisions §1–5 accepted as built; both notifiers configured with Telegram default; single checkout for dev and service (stop the supervisor tab during a self-build).

## The research run in flight

Folder: `_bmad-output/planning-artifacts/research/studio-front-end-and-repo-structure-2026-10-09/` (bmad-deep-recon, native run). Read `brief.md` (plan, frame, dimensions, knobs), `.memlog.md` (every decision, source batch and claim with status), then the digests JIT.

Dimensions: **A1** comparable repo structures, **A2** per-app releases + migration + marketplace layout, **A3** one installer/updater; **B1** agent-office precedents, **B2** renderer in a Next.js front end (select), **B3** events/SSE projection + Hermes chat + hosting, **B4** assets and licences, **B5** the engagement loop.

State at the boundary:

| Dimension | Round 1 | Verified | Round 2 |
|---|---|---|---|
| A1 | `A1-r1-1.md` | not yet | lean round launched (`A1-r2-1.md` expected) |
| A2 | `A2-r1-1.md` | verifier launched (`A2-r1-verify.md` expected) | `A2-r2-1.md` landed |
| A3 | `A3-r1-1.md` | `A3-r1-verify.md` (3 verified, 2 unverified) | launched (`A3-r2-1.md` expected) |
| B1 | `B1-r1-1.md` | not yet | lean round launched (`B1-r2-1.md`) |
| B2 | `B2-r1-1.md` | not yet | folded into `B4B2-r2-1.md` |
| B3 | `B3-r1-1.md` | not yet | lean round launched (`B3-r2-1.md`) |
| B4 | `B4-r1-1.md` | not yet | `B4B2-r2-1.md` launched |
| B5 | `B5-r1-1.md` | not yet | lean round launched (`B5-r2-1.md`) |

Headline findings so far (each sourced in the digests):

- **Repo structure.** Omnara is the nearest precedent: one repo, three deployables with tag prefixes and one release workflow each, newcomer runs `git clone` + `docker compose up`. OpenCode, Happy, PostHog, n8n do per-app tags in one repo too. The Claude Code marketplace supports a plugin in a subfolder (`git-subdir`, sparse checkout, `metadata.pluginRoot`) and the pinned zip (`archive` + sha256, up to 256 MiB), and its own docs name `<plugin>--v<version>` tags as the dependency convention, so the existing `tk-studio--v` prefix is idiomatic. GitHub path filters do not apply to tag pushes and rulesets cannot scope required checks per path on a personal repo; the fan-in gate job pattern plus a ruleset bypass actor reproduces today's protections. release-please's parser takes a one-character separator, so `--v` tags would need testing or a scripted release step; changesets fixes `pkg@version`. `git subtree add` keeps full history; GitHub transfer redirects URLs, archiving does not. The only split rationale retrieved (MoJ Sirius ADR) was rebuild coupling, which a task graph removes.
- **Installer.** The 2025–26 pattern for this class of tool is a bootstrap script plus a self-updating CLI (Claude Code, uv, Hermes all do `irm | iex` on Windows); a committed roster with checksums (mise.lock, rustup channel manifests) is the cleanest expression of a compatible version set; plugin auto-update is off by default for third-party marketplaces and there is no update-all; MSIX forbids per-user services; winget zip-portable packages work but have no roster concept.
- **Front end.** Pixel Agents (9.6k stars, MIT, AsyncAPI contract, hooks-first) is the reference; claude-office is the only Next.js + PixiJS precedent with a vendor-neutral REST ingest and a fixture simulator; AgentSystemLabs/agent-office (3D, 687 stars in two weeks) and munder-difflin (8.6k, file-based event log) are the new neighbours; **no precedent renders story or epic progress**. AI Town's rule set (one authoritative mutator, diffs per step, interpolation buffers, ordered inputs) is the architecture lesson. Renderer matrix: CSS steps()/DOM 4.60, plain PixiJS 4.15, Phaser 3.65, Rive 3.30, Godot web 3.05; @pixi/react is effectively unmaintained; Godot 4.7 cannot export C# to web; a hybrid (DOM for HUD and bubbles, one Pixi canvas for the floor) is the likely answer. Hosting: a Next static export served by the Bun service on the same origin keeps the cookie first-party; SSE dies permanently on a 401. Hermes exposes an OpenAI-compatible API server with capabilities and SSE; its dashboard chat is a PTY over WebSocket with conflicting Windows notes. Assets: LPC is share-alike with mandatory credits, LimeZu must stay out of git, PixelLab output is the user's to distribute; no CC0 office pack with animated workers exists.
- **Engagement loop.** No agent product quotes a price before running; all gate on a plan. Reusable pieces: Cursor's editable plan with clarifying questions, Jules's assumptions list (avoid its auto-approve timer), Factory's autonomy level chosen at approval, Replit's checkpoints, agency SOW structure (scope and exclusions, client role matrix with dated dependencies, three-layer acceptance, written change control), ProKanban's 50/85/95 Monte Carlo band from item counts, which the studio can compute from its own metered history.

To finish the run (next session): wait for or read the pending digests; verify the B dimensions' load-bearing claims (one independent source each, fresh-context verifier agents, write `*-verify.md`); run the red-team skeptic on the repository verdict; write `research.md` per `references/synthesis.md` (executive summary decision-first, dimension sections with benefits and drawbacks, cross-dimension insights, contrary evidence, recommendations bound to the ADR and the brief, open questions, source appendix, staleness map via `recon_kit.py staleness`); `recon_kit.py citations`; update the memlog; then **the ADR `briefs/adr-repository-structure-2026-10-09.md` for Tim's signature** (options with benefits and drawbacks, the frame's gates and weights scored, the recommendation, the migration plan, the per-app release scheme, the installer design), then the **front-end brief**. Lean return contract for any further assistant: write the digest to disk, return only a summary.

## The advisor tool

Tim pointed at https://code.claude.com/docs/en/advisor. Fit note: `_bmad-output/planning-artifacts/briefs/advisor-tool-fit-2026-10-09.md`. Short form: it is the harness-native version of the loop's consult leg (stronger model consulted at decision points), not a replacement for human escalation or the gate; the proposal is an `advisor` field on the routing legs, meter support for advisor tokens, and a third arm in Epic 24.3 (Sonnet 5.5 main + Opus 5.5 advisor). An observation is recorded for the evolve loop.

## Holes in the dev loops, updated

1 fixed (#92), 2 fixed (#89), 7 mitigated (`sbx run -d` pin, `start.ps1`), 13 the daemon trap (rule in §3.5), 14 new: folder trust gates project permission rules (rule in §4.1/§4.6; recorded in the ledger). Open: 3, 4, 6, 8, 9, 10, 11/12. Candidate 15: onboarding/drift should check `hasTrustDialogAccepted` for every registered project.

## Next work, in order

1. Finish the research run and write the ADR; Tim rules on the repository structure.
2. If one repo: the migration (filter-repo or subtree, prefixed tags, archive the old repo), per-app release workflows, the installer story.
3. The front-end brief and epic (office scene + mission board + Hermes chat + engagement loop), Next.js first.
4. Epic 24.3/24.4 with the advisor arm; Epic 23; holes 9, 10, 11.
5. OAuth walk-through for Tim when he asks.

## Gotchas found this session

- A project's `.claude/settings.json` permission rules are ignored until the folder is trusted on the box; trust is per repo root, no parent inheritance; headless runs cannot answer the dialog.
- From a Claude session, run no sbx command but `sbx daemon status` while the daemon may be down; start it through the task or `start.ps1`.
- `sbx run -d --name <sandbox>` pins a sandbox alive across disconnects; `sbx stop` releases.
- Python on the host needs `C:/` paths; long Bash commands with heredocs or apostrophes failed to parse several times: write scripts and PR bodies to the scratchpad, call `memlog.py` from a Python script, use `gh pr create --body-file`.
- Windows PowerShell strips quotes from `curl.exe -d` bodies; use `--data-binary @file`.
- Research assistants returning full digests cost 15–25k context tokens each; have them write to disk and return a summary.

## Starter prompt for the next session

```text
This is TIM-PC-2, the tk-studio agent PC. The supervisor runs on https://tim-pc-2.tail8e370a.ts.net:8787 (never start or stop it from a Claude session). The deep-recon research run on the front end and the repository structure is closed (PR #102); the ADR on repository structure awaits my ruling unless this prompt says I have ruled.

Read in this order before acting:
1. _bmad-output/implementation-artifacts/handoff-phase1-loop-2026-10-09.md
2. _bmad-output/planning-artifacts/research/studio-front-end-and-repo-structure-2026-10-09/brief.md and .memlog.md, then the digests you need
3. _bmad-output/planning-artifacts/briefs/advisor-tool-fit-2026-10-09.md
4. kb/agent-pc-setup-runbook.md §3.5, §3.8, §4

Rulings already made, do not reopen: everything in the handoffs and the 2026-10-09 decisions (no third repo; one installer as a hard gate; Next.js first; deep and thorough; benefits and drawbacks per approach; the contract-studio engagement vision). Engines live only in Docker Sandboxes; never bypass on the host; TUA is the game reference.

Hard rules: never --dangerously-skip-permissions on the host; keep the permissions.deny list; branch per run, PR-only, main protected on all three repos; every headless run ends with the status block (AD-11); nothing is done until conformance passes (AD-19); never start daemons or the supervisor from a Claude session; from a Claude session run no sbx command but `sbx daemon status` while the daemon may be down; stop the supervisor tab before the loop builds the supervisor itself; run Godot only via $env:GODOT on the host; don't change system or security settings yourself (hand me the exact command). Run needed tool setup yourself without asking. Read my Max quota with the usage tool. Record every loop hole in the observation ledger. Research assistants write digests to disk and return summaries only.

Do this, in order, and report briefly after each step:
A. Sanity: tk activate clean for the three projects; lib suite and conformance green; `sbx daemon status` running; curl /status on the supervisor with the token I give you. Report only what fails.
B. If PR #102 is open, walk me through it and merge it on my say-so; if I have ruled on the ADR, record the ruling in its header and add AD-21 to the architecture spine through a PR.
C. If I have not ruled, stop after A and ask me to rule on the ADR's §8.
D. After my ruling: the front-end brief, then the restructure (rehearsal first, ADR §5) or the first front-end epic as I decide.
E. Then Epic 24.3/24.4 with the advisor arm, Epic 23, loop holes 9, 10, 11.

Address me as Tim-Senpai. Lead every reply with pass/fail and blockers; keep it short.
```
