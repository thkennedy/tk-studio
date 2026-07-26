# Goal Delta: BMAD Version Reconciliation

**Mission:** `mission-1784224747161` "Single BMAD Install + Council Memory Re-home + Plugin Version-Awareness"
**Scoped by:** Yui (task planner) - **Routed by:** Alya - **Date:** 2026-07-16 (amended 2026-07-17)
**Status:** AMENDED per Tim's rulings (routed via Alya 2026-07-17). `missions.json` NOT modified - Tim still approves before any mutation.
**Spec amended:** `_bmad-output/council/mission-draft-bmad-consolidation-2026-07-15.md`

---

## AMENDMENT 2026-07-17 - Tim's rulings on the six questions

Tim ruled on all six. Amendments applied in place below; original reasoning kept
where it stands, superseded reasoning struck through with a SUPERSEDED note.
Summary of what changed:

1. **Q1 (version): 6.9.0 - LOCKED.** Matches original rec. No change.
2. **Q4 (gds/wds): OVERRULED - gds AND wds are BUNDLED framework, not project-local.**
   Tim: "gds is the base game development skills/agents/workflows from bmad that
   should still be available after consolidation." The current G2 branch shipped
   ZERO gds/wds skills, so the bundle is not merely inert (C1) but **incomplete by
   46 skills** (33 gds + 13 wds). This changes bundle CONTENT -> flips Q6.
3. **G5 deletion scope NARROWED: only `dpsue-*` and `dpsbe-*` disappear** (the two
   legacy per-domain council skill generations). Everything else stays.
4. **Authoritative source: the BMAD installer output.** Tim runs the 6.9.0
   installer into a clean scratch dir (gds included, custom excluded); that
   `_bmad/` + `.claude/skills/` becomes the content manifest. G2 VENDORS from it
   (mirror + C1 rewire), not hand-assembly. Resolves Q5 provenance automatically.
5. **Q6 (sequencing): REVERSED - G2 is HELD** until the installer output exists,
   because bundle content now changes (item 2). Sequence: installer (Tim) -> G2
   re-run vendors + C1 rewire -> gate.
6. **NEW requirement: project-name auto-detection** (p4 stream > github repo >
   folder fallback). Recommendation on where it lands: **G3 sub-requirement** - see
   the new "Q7" section.

---

## Why this delta exists

The mission consolidates four BMAD installs into one plugin-delivered install.
That inherently forces three repos onto a version they are not on today - two of
them across seven minor versions. No goal owns that blast radius. G4 is Reina's
memory gate; G5 is deletion. Version reconciliation falls between them and is
currently nobody's.

## Verification method

Every claim below was checked against disk this session. Claims I could not
verify are listed as Open Questions rather than filled in. Three of the premises
I was routed with did not survive verification - they are corrected in
"Corrections to the routing brief" and the correction changes two answers.

---

## Verified findings

### F1 - Version table (confirms Alya's audit)

| Repo | VCS | `_config/manifest.yaml` `installation.version` | `scripts/` | `custom/` |
|---|---|---|---|---|
| ClaudeOS (`C:\Github\ClaudeOS`) | git | **6.9.0** | yes | yes (2 skill overrides) |
| kraken_main (`C:\Users\kenne\Perforce\kraken_main`) | Perforce | **6.6.0** | yes | yes (config only) |
| Tools (`C:\Users\kenne\Perforce\Tools`) | Perforce | **6.2.2** | ABSENT | ABSENT |
| Kraken-Backend (`C:\Github\Kraken-Backend`) | git | **6.2.2** | ABSENT | ABSENT |

Confirmed. ClaudeOS alone has `wds` + `automator`; the bundle ships both, so the
bundle is ClaudeOS's 6.9.0 as Alya stated.

### F2 - The customization mechanism does not exist in 6.2.2 AT ALL

Not merely "the resolver is unreachable" - the entire override model is absent.
Measured across each repo's `.claude/skills/` and `_bmad/`:

| Repo | version | refs `resolve_customization` | refs `_bmad/scripts` | `customize.toml` FILES | `.toml` under `_bmad/` |
|---|---|---|---|---|---|
| Tools | 6.2.2 | **0** | **0** | **0** | **0** |
| Kraken-Backend | 6.2.2 | **0** | **0** | **0** | **0** |
| kraken_main | 6.6.0 | 160 | 71+ | present | present |
| ClaudeOS (control) | 6.9.0 | 154 | yes | **95** | 5 |

The control proves the greps are sound. No global (`~/.claude/skills`) or
plugin-cached skill references the resolver either (**0** and **0**) - so no
invocation path reaches it in those repos by any route.

The customization mechanism was introduced between 6.2.2 and 6.6.0. The 6.2.2
skills never invoke it; there are no overrides to drop even in principle.
**See "Corrections", item 1 - and F8, which is where the real risk actually lives.**

### F3 - Skill-set deltas (the concrete behavioural regression)

Skills present today that are **absent from 6.9.0** - i.e. they disappear when
the local install is deleted and the plugin takes over:

- **Tools + Kraken-Backend (6.2.2 -> 6.9.0), six skills:**
  `bmad-agent-qa`, `bmad-agent-quick-flow-solo-dev`, `bmad-agent-sm`,
  `bmad-create-ux-design`, `bmad-distillator`, `bmad-init`
- **kraken_main (6.6.0 -> 6.9.0), two skills:**
  `bmad-create-ux-design`, `bmad-distillator`

Additive in the other direction (no regression risk - new capability appearing):
`bmad-architecture`, `bmad-prd`, `bmad-spec`, `bmad-investigate`,
`bmad-forge-idea`, `bmad-ux`, `bmad-story-automator`,
`bmad-story-automator-review`, plus `bmad-checkpoint-preview`,
`bmad-customize`, `bmad-eval-runner`, `bmad-prfaq` for the 6.2.2 pair.

Several disappearances look like known consolidations rather than losses
(`bmad-agent-sm` / `bmad-agent-qa` fold into consolidated dev agents;
`bmad-create-ux-design` -> `bmad-ux`; `bmad-create-prd` -> `bmad-prd`). I can
confirm *presence*, not *usage* - see Open Question 2.

### F4 - `project_name` is missing from both 6.2.2 configs

`_bmad/core/config.yaml` keys:

- ClaudeOS 6.9.0: `user_name`, `project_name`, `communication_language`, `document_output_language`, `output_folder`
- kraken_main 6.6.0: same (has `project_name: kraken`)
- Tools 6.2.2: **no `project_name`** (`user_name: Captain`)
- Kraken-Backend 6.2.2: **no `project_name`** (`user_name: Captain`)

148 files in the 6.9.0 skill set reference `project_name` (run-folder patterns,
templates, doc headers). Bundled 6.9.0 skills on the two 6.2.2 repos will resolve
it to empty.

**Severity: degradation, not breakage.** The 6.9.0 SKILL.md contract is explicit -
*"missing keys take neutral defaults, never block"* (verified at
`.claude/skills/bmad-architecture/SKILL.md:54`). Output filenames and template
headers get blanks. **Fix is one config line per repo.**

### F5 - `_bmad/core/` changed layout between 6.2.2 and 6.9.0 (G5 hazard)

- **6.2.2** `_bmad/core/` **contains live skills**: `bmad-advanced-elicitation/SKILL.md`, `bmad-brainstorming/SKILL.md` + `steps/`, etc.
- **6.9.0** `_bmad/core/` contains only `config.yaml`, `config.local.yaml`, `module-help.csv`.
- **6.6.0** (kraken_main) is a partially-migrated hybrid: `.bak` residue
  (`bmad-advanced-elicitation/SKILL.md.bak`, `bmad-party-mode/SKILL.md.bak`,
  `bmad-distillator/SKILL.md.bak`, `bmad-help/SKILL.md.bak`) **plus a live
  `_bmad/core/bmad-init/`** with `scripts/bmad_init.py`.

G5 item 4 says "delete per-project `_bmad/` framework modules - leaving ONLY
`config.yaml` + `config.local.yaml`". On a 6.2.2 repo that command deletes
**executable skill content**, not framework scaffolding. The plugin does replace
those particular skills, so the end state is sound - but the instruction as
written is not safe to hand a human without this caveat.

### F6 - The bundle ships zero `gds-*` and zero `wds-*` skills

**[AMENDED 2026-07-17] This is now a BUNDLE-INCOMPLETENESS finding, not a
mixed-version-island finding.** Tim ruled gds + wds must be bundled (they are
base game-dev framework that must survive consolidation). So the current G2
branch is not just inert-per-C1 - it is **missing 46 skills** it must ship.
The "leave project-local" recommendation below is SUPERSEDED; kept for the
coupling data, which now sizes the C1 rewire instead of an island.

**C1 rewire scope grows (verified on ClaudeOS 6.9.0, the version being bundled):**
- `gds-*`: 33 skills; **45 files reference `resolve_customization`**, 49 reference
  `{project-root}/_bmad` -> these need the SAME C1 path rewire as the bmad-* skills.
- `wds-*`: 13 skills; 2 reference the resolver, 18 reference `{project-root}/_bmad`.

So G2's C1 rewire is no longer "105 bmad skills." It is **bmad-* + gds-* + wds-***,
and the vendoring-from-installer approach (Tim's item 4) must apply the rewire
across all three sets. This is real added scope on an already-blocked goal - flag
it to whoever re-runs G2.

---

### F6 (original, SUPERSEDED) - mixed-version island reasoning

Bundle contents on `feat/mission-single-bmad-instal-bundle-bmad-core-into-the-dps-council-pl`:

- `plugins/dps-council/skills/`: **73 `bmad-*` + 17 `dps-*` + README. No `gds-*`. No `wds-*`.**
- `plugins/dps-council/bmad/`: module assets DO ship - `gds` 16 files, `wds` 49, `tea` 2, and `core`/`bmm`/`cis`/`bmb`/`automator` 1 each.

The one-file modules are correct (the reviewer's rejected hypothesis holds -
`module-help.csv` is the menu manifest; the missing file vs source in each case is
`config.yaml`, legitimately project-local).

But the **skills** are not bundled, while every repo carries them:

| Repo | `gds-*` skills | `wds-*` skills |
|---|---|---|
| kraken_main | 40 | 0 |
| Tools | 35 | 0 |
| Kraken-Backend | 35 | 0 |
| ClaudeOS | 33 | 13 |

**Consequence:** after G5, every repo runs `bmad-*` @6.9.0 (plugin) alongside
`gds-*` @its own local version. That is a mixed-version install, and it is not
named anywhere in the mission.

Coupling checked - **risk is moderate, not fatal**:
- `gds-*` skills invoke `bmad-*` skills by name: `bmad-advanced-elicitation`,
  `bmad-brainstorming`, `bmad-help`, `bmad-party-mode`,
  `bmad-review-adversarial-general`, `bmad-review-edge-case-hunter`.
  **All six still exist in 6.9.0** - the cross-calls resolve by name.
- kraken_main's `gds-*` reference `_bmad/custom` (72x), `_bmad/scripts` (71x),
  `_bmad/gds` (50x), `_bmad/core` (2x) - same C1 resolver-path class as the
  `bmad-*` skills, and NOT covered by G2's C1 rewire (which targets the 105
  bundled skills only).
- Tools' `gds-*` reference no `_bmad/` paths at all (pre-resolver, consistent with F2).

### F7 - H2's dead `core/workflows` references pre-date the bundle

The gate findings flag `{project-root}/_bmad/core/workflows/advanced-elicitation/workflow.xml`
(8 refs) and `.../party-mode/workflow.md` (8 refs) as shipping nowhere. Verified:
**ClaudeOS's own live 6.9.0 `_bmad/core/` has no `workflows/` directory either.**
So H2 is a pre-existing upstream 6.9.0 defect that the bundle copied faithfully -
not a bundling regression. Still needs fixing; the framing changes (it is not
evidence the bundle is wrong, and it is not a reason to prefer 6.6.0).

### F8 - G5 is what weaponizes C1 - and the risk sits on the OPPOSITE repos from where it was predicted

(Raised by Alya's mid-task correction; verified independently here.)

The C1 finding is latent today and **G5 is the event that makes it live**:

1. **Today:** ClaudeOS and kraken_main have a local `_bmad/scripts/`. The bundled
   6.9.0 skills invoke `{project-root}/_bmad/scripts/resolve_customization.py` -
   and it resolves, *by accident*, against the very per-project copy the bundle
   was built to replace. It works for the wrong reason.
2. **After G5** deletes the local `_bmad/scripts/`: that path is gone. The
   invocation fails, the documented fallback fires, and every override in
   `_bmad/custom/` is silently dropped - no error, no warning.

**Therefore G2's C1 fix is a hard prerequisite of G5, not hygiene.** The spec's
existing "G5 depends on G2" is too weak: it reads as "the bundle must exist."
The real constraint is "**C1 must be FIXED**, or G5 inflicts the bug on every repo
that has overrides."

**The risk inversion** - this is the part worth Tim's attention:

| Repo | has `custom/` overrides? | what G5-before-C1-fix costs it |
|---|---|---|
| **ClaudeOS** | **yes - 2 live skill overrides** (`bmad-agent-dev.toml`, `bmad-dev-story.toml`) + `custom/config.toml` | **Silent loss of both.** ClaudeOS is the mission-runner host and `bmad-dev-story` is in live use. |
| **kraken_main** | **yes** (`custom/config.toml`, `custom/config.user.toml`) | Silent loss of team + personal config layers. |
| Tools | no (F2) | **Nothing.** Defaults are already the correct answer. |
| Kraken-Backend | no (F2) | **Nothing.** |

The routing brief placed this risk on Tools and Kraken-Backend. It is the exact
opposite: **the two repos that can lose something are ClaudeOS and kraken_main** -
the two with the newest BMAD and the most active use. The 6.2.2 repos are the
only ones that are safe.

**Latent trap for the 6.2.2 pair** (not a live loss, but must be recorded): after
G5 they run 6.9.0 skills against no `_bmad/scripts/` and no `custom/`. The result
is *correct* - defaults are what those projects want. But the first person to add
an override there gets silence instead of effect. If C1 is fixed, this evaporates.

### F9 - For the 6.2.2 pair, the change is a NET-NEW capability, not a regression

(Alya's reframe; adopted - the evidence supports it.)

Consolidating Tools and Kraken-Backend onto the 6.9.0 bundle does not upgrade a
mechanism they had. It **introduces one they have never had**, in a single step:
a resolver, a three-layer override model (`config.toml` / `<skill>.toml` team;
`*.user.toml` personal), and 95 `customize.toml` files - arriving alongside a
skill set seven minors newer.

Framed correctly, this **lowers** the assessed risk rather than raising it:

- Nothing they rely on is being taken away (F2: there is nothing there to take).
- The new mechanism is inert until someone writes an override.
- Net-new capability landing unannounced is a **documentation + comms** problem,
  not a correctness problem.

It does create one real obligation: **the arrival must be announced.** A developer
in Tools who has never seen `_bmad/custom/` will not know overrides are now
possible - nor that (pre-C1-fix) they would silently do nothing. G9 owns saying so.

---

## Corrections to the routing brief

Recorded because two of them change an answer.

1. **The "live silent-config-drop in the two 6.2.2 repos" is NOT live.**
   *Independently found here (F2) before Alya's mid-task retraction; she then
   retracted it herself on the same evidence. Recorded as converged, not as a
   claim taken on trust.*
   6.2.2 skills reference `resolve_customization` **zero** times, reference
   `_bmad/scripts` **zero** times, and ship **zero** `customize.toml` files -
   against ClaudeOS's 95. The mechanism postdates 6.2.2 entirely, and neither repo
   has a `_bmad/custom/` dir, so there are no overrides to drop even in principle.
   Falling back to skill defaults IS the correct answer there.
   **There is no standalone fix to carve out; the "Also flag" item is void.**
   The C1 finding remains entirely valid for its actual target - see **F8**, which
   shows the risk lands on ClaudeOS and kraken_main instead, i.e. the exact
   inverse of the original framing.

2. **G5 already covers `.agents/skills/`.** G5 item 1 names it explicitly
   ("`.agents/skills/` (byte-identical Cursor mirror) and `.cursor/` dirs"). The
   brief's "G5's deletion scope is written against `_bmad/` only" is not accurate.
   Also: the mirror is in **all four** repos, not Kraken-Backend alone - counts are
   identical to `.claude/skills/` in every one (ClaudeOS 121/121, kraken_main
   131/131, Tools 112/112, Kraken-Backend 128/128). So this is not a "fifth
   footprint nobody counted"; it is a counted footprint, undercounted by three repos.

3. **The real uncovered footprint is `gds-*`/`wds-*` in `.claude/skills/`** (F6),
   not `.agents/skills/`. G5 item 3 deletes only `bmad-*`.

---

## Recommendations

### Q1 - Which BMAD version wins: **6.9.0. Ship the bundle as-built.**

- **Reject "pin at 6.6.0."** It would strip eight skills from ClaudeOS
  (`bmad-architecture`, `bmad-prd`, `bmad-spec`, `bmad-investigate`,
  `bmad-forge-idea`, `bmad-ux`, `bmad-story-automator`,
  `bmad-story-automator-review`). ClaudeOS is the most active repo and the
  mission-runner host; `bmad-story-automator` and `bmad-quick-dev` are in live
  use there. Downgrading the busiest repo to spare the two quietest is backwards.
- **Reject "upgrade everything first."** The mission's endpoint deletes those
  installs. Upgrading an install you are about to delete is pure cost with no
  surviving artifact.
- **The `automator` + `wds` concern is not a risk.** Extra skills appearing in a
  repo is additive. Unused skills cost nothing but listing space.
- **6.9.0 is also where the resolver work landed.** The G2 fix (`d1a86aa`) was
  written against 6.9.0's resolver. 6.6.0 has a different-generation resolver and
  a half-migrated `core/` (F5). Bundling 6.6.0 would mean re-doing C1 against an
  older, messier base.

**Ruling: 6.9.0 LOCKED** (Tim, 2026-07-17), as the *initial* bundled version - G6/G7
will move it forward over time. ~~Consequence for Q6: the bundle content does not
change, G2 does not need to wait.~~ **SUPERSEDED** - the gds/wds bundling ruling
(Q4) DOES change bundle content, which reverses Q6. See Q6.

### Q2 - What regresses: **re-run through the corrected lens. Five items; the top one is not a regression at all, and the worst one lands on the repos nobody was watching.**

The question as routed ("what regresses in Tools, Kraken-Backend, kraken_main")
contains a false premise. Corrected framing, per F2/F8/F9:

- For **Tools and Kraken-Backend**, this is **not a regression - it is net-new
  capability arriving** (F9). They have nothing to lose because they have nothing.
- For **ClaudeOS and kraken_main**, there IS a real loss exposure - and it is
  created by **G5**, not by the version change (F8).

| # | Item | Repos | Severity | Mitigation |
|---|---|---|---|---|
| **R0** | **G5 deletes `_bmad/scripts/` -> bundled skills silently drop `custom/` overrides** (F8) | **ClaudeOS, kraken_main** | **HIGH if C1 unfixed; ZERO if fixed** | **G2's C1 fix is a hard prerequisite of G5.** Already in G2's re-run guidance. |
| R1 | Six skills disappear (F3) | Tools, Kraken-Backend | **Unknown - see OQ2** | Confirm non-use, or follow-up port |
| R2 | Two skills disappear (F3) | kraken_main | **Unknown - see OQ2** | Same |
| R3 | `project_name` stale/unset (F4) | Tools, Kraken-Backend (blank); kraken_main (wrong) | **Low->Moderate** - blank/wrong name mis-keys G3 T2 pools | Auto-detect + backfill (new Q7) |
| R4 | ~~Mixed-version `gds-*` island~~ **VOID** (F6) | - | - | **Superseded: gds/wds are bundled (Q4). No island.** |
| R5 | Override model arrives unannounced (F9) | Tools, Kraken-Backend | **Low** - comms, not correctness | G9 documents the arrival |

**Explicit zeroes:**
- **No regression from the customization change on the 6.2.2 repos** (F2). This
  was the loudest predicted risk in the routing brief and it does not exist.
- No `project_name` change needed for kraken_main or ClaudeOS (both have it).
- H2's dead `core/workflows` refs are not a bundling regression (F7).

**The load-bearing correction:** the routing brief pointed at Tools and
Kraken-Backend. R0 - the only HIGH item - is on **ClaudeOS and kraken_main**, and
it is a **sequencing** risk (G5 before C1), not a version risk. Choosing 6.9.0 vs
6.6.0 does not touch it. That is worth stating plainly because it means **the
version question and the dangerous question are two different questions**, and
only the second one can actually hurt.

R1/R2 remain the only items whose severity I cannot close myself (OQ2), and R0 is
already owned by G2's existing re-run guidance - so this delta's job on Q2 is to
*name the coupling*, not to add work.

### Q3 - Where it lands: **a new goal, sequenced after G2 and before G5. Do not rewrite G5's gate.**

- **Not inside G5.** G5 is `actor: human` and carries the destructive-op policy.
  Version-reconciliation is analysis + config work. Putting analysis into a
  human-run deletion goal makes the human do the analysis at the moment of
  deletion - exactly the wrong time.
- **Not gated behind G4.** G4 is Reina's *memory* gate. Version reconciliation is
  about *skills and framework*. They are independent risks; chaining them
  serializes work for no safety gain. The new goal can run parallel with G3/G4.
- **Depends on G2** (needs the bundle to compare against), **blocks G5**.
- **Number it G9, appended - do not insert between G4 and G5.** Goal ids are
  positional (`mission-1784224747161-1..-8`). Inserting mid-list renumbers G5-G8
  and breaks any existing reference (including the `.mission-reviews/gate/`
  artifacts keyed `-2`). Append as `-9` and express the ordering in the prompt.

**Proposed G9 - BMAD version reconciliation (actor: hermes)**
*Depends on: G2. Blocks: G5. Parallel with: G3, G4.*

1. Pin the winning version (6.9.0) and record the decision + rationale in the
   target-state doc from G1.
2. Produce a per-repo **version-delta ledger** for kraken_main, Tools,
   Kraken-Backend: skills gained, skills lost, config keys missing, module-layout
   changes. (F3/F4/F5 are the seed - re-verify at execution time, do not trust
   this doc's counts as current.)
3. For each lost skill, record a disposition: consolidated-into-X / unused /
   needs-port. **Explicit zero required** - no skill leaves the list unlabelled.
4. `project_name` backfill folded into the Q7 auto-detection work (was a manual
   config edit here; now driven by the detector - see Q7). G9 still owns applying
   the detected value to each repo's `_bmad/core/config.yaml` (Perforce: staged to
   a numbered CL awaiting Tim's submit; never auto-submit, never `p4 revert`).
5. ~~Name the gds/wds island~~ **VOID** (Q4 ruling: gds/wds are bundled).
6. Emit the **keep-list** G5 consumes: exactly which paths survive per repo -
   built around the narrowed deletion target (only `dpsue-*` + `dpsbe-*`).
7. **Announce the net-new override model** (F9) for Tools + Kraken-Backend: those
   projects gain a resolver + three-layer `custom/` model they have never had.
   One short note per repo - what it is, that it is inert until used.
8. **Record the C1-before-G5 interlock** (F8) in the keep-list handoff, so the
   human running G5 can confirm the fix landed before deleting anything.

**AC**
- Version decision recorded with rationale; target-state doc updated.
- Per-repo delta ledger exists; every lost skill carries a disposition (explicit zero enforced).
- `project_name` correct in all four `_bmad/core/config.yaml` via the Q7 detector
  (Perforce changes staged, not submitted).
- G5's keep-list is explicit and unambiguous (see Q4): deletes ONLY `dpsue-*` +
  `dpsbe-*` (skills + `.agents` mirror + `_bmad/memory` pools, gated by G4);
  retains bmad/gds/wds/dps skills + every module's own `config.yaml`.
- No deletions in this goal.

**G5 prompt amendments:**
- "Depends on G9 for the keep-list."
- **"HARD PREREQUISITE: G2's C1 fix must be VERIFIED LANDED before any
  `_bmad/scripts/` deletion"** (F8). Strengthen the existing "depends on G2" from
  *the bundle exists* to *the fix is in*. Without this, G5 silently destroys
  ClaudeOS's and kraken_main's `custom/` overrides. **This is the single highest-value
  line in this delta.**
- The F5 caveat: on 6.2.2 repos `_bmad/core/` holds live skills, not just framework.

### Q4 - Does G5 grow: **RE-DECIDED per Tim's ruling. G5 SHRINKS to a two-target delete; gds/wds move to G2 (bundled).**

Tim narrowed the deletion scope. G5 deletes **only the two legacy per-domain
council generations** - `dpsue-*` and `dpsbe-*`. Everything else stays: bmad/gds/
wds/cis/tea/bmb/automator/core from the bundle; dps-* council skills from the
plugin. My earlier "leave gds/wds project-local" is SUPERSEDED - they are bundled.

**Deletion target, verified on disk 2026-07-17 (cleanly isolated):**

| Target | `.claude/skills/` | `.agents/` mirror | `_bmad/memory/` pools |
|---|---|---|---|
| `dpsue-*` | kraken_main: 14 (elsewhere 0) | matching mirror | kraken_main: `dpsue` + 6 `dpsue-agent-*` |
| `dpsbe-*` | Kraken-Backend: 16 (elsewhere 0) | matching mirror | Kraken-Backend: `dpsbe` + 4 `dpsbe-agent-*` |

So G5 is per-repo and narrow: **kraken_main deletes the `dpsue` family, Kraken-Backend
deletes the `dpsbe` family, ClaudeOS + Tools have neither** (explicit zero). All of
it still G4-gated - the `_bmad/memory/dpsbe*` pools are the ONLY copy of that
project's council history (the mission's top constraint), so **nothing deletes
until Reina clears it.**

**Three things G5 still needs (unchanged by the narrowing):**
1. **`.agents/skills/` + `.cursor/`** stay in scope (G5 item 1) - but note this is
   the *Cursor-mirror* teardown, separate from the dpsue/dpsbe delete. All four
   repos (Correction 2). Whether the whole mirror goes or only the dpsue/dpsbe
   slices of it is an OQ - see OQ6.
2. **Keep-list must be enumerated, not "leave only config.yaml."** Every module
   ships its own `config.yaml` (verified gds/wds/automator). G9 emits the explicit
   keep-list; G5 executes it.
3. **F5 caveat** for the 6.2.2 repos (`_bmad/core/` holds live skills) - still applies
   if any `_bmad/` teardown touches core there.

**New tension surfaced by the ruling (OQ7):** Tim said "dps-* council skills come
from the plugin," yet ruled the local unprefixed `dps-*` skills STAY. Verified:
kraken_main, Tools, and Kraken-Backend each carry **10 local `dps-*` skills** that
now duplicate the plugin's `dps-council:dps-*` (shipped in G0). Leaving them is a
defensible transitional choice, but it is a knowing duplication - flag for Tim,
do not silently reconcile (OQ7).

### Q5 - Bundle version provenance: **RESOLVED by Tim's item 4 - vendoring from the installer makes it automatic.**

Original rec (copy `_bmad/_config/manifest.yaml` into the bundle) still holds, but
Tim's authoritative-source ruling makes it fall out for free: G2 **vendors from the
installer's scratch output**, so mirroring that `_bmad/` brings `_config/manifest.yaml`
along in the same operation. No separate copy step.

The manifest is BMAD-native and richer than any hand-rolled stamp: it records
`installation.version` **and** per-module versions on independent lines (ClaudeOS
sample: `tea` v1.19.0, `bmb` v1.8.0, `core`/`bmm` 6.9.0). Vendoring it verbatim
guarantees the bundled version matches what Tim actually installed.

- **G2 gains an AC:** the vendored bundle includes `bmad/_config/manifest.yaml`; the
  bundled BMAD version is readable from disk without inference.
- **G6 gains one AC line:** the dry-run reports the **BMAD version delta** alongside
  the plugin version delta (they move independently - plugin 0.7.0 says nothing
  about BMAD 6.9.0).
- **G7 gains one AC line:** the version-check reads the bundled BMAD version and
  surfaces it in the notify.

**Authoritative-source decision (Tim, item 4), folded in:** the bundle is
**vendored from Tim's installer output** (clean 6.9.0 scratch install, gds included,
custom excluded) - NOT hand-assembled from any existing repo. G2 mirrors that
`_bmad/` + `.claude/skills/` into `plugins/dps-council/{bmad,skills}/` and applies
the C1 rewire. This guarantees version consistency and a single source of truth for
what "the bundle is."

### Q6 - Hold the G2 re-run: **REVERSED. Hold G2 until the installer output exists.**

~~My earlier answer: release G2 on the Q1 ruling alone, because 6.9.0 is the bundle
as-built so content does not change.~~ **SUPERSEDED by Tim's Q4 ruling.** Bundling
gds + wds **does** change the bundle content: it must gain 46 skills (33 gds + 13
wds) plus their C1 rewire (F6: 45 gds + 2 wds skills reference the resolver). So my
"content does not change" premise is now false, and Alya's instinct to hold was
right for a reason neither of us had yet: not the version, but the gds/wds addition.

**Corrected sequence:**
1. **Tim runs the 6.9.0 BMAD installer** into a clean scratch dir (gds included,
   custom excluded) -> authoritative content manifest. *[manual, Tim, blocks G2]*
2. **G2 re-runs**, vendoring from that output into `plugins/dps-council/{bmad,skills}/`,
   applying the C1 path rewire across bmad-* + gds-* + wds-* + the smaller findings.
3. **Gate** (rule 6 review of the diff before merge).

G2 is correctly BLOCKED until step 1 produces the installer output. The remaining
delta items (G9, G5 narrowing, Q7, G6/G7 AC lines) do not block G2 and can be
approved on their own timeline.

### Q7 (Tim's new requirement) - project-name auto-detection: **G3 sub-requirement, not its own goal.**

Tim's rule: detect `project_name` from **p4 stream name > github repo name >
folder-name fallback**. Verified state (why this matters): the stored fields are
stale - blank in Kraken-Backend + Tools, `"kraken"` (not `kraken_main`) in
kraken_main, only ClaudeOS correct. A per-project T2 pool keyed on a blank or wrong
name **collides or mis-files** - so this is a correctness dependency of G3's
namespacing, not cosmetic.

**Recommendation: fold it into G3 as a sub-requirement.** Reasons:
1. **G3 is the consumer.** G3 stands up the per-user store and defines T2 as
   per-project-namespaced. The namespace key *is* the detected project name.
   Splitting detection into its own goal means G3 could ship a namespacing scheme
   keyed on a field another goal hasn't fixed yet - a self-inflicted ordering hazard.
2. **It is small.** A resolver helper (three ordered sources) + a backfill of four
   config fields. Not goal-sized on its own.
3. **It unifies with G9's `project_name` backfill.** The same detected value
   backfills both the council T2 key AND BMAD's `_bmad/core/config.yaml` field
   (148 files in 6.9.0 read it). One detector, one source of truth, two consumers.
   So G9's R3/item-4 config edit becomes "apply the G3 detector's output," not a
   hand-typed value.

**G3 sub-requirement (proposed):**
- A `project_name` detector: p4 stream name -> github repo name -> folder basename,
  first hit wins. Deterministic, no network beyond local VCS metadata.
- On store/pool init, key the T2 per-project namespace on the detected value.
- Backfill each repo's `_bmad/core/config.yaml` `project_name` from the detector
  (Perforce staged, not submitted).
- AC: all four repos resolve a correct, non-blank `project_name`; T2 pools are keyed
  on it and do not collide across the four projects.

**Caveat I cannot close from here:** Perforce MCP is not connected in this workspace,
so I could not read the actual p4 stream names for kraken_main/Tools. Tim states
folder == VCS name for all four (his verification), which makes the folder fallback
safe today - but the detector's *primary* source for the two Perforce repos is the
stream name, which I have not seen. G3 should confirm stream-name output matches
before trusting it over the fallback. Flagged, not assumed.

### Also-flagged: the standalone silent-config-drop fix

**Recommend: do not create it. The item is void.** Per Correction 1 / F2, the bug
is not live in the 6.2.2 repos - the mechanism it depends on postdates 6.2.2, and
there are no overrides to drop. Nothing to fix outside this mission.

The instinct behind the flag was sound, though, and it has a correct target:
**the exposure is real, it is on ClaudeOS and kraken_main, and it is not standalone -
it is G5's prerequisite** (F8). It does not need carving out; it needs the
interlock line added to G5.

---

## Delta summary (what changes if approved) [AMENDED 2026-07-17 per Tim's rulings]

| Target | Change | Blocking? |
|---|---|---|
| **Tim (manual)** | **Run the 6.9.0 BMAD installer** into a clean scratch dir (gds in, custom out) -> authoritative content manifest that G2 vendors from. | **Blocks G2** |
| **G2** | **Bundle content grows: +33 gds +13 wds skills** (Tim ruling 2). **Vendor from the installer output** (ruling 4), not hand-assembly; apply C1 rewire across bmad-* + gds-* + wds-*. Ship `bmad/_config/manifest.yaml` (comes free with the vendored `_bmad/`). | **HELD** until installer output exists |
| **NEW G9** | BMAD version reconciliation + keep-list. Depends G2, blocks G5, parallel G3/G4. `actor: hermes`. | Blocks G5 |
| **G5** | **NARROWED: delete ONLY `dpsue-*` (kraken_main) + `dpsbe-*` (Kraken-Backend)** - skills + `.agents` mirror + `_bmad/memory` pools, all G4-gated. Add: **C1-fix-verified hard prerequisite (F8)**; enumerate keep-list (per-module `config.yaml`, all bundle/plugin skills retained); F5 caveat; `.cursor/`-mirror teardown scope decision (OQ6). | No |
| **G3** | **NEW sub-requirement: `project_name` auto-detector** (p4 stream > github > folder) keying T2 namespacing + backfilling all four configs (Q7). | No |
| **G6** | Add AC: dry-run reports BMAD version delta alongside plugin version delta. | No |
| **G7** | Add AC: version-check reads + surfaces bundled BMAD version. | No |
| **G1 doc** | Record the 6.9.0 initial-pin + rationale. | No |
| **No change** | G4, G8. | - |

`missions.json` NOT modified. Nothing here is applied - Tim approves first.

---

## Open questions for Tim

**Resolved by Tim's 2026-07-17 rulings** (kept for the record): OQ1 (version ->
6.9.0), OQ3 (gds/wds -> bundle them). Remaining and new:

2. **Are the disappearing skills in use?** Still open, but **lower stakes after
   the narrowing** - G5 no longer deletes bmad/gds/wds. This is now only about the
   6.9.0 skill-set differences carried by the *bundle* (e.g. `bmad-distillator`,
   `bmad-create-ux-design` are not in 6.9.0). If a repo's workflow relied on one,
   it is simply absent from the bundle - a follow-up port, not a deletion loss.
   I verified presence, not usage.

4. **Are Tools and Kraken-Backend actually active?** Both still carry
   `user_name: Captain` (never-customized installer placeholder), pinned 6.2.2
   since 2026-04-09. If dormant, the whole delta's risk profile collapses. I cannot
   determine usage from the filesystem. Still the single highest-leverage answer.

5. **`_bmad/wds/skills/` exists in ClaudeOS's source** (the wds module ships a
   `skills` subdir). Now that wds is bundled, G2/G9 must confirm whether those are
   the same 13 `.claude/skills/wds-*` or a distinct set, so the vendoring does not
   double-ship or miss them. Flagged, not guessed.

6. **[NEW] `.cursor/` + `.agents/` mirror teardown scope.** G5 item 1 tears down
   the Cursor mirror. With the deletion narrowed to dpsue/dpsbe, does Tim want the
   WHOLE `.agents/skills/` + `.cursor/` removed (they mirror `.claude/skills/`
   1:1 in all four repos and are Cursor-era dead weight), or only the dpsue/dpsbe
   slices of them? My lean: remove the whole mirror - it is a byte-identical
   Cursor artifact and the council runs from `.claude/` + the plugin now. But it
   is a scope call, not mine to make.

7. **[NEW] Local unprefixed `dps-*` skills now duplicate the plugin.** Tim ruled
   they stay, yet also said "dps-* council skills come from the plugin." kraken_main,
   Tools, and Kraken-Backend each carry **10 local `dps-*` skills** that now
   duplicate `dps-council:dps-*` (shipped in G0). Leaving them is a defensible
   transitional state, but it is a knowing duplication and a future-drift source
   (local copy vs plugin copy diverging). Confirm: intentional for now, or fold
   into G5's delete once the plugin path is proven in those repos?

8. **[NEW] `project_name` detector - Perforce stream names unverified.** The Q7
   detector's primary source for the two Perforce repos is the p4 stream name,
   which I cannot read here (no Perforce MCP). Tim states folder == VCS name for
   all four, making the fallback safe - but G3 should confirm the stream-name path
   before trusting it over the folder fallback.

## Surfaces accounted for (explicit) [AMENDED 2026-07-17]

- **Mission state** (`~/.hermes/missions.json`): +1 goal (`-9`), goal-prompt
  amendments to G2 (bundle grows + vendor-from-installer), G3 (project-name
  detector), G5 (narrowed to dpsue/dpsbe + interlock), G6, G7. **NOT WRITTEN -
  Tim applies or authorizes.**
- **Tim's environment (manual precondition):** a clean 6.9.0 BMAD installer run
  into a scratch dir -> the authoritative bundle content. Blocks G2.
- **Plugin** (`plugins/dps-council/{bmad,skills}/`): vendored from the installer
  output - gains bmad-* + gds-* + wds-* + framework modules + `bmad/_config/manifest.yaml`;
  C1 path rewire across all bundled skill sets. G2.
- **All four repos** `_bmad/core/config.yaml`: `project_name` backfilled from the
  G3 detector (blank in Tools + Kraken-Backend; `kraken`->correct in kraken_main;
  ClaudeOS already correct). Perforce (Tools, kraken_main) -> numbered CLs awaiting
  Tim's submit. G3.
- **kraken_main**: `dpsue-*` skills + `.agents` mirror + `_bmad/memory/dpsue*` pools
  deleted (G4-gated). Kraken-Backend: same for `dpsbe-*`. ClaudeOS + Tools: neither
  present (explicit zero). G5.
- **Canonical**: no change. Nothing here is promoted knowledge yet - Reina candidate
  for `commons/` after G8.
- **Explicit zeroes:** no change to G4, G8; no code changes in G9; no deletions in
  G9; no standalone silent-config-drop fix (dismissed, F2); no gds/wds deletion
  (they are now bundled and retained).
- **Rules honored:** no `p4 revert`; no P4 submit without approval; ASCII-only;
  one deliverable file, no scratch files; `missions.json` not mutated.
