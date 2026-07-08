# Prep: Roster-wide Sanctum Reconciliation (pre-release program) -- 2026-07-07

**Status:** PARKED by Tim (end of day, too many parallel agents to move sanctums safely).
This is decision-prep only -- nothing is scoped or executed yet. Pick up when the
parallel load is low and you're fresh.

**Owner of the eventual scope:** Yui (task planner). Alya routes; Reina owns the
publish-vs-local policy. Alya does not scope this herself.

---

## The ask (Tim's words)

Before releasing the council to the team, every council member's sanctum must be
reconciled onto the shared root per ADR-0002. "Painful but necessary... if I am to
release the council to my team." Not a one-off migration -- a program: audit the
roster -> per-member migrate/backfill plan -> Reina gates publish-vs-local at
execution -> standardize the per-project KB location so shared-root members can find
any project's KB.

The single-sanctum migration (Reina's own, ISS-007's literal fix) stays PARKED --
piecemeal moves are unsafe while members run in parallel windows.

## Governing canon (see caveat below -- these are NOT in git yet)

- **ADR-0002** -- council sanctum locality & distribution: sanctums live on the
  shared root, distributed via the git plugin; custodian gates publish-vs-local;
  per-project = standardized KB only.
  Disk path: `<canonical_root>/commons/decisions/ADR-0002-council-sanctum-locality-and-distribution.md`
- **ADR-0001** -- mission-seed vs canonical knowledge wall (related: the
  KB-standardization angle inherits this two-tier model).
  Disk path: `<canonical_root>/commons/decisions/ADR-0001-mission-seed-canonical-authority.md`
- **ISS-007** (High) -- OS-role sanctum void on the shared root: only Alya's sanctum
  exists there; Yui's is empty (she scoped a mission blind); Reina's was born
  per-project in ClaudeOS. Disk path: `<canonical_root>/commons/issues-ledger.md`
- `<canonical_root>` on this machine = `C:/Users/kenne/Perforce/dps-council/canonical`

## Three constraints Alya holds (fixed AC for whoever scopes this)

1. **Reina's publish-vs-local policy gates the migration.** ADR-0002 grants the gate
   but not the schema -- which sanctum sections are shared/distributed vs
   workspace-local. That policy is a hard dependency; no member migrates until it
   exists. Named Reina deliverable.
2. **KB-standardization already has an owner.** ADR-0002 point 3 (standardize the
   per-project KB so shared-root members can locate it) is the SAME surface
   `mission-1783471523182` (Research->Knowledge Lifecycle) is building (the seed KB).
   Coordinate with that mission -- do not scope a second, competing KB standard.
3. **You cannot migrate a sanctum out from under a live session.** Tim runs
   specialists in parallel windows (the reason the single migration is parked). The
   program must include a per-member quiesce-or-coordinate step, or continuity
   corrupts mid-reconciliation. This is why it's a program, not a chore.

## Proposed shape (not yet approved)

- **Phase 0 (cheap):** roster audit -- enumerate every member, locate each sanctum
  (shared-root present / empty / born-per-project / absent), produce the real gap
  map. Grounds scoping in facts. Alya + Reina can produce quickly.
- **Then Yui scopes** the program into phased stories, handed the audit + the three
  constraints as fixed AC, with Reina owning the publish-vs-local policy as a named
  deliverable.

## OPEN DECISIONS for Tim (this is what to come back to)

- **Fork A vs B:**
  - **(A)** Route straight to Yui to scope, pre-loaded with the audit + constraints.
    Leaner; she has done this shape twice this week. (Alya's lean.)
  - **(B)** Convene first (Yui + Reina + Alya) before a single story is written.
    Heavier, but pre-release stakes may justify pressure-testing the shape.
- **Phase-0 audit:** run it now (next session) or fold it into A/B?

## NEW FINDING (2026-07-07, Alya) -- blocks the ADR-0002 premise

The dps-council repo `.gitignore` ignores **both** `canonical/` (line 2) and
`shared-memory/` (line 1). Consequences:

- Reina's ADR-0001, ADR-0002, and ISS-007 exist on disk but are **not under git
  version control** -- they cannot be committed to the dps-council repo as-is.
- Every shared-root sanctum (Alya's, and any future member's) is likewise
  **gitignored** -- so the "distributed via the git plugin" model that ADR-0002
  assumes **does not exist yet**.

This is very likely the program's true first question: HOW do the shared root and
canonical get git-tracked/distributed at all? The ignore may be intentional (keep
machine-local studio state out of the shipped plugin) -- in which case "distribute
via git" needs a separate distribution repo or a different mechanism. Either way it's
a structural distribution decision, deliberately left for a fresh session.

**Issues-ledger candidate (Reina to record, her domain):** "ISS-008 -- shared-root
and canonical are gitignored in the dps-council plugin repo; contradicts ADR-0002's
git-distribution premise." Not written to the ledger yet because the ledger itself
lives under the gitignored `canonical/` -- logging it there would not make it durable
either. Captured HERE (ClaudeOS repo, tracked) so it survives.

## Where this is durable

This brief lives in the **ClaudeOS repo** (`_bmad-output/council/`, git-tracked) and
is committed. The canonical ADRs/ISS are safe on disk but untracked -- see finding.
