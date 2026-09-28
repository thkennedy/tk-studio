---
title: Claude Code plugin archive-install envelope — verified at CLI 2.1.226
description: Live-probed facts for the EP-018 archive backstop — the accepted archive-source shape, mismatch refusal and version-gate behavior, the --plugin-dir zip load proof, seed-dir serve mechanics and gaps, and the private-repo constraint on the archive source type.
rank: 30
---

# Claude Code plugin archive-install envelope — verified at CLI 2.1.226

Probed 2026-08-10 (ST-056, EP-018 / PROP-012) against `claude` 2.1.226 on
Windows, resolving what the archive-source + SHA-256 install path actually
supports before the release motion builds on it. Grounds the ST-057
release-archive tooling and the offline runbook. Docs cross-checked:
`plugin-marketplaces.md`, `plugins.md`, `plugins-reference.md` (2026-08;
archive source shipped in v2.1.224).

## The validator's accepted envelope (probe matrix, live)

`claude plugin validate` on a marketplace manifest accepts exactly one
archive shape:

```json
{"source": "archive", "url": "https://…", "sha256": "<64 hex>"}
```

- `sha256` is **optional**; when present it must be exactly 64 hex chars.
- Every other probed shape is rejected (`plugins.0.source: Invalid input`):
  `http://` URLs, `file://` URLs, `path` keys (relative or absolute — **no
  local-file archive source exists**), short/non-hex/`sha256:`-prefixed
  digests, and `type` in place of the `source` key.
- Docs add (not re-probed live): loopback, link-local, and cloud-metadata
  hosts are rejected; every redirect hop must satisfy the same rules;
  `.zip` only, ≤ 256 MiB, `.claude-plugin/` at the archive root or exactly
  one folder deep. Versioning splits by case (docs): **with no declared
  version the digest IS the version** and tracks the zip automatically;
  **with a declared version (tk-studio's case) that string is the update
  signal — bump it whenever the zip changes, or users keep the cached
  copy**.

## Live fetch, mismatch refusal, version gate — proven 2026-08-10

The first operator-gated probe ran against a disposable dummy plugin
(`probe-dummy`, public repo `thkennedy/plugin-archive-probe`, release
assets on GitHub's default host) declared archive-source by a local
directory marketplace, in isolated config homes. Four cells, all live:

- **Fetch:** `plugin install` from a public-HTTPS GitHub release asset
  succeeds — the off-origin asset redirect
  (`objects.githubusercontent.com`) is tolerated, the digest verifies, and
  the cache materializes fully (`cache/<mkt>/<plugin>/<version>/`, `.in_use`
  markers, component inventory served).
- **Mismatch refusal:** a wrong 64-hex `sha256` refuses with exactly
  `Plugin archive integrity check failed for <url>: expected sha256 <a>,
  got <b>. The archive was not installed.` — exit 1, nothing lands in the
  cache. The docs' claim is now a live fact.
- **Same declared version, changed bytes at the same URL:** invisible.
  `marketplace update` + `plugin update` report "already at the latest
  version"; no refetch, so the pinned `sha256` is **never re-checked after
  first materialization**. Consequence: republishing an asset without a
  version bump reaches nobody — the release motion's version-bump
  discipline (and its never-mutate-a-published-asset corollary) is
  load-bearing, not cosmetic.
- **Declared version bump:** updating the marketplace entry (version +
  url + sha256) and running the scoped update fetches the new asset,
  verifies the new digest, and materializes the new version alongside the
  old — the studio's release path, proven end to end.

## Local zip load — proven live, zero network

A zip built from the plugin tree with contents at root
(`git archive --format=zip HEAD:plugins/tk-studio`, 390,825 bytes at
0.2.5) loads through the CLI's own resolver:

```
claude --plugin-dir <path>\tk-studio-<version>.zip plugin details tk-studio
```

served the full component inventory — **17 skills + 2 agents at 0.2.5**
(`Source: tk-studio@inline`); the 17 skills match `released-roster.json`
exactly (the roster records skills only — agents have no roster
counterpart).
`--plugin-dir` is session-scoped (per docs), so this is the **session-level
offline path**: no marketplace, no network, no install record.

## Seed-dir mechanics — population works, runtime verbs don't read it

The documented offline/container pair is: populate with
`CLAUDE_CODE_PLUGIN_CACHE_DIR=<seed>` (marketplace add + plugin install),
then run with `CLAUDE_CODE_PLUGIN_SEED_DIR=<seed>`.

**Population (proven live):** the seed lands complete —
`known_marketplaces.json`, `installed_plugins.json` (v2 record), the
marketplace clone, and the fully materialized
`cache/<marketplace>/<plugin>/<version>/` tree. Two caveats pinned:

1. **The marketplace declaration and enablement never enter the seed.**
   `extraKnownMarketplaces` + `enabledPlugins` land in the populating
   config home's `settings.json` — a target machine needs that settings
   half delivered separately (the container docs assume the image provides
   it).
2. **The seed's install record holds an absolute `installPath` into the
   seed** (observed). Whether runtime resolution follows that stored path
   or probes by seed location is unproven here — the docs claim
   relocation-safe resolution (content located by probing
   `$CLAUDE_CODE_PLUGIN_SEED_DIR/...` at runtime, "not by trusting paths
   stored inside the seed's JSON"), and their documented seed layout does
   not even include `installed_plugins.json`.

**Runtime (gap, pinned live):** at 2.1.226 the plugin management verbs
(`plugin list`, `plugin details`, `plugin install`, `plugin marketplace
list`) do **not** consult `CLAUDE_CODE_PLUGIN_SEED_DIR` — all report
empty/not-found even with the seed fully populated and the settings
enablement present.

**Live-session serve (proven 2026-08-10, second operator-gated probe):**
a `claude -p` run under `CLAUDE_CODE_PLUGIN_SEED_DIR` with the settings
enablement present, in an authenticated config home holding **no plugin
cache and an empty install record**, splits cleanly:

- **Explicit invocation works.** `/<plugin>:<skill>` resolves and loads
  the seeded skill body — zero network, zero cache materialization in the
  run home (its `plugins/installed_plugins.json` stays `{}` after the
  run; the seed's cache is the only copy of the content on the machine).
  Headless drives that name their skill exactly — the driver contract's
  invocation form — are served by a seed alone.
- **Advertisement does not.** The seeded skill is absent from the
  session's available-skills surface: asked identically, the seeded
  session denies the skill exists while a `--plugin-dir` session (positive
  control, same question, same model) confirms it. Discovery-driven flows
  — the model electing a skill it can see — will not find seeded plugins;
  attended discovery UX still needs `--plugin-dir` or a real install.

The seed's absolute-`installPath` question (above) stays open: here the
stored path pointed into the seed, so path-following and probe-by-location
resolution coincide — the probe cannot distinguish them.

## The private-repo constraint (lifted 2026-09-15)

This repo was **private** until 2026-09-15; the facts below were probed
while it was, and still hold for any private host. Archive downloads are unauthenticated by
default; the one documented auth seam is marketplace-declared `headers`
(an `extraKnownMarketplaces` URL-source entry), sent only while the
download shares the marketplace URL's origin and **dropped on
cross-origin redirect** — and GitHub release-asset downloads redirect
off-origin, so headers cannot ride them. Neither a GitHub release asset
nor a raw URL of a private repo is therefore fetchable by the archive
source type, and **the marketplace `archive` source entry could not serve
this plugin while the repo was private**. The seams that activate it:
public hosting (repo made public, or assets on a public host), or a
private artifact host that serves same-origin with header auth. The
first seam is now open — the repo is public — but the archive-source
install has not been re-probed live against the public asset.
Until it is, the backstop that works is the verified local zip — sneakernet
the asset (`gh release download` on a connected machine),
verify the SHA-256 out-of-band against `released-roster.json`'s record,
consume via `--plugin-dir <zip>` (session) or a seeded cache (persistent,
subject to the runtime gap above).

## Operator-gated probes — both run 2026-08-10

Released by the operator at the 2026-08-10 boundary triage and run the
same day (results folded into the sections above):

- **Live archive-source fetch, checksum-mismatch refusal, and
  version-gate interaction** — run against a dummy artifact on a public
  host (`thkennedy/plugin-archive-probe`, disposable, safe to delete); no
  studio content was published.
- **Live-session seed serve** — run spend-bearing with a positive control
  validating the detection method; serve-on-explicit-invocation proven,
  advertisement gap pinned.
