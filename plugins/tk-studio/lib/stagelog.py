"""tk-studio stage log and sweep ledger flip — split out of plansync.py.

The Story 35.8 stage log (the story spec's append-only `## Stage Log` table,
its pre-spec buffer, the `--from-pass`/`--from-run` row derivation and the
`stage-post` Jira worklog/comment push) and the Story 35.7 sweep ledger flip
(`ledger-resolve`), moved here verbatim per DW-87 / TKSTUDIO-220 option A.

The CLI verbs stay on plansync.py (`stage`, `stage-post`, `ledger-resolve`),
and plansync re-exports every name defined here lazily (PEP 562), so
`plansync.<name>` keeps resolving. This module imports plansync at load;
plansync imports this one only inside functions, so the graph stays acyclic
at load time.

Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import dwledger
import jirabackend
import plansync
import syncback


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
STAGE_INTENT = plansync.SETUP_INTENT
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
            raise plansync.PlanSyncError(f"stage: {value!r} is not an ISO-8601 "
                                f"timestamp") from exc
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
    else:
        raise plansync.PlanSyncError(f"stage: {value!r} is not a timestamp")
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
        raise plansync.PlanSyncError("stage: a row must be a JSON object")
    unknown = set(raw) - set(STAGE_COLUMNS)
    if unknown:
        raise plansync.PlanSyncError("stage: row fields outside the Stage Log columns: "
                            + ", ".join(sorted(unknown))
                            + " (elapsed is never stored, only derived)")
    row = {column: _stage_cell(raw.get(column)) for column in STAGE_COLUMNS}
    if row["stage"] == NO_VALUE:
        raise plansync.PlanSyncError("stage: a row needs its stage")
    if raw.get("started") in (None, "", NO_VALUE):
        raise plansync.PlanSyncError(f"stage: the {row['stage']} row needs its "
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


# Story 38.5 (DW-177): the rest of a name after `<key>-` that a later half
# (`-s2`) or a remediation (`-r1`) carries, excluded from the first half's glob.
SPLIT_SPEC_RE = re.compile(r"^(s|r)\d+(-.*)?\.md$")


def _stage_target(root: Path, story: str | None, entity: str | None
                  ) -> tuple[Path | None, str]:
    """(the document holding the table — None while the spec is unwritten,
    the story or entity id the row keys use)."""
    if entity:
        found = plansync._find_entity(plansync.plan_dir(root), entity)
        if found is None:
            raise plansync.PlanSyncError(f"stage: unknown id {entity}: no canonical "
                                f"entity in {plansync.plan_dir(root)}")
        return found[0], entity
    sid = stage_story(story or "")
    if not sid or re.search(r"[\\/*?\[\]]", sid):
        raise plansync.PlanSyncError("stage: --story <key> or --entity <id> names "
                            "the document")
    # Story 38.5 (DW-177): a split story's spec by its exact `<key>-spec.md`
    # first; else the prefix glob, a later half's (`-s<n>`) and a
    # remediation's (`-r<n>`) names excluded, used only when one file matches.
    stories = sorted((root / SPECS_REL).glob(f"*/stories/{sid}-spec.md"))
    if not stories:
        stories = sorted({
            p for pattern in (f"{sid}.md", f"{sid}-*.md")
            for p in (root / SPECS_REL).glob(f"*/stories/{pattern}")
            if not SPLIT_SPEC_RE.match(p.name[len(sid) + 1:])})
    if len(stories) > 1:
        raise plansync.PlanSyncError(
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
    plansync._atomic_write(path, "".join(json.dumps(r, ensure_ascii=False) + "\n"
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
                    plansync._atomic_write(self.target, text)
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
            raise plansync.PlanSyncError(
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
            raise plansync.PlanSyncError(
                f"stage --start: {stage}{'' if want == NO_VALUE else ' ' + want} "
                f"of {doc.sid} is already open (started {row['started']}) — "
                f"stop it first")
    row = stage_row({"stage": stage, "pass": pass_, "started": now or plansync._now(),
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
    update = {"ended": _stage_stamp(now or plansync._now()),
              "outcome": _stage_cell(outcome or "done")}
    for column, value in (("model", model), ("effort", effort),
                          ("session_id", session_id)):
        if value not in (None, ""):
            update[column] = _stage_cell(value)
    done = doc.complete(lambda r: r["stage"] == stage
                        and (want == NO_VALUE or r["pass"] == want), update)
    if done is None:
        raise plansync.PlanSyncError(
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


def _journal_spans(run_dir: Path, task_id: str) -> list[tuple[float, float | None]]:
    """Every `session-start` ts of the task in journal order, each with the
    `session-end` after it (before the task's next start), else None."""
    spans: list[list] = []
    for entry in _read_jsonl_file(Path(run_dir) / "journal.jsonl"):
        if entry.get("task_id") != task_id:
            continue
        ts = entry.get("ts")
        if not isinstance(ts, (int, float)) or isinstance(ts, bool):
            continue
        if entry.get("kind") == "session-start":
            spans.append([ts, None])
        elif entry.get("kind") == "session-end" and spans and spans[-1][1] is None:
            spans[-1][1] = ts
    return [(start, end) for start, end in spans]


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


def _subagent_transcripts(transcript: Path | None,
                          copy_dir: Path | None) -> list[Path]:
    found: dict[str, Path] = {}
    dirs = [copy_dir] if copy_dir is not None else []
    if transcript is not None:
        dirs.insert(0, Path(transcript).with_suffix("") / "subagents")
    for folder in dirs:
        if folder.is_dir():
            for path in sorted(folder.glob("agent-*.jsonl")):
                found.setdefault(path.name, path)
    return list(found.values())


def _pass_transcript(run_dir: Path, task_key: str,
                     session: dict) -> tuple[Path | None, Path]:
    """A session's transcript (its recorded path, else the meter's session
    list, each also under the run dir's copy) and the copy folder."""
    import meter
    task_id = session["task_id"]
    candidates = [session.get("transcript_path")]
    candidates += list(reversed(meter._story_sessions(run_dir, task_key)
                                .get(task_id, [])))
    copy_dir = run_dir / "transcripts" / task_key / task_id
    for candidate in candidates:
        if isinstance(candidate, str) and candidate:
            for path in (Path(candidate), copy_dir / Path(candidate).name):
                if path.is_file():
                    return path, copy_dir
    return None, copy_dir


def _session_transcript(run_dir: Path, task_key: str,
                        session: dict) -> tuple[Path | None, Path]:
    """Story 37.3: a backfilled session's own transcript only — its recorded
    path (or the same-named copy under the run dir), else a meter event
    path whose file stem is its session id; never another session's (the
    engine's task ids are per task, so a retry shares the timed-out
    attempt's)."""
    import meter
    task_id = session["task_id"]
    sid = session.get("session_id")
    candidates = [session.get("transcript_path")]
    if isinstance(sid, str) and sid:
        candidates += [c for c in meter._story_sessions(run_dir, task_key).get(task_id, [])
                       if isinstance(c, str) and c
                       and Path(c.replace("\\", "/")).stem == sid]
    copy_dir = run_dir / "transcripts" / task_key / task_id
    for candidate in candidates:
        if isinstance(candidate, str) and candidate:
            for path in (Path(candidate), copy_dir / Path(candidate).name):
                if path.is_file():
                    return path, copy_dir
    return None, copy_dir


_RESULT_SUCCESS = ("done", "in-review", "ready-for-dev")


def _session_outcome(session: dict):
    """Story 38.2 (CAP-6, DW-180): a session's Stage Log outcome — its
    status, unless the adapter answered `completed` for a session whose
    `result_json.status` is a word other than a success (`done`,
    `in-review`, `ready-for-dev`): that word (`halted`, `blocked`), so a
    halted attempt's row never reads `completed`."""
    status = session.get("status")
    result = session.get("result_json")
    word = result.get("status") if isinstance(result, dict) else None
    if (status == "completed" and isinstance(word, str) and word.strip()
            and word.strip() not in _RESULT_SUCCESS):
        return word.strip()
    return status


def _session_row(worktree: Path, run_dir: Path, task_key: str,
                 sessions: list[dict], i: int, recorded: dict[str, str],
                 gates: set[str], prices: dict | None,
                 cache: dict) -> dict | None:
    """The i-th session's Stage Log row, as its own pass would have written
    it (Story 37.3; Story 38.3 extracted it for `stage --from-run`): its
    stage by the evidence on record, its pass the count of its stage's
    sessions so far, its own transcript and journal span (the k-th
    `session-start` of the task id for its k-th session record), tokens from
    the transcript else its state.json `usage`, cost by `meter.price` else
    `meter._session_usd`, outcome `_session_outcome`. None when it has no
    start stamp. `cache` holds the routing, read once."""
    import meter
    session = sessions[i]
    sid = session.get("session_id")
    stage = _session_stage(session, task_key, recorded, gates)
    number = sum(1 for s in sessions[:i + 1]
                 if _session_stage(s, task_key, recorded, gates) == stage)
    task_id = session["task_id"]
    transcript, copy_dir = _session_transcript(run_dir, task_key, session)
    records = _read_jsonl_file(transcript) if transcript else []
    # the run dir's subagents copy is shared by the task's sessions: read
    # it only when no other session shares this task id
    shared = sum(1 for s in sessions if s["task_id"] == task_id) > 1
    sub_copy = None if shared else copy_dir / "subagents"
    helpers = [sub for sub in _subagent_transcripts(transcript, sub_copy)
               if not _first_user_text(_read_jsonl_file(sub)).lstrip()
               .startswith(CONSULT_MARKER)]
    # the k-th journal span of the task id is its k-th session record's
    ordinal = sum(1 for s in sessions[:i] if s["task_id"] == task_id)
    spans = _journal_spans(run_dir, task_id)
    start_ts, end_ts = spans[ordinal] if ordinal < len(spans) else (None, None)
    first, last = _transcript_span(records)
    started = start_ts if start_ts is not None else first
    ended = end_ts if end_ts is not None else last
    if started is None:
        return None
    paths = ([transcript] if transcript else []) + helpers
    tokens_in, tokens_out, seen_model, metered = _usage_totals(paths)
    cost = _usage_cost(paths, prices) if metered else None
    usage = session.get("usage") if isinstance(session.get("usage"), dict) else None
    if not metered and usage:
        tokens_in = sum(int(usage.get(k) or 0) for k in (
            "input_tokens", "cache_read_tokens", "cache_creation_tokens"))
        tokens_out = int(usage.get("output_tokens") or 0)
        metered = True
        if prices is not None:
            if "routing" not in cache:
                cache["routing"] = meter._route_file(Path(worktree) / ROUTING_CURRENT_REL) or {}
            try:
                cost = meter._session_usd(task_key, session, prices, cache["routing"])
            except meter.MeterError:
                cost = None
    return stage_row({
        "stage": stage, "pass": number, "started": started, "ended": ended,
        "session_id": sid, "model": session.get("model") or seen_model,
        "effort": _routing_effort(worktree, stage),
        "tokens_in": tokens_in if metered else None,
        "tokens_out": tokens_out if metered else None,
        "cost_usd": cost, "outcome": _session_outcome(session)})


def _backfill_rows(worktree: Path, run_dir: Path, task_key: str,
                   sessions: list[dict], doc: "_StageDoc",
                   recorded: dict[str, str], gates: set[str],
                   prices: dict | None) -> list[dict]:
    """Story 37.3 (DW-148): one row per earlier session (all but the
    current) whose session id no Stage Log row names, as its own pass would
    have written it (`_session_row`); a session with no id or no start
    stamp is skipped. A retry shares its task id, so each backfilled
    session reads only its own transcript (`_session_transcript`) and its
    own journal span — never the task's last (the current pass's)."""
    on_record = {r["session_id"] for r in doc.rows()}
    current_id = sessions[-1].get("session_id")
    cache: dict = {}
    rows = []
    for i, session in enumerate(sessions[:-1]):
        sid = session.get("session_id")
        if not isinstance(sid, str) or not sid or sid in on_record or sid == current_id:
            continue
        row = _session_row(worktree, run_dir, task_key, sessions, i, recorded,
                           gates, prices, cache)
        if row is None:
            continue
        rows.append(row)
        on_record.add(sid)
    return rows


def run_stage_rows(worktree: Path, run_dir: Path,
                   prices_path: Path | None = None) -> dict:
    """`stage --from-run` (Story 38.3, DW-165): a sweep's bundles' engine
    passes as Stage Log rows, read only — a bundle has no spec and no Jira
    issue, so the supervisor renders them into the sweep PR body's `## Stage
    Log`. Every bundle key (`meter._bundle_keys`: the triages', then any
    other `dw*-` task) gets `{key, rows}`, one row per session in state.json
    order by `_session_row` (no rows on record, gates from the journal, pass
    numbering per stage). Answers `{ok, columns, bundles, written: []}`;
    never writes a doc or a buffer. An unreadable state.json is refused."""
    import meter
    worktree, run_dir = Path(worktree), Path(run_dir)
    state = _read_json_file(run_dir / "state.json")
    if state is None:
        raise plansync.PlanSyncError(f"stage --from-run: {run_dir / 'state.json'} "
                            f"is unreadable")
    tasks = state.get("tasks") if isinstance(state.get("tasks"), dict) else {}
    gates = _journal_gate_tasks(run_dir)
    prices = _load_prices(prices_path)
    cache: dict = {}
    bundles = []
    for key in meter._bundle_keys(run_dir, tasks):
        task = tasks.get(key) if isinstance(tasks.get(key), dict) else {}
        sessions = [s for s in task.get("sessions") or []
                    if isinstance(s, dict) and isinstance(s.get("task_id"), str)]
        task_key = task.get("story_key") if isinstance(task.get("story_key"), str) else key
        rows = []
        for i in range(len(sessions)):
            row = _session_row(worktree, run_dir, task_key, sessions, i, {},
                               gates, prices, cache)
            if row is not None:
                rows.append(row)
        bundles.append({"key": key, "rows": rows})
    result = {"ok": True, "columns": list(STAGE_COLUMNS), "bundles": bundles,
              "written": []}
    return _finish_stage(result, "complete", None)


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
    with the worktree's, and removed there once moved. Story 37.3 (DW-148):
    an earlier session of the story not on record by session id (a timed-out
    attempt whose row the rollback's reset reverted, or whose hook never
    wrote) is backfilled first, its outcome its own status (`timeout`), its
    tokens from its transcript else its state.json `usage`, its cost by
    `meter.price` else `meter._session_usd` (`—` when unpriced). Story 38.2
    (CAP-6): every row's outcome is `_session_outcome` — a `completed`
    session whose result reads `halted` writes `outcome: halted`."""
    worktree, run_dir = Path(worktree), Path(run_dir)
    state = _read_json_file(run_dir / "state.json")
    if state is None:
        raise plansync.PlanSyncError(f"stage --from-pass: {run_dir / 'state.json'} "
                            f"is unreadable")
    sid = stage_story(story)
    task = (state.get("tasks") or {}).get(sid) or (state.get("tasks") or {}).get(story)
    sessions = [s for s in (task or {}).get("sessions") or []
                if isinstance(s, dict) and isinstance(s.get("task_id"), str)]
    if not sessions:
        raise plansync.PlanSyncError(f"stage --from-pass: no session recorded for "
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

    transcript, copy_dir = _pass_transcript(run_dir, task_key, current)
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
        raise plansync.PlanSyncError(f"stage --from-pass: no start stamp for {task_id} "
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
    rows = _backfill_rows(worktree, run_dir, task_key, sessions, doc,
                          recorded, gates, prices)
    rows.append(stage_row({
        "stage": stage, "pass": number, "started": started, "ended": ended,
        "session_id": current.get("session_id"),
        "model": current.get("model") or seen_model,
        "effort": _routing_effort(worktree, stage),
        "tokens_in": tokens_in if metered else None,
        "tokens_out": tokens_out if metered else None,
        "cost_usd": cost, "outcome": _session_outcome(current)}))

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
    found = plansync._find_entity(plansync.plan_dir(project_root), entity_id)
    if found is None:
        raise plansync.PlanSyncError(f"stage-post: unknown id {entity_id}: no "
                            f"canonical entity in {plansync.plan_dir(project_root)}")
    external = found[1].get("external") or {}
    jira = external.get(jirabackend.BINDING) if isinstance(external, dict) else None
    key = jira.get("key") if isinstance(jira, dict) else None
    if not isinstance(key, str) or not key.strip():
        raise plansync.PlanSyncError(f"stage-post: {entity_id} carries no "
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
        if plansync._recorded(root, "planning.jira.project_key") is None:
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
            plansync._atomic_write(path, json.dumps(state, indent=2, sort_keys=True,
                                           ensure_ascii=False) + "\n")
            rel = _rel(root, path)
            if rel not in result["written"]:
                result["written"].append(rel)
            result["pending"].remove(f"{key} {which}")
        return _stage_post_done(result, doc, state)
    except plansync.PlanSyncError as exc:  # a refusal: final, never retried
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
    plans = plansync.plan_dir(root)
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


# ------------------------------------------- Story 35.7: the sweep's ledger flip

LEDGER_REL = plansync.IMPL_REL / "deferred-work.md"
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
        raise plansync.PlanSyncError(f"ledger-resolve: --pr must be <owner/repo>#N or a GitHub PR URL: {pr!r}")
    return f"{m.group(1)}#{m.group(2)}"


def _ledger_spans(text: str) -> dict[str, tuple[int, int]]:
    """Each `### DW-NN:` entry's span; a duplicate heading is refused by name."""
    return {e.id: (e.start, e.end) for e in dwledger.parse_ledger(text)}


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
        raise plansync.PlanSyncError(f"ledger-resolve: not DW ids: {', '.join(bad)}")
    if date is not None and not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        raise plansync.PlanSyncError(f"ledger-resolve: --date must be YYYY-MM-DD: {date!r}")
    path = root / LEDGER_REL
    if not path.is_file():
        raise plansync.PlanSyncError(f"ledger-resolve: no ledger at {LEDGER_REL.as_posix()}")
    text = path.read_text(encoding="utf-8")
    resolved: list[str] = []
    pending: list[str] = []
    unchanged: list[str] = []
    missing: list[str] = []
    edits: list[tuple[int, int, str]] = []
    spans = _ledger_spans(text)
    for dw in dict.fromkeys(ids):
        span = spans.get(dw)
        if not span:
            missing.append(dw)  # Story 38.3 (B4): refused by name below, never `pending`
            continue
        body = text[span[0]:span[1]]
        status_m = _DW_STATUS_RE.search(body)
        value = status_m.group(1).strip() if status_m else ""
        first = value.split()[0] if value else ""
        if first == "open":
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
    if missing:
        # before any write (a dry run refuses the same): the counter's next id says where the ledger stands
        try:
            tail = f"(the counter's next id: DW-{plansync._deferred_next(root, text, plansync.load_counter(root))})"
        except Exception as exc:  # a counter that cannot be read still names the missing ids
            tail = f"(the counter unreadable: {exc})"
        raise dwledger.LedgerMissingId(
            f"LedgerMissingId: {', '.join(missing)} not in the ledger {tail}")
    for start, end, line in sorted(edits, reverse=True):
        text = text[:start] + line + text[end:]
    rel = LEDGER_REL.as_posix()
    if edits and not dry_run:
        plansync._atomic_write(path, text)
    result = {"ok": True, "ledger": rel, "pr": ref, "dry_run": dry_run,
              "resolved": resolved, "pending": pending, "unchanged": unchanged,
              "written": [rel] if edits else []}
    _finish_stage(result, "partial" if pending else "complete",
                  f"pending (still open at the owner root): {', '.join(pending)}" if pending else None)
    result["ok"] = True  # every answer but a refusal: `pending` is retried, never refused
    return result
