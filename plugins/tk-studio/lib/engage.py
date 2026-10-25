"""tk-studio-engage — the `reply` verb (Story 32.2, design spec §6.4 and D2,
user flow F2 step 1, driver contract 0.1.27 additive).

The planner leg of an engagement: the supervisor's chat route
(`POST /chat/{engagement}`) appends the owner's line to
`_bmad-output/engagements/<ENG-NNN>/chat.jsonl` and queues one run of the
shipped one-shot `engagement-chat` job, a `claude -p` session on the host in
the run's worktree driven by this surface with the payload
`{verb: "reply", engagement, project, project_root, seq, run_id}`; the
payload's `project_root` (the served registry root, where `chat.jsonl` and
the record live untracked) is what `--directory` names. The session reads the
memory, then writes its reply. One verb, two modes:

  uv run engage.py reply --directory ROOT --engagement ENG-NNN [--dry-run]

answers the memory: the record (`engagement.yaml`, JSON text — Settled
shape 1), the whole chat, and three root-relative indexes (AD-15) of
`_bmad-output/planning-artifacts/`, `kb/` (without `kb/confluence/`) and
`kb/confluence/`: `{path, bytes, title}` per file, sorted by path, capped at
INDEX_MAX entries with a `truncated` flag. It never dumps a file's body; the
session reads what it needs.

  uv run engage.py reply --directory ROOT --engagement ENG-NNN
      --body-file PATH [--proposals-file PATH] --run-id RUN [--dry-run]

appends the planner's line `{seq, at, author: "planner", body, run_id,
proposals[]}` under the chat lock (Settled shape 3: `chat.lock` in the
engagement's directory, exclusive create, stale after 30 s; the last `seq`
re-read inside it; the file rewritten atomically). The body is at most
32 KiB UTF-8. Each proposal (Settled shape 4) is `{verb, payload, label}`:
`verb` one of the six owner inputs (`answer`, `go`, `revise`, `question`,
`approve`, `cancel`), `payload` that verb's typed payload checked by the
supervisor's rules (`checkInputBody`), `label` a non-empty string of at most
80 characters. A proposal is a button the owner presses; the planner moves
no state, holds no bearer and no CSRF token.

The `questions` verb (Story 32.3, user flow F2 step 2) is the planner's
clarifying questions, asked only when the turn finds gaps a default cannot
cover:

  uv run engage.py questions --directory ROOT --engagement ENG-NNN
      --run-id RUN --questions-file PATH [--dry-run]

writes `_bmad-output/engagements/<id>/questions.json` atomically (Settled
shape 1): `{run_id, at, questions: [{id, text, options: [{label, default?:
true}], impact}]}` — 1 to 3 questions, each `id` matching
`^[a-z0-9][a-z0-9-]{0,15}$` and unique, `text` and `impact` non-empty, 2 to
6 options with non-empty unique labels and exactly one `default: true`. The
questions file is a JSON array of those questions. The supervisor applies
the written file once per `run_id` (the 32.1 event row `questions`, source
`planner`); this verb moves no state. Its refusals: `TooManyQuestions` (a
fourth), `QuestionInvalid` (naming the index), `EngagementClosed`,
`NotIntake` (any state but `intake`), `RunIdRequired`, plus the record's.

The `scope` verb (Story 32.4, user flow F2 step 3) is the engagement's
scope of work, published to Confluence:

  uv run engage.py scope --directory ROOT --engagement ENG-NNN
      [--scope-file PATH | --revise-at AT] [--dry-run]

In `scoping` only (else `NotScoping`, or `EngagementClosed`). The planner's
`scope.md` (`--scope-file`, default the engagement's own `scope.md`) is
checked first (Settled shape 1): the `##` sections `Goal`, `Deliverables`
(each `### <title>` with an `Acceptance signal:` line, else
`DeliverableWithoutSignal: <title>`), `Exclusions`, `What the studio needs
from you` (each list item dated `YYYY-MM-DD`), `Milestones` and `Proposed
epics and stories` (`### Epic <k>: …` / `#### Story <k>.<m>: …` in
`epics.md`'s story shape, at least one story), in that order, each
non-empty, plus an optional last `## Assumptions` naming each of the
record's `assumptions[]` question ids (else `AssumptionUnstated: <id>`);
any other shape is `ScopeInvalid: <what>`. `--revise-at AT` instead takes
the body of the record's `revise` input logged at `AT` verbatim (unchecked,
D9; none: `ReviseNotFound`). Under `scope.lock` (the `chat.lock` pattern;
held: `ScopeBusy`, `partial` with `retry: true`) the text lands as
`_bmad-output/engagements/<id>/scope.md` (atomically, when it differs) and
is published as the page `ENG-NNN: Scope of Work` in the folder
`Engagements/ENG-NNN` (each found by title, else created) with 31.3's
provenance footer, skipped when the remote footer's content hash matches;
then the record is re-read fresh and only `scope_page {id, url, version}`
and `updated` are merged into it. No binding is `ConfluenceUnbound`; an
absent agent-seat variable is named; a refused write is `PublishRefused`;
a 429 or 5xx is `partial` with `retry: true` (`scope.md` kept,
`scope_page` unchanged); `scope.md`, the record or `scope.lock` refused by
the OS is `ScopeUnwritable: <path>: <error>` (`written` names what had
already landed). Nothing is written under `plan/`,
`_bmad-output/planning-artifacts/` or `.tk-studio/`: the proposed epics and
stories become plan entities only at approval (32.6). The sync-back mirrors
an owner's edit of the page back through `apply_page_revision` (Settled
shape 3). The `reply` memory carries `scope {path, text}` (null while
there is none), so the planner's next turn reads the current scope.

Refusals end `blocked` (exit 2), each named in `reason`: `BadEngagement`,
`UnknownEngagement` (no record), `EngagementRecordUnreadable` (not JSON, or
not a record), `EngagementClosed` (`delivered`, `failed`, `cancelled`),
`BodyEmpty`, `BodyTooLarge`, `RunIdRequired`, `ProposalInvalid` (naming the
index), `ChatBusy` (the lock held past the wait), `ChatUnwritable` (the chat not
UTF-8, or the lock or chat file refused by the OS), an unreadable
`--body-file` or `--proposals-file`. Nothing is appended on a refusal. A
dry run writes nothing and ends `partial`. Every result ends with the §3
status block (AD-11). Stdlib-only (NFR9); never prompts; imports no driver
and no supervisor code.
"""
from __future__ import annotations

import argparse
import html
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import config as configlib
import mdstorage
from job import atomic_write_text

INTENT = "tk-studio-engage"
ENGAGEMENT_ID_RE = re.compile(r"^ENG-\d{3,}$")
ENGAGEMENTS_REL = Path("_bmad-output") / "engagements"
TERMINAL_STATES = ("delivered", "failed", "cancelled")
INPUT_VERBS = ("answer", "go", "revise", "question", "approve", "cancel")
AUTONOMY_LEVELS = ("ask", "steady", "full")
BODY_MAX_BYTES = 32 * 1024
LABEL_MAX = 80
INDEX_MAX = 200
CHAT_LOCK_STALE_S = 30.0
CHAT_LOCK_WAIT_S = 5.0
# The three memory indexes: (key, root-relative directory, excluded subtree).
INDEXES = (
    ("plan", "_bmad-output/planning-artifacts", None),
    ("kb", "kb", "kb/confluence"),
    ("confluence", "kb/confluence", None),
)
TITLE_RE = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$")

# Each verb's fields besides `verb`: (required, optional) — the supervisor's
# `VERB_FIELDS` (apps/supervisor/src/engagement.ts).
VERB_FIELDS = {
    "answer": (("answers",), ()),
    "go": ((), ("cap",)),
    "revise": ((), ("body",)),
    "question": (("text",), ()),
    "approve": (("autonomy",), ("base_ref",)),
    "cancel": ((), ("reason",)),
}


class Refused(Exception):
    """A named refusal: `name` leads the status block's reason."""

    def __init__(self, name: str, detail: str):
        super().__init__(f"{name}: {detail}")
        self.name = name


def _result(engagement: str, mode: str, dry_run: bool) -> dict:
    return {"ok": False, "dry_run": dry_run, "engagement": engagement,
            "mode": mode, "notes": [], "written": []}


def _finish(result: dict, status: str, reason: str | None) -> dict:
    result["ok"] = status != "blocked"
    for key in ("status", "intent", "artifacts", "reason"):
        result.pop(key, None)
    result.update({"status": status, "intent": INTENT,
                   "artifacts": list(result["written"]), "reason": reason})
    return result


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds") \
        .replace("+00:00", "Z")


def _non_empty(value) -> bool:
    return isinstance(value, str) and value.strip() != ""


# ------------------------------------------------------------ the record

def engagement_dir(root: Path, engagement: str) -> Path:
    return Path(root) / ENGAGEMENTS_REL / engagement


def chat_rel(engagement: str) -> str:
    return f"_bmad-output/engagements/{engagement}/chat.jsonl"


def read_record(root: Path, engagement: str) -> dict:
    """The record, read as JSON (Settled shape 1); refused by name when it
    is absent, not JSON or not a record of `engagement`."""
    path = engagement_dir(root, engagement) / "engagement.yaml"
    shown = f"_bmad-output/engagements/{engagement}/engagement.yaml"
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise Refused("UnknownEngagement", f"no record at {shown}") from None
    except (OSError, UnicodeDecodeError) as exc:
        raise Refused("EngagementRecordUnreadable",
                      f"{shown}: {exc.__class__.__name__}") from None
    try:
        record = json.loads(text)
    except json.JSONDecodeError as exc:
        raise Refused("EngagementRecordUnreadable",
                      f"{shown} is not JSON text ({exc.msg})") from None
    if not isinstance(record, dict) or record.get("shape_version") != 1:
        raise Refused("EngagementRecordUnreadable",
                      f"{shown} is not an engagement record "
                      f"(shape_version 1)")
    if record.get("id") != engagement:
        raise Refused("EngagementRecordUnreadable",
                      f"{shown}: id {record.get('id')!r} does not match "
                      f"its directory {engagement}")
    return record


def read_chat(root: Path, engagement: str) -> list[dict]:
    """Every parsed chat line with a finite numeric `seq` (a torn line, or
    one whose `seq` is NaN or an infinity, skipped)."""
    path = engagement_dir(root, engagement) / "chat.jsonl"
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []
    lines = []
    for raw in text.split("\n"):
        if not raw.strip():
            continue
        try:
            line = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if not isinstance(line, dict):
            continue
        seq = line.get("seq")
        if isinstance(seq, bool) or not isinstance(seq, (int, float)):
            continue
        if isinstance(seq, float) and not math.isfinite(seq):
            continue
        lines.append(line)
    return lines


# ------------------------------------------------------------ the memory

def _title(path: Path) -> str | None:
    """A Markdown file's first ATX heading (within its first 64 lines)."""
    if path.suffix.lower() not in (".md", ".markdown"):
        return None
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for _ in range(64):
                line = handle.readline()
                if not line:
                    break
                match = TITLE_RE.match(line.strip())
                if match:
                    return match.group(1)
    except OSError:
        return None
    return None


def index(root: Path, rel: str, exclude: str | None = None,
          cap: int = INDEX_MAX) -> dict:
    """`{root, files: [{path, bytes, title}], truncated}`: every file under
    `rel` (dot-names skipped, `exclude` left out), root-relative with `/`,
    sorted by path, at most `cap`."""
    base = Path(root) / rel
    files = []
    if base.is_dir():
        for dirpath, dirnames, filenames in os.walk(base):
            here = Path(dirpath)
            keep = []
            for name in dirnames:
                child = (here / name).relative_to(root).as_posix()
                if name.startswith(".") or (exclude and child == exclude):
                    continue
                keep.append(name)
            dirnames[:] = sorted(keep)
            for name in filenames:
                if name.startswith("."):
                    continue
                path = here / name
                try:
                    size = path.stat().st_size
                except OSError:
                    continue
                files.append({"path": path.relative_to(root).as_posix(),
                              "bytes": size, "title": _title(path)})
    files.sort(key=lambda f: f["path"])
    return {"root": rel, "files": files[:cap], "truncated": len(files) > cap}


def memory(root: Path) -> dict:
    return {key: index(root, rel, exclude) for key, rel, exclude in INDEXES}


# ------------------------------------------------------------ the proposals

def check_payload(verb: str, payload) -> str | None:
    """The supervisor's per-verb rules (`checkInputBody`) on a proposal's
    payload; None when it holds, else what is wrong."""
    if not isinstance(payload, dict):
        return "payload must be an object"
    required, optional = VERB_FIELDS[verb]
    allowed = required + optional
    for key in payload:
        if key not in allowed:
            return (f"unknown field '{key}' for verb '{verb}' (allowed: "
                    f"{', '.join(allowed) if allowed else 'none'})")
    for key in required:
        if key not in payload:
            return f"missing field '{key}' for verb '{verb}'"
    if verb == "answer":
        answers = payload["answers"]
        if not isinstance(answers, dict) or not answers:
            return ("field 'answers' must be a non-empty object of question "
                    "id to option")
        for qid, option in answers.items():
            if not qid.strip():
                return "field 'answers' has an empty question id"
            if not _non_empty(option):
                return f"field 'answers.{qid}' must be a non-empty string"
    elif verb == "go":
        cap = payload.get("cap")
        if "cap" in payload and (isinstance(cap, bool)
                                 or not isinstance(cap, (int, float))
                                 or not math.isfinite(cap) or cap <= 0):
            return "field 'cap' must be a number > 0"
    elif verb == "revise":
        if "body" in payload:
            if not _non_empty(payload["body"]):
                return "field 'body' must be a non-empty string"
            if len(payload["body"].encode("utf-8")) > BODY_MAX_BYTES:
                return f"field 'body' exceeds {BODY_MAX_BYTES} bytes (UTF-8)"
    elif verb == "question":
        if not _non_empty(payload["text"]):
            return "field 'text' must be a non-empty string"
    elif verb == "approve":
        if payload["autonomy"] not in AUTONOMY_LEVELS:
            return ("field 'autonomy' must be one of "
                    + ", ".join(AUTONOMY_LEVELS))
        if "base_ref" in payload and not _non_empty(payload["base_ref"]):
            return "field 'base_ref' must be a non-empty string"
    elif verb == "cancel":
        if "reason" in payload and not _non_empty(payload["reason"]):
            return "field 'reason' must be a non-empty string"
    return None


def check_proposals(proposals) -> list[dict]:
    """The proposals checked (Settled shape 4); ProposalInvalid names the
    first bad index."""
    if not isinstance(proposals, list):
        raise Refused("ProposalInvalid", "the proposals must be a JSON array")
    out = []
    for i, proposal in enumerate(proposals):
        def bad(why: str):
            return Refused("ProposalInvalid", f"proposals[{i}]: {why}")
        if not isinstance(proposal, dict):
            raise bad("not an object {verb, payload, label}")
        extra = [k for k in proposal if k not in ("verb", "payload", "label")]
        if extra:
            raise bad(f"unknown field '{extra[0]}' (allowed: verb, payload, "
                      f"label)")
        verb = proposal.get("verb")
        if verb not in INPUT_VERBS:
            raise bad(f"unknown verb {json.dumps(verb)} (allowed: "
                      f"{', '.join(INPUT_VERBS)})")
        if "payload" not in proposal:
            raise bad("missing field 'payload'")
        why = check_payload(verb, proposal["payload"])
        if why:
            raise bad(why)
        label = proposal.get("label")
        if not _non_empty(label):
            raise bad("field 'label' must be a non-empty string")
        if len(label) > LABEL_MAX:
            raise bad(f"field 'label' exceeds {LABEL_MAX} characters")
        out.append({"verb": verb, "payload": proposal["payload"],
                    "label": label})
    return out


# ------------------------------------------------------------ the questions

QUESTION_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,15}$")
QUESTIONS_MAX = 3
OPTIONS_MIN, OPTIONS_MAX = 2, 6
QUESTION_FIELDS = ("id", "text", "options", "impact")
OPTION_FIELDS = ("label", "default")


def questions_rel(engagement: str) -> str:
    return f"_bmad-output/engagements/{engagement}/questions.json"


def check_questions(questions) -> list[dict]:
    """The questions checked (Settled shape 1): a fourth is
    TooManyQuestions; any other bad shape is QuestionInvalid naming the
    first bad index."""
    if not isinstance(questions, list):
        raise Refused("QuestionInvalid", "the questions must be a JSON array")
    if not questions:
        raise Refused("QuestionInvalid", "at least one question is asked")
    if len(questions) > QUESTIONS_MAX:
        raise Refused("TooManyQuestions", f"{len(questions)} questions; at "
                      f"most {QUESTIONS_MAX} are asked (questions[3] is "
                      f"one too many)")
    out, ids = [], set()
    for i, question in enumerate(questions):
        def bad(why: str):
            return Refused("QuestionInvalid", f"questions[{i}]: {why}")
        if not isinstance(question, dict):
            raise bad("not an object {id, text, options, impact}")
        extra = [k for k in question if k not in QUESTION_FIELDS]
        if extra:
            raise bad(f"unknown field '{extra[0]}' (allowed: "
                      f"{', '.join(QUESTION_FIELDS)})")
        qid = question.get("id")
        if not isinstance(qid, str) or not QUESTION_ID_RE.fullmatch(qid):
            raise bad(f"field 'id' {json.dumps(qid)} must match "
                      f"{QUESTION_ID_RE.pattern}")
        if qid in ids:
            raise bad(f"duplicate id '{qid}'")
        ids.add(qid)
        for key in ("text", "impact"):
            if not _non_empty(question.get(key)):
                raise bad(f"field '{key}' must be a non-empty string")
        options = question.get("options")
        if not isinstance(options, list) or not \
                OPTIONS_MIN <= len(options) <= OPTIONS_MAX:
            raise bad(f"field 'options' must hold {OPTIONS_MIN} to "
                      f"{OPTIONS_MAX} options")
        labels, defaults, kept = set(), 0, []
        for j, option in enumerate(options):
            if not isinstance(option, dict):
                raise bad(f"options[{j}] is not an object {{label, default?}}")
            extra = [k for k in option if k not in OPTION_FIELDS]
            if extra:
                raise bad(f"options[{j}]: unknown field '{extra[0]}' "
                          f"(allowed: label, default)")
            label = option.get("label")
            if not _non_empty(label):
                raise bad(f"options[{j}]: field 'label' must be a non-empty "
                          f"string")
            folded = label.strip().casefold()
            if folded in labels:
                raise bad(f"options[{j}]: duplicate label '{label.strip()}'")
            labels.add(folded)
            if "default" in option:
                if option["default"] is not True:
                    raise bad(f"options[{j}]: field 'default' must be true "
                              f"when present")
                defaults += 1
            kept.append({"label": label.strip(),
                         **({"default": True} if option.get("default")
                            is True else {})})
        if defaults != 1:
            raise bad(f"exactly one option is the default ({defaults} are)")
        out.append({"id": qid, "text": question["text"].strip(),
                    "options": kept, "impact": question["impact"].strip()})
    return out


def questions(project_root: Path, engagement: str, asked=None,
              run_id: str | None = None, dry_run: bool = False,
              now=None) -> dict:
    """The `questions` verb (see the module docstring): `asked` is the
    parsed questions file."""
    root = Path(project_root).resolve()
    result = _result(engagement, "questions", dry_run)
    try:
        if not ENGAGEMENT_ID_RE.match(engagement or ""):
            raise Refused("BadEngagement", f"--engagement {engagement!r} is "
                          f"not an engagement id (ENG-001)")
        record = read_record(root, engagement)
        state = record.get("state")
        if state in TERMINAL_STATES:
            raise Refused("EngagementClosed", f"{engagement} is {state}; "
                          f"nothing is written")
        if state != "intake":
            raise Refused("NotIntake", f"{engagement} is {state}; questions "
                          f"are asked only in intake")
        if not _non_empty(run_id):
            raise Refused("RunIdRequired", "the questions name their run "
                          "(--run-id, the payload's run_id)")
        checked = check_questions(asked)
        doc = {"run_id": run_id.strip(), "at": now or _now(),
               "questions": checked}
        result["questions"] = doc
        if dry_run:
            result["notes"].append("dry run: questions.json was not written")
            return _finish(result, "partial", "dry run: nothing written; a "
                           "real run would write `questions`")
        atomic_write_text(engagement_dir(root, engagement) / "questions.json",
                          json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
        result["written"].append(questions_rel(engagement))
        return _finish(result, "complete", None)
    except Refused as exc:
        return _finish(result, "blocked", f"engage refused: {exc}")


# ------------------------------------------------------------ the chat lock

def _take_over_stale(lock: Path, clock,
                     stale_s: float = CHAT_LOCK_STALE_S) -> None:
    """Take a stale lock over atomically: rename it to a unique name (of
    two writers that saw it stale, one rename wins; the other finds it
    gone). What was moved is checked once more: not stale (another writer
    retook the lock between this writer's stat and its rename), it is put
    back with an exclusive link (never over a lock that exists) before the
    moved name is removed. The caller then retries the exclusive create."""
    aside = lock.with_name(f"{lock.name}.stale-{os.getpid()}-"
                           f"{os.urandom(4).hex()}")
    try:
        os.rename(lock, aside)
    except FileNotFoundError:
        return
    try:
        if clock() - aside.stat().st_mtime <= stale_s:
            try:
                os.link(aside, lock)
            except OSError:
                pass
    finally:
        try:
            aside.unlink()
        except FileNotFoundError:
            pass


def _with_chat_lock(root: Path, engagement: str, fn, wait_s=CHAT_LOCK_WAIT_S,
                    clock=time.time, sleep=time.sleep):
    """Run `fn` holding `chat.lock` (exclusive create; older than 30 s it is
    stale and retaken; held, it is waited on up to `wait_s`, then ChatBusy)."""
    lock = engagement_dir(root, engagement) / "chat.lock"
    deadline = clock() + wait_s
    while True:
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            try:
                if clock() - lock.stat().st_mtime > CHAT_LOCK_STALE_S:
                    _take_over_stale(lock, clock)
                    continue
            except FileNotFoundError:
                continue
            if clock() >= deadline:
                raise Refused("ChatBusy", f"_bmad-output/engagements/"
                              f"{engagement}/chat.lock is held") from None
            sleep(0.02)
            continue
        os.close(fd)
        try:
            return fn()
        finally:
            try:
                lock.unlink()
            except FileNotFoundError:
                pass


def append_line(root: Path, engagement: str, line: dict) -> dict:
    """Append `line` under the lock with the next `seq` (the last re-read
    inside it); the file is rewritten whole, atomically. A chat that is not
    UTF-8, or a lock or chat file the OS refuses (OSError), is ChatUnwritable
    and nothing is appended."""
    path = engagement_dir(root, engagement) / "chat.jsonl"

    def write() -> dict:
        try:
            text = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            text = ""
        last = 0
        for existing in read_chat(root, engagement):
            last = max(last, int(existing["seq"]))
        written = {"seq": last + 1, **line}
        body = text if not text or text.endswith("\n") else text + "\n"
        atomic_write_text(path, body + json.dumps(
            written, ensure_ascii=False) + "\n")
        return written

    try:
        return _with_chat_lock(root, engagement, write)
    except (OSError, UnicodeDecodeError) as exc:
        raise Refused("ChatUnwritable", f"{chat_rel(engagement)}: "
                      f"{exc.__class__.__name__}") from None


# ------------------------------------------------------------ the verb

def reply(project_root: Path, engagement: str, body: str | None = None,
          proposals=None, run_id: str | None = None, dry_run: bool = False,
          now=None) -> dict:
    """The `reply` verb (see the module docstring). `body` None is the
    memory mode; a text is the write mode (`proposals` the parsed list)."""
    root = Path(project_root).resolve()
    mode = "memory" if body is None else "write"
    result = _result(engagement, mode, dry_run)
    try:
        if not ENGAGEMENT_ID_RE.match(engagement or ""):
            raise Refused("BadEngagement", f"--engagement {engagement!r} is "
                          f"not an engagement id (ENG-001)")
        record = read_record(root, engagement)
        state = record.get("state")
        if state in TERMINAL_STATES:
            raise Refused("EngagementClosed", f"{engagement} is {state}; "
                          f"nothing is appended")
        if mode == "memory":
            result.update({"record": record,
                           "chat": read_chat(root, engagement),
                           "memory": memory(root),
                           "scope": read_scope(root, engagement)})
            return _finish(result, "complete", None)
        if not body.strip():
            raise Refused("BodyEmpty", "the reply body is empty")
        if len(body.encode("utf-8")) > BODY_MAX_BYTES:
            raise Refused("BodyTooLarge", f"the reply body exceeds "
                          f"{BODY_MAX_BYTES} bytes (UTF-8)")
        if not _non_empty(run_id):
            raise Refused("RunIdRequired", "a reply names its run "
                          "(--run-id, the payload's run_id)")
        checked = check_proposals([] if proposals is None else proposals)
        line = {"at": now or _now(), "author": "planner", "body": body,
                "run_id": run_id.strip(), "proposals": checked}
        if dry_run:
            result["line"] = {"seq": None, **line}
            result["notes"].append("dry run: the line was not appended")
            return _finish(result, "partial", "dry run: nothing written; a "
                           "real run would append `line`")
        result["line"] = append_line(root, engagement, line)
        result["written"].append(chat_rel(engagement))
        return _finish(result, "complete", None)
    except Refused as exc:
        return _finish(result, "blocked", f"engage refused: {exc}")


# ------------------------------------------------------------ the scope

SCOPE_SECTIONS = ("Goal", "Deliverables", "Exclusions",
                  "What the studio needs from you", "Milestones",
                  "Proposed epics and stories")
ASSUMPTIONS_SECTION = "Assumptions"
SCOPE_TITLE = "{engagement}: Scope of Work"
ENGAGEMENTS_FOLDER = "Engagements"
SCOPE_LOCK_WAIT_S = 5.0
# scope.lock wraps Confluence I/O, so it is stale only well past the worst
# publish: ~8 requests (folders, page lookup, GET, PUT, a few result pages)
# each up to the 30 s urlopen timeout, plus the client's 90 s 429 wait
# budget (jirabackend.RETRY_WAIT_BUDGET) — about 330 s; 900 s leaves a
# wide margin and stays far from chat.lock's 30 s.
SCOPE_LOCK_STALE_S = 900.0
SCOPE_FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")
SCOPE_H_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
# `**Acceptance signal:** …` and `**Acceptance signal**: …` (the colon inside
# or outside the bold) and the plain `Acceptance signal: …`
SIGNAL_RE = re.compile(r"^\s*(?:[-*+]\s+)?(?:\*\*|__)?Acceptance signal"
                       r"(?:\*\*|__)?:(?:\*\*|__)?\s*(.*)$", re.IGNORECASE)
SCOPE_ITEM_RE = re.compile(r"^([-*+]|\d{1,9}[.)])\s+")
ISO_DATE_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
EPIC_RE = re.compile(r"^Epic\s+(\d+)\s*:\s*\S")
STORY_RE = re.compile(r"^Story\s+(\d+)\.(\d+)\s*:\s*\S")
STORY_SHAPE = (("As a", re.compile(r"\bAs an?\b")),
               ("I want", re.compile(r"\bI want\b")),
               ("So that", re.compile(r"\bSo that\b")),
               ("**Acceptance Criteria:**",
                re.compile(r"Acceptance Criteria", re.IGNORECASE)))
SCOPE_TRANSIENT_RE = re.compile(r"\bcannot reach\b|\breturned 5\d\d\b|"
                                r"^HTTP 5\d\d\b")


def scope_rel(engagement: str) -> str:
    return f"_bmad-output/engagements/{engagement}/scope.md"


def read_scope(root: Path, engagement: str) -> dict | None:
    """`{path, text}` of the engagement's `scope.md`, or None."""
    path = engagement_dir(root, engagement) / "scope.md"
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    return {"path": scope_rel(engagement), "text": text}


def _headings(text: str) -> list[tuple[int, int, str]]:
    """(line index, level, title) of every ATX heading outside a fence."""
    out, fence = [], None
    for i, line in enumerate(text.replace("\r\n", "\n").split("\n")):
        opened = SCOPE_FENCE_RE.match(line)
        if fence is not None:
            if opened and opened.group(1)[0] == fence[0] \
                    and len(opened.group(1)) >= len(fence):
                fence = None
            continue
        if opened:
            fence = opened.group(1)
            continue
        m = SCOPE_H_RE.match(line)
        if m:
            out.append((i, len(m.group(1)), m.group(2).strip()))
    return out


def parse_scope(text: str) -> dict:
    """The scope's `##` sections in order: `{sections: [(title, body
    lines)], headings}`; text before the first `##` is the preamble."""
    lines = text.replace("\r\n", "\n").split("\n")
    heads = _headings(text)
    tops = [(i, title) for i, level, title in heads if level == 2]
    sections = []
    for n, (i, title) in enumerate(tops):
        end = tops[n + 1][0] if n + 1 < len(tops) else len(lines)
        sections.append((title, lines[i + 1:end]))
    return {"sections": sections}


def _subsections(body: list[str], level: int) -> list[tuple[str, list[str]]]:
    """The `level` headings of a section body with their lines (deeper
    headings stay inside)."""
    text = "\n".join(body)
    heads = [(i, t) for i, lv, t in _headings(text) if lv == level]
    out = []
    for n, (i, title) in enumerate(heads):
        stop = len(body)
        for j, lv, _t in _headings(text):
            if j > i and lv <= level:
                stop = j
                break
        out.append((title, body[i + 1:stop]))
    return out


def check_scope(text: str, assumptions=None) -> None:
    """The planner's `scope.md` checked (Settled shapes 1 and 5); raises the
    named refusal, else returns None."""
    sections = parse_scope(text)["sections"]
    known = [s.casefold() for s in SCOPE_SECTIONS + (ASSUMPTIONS_SECTION,)]
    titles = [title for title, _ in sections]
    for title in titles:
        if title.casefold() not in known:
            raise Refused("ScopeInvalid", f"unknown section '## {title}' "
                          f"(allowed, in order: "
                          f"{', '.join(SCOPE_SECTIONS)}, then an optional "
                          f"{ASSUMPTIONS_SECTION})")
    folded = [t.casefold() for t in titles]
    for name in SCOPE_SECTIONS + (ASSUMPTIONS_SECTION,):
        if folded.count(name.casefold()) > 1:
            raise Refused("ScopeInvalid", f"section '## {name}' appears "
                          f"twice")
    for name in SCOPE_SECTIONS:
        if name.casefold() not in folded:
            raise Refused("ScopeInvalid", f"section '## {name}' is missing")
    expected = list(SCOPE_SECTIONS)
    if ASSUMPTIONS_SECTION.casefold() in folded:
        expected.append(ASSUMPTIONS_SECTION)
    for title, want in zip(titles, expected):
        if title.casefold() != want.casefold():
            raise Refused("ScopeInvalid", f"section '## {title}' is out of "
                          f"order (expected '## {want}' there)")
    body = {title.casefold(): lines for title, lines in sections}
    for name in SCOPE_SECTIONS + ((ASSUMPTIONS_SECTION,)
                                  if ASSUMPTIONS_SECTION.casefold() in body
                                  else ()):
        if not "\n".join(body[name.casefold()]).strip():
            raise Refused("ScopeInvalid", f"section '## {name}' is empty")
    # deliverables: each `### <title>` carries its acceptance signal
    deliverables = _subsections(body["deliverables"], 3)
    if not deliverables:
        raise Refused("ScopeInvalid", "section '## Deliverables' names no "
                      "deliverable (### <title>)")
    for title, lines in deliverables:
        if not any((m := SIGNAL_RE.match(line)) and m.group(1).strip()
                   for line in lines):
            raise Refused("DeliverableWithoutSignal", title)
    # dependencies: each list item dated
    n = 0
    for line in body["what the studio needs from you"]:
        if not SCOPE_ITEM_RE.match(line):
            continue
        n += 1
        dated = False
        for found in ISO_DATE_RE.findall(line):
            try:
                datetime.strptime(found, "%Y-%m-%d")
                dated = True
            except ValueError:
                pass
        if not dated:
            raise Refused("ScopeInvalid", f"dependency {n} has no date "
                          f"(YYYY-MM-DD)")
    # proposed epics and stories, in epics.md's story shape
    stories = 0
    for etitle, elines in _subsections(body["proposed epics and stories"], 3):
        if not EPIC_RE.match(etitle):
            raise Refused("ScopeInvalid", f"'### {etitle}' is not an epic "
                          f"heading (### Epic <k>: <title>)")
        for stitle, slines in _subsections(elines, 4):
            if not STORY_RE.match(stitle):
                raise Refused("ScopeInvalid", f"'#### {stitle}' is not a "
                              f"story heading (#### Story <k>.<m>: <title>)")
            story = "\n".join(slines)
            for label, pattern in STORY_SHAPE:
                if not pattern.search(story):
                    raise Refused("ScopeInvalid", f"'#### {stitle}' has no "
                                  f"'{label}' (epics.md's story shape)")
            stories += 1
    if not stories:
        raise Refused("ScopeInvalid", "no proposed story (#### Story <k>.<m>: "
                      "<title> under ### Epic <k>: <title>)")
    # an image is never part of a scope
    storage, images = mdstorage.convert(text, "scope.md")
    if images:
        raise Refused("ScopeInvalid", f"an image ({images[0]['path']}) — a "
                      f"scope carries no image")
    if "<ac:image" in storage:
        # a web image (`https://…`, `//…`) is an `ri:url`, no attachment
        found = re.search(r'<ac:image[^>]*>\s*<ri:url ri:value="([^"]*)"',
                          storage)
        src = html.unescape(found.group(1)) if found else "a web image"
        raise Refused("ScopeInvalid", f"an image ({src}) — a scope carries "
                      f"no image")
    # the assumptions named on the page (Settled shape 5)
    stated = "\n".join(body.get(ASSUMPTIONS_SECTION.casefold(), []))
    for entry in assumptions or []:
        qid = entry.get("question") if isinstance(entry, dict) else None
        if not isinstance(qid, str) or not qid:
            continue
        if not re.search(r"(?<![a-z0-9-])" + re.escape(qid) + r"(?![a-z0-9-])",
                         stated):
            raise Refused("AssumptionUnstated", qid)


def _with_scope_lock(root: Path, engagement: str, fn,
                     wait_s=SCOPE_LOCK_WAIT_S, clock=time.time,
                     sleep=time.sleep):
    """Run `fn` holding `scope.lock` (the `chat.lock` rule: exclusive
    create, retaken when stale, held past `wait_s`: ScopeBusy), stale only
    after SCOPE_LOCK_STALE_S (it wraps Confluence I/O). The lock holds a
    token unique to this holder, and release removes it only while it still
    holds that token: a lock taken over by another writer is never
    removed by the first holder."""
    lock = engagement_dir(root, engagement) / "scope.lock"
    token = f"{os.getpid()}-{os.urandom(8).hex()}"
    deadline = clock() + wait_s
    while True:
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            try:
                if clock() - lock.stat().st_mtime > SCOPE_LOCK_STALE_S:
                    _take_over_stale(lock, clock, SCOPE_LOCK_STALE_S)
                    continue
            except FileNotFoundError:
                continue
            if clock() >= deadline:
                raise Refused("ScopeBusy", f"_bmad-output/engagements/"
                              f"{engagement}/scope.lock is held") from None
            sleep(0.02)
            continue
        try:
            os.write(fd, token.encode("ascii"))
        finally:
            os.close(fd)
        try:
            return fn()
        finally:
            _release_scope_lock(lock, token)


def _release_scope_lock(lock: Path, token: str) -> None:
    """Remove `lock` only while it still holds this holder's `token`."""
    try:
        held = lock.read_text(encoding="ascii", errors="replace")
    except (FileNotFoundError, OSError):
        return
    if held != token:
        return
    try:
        lock.unlink()
    except FileNotFoundError:
        pass


def _merge_record(root: Path, engagement: str, changes: dict) -> None:
    """Re-read the record fresh and merge only `changes` (the
    `chatSpendPass` rule), written atomically as JSON text."""
    record = read_record(root, engagement)
    record.update(changes)
    atomic_write_text(engagement_dir(root, engagement) / "engagement.yaml",
                      json.dumps(record, ensure_ascii=False, indent=2) + "\n")


class _Transient(Exception):
    """A 429 or 5xx, or the network: `partial`, `retry: true`."""


def _page_url(site: str | None, webui: str | None) -> str | None:
    site = re.sub(r"^https?://", "", site or "").strip("/")
    if site and webui:
        return f"https://{site}/wiki{webui}"
    return webui


def _publish_scope(root: Path, engagement: str, text: str, space_id: str,
                   site: str | None, transport, sleep,
                   recorded_version=None) -> dict:
    """The page `ENG-NNN: Scope of Work` in `Engagements/ENG-NNN` (Settled
    shape 2): `{id, url, version, action}`. `skipped` only when the footer
    hash matches and the page is still at `recorded_version` (or none is
    recorded): an owner's newer version is overwritten at version + 1
    (local wins), never adopted unmirrored."""
    import confluence
    import plansync
    try:
        client = confluence.ConfluenceClient.from_env(transport)
        if sleep is not None:
            client.sleep = sleep

        def refused(what: str, detail: str):
            if SCOPE_TRANSIENT_RE.search(detail):
                return _Transient(f"{what}: {detail}")
            return Refused("PublishRefused", f"{what}: {detail}")

        parent = confluence.find_folders(client, space_id).get(
            ENGAGEMENTS_FOLDER)
        if parent is None:
            made, detail = confluence.create_folder(client, space_id,
                                                    ENGAGEMENTS_FOLDER)
            if made is None:
                raise refused(f"folder {ENGAGEMENTS_FOLDER} create refused",
                              detail)
            parent = str(made["id"])
        folder = confluence.find_child_folder(client, parent, engagement)
        if folder is None:
            made, detail = confluence.create_folder(client, space_id,
                                                    engagement,
                                                    parent_id=parent)
            if made is None:
                raise refused(f"folder {ENGAGEMENTS_FOLDER}/{engagement} "
                              f"create refused", detail)
            folder = str(made["id"])
        title = SCOPE_TITLE.format(engagement=engagement)
        rel = scope_rel(engagement)
        storage, _images = mdstorage.convert(text, rel)
        digest = plansync.page_hash(title, storage, [])
        body = storage + plansync.page_footer(
            rel, plansync._provenance(root, rel), digest)
        page_id = confluence.find_page(client, folder, title)
        if page_id is not None:
            page = confluence.get_page(client, page_id)
            hashes = plansync.FOOTER_HASH_RE.findall(confluence.page_body(page))
            remote = confluence.page_version(page)
            if hashes and hashes[-1] == digest and (
                    recorded_version is None or remote == recorded_version):
                return {"id": page_id,
                        "url": _page_url(site, plansync._webui(page)),
                        "version": confluence.page_version(page),
                        "action": "skipped"}
            put, detail = confluence.update_page(
                client, page_id, title, body,
                confluence.page_version(page) + 1)
            if put is None:
                raise refused(f"page {title} update refused", detail)
            webui = plansync._webui(put) or plansync._webui(page)
            version = confluence.page_version(put) \
                or confluence.page_version(page) + 1
            return {"id": page_id, "url": _page_url(site, webui),
                    "version": version, "action": "updated"}
        made, detail = confluence.create_page(client, space_id, folder, title,
                                              body)
        if made is None:
            raise refused(f"page {title} create refused", detail)
        return {"id": str(made["id"]),
                "url": _page_url(site, plansync._webui(made)),
                "version": confluence.page_version(made) or 1,
                "action": "created"}
    except confluence.RateLimited as exc:
        raise _Transient(str(exc)) from None
    except confluence.ConfluenceError as exc:
        if SCOPE_TRANSIENT_RE.search(str(exc)):
            raise _Transient(str(exc)) from None
        raise Refused("PublishRefused", str(exc)) from None


def scope(project_root: Path, engagement: str, text: str | None = None,
          revise_at: str | None = None, dry_run: bool = False, now=None,
          transport=None, sleep=None, lock_wait_s=SCOPE_LOCK_WAIT_S) -> dict:
    """The `scope` verb (see the module docstring): `text` is the planner's
    scope (checked); `revise_at` names the `revise` input whose body is
    taken verbatim."""
    import confluence
    import plansync
    root = Path(project_root).resolve()
    result = _result(engagement, "scope", dry_run)
    result.update({"source": "revise" if revise_at is not None
                   else "planner", "scope": scope_rel(engagement),
                   "page": None})
    try:
        if not ENGAGEMENT_ID_RE.match(engagement or ""):
            raise Refused("BadEngagement", f"--engagement {engagement!r} is "
                          f"not an engagement id (ENG-001)")
        record = read_record(root, engagement)
        state = record.get("state")
        if state in TERMINAL_STATES:
            raise Refused("EngagementClosed", f"{engagement} is {state}; "
                          f"nothing is written")
        if state != "scoping":
            raise Refused("NotScoping", f"{engagement} is {state}; the scope "
                          f"is written only in scoping")
        if revise_at is not None:
            line = next((l for l in reversed(record.get("inputs") or [])
                         if isinstance(l, dict) and l.get("verb") == "revise"
                         and l.get("at") == revise_at), None)
            body = ((line or {}).get("payload") or {}).get("body") \
                if isinstance((line or {}).get("payload"), dict) else None
            if not _non_empty(body):
                raise Refused("ReviseNotFound", f"no revise input with a "
                              f"body at {revise_at!r} in {engagement}'s "
                              f"inputs[]")
            text = body
        else:
            if text is None:
                raise Refused("ScopeInvalid", "no scope text")
            check_scope(text, record.get("assumptions"))
        space_id = plansync._recorded(root, "planning.confluence.space_id")
        if space_id is None:
            raise Refused("ConfluenceUnbound", "planning.confluence.space_id "
                          "is not recorded — run `plansync.py setup` first")
        gaps = confluence.env_gaps()
        if gaps:
            raise Refused("ConfluenceEnvMissing", "; ".join(gaps))
        if dry_run:
            result["notes"].append("dry run: scope.md was not written and "
                                   "the page not published")
            return _finish(result, "partial", "dry run: nothing written; a "
                           "real run would write `scope` and publish it")
        site = plansync._recorded(root, "planning.jira.site")
        path = engagement_dir(root, engagement) / "scope.md"

        def write_and_publish() -> dict:
            # re-checked under the lock: the state may have left scoping
            # since the unlocked check above
            fresh = read_record(root, engagement)
            fresh_state = fresh.get("state")
            if fresh_state in TERMINAL_STATES:
                raise Refused("EngagementClosed", f"{engagement} is "
                              f"{fresh_state}; nothing is written")
            if fresh_state != "scoping":
                raise Refused("NotScoping", f"{engagement} is {fresh_state}; "
                              f"the scope is written only in scoping")
            try:
                current = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                current = None
            if current != text:
                try:
                    atomic_write_text(path, text)
                except OSError as exc:
                    raise Refused("ScopeUnwritable", f"{scope_rel(engagement)}"
                                  f": {exc.__class__.__name__}") from None
                result["written"].append(scope_rel(engagement))
            recorded = fresh.get("scope_page") \
                if isinstance(fresh.get("scope_page"), dict) else {}
            try:
                recorded_version = int(recorded["version"]) \
                    if recorded.get("version") is not None else None
            except (TypeError, ValueError):
                recorded_version = None
            page = _publish_scope(root, engagement, text, space_id, site,
                                  transport, sleep, recorded_version)
            record_rel = f"_bmad-output/engagements/{engagement}/" \
                         f"engagement.yaml"
            try:
                _merge_record(root, engagement, {
                    "scope_page": {"id": page["id"], "url": page["url"],
                                   "version": page["version"]},
                    "updated": now or _now()})
            except OSError as exc:
                # scope.md (in `written`) and the page are already out; only
                # the record's scope_page is behind
                result["notes"].append(f"page {page['id']} published at "
                                       f"version {page['version']}; "
                                       f"scope_page unchanged")
                raise Refused("ScopeUnwritable", f"{record_rel}: "
                              f"{exc.__class__.__name__}") from None
            result["written"].append(record_rel)
            return page

        try:
            result["page"] = _with_scope_lock(root, engagement,
                                              write_and_publish,
                                              wait_s=lock_wait_s)
        except _Transient as exc:
            result["retry"] = True
            result["notes"].append("scope.md kept; scope_page unchanged; "
                                   "rerun to publish")
            return _finish(result, "partial", f"engage scope transient: "
                           f"{exc}")
        except Refused as exc:
            if exc.name != "ScopeBusy":
                raise
            result["retry"] = True
            return _finish(result, "partial", f"engage scope busy: {exc}")
        except OSError as exc:  # the lock itself refused by the OS
            raise Refused("ScopeUnwritable", f"scope.lock: "
                          f"{exc.__class__.__name__}") from None
        if revise_at is not None:
            result["revise_at"] = revise_at
        return _finish(result, "complete", None)
    except Refused as exc:
        return _finish(result, "blocked", f"engage refused: {exc}")


def apply_page_revision(root: Path, engagement: str, page: dict,
                        now=None) -> dict:
    """An owner's edit of the scope page, mirrored by the sync-back
    (Settled shape 3). `page` is `{id, version, body}` (`body` the storage
    format). In `scoping` its Markdown replaces `scope.md` wholesale,
    unchecked (the page is authoritative, D9), and `scope_page.version` is
    merged; in any other state nothing changes and the answer names why.
    Re-checked under `scope.lock`: a record already at or past the page's
    version (a concurrent `scope` publish) applies nothing, without a note.
    Answers `{applied, retry, note, markdown, written[]}`; never raises."""
    root = Path(root)
    out = {"applied": False, "retry": False, "note": None,
           "markdown": mdstorage.to_markdown(page.get("body") or ""),
           "written": []}
    try:
        record = read_record(root, engagement)
    except Refused as exc:
        out["note"] = f"scope edit of {engagement} not applied: {exc}"
        return out
    sp = record.get("scope_page") if isinstance(record.get("scope_page"),
                                                dict) else {}
    if str(sp.get("id")) != str(page.get("id")):
        out["note"] = (f"scope edit of {engagement} not applied: page "
                       f"{page.get('id')} is not its scope page")
        return out
    state = record.get("state")
    if state != "scoping":
        out["note"] = (f"scope edit of {engagement} not applied: state "
                       f"{state} (send revise)")
        return out
    version = page.get("version")
    path = engagement_dir(root, engagement) / "scope.md"

    def replace() -> bool:
        # re-checked under the lock: a concurrent `engage.py scope` may have
        # published a version at or past this one since the sync-back's GET
        fresh = read_record(root, engagement)
        merged = dict(fresh.get("scope_page") or {}) \
            if isinstance(fresh.get("scope_page"), dict) else {}
        # ... and the state or the scope page may have changed since
        if fresh.get("state") != "scoping" \
                or str(merged.get("id")) != str(page.get("id")):
            return False
        try:
            current = int(merged.get("version") or 0)
        except (TypeError, ValueError):
            current = 0
        try:
            if current >= int(version):
                return False
        except (TypeError, ValueError):
            pass
        atomic_write_text(path, out["markdown"])
        merged["version"] = version
        _merge_record(root, engagement, {"scope_page": merged,
                                         "updated": now or _now()})
        return True

    try:
        applied = _with_scope_lock(root, engagement, replace,
                                   wait_s=SCOPE_LOCK_WAIT_S)
    except Refused as exc:
        out["retry"] = exc.name == "ScopeBusy"
        out["note"] = f"scope edit of {engagement} not applied: {exc}"
        return out
    except OSError as exc:
        out["retry"] = True
        out["note"] = (f"scope edit of {engagement} not applied: "
                       f"{exc.__class__.__name__}")
        return out
    if not applied:
        return out  # already at or past this version: nothing to apply
    out["applied"] = True
    out["written"] = [scope_rel(engagement),
                      f"_bmad-output/engagements/{engagement}/engagement.yaml"]
    return out


# --------------------------------------------------------------------- CLI

def _questions_main(directory: Path, args) -> int:
    def refused(why: str) -> int:
        result = _finish(_result(args.engagement, "questions", args.dry_run),
                         "blocked", f"engage refused: {why}; nothing written")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2
    try:
        text = Path(args.questions_file).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return refused(f"cannot read --questions-file: {exc}")
    try:
        asked = json.loads(text)
    except json.JSONDecodeError as exc:
        return refused(f"QuestionInvalid: --questions-file is not JSON "
                       f"({exc.msg})")
    result = questions(directory, args.engagement, asked, run_id=args.run_id,
                       dry_run=args.dry_run)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 2 if result.get("status") == "blocked" else 0


def _scope_main(directory: Path, args, transport=None) -> int:
    text = None
    if args.revise_at is None:
        source = Path(args.scope_file) if args.scope_file else \
            engagement_dir(Path(directory).resolve(), args.engagement) \
            / "scope.md"
        try:
            text = source.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            result = _finish(_result(args.engagement, "scope", args.dry_run),
                             "blocked", f"engage refused: ScopeInvalid: "
                             f"cannot read --scope-file: "
                             f"{exc.__class__.__name__}; nothing written")
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 2
    result = scope(directory, args.engagement, text=text,
                   revise_at=args.revise_at, dry_run=args.dry_run,
                   transport=transport)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 2 if result.get("status") == "blocked" else 0


def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio-engage")
    sub = parser.add_subparsers(dest="command", required=True)
    rep = sub.add_parser("reply")
    rep.add_argument("--directory", required=True,
                     help="project root (walks up to the nearest)")
    rep.add_argument("--engagement", required=True, help="ENG-NNN")
    rep.add_argument("--body-file", help="the reply's text, UTF-8 (never "
                                         "the command line); absent: the "
                                         "memory")
    rep.add_argument("--proposals-file", help="a JSON array of "
                                              "{verb, payload, label}")
    rep.add_argument("--run-id", help="the driven run's id (the payload's "
                                      "run_id)")
    rep.add_argument("--dry-run", action="store_true")
    qst = sub.add_parser("questions")
    qst.add_argument("--directory", required=True,
                     help="project root (walks up to the nearest)")
    qst.add_argument("--engagement", required=True, help="ENG-NNN")
    qst.add_argument("--run-id", help="the driven run's id (the payload's "
                                      "run_id)")
    qst.add_argument("--questions-file", required=True,
                     help="a JSON array of {id, text, options, impact}")
    qst.add_argument("--dry-run", action="store_true")
    scp = sub.add_parser("scope")
    scp.add_argument("--directory", required=True,
                     help="project root (the served root, project_root)")
    scp.add_argument("--engagement", required=True, help="ENG-NNN")
    source = scp.add_mutually_exclusive_group()
    source.add_argument("--scope-file", help="the planner's scope.md "
                                             "(default: the engagement's "
                                             "own scope.md)")
    source.add_argument("--revise-at", help="the `at` of the revise input "
                                            "whose body becomes the scope")
    scp.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    directory = configlib.find_project_root(Path(args.directory))
    if args.command == "questions":
        return _questions_main(directory, args)
    if args.command == "scope":
        return _scope_main(directory, args)
    mode = "write" if args.body_file is not None else "memory"
    texts = {}
    for name in ("body_file", "proposals_file"):
        value = getattr(args, name)
        if value is None:
            continue
        try:
            texts[name] = Path(value).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            result = _finish(_result(args.engagement, mode, args.dry_run),
                             "blocked", f"engage refused: cannot read "
                             f"--{name.replace('_', '-')}: {exc}; nothing "
                             f"appended")
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 2
    proposals = None
    if "proposals_file" in texts:
        if mode == "memory":
            result = _finish(_result(args.engagement, mode, args.dry_run),
                             "blocked", "engage refused: --proposals-file "
                             "needs --body-file; nothing appended")
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 2
        try:
            proposals = json.loads(texts["proposals_file"])
        except json.JSONDecodeError as exc:
            result = _finish(_result(args.engagement, mode, args.dry_run),
                             "blocked", f"engage refused: ProposalInvalid: "
                             f"--proposals-file is not JSON ({exc.msg}); "
                             f"nothing appended")
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 2
    result = reply(directory, args.engagement, body=texts.get("body_file"),
                   proposals=proposals, run_id=args.run_id,
                   dry_run=args.dry_run)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 2 if result.get("status") == "blocked" else 0


if __name__ == "__main__":
    sys.exit(main())
