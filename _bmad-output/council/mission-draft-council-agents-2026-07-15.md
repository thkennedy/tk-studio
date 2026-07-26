# Mission Draft: Council Specialists Spawnable as Subagents (G0 — prerequisite)

**Scoped by:** Yui (extracted by Alya from the BMAD-consolidation draft) · **Date:** 2026-07-15
**Status:** DRAFT — approved in principle by Tim 2026-07-15; ships FIRST, before the BMAD-consolidation mission.
**target_repo:** `dps-council` — git source `github.com/DirtyPearlStudios/claude-plugins`, working copy `C:/Users/kenne/Perforce/dps-council/`, plugin source `plugins/dps-council/`.

## Intent

Add an auto-discovered `agents/` directory to the dps-council plugin containing one thin wrapper agent per persona specialist, each delegating to its existing skill. This makes `Agent(subagent_type: "dps-council:dps-agent-*")` resolve, restoring the orchestrator's Route / Synthesize / Convene model (spawn specialist -> keep Alya live -> synthesize the return). Skills remain the single source of truth for persona and sanctum — no persona text is forked into agent files. This is a prerequisite for the BMAD-consolidation mission, whose goals must dispatch Reina (G4) and a dev (G2/G5) as subagents.

## Why now (verified 2026-07-15)

The plugin ships 17 skills and ZERO agents (`plugin.json` has no `agents` key; no `agents/` dir in source or cache). So specialists cannot be spawned — the only working path is an in-conversation Skill handoff, which turns the conversation INTO the specialist and cannot do multi-specialist Convene. Reproduced this session (Alya's route to Yui failed with "Agent type not found"). Confirmed against current Claude Code docs: plugins CAN ship subagents via an auto-discovered `agents/` dir, namespaced `dps-council:<name>`.

## Mini-goals

### mg1 — Verify mechanics + choose the wrapper pattern
- Confirm with the claude-code-guide agent + current docs: exact agent frontmatter format; automatic `plugin:name` namespacing; and — the load-bearing detail — whether the `skills:` frontmatter preload OR a Skill-tool invocation from the wrapper body correctly preserves the skill's **root-relative path resolution and rebirth ritual**. (Skills use bare paths resolving from skill root; a naive `Read` of SKILL.md into an agent body breaks internal `references/...` refs.)
- **AC:** a one-page mechanics note committed; the wrapper pattern chosen with justification.

### mg2 — Author the wrapper agents
- Create `plugins/dps-council/agents/` with one wrapper per persona specialist (11 `dps-agent-*`: orchestrator, task-planner, custodian, tech-writer, game-dev, tools-backend, ue-code-reviewer, backend-dev, ops, be-code-reviewer, build-engineer). Frontmatter `name` = skill basename; description/model from each skill's `customize.toml [agent]`.
- Wrapper body delegates to the skill via the mg1-chosen pattern. No persona text duplicated. The 17 skills are NOT modified.
- **AC:** 11 wrapper files present; each resolves `${CLAUDE_PLUGIN_ROOT}` (or the chosen mechanism) to its skill; ASCII-only; the workflow skills (dps-changelog, dps-investigate, dps-stream-*, dps-update-newsletter) intentionally get NO agent wrapper (they are invoked as skills, not spawned as personas) — documented as an explicit decision.

### mg3 — Version bump + re-sync
- Bump `version` in BOTH `plugins/dps-council/.claude-plugin/plugin.json` AND `.claude-plugin/marketplace.json` (`plugins[].version`), lockstep (confirmed pattern, commit `b12cd02`).
- Reinstall/update so the read-only cache re-syncs (`dps-local` marketplace has `autoUpdate: true`).
- **AC:** both version fields match the new version; cache re-synced to the new version + commit.

### mg4 — Verify end-to-end (no regression)
- **AC:**
  - The Agent tool resolves `dps-council:dps-agent-task-planner` and every persona specialist.
  - A spawned specialist runs its OWN rebirth (from its current sanctum location — shared-memory for Alya, project-local for specialists; the per-user store is a later consolidation-mission concern) and returns real output to a still-live orchestrator.
  - RT works (Alya routes to a spawned specialist and synthesizes). CN works (a Convene dispatches >=2 specialists in parallel; Alya synthesizes both returns).
  - `/dps-council:<skill>` slash + Skill-tool invocation still work for all 17 skills — no regression.

## Human-gated outward steps (per Tim's destructive/outward-op policy, 2026-07-15)

The agent PROVIDES exact commands; Tim runs them or explicitly approves in-session. These are NOT done autonomously:
- `git` branch / commit / push on `DirtyPearlStudios/claude-plugins`.
- PR open + merge (merge only AFTER a code-review pass — CLAUDE.md rule 6).
- Any marketplace publish/refresh.
Local work (authoring wrapper files, editing on a branch) proceeds; the push/PR/merge/publish is the gate.

## Constraints

- Do NOT touch `shared-memory/` or `canonical/` (gitignored, not plugin source).
- Keep all 17 skills intact — this ADDS agents only.
- ASCII-only in committed source.
- Code-review pass before the merge gate.

## Bootstrap note

G0 cannot use dps-council subagents to build itself (that is the very thing it fixes). Implement via a general-purpose agent or directly. Once G0 lands and the cache re-syncs, the consolidation mission and all future council work gain real subagent dispatch.

## Non-blocking follow-up

File the "phantom agent-type advertising" harness behavior (skill names surfaced as agent types that do not spawn) via `/feedback`.
