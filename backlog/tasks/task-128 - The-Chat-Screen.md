---
id: TASK-128
title: The Chat Screen
status: To Do
assignee: []
created_date: '2026-10-25 03:13'
labels:
  - ST-128
milestone: The Engagement Loop v1
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the owner,
I want the engagement conversation in the web,
So that intake, questions, scope, quote and approval happen from the desktop or the iPad without a terminal (§6.3 Chat; F2).

**Acceptance Criteria:**

**Given** `GET /engagements`, `GET /chat/{id}` and the typed inputs
**When** the Chat screen renders
**Then** it lists the project's engagements by state with the open one's transcript (owner and planner lines, the planner's run cost on hover), a message box (`POST /chat/{id}`), the state as a stepper (`intake … delivered`, the side exits marked), the questions as cards with their options and defaults (an answer sends `answer`), the scope page's link and a **Revise** box (sends `revise`), the quote as the band (50/85/95 as share and dollars, the cap, the autonomy levels) and an **Approve** control with the autonomy choice (sends `approve`), **Go** and **Cancel** where the table allows them, and a planner `proposals[]` entry as a button sending exactly that input; a **New engagement** form (`POST /engagements`); the nav gains Chat, and an engagement in `awaiting-answers` or `quoted` puts a count on it; the web sends the CSRF token as the inbox reply does; the stream keeps the transcript live and the watchdog on `visibilitychange` reconnects it on the iPad

**Given** the screen
**When** it is tested
**Then** vitest covers the stepper, the cards, the quote, each action and the refusals' rendering with a fixture; the studio-web gate stays green
<!-- SECTION:DESCRIPTION:END -->
