"""tk-studio working-set recommendation — propose, confirm, record (ST-4.3, AD-17).

Recommendations are two-dimensional (role × project) and evidence-backed:

  propose   read-only. Combines the resource inventory (ST-4.1), project
            detection (ST-4.2), and the operator's role (per-user store) into
            a proposed working set where every entry carries its evidence.
            Detection-derived suggestions join only on a `confident` outcome —
            an ask outcome contributes nothing (never a silent guess).
            Proposing IS the dry run: it shows the full plan and writes nothing.

  record    the explicit-confirmation act. Lands the confirmed set in tracked
            project config under `working_set.<role>` — a map keyed by role
            (AD-17): this role's entry is replaced, every other role's entry
            and every human comment in the file are preserved byte-for-byte.
            Re-recording an identical set is a no-op. Only this verb (invoked
            by tk-studio-onboard after the operator confirms) writes the key.

Proposal sources, each a named evidence line per resource:
  role-default    conservative per-role module base (v1 roles; new roles are
                  configuration, not architecture)
  detection       the confident profile's `suggests`, citing type + score +
                  the markers that fired
  user-authored   the project's own resources (first-class path, AD-17)

CLI:
  uv run recommend.py propose --directory DIR [--role ROLE]
  uv run recommend.py record  --directory DIR --role ROLE --resources a,b,c [--dry-run]

Exit codes: 0 ok; 2 bad invocation / classification refusal.
Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import config as configlib
import detect as detectlib
import inventory as inventorylib
import store as storelib

RECOMMEND_VERSION = 1

# Conservative per-role module base. v1 ships these two roles (AD-17); adding
# a role means adding data here or overriding via proposal review — not new
# architecture.
ROLE_BASE = {
    "developer": ["bmm", "tea"],
    "direction-giver": ["bmm", "cis"],
}

_ROLE_TOKEN_RE = re.compile(r"^[a-z][a-z0-9-]*$")


class RecommendError(Exception):
    """Bad invocation, unknown role shape, or unwritable config."""


# ---------------------------------------------------------------- propose

def _module_status(inv: dict, name: str) -> str | None:
    for resource in inv["resources"]:
        if resource["kind"] == "module" and resource["name"] == name:
            return resource["status"]
    return None


def propose(project_root: Path, role: str | None = None,
            lock_path: Path | None = None,
            profiles_dir: Path | None = None) -> dict:
    """Evidence-backed role × project working-set proposal. Pure read."""
    root = Path(project_root).resolve()
    if role is None:
        role = storelib.read_config().get("role") or storelib.DEFAULT_ROLE
    if not _ROLE_TOKEN_RE.match(role):
        raise RecommendError(f"role '{role}' is not a valid role token")

    inv = inventorylib.scan(root, lock_path=lock_path)
    det = detectlib.detect(root, profiles_dir=profiles_dir)

    proposed: dict[str, dict] = {}

    def _add(name: str, kind: str, source: str, evidence: str,
             status: str | None) -> None:
        entry = proposed.setdefault(name, {
            "name": name, "kind": kind, "status": status, "evidence": [],
        })
        entry["evidence"].append(f"{source}: {evidence}")

    for module in ROLE_BASE.get(role, []):
        _add(module, "module", "role-default",
             f"conservative base for role '{role}'",
             _module_status(inv, module))

    if det["outcome"] == detectlib.OUTCOME_CONFIDENT:
        top = det["candidates"][0]
        fired = "; ".join(e["evidence"] for e in top["evidence"][:3])
        for module in top["suggests"]:
            _add(module, "module", "detection",
                 f"detected {top['id']} (score {top['score']} ≥ floor "
                 f"{top['confidence_min']}): {fired}",
                 _module_status(inv, module))

    for resource in inv["resources"]:
        if resource["origin"] == "user-authored":
            _add(resource["name"], resource["kind"], "user-authored",
                 f"authored in this project at {resource.get('path')}",
                 "installed")

    unavailable = sorted(n for n, e in proposed.items()
                         if e["kind"] == "module" and e["status"] is None)
    notes = list(inv["notes"])
    if unavailable:
        notes.append("proposed module(s) neither installed nor in the studio "
                     f"registry: {', '.join(unavailable)}")
    if det["outcome"] != detectlib.OUTCOME_CONFIDENT:
        notes.append(f"detection outcome '{det['outcome']}' — no "
                     "detection-derived suggestions; ask the operator what "
                     "this project is before widening the set")

    return {
        "recommend_version": RECOMMEND_VERSION,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "project_root": str(root),
        "role": role,
        "detection_outcome": det["outcome"],
        "detected_type": det["top_candidate"],
        "vcs": det["vcs"]["type"],
        "proposal": sorted(proposed.values(), key=lambda e: e["name"]),
        "current_working_set": read_working_set(root).get(role),
        "notes": notes,
    }


# ----------------------------------------------------------------- record

def read_working_set(project_root: Path) -> dict:
    """The tracked working_set map ({} when unset); parse errors surface."""
    tracked = Path(project_root) / ".tk-studio" / configlib.TRACKED_NAME
    if not tracked.is_file():
        return {}
    data = configlib._load_yaml(tracked)
    value = data.get("working_set")
    return value if isinstance(value, dict) else {}


def _block_extent(lines: list[str], start: int) -> int:
    """Index one past the last line of the block opened at lines[start]."""
    indent = len(lines[start]) - len(lines[start].lstrip())
    i = start + 1
    while i < len(lines):
        line = lines[i]
        if line.strip() and (len(line) - len(line.lstrip())) <= indent:
            break
        i += 1
    # trailing blank/comment lines belong to the parent, not the block
    while i > start + 1 and not lines[i - 1].strip():
        i -= 1
    return i


def _render_role_block(role: str, resources: list[str]) -> list[str]:
    lines = [f"  {role}:"]
    lines.extend(f"    - {name}" for name in resources)
    return lines


def record(project_root: Path, role: str, resources: list[str],
           dry_run: bool = False) -> dict:
    """Land a confirmed working set at working_set.<role> in tracked config.

    Text surgery, not a YAML round trip: every comment and every other
    role's entry is preserved byte-for-byte (AD-17 — no role's confirmation
    overwrites another's). Idempotent: an identical set changes nothing.
    """
    root = Path(project_root).resolve()
    if not _ROLE_TOKEN_RE.match(role):
        raise RecommendError(f"role '{role}' is not a valid role token")
    resources = [r.strip() for r in resources if r.strip()]
    if not resources:
        raise RecommendError("a working set must name at least one resource "
                             "(recording an empty set is not a confirmation)")
    for name in resources:
        if not re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]*$", name):
            raise RecommendError(f"'{name}' is not a valid resource name")

    tracked = root / ".tk-studio" / configlib.TRACKED_NAME
    if not tracked.is_file():
        raise RecommendError(
            f"{tracked} does not exist — run project config standup first "
            "(uv run config.py standup)")

    text = tracked.read_text(encoding="utf-8")
    lines = text.splitlines()
    role_block = _render_role_block(role, resources)

    ws_idx = next((i for i, l in enumerate(lines)
                   if re.match(r"^working_set:\s*(#.*)?$", l)), None)
    if ws_idx is None:
        new_lines = lines + ["", "# Role-keyed working sets (AD-17) — recorded only on explicit",
                             "# confirmation via tk-studio-onboard; one entry per role.",
                             "working_set:"] + role_block
    else:
        ws_end = _block_extent(lines, ws_idx)
        role_idx = next((i for i in range(ws_idx + 1, ws_end)
                         if re.match(rf"^  {re.escape(role)}:\s*(#.*)?$", lines[i])),
                        None)
        if role_idx is None:
            new_lines = lines[:ws_end] + role_block + lines[ws_end:]
        else:
            role_end = _block_extent(lines, role_idx)
            new_lines = lines[:role_idx] + role_block + lines[role_end:]

    new_text = "\n".join(new_lines) + "\n"
    changed = new_text != text
    if changed and not dry_run:
        configlib.assert_tracked_safe(new_text, str(tracked))
        fd, tmp = tempfile.mkstemp(dir=tracked.parent, prefix=tracked.name,
                                   suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(new_text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, tracked)

    return {
        "project_root": str(root),
        "role": role,
        "resources": resources,
        "changed": changed,
        "dry_run": dry_run,
        "working_set": {**read_working_set(root),
                        **({role: resources} if dry_run else {})},
    }


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio working-set recommendation")
    sub = parser.add_subparsers(dest="command", required=True)

    prop = sub.add_parser("propose", help="evidence-backed proposal (read-only)")
    prop.add_argument("--directory", required=True, help="project root")
    prop.add_argument("--role", help="override the per-user store role")
    prop.add_argument("--lock", help="module-registry path (tests)")
    prop.add_argument("--profiles-dir", help="detection profiles dir (tests)")

    rec = sub.add_parser("record", help="record a confirmed set (the write)")
    rec.add_argument("--directory", required=True, help="project root")
    rec.add_argument("--role", required=True)
    rec.add_argument("--resources", required=True,
                     help="comma-separated confirmed resource names")
    rec.add_argument("--dry-run", action="store_true",
                     help="show the resulting entry without writing")

    args = parser.parse_args(argv)
    try:
        if args.command == "propose":
            result = propose(Path(args.directory), role=args.role,
                             lock_path=args.lock,
                             profiles_dir=Path(args.profiles_dir)
                             if args.profiles_dir else None)
        else:
            result = record(Path(args.directory), args.role,
                            args.resources.split(","), dry_run=args.dry_run)
        print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
        return 0
    except (RecommendError, inventorylib.InventoryError, detectlib.DetectError,
            configlib.ClassificationError, configlib.ConfigError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
