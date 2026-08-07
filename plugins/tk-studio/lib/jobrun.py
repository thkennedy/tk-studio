"""tk-studio job wrapper — the §4 scheduler verbs on harness-native primitives
(ST-6.2, AD-10, AD-11, AD-12).

The job model is data (lib/job.py, ST-6.1); this module is the execution
half the driver contract fixes: submit / status / cancel / wake, plus the
two wrapper verbs the agent side of tk-studio-job uses to keep skill-target
runs honest (account, finish). Scheduling itself is delegated: recurring
triggers return a machine-readable *directive* the bound substrate (v1:
harness-native primitives — scheduled tasks, loop skills, self-paced
wakeups) binds outside this process. Nothing here owns a clock.

Guarantees implemented here, verbatim from the contract:

  - submit validates; a definition missing guards or stop conditions is
    rejected (accepted=false), never scheduled.
  - Budget guards and stop conditions terminate a run `partial` with the
    guard named in reason — a job never runs away. Wall-clock is enforced
    directly on core targets (subprocess timeout); turns/tokens are
    enforced through `account`, which the executing wrapper MUST call each
    iteration and MUST obey when it answers exceeded.
  - Stop conditions gate scheduling: submit and wake refuse (with the
    condition named) once max_runs / until / on_status holds.
  - A job declared durable records the requirement; a session-scoped
    binding surfaces the constraint in the submit response — the schedule
    is never silently lost.
  - Job-level events: this wrapper alone emits `job-run` (one event per
    terminal transition); target skills emit their own surface events —
    never both for one failure (AD-12).
  - Delta capture rides every terminal transition (ST-9.4): the run's
    handoff deltas append to the per-project reconciliation queue
    (lib/reconcile.py, deduped on the knowledge.schema.json key), the
    capture evidence lands in summary.json, and a capture failure is
    recorded there — never a masked verb, never a raised finish.

CLI (all verbs end with JSON on stdout; never prompts — AD-11):
  uv run jobrun.py submit  --directory DIR --id JOB_ID
  uv run jobrun.py status  --directory DIR --job-id ID [--run-id RID]
  uv run jobrun.py cancel  --directory DIR --job-id ID [--run-id RID]
  uv run jobrun.py wake    --directory DIR --job-id ID
  uv run jobrun.py account --directory DIR --run-id RID [--turns N] [--tokens N]
  uv run jobrun.py finish  --directory DIR --run-id RID --state STATE
                           [--reason R] [--status-block JSON]

Exit codes: 0 verb answered (including accepted=false / woken=false — a
refusal is an answer); 2 bad invocation or unknown id; 1 unexpected
failure. Env: TK_STUDIO_HOME overrides the store root (tests).
Stdlib-only (NFR9).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import job as joblib
import ledger
import reconcile as reconcilelib
import routing as routinglib

PLUGIN_ROOT = Path(__file__).resolve().parents[1]

DURABILITY_CONSTRAINT = (
    "durable-recurring on a session-scoped substrate: local harness "
    "schedules die with the session — bind this job to a cloud routine or "
    "an external harness via the driver contract, or re-submit each "
    "session (the definition records the requirement; nothing is "
    "silently kept or lost)")


class JobRunError(Exception):
    """Bad invocation or unknown id; verb refusals are answers, not errors."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _emit_job_event(record: dict, key: str, detail: str | None = None) -> None:
    """One job-run event per terminal transition — this wrapper is the sole
    emitter of job-level events (AD-12); emission never masks the verb."""
    payload = {
        "job_id": record["job_id"],
        "run_id": record["run_id"],
        "state": record["state"],
    }
    if record.get("reason"):
        payload["reason"] = record["reason"]
    if detail:
        payload["detail"] = detail
    if record.get("started") and record.get("ended"):
        elapsed = (_parse_iso(record["ended"])
                   - _parse_iso(record["started"])).total_seconds() * 1000
        payload["elapsed_ms"] = round(elapsed, 3)
    try:
        ledger.emit("job-run", payload, project=key)
    except Exception:
        pass


# ------------------------------------------------------------- scheduling

def evaluate_stop(defn: dict, runs: list[dict]) -> str | None:
    """The stop condition that currently forbids scheduling, or None."""
    stop = defn["stop"]
    counted = [r for r in runs if "error" not in r]
    if "max_runs" in stop and len(counted) >= stop["max_runs"]:
        return f"stop: max_runs ({stop['max_runs']}) reached"
    if "until" in stop and _now() >= _parse_iso(stop["until"]):
        return f"stop: until ({stop['until']}) passed"
    if "on_status" in stop and counted:
        last_state = counted[-1].get("state")
        if last_state in stop["on_status"]:
            return f"stop: on_status — last run ended {last_state}"
    return None


def _directive(defn: dict) -> dict:
    """What the substrate binds for a recurring (or deferred) trigger."""
    trigger = defn["trigger"]
    if trigger == "one-shot":
        return {"kind": "at", "at": defn["at"]} if defn.get("at") else \
               {"kind": "immediate"}
    cadence = defn["cadence"]
    if trigger == "cron":
        return {"kind": "cron", "schedule": cadence["schedule"]}
    if cadence["mode"] == "fixed":
        return {"kind": "loop", "interval_seconds": cadence["interval_seconds"]}
    directive = {"kind": "self-paced"}
    if "hint_seconds" in cadence:
        directive["hint_seconds"] = cadence["hint_seconds"]
    return directive


def _tilde(path: Path) -> str:
    """Home-relativize a per-user-store path for emission (~/... — the §1
    sanitization posture); a store outside home (tests) emits as-is."""
    try:
        return "~/" + path.relative_to(Path.home()).as_posix()
    except ValueError:
        return path.as_posix()


def _knowledge_directive(key: str, run_id: str) -> dict:
    """The §4 KB-injection directive (ST-9.6): the project spine and the
    run's seed named by path so any driver can inject their contents into
    the segment prompt it executes. The injection ACT stays driver-side
    (AD-2 — the studio never renders another harness's prompts); aid, not
    gate — an absent file is never a reason to skip or fail the run."""
    spine = reconcilelib.knowledge_dir(key) / "spine.md"
    seed = joblib.workspace_path(key, run_id) / "seed.md"
    return {
        "spine": {"path": _tilde(spine), "present": spine.is_file()},
        "seed": {"path": _tilde(seed), "present": seed.is_file()},
    }


def _job_routing(defn: dict, project_root: Path) -> dict:
    """The run's effective model/effort (AD-14, §5): the definition's own
    model/effort fields are the runtime override; the executing resource is
    the target skill (tk-studio-job itself for core targets)."""
    resource = defn["target"].get("skill") or "tk-studio-job"
    runtime: dict = {}
    if defn.get("model"):
        runtime.setdefault("model", {})["default"] = defn["model"]
    if defn.get("effort"):
        runtime.setdefault("model", {})["effort"] = defn["effort"]
    return routinglib.resolve_routing(resource, project_root=project_root,
                                      runtime=runtime)


def _payload_flags(payload: dict) -> list[str]:
    """Payload fields → CLI flags, the §1 1:1 mapping (underscores become
    hyphens; true is a bare flag; false/null are omitted)."""
    flags: list[str] = []
    for field, value in payload.items():
        flag = "--" + field.replace("_", "-")
        if value is True:
            flags.append(flag)
        elif value is False or value is None:
            continue
        else:
            flags.extend([flag, str(value)])
    return flags


# -------------------------------------------------------------- execution

def _summarize_result(parsed: dict | None, exit_code: int | None) -> tuple[dict, str]:
    """Compact summary + one-line headline from a core's parsed output.

    Well-known report keys (the conformance runner's among them) surface in
    the summary; everything else stays in the workspace's output.json."""
    summary: dict = {}
    if exit_code is not None:
        summary["exit_code"] = exit_code
    if isinstance(parsed, dict):
        for known in ("ok", "surfaces_checked", "checks_run"):
            if known in parsed:
                summary[known] = parsed[known]
        if isinstance(parsed.get("failures"), list):
            summary["failure_count"] = len(parsed["failures"])
    headline = " ".join(f"{k}={v}" for k, v in summary.items()) or "no output"
    return summary, headline


def _land_summary(key: str, record: dict, summary: dict) -> None:
    """The run summary artifact every terminal run leaves in its workspace."""
    joblib.write_workspace_json(key, record["run_id"], "summary.json", {
        "job_id": record["job_id"],
        "run_id": record["run_id"],
        "state": record["state"],
        "reason": record.get("reason"),
        "started": record.get("started"),
        "ended": record.get("ended"),
        **summary,
    })


def _finalize_run(key: str, record: dict, summary: dict,
                  detail: str | None = None) -> dict:
    """Every terminal transition's closing motion: capture the run's handoff
    deltas into the project reconciliation queue (ST-9.4 — the capture hook
    riding the wrapper's close; idempotent by the queue's dedupe key, so a
    boundary capture already landed is just duplicates here), land
    summary.json with the capture evidence, emit the job-run event. Capture
    never masks the transition — a failure is recorded, not raised."""
    try:
        captured = reconcilelib.capture(key, record["run_id"])
    except Exception as exc:
        captured = {"captured": 0, "errors": [str(exc)]}
    _land_summary(key, record, {**summary, "capture": captured})
    _emit_job_event(record, key, detail=detail)
    return captured


def execute_core(key: str, record: dict) -> dict:
    """Run a core-target run to a terminal state, wall-clock guarded.

    Outcome mapping: machine-readable stdout → complete; timeout → partial
    with the guard named; anything unparseable → blocked, never a guess.
    Every terminal path lands summary.json in the workspace; a parsed
    result additionally lands in full as output.json (run.json keeps only
    the compact status block).
    """
    defn = record["job"]
    core = defn["target"]["core"]
    payload = defn["target"].get("payload") or {}
    record = joblib.update_run(key, record["run_id"], {"state": "running"})
    argv = [sys.executable, str(PLUGIN_ROOT / core[0]), *core[1:],
            *_payload_flags(payload)]
    timeout = defn["guards"].get("max_wall_clock_seconds")
    try:
        proc = subprocess.run(
            argv, stdin=subprocess.DEVNULL, capture_output=True, text=True,
            timeout=timeout, cwd=str(PLUGIN_ROOT))
    except subprocess.TimeoutExpired:
        record = joblib.update_run(key, record["run_id"], {
            "state": "partial",
            "reason": f"guard: max_wall_clock_seconds ({timeout}s)"})
        _finalize_run(key, record, {})
        return record
    parsed = None
    stdout = proc.stdout.strip()
    for candidate in ([stdout] + (stdout.splitlines()[-1:] if stdout else [])):
        try:
            parsed = json.loads(candidate)
            break
        except json.JSONDecodeError:
            continue
    if parsed is None:
        record = joblib.update_run(key, record["run_id"], {
            "state": "blocked",
            "reason": f"core produced no machine-readable output "
                      f"(exit {proc.returncode})"})
        _finalize_run(key, record, {"exit_code": proc.returncode})
        return record
    summary, headline = _summarize_result(parsed, proc.returncode)
    if isinstance(parsed, dict):
        joblib.write_workspace_json(key, record["run_id"], "output.json", parsed)
    record = joblib.update_run(key, record["run_id"], {
        "state": "complete", "status_block": {"summary": summary}})
    _finalize_run(key, record, summary, detail=headline)
    return record


# ------------------------------------------------------------------ verbs

def submit(project_root: Path, job_id: str) -> dict:
    """§4 submit: validate, gate on stop conditions, mint/execute/schedule.

    Response always carries {job_id, run_id, accepted, reason?}; recurring
    triggers add the substrate directive, durable jobs the surfaced
    constraint. accepted=false is an answer, never an exception."""
    root = Path(project_root)
    entry = joblib.load_instance(root, job_id)
    if entry["problems"]:
        return {"job_id": job_id, "run_id": None, "accepted": False,
                "reason": "; ".join(entry["problems"])}
    defn = entry["definition"]
    key = joblib.project_key(root)
    stop_reason = evaluate_stop(defn, joblib.list_runs(key, job_id=job_id))
    if stop_reason:
        return {"job_id": job_id, "run_id": None, "accepted": False,
                "reason": stop_reason}

    routing = _job_routing(defn, root)
    result: dict = {"job_id": job_id, "run_id": None, "accepted": True,
                    "substrate": "harness-native",
                    "directive": _directive(defn),
                    "routing": routing}
    if defn.get("durable") and defn["trigger"] != "one-shot":
        result["durability_constraint"] = DURABILITY_CONSTRAINT

    if defn["trigger"] == "one-shot":
        record = joblib.create_run(defn, key)
        record = joblib.update_run(key, record["run_id"],
                                   {"routing": routing})
        result["run_id"] = record["run_id"]
        due_now = not defn.get("at") or _parse_iso(defn["at"]) <= _now()
        if due_now and "core" in defn["target"]:
            record = execute_core(key, record)
            result["state"] = record["state"]
            if record.get("reason"):
                result["reason"] = record["reason"]
        elif due_now:
            result["state"] = "queued"
            result["directive"] = {
                "kind": "invoke-skill", "skill": defn["target"]["skill"],
                "payload": defn["target"].get("payload") or {},
                "knowledge": _knowledge_directive(key, record["run_id"]),
                "then": f"jobrun.py finish --run-id {record['run_id']}"}
        else:
            result["state"] = "queued"
    return result


def status(project_root: Path, job_id: str, run_id: str | None = None) -> dict:
    """§4 status: read-only; the exact response shape a driver relies on."""
    root = Path(project_root)
    entry = joblib.load_instance(root, job_id)
    if entry["definition"] is None:
        raise JobRunError("; ".join(entry["problems"]))
    key = joblib.project_key(root)
    runs = joblib.list_runs(key, job_id=job_id)
    if run_id is not None:
        runs = [r for r in runs if r.get("run_id") == run_id]
        if not runs:
            raise JobRunError(f"run '{run_id}' not found for job '{job_id}'")
    return {"job_id": job_id, "runs": [
        {"run_id": r.get("run_id"), "state": r.get("state"),
         **({"status_block": r["status_block"]} if r.get("status_block") else {}),
         **({"started": r["started"]} if r.get("started") else {}),
         **({"ended": r["ended"]} if r.get("ended") else {}),
         **({"reason": r["reason"]} if r.get("reason") else {}),
         **({"error": r["error"]} if r.get("error") else {})}
        for r in runs]}


def cancel(project_root: Path, job_id: str, run_id: str | None = None) -> dict:
    """§4 cancel: stop scheduling; resumable runs terminate partial with
    reason `cancelled`. Idempotent — nothing left to cancel still answers."""
    root = Path(project_root)
    key = joblib.project_key(root)
    runs = joblib.list_runs(key, job_id=job_id)
    if run_id is not None:
        runs = [r for r in runs if r.get("run_id") == run_id]
        if not runs:
            return {"cancelled": False,
                    "reason": f"run '{run_id}' not found for job '{job_id}'"}
    ended = []
    for record in runs:
        if record.get("state") in joblib.RESUMABLE_STATES:
            record = joblib.update_run(key, record["run_id"], {
                "state": "partial", "reason": "cancelled"})
            _finalize_run(key, record, {})
            ended.append(record["run_id"])
    return {"cancelled": True, "runs_ended": ended,
            "directive": {"kind": "unbind",
                          "detail": "remove any substrate schedule bound "
                                    f"for job '{job_id}'"}}


def wake(project_root: Path, job_id: str) -> dict:
    """§4 wake: fire a recurring job's next iteration now (the mission-
    runner tick). Stop conditions gate it; woken=false names the reason."""
    root = Path(project_root)
    entry = joblib.load_instance(root, job_id)
    if entry["problems"]:
        return {"woken": False, "run_id": None,
                "reason": "; ".join(entry["problems"])}
    defn = entry["definition"]
    if defn["trigger"] == "one-shot":
        return {"woken": False, "run_id": None,
                "reason": "wake applies to recurring jobs — submit runs a "
                          "one-shot"}
    key = joblib.project_key(root)
    stop_reason = evaluate_stop(defn, joblib.list_runs(key, job_id=job_id))
    if stop_reason:
        return {"woken": False, "run_id": None, "reason": stop_reason}
    routing = _job_routing(defn, root)
    record = joblib.create_run(defn, key)
    record = joblib.update_run(key, record["run_id"], {"routing": routing})
    result = {"woken": True, "run_id": record["run_id"], "routing": routing}
    if "core" in defn["target"]:
        record = execute_core(key, record)
        result["state"] = record["state"]
        if record.get("reason"):
            result["reason"] = record["reason"]
    else:
        result["state"] = "queued"
        result["directive"] = {
            "kind": "invoke-skill", "skill": defn["target"]["skill"],
            "payload": defn["target"].get("payload") or {},
            "knowledge": _knowledge_directive(key, record["run_id"]),
            "then": f"jobrun.py finish --run-id {record['run_id']}"}
    return result


# --------------------------------------------------- agent-side wrapper

def account(project_root: Path, run_id: str, turns: int = 0,
            tokens: int = 0) -> dict:
    """Accumulate budget counters for a running run and answer whether any
    guard is exceeded. The executing wrapper calls this every iteration and
    MUST end the run partial (naming the guard) when within_budget=false."""
    key = joblib.project_key(Path(project_root))
    record = joblib.read_run(key, run_id)
    if record["state"] not in joblib.RESUMABLE_STATES:
        raise JobRunError(f"run '{run_id}' already ended {record['state']}")
    counters = dict(record.get("counters") or {})
    counters["turns"] = counters.get("turns", 0) + turns
    counters["tokens"] = counters.get("tokens", 0) + tokens
    if record.get("started"):
        counters["wall_clock_seconds"] = round(
            (_now() - _parse_iso(record["started"])).total_seconds(), 3)
    record = joblib.update_run(key, run_id, {"counters": counters})
    guards = record["job"]["guards"]
    exceeded = [name for name, spent_key in
                (("max_turns", "turns"), ("max_tokens", "tokens"),
                 ("max_wall_clock_seconds", "wall_clock_seconds"))
                if name in guards and counters.get(spent_key, 0) >= guards[name]]
    return {"run_id": run_id, "counters": counters,
            "within_budget": not exceeded, "exceeded": exceeded,
            "required_on_exceeded": "end the run partial with the guard "
                                    "named in reason (§4)"}


def finish(project_root: Path, run_id: str, state: str,
           reason: str | None = None, status_block: dict | None = None) -> dict:
    """Terminal-ize a skill-target run; emits the job-run event (the
    wrapper's one job-level emission for this run — AD-12)."""
    key = joblib.project_key(Path(project_root))
    changes: dict = {"state": state}
    if reason is not None:
        changes["reason"] = reason
    if status_block is not None:
        changes["status_block"] = status_block
    record = joblib.update_run(key, run_id, changes)
    result = {"run_id": run_id, "state": record["state"],
              "reason": record.get("reason")}
    if record["state"] in joblib.TERMINAL_STATES:
        result["capture"] = _finalize_run(key, record, {})
    return result


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="tk-studio job wrapper — driver-contract §4 verbs on "
                    "the harness-native substrate")
    sub = parser.add_subparsers(dest="command", required=True)

    for name in ("submit", "status", "cancel", "wake", "account", "finish"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--directory", required=True, help="project root")
        if name == "submit":
            cmd.add_argument("--id", required=True, help="job id")
        elif name in ("status", "cancel", "wake"):
            cmd.add_argument("--job-id", required=True)
            if name != "wake":
                cmd.add_argument("--run-id")
        else:
            cmd.add_argument("--run-id", required=True)
            if name == "account":
                cmd.add_argument("--turns", type=int, default=0)
                cmd.add_argument("--tokens", type=int, default=0)
            else:
                cmd.add_argument("--state", required=True,
                                 choices=list(joblib.TERMINAL_STATES))
                cmd.add_argument("--reason")
                cmd.add_argument("--status-block", help="JSON object")

    args = parser.parse_args(argv)
    try:
        if args.command == "submit":
            result = submit(Path(args.directory), args.id)
        elif args.command == "status":
            result = status(Path(args.directory), args.job_id, args.run_id)
        elif args.command == "cancel":
            result = cancel(Path(args.directory), args.job_id, args.run_id)
        elif args.command == "wake":
            result = wake(Path(args.directory), args.job_id)
        elif args.command == "account":
            result = account(Path(args.directory), args.run_id,
                             turns=args.turns, tokens=args.tokens)
        else:
            block = None
            if args.status_block:
                try:
                    block = json.loads(args.status_block)
                except json.JSONDecodeError as exc:
                    raise JobRunError(f"--status-block is not valid JSON: {exc}")
            result = finish(Path(args.directory), args.run_id, args.state,
                            reason=args.reason, status_block=block)
    except (JobRunError, joblib.JobError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
