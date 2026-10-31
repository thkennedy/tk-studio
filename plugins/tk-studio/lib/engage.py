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
      [--scope-file PATH | --revise-at AT]
      [--brief-file PATH --gdd-file PATH] [--dry-run]

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

Story 34.8 (user flow F9), Story 36.6 (DW-90): a game project is one whose
tracked `.tk-studio/config.yaml` `working_set` has any role's list holding
`gds` or an entry starting `gds-`, and whose `_bmad/_config/manifest.yaml`
lists the `gds` module installed (`is_game_project`; decided here only,
never re-derived by the supervisor). On a game project `scope` takes the
planner's quick-flow game brief and GDD (`--brief-file`, `--gdd-file`, the
`gds-create-game-brief` Fast path and the `gds-gdd` Express path): both
are required (`GameDocsMissing: brief | gdd`) unless `--revise-at` re-runs
a scope already published (the record carries `scope_page`): that keeps
whatever doc pages the record holds (Story 35.6: and still merges
`game: true`, so a revise of a scope published before 34.8 gains it). On
any other project
either flag is `NotAGameProject`. Each lands as
`_bmad-output/engagements/<id>/brief.md` / `gdd.md` (atomically, when it
differs) and is published beside the scope in `Engagements/ENG-NNN` as
`ENG-NNN: Game Brief` / `ENG-NNN: GDD` (the same footer and skip rule);
the record then gains `brief_page` / `gdd_page` `{id, url, version}`
(shaped like `scope_page`) and `game: true`, merged with `scope_page`.

The `quote` verb (Story 32.5, user flow F2 step 4) is the engagement's
price, the planner's turn after the scope (or by hand):

  uv run engage.py quote --directory ROOT --engagement ENG-NNN [--seed N]
      [--dry-run]

In `scoping` only (else `NotScoping`, or `EngagementClosed`). It counts the
proposed stories of `scope.md` by their headings (`scope_counts`; none, or
no `scope.md`: `NoScope`), reads the project's structured meter records
from every machine's ledger under the store's `measurements/` (deduped by
`story_key`, the last kept; a free-text `meter:` line is counted as
`unstructured`, never parsed) and resamples their per-story tokens and
dollars over the proposed story count (`quote.py`: a seeded bootstrap of
10,000 resamples, nearest-rank 50/85/95, `cap = p95 + one story at p85`;
under eight records "thin history", widened ×1.5 from the Opus 5.5 trial's
per-story dollars). Each band is `{tokens, usd, share}`, the share over
`plan.window_tokens` of the user or studio config, else "share unknown".
An unreadable `prices.json` or an unpriced route model is
`PricesUnreadable`. The record is re-read fresh and only `quote {band50,
band85, band95, cap, basis, computed_at}` and `updated` are merged into it
(`cap` a number in USD); `.tk-studio/budget-bands.yaml` gains
`epics.<EP-NNN>.usd_estimate` (the p85 dollars of each proposed epic, keyed
by the id `plan-counter.yaml` predicts) with every other byte kept. The
state does not move: the owner's `go` moves `scoping → quoted` (32.1's
`quote-present` row). An OS refusal is `QuoteUnwritable` (`written` names
what had landed).

The `closeout` verb (Story 32.8, user flow F2 steps 7 to 9) is the
engagement's delivery report, run by the supervisor's closeout pass once
the engagement's last run ended (never by the planner):

  uv run engage.py closeout --directory ROOT --engagement ENG-NNN
      --input-file PATH [--dry-run]

In `in-progress` or `partial` only (else `NotInProgress`, or
`EngagementClosed`). The input file is the supervisor's composition, a
JSON object `{run_id, outcome_hint, runs: [{run_id, job, state,
studio_run_id, cost_usd, pr}], stories: [{key, run_id, spec_status, pr,
pr_state}], epics: [{job, queued}], side_exits: [{at, to, verb, reason}],
spend {planning_usd, runs_usd}, quote, slices?}` (else
`CloseoutInputInvalid`). Story 34.8: `slices: [{story, engine, assets,
playable, contact_sheet?, report?, frames?}]` (one per slice run's story,
from its own leg's `host-verify` event, Story 35.6) adds a `## Slice verdicts` section after
`Deliverables` — one line per story, `<key> — engine <v>; assets <v>;
playable <v>`, and its contact sheet (a host path) copied beside
`closeout.md` as `<key>-contact-sheet.png`, embedded and uploaded to the
page as an attachment (an unreadable sheet is a note); with no slice the
section is absent. Story 35.6 (CAP-13): an entry's `report?` (its own leg's
`report.json`) and `frames?` (its sampled frames), host paths under the run
workspace, are read the same way and written beside `closeout.md` and
attached as `<key>-report.json` and `<key>-frame-<name>`; under the story,
after its sheet, a `| Report | Value |` table (verdict, failed, ticks, seed,
mode, moments, log errors; none for a report that is not a JSON object,
a note) and the line `Frames: [<name>](<key>-frame-<name>), …;
[report.json](<key>-report.json)`. An unreadable file is a note and is
dropped; an entry with neither renders as in 0.1.29. Each
`### <title>` of `scope.md`'s `## Deliverables` (no `scope.md`: `NoScope`)
is judged against its stories (the proposed stories naming its title,
else every proposed story; the i-th proposed epic is the i-th declared
`run-epic-N` job, its story `m` the landed key `N-m-…`): `done` when each
landed (`spec_status: done`) and its PR is `MERGED`, else `not done — `
the first of `no acceptance signal` (owner text is unchecked: the signal
line, else any line naming `acceptance signal`), `epic not run`, `story
<key> not landed`, `PR <url> not merged`. Every deliverable done is
`delivered`; else the last run `blocked` is `failed`; else `partial`.
`closeout.md` (the `##` sections `Outcome`, `Deliverables`, `Pull
requests`, `Cost per story` — `story | run | tokens | usd` from the meter
records by `story_key`, and the runs' `job-run` cost, `—` unmetered —
`Spend`, `Quote against actual` — `runs_usd` against the bands and the
cap, which are priced from story runs alone — and `Side exits`) is written
atomically
and published as `ENG-NNN: Closeout` in the scope's `Engagements/ENG-NNN`
folder (skipped when the footer hash and the recorded version match); no
Confluence binding, an absent agent-seat variable or a refused write
leaves `page: null` with a note, never a refusal. Then `closeout {path,
page, outcome, done, not_done, run_id, at}` alone is merged into a fresh
read of the record; the state does not move here (the supervisor applies
`run-ended`). A 429, a 5xx or an OS refusal ends `partial` with `retry:
true`. The result is `{status, engagement, outcome, page, written[]}`.

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
import hashlib
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
RUN_OUTCOMES = ("delivered", "partial", "failed")
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
# Story 34.8: a game project's quick-flow docs, published beside the scope
BRIEF_TITLE = "{engagement}: Game Brief"
GDD_TITLE = "{engagement}: GDD"
GAME_DOCS = (("brief", "brief.md", BRIEF_TITLE, "brief_page"),
             ("gdd", "gdd.md", GDD_TITLE, "gdd_page"))
GDS_RESOURCE = "gds"
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


def doc_rel(engagement: str, name: str) -> str:
    return f"_bmad-output/engagements/{engagement}/{name}"


def is_game_project(root: Path) -> bool:
    """Story 34.8: the tracked `.tk-studio/config.yaml` `working_set` has a
    role's list holding `gds` or an entry starting `gds-` (never the local
    overlay or the user tier). Story 36.6 (DW-90): and the installed-module
    manifest lists `gds`, so the plugin-shipped `gds-engine-godot-4` alone is
    not enough. An absent or unreadable config or manifest is not a game
    project."""
    import miniyaml
    from inventory import MANIFEST_REL, read_manifest_modules
    path = Path(root) / ".tk-studio" / configlib.TRACKED_NAME
    try:
        doc = miniyaml.load(path) if path.is_file() else None
    except (OSError, UnicodeDecodeError, miniyaml.MiniYamlError):
        return False
    sets = doc.get("working_set") if isinstance(doc, dict) else None
    if not isinstance(sets, dict):
        return False
    if not any(isinstance(entry, str) and (entry == GDS_RESOURCE
                                           or entry.startswith("gds-"))
               for names in sets.values() if isinstance(names, list)
               for entry in names):
        return False
    try:
        modules = read_manifest_modules(Path(root) / MANIFEST_REL)
    except (OSError, UnicodeDecodeError):
        return False
    return any(module.get("name") == GDS_RESOURCE for module in modules)


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


def _merge_record(root: Path, engagement: str, changes,
                  void_quote: bool = False) -> dict:
    """Re-read the record fresh and merge only `changes` (the
    `chatSpendPass` rule), written atomically as JSON text. `changes` may
    be a callable of the fresh record (a value derived from that read).
    `void_quote`: a non-null `quote` is merged as null too (the scope it
    priced was replaced). Answers the changes merged."""
    record = read_record(root, engagement)
    if callable(changes):
        changes = changes(record)
    changes = dict(changes)
    if void_quote and record.get("quote") is not None:
        changes["quote"] = None
    record.update(changes)
    atomic_write_text(engagement_dir(root, engagement) / "engagement.yaml",
                      json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    return changes


class _Transient(Exception):
    """A 429 or 5xx, or the network: `partial`, `retry: true`."""


def _page_url(site: str | None, webui: str | None) -> str | None:
    site = re.sub(r"^https?://", "", site or "").strip("/")
    if site and webui:
        return f"https://{site}/wiki{webui}"
    return webui


def _publish_scope(root: Path, engagement: str, text: str, space_id: str,
                   site: str | None, transport, sleep,
                   recorded_version=None, title: str | None = None,
                   rel: str | None = None,
                   attachments: list | None = None) -> dict:
    """The page `ENG-NNN: Scope of Work` in `Engagements/ENG-NNN` (Settled
    shape 2): `{id, url, version, action}`. `skipped` only when the footer
    hash matches and the page is still at `recorded_version` (or none is
    recorded): an owner's newer version is overwritten at version + 1
    (local wins), never adopted unmirrored. Story 32.8: `title` and `rel`
    name another page of the same folder (`ENG-NNN: Closeout` from
    `closeout.md`); default the scope's. Story 34.8: `attachments`
    `[(filename, bytes)]` are uploaded to the page (each skipped when the
    page already holds it with the same `sha256:` comment) and count in the
    footer's content hash; a refused upload is named in the answer's
    `attachment_errors`, never a refusal of the page."""
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
        title = title or SCOPE_TITLE.format(engagement=engagement)
        rel = rel or scope_rel(engagement)
        storage, _images = mdstorage.convert(text, rel)
        uploads = [(name, content, hashlib.sha256(content).hexdigest())
                   for name, content in attachments or []]
        digest = plansync.page_hash(title, storage, [h for _, _, h in uploads])

        def attach(page: dict) -> dict:
            if not uploads:
                return page
            remote = {a.get("title"): a for a in
                      confluence.list_attachments(client, page["id"])}
            errors = []
            for name, content, sha in uploads:
                comment = f"sha256:{sha}"
                if comment in str((remote.get(name) or {}).get("comment")
                                  or ""):
                    continue
                ok, detail = confluence.upload_attachment(
                    client, page["id"], name, content, comment)
                if not ok:
                    errors.append(f"{name}: {detail}")
            return {**page, "attachment_errors": errors} if errors else page
        body = storage + plansync.page_footer(
            rel, plansync._provenance(root, rel), digest)
        page_id = confluence.find_page(client, folder, title)
        if page_id is not None:
            page = confluence.get_page(client, page_id)
            hashes = plansync.FOOTER_HASH_RE.findall(confluence.page_body(page))
            remote = confluence.page_version(page)
            if hashes and hashes[-1] == digest and (
                    recorded_version is None or remote == recorded_version):
                return attach({"id": page_id,
                               "url": _page_url(site, plansync._webui(page)),
                               "version": confluence.page_version(page),
                               "action": "skipped"})
            put, detail = confluence.update_page(
                client, page_id, title, body,
                confluence.page_version(page) + 1)
            if put is None:
                raise refused(f"page {title} update refused", detail)
            webui = plansync._webui(put) or plansync._webui(page)
            version = confluence.page_version(put) \
                or confluence.page_version(page) + 1
            return attach({"id": page_id, "url": _page_url(site, webui),
                           "version": version, "action": "updated"})
        made, detail = confluence.create_page(client, space_id, folder, title,
                                              body)
        if made is None:
            raise refused(f"page {title} create refused", detail)
        return attach({"id": str(made["id"]),
                       "url": _page_url(site, plansync._webui(made)),
                       "version": confluence.page_version(made) or 1,
                       "action": "created"})
    except confluence.RateLimited as exc:
        raise _Transient(str(exc)) from None
    except confluence.ConfluenceError as exc:
        if SCOPE_TRANSIENT_RE.search(str(exc)):
            raise _Transient(str(exc)) from None
        raise Refused("PublishRefused", str(exc)) from None


def _write_and_publish(root: Path, engagement: str, text: str, path: Path,
                       space_id, site, result: dict, now, transport,
                       sleep) -> dict:
    """`scope`'s write and publish, under the scope lock."""
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
    rewrote = current != text
    record_rel = f"_bmad-output/engagements/{engagement}/" \
                 f"engagement.yaml"
    if rewrote and fresh.get("quote") is not None:
        # void first: a quote of the old scope is merged null before
        # scope.md is replaced, so no later failure can leave it
        # standing beside the new scope (`go` would pass
        # `quote-present` at the old story count)
        try:
            _merge_record(root, engagement,
                          {"updated": now or _now()},
                          void_quote=True)
        except OSError as exc:
            raise Refused("ScopeUnwritable", f"{record_rel}: "
                          f"{exc.__class__.__name__}") from None
        result["written"].append(record_rel)
        result["notes"].append("scope.md replaced: the quote is "
                               "voided")
    if rewrote:
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
    try:
        merged = _merge_record(root, engagement, {
            "scope_page": {"id": page["id"], "url": page["url"],
                           "version": page["version"]},
            "updated": now or _now()}, void_quote=rewrote)
        # a belt: the quote was voided before scope.md was replaced
        if "quote" in merged and "scope.md replaced: the quote is " \
                "voided" not in result["notes"]:
            result["notes"].append("scope.md replaced: the quote is "
                                   "voided")
    except OSError as exc:
        # scope.md (in `written`) and the page are already out; only
        # the record's scope_page is behind
        result["notes"].append(f"page {page['id']} published at "
                               f"version {page['version']}; "
                               f"scope_page unchanged")
        raise Refused("ScopeUnwritable", f"{record_rel}: "
                      f"{exc.__class__.__name__}") from None
    if record_rel not in result["written"]:
        result["written"].append(record_rel)
    return page


def _write_and_publish_all(root: Path, engagement: str, text: str, path: Path,
                           space_id, site, result: dict, now, transport, sleep,
                           game: bool, docs: dict) -> dict:
    """The scope (`_write_and_publish`), then a game project's docs (Story
    34.8), under the scope lock."""
    page = _write_and_publish(root, engagement, text, path, space_id, site,
                              result, now, transport, sleep)
    record_rel = f"_bmad-output/engagements/{engagement}/" \
                 f"engagement.yaml"
    if not game:
        return page
    pages = {}
    for kind, name, title, key in GAME_DOCS:
        body = docs[kind]
        if body is None:
            continue  # a revise re-run: the published doc stands
        rel = doc_rel(engagement, name)
        doc_path = engagement_dir(root, engagement) / name
        try:
            held = doc_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            held = None
        if held != body:
            try:
                atomic_write_text(doc_path, body)
            except OSError as exc:
                raise Refused("ScopeUnwritable", f"{rel}: "
                              f"{exc.__class__.__name__}") from None
            result["written"].append(rel)
        prior = read_record(root, engagement).get(key)
        try:
            version = int(prior["version"]) \
                if isinstance(prior, dict) \
                and prior.get("version") is not None else None
        except (TypeError, ValueError):
            version = None
        pages[key] = _publish_scope(
            root, engagement, body, space_id, site, transport, sleep,
            version, title=title.format(engagement=engagement),
            rel=rel)
    if not pages:
        # no game doc published by this call (a flagless revise of a
        # pre-34.8 scope). Story 35.6 (hole 92): the project is a
        # game project, so the record still gains `game: true` (its
        # doc pages, if any, kept as they are)
        try:
            _merge_record(root, engagement,
                          {"game": True, "updated": now or _now()})
        except OSError as exc:
            raise Refused("ScopeUnwritable", f"{record_rel}: "
                          f"{exc.__class__.__name__}") from None
        return page
    changes = {key: {"id": p["id"], "url": p["url"],
                     "version": p["version"]}
               for key, p in pages.items()}
    changes.update(game=True, updated=now or _now())
    try:
        _merge_record(root, engagement, changes)
    except OSError as exc:
        raise Refused("ScopeUnwritable", f"{record_rel}: "
                      f"{exc.__class__.__name__}") from None
    result.update({key: p for key, p in pages.items()})
    return page


def scope(project_root: Path, engagement: str, text: str | None = None,
          revise_at: str | None = None, dry_run: bool = False, now=None,
          transport=None, sleep=None, lock_wait_s=SCOPE_LOCK_WAIT_S,
          brief: str | None = None, gdd: str | None = None) -> dict:
    """The `scope` verb (see the module docstring): `text` is the planner's
    scope (checked); `revise_at` names the `revise` input whose body is
    taken verbatim. Story 34.8: `brief` and `gdd` are a game project's
    quick-flow docs, published beside the scope."""
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
        # Story 34.8: a game project's docs (decided here, from the tracked
        # working set only)
        game = is_game_project(root)
        docs = {"brief": brief, "gdd": gdd}
        if not game:
            given = [k for k, v in docs.items() if v is not None]
            if given:
                raise Refused("NotAGameProject", f"--{given[0]}-file given, "
                              f"but no working_set role carries gds")
        else:
            # a revise re-run of a scope already published (the supervisor's,
            # with no doc flags) keeps whatever pages the record holds — a
            # record scoped before 34.8 has none; the first scope needs both
            revising = revise_at is not None \
                and isinstance(record.get("scope_page"), dict)
            for kind, _name, _title, key in GAME_DOCS:
                if docs[kind] is None and not revising:
                    raise Refused("GameDocsMissing", kind)
                if docs[kind] is not None and not docs[kind].strip():
                    raise Refused("GameDocsMissing", f"{kind} (empty)")
        result["game"] = game
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

        try:
            result["page"] = _with_scope_lock(
                root, engagement,
                lambda: _write_and_publish_all(
                    root, engagement, text, path, space_id, site, result, now,
                    transport, sleep, game, docs),
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
    record_rel = f"_bmad-output/engagements/{engagement}/engagement.yaml"
    landed: list[str] = []  # what replace() wrote, kept on a later OSError

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
        try:
            on_disk = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            on_disk = None
        # as `scope`: only a scope.md actually replaced voids the quote (a
        # version bump whose Markdown is unchanged keeps it)
        rewrote = on_disk != out["markdown"]
        if rewrote and fresh.get("quote") is not None:
            # void first: a quote of the old scope is merged null before
            # scope.md is replaced (the owner re-quotes before `go`); a
            # failed void leaves scope.md untouched (an OSError: retry)
            _merge_record(root, engagement, {"updated": now or _now()},
                          void_quote=True)
            landed.append(record_rel)
        if rewrote:
            atomic_write_text(path, out["markdown"])
            landed.append(scope_rel(engagement))
        merged["version"] = version
        _merge_record(root, engagement, {"scope_page": merged,
                                         "updated": now or _now()},
                      void_quote=rewrote)
        if record_rel not in landed:
            landed.append(record_rel)
        return True

    try:
        applied = _with_scope_lock(root, engagement, replace,
                                   wait_s=SCOPE_LOCK_WAIT_S)
    except Refused as exc:
        out["retry"] = exc.name == "ScopeBusy"
        out["note"] = f"scope edit of {engagement} not applied: {exc}"
        out["written"] = list(landed)
        return out
    except OSError as exc:
        out["retry"] = True
        out["note"] = (f"scope edit of {engagement} not applied: "
                       f"{exc.__class__.__name__}")
        # a void (or scope.md) that landed before the failure is named
        out["written"] = list(landed)
        return out
    if not applied:
        return out  # already at or past this version: nothing to apply
    out["applied"] = True
    out["written"] = [rel for rel in (scope_rel(engagement), record_rel)
                      if rel in landed]
    return out


# ------------------------------------------------------------ the quote (32.5)

def scope_counts(text: str) -> dict:
    """`{epics: [{k, title, stories}], stories}` of the scope's `## Proposed
    epics and stories`, from the headings only (`### Epic <k>: …`, `####
    Story <k>.<m>: …`), so an owner-edited `scope.md` still counts."""
    body = next((lines for title, lines in parse_scope(text)["sections"]
                 if title.casefold() == "proposed epics and stories"), None)
    epics, total = [], 0
    for etitle, elines in _subsections(body or [], 3):
        m = EPIC_RE.match(etitle)
        if not m:
            continue
        stories = sum(1 for stitle, _ in _subsections(elines, 4)
                      if STORY_RE.match(stitle))
        epics.append({"k": int(m.group(1)),
                      "title": etitle.split(":", 1)[1].strip(),
                      "stories": stories})
        total += stories
    return {"epics": epics, "stories": total}


def plan_window() -> int | None:
    """`plan.window_tokens` from the user and studio scopes (never the
    project's), a positive int; else None ("share unknown")."""
    try:
        value, _ = configlib.resolve("plan.window_tokens")
    except configlib.ConfigError:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    return value


def _next_epic(root: Path) -> int | None:
    """`next.epic` of `.tk-studio/plan-counter.yaml` (1 with no counter),
    or None when the counter is unreadable."""
    import plansync
    try:
        return int(plansync.load_counter(root)["next"]["epic"])
    except (plansync.PlanSyncError, OSError, UnicodeDecodeError):
        return None


def quote(project_root: Path, engagement: str, seed: int | None = None,
          dry_run: bool = False, now=None, prices_path: Path | None = None,
          measurements: Path | None = None,
          lock_wait_s=SCOPE_LOCK_WAIT_S) -> dict:
    """The `quote` verb (Story 32.5 Settled shape 2): the seeded 50/85/95
    band over the scope's proposed stories, merged as `quote` (and
    `updated`) into a fresh read of the record, and `epics.<EP-NNN>.
    usd_estimate` in `.tk-studio/budget-bands.yaml`. The state stays
    `scoping`: the owner's `go` moves it to `quoted` (Settled shape 3)."""
    import consolidate
    import ledger
    import meter
    import quote as quotelib
    root = Path(project_root).resolve()
    result = _result(engagement, "quote", dry_run)
    result["quote"] = None
    record_rel = f"_bmad-output/engagements/{engagement}/engagement.yaml"
    try:
        if not ENGAGEMENT_ID_RE.match(engagement or ""):
            raise Refused("BadEngagement", f"--engagement {engagement!r} is "
                          f"not an engagement id (ENG-001)")
        if seed is not None and not quotelib.valid_seed(seed):
            raise Refused("BadSeed", f"--seed {seed!r} is not an integer in "
                          f"0 <= seed < 2**53")
        record = read_record(root, engagement)
        state = record.get("state")
        if state in TERMINAL_STATES:
            raise Refused("EngagementClosed", f"{engagement} is {state}; "
                          f"nothing is written")
        if state != "scoping":
            raise Refused("NotScoping", f"{engagement} is {state}; the quote "
                          f"is written only in scoping")

        def price() -> dict:
            # a real run holds scope.lock from the read of scope.md through
            # the merge: a concurrent `scope` or sync-back cannot replace
            # the scope between the count and the quote landing
            nonlocal seed
            scoped = read_scope(root, engagement)
            if scoped is None:
                raise Refused("NoScope", f"no {scope_rel(engagement)} (run "
                              f"`engage.py scope` first)")
            counts = scope_counts(scoped["text"])
            ks = [e["k"] for e in counts["epics"]]
            dups = sorted({k for k in ks if ks.count(k) > 1})
            if dups:
                raise Refused("NoScope", f"{scope_rel(engagement)} repeats "
                              "epic "
                              + ", ".join(f"### Epic {k}" for k in dups)
                              + " (each proposed epic needs its own number)")
            # the ids are EP-<next + k - 1>: only 1..m in order keys each
            # proposed epic to a fresh id (an `### Epic 0` would key to a
            # live epic, a gap to an id no epic takes)
            if ks != list(range(1, len(ks) + 1)):
                raise Refused("NoScope", f"{scope_rel(engagement)} numbers "
                              "its epics "
                              + ", ".join(f"### Epic {k}" for k in ks)
                              + f" (the proposed epics are numbered 1 to "
                              f"{len(ks)} in order)")
            n = counts["stories"]
            if n < 1:
                raise Refused("NoScope", f"{scope_rel(engagement)} proposes "
                              f"no story (#### Story <k>.<m>: <title>)")
            try:
                prices = meter.load_prices(prices_path)
            except meter.MeterError as exc:
                raise Refused("PricesUnreadable", str(exc)) from None
            project = configlib.project_key(root)
            try:
                mdir = Path(measurements) if measurements is not None \
                    else ledger.store_root() / "measurements"
                events = consolidate.read_events(mdir)[0] \
                    if mdir.is_dir() else []
            except (OSError, UnicodeDecodeError) as exc:
                raise Refused("QuoteUnwritable", f"measurements: "
                              f"{exc.__class__.__name__}") from None
            hist = quotelib.history(events, project)
            samples = hist["samples"]
            route = meter.route(root)
            if route is None:
                route = next((s["route"] for s in reversed(samples)
                              if s["route"]), None)
                if route is not None:  # the sample's route is unchecked data
                    route = {leg: m for leg, m in route.items()
                             if isinstance(m, str)} or None
            unpriced = sorted({m for m in (route or {}).values()
                               if meter._rates(prices, m) is None})
            if unpriced:
                raise Refused("PricesUnreadable", "no price for the route "
                              "model(s) " + ", ".join(unpriced)
                              + " in the price "
                              f"table dated {prices.get('date')}")
            window = plan_window()
            if seed is None:
                seed = quotelib.default_seed(engagement, n)
            nxt = _next_epic(root)
            epics = [{**e, "ep_id": None if nxt is None
                      else f"EP-{nxt + e['k'] - 1:03d}"}
                     for e in counts["epics"]]
            figures = quotelib.compute(samples, n, epics, seed, window)
            def planning_of(rec: dict):
                spend = rec.get("spend") if isinstance(rec.get("spend"),
                                                       dict) else {}
                usd = spend.get("planning_usd")
                return usd if isinstance(usd, (int, float)) \
                    and not isinstance(usd, bool) else 0

            planning = planning_of(record)
            basis = {
                "method": "bootstrap", "resamples": quotelib.RESAMPLES,
                "seed": seed, "stories": n, "epics": epics,
                "history": {"n": figures["history_n"],
                            "unstructured": hist["unstructured"],
                            "project": project},
                "kind": "story", "thin": figures["thin"],
                "at_cap": quotelib.AT_CAP, "route": route,
                "autonomy": list(AUTONOMY_LEVELS),
                "planning_usd": planning, "scoping_billable": planning > 0,
                "prices_date": prices["date"], "window_tokens": window,
                "cap_tokens": figures["cap_tokens"],
                "notes": list(figures["notes"]),
            }
            if figures["thin"]:
                basis["widen"] = quotelib.WIDEN
                basis["prior"] = quotelib.PRIOR_SOURCE
            q = {"band50": figures["band50"], "band85": figures["band85"],
                 "band95": figures["band95"], "cap": figures["cap"],
                 "basis": basis, "computed_at": now or _now()}
            result["quote"] = q
            result["notes"].extend(figures["notes"])
            if window is None:
                result["notes"].append("share unknown: no plan.window_tokens")
            estimates = {e["ep_id"]: figures["epic_usd"][e["k"]] for e in epics
                         if e["ep_id"] and e["k"] in figures["epic_usd"]}
            if nxt is None:
                result["notes"].append(".tk-studio/plan-counter.yaml is "
                                       "unreadable: no epics band written")
            bands_path = root / quotelib.BANDS_REL
            bands_rel = quotelib.BANDS_REL.as_posix()
            try:
                current = bands_path.read_text(encoding="utf-8") \
                    if bands_path.is_file() else None
            except (OSError, UnicodeDecodeError) as exc:
                raise Refused("QuoteUnwritable", f"{bands_rel}: "
                              f"{exc.__class__.__name__}") from None
            try:
                bands_text = quotelib.epic_bands_text(current, estimates) \
                    if estimates else None
            except quotelib.QuoteError as exc:
                raise Refused("QuoteUnwritable", str(exc)) from None
            result["bands"] = estimates
            if dry_run:
                result["notes"].append("dry run: the quote was not merged and "
                                       "the bands not written")
                return _finish(result, "partial", "dry run: nothing "
                               "written; a real run would merge `quote` and "
                               "write the bands")
            fresh = read_record(root, engagement)  # the state may have moved
            if fresh.get("state") in TERMINAL_STATES:
                raise Refused("EngagementClosed", f"{engagement} is "
                              f"{fresh.get('state')}; nothing is written")
            if fresh.get("state") != "scoping":
                raise Refused("NotScoping", f"{engagement} is "
                              f"{fresh.get('state')}; the quote is written "
                              f"only "
                              f"in scoping")
            def with_fresh_spend(rec: dict) -> dict:
                # the planning spend of the read the merge writes over (a
                # concurrent chatSpendPass may have moved it since)
                fresh_planning = planning_of(rec)
                q["basis"]["planning_usd"] = fresh_planning
                q["basis"]["scoping_billable"] = fresh_planning > 0
                return {"quote": q, "updated": now or _now()}

            try:
                _merge_record(root, engagement, with_fresh_spend)
            except OSError as exc:
                raise Refused("QuoteUnwritable", f"{record_rel}: "
                              f"{exc.__class__.__name__}") from None
            result["written"].append(record_rel)
            if bands_text is not None and bands_text != current:
                try:
                    bands_path.parent.mkdir(parents=True, exist_ok=True)
                    atomic_write_text(bands_path, bands_text)
                except OSError as exc:
                    raise Refused("QuoteUnwritable", f"{bands_rel}: "
                                  f"{exc.__class__.__name__}") from None
                result["written"].append(bands_rel)
            return _finish(result, "complete", None)

        if dry_run:
            return price()
        try:
            return _with_scope_lock(root, engagement, price,
                                    wait_s=lock_wait_s)
        except Refused as exc:
            if exc.name != "ScopeBusy":
                raise
            raise Refused("QuoteUnwritable", f"_bmad-output/engagements/"
                          f"{engagement}/scope.lock is held") from None
        except OSError as exc:  # the lock itself refused by the OS
            raise Refused("QuoteUnwritable", f"scope.lock: "
                          f"{exc.__class__.__name__}") from None
    except Refused as exc:
        return _finish(result, "blocked", f"engage refused: {exc}")


# ------------------------------------------------------------ the closeout (32.8)

CLOSEOUT_TITLE = "{engagement}: Closeout"
CLOSEOUT_STATES = ("in-progress", "partial")
SIGNAL_WORDS = "acceptance signal"
UNMETERED = "—"
LIST_FIELDS = ("runs", "stories", "epics", "side_exits")


def closeout_rel(engagement: str) -> str:
    return f"_bmad-output/engagements/{engagement}/closeout.md"


def _atomic_write_bytes(path: Path, content: bytes) -> None:
    """`atomic_write_text`'s discipline for bytes (a contact sheet)."""
    import tempfile
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name,
                               suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _file_key(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "-", str(text))


def sheet_name(story: str) -> str:
    """Story 34.8: a slice's contact sheet beside `closeout.md` (and its
    attachment's filename on the page)."""
    return _file_key(story) + "-contact-sheet.png"


def report_name(story: str) -> str:
    """Story 35.6: a slice leg's `report.json` beside `closeout.md` (and its
    attachment's filename on the page)."""
    return _file_key(story) + "-report.json"


def frame_name(story: str, frame: str) -> str:
    """Story 35.6: a slice leg's sampled frame beside `closeout.md`,
    `<key>-frame-<name>` (`<name>` the frame's basename)."""
    return _file_key(story) + "-frame-" + _frame_base(frame)


def _frame_base(frame: str) -> str:
    """A frame path's basename (either separator), file-safe."""
    return _file_key(re.split(r"[\\/]", str(frame))[-1])


def _signal_of(lines: list[str]) -> str | None:
    """A deliverable's acceptance signal: the `SIGNAL_RE` line, else (owner
    text is unchecked) the first line naming `acceptance signal` in any case,
    its text after the words (or the next non-empty line); None when no
    line names one."""
    for line in lines:
        m = SIGNAL_RE.match(line)
        if m and m.group(1).strip():
            return m.group(1).strip()
    for n, line in enumerate(lines):
        at = line.casefold().find(SIGNAL_WORDS)
        if at < 0:
            continue
        rest = re.sub(r"^[\s*_:\-–—]+", "", line[at + len(SIGNAL_WORDS):])
        rest = rest.strip()
        if rest:
            return rest
        following = next((x.strip() for x in lines[n + 1:] if x.strip()),
                         "")
        return following or None
    return None


def closeout_deliverables(text: str) -> list[dict]:
    """`[{title, signal}]` of the scope's `## Deliverables` `### <title>`
    items (Settled shape 3); [] when the section is absent."""
    body = next((lines for title, lines in parse_scope(text)["sections"]
                 if title.casefold() == "deliverables"), None)
    return [{"title": title, "signal": _signal_of(lines)}
            for title, lines in _subsections(body or [], 3)]


def _proposed_stories(text: str) -> list[dict]:
    """The proposed epics that hold a story, in the scope's order (the
    approve pass's order): `[{k, stories: [{m, title, body}]}]`."""
    body = next((lines for title, lines in parse_scope(text)["sections"]
                 if title.casefold() == "proposed epics and stories"), None)
    epics = []
    for etitle, elines in _subsections(body or [], 3):
        m = EPIC_RE.match(etitle)
        if not m:
            continue
        stories = []
        for stitle, slines in _subsections(elines, 4):
            sm = STORY_RE.match(stitle)
            if sm:
                stories.append({"m": int(sm.group(2)),
                                "title": stitle.split(":", 1)[1].strip(),
                                "body": "\n".join(slines)})
        if stories:
            epics.append({"k": int(m.group(1)), "stories": stories})
    return epics


def _check_closeout_input(data) -> dict:
    """The supervisor's composition (Settled shape 2), checked; raises
    `CloseoutInputInvalid` naming what is wrong."""
    def bad(what: str):
        return Refused("CloseoutInputInvalid", what)
    if not isinstance(data, dict):
        raise bad("the input is not a JSON object")
    if not _non_empty(data.get("run_id")):
        raise bad("'run_id' must be a non-empty string")
    hint = data.get("outcome_hint")
    if hint is not None and hint not in RUN_OUTCOMES:
        raise bad(f"'outcome_hint' must be one of {', '.join(RUN_OUTCOMES)}")
    for key in LIST_FIELDS:
        value = data.get(key, [])
        if not isinstance(value, list) or not all(isinstance(x, dict)
                                                  for x in value):
            raise bad(f"'{key}' must be a list of objects")
    for n, story in enumerate(data.get("stories") or []):
        if not _non_empty(story.get("key")):
            raise bad(f"stories[{n}] has no key")
    for n, epic in enumerate(data.get("epics") or []):
        if not _non_empty(epic.get("job")):
            raise bad(f"epics[{n}] has no job")
    slices = data.get("slices", [])
    if not isinstance(slices, list) or not all(isinstance(x, dict)
                                               for x in slices):
        raise bad("'slices' must be a list of objects")
    for n, entry in enumerate(slices):
        if not _non_empty(entry.get("story")):
            raise bad(f"slices[{n}] has no story")
        for field in ("engine", "assets", "playable"):
            if not _non_empty(entry.get(field)):
                raise bad(f"slices[{n}] {field} must be a non-empty string")
        sheet = entry.get("contact_sheet")
        if sheet is not None and not _non_empty(sheet):
            raise bad(f"slices[{n}] contact_sheet must be a non-empty "
                      f"string or absent")
        report = entry.get("report")
        if report is not None and not _non_empty(report):
            raise bad(f"slices[{n}] report must be a non-empty string or "
                      f"absent")
        frames = entry.get("frames")
        if frames is not None and (not isinstance(frames, list) or not all(
                _non_empty(f) for f in frames)):
            raise bad(f"slices[{n}] frames must be a list of non-empty "
                      f"strings or absent")
    for key in ("spend", "quote"):
        if data.get(key) is not None and not isinstance(data.get(key), dict):
            raise bad(f"'{key}' must be an object or null")
    return data


def _num(value) -> float | None:
    return float(value) if isinstance(value, (int, float)) \
        and not isinstance(value, bool) and math.isfinite(value) else None


def _usd(value) -> str:
    n = _num(value)
    return UNMETERED if n is None else f"${n:,.2f}"


def _cell(value) -> str:
    text = str(value) if value not in (None, "") else UNMETERED
    return text.replace("|", "\\|").replace("\n", " ")


def closeout_verdicts(text: str, data: dict) -> list[dict]:
    """Each deliverable's verdict (Settled shape 3): `[{title, signal,
    done, why, stories: [key], prs: [url]}]`. A deliverable's stories are
    the proposed stories naming its title (case-insensitive), else every
    proposed story; the i-th proposed epic is the i-th declared job
    (`run-epic-N`), its story `m` the landed key `N-m-…`. `done` when each
    landed (`spec_status: done`) and its PR is `MERGED`; else the first
    why of `no acceptance signal`, `epic not run`, `story <key> not
    landed`, `PR <url> not merged`."""
    epics = data.get("epics") or []
    landed = data.get("stories") or []
    proposed = _proposed_stories(text)
    members_all = []
    for i, epic in enumerate(proposed):
        job = epics[i] if i < len(epics) else None
        m = re.search(r"(\d+)$", str((job or {}).get("job") or ""))
        n = int(m.group(1)) if m else None
        queued = bool(job and job.get("queued") is True)
        for story in epic["stories"]:
            entry = None
            if n is not None:
                key_re = re.compile(rf"^{n}-{story['m']}(?:-|$)")
                hits = [s for s in landed if key_re.match(str(s["key"]))]
                entry = next((s for s in reversed(hits)
                              if s.get("spec_status") == "done"),
                             hits[-1] if hits else None)
            shown = entry["key"] if entry else (
                f"{n}-{story['m']}" if n is not None
                else f"{epic['k']}.{story['m']}")
            members_all.append({"title": story["title"],
                                "body": story["body"], "queued": queued,
                                "entry": entry, "key": shown})
    out = []
    for d in closeout_deliverables(text):
        folded = d["title"].casefold()
        members = [s for s in members_all
                   if folded in s["title"].casefold()
                   or folded in s["body"].casefold()] or members_all
        if not members_all:
            members = [{"queued": True, "entry": s, "key": s["key"]}
                       for s in landed]
        prs = []
        for s in members:
            pr = (s["entry"] or {}).get("pr")
            if _non_empty(pr) and pr not in prs:
                prs.append(pr)
        why = None
        if not d["signal"]:
            why = "no acceptance signal"
        elif not members or any(not s["queued"] for s in members):
            why = "epic not run"
        else:
            for s in members:
                if (s["entry"] or {}).get("spec_status") != "done":
                    why = f"story {s['key']} not landed"
                    break
            if why is None:
                for s in members:
                    state = str(s["entry"].get("pr_state") or "").upper()
                    if state != "MERGED":
                        why = (f"PR {s['entry'].get('pr') or 'none'} not "
                               f"merged")
                        break
        out.append({"title": d["title"], "signal": d["signal"],
                    "done": why is None, "why": why,
                    "stories": [s["key"] for s in members], "prs": prs})
    return out


def closeout_outcome(verdicts: list[dict], data: dict) -> str:
    """Settled shape 4: every deliverable done → `delivered`; else the last
    run's queue state `blocked` → `failed`; else `partial`."""
    if verdicts and all(v["done"] for v in verdicts):
        return "delivered"
    last = next((r for r in data.get("runs") or []
                 if r.get("run_id") == data.get("run_id")), None)
    if (last or {}).get("state") == "blocked" \
            or (last is None and data.get("outcome_hint") == "failed"):
        return "failed"
    return "partial"


def _report_value(value) -> str:
    text = str(value) if value not in (None, "") else "—"
    return text.replace("|", "\\|").replace("\n", " ")


def report_table(report: dict) -> list[str]:
    """Story 35.6 (CAP-13): a slice leg's `report.json` as the two-column
    `| Report | Value |` table: verdict, failed, ticks, seed, mode, moments
    and log errors."""
    failed = report.get("failed")
    failed = failed if isinstance(failed, dict) else {}
    invariant, detail = failed.get("invariant"), failed.get("detail")
    failed_text = f"{invariant or '?'}: {detail}" if detail \
        else (invariant or None)
    run, total = report.get("ticks_run"), report.get("ticks")
    ticks = None if run is None and total is None else \
        f"{'—' if run is None else run}/{'—' if total is None else total}"
    moments = report.get("moments")
    named = [f"{m.get('name')}@{m.get('tick')}" for m in moments
             if isinstance(m, dict)] if isinstance(moments, list) else []
    errors = report.get("log_errors")
    rows = [("verdict", report.get("verdict")), ("failed", failed_text),
            ("ticks", ticks), ("seed", report.get("seed")),
            ("mode", report.get("mode")),
            ("moments", ", ".join(named) or None),
            ("log errors", len(errors) if isinstance(errors, list) else 0)]
    return ["| Report | Value |", "| --- | --- |"] + [
        f"| {name} | {_report_value(value)} |" for name, value in rows]


def render_closeout(engagement: str, record: dict, data: dict,
                    verdicts: list[dict], outcome: str,
                    meter: dict | None = None,
                    reports: dict | None = None) -> str:
    """`closeout.md` (Settled shape 5): the `##` sections `Outcome`,
    `Deliverables`, `Pull requests`, `Cost per story`, `Spend`, `Quote
    against actual` and `Side exits`; Story 34.8: `Slice verdicts` after
    `Deliverables` when `data` carries a slice. Story 35.6: `reports` maps
    a slice's story to its parsed `report.json` (the verdict table)."""
    meter = meter or {}
    reports = reports or {}
    runs = data.get("runs") or []
    stories = data.get("stories") or []
    done = sum(1 for v in verdicts if v["done"])
    last = next((r for r in runs if r.get("run_id") == data["run_id"]), {})
    out = [f"# {engagement}: Closeout", ""]
    out += ["## Outcome", "",
            f"- Outcome: {outcome}",
            f"- Last run: {data['run_id']} "
            f"({last.get('state') or 'unknown'})",
            f"- Deliverables done: {done} of {len(verdicts)}", ""]
    out += ["## Deliverables", ""]
    if not verdicts:
        out += ["No deliverable (### <title>) in the scope's "
                "## Deliverables.", ""]
    for v in verdicts:
        out += [f"### {v['title']}", "",
                f"Acceptance signal: {v['signal'] or 'none'}", "",
                "Verdict: " + ("done" if v["done"]
                               else f"not done — {v['why']}"), ""]
        out += [f"- Story: {key}" for key in v["stories"]]
        out += [f"- PR: {pr}" for pr in v["prs"]]
        if v["stories"] or v["prs"]:
            out.append("")
    slices = data.get("slices") or []
    if slices:
        # Story 34.8: the slice's verdicts per story, each contact sheet
        # embedded (the file beside closeout.md, an attachment on the page)
        out += ["## Slice verdicts", ""]
        for entry in slices:
            out.append(f"- {_cell(entry.get('story'))} — engine "
                       f"{_cell(entry.get('engine'))}; assets "
                       f"{_cell(entry.get('assets'))}; playable "
                       f"{_cell(entry.get('playable'))}")
        out.append("")
        for entry in slices:
            if entry.get("contact_sheet"):
                out += [f"![{entry['story']} contact sheet]"
                        f"({sheet_name(entry['story'])})", ""]
            # Story 35.6: the leg's report as a verdict table, then its
            # sampled frames and the report itself (attachments on the page)
            story = entry["story"]
            if isinstance(reports.get(story), dict):
                out += report_table(reports[story]) + [""]
            links = []
            if entry.get("frames"):
                frame_links = ", ".join(
                    f"[{_frame_base(f)}]({frame_name(story, f)})"
                    for f in entry["frames"])
                links.append(f"Frames: {frame_links}")
            if entry.get("report"):
                links.append(f"[report.json]({report_name(story)})")
            if links:
                out += ["; ".join(links), ""]
    out += ["## Pull requests", ""]
    seen = []
    for s in stories:
        pr = s.get("pr")
        if _non_empty(pr) and pr not in [p for p, _ in seen]:
            seen.append((pr, s.get("pr_state")))
    for r in runs:
        pr = r.get("pr")
        if _non_empty(pr) and pr not in [p for p, _ in seen]:
            seen.append((pr, None))
    out += [f"- {pr} ({state or 'state unknown'})" for pr, state in seen] \
        or ["None."]
    out.append("")
    out += ["## Cost per story", "", "| story | run | tokens | usd |",
            "| --- | --- | --- | --- |"]
    keys = []
    for s in stories:
        if s["key"] not in [k for k, _ in keys]:
            keys.append((s["key"], s.get("run_id")))
    for key, run_id in keys:
        sample = meter.get(key) or {}
        tokens = sample.get("tokens")
        out.append(f"| {_cell(key)} | {_cell(run_id)} | "
                   f"{tokens if isinstance(tokens, int) else UNMETERED} | "
                   f"{_usd(sample.get('usd'))} |")
    if not keys:
        out.append(f"| {UNMETERED} | {UNMETERED} | {UNMETERED} | "
                   f"{UNMETERED} |")
    out += ["", "| run | job | state | usd |", "| --- | --- | --- | --- |"]
    for r in runs:
        out.append(f"| {_cell(r.get('run_id'))} | {_cell(r.get('job'))} | "
                   f"{_cell(r.get('state'))} | {_usd(r.get('cost_usd'))} |")
    if not runs:
        out.append(f"| {UNMETERED} | {UNMETERED} | {UNMETERED} | "
                   f"{UNMETERED} |")
    out.append("")
    spend = data.get("spend") if isinstance(data.get("spend"), dict) \
        else (record.get("spend") if isinstance(record.get("spend"), dict)
              else {})
    planning = _num(spend.get("planning_usd")) or 0.0
    runs_usd = _num(spend.get("runs_usd")) or 0.0
    total = round(planning + runs_usd, 6)
    out += ["## Spend", "", f"- planning_usd: {_usd(planning)}",
            f"- runs_usd: {_usd(runs_usd)}", f"- total: {_usd(total)}", ""]
    out += ["## Quote against actual", ""]
    q = data.get("quote") if isinstance(data.get("quote"), dict) \
        else (record.get("quote") if isinstance(record.get("quote"), dict)
              else None)
    if q is None:
        out += ["No quote on the record.", ""]
    else:
        def band(name):
            b = q.get(name)
            return _num(b.get("usd")) if isinstance(b, dict) else None
        # the bands and the cap are priced from story-run samples alone
        # and the supervisor's cap meters runs_usd alone: the actual is
        # runs_usd (planning_usd and the total stand on their own lines)
        cap = _num(q.get("cap"))
        hit = next((name for name in ("band50", "band85", "band95")
                    if band(name) is not None and runs_usd <= band(name)),
                   None)
        if hit is None:
            hit = "above band95" if cap is None else (
                "within the cap" if runs_usd < cap else "at or over the cap")
        else:
            hit = f"within {hit}"
        cap_line = "no cap" if cap is None else (
            "under the cap" if runs_usd < cap else "at or over the cap")
        out += [f"- band50: {_usd(band('band50'))}",
                f"- band85: {_usd(band('band85'))}",
                f"- band95: {_usd(band('band95'))}",
                f"- cap: {_usd(cap)}",
                f"- actual (runs_usd): {_usd(runs_usd)}",
                f"- planning_usd: {_usd(planning)}",
                f"- total: {_usd(total)}",
                f"- band hit: {hit}", f"- cap hit: {cap_line}", ""]
    out += ["## Side exits", ""]
    exits = data.get("side_exits") or []
    out += [f"- {_cell(e.get('at'))}: {_cell(e.get('verb'))} → "
            f"{_cell(e.get('to'))} — {_cell(e.get('reason'))}"
            for e in exits] or ["None."]
    out.append("")
    return "\n".join(out)


def _meter_samples(root: Path,
                   measurements: Path | None) -> tuple[dict, str | None]:
    """The project's meter records by `story_key` (`quote.py history`), and
    a note when they could not be read (every figure then unmetered)."""
    import consolidate
    import ledger
    import quote as quotelib
    try:
        mdir = Path(measurements) if measurements is not None \
            else ledger.store_root() / "measurements"
        events = consolidate.read_events(mdir)[0] if mdir.is_dir() else []
    except (OSError, UnicodeDecodeError) as exc:
        return {}, (f"measurements unreadable "
                    f"({exc.__class__.__name__}): every story unmetered")
    hist = quotelib.history(events, configlib.project_key(root))
    return {s["story_key"]: s for s in hist["samples"]}, None


def closeout(project_root: Path, engagement: str, data, dry_run: bool = False,
             now=None, transport=None, sleep=None,
             measurements: Path | None = None) -> dict:
    """The `closeout` verb (Story 32.8, Settled shapes 2, 3 and 5): the
    supervisor's composition `data` rendered as `closeout.md` (atomically),
    published as `ENG-NNN: Closeout` beside the scope, and `closeout {path,
    page, outcome, done, not_done, run_id, at}` merged alone into a fresh
    read of the record. The state does not move here: the supervisor applies
    `run-ended` after. Run by the supervisor's closeout pass only."""
    import confluence
    import plansync
    root = Path(project_root).resolve()
    result = _result(engagement, "closeout", dry_run)
    result.update({"outcome": None, "page": None})
    rel = closeout_rel(engagement)
    record_rel = f"_bmad-output/engagements/{engagement}/engagement.yaml"
    try:
        if not ENGAGEMENT_ID_RE.match(engagement or ""):
            raise Refused("BadEngagement", f"--engagement {engagement!r} is "
                          f"not an engagement id (ENG-001)")
        data = _check_closeout_input(data)
        record = read_record(root, engagement)
        state = record.get("state")
        if state in TERMINAL_STATES:
            raise Refused("EngagementClosed", f"{engagement} is {state}; "
                          f"nothing is written")
        if state not in CLOSEOUT_STATES:
            raise Refused("NotInProgress", f"{engagement} is {state}; a "
                          f"closeout is written only in in-progress or "
                          f"partial")
        scoped = read_scope(root, engagement)
        if scoped is None:
            raise Refused("NoScope", f"no {scope_rel(engagement)}")
        meter, note = _meter_samples(root, measurements)
        if note:
            result["notes"].append(note)
        verdicts = closeout_verdicts(scoped["text"], data)
        outcome = closeout_outcome(verdicts, data)
        # Story 34.8: each slice's contact sheet read from its host path; an
        # unreadable one is a note, its line kept without the image
        sheets: list[tuple[str, bytes]] = []
        # Story 35.6 (CAP-13): each slice leg's report and sampled frames,
        # read the same way (an unreadable file is a note and is dropped),
        # written beside closeout.md and attached with the sheet
        reports: dict[str, dict] = {}
        if data.get("slices"):
            kept = []
            for entry in data["slices"]:
                entry = dict(entry)
                story = entry["story"]
                if entry.get("contact_sheet"):
                    try:
                        sheets.append((sheet_name(story),
                                       Path(entry["contact_sheet"])
                                       .read_bytes()))
                    except OSError as exc:
                        result["notes"].append(
                            f"contact sheet of {story} unreadable "
                            f"({exc.__class__.__name__}): not embedded")
                        entry.pop("contact_sheet")
                if entry.get("report"):
                    try:
                        raw = Path(entry["report"]).read_bytes()
                    except OSError as exc:
                        result["notes"].append(
                            f"report.json of {story} unreadable "
                            f"({exc.__class__.__name__}): not attached")
                        entry.pop("report")
                    else:
                        sheets.append((report_name(story), raw))
                        try:
                            doc = json.loads(raw.decode("utf-8-sig"))
                        except (UnicodeDecodeError, ValueError):
                            doc = None
                        if isinstance(doc, dict):
                            reports[story] = doc
                        else:
                            result["notes"].append(
                                f"report.json of {story} is not a JSON "
                                f"object: no verdict table")
                if entry.get("frames"):
                    frames = []
                    for frame in entry["frames"]:
                        try:
                            sheets.append((frame_name(story, frame),
                                           Path(frame).read_bytes()))
                        except OSError as exc:
                            result["notes"].append(
                                f"frame {frame} of {story} unreadable "
                                f"({exc.__class__.__name__}): not attached")
                            continue
                        frames.append(frame)
                    if frames:
                        entry["frames"] = frames
                    else:
                        entry.pop("frames")
                kept.append(entry)
            data = {**data, "slices": kept}
        text = render_closeout(engagement, record, data, verdicts, outcome,
                               meter, reports)
        done = sum(1 for v in verdicts if v["done"])
        result.update({"outcome": outcome, "closeout": rel, "done": done,
                       "not_done": len(verdicts) - done})
        if dry_run:
            result["notes"].append("dry run: closeout.md was not written, "
                                   "the page not published")
            return _finish(result, "partial", "dry run: nothing written; a "
                           "real run would write `closeout` and publish it")
        path = engagement_dir(root, engagement) / "closeout.md"
        try:
            current = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            current = None
        for name, content in sheets:
            sheet_path = engagement_dir(root, engagement) / name
            try:
                held = sheet_path.read_bytes()
            except OSError:
                held = None
            if held == content:
                continue
            try:
                _atomic_write_bytes(sheet_path, content)
            except OSError as exc:
                result["retry"] = True
                return _finish(result, "partial", f"engage closeout "
                               f"transient: {doc_rel(engagement, name)}: "
                               f"{exc.__class__.__name__}")
            result["written"].append(doc_rel(engagement, name))
        if current != text:
            try:
                atomic_write_text(path, text)
            except OSError as exc:
                result["retry"] = True
                return _finish(result, "partial", f"engage closeout "
                               f"transient: {rel}: "
                               f"{exc.__class__.__name__}")
            result["written"].append(rel)
        page = None
        space_id = plansync._recorded(root, "planning.confluence.space_id")
        gaps = confluence.env_gaps() if space_id is not None else []
        if space_id is None:
            result["notes"].append("ConfluenceUnbound: planning.confluence."
                                   "space_id is not recorded; the closeout "
                                   "is not published (page: null)")
        elif gaps:
            result["notes"].append("ConfluenceEnvMissing: " + "; ".join(gaps)
                                   + "; the closeout is not published "
                                   "(page: null)")
        else:
            prior = record.get("closeout") \
                if isinstance(record.get("closeout"), dict) else {}
            recorded = prior.get("page") \
                if isinstance(prior.get("page"), dict) else {}
            try:
                recorded_version = int(recorded["version"]) \
                    if recorded.get("version") is not None else None
            except (TypeError, ValueError):
                recorded_version = None
            try:
                page = _publish_scope(
                    root, engagement, text, space_id,
                    plansync._recorded(root, "planning.jira.site"),
                    transport, sleep, recorded_version,
                    title=CLOSEOUT_TITLE.format(engagement=engagement),
                    rel=rel, attachments=sheets)
                for detail in page.pop("attachment_errors", []):
                    result["notes"].append(f"attachment not uploaded: "
                                           f"{detail}")
            except _Transient as exc:
                result["retry"] = True
                result["notes"].append("closeout.md kept; the record's "
                                       "closeout unchanged; rerun to "
                                       "publish")
                return _finish(result, "partial", f"engage closeout "
                               f"transient: {exc}")
            except Refused as exc:
                result["notes"].append(f"the closeout is not published "
                                       f"(page: null): {exc}")
        result["page"] = page
        entry = {"path": rel,
                 "page": None if page is None else
                 {"id": page["id"], "url": page["url"],
                  "version": page["version"]},
                 "outcome": outcome, "done": done,
                 "not_done": len(verdicts) - done,
                 "run_id": data["run_id"], "at": now or _now()}
        try:
            _merge_record(root, engagement, {"closeout": entry})
        except OSError as exc:
            result["retry"] = True
            return _finish(result, "partial", f"engage closeout transient: "
                           f"{record_rel}: {exc.__class__.__name__}")
        result["written"].append(record_rel)
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
    docs = {}
    for kind in ("brief", "gdd"):
        value = getattr(args, f"{kind}_file", None)
        if value is None:
            continue
        try:
            docs[kind] = Path(value).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            result = _finish(_result(args.engagement, "scope", args.dry_run),
                             "blocked", f"engage refused: GameDocsMissing: "
                             f"{kind}: cannot read --{kind}-file: "
                             f"{exc.__class__.__name__}; nothing written")
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 2
    result = scope(directory, args.engagement, text=text,
                   revise_at=args.revise_at, dry_run=args.dry_run,
                   transport=transport, brief=docs.get("brief"),
                   gdd=docs.get("gdd"))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 2 if result.get("status") == "blocked" else 0


def _closeout_main(directory: Path, args, transport=None) -> int:
    try:
        data = json.loads(Path(args.input_file).read_text(encoding="utf-8"))
    except OSError as exc:
        # an OS refusal is transient (the module docstring): `partial`,
        # `retry: true`, never a named refusal the supervisor records
        result = _result(args.engagement, "closeout", args.dry_run)
        result.update({"outcome": None, "page": None, "retry": True})
        result["notes"].append("nothing written; rerun to close out")
        result = _finish(result, "partial", f"engage closeout transient: "
                         f"--input-file: {exc.__class__.__name__}")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        result = _result(args.engagement, "closeout", args.dry_run)
        result.update({"outcome": None, "page": None})
        result = _finish(result, "blocked", f"engage refused: "
                         f"CloseoutInputInvalid: cannot read --input-file "
                         f"as JSON ({exc.__class__.__name__}); nothing "
                         f"written")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2
    result = closeout(directory, args.engagement, data, dry_run=args.dry_run,
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
    scp.add_argument("--brief-file", help="a game project's quick-flow game "
                                          "brief (gds-create-game-brief), "
                                          "Story 34.8")
    scp.add_argument("--gdd-file", help="a game project's quick-flow GDD "
                                        "(gds-gdd), Story 34.8")
    scp.add_argument("--dry-run", action="store_true")
    quo = sub.add_parser("quote")
    quo.add_argument("--directory", required=True,
                     help="project root (the served root, project_root)")
    quo.add_argument("--engagement", required=True, help="ENG-NNN")
    quo.add_argument("--seed", type=int, help="the bootstrap's seed, 0 <= N "
                                              "< 2**53 (default: the first 6 "
                                              "bytes of sha256 of "
                                              "'<engagement>:<n>')")
    quo.add_argument("--dry-run", action="store_true")
    clo = sub.add_parser("closeout")
    clo.add_argument("--directory", required=True,
                     help="project root (the served root, project_root)")
    clo.add_argument("--engagement", required=True, help="ENG-NNN")
    clo.add_argument("--input-file", required=True,
                     help="the supervisor's composition, a JSON object "
                          "{run_id, outcome_hint, runs, stories, epics, "
                          "side_exits, spend, quote}")
    clo.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    directory = configlib.find_project_root(Path(args.directory))
    if args.command == "questions":
        return _questions_main(directory, args)
    if args.command == "scope":
        return _scope_main(directory, args)
    if args.command == "closeout":
        return _closeout_main(directory, args)
    if args.command == "quote":
        result = quote(directory, args.engagement, seed=args.seed,
                       dry_run=args.dry_run)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2 if result.get("status") == "blocked" else 0
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
