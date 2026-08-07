# Council Meeting — Research→Knowledge Lifecycle (planning-phase seed KB) — 2026-07-07

Convened by Alya at Tim's direction. Domain: OS-role territory (unset `council_domain`;
no domain specialist needed). Present: Yui (planner), Sora (tech writer), Reina (custodian).

## The proposal

Fold research into the **planning** phase, not just after it. Produce a provisional,
mission-scoped **seed** (a knowledge base draft) so every segment starts from the same
base instead of blindly executing the prior handoff. During development, segments surface
**deltas** where reality diverges from the seed; those deltas are reconciled afterward and
promoted into the canonical KB. Sits on top of the earlier decompose→notify gate and the
reactive mg5 cap-escalation.

## Council verdicts

**Yui (scope / decomposition lens)**
Directionally right, but keep the gate cheap. Decomposition (MG→stories) and the
`#stories > MAX_SEGMENTS` notify must stay fast — if I front-load a full research pass
*before* the go/no-go, every re-scoped or killed mission burns that research for nothing.
Sequence it: decompose → gate → *then* seed, and seed **per approved story, lazily**, not
one mission-wide research dump. One hazard: if the seed's research is wrong, my story
count can be wrong too — so the gate decision inherits the seed's error bars. I want the
gate to run on the cheap structural decompose, and treat the seed as enrichment that
follows, not a precondition.

**Sora (structure / distillation lens)**
I'm the one this changes most, and I'm for it. Today I inherit a raw backlog *after* the
work and reconstruct what happened. Structured deltas turn that into adjudicating flagged
diffs — far better. But it only works if the seed has a **stable schema** and the delta
note references it by anchor ("assumption A3 was wrong: X, not Y"). That means I define the
seed *format* up front, before research runs, so research writes into my structure. Note
the friction with Yui: I need to be in early enough to set the template — that's a small,
one-time cost, not a per-mission research cost. I do the format; the specialist does the
spelunking; I don't do primary code research.

**Reina (integrity / canonical lens)**
I'll allow it, with a wall. The seed is **provisional and mission-scoped** — it is *not*
canonical and nothing writes to canonical without my promotion gate. Two governance points
nobody else owns: (1) **authority during a mission** — if canonical says X and the seed
says Y because the code moved, the segment must know the seed wins *for this mission* while
canonical remains the long-term base. Put that in the seed header, explicitly. (2)
**reconciliation stays gated** — deltas do not auto-promote. They queue for my promotion
pass; freshness comes from running that pass at mission close, not from a live firehose
into the garden. And seeds are disposable: they die with the mission unless their
reconciled deltas earn promotion. I garbage-collect; I don't inherit orphans.

## Disagreement

- **Seed timing/weight.** Yui wants the gate on the *cheap* decompose with the seed lazy and
  behind it; Sora needs to be in *early* to set the seed schema. Resolvable: these aren't the
  same cost — Sora's schema is a one-time template (cheap, up front); the *research that
  populates it* is what stays lazy and behind Yui's gate. Not a real fork once separated.
- **Reconciliation cadence.** Reina holds a gated/manual promotion (integrity, slower); the
  "KB stays fresh" goal pulls faster. Named, not resolved by fiat: freshness vs integrity is
  Reina's gate to pace. Her call, and I back it — a fast KB full of unverified deltas is worse
  than a slightly stale correct one.

## Alya's recommendation

**Proceed, with adjustments.** The design is sound and the tensions resolve cleanly:

1. **Sequence:** decompose → notify-gate (on the cheap structural pass) → seed the *approved*
   stories only. Research sits behind the gate.
2. **Two tiers, walled:** seed = mission-scoped, provisional, disposable, and **authoritative
   for its own mission**; canonical = Reina-gated, long-term base. Seed header declares the
   supersede-for-this-mission rule so segments know which source wins.
3. **Schema up front, research lazy:** Sora defines the seed + delta schema once (template);
   the specialist/investigate pass populates per story; segments emit anchored deltas in their
   handoffs.
4. **Reconciliation stays Reina's gate:** deltas queue, promote at mission close, no
   auto-write. Seeds GC with the mission unless promoted.

This also settles the earlier open scope question: it pulls in all three OS roles as
first-class, so it's **option (C)** — the council owns the knowledge brain (Yui decompose +
Sora schema/distill + Reina gate), the ClaudeOS runner wires it and owns the notify gate.
Cross-repo mission.

**Architectural-decision note:** this is an ADR candidate — the seed↔canonical authority
rule and the reconciliation gate are cross-cutting policy. Reina, flagging for promotion to
`<canonical_root>/commons/decisions/` at your next pass.

## Next step

Route to **Yui** to scope the mission (decompose+gate+seed-trigger wiring as the runner
surface), with **Sora** owning the seed + delta schema as a named deliverable and **Reina**
owning the seed↔canonical wall + promotion gate as acceptance criteria. Cross-repo (C).

**Still needs Tim (one input):** does the planning-phase research run as a dedicated
investigate pass (`bmad-investigate` / `tk-investigate`) or inline inside the planning
agent? Determines whether the seed pass is its own runner step or folded into decomposition.
