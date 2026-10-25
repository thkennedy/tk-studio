---
id: TASK-126
title: The Quote Band
status: To Do
assignee: []
created_date: '2026-10-25 03:13'
labels:
  - ST-126
milestone: The Engagement Loop v1
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the owner,
I want a 50/85/95 band from the studio's own history with a hard cap,
So that I approve a price with its tail, not a hope (F2 step 4; D4; B5 item 4).

**Acceptance Criteria:**

**Given** the meter's per-story records (today a free-text `observation`; this story makes the meter's payload structured and additive: `kind: meter`, `story_key`, `epic`, `usd`, `tokens {input, output, cache_read, cache_write}` per leg and the route, written to `transcripts/<key>/observation.json` and harvested to the host ledger as before) and the scope's proposed stories
**When** `engage.py quote` runs (the planner's turn after the scope, or by hand)
**Then** it computes, for this project and story kind, a seeded bootstrap (10,000 resamples of per-story tokens over the proposed story count) 50/85/95 band in tokens, shown as plan-window share (the plan's weekly window from `~/.tk-studio/config.yaml`'s `plan.window_tokens`, else "share unknown") with the list-price dollar shadow (`prices.json`), the cap (`cap = p95 + one story at p85`) and what happens at the cap (the run pauses `partial`, the engagement's issue blocks with the figures, the owner decides), the route and the autonomy levels on offer (32.6), and whether scoping was billable (the planning spend so far); a history under eight landed stories says "thin history" and widens the band from the design spec §10's sizing by analogy, never a bare number; `quote {band50, band85, band95, cap, basis, computed_at}` lands in the record, the state moves `scoping → quoted`, and `.tk-studio/budget-bands.yaml` gains `epics.<proposed EP>.usd_estimate` from the 85th so the board draws the band against spend once the epics exist

**Given** the quote
**When** it is tested
**Then** the lib suite covers the resampling (seeded, exact), the thin-history rule, the share, the cap and the voiding on `revise` with fixtures; `GET /engagements/{id}` carries the quote and `GET /board`'s `band_usd` follows it; `kb/quote-band.md` records the method and its first figures
<!-- SECTION:DESCRIPTION:END -->
