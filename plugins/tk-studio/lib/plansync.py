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

`sync` is the full adapter verb (ST-3.3): normalize -> validate -> plan index
-> projection, where the projection step alone is binding-driven (AD-4: the
binding decides projection only — everything before it is identical under
every backend). Under `bmad-files` the canonical files ARE the backend: the
projection step is a first-class no-op, reported cleanly, never an error
(FR14). plan/index.md is a generated, ranked entry point over the canonical
entities — regenerated deterministically, refused if a foreign index.md sits
in its place.

Both verbs name every file they wrote in `written[]` — the counter included,
with `counter` naming the committed id counter's path and whether this run
persisted it — and sync names replaced projection files in `removed[]`, so
commit staging derives from the response alone (EP-017, PROP-020). Under
`--dry-run` the same lists name what the run would write or remove. A sync
blocked at the projection still names normalize's landed writes.

CLI:
  uv run plansync.py normalize --directory ROOT [--dry-run]
  uv run plansync.py sync --directory ROOT [--dry-run] [--backend NAME]
  uv run plansync.py validate --directory ROOT
  uv run plansync.py status --directory ROOT --id ST-NNN --status ENUM
                            [--note TEXT] [--caller NAME] [--dry-run]
  uv run plansync.py setup --directory ROOT [--dry-run]
                           [--owner-account-id ID | --owner-email EMAIL]
  uv run plansync.py publish --directory ROOT [--dry-run]
                             [--source CATEGORY=PATH ...]
                             [--attachment-max-bytes N]
  uv run plansync.py sync-back --directory ROOT [--dry-run]

`setup` (Story 31.2) creates the project's tracking from the studio
template through the agent seat's gateway tokens (TK_ATLASSIAN_*): the Jira
project (key from the project id), its issue types, the statuses `Blocked -
Awaiting User` and `Block Resolved` with their transition, the "Needs you"
filter, the Confluence space and its five design-page folders, and the
owner seat's accountId. Each is recognised by key first and created only
when absent; the keys and ids land under `planning.jira` and
`planning.confluence` in tracked config. What the API refuses becomes the
owner's numbered steps (`owner_steps[]`) and the run ends `partial`; an
unregistered project or an absent variable ends `blocked` before any call.
The result names `found[]`, `created[]` and `written[]` and ends with the
AD-11 status block.

`publish` (Story 31.3) converts each design page (brief, GDD, scope of
work, decisions) from Markdown to Confluence storage format (mdstorage)
and creates or updates it by the stable title `<Folder>: <slug>` in the
folder setup recorded, with a provenance footer (the source and the last
commit that touched it) and a content hash: an unchanged page is skipped.
Images are attached (PNG re-deflated losslessly), any over the per-file
ceiling refused by name. It writes `.tk-studio/confluence-pages.json`, the
index the Jira promote turns into each issue's "Design pages:" line, and
never changes an entity field (AD-5). The AD-11 status block ends the
result.

`sync-back` (Story 31.4) pulls the project's Atlassian state into local
memory (lib/syncback.py holds the tick): each tracked issue's status
(canonical by name, then category; the Jira original under
`external.jira`), its comments append-only into
`_bmad-output/tracking/<KEY>/comments.jsonl`, its attachments as links, and
every owner-authored Confluence page into `kb/confluence/<slug>.md` under a
provenance header (a local edit is overwritten and named in
`overwritten[]`). One paged JQL search per tick; the cursor in
`_bmad-output/tracking/sync-state.json` moves only after every page was
read. Nothing local is promoted back and no entity field other than
`status` changes (AD-5). An absent binding or Jira variable ends `blocked`
before any call; an absent Confluence token, owner accountId or space id,
a conflict or an interrupted read ends `partial`. The shipped cron job
`atlassian-sync-back` runs it every 10 minutes. The AD-11 status block ends
the result.

`status` is the driver's status pull-back (Story 26.5, AD-5 status-class
only): it sets one canonical story's `status`, stamps `updated`, replaces
the entity's `external.driver` snapshot (caller, status, note,
previous_status; every other `external.<name>` entry left as it was), then
runs `sync` as-is so the projection and plan/index.md follow. Only
--directory is touched; the result's `plan_dir` names the plan it wrote.
An outside-enum status, an unknown or non-story id, a blank caller, a
multi-line note, or a sprint-status.yaml entry pinning the story to a
different status are named refusals with nothing written.

Exit codes: 0 ok; 2 blocked/refusal; 1 unexpected failure.
Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import backlogmd
import config as configlib
import confluence
import interchange
import jirabackend
import mdstorage
import miniyaml
import registry
import syncback

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

    # Every file this run wrote (would write under dry_run), in write order,
    # counter included — commit staging derives from the response alone
    # (EP-017, PROP-020).
    counter_written = bool(minter.minted or minter.skipped)
    written = [str(counter_path(project_root))] if counter_written else []
    written += [str(p["path"]) for p in planned if p["action"] != "unchanged"]
    written += [s["path"] for s in stamp_results if s["action"] == "stamped"]

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
            "counter": {"path": str(counter_path(project_root)),
                        "written": counter_written},
            "written": written,
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


# --------------------------------------------------------------- plan index

GENERATED_MARKER = ("<!-- generated by tk-studio plansync.py — "
                    "edit entity files, not this index -->")
BACKENDS = ("bmad-files", "backlog-md", "jira")


def render_plan_index(project_name: str, entities: list[dict]) -> str:
    """Deterministic index over canonical entities: epics, their stories,
    each story's tasks — id order throughout."""
    by_type: dict[str, list[dict]] = {"epic": [], "story": [], "task": []}
    for front in entities:
        by_type.setdefault(front.get("type"), []).append(front)
    for group in by_type.values():
        group.sort(key=lambda f: f.get("id") or "")
    counts = {k: len(v) for k, v in by_type.items() if k in ("epic", "story", "task")}
    status_counts: dict[str, int] = {}
    for front in entities:
        status_counts[front.get("status", "?")] = \
            status_counts.get(front.get("status", "?"), 0) + 1
    status_line = ", ".join(f"{s} {n}" for s, n in sorted(status_counts.items()))

    lines = [
        f"# {project_name} — canonical plan",
        "",
        GENERATED_MARKER,
        "",
        f"> {counts['epic']} epics, {counts['story']} stories, "
        f"{counts['task']} tasks. Status: {status_line or 'none'}.",
        "> The binding decides projection only — this index always reflects",
        "> the canonical files (FR14). Regenerate:",
        "> `uv run <plugin>/lib/plansync.py sync --directory <project-root>`",
    ]

    def entry(front: dict, indent: str = "") -> str:
        return (f"{indent}- [`{front['id']}`]({front['id']}.md) "
                f"{front.get('title', '')} — `{front.get('status', '?')}`")

    orphans: list[dict] = []
    tasks_by_story: dict[str, list[dict]] = {}
    for task in by_type["task"]:
        tasks_by_story.setdefault(task.get("parent") or "", []).append(task)
    epic_ids = {e["id"] for e in by_type["epic"]}

    for epic in by_type["epic"]:
        lines += ["", f"## {epic['id']} — {epic.get('title', '')} "
                      f"(`{epic.get('status', '?')}`)", ""]
        stories = [s for s in by_type["story"] if s.get("parent") == epic["id"]]
        if not stories:
            lines.append("_No stories yet._")
        for story in stories:
            lines.append(entry(story))
            lines.extend(entry(t, "  ") for t in tasks_by_story.get(story["id"], []))

    story_ids = {s["id"] for s in by_type["story"]}
    orphans += [s for s in by_type["story"]
                if s.get("parent") not in epic_ids]
    orphans += [t for t in by_type["task"]
                if t.get("parent") not in story_ids]
    if orphans:
        lines += ["", "## Unparented", ""]
        lines.extend(entry(o) for o in sorted(orphans, key=lambda f: f["id"]))
    return "\n".join(lines) + "\n"


def _refuse_foreign_index(target: Path) -> None:
    """Raise when target exists but plansync.py did not generate it."""
    if target.exists() and GENERATED_MARKER not in target.read_text(
            encoding="utf-8", errors="replace"):
        raise PlanSyncError(
            f"{target} exists but was not generated by plansync.py — refusing "
            f"to overwrite; move or delete it and rerun")


def generate_plan_index(project_root: Path, dry_run: bool = False) -> dict:
    """Regenerate plan/index.md. Refuses a foreign index, never overwrites it."""
    target_dir = plan_dir(project_root)
    target = target_dir / "index.md"
    _refuse_foreign_index(target)
    entities = []
    if target_dir.is_dir():
        paths, _ = interchange.scan_entities(target_dir)
        for path in paths:
            try:
                front, _ = interchange.parse_entity(path)
            except interchange.InterchangeError:
                continue
            if isinstance(front.get("id"), str):
                entities.append(front)
    content = render_plan_index(Path(project_root).resolve().name, entities)
    changed = not target.exists() or \
        target.read_text(encoding="utf-8") != content
    if changed and not dry_run:
        _atomic_write(target, content)
    return {"index": str(target), "entities": len(entities), "changed": changed}


# --------------------------------------------------------------------- sync

def _projection_written(projection: dict) -> list[str]:
    """Local files a projection round reports writing, in write order.

    Both adapters name their canonical-file writes: pull-back ``applied``
    entries carry ``path``, backlog-md promote reports ``written``, jira
    promote entries carry ``path``. Remote-only operations name no local
    file; a projection with no writes yields an empty list.
    """
    paths: list[str] = []
    for entry in (projection.get("pull_back") or {}).get("applied") or []:
        if isinstance(entry, dict) and entry.get("path"):
            paths.append(entry["path"])
    promote = projection.get("promote") or {}
    paths.extend(promote.get("written") or [])
    for bucket in ("created", "updated"):
        for entry in promote.get(bucket) or []:
            if isinstance(entry, dict) and entry.get("path"):
                paths.append(entry["path"])
    return paths


def sync(project_root: Path, dry_run: bool = False,
         runtime: dict | None = None) -> dict:
    """normalize -> validate -> index -> binding-driven projection (AD-4).

    Everything before projection is identical under every binding; under
    bmad-files the projection is a clean, first-class no-op (FR14).
    """
    project_root = Path(project_root).resolve()
    try:
        binding, scope = configlib.resolve("planning.backend",
                                           project_root=project_root,
                                           runtime=runtime)
    except configlib.ConfigError:
        binding, scope = "bmad-files", "fallback"
    if binding not in BACKENDS:
        return {"ok": False, "blocked": True, "binding": binding,
                "reason": f"unknown planning backend '{binding}' "
                          f"(known: {', '.join(BACKENDS)})"}

    norm = normalize(project_root, dry_run=dry_run)
    result = {"ok": False, "binding": binding, "binding_scope": scope,
              "dry_run": dry_run, "normalize": norm}
    if not norm["ok"]:
        result.update({"blocked": True,
                       "reason": norm.get("reason", "normalize failed")})
        return result

    if binding == "bmad-files":
        result["projection"] = {
            "binding": binding, "action": "none",
            "note": "bmad-files: the canonical files are the backend — "
                    "no projection, by design (FR14)"}
    elif binding == "backlog-md":
        result["projection"] = backlogmd.project(
            project_root, plan_dir(project_root), dry_run=dry_run)
    else:  # jira (AD-7): the adapter alone talks to the backend (AD-4)
        result["projection"] = jirabackend.project(
            project_root, plan_dir(project_root), dry_run=dry_run,
            runtime=runtime)
        if result["projection"].get("blocked"):
            result.update({"blocked": True,
                           "reason": result["projection"]["reason"]})
            # Normalize's writes already landed — a projection block must
            # still name them or staging misses the minted files (EP-017).
            result["written"] = list(norm.get("written") or [])
            result["removed"] = []
            return result

    # Index last: pull-back may have updated canonical statuses.
    result["index"] = generate_plan_index(project_root, dry_run=dry_run)

    # Sync-level roll-up of every file the run wrote (would write under
    # dry_run): normalize's writes, the projection's named writes, the index
    # when it changed — commit staging derives from the response alone
    # (EP-017, PROP-020).
    written = list(norm.get("written") or [])
    written += _projection_written(result["projection"])
    if result["index"]["changed"]:
        written.append(result["index"]["index"])
    seen: set[str] = set()
    result["written"] = [p for p in written
                         if not (p in seen or seen.add(p))]
    # Only the projection removes files (a rename replaces its backlog
    # file); normalize and the index never delete.
    result["removed"] = list(
        (result["projection"].get("promote") or {}).get("removed") or [])
    result["ok"] = True
    return result


# ---------------------------------------------------------- status pull-back

DRIVER_SNAPSHOT = "driver"
DEFAULT_CALLER = "tk-studio-plan-sync"


def _find_entity(target_dir: Path, entity_id: str) -> tuple[Path, dict, str] | None:
    """(path, frontmatter, body) of the canonical entity with this id."""
    if not target_dir.is_dir():
        return None
    paths, _ = interchange.scan_entities(target_dir)
    for path in paths:
        try:
            front, body = interchange.parse_entity(path)
        except interchange.InterchangeError:
            continue
        if front.get("id") == entity_id:
            return path, front, body
    return None


def _sprint_pin(project_root: Path, front: dict) -> tuple[str, Path] | None:
    """(pinned status, sprint-status path) when normalize's sprint-status
    pull would rewrite this story's status on the re-sync, else None."""
    source = front.get("source")
    if not isinstance(source, str) or not source.startswith(
            f"{EPICS_FILENAME}#story-"):
        return None
    impl = project_root / IMPL_REL
    sprint = _load_sprint_status(impl, [])
    num = source.split("#story-", 1)[1]
    if num not in sprint:
        return None
    # normalize pulls only for stories its epics.md still derives.
    epics_path = project_root / PLANNING_REL / EPICS_FILENAME
    if not epics_path.is_file():
        return None
    keys = {s["key"] for s in parse_epics_doc(epics_path.read_text(encoding="utf-8"))}
    if f"story-{num}" not in keys:
        return None
    return sprint[num], impl / SPRINT_STATUS_FILENAME


def _breaks_line(text: str) -> bool:
    """True when str.splitlines (miniyaml's line split) would break text."""
    lines = text.splitlines()
    return len(lines) > 1 or text != "".join(lines)


def status_pull_back(project_root: Path, story_id: str, status: str,
                     note: str = "", caller: str = DEFAULT_CALLER,
                     dry_run: bool = False) -> dict:
    """Set one canonical story's status from a driver, then re-sync (AD-5).

    Status-class only: writes `status`, `updated` and `external.driver`;
    every other key and `external.<name>` entry is left as it was. Always
    writes, even when the status is unchanged (each call is a driver event).
    """
    project_root = Path(project_root).resolve()
    note = "" if note is None else note
    if status not in interchange.STATUS_VALUES:
        raise PlanSyncError(
            f"status {status!r} is not in the canonical enum "
            f"({', '.join(interchange.STATUS_VALUES)})")
    if not isinstance(caller, str) or not caller.strip() \
            or _breaks_line(caller):
        raise PlanSyncError("caller must be a non-empty string")
    if _breaks_line(note):
        raise PlanSyncError("note must be a single line")

    # Duplicate ids block before anything is written, as in normalize (AD-4):
    # otherwise an arbitrary copy is rewritten and only then the sync blocks.
    entity_paths, _ = _scan_canonical(project_root / "_bmad-output")
    duplicates = [e for e in interchange.validate_set(entity_paths)["set_errors"]
                  if "duplicate id" in e]
    if duplicates:
        raise PlanSyncError("duplicate ids block sync until renumbered (AD-4): "
                            + "; ".join(duplicates))

    target_dir = plan_dir(project_root)
    # A foreign index would make the re-sync raise after normalize and the
    # projection already wrote files the response could no longer name.
    _refuse_foreign_index(target_dir / "index.md")
    found = _find_entity(target_dir, story_id)
    if found is None:
        raise PlanSyncError(
            f"unknown id {story_id}: no canonical entity in {target_dir}")
    path, front, body = found
    if front.get("type") != "story":
        raise PlanSyncError(
            f"{story_id} is a {front.get('type')}, not a story — "
            f"status takes a story id")
    pin = _sprint_pin(project_root, front)
    if pin is not None and pin[0] != status:
        raise PlanSyncError(
            f"status of {story_id} is pinned to '{pin[0]}' by {pin[1]} — "
            f"update that file or remove the entry")

    previous = front.get("status")
    now = _now()
    updated = dict(front)
    updated["status"] = status
    updated["updated"] = now
    external = dict(front.get("external") or {})
    external[DRIVER_SNAPSHOT] = {
        "key": caller,
        "synced_at": now,
        "content_hash": backlogmd._content_hash(story_id, status, note),
        "caller": caller,
        "status": status,
        "note": note,
        "previous_status": previous,
    }
    updated["external"] = external
    if not dry_run:
        _atomic_write(path, interchange.render_entity(updated, body))

    try:
        synced = sync(project_root, dry_run=dry_run)
    except Exception as exc:
        if dry_run:
            raise
        # The entity write already landed: report it, never a refusal (or a
        # traceback) that implies nothing was written.
        return {"ok": False, "blocked": True, "reason": str(exc),
                "id": story_id, "status": status,
                "previous_status": previous, "caller": caller, "note": note,
                "path": str(path), "plan_dir": str(target_dir),
                "dry_run": dry_run, "sync": None,
                "written": [str(path)], "removed": []}
    written = [str(path)] + list(synced.get("written") or [])
    if dry_run and synced.get("ok") and previous != status:
        # sync's dry run sees the on-disk (old-status) entity; the real run
        # re-renders the index with the new status, so name it. A blocked
        # sync never writes the index; an unchanged status leaves it as is.
        written.append(str(target_dir / "index.md"))
    seen: set[str] = set()
    result = {"ok": bool(synced.get("ok")), "id": story_id, "status": status,
              "previous_status": previous, "caller": caller, "note": note,
              "path": str(path), "plan_dir": str(target_dir),
              "dry_run": dry_run, "sync": synced,
              "written": [p for p in written if not (p in seen or seen.add(p))],
              "removed": list(synced.get("removed") or [])}
    if not synced.get("ok"):
        result["blocked"] = True
        result["reason"] = synced.get("reason", "sync failed")
    elif not dry_run:
        # A binding pull-back (a pending board edit while the canonical status
        # equals the last-promoted one) can overwrite the status just set.
        after = _find_entity(target_dir, story_id)
        landed = after[1].get("status") if after else None
        if landed != status:
            result["ok"] = False
            result["blocked"] = True
            result["reason"] = (
                f"status of {story_id} was reverted to '{landed}' by the "
                f"re-sync ({synced.get('binding')} pull-back) — resolve the "
                f"board edit and call again")
    return result


# --------------------------------------------------------- tracking setup

SETUP_INTENT = "tk-studio-plan-sync"
SETUP_BLOCK_KEYS = ("status", "intent", "artifacts", "reason")


class SetupRefusal(Exception):
    """A named refusal met mid-setup (a key collision)."""


def _recorded(project_root: Path, dotted: str) -> str | None:
    """A binding value from config, or None when absent or empty."""
    try:
        value, _ = configlib.resolve(dotted, project_root=project_root)
    except configlib.ConfigError:
        return None
    if value is None or isinstance(value, (dict, list)) or str(value) == "":
        return None
    return str(value)


def _setup_gaps(project_root: Path, project_id: str) -> list[str]:
    """Every refusal that ends setup before any Atlassian call, by name."""
    gaps = []
    try:
        registry.read_project(project_id)
    except registry.RegistryError as exc:
        gaps.append(f"{exc} — onboard the project first "
                    f"(registry.py register)")
    cloud_gap = jirabackend.gateway_gaps()
    for name in (jirabackend.AGENT_EMAIL_ENV, jirabackend.AGENT_TOKEN_ENV,
                 jirabackend.AGENT_CONFLUENCE_TOKEN_ENV,
                 jirabackend.CLOUD_ID_ENV):
        if os.environ.get(name):
            continue
        if name == jirabackend.CLOUD_ID_ENV and cloud_gap:
            gaps.extend(cloud_gap)
        else:
            gaps.append(f"{name} is not set")
    if _recorded(project_root, "planning.jira.site") is None \
            and not os.environ.get(jirabackend.SITE_ENV):
        gaps.append(f"{jirabackend.SITE_ENV} is not set (first setup: "
                    f"planning.jira.site is not configured)")
    layout = binding_layout_gap(project_root)
    if layout:
        gaps.append(layout)
    key = jirabackend.project_key_for(project_id)
    if key is None:
        gaps.append(f"no Jira project key can be derived from project id "
                    f"{project_id!r} (uppercase alphanumerics starting with "
                    f"a letter)")
    else:
        for dotted in ("planning.jira.project_key",
                       "planning.confluence.space_key"):
            recorded = _recorded(project_root, dotted)
            if recorded is not None and recorded != key:
                gaps.append(f"{dotted} records {recorded!r} but setup derives "
                            f"{key!r} from project id {project_id!r}")
    return gaps


# --- the binding text edit (Settled shape 1): every other byte survives

def _key_index(lines: list[str], lo: int, hi: int, depth: int,
               key: str) -> int | None:
    pattern = re.compile(rf"^{'  ' * depth}{re.escape(key)}:(\s.*)?$")
    for i in range(lo, hi):
        if pattern.match(lines[i]):
            return i
    return None


def _block_extent(lines: list[str], idx: int, depth: int) -> tuple[int, int]:
    """(end, insert_at) of the mapping opened at lines[idx]: the block runs
    while lines are blank, comment-only or indented deeper; new keys go
    after its last content line. A comment-only line (even at column 0, as
    in config.py's _TRACKED_TEMPLATE) neither ends the block nor counts as
    its last content line."""
    end, last = idx + 1, idx
    while end < len(lines):
        line = lines[end]
        if line.strip() and not line.lstrip().startswith("#"):
            if len(line) - len(line.lstrip(" ")) <= 2 * depth:
                break
            last = end
        end += 1
    return end, last + 1


def _inline_value(line: str) -> str:
    value = line.split(":", 1)[1].strip()
    value = re.sub(r"\s+#.*$", "", value) if not value.startswith(("'", '"')) \
        else value
    return value.strip().strip('"').strip("'")


def _set_path(lines: list[str], path: tuple[str, ...], value: str) -> None:
    lo, hi, insert_at = 0, len(lines), len(lines)
    for depth, key in enumerate(path):
        last = depth == len(path) - 1
        idx = _key_index(lines, lo, hi, depth, key)
        rendered = f"{'  ' * depth}{key}:" + (f" {json.dumps(value)}" if last else "")
        if idx is None:
            if depth == 0:
                if lines and lines[-1].strip():
                    lines.append("")
                insert_at = len(lines)
            lines.insert(insert_at, rendered)
            idx = insert_at
        elif last:
            if _inline_value(lines[idx]) != value:
                lines[idx] = rendered
        elif _inline_value(lines[idx]) and not lines[idx].split(":", 1)[1].strip().startswith("#"):
            raise PlanSyncError(f"config key {'.'.join(path[:depth + 1])} "
                                f"holds a scalar where setup needs a mapping")
        if not last:
            hi, insert_at = _block_extent(lines, idx, depth)
            lo = idx + 1


def _flatten(prefix: tuple[str, ...], mapping: dict) -> list[tuple[tuple[str, ...], str]]:
    pairs = []
    for key, value in mapping.items():
        if isinstance(value, dict):
            pairs += _flatten(prefix + (key,), value)
        elif value not in (None, ""):
            pairs.append((prefix + (key,), str(value)))
    return pairs


def binding_layout_gap(project_root: Path) -> str | None:
    """A named refusal when the tracked `planning:` block is not laid out
    in two-space steps (the text edit would add a second `jira:` mapping
    beside one indented otherwise), else None."""
    tracked = Path(project_root) / ".tk-studio" / configlib.TRACKED_NAME
    if not tracked.is_file():
        return None
    lines = tracked.read_text(encoding="utf-8").splitlines()
    idx = _key_index(lines, 0, len(lines), 0, "planning")
    if idx is None:
        return None
    end, _ = _block_extent(lines, idx, 0)
    content = [l for l in lines[idx + 1:end]
               if l.strip() and not l.lstrip().startswith("#")]
    widths = [len(l) - len(l.lstrip(" ")) for l in content]
    if any("\t" in l[:len(l) - len(l.lstrip())] for l in content) or \
            (widths and widths[0] != 2) or any(w % 2 for w in widths):
        return (f"{tracked}'s planning: block is not indented in two-space "
                f"steps — setup edits it as text and refuses to guess; "
                f"re-indent it with two spaces per level, then rerun")
    return None


def write_binding(project_root: Path, binding: dict,
                  dry_run: bool = False) -> tuple[Path, bool]:
    """Land the tracking binding under `planning:` in tracked config as a
    text edit; classification-checked before the write (AD-3), atomic.
    Returns (path, changed)."""
    tracked = Path(project_root) / ".tk-studio" / configlib.TRACKED_NAME
    text = tracked.read_text(encoding="utf-8") if tracked.is_file() else ""
    lines = text.splitlines()
    for path, value in _flatten(("planning",), binding):
        _set_path(lines, path, value)
    new_text = "\n".join(lines) + "\n"
    if new_text == text:
        return tracked, False
    try:
        parsed = miniyaml.loads(new_text)
    except miniyaml.MiniYamlError as exc:
        raise PlanSyncError(f"the binding edit would leave {tracked} "
                            f"unreadable: {exc}") from exc
    for path, value in _flatten(("planning",), binding):
        node = parsed
        for part in path:
            node = node.get(part) if isinstance(node, dict) else None
        if node is None or str(node) != value:
            raise PlanSyncError(f"the binding edit would not land "
                                f"{'.'.join(path)} in {tracked} (its "
                                f"planning: block is laid out in a way the "
                                f"text edit does not handle)")
    if not dry_run:
        configlib.assert_tracked_safe(new_text, str(tracked))
        _atomic_write(tracked, new_text)
    return tracked, True


# --- the owner's numbered browser steps (kb/atlassian-free-tier.md §2 Q1)

def _project_steps(site: str, key: str, name: str) -> list[str]:
    # create only: on Free, project roles cannot be customised and everyone
    # with Jira access administers every project (kb §2 Q2)
    return [f"Sign in to https://{site} as the owner seat, open Projects > "
            f"Create project > Software development > Kanban, choose "
            f"Company-managed, name it `{name}` and set the key to `{key}`."]


def _company_status_steps(site: str, key: str,
                          existing=()) -> list[str]:
    """The company-managed workflow steps; a status that already exists on
    the site (`existing`) is added to the workflow, never created again."""
    def add(name: str) -> str:
        if name in existing:
            return (f"Choose Add status and add the existing status "
                    f"`{name}` to the workflow (do not create a new one).")
        return (f"Choose Add status, create `{name}` in the In Progress "
                f"category.")
    return [f"Sign in to https://{site} as the owner seat and open Settings "
            f"> Work items > Workflows; choose Edit on the workflow project "
            f"`{key}` uses.",
            add(jirabackend.BLOCKED_STATUS),
            add(jirabackend.RESOLVED_STATUS),
            f"Add a transition from `{jirabackend.BLOCKED_STATUS}` to "
            f"`{jirabackend.RESOLVED_STATUS}`, then choose Update workflow."]


_STATUS_CATEGORY = {"To Do": "To Do", "In Progress": "In Progress",
                    "Done": "Done"}


def _template_status_steps(site: str, key: str, missing: list[str],
                           team: bool) -> list[str]:
    where = (f"open project `{key}` > Project settings > Issue types > "
             f"Story, and choose Edit workflow" if team else
             f"open Settings > Work items > Workflows and choose Edit on the "
             f"workflow project `{key}` uses")
    return ([f"Sign in to https://{site} as the owner seat and {where}."]
            + [f"Add status `{name}` in the {_STATUS_CATEGORY[name]} "
               f"category, then save the workflow." for name in missing])


def _team_status_steps(site: str, key: str) -> list[str]:
    return [f"Sign in to https://{site} as the owner seat, open project "
            f"`{key}` > Project settings > Issue types > Story, and choose "
            f"Edit workflow.",
            f"Add status `{jirabackend.BLOCKED_STATUS}` in the In progress "
            f"category.",
            f"Add status `{jirabackend.RESOLVED_STATUS}` in the In progress "
            f"category.",
            f"Add a transition from `{jirabackend.BLOCKED_STATUS}` to "
            f"`{jirabackend.RESOLVED_STATUS}`, then choose Save changes; "
            f"repeat for the Epic issue type."]


def _issue_type_steps(site: str, key: str, missing: list[str]) -> list[str]:
    return [f"Sign in to https://{site} as the owner seat, open project "
            f"`{key}` > Project settings > Issue types and add "
            f"{', '.join(f'`{m}`' for m in missing)}."]


def _filter_steps(site: str, key: str) -> list[str]:
    return [f"Sign in to https://{site} as the owner seat, open Filters > "
            f"Search work items, switch to JQL, enter "
            f"`{jirabackend.NEEDS_YOU_JQL}`, then Save filter as "
            f"`{jirabackend.NEEDS_YOU_FILTER}`.",
            f"Open the saved filter's Details > Edit permissions and share "
            f"`{jirabackend.NEEDS_YOU_FILTER}` with project `{key}` (Viewers: "
            f"Project `{key}`), so the agent seat finds it on the rerun."]


def _space_steps(site: str, key: str, name: str) -> list[str]:
    # create only: Confluence Free permissions cannot be customised (kb §2 Q4)
    return [f"Sign in to https://{site}/wiki as the owner seat, choose "
            f"Create > Space > Blank space, name it `{name}` and set the "
            f"space key to `{key}`."]


def _folder_steps(site: str, key: str, titles: list[str]) -> list[str]:
    return [f"Sign in to https://{site}/wiki as the owner seat, open space "
            f"`{key}` and, from the sidebar's + > Folder, create the "
            f"top-level folder{'s' if len(titles) > 1 else ''} "
            f"{', '.join(f'`{t}`' for t in titles)}."]


def _owner_id_steps(site: str) -> list[str]:
    return [f"Sign in to https://{site} as the owner seat, open your "
            f"Atlassian profile (avatar > Profile) and copy the accountId "
            f"from the address bar (kb/atlassian-free-tier.md §1 step 6); "
            f"rerun setup with `--owner-account-id <that id>`."]


def _setup_result(project_id: str, dry_run: bool) -> dict:
    return {"ok": False, "dry_run": dry_run, "project_id": project_id,
            "project_key": None, "found": [], "created": [],
            "would_create": [], "owner_steps": [], "notes": [],
            "binding": {}, "written": []}


def _finish_setup(result: dict, status: str, reason: str | None) -> dict:
    result["ok"] = status != "blocked"
    result.update({"status": status, "intent": SETUP_INTENT,
                   "artifacts": list(result["written"]), "reason": reason})
    return result


def _number_steps(groups: list[list[str]]) -> list[str]:
    """The owner's steps numbered in order, the rerun step last."""
    steps = [line for group in groups for line in group]
    steps.append("Rerun `uv run plugins/tk-studio/lib/plansync.py setup "
                 "--directory <project root>`: it recognises what was made "
                 "by key and records it.")
    return [f"{i}. {line}" for i, line in enumerate(steps, 1)]


def setup_flag_refusal(project_root: Path, dry_run: bool = False) -> dict:
    """`--owner-account-id` and `--owner-email` together: one source of the
    owner's accountId, so both is a named refusal before any call."""
    root = Path(project_root).resolve()
    return _finish_setup(
        _setup_result(configlib.project_key(root), dry_run), "blocked",
        "tracking setup refused: --owner-account-id and --owner-email are "
        "exclusive — pass one of them, not both")


def setup(project_root: Path, dry_run: bool = False,
          owner_account_id: str | None = None,
          owner_email: str | None = None, transport=None) -> dict:
    """Create the project's Jira project, statuses, filter and Confluence
    space from the studio template, recognising each by key first (Story
    31.2, AD-4). Ends `complete` only when every step was created or found;
    whatever the API refuses becomes the owner's numbered steps and the run
    ends `partial`, as does a dry run that would create anything; a refusal
    ends `blocked` before any Atlassian call."""
    root = Path(project_root).resolve()
    project_id = configlib.project_key(root)
    result = _setup_result(project_id, dry_run)

    def finish(status: str, reason: str | None) -> dict:
        return _finish_setup(result, status, reason)

    gaps = _setup_gaps(root, project_id)
    if gaps:
        return finish("blocked", "tracking setup refused: " + "; ".join(gaps))

    key = jirabackend.project_key_for(project_id)
    result["project_key"] = key
    recorded_site = _recorded(root, "planning.jira.site")
    site = recorded_site or os.environ[jirabackend.SITE_ENV]
    site = re.sub(r"^https?://", "", site).strip("/")
    email = os.environ[jirabackend.AGENT_EMAIL_ENV]
    cloud_id = os.environ[jirabackend.CLOUD_ID_ENV]
    jira = jirabackend.JiraClient.for_gateway(
        cloud_id, email, os.environ[jirabackend.AGENT_TOKEN_ENV], transport,
        site=site)
    conf = confluence.ConfluenceClient(
        cloud_id, email, os.environ[jirabackend.AGENT_CONFLUENCE_TOKEN_ENV],
        transport, site=site)

    found, created, notes = result["found"], result["created"], result["notes"]
    would = result["would_create"]
    groups: list[list[str]] = []
    # Settled shape 1, in its order; None/empty values are not written. A
    # key is recorded only once its item is found (past the collision
    # check), created, or handed to the owner to create — so a rerun never
    # adopts a same-keyed item this setup neither made nor asked for.
    jira_binding: dict = {"site": None if recorded_site else site,
                          "project_key": None, "project_id": None,
                          "filter_id": None, "owner_account_id": None,
                          "agent_account_id": None}
    conf_binding: dict = {"space_key": None, "space_id": None, "folders": {}}
    result["binding"] = {"jira": jira_binding, "confluence": conf_binding}
    error = None
    handed_over = False  # an owner step asks the owner to create a keyed item
    try:
        # 1. the agent seat
        status, me = jira.request("GET", "/myself")
        if status != 200 or not isinstance(me, dict):
            raise jirabackend.JiraError(
                f"auth preflight failed: GET /myself returned {status}")
        agent_id = me.get("accountId")
        jira_binding["agent_account_id"] = agent_id
        found.append(f"agent seat accountId {agent_id}")

        # 7 (first: the project lead is the owner when known). The owner id
        # source order is Settled shape 2.
        owner_id = _recorded(root, "planning.jira.owner_account_id")
        if owner_id:
            found.append("owner seat accountId (recorded)")
        elif owner_account_id:
            owner_id = owner_account_id
            found.append("owner seat accountId (--owner-account-id)")
        elif owner_email:
            owner_id, note = jirabackend.lookup_owner(jira, owner_email)
            if owner_id:
                found.append("owner seat accountId (looked up by "
                             "--owner-email)")
            else:
                notes.append(note)
                groups.append(_owner_id_steps(site))
        else:
            groups.append(_owner_id_steps(site))
        jira_binding["owner_account_id"] = owner_id

        # 2. the project
        recorded_pid = _recorded(root, "planning.jira.project_id")
        recorded_key = _recorded(root, "planning.jira.project_key")
        proj = jirabackend.get_project(jira, key)
        if proj is not None:
            if recorded_key != key or (recorded_pid and
                                       recorded_pid != str(proj.get("id"))):
                raise SetupRefusal(
                    f"Jira project {key} already exists on {site} and this "
                    f"setup did not create it (planning.jira.project_key "
                    f"does not record it) — set `project_id` in "
                    f".tk-studio/config.yaml to a unique id, or record "
                    f"planning.jira.project_key: {key} to adopt it")
            found.append(f"Jira project {key}")
            jira_binding["project_key"] = key
        elif dry_run:
            would.append(f"Jira project {key}")
        else:
            made, detail = jirabackend.create_project(
                jira, key, project_id, owner_id or agent_id)
            if made is None:
                notes.append(f"project create refused: {detail}")
                groups.append(_project_steps(site, key, project_id))
                jira_binding["project_key"] = key
                handed_over = True
            else:
                created.append(f"Jira project {key}")
                jira_binding["project_key"] = key
                proj = jirabackend.get_project(jira, key)
                if proj is None:
                    raise jirabackend.JiraError(
                        f"setup: project {key} was created but GET "
                        f"/project/{key} finds none")
        if proj is not None:
            jira_binding["project_id"] = str(proj.get("id"))

        # 3. issue types, 4. the five-status workflow and the transition
        if proj is not None:
            pid = str(proj.get("id"))
            have_types, missing_types = jirabackend.confirm_issue_types(proj)
            found += [f"issue type {t}" for t in have_types]
            if missing_types:
                groups.append(_issue_type_steps(site, key, missing_types))
            team = jirabackend.is_team_managed(proj)
            have = jirabackend.find_statuses(jira, pid, key, team)
            found += [f"status {n}" for n in jirabackend.TEMPLATE_STATUSES
                      if n in have]
            missing_template = [n for n in jirabackend.TEMPLATE_STATUSES
                                if n not in have
                                and n not in jirabackend.SETUP_STATUSES]
            if missing_template:
                groups.append(_template_status_steps(site, key,
                                                     missing_template, team))
            missing = [n for n in jirabackend.SETUP_STATUSES if n not in have]
            company_steps = False
            if missing and team:
                groups.append(_team_status_steps(site, key))
            elif missing and dry_run:
                would.extend(f"status {n}" for n in missing)
            elif missing:
                made, detail = jirabackend.create_statuses(jira, pid, missing)
                landed = {e["name"]: e for e in made or []}
                for name in missing:
                    if name in landed:
                        have[name] = landed[name]
                        created.append(f"status {name}")
                if made is None:
                    notes.append(f"status create refused: {detail}")
                elif len(landed) < len(missing):
                    notes.append(
                        "status create answered without "
                        + ", ".join(n for n in missing if n not in landed))
                if len(landed) < len(missing):
                    groups.append(_company_status_steps(site, key, have))
                    company_steps = True
            if not team and not company_steps:
                both = all(n in have for n in jirabackend.SETUP_STATUSES)
                label = (f"transition {jirabackend.BLOCKED_STATUS} -> "
                         f"{jirabackend.RESOLVED_STATUS}")
                if not both:
                    if dry_run:
                        would.append(label)
                else:
                    blocked_id = have[jirabackend.BLOCKED_STATUS].get("id")
                    resolved_id = have[jirabackend.RESOLVED_STATUS].get("id")
                    flow, why = jirabackend.find_workflow(jira, key)
                    if flow is not None and jirabackend.has_resolution_transition(
                            flow, blocked_id, resolved_id):
                        found.append(label)
                    elif flow is None:
                        notes.append(f"workflow not selected: {why}")
                        groups.append(_company_status_steps(site, key, have))
                    elif dry_run:
                        would.append(label)
                    else:
                        done, detail = jirabackend.add_resolution_transition(
                            jira, flow, blocked_id, resolved_id)
                        if done:
                            created.append(label)
                        else:
                            notes.append(f"workflow update refused: {detail}")
                            groups.append(_company_status_steps(site, key, have))
        elif dry_run:
            would.extend(f"status {n}" for n in jirabackend.SETUP_STATUSES)
            would.append(f"transition {jirabackend.BLOCKED_STATUS} -> "
                         f"{jirabackend.RESOLVED_STATUS}")

        # 5. the "Needs you" filter
        saved = jirabackend.find_filter(jira, agent_id)
        if saved is not None:
            found.append(f"filter {jirabackend.NEEDS_YOU_FILTER}")
        elif dry_run:
            would.append(f"filter {jirabackend.NEEDS_YOU_FILTER}")
        elif proj is None:
            # shared with the project, so it waits for the project to exist
            notes.append(f"filter {jirabackend.NEEDS_YOU_FILTER} not created: "
                         f"it is shared with project {key}, which does not "
                         f"exist yet — the rerun creates it")
        else:
            saved, detail = jirabackend.create_filter(jira, str(proj.get("id")))
            if saved is None:
                notes.append(f"filter create refused: {detail}")
                groups.append(_filter_steps(site, key))
            else:
                created.append(f"filter {jirabackend.NEEDS_YOU_FILTER}")
        if saved is not None:
            jira_binding["filter_id"] = str(saved.get("id"))

        # 6. the Confluence space and its folders
        space = confluence.find_space(conf, key)
        if space is not None:
            if _recorded(root, "planning.confluence.space_key") != key:
                raise SetupRefusal(
                    f"Confluence space {key} already exists and this setup "
                    f"did not create it (planning.confluence.space_key does "
                    f"not record it) — set `project_id` in "
                    f".tk-studio/config.yaml to a unique id, or record "
                    f"planning.confluence.space_key: {key} to adopt it")
            found.append(f"Confluence space {key}")
            conf_binding["space_key"] = key
        elif dry_run:
            would.append(f"Confluence space {key}")
        else:
            space, detail = confluence.create_space(conf, key, project_id)
            if space is None:
                notes.append(f"space create refused: {detail}")
                groups.append(_space_steps(site, key, project_id))
                conf_binding["space_key"] = key
                handed_over = True
            else:
                created.append(f"Confluence space {key}")
                conf_binding["space_key"] = key
        if space is not None:
            conf_binding["space_id"] = str(space.get("id"))
            try:
                titles = confluence.find_folders(conf, str(space.get("id")))
            except confluence.ConfluenceError as exc:
                # Confluence's space-children listing wants read:custom-content
                # beside read:hierarchical-content (hole 91): without it the
                # folders are still created, just never adopted from the site.
                if "scope" not in str(exc).lower():
                    raise
                titles = {}
                notes.append("folder listing refused by scope (the Confluence key "
                             "lacks read:custom-content:confluence, which the space "
                             "children endpoint requires): folders created without "
                             "adoption; a folder made by hand is not recognised")
            refused = []
            for name, title in confluence.FOLDERS:
                if title in titles:
                    conf_binding["folders"][name] = titles[title]
                    found.append(f"folder {title}")
                elif dry_run:
                    would.append(f"folder {title}")
                else:
                    folder, detail = confluence.create_folder(
                        conf, str(space.get("id")), title)
                    if folder is None:
                        notes.append(f"folder {title} create refused: {detail}")
                        refused.append(title)
                    else:
                        conf_binding["folders"][name] = str(folder.get("id"))
                        created.append(f"folder {title}")
            if refused:
                groups.append(_folder_steps(site, key, refused))
        elif dry_run:
            would.extend(f"folder {title}" for _, title in confluence.FOLDERS)
    except (jirabackend.JiraError, confluence.ConfluenceError,
            SetupRefusal) as exc:
        error = str(exc)

    # 8. the binding — on an error only when this run already created
    # something, or emitted an owner step to create a keyed item (the
    # project or the space), so a rerun recognises it by key rather than
    # refusing it as a collision
    if dry_run:
        notes.append("dry run: nothing created, config not written")
    elif error is None or created or handed_over:
        try:
            tracked, changed = write_binding(root, result["binding"])
            if changed:
                # project-root-relative, POSIX (§3: artifacts are relative)
                result["written"].append(tracked.relative_to(root).as_posix())
        except (PlanSyncError, configlib.ClassificationError) as exc:
            record = "; ".join(f"{'.'.join(path)}: {value}" for path, value
                               in _flatten(("planning",), result["binding"]))
            error = ((f"{error}; " if error else "")
                     + f"the binding was not written: {exc} — this run "
                       f"created {', '.join(created) or 'nothing'}; record "
                       f"these keys and ids by hand: {record}")

    # 9. the result
    if error is not None:
        if groups:
            # the steps the API refused before the error still reach the owner
            result["owner_steps"] = _number_steps(groups)
            error += (f" — and {len(groups)} item(s) the API could not do "
                      f"here are left to the owner; the numbered steps: "
                      + " ".join(result["owner_steps"]))
        return finish("blocked", error)
    if groups:
        result["owner_steps"] = _number_steps(groups)
        reason = (f"tracking setup partial: {len(groups)} item(s) the "
                  f"API could not do here are left to the owner; the "
                  f"numbered steps: " + " ".join(result["owner_steps"]))
        if would:
            reason += " Dry run: would create " + ", ".join(would) + "."
        return finish("partial", reason)
    if would:
        return finish("partial", "dry run: nothing created; a real run would "
                                 "create " + ", ".join(would))
    return finish("complete", None)


# ------------------------------------------------------ design-page publish
#
# Story 31.3 (§6.8 b, AD-22): the project's design pages go to the folders
# setup recorded in the Confluence space. Publish writes only to Confluence
# and to the local page index — never an entity field (AD-5).

PUBLISH_INTENT = SETUP_INTENT
# category -> (project-relative directory glob, file-name glob), matched
# case-insensitively on the file name (Settled shape 1). `records` is not
# published here.
PUBLISH_SOURCES = {
    "brief": ("_bmad-output/planning-artifacts/briefs/*", "brief.md"),
    "gdd": ("_bmad-output/planning-artifacts/**", "gdd*.md"),
    "scope-of-work": ("_bmad-output/planning-artifacts/**",
                      "scope-of-work*.md"),
    "decisions": ("_bmad-output/planning-artifacts/design/*",
                  "decisions*.md"),
}
SLUG_FROM_PARENT = ("brief.md", "readme.md", "index.md")
ATTACHMENT_CEILING = 104_857_600  # the REST upload ceiling (kb §2 Q4)
PAGE_INDEX_REL = jirabackend.PAGE_INDEX_REL
FOOTER_HASH_RE = re.compile(r"content-hash: sha256:([0-9a-f]{64})")
FREE_STORAGE_NOTE = ("Confluence Free stores 2 GB per site (Settings > "
                     "Storage shows use)")


def _publish_result(dry_run: bool) -> dict:
    return {"ok": False, "dry_run": dry_run, "found": [], "created": [],
            "updated": [], "skipped": [], "refused": [], "would_publish": [],
            "bytes_uploaded": 0, "notes": [], "written": []}


def _finish_publish(result: dict, status: str, reason: str | None) -> dict:
    result["ok"] = status != "blocked"
    result.update({"status": status, "intent": PUBLISH_INTENT,
                   "artifacts": list(result["written"]), "reason": reason})
    return result


def _discover_sources(root: Path, category: str,
                      gaps: list[str]) -> list[str]:
    """The category's default sources, project-relative POSIX, sorted. A
    source that resolves (symlinks followed) outside the project root is
    never read: it is a named gap, as an out-of-root `--source` is."""
    dir_glob, name_glob = PUBLISH_SOURCES[category]
    found = set()
    for folder in root.glob(dir_glob):
        if not folder.is_dir():
            continue
        for path in folder.iterdir():
            if path.is_file() and fnmatch.fnmatchcase(path.name.lower(),
                                                      name_glob):
                rel = path.relative_to(root).as_posix()
                resolved = path.resolve()
                try:
                    resolved.relative_to(root)
                except ValueError:
                    gaps.append(f"{category} source {rel!r}: {resolved} is "
                                f"outside the project root {root}")
                    continue
                found.add(rel)
    return sorted(found)


def _page_title(category: str, rel: str) -> str:
    folder_title = dict(confluence.FOLDERS)[category]
    path = Path(rel)
    slug = path.parent.name if path.name.lower() in SLUG_FROM_PARENT \
        and path.parent.name else path.stem
    return f"{folder_title}: {slug}"


def _source_overrides(root: Path, sources: list[str] | None
                      ) -> tuple[dict[str, list[str]], list[str]]:
    """`--source <category>=<path>` (repeatable): the category's sources for
    this run, replacing its default. Every bad flag is a named gap."""
    overrides: dict[str, list[str]] = {}
    gaps = []
    for flag in sources or []:
        category, sep, raw = flag.partition("=")
        category = category.strip()
        if not sep or not raw.strip():
            gaps.append(f"--source {flag!r} is not <category>=<path>")
            continue
        if category not in PUBLISH_SOURCES:
            gaps.append(f"--source {flag!r}: unknown category {category!r} "
                        f"(known: {', '.join(PUBLISH_SOURCES)})")
            continue
        path = Path(raw.strip())
        path = (path if path.is_absolute() else root / path).resolve()
        try:
            rel = path.relative_to(root).as_posix()
        except ValueError:
            gaps.append(f"--source {flag!r}: {path} is outside the project "
                        f"root {root}")
            continue
        if not path.is_file():
            gaps.append(f"--source {flag!r}: {rel} does not exist")
            continue
        bucket = overrides.setdefault(category, [])
        if rel not in bucket:
            bucket.append(rel)
    return overrides, gaps


def _git_out(root: Path, *args: str) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(["git", *args], cwd=str(root),
                              stdin=subprocess.DEVNULL, capture_output=True,
                              encoding="utf-8", errors="replace")
    except OSError:
        return None


def _provenance(root: Path, rel: str) -> str:
    """The last commit that touched the source (never HEAD), with
    `(uncommitted changes)` when it is dirty or untracked; `no commit`
    outside a git work tree."""
    inside = _git_out(root, "rev-parse", "--is-inside-work-tree")
    if inside is None or inside.returncode != 0 \
            or inside.stdout.strip() != "true":
        return "no commit"
    log = _git_out(root, "log", "-1", "--format=%H", "--", rel)
    sha = (log.stdout.strip() if log and log.returncode == 0 else "") \
        or "no commit"
    dirty = _git_out(root, "status", "--porcelain", "--", rel)
    if dirty is not None and dirty.returncode == 0 and dirty.stdout.strip():
        sha += " (uncommitted changes)"
    return sha


def page_hash(title: str, storage: str, attachment_hashes: list[str]) -> str:
    """sha256 over the title, the storage body (footer excluded) and each
    attachment's sha256, in order (Settled shape 2)."""
    return jirabackend._content_hash(title, storage, *attachment_hashes)


def page_footer(source: str, commit: str, digest: str) -> str:
    return (f"<p><em>Published by tk-studio from <code>"
            f"{html.escape(source)}</code> at commit <code>"
            f"{html.escape(commit)}</code>. content-hash: sha256:{digest}"
            f"</em></p>")


def _load_page_index(root: Path) -> list[dict]:
    """The index's entries in their order; [] when absent or unreadable."""
    path = root / PAGE_INDEX_REL
    try:
        pages = json.loads(path.read_text(encoding="utf-8")).get("pages")
    except (OSError, ValueError, AttributeError):
        return []
    return [p for p in pages if isinstance(p, dict)
            and isinstance(p.get("title"), str)] \
        if isinstance(pages, list) else []


def _merge_page_index(previous: list[dict], landed: list[dict]) -> list[dict]:
    """Earlier entries in their order, each replaced by this run's entry of
    the same title; this run's new titles appended in work order. A page not
    processed this run (no folder, a `--source` override, a refusal) keeps
    its entry, so its Jira link does not vanish."""
    fresh = {p["title"]: p for p in landed}
    merged = [fresh.pop(p["title"], p) for p in previous]
    return merged + [p for p in landed if p["title"] in fresh]


def _refuse_image(result: dict, partial: list[str], name: str, source: str,
                  reason: str) -> None:
    result["refused"].append({"name": name, "source": source,
                              "reason": reason})
    partial.append(f"image {name} refused ({reason.split(' — ')[0]})")


def _webui(page: dict | None) -> str | None:
    return ((page or {}).get("_links") or {}).get("webui") or None


def publish(project_root: Path, dry_run: bool = False,
            sources: list[str] | None = None,
            attachment_max_bytes: int | None = None,
            transport=None) -> dict:
    """Publish the design pages (brief, GDD, scope of work, decisions) to
    the folders setup recorded, by stable title, each with a provenance
    footer and a content hash that skips unchanged pages; write the local
    page index the Jira promote links from (Story 31.3, AD-4/AD-5). Ends
    `blocked` (exit 2) on an env gap, an absent binding, a bad `--source`
    or a duplicate title — before any call — or on an auth refusal;
    `partial` when a category has no folder, an attachment or page is
    refused, or a dry run would publish anything; else `complete`."""
    root = Path(project_root).resolve()
    result = _publish_result(dry_run)
    notes = result["notes"]

    def finish(status: str, reason: str | None) -> dict:
        return _finish_publish(result, status, reason)

    gaps = list(confluence.env_gaps())
    space_id = _recorded(root, "planning.confluence.space_id")
    if space_id is None:
        gaps.append("planning.confluence.space_id is not recorded (no "
                    "planning.confluence binding) — run `plansync.py setup` "
                    "first")
    overrides, flag_gaps = _source_overrides(root, sources)
    gaps += flag_gaps
    if attachment_max_bytes is not None and attachment_max_bytes <= 0:
        gaps.append(f"--attachment-max-bytes {attachment_max_bytes} is not "
                    f"a positive byte count")
    by_category = {cat: overrides.get(cat)
                   or _discover_sources(root, cat, gaps)
                   for cat in PUBLISH_SOURCES}
    titles: dict[str, str] = {}
    owners: dict[str, tuple[str, str]] = {}
    category_of: dict[str, str] = {}
    for cat, rels in by_category.items():
        for rel in rels:
            if rel in category_of:
                gaps.append(f"{rel} supplied to two categories "
                            f"({category_of[rel]} and {cat}) — pass it to one")
                continue
            category_of[rel] = cat
            title = _page_title(cat, rel)
            # Confluence titles are unique per space case-insensitively
            key = title.casefold()
            if key in owners and owners[key][0] != rel:
                first, first_title = owners[key]
                named = repr(title) if title == first_title \
                    else f"{first_title!r} / {title!r}"
                gaps.append(f"duplicate page title {named}: {first} "
                            f"and {rel} — rename one source")
            owners.setdefault(key, (rel, title))
            titles[rel] = title
    if gaps:
        return finish("blocked", "publish refused: " + "; ".join(gaps))

    if attachment_max_bytes is None:
        ceiling = ATTACHMENT_CEILING
        notes.append(f"attachment ceiling assumed {ATTACHMENT_CEILING:,} "
                     f"bytes (100 MB): the site's Attachment maximum size was "
                     f"not supplied (--attachment-max-bytes) and REST uploads "
                     f"over 100 MB fail")
    else:
        ceiling = min(attachment_max_bytes, ATTACHMENT_CEILING)
        if attachment_max_bytes > ATTACHMENT_CEILING:
            notes.append(f"attachment ceiling {ATTACHMENT_CEILING:,} bytes: "
                         f"the supplied {attachment_max_bytes:,} is above "
                         f"the 100 MB REST upload ceiling")
        else:
            notes.append(f"attachment ceiling {ceiling:,} bytes: the "
                         f"supplied site setting (--attachment-max-bytes)")

    partial: list[str] = []
    work: list[tuple[str, str, str]] = []  # (category, folder id, source)
    for cat, rels in by_category.items():
        if not rels:
            result["skipped"].append({"category": cat,
                                      "reason": "no source"})
            continue
        folder = _recorded(root, f"planning.confluence.folders.{cat}")
        if folder is None:
            result["skipped"].append({
                "category": cat, "sources": list(rels),
                "reason": f"planning.confluence.folders.{cat} is not "
                          f"recorded — rerun `plansync.py setup`"})
            partial.append(f"category {cat} has no folder")
            continue
        work.extend((cat, folder, rel) for rel in rels)

    site = _recorded(root, "planning.jira.site") \
        or os.environ.get(jirabackend.SITE_ENV)
    conf = confluence.ConfluenceClient(
        os.environ[jirabackend.CLOUD_ID_ENV],
        os.environ[jirabackend.AGENT_EMAIL_ENV],
        os.environ[jirabackend.AGENT_CONFLUENCE_TOKEN_ENV], transport,
        site=site)

    landed: dict[str, dict] = {}
    error = None
    try:
        for cat, folder, rel in work:
            title = titles[rel]
            entry = {"category": cat, "source": rel, "title": title}
            storage, images = mdstorage.convert(
                (root / rel).read_text(encoding="utf-8"), rel, titles)
            uploads, image_hashes = [], []
            for image in images:
                name = image["path"]
                # confined to the project root, symlinks followed, before
                # any read: an absolute path or a non-http(s) scheme too
                path = (root / name).resolve()
                if image.get("outside"):
                    path = None
                else:
                    try:
                        path.relative_to(root)
                    except ValueError:
                        path = None
                if path is None:
                    _refuse_image(result, partial, name, rel,
                                  "outside the project root — left out, "
                                  "the page still publishes")
                    continue
                if not path.is_file():
                    _refuse_image(result, partial, name, rel,
                                  "image not found — left out, the page "
                                  "still publishes")
                    continue
                png = path.suffix.lower() == ".png"
                size = path.stat().st_size
                # a PNG may re-deflate under the ceiling, so only one far
                # over it is refused before the read
                if size > (4 * ceiling if png else ceiling):
                    _refuse_image(result, partial, name, rel,
                                  f"{size:,} bytes is over the per-file "
                                  f"attachment ceiling of {ceiling:,} bytes "
                                  f"— left out, the page still publishes")
                    continue
                source_bytes = path.read_bytes()
                data = mdstorage.recompress_png(source_bytes) if png \
                    else source_bytes
                if len(data) > ceiling:
                    _refuse_image(result, partial, name, rel,
                                  f"{len(data):,} bytes is over the per-file "
                                  f"attachment ceiling of {ceiling:,} bytes "
                                  f"— left out, the page still publishes")
                    continue
                # the hash is over the source bytes: another zlib build
                # never republishes an unchanged image
                digest = hashlib.sha256(source_bytes).hexdigest()
                image_hashes.append(digest)
                uploads.append((image["filename"], data, digest))
            digest = page_hash(title, storage, image_hashes)
            body = storage + page_footer(rel, _provenance(root, rel), digest)

            page_id = confluence.find_page(conf, folder, title)
            if page_id is not None:
                page = confluence.get_page(conf, page_id)
                webui = _webui(page)
                result["found"].append({**entry, "page_id": page_id})
                # the footer is the page's last element: its hash is the
                # last match (a source may quote the marker)
                hashes = FOOTER_HASH_RE.findall(confluence.page_body(page))
                remote = hashes[-1] if hashes else None
                if remote == digest:
                    result["skipped"].append({**entry, "page_id": page_id,
                                              "reason": "unchanged"})
                else:
                    notes.append(
                        f"{title}: " + ("the remote page carries no tk-studio "
                                        "content hash" if not remote else
                                        "the remote content hash differs "
                                        "(the source changed, or the page was "
                                        "edited in Confluence)")
                        + (" — would be overwritten" if dry_run
                           else " — overwritten")
                        + ", the local source wins (AD-5)")
                    if dry_run:
                        result["would_publish"].append({
                            **entry, "page_id": page_id, "action": "update"})
                        continue
                    put, detail = confluence.update_page(
                        conf, page_id, title, body,
                        confluence.page_version(page) + 1)
                    if put is None:
                        result["refused"].append({"name": title,
                                                  "source": rel,
                                                  "reason": f"update refused: "
                                                            f"{detail}"})
                        partial.append(f"page {title} update refused")
                        continue
                    webui = _webui(put) or webui
                    result["updated"].append({**entry, "page_id": page_id})
            else:
                if dry_run:
                    result["would_publish"].append({**entry,
                                                    "action": "create"})
                    continue
                made, detail = confluence.create_page(conf, space_id, folder,
                                                      title, body)
                if made is None:
                    result["refused"].append({"name": title, "source": rel,
                                              "reason": f"create refused: "
                                                        f"{detail}"})
                    partial.append(f"page {title} create refused")
                    continue
                page_id = str(made["id"])
                webui = _webui(made)
                result["created"].append({**entry, "page_id": page_id})
            landed[rel] = {**entry, "page_id": page_id, "webui": webui}

            if uploads:
                remote_files = {a.get("title"): a for a in
                                confluence.list_attachments(conf, page_id)}
                pending = []
                for filename, data, sha in uploads:
                    comment = f"sha256:{sha}"
                    held = remote_files.get(filename)
                    if held and comment in str(held.get("comment") or ""):
                        continue
                    pending.append((filename, data, comment))
                if dry_run:
                    # only an unchanged page reaches here on a dry run (a
                    # read, never a write): its missing or stale
                    # attachments are what a real run would still publish
                    if pending:
                        result["would_publish"].append({
                            **entry, "page_id": page_id, "action": "attach",
                            "attachments": [f for f, _, _ in pending]})
                    continue
                for filename, data, comment in pending:
                    ok, detail = confluence.upload_attachment(
                        conf, page_id, filename, data, comment)
                    if not ok:
                        result["refused"].append({
                            "name": filename, "source": rel,
                            "reason": f"upload refused: {detail}"})
                        partial.append(f"attachment {filename} refused")
                        continue
                    result["bytes_uploaded"] += len(data)
    except (confluence.ConfluenceError, OSError, UnicodeDecodeError) as exc:
        error = str(exc)

    if dry_run:
        notes.append("dry run: nothing published, the page index not written")
    else:
        notes.append(f"{result['bytes_uploaded']} bytes uploaded this run; "
                     f"{FREE_STORAGE_NOTE}")
        pages = _merge_page_index(_load_page_index(root),
                                  [landed[rel] for _, _, rel in work
                                   if rel in landed])
        target = root / PAGE_INDEX_REL
        text = json.dumps({"pages": pages}, ensure_ascii=False,
                          indent=2) + "\n"
        try:
            old = target.read_text(encoding="utf-8") \
                if target.is_file() else None
        except (OSError, UnicodeDecodeError):
            old = None  # unreadable: rewritten, the run still ends (AD-11)
        if pages and text != old:
            _atomic_write(target, text)
            result["written"].append(PAGE_INDEX_REL.as_posix())

    if error is not None:
        return finish("blocked", f"publish: {error}")
    if partial:
        return finish("partial", "publish partial: " + "; ".join(partial))
    if result["would_publish"]:
        return finish("partial", "dry run: nothing published; a real run "
                                 "would publish " + ", ".join(
                                     w["title"] for w in result["would_publish"]))
    return finish("complete", None)


# --------------------------------------------------------------- sync-back

SYNC_BACK_INTENT = SETUP_INTENT


def _finish_sync_back(result: dict, status: str, reason: str | None) -> dict:
    result["ok"] = status != "blocked"
    result.update({"status": status, "intent": SYNC_BACK_INTENT,
                   "artifacts": list(result["written"]), "reason": reason})
    return result


def sync_back(project_root: Path, dry_run: bool = False, transport=None,
              sleep=None, now=None) -> dict:
    """Pull status, comments, attachments and the owner's Confluence pages
    into local memory (Story 31.4; the tick is `syncback.tick`). Ends
    `blocked` (exit 2) on no `planning.jira` binding or an absent Jira
    variable — each named, before any call — or on a failed preflight
    (unreachable, deactivated, the 401/403 split); `partial` on an absent
    Confluence token, owner accountId or space id, a conflict, or a 429 or
    error that interrupted a read (the cursor unchanged); else
    `complete`. A tick that changed a canonical status regenerates
    `plan/index.md` (local-only, FR14). Never promotes anything (D9,
    AD-5)."""
    root = Path(project_root).resolve()
    result = syncback.new_result(dry_run)

    def finish(status: str, reason: str | None) -> dict:
        return _finish_sync_back(result, status, reason)

    if _recorded(root, "planning.jira.project_key") is None:
        return finish("blocked", "sync-back refused: "
                      "planning.jira.project_key is not recorded (no "
                      "planning.jira binding) — run `plansync.py setup` "
                      "first; no Atlassian call made")
    settings, gaps = jirabackend._resolve_settings(root, None)
    if not os.environ.get(jirabackend.AGENT_TOKEN_ENV) \
            and not os.environ.get(jirabackend.TOKEN_ENV):
        gaps.insert(0, f"{jirabackend.AGENT_TOKEN_ENV} is not set (the "
                       f"agent seat's Jira token)")
    if gaps:
        reason = ("sync-back refused: " + "; ".join(gaps)
                  + " — no Atlassian call made")
        if not dry_run and not any(g.startswith("planning.jira.")
                                   for g in gaps):
            syncback.record_refusal(root, result, "token-missing", reason,
                                    now)
        return finish("blocked", reason)

    jira = jirabackend.client_for(settings, transport)
    conf, conf_gaps = None, confluence.env_gaps()
    if not conf_gaps:
        conf = confluence.ConfluenceClient(
            os.environ[jirabackend.CLOUD_ID_ENV],
            os.environ[jirabackend.AGENT_EMAIL_ENV],
            os.environ[jirabackend.AGENT_CONFLUENCE_TOKEN_ENV], transport,
            site=settings.get("site"))
    if sleep is not None:
        jira.sleep = sleep
        if conf is not None:
            conf.sleep = sleep
    binding = {
        "project_key": settings["project_key"],
        "site": re.sub(r"^https?://", "", settings.get("site") or "").strip("/")
        or None,
        "owner_account_id": _recorded(root, "planning.jira.owner_account_id"),
        "agent_account_id": _recorded(root, "planning.jira.agent_account_id"),
        "space_id": _recorded(root, "planning.confluence.space_id"),
        "space_key": _recorded(root, "planning.confluence.space_key"),
        "published": {str(p.get("page_id")) for p in _load_page_index(root)
                      if p.get("page_id") is not None},
    }
    status, reason = syncback.tick(root, result, binding, plan_dir(root),
                                   jira, conf, conf_gaps, now=now)
    if not dry_run and any("status" in a["fields"] for a in result["applied"]):
        # FR14: the index follows the canonical files the tick changed —
        # local-only, never a promote (D9)
        try:
            index = generate_plan_index(root)
        except PlanSyncError as exc:
            result["notes"].append(f"plan index not regenerated: {exc}")
        else:
            if index["changed"]:
                result["written"].append(
                    Path(index["index"]).resolve().relative_to(root)
                    .as_posix())
    return finish(status, reason)


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: entity titles
    # are arbitrary unicode and the status JSON must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio planning adapter")
    sub = parser.add_subparsers(dest="command", required=True)
    norm = sub.add_parser("normalize")
    norm.add_argument("--directory", required=True, help="project root (walks up to the nearest)")
    norm.add_argument("--dry-run", action="store_true")
    snc = sub.add_parser("sync")
    snc.add_argument("--directory", required=True, help="project root (walks up to the nearest)")
    snc.add_argument("--dry-run", action="store_true")
    snc.add_argument("--backend", choices=list(BACKENDS),
                     help="runtime binding override (AD-15: runtime wins)")
    val = sub.add_parser("validate")
    val.add_argument("--directory", required=True, help="project root (walks up to the nearest)")
    sts = sub.add_parser("status")
    sts.add_argument("--directory", required=True, help="project root (walks up to the nearest)")
    sts.add_argument("--id", required=True, dest="entity_id",
                     help="canonical story id (ST-NNN)")
    # Validated in code, not argparse choices: a refusal stays JSON (exit 2).
    sts.add_argument("--status", required=True, help="canonical status enum")
    sts.add_argument("--note", default="")
    sts.add_argument("--caller", default=DEFAULT_CALLER)
    sts.add_argument("--dry-run", action="store_true")
    stp = sub.add_parser("setup")
    stp.add_argument("--directory", required=True, help="project root (walks up to the nearest)")
    stp.add_argument("--dry-run", action="store_true")
    stp.add_argument("--owner-account-id", default=None)
    stp.add_argument("--owner-email", default=None)
    pub = sub.add_parser("publish")
    pub.add_argument("--directory", required=True, help="project root (walks up to the nearest)")
    pub.add_argument("--dry-run", action="store_true")
    pub.add_argument("--source", action="append", default=None,
                     metavar="CATEGORY=PATH",
                     help="replace a category's default sources (repeatable)")
    pub.add_argument("--attachment-max-bytes", type=int, default=None,
                     help="the site's Attachment maximum size, in bytes")
    sbk = sub.add_parser("sync-back")
    sbk.add_argument("--directory", required=True, help="project root (walks up to the nearest)")
    sbk.add_argument("--dry-run", action="store_true")

    args = parser.parse_args(argv)
    # --directory walks up to the nearest project root (driver contract
    # 0.1.22): from inside a nested project the nested counter is minted.
    args.directory = configlib.find_project_root(Path(args.directory))
    try:
        if args.command == "normalize":
            result = normalize(Path(args.directory), dry_run=args.dry_run)
        elif args.command == "sync":
            runtime = ({"planning": {"backend": args.backend}}
                       if args.backend else None)
            result = sync(Path(args.directory), dry_run=args.dry_run,
                          runtime=runtime)
        elif args.command == "setup" and args.owner_account_id \
                and args.owner_email:
            result = setup_flag_refusal(Path(args.directory),
                                        dry_run=args.dry_run)
        elif args.command == "setup":
            result = setup(Path(args.directory), dry_run=args.dry_run,
                           owner_account_id=args.owner_account_id,
                           owner_email=args.owner_email)
        elif args.command == "publish":
            result = publish(Path(args.directory), dry_run=args.dry_run,
                             sources=args.source,
                             attachment_max_bytes=args.attachment_max_bytes)
        elif args.command == "sync-back":
            result = sync_back(Path(args.directory), dry_run=args.dry_run)
        elif args.command == "status":
            result = status_pull_back(Path(args.directory), args.entity_id,
                                      args.status, note=args.note,
                                      caller=args.caller, dry_run=args.dry_run)
        else:
            result = validate(Path(args.directory))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result.get("ok") else 2
    except PlanSyncError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
