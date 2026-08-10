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

Maintainer tooling, not a driver surface (AD-11 does not bind it); the
JSON result on stdout follows the house shape. Stdlib-only; ``git`` and
``gh`` are the transports.

Usage:
    uv run tools/release_archive.py run [--dry-run]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PLUGIN_SUBDIR = "plugins/tk-studio"
ROSTER = REPO_ROOT / PLUGIN_SUBDIR / ".claude-plugin" / "released-roster.json"
PLUGIN_MANIFEST = REPO_ROOT / PLUGIN_SUBDIR / ".claude-plugin" / "plugin.json"


def _run(args: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True,
                          cwd=str(REPO_ROOT), **kw)


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
    """
    stamp = time.gmtime(commit_epoch)[:6]
    with zipfile.ZipFile(raw) as src, \
            zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for name in sorted(src.namelist()):
            entry = src.getinfo(name)
            info = zipfile.ZipInfo(name, date_time=stamp)
            info.external_attr = entry.external_attr
            info.compress_type = zipfile.ZIP_DEFLATED
            dst.writestr(info, src.read(name))


def run(dry_run: bool) -> dict:
    version = json.loads(PLUGIN_MANIFEST.read_text(encoding="utf-8"))["version"]
    tag = f"tk-studio--v{version}"
    asset = f"tk-studio-{version}.zip"

    if not _run(["git", "tag", "-l", tag]).stdout.strip():
        _fail(f"tag {tag} not found — mint it first: claude plugin tag")
    commit = _run(["git", "rev-list", "-n", "1", tag]).stdout.strip()

    proc = _run(["gh", "repo", "view", "--json", "nameWithOwner",
                 "-q", ".nameWithOwner"])
    if proc.returncode != 0:
        _fail(f"gh repo view failed: {proc.stderr.strip()}")
    name_with_owner = proc.stdout.strip()
    url = (f"https://github.com/{name_with_owner}/releases/download/"
           f"{tag}/{asset}")

    commit_epoch = int(_run(["git", "show", "-s", "--format=%ct",
                             commit]).stdout.strip())

    with tempfile.TemporaryDirectory() as tmp:
        raw_path = Path(tmp) / f"raw-{asset}"
        zip_path = Path(tmp) / asset
        proc = _run(["git", "archive", "--format=zip", "-o", str(raw_path),
                     f"{tag}:{PLUGIN_SUBDIR}"])
        if proc.returncode != 0:
            _fail(f"git archive failed: {proc.stderr.strip()}")
        normalize_zip(raw_path, zip_path, commit_epoch)
        sha = _sha256(zip_path)
        size = zip_path.stat().st_size

        result = {"ok": True, "dry_run": dry_run, "version": version,
                  "tag": tag, "commit": commit, "asset": asset,
                  "sha256": sha, "size": size, "url": url,
                  "verified": False, "written": []}
        if dry_run:
            return result

        if _run(["gh", "release", "view", tag]).returncode != 0:
            proc = _run(["gh", "release", "create", tag, "--verify-tag",
                         "--title", f"tk-studio {version}", "--notes",
                         f"Release asset for the archive backstop "
                         f"(EP-018): `{asset}`, sha256 `{sha}`."])
            if proc.returncode != 0:
                _fail(f"gh release create failed: {proc.stderr.strip()}")
        proc = _run(["gh", "release", "upload", tag, str(zip_path),
                     "--clobber"])
        if proc.returncode != 0:
            _fail(f"gh release upload failed: {proc.stderr.strip()}")

        # Verify the round trip: the published asset must hash to the
        # digest about to be recorded — a mismatch fails the motion loud.
        down = Path(tmp) / "verify"
        down.mkdir()
        proc = _run(["gh", "release", "download", tag, "--pattern", asset,
                     "--dir", str(down)])
        if proc.returncode != 0:
            _fail(f"gh release download failed: {proc.stderr.strip()}")
        published_sha = _sha256(down / asset)
        if published_sha != sha:
            _fail(f"published asset digest mismatch: built {sha}, "
                  f"downloaded {published_sha} — not recording")
        result["verified"] = True

    roster = json.loads(ROSTER.read_text(encoding="utf-8"))
    if roster["version"] != version:
        _fail(f"roster version {roster['version']} != plugin.json "
              f"{version} — run the gate bump first (lockstep)")
    roster["archive"] = {"url": url, "sha256": sha}
    with ROSTER.open("w", encoding="utf-8", newline="\n") as fh:
        json.dump(roster, fh, indent=2)
        fh.write("\n")
    result["written"] = [str(ROSTER.relative_to(REPO_ROOT)).replace("\\", "/")]
    return result


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
    args = parser.parse_args()
    print(json.dumps(run(args.dry_run), indent=2))


if __name__ == "__main__":
    main()
