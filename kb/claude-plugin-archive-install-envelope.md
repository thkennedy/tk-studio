---
title: Claude Code plugin archive-install envelope — verified at CLI 2.1.226
description: Live-probed facts for the EP-018 archive backstop — the validator's accepted archive shape, the --plugin-dir zip load proof, seed-dir mechanics and gaps, and the private-repo constraint on the archive source type.
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
  mismatch refuses install with "Plugin archive integrity check failed";
  `.zip` only, ≤ 256 MiB, `.claude-plugin/` at the archive root or exactly
  one folder deep. Versioning splits by case (docs): **with no declared
  version the digest IS the version** and tracks the zip automatically;
  **with a declared version (tk-studio's case) that string is the update
  signal — bump it whenever the zip changes, or users keep the cached
  copy**.

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
enablement present. The docs frame the seed as a session-start mechanism
("starts with marketplaces and plugins already available"); whether a live
session actually serves seeded plugins is **unproven here** — the probe
needs harness auth inside an isolated config home and is spend-bearing
(operator-gated, below).

## The private-repo constraint

This repo is **private**. Archive downloads are unauthenticated by
default; the one documented auth seam is marketplace-declared `headers`
(an `extraKnownMarketplaces` URL-source entry), sent only while the
download shares the marketplace URL's origin and **dropped on
cross-origin redirect** — and GitHub release-asset downloads redirect
off-origin, so headers cannot ride them. Neither a GitHub release asset
nor a raw URL of a private repo is therefore fetchable by the archive
source type, and **the marketplace `archive` source entry cannot serve
this plugin today**. The seams that activate it: public hosting (repo
made public, or assets on a public host), or a private artifact host
that serves same-origin with header auth.
Until then the backstop that works is the verified local zip — sneakernet
the asset (authenticated `gh release download` on a connected machine),
verify the SHA-256 out-of-band against `released-roster.json`'s record,
consume via `--plugin-dir <zip>` (session) or a seeded cache (persistent,
subject to the runtime gap above).

## Operator-gated probes (named, not skipped)

- **Live archive-source fetch, checksum-mismatch refusal, and
  version-gate interaction** — need a plugin zip on a public HTTPS host;
  publishing studio content (or even a dummy artifact) to a public host is
  an operator call.
- **Live-session seed serve** — a `claude -p` run under
  `CLAUDE_CODE_PLUGIN_SEED_DIR` with an isolated, authenticated config
  home; spend-bearing.
