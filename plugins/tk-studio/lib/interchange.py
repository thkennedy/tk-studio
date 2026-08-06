"""Canonical planning interchange — parse, validate, render (ST-3.1, AD-6).

One entity per markdown file: YAML frontmatter (inside the miniyaml subset)
plus a markdown body. This module is the single shipped parser/validator for
the shape published in contracts/interchange/shape.v1.json — no adapter or
skill ships its own (the ST-3.1 contract). Required keys: shape_version, id,
type, title, status (closed enum), created/updated (ISO-8601). Optional:
parent, depends_on, priority, assignee, labels, external.<binding>.

Unknown frontmatter keys are preserved and ignored: normalization (ST-3.2)
repairs canonical keys in place without dropping upstream content (AD-4).
A markdown file counts as an entity iff its frontmatter carries
shape_version; directory validation skips everything else.

Set validation adds the cross-file rules the sync layer blocks on: duplicate
ids (both paths named — AD-4), parent references that are missing or the
wrong type, and dangling depends_on.

CLI:
  uv run interchange.py validate --file PATH
  uv run interchange.py validate --directory DIR

Exit codes: 0 valid; 2 validation errors/refusal; 1 unexpected failure.
Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import miniyaml

SHAPE_VERSION = 1
ENTITY_TYPES = ("epic", "story", "task")
STATUS_VALUES = ("draft", "ready", "in-progress", "blocked", "review", "done", "dropped")
PRIORITY_VALUES = ("P0", "P1", "P2", "P3")
EXTERNAL_REQUIRED = ("key", "synced_at", "content_hash")

PREFIX_BY_TYPE = {"epic": "EP", "story": "ST", "task": "TA"}
PARENT_PREFIX_BY_TYPE = {"story": "EP", "task": "ST"}
ID_RE = re.compile(r"^(EP|ST|TA)-\d{3,}$")

REQUIRED_KEYS = ("shape_version", "id", "type", "title", "status", "created", "updated")

# Canonical key order for render_entity; unknown keys follow in source order.
CANONICAL_ORDER = ("shape_version", "id", "type", "title", "status", "created",
                   "updated", "parent", "depends_on", "priority", "assignee",
                   "labels", "external")

_FRONTMATTER_RE = re.compile(r"^---\r?\n(.*?)^---[ \t]*\r?\n?", re.DOTALL | re.MULTILINE)


class InterchangeError(Exception):
    """Refusal or unparseable entity file; message is safe to surface."""


# ------------------------------------------------------------------- parsing

def split_frontmatter(text: str) -> tuple[str, str] | None:
    """(raw frontmatter, body) if the text opens with a --- block, else None."""
    if not text.startswith("---"):
        return None
    match = _FRONTMATTER_RE.match(text)
    if not match:
        return None
    return match.group(1), text[match.end():]


def parse_entity(path: Path) -> tuple[dict, str]:
    """(frontmatter, body) for an entity file; raises on unparseable input."""
    text = Path(path).read_text(encoding="utf-8")
    parts = split_frontmatter(text)
    if parts is None:
        raise InterchangeError(f"{path}: no YAML frontmatter block")
    raw, body = parts
    try:
        front = miniyaml.loads(raw)
    except miniyaml.MiniYamlError as exc:
        raise InterchangeError(f"{path}: frontmatter outside the miniyaml subset: {exc}") from exc
    return front, body


def render_entity(front: dict, body: str) -> str:
    """Serialize frontmatter + body; canonical keys first, then unknown keys."""
    ordered = {k: front[k] for k in CANONICAL_ORDER if k in front}
    ordered.update({k: v for k, v in front.items() if k not in ordered})
    if body and not body.startswith(("\n", "\r\n")):
        body = "\n" + body
    return "---\n" + miniyaml.dumps(ordered) + "---\n" + body


# ---------------------------------------------------------------- validation

def _is_iso(value: object) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        datetime.fromisoformat(value)
        return True
    except ValueError:
        return False


def _nonempty_str(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def validate_entity(front: dict) -> list[str]:
    """Frontmatter errors for one entity against shape.v1 (empty = valid)."""
    errors: list[str] = []
    if not isinstance(front, dict):
        return ["frontmatter must be a mapping"]

    missing = [k for k in REQUIRED_KEYS if k not in front]
    if missing:
        errors.append(f"missing required keys: {', '.join(missing)}")

    if "shape_version" in front and front["shape_version"] != SHAPE_VERSION:
        errors.append(f"shape_version must be {SHAPE_VERSION}, "
                      f"got {front['shape_version']!r}")

    entity_id = front.get("id")
    if "id" in front and (not isinstance(entity_id, str) or not ID_RE.match(entity_id)):
        errors.append(f"id must match EP-/ST-/TA-NNN, got {entity_id!r}")
        entity_id = None

    entity_type = front.get("type")
    if "type" in front and entity_type not in ENTITY_TYPES:
        errors.append(f"type must be one of {ENTITY_TYPES}, got {entity_type!r}")
        entity_type = None
    if isinstance(entity_id, str) and entity_type in PREFIX_BY_TYPE and \
            not entity_id.startswith(PREFIX_BY_TYPE[entity_type] + "-"):
        errors.append(f"id {entity_id} does not match type {entity_type} "
                      f"(expected prefix {PREFIX_BY_TYPE[entity_type]}-)")

    if "title" in front and not _nonempty_str(front["title"]):
        errors.append(f"title must be a non-empty string, got {front['title']!r}")

    if "status" in front and front["status"] not in STATUS_VALUES:
        errors.append(f"status must be one of {STATUS_VALUES} (closed enum), "
                      f"got {front['status']!r}")

    for key in ("created", "updated"):
        if key in front and not _is_iso(front[key]):
            errors.append(f"{key} must be an ISO-8601 date-time string, "
                          f"got {front[key]!r}")

    if "parent" in front:
        parent = front["parent"]
        if entity_type == "epic":
            errors.append("an epic has no parent")
        elif not isinstance(parent, str) or not ID_RE.match(parent):
            errors.append(f"parent must be an entity id, got {parent!r}")
        elif entity_type in PARENT_PREFIX_BY_TYPE and \
                not parent.startswith(PARENT_PREFIX_BY_TYPE[entity_type] + "-"):
            errors.append(f"parent of a {entity_type} must be "
                          f"{PARENT_PREFIX_BY_TYPE[entity_type]}-NNN, got {parent}")

    if "depends_on" in front:
        deps = front["depends_on"]
        if not isinstance(deps, list):
            errors.append(f"depends_on must be a list of entity ids, got {deps!r}")
        else:
            for dep in deps:
                if not isinstance(dep, str) or not ID_RE.match(dep):
                    errors.append(f"depends_on entry must be an entity id, got {dep!r}")
                elif dep == entity_id:
                    errors.append(f"depends_on must not include the entity itself ({dep})")
            dupes = {d for d in deps if isinstance(d, str) and deps.count(d) > 1}
            if dupes:
                errors.append(f"depends_on has duplicates: {', '.join(sorted(dupes))}")

    if "priority" in front and front["priority"] not in PRIORITY_VALUES:
        errors.append(f"priority must be one of {PRIORITY_VALUES}, "
                      f"got {front['priority']!r}")

    if "assignee" in front and not _nonempty_str(front["assignee"]):
        errors.append(f"assignee must be a non-empty string, got {front['assignee']!r}")

    if "labels" in front:
        labels = front["labels"]
        if not isinstance(labels, list) or not all(_nonempty_str(l) for l in labels):
            errors.append(f"labels must be a list of non-empty strings, got {labels!r}")

    if "external" in front:
        external = front["external"]
        if not isinstance(external, dict):
            errors.append(f"external must be a map of binding -> sync state, "
                          f"got {external!r}")
        else:
            for binding, state in external.items():
                if not isinstance(state, dict):
                    errors.append(f"external.{binding} must be a mapping, got {state!r}")
                    continue
                for req in EXTERNAL_REQUIRED:
                    if req == "synced_at":
                        if not _is_iso(state.get(req)):
                            errors.append(f"external.{binding}.synced_at must be "
                                          f"ISO-8601, got {state.get(req)!r}")
                    elif not _nonempty_str(state.get(req)):
                        errors.append(f"external.{binding}.{req} must be a "
                                      f"non-empty string, got {state.get(req)!r}")
    return errors


# ------------------------------------------------------------ file/set level

def is_entity_text(text: str) -> bool:
    """True iff the raw frontmatter block carries shape_version (entity marker)."""
    parts = split_frontmatter(text)
    if parts is None:
        return False
    return re.search(r"^shape_version\s*:", parts[0], re.MULTILINE) is not None


def validate_file(path: Path) -> dict:
    """{path, id, type, errors} for one entity file."""
    path = Path(path)
    try:
        front, _body = parse_entity(path)
    except InterchangeError as exc:
        return {"path": str(path), "id": None, "type": None, "errors": [str(exc)]}
    return {"path": str(path),
            "id": front.get("id") if isinstance(front.get("id"), str) else None,
            "type": front.get("type"),
            "errors": validate_entity(front)}


def validate_set(paths: list[Path]) -> dict:
    """Per-file validation plus the cross-file rules sync blocks on (AD-4).

    Returns {ok, entities, files[], set_errors[]}. A duplicate id names both
    paths — the sync layer must block until renumbered, never pick a survivor.
    """
    files, fronts = [], {}
    for path in paths:
        record = validate_file(path)
        files.append(record)
        if not record["errors"]:
            fronts[record["path"]], _ = parse_entity(Path(path))
    set_errors: list[str] = []

    by_id: dict[str, list[dict]] = {}
    for record in files:
        if record["id"] and ID_RE.match(record["id"]):
            by_id.setdefault(record["id"], []).append(record)

    for entity_id, records in sorted(by_id.items()):
        if len(records) > 1:
            listed = ", ".join(sorted(r["path"] for r in records))
            set_errors.append(f"duplicate id {entity_id} in: {listed} — "
                              f"renumber before sync (AD-4)")

    # Parent *type* is enforced per-entity via the id prefix; here only existence.
    for record in files:
        front = fronts.get(record["path"])
        if front is None:
            continue
        parent = front.get("parent")
        if isinstance(parent, str) and ID_RE.match(parent) and parent not in by_id:
            set_errors.append(f"{record['path']}: parent {parent} not found in set")
        for dep in front.get("depends_on") or []:
            if isinstance(dep, str) and ID_RE.match(dep) and dep not in by_id:
                set_errors.append(f"{record['path']}: depends_on {dep} "
                                  f"not found in set")

    file_errors = any(r["errors"] for r in files)
    return {"ok": not file_errors and not set_errors,
            "entities": len(files),
            "files": files,
            "set_errors": set_errors}


def scan_entities(directory: Path) -> tuple[list[Path], int]:
    """(entity files under directory, count of non-entity .md skipped)."""
    directory = Path(directory)
    if not directory.is_dir():
        raise InterchangeError(f"{directory} is not a directory")
    entities, skipped = [], 0
    for path in sorted(directory.rglob("*.md")):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            skipped += 1
            continue
        if is_entity_text(text):
            entities.append(path)
        else:
            skipped += 1
    return entities, skipped


def validate_directory(directory: Path) -> dict:
    entities, skipped = scan_entities(directory)
    result = validate_set(entities)
    result["directory"] = str(Path(directory).resolve())
    result["skipped"] = skipped
    return result


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio canonical interchange")
    sub = parser.add_subparsers(dest="command", required=True)
    val = sub.add_parser("validate")
    target = val.add_mutually_exclusive_group(required=True)
    target.add_argument("--file", help="one entity file")
    target.add_argument("--directory", help="scan for entity files (shape_version marker)")

    args = parser.parse_args(argv)
    try:
        if args.file:
            record = validate_file(Path(args.file))
            ok = not record["errors"]
            print(json.dumps({"ok": ok, **record}, ensure_ascii=False, indent=2))
        else:
            result = validate_directory(Path(args.directory))
            ok = result["ok"]
            print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if ok else 2
    except InterchangeError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
