# tk-studio

**An AI dev-studio layer over a pinned, unforked [BMad Method](https://github.com/bmad-code-org/BMAD-METHOD) base** — shipped as a Claude Code plugin that the `tk-studio` installer writes into your skills folder.

tk-studio adds the discipline BMad leaves to the team: version-pinned installs that stay in lockstep across machines, a strict data taxonomy (every write lands in a classified home), a canonical planning layer with backend adapters (Backlog.md, Jira), role-aware orchestration, unattended job execution behind a published driver contract, and a self-measurement loop that turns the studio's own telemetry into reviewed fixes.

| | |
| --- | --- |
| Plugin release | **0.3.2** (the installer roster, [`tools/installer/rosters/`](tools/installer/rosters/), is the version gate) |
| Driver contract | **0.1.13** — [`plugins/tk-studio/contracts/driver-contract.md`](plugins/tk-studio/contracts/driver-contract.md) |
| BMad base pin | core **6.11.0** + 6 external modules — [`plugins/tk-studio/bmad.lock`](plugins/tk-studio/bmad.lock) |
| Platform | Windows-first (junctions, no admin); macOS/Linux via symlinks |
| Test state | 691 lib tests green; conformance suite covers all 18 surfaces |

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
- **git**; the **[gh](https://cli.github.com/) CLI** authenticated (measurement pushes open PRs)
- Optional: **Obsidian** — the studio can maintain a vault window into each project's knowledge and planning folders

No admin rights are required on Windows; the store uses directory junctions.

## Quick start

### Bootstrap (one command)

One script installs the pinned `uv` and the small self-updating `tk-studio` meta-CLI, puts only the studio's `bin` folder on your PATH and turns on long paths for git. It never clones anything; re-running it is the update. The meta-CLI then installs and updates the apps the roster ships (`tk-studio install`, `tk-studio update`, `tk-studio status`).

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/thkennedy/tk-studio/main/tools/installer/install.ps1 | iex
```

Linux / macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/thkennedy/tk-studio/main/tools/installer/install.sh | sh
```

Published SHA-256 of each script:

| Script | SHA-256 |
|---|---|
| `tools/installer/install.ps1` | `a386d79989b55e87616714064f2ede8dc7c6044d6beefaf5ce2d5e3a55073140` |
| `tools/installer/install.sh` | `f3bb442100401316e874d9b2c3fddf5f9670a258af575f57bad13ef4c81d672c` |

To verify before running, download, check, then run:

```powershell
irm https://raw.githubusercontent.com/thkennedy/tk-studio/main/tools/installer/install.ps1 -OutFile install.ps1
(Get-FileHash -Algorithm SHA256 install.ps1).Hash   # must equal the install.ps1 row above
powershell -ExecutionPolicy Bypass -File .\install.ps1   # Windows PowerShell 5.1 (stock); pwsh works too
```

```bash
curl -fsSLO https://raw.githubusercontent.com/thkennedy/tk-studio/main/tools/installer/install.sh
echo "f3bb442100401316e874d9b2c3fddf5f9670a258af575f57bad13ef4c81d672c  install.sh" | sha256sum -c -        # Linux
echo "f3bb442100401316e874d9b2c3fddf5f9670a258af575f57bad13ef4c81d672c  install.sh" | shasum -a 256 -c -    # macOS (no sha256sum)
sh install.sh
```

Both take a channel (default `stable`) and a roster override. With the one-liners, pass them through the environment, since `iex` takes no arguments:

```powershell
$env:TK_STUDIO_CHANNEL = 'latest'; $env:TK_STUDIO_ROSTER = '<path or https URL>'
irm https://raw.githubusercontent.com/thkennedy/tk-studio/main/tools/installer/install.ps1 | iex
```

```bash
curl -fsSL https://raw.githubusercontent.com/thkennedy/tk-studio/main/tools/installer/install.sh | TK_STUDIO_CHANNEL=latest sh
# or: ... | sh -s -- --channel latest --roster <path or https URL>
```

A downloaded script also takes `-Channel` / `-Roster` (`powershell -ExecutionPolicy Bypass -File .\install.ps1 -Channel latest`) or `--channel` / `--roster`. Through `iex` a refusal throws `<Name>: <detail>` and leaves the window open; run as a file it exits 1. Until the first `cli--v` release is recorded in the roster, the bootstrap stops with `CliNotShipped`.

### 1. Install the plugin

With the meta-CLI on your PATH (bootstrap above), one command installs the plugin and the apps the roster ships:

```bash
tk-studio install
```

Until the first `cli--v` release is recorded in the roster, the bootstrap stops with `CliNotShipped`; meanwhile run the meta-CLI from a checkout, as shown under "Developers who clone" below (`uv run --project tools/installer/cli tk-studio install`).

The plugin lands at `~/.claude/skills/tk-studio/` (`$CLAUDE_CONFIG_DIR/skills/tk-studio/` when that is set), written from the roster's SHA-256-verified release zip. Claude Code loads it in place as `tk-studio@skills-dir`, with no marketplace and no `claude plugin install`. The install also removes any user-scope marketplace copy of `tk-studio`, because a same-named marketplace copy shadows the skills-dir folder.

> **Updating later:** `tk-studio update` brings every component to the channel roster's version; `tk-studio status` shows installed vs roster. Engine sandboxes do not see the host folder live: after `tk-studio install` or `update` on the host, run `sbx skills import --force` so the sandboxes' shared skills store gets the new copy ([kb/agent-pc-setup-runbook.md](kb/agent-pc-setup-runbook.md) §3.5).

> **Deprecation watch (skills-dir plugins):** this delivery rests on Claude Code loading a plugin folder from the skills directory. Where to look for a change: [code.claude.com/docs/en/plugins/create](https://code.claude.com/docs/en/plugins/create) ("Develop without a marketplace"), [code.claude.com/docs/en/plugins/loading](https://code.claude.com/docs/en/plugins/loading) (the name-conflict order), and the Claude Code CHANGELOG (grep `skills-dir`). Status: none found as of 2026-10-15.

**Moving from the marketplace install:** `tk-studio install` uninstalls only user-scope marketplace copies; a project- or local-scope copy (the old `claude plugin install tk-studio@tk-studio --scope project`) is only reported, and it shadows the skills-dir folder. From that project's checkout run `claude plugin uninstall tk-studio@tk-studio --scope project` (`--scope local` for a local-scope copy), then `tk-studio install`, then `sbx skills import --force` for engine sandboxes. `claude plugin list` should then show `tk-studio@skills-dir` and no `tk-studio@tk-studio`; check it there, because "tk activate" sees only user-scope marketplace copies, not project- or local-scope ones. If "tk activate" still reports the plugin plane `shadowed`, run the fix it prints.

**Air-gapped / offline machines:** the skills-dir write from a downloaded release zip is in [kb/offline-install-runbook.md](kb/offline-install-runbook.md).

**Developers who clone** this repo to work on the studio itself:

```bash
git clone https://github.com/thkennedy/tk-studio.git
tk-studio install --link <path-to-checkout>
```

Until the first `cli--v` release is recorded in the roster the bootstrap stops with `CliNotShipped`, so from a checkout run the meta-CLI as `uv run --project tools/installer/cli tk-studio install --link <path-to-checkout>`. `--link` points `~/.claude/skills/tk-studio` at `<checkout>/plugins/tk-studio` (a junction on Windows, a symlink elsewhere), so your edits load in the next session. Then run `sbx skills import --force` for engine sandboxes: their store is a copy, also of a linked folder. It links the plugin only; it installs no other app. A later plain `tk-studio install` or `update` replaces the link with the release zip's folder; re-run `install --link <checkout>` (then `sbx skills import --force`) to get it back. The repo's `.claude-plugin/marketplace.json` remains as a developer catalog, for browsing it or pinning a tag in a dev checkout:

```bash
claude plugin marketplace add thkennedy/tk-studio#tk-studio--v<X.Y.Z>
```

Every `tk-studio install` or `update` runs `claude plugin marketplace remove tk-studio`, so this catalog is gone after the next install or update; re-add it afterwards if you want it. Never install `tk-studio@tk-studio` from it alongside the folder: a marketplace copy named `tk-studio` shadows the skills-dir folder, so use `install --link` instead.

### 2. Verify with the drift check

In a Claude Code session:

> **"activate the studio"** (or `tk activate`, "studio status", "check for drift")

Activation cross-checks four planes — BMad base vs the `bmad.lock` pin, the skills-dir plugin folder vs the channel's roster, per-user store health, vault window — and reports loudly with exact fix commands. It is **read-only**: it names fixes, never applies them. On a fresh machine expect the store plane to guide you through standup.

Outside a session, `tk-studio doctor` reports the plugin folder's mode (written or linked) and runs the installer's smoke checks, one line each with its fix. It is read-only too.

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

All 18 studio surfaces, grouped by pillar. Every one runs attended **and** headless with identical behavior (AD-11); headless runs end with a JSON status block and never prompt. Say the trigger phrase in a Claude Code session to use one.

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
| `tk-studio-launch` | "tk launch", "launch epic N", "run status" | The studio's one way to start the execution substrate (bmad-loop) for a project epic: route the epic's first story per leg, distill the epic SPEC and bootstrap the first story's tasks at the planner tier, then start the engine detached with a pre-minted run id. Ships as the `run-epic` job type. |

**Execution-pipeline routing.** Every leg of a bmad-loop run — the monitor session, its implementer / reviewer / consult subagents, the pre-dispatch seam check, the review and triage stages, the conditional supervisor pass — carries a measured model/effort default (pipeline v2: a mid-tier session that never decides, mid-tier builders and refuters, the top execution tier consulted on objective triggers only). The numbers are in [kb/execution-pipeline-model-routing.md](kb/execution-pipeline-model-routing.md); a project overrides per story in `.bmad-loop/routing.toml`, a driver per invocation with `--set`, and `lib/pipeline.py` writes the result where the engine reads it (AD-14).

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
  .claude-plugin/marketplace.json    # developer catalog (pin to a tag); tools/installer/rosters/ is the gate
  plugins/tk-studio/
    .claude-plugin/plugin.json       # plugin version (gate ×4: roster, released-roster.json, plugin.json, catalog)
    skills/tk-studio-*/              # the 18 studio surfaces
    agents/                          # thin role wrappers: developer, direction-giver
    lib/                             # deterministic cores (stdlib-only Python, uv run)
    contracts/                       # driver contract + schemas + conformance suite
    bmad.lock                        # the BMad base pin
  apps/supervisor/                   # the studio supervisor (Bun/TS; `bun test` from here), a nested
                                     #   studio project (AD-21): own _bmad/ _bmad-output/ .tk-studio/
                                     #   .bmad-loop/ .claude/; released as supervisor--vX.Y.Z
  measurements/                      # teammate ledgers, arriving only via PR
  issues/ledger.md                   # ISS-NNN living defect ledger
  proposals/ledger.md                # PROP-NNN living proposals ledger
  kb/                                # this repo's own knowledge base (ranked index)
  tools/                             # maintainer tooling (release_archive.py)
  _bmad/ _bmad-output/               # working BMad install for developing tk-studio itself
```

## Development

Run the lib suite (691 tests):

```bash
cd plugins/tk-studio/lib && uv run python -m unittest discover tests
```

Run conformance (all 18 surfaces, direct headless drive):

```bash
cd plugins/tk-studio && uv run contracts/conformance/runner.py run
```

Add `--harness` for the spend-bearing pass through the real harness (opt-in). The release motion (version gate ×3 bump → plugin tag → pinned archive asset → record, which brings the roster into the gate ×4 lockstep) and the offline install path are documented in [kb/offline-install-runbook.md](kb/offline-install-runbook.md); [kb/claude-plugin-archive-install-envelope.md](kb/claude-plugin-archive-install-envelope.md) is the historical marketplace-era record. Windows contributors: read [kb/windows-console-and-powershell-gotchas.md](kb/windows-console-and-powershell-gotchas.md) before touching canonical files.

## Governing documents

- [Architecture spine](_bmad-output/planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md) — the 20 architecture decisions (AD-1…AD-20) every change honors
- [Driver contract](plugins/tk-studio/contracts/driver-contract.md) — the versioned surface any harness consumes
- [Issues ledger](issues/ledger.md) · [Proposals ledger](proposals/ledger.md) — the living measurement outputs
- [Product brief](_bmad-output/planning-artifacts/briefs/brief-tk-studio-2026-07-25/) — pillars, rulings, and the O1 distribution decision
- [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) · [BMad docs](https://docs.bmad-method.org) — the upstream method this studio builds on

## License

[MIT](LICENSE). The vendored BMad base under `_bmad/` and `.claude/skills/` keeps its upstream license.

