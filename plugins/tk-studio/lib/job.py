"""tk-studio job model — declarative jobs, resumable run state (ST-6.1, AD-10).

O8 hybrid ruling: a job is data; the bound substrate executes it. This module
owns the data half — the one validator of contracts/job.schema.json and the
one reader/writer of run workspaces:

  types       generic job types shipped with the plugin: jobs/<type-id>.json
  instances   per-project jobs: tracked config `jobs:` lists scalar ids; each
              id names .tk-studio/jobs/<id>.json (the config surface stays
              inside the miniyaml subset — never inline job mappings). An id
              with no instance file that names a shipped type uses that type
              directly; an instance file may extend a type (`type:`) with
              instance fields overriding, target keys overlaying, payload
              shallow-merging.
  validation  rejects a definition missing budget guards or stop conditions —
              a job never runs away (AD-10). Definition files are tracked, so
              they are AD-3-classified too: credential-shaped content or
              absolute machine paths refuse.
  run state   ~/.tk-studio/projects/<key>/runs/<run-id>/run.json — atomic
              writes; queued|running runs are resumable (they carry the
              resolved definition snapshot + checkpoint, so a fresh process
              continues from the workspace alone); terminal states
              (complete|partial|blocked|cancelled) are immutable. The state
              enum matches the driver-contract §4 status verb exactly.

Execution (submit/status/cancel/wake, guard enforcement) is ST-6.2's
tk-studio-job wrapper; nothing here schedules or runs anything.

CLI:
  uv run job.py validate (--file PATH | --id ID --directory DIR)
  uv run job.py list --directory DIR
  uv run job.py run-init --directory DIR --id JOB_ID
  uv run job.py runs --directory DIR [--job-id ID]
  uv run job.py run-show --directory DIR --run-id RUN_ID

Exit codes: 0 ok; 2 invalid definition / unknown id / bad invocation;
1 unexpected failure. Env: TK_STUDIO_HOME overrides the store root (tests).
Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import classify
import config as configlib
import miniyaml
import store as storelib

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = PLUGIN_ROOT / "contracts" / "job.schema.json"
TYPES_DIR = PLUGIN_ROOT / "jobs"

_ID_RE = re.compile(r"^[a-z][a-z0-9-]*$")

# The schema file is the single source for every enum and required list —
# code and contract cannot drift (the ledger/taxonomy discipline).
_SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
_DEF_FIELDS = _SCHEMA["definition"]["fields"]
JOB_SCHEMA_VERSION = _SCHEMA["job_schema_version"]
REQUIRED_FIELDS = tuple(_SCHEMA["definition"]["required"])
TRIGGERS = tuple(_DEF_FIELDS["trigger"]["enum"])
TARGET_KEYS = tuple(_DEF_FIELDS["target"]["fields"])
CADENCE_KEYS = tuple(_DEF_FIELDS["cadence"]["fields"])
CADENCE_MODES = tuple(_DEF_FIELDS["cadence"]["fields"]["mode"]["enum"])
GUARD_KEYS = tuple(_DEF_FIELDS["guards"]["fields"])
STOP_KEYS = tuple(_DEF_FIELDS["stop"]["fields"])
STOP_STATUSES = tuple(_DEF_FIELDS["stop"]["fields"]["on_status"]["enum"])
EFFORTS = tuple(_DEF_FIELDS["effort"]["enum"])
RUN_STATES = tuple(_SCHEMA["run"]["fields"]["state"]["enum"])
RESUMABLE_STATES = ("queued", "running")
TERMINAL_STATES = tuple(s for s in RUN_STATES if s not in RESUMABLE_STATES)

_RUN_IMMUTABLE_KEYS = ("run_schema_version", "run_id", "job_id", "project",
                       "created")


class JobError(Exception):
    """Invalid definition, unknown id, or run-state violation."""


# ------------------------------------------------------------- validation

def _is_iso(value: object) -> bool:
    try:
        datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return True
    except (ValueError, TypeError):
        return False


def _positive(value: object) -> bool:
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and value > 0)


def _validate_target(target: object, problems: list[str]) -> None:
    if not isinstance(target, dict):
        problems.append("target must be an object")
        return
    unknown = set(target) - set(TARGET_KEYS)
    if unknown:
        problems.append(f"target has unknown field(s): {', '.join(sorted(unknown))}")
    skill = target.get("skill")
    core = target.get("core")
    if skill is None and core is None:
        problems.append("target must name at least one of skill|core")
    if skill is not None and (not isinstance(skill, str) or not skill.strip()):
        problems.append("target.skill must be a non-empty string")
    if core is not None:
        if (not isinstance(core, list) or not core
                or not all(isinstance(a, str) and a for a in core)):
            problems.append("target.core must be a non-empty list of strings")
        else:
            head = Path(core[0])
            if head.is_absolute() or ".." in head.parts:
                problems.append("target.core[0] must be plugin-root-relative "
                                "(no absolute paths, no '..')")
    payload = target.get("payload")
    if payload is not None and not isinstance(payload, dict):
        problems.append("target.payload must be an object")


def _validate_cadence(defn: dict, problems: list[str]) -> None:
    trigger = defn.get("trigger")
    cadence = defn.get("cadence")
    if trigger == "one-shot":
        if cadence is not None:
            problems.append("cadence is for recurring triggers — one-shot "
                            "takes an optional 'at' instead")
        return
    if trigger not in ("cron", "loop"):
        return  # trigger itself already reported
    if cadence is None:
        problems.append(f"trigger '{trigger}' requires a cadence")
        return
    if not isinstance(cadence, dict):
        problems.append("cadence must be an object")
        return
    unknown = set(cadence) - set(CADENCE_KEYS)
    if unknown:
        problems.append(f"cadence has unknown field(s): {', '.join(sorted(unknown))}")
    mode = cadence.get("mode")
    if mode not in CADENCE_MODES:
        problems.append(f"cadence.mode must be one of {'|'.join(CADENCE_MODES)}")
        return
    if trigger == "cron":
        if mode != "fixed":
            problems.append("cron is inherently fixed — self-paced is valid "
                            "only for loop")
        schedule = cadence.get("schedule")
        if not isinstance(schedule, str) or len(schedule.split()) != 5:
            problems.append("cron requires cadence.schedule as a 5-field "
                            "cron expression")
        for stray in ("interval_seconds", "hint_seconds"):
            if stray in cadence:
                problems.append(f"cadence.{stray} does not apply to cron")
    else:  # loop
        if "schedule" in cadence:
            problems.append("cadence.schedule is cron-only")
        if mode == "fixed":
            if not _positive(cadence.get("interval_seconds")):
                problems.append("loop with fixed cadence requires "
                                "interval_seconds > 0")
            if "hint_seconds" in cadence:
                problems.append("cadence.hint_seconds is self-paced-only")
        else:  # self-paced
            if "interval_seconds" in cadence:
                problems.append("cadence.interval_seconds is fixed-only")
            if "hint_seconds" in cadence and not _positive(cadence.get("hint_seconds")):
                problems.append("cadence.hint_seconds must be > 0")


def _validate_guards(guards: object, problems: list[str]) -> None:
    if not isinstance(guards, dict):
        problems.append("guards must be an object")
        return
    unknown = set(guards) - set(GUARD_KEYS)
    if unknown:
        problems.append(f"guards has unknown field(s): {', '.join(sorted(unknown))}")
    if not set(guards) & set(GUARD_KEYS):
        problems.append("guards must set at least one of "
                        f"{'|'.join(GUARD_KEYS)} — a job never runs away (AD-10)")
    for key in set(guards) & set(GUARD_KEYS):
        if not _positive(guards[key]):
            problems.append(f"guards.{key} must be a number > 0")


def _validate_stop(stop: object, problems: list[str]) -> None:
    if not isinstance(stop, dict):
        problems.append("stop must be an object")
        return
    unknown = set(stop) - set(STOP_KEYS)
    if unknown:
        problems.append(f"stop has unknown field(s): {', '.join(sorted(unknown))}")
    if not set(stop) & set(STOP_KEYS):
        problems.append("stop must set at least one of "
                        f"{'|'.join(STOP_KEYS)} — a job never runs away (AD-10)")
    if "max_runs" in stop and not (isinstance(stop["max_runs"], int)
                                   and not isinstance(stop["max_runs"], bool)
                                   and stop["max_runs"] > 0):
        problems.append("stop.max_runs must be an integer > 0")
    if "until" in stop and not _is_iso(stop["until"]):
        problems.append("stop.until must be an ISO-8601 timestamp")
    if "on_status" in stop:
        statuses = stop["on_status"]
        if (not isinstance(statuses, list) or not statuses
                or not set(statuses) <= set(STOP_STATUSES)):
            problems.append("stop.on_status must be a non-empty list from "
                            f"{'|'.join(STOP_STATUSES)}")


def validate_definition(defn: object) -> list[str]:
    """All schema violations in one pass; empty list = valid."""
    if not isinstance(defn, dict):
        return ["definition must be a JSON object"]
    problems: list[str] = []
    unknown = set(defn) - set(_DEF_FIELDS)
    if unknown:
        problems.append(f"unknown field(s): {', '.join(sorted(unknown))}")
    for field in REQUIRED_FIELDS:
        if field not in defn:
            problems.append(f"missing required field '{field}'")
    if "job_schema_version" in defn and defn["job_schema_version"] != JOB_SCHEMA_VERSION:
        problems.append(f"job_schema_version must be {JOB_SCHEMA_VERSION}")
    if "id" in defn and (not isinstance(defn["id"], str)
                         or not _ID_RE.match(defn["id"])):
        problems.append("id must match ^[a-z][a-z0-9-]*$")
    if "description" in defn and not isinstance(defn["description"], str):
        problems.append("description must be a string")
    if "type" in defn and (not isinstance(defn["type"], str)
                           or not _ID_RE.match(defn["type"])):
        problems.append("type must be a shipped job-type id (^[a-z][a-z0-9-]*$)")
    if "target" in defn:
        _validate_target(defn["target"], problems)
    if "trigger" in defn and defn["trigger"] not in TRIGGERS:
        problems.append(f"trigger must be one of {'|'.join(TRIGGERS)}")
    if "at" in defn:
        if defn.get("trigger") != "one-shot":
            problems.append("'at' applies only to one-shot jobs")
        elif not _is_iso(defn["at"]):
            problems.append("'at' must be an ISO-8601 timestamp")
    _validate_cadence(defn, problems)
    if "durable" in defn and not isinstance(defn["durable"], bool):
        problems.append("durable must be a boolean")
    if "guards" in defn:
        _validate_guards(defn["guards"], problems)
    if "stop" in defn:
        _validate_stop(defn["stop"], problems)
    if "model" in defn and (not isinstance(defn["model"], str)
                            or not defn["model"].strip()):
        problems.append("model must be a non-empty string")
    if "effort" in defn and defn["effort"] not in EFFORTS:
        problems.append(f"effort must be one of {'|'.join(EFFORTS)}")
    return problems


# ------------------------------------------------------- types & instances

def _load_definition_file(path: Path) -> tuple[dict | None, list[str]]:
    """Read + parse one definition file; AD-3-classify the raw text (these
    files are tracked — credentials and machine paths refuse)."""
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        return None, [f"definition file unreadable: {exc}"]
    problems = classify.find_credentials(raw)
    machine_paths = classify.find_machine_paths(raw)
    if machine_paths:
        problems.append("absolute machine path(s) in a tracked definition "
                        f"(AD-3): {', '.join(machine_paths[:3])}")
    try:
        defn = json.loads(raw)
    except json.JSONDecodeError as exc:
        problems.append(f"not valid JSON: {exc}")
        return None, problems
    if not isinstance(defn, dict):
        problems.append("definition must be a JSON object")
        return None, problems
    return defn, problems


def load_types() -> dict:
    """Shipped generic job types: {type_id: {definition, path, problems[]}}."""
    types: dict[str, dict] = {}
    if not TYPES_DIR.is_dir():
        return types
    for path in sorted(TYPES_DIR.glob("*.json")):
        defn, problems = _load_definition_file(path)
        if defn is not None:
            if "type" in defn:
                problems.append("a shipped generic type may not itself "
                                "extend a type")
            if defn.get("id") != path.stem:
                problems.append(f"id must equal the file stem '{path.stem}'")
            problems.extend(validate_definition(defn))
        types[path.stem] = {
            "definition": defn,
            "path": str(path.relative_to(PLUGIN_ROOT)).replace("\\", "/"),
            "problems": problems,
        }
    return types


def resolve_instance(defn: dict, types: dict | None = None) -> tuple[dict, list[str]]:
    """Apply type extension: instance fields override the shipped type's,
    target keys overlay, payload shallow-merges (instance wins)."""
    if "type" not in defn:
        return defn, []
    types = load_types() if types is None else types
    type_id = defn["type"]
    entry = types.get(type_id) if isinstance(type_id, str) else None
    if entry is None or entry["definition"] is None:
        known = ", ".join(sorted(types)) or "none shipped"
        return defn, [f"unknown job type '{type_id}' (shipped types: {known})"]
    if entry["problems"]:
        return defn, [f"job type '{type_id}' is itself invalid: "
                      + "; ".join(entry["problems"])]
    merged = json.loads(json.dumps(entry["definition"]))
    for key, value in defn.items():
        if key == "type":
            continue
        if (key == "target" and isinstance(value, dict)
                and isinstance(merged.get("target"), dict)):
            target = dict(merged["target"])
            for t_key, t_value in value.items():
                if (t_key == "payload" and isinstance(t_value, dict)
                        and isinstance(target.get("payload"), dict)):
                    target["payload"] = {**target["payload"], **t_value}
                else:
                    target[t_key] = t_value
            merged["target"] = target
        else:
            merged[key] = value
    return merged, []


def instances_dir(project_root: Path) -> Path:
    return Path(project_root) / ".tk-studio" / "jobs"


def project_job_ids(project_root: Path) -> list[str]:
    """The tracked config's jobs[] — scalar id refs only (miniyaml subset)."""
    try:
        value, _scope = configlib.resolve("jobs", project_root=Path(project_root))
    except configlib.ConfigError:
        return []
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise JobError("config 'jobs' must be a list of job-id strings — "
                       "definitions live in .tk-studio/jobs/<id>.json, never "
                       "inline (miniyaml subset)")
    return value


def load_instance(project_root: Path, job_id: str,
                  types: dict | None = None) -> dict:
    """Resolve one job id: the project's .tk-studio/jobs/<id>.json when
    present (type-extended), else a shipped type used directly."""
    types = load_types() if types is None else types
    entry: dict = {"id": job_id, "source": None, "path": None,
                   "extends": None, "definition": None, "problems": []}
    if not _ID_RE.match(job_id):
        entry["problems"] = [f"job id '{job_id}' must match ^[a-z][a-z0-9-]*$"]
        return entry
    path = instances_dir(project_root) / f"{job_id}.json"
    if path.is_file():
        entry["source"] = "instance"
        entry["path"] = f".tk-studio/jobs/{job_id}.json"
        defn, problems = _load_definition_file(path)
        if defn is not None:
            if defn.get("id") != job_id:
                problems.append(f"id must equal the file stem '{job_id}'")
            entry["extends"] = defn.get("type")
            resolved, resolve_problems = resolve_instance(defn, types)
            problems.extend(resolve_problems)
            problems.extend(validate_definition(resolved))
            entry["definition"] = resolved
        entry["problems"] = problems
    elif job_id in types:
        shipped = types[job_id]
        entry["source"] = "type"
        entry["path"] = shipped["path"]
        entry["definition"] = shipped["definition"]
        entry["problems"] = list(shipped["problems"])
    else:
        entry["problems"] = [
            f"no definition for '{job_id}': neither "
            f".tk-studio/jobs/{job_id}.json nor a shipped type"]
    return entry


def load_instances(project_root: Path) -> dict:
    """Every job the project declares, in config order, each validated."""
    root = Path(project_root).resolve()
    types = load_types()
    ids = project_job_ids(root)
    problems: list[str] = []
    seen: set[str] = set()
    jobs: list[dict] = []
    for job_id in ids:
        if job_id in seen:
            problems.append(f"duplicate job id '{job_id}' in config jobs[]")
            continue
        seen.add(job_id)
        jobs.append(load_instance(root, job_id, types))
    return {"jobs": jobs, "problems": problems}


# --------------------------------------------------------------- run state

def project_key(project_root: Path) -> str:
    """The project's one identity (AD-20): explicit project_id from tracked
    config, else the root basename — same rule as the registry."""
    root = Path(project_root).resolve()
    tracked = root / ".tk-studio" / configlib.TRACKED_NAME
    pid = None
    if tracked.is_file():
        try:
            pid = miniyaml.load(tracked).get("project_id")
        except miniyaml.MiniYamlError:
            pid = None
    return storelib.safe_name(str(pid) if pid else root.name)


def runs_root(key: str) -> Path:
    return storelib.store_root() / "projects" / key / "runs"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _atomic_write_json(path: Path, data: dict) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def create_run(defn: dict, key: str) -> dict:
    """Mint a run workspace for a validated definition; state starts queued.

    The record snapshots the resolved definition, so a fresh process resumes
    from the workspace alone (never re-reading project config mid-run).
    """
    problems = validate_definition(defn)
    if problems:
        raise JobError("refusing a run for an invalid definition: "
                       + "; ".join(problems))
    storelib.ensure_store()
    root = runs_root(key)
    root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base = f"{defn['id']}-{stamp}"
    run_id, attempt = base, 1
    while True:
        workspace = root / run_id
        try:
            workspace.mkdir()
            break
        except FileExistsError:
            attempt += 1
            run_id = f"{base}-{attempt}"
    now = _now()
    record = {
        "run_schema_version": 1,
        "run_id": run_id,
        "job_id": defn["id"],
        "project": key,
        "state": "queued",
        "created": now,
        "updated": now,
        "job": defn,
    }
    _atomic_write_json(workspace / "run.json", record)
    return record


def workspace_path(key: str, run_id: str) -> Path:
    return runs_root(key) / run_id


def write_workspace_json(key: str, run_id: str, name: str, data: dict) -> Path:
    """Land a JSON artifact in a run workspace (atomic, same discipline as
    run.json). The workspace must already exist — create_run minted it."""
    path = workspace_path(key, run_id) / name
    if not path.parent.is_dir():
        raise JobError(f"run '{run_id}' has no workspace for project '{key}'")
    _atomic_write_json(path, data)
    return path


def run_path(key: str, run_id: str) -> Path:
    return workspace_path(key, run_id) / "run.json"


def read_run(key: str, run_id: str) -> dict:
    path = run_path(key, run_id)
    if not path.is_file():
        raise JobError(f"run '{run_id}' has no workspace for project '{key}'")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise JobError(f"run state unreadable at {path.name}: {exc}") from exc


def update_run(key: str, run_id: str, changes: dict) -> dict:
    """Merge changes into run.json atomically, stamping updated (and
    started/ended on the matching transitions). Refuses identity rewrites,
    unknown states, terminal-state mutation, and a terminal-ish state
    without a reason (§4: partial|blocked|cancelled always carry one)."""
    record = read_run(key, run_id)
    for immutable in _RUN_IMMUTABLE_KEYS:
        if immutable in changes and changes[immutable] != record.get(immutable):
            raise JobError(f"run field '{immutable}' is immutable")
    new_state = changes.get("state", record["state"])
    if new_state not in RUN_STATES:
        raise JobError(f"state must be one of {'|'.join(RUN_STATES)}")
    if record["state"] in TERMINAL_STATES and new_state != record["state"]:
        raise JobError(f"run '{run_id}' ended {record['state']} — terminal "
                       "states are immutable")
    merged = {**record, **changes}
    if new_state in ("partial", "blocked", "cancelled") and not merged.get("reason"):
        raise JobError(f"state '{new_state}' requires a reason (§4)")
    merged["updated"] = _now()
    if new_state == "running" and not merged.get("started"):
        merged["started"] = merged["updated"]
    if new_state in TERMINAL_STATES and not merged.get("ended"):
        merged["ended"] = merged["updated"]
    _atomic_write_json(run_path(key, run_id), merged)
    return merged


def list_runs(key: str, job_id: str | None = None) -> list[dict]:
    """Every run record for the project (oldest first); unreadable state
    surfaces as an error entry, never silently skipped."""
    root = runs_root(key)
    if not root.is_dir():
        return []
    records = []
    for workspace in sorted(p for p in root.iterdir() if p.is_dir()):
        try:
            record = read_run(key, workspace.name)
        except JobError as exc:
            record = {"run_id": workspace.name, "error": str(exc)}
        if job_id is None or record.get("job_id") == job_id:
            records.append(record)
    return records


# --------------------------------------------------------------------- CLI

def _cmd_validate(args) -> dict:
    if bool(args.file) == bool(args.id):
        raise JobError("validate takes exactly one of --file or "
                       "--id with --directory")
    if args.file:
        defn, problems = _load_definition_file(Path(args.file))
        if defn is not None:
            resolved, resolve_problems = resolve_instance(defn)
            problems = problems + resolve_problems + validate_definition(resolved)
            defn = resolved
        if problems:
            raise JobError("; ".join(problems))
        return {"job": defn}
    if not args.directory:
        raise JobError("--id requires --directory")
    entry = load_instance(Path(args.directory), args.id)
    if entry["problems"]:
        raise JobError("; ".join(entry["problems"]))
    return {"source": entry["source"], "job": entry["definition"]}


def _cmd_list(args) -> dict:
    types = load_types()
    declared = load_instances(Path(args.directory))
    invalid = ([t for t in types.values() if t["problems"]]
               + [j for j in declared["jobs"] if j["problems"]])
    return {
        "types": [{"id": type_id, **entry} for type_id, entry in types.items()],
        "jobs": declared["jobs"],
        "problems": declared["problems"],
        "valid": not invalid and not declared["problems"],
    }


def _cmd_run_init(args) -> dict:
    root = Path(args.directory)
    entry = load_instance(root, args.id)
    if entry["problems"]:
        raise JobError("; ".join(entry["problems"]))
    key = project_key(root)
    record = create_run(entry["definition"], key)
    return {"project": key, "run": record,
            "workspace": str(runs_root(key) / record["run_id"])}


def _cmd_runs(args) -> dict:
    key = project_key(Path(args.directory))
    return {"project": key, "runs": list_runs(key, job_id=args.job_id)}


def _cmd_run_show(args) -> dict:
    key = project_key(Path(args.directory))
    return {"project": key, "run": read_run(key, args.run_id)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="tk-studio job model (data + run state; execution is "
                    "tk-studio-job)")
    sub = parser.add_subparsers(dest="command", required=True)

    val = sub.add_parser("validate", help="validate one definition")
    val.add_argument("--file", help="definition file path")
    val.add_argument("--id", help="job id (instance or shipped type)")
    val.add_argument("--directory", help="project root (with --id)")

    lst = sub.add_parser("list", help="shipped types + declared project jobs")
    lst.add_argument("--directory", required=True, help="project root")

    init = sub.add_parser("run-init", help="mint a queued run workspace")
    init.add_argument("--directory", required=True, help="project root")
    init.add_argument("--id", required=True, help="job id")

    runs = sub.add_parser("runs", help="list run records for a project")
    runs.add_argument("--directory", required=True, help="project root")
    runs.add_argument("--job-id", help="filter to one job")

    show = sub.add_parser("run-show", help="one run record")
    show.add_argument("--directory", required=True, help="project root")
    show.add_argument("--run-id", required=True)

    args = parser.parse_args(argv)
    handlers = {"validate": _cmd_validate, "list": _cmd_list,
                "run-init": _cmd_run_init, "runs": _cmd_runs,
                "run-show": _cmd_run_show}
    try:
        result = handlers[args.command](args)
    except (JobError, configlib.ConfigError, miniyaml.MiniYamlError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
