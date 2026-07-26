# Mission Draft — Research→Knowledge Lifecycle — scoped by Yui, finalized by Alya — 2026-07-07

Routed by Alya (Tim approved). Yui scoped it; Tim answered the 4 open questions; Alya folded the
decisions in (incl. the added Settings mini-goal) and merged to `~/.hermes/missions.json`. Source
brief: `brief-yui-knowledge-lifecycle-2026-07-07.md`; council record:
`convene-knowledge-lifecycle-2026-07-07.md`.

## Mission header

- **Title:** Research→Knowledge Lifecycle for the mission runner
- **Binary outcome:** A mission produces a broad **spine** at mission-start and a narrow **seed** at
  each approved MG-start (both schema-valid); every segment reads spine+seed (not just the prior
  handoff); segments emit **anchored deltas** that queue for **Reina** and reach canonical only by an
  explicit human promotion at mission close.
- **target_repo:** `C:\Github\ClaudeOS` (Tim, OQ-1). Reusable council-side artifacts — a canonical
  schema doc and a dedicated `dps-investigate` skill — are a **separate later track** in the dps-council
  repo, not this mission.
- **verify_cmd:** `bun run typecheck`
- **Workspace root:** `.mission/knowledge-lifecycle/`

## Decisions (Tim, 2026-07-07) — resolves Yui's OQ-1..4

1. **OQ-1 repo:** ClaudeOS. Council-side reusable bits deferred to a later dps-council track.
2. **OQ-2 investigate:** the research pass defaults to **`dps-investigate`**, with a **pluggable seam**
   so a project/domain can supply another pass later. Today it's the only option; domain-detection
   (mission-1783445603624) may enable per-project overrides. **RESOLVED 2026-07-07 (Tim's order, built
   this session):** the `dps-investigate` skill now EXISTS at
   `C:/Users/kenne/Perforce/dps-council/plugins/dps-council/skills/dps-investigate/` (SKILL.md +
   `references/seed-template.md`), mirrored into the plugin cache. It has two modes — `spine`
   (mission-start, broad/bounded) and `seed` (MG-start, narrow, inherits spine) — evidence-graded
   (Confirmed/Deduced/Hypothesized) with immutable anchor ids, and hard-walled off canonical. Untracked
   in the dps-council git repo (uncommitted, Tim to commit). **Knock-on for mg1:** the seed/delta SCHEMA
   now has a concrete contract (`seed-template.md`) — mg1 **formalizes + validates against it** rather
   than designing the schema from scratch (anchor-id immutability, mandatory supersede header, delta must
   cite an existing anchor).
3. **OQ-3 promotion:** deltas **promote to a durable queue = Reina's backlog**; the attended capstone is
   **Reina working her backlog** and promoting/rejecting items into canonical at mission close.
4. **OQ-4 tunables:** gate metric = new **`MAX_STORIES_PER_MG`** (default 5, mirrors `MAX_SEGMENTS`);
   spine budget default **40 turns** (Yui's rec). **New requirement:** a **"Mission Runner" section in
   the ClaudeOS Settings page** to configure these + the existing runner tunables — becomes **mg4**.

## Mini-goals (8; ordered; dependencies hold)

1. **Seed + delta schema + validator** — the contract (supersede header, spine/seed tiers, anchored
   assumptions) + a pure unit-tested validator. Foundation. *(deps: none)*
2. **Mission-start spine pass** — broad/shallow/bounded investigate → schema-valid spine; budget default
   40 turns **read from runner config**. *(deps: mg1)*
3. **MG-start: decompose → notify-gate → seed pass** — cheap decompose; gate `#stories > MAX_STORIES_PER_MG`
   (default 5) notifies + pauses; approved MG gets a narrow seed inheriting the spine; research =
   `dps-investigate` (pluggable). Ordering proven: no research before the gate. *(deps: mg1, mg2)*
4. **Mission Runner Settings section** — dashboard Settings UI exposing `MAX_STORIES_PER_MG` (5), spine
   budget (40), `MAX_SEGMENTS` (5), `max_turns` (150), `max_budget_usd` (10); persisted locally; **the
   runner reads these** (mg2/mg3 consume, never hardcode). *(deps: mg2, mg3 — added by Alya per OQ-4)*
5. **Runner wiring: spine+seed injection** — `renderStory` feeds spine + MG seed into every segment
   (fresh AND continued), asserted by test; no handoff/economy regression. *(deps: mg1–mg3)*
6. **Delta capture + reconciliation queue (Reina's backlog)** — anchored deltas from handoffs → durable
   per-mission queue; mission-close routes to Reina's gate; **no auto-write**; seeds GC unless promoted;
   MG-local vs spine deltas distinguished. *(deps: mg1, mg5)*
7. **Headless e2e proof** — full chain headless; validated artifacts + a queued delta; zero canonical
   auto-write; promotion deferred to mg8. *(deps: mg1–mg6)*
8. **Attended capstone (actor: human)** — Tim watches the live lifecycle; **Reina works her backlog** and
   promotes/rejects ≥1 real delta into canonical at mission close. *(deps: mg1–mg7)*

## AC → constraint mapping (unchanged from convene, now with mg numbers)

- **Sequence (C1):** mg3 proves decompose → gate → seed.
- **Two walled tiers (C2):** mg1 validator enforces the supersede header; mg2/mg3/mg6 never write canonical.
- **Schema-first, research-lazy (C3):** mg1 before mg2/mg3; seed populated per approved MG only.
- **Reina's gate (C4):** mg6 queues + routes, no auto-write; mg8 is the only path canonical changes; GC.
- **Two-tier passes:** spine (mg2) broad/once/bounded; seed (mg3) narrow/per-MG/inherits-spine; deltas
  tiered (mg6). Tunables surfaced in mg4.

## Risks (carried from Yui's scope)

1. Gate error-bars — gate on the cheap decompose, not the seed (baked into mg3).
2. Spine cost front-loaded — bounded budget (mg2), configurable (mg4); a killed mission eats one spine pass.
3. Delta anchor drift — mg1 validator's dangling-anchor rejection catches it.
4. `dps-investigate` binding — resolves to the council investigate capability until the dedicated skill
   ships (Decision 2 build note).
5. Dogfood — 8 MGs kept small so this mission itself obeys the `>MAX_STORIES_PER_MG` discipline.
