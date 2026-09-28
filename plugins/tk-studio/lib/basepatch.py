"""tk-studio base patches: studio-managed fixes to installer-owned BMad files.

Tracks the gap between AD-1 (zero forks) and the moment an upstream defect
stops the studio working. It is not a fork. Each patch is declared in
`base-patches/patches.json`:
- It is the smallest fix for one named upstream issue.
- It is pinned to the exact upstream text it replaces (`find`) and to the
  core versions it was verified against (`applies_to_core`).
- It carries a `marker` line that proves it landed.

`tk install` re-applies every applicable patch after each install, so a
reinstall can never silently revert it. `tk activate` reports a missing one
as bmad-base drift.

Nothing is ever patched blind:
- A target whose upstream text changed is reported `stale`. The upstream may
  have fixed the defect, or moved it.
- A core version the patch was not verified against is reported
  `unverified-core`.
Either way the file is left untouched and the operator re-checks the
upstream issue. Retire a patch once its issue is fixed at the pin.

States, per patch:
  applied          the marker is present
  pending          the defect text is present exactly once, marker absent (check only)
  patched          apply wrote the fix (apply only)
  not-applicable   the target file is not installed, so there is nothing to fix
  unverified-core  the defect text is present, but at a core version the patch was
                   never verified against (re-verify, then extend applies_to_core)
  stale            neither marker nor the defect text: upstream changed the file
                   (fixed or moved); re-verify the issue and retire or re-pin

CLI (stdlib only, NFR9; one JSON object on stdout):
  uv run basepatch.py check --directory DIR [--core VERSION]
  uv run basepatch.py apply --directory DIR [--core VERSION] [--dry-run]
Exit 0 when every applicable patch ends applied/patched; 1 otherwise; 2 on
a registry error.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
REGISTRY = PLUGIN_ROOT / "base-patches" / "patches.json"
REQUIRED = ("id", "target", "upstream_issue", "applies_to_core", "marker", "find", "replace")
GOOD = ("applied", "patched", "not-applicable")


class PatchError(Exception):
    pass


def load(path: Path = REGISTRY) -> list[dict]:
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise PatchError(f"base-patch registry unreadable: {path}: {exc}") from exc
    patches = doc.get("patches")
    if not isinstance(patches, list):
        raise PatchError(f"base-patch registry has no patches list: {path}")
    seen = set()
    for p in patches:
        missing = [k for k in REQUIRED if not p.get(k)]
        if missing:
            raise PatchError(f"base patch {p.get('id', '?')}: missing {', '.join(missing)}")
        if p["id"] in seen:
            raise PatchError(f"duplicate base patch id {p['id']}")
        if p["marker"] not in p["replace"]:
            raise PatchError(f"base patch {p['id']}: replace text must carry its marker")
        seen.add(p["id"])
    return patches


def _read(target: Path) -> tuple[str, str]:
    raw = target.read_bytes().decode("utf-8")
    newline = "\r\n" if "\r\n" in raw else "\n"
    return raw, newline


def _eol(text: str, newline: str) -> str:
    return text if newline == "\n" else text.replace("\n", "\r\n")


def state(root: Path, patch: dict, core: str | None) -> str:
    target = root / patch["target"]
    if not target.is_file():
        return "not-applicable"
    raw, newline = _read(target)
    if patch["marker"] in raw:
        return "applied"
    defect = raw.count(_eol(patch["find"], newline)) == 1
    if core is not None and core not in patch["applies_to_core"]:
        return "unverified-core" if defect else "stale"
    return "pending" if defect else "stale"


def _atomic_write(target: Path, text: str) -> None:
    fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=f".{target.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(text.encode("utf-8"))
        os.replace(tmp, target)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _row(patch: dict, status: str) -> dict:
    return {"id": patch["id"], "target": patch["target"], "status": status,
            "upstream_issue": patch["upstream_issue"]}


def check(root: Path, core: str | None, patches: list[dict] | None = None) -> list[dict]:
    return [_row(p, state(root, p, core)) for p in (patches if patches is not None else load())]


def apply(root: Path, core: str | None, patches: list[dict] | None = None,
          dry_run: bool = False) -> list[dict]:
    rows = []
    for p in (patches if patches is not None else load()):
        status = state(root, p, core)
        if status == "pending" and not dry_run:
            target = root / p["target"]
            raw, newline = _read(target)
            _atomic_write(target, raw.replace(_eol(p["find"], newline), _eol(p["replace"], newline), 1))
            status = "patched" if p["marker"] in _read(target)[0] else "stale"
        rows.append(_row(p, status))
    return rows


def healthy(rows: list[dict]) -> bool:
    return all(r["status"] in GOOD for r in rows)


def _core_from_lock(root: Path) -> str | None:
    sys.path.insert(0, str(PLUGIN_ROOT / "lib"))
    import bmadlock  # noqa: E402
    try:
        return bmadlock.parse_lock(PLUGIN_ROOT / "bmad.lock")["core"]["version"]
    except bmadlock.LockParseError:
        return None


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="tk-studio base patches")
    ap.add_argument("verb", choices=("check", "apply"))
    ap.add_argument("--directory", default=".")
    ap.add_argument("--core", help="core version to judge against (default: the bmad.lock pin)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    root = Path(args.directory).resolve()
    core = args.core or _core_from_lock(root)
    try:
        rows = (check(root, core) if args.verb == "check"
                else apply(root, core, dry_run=args.dry_run))
    except PatchError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2
    ok = healthy(rows)
    print(json.dumps({"ok": ok, "core": core, "dry_run": args.dry_run, "patches": rows}))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
