"""tk-studio planning adapter — normalize pass + id authority (ST-3.2, AD-4/AD-6).

Stock BMad planning skills stay untouched and write their native artifacts in
_bmad-output/ (AD-4, zero forks). This module owns canonicalization: after
stock flows run, `normalize` stamps/repairs the AD-6 canonical shape so the
normalized _bmad-output/ planning artifacts are the single canonical local
representation under every binding.

What normalize does, in order:
  1. Blocks if any two entity files under _bmad-output/ carry the same id —
     both paths named, nothing written until a human renumbers (AD-4).
  2. Parses planning-artifacts/epics.md ('## Epic N:' / '### Story N.M:'
     sections) and derives one canonical entity file per epic/story under
     planning-artifacts/plan/<ID>.md. Prior runs are matched by the `source`
     frontmatter key (e.g. "epics.md#story-3.1"), so ids never move. Section
     text is carried into the entity body verbatim; on re-run, title/parent/
     body refresh from the source while id, status, priority, assignee,
     labels, external and unknown keys are preserved. Invalid present values
     block (refuse-to-guess, AD-3 posture) — only *missing* keys are filled.
  3. Mints ids only from the committed per-project counter
     ({project-root}/.tk-studio/plan-counter.yaml): EP-/ST-/TA-NNN, document
     order, counter persisted atomically *before* entity files land (a crash
     leaves an id gap, never a duplicate; ids are never reused). A counter
     sitting behind already-used ids skips them and says so.
  4. Stamps `canonical_id` into matching implementation-artifacts story files
     (story-N.M.md) textually — one inserted/updated frontmatter line, every
     other byte preserved. Story files are references to the canonical
     entity, not entities themselves (one entity, one file).
  5. Pulls story status from implementation-artifacts/sprint-status.yaml when
     present and parseable, mapping BMad sprint states onto the closed
     canonical enum; unmappable states are reported, never guessed.

CLI:
  uv run plansync.py normalize --directory ROOT [--dry-run]
  uv run plansync.py validate --directory ROOT

Exit codes: 0 ok; 2 blocked/refusal; 1 unexpected failure.
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

import interchange
import miniyaml

COUNTER_VERSION = 1
COUNTER_REL = Path(".tk-studio") / "plan-counter.yaml"
PLANNING_REL = Path("_bmad-output") / "planning-artifacts"
PLAN_DIRNAME = "plan"
EPICS_FILENAME = "epics.md"
IMPL_REL = Path("_bmad-output") / "implementation-artifacts"
SPRINT_STATUS_FILENAME = "sprint-status.yaml"

EPIC_HEAD_RE = re.compile(r"^## Epic (\d+): (.+?)\s*$")
STORY_HEAD_RE = re.compile(r"^### Story (\d+)\.(\d+): (.+?)\s*$")
STORY_FILE_RE = re.compile(r"^story-(\d+)[.-](\d+)\.md$")
SPRINT_KEY_RE = re.compile(r"^(\d+)[.-](\d+)")

# BMad sprint states -> canonical closed enum; unmapped states are reported.
SPRINT_STATUS_MAP = {
    "backlog": "draft", "drafted": "draft",
    "ready": "ready", "ready-for-dev": "ready",
    "in-progress": "in-progress", "in-dev": "in-progress",
    "review": "review", "ready-for-review": "review",
    "blocked": "blocked",
    "done": "done",
    "dropped": "dropped", "cancelled": "dropped",
}


class PlanSyncError(Exception):
    """Refusal or blocked sync; message is safe to surface."""


def plan_dir(project_root: Path) -> Path:
    return Path(project_root) / PLANNING_REL / PLAN_DIRNAME


def counter_path(project_root: Path) -> Path:
    return Path(project_root) / COUNTER_REL


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


# ----------------------------------------------------------------- counter

def load_counter(project_root: Path) -> dict:
    path = counter_path(project_root)
    if not path.is_file():
        return {"counter_version": COUNTER_VERSION,
                "next": {"epic": 1, "story": 1, "task": 1}}
    try:
        data = miniyaml.load(path)
    except miniyaml.MiniYamlError as exc:
        raise PlanSyncError(f"counter unreadable: {path}: {exc}") from exc
    if data.get("counter_version") != COUNTER_VERSION:
        raise PlanSyncError(f"{path}: counter_version must be {COUNTER_VERSION}, "
                            f"got {data.get('counter_version')!r}")
    nxt = data.get("next")
    if not isinstance(nxt, dict) or \
            not all(isinstance(nxt.get(k), int) and nxt.get(k) >= 1
                    for k in ("epic", "story", "task")):
        raise PlanSyncError(f"{path}: 'next' must map epic/story/task to ints >= 1")
    return data


def save_counter(project_root: Path, counter: dict) -> None:
    _atomic_write(counter_path(project_root), miniyaml.dumps(counter))


class Minter:
    """Mints EP-/ST-/TA-NNN from the committed counter, skipping taken ids."""

    def __init__(self, project_root: Path, taken: set[str]):
        self.project_root = project_root
        self.counter = load_counter(project_root)
        self.taken = set(taken)
        self.minted: list[str] = []
        self.skipped: list[str] = []

    def mint(self, kind: str) -> str:
        prefix = interchange.PREFIX_BY_TYPE[kind]
        while True:
            n = self.counter["next"][kind]
            self.counter["next"][kind] = n + 1
            candidate = f"{prefix}-{n:03d}"
            if candidate not in self.taken:
                self.taken.add(candidate)
                self.minted.append(candidate)
                return candidate
            # ids are never reused: a counter behind existing ids skips them.
            self.skipped.append(candidate)

    def persist(self) -> None:
        save_counter(self.project_root, self.counter)


# ------------------------------------------------------------ epics parsing

def parse_epics_doc(text: str) -> list[dict]:
    """Ordered epic/story sections from a BMad epics.md body.

    Epic body is the text between its heading and its first story (or next
    h2); story body is its full section. Both are carried verbatim.
    """
    parts = interchange.split_frontmatter(text)
    body = parts[1] if parts else text
    lines = body.splitlines()

    entities: list[dict] = []
    current: dict | None = None

    def close(upto: int) -> None:
        nonlocal current
        if current is not None:
            current["body"] = "\n".join(lines[current["start"]:upto]).strip("\n")
            entities.append(current)
            current = None

    for i, line in enumerate(lines):
        epic_m = EPIC_HEAD_RE.match(line)
        story_m = STORY_HEAD_RE.match(line)
        if epic_m:
            close(i)
            current = {"kind": "epic", "key": f"epic-{epic_m.group(1)}",
                       "num": epic_m.group(1), "title": epic_m.group(2),
                       "start": i + 1}
        elif story_m:
            close(i)
            epic_num = story_m.group(1)
            current = {"kind": "story",
                       "key": f"story-{epic_num}.{story_m.group(2)}",
                       "num": f"{epic_num}.{story_m.group(2)}",
                       "epic_num": epic_num,
                       "title": story_m.group(3), "start": i + 1}
        elif line.startswith("## ") and current is not None:
            close(i)
    close(len(lines))
    return entities


# ------------------------------------------------------------- normalization

def _scan_canonical(bmad_output: Path) -> tuple[list[Path], dict]:
    """(entity files under _bmad-output, source_key -> path map)."""
    if not bmad_output.is_dir():
        return [], {}
    entity_paths, _ = interchange.scan_entities(bmad_output)
    by_source: dict[str, Path] = {}
    for path in entity_paths:
        try:
            front, _ = interchange.parse_entity(path)
        except interchange.InterchangeError:
            continue
        source = front.get("source")
        if isinstance(source, str) and source not in by_source:
            by_source[source] = path
    return entity_paths, by_source


def _repair(front: dict, section: dict, parent_id: str | None,
            errors: list[str], path: Path) -> dict:
    """Refresh source-derived keys, fill missing keys, refuse invalid ones."""
    repaired = dict(front)
    repaired["shape_version"] = repaired.get("shape_version", interchange.SHAPE_VERSION)
    repaired["type"] = repaired.get("type", section["kind"])
    if repaired["type"] != section["kind"]:
        errors.append(f"{path}: type {repaired['type']!r} contradicts source "
                      f"{section['key']!r} — fix by hand")
    repaired["title"] = section["title"]
    if "status" not in front:
        repaired["status"] = "draft"
    if "created" not in front:
        repaired["created"] = _now()
    if "updated" not in front:
        repaired["updated"] = repaired["created"]
    if parent_id:
        repaired["parent"] = parent_id
    repaired["source"] = f"{EPICS_FILENAME}#{section['key']}"
    return repaired


def _stamp_story_file(path: Path, canonical_id: str, dry_run: bool) -> str:
    """Textually insert/refresh one `canonical_id:` line; every other byte kept."""
    text = path.read_text(encoding="utf-8")
    line = f"canonical_id: {canonical_id}"
    stamp_re = re.compile(r"^canonical_id:\s*(\S+)\s*$", re.MULTILINE)
    if text.startswith("---"):
        existing = stamp_re.search(text)
        if existing:
            if existing.group(1) == canonical_id:
                return "unchanged"
            new_text = stamp_re.sub(line, text, count=1)
        else:
            newline = "\r\n" if text.startswith("---\r\n") else "\n"
            new_text = text.replace("---" + newline, "---" + newline + line + newline, 1)
    else:
        new_text = f"---\n{line}\n---\n\n{text}"
    if not dry_run:
        _atomic_write(path, new_text)
    return "stamped"


def _load_sprint_status(impl_dir: Path, notes: list[str]) -> dict[str, str]:
    """story num ('N.M') -> canonical status, from BMad sprint-status.yaml."""
    path = impl_dir / SPRINT_STATUS_FILENAME
    if not path.is_file():
        return {}
    try:
        data = miniyaml.load(path)
    except miniyaml.MiniYamlError as exc:
        notes.append(f"sprint-status skipped (outside miniyaml subset): {exc}")
        return {}
    status_map = data.get("development-status") or data.get("development_status")
    if not isinstance(status_map, dict):
        notes.append("sprint-status skipped: no development-status map")
        return {}
    result: dict[str, str] = {}
    for key, value in status_map.items():
        key_m = SPRINT_KEY_RE.match(str(key))
        if not key_m:
            continue
        canonical = SPRINT_STATUS_MAP.get(str(value).strip().lower())
        if canonical is None:
            notes.append(f"sprint-status: unmapped state {value!r} for {key!r} "
                         f"— left as-is (closed enum, AD-6)")
            continue
        result[f"{key_m.group(1)}.{key_m.group(2)}"] = canonical
    return result


def normalize(project_root: Path, dry_run: bool = False) -> dict:
    project_root = Path(project_root).resolve()
    planning = project_root / PLANNING_REL
    impl = project_root / IMPL_REL
    bmad_output = project_root / "_bmad-output"
    target_dir = plan_dir(project_root)
    notes: list[str] = []
    errors: list[str] = []

    # 1. Duplicate ids block before anything is written (AD-4).
    entity_paths, by_source = _scan_canonical(bmad_output)
    pre = interchange.validate_set(entity_paths)
    duplicates = [e for e in pre["set_errors"] if "duplicate id" in e]
    if duplicates:
        return {"ok": False, "blocked": True, "errors": duplicates,
                "reason": "duplicate ids block sync until renumbered (AD-4)"}

    taken = {r["id"] for r in pre["files"] if r["id"]}
    epics_path = planning / EPICS_FILENAME
    sections = []
    if epics_path.is_file():
        sections = parse_epics_doc(epics_path.read_text(encoding="utf-8"))
    else:
        notes.append(f"{epics_path} not found — nothing to derive")

    # 2/3. Plan the whole run first, minting in document order; the counter
    # is persisted before any entity file lands.
    minter = Minter(project_root, taken)
    epic_ids: dict[str, str] = {}
    planned: list[dict] = []
    for section in sections:
        source_key = f"{EPICS_FILENAME}#{section['key']}"
        existing_path = by_source.get(source_key)
        parent_id = epic_ids.get(section.get("epic_num")) if section["kind"] == "story" else None

        if existing_path is not None:
            front, body = interchange.parse_entity(existing_path)
            # Missing keys are what repair fills; only *invalid present* values
            # block (refuse-to-guess). Title is refreshed from source anyway.
            entity_errors = [
                e for e in interchange.validate_entity(front)
                if not e.startswith("missing required keys")
                and not e.startswith("title ")]
            if entity_errors:
                errors.extend(f"{existing_path}: {e}" for e in entity_errors)
                if section["kind"] == "epic" and isinstance(front.get("id"), str):
                    epic_ids[section["num"]] = front["id"]
                continue
            repaired = _repair(front, section, parent_id, errors, existing_path)
            if "id" not in repaired:
                repaired["id"] = minter.mint(section["kind"])
            new_body = "\n" + section["body"] + "\n"
            changed = repaired != front or new_body != body
            if changed:
                repaired["updated"] = _now()
            planned.append({"path": existing_path, "front": repaired,
                            "body": new_body,
                            "action": "repaired" if changed else "unchanged"})
            entity_id = repaired["id"]
        else:
            entity_id = minter.mint(section["kind"])
            now = _now()
            front = {"shape_version": interchange.SHAPE_VERSION, "id": entity_id,
                     "type": section["kind"], "title": section["title"],
                     "status": "draft", "created": now, "updated": now,
                     "source": source_key}
            if parent_id:
                front["parent"] = parent_id
            planned.append({"path": target_dir / f"{entity_id}.md",
                            "front": front, "body": "\n" + section["body"] + "\n",
                            "action": "created"})
        if section["kind"] == "epic":
            epic_ids[section["num"]] = entity_id

    if errors:
        return {"ok": False, "blocked": True, "errors": errors,
                "reason": "invalid canonical values need a human fix — "
                          "nothing was written"}

    # 4. Story-file stamping plan.
    stamps: list[tuple[Path, str]] = []
    story_ids = {p["front"]["source"].split("#", 1)[1]: p["front"]["id"]
                 for p in planned if p["front"]["type"] == "story"}
    if impl.is_dir():
        for path in sorted(impl.glob("*.md")):
            file_m = STORY_FILE_RE.match(path.name)
            if not file_m:
                continue
            key = f"story-{int(file_m.group(1))}.{int(file_m.group(2))}"
            if key in story_ids:
                stamps.append((path, story_ids[key]))
            else:
                notes.append(f"{path.name}: no matching story in {EPICS_FILENAME} "
                             f"— not stamped")

    # 5. Sprint-status pull.
    sprint = _load_sprint_status(impl, notes)
    for plan_item in planned:
        front = plan_item["front"]
        if front["type"] != "story":
            continue
        num = front["source"].split("#story-", 1)[-1]
        pulled = sprint.get(num)
        if pulled and front.get("status") != pulled:
            front["status"] = pulled
            front["updated"] = _now()
            if plan_item["action"] == "unchanged":
                plan_item["action"] = "repaired"

    # Apply: counter first, then entity files, then stamps.
    if minter.skipped:
        notes.append(f"counter was behind existing ids — skipped: "
                     f"{', '.join(minter.skipped)} (ids are never reused)")
    if not dry_run:
        if minter.minted or minter.skipped:
            minter.persist()
        for plan_item in planned:
            if plan_item["action"] != "unchanged":
                _atomic_write(plan_item["path"],
                              interchange.render_entity(plan_item["front"],
                                                        plan_item["body"]))
    stamp_results = [{"path": str(p), "id": i,
                      "action": _stamp_story_file(p, i, dry_run)}
                     for p, i in stamps]

    if dry_run or not bmad_output.is_dir():
        post = {"ok": True, "entities": len(planned), "set_errors": [], "files": []}
    else:
        post = validate(project_root)

    actions = {"created": 0, "repaired": 0, "unchanged": 0}
    for plan_item in planned:
        actions[plan_item["action"]] += 1
    return {"ok": post["ok"], "dry_run": dry_run,
            "plan_dir": str(target_dir), "entities": len(planned),
            "actions": actions, "minted": minter.minted,
            "files": [{"path": str(p["path"]), "id": p["front"]["id"],
                       "action": p["action"]} for p in planned],
            "story_file_stamps": stamp_results, "notes": notes,
            "validation": {
                "ok": post["ok"],
                "entities": post["entities"],
                "set_errors": post["set_errors"],
                "file_errors": [{"path": f["path"], "errors": f["errors"]}
                                for f in post["files"] if f["errors"]]}}


def validate(project_root: Path) -> dict:
    bmad_output = Path(project_root).resolve() / "_bmad-output"
    if not bmad_output.is_dir():
        raise PlanSyncError(f"{bmad_output} is not a directory")
    return interchange.validate_directory(bmad_output)


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="tk-studio planning adapter")
    sub = parser.add_subparsers(dest="command", required=True)
    norm = sub.add_parser("normalize")
    norm.add_argument("--directory", required=True, help="project root")
    norm.add_argument("--dry-run", action="store_true")
    val = sub.add_parser("validate")
    val.add_argument("--directory", required=True, help="project root")

    args = parser.parse_args(argv)
    try:
        if args.command == "normalize":
            result = normalize(Path(args.directory), dry_run=args.dry_run)
        else:
            result = validate(Path(args.directory))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result.get("ok") else 2
    except PlanSyncError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
