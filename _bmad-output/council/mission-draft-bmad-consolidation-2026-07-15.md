# Mission Draft: Single BMAD Install + Council Memory Re-home + Plugin Version-Awareness

**Scoped by:** Yui (task planner) · **Routed by:** Alya · **Date:** 2026-07-15
**Status:** DRAFT — awaiting Tim's review of open questions before mission creation
**Source brief:** `_bmad-output/council/brief-bmad-consolidation-2026-07-15.md`
**target_repo:** `tk-council` (plugin + canonical live there); several goals also touch the 4 project repos.

## Intent

Collapse the studio's BMAD + council footprint to a single source of truth: BMAD core bundled into the tk-council plugin, delivered once per machine, with council memory re-homed onto a three-tier model that is team-safe (multi-user) from day one. Eliminate ~548 duplicated skill copies, three coexisting council generations, and the Cursor-era `.agents` mirror — without losing a byte of real council history. Add the plugin-maintenance loop that keeps every dev current: agent-driven updates plus an orchestrator version-check on birth/rebirth.

## Locked decisions (fixed constraints — not reopened by this mission)

1. BMAD core is **bundled into the tk-council plugin** (shared release cycle with the council).
2. **Three-tier memory model**, governed by *promotion is the membrane*: T1 Identity (sanctums, per-user cross-project), T2 Working state (per-user-per-project-per-session), T3a Promoted project-specific (project VCS), T3b Promoted domain-general (`canonical/<domain>`).
3. **Sanctums are per-user, not per-team.** Team learning happens only through promotion (T3).
4. **Multi-user fix:** T1 + T2 move to a per-user store OFF the shared repo; the shared tk-council repo holds only T3b.

## Governing ordering rule (inviolable)

**No deletion of any memory before it is (a) migrated to its new tier home AND (b) cleared by a Reina promotion pass.** History loss is the top mission risk. Every deletion mini-goal carries an explicit "cleared-to-delete" dependency on the migration ledger (G4).

---

## Goals

### G0 — Make council specialists spawnable as subagents (PREREQUISITE)
*Owner: plugin maintainer (dev); verify mechanics with the claude-code-guide agent.*
Depends on: nothing. **Blocks the council's Route/Convene model** — should land BEFORE the rest of this mission, or ship as its own standalone mission first.

Rationale (verified 2026-07-15): the plugin ships 17 skills and ZERO agents, so `Agent(subagent_type: "tk-council:tk-agent-*")` fails ("Agent type not found"). The orchestrator cannot spawn specialists, so Route/Synthesize/Convene collapse to an in-conversation Skill handoff (no multi-specialist Convene). Confirmed docs: plugins CAN ship subagents via an auto-discovered `agents/` dir, namespaced `tk-council:<name>`.

1. Add an `agents/` dir to the plugin source (`C:/Users/kenne/Perforce/tk-council/plugins/tk-council/agents/`) with one **thin wrapper agent per persona specialist** (the 11 `tk-agent-*` skills). Frontmatter `name` = skill basename; description/model sourced from the skill's `customize.toml [agent]`.
2. Each wrapper **delegates to its skill** — skills stay the single source of truth for persona/sanctum. Prefer the agent frontmatter `skills:` preload field, or a Skill-tool invocation — whichever correctly preserves the skill's **root-relative path resolution + rebirth ritual**. VERIFY: skills use bare paths resolving from skill root, so a naive `Read` of SKILL.md into an agent body would break internal `references/...` refs.
3. Do NOT fork persona text into agent files. Do NOT modify the 17 skills — this ADDS agents.
4. Bump version in BOTH `plugins/tk-council/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (lockstep, confirmed pattern); reinstall so the read-only cache re-syncs.

**AC**
- The Agent tool resolves `tk-council:tk-agent-task-planner` and every persona specialist.
- A spawned specialist runs its OWN rebirth from the per-user store and returns real output to a still-live orchestrator.
- RT and CN work: a Convene dispatches >=2 specialists (in parallel) and Alya synthesizes their returns.
- `/tk-council:<skill>` slash + Skill-tool invocation still work — no regression on the 17 skills.
- Branch + PR on the git source (origin: the pre-rename upstream (`claude-plugins`)); ASCII-only; code-review before merge.
- (Non-blocking) file the "phantom agent-type advertising" behavior via `/feedback`.

Note: G0 is intentionally independent of the memory/BMAD work. It can be pulled out as its own mission that ships first — recommended, since it unblocks ALL council multi-specialist work, not just this mission.

### G1 — Lock the target-state design + resolve open parameters
*Owner: Yui (facilitation) + Tim (decisions); Sora documents the target-state doc.*
Depends on: nothing (entry point).

1. Resolve the three open parameters (see Open Questions): per-user store path; T3a in-repo convention; version-discovery mechanism.
2. Produce a target-state architecture doc: the three-tier map, concrete directory layouts (plugin, per-user store, project repo, canonical), and the full config-key delta.

**AC**
- Target-state doc exists and is Tim-approved.
- All three open parameters have decided, written values.
- Config schema delta enumerated: new/changed keys, `tk_shared_root` semantics, per-user-store key, T3a-location key. Migration of existing `config.local.yaml` files specified.
- No code changes in this goal — design only.

### G2 — Bundle BMAD core into the tk-council plugin
*Owner: plugin maintainer (dev).*
Depends on: G1. **Precedes** all per-project BMAD deletions (G5).

1. Move the 73 `bmad-*` skills + the framework modules (bmm, gds, cis, core, tea, bmb, wds, automator, custom, scripts) into the plugin package.
2. Bump the plugin version.
3. Verify plugin-hosted BMAD resolves `{project-root}/_bmad/core/config.yaml` (pattern already proven by Alya's 2026-07-15 web onboarding — add a regression test that pins it).

**AC**
- Plugin ships the bmad-* skills + framework; `tk-local` source updated and installable.
- A project with **no** local `bmad-*` skills runs a representative BMAD workflow via the plugin, reading its own local config. Demonstrated on ClaudeOS.
- Plugin version bumped; plugin loads clean; any plugin-level tests/typecheck green.
- Regression test asserts `{project-root}` config resolution from a plugin-hosted skill.

### G3 — Stand up the per-user council store + generalize sanctums
*Owner: Alya (identity model) + dev (implementation).*
Depends on: G1. **Precedes** G4 (needs a home to move T1/T2 into) and G7.

1. Create the per-user store layout at the G1-decided path.
2. Re-home `tk_shared_root` from the shared Perforce repo to the per-user store; keep `canonical_root` pointed at the shared repo (now the only thing shared there).
3. Generalize Alya's shared-sanctum model to ALL specialists: every specialist's sanctum becomes per-user, cross-project, in the per-user store. Define T2 pool location as per-user-store, namespaced by project.

**AC**
- Per-user store exists with the decided layout; documented.
- Alya AND every specialist First-Breathe/Rebirth from the per-user store, not project-local dirs.
- A specialist activating in two different projects shares one sanctum (identity) but keeps separate per-project T2 pools.
- `config.local.yaml` across all 4 repos updated to the new `tk_shared_root`; old shared-memory path no longer written to.

### G4 — Memory migration + Reina promotion pass (GATED)
*Owner: Reina (sole writer of promoted knowledge).*
Depends on: G3. **Is the gate** for every deletion in G5.

1. Inventory every legacy / project-local council pool across the 4 repos.
2. Reina runs a promotion pass per pool, routing each keeper to T3a (project VCS) or T3b (`canonical/<domain>`).
3. Move surviving T1/T2 content into the per-user store.
4. Emit a **migration ledger**: what moved where, and an explicit per-target "cleared-to-delete" list.

Priority order (by history-loss risk):
- **Kraken-Backend `tkbe`** (ONLY record of that project's council history — highest risk).
- **kraken_main `tkue`** + legacy `tkue-agent-*` pools.
- kraken_main / Tools / ClaudeOS new-gen `tk-council` pools (relocate to per-user store).

**AC**
- Every pool inventoried; nothing skipped silently (explicit zero where empty).
- Reina's promotion decisions recorded; promoted knowledge committed to the correct tier (project VCS commits are PR-gated per CLAUDE.md rule 6).
- Migration ledger complete; **nothing deleted in this goal.**
- Kraken-Backend `tkbe` fully accounted for before it appears on any cleared-to-delete list.

### G5 — Retirement / deletion (per-repo, gated)
*Owner: dev, per repo.*
Depends on: G2 (for bmad-skill deletions) + G4 (for memory deletions).

Per repo, delete only what is cleared:
1. `.agents/skills/` (byte-identical Cursor mirror) and `.cursor/` dirs.
2. Dead council generations: `tkue-*`, `tkbe-*`, unprefixed `tk-*`.
3. Per-project `bmad-*` skills (now plugin-provided).
4. Per-project `_bmad/` framework modules — leaving ONLY `config.yaml` + `config.local.yaml` (+ any T3a promoted-knowledge dir).

**AC**
- Per repo: of the old footprint, only config (+ T3a knowledge) remains; council still activates via plugin; app/build/test unaffected (verify per repo).
- Perforce repos (kraken_main, Tools): deletions staged to numbered CLs **awaiting Tim's explicit submit** — never `p4 submit` autonomously, never `p4 revert`.
- Git repos (ClaudeOS, Kraken-Backend): deletions on a branch with a code-review pass before the merge gate.
- Decision recorded on `AGENTS.md` (keep as cross-tool convention, or remove) — see Open Questions.

### G6 — Capability A: agent-driven plugin update
*Owner: plugin maintainer (dev).*
Depends on: G2. Parallelizable with G3-G5.

1. A skill/workflow (+ hooks as needed) that updates the installed tk-council plugin — including bundled BMAD — from the `tk-local` source to a target version, via agent interaction.
2. Preview/dry-run of what will change; confirm-before-apply guardrail.
3. Handle the reload/restart seam: an updated plugin takes effect next session; the flow states this and, where possible, triggers/《prompts》 the reload.

**AC**
- Agent-invoked update moves the installed plugin from current to target version.
- Dry-run lists version delta + changed skills before applying; apply requires explicit confirm.
- Post-update state is correct on next session load; the reload requirement is surfaced, not silently assumed.

### G7 — Capability B: version-awareness on birth/rebirth
*Owner: Alya.*
Depends on: G1 (discovery mechanism), G3 (birth/rebirth touches the store), G6 (hands off to the update flow).

1. Alya's First-Breath/Rebirth reads running version + latest-available version (via the G1 mechanism) and compares.
2. If newer exists: notify the user and ASK whether to update first. Decline -> proceed on current; accept -> hand to Capability A.

**AC**
- On activation with a newer version available, Alya surfaces a clear notify + ask before starting work.
- When up-to-date, no prompt (no false positives).
- Decline path proceeds cleanly on the current version; accept path invokes G6.
- Version compare handles the `tk-local` versioning scheme decided in G1.

### G8 — End-to-end validation + team-safe rollout proof (attended capstone)
*Owner: Alya + Tim.*
Depends on: all prior goals.

1. Prove the full model on a clean project.
2. Simulate a second user to verify per-user isolation (no memory collision).

**AC**
- A fresh project activates the council entirely via the plugin (no local bmad/council skills); reads its own config; T2 working memory lands in the per-user store.
- A promotion routes correctly to T3a vs T3b.
- A bumped plugin triggers the G7 version-check and the G6 update flow.
- A simulated second user's sanctums/pools do NOT collide with Tim's (per-user isolation verified).
- Tim signs off.

---

## Critical path & parallelism

- **G0 ships first** (or as a standalone prerequisite mission) — without it the orchestrator can't dispatch the specialists that later goals rely on (Reina for G4, dev for G2/G5).
- **Safety-critical serial spine:** G1 -> G3 -> G4 -> G5 (design -> per-user store -> Reina migration -> deletion). Nothing gets deleted until Reina has cleared it, and every deletion follows the G5 human-in-the-loop destructive-op policy.
- **G2** runs after G1, in parallel with G3; it is the second precondition for G5 (bmad-skill deletions).
- **G6** runs after G2, parallel with the G3-G5 spine.
- **G7** needs G1 + G3 + G6.
- **G8** is the final attended capstone.

Suggested branch-sized mini-goal count: ~2-4 per goal; G4 and G5 fan out per-repo. Keep each mini-goal a coherent, reviewable unit (mission-runner MAX_STORIES_PER_MG is 50, but reviewability, not the cap, is the sizing guide).

## Resolved parameters (Tim, 2026-07-15)

1. **Per-user store path:** OS-specific — `%USERPROFILE%\.tk-council\` (Windows), `~/.tk-council/` (macOS/Linux). The resolver picks per-OS. Confirmed OFF shared VCS. (drives G1/G3)
2. **T3a promoted project-knowledge location:** under the project's `/docs/`, organized by **functional area** — NOT a `/council` subdir. Rationale (Tim): this is the *project's* knowledge, not just the council's. Reina's gate routes project-specific -> `{project}/docs/<functional-area>/`; domain-general -> `canonical/<domain>` (T3b). (drives G4/G5)
3. **Version discovery:** compare the installed version (`installed_plugins.json`, or the cache path segment `.../0.5.0/`) against the marketplace source of record `C:/Users/kenne/Perforce/tk-council/.claude-plugin/marketplace.json` -> `plugins[].version` (kept in lockstep with the plugin's own `plugin.json` on every bump; there are no git tags). **Reload-to-apply is accepted** — plugins load at session start; the agent must clearly COMMUNICATE that a restart is needed after update, never apply silently. Optional finer signal: `gitCommitSha` in `installed_plugins.json` vs source HEAD catches same-version content drift (the cache is currently 1 commit behind source). (drives G6/G7)
4. **Subagent spawnability:** RESOLVED into new prerequisite goal **G0** (add plugin `agents/` wrappers). Verified this session: the plugin ships 17 skills / 0 agents, so specialists cannot be spawned. See G0.
5. **Destructive-operation policy (global):** destructive ops (deletions, `p4`/git removals, marketplace overwrites) are **strongly suggested for a human to run OUTSIDE headless sessions**. The agent PROVIDES THE EXACT COMMAND it would run; the human either runs it themselves OR explicitly approves the agent to run it in-session. This supersedes the earlier "stage to CLs" framing — same spirit, generalized to all repos and all destructive steps. (governs G5 + all teardown)

## Residual minor items
- `AGENTS.md` disposition (keep as a cross-tool convention vs remove with the non-Claude layer) — decide during G5.
- PR target confirmed: `origin` of `C:/Users/kenne/Perforce/tk-council` is the pre-rename upstream `claude-plugins` (the local dir is named `tk-council`; the GitHub repo is `claude-plugins`).

## Surfaces accounted for (explicit)

- **Plugin:** `~/.claude/plugins/cache/tk-local/tk-council/<version>/` — gains bmad-* + framework; version bump; new update skill/workflow/hooks; Alya birth/rebirth version-check.
- **Per-user store (new):** T1 sanctums (all specialists) + T2 pools (per-project namespaced).
- **Shared tk-council repo:** retains only `canonical/<domain>` (T3b); loses the per-user shared-memory role.
- **Each project repo:** keeps `config.yaml` + `config.local.yaml`; gains a T3a promoted-knowledge dir; loses `.agents/`, `.cursor/`, dead council gens, `bmad-*` skills, `_bmad/` framework.
- **Config keys:** `tk_shared_root` (re-homed), `canonical_root` (unchanged), new per-user-store + T3a-location keys.
- **Mission runner:** consumes this as a `tk-council`-target mission; goals map to branches.
- **Rules honored:** CLAUDE.md rule 6 (review before merge), no `p4 revert`, no P4 submit without approval, ASCII-only source.
