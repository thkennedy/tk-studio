---
name: tk-studio-onboard
description: Onboard a project into the studio — stand up the taxonomy (store, config, registry, kb, vault window), then propose a role × project working set with evidence and record it only on explicit confirmation. Use when the user says "onboard this project", "tk onboard", "set up the studio here", or "recommend a working set".
---

# tk-studio-onboard

Onboarding lands the Taxonomy (Epic 2) and turns the Recommendation inputs
(`tk-studio-detect`) into a confirmed, recorded working set (AD-17). Detection
never guesses; recording happens only on the operator's explicit confirmation.

## Flow (both modes)

Run each step through the plugin root; all are idempotent.

1. **Taxonomy standup** (skips cleanly whatever already exists):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/store.py" standup
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/config.py" standup --directory <project-root> [--vcs git|perforce] [--project-id ID]
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/registry.py" register --directory <project-root> --writer onboard [--project-id ID]
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/kb.py" standup --directory <project-root>
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/vault.py" link --project-id <id>
   ```

   A `project_id` collision fails registration and demands an explicit id
   (AD-20) — surface it, never invent one. No vault configured → linking
   skips cleanly (the vault is a view, never a dependency).

   Attended, after standup: if the store config has no `display_name`, ask
   how the operator wants the studio to address them and record the answer:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/store.py" set-name "<name>"
   ```

   "Use my assistant preference" records the literal `assistant-preference`
   — the fallback, chosen, so no surface asks again. Headless never prompts
   and skips this (address is presentation-only).

2. **Propose** (read-only — this IS the dry run; it shows the full plan and
   writes nothing):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/recommend.py" propose --directory <project-root>
   ```

   Role resolves from the per-user store (`--role` overrides). Every proposed
   resource carries evidence lines by source: `role-default` (conservative
   per-role base), `detection` (only on a `confident` outcome — type, score,
   fired markers), `user-authored` (the project's own resources, first-class).
   On an ask outcome (`ambiguous — ask` / `unknown — ask`) the proposal
   carries no detection-derived entries and a note saying so.

   A confident game profile can also propose a plugin-shipped engine skill
   (`game-godot` → `gds-engine-godot-4`, Story 34.4): a `kind: skill` entry
   with `detection:` and `engine-pin:` evidence (the project's pinned engine
   version against the skill's supported range). A pin outside the range,
   a features/SDK disagreement or an unreadable pin adds the entry's
   `warnings[]` and a `gds-engine-godot-4: ` note; a pin that cannot be
   checked (no readable `project.godot`, a malformed `global.json`) is still
   proposed and carries an `engine pin not checked: <reason>` warning;
   attended, show that warning to the operator before they confirm. Headless onboarding records
   nothing new: it records only what the payload confirms.

3. **Confirm, then record**:
   - **Attended:** present the proposal with its evidence; the operator
     edits/accepts the set. On an ask outcome, ask what the project is
     first and re-propose. Only after an explicit yes:

     ```bash
     uv run "${CLAUDE_PLUGIN_ROOT}/lib/recommend.py" record --directory <project-root> --role <role> --resources <a,b,c>
     ```

   - **Headless:** confirmation must arrive in the payload (an explicit
     `resources` list). No payload set → do NOT record; end `blocked` naming
     the missing confirmation (AD-11 — never prompt, never guess).

   Recording lands in tracked config `working_set.<role>` — a role-keyed
   map: this role's entry replaced, every other role's entry and every
   comment preserved byte-for-byte. Re-recording an identical set is a
   no-op (idempotent re-onboarding).

4. **Set up tracking** (optional — only when asked: attended, the operator
   asks for it; headless, the payload carries `tracking: true`). The
   planning adapter creates the project's Jira project, its statuses and
   the "Needs you" filter, and the linked Confluence space with its
   design-page folders, from the studio template, and records the keys and
   ids under `planning.jira` and `planning.confluence` (AD-4: this skill
   never calls Atlassian itself):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/plansync.py" setup --directory <project-root> [--dry-run] [--owner-account-id <id> | --owner-email <owner email>]
   ```

   Pass `--owner-account-id` or `--owner-email` from the payload's
   `owner_account_id` / `owner_email` when given. It uses the agent seat's
   variables only — `TK_ATLASSIAN_SITE` (first setup), `TK_ATLASSIAN_AGENT_EMAIL`,
   `TK_ATLASSIAN_AGENT_TOKEN`, `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN`,
   `TK_ATLASSIAN_CLOUD_ID` — and refuses with each absent one named (and
   on an unregistered project) before any call: relay that refusal as
   `blocked`, never ask for a token. Relay the setup's status block as
   this skill's — its `status` and `reason` unchanged, its `artifacts`
   added to (deduplicated with) the artifacts onboard itself wrote this
   run (`kb/`, vault links, the registry entry), with `intent` set to
   `tk-studio-onboard` (the core's block says `tk-studio-plan-sync`):
   `complete` when every step was created or found;
   `partial` with its `owner_steps[]` shown **verbatim and in order** —
   the numbered steps the API could not do on the free plan — never
   reworded and never reported `complete`; `blocked` with its `reason`.
   A rerun is idempotent: what exists is recognised by key and named in
   `found[]`.

## Report

- **Attended:** one line per standup step (created vs already-present), the
  proposal table with evidence, then the recorded outcome.
- **Attended, tracking:** the setup's `found[]` and `created[]`, then, on
  `partial`, its numbered owner steps verbatim.
- **Headless:** end with the status block — `complete` after a successful
  record (or a clean standup-only run with no confirmation requested),
  `partial` when tracking setup ended `partial` (its `reason` carries the
  owner's numbered steps verbatim, `artifacts` the config it wrote plus
  what onboard itself wrote),
  `blocked` on collision, classification refusal, missing confirmation, or
  a tracking-setup refusal:

  ```json
  {"status": "complete", "intent": "tk-studio-onboard", "artifacts": [".tk-studio/config.yaml"], "reason": null}
  ```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- Recording is the only write to `working_set` and happens only on explicit
  confirmation — a proposal is never auto-recorded (NFR6).
- Registry writes go through `registry.py` with `--writer onboard` (AD-20
  single-writer); this skill never edits `projects.yaml` directly.
- Tracked-config writes are classification-checked (AD-3) — a refusal is a
  `blocked` status, not a workaround.
- Tracking setup goes through `plansync.py setup` only (AD-4); the
  owner's token is never read and no token lands in any file (AD-3).
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
