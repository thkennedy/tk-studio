---
id: SPEC-epic-20
companions: []
sources:
  - ../../planning-artifacts/epics.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Epic 20: The Contract Names Its Drivers and Carries Cost

## Why

A mandate plus a measurement gap (Plan Phase 1 scope item 8, acceptance (d); `briefs/brief-studio-supervisor-2026-09-27/brief.md`). ClaudeOS is retired as driver, yet `driver-contract.md` still names it as the consumer; the studio supervisor and Hermes now drive the studio and the contract must say so. Operators measuring unattended runs also need each terminal run's cost in the ledger, but today the `job-run` taxonomy payload has no cost field and `jobrun.py` records none. Repo: tk-studio.

## Capabilities

- **CAP-1**
  - **intent:** `jobrun.py finish` accepts the run's cost, and the terminal record carries it.
  - **success:** Given a finish with a cost figure, the `job-run` event payload carries `total_cost_usd` as a non-negative number, `run.json` records the same figure, and there is exactly one emitter and one event per terminal transition.
- **CAP-2**
  - **intent:** A finish without cost is unchanged.
  - **success:** Behavior and event are identical to 0.1.17: the field is absent, never zero-filled.
- **CAP-3**
  - **intent:** An invalid cost is refused, not guessed.
  - **success:** A negative, non-numeric, or non-finite cost makes `finish` refuse with a named error; nothing is recorded or emitted.
- **CAP-4**
  - **intent:** The taxonomy declares the cost field.
  - **success:** `contracts/events/taxonomy.v1.json` declares `job-run.payload.total_cost_usd` optional, with a note naming its source (the worker's `--output-format json` result); the lib suite pins the present, absent, and refused cases; full suite green.
- **CAP-5**
  - **intent:** The contract at 0.1.18 names its UI-carrying consumers in place of ClaudeOS.
  - **success:** Header reads 0.1.18 with a changelog clause marking it additive; §7 row 6 names the studio supervisor (status page) and Hermes (front door) as the consumers that carry UI, and still states the studio grows no UI; the Audience line and every other row naming ClaudeOS as the driver are updated.
- **CAP-6**
  - **intent:** A driver author can find who drives the studio.
  - **success:** A driver roster lists the studio supervisor (executing wrapper, status page), Hermes (front door that submits jobs to the supervisor and never executes a run), and direct invocation (a conforming driver per §1).
- **CAP-7**
  - **intent:** Any conformant driver may execute a run.
  - **success:** §2 states the executing wrapper for a run is whichever conformant driver executed its `wake` directive, and that `account` and `finish` are that wrapper's duty.
- **CAP-8**
  - **intent:** Cross-references and the `finish` row are correct.
  - **success:** §1 points to §2 for per-skill CLIs and to §3 for the status block; the §4 `finish` row documents the optional `total_cost_usd` from CAP-1.
- **CAP-9**
  - **intent:** The change reaches headless runs on the agent PC.
  - **success:** `runner.py run` is ok over every surface; lib suite green; `tools/release_archive.py` ships the plugin at its next patch version with the gate ×3 in lockstep and a verified archive; the scoped plugin update lands it on the agent PC; `tk activate` is clean on all four planes.

## Constraints

- AD-2: nothing in the plugin imports a driver; the contract is the entire interface.
- Contract bump is additive **0.1.18** — the planned 0.1.16 slot was consumed by the install `no_normalize` change (PR #64), and 0.1.17 by the studio-managed base patches (#76, 2026-09-28).
- AD-12: one `job-run` emitter (the job wrapper), one event per terminal transition.
- AD-3: an invalid cost is refused, never coerced or guessed.
- The studio grows no UI; UI lives in driver-side consumers.

## Non-goals

- Any studio-side UI or dashboard.
- Implementing or importing the supervisor or Hermes in the plugin.
- Computing run cost studio-side — the figure is supplied to `finish`.
- Any non-additive contract shape change.

## Success signal

- A run finished with a cost lands one `job-run` event and a `run.json` both carrying the same `total_cost_usd`, a run finished without one is byte-identical in shape to 0.1.17, and the released 0.1.18 contract on the agent PC names the supervisor, Hermes, and direct invocation as its drivers with `tk activate` clean.

## Assumptions

- The cost comes from the driver as a `finish` argument sourced from the worker's `--output-format json` result; the studio does not compute it.
- 0 is a valid cost (the criterion says non-negative) and is recorded, not treated as absent.
- Story order is 20.1 then 20.2, since the §4 `finish` row documents 20.1's field.

## Open Questions

- What is the CLI shape of the cost argument on `jobrun.py finish` (flag name)? The source does not name it.
