"""tk-studio-engage — the `studio-reply` verb's two scripts (Story 39.3,
design addendum 2026-11-07 §3.8, AD-11, driver contract 0.1.35 additive).

The studio chat is a conversation with the studio, not with an engagement.
The supervisor's route `POST /chat {project, text}` appends the owner's line
to `_bmad-output/tracking/studio-chat.jsonl` at the served registry root and
queues one run of the shipped one-shot `studio-chat` job, a `claude -p`
session on the host driven by `tk-studio-engage` with the payload
`{verb: "studio-reply", project, project_root, seq, run_id}`. The session
runs the tk-studio-orchestrator core headless through this script, answers
from the reads the pages use, and writes one reply:

  uv run studiochat.py context --directory ROOT --seq N

is read-only. It answers `{ok, dry_run, mode: "context", seq, line, chat[],
reads, routing, voice, shell?, not_yet[], notes[], written[]}`: `line` the
owner line `seq`; `chat[]` the last 40 lines up to it; `reads` the
supervisor's reads file `_bmad-output/tracking/studio-chat-reads/<seq>.json`
(the board, the office, the status, the project's last runs with their
ledger cost, the inbox — written by serve at post time, since the session
holds no bearer), or null with a note; `routing` exactly the orchestrator's
terminal answer `{"ok": true, **orchestrate.resolve(root)}` (no `--role`,
the default lock: the same words resolve alike in a terminal and in the
page, AD-11); `voice` `council` when the line names the council
(`\\bcouncil\\b`, any case), else `plain`; `shell` (`orchestrate.load_shell()`)
only for the council voice, as presentation — it is loaded after `routing`
and never feeds it; `not_yet` the proposal kinds that land in Story 39.7.

  uv run studiochat.py reply --directory ROOT --seq N --run-id RUN
      --body-file PATH [--proposals-file PATH] [--dry-run]

appends the reply `{seq, at, author: "planner", body, run_id, reply_to,
proposals[]}` under `_bmad-output/tracking/studio-chat.lock` (exclusive
create, stale after 30 s and taken over, waited on up to 5 s, then
`ChatBusy`; the last `seq` re-read inside it; the file rewritten
atomically). `reply_to` is the owner line's `seq`; at most one reply per
line (`AlreadyAnswered`). The body is at most 32 KiB UTF-8. A proposal
(at most 6) is `{kind, label}` plus its kind's fields and no other:
`queue {project, job}`, `answer {id, letter, note, issue}`, `open {route}`,
`engagement {title}`; `stop-after-story` and `open-studio` are refused by
name (`ProposalNotYet: <kind> lands in Story 39.7`) until Story 39.7.

Refusals end `blocked` (exit 2), each named in `reason`: `UnknownLine` (no
owner line `seq`), `ChatUnreadable`, `BodyEmpty`, `BodyTooLarge`,
`RunIdRequired`, `AlreadyAnswered`, `ProposalInvalid: <index>: <why>`,
`ProposalNotYet`, `ChatBusy`, `ChatUnwritable`, an unreadable
`--body-file` or `--proposals-file`. Nothing is appended on a refusal. A
dry run writes nothing and ends `partial`. Every result ends with the §3
status block (AD-11). Stdlib-only (NFR9); never prompts; moves no state
beyond the one reply; imports no driver and no supervisor code.
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
import inventory as inventorylib
import orchestrate
from engage import (BODY_MAX_BYTES, LABEL_MAX, Refused, _take_over_stale,
                    atomic_write_text)
# the decision lines `sweepdecisions.parse_answers` ingests (an answer note
# must hold none: it would record a decision the button's label never named)
from sweepdecisions import (ALL_LINE_RE, DEFAULT_LINE_RE, ID_LINE_RE,
                            LEADING_MENTIONS_RE)

INTENT = "tk-studio-engage"
TRACKING_REL = Path("_bmad-output") / "tracking"
CHAT_NAME = "studio-chat.jsonl"
LOCK_NAME = "studio-chat.lock"
READS_DIR = "studio-chat-reads"
CHAT_REL = "_bmad-output/tracking/studio-chat.jsonl"
LOCK_REL = "_bmad-output/tracking/studio-chat.lock"
CHAT_LOCK_STALE_S = 30.0
CHAT_LOCK_WAIT_S = 5.0
CONTEXT_LINES = 40
PROPOSALS_MAX = 6
NOTE_MAX = 2000
COUNCIL_RE = re.compile(r"\bcouncil\b", re.IGNORECASE)
NOT_YET = ("stop-after-story", "open-studio")
NOT_YET_STORY = "39.7"
JOB_RE = re.compile(r"^[a-z][a-z0-9-]*$")
QUESTION_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
LETTER_RE = re.compile(r"^[A-Z]$")
ISSUE_RE = re.compile(r"^[A-Z][A-Z0-9]+-\d+$")
ROUTE_RE = re.compile(r"^/app(/[A-Za-z0-9._~%-]+)*$")
# Each kind's own fields besides `kind` and `label` (Settled shape 3).
KIND_FIELDS = {
    "queue": ("project", "job"),
    "answer": ("id", "letter", "note", "issue"),
    "open": ("route",),
    "engagement": ("title",),
    "stop-after-story": (),
    "open-studio": (),
}


def _result(seq, mode: str, dry_run: bool) -> dict:
    return {"ok": False, "dry_run": dry_run, "mode": mode, "seq": seq,
            "notes": [], "written": []}


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

def tracking_dir(root: Path) -> Path:
    return Path(root) / TRACKING_REL


def reads_rel(seq: int) -> str:
    return f"_bmad-output/tracking/{READS_DIR}/{seq}.json"


def _parse(text: str) -> list[dict]:
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


def read_chat(root: Path) -> list[dict]:
    """Every parsed line with a finite numeric `seq` (a torn line skipped);
    no file is an empty chat. A chat the OS refuses or that is not UTF-8 is
    ChatUnreadable."""
    path = tracking_dir(root) / CHAT_NAME
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return []
    except (OSError, UnicodeDecodeError) as exc:
        raise Refused("ChatUnreadable", f"{CHAT_REL}: "
                      f"{exc.__class__.__name__}") from None
    return _parse(text)


def is_owner_line(line: dict) -> bool:
    """An owner line asks; a press line (`pressed`) queues nothing."""
    return line.get("author") == "owner" and "pressed" not in line


def owner_line(lines: list[dict], seq: int) -> dict:
    for line in lines:
        if line.get("seq") == seq and is_owner_line(line):
            return line
    raise Refused("UnknownLine", f"no owner line seq {seq} in {CHAT_REL}")


def answered(lines: list[dict], seq: int) -> bool:
    return any(line.get("author") == "planner" and line.get("reply_to") == seq
               for line in lines)


def _with_lock(root: Path, fn, wait_s=CHAT_LOCK_WAIT_S, clock=time.time,
               sleep=time.sleep):
    """Run `fn` holding `studio-chat.lock` (exclusive create; older than
    30 s it is stale and retaken; held, it is waited on up to `wait_s`,
    then ChatBusy)."""
    directory = tracking_dir(root)
    directory.mkdir(parents=True, exist_ok=True)
    lock = directory / LOCK_NAME
    deadline = clock() + wait_s
    while True:
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            try:
                if clock() - lock.stat().st_mtime > CHAT_LOCK_STALE_S:
                    _take_over_stale(lock, clock, CHAT_LOCK_STALE_S)
                    continue
            except FileNotFoundError:
                continue
            if clock() >= deadline:
                raise Refused("ChatBusy", f"{LOCK_REL} is held") from None
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


def append_reply(root: Path, reply_to: int, line: dict,
                 wait_s=CHAT_LOCK_WAIT_S, clock=time.time,
                 sleep=time.sleep) -> dict:
    """Append the reply under the lock with the next `seq` (the last
    re-read inside it), once per `reply_to`; the file is rewritten whole,
    atomically. A lock or chat file the OS refuses, or a chat that is not
    UTF-8, is ChatUnwritable and nothing is appended."""
    path = tracking_dir(root) / CHAT_NAME

    def write() -> dict:
        try:
            text = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            text = ""
        lines = _parse(text)
        owner_line(lines, reply_to)
        if answered(lines, reply_to):
            raise Refused("AlreadyAnswered", f"a reply to seq {reply_to} "
                          f"is already in {CHAT_REL}")
        last = 0
        for existing in lines:
            last = max(last, int(existing["seq"]))
        written = {"seq": last + 1, **line}
        body = text if not text or text.endswith("\n") else text + "\n"
        atomic_write_text(path, body + json.dumps(
            written, ensure_ascii=False) + "\n")
        return written

    try:
        return _with_lock(root, write, wait_s=wait_s, clock=clock,
                          sleep=sleep)
    except (OSError, UnicodeDecodeError) as exc:
        raise Refused("ChatUnwritable", f"{CHAT_REL}: "
                      f"{exc.__class__.__name__}") from None


# ------------------------------------------------------------ the proposals

def _decision_line(raw: str) -> bool:
    """A line `sweepdecisions.parse_answers` reads as a decision (its own
    normalisation: stripped, a leading bullet and leading mentions off)."""
    line = re.sub(r"^[-*]\s*", "", raw.strip())
    line = LEADING_MENTIONS_RE.sub("", line)
    return bool(ID_LINE_RE.match(line) or ALL_LINE_RE.match(line)
                or DEFAULT_LINE_RE.match(line))


def _check_fields(kind: str, proposal: dict) -> str | None:
    if kind == "queue":
        if not _non_empty(proposal["project"]):
            return "field 'project' must be a non-empty string"
        if not isinstance(proposal["job"], str) \
                or not JOB_RE.match(proposal["job"]):
            return "field 'job' must match ^[a-z][a-z0-9-]*$"
    elif kind == "answer":
        if not isinstance(proposal["id"], str) \
                or not QUESTION_ID_RE.match(proposal["id"]):
            return "field 'id' must be the question's id " \
                   "(^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$)"
        if not isinstance(proposal["letter"], str) \
                or not LETTER_RE.match(proposal["letter"]):
            return "field 'letter' must be one capital letter"
        if not isinstance(proposal["note"], str):
            return "field 'note' must be a string (possibly empty)"
        if len(proposal["note"]) > NOTE_MAX:
            return f"field 'note' exceeds {NOTE_MAX} characters"
        for raw in proposal["note"].splitlines():
            if _decision_line(raw):
                return ("field 'note' must hold no decision line "
                        "('<id>: <letter>', 'all: <letter>', 'default'): "
                        f"{raw.strip()!r}")
        if not isinstance(proposal["issue"], str) \
                or not ISSUE_RE.match(proposal["issue"]):
            return "field 'issue' must be the inbox item's key (ABC-123)"
    elif kind == "open":
        if not isinstance(proposal["route"], str) \
                or not ROUTE_RE.match(proposal["route"]):
            return "field 'route' must be a page route under /app"
    elif kind == "engagement":
        if not _non_empty(proposal["title"]):
            return "field 'title' must be a non-empty string"
        if len(proposal["title"].encode("utf-8")) > BODY_MAX_BYTES:
            return f"field 'title' exceeds {BODY_MAX_BYTES} bytes (UTF-8)"
    return None


def check_proposals(proposals) -> list[dict]:
    """The proposals checked (Settled shape 3): ProposalInvalid names the
    first bad index; a 39.7 kind is ProposalNotYet by name."""
    if not isinstance(proposals, list):
        raise Refused("ProposalInvalid", "the proposals must be a JSON array")
    if len(proposals) > PROPOSALS_MAX:
        raise Refused("ProposalInvalid", f"{PROPOSALS_MAX}: at most "
                      f"{PROPOSALS_MAX} proposals")
    out = []
    for i, proposal in enumerate(proposals):
        def bad(why: str):
            return Refused("ProposalInvalid", f"{i}: {why}")
        if not isinstance(proposal, dict):
            raise bad("not an object {kind, label, ...}")
        kind = proposal.get("kind")
        if not isinstance(kind, str):  # a list/object kind is unhashable
            raise bad(f"field 'kind' must be a string, got "
                      f"{json.dumps(kind)}")
        if kind in NOT_YET:
            raise Refused("ProposalNotYet", f"{kind} lands in Story "
                          f"{NOT_YET_STORY}")
        if kind not in KIND_FIELDS:
            raise bad(f"unknown kind {json.dumps(kind)} (allowed: "
                      f"{', '.join(k for k in KIND_FIELDS if k not in NOT_YET)})")
        allowed = ("kind", "label") + KIND_FIELDS[kind]
        extra = [k for k in proposal if k not in allowed]
        if extra:
            raise bad(f"unknown field '{extra[0]}' (allowed for {kind}: "
                      f"{', '.join(allowed)})")
        missing = [k for k in allowed if k not in proposal]
        if missing:
            raise bad(f"missing field '{missing[0]}'")
        label = proposal["label"]
        if not _non_empty(label):
            raise bad("field 'label' must be a non-empty string")
        if len(label) > LABEL_MAX:
            raise bad(f"field 'label' exceeds {LABEL_MAX} characters")
        why = _check_fields(kind, proposal)
        if why:
            raise bad(why)
        out.append({k: proposal[k] for k in allowed})
    return out


# ------------------------------------------------------------ the verbs

def routing_of(root: Path) -> dict:
    """Exactly what the orchestrator SKILL's documented command prints:
    `{"ok": true, **orchestrate.resolve(root)}` (no --role, the default
    lock), or its `{"ok": false, "error"}` (AD-11)."""
    try:
        return {"ok": True, **orchestrate.resolve(root)}
    except (orchestrate.OrchestrateError, inventorylib.InventoryError,
            configlib.ConfigError) as exc:  # the terminal's refusal shape
        return {"ok": False, "error": str(exc)}


def read_reads(root: Path, seq: int, notes: list[str]):
    path = tracking_dir(root) / READS_DIR / f"{seq}.json"
    try:
        reads = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        notes.append(f"no reads file at {reads_rel(seq)}: answer state "
                     f"questions plainly as unknown")
        return None
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        notes.append(f"the reads file {reads_rel(seq)} is unreadable "
                     f"({exc.__class__.__name__})")
        return None
    if not isinstance(reads, dict):
        notes.append(f"the reads file {reads_rel(seq)} is not an object")
        return None
    return reads


def context(project_root: Path, seq: int) -> dict:
    """The `context` mode (see the module docstring). Read-only."""
    root = Path(project_root).resolve()
    result = _result(seq, "context", False)
    try:
        lines = read_chat(root)
        line = owner_line(lines, seq)
        so_far = [entry for entry in lines if entry["seq"] <= seq]
        result["line"] = line
        result["chat"] = so_far[-CONTEXT_LINES:]
        result["reads"] = read_reads(root, seq, result["notes"])
        # routing first; the shell is presentation and never feeds it
        result["routing"] = routing_of(root)
        council = bool(COUNCIL_RE.search(str(line.get("body", ""))))
        result["voice"] = "council" if council else "plain"
        if council:
            try:
                result["shell"] = orchestrate.load_shell()
            except orchestrate.OrchestrateError as exc:
                result["notes"].append(f"the council shell did not load "
                                       f"({exc}); answer in the plain voice")
        result["not_yet"] = list(NOT_YET)
        return _finish(result, "complete", None)
    except Refused as exc:
        return _finish(result, "blocked", f"studiochat refused: {exc}")


def reply(project_root: Path, seq: int, body: str, proposals=None,
          run_id: str | None = None, dry_run: bool = False, now=None,
          wait_s=CHAT_LOCK_WAIT_S) -> dict:
    """The `reply` mode (see the module docstring)."""
    root = Path(project_root).resolve()
    result = _result(seq, "reply", dry_run)
    try:
        if not isinstance(body, str) or not body.strip():
            raise Refused("BodyEmpty", "the reply body is empty")
        if len(body.encode("utf-8")) > BODY_MAX_BYTES:
            raise Refused("BodyTooLarge", f"the reply body exceeds "
                          f"{BODY_MAX_BYTES} bytes (UTF-8)")
        if not _non_empty(run_id):
            raise Refused("RunIdRequired", "a reply names its run "
                          "(--run-id, the payload's run_id)")
        lines = read_chat(root)
        owner_line(lines, seq)
        if answered(lines, seq):
            raise Refused("AlreadyAnswered", f"a reply to seq {seq} is "
                          f"already in {CHAT_REL}")
        checked = check_proposals([] if proposals is None else proposals)
        line = {"at": now or _now(), "author": "planner", "body": body,
                "run_id": run_id.strip(), "reply_to": seq,
                "proposals": checked}
        if dry_run:
            result["line"] = {"seq": None, **line}
            result["notes"].append("dry run: the reply was not appended")
            return _finish(result, "partial", "dry run: nothing written; a "
                           "real run would append `line`")
        result["line"] = append_reply(root, seq, line, wait_s=wait_s)
        result["written"].append(CHAT_REL)
        return _finish(result, "complete", None)
    except Refused as exc:
        return _finish(result, "blocked", f"studiochat refused: {exc}")


# --------------------------------------------------------------------- CLI

def _emit(result: dict) -> int:
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 2 if result.get("status") == "blocked" else 0


def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="tk-studio-engage: the studio chat (Story 39.3)")
    sub = parser.add_subparsers(dest="command", required=True)
    ctx = sub.add_parser("context", help="the turn's context (read-only)")
    ctx.add_argument("--directory", required=True,
                     help="the served root (the payload's project_root)")
    ctx.add_argument("--seq", required=True, type=int,
                     help="the owner line's seq")
    rep = sub.add_parser("reply", help="append the reply")
    rep.add_argument("--directory", required=True,
                     help="the served root (the payload's project_root)")
    rep.add_argument("--seq", required=True, type=int,
                     help="the owner line's seq (the reply's reply_to)")
    rep.add_argument("--run-id", help="the driven run's id (the payload's "
                                      "run_id)")
    rep.add_argument("--body-file", required=True,
                     help="the reply's text, UTF-8 (never the command line)")
    rep.add_argument("--proposals-file",
                     help="a JSON array of {kind, label, ...}")
    rep.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    directory = Path(args.directory)
    if args.command == "context":
        return _emit(context(directory, args.seq))
    texts = {}
    for name in ("body_file", "proposals_file"):
        value = getattr(args, name)
        if value is None:
            continue
        try:
            texts[name] = Path(value).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            return _emit(_finish(
                _result(args.seq, "reply", args.dry_run), "blocked",
                f"studiochat refused: cannot read "
                f"--{name.replace('_', '-')}: {exc}; nothing appended"))
    proposals = None
    if "proposals_file" in texts:
        try:
            proposals = json.loads(texts["proposals_file"])
        except json.JSONDecodeError as exc:
            return _emit(_finish(
                _result(args.seq, "reply", args.dry_run), "blocked",
                f"studiochat refused: ProposalInvalid: --proposals-file is "
                f"not JSON ({exc.msg}); nothing appended"))
    return _emit(reply(directory, args.seq, texts["body_file"],
                       proposals=proposals, run_id=args.run_id,
                       dry_run=args.dry_run))


if __name__ == "__main__":
    sys.exit(main())
