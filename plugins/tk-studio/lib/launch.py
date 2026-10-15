"""tk-studio launch — start, inspect and stop the execution substrate for one
project epic (the `tk-studio-launch` surface; AD-2, AD-10, AD-11).

The studio pipeline (`agentic-pipeline-2026-09-02.md`, decision 5) routes
every run through the studio: a conformant driver (the studio supervisor,
Hermes as the front door that submits to it, or direct invocation —
driver-contract §1 driver roster) runs a `run-epic` job, the orchestrator
invokes this surface, and this core is the one place that talks to the
substrate — bmad-loop, driven only through its
CLI (`bmad-loop run|list|status|stop|validate`), never imported. The agent
side of the skill does the planner-tier work first (the epic SPEC, the first
story's task manifest); this core stays deterministic: readiness gates, a
pre-minted run id, a detached engine process, and JSON answers.

Verbs (all end with JSON on stdout; never prompt — AD-11):
  uv run launch.py check  --directory DIR --spec FOLDER
  uv run launch.py start  --directory DIR --spec FOLDER [--run-id ID] [--wait S]
                          [--allow-budget-mismatch]
  uv run launch.py status --directory DIR [--run-id ID]
  uv run launch.py stop   --directory DIR --run-id ID [--graceful]

Guarantees:
  - `start` never launches onto a checkout that already has a live engine
    (one engine per checkout — the merge gate and dispatch read the live
    tree and collide), never without a SPEC.md and a non-empty task
    manifest, and never past a failing `bmad-loop validate`; every gap is
    named (`gaps[]`), never guessed around.
  - The engine runs detached, with no console window (the operator's
    headless rule), its output captured to the per-user store —
    `~/.tk-studio/projects/<key>/launches/<run-id>.log` — never into the
    project tree (an untracked file there would dirty the checkout the
    engine's own preflight refuses to run on).
  - `start` answers `ok` only once the engine has written its
    `.bmad-loop/runs/<run-id>/state.json`; a launch the engine never
    acknowledged reports the pid and log instead of claiming success.
  - Every result — each verb's answer and every refusal — ends with the
    AD-11 status block keys, in order: `status`, `intent`
    ("tk-studio-launch"), `artifacts`, `reason` (driver-contract §3), so a
    skill path, fresh or relaunch, ends on the core's block.
  - `check` and `start` compare the engine's `.bmad-loop/policy.toml`
    `[limits]` (read-only, never edited) with the tracked
    `.tk-studio/budget-bands.yaml`: `budget.budget_mismatch[]` names every
    limit the largest band exceeds, with both numbers. A mismatch is never
    a gap (`ok` is unchanged): `check` ends `partial` naming it, and
    `start` refuses unless `--allow-budget-mismatch` is given (the skill's
    `allow_budget_mismatch: true` payload); a `start` refusal after its
    readiness check that found a mismatch carries the `budget` object too.
    A band whose compared field is not a number puts that limit under
    `not_compared`, never compared on the remaining bands.

Exit codes: 0 verb answered (a `check` with gaps is an answer: ok=false);
2 bad invocation or refusal (`start` on a failing check, missing spec, an
unacknowledged budget mismatch);
1 unexpected failure (spawn error, engine never acknowledged).
Env: TK_STUDIO_HOME overrides the store root (tests). Stdlib-only (NFR9).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
import tomllib
from datetime import datetime
from pathlib import Path

import job as joblib
import miniyaml
import store as storelib

# statuses `bmad-loop list --json` reports for a run whose engine is gone;
# anything else owns the checkout (a paused engine is still a live process)
TERMINAL_STATUSES = frozenset({"finished", "stopped", "interrupted", "crashed"})
RUN_ID_RE = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{4}$")
DEFAULT_WAIT_S = 30.0
POLL_S = 0.5

INTENT = "tk-studio-launch"
# the AD-11 status block, last in every result and in this order (§3)
BLOCK_KEYS = ("status", "intent", "artifacts", "reason")

POLICY_REL = ".bmad-loop/policy.toml"
BANDS_REL = ".tk-studio/budget-bands.yaml"
# policy `[limits]` key -> the band field its largest band is compared with
BUDGET_COMPARED = (("max_tokens_per_story", "weighted_tokens"),
                   ("max_review_cycles", "review_cycles_max"))
# policy limits the bands carry no field for (the wall-clock session
# timeout, the per-session token guard, the follow-up review cap): listed,
# never a mismatch
BUDGET_NOT_COMPARED = ("session_timeout_min", "max_tokens_per_session",
                       "max_followup_reviews")


class LaunchError(Exception):
    """Bad invocation or a refusal with its reason named. ``extra`` holds
    structured fields the refusal JSON carries before the block keys (the
    readiness ``budget`` on a `start` refusal after its check)."""

    def __init__(self, message: str, *, extra: dict | None = None) -> None:
        super().__init__(message)
        self.extra = dict(extra or {})


# ------------------------------------------------------------------ transport

def _bmad_loop_binary() -> str | None:
    return shutil.which("bmad-loop")


def run_cli(args: list[str], *, cwd: Path | None = None,
            timeout: int = 120) -> tuple[int, str, str]:
    """`bmad-loop <args>` captured. Module-level so tests inject a fake."""
    binary = _bmad_loop_binary()
    if binary is None:
        raise LaunchError("bmad-loop is not on PATH (install: uv tool install bmad-loop)")
    proc = subprocess.run([binary, *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout,
                          cwd=str(cwd) if cwd else None, stdin=subprocess.DEVNULL)
    return proc.returncode, proc.stdout, proc.stderr


def spawn_detached(args: list[str], *, cwd: Path, log_path: Path) -> int:
    """Start `bmad-loop <args>` as a detached, console-less process whose
    output lands in `log_path`. Returns the pid. Module-level so tests
    inject a fake."""
    binary = _bmad_loop_binary()
    if binary is None:
        raise LaunchError("bmad-loop is not on PATH (install: uv tool install bmad-loop)")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    kwargs: dict = {}
    if os.name == "nt":
        kwargs["creationflags"] = (subprocess.DETACHED_PROCESS
                                   | subprocess.CREATE_NEW_PROCESS_GROUP)
    else:
        kwargs["start_new_session"] = True
    with open(log_path, "ab") as log:
        proc = subprocess.Popen([binary, *args], cwd=str(cwd),
                                stdin=subprocess.DEVNULL, stdout=log,
                                stderr=subprocess.STDOUT, close_fds=True,
                                **kwargs)
    return proc.pid


def _json_out(text: str) -> dict | None:
    text = text.strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


# ------------------------------------------------------------------- helpers

def mint_run_id(now: datetime | None = None) -> str:
    """bmad-loop's own run-id shape: %Y%m%d-%H%M%S-<4 hex> (lexical = chronological)."""
    stamp = (now or datetime.now()).strftime("%Y%m%d-%H%M%S")
    return f"{stamp}-{secrets.token_hex(2)}"


def _manifest_entry_count(path: Path) -> int:
    """`- id:` entries of a stories.yaml (a top-level list by the substrate's
    schema; leading indentation tolerated), without a YAML parser — the
    substrate validates the manifest properly; this only answers "is there
    anything to dispatch"."""
    count = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        if re.match(r"^\s*-\s+id:\s*\S", line):
            count += 1
    return count


def default_spec_folder(epic: int) -> str:
    """The epic's spec folder when the payload names only the epic number
    (the skill's documented default)."""
    return f"_bmad-output/specs/spec-epic-{int(epic)}"


def _spec_paths(root: Path, spec_folder: str) -> tuple[Path, str]:
    """(absolute folder, the project-relative spelling handed to the
    substrate). A relative spelling is passed through verbatim — Path()
    would rewrite separators on Windows — and an absolute one is
    relativized once, here, so `validate` and `run` always see the same
    argument."""
    folder = Path(spec_folder)
    if folder.is_absolute():
        return folder, os.path.relpath(folder, root)
    return root / folder, spec_folder


def launches_dir(project_root: Path) -> Path:
    key = joblib.project_key(project_root)
    return storelib.store_root() / "projects" / key / "launches"


def list_runs(project_root: Path) -> list[dict]:
    """`bmad-loop list --json` for the checkout; [] when the project has never run."""
    if not (project_root / ".bmad-loop").is_dir():
        return []
    rc, out, err = run_cli(["list", "--json", "--project", str(project_root)])
    parsed = _json_out(out)
    if rc != 0 or parsed is None:
        raise LaunchError(f"bmad-loop list failed (exit {rc}): {(err or out).strip()[:400]}")
    return list(parsed.get("runs") or [])


def live_runs(runs: list[dict]) -> list[dict]:
    """Runs whose engine still owns the checkout: any non-terminal status
    (a paused engine is a live process). Terminal is decided by status
    alone — a stale `paused_stage` on a finished run must never block
    every later launch."""
    return [r for r in runs if str(r.get("status", "")) not in TERMINAL_STATUSES]


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _empty_budget() -> dict:
    return {"compared": [], "budget_mismatch": [], "not_compared": []}


def compare_budget(project_root: Path) -> tuple[dict, dict]:
    """(budget, check entry): the engine's policy limits against the budget
    bands. Both files are only read — the machine-local policy is never
    edited here. A band ceiling above its policy limit is a
    `budget_mismatch` entry `{limit, policy, band, band_field, band_value}`;
    a limit the bands carry no field for is `not_compared`. A missing or
    unparseable input is named in the check entry, never a crash and never
    a mismatch."""
    budget = _empty_budget()
    every_limit = [limit for limit, _ in BUDGET_COMPARED] + list(BUDGET_NOT_COMPARED)

    def not_compared_all(problem: str) -> tuple[dict, dict]:
        budget["not_compared"] = [{"limit": limit, "reason": problem} for limit in every_limit]
        return budget, {"check": "budget", "ok": True,
                        "detail": f"not compared (advisory): {problem}"}

    policy_path = project_root / POLICY_REL
    try:
        with open(policy_path, "rb") as fh:
            policy = tomllib.load(fh)
    except FileNotFoundError:
        return not_compared_all(f"{POLICY_REL} missing")
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
        return not_compared_all(f"{POLICY_REL} unparseable: {exc}")
    bands_path = project_root / BANDS_REL
    try:
        bands_doc = miniyaml.load(bands_path)
    except FileNotFoundError:
        return not_compared_all(f"{BANDS_REL} missing")
    except (OSError, UnicodeDecodeError, miniyaml.MiniYamlError) as exc:
        return not_compared_all(f"{BANDS_REL} unparseable: {exc}")
    limits = policy.get("limits")
    if not isinstance(limits, dict):
        return not_compared_all(f"{POLICY_REL} has no [limits] table")
    bands = bands_doc.get("bands") if isinstance(bands_doc, dict) else None
    if not isinstance(bands, dict) or not bands:
        return not_compared_all(f"{BANDS_REL} has no bands map")

    for limit, field in BUDGET_COMPARED:
        policy_value = limits.get(limit)
        if not _number(policy_value):
            reason = "absent from policy" if limit not in limits else "not a number in policy"
            budget["not_compared"].append({"limit": limit, "reason": reason})
            continue
        typed = [(str(name), band[field]) for name, band in bands.items()
                 if isinstance(band, dict) and field in band]
        # a band carrying the field with a non-numeric value would let a
        # smaller band be compared and hide a real mismatch: name it instead
        bad = [name for name, value in typed if not _number(value)]
        if bad:
            budget["not_compared"].append({
                "limit": limit,
                "reason": "; ".join(f"band {name} {field} not a number" for name in bad)})
            continue
        carried = typed
        if not carried:
            budget["not_compared"].append({"limit": limit, "reason": "no band field"})
            continue
        band, band_value = max(carried, key=lambda item: item[1])
        entry = {"limit": limit, "policy": policy_value, "band": band,
                 "band_field": field, "band_value": band_value}
        budget["compared"].append(entry)
        if band_value > policy_value:
            budget["budget_mismatch"].append(entry)
    for limit in BUDGET_NOT_COMPARED:
        budget["not_compared"].append({"limit": limit, "reason": "no band field"})

    mismatch = budget["budget_mismatch"]
    detail = ("budget_mismatch: " + "; ".join(mismatch_text(m) for m in mismatch)
              if mismatch else
              f"{len(budget['compared'])} limit(s) within the bands")
    return budget, {"check": "budget", "ok": not mismatch, "detail": detail}


def mismatch_text(entry: dict) -> str:
    """One mismatch, both numbers named."""
    return (f"{entry['limit']} {entry['policy']} < band {entry['band']} "
            f"{entry['band_field']} {entry['band_value']}")


def with_block(result: dict, status: str, artifacts: list[str],
               reason: str | None) -> dict:
    """``result`` with the AD-11 block keys appended last, in order."""
    out = {k: v for k, v in result.items() if k not in BLOCK_KEYS}
    out.update(status=status, intent=INTENT, artifacts=list(artifacts), reason=reason)
    return out


def check_block(result: dict) -> tuple[str, list[str], str | None]:
    """check: blocked naming the gaps; partial naming each mismatch;
    complete otherwise. A check launches nothing, so no artifacts."""
    mismatch = (result.get("budget") or {}).get("budget_mismatch") or []
    mismatch_reason = ("budget_mismatch: " + "; ".join(mismatch_text(m) for m in mismatch)
                       if mismatch else None)
    if result.get("gaps"):
        reason = "; ".join(result["gaps"])
        if mismatch_reason:
            reason += "; " + mismatch_reason
        return "blocked", [], reason
    if mismatch_reason:
        return "partial", [], mismatch_reason
    return "complete", [], None


def start_block(result: dict) -> tuple[str, list[str], str | None]:
    """start: complete with the project-relative run dir and spec folder
    (never `run_dir_abs` or the store `log`); blocked when unacknowledged."""
    if result.get("ok"):
        return "complete", [result["run_dir"], result["spec_folder"]], None
    return "blocked", [], result.get("error") or "the engine never acknowledged the launch"


# --------------------------------------------------------------------- verbs

def check(project_root: Path, spec_folder: str) -> dict:
    """Readiness gates for a launch. ok=false names every gap; nothing is
    launched or written."""
    checks: list[dict] = []
    gaps: list[str] = []

    def add(name: str, ok: bool, detail: str) -> None:
        checks.append({"check": name, "ok": ok, "detail": detail})
        if not ok:
            gaps.append(f"{name}: {detail}")

    root = project_root.resolve()
    add("project", root.is_dir(), f"{root}" if root.is_dir() else f"not a directory: {root}")
    if not root.is_dir():
        return {"ok": False, "checks": checks, "gaps": gaps, "budget": _empty_budget()}

    # the budget comparison is advisory to `ok`: a mismatch is never a gap
    budget, budget_check = compare_budget(root)
    checks.append(budget_check)

    folder_abs, rel = _spec_paths(root, spec_folder)
    spec_md = folder_abs / "SPEC.md"
    manifest = folder_abs / "stories.yaml"
    add("spec folder", folder_abs.is_dir(),
        str(folder_abs) if folder_abs.is_dir() else f"spec folder missing: {folder_abs}")
    add("SPEC.md", spec_md.is_file(),
        "present" if spec_md.is_file() else "missing — distill the epic with bmad-spec first")
    if manifest.is_file():
        n = _manifest_entry_count(manifest)
        add("task manifest", n > 0,
            f"{n} entries" if n > 0 else "stories.yaml has no entries — bootstrap the first story's tasks first")
    else:
        add("task manifest", False, "stories.yaml missing — bootstrap the first story's tasks first")

    binary = _bmad_loop_binary()
    add("bmad-loop", binary is not None,
        binary or "bmad-loop is not on PATH (install: uv tool install bmad-loop)")
    if binary is None or not folder_abs.is_dir():
        return {"ok": not gaps, "checks": checks, "gaps": gaps, "budget": budget}

    plugin = root / ".bmad-loop" / "plugins" / "studio-pipeline" / "plugin.toml"
    checks.append({"check": "studio-pipeline plugin", "ok": True,
                   "detail": ("present" if plugin.is_file()
                              else "absent — the run will have no gate session (advisory)")})

    try:
        live = live_runs(list_runs(root))
    except LaunchError as exc:
        add("live engine", False, str(exc))
    else:
        add("live engine", not live,
            "none" if not live else "a run already owns this checkout: "
            + ", ".join(f"{r.get('run_id')} ({r.get('status')})" for r in live))

    try:
        rc, out, err = run_cli(["validate", "--json", "--project", str(root), "--spec", rel])
    except LaunchError as exc:
        add("bmad-loop validate", False, str(exc))
    else:
        parsed = _json_out(out)
        if parsed is None:
            add("bmad-loop validate", False,
                f"no JSON from bmad-loop validate (exit {rc}): {(err or out).strip()[:300]}")
        else:
            problems = [f.get("message", "") for f in parsed.get("findings", [])
                        if f.get("severity") == "problem"]
            add("bmad-loop validate", bool(parsed.get("ok")) and not problems,
                "ok" if parsed.get("ok") else "; ".join(problems) or "validate reported not ok")
    return {"ok": not gaps, "checks": checks, "gaps": gaps, "budget": budget}


def start(project_root: Path, spec_folder: str, *, run_id: str | None = None,
          wait_s: float = DEFAULT_WAIT_S, allow_budget_mismatch: bool = False) -> dict:
    """Launch the engine detached for the epic's manifest; ok only once the
    engine acknowledged the pre-minted run id on disk. A budget mismatch
    refuses unless ``allow_budget_mismatch`` acknowledges it."""
    readiness = check(project_root, spec_folder)
    mismatch = readiness["budget"]["budget_mismatch"]
    # a refusal after readiness that found a mismatch carries the structured
    # comparison, so every exceeded limit is named with both numbers (AC3);
    # a gaps-only refusal keeps the plain refusal shape
    budget_extra = {"budget": readiness["budget"]} if mismatch else None
    if not readiness["ok"]:
        raise LaunchError("launch refused: " + "; ".join(readiness["gaps"]),
                          extra=budget_extra)
    if mismatch and not allow_budget_mismatch:
        raise LaunchError(
            "launch refused: budget_mismatch: "
            + "; ".join(mismatch_text(m) for m in mismatch)
            + f" — raise the limit in {POLICY_REL} [limits] (never edited by the launch core) "
              "or acknowledge with allow_budget_mismatch: true (--allow-budget-mismatch)",
            extra=budget_extra)
    root = project_root.resolve()
    rid = run_id or mint_run_id()
    if not RUN_ID_RE.match(rid):
        raise LaunchError(f"run id must look like YYYYMMDD-HHMMSS-hex4: {rid!r}")
    run_dir = root / ".bmad-loop" / "runs" / rid
    if run_dir.exists():
        raise LaunchError(f"run id already exists: {run_dir}")
    log_path = launches_dir(root) / f"{rid}.log"
    _, rel = _spec_paths(root, spec_folder)
    args = ["run", "--project", str(root), "--spec", rel, "--run-id", rid]
    pid = spawn_detached(args, cwd=root, log_path=log_path)
    state = run_dir / "state.json"
    deadline = time.monotonic() + max(0.0, wait_s)
    seen = state.is_file()
    while not seen and time.monotonic() < deadline:
        time.sleep(POLL_S)
        seen = state.is_file()
    result = {
        "ok": seen,
        "run_id": rid,
        # project-relative, so it can go into a status block's artifacts[]
        # verbatim (driver-contract §3: never an absolute local path)
        "run_dir": f".bmad-loop/runs/{rid}",
        "run_dir_abs": str(run_dir),
        "log": str(log_path),
        "pid": pid,
        "spec_folder": rel,
        "state_seen": seen,
        "checks": readiness["checks"],
        "budget": readiness["budget"],
    }
    if not seen:
        result["error"] = (f"engine did not write {state} within {wait_s:g}s — it may still be "
                           f"starting (pid {pid}); inspect the log before launching again")
    return result


def status(project_root: Path, run_id: str | None = None) -> dict:
    root = project_root.resolve()
    runs = list_runs(root)
    live = live_runs(runs)
    result: dict = {"ok": True, "project": str(root), "runs": runs, "live": live}
    target = run_id or (live[-1]["run_id"] if live else None)
    if target:
        rc, out, err = run_cli(["status", "--json", "--project", str(root), target])
        parsed = _json_out(out)
        if parsed is None:
            raise LaunchError(f"bmad-loop status {target} failed (exit {rc}): {(err or out).strip()[:400]}")
        tasks = parsed.get("tasks") or []
        result["run"] = {
            "run_id": parsed.get("run_id"),
            "status": parsed.get("status"),
            "finished": parsed.get("finished"),
            "stopped": parsed.get("stopped"),
            "crashed": parsed.get("crashed"),
            "paused_stage": parsed.get("paused_stage"),
            "paused_reason": parsed.get("paused_reason"),
            "paused_story_key": parsed.get("paused_story_key"),
            "tokens": parsed.get("tokens"),
            "adapters": parsed.get("adapters"),
            "tasks": [{"key": t.get("story_key"), "phase": t.get("phase"),
                       "attempt": t.get("attempt"), "review_cycle": t.get("review_cycle")}
                      for t in tasks],
        }
    return result


def stop(project_root: Path, run_id: str, *, graceful: bool = False) -> dict:
    root = project_root.resolve()
    args = ["stop"]
    if graceful:
        args.append("--graceful")
    args += ["--project", str(root), run_id]
    rc, out, err = run_cli(args)
    if rc != 0:
        # an unknown or already-terminal run is a refusal the substrate
        # names, not an unexpected failure — surface it as one (exit 2)
        raise LaunchError(f"bmad-loop stop {run_id} refused (exit {rc}): "
                          f"{(out + err).strip()[:400]}")
    return {"ok": True, "run_id": run_id, "graceful": graceful,
            "output": (out + err).strip()[:800]}


# ----------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio launch — the execution substrate for one epic")
    sub = parser.add_subparsers(dest="command", required=True)

    for name, help_text in (("check", "readiness gates; launches nothing"),
                            ("start", "launch the engine detached for the epic's manifest")):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--directory", required=True)
        p.add_argument("--spec", help="epic spec folder (project-relative); "
                                      "default from --epic: _bmad-output/specs/spec-epic-<N>")
        p.add_argument("--epic", type=int, help="epic number (names the default spec folder)")
        if name == "start":
            p.add_argument("--run-id", help="pre-minted run id (default: minted here)")
            p.add_argument("--wait", type=float, default=DEFAULT_WAIT_S,
                           help="seconds to wait for the engine's state.json")
            p.add_argument("--allow-budget-mismatch", action="store_true",
                           help="start despite a policy limit the budget bands exceed "
                                "(the payload's allow_budget_mismatch: true)")

    p = sub.add_parser("status", help="runs on the checkout; detail for the live or named run")
    p.add_argument("--directory", required=True)
    p.add_argument("--run-id")

    p = sub.add_parser("stop", help="stop a run (graceful = after the current unit)")
    p.add_argument("--directory", required=True)
    p.add_argument("--run-id", required=True)
    p.add_argument("--graceful", action="store_true")

    args = parser.parse_args(argv)
    root = Path(args.directory)
    try:
        if args.command in ("check", "start"):
            spec = args.spec
            if not spec:
                if args.epic is None:
                    raise LaunchError("give --spec or --epic (the spec folder is required)")
                spec = default_spec_folder(args.epic)
        if args.command == "check":
            result = check(root, spec)
            _emit(with_block(result, *check_block(result)))
            return 0
        if args.command == "start":
            result = start(root, spec, run_id=args.run_id, wait_s=args.wait,
                           allow_budget_mismatch=args.allow_budget_mismatch)
            _emit(with_block(result, *start_block(result)))
            return 0 if result["ok"] else 1
        if args.command == "status":
            _emit(with_block(status(root, args.run_id), "complete", [], None))
            return 0
        if args.command == "stop":
            _emit(with_block(stop(root, args.run_id, graceful=args.graceful),
                             "complete", [], None))
            return 0
    except LaunchError as exc:
        refusal = {"ok": False, "error": str(exc), **exc.extra}
        _emit(with_block(refusal, "blocked", [], str(exc)))
        return 2
    except (OSError, subprocess.SubprocessError) as exc:
        error = f"{type(exc).__name__}: {exc}"
        _emit(with_block({"ok": False, "error": error}, "blocked", [], error))
        return 1
    return 2


def _emit(result: dict) -> None:
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
