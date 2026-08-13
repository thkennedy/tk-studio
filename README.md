# tk-studio

**An AI dev-studio layer over a pinned, unforked [BMad Method](https://github.com/bmad-code-org/BMAD-METHOD) base** — shipped as a Claude Code plugin from this repo's git marketplace.

tk-studio adds the discipline BMad leaves to the team: version-pinned installs that stay in lockstep across machines, a strict data taxonomy (every write lands in a classified home), a canonical planning layer with backend adapters (Backlog.md, Jira), role-aware orchestration, unattended job execution behind a published driver contract, and a self-measurement loop that turns the studio's own telemetry into reviewed fixes.

| | |
| --- | --- |
| Plugin release | **0.2.8** (marketplace catalog is the version gate) |
| Driver contract | **0.1.13** — [`plugins/tk-studio/contracts/driver-contract.md`](plugins/tk-studio/contracts/driver-contract.md) |
| BMad base pin | core **6.11.0** + 6 external modules — [`plugins/tk-studio/bmad.lock`](plugins/tk-studio/bmad.lock) |
| Platform | Windows-first (junctions, no admin); macOS/Linux via symlinks |
| Test state | 639 lib tests green; conformance suite covers all 17 surfaces |

---

## How this relates to BMad Method

tk-studio is built **on** BMad, never a fork of it (AD-1, the zero-fork line):

- The upstream base — [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) ([docs](https://docs.bmad-method.org), [`bmad-method` on npm](https://www.npmjs.com/package/bmad-method)) — is installed by running the **upstream installer at a committed pin**: `npx bmad-method@<pin> install …`, driven by [`bmad.lock`](plugins/tk-studio/bmad.lock). BMad code is never vendored, patched, or forked.
- Stock BMad skills (PRD, architecture, stories, dev-story, retros…) run **untouched**. The studio sequences around them — for example the planning adapter canonicalizes the artifacts they produce, without ever editing BMad itself.
- Base upgrades are a reviewed motion: `tk-studio-base-update` bumps the pin, reruns the upstream installer, and opens an integration PR so the upstream diff gets human review without owning a fork.

The pinned module set (external modules version independently of core):

| Module | Pin | Upstream |
| --- | --- | --- |
| `bmm` (BMad core method) | 6.11.0 | [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) |
| `bmb` (Builder) | v2.1.0 | [bmad-builder](https://github.com/bmad-code-org/bmad-builder) |
| `cis` (Creative Intelligence Suite) | v0.2.1 | [bmad-module-creative-intelligence-suite](https://github.com/bmad-code-org/bmad-module-creative-intelligence-suite) |
| `gds` (Game Dev Studio) | v0.6.0 | [bmad-module-game-dev-studio](https://github.com/bmad-code-org/bmad-module-game-dev-studio) |
| `tea` (Test Architecture Enterprise) | v1.22.0 | [bmad-method-test-architecture-enterprise](https://github.com/bmad-code-org/bmad-method-test-architecture-enterprise) |
| `wds` (Web Design Studio) | v0.4.3 | [bmad-method-wds-expansion](https://github.com/bmad-code-org/bmad-method-wds-expansion) |
| `bmad-loop` | v0.9.1 | [bmad-loop](https://github.com/bmad-code-org/bmad-loop) |

For what BMad itself does — agents, workflows, the method — start with the [BMad documentation](https://docs.bmad-method.org). This README covers only what the studio adds on top.

---

## Prerequisites

- **Claude Code** ≥ 2.1.223 (verified at 2.1.226) — CLI, desktop, or IDE
- **Node.js 20+** — `npx` runs the upstream BMad installer
- **[uv](https://docs.astral.sh/uv/)** — every studio script is stdlib-only Python 3.12+ run via `uv run` (uv fetches the interpreter if needed)
- **git**, plus access to this repository; the **[gh](https://cli.github.com/) CLI** authenticated (measurement pushes open PRs)
- Optional: **Obsidian** — the studio can maintain a vault window into each project's knowledge and planning folders

No admin rights are required on Windows; the store uses directory junctions.

## Quick start

### 1. Install the plugin

**Option A — clone this repo (recommended for the studio's own developers/testers):**

```bash
git clone https://github.com/thkennedy/tk-studio.git
```

Open the folder in Claude Code and **trust it**. The repo carries an `extraKnownMarketplaces` entry ([`.claude/settings.json`](.claude/settings.json)), so Claude Code auto-prompts to add the `tk-studio` marketplace and install the plugin. Accept both prompts and you're done.

**Option B — add the marketplace remotely (use the plugin anywhere, no clone):**

```bash
claude plugin marketplace add thkennedy/tk-studio
```

```bash
claude plugin install tk-studio@tk-studio
```

**Option C — air-gapped / git-less machines:** install from the SHA-256-pinned release asset. Full walkthrough: [kb/offline-install-runbook.md](kb/offline-install-runbook.md).

> **Updating later:** `claude plugin marketplace update tk-studio` refreshes the catalog, then `claude plugin update tk-studio@tk-studio --scope <user|project>` updates the install — the bare plugin name without the `@marketplace` suffix and explicit scope fails "not found" on current CLIs.

### 2. Verify with the drift check

In a Claude Code session:

> **"activate the studio"** (or `tk activate`, "studio status", "check for drift")

Activation cross-checks four planes — BMad base vs the `bmad.lock` pin, installed plugin vs the marketplace catalog, per-user store health, vault window — and reports loudly with exact fix commands. It is **read-only**: it names fixes, never applies them. On a fresh machine expect the store plane to guide you through standup.

### 3. Install the BMad base (per project)

In the project you want to work in:

> **"tk install"** (or "install the base")

This runs the upstream installer non-interactively at the committed pin and verifies the result (`verify-at-pin`). Deterministic, idempotent, zero forks.

### 4. Onboard your project

> **"onboard this project"** (or `tk onboard`, "set up the studio here")

Onboarding stands up the taxonomy — per-user store `~/.tk-studio/`, tracked project config `.tk-studio/config.yaml`, the project registry entry, `kb/` with its ranked index, the Obsidian vault window if configured — then **proposes** a role × project working set with evidence (detected project type, role defaults, your own user-authored resources) and records it **only on your explicit confirmation**. It never guesses.

### 5. Enter the studio

> **"enter the studio"** (or `tk studio`; "convene the council" adds the persona shell)

The orchestrator resolves who you are (role, from your store) and what this project needs (your role's confirmed working set) and offers routes by name — stock BMad skills included. `developer` gets execution framing (dev-story, code review, sprint status); `direction-giver` gets shaping/delegation/synthesis framing. Thin role agents (`tk-studio:developer`, `tk-studio:direction-giver`) enter with the role pre-fixed.

That's the loop: **activate → install → onboard → enter**, then work through BMad as usual with the studio keeping everything pinned, classified, and measured.

---

## Feature reference

All 17 studio surfaces, grouped by pillar. Every one runs attended **and** headless with identical behavior (AD-11); headless runs end with a JSON status block and never prompt. Say the trigger phrase in a Claude Code session to use one.

### Lockstep — pinned installs and drift

| Skill | Say | What it does |
| --- | --- | --- |
| `tk-studio-activate` | "activate the studio", "check for drift" | Four-plane health check (base, plugin, store, vault). Read-only, loud, fix-guided; emits its own measurement events. |
| `tk-studio-install` | "tk install" | Installs the BMad base at the `bmad.lock` pin — non-interactive, deterministic, verify-at-pin. |
| `tk-studio-base-update` | "base update", "adopt the new BMad release" | Adopts a new upstream release as one reviewable motion: bump the pin → rerun the upstream installer → open the integration PR. Its verify step auto-normalizes known upstream installer churn (list re-serialization, LF rewrites) so the diff you review is the real diff. |

> Known upstream behavior: through core 6.10.0 the quick-update ignored `--pin` and floated stable modules to the latest non-major tag (fixed in 6.11.0's installer, upstream #2680). A `verify-at-pin` failure right after an upstream release is still drift, not a studio bug — the fix is a pin-bump motion (see [issues/ledger.md](issues/ledger.md), ISS-003).

### Project setup and recommendation

| Skill | Say | What it does |
| --- | --- | --- |
| `tk-studio-detect` | "tk detect", "what's installed" | Read-only inventory of the full resource universe — installed BMad modules/skills, known-but-uninstalled official modules, and the project's own user-authored resources — plus evidence-scored project-type detection. Never guesses; ambiguity is surfaced as an ask. |
| `tk-studio-onboard` | "tk onboard", "onboard this project" | Taxonomy standup + propose/confirm/record of the role × project working set (see Quick start step 4). Idempotent; re-onboarding an unchanged setup is a no-op. |

### Orchestration and roles

| Skill | Say | What it does |
| --- | --- | --- |
| `tk-studio-orchestrator` | "enter the studio", "convene the council" | The stateless front door: resolve role → resolve working set → route by name. The council persona shell is optional presentation data (attended only); routing never lives in it. |

Roles ship as configuration: v1 has `developer` and `direction-giver` (thin agent wrappers included). Working sets are per-role maps in tracked config — one role's confirmation never overwrites another's.

### Planning

| Skill | Say | What it does |
| --- | --- | --- |
| `tk-studio-plan-sync` | "tk plan sync", "sync the plan" | The planning adapter (AD-4/AD-5): normalizes BMad-native planning artifacts into the canonical interchange shape (stable `EP-/ST-/TA-NNN` ids minted from the committed per-project counter — the adapter is the sole id authority) and syncs with the bound backend. Sync is one-way **promote** plus status-class **pull-back** with echo suppression; both-sides-changed is a human conflict, never silently resolved. Results name every file written, so commit staging derives from the response alone. |
| `tk-studio-migrate` | "tk migrate", "migrate planning to jira" | Designed migration of a project's planning binding (AD-16): closed inventory → export → transform → import → verification, copy-then-verify-then-flag cutover, source retained read-only until you explicitly clear it. |

Planning backends are per-project bindings: `bmad-files` (fallback), `backlog-md` (local kanban projection — see [kb/backlog-md-verified-behavior.md](kb/backlog-md-verified-behavior.md)), `jira` (via API tokens, not OAuth — headless-safe). Backends are projections; the canonical files in `_bmad-output/` are always authoritative.

### Knowledge and research

| Skill | Say | What it does |
| --- | --- | --- |
| `tk-studio-research` | "tk research", "run the ecosystem watch" | Chartered research pass: survey scoped topics, grade every finding by evidence, land findings in the run workspace, emit `observation` events for recommendation-worthy ones. |
| `tk-studio-knowledge` | "tk promote", "promote the corrections" | The knowledge promotion gate: drafts reconciled corrections from the routing queue into ordinary `kb/` files on a feature branch behind a PR. Review is the gate; nothing auto-applies. |

Project knowledge lives in `kb/` with an llms.txt-style ranked [index](kb/index.md) as the agent entry point.

### Sessions and unattended work

| Skill | Say | What it does |
| --- | --- | --- |
| `tk-studio-session` | "tk session", "hand off this run" | Session discipline as a surface: land a byte-budgeted boundary handoff (optionally carrying knowledge deltas) and end the session, or resume a fresh session from a run workspace alone. |
| `tk-studio-job` | "tk job", "submit a job" | Declarative jobs (id, target skill + payload, trigger `one-shot|cron|loop`, budget guards, stop conditions, model/effort) executed on the harness's own scheduling primitives, with a `resolve` verb serving fully-resolved definitions to external drivers. |

Any harness can drive the studio unattended through the [driver contract](plugins/tk-studio/contracts/driver-contract.md) — versioned, with JSON schemas for the status block, job model, interchange shape, event taxonomy, registry, and knowledge artifacts. The shipped [conformance suite](plugins/tk-studio/contracts/conformance/) proves every surface's headless behavior (including a spend-bearing opt-in pass through the real harness under denied permissions).

### Measurement and evolution

The studio measures itself and evolves through review, never silently (AD-12):

| Skill | Say | What it does |
| --- | --- | --- |
| `tk-studio-report` | "tk report", "that skill misbehaved" | One-verb human defect report → a `report` event in your local ledger. **This is the tester feedback verb — use it liberally.** |
| `tk-studio-observe` | "tk observe", "note this toil" | Records observed toil / retro signals / research findings as `observation` events. Observe-and-log only. |
| `tk-studio-measure-push` | "tk measure push", "push my measurements" | Moves your local ledger to the shared repo as a per-user-per-machine file under [`measurements/`](measurements/) via feature branch + PR — sanitization re-checked pre-commit; **review is the membrane**. Repeat pushes update the same PR. |
| `tk-studio-consolidate` | "tk consolidate" | Clusters merged defect-shaped events into [`issues/ledger.md`](issues/ledger.md) — stable `ISS-NNN` rows, severity, expected-vs-actual, named evidence, fix candidates. Rows update in place, never deleted. |
| `tk-studio-evolve` | "tk evolve", "draft proposals" | Clusters merged observations into [`proposals/ledger.md`](proposals/ledger.md) — stable `PROP-NNN` rows with the candidate change the observation itself stated. Documents only: adoption is always a human call. |

Every event is sanitized at emission (anything credential-shaped is stripped) and appends to `~/.tk-studio/measurements/<user>-<machine>.jsonl` — never a shared file, never on VCS until you push it through the membrane.

---

## Where data lands (the taxonomy)

Every write is classified before it lands (AD-3). A skill that cannot classify its write halts rather than guessing.

| Category | Home | Version control |
| --- | --- | --- |
| Working data (runs, scratch, measurements) | `~/.tk-studio/` per-user store | never |
| Project knowledge | `{project}/kb/` | the project's VCS |
| Planning data | wherever the project's planning binding says (canonical: `_bmad-output/`) | the project's VCS |
| Studio data (skills, contracts, ledgers) | this repo, delivered via the plugin | git, always |
| Credentials | user-store local config / OS credential store / environment | **never tracked, anywhere** |

## For testers

You have the whole loop available — the most valuable thing you can do is use the studio on a real project and let the measurement membrane carry what you hit:

1. Work normally (quick start above). When a skill does the wrong thing: **"tk report"**. When something is toilsome or surprising but not broken: **"tk observe"**.
2. Every so often: **"tk measure push"** — it opens a PR with your ledger; nothing lands without review.
3. Drift checks, install failures, and headless failures are recorded automatically — you don't need to do anything for those.

Consolidation and proposal drafting run repo-side and turn the merged corpus into `ISS-`/`PROP-` rows for triage. Your events become the studio's roadmap.

## Repository map

```text
tk-studio/
  .claude-plugin/marketplace.json    # catalog; plugins[].version = the update gate
  plugins/tk-studio/
    .claude-plugin/plugin.json       # plugin version (lockstep with the catalog)
    skills/tk-studio-*/              # the 17 studio surfaces
    agents/                          # thin role wrappers: developer, direction-giver
    lib/                             # deterministic cores (stdlib-only Python, uv run)
    contracts/                       # driver contract + schemas + conformance suite
    bmad.lock                        # the BMad base pin
  measurements/                      # teammate ledgers, arriving only via PR
  issues/ledger.md                   # ISS-NNN living defect ledger
  proposals/ledger.md                # PROP-NNN living proposals ledger
  kb/                                # this repo's own knowledge base (ranked index)
  tools/                             # maintainer tooling (release_archive.py)
  _bmad/ _bmad-output/               # working BMad install for developing tk-studio itself
```

## Development

Run the lib suite (639 tests):

```bash
cd plugins/tk-studio/lib && uv run python -m unittest discover tests
```

Run conformance (all 17 surfaces, direct headless drive):

```bash
cd plugins/tk-studio && uv run contracts/conformance/runner.py run
```

Add `--harness` for the spend-bearing pass through the real harness (opt-in). The release motion (version gate ×3 → plugin tag → pinned archive asset → record) and the offline install path are documented in [kb/offline-install-runbook.md](kb/offline-install-runbook.md) and [kb/claude-plugin-archive-install-envelope.md](kb/claude-plugin-archive-install-envelope.md). Windows contributors: read [kb/windows-console-and-powershell-gotchas.md](kb/windows-console-and-powershell-gotchas.md) before touching canonical files.

## Governing documents

- [Architecture spine](_bmad-output/planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md) — the 20 architecture decisions (AD-1…AD-20) every change honors
- [Driver contract](plugins/tk-studio/contracts/driver-contract.md) — the versioned surface any harness consumes
- [Issues ledger](issues/ledger.md) · [Proposals ledger](proposals/ledger.md) — the living measurement outputs
- [Product brief](_bmad-output/planning-artifacts/briefs/brief-tk-studio-2026-07-25/) — pillars, rulings, and the O1 distribution decision
- [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) · [BMad docs](https://docs.bmad-method.org) — the upstream method this studio builds on

## Reference material (local-only, not pushed)

`legacy-council/` holds a gitignored working copy of the pre-studio TK council marketplace repo used as tk-studio's design model. It keeps its own `.git/` for local reference and is never committed here.
