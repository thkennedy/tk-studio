"""tk-studio project detection — weighted markers, confidence floor, zero writes (ST-4.2, AD-17).

Given a project root, scores candidate project types against the profile
registry shipped with the plugin (skills/tk-studio-detect/profiles/*.json)
and reports ranked candidates with the concrete evidence behind every scored
marker. tk detector discipline, ported: detection is a pure read, and below
the confidence floor the answer is "unknown — ask" — never a silent guess.

Outcomes:
  confident        top candidate meets its confidence floor AND clears the
                   margin over the runner-up — safe to propose downstream
  ambiguous — ask  something scored, but floor or margin unmet — a human picks
  unknown — ask    no profile scored — a human explains the project

Marker kinds (each carries weight + human-readable evidence text):
  file_glob     a file matching the pattern exists within max_depth
  dir_exists    a directory with that name exists within max_depth
  file_content  a matching file's content matches the probe regex
  vcs           the project's VCS is `pattern` (git | perforce)

Profiles may carry a `suggests` list (module names) — data consumed by the
recommendation step (ST-4.3), never acted on here.

CLI:
  uv run detect.py scan --directory DIR [--profiles-dir DIR] [--margin N]

Exit codes: 0 ok (any outcome — "ask" is a result, not an error); 2 bad
invocation. Stdlib-only (NFR9); never prompts, never writes (AD-11).
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROFILES_DIR = PLUGIN_ROOT / "skills" / "tk-studio-detect" / "profiles"

DETECT_VERSION = 1
DEFAULT_MARGIN = 2  # top must beat the runner-up by this to stay confident
MAX_CONTENT_BYTES = 2 * 1024 * 1024

# Never descend into these: huge, generated, or vendored. The directory itself
# is still recorded (so a dir_exists marker can fire on the name).
PRUNE_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "vendor", "__pycache__",
    ".venv", "venv", ".gradle", ".idea", ".vs", ".tox", ".mypy_cache",
    "Engine", "Intermediate", "Binaries", "Saved", "DerivedDataCache",
    "Content", "Library", "Temp", "obj",
    "dist", ".next", ".nuxt", ".svelte-kit", "build", ".turbo",
}

OUTCOME_CONFIDENT = "confident"
OUTCOME_AMBIGUOUS = "ambiguous — ask"
OUTCOME_UNKNOWN = "unknown — ask"


class DetectError(Exception):
    """Bad invocation or unreadable profile registry."""


# ---------------------------------------------------------------- registry

def load_profiles(profiles_dir: Path) -> list[dict]:
    profiles_dir = Path(profiles_dir)
    if not profiles_dir.is_dir():
        raise DetectError(f"profiles dir not found: {profiles_dir}")
    profiles = []
    for path in sorted(profiles_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise DetectError(f"bad profile {path.name}: {exc}") from exc
        data.setdefault("_source", path.name)
        profiles.append(data)
    if not profiles:
        raise DetectError(f"no profiles found in {profiles_dir}")
    return profiles


# ------------------------------------------------------------------- walk

def collect_inventory(root: Path, max_depth: int) -> list[tuple[str, str, int, str]]:
    """One bounded, pruned walk → (kind, name, depth, path); read-only."""
    inv: list[tuple[str, str, int, str]] = []
    root_str = str(root.resolve())
    for dirpath, dirnames, filenames in os.walk(root_str, topdown=True,
                                                onerror=lambda _e: None):
        rel = os.path.relpath(dirpath, root_str)
        depth_dir = 0 if rel == os.curdir else rel.count(os.sep) + 1
        child_depth = depth_dir + 1
        if child_depth <= max_depth:
            for fn in filenames:
                inv.append(("file", fn, child_depth, os.path.join(dirpath, fn)))
        keep = []
        for dn in dirnames:
            if child_depth <= max_depth:
                inv.append(("dir", dn, child_depth, os.path.join(dirpath, dn)))
            if dn not in PRUNE_DIRS and child_depth < max_depth:
                keep.append(dn)
        dirnames[:] = keep
    return inv


def detect_vcs(root: Path) -> dict:
    """{type: git|perforce|none, evidence}. A .git dir/file beats P4 hints."""
    if (root / ".git").exists():
        return {"type": "git", "evidence": ".git present"}
    for hint in (".p4config", ".p4ignore", "p4config.txt"):
        if (root / hint).is_file():
            return {"type": "perforce", "evidence": f"{hint} present"}
    return {"type": "none", "evidence": "no VCS markers at the root"}


# ---------------------------------------------------------------- scoring

def _file_matches(inv, pattern: str, max_depth: int):
    for kind, name, depth, path in inv:
        if kind == "file" and depth <= max_depth and fnmatch.fnmatch(name, pattern):
            yield name, path


def _content_probe(path: str, probe: re.Pattern) -> bool:
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            return probe.search(fh.read(MAX_CONTENT_BYTES)) is not None
    except OSError:
        return False


def eval_marker(marker: dict, inv, vcs: dict) -> tuple[bool, str]:
    kind = marker.get("kind")
    pattern = marker.get("pattern", "")
    max_depth = int(marker.get("max_depth", 1))
    if kind == "file_glob":
        for name, _path in _file_matches(inv, pattern, max_depth):
            return True, name
        return False, ""
    if kind == "dir_exists":
        low = pattern.lower()
        for k, name, depth, _path in inv:
            if k == "dir" and depth <= max_depth and name.lower() == low:
                return True, name
        return False, ""
    if kind == "file_content":
        probe = re.compile(marker.get("probe", ""), re.IGNORECASE)
        for name, path in _file_matches(inv, pattern, max_depth):
            if _content_probe(path, probe):
                return True, name
        return False, ""
    if kind == "vcs":
        if vcs["type"] == pattern:
            return True, vcs["evidence"]
        return False, ""
    return False, ""


def score(profiles: list[dict], root: Path) -> tuple[list[dict], dict]:
    all_markers = [m for p in profiles
                   for m in p.get("detection", {}).get("markers", [])]
    max_depth = max((int(m.get("max_depth", 1)) for m in all_markers), default=1)
    inv = collect_inventory(root, max_depth)
    vcs = detect_vcs(root)

    candidates = []
    for order, profile in enumerate(profiles):
        det = profile.get("detection", {})
        total = 0
        evidence = []
        for marker in det.get("markers", []):
            hit, match = eval_marker(marker, inv, vcs)
            if hit:
                weight = int(marker.get("weight", 0))
                total += weight
                evidence.append({"evidence": marker.get("evidence", ""),
                                 "weight": weight, "match": match})
        candidates.append({
            "id": profile.get("id"),
            "display_name": profile.get("display_name", profile.get("id")),
            "score": total,
            "confidence_min": int(det.get("confidence_min", 4)),
            "suggests": profile.get("suggests", []),
            "evidence": evidence,
            "_order": order,
        })
    candidates.sort(key=lambda c: (-c["score"], c["_order"]))
    return candidates, vcs


def recommend(candidates: list[dict], margin: int = DEFAULT_MARGIN) -> dict:
    scored = [c for c in candidates if c["score"] > 0]
    if not scored:
        return {"outcome": OUTCOME_UNKNOWN, "top_candidate": None}
    best = scored[0]
    runner_up = scored[1]["score"] if len(scored) > 1 else 0
    if best["score"] < best["confidence_min"]:
        return {"outcome": OUTCOME_UNKNOWN, "top_candidate": best["id"]}
    if best["score"] - runner_up < margin:
        return {"outcome": OUTCOME_AMBIGUOUS, "top_candidate": best["id"]}
    return {"outcome": OUTCOME_CONFIDENT, "top_candidate": best["id"]}


def detect(project_root: Path, profiles_dir: Path | None = None,
           margin: int = DEFAULT_MARGIN) -> dict:
    """Score the project against the registry. Pure read, never a guess."""
    root = Path(project_root).resolve()
    if not root.is_dir():
        raise DetectError(f"project root {root} is not a directory")
    profiles = load_profiles(profiles_dir or DEFAULT_PROFILES_DIR)
    candidates, vcs = score(profiles, root)
    rec = recommend(candidates, margin)
    public = [{k: c[k] for k in ("id", "display_name", "score", "confidence_min",
                                 "suggests", "evidence")} for c in candidates]
    return {
        "detect_version": DETECT_VERSION,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "project_root": str(root),
        "vcs": vcs,
        "outcome": rec["outcome"],
        "top_candidate": rec["top_candidate"],
        "candidates": public,
    }


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio project detection (read-only)")
    sub = parser.add_subparsers(dest="command", required=True)
    cmd = sub.add_parser("scan", help="score candidate project types with evidence")
    cmd.add_argument("--directory", required=True, help="project root")
    cmd.add_argument("--profiles-dir", help="profile registry (default: shipped profiles)")
    cmd.add_argument("--margin", type=int, default=DEFAULT_MARGIN,
                     help=f"confidence margin over the runner-up (default {DEFAULT_MARGIN})")
    args = parser.parse_args(argv)

    try:
        result = detect(Path(args.directory),
                        profiles_dir=Path(args.profiles_dir) if args.profiles_dir else None,
                        margin=args.margin)
    except DetectError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
