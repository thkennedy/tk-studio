"""Release-archive step of the release motion (ST-057, EP-018 / PROP-012).

Builds the plugin-tree zip deterministically at the release tag (a
``git archive`` of the tag's subtree, then :func:`normalize_zip` — see
its docstring for why raw subtree archives are time-varying), computes
its SHA-256, publishes it as the tag's GitHub release asset, re-downloads
the published asset and verifies the digest, then records
``archive: {url, sha256}`` in ``released-roster.json`` — the gate's third
file doubles as the backstop manifest (fork ruled 2026-08-10). Anyone at
the tag can rebuild the byte-identical zip and re-derive the recorded
digest: ``run --dry-run`` prints it without publishing.

Motion order (two commits — the checksum trails the artifact it names,
because a zip cannot contain its own digest):

1. gate x3 bump commit (plugin.json + marketplace.json + roster
   version/skills), then ``claude plugin tag`` mints ``tk-studio--v<X>``
   at that commit;
2. this tool: build from the tag, hash, publish, verify, record;
3. the roster archive-record commit lands immediately after — main is
   never left between the two commits.

Every app (AD-21, Story 25.1): ``--app <plugin|supervisor|studio-web|cli>``
cuts that app from its subtree at its ``<prefix>--vX.Y.Z`` tag (``cli`` is
a wheel built by ``uv build``), publishes with ``--latest=false`` (no app
owns the repository's "latest"; consumers resolve by tag), verifies the
round trip, and records ``{tag, url, sha256}`` (plus ``source`` when the
asset lives on another repository) under the app's component in
``tools/installer/rosters/<channel>.json`` — refusing, before any ``gh``
mutation, a roster the drift check's guard rejects. ``--app plugin`` (the
default) is the historical motion unchanged in effect, plus those two
additions.

Maintainer tooling, not a driver surface (AD-11 does not bind it); the
JSON result on stdout follows the house shape. Stdlib-only; ``git`` and
``gh`` are the transports.

Usage:
    uv run tools/release_archive.py run [--app plugin] [--dry-run]
    uv run tools/release_archive.py run --app supervisor --version X.Y.Z \\
        --repo <path-to-supervisor-checkout> [--channel latest|stable]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

# Module paths are plain globals so the lib suite can point them at a
# tempdir — tests never touch the real repository's files.
REPO_ROOT = Path(__file__).resolve().parents[1]
PLUGIN_SUBDIR = "plugins/tk-studio"
ROSTER = REPO_ROOT / PLUGIN_SUBDIR / ".claude-plugin" / "released-roster.json"
PLUGIN_MANIFEST = REPO_ROOT / PLUGIN_SUBDIR / ".claude-plugin" / "plugin.json"
ROSTERS_DIR = REPO_ROOT / "tools" / "installer" / "rosters"
DRIFT_CHECK_DIR = (REPO_ROOT / PLUGIN_SUBDIR / "skills" / "tk-studio-activate"
                   / "scripts")
CHANNELS = ("latest", "stable")

# app -> (tag prefix, subtree at the tag, artifact kind). The supervisor's
# subtree is its own checkout's root (via --repo) until EP-31 moves it in.
APPS = {
    "plugin": ("tk-studio--v", PLUGIN_SUBDIR, "zip"),
    "supervisor": ("supervisor--v", ".", "zip"),
    "studio-web": ("studio-web--v", "apps/studio-web/dist", "zip"),
    "cli": ("cli--v", "tools/installer/cli", "wheel"),
}
VERSION_RE = re.compile(r"\d+\.\d+\.\d+")


def _run(args: list[str], cwd: Path | None = None,
         **kw) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(args, capture_output=True, text=True,
                              cwd=str(cwd or REPO_ROOT), **kw)
    except FileNotFoundError:
        _fail(f"{args[0]} not found on PATH")


def _fail(reason: str) -> None:
    print(json.dumps({"ok": False, "error": reason}))
    raise SystemExit(1)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_zip(raw: Path, out: Path, commit_epoch: int) -> None:
    """Rewrite a zip with entry order, mtimes, and attributes fixed by
    the commit — byte-identical output for identical (tree, commit).

    ``git archive <ref>:subdir`` archives a *tree* object, and for trees
    git stamps entries with the archiving wall clock (probed live
    2026-08-10: same tag, different minutes, different bytes) — the
    commit-time stamping the docs describe applies only to commit/tag
    archives, whose paths would carry the two-deep ``plugins/tk-studio/``
    prefix the plugin loader rejects. So determinism is restored here:
    entries re-written sorted, dated by the commit, permissions
    preserved, no extra fields, no comment.

    Entries are STORED, not deflated: compressed bytes depend on the
    zlib implementation (CPython 3.14's Windows builds moved to zlib-ng),
    and ``create_system`` is pinned to 3 (UNIX): CPython derives it from
    the build platform, and POSIX unzip honors ``external_attr`` mode
    bits only under it — both probed/reviewed 2026-08-10 (PR #47).
    """
    stamp = time.gmtime(commit_epoch)[:6]
    with zipfile.ZipFile(raw) as src, \
            zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as dst:
        for name in sorted(src.namelist()):
            entry = src.getinfo(name)
            info = zipfile.ZipInfo(name, date_time=stamp)
            info.external_attr = entry.external_attr
            info.create_system = 3
            info.compress_type = zipfile.ZIP_STORED
            dst.writestr(info, src.read(name))


def _write_json_atomic(path: Path, data: dict) -> None:
    """Same bytes as the historical writer (indent 2, LF, trailing
    newline), landed via a temp file + replace so a crash never leaves a
    half-written roster."""
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.",
                               suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(data, fh, indent=2)
            fh.write("\n")
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _roster_problems(roster: dict, released_archive: dict | None,
                     plugin_version: str) -> list[str]:
    """The one installer-roster guard lives in the drift check (the lib
    suite and the plugin plane call it too); the motion refuses to write a
    roster it rejects."""
    if str(DRIFT_CHECK_DIR) not in sys.path:
        sys.path.insert(0, str(DRIFT_CHECK_DIR))
    import drift_check  # noqa: E402  (plugin-side, stdlib-only)
    return drift_check.roster_problems(
        roster, released_archive=released_archive,
        plugin_version=plugin_version)


def _read_json(path: Path, label: str) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        _fail(f"{label} unreadable: {exc}")


def _build_wheel(raw_zip: Path, work: Path, commit_epoch: int,
                 cwd: Path) -> Path:
    """cli: the subtree at the tag, extracted, built by ``uv build`` with
    SOURCE_DATE_EPOCH pinned to the commit — never the working tree."""
    src = work / "src"
    out = work / "dist"
    with zipfile.ZipFile(raw_zip) as z:
        z.extractall(src)
    env = dict(os.environ, SOURCE_DATE_EPOCH=str(commit_epoch))
    proc = _run(["uv", "build", "--wheel", "--out-dir", str(out), str(src)],
                cwd=cwd, env=env)
    if proc.returncode != 0:
        _fail(f"uv build failed: {proc.stderr.strip()}")
    wheels = sorted(out.glob("*.whl"))
    if len(wheels) != 1:
        _fail(f"uv build produced {len(wheels)} wheels, expected exactly 1")
    return wheels[0]


def run(dry_run: bool, app: str = "plugin", version: str | None = None,
        repo: Path | None = None, channel: str = "latest") -> dict:
    if app not in APPS:
        _fail(f"unknown app {app!r} — one of {', '.join(APPS)}")
    if channel not in CHANNELS:
        _fail(f"unknown channel {channel!r} — one of {', '.join(CHANNELS)}")
    if app == "plugin" and channel != "latest":
        # The plugin cut also rewrites released-roster.json's archive; into
        # stable it would leave latest.json's plugin entry stale (gate x4 red,
        # and stable is guarded for shape only, so nothing else stops it).
        _fail("the plugin motion records into latest (gate x4); promote to "
              "stable by PR — --app plugin --channel stable refused")
    prefix, subtree, kind = APPS[app]
    repo = Path(repo).resolve() if repo else REPO_ROOT
    if app == "plugin" and repo != REPO_ROOT:
        # The plugin is gated against this repository's plugin.json and
        # released-roster.json: built and published from another checkout,
        # the cut would ride a gate that never described it.
        _fail(f"the plugin motion builds and publishes from this repository "
              f"(gate x4); --app plugin --repo {repo} refused")
    plugin_version = _read_json(PLUGIN_MANIFEST, "plugin.json")["version"]

    released = None
    if app == "plugin":
        if version is not None and version != plugin_version:
            _fail(f"--version {version} != plugin.json {plugin_version} — the "
                  "plugin's version is plugin.json's")
        version = plugin_version
        # Lockstep before any work — and long before any gh mutation: a
        # partial gate bump must fail here, not after a release is created.
        released = _read_json(ROSTER, "released-roster.json")
        if released["version"] != version:
            _fail(f"roster version {released['version']} != plugin.json "
                  f"{version} — run the gate bump first (lockstep)")
    else:
        if not version or not VERSION_RE.fullmatch(version):
            _fail(f"--app {app} needs --version X.Y.Z (got {version!r})")
        if app == "supervisor" and repo == REPO_ROOT:
            _fail("--app supervisor runs against its own checkout until "
                  "EP-31: pass --repo <path-to-supervisor-checkout>")
    # The roster this cut records into, read and sanity-checked before any
    # git/gh call (a dry run records nothing, so does not read it).
    roster_path = ROSTERS_DIR / f"{channel}.json"
    roster = None
    if not dry_run:
        roster = _read_json(roster_path, f"installer roster {channel}.json")
        if not isinstance(roster, dict) \
                or not isinstance(roster.get("components"), dict):
            _fail(f"installer roster {channel}.json has no components object")
        if roster.get("channel") != channel:
            _fail(f"installer roster {channel}.json: channel "
                  f"{roster.get('channel')!r} is not the file stem "
                  f"{channel!r} — not publishing")
    tag = f"{prefix}{version}"
    asset = f"tk-studio-{version}.zip" if app == "plugin" \
        else f"{app}-{version}.zip"

    if not _run(["git", "tag", "-l", tag], cwd=repo).stdout.strip():
        hint = "claude plugin tag" if app == "plugin" \
            else f"git tag {tag} && git push origin {tag}"
        _fail(f"tag {tag} not found — mint it first: {hint}")
    proc = _run(["git", "rev-list", "-n", "1", tag], cwd=repo)
    if proc.returncode != 0:
        _fail(f"git rev-list failed: {proc.stderr.strip()}")
    commit = proc.stdout.strip()
    treeish = f"{tag}:" if subtree == "." else f"{tag}:{subtree}"
    proc = _run(["git", "cat-file", "-t", treeish], cwd=repo)
    if proc.returncode != 0 or proc.stdout.strip() != "tree":
        _fail(f"app subtree {subtree} absent at {tag} — nothing to build")

    # Cosmetic in dry-run (the URL is only recorded on publish), so a
    # missing/unauthenticated gh must not block digest re-derivation.
    proc = _run(["gh", "repo", "view", "--json", "nameWithOwner",
                 "-q", ".nameWithOwner"], cwd=repo)
    if proc.returncode != 0:
        if not dry_run:
            _fail(f"gh repo view failed: {proc.stderr.strip()}")
        name_with_owner = None
    else:
        name_with_owner = proc.stdout.strip()

    proc = _run(["git", "show", "-s", "--format=%ct", commit], cwd=repo)
    if proc.returncode != 0:
        _fail(f"git show failed: {proc.stderr.strip()}")
    commit_epoch = int(proc.stdout.strip())

    with tempfile.TemporaryDirectory() as tmp:
        raw_path = Path(tmp) / f"raw-{asset}"
        # -c core.autocrlf=false: archives apply worktree eol conversion,
        # so unpinned config would CRLF-convert every text entry on this
        # machine and the digest would not reproduce elsewhere (PR #47).
        proc = _run(["git", "-c", "core.autocrlf=false", "archive",
                     "--format=zip", "-o", str(raw_path), treeish], cwd=repo)
        if proc.returncode != 0:
            _fail(f"git archive failed: {proc.stderr.strip()}")
        if kind == "wheel":
            art_path = _build_wheel(raw_path, Path(tmp), commit_epoch, repo)
            # The subtree's own pyproject names the wheel's version; a wheel
            # that is not --version would be published under the wrong tag.
            if f"-{version}-" not in art_path.name:
                _fail(f"built wheel {art_path.name} is not version {version} "
                      f"— bump the cli's pyproject.toml at {tag} first")
            asset = art_path.name
        else:
            art_path = Path(tmp) / asset
            normalize_zip(raw_path, art_path, commit_epoch)
        sha = _sha256(art_path)
        size = art_path.stat().st_size
        url = (f"https://github.com/{name_with_owner}/releases/download/"
               f"{tag}/{asset}") if name_with_owner else None

        result = {"ok": True, "dry_run": dry_run, "app": app,
                  "channel": channel, "version": version,
                  "tag": tag, "commit": commit, "asset": asset,
                  "sha256": sha, "size": size, "url": url,
                  "verified": False, "written": []}
        if dry_run:
            return result

        # The roster entry this cut will record — built and guarded before
        # any gh mutation, so a roster the guard rejects is never published
        # toward, let alone written.
        entry = {"tag": tag, "url": url, "sha256": sha}
        if repo != REPO_ROOT:
            proc = _run(["gh", "repo", "view", "--json", "nameWithOwner",
                         "-q", ".nameWithOwner"], cwd=REPO_ROOT)
            if proc.returncode != 0:
                _fail(f"gh repo view (this repository) failed: "
                      f"{proc.stderr.strip()}")
            if proc.stdout.strip() != name_with_owner:
                entry["source"] = name_with_owner
        if app != "plugin" and "plugin" not in roster["components"]:
            # No plugin entry, no home for the guard to compare against:
            # every app entry names its repository (the guard requires it).
            entry["source"] = name_with_owner
        roster["components"][app] = entry
        if app == "plugin":
            released["archive"] = {"url": url, "sha256": sha}
            archive = released["archive"]
        else:
            archive = _read_json(ROSTER, "released-roster.json").get("archive")
            # No archive record: skip the comparison rather than compare
            # against nothing — the record pin reports the record itself.
            if not isinstance(archive, dict):
                archive = None
        # Gate x4 binds the channel this motion releases into (latest);
        # stable trails by PR and is checked for shape only.
        if channel == "latest":
            problems = _roster_problems(roster, archive, plugin_version)
        else:
            problems = _roster_problems(roster, None, None)
        if problems:
            _fail(f"installer roster {channel}.json would be rejected by the "
                  f"guard — not publishing: {'; '.join(problems)}")

        if _run(["gh", "release", "view", tag], cwd=repo).returncode != 0:
            title = f"tk-studio {version}" if app == "plugin" \
                else f"{app} {version}"
            notes = (f"Release asset for the archive backstop (EP-018): "
                     f"`{asset}`, sha256 `{sha}`.") if app == "plugin" \
                else f"Release asset (AD-21 roster): `{asset}`, sha256 `{sha}`."
            # --latest=false: no app owns the repository's "latest" — the
            # roster is the only version gate and consumers resolve by tag
            # (AD-21).
            proc = _run(["gh", "release", "create", tag, "--verify-tag",
                         "--latest=false", "--title", title, "--notes", notes],
                        cwd=repo)
            if proc.returncode != 0:
                _fail(f"gh release create failed: {proc.stderr.strip()}")
        else:
            # An existing release keeps whatever "latest" flag it was made
            # with — demote it, so no app owns the repository's "latest".
            proc = _run(["gh", "release", "edit", tag, "--latest=false"],
                        cwd=repo)
            if proc.returncode != 0:
                _fail(f"gh release edit --latest=false failed: "
                      f"{proc.stderr.strip()}")
        proc = _run(["gh", "release", "upload", tag, str(art_path),
                     "--clobber"], cwd=repo)
        if proc.returncode != 0:
            _fail(f"gh release upload failed: {proc.stderr.strip()}")

        # Verify the round trip: the published asset must hash to the
        # digest about to be recorded — a mismatch fails the motion loud.
        down = Path(tmp) / "verify"
        down.mkdir()
        proc = _run(["gh", "release", "download", tag, "--pattern", asset,
                     "--dir", str(down)], cwd=repo)
        if proc.returncode != 0:
            _fail(f"gh release download failed: {proc.stderr.strip()}")
        published_sha = _sha256(down / asset)
        if published_sha != sha:
            _fail(f"published asset digest mismatch: built {sha}, "
                  f"downloaded {published_sha} — not recording")
        result["verified"] = True

    if app == "plugin":
        _write_json_atomic(ROSTER, released)
        result["written"].append(_rel(ROSTER))
    _write_json_atomic(roster_path, roster)
    result["written"].append(_rel(roster_path))
    if "source" in entry:
        result["source"] = entry["source"]
    return result


def _rel(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT)).replace("\\", "/")
    except ValueError:
        return str(path)


def main() -> None:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="tk-studio release-archive step (build, publish, "
                    "verify, record)")
    sub = parser.add_subparsers(dest="command", required=True)
    cmd = sub.add_parser("run", help="build + hash; publish, verify, and "
                                     "record unless --dry-run")
    cmd.add_argument("--dry-run", action="store_true",
                     help="build and hash only — no gh calls beyond repo "
                          "view, nothing recorded")
    cmd.add_argument("--app", choices=list(APPS), default="plugin",
                     help="which app to cut (default plugin)")
    cmd.add_argument("--version",
                     help="X.Y.Z for non-plugin apps (the plugin's is "
                          "plugin.json's)")
    cmd.add_argument("--repo", type=Path,
                     help="checkout to build from and publish in (default "
                          "this repository); the roster write always targets "
                          "this repository")
    cmd.add_argument("--channel", choices=list(CHANNELS), default="latest",
                     help="installer roster to record into (default latest; "
                          "--app plugin records into latest only)")
    args = parser.parse_args()
    print(json.dumps(run(args.dry_run, app=args.app, version=args.version,
                         repo=args.repo, channel=args.channel), indent=2))


if __name__ == "__main__":
    main()
