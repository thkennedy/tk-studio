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

Deltas (ST-9.2, Epic 9): a handoff optionally carries deltas[] — the closed
correction shape from contracts/knowledge.schema.json ({anchor, verdict
WRONG|STALE|CONFIRMED, reality, evidence, tier run-local|spine}) — validated
by lib/knowledge.py against the run workspace's seed.md (available set =
defined + inherited anchors). Unanchored and dangling deltas are named
rejections, never silently dropped; a workspace with no seed has no anchors,
so any delta against it dangles by construction. Aid, not gate: only the
delta-carrying handoff is refused — the run stays resumable and a handoff
without deltas always lands regardless of seed state.

Budget ruling (ST-9.2, made here): the 16 KB handoff budget does NOT grow —
deltas share it. Deltas are pointers, not essays (reality/evidence stay
compact; the byte budget enforces the total), and the list is capped at
MAX_HANDOFF_DELTAS: a boundary carrying more than 16 corrections is not a
handoff, it is a sign the seed needs re-research.

Capture (ST-9.4): a delta-carrying handoff is also captured into the
per-project reconciliation queue at the boundary (lib/reconcile.py,
best-effort — the handoff never fails on a capture problem; the result
rides the response's `capture` key). Boundary capture exists because
handoff.json is overwritten per boundary: without it, a mid-run boundary's
corrections would vanish when the next boundary lands. The wrapper's finish
captures again at run close; the queue's dedupe key makes both hooks
idempotent. Duplicate identical deltas within one handoff (same anchor,
verdict, reality, tier — the 9.2 review's deferred finding) are a named
rejection: one correction, stated once.

Run selection: both verbs take exactly one of --run-id or --job-id. A driver
that submitted a job knows the job id, not the minted run id; --job-id
resolves the job's sole resumable run (zero or several → named refusal,
never a guess) — mirrors the §4 status verb's {job_id, run_id?} shape.

The run stays in its resumable state across the split: ending the *session*
never ends the *run* (finish/cancel do that, through jobrun).

CLI:
  uv run session.py handoff --directory DIR (--run-id RID | --job-id JID)
                            --boundary KIND --name NAME
                            --done ITEM [--done ITEM ...]
                            --next ITEM [--next ITEM ...]
                            [--gotcha ITEM ...] [--artifact PATH ...]
                            [--delta JSON ...]
  uv run session.py resume  --directory DIR (--run-id RID | --job-id JID)

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
import knowledge
import reconcile as reconcilelib

HANDOFF_NAME = "handoff.json"
SEED_NAME = "seed.md"
BOUNDARY_KINDS = ("epic", "story", "phase", "budget")
MAX_HANDOFF_BYTES = 16384
# Budget ruling (ST-9.2): deltas share the 16 KB, list length capped —
# 16 pointer-shaped deltas cost well under a third of the budget.
MAX_HANDOFF_DELTAS = 16

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


def resolve_run_id(project_root: Path, run_id: str | None,
                   job_id: str | None) -> str:
    """Exactly one selector. A driver that submitted a job knows the job id,
    not the minted run id; --job-id resolves the job's sole resumable run —
    zero or several is a named refusal, never a guess (AD-11)."""
    if bool(run_id) == bool(job_id):
        raise SessionError("exactly one of --run-id or --job-id selects the "
                           "run")
    if run_id:
        return run_id
    key = joblib.project_key(Path(project_root))
    candidates = [r for r in joblib.list_runs(key, job_id=job_id)
                  if r.get("state") in joblib.RESUMABLE_STATES]
    if not candidates:
        raise SessionError(f"job '{job_id}' has no resumable run for "
                           f"project '{key}'")
    if len(candidates) > 1:
        ids = ", ".join(r["run_id"] for r in candidates)
        raise SessionError(f"job '{job_id}' has {len(candidates)} resumable "
                           f"runs ({ids}) — name the run id explicitly")
    return candidates[0]["run_id"]


def _validated_deltas(deltas, workspace: Path) -> list[dict]:
    """The closed correction shape, checked against the workspace's seed.
    Every problem is a named rejection (invariant 3) — the handoff refuses,
    the run is untouched."""
    items = list(deltas or [])
    if not items:
        return []
    if not all(isinstance(d, dict) for d in items):
        raise SessionError("each delta must be a JSON object (the closed "
                           "shape: anchor, verdict, reality, evidence, tier)")
    if len(items) > MAX_HANDOFF_DELTAS:
        raise SessionError(
            f"handoff carries {len(items)} deltas (max {MAX_HANDOFF_DELTAS})"
            " — deltas are pointers; a boundary with more corrections than "
            "that needs the seed re-researched, not a bigger handoff")
    seen: dict[tuple, int] = {}
    for index, delta in enumerate(items):
        key = knowledge.delta_key(delta)
        if key in seen:
            raise SessionError(
                f"deltas[{seen[key]}] and deltas[{index}] are the same "
                f"correction (anchor '{key[0]}', same verdict, reality, "
                "and tier) — one correction, stated once (the queue "
                "dedupes on (run_id, anchor, verdict, reality, tier); an "
                "identical repeat adds nothing)")
        seen[key] = index
    seed_path = workspace / SEED_NAME
    seed_text = ""
    if seed_path.is_file():
        try:
            seed_text = seed_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            # UnicodeDecodeError is a ValueError, not an OSError — a
            # UTF-16/ANSI-re-encoded seed (the PowerShell default trap)
            # must refuse named, never die with a traceback (AD-11).
            raise SessionError(f"{SEED_NAME} unreadable: {exc}") from exc
    verdict = knowledge.validate_deltas(items, seed_text)
    if not verdict["valid"]:
        context = ("" if seed_path.is_file() else
                   f" [workspace has no {SEED_NAME} — no anchors exist to "
                   "cite]")
        raise SessionError("deltas rejected, never silently dropped"
                           f"{context}: " + "; ".join(verdict["errors"]))
    return items


def write_handoff(project_root: Path, run_id: str, boundary_kind: str,
                  boundary_name: str, done, next_steps,
                  gotchas=(), artifacts=(), deltas=()) -> dict:
    """Land the boundary handoff and direct the session to end."""
    if boundary_kind not in BOUNDARY_KINDS:
        raise SessionError(
            f"boundary must be one of {'|'.join(BOUNDARY_KINDS)} — splits "
            "happen at declared boundaries, not arbitrary moments")
    if not isinstance(boundary_name, str) or not boundary_name.strip():
        raise SessionError("the boundary needs a name (e.g. 'ST-6.6', "
                           "'token budget 80%')")
    key, record = _open_run(project_root, run_id)
    workspace = joblib.workspace_path(key, run_id)
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
        "deltas": _validated_deltas(deltas, workspace),
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
    result = {"handoff": handoff, "path": str(path), "bytes": size,
              "directive": END_DIRECTIVE}
    if handoff["deltas"]:
        # boundary capture (ST-9.4): the next boundary overwrites this
        # handoff, so its corrections go durable now. Best-effort — the
        # handoff already landed; a capture problem is reported, not raised.
        try:
            result["capture"] = reconcilelib.capture(key, run_id)
        except Exception as exc:
            result["capture"] = {"captured": 0, "errors": [str(exc)]}
    return result


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
    hand.add_argument("--run-id", help="the run (or select via --job-id)")
    hand.add_argument("--job-id", help="the job whose sole resumable run "
                                       "this hands off")
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
    hand.add_argument("--delta", action="append", default=[],
                      dest="deltas", metavar="JSON",
                      help="one delta object (knowledge.schema.json shape); "
                           "repeatable")

    res = sub.add_parser("resume", help="continue from a workspace alone")
    res.add_argument("--directory", required=True, help="project root")
    res.add_argument("--run-id", help="the run (or select via --job-id)")
    res.add_argument("--job-id", help="the job whose sole resumable run "
                                      "this resumes")

    args = parser.parse_args(argv)
    try:
        root = Path(args.directory)
        run_id = resolve_run_id(root, args.run_id, args.job_id)
        if args.command == "handoff":
            deltas = []
            for raw in args.deltas:
                try:
                    deltas.append(json.loads(raw))
                except json.JSONDecodeError as exc:
                    raise SessionError(
                        f"--delta is not valid JSON ({exc}) — pass one "
                        "object per flag, the knowledge.schema.json shape")
            result = write_handoff(root, run_id,
                                   args.boundary, args.name, args.done,
                                   args.next_steps, gotchas=args.gotchas,
                                   artifacts=args.artifacts, deltas=deltas)
        else:
            result = read_resume(root, run_id)
    except (SessionError, joblib.JobError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
