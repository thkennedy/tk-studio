"""tk-studio trial meter: every landed story carries its price and its time (ST-24.1).

At the landed-story boundary (bmad-loop `post_commit`, via the studio-pipeline
plugin's meter_hook.py) the meter:

  1. collect  copies the story's session transcripts and their subagent
              transcripts (`agent-*.jsonl` + `agent-*.meta.json`) into
              `<run_dir>/transcripts/<story_key>/<task_id>/` -- the run dir
              sits in the mounted checkout (gitignored), so the copies reach
              the host even when the engine runs inside a microVM;
  2. price    prices every usage record (deduped by `message.id`) against the
              committed, dated, sourced `prices.json`, per model and per leg;
              a model missing from the table is a named refusal, never a guess;
  3. record   emits exactly one `observation` per story through
              observe.record_observation -> ledger.emit (AD-12), only after
              pricing succeeded, guarded by `transcripts/<key>/metered.json`.

Copy-out runs before the price table is loaded, so a bad table never costs
the transcripts. A refusal of the `story` command is also written, with its
UTC time, to `transcripts/<key>/meter-refusal.json` (the hook's stdout is not
kept); a later recorded run removes it. A refusal never emits an observation.

The journal's `tokens` / `tokens_weighted` counters are never used for dollars.

CLI:
  uv run meter.py story --run-dir D --story-key K [--repo-root R]
                        [--prices P] [--no-record]

Prints one JSON object. Exit codes: 0 ok; 2 refusal (`{"ok": false, "error": ...}`,
AD-11). Stdlib-only (NFR9); never prompts.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

import job
import ledger
import observe

PRICES_PATH = Path(__file__).resolve().parent / "prices.json"

LEGS = ("session", "implementer", "reviewers", "consult", "seam", "review",
        "triage", "supervise")
UNKNOWN_LEG = "unknown"
ROLE_LEGS = {"dev": "session", "review": "review", "triage": "triage"}
RATE_FIELDS = ("input", "output", "cache_write_5m", "cache_write_1h", "cache_read")
# The table prices standard usage only; any other value of these usage fields
# is a premium the table does not carry (usage field -> accepted values; an
# absent field is standard).
STANDARD_USAGE = {"speed": ("standard",), "service_tier": ("standard",),
                  "inference_geo": ("not_available", "global")}
# Per-request server tools the table carries no rate for (usage.server_tool_use).
SERVER_TOOL_FIELDS = ("web_search_requests", "web_fetch_requests")
MARKER = "metered.json"
REFUSAL = "meter-refusal.json"
MTOK = 1_000_000


class MeterError(Exception):
    """A refusal; the message is safe to surface and names what is missing."""


# ------------------------------------------------------------------ helpers

def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _atomic_copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=dst.parent, prefix=dst.name, suffix=".tmp")
    os.close(fd)
    try:
        shutil.copyfile(src, tmp)
        os.replace(tmp, dst)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _read_jsonl(path: Path) -> list[dict]:
    out: list[dict] = []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return out
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


def _read_json(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):  # ValueError covers JSON and UTF-8 decode errors
        return None
    return data if isinstance(data, dict) else None


def _task_role(task_id: str, story_key: str) -> str:
    """`<story_key>-<label>-<n>` -> label (any label, e.g. a plugin workflow's
    `studio-pipeline.gate`); an id with no `-<n>` suffix yields the whole rest.
    Labels other than dev/review/triage are priced under the `unknown` leg."""
    rest = task_id[len(story_key) + 1:] if task_id.startswith(story_key + "-") else ""
    m = re.match(r"^(.+)-\d+$", rest)
    return m.group(1) if m else rest


def _journal_roles(run_dir: Path) -> dict[str, str]:
    """task_id -> role from the engine's `session-start` journal lines. The
    engine writes the session's declared role there (a plugin workflow's own
    `role`, e.g. studio-pipeline.gate -> review), which the task id's label
    does not carry."""
    roles: dict[str, str] = {}
    for entry in _read_jsonl(Path(run_dir) / "journal.jsonl"):
        if entry.get("kind") != "session-start":
            continue
        task_id, role = entry.get("task_id"), entry.get("role")
        if isinstance(task_id, str) and isinstance(role, str) and role:
            roles[task_id] = role
    return roles


def _state_tasks(run_dir: Path) -> dict:
    tasks = (_read_json(Path(run_dir) / "state.json") or {}).get("tasks")
    return tasks if isinstance(tasks, dict) else {}


# ------------------------------------------------------------------ collect

def _story_sessions(run_dir: Path, story_key: str) -> dict[str, list[str]]:
    """task_id -> ordered, distinct transcript paths from the hook-relay events."""
    sessions: dict[str, list[str]] = {}
    events_dir = run_dir / "events"
    if not events_dir.is_dir():
        return sessions
    # Labels may contain '-', so a longer story key that extends this one
    # (`<key>-more-words`) would otherwise look like one of our task ids.
    longer_keys = [k for k in _state_tasks(run_dir)
                   if isinstance(k, str) and k.startswith(story_key + "-")]
    for path in sorted(events_dir.glob("*.json")):
        event = _read_json(path)
        if not event:
            continue
        task_id = event.get("task_id")
        transcript = event.get("transcript_path")
        if not isinstance(task_id, str) or not task_id.startswith(story_key + "-"):
            continue
        if any(task_id.startswith(k + "-") for k in longer_keys):
            continue
        paths = sessions.setdefault(task_id, [])
        if isinstance(transcript, str) and transcript and transcript not in paths:
            paths.append(transcript)
    return sessions


def collect(run_dir: Path, story_key: str) -> dict:
    """Copy the story's session + subagent transcripts into the run dir.

    Returns {"dir", "sessions": [{task_id, role, transcript, subagents}],
    "copied": n, "missing_transcripts": [path, ...]}. A session's role is its
    journal `session-start` role when the journal has one for its task id,
    else the task id's label. A source that no longer exists is listed by
    name; a copy already made by an earlier run stands in.
    """
    run_dir = Path(run_dir)
    dest_root = run_dir / "transcripts" / story_key
    sessions_out: list[dict] = []
    missing: list[str] = []
    copied = 0
    journal_roles = _journal_roles(run_dir)
    for task_id, paths in _story_sessions(run_dir, story_key).items():
        role = journal_roles.get(task_id) or _task_role(task_id, story_key)
        task_dir = dest_root / task_id
        attached: set[Path] = set()  # task_dir/subagents is shared by the task's sessions
        for transcript in paths:
            src = Path(transcript)
            dst = task_dir / src.name
            if src.is_file():
                _atomic_copy(src, dst)
                copied += 1
            elif not dst.is_file():
                missing.append(transcript)
                continue
            subagents: list[dict] = []
            src_sub = src.with_suffix("") / "subagents"
            if src_sub.is_dir():
                for item in sorted(src_sub.iterdir()):
                    if item.is_file() and item.name.startswith("agent-") and (
                            item.name.endswith(".jsonl") or item.name.endswith(".meta.json")):
                        _atomic_copy(item, task_dir / "subagents" / item.name)
                        copied += 1
            dst_sub = task_dir / "subagents"
            if dst_sub.is_dir():
                for item in sorted(dst_sub.glob("agent-*.jsonl")):
                    if item in attached:
                        continue
                    attached.add(item)
                    meta = _read_json(item.with_name(item.name[:-len(".jsonl")] + ".meta.json"))
                    subagents.append({"transcript": item, "meta": meta or {}})
            sessions_out.append({"task_id": task_id, "role": role,
                                 "transcript": dst, "subagents": subagents})
    return {"dir": dest_root, "sessions": sessions_out, "copied": copied,
            "missing_transcripts": missing}


# ------------------------------------------------------------------ legs

def leg_for(role: str, subagent_meta: dict | None = None) -> str:
    """The one place leg attribution lives (a heuristic; unknown is named).

    Session role: dev -> session, review -> review, triage -> triage, anything
    else -> unknown. A subagent of any known session (dev, review, triage) maps
    by its meta.json description/agentType first -- the workflow routes every
    consult and every reviewer layer to its own model whoever launches it:
    consult -> consult; a hunter / reviewer / review layer / auditor ->
    reviewers. Any other subagent of a known session -> implementer: the dev
    session launches the implementer, and the only other subagents a review or
    triage session launches are implementer relaunches on the implementer's
    model ("Apply review patches 24-1" -- `review patches` is not a reviewer
    layer). A subagent of an unknown-role session stays unknown. seam and
    supervise have no sessions yet and report 0.
    """
    base = ROLE_LEGS.get(role, UNKNOWN_LEG)
    if subagent_meta is None or base == UNKNOWN_LEG:
        return base
    text = " ".join(str(subagent_meta.get(k) or "")
                    for k in ("description", "agentType")).lower()
    if "consult" in text:
        return "consult"
    if re.search(r"hunter|reviewer|review layer|auditor", text):
        return "reviewers"
    return "implementer"


# ------------------------------------------------------------------ prices

def load_prices(path: Path | None = None) -> dict:
    path = Path(path) if path else PRICES_PATH
    data = _read_json(path)
    if data is None:
        raise MeterError(f"price table unreadable: {path}")
    if not data.get("date") or not data.get("source"):
        raise MeterError(f"price table {path} lacks its date or source")
    models = data.get("models")
    if not isinstance(models, dict) or not models:
        raise MeterError(f"price table {path} has no models")
    aliases = data.get("aliases")
    if aliases is not None:
        if not isinstance(aliases, dict):
            raise MeterError(f"price table {path}: 'aliases' is not an object")
        for alias, target in aliases.items():
            if not isinstance(target, str):
                raise MeterError(f"price table {path}: alias '{alias}' is not a model id string")
    for model, rates in models.items():
        if not isinstance(rates, dict):
            raise MeterError(f"price table {path}: model '{model}' is not an object")
        for field in RATE_FIELDS:
            if not isinstance(rates.get(field), (int, float)):
                raise MeterError(f"price table {path}: model '{model}' lacks '{field}'")
    return data


def _rates(prices: dict, model: str) -> dict | None:
    model = (prices.get("aliases") or {}).get(model, model)
    return prices["models"].get(model)


def _usage_records(transcript: Path) -> list[dict]:
    """Assistant usage records of one transcript: {id, model, usage}."""
    out = []
    for line in _read_jsonl(transcript):
        message = line.get("message")
        if not isinstance(message, dict) or not isinstance(message.get("usage"), dict):
            continue
        out.append({"id": message.get("id"), "model": message.get("model"),
                    "usage": message["usage"]})
    return out


def _int(value) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _server_tools(usage: dict) -> str | None:
    """`field=n` of the first non-zero per-request server tool count, else None."""
    counts = usage.get("server_tool_use")
    if not isinstance(counts, dict):
        return None
    for field in SERVER_TOOL_FIELDS:
        value = counts.get(field)
        if value is not None and value is not False and value != 0:
            return f"{field}={value}"
    return None


def _premium(usage: dict) -> str | None:
    """`field=value` of the first usage the table does not price: a
    non-standard pricing modifier or a non-zero server tool count; else None."""
    for field, accepted in STANDARD_USAGE.items():
        value = usage.get(field)
        if value is not None and value not in accepted:
            return f"{field}={value}"
    return _server_tools(usage)


def price(sources: list[tuple[str, Path]], prices: dict) -> dict:
    """Price usage from (leg, transcript) pairs.

    Dedupes by `message.id` before summing, keeping the LAST line of each id
    (Claude Code writes one line per content block and the final one carries
    the complete `output_tokens`); records without an id each count. Skips
    all-zero usage (Claude Code's `<synthetic>` lines) before the lookup. Raises MeterError naming
    every model absent from the table, and every model whose usage carries a
    non-standard speed / service_tier / inference_geo or a non-zero
    server_tool_use web_search_requests / web_fetch_requests count the table
    does not price (`model (speed=fast)`, `model (web_search_requests=2)`) --
    no partial dollars.
    """
    records: list[tuple[str, dict]] = []
    slot: dict = {}  # message.id -> index in records
    for leg, transcript in sources:
        for record in _usage_records(transcript):
            rid = record["id"]
            if rid is None:
                records.append((leg, record))
            elif rid in slot:
                records[slot[rid]] = (leg, record)
            else:
                slot[rid] = len(records)
                records.append((leg, record))
    tallies: list[tuple[str, str, dict]] = []
    missing: list[str] = []
    unpriced: list[str] = []  # "model (field=value)" of premium usage
    ttl_unknown = False
    for leg, record in records:
        usage = record["usage"]
        tokens = {
            "input": _int(usage.get("input_tokens")),
            "output": _int(usage.get("output_tokens")),
            "cache_read": _int(usage.get("cache_read_input_tokens")),
        }
        creation = _int(usage.get("cache_creation_input_tokens"))
        split = usage.get("cache_creation")
        if isinstance(split, dict):
            tokens["cache_write_5m"] = _int(split.get("ephemeral_5m_input_tokens"))
            tokens["cache_write_1h"] = _int(split.get("ephemeral_1h_input_tokens"))
            remainder = creation - tokens["cache_write_5m"] - tokens["cache_write_1h"]
            if remainder > 0:  # unsplit part: 5m rate, flagged like no split
                tokens["cache_write_5m"] += remainder
                ttl_unknown = True
        else:
            tokens["cache_write_5m"] = creation
            tokens["cache_write_1h"] = 0
            if creation:
                ttl_unknown = True
        if not any(tokens.values()) and not _server_tools(usage):
            continue
        model = record["model"] if isinstance(record["model"], str) else "<none>"
        if _rates(prices, model) is None:
            if model not in missing:
                missing.append(model)
            continue
        premium = _premium(usage)
        if premium:
            named = f"{model} ({premium})"
            if named not in unpriced:
                unpriced.append(named)
            continue
        model = (prices.get("aliases") or {}).get(model, model)
        tallies.append((leg, model, tokens))
    if missing or unpriced:
        raise MeterError(
            "no price for model(s) " + ", ".join(f"'{m}'" for m in missing + unpriced)
            + f" in the price table dated {prices.get('date')}; add them to "
            "prices.json from a sourced table, never a guess")
    by_model: dict[str, float] = {}
    by_leg: dict[str, float] = {leg: 0.0 for leg in LEGS}
    tokens_by_model: dict[str, dict] = {}
    total = 0.0
    for leg, model, tokens in tallies:
        rates = _rates(prices, model)
        usd = sum(tokens[f] * rates[f] for f in RATE_FIELDS) / MTOK
        total += usd
        by_model[model] = by_model.get(model, 0.0) + usd
        by_leg[leg] = by_leg.get(leg, 0.0) + usd
        agg = tokens_by_model.setdefault(model, {f: 0 for f in RATE_FIELDS})
        for f in RATE_FIELDS:
            agg[f] += tokens[f]
    if not by_leg.get(UNKNOWN_LEG):
        by_leg.pop(UNKNOWN_LEG, None)
    return {
        "usd_total": round(total, 6),
        "usd_by_model": {m: round(v, 6) for m, v in sorted(by_model.items())},
        "usd_by_leg": {leg: round(v, 6) for leg, v in by_leg.items()},
        "tokens_by_model": tokens_by_model,
        "ttl_unknown": ttl_unknown,
    }


# ------------------------------------------------------------------ timing / route

def timing(run_dir: Path, story_key: str) -> dict:
    """Wall-clock = this key's story-done.ts - its first session-start.ts."""
    first_start = None
    done = None
    for entry in _read_jsonl(Path(run_dir) / "journal.jsonl"):
        if entry.get("story_key") != story_key:
            continue
        ts = entry.get("ts")
        if not isinstance(ts, (int, float)) or isinstance(ts, bool):
            continue
        kind = entry.get("kind")
        if kind == "session-start" and (first_start is None or ts < first_start):
            first_start = ts
        elif kind == "story-done":
            done = ts
    wall = None
    if first_start is not None and done is not None:
        wall = round(done - first_start, 3)
    task = _state_tasks(run_dir).get(story_key)
    attempts = task.get("attempt") if isinstance(task, dict) else None
    if not isinstance(attempts, int) or isinstance(attempts, bool):
        attempts = None
    return {"wall_clock_s": wall, "attempts": attempts}


def route(repo_root: Path) -> dict | None:
    """Leg -> model map from `<repo_root>/.bmad-loop/routing.current.json`."""
    data = _read_json(Path(repo_root) / ".bmad-loop" / "routing.current.json")
    if data is None:
        return None
    return {leg: value["model"] for leg, value in data.items()
            if isinstance(value, dict) and isinstance(value.get("model"), str)}


# ------------------------------------------------------------------ record

def _pairs(mapping: dict | None) -> str:
    if not mapping:
        return "none"
    return ",".join(f"{k}:{v}" for k, v in mapping.items())


def _val(value) -> str:
    return "none" if value is None else str(value)


def describe(story_key: str, report: dict) -> str:
    return (f"meter: story={story_key} route={_pairs(report.get('route'))} "
            f"usd={report['usd_total']} usd_by_model={_pairs(report['usd_by_model'])} "
            f"usd_by_leg={_pairs(report['usd_by_leg'])} "
            f"wall_clock_s={_val(report['wall_clock_s'])} "
            f"attempts={_val(report['attempts'])} "
            f"missing_transcripts={len(report.get('missing_transcripts') or [])} "
            f"ttl_unknown={'true' if report.get('ttl_unknown') else 'false'} "
            f"prices_date={_val(report.get('prices_date'))}")


def record(run_dir: Path, story_key: str, report: dict, repo_root: Path) -> bool:
    """Emit one observation for the story unless its marker already exists.

    Returns True when an observation was emitted now.
    """
    marker = Path(run_dir) / "transcripts" / story_key / MARKER
    if marker.is_file():
        return False
    transcripts_dir = Path(run_dir) / "transcripts" / story_key
    try:
        evidence = Path(os.path.relpath(transcripts_dir.resolve(),
                                        Path(repo_root).resolve())).as_posix()
    except ValueError:  # different drive on Windows
        evidence = f"transcripts/{story_key}"
    observe.record_observation("other", describe(story_key, report),
                               evidence=evidence,
                               project=job.project_key(repo_root))
    _atomic_write_text(marker, json.dumps(
        {"story_key": story_key, "usd_total": report["usd_total"],
         "prices_date": report["prices_date"],
         "ttl_unknown": report["ttl_unknown"]}, indent=2) + "\n")
    return True


# ------------------------------------------------------------------ story

def meter_story(run_dir: Path, story_key: str, repo_root: Path | None = None,
                prices_path: Path | None = None, do_record: bool = True) -> dict:
    run_dir = Path(run_dir)
    if not run_dir.is_dir():
        raise MeterError(f"run dir not found: {run_dir}")
    if repo_root is None:
        parents = run_dir.resolve().parents
        if len(parents) < 3:
            raise MeterError(f"cannot infer the repo root from run dir {run_dir}; "
                             "pass --repo-root")
        repo_root = parents[2]
    repo_root = Path(repo_root)
    # Copy out first: on sbx the transcripts exist only inside the microVM,
    # and keeping them must not depend on the price table being readable.
    collected = collect(run_dir, story_key)
    if not collected["sessions"]:
        detail = (f"; missing transcripts: {', '.join(collected['missing_transcripts'])}"
                  if collected["missing_transcripts"] else "")
        raise MeterError(f"no session transcripts for story '{story_key}' in {run_dir}{detail}")
    prices = load_prices(prices_path)
    sources: list[tuple[str, Path]] = []
    for session in collected["sessions"]:
        sources.append((leg_for(session["role"]), session["transcript"]))
        for sub in session["subagents"]:
            sources.append((leg_for(session["role"], sub["meta"]), sub["transcript"]))
    priced = price(sources, prices)
    report = {
        "story_key": story_key,
        **priced,
        **timing(run_dir, story_key),
        "route": route(repo_root),
        "prices_date": prices["date"],
        "transcripts_dir": str(collected["dir"]),
        "copied": collected["copied"],
        "missing_transcripts": collected["missing_transcripts"],
        "sessions": [{"task_id": s["task_id"], "role": s["role"],
                      "leg": leg_for(s["role"]),
                      "subagents": {sub["transcript"].name: leg_for(s["role"], sub["meta"])
                                    for sub in s["subagents"]}}
                     for s in collected["sessions"]],
    }
    if do_record:
        report["recorded"] = record(run_dir, story_key, report, repo_root)
        if not report["recorded"]:
            report["already_recorded"] = True
        _clear_refusal(run_dir, story_key)  # the story is metered now
    else:
        report["recorded"] = False
    return report


def _refusal_path(run_dir: Path, story_key: str) -> Path:
    return Path(run_dir) / "transcripts" / story_key / REFUSAL


def _write_refusal(run_dir: Path, story_key: str, refusal: dict) -> None:
    """Keep a refusal visible after the run (the hook's stdout is discarded).
    Best effort: never changes the printed refusal or the exit code. Written
    only into a bmad-loop run dir (one holding its journal or events), never
    into an arbitrary directory a mistyped --run-dir names."""
    run_dir = Path(run_dir)
    if not story_key or not ((run_dir / "journal.jsonl").is_file()
                             or (run_dir / "events").is_dir()):
        return
    stamped = {**refusal, "ts": datetime.datetime.now(datetime.timezone.utc)
               .strftime("%Y-%m-%dT%H:%M:%SZ")}
    try:
        _atomic_write_text(_refusal_path(run_dir, story_key),
                           json.dumps(stamped, indent=2, ensure_ascii=False) + "\n")
    except OSError:
        pass


def _clear_refusal(run_dir: Path, story_key: str) -> None:
    try:
        _refusal_path(run_dir, story_key).unlink()
    except OSError:  # absent, or not removable: the success stands either way
        pass


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio trial meter")
    sub = parser.add_subparsers(dest="command", required=True)
    cmd = sub.add_parser("story", help="copy out, price, time and record one landed story")
    cmd.add_argument("--run-dir", required=True)
    cmd.add_argument("--story-key", required=True)
    cmd.add_argument("--repo-root", help="defaults to the run dir's checkout")
    cmd.add_argument("--prices", help="price table (defaults to lib/prices.json)")
    cmd.add_argument("--no-record", action="store_true",
                     help="price and report only; no ledger write, no marker")
    args = parser.parse_args(argv)
    try:
        report = meter_story(Path(args.run_dir), args.story_key,
                             repo_root=Path(args.repo_root) if args.repo_root else None,
                             prices_path=Path(args.prices) if args.prices else None,
                             do_record=not args.no_record)
    except (MeterError, ledger.LedgerError, OSError) as exc:
        refusal = {"ok": False, "error": str(exc)}
        print(json.dumps(refusal, ensure_ascii=False))
        _write_refusal(Path(args.run_dir), args.story_key, refusal)
        return 2
    print(json.dumps({"ok": True, **report}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
