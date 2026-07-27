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

## Report

- **Attended:** one line per standup step (created vs already-present), the
  proposal table with evidence, then the recorded outcome.
- **Headless:** end with the status block — `complete` after a successful
  record (or a clean standup-only run with no confirmation requested),
  `blocked` on collision, classification refusal, or missing confirmation:

  ```json
  {"status": "complete", "intent": "tk-studio-onboard", "artifacts": [".tk-studio/config.yaml"], "reason": null}
  ```

## Rules

- Recording is the only write to `working_set` and happens only on explicit
  confirmation — a proposal is never auto-recorded (NFR6).
- Registry writes go through `registry.py` with `--writer onboard` (AD-20
  single-writer); this skill never edits `projects.yaml` directly.
- Tracked-config writes are classification-checked (AD-3) — a refusal is a
  `blocked` status, not a workaround.
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
