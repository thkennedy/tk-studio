# Routing Brief: BMAD Consolidation + Council Memory Re-home + Plugin Version-Awareness

**From:** Alya (orchestrator) · **To:** Yui (task planner) · **Date:** 2026-07-15
**Action:** Scope this into a mission spec. SCOPE ONLY — do not implement, do not create branches, do not edit anything except your mission-spec doc.

## The initiative

Consolidate to a SINGLE BMAD install delivered via the tk-council plugin, shared across all projects, and re-home council memory onto a clean three-tier model. The team is migrating fully to Claude Code (dropping Cursor), so the non-Claude skill layer is now dead weight. Tim has run the tk-council plugin across all projects for a while and is confident in its stability.

## Locked decisions (do NOT reopen — Tim already decided these with Alya)

1. **BMAD core is BUNDLED INTO the tk-council plugin** — not a separate plugin, not machine-wide `~/.claude/skills`. One plugin delivers council specialists + BMAD core; they share a release cycle.
2. **Three-tier memory model, governed by "promotion is the membrane"** — everything a council session produces is per-user cognition until Reina promotes it; promotion is the ONLY path into anything team-shared (VCS):
   - **Tier 1 — Identity** (sanctums: persona, bond, learned craft/heuristics): per-user, CROSS-project, in a PER-USER council store. Generalize Alya's existing shared-sanctum model to ALL specialists (today specialists' sanctums are wrongly project-local, so the game-dev specialist re-learns craft in every UE repo).
   - **Tier 2 — Working state** (session logs, daily, open threads, in-flight task/scope): per-user-per-project-per-session, in the PER-USER council store, namespaced by project. GC-able.
   - **Tier 3a — Promoted PROJECT-specific knowledge** (Reina-gated): lives in THAT PROJECT'S OWN VCS (travels with code, PR-gated, benefits non-council teammates).
   - **Tier 3b — Promoted DOMAIN-general knowledge** (Reina-gated): stays in `tk-council/canonical/<domain>` (existing model).
   - Reina routes each promotion to 3a vs 3b at the gate.
3. **Sanctums are PER-USER, not per-team.** Each dev's council learns that dev's patterns; team-level learning happens ONLY through promotion (Tier 3). A teammate gets their own Alya/Yui/Reina.
4. **Multi-user fix (critical):** today `tk_shared_root` points INTO the shared Perforce tk-council repo (`C:/Users/kenne/Perforce/tk-council/shared-memory`) and project pools live in `{project}/_bmad/memory/tk-council/`. For a team this collides. Tiers 1 & 2 must move to a PER-USER store OFF the shared repo (e.g. `~/.tk-council/`). The shared tk-council repo then holds ONLY Tier 3b (canonical).

## Recon / blast radius (verified 2026-07-15)

Four active project repos + their `council_domain`:
- ClaudeOS (web): `C:/Github/ClaudeOS`
- kraken_main (ue): `C:/Users/kenne/Perforce/kraken_main`
- Kraken-Backend (be): `C:/Github/Kraken-Backend`
- Tools (tools): `C:/Users/kenne/Perforce/Tools`

Footprint:
- ~67-73 `bmad-*` skills duplicated in BOTH `.claude/skills` AND `.agents/skills`. The `.agents/skills` tree is a BYTE-IDENTICAL mirror (confirmed) — the Cursor/non-Claude load path. ~548 total skill-dir copies across the 4 repos, ~160M+.
- `.cursor/` dirs in kraken_main, Kraken-Backend, Tools.
- Full per-project `_bmad/` framework trees (bmm, gds, cis, core, tea, bmb, wds, automator, custom, scripts) + config + memory.
- **THREE council generations coexist in project skill dirs; only the plugin one is live:**
  - gen1 (oldest): `tkue-*` (kraken_main, 12 skills), `tkbe-*` (Kraken-Backend, 16 skills)
  - gen2 (middle, pre-reviewer-split): unprefixed `tk-*` (all 4 repos, ~10 each)
  - gen3 (LIVE, keep): the plugin's `tk-agent-*` (17 skills), at `C:/Users/kenne/.claude/plugins/cache/tk-local/tk-council/0.5.0/skills/`
- **MEMORY HAZARD:** `Kraken-Backend/_bmad/memory/tkbe` is the ONLY record of that project's council history (no new-gen tk-council pool there). kraken_main has `tkue` + legacy pools alongside new-gen. These hold real state.

## Migration buckets (Alya first-pass — refine into mini-goals)

- **DELETE:** all `.agents/skills` (identical mirror); `.cursor/` dirs; the two dead council generations (`tkue-*`, `tkbe-*`, unprefixed `tk-*`).
- **CONSOLIDATE into plugin:** the 73 `bmad-*` skills + the `_bmad/` framework modules. Per-project `_bmad/` collapses to just `config.yaml` + `config.local.yaml`.
- **MOVE out of project VCS:** `{project}/_bmad/memory/tk-council*` pools + per-project sanctums -> per-user council store.
- **MIGRATE-THEN-DELETE (gated):** Reina runs a promotion pass on Kraken-Backend's `tkbe` pool and kraken_main's `tkue` pool, promoting anything worth keeping into the respective project's VCS, BEFORE deletion.
- **RE-HOME:** `tk_shared_root` -> per-user path; establish the Tier-3a convention (where project-promoted knowledge lands in each repo, e.g. `docs/council/`).
- **KEEP:** per-project config; `canonical/<domain>`; the plugin's 17 council skills.
- **INVIOLABLE ORDERING GATE:** no delete of any memory before it is migrated AND Reina has run her promotion pass. Losing history is the top risk.

## New capabilities to include (Tim added these)

**A. Agent-driven plugin update.** A skill/workflow (plus any needed hooks) to update the tk-council plugin — including its now-bundled BMAD version — via agent interaction. The agent performs/facilitates the update rather than the dev doing it by hand.

**B. Version-awareness on birth/rebirth.** The orchestrator (Alya) checks the plugin version during its First-Breath/Rebirth flow. If a newer plugin version has been pushed (by Tim or anyone), Alya NOTIFIES the user and ASKS whether to update the plugin FIRST, before beginning work. Design considerations:
1. Needs running version, latest-available version, and a compare.
2. Claude Code loads plugins at session start -> an update likely needs a session/agent reload to take effect (hence "update before beginning work"). Plan the reload/restart seam.
3. How "latest available" is discovered — the plugin source is `tk-local` (a local plugin marketplace/source at the tk-council repo).

## Constraints / rules

- **Target repo** for the mission is the tk-council repo (plugin + canonical live there). Several mini-goals also delete/move things in the 4 project repos.
- **CLAUDE.md rule 6:** every branch gets an adversarial code-review pass against main BEFORE the merge gate.
- **Never `p4 revert`; never submit P4 CLs without explicit dev approval** (kraken_main and Tools are Perforce workspaces).
- **ASCII-only in committed source** (comments, strings, logs); Unicode OK in markdown prose.
- A mission runner exists (ClaudeOS `scripts/mission-runner.ts`) with MG-start decompose gating (MAX_STORIES_PER_MG now 50); size mini-goals so each is a coherent, reviewable unit.
- Per-user rollout first (Tim), but the design must be TEAM-SAFE (multi-user) from the start.

## Deliverable

Write the mission spec to `C:/Github/ClaudeOS/_bmad-output/council/mission-draft-bmad-consolidation-2026-07-15.md` (matches prior mission-draft convention). Include:
- Mission title, one-paragraph intent, `target_repo`, and the locked decisions as fixed constraints.
- Ordered goals -> mini-goals, each with crisp acceptance criteria, dependency/ordering constraints (especially the memory-migration-before-delete gate), and owning specialist(s).
- A dedicated section for capabilities A and B with their design considerations.
- A risks / open-questions section: what Tim must decide before execution (at minimum: exact per-user store path; the Tier-3a in-repo location convention; how "latest plugin version" is discovered).
- A SCOPE, not an implementation.
