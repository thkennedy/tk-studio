# Goal Delta: BMAD Version Reconciliation

**Mission:** `mission-1784224747161` "Single BMAD Install + Council Memory Re-home + Plugin Version-Awareness"
**Scoped by:** Yui (task planner) - **Routed by:** Alya - **Date:** 2026-07-16
**Status:** RECOMMENDATION - awaiting Tim's approval. `missions.json` NOT modified.
**Spec amended:** `_bmad-output/council/mission-draft-bmad-consolidation-2026-07-15.md`

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

### F6 - The bundle ships zero `gds-*` and zero `wds-*` skills (the mixed-version island)

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

**Consequence for Q6:** the bundle content does not change. G2 does not need to wait.

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
| R3 | `project_name` unset (F4) | Tools, Kraken-Backend | **Low** - degrades to blank, never blocks | One config line per repo |
| R4 | Mixed-version `gds-*` island (F6) | all four | **Moderate** | Name it; keep module `config.yaml`; accept this mission |
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
4. Add `project_name` to Tools' and Kraken-Backend's `_bmad/core/config.yaml`
   (Perforce: staged to a numbered CL awaiting Tim's submit; never auto-submit,
   never `p4 revert`).
5. Name the `gds-*`/`wds-*` mixed-version island explicitly and record the
   accepted decision (recommended: leave project-local this mission).
6. Emit the **keep-list** G5 consumes: exactly which paths survive per repo.
7. **Announce the net-new override model** (F9) for Tools + Kraken-Backend: those
   projects gain a resolver + three-layer `custom/` model they have never had.
   One short note per repo - what it is, that it is inert until used.
8. **Record the C1-before-G5 interlock** (F8) in the keep-list handoff, so the
   human running G5 can confirm the fix landed before deleting anything.

**AC**
- Version decision recorded with rationale; target-state doc updated.
- Per-repo delta ledger exists; every lost skill carries a disposition (explicit zero enforced).
- `project_name` present in all four `_bmad/core/config.yaml` (Perforce changes staged, not submitted).
- Mixed-version `gds-*`/`wds-*` decision recorded; if "leave project-local", the
  keep-list retains each surviving module's own `config.yaml`.
- G5's keep-list is explicit and unambiguous (see Q4).
- No deletions in this goal.

**G5 prompt amendments:**
- "Depends on G9 for the keep-list."
- **"HARD PREREQUISITE: G2's C1 fix must be VERIFIED LANDED before any
  `_bmad/scripts/` deletion"** (F8). Strengthen the existing "depends on G2" from
  *the bundle exists* to *the fix is in*. Without this, G5 silently destroys
  ClaudeOS's and kraken_main's `custom/` overrides. **This is the single highest-value
  line in this delta.**
- The F5 caveat: on 6.2.2 repos `_bmad/core/` holds live skills, not just framework.

### Q4 - Does G5 grow: **yes, but not where the brief expected.**

1. **`.agents/skills/` - already covered.** No growth needed (Correction 2).
   Worth correcting the count to all four repos in G5's text.
2. **`gds-*`/`wds-*` in `.claude/skills/` - the real gap.** G5 item 3 deletes only
   `bmad-*`, so 33-40 `gds-*` per repo (+13 `wds-*` in ClaudeOS) survive.
   **Recommendation: leave them project-local for this mission and say so.**
   Bundling `gds-*`/`wds-*` is real scope growth on G2 (which is already blocked
   and already carries a C1 rewire across 105 skills) - it belongs in a follow-up
   mission, not here. But the survival must be *deliberate and written*, not
   incidental.
3. **G5's "leaving ONLY `config.yaml`" is ambiguous and must become an enumerated
   keep-list.** Every module ships its own `config.yaml` - verified for `gds`,
   `wds`, `automator`. If "config.yaml" means only `_bmad/core/config.yaml`, then
   the surviving `gds-*` skills lose `_bmad/gds/config.yaml` and break. G9 emits
   the explicit keep-list; G5 executes it.
4. **G5 gains the F5 caveat** for 6.2.2 repos (`_bmad/core/` holds live skills).

### Q5 - Bundle version provenance: **a G2 add. Not its own goal.** (Confirms Alya's item 11.)

The provenance artifact **already exists and is BMAD-native**:
`_bmad/_config/manifest.yaml` records `installation.version` **and** per-module
versions - including modules on independent version lines (ClaudeOS: `tea`
v1.19.0, `bmb` v1.8.0, `core`/`bmm` 6.9.0). It is strictly richer than a
hand-rolled version stamp, and it is already correct in the source install.

Verified: **the bundle ships no `_config/` at all.** The entire fix is to copy the
source install's `_bmad/_config/manifest.yaml` to
`plugins/dps-council/bmad/_config/manifest.yaml`, plus a README line. That is a
file copy - it does not merit a goal.

- **G2 gains:** ship `bmad/_config/manifest.yaml`; AC - the bundled BMAD version is
  readable from disk without inference.
- **G6 gains one AC line:** the dry-run reports the **BMAD version delta**
  alongside the plugin version delta (they move independently - plugin 0.7.0 says
  nothing about BMAD 6.9.0, which is the exact gap Alya identified).
- **G7 gains one AC line:** the version-check reads the bundled BMAD version and
  surfaces it in the notify.

Two AC lines and a file copy. No new goal.

### Q6 - Hold the G2 re-run: **I disagree with Alya - do not hold it. Release it on Q1 alone.**

Alya's reasoning is sound *conditionally*: if the answer were "pin at 6.6.0", G2's
bundle content changes and Tim runs it twice. But the answer is 6.9.0 (Q1), and
6.9.0 is the bundle as-built - so **G2's content does not change**. The C1
resolver rewire is orthogonal to the version question: it is about *where* skills
find the resolver, not *which version* of it.

Holding G2 behind full approval of this delta costs a serialization for a decision
that does not touch it. The dependency is narrower than Alya framed it:

- **G2 needs one thing from Tim: the Q1 ruling.** Confirm 6.9.0 -> re-run G2
  immediately with the existing guidance plus the manifest item (Q5).
- **If Tim overrules to 6.6.0 -> Alya is right, hold G2** and re-scope the bundle.

So: **release G2 on the Q1 ruling, not on approval of the whole delta.** G9, the
G5 amendments, and the G6/G7 AC lines can be approved on their own timeline
without blocking G2 - none of them change what G2 builds.

### Also-flagged: the standalone silent-config-drop fix

**Recommend: do not create it. The item is void.** Per Correction 1 / F2, the bug
is not live in the 6.2.2 repos - the mechanism it depends on postdates 6.2.2, and
there are no overrides to drop. Nothing to fix outside this mission.

The instinct behind the flag was sound, though, and it has a correct target:
**the exposure is real, it is on ClaudeOS and kraken_main, and it is not standalone -
it is G5's prerequisite** (F8). It does not need carving out; it needs the
interlock line added to G5.

---

## Delta summary (what changes if approved)

| Target | Change | Blocking? |
|---|---|---|
| **NEW G9** | BMAD version reconciliation. Depends G2, blocks G5, parallel G3/G4. `actor: hermes`. | Blocks G5 |
| **G2** | Add: ship `bmad/_config/manifest.yaml` (provenance). Content otherwise unchanged. | No - re-run on Q1 ruling |
| **G5** | Add: **C1-fix-verified hard prerequisite (F8 - highest value)**; consume G9's keep-list; enumerate keep-list explicitly (per-module `config.yaml`); record `gds-*`/`wds-*` survive project-local; add F5 caveat (6.2.2 `core/` holds live skills); correct `.agents/` scope to all four repos. | No |
| **G6** | Add AC: dry-run reports BMAD version delta alongside plugin version delta. | No |
| **G7** | Add AC: version-check reads + surfaces bundled BMAD version. | No |
| **G1 doc** | Record the 6.9.0 pin + rationale. | No |
| **No change** | G3, G4, G8. | - |

`missions.json` NOT modified. Nothing here is applied.

---

## Open questions for Tim

1. **Q1 ruling - confirm 6.9.0?** This is the only decision gating the G2 re-run.
   Everything else in this delta can be approved later without blocking anything.

2. **Are the disappearing skills in use?** I verified *presence*, not *usage* -
   I cannot see who runs what. `bmad-distillator` and `bmad-create-ux-design`
   disappear for kraken_main, Tools, AND Kraken-Backend (all three non-ClaudeOS
   repos). `bmad-agent-sm`, `bmad-agent-qa`, `bmad-agent-quick-flow-solo-dev`,
   `bmad-init` disappear for the 6.2.2 pair. If any are live, G9 gains a port
   task. **This is the largest unquantified risk in the delta.**

3. **`gds-*`/`wds-*` - leave project-local (my recommendation) or grow G2 to bundle
   them?** Leaving them means an accepted mixed-version install. Bundling them is
   meaningful G2 scope growth on an already-blocked goal.

4. **Are Tools and Kraken-Backend actually active?** Both still carry
   `user_name: Captain` - the never-customized installer placeholder - and both
   are pinned at 6.2.2 from 2026-04-09. If they are dormant, R1's severity drops
   to near-zero and G9 shrinks to a bookkeeping pass. I cannot determine usage
   from the filesystem. This single answer moves the delta's risk profile more
   than any other.

5. **`_bmad/wds/skills/` exists in ClaudeOS's source** (the module ships a `skills`
   subdir). I did not trace whether those are the same 13 `wds-*` skills as in
   `.claude/skills/` or a distinct set. Flagged rather than guessed; G9 resolves
   it while building the ledger.

## Surfaces accounted for (explicit)

- **Mission state** (`~/.hermes/missions.json`): +1 goal (`-9`), 4 goal-prompt
  amendments (G2, G5, G6, G7). **NOT WRITTEN - Tim applies or authorizes.**
- **Plugin** (`plugins/dps-council/bmad/_config/`): new `manifest.yaml`. G2.
- **Tools + Kraken-Backend** `_bmad/core/config.yaml`: `project_name` added.
  Perforce (Tools) -> numbered CL awaiting Tim's submit. G9.
- **kraken_main**: no config change needed (`project_name: kraken` present).
- **ClaudeOS**: no config change needed. This doc only.
- **Canonical**: no change. Nothing here is promoted knowledge yet - if the 6.9.0
  pin holds, it is a Reina candidate for `commons/` after G8.
- **Explicit zeroes:** no change to G3, G4, G8; no code changes in G9; no
  deletions in G9; no standalone silent-config-drop fix (dismissed, F2).
- **Rules honored:** no `p4 revert`; no P4 submit without approval; ASCII-only;
  one deliverable file, no scratch files; `missions.json` not mutated.
