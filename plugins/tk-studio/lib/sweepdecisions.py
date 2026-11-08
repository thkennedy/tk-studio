"""The owner's sweep decisions: a source and a sink (Story 38.4, hole 112, DW-171).

The source. A sweep's triage (bmad-loop-sweep's result schema) names each
decision with the skill's own `options [{key, label, effect, intent?,
resolution?}]` and `recommendation`; the studio letters them (AD-4: the stock
skill is never forked):

    {id, question, context, options: [{letter, text, key, effect}], default}

`letter` is A, B, C, … in the skill's order; `text` the label, then
` — <intent or resolution>` when either is present, on one line, clipped to
200; `default` the letter whose `key` equals `recommendation`, else null (no
options: `options: []`, `default: null`). `launch.py triage_summary` and
`sweep.ts parseTriage` project the same shape.

Decisions are related, and go in one issue, when their normalised question
and option list are equal (lowercased, whitespace collapsed, every `DW-\\d+`
token removed; the options as `(label, effect)` plus the recommendation's
index). A group holds at most 30 ids (chunked past that); groups are ordered
by their lowest DW number, ids inside a group by DW number. `post` (the body
of `tk-studio-track block --source sweep`) creates one `Task` per group,
labelled `tk-studio-decision` and assigned to the owner, summary `Decision:
DW-87 — <question>` / `Decisions: DW-12, DW-13 — <question>` (past 6 ids
`DW-12, …, DW-17 +N`, within 255 characters), the description one block per
id (question, context, `A) <text>` lines, `Default: <letter|none>`), then
`track._block_issue` moves it to `Blocked - Awaiting User` with the mention
comment `inbox.BLOCK_COMMENT_RE` reads.

The record is `_bmad-output/tracking/decisions-jira.json` at the project root
(local tracking memory, atomic, UTF-8, never committed):

    {version: 1, issues: {<KEY>: {ids, run_id, engine_run_id, posted_at,
       state: open|done, blocked, decisions: {<DW>: {question, options,
       default}}, cycles: [{block_comment, at, ingested, missing,
       move_pending?}]}},
     answers: {<DW>: {letter, text, key, label, effect, issue, date}},
     legacy_cycles?: [{issue, block_comment, at, ingested, missing,
       move_pending?}],
     legacy?: {<name>: value} | [...]}

`blocked` is false from the create until `_block_issue` has moved the issue
and posted the mention; a re-run finishes that block instead of skipping the
issue's ids (an entry without the field is taken as blocked).

A legacy entry (the 2026-11-05 hand posting's, any other shape) is kept as it
is under its issue key and read only for its `DW-\\d+` ids (its ingest cycles
go in `legacy_cycles`, beside it). The 2026-11-05 file is keyed by group name
(`DW-32`, `R1`, `HUD`, …), each entry naming its `issue`: such an entry is
indexed under that issue, its group name kept in the entry's `group` (a
`DW-n` group name is never taken for an issue key); a legacy entry whose
`status` is `Done` is not "asked". Every other top-level value of a legacy file is
kept verbatim (one whose name the record uses goes under `legacy: {<name>:
value}`; a top-level list is kept as it is under `legacy`), and a record's
unrecognised top-level keys are kept likewise. Its options come from the
live issue's description, and when none are readable the reply names the ids
`not ingested: options unreadable` and the issue is re-blocked (never invented).

The sink. `ingest` runs in the sync-back tick right after `inbox.derive`
(under its gate), once per `(issue, reason_comment.id)`, for each inbox item
carrying `decision` in state `resolved`: the owner's comments after the newest
agent `Blocked:` comment are parsed (`<id>: <letter>`, `all: <letter>`,
`default`; an id's own line, then `all:`, then — only with a `default` line —
the id's default; a later line wins; a letter outside the options, a
qualified answer and a `default` with no default leave the id open, named),
each answered id gets its ledger `decision:` line through
`plansync.ledger_decide`, the record's `answers`, one agent reply (`Ingested:
…` / `Still open: …`), then a by-name move to `Done` (complete) or a re-block
naming the missing ids. Only a temporary failure (`track.transient`) before
the reply leaves the cycle and the item's answers unrecorded, so the next
tick retries; one after the reply (the `Done` move or the re-block) records
the cycle with `move_pending: true`, and the next tick retries only that move
(no second reply), then clears the marker; any
other failure (a refused reply, a `Done` move or a re-block refused or with
no route) still records the cycle — `ingested` the ids whose ledger line was
written, merged into `answers`, `missing` the rest — the failure in the
tick's notes, never retried; an item with no `reason_comment` id is skipped before any reply or
ledger line, with a note, and records nothing. Library only; stdlib-only (NFR9). `track`, `plansync`,
`syncback` and `inbox` are imported lazily (each imports this module's
importers at its top).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import dwledger
import jirabackend

TRACKING_REL = Path("_bmad-output") / "tracking"
RECORD_REL = TRACKING_REL / "decisions-jira.json"
RECORD_VERSION = 1
LABEL = "tk-studio-decision"
ISSUE_TYPE = "Task"
DONE_STATUS = "Done"
GROUP_MAX = 30
TEXT_MAX = 200
SUMMARY_MAX = 255
SUMMARY_IDS_MAX = 6
DW_RE = re.compile(r"DW-\d+", re.IGNORECASE)
DW_ID_RE = re.compile(r"^DW-\d+$")
ISSUE_KEY_RE = re.compile(r"^[A-Z][A-Z0-9]+-\d+$")
ANSWER_HOW = ('one "<id>: <letter>" line per decision, "all: <letter>" for '
              'every decision here, or "default" to take each default')
RESOLVES = ('reply with one "<id>: <letter>" line per decision, '
            '"all: <letter>", or "default"')
# Settled shape 6: the owner's answer lines (matched case-insensitively)
ID_LINE_RE = re.compile(r"^(DW-\d+)\s*[:=]\s*([A-Z])\s*[.!]?$", re.IGNORECASE)
ALL_LINE_RE = re.compile(r"^all\s*[:=]\s*([A-Z])\s*[.!]?$", re.IGNORECASE)
DEFAULT_LINE_RE = re.compile(r"^default\s*[.!]?$", re.IGNORECASE)
QUALIFIED_RE = re.compile(r"^(DW-\d+)\s*[:=]\s*([A-Z])(?:\s+|\s*[,;(—–-])\s*\S.*$",
                          re.IGNORECASE)
# a hand-posted description's lettered option line (plan Risks)
OPTION_LINE_RE = re.compile(r"^\s*[-*]?\s*\(?\*{0,2}([A-D])\*{0,2}[).:—–-]\s+(.+)$")
DEFAULT_IN_TEXT_RE = re.compile(r"^\s*[-*]?\s*default\s*[:=]\s*\(?([A-D])\b", re.IGNORECASE)


# ------------------------------------------------------------ the shape

def _one_line(text) -> str:
    return " ".join(str(text or "").split())


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def _options(decision: dict) -> list[dict]:
    raw = decision.get("options")
    return [o for o in raw if isinstance(o, dict)] if isinstance(raw, list) else []


def lettered(decision: dict) -> dict:
    """One decision in the studio's shape (Settled shape 1), plus each
    option's `label` (the record and the engine answer match by it)."""
    options, default = [], None
    recommendation = decision.get("recommendation")
    for i, option in enumerate(_options(decision)[:26]):
        letter = chr(ord("A") + i)
        label = _one_line(option.get("label"))
        extra = _one_line(option.get("intent") or option.get("resolution"))
        key = str(option.get("key") if option.get("key") is not None else "")
        options.append({"letter": letter,
                        "text": _clip(label + (f" — {extra}" if extra else ""),
                                      TEXT_MAX),
                        "key": key, "effect": str(option.get("effect") or ""),
                        "label": label})
        if default is None and recommendation is not None and key \
                and str(recommendation) == key:
            default = letter
    return {"id": str(decision.get("id") or ""),
            "question": str(decision.get("question") or ""),
            "context": str(decision.get("context") or ""),
            "options": options, "default": default}


def shape(decision: dict) -> dict:
    """The triage projection's decision: `{id, question, context, options:
    [{letter, text, key, effect}], default}`."""
    d = lettered(decision)
    d["options"] = [{k: o[k] for k in ("letter", "text", "key", "effect")}
                    for o in d["options"]]
    return d


def dw_number(dw: str) -> int:
    m = re.match(r"^DW-(\d+)$", str(dw))
    return int(m.group(1)) if m else 10 ** 9


def _norm(text) -> str:
    return " ".join(DW_RE.sub("", " ".join(str(text or "").lower().split())).split())


def group_key(decision: dict) -> tuple:
    options = _options(decision)
    keys = [str(o.get("key")) for o in options]
    rec = str(decision.get("recommendation"))
    return (_norm(decision.get("question")),
            tuple((_norm(o.get("label")), str(o.get("effect") or ""))
                  for o in options),
            keys.index(rec) if rec in keys else -1)


def groups(decisions: list[dict]) -> list[list[dict]]:
    """The related groups (Settled shape 2): equal normalised question and
    options; ≤30 ids each; ordered by their lowest DW number."""
    buckets: dict[tuple, list[dict]] = {}
    for d in decisions:
        buckets.setdefault(group_key(d), []).append(d)
    out: list[list[dict]] = []
    for members in buckets.values():
        members = sorted(members, key=lambda d: dw_number(d.get("id")))
        for i in range(0, len(members), GROUP_MAX):
            out.append(members[i:i + GROUP_MAX])
    return sorted(out, key=lambda g: dw_number(g[0].get("id")))


# ------------------------------------------------------------ the issue form

def id_list(ids: list[str]) -> str:
    if len(ids) <= SUMMARY_IDS_MAX:
        return ", ".join(ids)
    return f"{ids[0]}, …, {ids[SUMMARY_IDS_MAX - 1]} +{len(ids) - SUMMARY_IDS_MAX}"


def summary(ids: list[str], question: str) -> str:
    head = (f"Decision: {ids[0]} — " if len(ids) == 1
            else f"Decisions: {id_list(ids)} — ")
    return head + _clip(_one_line(question), max(SUMMARY_MAX - len(head), 1))


def description(run_id: str, engine_run_id: str, decisions: list[dict],
                earlier: dict[str, tuple[str, str]] | None = None) -> str:
    """The issue's plain-text description (REST v2): the answer form, then
    one block per decision (`decisions` lettered). `earlier`: a re-asked id's
    `(letter, KEY)`."""
    earlier = earlier or {}
    lines = [f"Sweep {run_id} (engine {engine_run_id}) needs {len(decisions)} "
             f"decision(s). Answer in one comment: {ANSWER_HOW}."]
    for d in decisions:
        lines += ["", f"{d['id']}: {_one_line(d['question'])}"]
        if _one_line(d.get("context")):
            lines.append(_one_line(d["context"]))
        lines += [f"{o['letter']}) {o['text']}" for o in d["options"]]
        lines.append(f"Default: {d.get('default') or 'none'}")
        if d["id"] in earlier:
            letter, key = earlier[d["id"]]
            lines.append(f"Earlier answer: {letter} ({key}) no longer matches "
                         f"these options")
    return "\n".join(lines)


def block_reason(ids: list[str], still: bool = False) -> str:
    return (f"{len(ids)} sweep decision(s) {'still ' if still else ''}need "
            f"your answer: {', '.join(ids)}")


# ------------------------------------------------------------ the record

KNOWN_KEYS = ("version", "issues", "answers", "legacy_cycles")
LEGACY_KEY = "legacy"


def _empty() -> dict:
    return {"version": RECORD_VERSION, "issues": {}, "answers": {}}


def _is_issue_map(value) -> bool:
    return isinstance(value, dict) and all(
        isinstance(k, str) and ISSUE_KEY_RE.match(k) for k in value)


def _legacy_issues(source: dict) -> tuple[dict, set]:
    """(a legacy dict's entries by issue key, the source keys indexed). An
    entry naming its `issue` (the 2026-11-05 file is keyed by group name:
    `DW-32`, `R1`, `HUD`, …) is indexed under that issue, its group name
    kept in `group` (an entry already carrying another `group` stays
    verbatim under its key); otherwise an issue-keyed entry under its key.
    A `DW-n` key never becomes an issue key when its value names an issue."""
    issues: dict = {}
    used: set = set()
    for k, v in source.items():
        if not isinstance(k, str):
            continue
        named = v.get("issue") if isinstance(v, dict) else None
        if not (isinstance(named, str) and ISSUE_KEY_RE.match(named)
                and not DW_ID_RE.match(named)):
            named = None
        if named is not None:
            if named not in issues and v.get("group", k) == k:
                entry = dict(v)
                if named != k:
                    entry.setdefault("group", k)
                issues[named] = entry
                used.add(k)
            continue
        if ISSUE_KEY_RE.match(k) and k not in issues:
            issues[k] = v
            used.add(k)
    return issues, used


def load_record(root: Path) -> dict:
    """The record, a legacy file's entries kept under their keys, or an
    empty one when absent or unreadable. Every other top-level value is kept
    verbatim, so `write_record` drops nothing: a record's unrecognised keys
    as they are; a legacy file's non-issue keys as they are, except a name
    the record uses (or `legacy`), which goes under `legacy: {<name>:
    value}`; a legacy top-level list as it is under `legacy`."""
    try:
        data = json.loads((Path(root) / RECORD_REL).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        return _empty()
    record = _empty()
    if isinstance(data, dict) and data.get("version") == RECORD_VERSION:
        if isinstance(data.get("issues"), dict):
            record["issues"] = data["issues"]
        if isinstance(data.get("answers"), dict):
            record["answers"] = data["answers"]
        if isinstance(data.get("legacy_cycles"), list):
            record["legacy_cycles"] = data["legacy_cycles"]
        for k, v in data.items():
            if k not in KNOWN_KEYS:
                record[k] = v
        return record
    # a legacy file (the 2026-11-05 script's): its entries kept by key, the
    # rest of it verbatim
    kept: dict = {}
    used: set = set()
    if isinstance(data, dict):
        source = data.get("issues") if isinstance(data.get("issues"), (dict, list)) else data
        if isinstance(source, dict):
            record["issues"], used = _legacy_issues(source)
        for k, v in data.items():
            if source is data and k in used:
                continue
            if k == "issues" and _is_issue_map(v):
                continue
            if k in KNOWN_KEYS or k == LEGACY_KEY:
                record.setdefault(LEGACY_KEY, {})[k] = v
            else:
                kept[k] = v
    else:
        source = data
        record[LEGACY_KEY] = data
    if isinstance(source, list):
        for entry in source:
            if not isinstance(entry, dict):
                continue
            key = entry.get("key") or entry.get("issue")
            if isinstance(key, str) and ISSUE_KEY_RE.match(key):
                record["issues"][key] = entry
    record.update(kept)
    return record


def write_record(root: Path, record: dict) -> str:
    jirabackend._atomic_write(Path(root) / RECORD_REL, json.dumps(
        record, ensure_ascii=False, indent=2) + "\n")
    return RECORD_REL.as_posix()


def is_studio_entry(entry) -> bool:
    return isinstance(entry, dict) and isinstance(entry.get("ids"), list) \
        and entry.get("state") in ("open", "done") \
        and isinstance(entry.get("decisions"), dict)


def _block_pending(entry) -> bool:
    """A studio entry created but never blocked (`blocked: false`: the move
    or the mention comment did not complete); an entry without the field is
    taken as blocked."""
    return is_studio_entry(entry) and entry.get("state") == "open" \
        and entry.get("blocked") is False


def entry_ids(entry) -> list[str]:
    """A record entry's ids: the studio entry's `ids`, else every `DW-\\d+`
    in a legacy entry's strings (sorted by number, once each)."""
    if is_studio_entry(entry):
        return [str(i) for i in entry["ids"]]
    found: set[str] = set()

    def walk(value):
        if isinstance(value, str):
            found.update(m.upper() for m in DW_RE.findall(value))
        elif isinstance(value, dict):
            for k, v in value.items():
                walk(k)
                walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)
    walk(entry)
    return sorted(found, key=dw_number)


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(timezone.utc)


# ------------------------------------------------------------ the parse

def parse_answers(texts: list[str], decisions: dict[str, dict],
                  ids: list[str]) -> tuple[dict[str, str], dict[str, str]]:
    """(answered `{id: letter}`, still open `{id: why}`) for `ids` from the
    owner's comment texts in order (Settled shape 6). `decisions[id]` holds
    `options` (lettered) and `default`."""
    own: dict[str, str] = {}
    qualified: set[str] = set()
    all_letter, take_default = None, False
    for text in texts:
        for raw in str(text or "").splitlines():
            line = re.sub(r"^[-*]\s*", "", raw.strip())
            m = ID_LINE_RE.match(line)
            if m:
                dw = m.group(1).upper()
                own[dw] = m.group(2).upper()
                qualified.discard(dw)
                continue
            m = ALL_LINE_RE.match(line)
            if m:
                all_letter = m.group(1).upper()
                continue
            if DEFAULT_LINE_RE.match(line):
                take_default = True
                continue
            m = QUALIFIED_RE.match(line)
            if m:
                dw = m.group(1).upper()
                qualified.add(dw)
                own.pop(dw, None)
    answered: dict[str, str] = {}
    still: dict[str, str] = {}
    for dw in ids:
        d = decisions.get(dw) or {}
        letters = {o.get("letter") for o in d.get("options") or []}
        if not letters:
            still[dw] = "not ingested: options unreadable"
            continue
        if dw in qualified:
            still[dw] = "qualified answer, not ingested"
            continue
        letter = own.get(dw) or all_letter
        if letter is None and take_default:
            if not d.get("default"):
                still[dw] = "no default"
                continue
            letter = d["default"]
        if letter is None:
            still[dw] = "no answer line"
        elif letter not in letters:
            still[dw] = f"no option {letter}"
        else:
            answered[dw] = letter
    return answered, still


def options_from_description(text: str) -> tuple[list[dict], str | None]:
    """A hand-posted issue's lettered option lines and default (plan Risks);
    `([], None)` when none are readable."""
    options: list[dict] = []
    seen: set[str] = set()
    default = None
    for raw in str(text or "").splitlines():
        m = DEFAULT_IN_TEXT_RE.match(raw)
        if m:
            default = m.group(1).upper()
            continue
        m = OPTION_LINE_RE.match(raw)
        if not m or m.group(1) in seen:
            continue
        seen.add(m.group(1))
        body = _one_line(re.sub(r"\*{1,2}", "", m.group(2)))
        if re.search(r"\((default|recommended)\)", body, re.IGNORECASE):
            default = default or m.group(1)
        options.append({"letter": m.group(1), "text": _clip(body, TEXT_MAX),
                        "key": "", "effect": "", "label": body})
    return options, (default if any(o["letter"] == default for o in options)
                     else None)


def reply_text(answered: dict[str, str], decisions: dict[str, dict],
               still: dict[str, str]) -> str:
    def text_of(dw, letter):
        for o in (decisions.get(dw) or {}).get("options") or []:
            if o.get("letter") == letter:
                return o.get("text") or ""
        return ""
    done = "; ".join(f"{dw}: {letter} — {text_of(dw, letter)}"
                     for dw, letter in sorted(answered.items(),
                                              key=lambda kv: dw_number(kv[0])))
    left = ", ".join(f"{dw} ({why})" for dw, why in
                     sorted(still.items(), key=lambda kv: dw_number(kv[0])))
    return f"Ingested: {done or 'none'}\nStill open: {left or 'none'}"


# ------------------------------------------------------------ the source

def _read_triages(paths: list[str]) -> tuple[list[dict], str | None, str | None]:
    """(decisions merged by id — a later file wins —, engine run id, refusal)."""
    merged: dict[str, dict] = {}
    engine = None
    for p in paths:
        path = Path(p)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, ValueError) as exc:
            return [], None, f"TriageUnreadable: {p}: {exc}"
        if not isinstance(data, dict):
            return [], None, f"TriageUnreadable: {p} is not a JSON object"
        parts = path.resolve().parts
        if len(parts) >= 4 and parts[-3] == "runs" and parts[-4] == ".bmad-loop":
            engine = parts[-2]
        for d in data.get("decisions") or []:
            if isinstance(d, dict) and d.get("id"):
                merged[str(d["id"])] = d
    return list(merged.values()), engine, None


def _create_issue(client, project_key: str, owner: str, text_summary: str,
                  text_description: str) -> str:
    """`POST /issue`: a Task labelled `tk-studio-decision`, assigned to the
    owner. A 400 is track.IssueCreateRefused."""
    import track
    fields = {"project": {"key": project_key}, "summary": text_summary,
              "issuetype": {"name": ISSUE_TYPE},
              "description": text_description, "labels": [LABEL],
              "assignee": {"accountId": owner}}
    posted, resp = client.request("POST", "/issue", {"fields": fields},
                                  scope=jirabackend.SCOPE_WORK)
    if posted == 400:
        raise track.IssueCreateRefused(
            f'creating "{text_summary}" (issue type {ISSUE_TYPE!r}) returned '
            f"{jirabackend._refusal(posted, resp)}")
    if posted not in (200, 201) or not isinstance(resp, dict) \
            or not resp.get("key"):
        raise jirabackend.JiraError(f"track: POST /issue returned {posted}")
    return str(resp["key"])


def post(project_root: Path, triage_paths: list[str], run_id: str | None,
         ask: list[str] | None = None, dry_run: bool = False,
         transport=None, sleep=None, now: datetime | None = None) -> dict:
    """`tk-studio-track block --source sweep` (see the module docstring and
    track's)."""
    import plansync
    import track
    root = Path(project_root).resolve()
    ask = list(ask or [])
    result = {"ok": False, "dry_run": dry_run, "source": "sweep",
              "run_id": run_id, "issues": [], "skipped": [], "notes": [],
              "written": []}

    def refuse(why: str) -> dict:
        return track._finish(result, "blocked", f"track refused: {why}")

    if not str(run_id or "").strip():
        return refuse("--source sweep needs --run-id (the studio run id); no "
                      "Atlassian call made")
    if not triage_paths:
        return refuse("TriageUnreadable: --source sweep needs --triage PATH; "
                      "no Atlassian call made")
    bad = [a for a in ask if not DW_ID_RE.match(a)]
    if bad:
        return refuse(f"--ask takes DW ids: {', '.join(bad)}; no Atlassian "
                      f"call made")
    decisions, engine, gap = _read_triages(triage_paths)
    if gap:
        return refuse(gap + "; no Atlassian call made")
    if not decisions:
        result["notes"].append("the triage names no decision: nothing posted")
        return track._finish(result, "complete", None)
    settings, owner, gap = track._agent_seat(root)
    if gap:
        return refuse(gap)
    record = load_record(root)
    asked_on: dict[str, str] = {}
    open_on: dict[str, list[str]] = {}  # every open issue listing the id
    for key, entry in record["issues"].items():
        if is_studio_entry(entry) and entry.get("state") != "open":
            continue
        if not is_studio_entry(entry) and isinstance(entry, dict) \
                and str(entry.get("status") or "").strip().lower() \
                == DONE_STATUS.lower():
            continue  # a legacy entry already Done is not asked
        for dw in entry_ids(entry):
            asked_on.setdefault(dw, key)
            open_on.setdefault(dw, []).append(key)
    earlier: dict[str, tuple[str, str]] = {}
    todo = []
    unfinished: list[str] = []  # open record issues whose block never completed
    for d in decisions:
        dw = str(d["id"])
        answer = record["answers"].get(dw)
        if dw in ask:
            # the re-ask is an open issue listing the id OTHER than the one
            # holding its recorded answer (that issue may still read as
            # open: re-blocked for other ids, or a legacy entry not Done)
            answered_on = answer.get("issue") if isinstance(answer, dict) \
                else None
            prior = next((k for k in open_on.get(dw, []) if k != answered_on),
                         None)
            if prior is not None:
                # already re-asked on an open issue: a repeated call is
                # idempotent (one Task per group)
                if _block_pending(record["issues"].get(prior)):
                    if prior not in unfinished:
                        unfinished.append(prior)
                else:
                    result["skipped"].append(f"{dw}: already re-asked on {prior}")
                continue
            if isinstance(answer, dict) and answer.get("letter"):
                earlier[dw] = (str(answer["letter"]), str(answer.get("issue") or "?"))
            todo.append(d)
        elif isinstance(answer, dict):
            result["skipped"].append(f"{dw}: answered on {answer.get('issue') or '?'}")
        elif dw in asked_on:
            key = asked_on[dw]
            if _block_pending(record["issues"].get(key)):
                if key not in unfinished:
                    unfinished.append(key)
            else:
                result["skipped"].append(f"{dw}: already asked on {key}")
        else:
            todo.append(d)
    if not todo and not unfinished:
        return track._finish(result, "complete", None)
    project_key = str(plansync._recorded(root, "planning.jira.project_key"))
    client = None if dry_run else jirabackend.client_for(settings, transport)
    if client is not None and sleep is not None:
        client.sleep = sleep
    notes = result["notes"]
    errors: list[str] = []
    stamp = _now(now).isoformat(timespec="seconds")

    def block(key: str, ids: list[str], created: bool) -> dict:
        """Move `key` to the block status with the mention comment; the
        record's `blocked` set once both are done (a temporary failure
        raises, and the next run finishes it)."""
        moved = track._block_issue(client, owner, {"id": key}, key, "decision",
                                   track.comment_body(owner, block_reason(ids),
                                                      RESOLVES),
                                   False, notes)
        entry = {"issue": key, "ids": ids, "created": created,
                 "transitioned": moved["transitioned"],
                 "commented": moved["commented"]}
        for name in ("skipped", "error"):
            if name in moved:
                entry[name] = moved[name]
        if "error" in moved:
            errors.append(f"{key}: {moved['error']}")
        else:
            record["issues"][key]["blocked"] = True
            remember(write_record(root, record))
        return entry

    def remember(written: str) -> None:
        if written not in result["written"]:
            result["written"].append(written)

    def failed(key, ids, created, exc) -> dict:
        result["issues"].append({"issue": key, "ids": ids, "created": created,
                                 "transitioned": False, "commented": False,
                                 "error": str(exc)})
        if track.transient(exc):
            result["retry"] = True
            return track._finish(result, "partial", f"track retry: "
                                 f"{', '.join(ids)}: {exc} — a temporary "
                                 f"failure; call again on the next pass",
                                 ok=False)
        return refuse(f"{', '.join(ids)}: {exc}")

    for key in unfinished:
        ids = entry_ids(record["issues"][key])
        if dry_run:
            notes.append(f"dry run: would finish {key}'s block (move it to "
                         f"{jirabackend.BLOCKED_STATUS!r} with the mention "
                         f"comment) for {', '.join(ids)}")
            result["issues"].append({"issue": key, "ids": ids, "created": False,
                                     "transitioned": False, "commented": False})
            continue
        try:
            result["issues"].append(block(key, ids, False))
        except jirabackend.JiraError as exc:
            return failed(key, ids, False, exc)
    for group in groups(todo):
        shaped = [lettered(d) for d in group]
        ids = [d["id"] for d in shaped]
        text_summary = summary(ids, shaped[0]["question"])
        text_description = description(str(run_id), engine or "unknown", shaped,
                                       {k: v for k, v in earlier.items() if k in ids})
        if dry_run:
            notes.append(f'dry run: would create "{text_summary}" ({ISSUE_TYPE}, '
                         f"{LABEL}, assigned to the owner) for {', '.join(ids)} "
                         f"and move it to {jirabackend.BLOCKED_STATUS!r} with "
                         f"the mention comment")
            result["issues"].append({"issue": None, "ids": ids, "created": False,
                                     "transitioned": False, "commented": False})
            continue
        key = None
        try:
            key = _create_issue(client, project_key, owner, text_summary,
                                text_description)
            record["issues"][key] = {
                "ids": ids, "run_id": str(run_id), "engine_run_id": engine,
                "posted_at": stamp, "state": "open", "blocked": False,
                "decisions": {d["id"]: {"question": d["question"],
                                        "options": d["options"],
                                        "default": d["default"]}
                              for d in shaped},
                "cycles": []}
            remember(write_record(root, record))
            result["issues"].append(block(key, ids, True))
        except track.IssueCreateRefused as exc:
            return refuse(f"IssueCreateRefused: {exc}")
        except jirabackend.JiraError as exc:
            return failed(key, ids, key is not None, exc)
    if dry_run:
        return track._finish(result, "partial", "dry run: nothing written; a "
                             "real run would create, move and comment as "
                             "`notes[]` names")
    if errors:
        return track._finish(result, "partial", "track partial: "
                             + "; ".join(errors))
    return track._finish(result, "complete", None)


# ------------------------------------------------------------ the sink

def _owner_texts(root: Path, key: str, after: str | None) -> list[str]:
    """The owner's comment bodies on `key` (the last log line per id) created
    after `after` (the newest agent `Blocked:` comment), in comment order."""
    import syncback
    _, lines = syncback._log_lines(Path(root) / TRACKING_REL / key / "comments.jsonl")
    latest: dict[str, dict] = {}
    for entry in lines:
        latest[str(entry.get("id"))] = entry
    since = syncback.parse_time(after)
    picked = []
    for entry in latest.values():
        if entry.get("author") != "owner":
            continue
        at = syncback.parse_time(entry.get("created"))
        if since is not None and (at is None or at <= since):
            continue
        picked.append((at.timestamp() if at else 0.0, entry))
    picked.sort(key=lambda p: p[0])
    return [str(e.get("body") or "") for _, e in picked]


def _issue_decisions(jira, key: str, entry, item: dict) -> tuple[list[str], dict[str, dict]]:
    """(the issue's ids, `{id: {question?, options, default}}`): the studio
    entry's own, else (a legacy or absent entry) the ids from the entry or the
    inbox item and the options read from the live description."""
    if is_studio_entry(entry):
        return entry_ids(entry), {str(k): v for k, v in entry["decisions"].items()
                                  if isinstance(v, dict)}
    ids = entry_ids(entry) if entry is not None else \
        [str(i) for i in ((item.get("decision") or {}).get("ids") or [])]
    status, issue = jira.request("GET", f"/issue/{key}",
                                 query={"fields": "description"},
                                 scope=jirabackend.SCOPE_READ)
    if status != 200 or not isinstance(issue, dict):
        if isinstance(status, int) and status >= 500:
            raise jirabackend.JiraError(f"ingest: GET /issue/{key} returned {status}")
        text = ""
    else:
        text = (issue.get("fields") or {}).get("description")
        text = text if isinstance(text, str) else ""
    options, default = options_from_description(text)
    return ids, {dw: {"options": options, "default": default} for dw in ids}


def _move(jira, owner: str, key: str, missing: list[str], notes: list[str],
          counts: dict, entry) -> None:
    """After the reply: the by-name move to `Done` (nothing missing) or the
    re-block naming `missing`. A temporary failure raises; a refused or
    unroutable move is noted (the cycle is recorded, never retried)."""
    import track
    if missing:
        moved = track._block_issue(
            jira, owner, {"id": key}, key, "decision",
            track.comment_body(owner, block_reason(missing, still=True),
                               RESOLVES),
            False, notes, repost_after_owner=True)
        if "error" in moved:
            # not temporary (a temporary failure raises): the cycle is
            # recorded and the failure noted, never retried
            notes.append(f"{key}: re-block: {moved['error']} — the "
                         f"cycle is recorded; the issue is not re-blocked")
        else:
            counts["decisions_reblocked"] += 1
    elif jirabackend.transition_to_name(jira, key, DONE_STATUS, notes,
                                        key) is not None:
        counts["decisions_done"] += 1
        if is_studio_entry(entry):
            entry["state"] = "done"
    else:
        notes.append(f"{key}: no move to {DONE_STATUS!r} — the cycle "
                     f"is recorded; the issue is not moved")


def ingest(root: Path, result: dict, binding: dict, jira,
           now: datetime | None = None) -> list[str]:
    """The tick's decision ingest (see the module docstring). Answers the
    tick's partial reasons (a temporary failure: retried next tick)."""
    import inbox
    import plansync
    import track
    root = Path(root)
    now = _now(now)
    counts = result["counts"]
    for name in ("decisions_ingested", "decisions_reblocked", "decisions_done"):
        counts.setdefault(name, 0)
    items = [i for i in inbox.load(root).get("items") or []
             if isinstance(i, dict) and i.get("decision")
             and i.get("state") == "resolved" and i.get("issue")]
    if not items:
        return []
    owner = binding.get("owner_account_id") or ""
    notes, partial = result["notes"], []
    record = load_record(root)
    date = now.strftime("%Y-%m-%d")
    for item in items:
        key = str(item["issue"])
        reason = item.get("reason_comment") or {}
        cycle_id = str(reason.get("id")) if reason.get("id") is not None else None
        if cycle_id is None:
            # nothing to key the cycle on: no reply, no ledger line, no record
            notes.append(f"{key}: no block comment to key the cycle on — "
                         f"skipped, nothing posted or recorded")
            continue
        entry = record["issues"].get(key)
        if is_studio_entry(entry):
            recorded = [c for c in entry.get("cycles") or [] if isinstance(c, dict)]
        else:
            recorded = [c for c in record.get("legacy_cycles") or []
                        if isinstance(c, dict) and c.get("issue") == key]
        seen = next((c for c in recorded if c.get("block_comment") == cycle_id),
                    None)
        if seen is not None:
            if seen.get("move_pending"):
                # the reply stands; only the move (or re-block) is retried
                try:
                    _move(jira, owner, key, [str(dw) for dw in seen.get("missing") or []],
                          notes, counts, entry)
                except jirabackend.JiraError as exc:
                    if track.transient(exc):
                        result["retry"] = True
                        partial.append(f"{key}: the move after the reply was "
                                       f"interrupted again ({exc}) — retried "
                                       f"next tick")
                        continue
                    notes.append(f"{key}: decision ingest: {exc} — the cycle "
                                 f"is recorded; not retried")
                seen.pop("move_pending", None)
                written = write_record(root, record)
                if written not in result["written"]:
                    result["written"].append(written)
            continue
        # this item's answers: only ids whose ledger line is written are merged
        got: dict[str, dict] = {}
        pending: list[str] | None = None
        answered: dict[str, str] = {}
        still: dict[str, str] = {}
        failed = replied = move_pending = False
        try:
            ids, decisions = _issue_decisions(jira, key, entry, item)
            pending = [dw for dw in ids
                       if (record["answers"].get(dw) or {}).get("issue") != key]
            texts = _owner_texts(root, key, reason.get("created"))
            answered, still = parse_answers(texts, decisions, pending)
            if not ids:
                # never invented (plan Risks): no readable ids, nothing ingested
                still = {"the issue's DW ids": "not ingested: options unreadable"}
            for dw, letter in list(answered.items()):
                option = next(o for o in decisions[dw]["options"]
                              if o.get("letter") == letter)
                try:
                    plansync.ledger_decide(root, dw, letter, option.get("text") or "",
                                           key, date=date)
                except (plansync.PlanSyncError, dwledger.LedgerDuplicateId,
                        dwledger.LedgerMissingId) as exc:
                    answered.pop(dw)
                    still[dw] = "ledger refused"
                    notes.append(f"{key}: {dw}: ledger-decide refused: {exc}")
                    continue
                got[dw] = {
                    "letter": letter, "text": option.get("text") or "",
                    "key": option.get("key") or "",
                    "label": option.get("label") or "",
                    "effect": option.get("effect") or "", "issue": key,
                    "date": date}
            jirabackend.add_comment(jira, key, reply_text(answered, decisions, still))
            replied = True
            _move(jira, owner, key, sorted(still, key=dw_number), notes, counts,
                  entry)
        except jirabackend.JiraError as exc:
            if track.transient(exc) and replied:
                # the reply is posted: the cycle is recorded with the move
                # pending, so the next tick retries only the move (no
                # second reply)
                move_pending = True
                result["retry"] = True
                partial.append(f"{key}: the move after the reply was "
                               f"interrupted ({exc}) — the reply stands; the "
                               f"move is retried next tick")
            elif track.transient(exc):
                # only a temporary failure leaves the cycle unrecorded
                result["retry"] = True
                partial.append(f"{key}: decision ingest interrupted ({exc}) — "
                               f"retried next tick")
                continue
            else:
                # not temporary: the cycle is recorded with what reached the
                # ledger, the failure noted, never retried (no second reply)
                failed = True
                notes.append(f"{key}: decision ingest: {exc} — the cycle is "
                             f"recorded; not retried")
        if failed:
            if pending is None:
                pending = [str(dw) for dw in (entry.get("ids") or [])] \
                    if is_studio_entry(entry) else []
            ingested = sorted(got, key=dw_number)
            missing = sorted((set(pending) | set(still)) - set(got), key=dw_number)
        else:
            ingested = sorted(answered, key=dw_number)
            missing = sorted(still, key=dw_number)
        # the reply is posted (or the item failed for good): the ids written
        # to the ledger are the record's answers now
        record["answers"].update(got)
        counts["decisions_ingested"] += len(ingested)
        cycle = {"block_comment": cycle_id,
                 "at": now.isoformat(timespec="seconds"),
                 "ingested": ingested, "missing": missing}
        if move_pending:
            cycle["move_pending"] = True
        if is_studio_entry(entry):
            entry.setdefault("cycles", []).append(cycle)
        else:
            # a legacy entry is kept as it is: its cycles live beside it
            record.setdefault("legacy_cycles", []).append({"issue": key, **cycle})
        written = write_record(root, record)
        if written not in result["written"]:
            result["written"].append(written)
    return partial
