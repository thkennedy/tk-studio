---
id: TASK-90
title: Routing Legs Carry an Advisor and an Effort
status: Done
assignee: []
created_date: '2026-10-15 19:21'
updated_date: '2026-10-16 20:50'
labels:
  - ST-090
milestone: "The Service Owns Lifetime, Part 1: The Studio Side"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator comparing routes,
I want every pipeline leg to declare an optional advisor model and to pass its effort explicitly to every subagent it launches,
So that Epic 24.3 can run its third arm (a cheaper main model with a stronger advisor) and the meter can price it (the advisor fit note; PROP-045, PROP-052, PROP-058).

**Acceptance Criteria:**

**Given** `[pipeline.legs]` in the launch customization and a project's `.bmad-loop/routing.toml`
**When** a leg carries `advisor = "opus" | "fable" | "off"`
**Then** `pipeline.py check|resolve|apply` validate it (default `off`; the pairing rule: the advisor must rank at or above the leg's model; a violation is a named refusal), `apply` writes it into `routing.current.json`, and the session leg's `claude -p` command carries `--advisor <model>` only when the leg's advisor is not `off`

**Given** the implementer and reviewer launches the session makes
**When** the routing is in force
**Then** each launch passes `model`, `effort` and the advisor explicitly (the executor customization reads `routing.current.json`), and the dispatch note's consult triggers are stated as advisor instructions when an advisor is on ("consult the advisor on: verify-red, halt, deviation above 0, a high-severity finding, a tripwire, a file outside Files, and before declaring the story done"), with a Consult Log entry appended per advisor call so the audit trail survives

**Given** `lib/meter.py`
**When** a story's transcripts carry advisor usage
**Then** the meter prices it as its own leg `advisor` from the price table (a missing price is a named refusal, never a guess) and the observation names it beside the other legs

**Given** the driver contract §5
**When** the story closes
**Then** it documents the `advisor` field and the pairing rule (0.1.21, additive), the lib suite pins the validation, the command line and the pricing, and conformance is green; the shipped defaults stay `advisor = "off"` on every leg (AD-14: nothing changes until Epic 24.4 records a verdict)
<!-- SECTION:DESCRIPTION:END -->
