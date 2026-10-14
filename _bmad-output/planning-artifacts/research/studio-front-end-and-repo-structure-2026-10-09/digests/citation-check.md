# Citation check (semantic), 2026-10-09

Sample: 112 citation instances across sections 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 (every citation in §1 and §12; every numbered finding in §11; all seven insights in §10; a spread across §2 to §9). Live fetches: 4 (curl HEAD on a public GitHub release asset; `gh api` raw read of release-please `src/util/tag-name.ts`; WebFetch of Bun's npm-to-bun migration guide; WebFetch of GitHub's about-protected-branches page). Evidence of record: the 23 digests in this folder.

Verdict key: supported = the digest line for that URL says what the sentence says; partly = part of the sentence rests on a different source or on the researcher's inference; not supported = the source says something materially different; unreachable = no digest line and no fetch within budget.

| # | section | sentence (short) | marker | verdict | note |
|---|---|---|---|---|---|
| 1 | §1 A.1 | Omnara: three deployables, prefixes `omnarad-`/`cluster-`/`sdk-`, one workflow each | [1] | supported | A1-r1 L28; the API also lists a fourth `cli-release.yaml`, which does not contradict "one each" |
| 2 | §1 A.1 | Omnara newcomer path `git clone` then `docker compose up` | [2] | supported | A1-r1 L42 |
| 3 | §1 A.1 | OpenCode weekly lockstep core release plus `vscode-v` prefix, Bun monorepo | [3] | supported | A1-r1 L26 |
| 4 | §1 A.1 | Happy archived CLI and server repos 2026-02-14, folded into monorepo | [5] | supported | A1-r2 L22; "no stated rationale" at L24 |
| 5 | §1 A.1 | PostHog four tag schemes; n8n two release lines | [6][7] | supported | A1-r1 L29, L30 |
| 6 | §1 A.1 | Sirius 2020 split: rebuild coupling | [8] | supported | A1-r1 L68; "the only written split rationales" is slightly loose since §2 also lists Hermes [12] (a core/satellite rationale, not a monorepo split) |
| 7 | §1 A.1 | Unkey RFC 0010: build time + cross-project tangles, executed only partially | [9] | supported | A1-r2 L7-L11 (RFC text is a search excerpt, medium, as the appendix says) |
| 8 | §1 A.1 | Proton merge-back: CI rewrite and cut-over weekend | [11] | supported | A1-r2 L14 |
| 9 | §1 A.1 | Nordmann: a split loses the whole dependency graph for AI assistants | [10] | supported | A1-r2 L18 |
| 10 | §1 A.2 | Relative subfolder; `git-subdir` sparse/partial; `archive` zip + SHA-256 up to 256 MiB; `<plugin>--v<version>` convention | [29][30][31] | supported | [29]: A2-r1 L11-L13; 256 MiB and the `--v` convention are [31]: A2-r2 L9, L12. [30] adds nothing specific to this sentence (harmless bundle cite) |
| 11 | §1 A.2 | Official marketplace: 53 in-repo plugins, 262 SHA-pinned external pointers | [17] | supported | A1-r2 L42 |
| 12 | §1 A.3 | filter-repo `--to-subdirectory-filter` + `--tag-rename`; independent walkthrough; merge `--allow-unrelated-histories` | [50][51] | supported | A2-r1 L55-L56; A2-r1-verify row 3 (dev.to merges "with unrelated histories"); R2 already discloses the git-merge text was not retrieved |
| 13 | §1 A.3 | `git subtree add` is the one-commit fallback | [52] | supported | A2-r2 L20 ("A new commit is created automatically, joining...") |
| 14 | §1 A.3 | Archiving freezes the old repository at its URL | [54] | supported | A2-r2 L22 (read-only; no redirect documented) |
| 15 | §1 A.3 | Path filters not evaluated for tag pushes | [33][34] | supported | A2-r1 L26; A2-r1-verify row 1 |
| 16 | §1 A.3 | No path-conditional required checks; fan-in gate with `if: !cancelled()` | [37][38] | supported | A2-r1-verify row 4; A2-r2 L25 |
| 17 | §1 A.3 | release-please parser takes a single-character separator | [43][42] | supported | A2-r2 L13-L14; live: `tag-name.ts` L18 `(?<separator>[^a-zA-Z0-9])`, L19 `DEFAULT_SEPARATOR = '-'` |
| 18 | §1 caveat | Whole-repo clone on install and refresh, 120 s, `--sparse` user-side only; MAX_PATH failure on this Windows build | [239][240] | supported | A-redteam F1 L12-L15 |
| 19 | §1 caveat | Subtree merges lose path-limited `git log` history | [249] | supported | A-redteam F5 L46 |
| 20 | §1 caveat | Bypass actors do not exist on user-owned repositories | [246] | supported | A-redteam F4 L39; live: page reads "Actors may only be added to bypass lists when the repository belongs to an organization." |
| 21 | §1 installer | `irm \| iex` used by Claude Code, uv, Hermes, Microsoft dev-box | [56][57][61][63] | supported | A3-r1 L13, L9; A3-r2 L16, L19 |
| 22 | §1 installer | Roster of versions, URLs, checksums: `mise.lock` and rustup channel manifests | [72][73] | supported | A3-r1 L27, L31 |
| 23 | §1 installer | Hermes `install.ps1`: hash-pinned slots, launcher dir on PATH, JSON marker, re-run = update | [62] | supported | A3-r2 L17 |
| 24 | §1 installer | Third-party marketplaces do not auto-update by default; no update-all | [30][75][74] | supported | A3-r2 L12; A3-r1 L17; A3-r1-verify row 1 |
| 25 | §1 B.1 | Pixel Agents (9.6k, MIT) publishes AsyncAPI; external producer via `POST /api/hooks/claude` | [84][86] | supported | B1-r2 L21, L29 |
| 26 | §1 B.1 | claude-office: only Next.js + PixiJS precedent; only vendor-neutral REST ingest + fixture simulator | [88][89] | supported | B1-r1 L63 verdict; B1-r2 L44-L47 |
| 27 | §1 B.1 | AI Town rule set (one mutator, diffs per step, interpolation buffers, ordered inputs) | [92] | supported | B1-r1 L28; verifier could not confirm "diff" vs snapshot in code, but ARCHITECTURE.md says diff |
| 28 | §1 B.1 | Paperclip goals → projects → tickets → approvals | [102][103] | supported | B1-r2 L55-L56 |
| 29 | §1 B.2 | Static export forbids cookies, rewrites, headers, Server Actions | [117] | supported | B2-r1 L26; B3-r1 L38 (cookies() is the weakest item per B2-r1-verify row 10, still on the docs page) |
| 30 | §1 B.2 | Cookies have no port isolation; `ts.net` on the PSL | [147][149] | supported | B3-r2 L45, L47 |
| 31 | §1 B.2 | EventSource dies permanently on non-200; silently on iOS 18 when backgrounded | [133][150] | supported | B3-r1 L19; B3-r2 L51 (single forum thread; appendix marks it low) |
| 32 | §1 B.3 | Jules eight-state enum, `AWAITING_*` states, `:approvePlan` verb | [185] | supported | B5-r2 L12-L15 |
| 33 | §1 B.3 | Cursor plan mode switches to editing without consent; no hard setting | [179][180] | supported | B5-r2 L70-L71; note [236] (verifier) found staff naming an "Auto-Approved Mode Transitions" setting, which §9 already reports |
| 34 | §1 B.3 | ProKanban 50/85/95 band from item counts | [193] | supported | B5-r1 L26-L27 |
| 35 | §1 B.3 | One IT project in six overruns cost by about 200 percent | [198][199] | supported | B5-r2 L65-L66; B5-r1-verify row 13 |
| 36 | §1 B caveat | PixiJS v8: no primary integer-zoom recipe; open mobile blurriness issue | [115][132] | supported | B4B2-r2 L28, L30; B2-r1-verify row 13 |
| 37 | §1 B caveat | `@pixi/react` effectively unmaintained | [110][111] | supported | B2-r1 L10; B2-r1-verify row 3 |
| 38 | §1 B caveat | LimeZu page names no sit or typing animation | [160] | supported | B4B2-r2 L15 |
| 39 | §1 B caveat | `tailscale serve` with two path mounts undocumented | [144] | supported | B3-r2 L40 |
| 40 | §12 R1 | One repository: twelve layouts, three split rationales, one merge-back, Happy fold-in | [1][3][5][8][9][11][10] | supported | rows 1-9 above |
| 41 | §12 R2 | filter-repo recipe with `--tag-rename 'v':'supervisor--v'`; subtree fallback loses `git log -- path` without `-m --follow`; archive after | [50][51][52][249][54] | supported | A2-r1 L56, L109; A-redteam F5 (GitLab: `--follow -m`) |
| 42 | §12 R3 | Per-app `on.push.tags`, `make_latest: false`, no release-please for `--` | [33][43][31][244] | supported | A-redteam F3 L31 (`make_latest` per release); A2-r2 L14 |
| 43 | §12 R4 | Gate asserts `success`; skipped/neutral pass; bypass lists org-only; non-release workflows filter to `branches:` | [35][38][246][247][33] | supported | live: "Required status checks must have a successful, skipped, or neutral status"; A-redteam F4 L38-L40 |
| 44 | §12 R5 | Bootstrap → meta-CLI → roster → pinned zip → `claude plugin install --yes`; never `/releases/latest`; enable long paths; rename aside, stop service | [56][62][72][75][64][66][239][244][252] | partly | all sub-claims trace to digests, but "enable long paths" rests on [240] (issue 100214, `core.longpaths` unset), not [239]; add [240] |
| 45 | §12 R6 | Plugin sealed (cache holds only its folder); no submodules/LFS; PostHog nested-workspace exclusion; `node_modules` out of recursed paths; uv workspace optional; no Turborepo yet | [242][239][31][20][257][25][26] | supported | A-redteam F2 L23; A1-r2 L33 (pnpm-workspace.yaml exclusion is in row 20's file set); F8 L63; "no submodules" is [240]'s case, harmless |
| 46 | §12 R7 | Static export on one origin; hybrid DOM + plain Pixi canvas, `ssr: false`, nearest, integer zoom to be proven; no `@pixi/react`/Phaser/Godot | [117][135][109][113][111][115][132] | supported | B2-r1 L12-L15, L26; the integer-zoom recipe is explicitly "to be proven", matching B4B2-r2 L29 (low) |
| 47 | §12 R8 | Pixel Agents `ServerMessage` subset + claude-office REST ingest + AI Town rules | [84][89][92] | supported | B1-r2 L21-L28, L44-L47; B1-r1 L28 |
| 48 | §12 R9 | One SSE stream, `Last-Event-ID`, five-minute replay buffer, heartbeat ≤15 s, `server.timeout(req, 0)`, watchdog | [133][135][150] | partly | "five-minute replay buffer" is not in [133], [135] or [150]; it mirrors Hermes's five-minute run-event buffer [136] (docs claim; constant unread per B3-r1-verify row 12) and a low-confidence SharpAPI excerpt that has no appendix row. Everything else supported |
| 49 | §12 R10 | Hermes loopback API, key held by supervisor, Runs API server-to-server, `/v1/capabilities`, no dashboard embed, plugin only if needed | [136][138] | supported | B3-r2 L11-L20 |
| 50 | §12 R11 | LimeZu out of git, credited; LPC/PixelLab for committed art; edited SA frames stay SA; verify sit/typing | [159][160][153][164] | supported | B4-r1 L22-L27, L10-L13, L43; B4B2-r2 L13-L15 |
| 51 | §12 R12 | Jules enum + approval verb; autonomy at approval; 50/85/95 band; tail priced | [185][182][193][198] | supported | B5-r2 L12-L15, L34; B5-r1 L26; B5-r2 L65 |
| 52 | §11.1 | Troubleshooting page quotes; re-clone on new commits; `--sparse` user-side; sparse/shallow requests closed | [239][241][31] | supported | A-redteam F1 L12-L14 |
| 53 | §11.1 | chrome-devtools-mcp: 100 KB plugin, 1.6 GB + 4.4 GB submodules, MAX_PATH on build 26300, stale forever | [240] | supported | A-redteam F1 L15 |
| 54 | §11.1 | A `url` marketplace fetches only the JSON | [29] | supported | A1-r1 L59 |
| 55 | §11.1 | A private repository's release assets redirect cross-origin and drop auth headers | [31] | partly | [31] says only that a cross-origin redirect drops configured headers (A2-r2 L10). That release assets redirect cross-origin was the A2 researcher's unverified belief (A2-r2 L58). Live today: a public asset URL answers 302 to `release-assets.githubusercontent.com`, so the mechanism is real; private-repo behaviour remains the §13 open question |
| 56 | §11.2 | Plugin cache holds only its own folder; vendoring + drift check; symlinks outside marketplace skipped | [242][243][31] | supported | A-redteam F2 L23-L25 |
| 57 | §11.3 | GitHub latest = newest non-draft non-prerelease by `created_at` (commit date); multi-semantic-release case | [244][245] | partly | mechanism supported (F3 L31); wording "a supervisor release cut from an older commit can outrank a newer plugin release" reverses the direction: an older `created_at` ranks below. The red team says ranking follows commit date "and vice versa". Reword; the design consequence (`make_latest: false`) is unchanged |
| 58 | §11.4 | Required checks pass on skipped/neutral; Mergify critique; bypass lists org-only; bare `push:` runs on tags | [246][247][248][33] | supported | A-redteam F4 L38-L40; live confirmation of [246] |
| 59 | §11.5 | Subtree merge: `git log -- prefix/file` outer-only without `-m --follow`; blame finds originals; patch pending; GitLab empty History; LWN paths diverge | [249][250][251] | supported | A-redteam F5 L46 |
| 60 | §11.6 | restic rename regression; go-update "in use"; service cannot replace binary; `ENOTEMPTY`; mirror-only broken-binary report | [252][253][239][254] | supported | A-redteam F6 L52 (Anytype is folded into row 253 as the appendix says) |
| 61 | §11.7 | Genkit WHY_MONOREPO; oscillation essay | [255][256] | supported | A-redteam F7 L58 |
| 62 | §11.8 | Junctions in `node_modules` broke Bun; symlinks need Developer Mode; mirror-only worktree report | [257][31][258] | supported | A-redteam F8 L63 |
| 63 | §11.8 | "Bun installs with hardlinks on Windows" | [22] | partly | row 22's URL (bun.sh/docs/install/workspaces) says nothing about Windows (A1-r2 L47; the report's own §10.6 says so). The sentence comes from Bun's migration guide (A1-r2 L48, search excerpt, medium). Live today, that guide reads "On Windows and Linux, bun install uses hardlinks". Add that URL to row 22 or a new row; as written §10.6 and §11.8 contradict each other on [22] |
| 64 | §11.9 | `irm \| iex` audits; Defender/SmartScreen false positives | [259] | supported | A-redteam F9 L68 |
| 65 | §11 not found | Claude Code's own `<plugin>--v<version>` convention; release-please parser as code-level evidence | [43] | supported | A-redteam L73; A2-r2 L14 |
| 66 | §10.1 | No tool makes a cross-app compatibility manifest; meta release = fourth tag | [41][46] | supported | A2-r1 L134 (inference from the tool cards those rows describe) |
| 67 | §10.1 | Plugin manifest `version` written from the roster Claude Code recomputes against | [30] | supported | A3-r2 L48 |
| 68 | §10.2 | One origin: static export served by Bun, host-only cookie, `server.timeout(req, 0)` | [117][135][147] | supported | B3-r1 L22, L38; B3-r2 L45 |
| 69 | §10.3 | No precedent renders story/epic progress; no product reports partial delivery or quotes before running | [94][95][175][189] | supported | B1-r1 L126 (nearest precedents); B5-r1 L99-L100; B5-r2 L53 (absences, as the text frames them) |
| 70 | §10.4 | Cursor leaking plan mode; Jules timer auto-approve; Jules enum as the fix | [179][180][184][185] | supported | B5-r2 L70-L71; B5-r1 L18 (timer not independently verified; appendix row is vendor doc) |
| 71 | §10.5 | LimeZu cannot be in a public repo; LPC credits must ship; itch.io verifies purchase, no download endpoint | [159][153][169] | supported | B4-r1 L23, L13; B4B2-r2 L22-L23 |
| 72 | §10.6 | uv and Bun workspaces silent on Windows; pnpm junctions; `command` under `cmd.exe`, no `link`; rename-only; Hermes PTY doc contradiction | [22][25][23][29][66][137][139] | supported | A1-r1 L218; A1-r2 L49; A3-r2 L7-L9, L24; B3-r2 L22 |
| 73 | §2 | Hermes: uv + npm workspaces, no Turborepo | [13] | supported | A1-r1 L14 |
| 74 | §2 | Supabase engines in separate repos, consumed as pinned images that lag upstream | [19] | supported | A1-r2 L53-L55 |
| 75 | §2 | Hermes CalVer-to-SemVer switch "forced by" plugin `requires_hermes` SemVer floors | [13][14] | partly | A1-r2 L37: the floor rule is "the documented driver" but "no single sentence of the form 'we switched because X' was found", confidence medium. "Forced by" states the inference as fact; use "apparently driven by" |
| 76 | §2 | Nightly bot opens up to 60 SHA-bump PRs across 262 external plugins | [18] | supported | A1-r2 L43-L44 (workflow comment says ~290 entries; marketplace.json count is 262) |
| 77 | §2 | PostHog: root uv workspace, `exclude-newer = "7 days"`, Turborepo caches pytest with `uv.lock` input, no experimental Python workspaces | [20][26] | supported | A1-r2 L29-L31 |
| 78 | §2 | Nx Python plugin active, community-maintained, whole lockfile as task input | [24] | supported | A1-r2 L50-L51 |
| 79 | §3 | `metadata.pluginRoot` (v2.1.239+) bare names | [29] | supported | A2-r1 L17 |
| 80 | §3 | Version order manifest → entry → hash; update leaves cache when it matches | [30] | supported | A2-r2 L7-L8 |
| 81 | §3 | `gh release list` date order, limit 30, one `isLatest`; live filter returned `tk-studio--v0.2.16` of 11 | [40] | supported | A2-r2 L29 |
| 82 | §3 | Bypass actors (admin, "for pull requests only") reproduce admins-not-enforced | [36] | supported | A2-r2 L23 says this; superseded by §11.4 [246] for a user-owned repo. Not a source fault; add a cross-reference |
| 83 | §3 | `include-component-in-tag` and `include-v-in-tag` default true; `tag-separator` no stated default | [42] | supported | A2-r2 L13 |
| 84 | §3 | changesets: private packages need `privatePackages`; `pkg@version` tags; Releases only in publish path | [45][46][47] | supported | A2-r2 L17-L19 |
| 85 | §3 | Transfer redirects and carries hooks/secrets until old name reused; archive no redirect | [53][54] | supported | A2-r2 L21-L22 |
| 86 | §4 | Claude Code manifest GPG-signed from 2.1.89; two-version retention and boundary have no independent source | [56][79] | supported | A3-r1 L15; A3-r1-verify row 5 |
| 87 | §4 | `uv tool install` constraints persist; upgrade respects them (maintainer-confirmed) | [58][59] | supported | A3-r1 L7; A3-r1-verify row 2 |
| 88 | §4 | `command` source re-runs every session, needs meta-CLI on PATH, `cmd.exe` from home, no `link` | [29][30] | supported | A3-r2 L7-L11 |
| 89 | §4 | winget: `InstallerSha256` required, zip-portable, PATH not refreshed, one PR per version | [67][68][69] | supported | A3-r1 L21-L22; A3-r1-verify row 4 (PATH sub-claim verified; sha256-required not independently reached, as the appendix implies) |
| 90 | §4 | MSIX: no per-user services, no install-dir writes, HKLM diverted (mechanism disputed) | [70][71] | supported | A3-r1 L24; A3-r1-verify row 3 |
| 91 | §4 | `curl \| sh` criticisms mitigated by pinned version + separately trusted hash | [76][77][78] | supported | A3-r1 L35-L37 ([77][78] are search snippets; appendix marks medium) |
| 92 | §5 | External producer: `POST /api/hooks/claude`, Bearer from `server.json`, 3100 only an example, 64 KB cap; "the server fans each event out to every live server with a 2 s timeout" | [86][85][205] | partly | endpoint, token, port and cap supported (B1-r2 L29-L30; B1-r1-verify row 5). The fan-out is done by the shipped `claude-hook.ts` hook script to every server under `~/.pixel-agents/servers/`, not by the server (B1-r2 L30). Reword the actor |
| 93 | §5 | Six characters from JIK-A-4 Metro City; no attribution file (medium) | [83] | supported | B1-r2 L34 |
| 94 | §5 | claude-office 23-type union, per-session 1000/60 s, immediate `accepted` | [89] | supported | B1-r2 L44-L46 (verifier: per-session keying read from design doc only; B1-r1-verify row 5) |
| 95 | §5 | AI Town: 16 ms ticks, 1 s steps, few-dozen-KB state, ~1.5 s latency; `activity.until`, `ACTION_TIMEOUT` 120 s | [92][93] | supported | B1-r1 L28; B3-r1 L12; B3-r1-verify row 1 |
| 96 | §5 | agent-office 687 stars in two weeks, 3D, PTYs, floor per repo, cork boards, WIP | [94] | supported | B1-r1 L33-L34; B1-r1-verify row 3 |
| 97 | §5 | `claude agents` groups and `--json [--all]` feed with lifecycle companions | [100][101] | supported | B1-r2 L50-L51; B1-r1-verify row 6 |
| 98 | §6 | Phaser 4.2.1, 4.0.0 renderer rebuild, 352,219 B gzip, 3 commits in 90 days | [119][120][122] | supported | B2-r1 L17-L20; B2-r1-verify row 4 |
| 99 | §6 | Rive runtimes MIT, canvas-lite ~313 KB gzip wasm, exports paid since 2025-10-20 | [128][129] | supported | B2-r1 L29-L30 (date vendor-only, as §6 says) |
| 100 | §6 | PixiJS cannot import under Node; `ssr: false` from a client file | [114][116] | supported | B2-r1 L14-L15; B2-r1-verify row 9 |
| 101 | §7 | Hermes dashboard "active in the last five minutes" | [137] | supported | B3-r1 L13 (same-publisher only, per B3-r1-verify row 2) |
| 102 | §7 | Runs stream events; buffers expire after five minutes; `Idempotency-Key`; 10 concurrent runs | [136] | supported | B3-r2 L15-L16 (constant unread, as §7's verification paragraph states) |
| 103 | §7 | Bun route precedence; `{ dir }` directory route; no implicit `.html`/`index.html` fallback | [135][216] | supported | B3-r2 L32-L33; B3-r1-verify row 16 |
| 104 | §7 | `Domain=ts.net` refused, `Domain=<tailnet>.ts.net` not refused and spans the tailnet | [149][151] | supported | B3-r2 L47 |
| 105 | §8 | LPC: CC-BY-SA most restrictive, commercial allowed, credits in-app; README 4.0 vs CREDITS.csv 3.0 | [153][154] | supported | B4-r1 L10-L15 |
| 106 | §8 | Male base sheets incl. idle/walk/sit/emote, no typing or celebrate; 64x64 | [155][153] | supported | B4-r1 L17-L18; B4-r1-verify row 2 |
| 107 | §8 | Modern Office $5.00 list, $2.50 on near-continuous sales | [222] | supported | B4-r1-verify row 5 |
| 108 | §8 | PixelLab MCP metered in generations (1; 10-25; 1-4); no ownership statement on MCP page; pricing did not render | [165][166] | supported | B4B2-r2 L17-L19 |
| 109 | §8 | Three projects gitignore LimeZu; munder-difflin and SkyOffice ship it in public MIT repos | [223][98][224] | supported | B4-r1-verify rows 6-7; B1-r2 L43 |
| 110 | §9 | Devin: planning billed in ACUs, XS≤2/XL>20, L/XL unhealthy, green/yellow/red, Coach, no pre-task estimate | [175] | supported | B5-r2 L43-L48 (vendor-only; §9's verification paragraph already records the ACU-vs-composite discrepancy) |
| 111 | §9 | Codex: explore first, never mix questions with plan, revised plan replaces, "approval client-side", users miss the pause, notify hook gap | [195][196][197][204] | partly | all sub-claims except one trace to those rows (B5-r2 L26-L30). "Approval client-side" comes from littlebearapps/untether issue 965 (B5-r2 L29, low-medium), which has no appendix row. Add a row or drop the sub-claim |
| 112 | §9 | ChatDev 2.0 moved "from a domain-specific virtual software company paradigm"; 1.x on a branch and as a preset | [190][191][192][230] | supported | B5-r1-verify row 9 |

## Mismatches (not supported or partly supported)

- [31] in §11.1: text says a private repository's release assets redirect cross-origin and drop auth headers / [31] (host-marketplace) only says a cross-origin redirect drops configured headers; the redirect itself was the A2 researcher's unverified belief / live check today: a public release-asset URL answers 302 to `release-assets.githubusercontent.com`, so keep the sentence but attribute the redirect to that observation (add a row or an inline note) and keep the private-repo case as the §13 open question it already is. Confidence on the sentence: medium.
- [22] in §11.8: text says Bun installs with hardlinks on Windows / row 22's workspaces page is silent on Windows (A1-r2 L47; §10.6 says so with the same marker) / the statement is on Bun's npm-to-bun migration guide, confirmed live ("On Windows and Linux, bun install uses hardlinks"); add `https://bun.com/docs/guides/install/from-npm-install-to-bun-install` to row 22 or as a new row and cite that for §11.8.
- [244] in §11.3: text says a supervisor release cut from an older commit "can outrank a newer plugin release" / the source (and the red team) says latest is ordered by `created_at`, the commit date, so ordering can diverge from publish order in either direction / reword to "a release cut from an older commit ranks by that commit's date, so the two apps' releases trade the 'latest' slot regardless of publish order". The `make_latest: false` rule in R3 is unaffected.
- [13][14] in §2: text says the CalVer-to-SemVer switch was "forced by" the SemVer-floor rule / A1-r2 L37 calls it the documented driver and says no explicit "we switched because" sentence was found (medium) / reword to "apparently driven by" and mark medium.
- [86][85][205] in §5: text says "the server fans each event out to every live server with a 2 s timeout" / B1-r2 L30: the shipped `claude-hook.ts` hook script fans out to every server listed under `~/.pixel-agents/servers/` / reword the actor to "the hook script".
- [195][196][197][204] in §9: text says Codex approval is client-side / that sub-claim rests on littlebearapps/untether issue 965 (B5-r2 L29, low-medium), which has no appendix row / add a row (low) or drop the sub-claim.
- [133][135][150] in R9: text prescribes "a five-minute replay buffer" / none of the three rows names a duration; the figure mirrors Hermes's five-minute run-event buffer [136] (docs claim; constant unread) and a low-confidence SharpAPI excerpt with no appendix row / cite [136] for the figure and label it a design parameter, medium.
- [239] in R5: text says "enable long paths" / the MAX_PATH and `core.longpaths` finding is in [240] (issue 100214), while [239] supports the `ENOTEMPTY` scanner note / add [240] to R5's citation list.

Not a source fault, but worth one line each:
- §3 [36] still states the bypass-actor plan that §11.4 [246] corrects for a user-owned repository; add "(corrected in §11.4)" so a reader of §3 alone is not misled.
- §1 A.1 "the only written split rationales found" sits beside §2's third rationale (Hermes [12], a core/satellite decision); say "monorepo-split rationales" or add [12].
- §1 A.2 bundles [30] into a sentence it does not support; harmless, but [29][31] carry it alone.
- §1 B.3 [179][180] "no hard setting": thread 151214 says exactly that; the verifier's threads [236] show staff pointing at an "Auto-Approved Mode Transitions" setting. §9 already carries both; §1 could say "no documented setting that blocks it".

## Unreachable

- None. Every sampled instance had at least one digest line for the cited URL; the four live fetches were used to settle attribution, not reachability.

## Summary

Of 112 sampled instances: 104 supported, 8 partly supported, 0 not supported, 0 unreachable. Every §1 and §12 citation checked; the two load-bearing mechanics behind R3 and R4 (single-character release-please separator; org-only bypass lists plus skipped/neutral passing) were re-read live and hold verbatim.
No mismatch changes a recommendation. Four are attribution slips (the right fact under the wrong row: [31] redirect, [22] hardlinks, [239] long paths, the Codex client-side approval with no row), two are wording that overstates the digest (Hermes "forced by", Pixel Agents fan-out actor), one is a reversed direction in §11.3, and one is a design parameter (R9's five-minute buffer) cited to rows that do not name it. Suggested handling: add the two missing rows (Bun migration guide; untether #965 or drop), move the two misattributed markers, reword three sentences, and cite [136] for the R9 figure at medium confidence.
