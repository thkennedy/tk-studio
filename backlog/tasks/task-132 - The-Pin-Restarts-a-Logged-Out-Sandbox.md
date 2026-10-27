---
id: TASK-132
title: The Pin Restarts a Logged-Out Sandbox
status: Done
assignee: []
created_date: '2026-10-26 16:40'
updated_date: '2026-10-26 22:31'
labels:
  - ST-132
milestone: Loop Hygiene, What Epics 31 and 32 Taught the Loop
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the supervisor,
I want the pin to notice a running sandbox without a Max login and restart it once,
So that a sandbox started outside the supervisor never blocks every claim (hole 68).

**Acceptance Criteria:**

**Given** a run on the sbx tier whose sandbox is already running when the pin runs
**When** the pin's login probe (`sbx exec <sb> env -u ANTHROPIC_API_KEY claude auth status --json`) answers not logged in
**Then** the pin stops and starts the sandbox once (`sbx stop`, `sbx run -d --name`), probes again, and only then runs the preflight; both attempts are recorded on the run (`pin-restart {probe_before, probe_after}`); a sandbox still logged out after the restart refuses the claim through 33.2's event naming the renewal; a sandbox the supervisor itself pinned in this pass is never restarted twice

**Given** `tk-studio-launch check` (the readiness check) and the runbook
**When** the engine sandbox is running with no supervisor pin recorded for it
**Then** the check names it as a warning ("started outside the supervisor; the next pin restarts it"), and the runbook's hole-68 row stays the rule for sessions; `bun test` covers the restart, the single-restart rule and the warning with a fake `sbx`
<!-- SECTION:DESCRIPTION:END -->
