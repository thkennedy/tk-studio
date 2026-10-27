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
            Story 34.5: `record --mcp <name>` is the one writer of the
            project root's `.mcp.json` — `<name>` confirmed and named by a
            profile's `suggests_mcp`; it merges `mcpServers.<name>` (the URL
            and bearer as `${TK_ENGINE_MCP_URL:-}` / `${TK_ENGINE_MCP_BEARER:-}`,
            never a value; the empty default keeps the file parseable in a
            session where the supervisor set neither), leaves every other
            server untouched, is idempotent (an entry in the earlier
            `${VAR}` form is rewritten), honours --dry-run and writes
            atomically. With --role/--resources too, the MCP name and the
            `.mcp.json` are checked before either write.

Proposal sources, each a named evidence line per resource:
  role-default    conservative per-role module base (v1 roles; new roles are
                  configuration, not architecture)
  detection       the confident profile's `suggests`, citing type + score +
                  the markers that fired; its `suggests_skills` (Story 34.4)
                  join as `kind: skill` entries, resolved against the plugin's
                  own skills/<name>/SKILL.md, with `engine-pin:` evidence and
                  any version `warnings[]` (also appended to `notes`); its
                  `suggests_mcp` (Story 34.5) join as `kind: mcp` entries with
                  `kb:` evidence, status `configured` when the project's
                  `.mcp.json` already has `mcpServers.<name>`, else
                  `not-configured` — proposing never writes `.mcp.json`
  user-authored   the project's own resources (first-class path, AD-17)

CLI:
  uv run recommend.py propose --directory DIR [--role ROLE]
  uv run recommend.py record  --directory DIR --role ROLE --resources a,b,c [--dry-run]
  uv run recommend.py record  --directory DIR --mcp NAME [--dry-run]

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
import engine_pin as enginepinlib
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

# Story 34.4: plugin-shipped skills a confident profile suggests resolve here
PLUGIN_ROOT = Path(__file__).resolve().parent.parent

# Story 34.5: the engine MCP's spike record, and the one `.mcp.json` entry
# shape `record --mcp` merges (the supervisor passes both values into the
# sandbox by name for an editor-in-the-loop run; the file carries no secret).
# The `${VAR:-}` default form: Claude Code refuses a `.mcp.json` whose `${VAR}`
# has no default and is unset, and every session but a flagged run's own (the
# host, an interactive one, an unflagged run: `buildWorkerEnv` strips
# `TK_ENGINE_MCP_*`) has both unset.
ENGINE_MCP_KB = "kb/engine-mcp-godot.md"
MCP_JSON_NAME = ".mcp.json"
MCP_ENTRY = {
    "type": "http",
    "url": "${TK_ENGINE_MCP_URL:-}",
    "headers": {"Authorization": "Bearer ${TK_ENGINE_MCP_BEARER:-}"},
}
_MCP_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


class RecommendError(Exception):
    """Bad invocation, unknown role shape, or unwritable config."""


# ---------------------------------------------------------------- propose

def _skill_status(name: str) -> str | None:
    """`installed` when the plugin ships skills/<name>/SKILL.md."""
    return "installed" if (PLUGIN_ROOT / "skills" / name / "SKILL.md").is_file() else None


def _engine_pin(root: Path, name: str) -> tuple[str | None, list[str]]:
    """(engine-pin evidence, warnings) for a skill carrying a pin.json;
    (None, []) for one that does not. A refusal reads as a warning: the
    operator decides, and the warning makes the mismatch visible."""
    if not (PLUGIN_ROOT / "skills" / name / "pin.json").is_file():
        return None, []
    try:
        result = enginepinlib.check(root, name)
    except enginepinlib.Refusal as exc:
        return f"engine pin not checked: {exc}", [f"engine pin not checked: {exc}"]
    supported = f"supported {result['supported']['min']}..{result['supported']['below']}"
    if result["pinned"] is None:
        return f"pinned version unreadable; {supported}", list(result["warnings"])
    source = ("global.json" if result["pinned"] == result["godot_net_sdk"]
              else "project.godot")
    return (f"pinned {result['pinned']} from {source}; {supported}",
            list(result["warnings"]))


def _mcp_status(root: Path, name: str) -> str:
    """`configured` when the project's .mcp.json has mcpServers.<name>, else
    `not-configured` (an absent or unreadable file included). Pure read."""
    try:
        data = json.loads((root / MCP_JSON_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "not-configured"
    servers = data.get("mcpServers") if isinstance(data, dict) else None
    return "configured" if isinstance(servers, dict) and name in servers else "not-configured"


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
    skill_notes: list[str] = []

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
        for skill in top.get("suggests_skills", []):
            _add(skill, "skill", "detection",
                 f"detected {top['id']} (score {top['score']} ≥ floor "
                 f"{top['confidence_min']}): {fired}",
                 _skill_status(skill))
            evidence, warnings = _engine_pin(root, skill)
            if evidence is not None:
                proposed[skill]["evidence"].append(f"engine-pin: {evidence}")
            if warnings:
                proposed[skill]["warnings"] = warnings
                skill_notes.extend(f"{skill}: {w}" for w in warnings)
        for mcp in top.get("suggests_mcp", []):
            _add(mcp, "mcp", "detection",
                 f"detected {top['id']} (score {top['score']} ≥ floor "
                 f"{top['confidence_min']}): {fired}",
                 _mcp_status(root, mcp))
            proposed[mcp]["evidence"].append(f"kb: {ENGINE_MCP_KB}")

    for resource in inv["resources"]:
        if resource["origin"] == "user-authored":
            _add(resource["name"], resource["kind"], "user-authored",
                 f"authored in this project at {resource.get('path')}",
                 "installed")

    unavailable = sorted(n for n, e in proposed.items()
                         if e["kind"] == "module" and e["status"] is None)
    unavailable_skills = sorted(n for n, e in proposed.items()
                                if e["kind"] == "skill" and e["status"] is None)
    notes = list(inv["notes"])
    if unavailable:
        notes.append("proposed module(s) neither installed nor in the studio "
                     f"registry: {', '.join(unavailable)}")
    if unavailable_skills:
        notes.append("proposed skill(s) not shipped in the studio plugin: "
                     f"{', '.join(unavailable_skills)}")
    notes.extend(skill_notes)
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


# ------------------------------------------------------------- record --mcp

def suggested_mcps(profiles_dir: Path | None = None) -> set[str]:
    """Every engine MCP name a detection profile's `suggests_mcp` names."""
    names: set[str] = set()
    for profile in detectlib.load_profiles(profiles_dir or detectlib.DEFAULT_PROFILES_DIR):
        value = profile.get("suggests_mcp", [])
        if isinstance(value, list):
            names.update(n for n in value if isinstance(n, str))
    return names


def record_mcp(project_root: Path, name: str, dry_run: bool = False,
               profiles_dir: Path | None = None) -> dict:
    """Merge the confirmed engine MCP into the project root's .mcp.json.

    The one writer of `.mcp.json` (Story 34.5): `name` must be named by a
    profile's `suggests_mcp`; `mcpServers.<name>` becomes MCP_ENTRY, every
    other key and server is left as it was. Idempotent (an entry already
    equal to MCP_ENTRY is not rewritten; one in any other form, the earlier
    `${VAR}` form without a default included, is replaced); --dry-run writes
    nothing and checks everything a write would; the write is atomic (temp
    file, fsync, os.replace).
    """
    root = Path(project_root).resolve()
    name = (name or "").strip()
    if not _MCP_NAME_RE.match(name):
        raise RecommendError(f"'{name}' is not a valid MCP server name")
    known = suggested_mcps(profiles_dir)
    if name not in known:
        raise RecommendError(
            f"'{name}' is not named by any detection profile's suggests_mcp "
            f"(known: {', '.join(sorted(known)) or 'none'}) — record only a "
            "confirmed, profile-suggested engine MCP")
    if not root.is_dir():
        raise RecommendError(f"project root {root} is not a directory")
    target = root / MCP_JSON_NAME
    text = None
    data: dict = {}
    if target.is_file():
        text = target.read_text(encoding="utf-8")
        try:
            loaded = json.loads(text)
        except ValueError as exc:
            raise RecommendError(f"{target} is not valid JSON: {exc}") from exc
        if not isinstance(loaded, dict):
            raise RecommendError(f"{target} is not a JSON object")
        data = loaded
    servers = data.get("mcpServers", {})
    if not isinstance(servers, dict):
        raise RecommendError(f"{target}: mcpServers is not an object")
    changed = servers.get(name) != MCP_ENTRY
    if changed:
        data = {**data, "mcpServers": {**servers, name: MCP_ENTRY}}
        if not dry_run:
            _atomic_write_json(target, data)
    return {
        "project_root": str(root),
        "mcp": name,
        "mcp_json": str(target),
        "entry": MCP_ENTRY,
        "changed": changed,
        "dry_run": dry_run,
    }


def _atomic_write_json(path: Path, data: dict) -> None:
    """indent 2 plus a trailing newline (job.py's JSON writer precedent)."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


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
    rec.add_argument("--role", help="required unless --mcp alone")
    rec.add_argument("--resources",
                     help="comma-separated confirmed resource names "
                          "(required with --role)")
    rec.add_argument("--mcp", help="Story 34.5: the confirmed engine MCP "
                                   "(a profile's suggests_mcp) to merge into "
                                   "the project's .mcp.json")
    rec.add_argument("--profiles-dir", help="detection profiles dir (tests)")
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
            if args.mcp is None and (args.role is None or args.resources is None):
                raise RecommendError("record needs --role and --resources, "
                                     "or --mcp")
            if (args.role is None) != (args.resources is None):
                raise RecommendError("--role and --resources go together")
            profiles = Path(args.profiles_dir) if args.profiles_dir else None
            if args.mcp is not None and args.role is not None:
                # The MCP name and the .mcp.json are checked before either
                # write: a refusal never leaves the working set half-recorded.
                record_mcp(Path(args.directory), args.mcp, dry_run=True,
                           profiles_dir=profiles)
            result = {}
            if args.role is not None:
                result = record(Path(args.directory), args.role,
                                args.resources.split(","), dry_run=args.dry_run)
            if args.mcp is not None:
                mcp = record_mcp(Path(args.directory), args.mcp,
                                 dry_run=args.dry_run, profiles_dir=profiles)
                # With --role too: the working-set answer, the MCP's beside it.
                result = {**result, "mcp_record": mcp} if result else mcp
        print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
        return 0
    except (RecommendError, inventorylib.InventoryError, detectlib.DetectError,
            configlib.ClassificationError, configlib.ConfigError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
