"""Backlog.md projection backend (ST-3.4, AD-5/AD-6).

Projects canonical entities into a Backlog.md-compatible `backlog/` folder:
epic -> milestone file + label linkage, story/task -> task file. The folder
is a *projection of the canonical files, never authoritative* (AD-5): promote
is canonical -> backlog, pull-back applies **status-class fields only**
(status, assignee) back onto canonical files, with echo suppression via the
`external.backlog-md` snapshot and both-changed conflicts surfaced for a
human, never silently resolved.

Verified against Backlog.md 1.48.0 (the pinned version) on 2026-07-27:
  - `task edit` DROPS unknown frontmatter keys — the spine's deferred
    question, answered. Projection therefore writes native keys only and
    carries the canonical id as the first label (the ruled fallback).
  - Native shapes captured from the CLI: task files
    `backlog/tasks/task-N - Title-slug.md` (id TASK-N, flow-list empties,
    quoted 'yyyy-mm-dd hh:mm' dates, SECTION-marked Description body),
    milestone files `backlog/milestones/m-N - slug.md`, `config.yml` with
    statuses ["To Do", "In Progress", "Done"]; tasks reference milestones by
    title.
  - Backlog.md task files use flow lists (outside the miniyaml subset), so
    pull-back extracts status-class fields by line, never a full YAML parse.

Status mapping is deliberately coarse -> the stock three columns; round-trip
stability (AD-5) comes from the snapshot: a canonical `review` promotes as
"In Progress", and an unchanged "In Progress" on pull-back is an echo, so
the finer local value survives.

Library only — sequenced by plansync.sync (the adapter front door). Writes
canonical frontmatter via lib/interchange.py (the adapter is the sole writer
of canonical keys, AD-4). Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import hashlib
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import interchange

TO_BACKEND_STATUS = {
    "draft": "To Do", "ready": "To Do",
    "in-progress": "In Progress", "blocked": "In Progress",
    "review": "In Progress",
    "done": "Done",
    # dropped: not projected (see promote notes)
}
FROM_BACKEND_STATUS = {
    "To Do": "ready", "In Progress": "in-progress", "Done": "done",
}

BINDING = "backlog-md"
CONFIG_TEMPLATE = """\
project_name: "{name}"
default_status: "To Do"
statuses: ["To Do", "In Progress", "Done"]
labels: []
date_format: yyyy-mm-dd
task_prefix: "task"
"""

TASK_KEY_RE = re.compile(r"^(?:task|TASK)-(\d+)")
MILESTONE_KEY_RE = re.compile(r"^m-(\d+)")


def backlog_root(project_root: Path) -> Path:
    return Path(project_root) / "backlog"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _backlog_date(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso).strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix="bl", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _slug(title: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*]', "", title).strip()
    return re.sub(r"\s+", "-", cleaned) or "untitled"


def _yaml_value(text: str) -> str:
    if text and not re.search(r'[:#\'"\[\]{}]', text) and text == text.strip():
        return text
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _content_hash(*parts: str) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part.encode("utf-8"))
        digest.update(b"\x00")
    return digest.hexdigest()


# ------------------------------------------------------------------ entities

def _load_entities(plan_dir: Path) -> list[tuple[Path, dict, str]]:
    """(path, frontmatter, body) for every canonical entity, id order."""
    if not plan_dir.is_dir():
        return []
    paths, _ = interchange.scan_entities(plan_dir)
    loaded = []
    for path in paths:
        try:
            front, body = interchange.parse_entity(path)
        except interchange.InterchangeError:
            continue
        if isinstance(front.get("id"), str):
            loaded.append((path, front, body))
    loaded.sort(key=lambda item: item[1]["id"])
    return loaded


def _write_canonical(path: Path, front: dict, body: str, dry_run: bool) -> None:
    if not dry_run:
        _atomic_write(path, interchange.render_entity(front, body))


# ------------------------------------------------------------ key allocation

def _existing_numbers(root: Path, pattern: re.Pattern, *dirs: str) -> set[int]:
    numbers: set[int] = set()
    for sub in dirs:
        folder = root / sub
        if not folder.is_dir():
            continue
        for path in folder.glob("*.md"):
            match = pattern.match(path.name)
            if match:
                numbers.add(int(match.group(1)))
    return numbers


class KeyAllocator:
    def __init__(self, start: int, taken: set[int]):
        self._next = max(taken, default=start - 1) + 1

    def allocate(self) -> int:
        value = self._next
        self._next += 1
        return value


# ------------------------------------------------------------------ rendering

def _render_task(key: str, front: dict, body: str, milestone: str | None,
                 dep_keys: list[str], created: str,
                 updated: str | None) -> str:
    lines = ["---",
             f"id: {key.upper()}",
             f"title: {_yaml_value(front['title'])}",
             f"status: {TO_BACKEND_STATUS[front['status']]}"]
    assignee = front.get("assignee")
    if assignee:
        lines += ["assignee:", f"  - {_yaml_value(assignee)}"]
    else:
        lines.append("assignee: []")
    lines.append(f"created_date: '{created}'")
    if updated:
        lines.append(f"updated_date: '{updated}'")
    labels = [front["id"]] + [l for l in front.get("labels") or []]
    lines.append("labels:")
    lines += [f"  - {_yaml_value(label)}" for label in labels]
    if milestone:
        lines.append(f"milestone: {_yaml_value(milestone)}")
    if dep_keys:
        lines.append("dependencies:")
        lines += [f"  - {dep}" for dep in dep_keys]
    else:
        lines.append("dependencies: []")
    lines += ["---", "", "## Description", "",
              "<!-- SECTION:DESCRIPTION:BEGIN -->",
              body.strip("\n"),
              "<!-- SECTION:DESCRIPTION:END -->"]
    return "\n".join(lines) + "\n"


def _render_milestone(key: str, title: str) -> str:
    return (f"---\nid: {key}\ntitle: {_yaml_value(title)}\n---\n\n"
            f"## Description\n\nMilestone: {title}\n")


def _find_by_key(root: Path, key: str, *dirs: str) -> Path | None:
    for sub in dirs:
        folder = root / sub
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob(f"{key} - *.md")):
            return path
    return None


# ------------------------------------------------------------------ pull-back

def _read_status_class(text: str) -> dict | None:
    """{status, assignee} from a Backlog.md task file, line-based (their
    frontmatter uses flow lists — outside the miniyaml subset)."""
    parts = interchange.split_frontmatter(text)
    if parts is None:
        return None
    raw = parts[0]
    status_m = re.search(r"^status:[ \t]*(.+?)[ \t]*$", raw, re.MULTILINE)
    status = status_m.group(1).strip("'\"") if status_m else None
    assignee = None
    assignee_m = re.search(r"^assignee:[ \t]*(.*?)[ \t]*$", raw, re.MULTILINE)
    if assignee_m:
        value = assignee_m.group(1)
        if value in ("", "[]"):
            block = re.search(r"^assignee:\s*\n((?:[ \t]+-[ \t]*.+\n?)+)",
                              raw, re.MULTILINE)
            if block:
                first = block.group(1).splitlines()[0]
                assignee = first.split("-", 1)[1].strip().strip("'\"") or None
        elif value.startswith("["):
            inner = value.strip("[]").split(",")[0].strip().strip("'\"")
            assignee = inner or None
        else:
            assignee = value.strip("'\"") or None
    return {"status": status, "assignee": assignee}


def pull_back(project_root: Path, plan_dir: Path, dry_run: bool = False) -> dict:
    """Apply backend status-class changes onto canonical files (AD-5).

    Echo suppression: a backend value equal to the last-promote snapshot is
    ignored. Both-changed entities are conflicts — reported, never resolved.
    """
    root = backlog_root(project_root)
    applied, conflicts, notes = [], [], []
    for path, front, body in _load_entities(plan_dir):
        snapshot = (front.get("external") or {}).get(BINDING)
        if not isinstance(snapshot, dict) or front["type"] == "epic":
            continue
        task_file = _find_by_key(root, snapshot.get("key", ""),
                                 "tasks", "completed", "archive/tasks")
        if task_file is None:
            notes.append(f"{front['id']}: projected task "
                         f"{snapshot.get('key')} not found in backlog/")
            continue
        backend = _read_status_class(task_file.read_text(encoding="utf-8"))
        if backend is None or backend["status"] is None:
            notes.append(f"{front['id']}: {task_file.name} has no readable status")
            continue

        changes: dict[str, object] = {}
        conflict_fields: list[str] = []
        snap_backend_status = snapshot.get("status")
        snap_canonical_status = snapshot.get("canonical_status")
        if backend["status"] != snap_backend_status:
            mapped = FROM_BACKEND_STATUS.get(backend["status"])
            if mapped is None:
                notes.append(f"{front['id']}: backend status "
                             f"{backend['status']!r} has no canonical mapping "
                             f"— left as-is")
            elif front["status"] != snap_canonical_status and \
                    front["status"] != mapped:
                conflict_fields.append(
                    f"status: canonical={front['status']!r} "
                    f"backend={backend['status']!r} "
                    f"(promoted: {snap_canonical_status!r})")
            elif front["status"] != mapped:
                changes["status"] = mapped

        snap_assignee = snapshot.get("assignee") or None
        if backend["assignee"] != snap_assignee:
            if (front.get("assignee") or None) != snap_assignee and \
                    (front.get("assignee") or None) != backend["assignee"]:
                conflict_fields.append(
                    f"assignee: canonical={front.get('assignee')!r} "
                    f"backend={backend['assignee']!r}")
            elif (front.get("assignee") or None) != backend["assignee"]:
                changes["assignee"] = backend["assignee"]

        if conflict_fields:
            conflicts.append({"id": front["id"], "canonical": str(path),
                              "backend": str(task_file),
                              "fields": conflict_fields})
            continue
        if not changes:
            continue
        if "status" in changes:
            front["status"] = changes["status"]
            snapshot["status"] = backend["status"]
            snapshot["canonical_status"] = changes["status"]
        if "assignee" in changes:
            if changes["assignee"] is None:
                front.pop("assignee", None)
            else:
                front["assignee"] = changes["assignee"]
            snapshot["assignee"] = changes["assignee"] or ""
        front["updated"] = _now_iso()
        snapshot["synced_at"] = _now_iso()
        _write_canonical(path, front, body, dry_run)
        applied.append({"id": front["id"],
                        "fields": sorted(changes),
                        "path": str(path)})
    return {"applied": applied, "conflicts": conflicts, "notes": notes}


# -------------------------------------------------------------------- promote

def promote(project_root: Path, plan_dir: Path, dry_run: bool = False) -> dict:
    """Project canonical entities into backlog/ and record snapshots."""
    root = backlog_root(project_root)
    entities = _load_entities(plan_dir)
    notes, written = [], []

    config = root / "config.yml"
    if not config.exists() and not dry_run:
        _atomic_write(config, CONFIG_TEMPLATE.format(
            name=Path(project_root).resolve().name))
        written.append(str(config))

    task_alloc = KeyAllocator(1, _existing_numbers(
        root, TASK_KEY_RE, "tasks", "completed", "drafts", "archive/tasks"))
    ms_alloc = KeyAllocator(0, _existing_numbers(root, MILESTONE_KEY_RE,
                                                 "milestones",
                                                 "archive/milestones"))

    # Pass 1: every projectable entity gets its backend key.
    keys: dict[str, str] = {}
    for _, front, _ in entities:
        snapshot = (front.get("external") or {}).get(BINDING)
        if isinstance(snapshot, dict) and snapshot.get("key"):
            keys[front["id"]] = snapshot["key"]
        elif front["status"] == "dropped":
            continue
        elif front["type"] == "epic":
            keys[front["id"]] = f"m-{ms_alloc.allocate()}"
        else:
            keys[front["id"]] = f"task-{task_alloc.allocate()}"

    epic_titles = {front["id"]: front["title"]
                   for _, front, _ in entities if front["type"] == "epic"}

    # Pass 2: render + write, snapshot on the canonical side.
    for path, front, body in entities:
        if front["status"] == "dropped":
            notes.append(f"{front['id']}: dropped — not projected"
                         + ("" if front["id"] not in keys else
                            f" (existing {keys[front['id']]} left in place; "
                            f"the projection is never authoritative)"))
            continue
        if front["id"] not in keys:
            continue
        key = keys[front["id"]]
        if front["type"] == "epic":
            content = _render_milestone(key, front["title"])
            content_hash = _content_hash(front["title"])
            target_dir, kind = root / "milestones", "milestone"
        else:
            milestone = epic_titles.get(front.get("parent") or "")
            dep_keys = [keys[d] for d in front.get("depends_on") or []
                        if d in keys]
            created = _backlog_date(front["created"])
            snapshot = (front.get("external") or {}).get(BINDING) or {}
            first_promote = not snapshot.get("key")
            content = _render_task(
                key, front, body, milestone, dep_keys, created,
                None if first_promote else _backlog_date(_now_iso()))
            content_hash = _content_hash(
                front["title"], front["status"], front.get("assignee") or "",
                ",".join(front.get("labels") or []), body)
            target_dir, kind = root / "tasks", "task"

        snapshot = (front.get("external") or {}).get(BINDING) or {}
        existing = _find_by_key(root, key, str(target_dir.relative_to(root)))
        target = target_dir / f"{key} - {_slug(front['title'])}.md"
        unchanged = (snapshot.get("content_hash") == content_hash
                     and existing is not None and existing == target)
        if unchanged:
            continue
        if not dry_run:
            _atomic_write(target, content)
            if existing is not None and existing != target:
                existing.unlink()  # projection rename; never authoritative
        written.append(str(target))

        snapshot.update({"key": key, "synced_at": _now_iso(),
                         "content_hash": content_hash})
        if kind == "task":
            snapshot["status"] = TO_BACKEND_STATUS[front["status"]]
            snapshot["canonical_status"] = front["status"]
            snapshot["assignee"] = front.get("assignee") or ""
        front.setdefault("external", {})[BINDING] = snapshot
        front["updated"] = _now_iso()
        _write_canonical(path, front, body, dry_run)

    return {"written": written, "notes": notes,
            "entities": len(entities), "backlog": str(root)}


def project(project_root: Path, plan_dir: Path, dry_run: bool = False) -> dict:
    """Full projection round: pull-back first (ingest human board edits),
    then promote (push canonical state)."""
    pulled = pull_back(project_root, plan_dir, dry_run=dry_run)
    promoted = promote(project_root, plan_dir, dry_run=dry_run)
    return {"binding": BINDING, "action": "projected",
            "pull_back": pulled, "promote": promoted,
            "conflicts": pulled["conflicts"]}
