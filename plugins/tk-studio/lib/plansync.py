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
  uv run plansync.py stage --start|--stop (--story KEY | --entity ID)
                           --stage NAME [--pass N] [--model M] [--effort E]
                           [--session-id S] [--outcome O] [--dry-run]
  uv run plansync.py stage --append --story KEY --row-json JSON
  uv run plansync.py stage --from-pass --run-dir D --story KEY [--role R]
                           [--phase P] --worktree W
  uv run plansync.py stage-post --directory ROOT --id ST-NNN [--story KEY]
                                [--dry-run]
  uv run plansync.py ledger-resolve --directory ROOT --pr OWNER/REPO#N
                                    --ids DW-a,DW-b [--date YYYY-MM-DD]
                                    [--dry-run]

`stage` (Story 35.8) writes the story spec's append-only `## Stage Log`
table (stage, pass, started, ended, session_id, model, effort, tokens_in,
tokens_out, cost_usd, outcome; elapsed never stored): the operator's
`--start`/`--stop`, the supervisor's `--append`, the engine hook's
`--from-pass` (one row per pass from state.json, the journal and the
transcript's usage lines, plus one per consult subagent). A row written
before the spec exists waits in `<spec_folder>/stages/<key>.jsonl`.
`stage-post` mirrors the rows onto the story's Jira issue as a start and a
finish comment and a worklog, recorded in
`_bmad-output/tracking/stage-posts.json`. Both end in the status block.

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

`ledger-resolve` (Story 35.7) is the sweep's plan pull-back after its PR
merged: each named `_bmad-output/implementation-artifacts/deferred-work.md`
entry whose `status:` is the engine's `done <date>` is rewritten to
`resolved <date> by <owner/repo>#N (sweep bundle dw-<name>; <the engine's
resolution, clipped>)` — the one line, every other byte kept, one atomic
write. An entry already `resolved … by <owner/repo>#N` (or closed any other
way) is `unchanged`; a still-`open` or absent one is `pending` (the owner
checkout has not pulled the merge yet: asked again). `ok` is true on every
answer but a refusal (no ledger, a malformed `--pr` or id); the result
names `resolved[]`, `pending[]`, `unchanged[]` and ends with the AD-11
status block (`partial` while anything is pending).

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


def _carried_stage_log(body: str) -> str:
    """An entity body's `## Stage Log` section (Story 35.8: the epic's
    planning row), carried over the source refresh — the table is
    append-only, never a field the source owns. Empty when absent."""
    lines = body.split("\n")
    mask = _fence_mask(lines)
    at = _heading_index(lines, mask, STAGE_HEADING)
    if at is None:
        return ""
    section = lines[at:_section_end(lines, mask, at)]
    while section and not section[-1].strip():
        section.pop()
    return "\n" + "\n".join(section) + "\n"


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
            new_body = "\n" + section["body"] + "\n" + _carried_stage_log(body)
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
    the site (`existing`) is added to the workflow, never created again.
    The global transitions go into the To Do-category status (`existing`'s
    `To Do` slot names it, DW-107), `Blocked - Awaiting User` and `DNI`."""
    def add(name: str) -> str:
        if name in existing:
            return (f"Choose Add status and add the existing status "
                    f"`{name}` to the workflow (do not create a new one).")
        category = _STATUS_CATEGORY[
            jirabackend.STATUS_CATEGORY[name]]
        return (f"Choose Add status, create `{name}` in the {category} "
                f"category.")
    todo = jirabackend.TODO_STATUS
    if isinstance(existing, dict) and isinstance(existing.get(todo), dict):
        todo = existing[todo].get("name") or todo
    return [f"Sign in to https://{site} as the owner seat and open Settings "
            f"> Work items > Workflows; choose Edit on the workflow project "
            f"`{key}` uses.",
            add(jirabackend.BLOCKED_STATUS),
            add(jirabackend.RESOLVED_STATUS),
            add(jirabackend.DNI_STATUS),
            f"Add a transition from `{jirabackend.BLOCKED_STATUS}` to "
            f"`{jirabackend.RESOLVED_STATUS}`.",
            f"On each of `{todo}`, `{jirabackend.BLOCKED_STATUS}` and "
            f"`{jirabackend.DNI_STATUS}`, tick Allow all statuses to "
            f"transition to this one (a global transition), then choose "
            f"Update workflow."]


_STATUS_CATEGORY = {"To Do": "To Do", "In Progress": "In Progress",
                    "Done": "Done", "IN_PROGRESS": "In Progress",
                    "DONE": "Done"}


def _workflow_labels(have: dict) -> list[str]:
    """The transition labels setup reports, by name, before the statuses
    have ids (the dry run)."""
    todo = (have.get(jirabackend.TODO_STATUS) or {}).get("name") \
        or jirabackend.TODO_STATUS
    return [f"transition {jirabackend.BLOCKED_STATUS} -> "
            f"{jirabackend.RESOLVED_STATUS}",
            f"global transition -> {todo}",
            f"global transition -> {jirabackend.BLOCKED_STATUS}",
            f"global transition -> {jirabackend.DNI_STATUS}"]


def _template_status_steps(site: str, key: str, missing: list[str],
                           team: bool) -> list[str]:
    where = (f"open project `{key}` > Project settings > Issue types > "
             f"Story, and choose Edit workflow" if team else
             f"open Settings > Work items > Workflows and choose Edit on the "
             f"workflow project `{key}` uses")
    return ([f"Sign in to https://{site} as the owner seat and {where}."]
            + [f"Add status `{name}` in the {_STATUS_CATEGORY[name]} "
               f"category, then save the workflow." for name in missing])


def _team_status_steps(site: str, key: str, have=None) -> list[str]:
    """The team-managed workflow steps; the global transitions go into the
    To Do-category status (`have`'s `To Do` slot names it, DW-107),
    `Blocked - Awaiting User` and `DNI`, as on a company-managed project."""
    todo = ((have or {}).get(jirabackend.TODO_STATUS) or {}).get("name") \
        or jirabackend.TODO_STATUS
    return [f"Sign in to https://{site} as the owner seat, open project "
            f"`{key}` > Project settings > Issue types > Story, and choose "
            f"Edit workflow.",
            f"Add status `{jirabackend.BLOCKED_STATUS}` in the In progress "
            f"category.",
            f"Add status `{jirabackend.RESOLVED_STATUS}` in the In progress "
            f"category.",
            f"Add status `{jirabackend.DNI_STATUS}` in the Done category.",
            f"Add a transition from `{jirabackend.BLOCKED_STATUS}` to "
            f"`{jirabackend.RESOLVED_STATUS}`.",
            f"On each of `{todo}`, `{jirabackend.BLOCKED_STATUS}` and "
            f"`{jirabackend.DNI_STATUS}`, tick Allow all statuses to "
            f"transition to this one (a global transition), then choose "
            f"Save changes; repeat for the Epic issue type."]


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

        # 3. issue types, 4. the five-status workflow, DNI and the
        # transitions
        if proj is not None:
            pid = str(proj.get("id"))
            have_types, missing_types = jirabackend.confirm_issue_types(proj)
            found += [f"issue type {t}" for t in have_types]
            if missing_types:
                groups.append(_issue_type_steps(site, key, missing_types))
            team = jirabackend.is_team_managed(proj)
            have = jirabackend.find_statuses(jira, pid, key, team)
            for n in jirabackend.TEMPLATE_STATUSES + (jirabackend.DNI_STATUS,):
                if n not in have:
                    continue
                actual = have[n].get("name")
                found.append(f"status {n}" if actual in (None, n)
                             else f"status {n} (satisfied by {actual})")
            missing_template = [n for n in jirabackend.TEMPLATE_STATUSES
                                if n not in have
                                and n not in jirabackend.SETUP_STATUSES]
            if missing_template:
                groups.append(_template_status_steps(site, key,
                                                     missing_template, team))
            missing = [n for n in jirabackend.CREATED_STATUSES
                       if n not in have]
            company_steps = False
            if missing and team:
                groups.append(_team_status_steps(site, key, have))
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
                if not all(n in have for n in jirabackend.CREATED_STATUSES):
                    if dry_run:
                        would.extend(_workflow_labels(have))
                else:
                    flow, why = jirabackend.find_workflow(jira, key)
                    if flow is None:
                        notes.append(f"workflow not selected: {why}")
                        groups.append(_company_status_steps(site, key, have))
                    else:
                        needed = jirabackend.workflow_transitions(flow, have)
                        found += [lb for lb, _, ok in needed if ok]
                        absent = [(lb, tr) for lb, tr, ok in needed if not ok]
                        if absent and dry_run:
                            would.extend(lb for lb, _ in absent)
                        elif absent:
                            version, why = jirabackend.find_workflow_version(
                                jira, key)
                            if version is None:
                                notes.append(f"workflow not selected: {why}")
                                groups.append(
                                    _company_status_steps(site, key, have))
                            else:
                                done, detail = jirabackend.update_workflow(
                                    jira, flow, version,
                                    # the To Do slot's status too: a
                                    # GLOBAL transition into it needs it
                                    # on the workflow
                                    [str(have[n].get("id")) for n in
                                     jirabackend.CREATED_STATUSES
                                     + (jirabackend.TODO_STATUS,)
                                     if n in have],
                                    [tr for _, tr in absent])
                                if done:
                                    created.extend(lb for lb, _ in absent)
                                else:
                                    notes.append(
                                        f"workflow update refused: {detail}")
                                    groups.append(_company_status_steps(
                                        site, key, have))
        elif dry_run:
            would.extend(f"status {n}" for n in jirabackend.CREATED_STATUSES)
            would.extend(_workflow_labels({}))

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
                # the client folds the 401 into its own message (the token, its email,
                # the org toggle), so a 401 on this one listing counts as the scope gap
                if "scope" not in str(exc).lower() and " 401 " not in str(exc):
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


# ------------------------------------------------- stage log (Story 35.8)
#
# One append-only `## Stage Log` table per story spec (AC1): one row per
# stage occurrence, the columns exactly STAGE_COLUMNS, `—` for an empty
# cell. Elapsed is never stored — only derived. A row's key is
# sha1("<story>|<stage>|<pass>|<started>")[:12], derived from the row and
# never a column. The section sits after `## Consult Log` (else before
# `## Auto Run Result`, else at the end); rows are only ever appended,
# except that `stage --stop` completes its own open row in place. A row
# written before the spec exists is buffered in
# `<spec_folder>/stages/<story>.jsonl` and flushed into the table (in
# started order) by the next write that finds the spec.

STAGE_HEADING = "## Stage Log"
STAGE_COLUMNS = ("stage", "pass", "started", "ended", "session_id", "model",
                 "effort", "tokens_in", "tokens_out", "cost_usd", "outcome")
NO_VALUE = "—"
CONSULT_LOG_HEADING = "## Consult Log"
AUTO_RUN_HEADING = "## Auto Run Result"
CONSULT_MARKER = "# Consult: a ruling on one objective trigger"
SPECS_REL = Path("_bmad-output") / "specs"
STAGE_BUFFER_DIRNAME = "stages"
STAGE_POSTS_REL = syncback.TRACKING_REL / "stage-posts.json"
ROUTING_CURRENT_REL = Path(".bmad-loop") / "routing.current.json"
# the routing leg whose effort a stage ran at
STAGE_LEGS = {"plan": "planner", "dev": "implementer", "review": "reviewers",
              "gate": "reviewers", "consult": "consult"}
STAGE_INTENT = SETUP_INTENT
WORKLOG_MIN_SECONDS = 60  # Jira's minimum worklog: a shorter span logs none
WORKLOG_SKIPPED = "skipped: span <60s"
STAGE_HEADER_LINE = "| " + " | ".join(STAGE_COLUMNS) + " |"
STAGE_RULE_LINE = "|" + "|".join("---" for _ in STAGE_COLUMNS) + "|"
_FENCE_RE = re.compile(r"^\s*(```|~~~)")
_TABLE_RULE_RE = re.compile(r"^\|\s*:?-")


def _finish_stage(result: dict, status: str, reason: str | None) -> dict:
    result["ok"] = status == "complete"
    artifacts = list(result.get("written") or [])
    for key in ("status", "intent", "artifacts", "reason"):
        result.pop(key, None)
    result.update({"status": status, "intent": STAGE_INTENT,
                   "artifacts": artifacts, "reason": reason})
    return result


def _stage_cell(value) -> str:
    """One table cell: `—` when empty; never a `|` or a line break."""
    if value is None or value == "":
        return NO_VALUE
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, float):
        return f"{value:.4f}"
    text = " ".join(str(value).split()).replace("|", "/")
    return text or NO_VALUE


def _stage_stamp(value) -> str:
    """`YYYY-MM-DDTHH:MM:SSZ` (UTC) from an ISO-8601 string (any offset,
    `Z`, fractional seconds) or epoch seconds (or nanoseconds)."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        secs = float(value)
        if secs > 1e14:  # the hook relay's time_ns()
            secs /= 1e9
        moment = datetime.fromtimestamp(secs, timezone.utc)
    elif isinstance(value, str) and value.strip() and value.strip() != NO_VALUE:
        text = value.strip()
        if text.endswith(("Z", "z")):
            text = text[:-1] + "+00:00"
        try:
            moment = datetime.fromisoformat(text)
        except ValueError as exc:
            raise PlanSyncError(f"stage: {value!r} is not an ISO-8601 "
                                f"timestamp") from exc
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
    else:
        raise PlanSyncError(f"stage: {value!r} is not a timestamp")
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def stage_moment(text: str | None) -> datetime | None:
    """A Stage Log stamp as an aware datetime; None for `—` or unreadable."""
    if not text or text == NO_VALUE:
        return None
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def stage_story(key: str) -> str:
    """The story a key names: a spec file's stem (`<key>-spec`) maps to it."""
    key = (key or "").strip()
    return key[:-len("-spec")] if key.endswith("-spec") else key


def stage_row_key(story: str, row: dict) -> str:
    """sha1(`<story>|<stage>|<pass>|<started>`)[:12] — derived, never a column."""
    raw = f"{stage_story(story)}|{row['stage']}|{row['pass']}|{row['started']}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def stage_row(raw: dict) -> dict:
    """One row from loose fields: every column a cell, stamps normalised."""
    if not isinstance(raw, dict):
        raise PlanSyncError("stage: a row must be a JSON object")
    unknown = set(raw) - set(STAGE_COLUMNS)
    if unknown:
        raise PlanSyncError("stage: row fields outside the Stage Log columns: "
                            + ", ".join(sorted(unknown))
                            + " (elapsed is never stored, only derived)")
    row = {column: _stage_cell(raw.get(column)) for column in STAGE_COLUMNS}
    if row["stage"] == NO_VALUE:
        raise PlanSyncError("stage: a row needs its stage")
    if raw.get("started") in (None, "", NO_VALUE):
        raise PlanSyncError(f"stage: the {row['stage']} row needs its "
                            f"started stamp")
    row["started"] = _stage_stamp(raw["started"])
    if raw.get("ended") not in (None, "", NO_VALUE):
        row["ended"] = _stage_stamp(raw["ended"])
    return row


def _fence_mask(lines: list[str]) -> list[bool]:
    mask, inside = [], False
    for line in lines:
        if _FENCE_RE.match(line):
            mask.append(True)
            inside = not inside
            continue
        mask.append(inside)
    return mask


def _heading_index(lines: list[str], mask: list[bool], heading: str) -> int | None:
    for i, line in enumerate(lines):
        if not mask[i] and line.strip() == heading:
            return i
    return None


def _section_end(lines: list[str], mask: list[bool], start: int) -> int:
    for i in range(start + 1, len(lines)):
        if not mask[i] and lines[i].startswith("## "):
            return i
    return len(lines)


def _row_line(row: dict) -> str:
    return "| " + " | ".join(row[c] for c in STAGE_COLUMNS) + " |"


def _stage_table(text: str) -> tuple[list[str], list[bool], int | None,
                                     list[tuple[int, dict]]]:
    """(lines, fence mask, the heading's index, [(line index, row)])."""
    lines = text.split("\n")
    mask = _fence_mask(lines)
    at = _heading_index(lines, mask, STAGE_HEADING)
    rows: list[tuple[int, dict]] = []
    if at is None:
        return lines, mask, None, rows
    header = False
    for i in range(at + 1, _section_end(lines, mask, at)):
        line = lines[i].strip()
        if not line.startswith("|") or _TABLE_RULE_RE.match(line):
            continue
        if not header:
            header = True
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) == len(STAGE_COLUMNS):
            rows.append((i, dict(zip(STAGE_COLUMNS, cells))))
    return lines, mask, at, rows


def parse_stage_log(text: str) -> list[dict]:
    """The rows of a document's `## Stage Log` table, in table order."""
    return [row for _, row in _stage_table(text)[3]]


def insert_stage_rows(text: str, rows: list[dict]) -> str:
    """Append rows to the table, creating the section in its place."""
    lines, mask, at, table = _stage_table(text)
    new = [_row_line(r) for r in rows]
    if at is not None:
        if table:
            pos = table[-1][0] + 1
        else:
            end = _section_end(lines, mask, at)
            pipes = [i for i in range(at + 1, end)
                     if lines[i].strip().startswith("|")]
            if pipes:
                pos = pipes[-1] + 1
            else:
                new = ["", STAGE_HEADER_LINE, STAGE_RULE_LINE] + new
                pos = at + 1
        lines[pos:pos] = new
        return "\n".join(lines)
    block = [STAGE_HEADING, "", STAGE_HEADER_LINE, STAGE_RULE_LINE, *new, ""]
    consult = _heading_index(lines, mask, CONSULT_LOG_HEADING)
    auto = _heading_index(lines, mask, AUTO_RUN_HEADING)
    if consult is not None:
        pos = _section_end(lines, mask, consult)
        if auto is not None and pos > auto:
            pos = auto  # never after the Auto Run Result
    elif auto is not None:
        pos = auto
    else:
        while lines and lines[-1].strip() == "":
            lines.pop()
        return "\n".join(lines + ["", *block])
    if pos > 0 and lines[pos - 1].strip() != "":
        block = ["", *block]
    lines[pos:pos] = block
    return "\n".join(lines)


def _stage_target(root: Path, story: str | None, entity: str | None
                  ) -> tuple[Path | None, str]:
    """(the document holding the table — None while the spec is unwritten,
    the story or entity id the row keys use)."""
    if entity:
        found = _find_entity(plan_dir(root), entity)
        if found is None:
            raise PlanSyncError(f"stage: unknown id {entity}: no canonical "
                                f"entity in {plan_dir(root)}")
        return found[0], entity
    sid = stage_story(story or "")
    if not sid or re.search(r"[\\/*?\[\]]", sid):
        raise PlanSyncError("stage: --story <key> or --entity <id> names "
                            "the document")
    stories = sorted({p for pattern in (f"{sid}.md", f"{sid}-*.md")
                      for p in (root / SPECS_REL).glob(f"*/stories/{pattern}")})
    if len(stories) > 1:
        raise PlanSyncError(
            f"stage: several specs match story {sid}: "
            + ", ".join(p.relative_to(root).as_posix() for p in stories)
            + " — name one")
    return (stories[0] if stories else None), sid


def _derived_buffer(root: Path, sid: str, spec_folder: str | None) -> Path | None:
    folder = Path(spec_folder) if spec_folder else None
    if folder is None:
        m = re.match(r"^(\d+)-", sid)
        if not m:
            return None
        folder = SPECS_REL / f"spec-epic-{int(m.group(1))}"
    return (root / folder / STAGE_BUFFER_DIRNAME / f"{sid}.jsonl").resolve()


def _buffer_paths(root: Path, sid: str, target: Path | None,
                  spec_folder: str | None) -> list[Path]:
    paths: list[Path] = []
    if target is not None and target.parent.name == "stories":
        paths.append((target.parent.parent / STAGE_BUFFER_DIRNAME
                      / f"{sid}.jsonl").resolve())
    derived = _derived_buffer(root, sid, spec_folder)
    if derived is not None and derived not in paths:
        paths.append(derived)
    return paths


def _read_buffer(paths: list[Path]) -> list[dict]:
    rows: list[dict] = []
    for path in paths:
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").split("\n"):
            if not line.strip():
                continue
            try:
                raw = json.loads(line)
            except ValueError:
                continue
            if isinstance(raw, dict):
                rows.append({c: _stage_cell(raw.get(c)) for c in STAGE_COLUMNS})
    return rows


def _write_buffer(path: Path, rows: list[dict]) -> None:
    _atomic_write(path, "".join(json.dumps(r, ensure_ascii=False) + "\n"
                                for r in rows))


def _rel(root: Path, path: Path) -> str:
    try:
        return Path(path).resolve().relative_to(Path(root).resolve()).as_posix()
    except ValueError:
        return str(path)


class _StageDoc:
    """One story's (or entity's) Stage Log as loaded: the table's document
    (None while the spec is unwritten), its text and rows, and the buffer."""

    def __init__(self, root: Path, story: str | None, entity: str | None,
                 spec_folder: str | None = None,
                 extra_roots: list[Path] | None = None):
        self.root = Path(root)
        self.target, self.sid = _stage_target(self.root, story, entity)
        self.original = (self.target.read_text(encoding="utf-8")
                         if self.target is not None else None)
        self.text = self.original
        self.buffers = (_buffer_paths(self.root, self.sid, self.target,
                                      spec_folder) if not entity else [])
        # Another root's buffers (`--from-pass --repo-root`: the planner ran
        # there): read with this root's, moved here on commit, then removed.
        self.extra_buffers: list[Path] = []
        for extra in extra_roots or []:
            for path in self._mirrored_buffers(Path(extra), spec_folder):
                if path not in self.buffers and path not in self.extra_buffers:
                    self.extra_buffers.append(path)
        self.buffered = []
        known: set[str] = set()
        for row in _read_buffer(self.buffers + self.extra_buffers):
            key = stage_row_key(self.sid, row)
            if key not in known:
                known.add(key)
                self.buffered.append(row)
        self.buffer_dirty = False

    def _mirrored_buffers(self, extra: Path, spec_folder: str | None) -> list[Path]:
        """This story's buffer paths under another root: the target's spec
        folder at the same relative place, and the derived one."""
        paths: list[Path] = []
        if self.target is not None and self.target.parent.name == "stories":
            try:
                folder = self.target.parent.parent.resolve().relative_to(
                    self.root.resolve())
            except ValueError:
                folder = None
            if folder is not None:
                paths.append((extra / folder / STAGE_BUFFER_DIRNAME
                              / f"{self.sid}.jsonl").resolve())
        derived = _derived_buffer(extra, self.sid, spec_folder)
        if derived is not None and derived not in paths:
            paths.append(derived)
        return paths

    @property
    def table(self) -> list[dict]:
        return parse_stage_log(self.text) if self.text is not None else []

    def rows(self) -> list[dict]:
        """Every row on record: the table's, then the buffered ones."""
        return self.table + self.buffered

    def keys(self) -> set[str]:
        return {stage_row_key(self.sid, r) for r in self.rows()}

    def fresh(self, rows: list[dict]) -> list[dict]:
        """The rows whose key is not on record yet (deduped among themselves)."""
        known, out = self.keys(), []
        for row in rows:
            key = stage_row_key(self.sid, row)
            if key not in known:
                known.add(key)
                out.append(row)
        return out

    def complete(self, match, update: dict) -> dict | None:
        """Complete the last open row `match` accepts, in place (the only
        in-place change); answers the completed row."""
        if self.text is not None:
            lines, _, _, table = _stage_table(self.text)
            for i, row in reversed(table):
                if row["ended"] == NO_VALUE and match(row):
                    done = {**row, **update}
                    lines[i] = _row_line(done)
                    self.text = "\n".join(lines)
                    return done
        for j in range(len(self.buffered) - 1, -1, -1):
            row = self.buffered[j]
            if row["ended"] == NO_VALUE and match(row):
                done = {**row, **update}
                self.buffered[j] = done
                self.buffer_dirty = True
                return done
        return None

    def commit(self, fresh: list[dict], dry_run: bool, result: dict) -> None:
        """Write fresh rows (and flush the buffer) into the table, or buffer
        them while the spec is unwritten; names every write in `written[]`
        and every buffer flushed away in `removed[]`."""
        written = result.setdefault("written", [])
        removed = result.setdefault("removed", [])
        if self.target is not None:
            known = {stage_row_key(self.sid, r) for r in self.table}
            pending = []
            for row in sorted(self.buffered, key=lambda r: r["started"]):
                key = stage_row_key(self.sid, row)
                if key not in known:
                    known.add(key)
                    pending.append(row)
            rows = pending + fresh
            text = insert_stage_rows(self.text, rows) if rows else self.text
            if text != self.original:
                if not dry_run:
                    _atomic_write(self.target, text)
                written.append(_rel(self.root, self.target))
            for path in self.buffers:
                if path.is_file():
                    if not dry_run:
                        path.unlink()
                        try:
                            path.parent.rmdir()  # only when now empty
                        except OSError:
                            pass
                    removed.append(_rel(self.root, path))
            # the table written first, then every buffer it now holds removed
            # (a crash between leaves rows the next write dedupes by key)
            for path in self.extra_buffers:
                self._remove_buffer(path, dry_run, removed)
            result["flushed"] = len(pending)
            return
        if not self.buffers:
            raise PlanSyncError(
                f"stage: no spec for story {self.sid} under "
                f"{SPECS_REL.as_posix()}/*/stories/ and no spec folder to "
                f"buffer its rows in")
        path = self.buffers[-1]
        result["buffer"] = _rel(self.root, path)
        moved = [p for p in self.extra_buffers if p.is_file()]
        if fresh or self.buffer_dirty or moved:
            if not dry_run:
                _write_buffer(path, self.buffered + fresh)
            written.append(_rel(self.root, path))
        for extra in moved:  # moved into this root's buffer, then removed
            self._remove_buffer(extra, dry_run, removed)

    def _remove_buffer(self, path: Path, dry_run: bool, removed: list) -> None:
        if not path.is_file():
            return
        if not dry_run:
            path.unlink()
            try:
                path.parent.rmdir()  # only when now empty
            except OSError:
                pass
        removed.append(_rel(self.root, path))


def _stage_result(doc: _StageDoc, dry_run: bool) -> dict:
    return {"ok": True, "story": doc.sid,
            "spec": _rel(doc.root, doc.target) if doc.target else None,
            "buffered": doc.target is None, "appended": 0, "rows": [],
            "dry_run": dry_run, "written": [], "removed": []}


def _stage_written(doc: _StageDoc, rows: list[dict], dry_run: bool,
                   result: dict) -> dict:
    fresh = doc.fresh(rows)
    doc.commit(fresh, dry_run, result)
    result["appended"] = len(fresh)
    result["rows"] = [stage_row_key(doc.sid, r) for r in fresh]
    return _finish_stage(result, "complete", None)


def stage_append(project_root: Path, rows: list[dict], story: str | None = None,
                 entity: str | None = None, spec_folder: str | None = None,
                 dry_run: bool = False) -> dict:
    """Append rows (the supervisor's legs, `stage --append`): a row whose key
    is already on record is skipped (`appended: 0`)."""
    doc = _StageDoc(project_root, story, entity, spec_folder)
    normalised = [stage_row(r) for r in rows]
    return _stage_written(doc, normalised, dry_run, _stage_result(doc, dry_run))


def _pass_cell(value) -> str:
    return _stage_cell(value)


def stage_start(project_root: Path, stage: str, story: str | None = None,
                entity: str | None = None, pass_=None, model=None, effort=None,
                session_id=None, outcome=None, now=None,
                dry_run: bool = False) -> dict:
    """`stage --start`: one open row (`ended: —`, `outcome: running`)."""
    doc = _StageDoc(project_root, story, entity)
    stage = _stage_cell(stage)
    want = _pass_cell(pass_)
    for row in doc.rows():
        if row["stage"] == stage and row["pass"] == want and row["ended"] == NO_VALUE:
            raise PlanSyncError(
                f"stage --start: {stage}{'' if want == NO_VALUE else ' ' + want} "
                f"of {doc.sid} is already open (started {row['started']}) — "
                f"stop it first")
    row = stage_row({"stage": stage, "pass": pass_, "started": now or _now(),
                     "session_id": session_id, "model": model,
                     "effort": effort, "outcome": outcome or "running"})
    return _stage_written(doc, [row], dry_run, _stage_result(doc, dry_run))


def stage_stop(project_root: Path, stage: str, story: str | None = None,
               entity: str | None = None, pass_=None, model=None, effort=None,
               session_id=None, outcome=None, now=None,
               dry_run: bool = False) -> dict:
    """`stage --stop`: completes the open row `--start` wrote — the only
    in-place change the table ever takes. No open row is a refusal."""
    doc = _StageDoc(project_root, story, entity)
    stage = _stage_cell(stage)
    want = _pass_cell(pass_)
    update = {"ended": _stage_stamp(now or _now()),
              "outcome": _stage_cell(outcome or "done")}
    for column, value in (("model", model), ("effort", effort),
                          ("session_id", session_id)):
        if value not in (None, ""):
            update[column] = _stage_cell(value)
    done = doc.complete(lambda r: r["stage"] == stage
                        and (want == NO_VALUE or r["pass"] == want), update)
    if done is None:
        raise PlanSyncError(
            f"stage --stop: no open {stage}"
            f"{'' if want == NO_VALUE else ' ' + want} row for {doc.sid} — "
            f"run `stage --start` first")
    result = _stage_result(doc, dry_run)
    result["completed"] = stage_row_key(doc.sid, done)
    return _stage_written(doc, [], dry_run, result)


# --- the engine's rows: `stage --from-pass` (the post_session hook)

def _read_json_file(path: Path) -> dict | None:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _read_jsonl_file(path: Path) -> list[dict]:
    try:
        text = Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if isinstance(record, dict):
            out.append(record)
    return out


def _pass_stage(label: str, role: str | None, phase: str | None) -> str:
    """dev / review / gate (the studio gate workflow) / triage, from the
    session's task label (`<story>-<label>-<n>`)."""
    if "gate" in (label or "") or phase == "pre_commit_gate":
        return "gate"
    if label in ("dev", "review", "triage"):
        return label
    return label or role or "session"


def _journal_gate_tasks(run_dir: Path) -> set[str]:
    """The task ids the journal shows run as a `pre_commit_gate` workflow: a
    `workflow-start {stage: pre_commit_gate}` followed by the session's
    `session-start` (bmad-loop's `_run_workflows` journals one right before
    the session it runs)."""
    gates: set[str] = set()
    armed = False
    for entry in _read_jsonl_file(Path(run_dir) / "journal.jsonl"):
        kind = entry.get("kind")
        if kind == "workflow-start":
            armed = entry.get("stage") == "pre_commit_gate"
        elif kind == "session-start":
            if armed and isinstance(entry.get("task_id"), str):
                gates.add(entry["task_id"])
            armed = False
        elif kind == "workflow-end":
            armed = False
    return gates


def _session_stage(session: dict, task_key: str, recorded: dict[str, str],
                   gates: set[str], role: str | None = None,
                   phase: str | None = None) -> str:
    """A session's stage from the evidence on record, the same for the
    current session and every earlier one: the stage its Stage Log row was
    written with (by session id), else the journal's `pre_commit_gate`
    workflow, else the task label / role / phase (`_pass_stage`)."""
    import meter
    sid = session.get("session_id")
    if isinstance(sid, str) and sid in recorded:
        return recorded[sid]
    if session.get("task_id") in gates:
        return "gate"
    return _pass_stage(meter._task_role(session["task_id"], task_key),
                       session.get("role") or role, phase)


def _routing_effort(worktree: Path, stage: str) -> str | None:
    leg = STAGE_LEGS.get(stage)
    routing = _read_json_file(Path(worktree) / ROUTING_CURRENT_REL) or {}
    entry = routing.get(leg) if leg else None
    effort = entry.get("effort") if isinstance(entry, dict) else None
    return effort if isinstance(effort, str) and effort else None


def _journal_span(run_dir: Path, task_id: str) -> tuple[float | None, float | None]:
    """The task's last `session-start` ts and the `session-end` after it."""
    start = end = None
    for entry in _read_jsonl_file(Path(run_dir) / "journal.jsonl"):
        if entry.get("task_id") != task_id:
            continue
        ts = entry.get("ts")
        if not isinstance(ts, (int, float)) or isinstance(ts, bool):
            continue
        if entry.get("kind") == "session-start":
            start, end = ts, None
        elif entry.get("kind") == "session-end" and start is not None:
            end = ts
    return start, end


def _message_text(record: dict) -> str:
    message = record.get("message")
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(part.get("text", "") for part in content
                       if isinstance(part, dict) and part.get("type") == "text")
    return ""


def _first_user_text(records: list[dict]) -> str:
    for record in records:
        if record.get("type") == "user" or (
                isinstance(record.get("message"), dict)
                and record["message"].get("role") == "user"):
            return _message_text(record)
    return ""


def _transcript_span(records: list[dict]) -> tuple[str | None, str | None]:
    stamps = [r["timestamp"] for r in records
              if isinstance(r.get("timestamp"), str) and r["timestamp"]]
    return (stamps[0], stamps[-1]) if stamps else (None, None)


def _usage_totals(paths: list[Path]) -> tuple[int, int, str | None, bool]:
    """(tokens_in, tokens_out, the first model, any usage read) summed over
    transcripts, deduped by `message.id` keeping the last line (the meter's
    rule): tokens_in = input + cache-read + cache-creation, tokens_out =
    output."""
    import meter
    slot: dict = {}
    records: list[dict] = []
    for path in paths:
        for record in meter._usage_records(Path(path)):
            rid = record["id"]
            if rid is None:
                records.append(record)
            elif rid in slot:
                records[slot[rid]] = record
            else:
                slot[rid] = len(records)
                records.append(record)
    tokens_in = tokens_out = 0
    model = None
    for record in records:
        tokens, _ = meter._tokens(record["usage"])
        tokens_in += (tokens["input"] + tokens["cache_read"]
                      + tokens["cache_write_5m"] + tokens["cache_write_1h"])
        tokens_out += tokens["output"]
        if model is None and isinstance(record.get("model"), str) \
                and record["model"] != "<synthetic>":
            model = record["model"]
    return tokens_in, tokens_out, model, bool(records)


def _usage_cost(paths: list[Path], prices: dict | None) -> float | None:
    """`meter.price` over the transcripts; None when unpriced (a refusal)."""
    import meter
    if prices is None:
        return None
    try:
        return float(meter.price([("session", Path(p)) for p in paths],
                                 prices)["usd_total"])
    except meter.MeterError:
        return None


def _load_prices(prices_path: Path | None) -> dict | None:
    import meter
    try:
        return meter.load_prices(prices_path)
    except meter.MeterError:
        return None


def _subagent_transcripts(transcript: Path | None, copy_dir: Path) -> list[Path]:
    found: dict[str, Path] = {}
    dirs = [copy_dir]
    if transcript is not None:
        dirs.insert(0, Path(transcript).with_suffix("") / "subagents")
    for folder in dirs:
        if folder.is_dir():
            for path in sorted(folder.glob("agent-*.jsonl")):
                found.setdefault(path.name, path)
    return list(found.values())


def stage_from_pass(worktree: Path, run_dir: Path, story: str,
                    role: str | None = None, phase: str | None = None,
                    prices_path: Path | None = None,
                    repo_root: Path | None = None,
                    dry_run: bool = False) -> dict:
    """`stage --from-pass` (the engine hook, post_session): the pass that
    just ended as one row — its stage from the session's task label (dev,
    review, the studio gate), its pass the count of the story's sessions
    of that stage so far, started/ended the journal's `session-start` /
    `session-end` ts, the session id and model from state.json's session
    record, effort from routing.current.json, tokens summed from the
    transcript's usage lines (`meter._tokens`) with its non-consult
    subagents, cost by `meter.price` (`—` when unpriced) — then one
    `consult` row per consult subagent (first user message opening with
    consult.md's heading) not yet on record. Every session (the current
    and each earlier one counted for the pass number) is classed by the
    same evidence (`_session_stage`). `repo_root` (the run's
    BMAD_LOOP_REPO_ROOT, when it is not the worktree): its buffered rows —
    the planner's plan row, written from the project root — are flushed
    with the worktree's, and removed there once moved."""
    worktree, run_dir = Path(worktree), Path(run_dir)
    state = _read_json_file(run_dir / "state.json")
    if state is None:
        raise PlanSyncError(f"stage --from-pass: {run_dir / 'state.json'} "
                            f"is unreadable")
    sid = stage_story(story)
    task = (state.get("tasks") or {}).get(sid) or (state.get("tasks") or {}).get(story)
    sessions = [s for s in (task or {}).get("sessions") or []
                if isinstance(s, dict) and isinstance(s.get("task_id"), str)]
    if not sessions:
        raise PlanSyncError(f"stage --from-pass: no session recorded for "
                            f"{sid} in {run_dir / 'state.json'}")
    import meter
    current = sessions[-1]
    task_id = current["task_id"]
    task_key = task.get("story_key") if isinstance(task.get("story_key"), str) else story
    extra = []
    if repo_root is not None and Path(repo_root).resolve() != worktree.resolve():
        extra.append(Path(repo_root))
    doc = _StageDoc(worktree, sid, None, state.get("spec_folder") or None,
                    extra_roots=extra)
    result = _stage_result(doc, dry_run)
    recorded = {r["session_id"]: r["stage"] for r in doc.rows()
                if r["session_id"] != NO_VALUE and r["stage"] != "consult"}
    gates = _journal_gate_tasks(run_dir)
    stage = _session_stage(current, task_key, recorded, gates,
                           role=role, phase=phase)
    number = sum(1 for s in sessions
                 if _session_stage(s, task_key, recorded, gates,
                                   role=role if s is current else None,
                                   phase=phase if s is current else None)
                 == stage)

    transcript = None
    candidates = [current.get("transcript_path")]
    candidates += list(reversed(meter._story_sessions(run_dir, task_key)
                                .get(task_id, [])))
    copy_dir = run_dir / "transcripts" / task_key / task_id
    for candidate in candidates:
        if isinstance(candidate, str) and candidate:
            for path in (Path(candidate), copy_dir / Path(candidate).name):
                if path.is_file():
                    transcript = path
                    break
        if transcript is not None:
            break
    records = _read_jsonl_file(transcript) if transcript else []
    consults, helpers = [], []
    for sub in _subagent_transcripts(transcript, copy_dir / "subagents"):
        sub_records = _read_jsonl_file(sub)
        if _first_user_text(sub_records).lstrip().startswith(CONSULT_MARKER):
            consults.append((sub, sub_records))
        else:
            helpers.append(sub)

    start_ts, end_ts = _journal_span(run_dir, task_id)
    first, last = _transcript_span(records)
    started = start_ts if start_ts is not None else first
    ended = end_ts if end_ts is not None else last
    if started is None:
        raise PlanSyncError(f"stage --from-pass: no start stamp for {task_id} "
                            f"(no journal session-start, no transcript)")
    prices = _load_prices(prices_path)
    paths = ([transcript] if transcript else []) + helpers
    tokens_in, tokens_out, seen_model, metered = _usage_totals(paths)
    cost = _usage_cost(paths, prices) if metered else None
    if not metered:
        usage = current.get("usage") if isinstance(current.get("usage"), dict) else None
        if usage:
            tokens_in = sum(int(usage.get(k) or 0) for k in (
                "input_tokens", "cache_read_tokens", "cache_creation_tokens"))
            tokens_out = int(usage.get("output_tokens") or 0)
            metered = True
    rows = [stage_row({
        "stage": stage, "pass": number, "started": started, "ended": ended,
        "session_id": current.get("session_id"),
        "model": current.get("model") or seen_model,
        "effort": _routing_effort(worktree, stage),
        "tokens_in": tokens_in if metered else None,
        "tokens_out": tokens_out if metered else None,
        "cost_usd": cost, "outcome": current.get("status")})]

    on_record = [r for r in doc.rows() if r["stage"] == "consult"]
    seen_ids = {r["session_id"] for r in on_record}
    entries = []
    for sub, sub_records in consults:
        sub_first, sub_last = _transcript_span(sub_records)
        agent = next((r.get("agentId") for r in sub_records
                      if isinstance(r.get("agentId"), str) and r["agentId"]),
                     None) or sub.stem
        if agent in seen_ids or sub_first is None:
            continue
        entries.append((sub_first, sub_last, agent, sub))
    for n, (sub_first, sub_last, agent, sub) in enumerate(sorted(entries), 1):
        c_in, c_out, c_model, c_metered = _usage_totals([sub])
        rows.append(stage_row({
            "stage": "consult", "pass": len(on_record) + n,
            "started": sub_first, "ended": sub_last, "session_id": agent,
            "model": c_model, "effort": _routing_effort(worktree, "consult"),
            "tokens_in": c_in if c_metered else None,
            "tokens_out": c_out if c_metered else None,
            "cost_usd": _usage_cost([sub], prices) if c_metered else None,
            "outcome": "done"}))
    result["task_id"] = task_id
    return _stage_written(doc, rows, dry_run, result)


# --- the Jira mirror: `stage-post` (the supervisor, after the pull-back)

def _pass_label(row: dict) -> str:
    return "" if row["pass"] == NO_VALUE else f" [pass {row['pass']}]"


def _usd(cell: str) -> str:
    try:
        return f"${float(cell):.2f}"
    except ValueError:
        return NO_VALUE


def stage_comment(row: dict, key: str, which: str) -> str:
    """The AC2 start / finish comment bodies, the row's own stamp in them
    and the marker `[stage:<key> start|stop]` appended."""
    head = f"Stage {row['stage']}{_pass_label(row)}"
    if which == "start":
        return (f"{head} started — {row['started']}; model: {row['model']}; "
                f"effort: {row['effort']} [stage:{key} start]")
    return (f"{head} finished — {row['ended']}; model: {row['model']}; "
            f"effort: {row['effort']}; tokens: {row['tokens_in']}/"
            f"{row['tokens_out']}; cost: {_usd(row['cost_usd'])} "
            f"[stage:{key} stop]")


def stage_span_seconds(row: dict) -> int | None:
    """The derived span of a completed row (never stored)."""
    start, end = stage_moment(row["started"]), stage_moment(row["ended"])
    if start is None or end is None:
        return None
    return max(0, int((end - start).total_seconds()))


def stage_worklog_comment(row: dict, key: str) -> str:
    return (f"Stage {row['stage']}{_pass_label(row)}: {row['started']} → "
            f"{row['ended']} ({stage_span_seconds(row)} s derived) "
            f"[stage:{key} worklog]")


def load_stage_posts(project_root: Path) -> dict:
    data = _read_json_file(Path(project_root) / STAGE_POSTS_REL)
    return data if isinstance(data, dict) else {}


def _jira_issue_of(project_root: Path, entity_id: str) -> str:
    found = _find_entity(plan_dir(project_root), entity_id)
    if found is None:
        raise PlanSyncError(f"stage-post: unknown id {entity_id}: no "
                            f"canonical entity in {plan_dir(project_root)}")
    external = found[1].get("external") or {}
    jira = external.get(jirabackend.BINDING) if isinstance(external, dict) else None
    key = jira.get("key") if isinstance(jira, dict) else None
    if not isinstance(key, str) or not key.strip():
        raise PlanSyncError(f"stage-post: {entity_id} carries no "
                            f"external.jira.key — run `plansync.py sync` "
                            f"to promote it first")
    return key.strip()


def _unposted(doc: "_StageDoc", state: dict) -> tuple[int, list[str]]:
    """(rows not yet fully mirrored, why each): a buffered row (not in the
    table yet, so not postable), an open row (its stop and worklog await
    `stage --stop`), or a completed row missing a start, stop or worklog
    record in stage-posts.json."""
    awaiting: list[str] = []
    for row in doc.buffered:
        awaiting.append(f"{stage_row_key(doc.sid, row)} buffered")
    for row in doc.table:
        key = stage_row_key(doc.sid, row)
        entry = state.get(key) if isinstance(state.get(key), dict) else {}
        if row["ended"] == NO_VALUE:
            awaiting.append(f"{key} open")
        elif not all(which in entry for which in ("start", "stop", "worklog")):
            awaiting.append(f"{key} unposted")
    return len(awaiting), awaiting


def _stage_post_done(result: dict, doc: "_StageDoc", state: dict) -> dict:
    """Complete only when nothing is left unposted; else `partial` with
    `retryable: true` (the caller retries next pass) naming the count."""
    count, awaiting = _unposted(doc, state)
    result["unposted"], result["awaiting"] = count, awaiting
    if count:
        result["retryable"] = True
        return _finish_stage(result, "partial",
                             f"stage-post pending: {count} row(s) not yet "
                             f"posted ({', '.join(awaiting[:5])}"
                             f"{', …' if len(awaiting) > 5 else ''})")
    return _finish_stage(result, "complete", None)


def stage_post(project_root: Path, entity_id: str, story: str | None = None,
               dry_run: bool = False, transport=None) -> dict:
    """Mirror the Stage Log onto the story's Jira issue (AC2): per row, the
    start comment, then (once the row is completed) the finish comment and
    a worklog of the derived span (a span under Jira's WORKLOG_MIN_SECONDS
    logs none: `worklog: "skipped: span <60s"`). Each post is recorded in
    `_bmad-output/tracking/stage-posts.json` `{<row key>: {start: {id,
    created}, stop: {id, created}, worklog: {id} | "skipped: span <60s"}}`
    as it lands; a marker already on the issue (`GET` comments / worklogs
    first) is recorded, never re-posted. Not bound: nothing posted
    (`posted: "skipped: not bound"`). `unposted` counts the rows not yet
    fully mirrored — buffered rows (no spec to hold them yet), open rows
    awaiting their stop, rows a post is still missing for — and while any
    remain the answer is `ok: false`, `partial`, `retryable: true`. A
    failed Jira call is `ok: false`, `retryable: true`; a refusal (no
    `external.jira.key`, no agent token, several specs) is `ok: false`
    with no `retryable` — final. Never throws."""
    root = Path(project_root).resolve()
    result: dict = {"ok": True, "id": entity_id, "story": None, "issue": None,
                    "posted": {"start": 0, "stop": 0, "worklog": 0, "found": 0},
                    "pending": [], "unposted": 0, "awaiting": [],
                    "dry_run": dry_run, "written": []}
    doc = None
    state: dict = {}
    try:
        doc = _StageDoc(root, story, None if story else entity_id)
        result["story"] = doc.sid
        rows = doc.table
        if _recorded(root, "planning.jira.project_key") is None:
            result["posted"] = "skipped: not bound"
            return _finish_stage(result, "complete", None)
        issue = _jira_issue_of(root, entity_id)
        result["issue"] = issue
        state = load_stage_posts(root)
        plan: list[tuple[str, str, dict]] = []
        for row in rows:
            key = stage_row_key(doc.sid, row)
            entry = state.get(key) if isinstance(state.get(key), dict) else {}
            if "start" not in entry:
                plan.append((key, "start", row))
            if row["ended"] != NO_VALUE:
                if "stop" not in entry:
                    plan.append((key, "stop", row))
                if "worklog" not in entry:
                    plan.append((key, "worklog", row))
        result["pending"] = [f"{k} {w}" for k, w, _ in plan]
        if not plan:
            return _stage_post_done(result, doc, state)
        settings, gaps = jirabackend._resolve_settings(root, None)
        if not os.environ.get(jirabackend.AGENT_TOKEN_ENV) \
                and not os.environ.get(jirabackend.TOKEN_ENV):
            gaps.insert(0, f"{jirabackend.AGENT_TOKEN_ENV} is not set (the "
                           f"agent seat's Jira token)")
        if gaps:
            result["unposted"], result["awaiting"] = _unposted(doc, state)
            return _finish_stage(result, "blocked", "stage-post refused: "
                                 + "; ".join(gaps) + " — no Atlassian call made")
        if dry_run:
            result["unposted"], result["awaiting"] = _unposted(doc, state)
            return _finish_stage(result, "complete", None)
        client = jirabackend.client_for(settings, transport)
        comments: list[dict] | None = None
        worklogs: list[dict] | None = None
        path = root / STAGE_POSTS_REL
        for key, which, row in plan:
            entry = state.setdefault(key, {})
            if which == "worklog" and (stage_span_seconds(row) or 0) < WORKLOG_MIN_SECONDS:
                # Jira logs nothing under a minute: no worklog, the comments still post
                entry["worklog"] = WORKLOG_SKIPPED
            elif which == "worklog":
                if worklogs is None:
                    worklogs = jirabackend.list_worklogs(client, issue)
                marker = f"[stage:{key} worklog]"
                hit = next((w for w in worklogs
                            if marker in str(w.get("comment") or "")), None)
                if hit is None:
                    hit = jirabackend.add_worklog(
                        client, issue, row["started"], stage_span_seconds(row),
                        stage_worklog_comment(row, key))
                    result["posted"]["worklog"] += 1
                else:
                    result["posted"]["found"] += 1
                entry["worklog"] = {"id": str(hit.get("id"))}
            else:
                if comments is None:
                    comments = jirabackend.list_comments(client, issue)
                marker = f"[stage:{key} {which}]"
                hit = next((c for c in comments
                            if marker in str(c.get("body") or "")), None)
                if hit is None:
                    hit = jirabackend.add_comment(
                        client, issue, stage_comment(row, key, which))
                    result["posted"][which] += 1
                else:
                    result["posted"]["found"] += 1
                entry[which] = {"id": str(hit.get("id")),
                                "created": hit.get("created")}
            _atomic_write(path, json.dumps(state, indent=2, sort_keys=True,
                                           ensure_ascii=False) + "\n")
            rel = _rel(root, path)
            if rel not in result["written"]:
                result["written"].append(rel)
            result["pending"].remove(f"{key} {which}")
        return _stage_post_done(result, doc, state)
    except PlanSyncError as exc:  # a refusal: final, never retried
        return _finish_stage(result, "blocked", str(exc))
    except Exception as exc:  # a failed post never throws: retried next pass
        if doc is not None:
            result["unposted"], result["awaiting"] = _unposted(doc, state)
        result["retryable"] = True
        return _finish_stage(result, "blocked",
                             f"stage-post failed: {str(exc)[:300]}")


# --- readers: every Stage Log row of a project (measurepush, report)

def stage_documents(project_root: Path) -> list[tuple[str, Path]]:
    """(story or entity id, document) for every spec and plan entity of
    the project holding a `## Stage Log` heading."""
    root = Path(project_root)
    out: list[tuple[str, Path]] = []
    for path in sorted((root / SPECS_REL).glob("*/stories/*.md")):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):  # unreadable spec: skipped
            continue
        if STAGE_HEADING in text:
            out.append((stage_story(path.stem), path))
    plans = plan_dir(root)
    if plans.is_dir():
        for path in sorted(plans.glob("*.md")):
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            if STAGE_HEADING in text:
                out.append((path.stem, path))
    return out


def stage_rows(project_root: Path) -> list[dict]:
    """Every table row of the project: {story, path (project-relative),
    key, row}."""
    root = Path(project_root)
    out = []
    for sid, path in stage_documents(root):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):  # vanished or changed since
            continue
        for row in parse_stage_log(text):
            out.append({"story": sid, "path": _rel(root, path),
                        "key": stage_row_key(sid, row), "row": row})
    return out


# --------------------------------------------------------------------- CLI

# ------------------------------------------- Story 35.7: the sweep's ledger flip

LEDGER_REL = IMPL_REL / "deferred-work.md"
_DW_HEAD_RE = re.compile(r"^### (DW-\d+): ", re.MULTILINE)
_ANY_HEAD_RE = re.compile(r"^#{1,6} ", re.MULTILINE)
_DW_STATUS_RE = re.compile(r"^status:[ \t]*(.*)$", re.MULTILINE)
_DW_RESOLUTION_RE = re.compile(r"^resolution:[ \t]*(.*)$", re.MULTILINE)
_DW_ID_RE = re.compile(r"^DW-\d+$")
_PR_REF_RE = re.compile(r"^([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)#(\d+)$")
_PR_URL_RE = re.compile(r"^https://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/pull/(\d+)/?$")
_DONE_DATE_RE = re.compile(r"^done\s+(\d{4}-\d{2}-\d{2})")
_BUNDLE_RE = re.compile(r"sweep bundle (dw\d*-[a-z0-9-]+)")
_BUNDLE_CLAUSE_RE = re.compile(r"([;,.\s]*)resolved by sweep bundle dw\d*-[a-z0-9-]+([;,.\s]*)")
LEDGER_RESOLUTION_MAX = 160


def pr_ref(pr: str) -> str:
    """`owner/repo#N` from that form or a GitHub pull-request URL."""
    text = (pr or "").strip()
    m = _PR_REF_RE.match(text) or _PR_URL_RE.match(text)
    if not m:
        raise PlanSyncError(f"ledger-resolve: --pr must be <owner/repo>#N or a GitHub PR URL: {pr!r}")
    return f"{m.group(1)}#{m.group(2)}"


def _ledger_spans(text: str) -> dict[str, tuple[int, int]]:
    """Each `### DW-NN:` entry's span (it ends at the next heading of any level)."""
    spans: dict[str, tuple[int, int]] = {}
    heads = list(_DW_HEAD_RE.finditer(text))
    for i, m in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        other = _ANY_HEAD_RE.search(text, m.end(), end)
        spans.setdefault(m.group(1), (m.start(), other.start() if other else end))
    return spans


def resolved_status(date: str, ref: str, resolution: str) -> str:
    """`resolved <date> by <ref> (sweep bundle dw-<name>; <resolution, clipped>)`.
    The engine's `resolved by sweep bundle <key>` clause adds nothing: removed
    wherever it stands, so the line names the bundle once (Story 36.2)."""
    resolution = " ".join(resolution.split())
    # the bundle named from the whole text, before the clip can cut it off
    bundle = _BUNDLE_RE.search(resolution)
    # mid-text one separator stays; at either end what is left behind goes
    resolution, removed = _BUNDLE_CLAUSE_RE.subn(lambda m: m.group(1) or m.group(2), resolution)
    if removed:
        resolution = resolution.strip(" ;,.")
    if len(resolution) > LEDGER_RESOLUTION_MAX:
        resolution = resolution[:LEDGER_RESOLUTION_MAX - 1].rstrip() + "…"
    head = f"sweep bundle {bundle.group(1)}" if bundle else "sweep"
    return f"resolved {date} by {ref} ({head}{'; ' + resolution if resolution else ''})"


def ledger_resolve(project_root: Path, pr: str, ids: list[str], date: str | None = None,
                   dry_run: bool = False) -> dict:
    """The sweep's ledger flip (see the module docstring)."""
    root = Path(project_root)
    ref = pr_ref(pr)
    bad = [i for i in ids if not _DW_ID_RE.match(i)]
    if bad:
        raise PlanSyncError(f"ledger-resolve: not DW ids: {', '.join(bad)}")
    if date is not None and not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        raise PlanSyncError(f"ledger-resolve: --date must be YYYY-MM-DD: {date!r}")
    path = root / LEDGER_REL
    if not path.is_file():
        raise PlanSyncError(f"ledger-resolve: no ledger at {LEDGER_REL.as_posix()}")
    text = path.read_text(encoding="utf-8")
    resolved: list[str] = []
    pending: list[str] = []
    unchanged: list[str] = []
    edits: list[tuple[int, int, str]] = []
    spans = _ledger_spans(text)
    for dw in dict.fromkeys(ids):
        span = spans.get(dw)
        body = text[span[0]:span[1]] if span else ""
        status_m = _DW_STATUS_RE.search(body) if span else None
        value = status_m.group(1).strip() if status_m else ""
        first = value.split()[0] if value else ""
        if not span or first == "open":
            pending.append(dw)
            continue
        if first != "done":
            unchanged.append(dw)  # already resolved (by this PR or another way)
            continue
        done = _DONE_DATE_RE.match(value)
        when = date or (done.group(1) if done else datetime.now(timezone.utc).strftime("%Y-%m-%d"))
        res_m = _DW_RESOLUTION_RE.search(body)
        line = "status: " + resolved_status(when, ref, res_m.group(1).strip() if res_m else "")
        edits.append((span[0] + status_m.start(), span[0] + status_m.end(), line))
        resolved.append(dw)
    for start, end, line in sorted(edits, reverse=True):
        text = text[:start] + line + text[end:]
    rel = LEDGER_REL.as_posix()
    if edits and not dry_run:
        _atomic_write(path, text)
    result = {"ok": True, "ledger": rel, "pr": ref, "dry_run": dry_run,
              "resolved": resolved, "pending": pending, "unchanged": unchanged,
              "written": [rel] if edits else []}
    _finish_stage(result, "partial" if pending else "complete",
                  f"pending (still open at the owner root): {', '.join(pending)}" if pending else None)
    result["ok"] = True  # every answer but a refusal: `pending` is retried, never refused
    return result


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
    stg = sub.add_parser("stage")
    mode = stg.add_mutually_exclusive_group(required=True)
    for flag in ("--start", "--stop", "--append", "--from-pass"):
        mode.add_argument(flag, action="store_true")
    stg.add_argument("--directory", default=None,
                     help="project root (default: --worktree, else the cwd)")
    stg.add_argument("--story", default=None, help="story key (its spec's table)")
    stg.add_argument("--entity", default=None,
                     help="plan entity id (the epic's planning row)")
    stg.add_argument("--stage", default=None)
    stg.add_argument("--pass", dest="pass_", default=None)
    stg.add_argument("--model", default=None)
    stg.add_argument("--effort", default=None)
    stg.add_argument("--session-id", default=None)
    stg.add_argument("--outcome", default=None)
    stg.add_argument("--row-json", default=None,
                     help="one row (a JSON object) or several (an array)")
    stg.add_argument("--run-dir", default=None)
    stg.add_argument("--role", default=None)
    stg.add_argument("--phase", default=None)
    stg.add_argument("--worktree", default=None)
    stg.add_argument("--repo-root", default=None,
                     help="--from-pass: the run's repo root, whose buffered "
                          "rows (the planner's plan row) are flushed too")
    stg.add_argument("--dry-run", action="store_true")
    lrs = sub.add_parser("ledger-resolve")
    lrs.add_argument("--directory", required=True, help="the owner root (walks up to the nearest)")
    lrs.add_argument("--pr", required=True, help="<owner/repo>#N (or the PR URL)")
    lrs.add_argument("--ids", required=True, help="comma-separated DW ids")
    lrs.add_argument("--date", default=None, help="YYYY-MM-DD (default: the engine's done date)")
    lrs.add_argument("--dry-run", action="store_true")
    spo = sub.add_parser("stage-post")
    spo.add_argument("--directory", required=True, help="project root (walks up to the nearest)")
    spo.add_argument("--id", required=True, dest="entity_id",
                     help="the plan entity whose external.jira.key is the issue")
    spo.add_argument("--story", default=None,
                     help="story key (default: the entity's own table)")
    spo.add_argument("--dry-run", action="store_true")

    args = parser.parse_args(argv)
    if args.command == "stage":
        return _stage_main(args)
    if args.command == "ledger-resolve":
        return _ledger_resolve_main(args)
    # --directory walks up to the nearest project root (driver contract
    # 0.1.22): from inside a nested project the nested counter is minted.
    args.directory = configlib.find_project_root(Path(args.directory))
    try:
        if args.command == "stage-post":
            result = stage_post(Path(args.directory), args.entity_id,
                                story=args.story, dry_run=args.dry_run)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0 if result.get("ok") else 2
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


def _ledger_resolve_main(args) -> int:
    """`ledger-resolve`: every answer ends in the JSON status block (AD-11);
    a refusal exits 2."""
    root = configlib.find_project_root(Path(args.directory))
    ids = [i.strip() for i in (args.ids or "").split(",") if i.strip()]
    try:
        result = ledger_resolve(root, args.pr, ids, date=args.date, dry_run=args.dry_run)
    except PlanSyncError as exc:
        result = _finish_stage({"written": []}, "blocked", str(exc))
        result["error"] = str(exc)
    except Exception as exc:  # never a traceback: the caller retries
        result = _finish_stage({"written": []}, "blocked",
                               f"ledger-resolve: {type(exc).__name__}: {exc}")
        result["error"] = result["reason"]
        result["retryable"] = True
    block = {k: result.pop(k) for k in ("status", "intent", "artifacts", "reason")}
    result.update(block)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 2


def _stage_main(args) -> int:
    """`stage --start|--stop|--append|--from-pass`: every path ends in the
    JSON status block (AD-11); a refusal exits 2."""
    base = args.directory or args.worktree or "."
    root = configlib.find_project_root(Path(base))
    try:
        if args.from_pass:
            missing = [f for f, v in (("--run-dir", args.run_dir),
                                      ("--story", args.story)) if not v]
            if missing:
                raise PlanSyncError("stage --from-pass needs "
                                    + " and ".join(missing))
            result = stage_from_pass(Path(args.worktree) if args.worktree else root,
                                     Path(args.run_dir), args.story,
                                     role=args.role, phase=args.phase,
                                     repo_root=(Path(args.repo_root)
                                                if args.repo_root else None),
                                     dry_run=args.dry_run)
        elif args.append:
            if not args.row_json:
                raise PlanSyncError("stage --append needs --row-json")
            try:
                rows = json.loads(args.row_json)
            except ValueError as exc:
                raise PlanSyncError(f"stage --append: --row-json is not "
                                    f"JSON: {exc}") from exc
            rows = rows if isinstance(rows, list) else [rows]
            result = stage_append(root, rows, story=args.story,
                                  entity=args.entity, dry_run=args.dry_run)
        else:
            if not args.stage:
                raise PlanSyncError("stage --start/--stop needs --stage")
            verb = stage_start if args.start else stage_stop
            result = verb(root, args.stage, story=args.story,
                          entity=args.entity, pass_=args.pass_,
                          model=args.model, effort=args.effort,
                          session_id=args.session_id, outcome=args.outcome,
                          dry_run=args.dry_run)
    except PlanSyncError as exc:
        result = _finish_stage({"story": args.story or args.entity,
                                "written": []}, "blocked", str(exc))
        result["error"] = str(exc)
    except Exception as exc:  # the hook path: never a traceback
        result = _finish_stage({"story": args.story or args.entity,
                                "written": []}, "blocked",
                               f"stage: {type(exc).__name__}: {exc}")
        result["error"] = result["reason"]
        result["retryable"] = True  # not a refusal: the caller may try again
    # the status block keys stay last (AD-11)
    block = {k: result.pop(k) for k in ("status", "intent", "artifacts", "reason")}
    result.update(block)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    sys.exit(main())
