---
name: tk-studio-plan-sync
description: Planning adapter — canonicalize BMad-native planning artifacts (normalize pass, sole id authority) and sync them with the bound planning backend. Use when the user says "sync the plan", "normalize planning artifacts", "tk plan sync", or after stock BMad planning flows produce or change epics/stories.
---

# tk-studio-plan-sync

The adapter side of AD-4: stock BMad planning skills stay untouched; this
skill canonicalizes what they produce. The normalized `_bmad-output/`
planning artifacts are the single canonical local representation under every
binding, and this skill is the **sole id authority** (EP-/ST-/TA-NNN from the
committed per-project counter at `.tk-studio/plan-counter.yaml`).

## Behavior (both modes)

1. Run the full adapter verb through the plugin root:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/plansync.py" sync --directory <project-root>
   ```

   `sync` = normalize → validate → projection → plan index, where only the
   projection step is binding-driven (resolved from `planning.backend`,
   AD-15 order; `--backend NAME` is the runtime override). Under
   `bmad-files` the canonical files are the backend: projection is a clean,
   first-class no-op (FR14). Under `backlog-md` the projection is pull-back
   → promote (AD-5): backend status-class changes (status, assignee) land on
   canonical files first — echo-suppressed against the `external.backlog-md`
   snapshot, both-changed entities surfaced as **conflicts** for a human,
   never resolved silently — then canonical entities project into a
   Backlog.md-compatible `backlog/` (epic → milestone + label linkage;
   story/task → task files, native keys only with the canonical id as the
   first label — Backlog.md 1.48.0 verifiably drops unknown frontmatter
   keys; see `kb/backlog-md-verified-behavior.md`). `normalize --directory
   <root>` runs the canonicalization pass alone. Add `--dry-run` to preview
   without writing. The normalize pass:
   - derives/repairs one canonical entity file per epic/story under
     `_bmad-output/planning-artifacts/plan/<ID>.md` from `epics.md` (matched
     across runs by the `source` key — ids never move; `epics.md` itself is
     never rewritten);
   - mints missing ids from the committed counter (document order, counter
     persisted atomically before entity files — a crash leaves a gap, never a
     duplicate);
   - stamps `canonical_id` into matching `implementation-artifacts/story-N.M.md`
     files textually (one line; every other byte preserved);
   - pulls story status from `sprint-status.yaml` when present, mapped onto
     the closed canonical enum (unmappable states reported, never guessed).

2. Blocking conditions (exit 2, nothing written):
   - **duplicate ids** anywhere under `_bmad-output/` — both paths are named;
     a human renumbers, then sync reruns (AD-4: never auto-pick a survivor);
   - **invalid present values** in canonical frontmatter (bad status, id,
     dates) — repair fills only *missing* keys, it never rewrites a present
     value it cannot trust (AD-3 refuse-to-guess).

3. Report:
   - **Attended:** summarize actions (created/repaired/unchanged, minted
     ids, stamps, notes); on a block, show the exact file paths and what to
     fix — never fix ids silently.
   - On **conflicts** (both sides changed since the last sync): list each
     conflicted entity with both values and both file paths; the human picks
     a side by editing one of them, then reruns sync.
   - **Headless:** no prompts (AD-11). End with the status block —
     `complete` on exit 0 (report conflicts as `partial` with the conflict
     list in `reason`), `blocked` on exit 2 with the blocking reason:

     ```json
     {"status": "complete", "intent": "tk-studio-plan-sync", "artifacts": ["_bmad-output/planning-artifacts/plan/"], "reason": null}
     ```

## Rules

- Only this skill (via `lib/plansync.py`) mints ids or writes canonical
  frontmatter keys — no other skill, stock or studio, ever does (AD-4).
- Entity shape questions resolve against `contracts/interchange/shape.v1.json`
  via `lib/interchange.py` — the single shipped validator.
- Backend projection (promote / status pull-back) is binding-driven and
  arrives with the backend adapters; `bmad-files` means normalize + validate
  + index with no projection — a first-class no-op, not an error.
- `plan/index.md` is generated — a foreign index.md in its place is refused,
  never overwritten.
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
