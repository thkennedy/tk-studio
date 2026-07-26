# Planning-Data Backend Research — tk-studio (tk-council)

**Date:** 2026-07-25
**Purpose:** Inform the brief's planning-data subsystem decision: (a) default LOCAL task-tracking + knowledge-base backend (file-based/in-repo, BMad-shaped), (b) clean later migration to Atlassian Cloud (team standard) and/or Linear, with every skill going through an adapter over a canonical epic/story/task interchange shape.
**Method:** Web research, July 2026 state. Primary sources (GitHub repos, official docs) preferred. Star counts / versions are as reported by sources on the fetch date; items I could not verify directly are flagged.

---

## 1. Agentic-first / local-first task tracking

### 1.1 Backlog.md — files-in-repo, agent-native ⭐ top candidate

- **Repo:** https://github.com/MrLesk/Backlog.md
- **Storage model:** Plain `.md` files in a `backlog/` (or `.backlog/`, configurable) folder in the repo; YAML frontmatter + markdown body; configurable ID prefixes (`TASK-1` style). 100% git-native — branches/merges/reviews apply to tasks.
- **CLI:** `backlog init / task create|edit|list|view / board / browser / search / milestone`. Terminal Kanban (`backlog board`), local web UI with drag-and-drop (`backlog browser`), fuzzy search, `board export` → shareable markdown reports, `--json` output on commands.
- **MCP:** Yes — `backlog mcp start`; documented connectors for Claude Code, Codex, Gemini CLI, Kiro, Cursor.
- **License / maturity:** MIT. ~6.3k stars, 374 forks, ~1,056 commits, actively maintained (July 2026). TypeScript/Bun. Notably, most of its own code is written by AI agents using Backlog.md itself.
- **Epic/story/task mapping:** Tasks + **milestones** + **dependencies** + acceptance-criteria/Definition-of-Done checklists. No first-class "epic" entity — milestones are the closest container. Subtasks not documented as first-class. So mapping is *epic→milestone, story→task, task→checklist item or dependent task* — workable but one level flatter than the canonical shape.
- **External sync:** None built in (no Jira/Linear/GitHub sync documented).

### 1.2 beads (Steve Yegge) — graph issue DB for agents

- **Repo:** https://github.com/steveyegge/beads · README: https://github.com/steveyegge/beads/blob/main/README.md
- **Storage model:** **Changed over its life — important.** Originally SQLite + JSONL export. As of July 2026 the engine is **Dolt** (version-controlled SQL DB with cell-level merge): embedded mode stores data in `.beads/embeddeddolt/` (binary, not human-diffable in git), optional server mode against `dolt sql-server` for concurrent writers. `.beads/issues.jsonl` remains as an **interchange export**, explicitly "not the source of truth." A community Rust port pinned to the older SQLite+JSONL model exists (https://github.com/Dicklesworthstone/beads_rust).
- **CLI / MCP:** Single Go binary `bd`, installed system-wide; npm `@beads/bd`; PyPI `beads-mcp` (MCP server). Integrations documented for Claude Code, Codex CLI, Cursor, Factory.ai.
- **License / maturity:** MIT. ~25.7k stars, 1.7k forks, ~10k commits, very active; but the storage-engine pivot (SQLite→Dolt) within ~9 months signals a fast-moving, still-settling design.
- **Epic/story/task mapping:** Strongest data model of the local tools: epics with child issues, hierarchical sub-tasks (`bd-a3f8.1`, `bd-a3f8.1.1`), priorities, and typed dependency links (README lists `relates-to`, `duplicates`, `supersedes`, `replies-to`; Yegge's writing also describes blocking + provenance/"discovered-from" links — exact current link taxonomy **not fully verified**, check `bd dep --help`). Built as agent memory: "ready work" queries, blocker awareness.
- **External sync:** No Jira/Linear/GitHub bridge documented in the README I reviewed. **Flag:** unverified whether community bridges exist.

### 1.3 claude-task-master (Task Master)

- **Repo:** https://github.com/eyaltoledano/claude-task-master
- **Storage model:** `.taskmaster/` directory in repo — `tasks.json` (JSON task DB), `docs/prd.txt`, config files. File-based and in-repo, but JSON-centric rather than markdown-per-task.
- **CLI / MCP:** Both. `npm i -g task-master-ai`; `task-master init / parse-prd / list / research / ...`. MCP configs documented for Cursor, Windsurf, VS Code, Q Developer.
- **License / maturity:** **MIT + Commons Clause** (no reselling/hosting it as a service). ~27.9k stars, 2.6k forks, 72 contributors, 90+ releases; crossed 25k stars Jan 2026.
- **Epic/story/task mapping:** Tasks/subtasks with dependencies, complexity scores, tags/workstreams, status. Its signature move is PRD→task decomposition via LLM (requires provider API keys). No first-class epic; tags approximate workstreams.
- **External sync:** None documented (no Jira/Linear/GitHub export).
- **Fit note:** It overlaps BMad's own planning role (PRD→stories) more than it complements it; as a *backend* it's a JSON store with an opinionated AI pipeline attached.

### 1.4 GitHub Issues/Projects via official MCP

- **Repo:** https://github.com/github/github-mcp-server (official; active releases through June 2026 — compact project-item payloads, `search_commits` added).
- **Storage model:** Server-side (GitHub Cloud) — *not* local-first, but repo-adjacent and free. GitHub now has issue types + sub-issues + Projects v2 fields, so epic→story→task maps as issue-type "Epic" → sub-issues, or Project grouping.
- **MCP/CLI:** First-class official MCP server; `gh` CLI. Known friction reported in 2026: verbose tool prompts, token-scope limitations for private repos (github-mcp-server issue #1683).
- **License / maturity:** MIT (server code); the backend is proprietary SaaS. Extremely mature.
- **Fit note:** Reasonable "online default" but the team's target is Atlassian/Linear, and it fails the local/offline requirement.

### 1.5 Server-based open-source Jira-likes

| Tool | Storage | MCP | License | Status July 2026 | Verdict for tk-studio |
|---|---|---|---|---|---|
| **Plane** (https://plane.so, https://developers.plane.so) | Server (Docker/K8s, Postgres) | **Native MCP server**, REST API, webhooks, OAuth apps; AI/BYOK on self-hosted | AGPL-3.0 (Community Edition, no user limits) | Very active; positions itself "AI-native"; work items + sub-issues, cycles, modules, pages (built-in wiki) | Best *self-hosted server* option if a Jira-like UI is ever wanted locally; overkill as v1 default (runs a whole stack) |
| **OpenProject** (https://www.openproject.org) | Server (Rails + Postgres) | No official MCP found (community only — **unverified**) ; APIv3 | GPLv3 | Active, EU company; building an official **Jira Migrator** (announced Mar 2026) | Solid but heavyweight, not agent-first |
| **Focalboard** (https://github.com/mattermost-community/focalboard) | Server/app, SQLite | — | Apache/MIT mix | **README states repo is not maintained** | Ruled out |
| **Taiga** (https://taiga.io) | Server (Django) | — | AGPL | Ownership churn (Kaleidos→TCS; rewrite forked as "Tenzu" by BIRU); maintenance-mode pace | Ruled out |
| **Huly** (https://huly.io) | Server, all-in-one (issues+docs+chat) | AI agents advertised; two-way GitHub issue sync | EPL-2.0 | Active | Interesting all-in-one, but a platform commitment, not a file backend |

### 1.6 Adjacent: spec-workflow markdown systems (not trackers, but shape the convention)

- **GitHub Spec Kit** (https://github.com/github/spec-kit) — MIT; sources report 90k–111k stars (**conflicting counts — flag**); Specify→Plan→Tasks→Implement, all plain markdown in-repo (`tasks.md` dependency-ordered, parallel-execution markers); agent-agnostic (30+ agents, v0.11.0 June 2026). Validates that *markdown-in-repo as the task source of truth* is now the mainstream agent convention — the same family as BMad's epics/stories/sprint-status.
- **git-bug** (https://github.com/git-bug/git-bug) — issues stored as native git objects, offline-first, CLI/TUI/web, bridges to GitHub/GitLab. Active in 2026. Not agent-first, no official MCP found (**unverified**), and git-object storage is opaque to a text-reading agent. Noted for completeness.

---

## 2. Agentic-first / local-first knowledge bases

### 2.1 Plain markdown docs-in-repo (BMad-style) + index conventions

- The de-facto agent-native KB in 2026: `docs/` markdown + an index file the agent reads first. BMad already ships this (`bmad-document-project`, `bmad-index-docs`, `project-context.md`), and Spec Kit / AGENTS.md / CLAUDE.md conventions all converge on it.
- **llms.txt** (https://llmstxt.org convention): root markdown file linking key content with one-line descriptions. Still a community proposal, no IETF/W3C standard; ~10% adoption across 300k domains (SE Ranking study), but *default* on Mintlify/GitBook/Fern-hosted docs and standard among AI-native companies (Anthropic, Cursor, Vercel). For tk-studio the takeaway is the *pattern*: a curated, ranked index file as the agent's entry point — exactly the "thin index" idea.
- Promotion/curation workflows: **no off-the-shelf agent-native tool found** that implements a curated "promote note→canonical doc" workflow. This is currently done by convention (draft folder → reviewed docs/ + index update), i.e., something a tk-studio skill would own. **Flag: absence claim — searched, found nothing dedicated.**

### 2.2 Obsidian (+ MCP)

- Local markdown vault; agents can use it two ways: (a) community MCP servers over the **Local REST API plugin** (requires the Obsidian app running), or (b) direct file access, since a vault is just folders of markdown. Widely covered as the 2026 default "personal agent KB."
- License: proprietary free app; the *data* is plain markdown (no lock-in). Good fit as an optional viewer over a docs-in-repo KB rather than as the backend itself. (Tim already runs Obsidian vaults — the dashboard reads them.)

### 2.3 Self-hosted wiki servers (Confluence-like function)

| Tool | Storage | API/MCP | License | Notes (2026) |
|---|---|---|---|---|
| **Outline** (https://github.com/outline/outline) | Server: Postgres + Redis + S3; external OIDC/SAML required | REST API; several community MCP servers (e.g. https://github.com/Vortiago/mcp-outline, PyPI `mcp-outline`) with doc CRUD, search, **markdown export per doc/collection**, batch ops | **BSL 1.1** | Best-in-class UX; markdown in/out makes it migration-friendly; infra-heavy for local default |
| **BookStack** (https://www.bookstackapp.com) | Server: PHP + MariaDB | REST API, markdown export | MIT | Simple, stable; book/chapter/page hierarchy; not git-native |
| **Wiki.js** (https://js.wiki) | Server: Node + DB | API; **bidirectional git sync of pages** (its standout feature) | AGPL | v3 rewrite long-running; git-backed content is conceptually closest to "wiki over docs-in-repo" |
| **Notion** (migration target) | SaaS | Official hosted MCP; markdown import/export | Proprietary | One source notes Notion's hosted MCP is OAuth-only — a **headless-agent blocker** (vs Linear's, which accepts API-key Bearer). **Flag: single-source claim.** |
| **Confluence Cloud** (team target) | SaaS | **Atlassian Remote MCP Server (Rovo) — GA Feb 2026**, 72+ tools across Jira/Confluence/Compass/JSM/Bitbucket, OAuth 2.1 *or API tokens*, cloud-hosted proxy respecting existing permissions (https://github.com/atlassian/atlassian-mcp-server, https://www.atlassian.com/platform/remote-mcp-server). Community alternative for API-token/self-hosted: https://github.com/sooperset/mcp-atlassian | Proprietary | SSE transport deprecated after June 2026 → streamable HTTP endpoint |

**Bottom line for KB:** nothing beats markdown-in-repo + index for the local default; Outline is the best self-hosted upgrade if a served wiki is ever needed; Confluence is reachable from markdown (see §3).

---

## 3. Migration / interchange

### 3.1 Canonical formats

- **No industry canonical epic/story/task interchange format exists.** The practical lingua francas are: CSV (Jira's native importer; Linear CSV import), JSONL (beads' explicit interchange layer), and markdown-with-frontmatter (Backlog.md, Spec Kit, BMad). tk-studio's plan to define its own canonical shape behind adapters is consistent with what everyone else ends up doing ad hoc.

### 3.2 Into Jira / Confluence (Atlassian Cloud)

- **Jira CSV import** — official, mature (https://support.atlassian.com/jira-cloud-administration/docs/import-data-from-a-csv-file/). Known wart: description fields imported via CSV use legacy wiki markup, not the new-editor markdown (JRACLOUD-79205) — an adapter must transform text.
- **Jira REST API / bulk endpoints** — the robust programmatic path; epic/story/sub-task hierarchy fully addressable.
- **Atlassian Remote MCP Server (GA Feb 2026)** — agents can create/update/bulk-manage Jira issues and Confluence pages directly; this makes "migration" a skill an agent runs, not a one-off ETL.
- **Markdown → Confluence:** `kovetskiy/mark` (Go, active May 2026; creates/updates pages from md, uploads attachments, supports macros — https://github.com/kovetskiy/mark); `md2cf` (Python CLI); `@telefonica/markdown-confluence-sync` (npm, hierarchy-preserving); the `markdown-confluence` GitHub org (Obsidian→Confluence publishing).

### 3.3 Into Linear

- **In-product migration assistant** for Jira/Asana/Shortcut/GitHub (recommended path; https://linear.app/docs/import-issues). CSV import supported. The old CLI importer `@linear/import` is **deprecated** but still exists for odd sources.
- **GraphQL API** — full programmatic path.
- **Linear hosted MCP** (https://mcp.linear.app/mcp, launched May 2025, expanded Feb 2026 with initiatives/milestones/project updates): OAuth 2.1 **or API-key Bearer** — explicitly workable for headless agents (https://linear.app/changelog/2026-04-23-linear-agent-mcp-support).
- Mapping note: Linear has no "epic" entity — canonical epic maps to Linear *Project* (or milestone), story→issue, task→sub-issue.

### 3.4 Bidirectional file↔tracker sync — does it exist?

Yes, but thinly; nothing is yet the obvious standard for agent workflows:

- **Imdone / imdone-cli** (https://imdone.io/markdown-jira-sync) — pulls Jira issues as markdown files into the repo, edit locally, push back; has a merge path for both-sides changes. Closest existing product to "file↔Jira bidirectional." Commercial/small; maturity moderate.
- **"Atlassian Sync" Claude skill** (claudepluginhub, 3d-stories) — bidirectional `.md`↔Jira/Confluence sync incl. pushing stories/epics and pulling status. **Flag: low-signal source, maturity unverified.**
- **MCP-as-sync** — the emerging pattern: no daemon, the agent itself reconciles files↔tracker through Atlassian/Linear MCP on demand. Several teams describe this; there is no packaged open-source project to adopt wholesale (**flag: absence claim**).
- **Commercial tracker↔tracker sync** (Exalate, OpsHub, Unito, GitHub↔Jira marketplace apps) — mature but tracker-to-tracker, not file-to-tracker.
- **git-bug bridges** — bidirectional GitHub/GitLab sync of git-native issues; no Jira/Linear bridge currently maintained (**unverified**).

---

## 4. Recommendation

### R1 (v1 default): BMad-style markdown-in-repo + thin index — yes, honestly the best v1 answer

The convergent 2026 pattern (Spec Kit ~100k stars, Backlog.md, AGENTS.md, llms.txt) is exactly what BMad already produces: markdown epics/stories/sprint-status + docs/ + index. tk-studio should make its **canonical interchange shape the frontmatter schema of those files** (stable IDs, parent links, status enum, acceptance criteria), plus one generated index (sprint-status/`index.md`, llms.txt-style). Zero new infrastructure, perfectly git-native, trivially readable/writable by any agent, and BMad skills already speak it. The adapter for "local" is then a file reader/writer, not an integration.

### R2 (optional structured local backend): Backlog.md

If the council wants a real board/CLI/MCP over the files without leaving the repo: MIT, files-in-repo (same storage philosophy — could even share the folder), CLI + MCP + terminal Kanban + local web UI, active, agent-proven. Its flat task/milestone model means the adapter must encode epic→milestone; acceptable. Prefer it over **beads** for v1: beads has the richer graph model and huge momentum, but its Dolt storage is a binary blob in the repo (poor git-diff/PR-review story, which conflicts with tk-studio's lockstep-git-base principle) and its storage engine has already pivoted once — revisit at v2 if dependency-graph "ready work" queries become the bottleneck. Avoid claude-task-master as backend (Commons Clause license, JSON-blob storage, overlaps BMad's own planning pipeline).

### R3 (migration path): adapter → Jira/Linear via official MCP + native importers; one-way promote first

- **Atlassian Cloud:** Atlassian Remote MCP Server (GA, 72+ tools, API-token auth) for agent-driven push of epics/stories; Jira CSV/REST for bulk seed; `kovetskiy/mark` for docs→Confluence.
- **Linear:** hosted MCP (API-key headless-friendly) + in-product importer/CSV for bulk; epic→Project mapping.
- Design the adapter as **one-way promote (local→cloud) with pull-status-back**, not full bidirectional sync — the only existing bidirectional file↔Jira products (Imdone, one unvetted Claude skill) are too thin to depend on, and MCP-driven reconciliation by the agent covers the gap.

---

## Verification flags (summary)

1. beads' exact current dependency-link taxonomy (README vs Yegge's posts differ) — check `bd` CLI directly.
2. Spec Kit star count: sources conflict (90k vs 111k).
3. Notion MCP "OAuth-only headless blocker" — single source.
4. OpenProject MCP availability — no official server found; community options unverified.
5. Absence claims (no packaged open-source file↔Jira/Linear agent sync; no dedicated agent-native KB curation tool) — based on search coverage, not proof.
6. "Atlassian Sync" Claude skill maturity — unvetted directory listing.
7. beads/Backlog.md/task-master star counts are as of source publication dates (June–July 2026), not live API reads.

## Key sources

- https://github.com/MrLesk/Backlog.md · https://github.com/steveyegge/beads · https://github.com/eyaltoledano/claude-task-master · https://github.com/github/github-mcp-server · https://github.com/github/spec-kit · https://github.com/git-bug/git-bug
- https://plane.so / https://developers.plane.so · https://www.openproject.org/blog/open-source-jira-alternative/ · https://openalternative.co/huly
- https://linear.app/docs/import-issues · https://linear.app/docs/jira · https://linear.app/changelog/2026-04-23-linear-agent-mcp-support · https://www.npmjs.com/package/@linear/import
- https://github.com/atlassian/atlassian-mcp-server · https://www.atlassian.com/platform/remote-mcp-server · https://github.com/sooperset/mcp-atlassian · https://support.atlassian.com/jira-cloud-administration/docs/import-data-from-a-csv-file/
- https://github.com/kovetskiy/mark · https://www.npmjs.com/package/@telefonica/markdown-confluence-sync · https://imdone.io/markdown-jira-sync
- https://github.com/outline/outline · https://github.com/Vortiago/mcp-outline · https://llmstxt.org (via 2026 adoption studies)
