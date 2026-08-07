# Evaluation: tk-council Plugin + Packaging Fork (2026-07-25)

- **Naming (scrub note, 2026-08-06):** every "tk-council" in this document names
  the legacy (pre-rename) council repo under evaluation — not the later tk-studio
  product, whose working title was also "tk-council" (see the concept seed).
- **Status:** Evaluation only. No decision made; the packaging direction goes to a
  council debate (forge-idea / party-mode) before any process starts. Tim's ruling
  2026-07-25: "debate it first, evaluation report only for now."
- **Source inspected:** `tk-council.rar` (added to `D:\ClaudeOS`), a full extract of
  the marketplace repo at `main` @ `d26a67f` -- including the git-ignored,
  Perforce-shared trees (`canonical/`, `shared-memory/`, `_bmad/`, `.agents/`,
  `.claude/`). Real repo home: the Perforce working dir (`...\Perforce\tk-council`,
  git origin: the pre-rename upstream `claude-plugins`).
- **Purpose:** (1) ground-truth inventory, (2) debts worth fixing under ANY direction,
  (3) frame the packaging fork so the debate argues about the right thing.
- ASCII-only.

---

## 1. What exists (inventory summary)

The repo is the `tk-local` marketplace hosting one plugin, `tk-council` v0.7.1
(1,521 tracked files of 1,548 total tracked; ~3,600 files on disk counting the
ignored trees).

| Layer | Content | Verdict |
|---|---|---|
| Council IP | 17 `tk-*` skills (11 persona-agent + 6 workflow), 11 thin `agents/` subagent wrappers, domain-profile registry + detector/onboarder scripts | The real asset. Keep the design. |
| Vendored BMad | 104 skills (71 `bmad-*`, 33 `gds-*`) + 7 framework modules, BMad 6.10.0, produced by `tools/vendor_bmad.py` | The packaging question. G2 of the in-flight mission, merged 2026-07-23. |
| Knowledge base | `canonical/` (103 files, 25 MB, Perforce-shared, git-ignored) | Only `ue/` (heavily) and `commons/` (lightly) hold real content. See section 3. |
| Legacy memory | `shared-memory/` = Alya's sanctum only (T1 on shared VCS -- the defect the mission exists to fix) | G3-G5 NOT STARTED; per-user store designed but unmerged. |
| Vendor source | `.agents/` + `.claude/` at repo root: byte-identical 21 MB trees of raw BMad installer output (~42 MB total), git-ignored | Consumed only by `vendor_bmad.py --source`. Restructuring target. |
| Mission artifacts | `.mission/`, `.mission-stories/`, `.mission-reviews/` (14 files, tracked) | Mission Control (ClaudeOS) drops these; spec source of truth is `_bmad-output/council/mission-draft-bmad-consolidation-2026-07-15.md` in ClaudeOS. |

Key mechanical facts:

- The plugin declares NOTHING in its manifest beyond name/version/description/author.
  No hooks, no commands, no MCP config, no settings. Everything wires by directory
  convention (`skills/`, `agents/`). Only path variable used: `${CLAUDE_PLUGIN_ROOT}`.
- The 11 `agents/*.md` are ~1 KB delegation wrappers ("invoke Skill
  `tk-council:<name>` as your FIRST action"), deliberately NOT `skills:` frontmatter
  preloads (bare paths would rebase and the rebirth ritual would be skipped).
- Routing is data-driven end to end: Alya builds the live roster from
  `domain-profiles/<council_domain>.json`; the tables in her SKILL.md are renders of
  that data. Adding a domain = dropping a JSON file. `web`/`generic` are
  external-roster profiles that hand off to plain BMad -- no plugin specialists.
- Detection (`detect-domain.py`) is read-only, bounded, weighted-marker scoring with
  a confidence floor and a 2-point margin rule; onboarding (`onboard-domain.py`) is
  propose-with-evidence, explicit-confirm, dry-run-able. Never silently guesses.

## 2. Strengths (preserve under any direction)

1. **Clean separation already exists.** The 104 vendored skills carry ZERO tk-council
   contamination (verified by grep for `tk-council|tk_|council_domain` -- one
   incidental substring hit in a gds knowledge doc). All coupling is machine-applied
   by `vendor_bmad.py`: path rewrites (178 files), 2 quirk patches, 1 resolver patch.
   Consequence: re-packaging is cheap. The council does not actually depend on WHERE
   BMad lives; the vendoring made it so, and the same discipline makes it undoable.
2. **The vendor pipeline is real engineering.** Rules-not-hand-patches, 8-check
   verify (`--check` for CI), sentinel-anchored framework patches that fail loudly on
   upstream drift, timestamp-free manifest for stable diffs. If the debate lands on
   keeping the bundle, this tool is fit for purpose.
3. **The domain-profile system** is the most future-proof part of the design and is
   orthogonal to packaging. Do not reopen it.
4. **Governance discipline** (Reina promotion membrane, closed-inventory /
   no-delete-before-clearance ordering, independent gate reviews with verdict.json,
   issue ledger with stable ISS ids) is unusually mature. The G2 gate even caught a
   dirty-worktree "live-proven" claim -- the process works.
5. **Name-based handoff already proven.** External-roster profiles (`web`, `generic`)
   route to BMad skills BY NAME with no plugin specialists. This is the coupling model
   a slim plugin would generalize.

## 3. Debts (worth fixing regardless of the fork)

| # | Debt | Where | Severity |
|---|---|---|---|
| D1 | Three memory models coexist: Alya cross-project on shared VCS; 10 specialists project-local (`{project-root}/_bmad/memory/tk-agent-*/`); designed per-user store (`~/.tk-council/`) implemented ONLY on an unmerged branch (`feat/mission-single-bmad-instal-stand-up-per-user-council-store-generali`) that is not an ancestor of main. On main, `lib/` holds nothing but stale bytecode. Store dir provisioned but EMPTY. | plugin `lib/`, `shared-memory/`, project repos | HIGH |
| D2 | SECURITY: Alya's `MEMORY.md` (shared-memory, Perforce-shared) contains an Atlassian MCP token suffix and a dead-token list. Same class as the Hermes key leak. Scrub now; do not wait for the G4 re-home. | `shared-memory/tk-agent-orchestrator/MEMORY.md` | HIGH |
| D3 | Shipped dead weight: 14 `__pycache__` dirs inside the plugin incl. bytecode for `test_check_plugin_version` whose SOURCE exists nowhere in the repo; empty `lib/` on main. | `plugins/tk-council/**` | MED |
| D4 | Doc drift: `skills/README.md` stale by 1 agent + 6 workflow skills and contradicts `tools.json`; BUILD-CONTRACT cites dead `plugin/skills/` layout; `kenne`-era absolute paths pervade docs; repo README self-name mismatch; TWO conflicting G0-G8 numberings (MIGRATION-RUNBOOK cutover vs mission spec) both live. | root docs, `skills/README.md` | MED |
| D5 | Alya's SKILL.md routing tables duplicate the profile JSONs (documented as renders, but they already drifted once vs `tools.json`). Consider generating them or trimming to pointers. | `tk-agent-orchestrator/SKILL.md` | LOW |
| D6 | ~42 MB duplicated vendor source (`.agents/` + `.claude/`, byte-identical) at repo root; only `vendor_bmad.py --source` consumes it. Under a slim-plugin direction it disappears; under bundling, consider a throwaway staging dir instead. | repo root | LOW |
| D7 | Vendor-tool nits from the G2 gate (all LOW, still open): dead `FRAMEWORK_EXCLUDE` constant, unused `verify(source)` param, `--check` cannot detect content drift. Plus open question: how the resolver fix was authored-but-uncommitted. | `tools/vendor_bmad.py`, MISSION-STATUS | LOW |
| D8 | Stale 0.7.0 plugin cache hazard (documented in MISSION-STATUS): old cache carries `_bmad/` incl. `core/` at its root and a plain-upstream resolver -> silent wrong-config for ~4 legacy-path skills. G6/G7 (update + version awareness) are the durable fix. | user plugin cache | MED |
| D9 | Canonical reality vs aspiration: `tools/` and `web/` gardens are empty shelves; `be/` is a staged import awaiting Reina promotion + backend-custodian sign-off; `ue/index.md` frontmatter still names the pre-migration roster (Masha, Zara...); 24 MB of `.COPY` Blueprint dumps would need LFS if canonical ever moves into git. | `canonical/` | LOW |

## 4. The packaging fork

### 4.1 Decision history (whiplash on record)

1. **2026-06-13 (Tim): "Path A -- plugin on top of BMad."** Two update channels:
   upstream installer for the framework, git plugin repo for the council.
   (MIGRATION-RUNBOOK.)
2. **2026-07-15 mission spec -> G2 (merged 2026-07-23): bundle BMad INTO the
   plugin.** One delivery per machine, shared release cycle. Motivated by ~548
   duplicated skill copies across 4 project repos + multi-user distribution.
3. **2026-07-25 (Tim): wants a version that "more easily sits on top of BMad
   (maybe back to modules) and survives BMad upgrades."** Points back toward Path A.

The debate should settle this ONCE, with the reversal cost on the table.

### 4.2 Options

**A. Slim plugin over stock BMad** (evaluator's recommendation, matches Path A)
- Plugin ships ONLY tk-council content (~120 files): 17 skills, 11 agents, profiles, lib.
- BMad installed per project via upstream installer; coupling by SKILL NAME
  (already proven by the external-roster profiles), never by path.
- Kills: the vendor pipeline, the resolver fork, the 42 MB vendor source, D6/D7/D8's
  vendoring half. BMad upgrades become upstream's own `bmad install` path.
- Cost: per-project BMad installs return (the ~548-copies pain -- though that is
  upstream's supported model and one installer command per repo per release).
  Alya's adaptive onboarding gains a "BMad present + version >= floor?" check.

**B. Keep the vendored bundle** (double down on G2)
- Keep `vendor_bmad.py`; accept a vendor->verify->release cycle per BMad release;
  keep single-artifact machine-wide distribution -- simplest story for other
  ClaudeOS users.
- Cost: permanent ownership of an upstream fork (resolver patch), 1,500-file plugin,
  and every upstream layout change lands on the anchored patches first.

**C. BMad external module(s) + micro-plugin**
- Repackage tk-council as a proper external module (like tea v1.19.0 / gds v0.6.0):
  installer-managed versioning, `bmad install` handles upgrades -- modules are the
  sanctioned extension point ("back to modules" literally).
- BUT: no machine-wide install, and BMad modules cannot ship Claude Code `agents/`
  subagent wrappers -- a micro-plugin is needed anyway. Effectively A with extra
  packaging; viable as a PHASE 2 of A (the tk-council skills already use `customize.toml`
  and the help-CSV conventions, so emitting a module manifest later is incremental).

### 4.3 What is orthogonal (carries forward under ALL options)

- The three-tier memory design (G1 doc, gate-cleared): per-user store, promotion is
  the membrane, `tk_shared_root -> tk_user_root` rename (RATIFIED 2026-07-20),
  closed-inventory + no-delete-before-clearance ordering, sanctum-collapse merge
  contract. Nothing in the packaging fork touches it.
- The domain-profile registry and adaptive onboarding.
- The 6 workflow skills (stream-open/review/land, changelog, newsletter,
  investigate) and Perforce discipline.
- G6/G7 (agent-driven update + version-awareness on rebirth) -- the mechanism
  differs per option but the capability is wanted in all of them.

### 4.4 Seed questions for the debate

1. Who are the real consumers over the next 12 months (Tim solo? N ClaudeOS devs?),
   and what is their tolerance for a per-project `bmad install` step vs a stale
   bundled BMad?
2. What is the actual observed cost of one BMad upstream release under B (measure:
   the 6.9->6.10 vendor run) vs under A (installer runs x number of repos)?
3. Is the resolver fork acceptable to own indefinitely if upstream never takes the
   filed patch (`tools/upstream-patches/resolver-plugin-hosting.md`)?
4. Does name-based coupling hold for everything the council hands off to, including
   `workflow_set` entries and the two quirk-patched cross-skill references
   (advanced-elicitation, party-mode)?
5. If A wins: what is the de-vendoring teardown ordering, and does it gate on the
   same closed-inventory rules as G5? (It should.)
6. If C ever runs: which parts of tk-council are BMad-module-shaped (config, help,
   customize) vs plugin-shaped (agents, marketplace), and is the split worth two
   artifacts?

## 5. Proposed process after the debate (not started)

1. `bmad-correct-course` on mission `mission-1784224747161`: keep G3-G5 unchanged,
   re-disposition G2's outcome per the debate verdict, refit G6/G7 to the chosen
   packaging. Fresh session per handoff protocol.
2. `bmad-architecture`: target-state v2 doc -- successor to
   `docs/target-state-architecture.md`, inheriting sections 3/5/6 (memory) verbatim
   and replacing section 4.1 (plugin layout).
3. `bmad-create-epics-and-stories` -> Mission Control as usual. The debts table
   (section 3) becomes the hygiene epic; D2 (token scrub) should not wait for it.
