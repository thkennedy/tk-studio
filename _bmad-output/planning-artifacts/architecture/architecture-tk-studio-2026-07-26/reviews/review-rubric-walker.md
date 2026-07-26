---
title: "Architecture-Spine Review — Rubric Walker"
artifact: ../ARCHITECTURE-SPINE.md
reviewer: rubric-walker (architecture-spine checklist)
date: 2026-07-26
verdict: approve-with-revisions
---

# Rubric-Walker Review — ARCHITECTURE-SPINE.md (tk-studio)

Reviewed against the good-spine checklist: (1) fixes the real divergence points for the level below and misses none; (2) every AD Rule is enforceable and actually prevents its stated divergence; (3) nothing under Deferred lets two units one level down diverge; (4) named tech is verified-current and correctly used; (5) every dimension the altitude owns is decided, deferred, or an open question — whole-dimension silence is a finding, especially the operational/environmental envelope.

Grounding read: the spine, brief.md, addendum.md (A1–A8), o1-decision-2026-07-26.md. O1 (composite distribution) treated as binding and not challenged. `{project-root}` and `~/.tk-studio/` treated as intentional BMad path-variable conventions per review instructions.

**Verdict: approve with revisions.** The spine is structurally strong — paradigm, layering, taxonomy, config resolution, measurement, and migration are decided cleanly, the Deferred list is mostly well-bounded, and the named tech matches the verified state of the world. But two high-tier gaps would let units one level down diverge (the canonical-representation ambiguity under the *default* planning binding, and a wholly silent verification/conformance dimension), and the credential/secrets dimension is unclassified in a system whose #1 named failure mode is headless auth.

---

## Findings

### HIGH

**F1 — Canonical local representation is ambiguous under the default binding (`backlog-md`). Checklist items 1 and 2.**

Three statements are in tension:

- AD-4 (O2): stock BMad artifacts carrying the canonical frontmatter shape "ARE the canonical local representation."
- Structural seed: `_bmad-output/` is annotated "canonical local planning rep," while `backlog/` is "planning data when binding = backlog-md (Backlog.md-compatible)" — two in-repo planning representations coexist when the *default* binding is active.
- AD-5's Binds line scopes the promote/status-pull-back semantics to "the planning adapter, all **external** backends." Backlog.md is a *local* backend (port table: `backlog-md` (default)), so AD-5's sync direction and authority rules arguably do not bind it at all.

Consequences one level down: the planning-adapter epic and the planning-flow-sequencing epic can legitimately disagree on (a) which file set is truth when both exist, (b) whether AD-5's "content authored locally wins / status observed externally wins" applies to `backlog/`, and (c) what happens to *content* edits made in the Backlog.md kanban web UI — the very interface the brief cites as a reason Backlog.md was chosen. If status-only pull-back applies, kanban content edits are silently outranked; if it doesn't apply, the semantics are undefined. Either way, two units diverge.

Fix: one sentence in AD-5 extending (or explicitly excluding) the promote/pull-back semantics to local structured backends, and one sentence in AD-4 or the seed stating which representation is authoritative when binding = backlog-md and how the two directories relate (e.g. "backlog/ is a synced projection; _bmad-output artifacts remain canonical; content edits in backlog/ surface as conflicts").

**F2 — The verification/conformance dimension is silent. Checklist items 2 and 5 (whole-dimension silence).**

AD-11 is the spine's broadest invariant ("every studio skill runs attended and headless with identical behavior") and the brief makes it a success criterion (SC-6: headless parity verified against the reference runner). Addendum A6 splits the requirement three ways — preserve / extend / **verify** — and the verify leg has no home in the spine. No AD, convention, deferred item, or open question decides: whether a conformance suite exists, where it lives in the repo seed (no `tests/` or conformance path appears), what it covers (dual-mode parity, status-block schema validation, adapter round-trip per AD-16's "verification (counts, id map, content hashes, spot round-trip)"), or when it runs. The Deferred section's "conformance runs by direct headless invocation until [the connector] exists" names the *mechanism* but not the *owner or artifact*.

Without this, AD-11 is unenforceable in practice (nothing detects attended/headless divergence until a user hits it), and each epic (adapter, jobs, orchestrator) will invent its own verification story — a textbook divergence point. Fix: either a short AD ("conformance is a shipped artifact: parity + schema checks in `contracts/` or `tools/`, run at N") or an explicit Deferred/Open entry acknowledging the dimension with a bound.

**F3 — Secrets/credentials are an unclassified taxonomy category. Checklist items 1 and 5.**

AD-7 mandates API tokens (not OAuth) for headless Jira flows, and AD-11 makes auth preflight the first step of every headless run because "silent-401 is the known #1 failure." Yet AD-3's taxonomy (working / project knowledge / studio / planning) has no category for credentials, the per-user `config.yaml` field list omits them, and no rule says where an Atlassian API token, a `claude setup-token` credential, or any future backend secret lives or how it is referenced (env var, keyring, file in `~/.tk-studio/`). AD-15's "no absolute machine paths in tracked files" is the only adjacent guard — nothing prevents a tracked project config from growing a token field.

Divergence: the Jira-adapter epic, the jobs epic, and onboarding can each pick a different secret home and reference style. Given the system's own framing of headless auth as its top historical failure, this dimension deserves at least a one-line classification ("credentials are working data: env/keyring reference only, never a literal in any config file, tracked or local") or an explicit open question.

### MEDIUM

**F4 — Entity id allocation has no uniqueness rule. Checklist item 1.**

AD-6 and the naming conventions fix `EP-/ST-/TA-NNN` as "stable, never reused" but nothing decides *how NNN is allocated*. With planning files on project VCS and 2–10 teammates (brief's secondary audience), two developers on parallel branches will both mint `ST-042`. Merge produces duplicate ids — violating "stable, never reused" with no rule broken by either author. The adapter epic and the planning-skill epic need one shared answer (allocation scan + collision policy, per-user prefixes, or backend-assigned at promote). One sentence in AD-6 bounds it.

**F5 — The evolve loop "observes and logs" with no logging home. Checklist items 1 and 2.**

AD-8 confines the evolve loop to observe-and-log in v1, but AD-12's event taxonomy is a closed list (`install-outcome`, `drift-detection`, `activation-failure`, `headless-failure`, `onboarding-funnel`, `report`) with no observation/toil event and no stated extension rule. Two implementations can diverge: one invents new event types in the measurement ledger (violating the approved taxonomy), the other logs somewhere outside AD-12's governance entirely (violating AD-3's classify-before-write, or forcing a `blocked` halt). Fix: add an event type, state the taxonomy is extensible under a named rule, or point the evolve loop's log at an existing category.

**F6 — Operational/environmental envelope: platform support is undeclared. Checklist item 5.**

The spine's operational surface is otherwise better than most domain-focused drafts (jobs, budgets, run workspaces, headless error semantics, and the substrate caveat are all decided) — but the *platform* half of the envelope is silent. The vault-window convention specifies only "Windows directory junctions"; the store path is glossed as `%USERPROFILE%\.tk-studio\`; nothing states whether macOS/Linux teammates are supported in v1 and what the junction equivalent is (the addendum's "on Windows use junctions" implies other platforms exist; the spine dropped that frame). A1 lists cross-platform as an explicit wrapper requirement. Also minor: `uv` is load-bearing for studio scripts ("via `uv run`") but unversioned in the Stack table. One line declaring the v1 platform set (even "Windows-first; POSIX symlink equivalence deferred") closes this.

**F7 — AD-14's enforcement mechanism (`customize.toml`) is a BMad-layer construct applied to non-BMad resources. Checklist items 2 and 4 (tech fit).**

`customize.toml` is BMad's per-resource customize layer. tk-studio's own skills/agents are Claude Code plugin resources, which have no native customize.toml. The rule "every resource declares a conservative default Claude model + reasoning effort in its `customize.toml`" is directly enforceable for BMad resources but undefined for the `tk-studio-*` roster — the studio must either adopt the same file convention for its own resources (fine, but say so) or declare defaults elsewhere (frontmatter, plugin config). As written, two skill authors can comply differently. Not a misuse of BMad itself — a scope-of-mechanism gap.

### LOW

**F8 — AD-7's load-bearing assumption should carry a verify note.** The Rule couples "official Atlassian Remote MCP Server" with "headless MUST authenticate with API tokens." That is internally consistent only if the hosted remote MCP accepts API-token auth non-interactively (dps ISS-008 is cited for why OAuth fails, not for what the hosted server accepts). The stack facts are current (GA 2026-02-04 confirmed); the *combination* is the thing the adapter epic must verify before committing. One flag word ("verify token-auth path at adapter design") suffices.

**F9 — Rules reference `tk install` / `tk report` verbs whose surface form is deferred.** AD-12 and AD-13 name these verbs normatively while the Deferred section leaves the CLI-shim question open ("a machine with no plugin cannot run a plugin skill"). Acceptable if the verbs are understood as abstract (skill-or-CLI), but a parenthetical in AD-13 would prevent an epic from assuming a CLI exists.

**F10 — Per-project BMad module variance vs the single studio-wide `bmad.lock`.** AD-1/AD-15 make the lock (version + module registry + install flags) a studio-scope default; AD-17 makes working sets per role×project. Unstated: whether a project may install a different module set than the lock's registry, or whether working sets only *select from* the locked set. Probably the latter — one clause would remove the question from the Lockstep and Recommendation epics.

**F11 — No visible Open Questions tri-state.** The rubric expects every owned dimension to be decided, deferred, or *open*; the spine's one acknowledged open question (bootstrap script) is buried inside a Deferred bullet. Format nit — splitting an "Open" subsection out of Deferred would make the tri-state auditable.

**F12 — Plugin release governance is thinner than measurement governance.** `marketplace.json plugins[].version` is named "the update gate" and lockstep with `plugin.json` is required, but who bumps it, under what review, and with what versioning scheme is unstated — while measurement PRs get a full membrane. Fold into the deployment half of the envelope; a single convention row covers it.

---

## Checklist Walk (explicit pass/fail)

| Checklist item | Result |
| --- | --- |
| Fixes real divergence points below, misses none | **Partial.** Strong coverage of distribution, taxonomy, sync direction, interchange shape, config resolution, jobs, measurement, migration, roles. Missed: canonical-rep authority under default binding (F1), id allocation (F4), evolve-loop log home (F5), secrets home (F3). |
| Every Rule enforceable, prevents its divergence | **Mostly.** AD-1, AD-2, AD-3, AD-5, AD-6, AD-12, AD-13, AD-15, AD-16, AD-18 are crisp and checkable. AD-11 lacks its verification mechanism (F2); AD-14's mechanism is undefined for studio-native resources (F7). |
| Deferred cannot cause divergence below | **Mostly pass.** Deferred items are well-bounded by contracts/seams (connector by AD-11, roles by AD-17, Linear/Confluence by AD-6/7, skill names by the naming convention, lock format by AD-1's semantic content). Exception: evolve-loop "observes and logs" defers automation but not the log's home (F5). |
| Named tech verified-current, correctly used | **Pass with one flag.** BMad 6.10.0, Backlog.md 1.48.0, Atlassian Remote MCP GA 2026-02-04, marketplace `extraKnownMarketplaces` mechanics — all match verified facts and are used consistently with them (Backlog.md's missing epic entity is correctly bridged in AD-6). Flag: AD-7's token-auth-over-hosted-MCP combination needs a verify note (F8); `customize.toml` scope gap (F7); `uv` unversioned (F6). |
| Every owned dimension decided/deferred/open | **Fail on two dimensions.** Verification/conformance wholly silent (F2); secrets/credentials unclassified (F3). Platform half of the environmental envelope undeclared (F6). The operations half of the envelope — often the skipped one — is genuinely well covered (AD-10, AD-11, AD-12, run workspaces, budget guards, substrate caveat); credit where due. |

## What the spine gets right (worth preserving through revision)

- The port/binding table up front is exactly the right altitude artifact: every variable dependency named, bound, and given v1 adapters.
- AD-5's one-way promote + status pull-back correctly encodes the research finding instead of hand-waving "sync."
- AD-12 riding plain git governance (PR membrane) instead of new infrastructure is the O1 ruling faithfully translated, including the ISS-NNN ledger discipline.
- AD-16 porting the dps migration safety rules verbatim (closed inventory, no-delete-before-clearance, copy-verify-flag) is the strongest single AD in the document.
- The Capability → Architecture map gives the epic-decomposition step a ready-made traceability skeleton.

## Recommended disposition

Resolve F1–F3 with targeted edits (each is one to three sentences) before epic decomposition; fold F4–F7 into the same editing pass or explicitly log them as open questions; F8–F12 are notes for the module-builder step. No structural rework needed.
