"""tk-studio session discipline — boundary handoffs, fresh-session resume
(ST-6.6, AD-10; spine: "long work splits at declared boundaries with compact
handoff artifacts; runs persist state in resumable run workspaces").

Two verbs, one contract:

  handoff   at a declared boundary (epic | story | phase) or a budget
            trigger, land handoff.json in the run workspace — what's done,
            what's next, what bites — update the run's checkpoint, and
            direct the session to END. Compact is enforced, not hoped for:
            an artifact past MAX_HANDOFF_BYTES refuses (a handoff that
            needs the full history is a history replay, the thing this
            exists to prevent). One handoff.json per run, overwritten at
            each boundary — the latest boundary is the resume point.
  resume    a fresh session pointed at a run workspace gets everything it
            needs from the workspace alone (success criterion 8): the run
            record (definition snapshot + checkpoint), the handoff, and the
            workspace file listing. Nothing outside the workspace is read;
            a terminal run refuses — there is nothing to resume.

The run stays in its resumable state across the split: ending the *session*
never ends the *run* (finish/cancel do that, through jobrun).

CLI:
  uv run session.py handoff --directory DIR --run-id RID
                            --boundary KIND --name NAME
                            --done ITEM [--done ITEM ...]
                            --next ITEM [--next ITEM ...]
                            [--gotcha ITEM ...] [--artifact PATH ...]
  uv run session.py resume  --directory DIR --run-id RID

Exit codes: 0 ok; 2 invalid boundary/handoff or unknown/terminal run;
1 unexpected failure. Env: TK_STUDIO_HOME overrides the store root (tests).
Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import job as joblib

HANDOFF_NAME = "handoff.json"
BOUNDARY_KINDS = ("epic", "story", "phase", "budget")
MAX_HANDOFF_BYTES = 16384

END_DIRECTIVE = {
    "end_session": True,
    "resume": "start a fresh session and run session.py resume against this "
              "workspace — it continues from handoff.json + run.json alone, "
              "never by replaying history",
}


class SessionError(Exception):
    """Invalid handoff or nothing to resume; message is safe to surface."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _str_list(value, label: str, required: bool) -> list[str]:
    items = list(value or [])
    if required and not items:
        raise SessionError(f"handoff.{label} must be a non-empty list — a "
                           "boundary with nothing to say is not a boundary")
    if not all(isinstance(v, str) and v.strip() for v in items):
        raise SessionError(f"handoff.{label} entries must be non-empty strings")
    return items


def _open_run(project_root: Path, run_id: str) -> tuple[str, dict]:
    key = joblib.project_key(Path(project_root))
    record = joblib.read_run(key, run_id)
    if record["state"] not in joblib.RESUMABLE_STATES:
        raise SessionError(f"run '{run_id}' ended {record['state']} — "
                           "nothing to hand off or resume")
    return key, record


def write_handoff(project_root: Path, run_id: str, boundary_kind: str,
                  boundary_name: str, done, next_steps,
                  gotchas=(), artifacts=()) -> dict:
    """Land the boundary handoff and direct the session to end."""
    if boundary_kind not in BOUNDARY_KINDS:
        raise SessionError(
            f"boundary must be one of {'|'.join(BOUNDARY_KINDS)} — splits "
            "happen at declared boundaries, not arbitrary moments")
    if not isinstance(boundary_name, str) or not boundary_name.strip():
        raise SessionError("the boundary needs a name (e.g. 'ST-6.6', "
                           "'token budget 80%')")
    key, record = _open_run(project_root, run_id)
    handoff = {
        "handoff_version": 1,
        "run_id": run_id,
        "job_id": record["job_id"],
        "boundary": {"kind": boundary_kind, "name": boundary_name.strip()},
        "created": _now(),
        "done": _str_list(done, "done", required=True),
        "next": _str_list(next_steps, "next", required=True),
        "gotchas": _str_list(gotchas, "gotchas", required=False),
        "artifacts": _str_list(artifacts, "artifacts", required=False),
    }
    size = len(json.dumps(handoff, ensure_ascii=False).encode("utf-8"))
    if size > MAX_HANDOFF_BYTES:
        raise SessionError(
            f"handoff is {size} bytes (max {MAX_HANDOFF_BYTES}) — compact "
            "means compact: point at artifacts instead of inlining them")
    path = joblib.write_workspace_json(key, run_id, HANDOFF_NAME, handoff)
    checkpoint = dict(record.get("checkpoint") or {})
    checkpoint["boundary"] = handoff["boundary"]
    checkpoint["handoffs"] = checkpoint.get("handoffs", 0) + 1
    joblib.update_run(key, run_id, {"checkpoint": checkpoint})
    return {"handoff": handoff, "path": str(path), "bytes": size,
            "directive": END_DIRECTIVE}


def read_resume(project_root: Path, run_id: str) -> dict:
    """Everything a fresh session needs, from the workspace alone."""
    key, record = _open_run(project_root, run_id)
    workspace = joblib.workspace_path(key, run_id)
    handoff_path = workspace / HANDOFF_NAME
    if not handoff_path.is_file():
        raise SessionError(f"run '{run_id}' has no {HANDOFF_NAME} — resume "
                           "follows a boundary handoff, never a guess")
    try:
        handoff = json.loads(handoff_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SessionError(f"{HANDOFF_NAME} unreadable: {exc}") from exc
    return {
        "run": record,
        "handoff": handoff,
        "workspace": str(workspace),
        "files": sorted(p.name for p in workspace.iterdir() if p.is_file()),
        "directive": {
            "continue_from": "handoff.next",
            "reads_outside_workspace": "none required — the run record "
                                       "snapshots the definition; artifacts "
                                       "are listed in the handoff",
        },
    }


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="tk-studio session discipline (boundary handoffs + "
                    "fresh-session resume)")
    sub = parser.add_subparsers(dest="command", required=True)

    hand = sub.add_parser("handoff", help="land a boundary handoff, end the "
                                          "session")
    hand.add_argument("--directory", required=True, help="project root")
    hand.add_argument("--run-id", required=True)
    hand.add_argument("--boundary", required=True,
                      choices=list(BOUNDARY_KINDS))
    hand.add_argument("--name", required=True,
                      help="the boundary itself, e.g. ST-6.6")
    hand.add_argument("--done", action="append", default=[], metavar="ITEM")
    hand.add_argument("--next", action="append", default=[], dest="next_steps",
                      metavar="ITEM")
    hand.add_argument("--gotcha", action="append", default=[],
                      dest="gotchas", metavar="ITEM")
    hand.add_argument("--artifact", action="append", default=[],
                      dest="artifacts", metavar="PATH")

    res = sub.add_parser("resume", help="continue from a workspace alone")
    res.add_argument("--directory", required=True, help="project root")
    res.add_argument("--run-id", required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "handoff":
            result = write_handoff(Path(args.directory), args.run_id,
                                   args.boundary, args.name, args.done,
                                   args.next_steps, gotchas=args.gotchas,
                                   artifacts=args.artifacts)
        else:
            result = read_resume(Path(args.directory), args.run_id)
    except (SessionError, joblib.JobError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
