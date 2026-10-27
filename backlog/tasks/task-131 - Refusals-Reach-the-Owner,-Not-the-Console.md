---
id: TASK-131
title: Refusals Reach the Owner, Not the Console
status: Done
assignee: []
created_date: '2026-10-26 16:40'
updated_date: '2026-10-26 21:28'
labels:
  - ST-131
milestone: Loop Hygiene, What Epics 31 and 32 Taught the Loop
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the owner,
I want a run that cannot claim to say why in its record and in my inbox,
So that an expired sandbox login or a failed pin never leaves a run silently queued for hours (holes 68, 69).

**Acceptance Criteria:**

**Given** a queued run the drain cannot claim (the Max-login preflight refuses, the pin fails, the placement is refused, the checkout lock is held by a live holder)
**When** the drain passes over it
**Then** the run stays `queued` and gains one queue event `claim-refused {reason, pass_at}` per distinct reason (a repeated reason updates `pass_at` on the same event, never a flood), the notifier sends one line per new reason with the run id and what resolves it, `GET /runs/{id}`, `GET /status`'s live list and the office's `problems[]` carry the latest reason (contract 0.1.28, additive), and the claim proceeds on the next pass once the reason clears, recorded as `claim-refusal-cleared`

**Given** the engine sandbox's Max login (the global `anthropic` sbx secret, renewed from inside the sandbox with `/login`)
**When** `tk-studio doctor` or the activate drift check runs
**Then** they read `refreshTokenExpiresAt` from the sandbox's `~/.claude/.credentials.json` through `sbx exec` (never the tokens) and warn from 7 days before expiry, naming the renewal steps (`sbx run --name <sandbox>` → `/login` → `/exit`); an expired login is a failed check; `bun test` and the lib suite cover the events, the notifier line, the doctor reading and the warning window with fakes
<!-- SECTION:DESCRIPTION:END -->
