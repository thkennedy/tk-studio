"""tk-studio reconciliation — delta capture, queue, and routing (ST-9.4,
Epic 9).

The fs half of the capture story: handoff deltas (the closed
contracts/knowledge.schema.json shape, validated at handoff time by
lib/session.py) become durable queue lines in the per-project
reconciliation queue, and a routing doc renders beside it for the human who
decides what promotes. Provisional knowledge stays in the per-user store
(AD-3) — the queue and routing doc live at

    ~/.tk-studio/projects/<key>/knowledge/reconciliation-queue.jsonl
    ~/.tk-studio/projects/<key>/knowledge/reconciliation-routing.md

and never touch the project VCS; only *promoted* knowledge crosses, as
ordinary kb/ files through a PR (ST-9.5, D3).

  capture   read a run workspace's handoff.json and append its deltas[] to
            the queue as knowledge.schema.json queue lines, deduped on
            (run_id, anchor, verdict, reality). The queue is append-only:
            capture never rewrites a line, and a pre-existing unparseable
            line is reported, never dropped or repaired. Idempotent by the
            dedupe key, so it safely rides every hook: the executing
            wrapper's finish/cancel/core-close (lib/jobrun.py) and each
            boundary handoff (lib/session.py) — a mid-run boundary's
            corrections survive the next boundary overwriting handoff.json.
            Malformed deltas (a hand-edited handoff) are named rejections
            in the result; valid ones still land.
  route     render the routing doc from the queue — a pure render
            (knowledge.render_routing) that APPLIES NOTHING: spine-tier
            corrections lead, WRONG|STALE|CONFIRMED inside each tier,
            invalid queue lines surfaced in their own section. An absent or
            empty queue answers rendered=false — nothing to route is an
            answer, not an error.

CLI:
  uv run reconcile.py capture --directory DIR --run-id RID
  uv run reconcile.py route   --directory DIR

Exit codes: 0 ok; 2 unknown run / unreadable handoff / bad invocation;
1 unexpected failure. Env: TK_STUDIO_HOME overrides the store root (tests).
Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import job as joblib
import knowledge
import store as storelib

QUEUE_NAME = "reconciliation-queue.jsonl"
ROUTING_NAME = "reconciliation-routing.md"
HANDOFF_NAME = "handoff.json"


class ReconcileError(Exception):
    """Unreadable handoff or queue refusal; message is safe to surface."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def knowledge_dir(key: str) -> Path:
    return storelib.store_root() / "projects" / key / "knowledge"


def queue_path(key: str) -> Path:
    return knowledge_dir(key) / QUEUE_NAME


def routing_path(key: str) -> Path:
    return knowledge_dir(key) / ROUTING_NAME


def _locked_append(path: Path, text: str) -> None:
    """Append under an exclusive OS lock, flushed and fsync'd — the ledger's
    append discipline (AD-12 pattern): concurrent captures never interleave
    or lose lines, and the file is only ever appended to."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8", newline="\n") as handle:
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try:
                handle.seek(0, os.SEEK_END)
                handle.write(text)
                handle.flush()
                os.fsync(handle.fileno())
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                handle.write(text)
                handle.flush()
                os.fsync(handle.fileno())
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def read_queue(key: str) -> dict:
    """The queue as data: {path, lines[], invalid[]} — an unparseable or
    shape-invalid line is reported with its 1-based line number, never
    dropped, never repaired (append-only means the file is never rewritten;
    a bad line stays visible until a human deals with it)."""
    path = queue_path(key)
    result: dict = {"path": str(path), "lines": [], "invalid": []}
    if not path.is_file():
        return result
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ReconcileError(f"{QUEUE_NAME} unreadable: {exc}") from exc
    for number, text in enumerate(raw.splitlines(), start=1):
        if not text.strip():
            continue
        try:
            line = json.loads(text)
        except json.JSONDecodeError as exc:
            result["invalid"].append({"line": number,
                                      "error": f"not valid JSON: {exc}"})
            continue
        problems = knowledge.validate_queue_line(line)
        if problems:
            result["invalid"].append({"line": number,
                                      "error": "; ".join(problems)})
            continue
        result["lines"].append(line)
    return result


def capture(key: str, run_id: str) -> dict:
    """Append a run's handoff deltas to the project queue, deduped.

    Works on any run that has a workspace — resumable (a boundary capture)
    or terminal (the wrapper's finish hook): corrections stay true whatever
    the run's outcome. No handoff, or a handoff without deltas, captures
    zero — an answer, never an error (aid, not gate)."""
    joblib.read_run(key, run_id)  # unknown run refuses named, via joblib
    handoff_path = joblib.workspace_path(key, run_id) / HANDOFF_NAME
    result: dict = {"run_id": run_id, "queue": str(queue_path(key)),
                    "deltas": 0, "captured": 0, "duplicates": 0,
                    "rejected": []}
    if not handoff_path.is_file():
        result["note"] = f"no {HANDOFF_NAME} in the run workspace — nothing " \
                         "to capture"
        return result
    try:
        handoff = json.loads(handoff_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReconcileError(f"{HANDOFF_NAME} unreadable: {exc}") from exc
    deltas = handoff.get("deltas") if isinstance(handoff, dict) else None
    if not isinstance(deltas, list) or not deltas:
        result["note"] = "handoff carries no deltas — nothing to capture"
        return result
    result["deltas"] = len(deltas)

    existing = read_queue(key)
    seen = {knowledge.queue_key(line) for line in existing["lines"]}
    if existing["invalid"]:
        result["queue_invalid"] = existing["invalid"]
    captured_at = _now()
    fresh: list[dict] = []
    for index, delta in enumerate(deltas):
        line = {
            "run_id": run_id,
            "captured_at": captured_at,
            **{field: (delta.get(field) if isinstance(delta, dict) else None)
               for field in ("anchor", "verdict", "reality", "evidence",
                             "tier")},
        }
        problems = knowledge.validate_queue_line(line)
        if problems:
            # a hand-edited handoff.json is the only way here — the session
            # surface validated deltas at write time (named, never silent)
            result["rejected"].append({"delta": index,
                                       "error": "; ".join(problems)})
            continue
        line_key = knowledge.queue_key(line)
        if line_key in seen:
            result["duplicates"] += 1
            continue
        seen.add(line_key)
        fresh.append(line)
    if fresh:
        _locked_append(queue_path(key), "".join(
            json.dumps(line, ensure_ascii=False, separators=(",", ":")) + "\n"
            for line in fresh))
    result["captured"] = len(fresh)
    return result


def capture_run(project_root: Path, run_id: str) -> dict:
    return capture(joblib.project_key(Path(project_root)), run_id)


def route(key: str) -> dict:
    """Render the routing doc beside the queue — pure render, applies
    nothing. An absent or empty queue answers rendered=false."""
    queue = read_queue(key)
    if not queue["lines"] and not queue["invalid"]:
        return {"rendered": False, "queue": queue["path"],
                "reason": "the reconciliation queue is empty — nothing to "
                          "route"}
    doc = knowledge.render_routing(queue["lines"], key, _now(),
                                   invalid=queue["invalid"])
    path = routing_path(key)
    joblib.atomic_write_text(path, doc)
    return {"rendered": True, "path": str(path), "queue": queue["path"],
            "entries": len({knowledge.queue_key(line)
                            for line in queue["lines"]}),
            "invalid": queue["invalid"]}


def route_project(project_root: Path) -> dict:
    return route(joblib.project_key(Path(project_root)))


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="tk-studio reconciliation (delta capture + queue + "
                    "routing)")
    sub = parser.add_subparsers(dest="command", required=True)

    cap = sub.add_parser("capture", help="append a run's handoff deltas to "
                                         "the project queue, deduped")
    cap.add_argument("--directory", required=True, help="project root")
    cap.add_argument("--run-id", required=True)

    rou = sub.add_parser("route", help="render the routing doc beside the "
                                       "queue (pure render, applies nothing)")
    rou.add_argument("--directory", required=True, help="project root")

    args = parser.parse_args(argv)
    try:
        if args.command == "capture":
            result = capture_run(Path(args.directory), args.run_id)
        else:
            result = route_project(Path(args.directory))
    except (ReconcileError, joblib.JobError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
