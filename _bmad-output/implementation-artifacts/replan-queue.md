# Replan queue

## 25-3-the-drift-check-and-conformance-read-the-folder-and-the — scope: stories — from 25-1-the-roster-and-the-release-motion-for-every-app — 2026-10-14

- What changed: the roster guard (`lib/release_roster.py` as landed by 25.1) accepts only the six known component names, `schema: 1`, `channel` in {stable, latest}, a `>=X.Y.Z` `requires.claude-code` floor and `X.Y.Z` `uv`/`bun` versions; a roster with no `plugin` entry requires `source` on every app entry; the drift plane's ok detail names both rosters with per-channel components, and gate ×4 binds `latest.json` only (`stable.json` is shape-only).
- What no longer holds: the plan's draft wording of the plane's ok detail; nothing in the story's acceptance criteria.
- Suggested adjustment: Replan (25-1 reconcile, 2026-10-14): build on the landed guard and the plane as they are; any roster fixture passes the guard (six names, schema 1, valid channel, floor and version formats, `source` on foreign entries); the `stale`/`missing`/`shadowed` cases extend the plane's existing per-channel detail rather than replacing it; read the configured channel from the roster file stem.
- Status: closed — applied to the unstarted 25-3 entry's invoke_dev_with by the attended session (2026-10-14)

## 25-4-the-bootstrap-and-the-meta-cli — scope: stories — from 25-1-the-roster-and-the-release-motion-for-every-app — 2026-10-14

- What changed: as above; and `uv`/`bun` entries are `{version, sha256: {<target>: <hex>}}` per platform, app entries may carry `source` naming a foreign repository, and the release motion refuses `--app plugin` with a foreign `--repo`.
- What no longer holds: nothing in the story's acceptance criteria; the fakes must match the landed shape.
- Suggested adjustment: Replan (25-1 reconcile, 2026-10-14): the meta-CLI reads the roster through the landed guard (never a second parser), selects the running platform's digest from the `sha256` map and refuses a missing key by name (`PlatformNotPinned`), honours `source` on foreign app entries, and treats an absent component as "not shipped in this channel"; every fake roster in its tests passes the guard.
- Status: closed — applied to the unstarted 25-4 entry's invoke_dev_with by the attended session (2026-10-14)
