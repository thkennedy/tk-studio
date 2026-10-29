"""tk-studio-report's rollup — the Stage Log read like a timesheet (Story 35.8, AC3).

Reads every `## Stage Log` row of a story (its spec) or of an epic (every
story spec keyed `<N>-…`, plus the epic's planning row on its plan entity)
and rolls them up, elapsed always derived from `started`/`ended`, never
read from a stored column:

  cycle_s         the first start to the merge row's end (null with no merge row)
  hands_on_s      the sum of the completed rows' spans, a row lying wholly
                  inside another engine row's span (a consult inside its
                  review pass) not counted twice (`nested_s`, `nested[]`);
                  it still counts in its own stage type's by_stage
  planning_share  the `plan` rows' spans over hands_on_s
  review_rounds   the `review` rows; reruns the `re-run` rows
  gaps[]          every stop followed by a later start: `gap <t1>..<t2>`, never hidden
  by_stage        rows, seconds, tokens_in, tokens_out and cost_usd per stage type

The epic's sums count each span once: a supervisor row (host-leg, re-run,
close-out, merge) one run appended to several stories' specs is matched on
stage, pass, started and ended and counted once in hands_on_s, reruns and
by_stage, and the nesting rule runs over every story's rows together, so a
row wholly inside another story's engine row (a plan made in another story's
gate session) is nested_s, never hands_on_s or planning_s. The per-story
rollups under `stories` are each story's own rows, unchanged.
  jira            the stamps `stage-post` recorded in
                  `_bmad-output/tracking/stage-posts.json`: per boundary the
                  comment's server `created` minus the body's own timestamp
                  (relay lag plus clock skew), the max named

`--post --id <epic entity>` adds one rollup comment to the epic's Jira issue,
idempotent by the marker `[stage-rollup:epic-<N>]` (GET comments first); a
project not bound to Jira posts nothing (`posted: "skipped: not bound"`).

CLI:
  uv run report.py rollup --directory ROOT (--story KEY | --epic N)
                          [--post --id EP-NNN]

Prints one JSON object ending in the AD-11 status block (intent
`tk-studio-report`). Exit 0 ok; 2 refusal or a failed post. Stdlib-only
(NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import config as configlib
import jirabackend
import plansync

INTENT = "tk-studio-report"
NO = plansync.NO_VALUE
# Rows not written by the engine hook: the operator's plan, the supervisor's legs.
NON_ENGINE_STAGES = frozenset({"plan", "host-leg", "re-run", "close-out", "merge"})
# The supervisor's run-level rows: one run resolving several stories appends the same ones to each.
SUPERVISOR_STAGES = frozenset({"host-leg", "re-run", "close-out", "merge"})


class RollupError(Exception):
    """A refusal; the message is safe to surface."""


def _number(cell: str) -> float | None:
    if cell in (None, "", NO):
        return None
    try:
        return float(cell)
    except ValueError:
        return None


def _iso(moment: datetime | None) -> str | None:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ") if moment else None


def _created(value) -> datetime | None:
    """A Jira `created` stamp (`2026-10-28T23:41:05.123+0000`) as a datetime."""
    if not isinstance(value, str) or not value:
        return None
    text = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", value.replace("Z", "+00:00"))
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _spans(rows: list[dict]) -> list[tuple[datetime, datetime] | None]:
    out = []
    for row in rows:
        start = plansync.stage_moment(row["started"])
        end = plansync.stage_moment(row["ended"])
        out.append((start, end) if start and end and end >= start else None)
    return out


def _container(i: int, rows: list[dict], spans: list) -> int | None:
    """The engine row whose span wholly holds row i's (the widest such),
    or None. Of two equal spans the earlier row holds the later."""
    if spans[i] is None:
        return None
    start, end = spans[i]
    best = None
    for j, other in enumerate(rows):
        if j == i or spans[j] is None or other["stage"] in NON_ENGINE_STAGES:
            continue
        o_start, o_end = spans[j]
        if not (o_start <= start and end <= o_end):
            continue
        if (o_start, o_end) == (start, end) and j > i:
            continue
        if best is None or (spans[j][1] - spans[j][0]) > (spans[best][1] - spans[best][0]):
            best = j
    return best


def rollup(sid: str, rows: list[dict], posts: dict) -> dict:
    """One story's (or one row set's) rollup — see the module docstring."""
    keyed = [(plansync.stage_row_key(sid, r), r) for r in rows]
    spans = _spans(rows)
    nested = []
    starts = [plansync.stage_moment(r["started"]) for _, r in keyed]
    starts = [s for s in starts if s]
    merges = [plansync.stage_moment(r["ended"]) for _, r in keyed
              if r["stage"] == "merge" and plansync.stage_moment(r["ended"])]
    first = min(starts) if starts else None
    merged = max(merges) if merges else None
    hands_on = plan = 0
    by_stage: dict[str, dict] = {}
    for i, (_, row) in enumerate(keyed):
        span = plansync.stage_span_seconds(row)
        agg = by_stage.setdefault(row["stage"], {"rows": 0, "seconds": 0,
                                                 "tokens_in": 0, "tokens_out": 0,
                                                 "cost_usd": 0.0})
        agg["rows"] += 1
        for field in ("tokens_in", "tokens_out"):
            value = _number(row[field])
            if value is not None:
                agg[field] += int(value)
        cost = _number(row["cost_usd"])
        if cost is not None:
            agg["cost_usd"] = round(agg["cost_usd"] + cost, 6)
        if span is not None:
            agg["seconds"] += span
            within = _container(i, rows, spans)
            if within is not None:  # already inside a counted span
                holder = rows[within]
                nested.append({"stage": row["stage"], "pass": row["pass"],
                               "seconds": span, "within": f"{holder['stage']} {holder['pass']}"})
                continue
            hands_on += span
            if row["stage"] == "plan":
                plan += span
    gaps = []
    latest: tuple[datetime, dict] | None = None
    for _, row in sorted(keyed, key=lambda kr: kr[1]["started"]):
        start = plansync.stage_moment(row["started"])
        if latest is not None and start and start > latest[0]:
            gaps.append({"from": _iso(latest[0]), "to": _iso(start),
                         "seconds": int((start - latest[0]).total_seconds()),
                         "after": f"{latest[1]['stage']} {latest[1]['pass']}",
                         "before": f"{row['stage']} {row['pass']}",
                         "line": f"gap {_iso(latest[0])}..{_iso(start)}"})
        end = plansync.stage_moment(row["ended"])
        if end and (latest is None or end > latest[0]):
            latest = (end, row)
    skews = []
    for key, row in keyed:
        entry = posts.get(key) if isinstance(posts.get(key), dict) else {}
        for boundary, column in (("start", "started"), ("stop", "ended")):
            created = _created((entry.get(boundary) or {}).get("created"))
            body = plansync.stage_moment(row[column])
            if created and body:
                skews.append({"row_key": key, "stage": row["stage"],
                              "pass": row["pass"], "boundary": boundary,
                              "body": row[column],
                              "created": entry[boundary]["created"],
                              "skew_s": round((created - body).total_seconds(), 3)})
    stamps = [_created(s["created"]) for s in skews]
    stamps = [s for s in stamps if s]
    return {
        "rows": len(keyed),
        "first_start": _iso(first), "merged": _iso(merged),
        "cycle_s": int((merged - first).total_seconds()) if first and merged else None,
        "hands_on_s": hands_on,
        "nested_s": sum(n["seconds"] for n in nested), "nested": nested,
        "planning_s": plan,
        "planning_share": round(plan / hands_on, 4) if hands_on else None,
        "review_rounds": sum(1 for _, r in keyed if r["stage"] == "review"),
        "reruns": sum(1 for _, r in keyed if r["stage"] == "re-run"),
        "gaps": gaps,
        "by_stage": by_stage,
        "jira": {
            "posted_boundaries": len(skews),
            "first_created": min(stamps).isoformat() if stamps else None,
            "last_created": max(stamps).isoformat() if stamps else None,
            "cycle_s": int((max(stamps) - min(stamps)).total_seconds()) if stamps else None,
            "skews": skews,
            "max_skew": max(skews, key=lambda s: abs(s["skew_s"])) if skews else None,
        },
    }


def _epic_entity(root: Path, epic: int) -> str | None:
    plans = plansync.plan_dir(root)
    if not plans.is_dir():
        return None
    for path in sorted(plans.glob("EP-*.md")):
        try:
            front, _ = plansync.interchange.parse_entity(path)
        except plansync.interchange.InterchangeError:
            continue
        if str(front.get("source") or "").strip() == f"epics.md#epic-{epic}":
            return front.get("id") if isinstance(front.get("id"), str) else path.stem
    return None


def _epic_spans(rows: list[dict]) -> list[dict]:
    """The epic's rows with each span once: a supervisor row (host-leg, re-run,
    close-out, merge) on several stories' specs — one run resolving them all —
    kept once, matched on stage, pass, started and ended."""
    out, seen = [], set()
    for row in rows:
        if row["stage"] in SUPERVISOR_STAGES:
            occurrence = (row["stage"], row["pass"], row["started"], row["ended"])
            if occurrence in seen:
                continue
            seen.add(occurrence)
        out.append(row)
    return out


def rollup_epic(root: Path, epic: int, entity_id: str | None = None) -> dict:
    root = Path(root)
    posts = plansync.load_stage_posts(root)
    entity_id = entity_id or _epic_entity(root, epic)
    stories: dict[str, dict] = {}
    story_rows: list[dict] = []
    epic_rows: list[dict] = []
    for sid, path in plansync.stage_documents(root):
        rows = plansync.parse_stage_log(path.read_text(encoding="utf-8"))
        if entity_id and sid == entity_id:
            epic_rows = rows
        elif re.match(rf"^{epic}-\d+-", sid):
            stories[sid] = rollup(sid, rows, posts)
            story_rows.extend(rows)
    planning = rollup(entity_id, epic_rows, posts) if entity_id and epic_rows else None
    parts = list(stories.values()) + ([planning] if planning else [])
    if not parts:
        raise RollupError(f"rollup: no Stage Log rows for epic {epic} under "
                          f"{root}")
    starts = [p["first_start"] for p in parts if p["first_start"]]
    merges = [s["merged"] for s in stories.values() if s["merged"]]
    # Each span once across the stories: the shared supervisor rows kept once, and
    # the nesting rule applied over every story's rows together (a plan made inside
    # another story's gate session is nested, not hands-on or planning time).
    whole = rollup(f"epic-{epic}", _epic_spans(story_rows + epic_rows), {})
    hands_on = whole["hands_on_s"]
    plan = whole["planning_s"]
    skews = [s for p in parts for s in p["jira"]["skews"]]
    first = plansync.stage_moment(min(starts)) if starts else None
    last = plansync.stage_moment(max(merges)) if merges else None
    return {
        "epic": epic, "entity": entity_id,
        "first_start": min(starts) if starts else None,
        "merged": max(merges) if merges else None,
        "cycle_s": int((last - first).total_seconds()) if first and last else None,
        "hands_on_s": hands_on, "nested_s": whole["nested_s"],
        "planning_s": plan,
        "planning_share": round(plan / hands_on, 4) if hands_on else None,
        "review_rounds": sum(s["review_rounds"] for s in stories.values()),
        "reruns": whole["reruns"],
        "gaps": [{"story": sid, **g} for sid, s in stories.items() for g in s["gaps"]],
        "by_stage": whole["by_stage"],
        "max_skew": max(skews, key=lambda s: abs(s["skew_s"])) if skews else None,
        "planning": planning, "stories": stories,
    }


def rollup_story(root: Path, story: str) -> dict:
    target, sid = plansync._stage_target(Path(root), story, None)
    if target is None:
        raise RollupError(f"rollup: no spec for story {sid}")
    rows = plansync.parse_stage_log(target.read_text(encoding="utf-8"))
    out = rollup(sid, rows, plansync.load_stage_posts(Path(root)))
    out["story"] = sid
    out["max_skew"] = out["jira"]["max_skew"]
    return out


def _hours(seconds) -> str:
    return "—" if seconds is None else f"{seconds / 3600:.2f} h"


def rollup_comment(epic: int, data: dict) -> str:
    tokens_in = sum(a["tokens_in"] for a in data["by_stage"].values())
    tokens_out = sum(a["tokens_out"] for a in data["by_stage"].values())
    cost = sum(a["cost_usd"] for a in data["by_stage"].values())
    share = data["planning_share"]
    skew = data.get("max_skew")
    return (f"Epic {epic} rollup — cycle: {_hours(data['cycle_s'])}; hands-on: "
            f"{_hours(data['hands_on_s'])}; planning share: "
            f"{'—' if share is None else f'{share * 100:.1f}%'}; review rounds: "
            f"{data['review_rounds']}; re-runs: {data['reruns']}; gaps: "
            f"{len(data['gaps'])}; tokens: {tokens_in}/{tokens_out}; cost: "
            f"${cost:.2f}; max skew: "
            f"{'—' if not skew else str(skew['skew_s']) + ' s'} "
            f"[stage-rollup:epic-{epic}]")


def post_rollup(root: Path, epic: int, entity_id: str, data: dict,
                transport=None) -> dict:
    """One idempotent rollup comment on the epic's issue (the retro's)."""
    root = Path(root)
    if plansync._recorded(root, "planning.jira.project_key") is None:
        return {"posted": "skipped: not bound"}
    issue = plansync._jira_issue_of(root, entity_id)
    settings, gaps = jirabackend._resolve_settings(root, None)
    if not os.environ.get(jirabackend.AGENT_TOKEN_ENV) \
            and not os.environ.get(jirabackend.TOKEN_ENV):
        gaps.insert(0, f"{jirabackend.AGENT_TOKEN_ENV} is not set (the agent "
                       f"seat's Jira token)")
    if gaps:
        raise RollupError("rollup --post refused: " + "; ".join(gaps)
                          + " — no Atlassian call made")
    client = jirabackend.client_for(settings, transport)
    marker = f"[stage-rollup:epic-{epic}]"
    for comment in jirabackend.list_comments(client, issue):
        if marker in str(comment.get("body") or ""):
            return {"posted": "already", "issue": issue,
                    "comment": {"id": str(comment.get("id")),
                                "created": comment.get("created")}}
    made = jirabackend.add_comment(client, issue, rollup_comment(epic, data))
    return {"posted": "posted", "issue": issue,
            "comment": {"id": str(made.get("id")), "created": made.get("created")}}


def _finish(result: dict, status: str, reason: str | None) -> dict:
    result["ok"] = status == "complete"
    result.update({"status": status, "intent": INTENT, "artifacts": [],
                   "reason": reason})
    return result


def run_rollup(root: Path, story: str | None = None, epic: int | None = None,
               post: bool = False, entity_id: str | None = None,
               transport=None) -> dict:
    result: dict = {}
    try:
        if (story is None) == (epic is None):
            raise RollupError("rollup needs exactly one of --story or --epic")
        if story is not None:
            if post:
                raise RollupError("rollup --post rolls an epic up: use --epic")
            result["rollup"] = rollup_story(root, story)
        else:
            result["rollup"] = rollup_epic(root, epic, entity_id)
            if post:
                target = entity_id or result["rollup"]["entity"]
                if not target:
                    raise RollupError(f"rollup --post: no plan entity for epic "
                                      f"{epic} — pass --id EP-NNN")
                result["post"] = post_rollup(root, epic, target, result["rollup"],
                                             transport)
        return _finish(result, "complete", None)
    except (RollupError, plansync.PlanSyncError) as exc:
        return _finish(result, "blocked", str(exc))
    except jirabackend.JiraError as exc:
        return _finish(result, "blocked", f"rollup --post failed: {exc}")
    except Exception as exc:  # a read or transport fault: never a traceback
        result["retryable"] = True  # not a refusal: the caller may try again
        return _finish(result, "blocked", f"rollup: {type(exc).__name__}: {exc}")


def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio Stage Log rollup")
    sub = parser.add_subparsers(dest="command", required=True)
    rol = sub.add_parser("rollup")
    rol.add_argument("--directory", required=True)
    rol.add_argument("--story", default=None)
    rol.add_argument("--epic", type=int, default=None)
    rol.add_argument("--post", action="store_true")
    rol.add_argument("--id", dest="entity_id", default=None,
                     help="the epic's plan entity (its external.jira.key)")
    args = parser.parse_args(argv)
    root = configlib.find_project_root(Path(args.directory))
    result = run_rollup(root, story=args.story, epic=args.epic, post=args.post,
                        entity_id=args.entity_id)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    sys.exit(main())
