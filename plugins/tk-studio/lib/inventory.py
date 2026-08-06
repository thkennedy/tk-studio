"""tk-studio resource inventory — the full resource universe, read-only (ST-4.1, AD-17).

Recommendations draw from everything that *could* be in a working set, not
just what is installed. This module enumerates the three source planes named
by FR17 and tags every resource with its provenance (the file of record the
datum came from):

  installed modules/skills   _bmad/_config/manifest.yaml + skill-manifest.csv
  known-but-uninstalled      the plugin's bmad.lock module registry (AD-1's
                             "module set" is the studio's installer registry)
  user-authored              project .claude/skills (minus BMad-synced names),
                             project .claude/agents, _bmad/custom/ content

User-authored is a first-class recommendation path (AD-17). A .claude/skills
entry whose name appears in the installed skill manifest is the installer's
own sync, not user authorship — it is attributed to its module, never
double-counted.

The output is a structured, data-only JSON artifact on stdout. Inventory is a
pure read of the machine + project: it never writes anywhere unless the
caller passes --out (their explicit choice of destination).

CLI:
  uv run inventory.py scan --directory DIR [--lock PATH] [--out FILE]

Exit codes: 0 ok; 2 bad invocation (missing project root / unreadable lock);
1 unexpected failure. Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import bmadlock

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOCK_PATH = PLUGIN_ROOT / "bmad.lock"

INVENTORY_VERSION = 1

MANIFEST_REL = Path("_bmad") / "_config" / "manifest.yaml"
SKILL_MANIFEST_REL = Path("_bmad") / "_config" / "skill-manifest.csv"
CLAUDE_SKILLS_REL = Path(".claude") / "skills"
CLAUDE_AGENTS_REL = Path(".claude") / "agents"
CUSTOM_REL = Path("_bmad") / "custom"

# Stock files the installer seeds into _bmad/custom/ — everything else there
# is user-authored content.
_CUSTOM_STOCK = {"config.toml", "config.user.toml", ".gitignore", "readme.md"}

_MANIFEST_MODULE_KEYS = ("version", "source", "npmPackage", "repoUrl", "channel")


class InventoryError(Exception):
    """Bad invocation or unreadable source of record."""


# ------------------------------------------------------------ source readers

def read_manifest_modules(manifest_path: Path) -> list[dict]:
    """Installed modules from _bmad/_config/manifest.yaml (name, version, ...).

    The manifest is upstream's file — a list of mappings, outside the
    miniyaml subset — so this reads exactly the slice needed, the same
    posture as bmadlock.read_installed_manifest.
    """
    modules: list[dict] = []
    current: dict | None = None
    in_modules = False
    for raw in manifest_path.read_text(encoding="utf-8").splitlines():
        if not in_modules:
            if re.match(r"^modules:\s*$", raw):
                in_modules = True
            continue
        if raw.strip() and not raw.startswith(" "):
            break  # dedent past the modules block
        m = re.match(r"^\s+-\s+name:\s*(\S+)", raw)
        if m:
            current = {"name": m.group(1)}
            modules.append(current)
            continue
        m = re.match(r"^\s+(\w+):\s*(.*)$", raw)
        if m and current is not None and m.group(1) in _MANIFEST_MODULE_KEYS:
            value = m.group(2).strip()
            current[m.group(1)] = None if value in ("null", "") else value
    return modules


def read_skill_manifest(csv_path: Path) -> list[dict]:
    """Installed skills from _bmad/_config/skill-manifest.csv."""
    with open(csv_path, encoding="utf-8", newline="") as handle:
        return [dict(row) for row in csv.DictReader(handle)]


def read_lock_registry(lock_path: Path) -> dict[str, dict]:
    """The studio's known-module registry: {name: spec} from bmad.lock."""
    lock = bmadlock.parse_lock(lock_path)
    registry: dict[str, dict] = {}
    core = lock.get("core", {})
    if core:
        registry["core"] = {"version": core.get("version"),
                            "package": core.get("package")}
    for name, spec in lock.get("modules", {}).items():
        registry[name] = spec if isinstance(spec, dict) else {"version": str(spec)}
    return registry


_FRONTMATTER_FIELD_RE = re.compile(r"^(name|description):\s*(.+)$")


def read_frontmatter_summary(md_path: Path) -> dict:
    """{name?, description?} from a markdown file's frontmatter block.

    Reads only top-level single-line scalars — enough for a resource label;
    anything fancier is simply absent, never guessed.
    """
    summary: dict = {}
    try:
        lines = md_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return summary
    if not lines or lines[0].strip() != "---":
        return summary
    for line in lines[1:]:
        if line.strip() == "---":
            break
        m = _FRONTMATTER_FIELD_RE.match(line)
        if m:
            value = m.group(2).strip()
            if value and value[0] in "'\"" and value[-1] == value[0] and len(value) > 1:
                value = value[1:-1]
            summary[m.group(1)] = value
    return summary


# ------------------------------------------------------------------- scan

def _rel(path: Path, root: Path) -> str:
    return str(path.relative_to(root)).replace("\\", "/")


def scan(project_root: Path, lock_path: Path | None = None) -> dict:
    """Enumerate the full resource universe for a machine + project.

    Pure read. Missing planes degrade to notes, never errors — a project
    without _bmad/ still gets the known-module registry and its own
    user-authored resources.
    """
    root = Path(project_root).resolve()
    if not root.is_dir():
        raise InventoryError(f"project root {root} is not a directory")
    lock_path = Path(lock_path) if lock_path else DEFAULT_LOCK_PATH

    resources: list[dict] = []
    notes: list[str] = []
    sources: dict[str, bool] = {}

    # -- installed modules (_bmad/_config/manifest.yaml)
    manifest_path = root / MANIFEST_REL
    installed_modules: dict[str, dict] = {}
    sources["installed_manifest"] = manifest_path.is_file()
    if sources["installed_manifest"]:
        for mod in read_manifest_modules(manifest_path):
            installed_modules[mod["name"]] = mod
    else:
        notes.append(f"no installed BMad base ({_rel(manifest_path, root)} missing)"
                     if (root / "_bmad").is_dir() else "no _bmad/ install in this project")

    # -- known-module registry (plugin bmad.lock)
    try:
        registry = read_lock_registry(lock_path)
        sources["lock_registry"] = True
    except bmadlock.LockParseError as exc:
        raise InventoryError(f"module registry unreadable: {exc}") from exc

    manifest_prov = _rel(manifest_path, root)
    for name, mod in installed_modules.items():
        entry = {
            "kind": "module",
            "name": name,
            "status": "installed",
            "origin": "bmad-official",
            "version": mod.get("version"),
            "provenance": manifest_prov,
        }
        if name not in registry:
            entry["origin"] = "unregistered"
            notes.append(f"installed module '{name}' is not in the studio registry (bmad.lock)")
        resources.append(entry)
    for name, spec in registry.items():
        if name in installed_modules:
            continue
        resources.append({
            "kind": "module",
            "name": name,
            "status": "known-uninstalled",
            "origin": "bmad-official",
            "version": spec.get("version"),
            "provenance": "bmad.lock",
        })

    # -- installed skills (_bmad/_config/skill-manifest.csv)
    skill_csv = root / SKILL_MANIFEST_REL
    installed_skill_ids: set[str] = set()
    sources["skill_manifest"] = skill_csv.is_file()
    if sources["skill_manifest"]:
        prov = _rel(skill_csv, root)
        for row in read_skill_manifest(skill_csv):
            skill_id = row.get("canonicalId") or row.get("name") or ""
            if not skill_id:
                continue
            installed_skill_ids.add(skill_id)
            resources.append({
                "kind": "skill",
                "name": skill_id,
                "status": "installed",
                "origin": "bmad-official",
                "module": row.get("module"),
                "description": row.get("description"),
                "path": row.get("path"),
                "provenance": prov,
            })
    elif sources["installed_manifest"]:
        notes.append(f"skill manifest missing ({_rel(skill_csv, root)})")

    # -- user-authored: project .claude/skills minus BMad-synced names
    skills_dir = root / CLAUDE_SKILLS_REL
    sources["claude_skills"] = skills_dir.is_dir()
    if sources["claude_skills"]:
        prov = _rel(skills_dir, root)
        for entry in sorted(skills_dir.iterdir()):
            skill_md = entry / "SKILL.md"
            if not entry.is_dir() or not skill_md.is_file():
                continue
            if entry.name in installed_skill_ids:
                continue  # installer sync of an installed skill, already counted
            summary = read_frontmatter_summary(skill_md)
            resources.append({
                "kind": "skill",
                "name": summary.get("name", entry.name),
                "status": "installed",
                "origin": "user-authored",
                "description": summary.get("description"),
                "path": _rel(entry, root),
                "provenance": prov,
            })

    # -- user-authored: project agents
    agents_dir = root / CLAUDE_AGENTS_REL
    sources["claude_agents"] = agents_dir.is_dir()
    if sources["claude_agents"]:
        prov = _rel(agents_dir, root)
        for entry in sorted(agents_dir.glob("*.md")):
            summary = read_frontmatter_summary(entry)
            resources.append({
                "kind": "agent",
                "name": summary.get("name", entry.stem),
                "status": "installed",
                "origin": "user-authored",
                "description": summary.get("description"),
                "path": _rel(entry, root),
                "provenance": prov,
            })

    # -- user-authored: _bmad/custom/ content beyond the stock seed files
    custom_dir = root / CUSTOM_REL
    sources["bmad_custom"] = custom_dir.is_dir()
    if sources["bmad_custom"]:
        prov = _rel(custom_dir, root)
        for entry in sorted(custom_dir.iterdir()):
            if entry.name.lower() in _CUSTOM_STOCK:
                continue
            summary = {}
            if entry.is_dir():
                for probe in ("SKILL.md", "AGENT.md", "README.md"):
                    if (entry / probe).is_file():
                        summary = read_frontmatter_summary(entry / probe)
                        break
            elif entry.suffix.lower() == ".md":
                summary = read_frontmatter_summary(entry)
            resources.append({
                "kind": "custom",
                "name": summary.get("name", entry.stem if entry.is_file() else entry.name),
                "status": "installed",
                "origin": "user-authored",
                "description": summary.get("description"),
                "path": _rel(entry, root),
                "provenance": prov,
            })

    counts = {
        "modules_installed": sum(1 for r in resources
                                 if r["kind"] == "module" and r["status"] == "installed"),
        "modules_known_uninstalled": sum(1 for r in resources
                                         if r["status"] == "known-uninstalled"),
        "skills_installed": sum(1 for r in resources
                                if r["kind"] == "skill" and r["origin"] != "user-authored"),
        "user_authored": sum(1 for r in resources if r["origin"] == "user-authored"),
        "total": len(resources),
    }

    return {
        "inventory_version": INVENTORY_VERSION,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "project_root": str(root),
        "sources": sources,
        "counts": counts,
        "resources": resources,
        "notes": notes,
    }


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio resource inventory (read-only)")
    sub = parser.add_subparsers(dest="command", required=True)
    cmd = sub.add_parser("scan", help="enumerate the full resource universe")
    cmd.add_argument("--directory", required=True, help="project root")
    cmd.add_argument("--lock", help="module-registry path (default: plugin bmad.lock)")
    cmd.add_argument("--out", help="also write the JSON artifact to this file")
    args = parser.parse_args(argv)

    try:
        result = scan(Path(args.directory), lock_path=args.lock)
    except InventoryError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2

    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text + "\n", encoding="utf-8", newline="\n")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
