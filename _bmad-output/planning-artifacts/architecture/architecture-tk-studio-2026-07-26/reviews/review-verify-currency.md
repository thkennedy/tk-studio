# Review — Verification & Currency of Committed Decisions

- **Target:** `ARCHITECTURE-SPINE.md` (architecture-tk-studio-2026-07-26)
- **Lens:** every committed decision web-researched or reality-checked, not asserted from training data
- **Reviewer pass date:** 2026-07-26
- **Evidence used:** run memlog (web-verification entry, 2026-07-26), installed BMad at `D:\Code\tk-studio\_bmad\_config\manifest.yaml`, fresh WebSearch spot-checks (npm bmad-method, MrLesk/Backlog.md, Atlassian MCP docs/community)

## Verdict

**PASS with minor findings.** The spine's named-technology claims trace cleanly to a same-day web-verification pass recorded in the memlog, and my independent spot-checks confirm the load-bearing ones. The gaps are small: one acknowledged assumption was dropped between memlog and spine, one product name has drifted upstream, one operational precondition is unstated, and two minor stack rows ride on training data rather than verification.

## What was confirmed current (traced + spot-checked)

| Claim in spine | Evidence | Status |
| --- | --- | --- |
| BMad Method 6.10.0 (AD-1, Stack) | Installed in repo: `_bmad/_config/manifest.yaml` shows `version: 6.10.0` (core + bmm), installed 2026-07-26. npm spot-check: latest `bmad-method` is 6.10.0, published ~20 days ago. Memlog also records non-interactive install flags "verified working this session". | Verified, current |
| Backlog.md 1.48.0 (Stack, AD-6) | Memlog verification entry; spot-check of MrLesk/Backlog.md releases confirms v1.48.0 is the current release line. | Verified, current |
| Backlog.md has no native epic entity; epic → milestone + label (AD-6) | Memlog confirms "still no epic entity, plain .md storage". Spot-check confirms milestones exist as first-class CLI commands (`backlog milestone add/rename/remove`), so the mapping target is real, not invented. | Verified |
| Atlassian Remote MCP Server: hosted, Cloud-only, OAuth 2.1 or API tokens; API tokens for headless (AD-7) | Memlog verification entry; spot-check confirms official `atlassian/atlassian-mcp-server` supports OAuth 2.1 or API tokens, with API token auth explicitly positioned for headless/CI/non-interactive use. The dps ISS-008 grounding (MCP OAuth cannot complete non-interactively) matches Atlassian's own guidance. | Verified |
| Claude Code plugin marketplace mechanics: `extraKnownMarketplaces` auto-prompt on folder trust, `plugins[].version` as update gate, sha pin on sources (AD-1, AD-13, Structural Seed) | Memlog records verification against code.claude.com docs, 2026-07. Consistent with current mechanics. | Verified |
| Harness scheduling: local scheduled tasks session-scoped; durable jobs need cloud routines / external harness (AD-10) | Memlog verification entry explicitly captured this caveat, and the spine honors it verbatim ("Substrate caveat honored in design"). This is exactly the kind of reality-check the lens asks for. | Verified |
| Obsidian Windows directory junctions, no admin required, officially cautioned (Consistency Conventions) | Memlog verification entry (Sync/file-watch edge cases noted); spine carries the "vault is a view" mitigation. | Verified |
| Linear: no native epic → Project mapping (AD-6, Deferred) | Memlog records Linear MCP live r/w check and the epic→Project mapping. Deferred to post-Jira anyway. | Verified, low exposure |

## Findings

### F1 — Medium: Backlog.md superset-frontmatter assumption dropped between memlog and spine

The memlog explicitly flags: "ASSUMPTION: Backlog.md tolerates superset frontmatter keys (unknown keys preserved) — verify before binding backlog-md adapter implementation; if false, adapter keeps canonical sidecar mapping instead." This is load-bearing for AD-6: the canonical interchange shape (`shape_version`, `external.<binding>`, `depends_on[]`, etc.) living directly in Backlog.md-compatible files only works if Backlog.md round-trips unknown keys without stripping them. The spine's AD-6, the Structural Seed (`backlog/` described as "Backlog.md-compatible"), and the Deferred list all omit this caveat and its designed fallback (sidecar mapping). A reader of the spine alone would treat superset tolerance as settled fact. **Fix:** carry the assumption + fallback into the spine, either as a caveat line in AD-6 or an entry in Deferred.

### F2 — Low: upstream product rename not reflected — "Atlassian Remote MCP Server" is now branded "Atlassian Rovo MCP Server"

Atlassian's current support docs and community announcements consistently use "Atlassian Rovo MCP Server" (the GitHub repo remains `atlassian/atlassian-mcp-server`). The spine and Stack table use the older "Atlassian Remote MCP Server" name throughout (AD-7, Stack). Functionally identical product, so no architectural impact, but the name will read stale to anyone cross-checking against Atlassian docs. **Fix:** note the current branding once, e.g. "Atlassian Remote MCP Server (now branded Rovo MCP Server)".

### F3 — Low: AD-7's API-token mandate has an unstated admin precondition

API token authentication on the Rovo MCP Server must be **enabled by an organization admin** (Atlassian Administration → Rovo → MCP server → Authentication) and comes in two flavors (personal API token with scopes, or admin-managed service-account API key). AD-7 mandates "Headless flows MUST authenticate with API tokens" but doesn't record that this is an org-level toggle that may be off by default in a target Jira org — a plausible silent-401 source, which AD-11 separately names as the #1 headless failure. **Fix:** add the admin-enablement precondition (and the service-account option) to AD-7 or to the auth-preflight description in AD-11.

### F4 — Low: two Stack rows asserted from training data, not the verification pass

The memlog's verification entry covers BMad, Backlog.md, Atlassian MCP, plugin marketplace, harness scheduling, Obsidian junctions, and Linear — but not:

- **Python 3.12+ via `uv run`** (Stack). Safe as a floor (3.12 is supported well past 2026, `uv` is established), but it is the only Stack row with no verification trail. Risk is negligible; noting for completeness of the discipline the project itself established.
- **Jira entity mapping epic→Epic, story→Story, task→Sub-task** (AD-6). Plausible for company-managed Jira Software projects, but issue-type hierarchies vary by project type (team-managed vs company-managed; Sub-task availability and Story presence are configurable). This was not part of the verification pass. Exposure is deferred (Jira ships only after local backends stabilize, AD-7), and AD-6's nearest-canonical-value escape hatch limits damage. **Fix:** tag the Jira mapping as "default mapping, confirm against target org's issue-type scheme at adapter build time".

### F5 — Info: exact GA date "2026-02-04" traces to memlog only

The Stack table's "GA 2026-02-04" for the Atlassian MCP server matches the memlog's pinned-versions entry (memlog body text says "GA 2026-02"; the version line carries the full date). I could not independently re-confirm the day-level date in spot-checks, only the GA-and-generally-available status. No action needed; the day-level precision is cosmetic.

## Non-findings (checked and fine)

- **`bmad.lock` + `npx bmad-method@<pin> install` non-interactive** — flags verified live this session per memlog; installer exists at the pinned version on npm.
- **Backlog.md milestone mapping target** — milestones are real first-class Backlog.md entities (CLI-managed), so AD-6's epic→milestone+label mapping is grounded, not guessed.
- **"beads" deferred note** — sourced from the 2026-07-25 planning-backend research doc, and correctly parked with a concrete revisit trigger rather than adopted.
- **Perforce "task stream" analogy (AD-18)** — training-data terminology, but v1 is conventions-only for Perforce, and task streams are a stable decade-old Perforce concept; no currency risk.
- **dps-sourced rules (ISS-008, migration safety, issues-ledger format)** — internal precedent, correctly cited as such rather than dressed up as external fact.

## Sources

- https://www.npmjs.com/package/bmad-method
- https://github.com/bmad-code-org/BMAD-METHOD/releases
- https://github.com/MrLesk/Backlog.md
- https://github.com/MrLesk/Backlog.md/releases
- https://github.com/atlassian/atlassian-mcp-server
- https://support.atlassian.com/atlassian-rovo-mcp-server/docs/authentication-and-authorization/
- https://support.atlassian.com/atlassian-rovo-mcp-server/docs/configuring-authentication-via-api-token/
- https://community.atlassian.com/forums/Atlassian-Remote-MCP-Server/Announcing-authentication-via-API-token-for-Atlassian-Rovo-MCP/ba-p/3197014
