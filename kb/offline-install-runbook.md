---
title: Offline install runbook — the archive backstop, end to end
description: How to install the tk-studio plugin on an air-gapped or git-less machine from the SHA-256-pinned release asset, and how the release motion produces that asset.
rank: 40
---

# Offline install runbook — the archive backstop

The sneakernet path for a machine without network, git, or npm (ST-057,
EP-018 / PROP-012). Facts behind every step are pinned live in
[claude-plugin-archive-install-envelope.md](claude-plugin-archive-install-envelope.md);
the release motion's archive step is `tools/release_archive.py`.

## What each release publishes

From 0.2.6 on, the release motion publishes a GitHub release
`tk-studio--v<version>` carrying `tk-studio-<version>.zip` — the plugin
tree at the tagged commit, contents at the zip root, **normalized to
byte-determinism** (raw `git archive <tag>:subdir` output varies with
the archiving wall clock — subtree archives are tree objects — and with
local `core.autocrlf`; both probed live 2026-08-10, so the tool archives
with eol conversion pinned off and rewrites entries sorted, dated by the
commit, STORED not deflated, `create_system` pinned — machine- and
platform-independent bytes) — and records its digest in the roster:

```json
"archive": {
  "url": "https://github.com/<owner>/tk-studio/releases/download/tk-studio--v<version>/tk-studio-<version>.zip",
  "sha256": "<64 hex>"
}
```

The digest is computed from the built zip AND re-verified against the
re-downloaded published asset before it is recorded; the lib suite
(`test_release_roster.py`) goes red from the 0.2.6 floor on if a release
records no archive or a malformed one. Because the build is
deterministic, anyone at the tag can independently re-derive the
recorded digest without publishing:

```bash
uv run tools/release_archive.py run --dry-run
```

## Sneakernet, end to end

On a **connected machine** (the repo has been public since 2026-09-15,
so the download itself needs no auth; this runbook exists for the target
machine that has no network, git, or npm at all):

```bash
gh release download tk-studio--v<version> --pattern "tk-studio-<version>.zip" --repo <owner>/tk-studio
```

Carry the zip to the target machine along with the expected digest
(read it from `released-roster.json` at the **archive-record commit
immediately after the tag** — repo tip, in practice; the roster at the
tag itself predates its own record by design — a second channel, not
the zip itself).

On the **target machine**, verify out-of-band before use:

```powershell
(Get-FileHash tk-studio-<version>.zip -Algorithm SHA256).Hash.ToLower()
```

(or `sha256sum` / `shasum -a 256` on POSIX). A mismatch means the
artifact is not what the release recorded — stop.

Then consume it:

- **Session-scoped (proven live, zero network):**

  ```bash
  claude --plugin-dir path/to/tk-studio-<version>.zip
  ```

  The CLI loads the zip directly — the full skill roster, no
  marketplace, no install record. Repeat the flag per session.

- **Persistent (seed mechanism — explicit invocation only):**
  pre-populate a seed on the connected machine
  (`CLAUDE_CODE_PLUGIN_CACHE_DIR=<seed>` + marketplace add + plugin
  install), carry the seed directory, and run with
  `CLAUDE_CODE_PLUGIN_SEED_DIR=<seed>` plus a `settings.json` carrying
  the `extraKnownMarketplaces`/`enabledPlugins` halves (they never enter
  the seed). The serve split, proven live 2026-08-10 (ST-056 probes —
  see the envelope record for the evidence): a seeded session serves
  plugin skills on **explicit `/plugin:skill` invocation only**, zero
  network, and never advertises them to the session — the model cannot
  discover a seeded skill on its own. That is sufficient for
  driver-contract headless drives, which name their skill exactly
  (§2's invocation form), and insufficient for attended discovery,
  which needs `--plugin-dir` or a real install. Unchanged gap at CLI
  2.1.226: the `claude plugin …` management verbs do not read the seed
  either.

## The archive marketplace source (the named seam)

`{"source": "archive", "url": …, "sha256": …}` in a marketplace entry
is the harness-native pinned install — but it fetches over public HTTPS
(headers only survive same-origin, and GitHub asset downloads redirect
off-origin), so it could not serve this repo's assets while the repo was
private. The repo went public on 2026-09-15, which lifts that blocker;
the recorded `{url, sha256}` pair is already in the exact shape that
entry needs. The archive-source path has not yet been re-probed live
against the public asset — until it is, this runbook's verified local
zip remains the proven backstop.

## Release-motion order (why the record trails the tag)

A zip cannot contain its own digest, so the motion is two commits:
gate ×3 bump + `claude plugin tag` first, then
`uv run tools/release_archive.py run` (build → hash → publish → verify →
record) and the roster archive-record commit immediately after — main is
never left between the two.
