---
name: tk-studio-migrate
description: Designed migration of a project's planning binding to Jira — closed inventory, export→transform→import→verification, copy-then-verify-then-flag cutover, source retained read-only until explicit operator clearance (AD-16). Use when the user says "migrate planning to jira", "rebind to jira", "tk migrate", or asks to move the project's backlog into the team's tracker.
---

# tk-studio-migrate

Rebinding a project to Jira is a verified migration, not a copy (ST-8.2,
AD-16). The deterministic core owns the safety rules; nothing here is a
shortcut around them.

## Behavior (both modes)

1. **Preview first** (no writes, backend not contacted):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/migrate.py" run --directory <project-root> --dry-run
   ```

2. **Run the migration:**

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/migrate.py" run --directory <project-root>
   ```

   In order: **closed inventory** (validated canonical entities + every
   current-projection file, hashed, persisted to
   `.tk-studio/migrations/jira.json` before any move — nothing off the
   inventory may ever be deleted) → **import** through the jira adapter
   (`lib/jirabackend.py` — the only surface that talks to the backend,
   AD-4; API-token preflight incl. the org-admin toggle and issue-type
   scheme confirmation, AD-7) → **verification** (entity counts, complete
   id map, content hashes against both the inventory and the promote
   snapshots, spot round-trip read back from Jira) → **cutover**: source
   projection files marked read-only, then the flag — `planning.backend:
   jira` in tracked config, edited textually so human-authored bytes
   survive — written **last** and re-verified through config resolution.
   A crash at any point still reads from the source binding.

3. **Any verification mismatch halts `blocked`** with every discrepancy
   listed; the flag is not written and no partial state reads as migrated.
   Other blocks: nothing to migrate, invalid canonical export, jira
   preflight failure (each gap named — never a silent 401), a local
   overlay overriding the flag, clearance without `--confirm`.

4. **Clearance is a separate, explicit act** — the source stays read-only
   until the operator decides:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/migrate.py" clear --directory <project-root> --confirm
   ```

   Deletes only inventory-listed files; anything else found is reported as
   a leftover and never deleted. `status --directory <root>` reports the
   record. **Attended:** never run `clear` without the operator explicitly
   confirming in conversation; **headless:** `--confirm` is the recorded
   clearance — absent, the run ends `blocked`, never a prompt (AD-11).

5. **Headless:** end with the status block:

   ```json
   {"status": "complete", "intent": "tk-studio-migrate", "artifacts": [".tk-studio/migrations/jira.json"], "reason": null}
   ```

## Rules

- No-delete-before-clearance and the closed inventory are absolute (AD-16);
  a mismatch is fixed by a human, never worked around.
- Canonical files are never a migration source in the deletable sense —
  they stay authoritative under every binding, Jira included (AD-4/AD-5).
- Credentials ride `JIRA_API_TOKEN` (+ `JIRA_EMAIL`) only — never any
  config file or the migration record (AD-3).
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
