# Alya → Yui — scoping brief: Research→Knowledge Lifecycle mission — 2026-07-07

Routed by Alya at Tim's direction. This is produce-work: return a scoped mission **draft**
to Alya. **Do NOT write `~/.hermes/missions.json`** — Alya merges (our established pattern).
Your shared sanctum is known-empty (flagged for Reina); don't block on First-Breath — work
from your skill definition + this brief. Full council record:
`_bmad-output/council/convene-knowledge-lifecycle-2026-07-07.md`.

## The design

Fold research into the PLANNING phase and produce a provisional, mission-scoped **seed KB**
every segment reads, so continued segments start from a shared base instead of blindly
executing the prior handoff. During dev, segments surface **deltas** where reality diverges
from the seed; deltas reconcile into canonical afterward.

Runner context (ClaudeOS, `C:/Github/ClaudeOS/scripts/mission-runner.ts`): mission = epic of
mini-goals (MGs); each MG runs as fresh `claude -p` "segments" that cycle via handoffs when a
75% context tripwire fires. Symbols: `decideLoopAction` (pure: merge/respawn/park/fail),
`MAX_SEGMENTS = 5`, handoffs `.mission/<mission>/<goal>/handoff.md` + `~/.claude-os/handoff-latest.md`.
Today a continued segment sees ONLY the prior handoff — no first-segment context.

## Constraints from the convene (non-negotiable in your scope)

1. **Sequence:** decompose → notify-gate → THEN seed. Research sits BEHIND the gate. Gate =
   `#stories(for an MG) > MAX_SEGMENTS → notify Tim` (tunable).
2. **Two walled tiers.** Seed = mission-scoped, provisional, disposable, **authoritative for
   its own mission**. Canonical = Reina-gated long-term base. Seed header declares the
   supersede-for-this-mission rule. Planning research NEVER writes canonical.
3. **Schema up front, research lazy.** Sora owns the seed + delta schema (one-time template);
   the specialist/investigate pass POPULATES it lazily per approved story; segments emit
   **anchored deltas** in handoffs ("assumption A3 was wrong: X not Y").
4. **Reconciliation is Reina's gate.** Deltas queue, promote at mission close, NO auto-write.
   Seeds GC with the mission unless promoted.

## Two-tier dedicated pass (Tim confirmed — bake into AC)

- **Mission-start pass = broad + shallow** → shared "spine" (architecture map, systems,
  invariants, entity/glossary map). Once per mission, behind the mission go/no-go. Map, not
  territory.
- **MG-start pass = narrow + deeper** → per-MG seed the segments read, LAYERED ON the spine
  (inherits, never re-derives). Once per MG, behind the `MAX_SEGMENTS` notify gate.
- Deltas tiered: most MG-local (cheap seed fix); rare one invalidates the spine (escalate;
  strong canonical-promotion candidate).

## Scope = option (C), cross-repo

Council owns the knowledge brain (Yui decompose + gate; Sora seed/delta schema; Reina
seed↔canonical wall + promotion gate); the ClaudeOS runner wires it + owns the notify gate.
Likely repo split: reusable planning/seed/investigate skills → dps-council plugin repo;
runner wiring (pass steps, seed injection into `renderStory`, the gate, delta capture in
handoffs) → `C:/Github/ClaudeOS`. Roots: `C:/Users/kenne/Perforce/dps-council/{canonical,shared-memory}`.
Flag exact target_repo split as an open question — don't guess.

## Relationship to existing work

This is a NEW mission (Tim's "next mission"), distinct from mission-1783446597838
"Token-aware session cycling" (owns segment-cycling mechanics). That mission already has
**mg5 "Cap-hit escalation (notify + optional auto-replan, no hard fail)"** — the REACTIVE net.
THIS mission is the PROACTIVE half that demotes mg5's cap-fail to a rare fallback. If a piece
belongs on the existing mission instead, say so.

## Deliverable (return to Alya)

1. **Mission header:** title, crisp binary_outcome, target_repo (flag cross-repo split),
   verify_cmd if obvious.
2. **Mini-goals:** ordered, each with `title`, binary/observable `done_when`, and a
   `full_prompt` sketch in house style (`/goal Mission: ... - mini-goal N of M ...`, workspace
   path, "cap at 20 turns then pause", "pause and ask Tim in chat", "do NOT self-tick the card",
   one-paragraph summary on done). Sequence so dependencies hold (schema before populated;
   spine pass before MG pass; a headless proof before any attended capstone).
3. **AC per component**, honoring the 4 constraints + two-tier passes.
4. **Open questions for Tim** (flag, don't guess) — at minimum: (a) seed research as a
   dedicated `bmad-investigate`/`dps-investigate` pass (Tim leans dedicated) vs inline in the
   planning agent, and the wiring implication; (b) exact repo split; (c) tunables (gate
   threshold, spine-pass budget).
5. **Risks** (seed staleness, gate decision inheriting seed error bars, cross-repo execution).

Same quality bar as your token-aware-session-cycling spec. Return the draft; Alya synthesizes
for Tim and handles the missions.json merge.
