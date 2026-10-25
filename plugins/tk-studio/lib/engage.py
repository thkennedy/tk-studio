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
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import config as configlib
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

def _take_over_stale(lock: Path, clock) -> None:
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
        if clock() - aside.stat().st_mtime <= CHAT_LOCK_STALE_S:
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
                           "memory": memory(root)})
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
    args = parser.parse_args(argv)
    directory = configlib.find_project_root(Path(args.directory))
    if args.command == "questions":
        return _questions_main(directory, args)
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
