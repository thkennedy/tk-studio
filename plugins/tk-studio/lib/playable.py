"""tk-studio playable — run the game for a bounded number of ticks under a
seeded, scripted scenario and come back with frames and a pass or fail
(Story 34.2, ST-139; the runner 34.3's `playable-verify` leg drives).

The host side of the playable run. It starts `$GODOT` on the project with
the `PlayableHarness` C# autoload (the template beside this file,
`godot/PlayableHarness.cs`, which the project copies in) and hands the
harness the scenario, the seed, the tick count and the output folder as
user args after `--`. The harness drives the inputs, evaluates the
invariants, captures the frames and writes `<out>/report.json`; this core
bounds the run with a wall clock, keeps the engine's output in
`<out>/log.txt`, merges `run` and `log_errors` into the report and ends in
the AD-11 status block.

Verb (ends with JSON on stdout; never prompts — AD-11):
  uv run playable.py run --directory DIR --scenario FILE --seed N --ticks T
                         --out DIR [--mode display|movie|headless]
                         [--wall-clock S] [--godot PATH]

Guarantees:
  - The engine binary is `--godot`, else `GODOT` from the environment
    (stripped): an absolute path to an existing file, never a bare
    `godot`. Unset, not absolute, missing or not a file is a refusal
    naming it, and nothing starts.
  - The project is `--directory` when it holds `project.godot`, else its
    one `*/project.godot` subfolder (TUA: `game/`); none or several is a
    refusal naming what was found. Its `project.godot` must register the
    `PlayableHarness` key under `[autoload]`; one that does not is a
    refusal naming it, before anything starts or `--out` is touched.
  - The scenario (schema 1) is parsed and validated before anything
    starts; a bad field is a refusal naming it. Seed is an int >= 0 that
    fits a ulong, ticks an int > 0 that fits an int32 (as does every
    scenario tick, from_tick, hold_ticks, capture_every and every): the
    harness's parse types.
  - The engine's stdout and stderr stream to `<out>/log.txt`, never into
    the project tree (an `--out` inside the folder holding `project.godot`
    is a refusal); stdin is closed. A stale `report.json` and the
    `*.png` directly under `<out>/frames/` are removed first. An overrun
    of `--wall-clock` (default 120 s; finite, > 0 and <= MAX_WALL_CLOCK_S)
    is killed with its process tree and the verdict is `fail`
    (`wall-clock`; the detail says when the tree kill was not confirmed).
    The scenario's JSON holds no NaN / Infinity and no non-finite number.
  - `<out>/report.json` is the harness's, merged with `run` and
    `log_errors` and written back atomically; no report from the harness
    is a `fail` (`harness`) this core writes itself; a merged report that
    cannot be written is `partial` naming it. A pass with a non-zero
    exit, or exit 0 with a fail, is a fail naming the mismatch. In
    `display` and `movie` modes a pass whose `frames[]` is empty or names a
    file missing under `<out>` is a fail (`frames`). An `ERROR:` /
    `SCRIPT ERROR:` / `SHADER ERROR:` log line under a pass whose scenario
    has a `no_error_log` invariant watching from tick 0 is a fail (a later
    `from_tick` leaves the verdict to the harness; `log_errors` is
    reported either way). Only the lines before the harness's end marker
    (`HARNESS_DETACHED`, printed as it detaches its logger) count:
    shutdown lines after it belong to no tick. No marker (the harness
    crashed or was killed) and the whole log counts.
  - Every result ends with the AD-11 block keys, in order: `status`
    (`complete` pass, `partial` fail, `blocked` refusal), `intent`
    ("playable"), `artifacts` (out-relative), `reason`.

Exit codes: 0 pass; 1 fail; 2 refusal or bad invocation.
Stdlib-only (NFR9). Never run on the engine's sandbox: the engine lives on
the host.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

INTENT = "playable"
BLOCK_KEYS = ("status", "intent", "artifacts", "reason")

# The ruled rendering path (kb/playable-verify-on-the-box.md `## Ruling`);
# launch.py carries the same constant for its `playable path` row.
PLAYABLE_PATH = "movie"
MODES = ("display", "movie", "headless")
FIXED_FPS = "60"

# The harness's user args (Settled shape 3); the template test greps the
# `.cs` for each, so the names live here once.
ARG_SCENARIO = "--playable-scenario="
ARG_SEED = "--playable-seed="
ARG_TICKS = "--playable-ticks="
ARG_OUT = "--playable-out="
USER_ARGS = (ARG_SCENARIO, ARG_SEED, ARG_TICKS, ARG_OUT)
# the harness is inert unless its user args carry ARG_SCENARIO
HARNESS_INERT_CHECK = "OS.GetCmdlineUserArgs()"
# the autoload key project.godot must register under [autoload]; the
# template's header names the line (`PlayableHarness="*res://..."`)
HARNESS_AUTOLOAD = "PlayableHarness"
HARNESS_AUTOLOAD_LINE = 'PlayableHarness="*res://src/Debug/PlayableHarness.cs"'
# the line the harness prints (GD.PrintErr, so ordered with the error
# lines on the merged stream) right before it detaches its logger; error
# lines after it are shutdown's, no tick's
HARNESS_DETACHED = "PLAYABLE: harness detached"

# `<out>/report.json` (Settled shape 2): the harness writes these keys;
# this core merges RUNNER_KEYS.
REPORT_KEYS = ("schema", "verdict", "failed", "seed", "ticks", "ticks_run",
               "capture_every", "mode", "frames", "moments", "frame_time_ms")
RUNNER_KEYS = ("log_errors", "run")
RUN_KEYS = ("argv", "exit", "duration_ms", "timed_out", "wall_clock_s", "godot")

INVARIANT_KINDS = ("node_exists", "no_error_log", "frame_time_under")
DEFAULT_CAPTURE_EVERY = 30
DEFAULT_FRAME_BUDGET_MS = 33.3
DEFAULT_WALL_CLOCK_S = 120
# the longest --wall-clock accepted: finite, and well inside every
# platform's wait (Windows overflows past ~4294967 s)
MAX_WALL_CLOCK_S = 86400

REPORT = "report.json"
LOG = "log.txt"
FRAMES = "frames"
ARTIFACTS = [REPORT, LOG, f"{FRAMES}/"]

ERROR_LINE = re.compile(r"^\s*(SCRIPT ERROR:|SHADER ERROR:|ERROR:)")
MAX_LOG_ERRORS = 20

# What the harness parses: `--playable-seed` as a ulong, `--playable-ticks`
# and every scenario tick-like int as an int32 (JsonElement.GetInt32). A
# value past these is a refusal here, never a silent mis-parse there.
SEED_MAX = 2**64 - 1
INT32_MAX = 2**31 - 1
# the bounded wait for `taskkill /T` before the plain kill fallback
KILL_TREE_TIMEOUT_S = 10


class Refusal(Exception):
    """A refusal: nothing started (status blocked, exit 2)."""


# ------------------------------------------------------------------ inputs

def resolve_godot(arg: str | None, env=None) -> str:
    """The engine binary: ``--godot`` else ``GODOT`` (stripped), worded
    like the doctor's ``engine`` row."""
    env = os.environ if env is None else env
    name = "--godot" if arg is not None else "GODOT"
    value = (arg if arg is not None else env.get("GODOT") or "").strip()
    if not value:
        raise Refusal("no engine: GODOT is unset (set GODOT to the Godot "
                      "console binary, runbook §2, or pass --godot)")
    path = Path(value)
    if not path.is_absolute():
        raise Refusal(f"no engine: {name} {value} is not an absolute path "
                      "(never a bare godot)")
    if not path.is_file():
        why = "is not a file" if path.exists() else "does not exist"
        raise Refusal(f"no engine ({name} names {value}, which {why})")
    return str(path)


def resolve_project(directory: str) -> Path:
    """``--directory`` holding ``project.godot``, else its one
    ``*/project.godot`` subfolder."""
    root = Path(directory).resolve()
    if not root.is_dir():
        raise Refusal(f"project: not a directory: {root}")
    if (root / "project.godot").is_file():
        return root
    found = sorted(p.parent for p in root.glob("*/project.godot") if p.is_file())
    if len(found) == 1:
        return found[0]
    if not found:
        raise Refusal(f"project: no project.godot in {root} or its subfolders")
    raise Refusal("project: several project.godot candidates: "
                  + ", ".join(str(p) for p in found))


def require_harness_autoload(project: Path) -> None:
    """Refuse a project whose ``project.godot`` registers no
    ``HARNESS_AUTOLOAD`` key under ``[autoload]`` (without it the game
    plays normally until the wall clock kills it)."""
    path = project / "project.godot"
    try:
        text = path.read_text(encoding="utf-8-sig", errors="replace")
    except OSError as exc:
        raise Refusal(f"project: {path} unreadable ({exc})") from None
    section = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith(";"):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].strip()
            continue
        if section == "autoload" and "=" in line:
            if line.split("=", 1)[0].strip() == HARNESS_AUTOLOAD:
                return
    raise Refusal(f"{path} registers no {HARNESS_AUTOLOAD} autoload ([autoload] "
                  f"{HARNESS_AUTOLOAD_LINE}); copy the template in first "
                  "(kb/playable-verify-on-the-box.md)")


def _int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _name(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _int32(field: str, value: object) -> None:
    """An int field the harness reads with GetInt32 (call after the type
    check)."""
    if value > INT32_MAX:
        raise ValueError(f"{field} {value} exceeds {INT32_MAX} (the harness reads an int32)")


def validate_scenario(doc: object) -> dict:
    """Settled shape 1. Returns the document; raises ValueError naming the
    first bad field."""
    if not isinstance(doc, dict):
        raise ValueError("the scenario is not a JSON object")
    if not (_int(doc.get("schema")) and doc["schema"] == 1):
        raise ValueError("schema must be 1")
    if "scene" in doc and not (isinstance(doc["scene"], str)
                               and doc["scene"].startswith("res://")):
        raise ValueError("scene must be a res:// path")
    if "capture_every" in doc and not (_int(doc["capture_every"]) and doc["capture_every"] >= 1):
        raise ValueError("capture_every must be an int >= 1")
    if "capture_every" in doc:
        _int32("capture_every", doc["capture_every"])
    if "frame_budget_ms" in doc and not (_number(doc["frame_budget_ms"])
                                         and doc["frame_budget_ms"] > 0):
        raise ValueError("frame_budget_ms must be a number > 0")
    inputs = doc.get("inputs")
    if not isinstance(inputs, list):
        raise ValueError("inputs is missing or not a list")
    for i, item in enumerate(inputs):
        at = f"inputs[{i}]"
        if not isinstance(item, dict):
            raise ValueError(f"{at} is not an object")
        if not (_int(item.get("tick")) and item["tick"] >= 0):
            raise ValueError(f"{at}.tick is missing or not an int >= 0")
        _int32(f"{at}.tick", item["tick"])
        if not _name(item.get("action")):
            raise ValueError(f"{at}.action is missing or not a non-empty string")
        if "pressed" in item and not isinstance(item["pressed"], bool):
            raise ValueError(f"{at}.pressed must be a bool")
        if "strength" in item and not (_number(item["strength"]) and 0 <= item["strength"] <= 1):
            raise ValueError(f"{at}.strength must be a number in 0..1")
        if "hold_ticks" in item and not (_int(item["hold_ticks"]) and item["hold_ticks"] >= 1):
            raise ValueError(f"{at}.hold_ticks must be an int >= 1")
        if "hold_ticks" in item:
            _int32(f"{at}.hold_ticks", item["hold_ticks"])
    if "random_inputs" in doc:
        block = doc["random_inputs"]
        if not isinstance(block, dict):
            raise ValueError("random_inputs is not an object")
        actions = block.get("actions")
        if not (isinstance(actions, list) and actions and all(_name(a) for a in actions)):
            raise ValueError("random_inputs.actions is missing or not a non-empty list of names")
        if not (_int(block.get("every")) and block["every"] >= 1):
            raise ValueError("random_inputs.every is missing or not an int >= 1")
        _int32("random_inputs.every", block["every"])
    invariants = doc.get("invariants")
    if not isinstance(invariants, list):
        raise ValueError("invariants is missing or not a list")
    for i, item in enumerate(invariants):
        at = f"invariants[{i}]"
        if not isinstance(item, dict):
            raise ValueError(f"{at} is not an object")
        if not _name(item.get("name")):
            raise ValueError(f"{at}.name is missing or not a non-empty string")
        kind = item.get("kind")
        if kind not in INVARIANT_KINDS:
            raise ValueError(f"{at}.kind {kind!r} is not one of "
                             + ", ".join(INVARIANT_KINDS))
        if kind == "node_exists" and not _name(item.get("path")):
            raise ValueError(f"{at}.path is missing (node_exists needs a node path)")
        if "budget_ms" in item and not (_number(item["budget_ms"]) and item["budget_ms"] > 0):
            raise ValueError(f"{at}.budget_ms must be a number > 0")
        if "from_tick" in item and not (_int(item["from_tick"]) and item["from_tick"] >= 0):
            raise ValueError(f"{at}.from_tick must be an int >= 0")
        if "from_tick" in item:
            _int32(f"{at}.from_tick", item["from_tick"])
    if "moments" in doc:
        moments = doc["moments"]
        if not isinstance(moments, list):
            raise ValueError("moments is not a list")
        for i, item in enumerate(moments):
            at = f"moments[{i}]"
            if not isinstance(item, dict):
                raise ValueError(f"{at} is not an object")
            if not _name(item.get("name")):
                raise ValueError(f"{at}.name is missing or not a non-empty string")
            if not (_int(item.get("tick")) and item["tick"] >= 0):
                raise ValueError(f"{at}.tick is missing or not an int >= 0")
            _int32(f"{at}.tick", item["tick"])
    return doc


def _no_constant(name: str):
    raise ValueError(f"{name} is not valid JSON (the harness's System.Text.Json rejects it)")


def _finite_float(text: str) -> float:
    value = float(text)
    if not math.isfinite(value):
        raise ValueError(f"number {text} is not finite (the harness reads a finite double)")
    return value


def load_scenario(path: Path) -> dict:
    try:
        doc = json.loads(path.read_text(encoding="utf-8-sig"),
                         parse_constant=_no_constant, parse_float=_finite_float)
    except FileNotFoundError:
        raise Refusal(f"scenario {path}: not found") from None
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise Refusal(f"scenario {path}: unreadable ({exc})") from None
    try:
        return validate_scenario(doc)
    except ValueError as exc:
        raise Refusal(f"scenario {path}: {exc}") from None


def _non_negative_int(name: str, raw: str, *, maximum: int, parsed_as: str,
                      positive: bool = False) -> int:
    try:
        value = int(str(raw).strip())
    except ValueError:
        raise Refusal(f"{name} {raw!r} is not an int") from None
    if value < (1 if positive else 0):
        raise Refusal(f"{name} {value} must be {'> 0' if positive else '>= 0'}")
    if value > maximum:
        raise Refusal(f"{name} {value} exceeds {maximum} (the harness parses it as {parsed_as})")
    return value


def _inside(path: Path, folder: Path) -> bool:
    """``path`` is ``folder`` or below it (both resolved; case-folded
    where the platform folds)."""
    p = os.path.normcase(str(path))
    f = os.path.normcase(str(folder))
    return p == f or p.startswith(f.rstrip("\\/") + os.sep)


# --------------------------------------------------------------- the engine

def engine_argv(godot: str, project: Path, mode: str, scenario: Path,
                seed: int, ticks: int, out: Path) -> list[str]:
    """Settled shape 3: the engine, the project, the mode's flags, then the
    harness's user args after ``--``."""
    if mode == "display":
        flags = ["--windowed", "--fixed-fps", FIXED_FPS]
    elif mode == "movie":
        flags = ["--write-movie", str(out / FRAMES / "movie.png"), "--fixed-fps", FIXED_FPS]
    elif mode == "headless":
        flags = ["--headless", "--fixed-fps", FIXED_FPS]
    else:
        raise Refusal(f"--mode {mode!r} is not one of " + ", ".join(MODES))
    return [godot, "--path", str(project), *flags, "--",
            f"{ARG_SCENARIO}{scenario}", f"{ARG_SEED}{seed}",
            f"{ARG_TICKS}{ticks}", f"{ARG_OUT}{out}"]


def kill_tree(proc: subprocess.Popen) -> bool:
    """Kill ``proc`` and its descendants (on the box ``$GODOT`` is the
    ``*_console.exe`` wrapper that starts the real engine as a child), then
    reap it. Windows: ``taskkill /T /F`` bounded by a timeout; POSIX: the
    process group ``run_engine`` started it in. ``proc.kill()`` is the
    fallback either way. Returns whether the tree kill was confirmed
    (taskkill exit 0; ``killpg`` did not raise): when not, only ``proc``
    is sure to be gone and its descendants may survive."""
    confirmed = False
    if os.name == "nt":
        try:
            done = subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL, timeout=KILL_TREE_TIMEOUT_S,
                                  check=False)
            confirmed = done.returncode == 0
        except (OSError, subprocess.SubprocessError):
            pass
    else:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
            confirmed = True
        except (OSError, AttributeError):
            pass
    try:
        proc.kill()
    except OSError:
        pass
    proc.wait()
    return confirmed


# Whether the last overrun's tree kill was confirmed (``run_engine`` keeps
# its injectable ``(exit | None, timed_out, duration_ms)`` return, so the
# flag travels here; ``run`` resets it before each start).
LAST_TREE_KILL_CONFIRMED = True
TREE_KILL_UNCONFIRMED = " (process tree kill not confirmed)"


def run_engine(argv: list[str], *, cwd: Path, log_path: Path,
               timeout_s: float) -> tuple[int | None, bool, int]:
    """Start the engine with stdout and stderr streaming to ``log_path``
    and stdin closed (on POSIX in a new session, so its group is its
    tree); kill the tree on overrun. Returns ``(exit | None, timed_out,
    duration_ms)``; an overrun whose tree kill is not confirmed clears
    ``LAST_TREE_KILL_CONFIRMED``. Module-level so tests inject a fake."""
    global LAST_TREE_KILL_CONFIRMED
    started = time.monotonic()
    extra = {} if os.name == "nt" else {"start_new_session": True}
    with open(log_path, "wb") as log:
        proc = subprocess.Popen(argv, cwd=str(cwd), stdin=subprocess.DEVNULL,
                                stdout=log, stderr=subprocess.STDOUT, **extra)
        try:
            code: int | None = proc.wait(timeout=timeout_s)
            timed_out = False
        except subprocess.TimeoutExpired:
            if not kill_tree(proc):
                LAST_TREE_KILL_CONFIRMED = False
            code, timed_out = None, True
    return code, timed_out, int((time.monotonic() - started) * 1000)


# ------------------------------------------------------------------ verdict

def scan_log(log_path: Path) -> list[str]:
    """The first ``MAX_LOG_ERRORS`` ``ERROR:`` / ``SCRIPT ERROR:`` /
    ``SHADER ERROR:`` lines (the one definition of an error line, shared
    with the harness's logger), before and after the end marker alike."""
    return scan_log_split(log_path)[0]


def scan_log_split(log_path: Path) -> tuple[list[str], list[str]]:
    """``(log_errors, guard_errors)``: the first ``MAX_LOG_ERRORS`` error
    lines of the whole log, and the first ones before the harness's
    ``HARNESS_DETACHED`` marker (the whole log's when there is no marker),
    the ones the verdict override may cite."""
    try:
        text = log_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return [], []
    errors: list[str] = []
    before: list[str] = []
    marked = False
    for line in text.splitlines():
        if not marked and line.strip() == HARNESS_DETACHED:
            marked = True
            continue
        if ERROR_LINE.match(line):
            if len(errors) < MAX_LOG_ERRORS:
                errors.append(line.strip())
            if not marked and len(before) < MAX_LOG_ERRORS:
                before.append(line.strip())
            if len(errors) >= MAX_LOG_ERRORS and (marked or len(before) >= MAX_LOG_ERRORS):
                break
    return errors, (before if marked else errors)


def _write_atomic(path: Path, data: bytes) -> None:
    tmp = path.with_name(f"{path.name}.tk-studio-{os.getpid()}.tmp")
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def _base_report(scenario: dict, seed: int, ticks: int, mode: str,
                 failed: dict) -> dict:
    """The report this core writes when the harness wrote none."""
    return {"schema": 1, "verdict": "fail", "failed": failed, "seed": seed,
            "ticks": ticks, "ticks_run": None,
            "capture_every": scenario.get("capture_every", DEFAULT_CAPTURE_EVERY),
            "mode": mode, "frames": [],
            "moments": [{"name": m["name"], "tick": m["tick"], "frame": None}
                        for m in scenario.get("moments") or []],
            "frame_time_ms": None}


def describe(failed: dict | None) -> str:
    if not isinstance(failed, dict):
        return "the harness named no failure"
    text = str(failed.get("invariant") or "?")
    if failed.get("tick") is not None:
        text += f" failed at tick {failed['tick']}"
    if failed.get("detail"):
        text += f": {failed['detail']}"
    return text


def missing_frames(report: dict, out_dir: Path) -> str | None:
    """Why a pass's ``frames[]`` does not prove ``<out>/frames/*.png``
    (None when every named file exists under ``out_dir``)."""
    frames = report.get("frames")
    if not isinstance(frames, list) or not frames:
        return "the report names no frames"
    root = out_dir.resolve()
    for item in frames:
        name = item.get("file") if isinstance(item, dict) else None
        if not isinstance(name, str) or not name:
            return f"a frames[] entry names no file: {item!r}"
        path = (root / name).resolve()
        if not _inside(path, root) or not path.is_file():
            return f"frame file {name} does not exist under the out folder"
    return None


def judge(report: dict | None, *, scenario: dict, seed: int, ticks: int,
          mode: str, code: int | None, timed_out: bool, wall_clock_s: float,
          log_errors: list[str], unreadable: str | None = None,
          out_dir: Path | None = None,
          tree_kill_confirmed: bool = True,
          guard_errors: list[str] | None = None) -> tuple[dict, str | None]:
    """The final report (without ``run``) and the failure reason (None on
    a pass). With ``out_dir``, a display or movie pass must name frame
    files that exist under it (headless renders nothing by design). An
    overrun whose tree kill was not confirmed says so in its detail.
    ``guard_errors`` (default ``log_errors``) are the error lines before
    the harness's end marker, the only ones that override a pass."""
    if guard_errors is None:
        guard_errors = log_errors
    if timed_out:
        detail = f"{wall_clock_s:g}s exceeded"
        if not tree_kill_confirmed:
            detail += TREE_KILL_UNCONFIRMED
        failed = {"invariant": "wall-clock", "detail": detail}
        report = dict(report) if report else _base_report(scenario, seed, ticks, mode, failed)
        report.update(verdict="fail", failed=failed)
        return report, describe(failed)
    if report is None:
        detail = (f"report.json unreadable ({unreadable}; exit {code})" if unreadable
                  else f"no report.json (exit {code})")
        failed = {"invariant": "harness", "detail": detail}
        return _base_report(scenario, seed, ticks, mode, failed), describe(failed)
    report = dict(report)
    verdict = report.get("verdict")
    if verdict == "pass":
        if code != 0:
            failed = {"invariant": "harness", "detail": f"report verdict pass but exit {code}"}
            report.update(verdict="fail", failed=failed)
            return report, describe(failed)
        if out_dir is not None and mode != "headless":
            why = missing_frames(report, out_dir)
            if why is not None:
                failed = {"invariant": "frames", "detail": f"{why} ({mode} mode)"}
                report.update(verdict="fail", failed=failed)
                return report, describe(failed)
        # The host scan sees boot lines printed before the harness attached,
        # so it overrides a pass only for a guard watching from tick 0; a
        # later from_tick is the harness's own verdict. Lines after the
        # harness's end marker are shutdown's, no tick's: they never count.
        guard = next((inv for inv in scenario.get("invariants") or []
                      if inv.get("kind") == "no_error_log"
                      and inv.get("from_tick", 0) == 0), None)
        if guard is not None and guard_errors:
            failed = {"invariant": guard["name"],
                      "detail": f"error line in the log: {guard_errors[0]}"}
            report.update(verdict="fail", failed=failed)
            return report, describe(failed)
        return report, None
    if verdict == "fail":
        if code == 0:
            return report, f"report verdict fail but exit 0: {describe(report.get('failed'))}"
        return report, describe(report.get("failed"))
    failed = {"invariant": "harness",
              "detail": f"report.json verdict {verdict!r} is not pass or fail (exit {code})"}
    report.update(verdict="fail", failed=failed)
    return report, describe(failed)


def with_block(result: dict, status: str, artifacts: list[str],
               reason: str | None) -> dict:
    """``result`` with the AD-11 block keys appended last, in order."""
    out = {k: v for k, v in result.items() if k not in BLOCK_KEYS}
    out.update(status=status, intent=INTENT, artifacts=list(artifacts), reason=reason)
    return out


# --------------------------------------------------------------------- verb

def run(*, directory: str, scenario: str, seed: str, ticks: str, out: str,
        mode: str = PLAYABLE_PATH, wall_clock: str | float = DEFAULT_WALL_CLOCK_S,
        godot: str | None = None, env=None) -> tuple[dict, int]:
    """One playable run. Returns ``(result with the status block, exit)``."""
    global LAST_TREE_KILL_CONFIRMED
    try:
        if mode not in MODES:
            raise Refusal(f"--mode {mode!r} is not one of " + ", ".join(MODES))
        seed_n = _non_negative_int("--seed", seed, maximum=SEED_MAX, parsed_as="a ulong")
        ticks_n = _non_negative_int("--ticks", ticks, positive=True, maximum=INT32_MAX,
                                    parsed_as="an int32")
        try:
            wall = float(wall_clock)
        except (TypeError, ValueError):
            raise Refusal(f"--wall-clock {wall_clock!r} is not a number") from None
        if not (math.isfinite(wall) and 0 < wall <= MAX_WALL_CLOCK_S):
            raise Refusal(f"--wall-clock {wall:g} must be a finite number of seconds "
                          f"> 0 and <= {MAX_WALL_CLOCK_S}")
        engine = resolve_godot(godot, env)
        project = resolve_project(directory)
        require_harness_autoload(project)
        scenario_path = Path(scenario).resolve()
        doc = load_scenario(scenario_path)
        out_dir = Path(out).resolve()
        if _inside(out_dir, project):
            raise Refusal(f"--out {out_dir} is inside the Godot project {project} (its log "
                          "and frames would land in res:// and be imported); pick a "
                          "folder outside it")
        argv = engine_argv(engine, project, mode, scenario_path, seed_n, ticks_n, out_dir)
        try:
            (out_dir / FRAMES).mkdir(parents=True, exist_ok=True)
            stale = out_dir / REPORT
            if stale.exists():
                stale.unlink()
            # an earlier run's frames never count as this run's
            for png in (out_dir / FRAMES).glob("*.png"):
                if png.is_file():
                    png.unlink()
        except OSError as exc:
            raise Refusal(f"--out {out_dir}: {exc}") from None
        log_path = out_dir / LOG
        LAST_TREE_KILL_CONFIRMED = True
        try:
            code, timed_out, duration_ms = run_engine(argv, cwd=project, log_path=log_path,
                                                      timeout_s=wall)
        except OSError as exc:
            raise Refusal(f"could not start {engine}: {exc}") from None
    except Refusal as exc:
        return with_block({"ok": False, "error": str(exc)}, "blocked", [], str(exc)), 2

    harness, unreadable = None, None
    report_path = out_dir / REPORT
    if report_path.is_file():
        try:
            harness = json.loads(report_path.read_text(encoding="utf-8-sig"))
            if not isinstance(harness, dict):
                harness, unreadable = None, "not a JSON object"
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            unreadable = str(exc)
    log_errors, guard_errors = scan_log_split(log_path)
    report, reason = judge(harness, scenario=doc, seed=seed_n, ticks=ticks_n, mode=mode,
                           code=code, timed_out=timed_out, wall_clock_s=wall,
                           log_errors=log_errors, unreadable=unreadable, out_dir=out_dir,
                           tree_kill_confirmed=LAST_TREE_KILL_CONFIRMED,
                           guard_errors=guard_errors)
    report["log_errors"] = log_errors
    report["run"] = {"argv": argv, "exit": code, "duration_ms": duration_ms,
                     "timed_out": timed_out, "wall_clock_s": wall, "godot": engine}
    passed = reason is None
    result = {"ok": passed, "verdict": report["verdict"], "failed": report.get("failed"),
              "out": str(out_dir), "mode": mode, "exit": code, "timed_out": timed_out,
              "duration_ms": duration_ms}
    try:
        _write_atomic(report_path, (json.dumps(report, indent=2, ensure_ascii=False)
                                    + "\n").encode("utf-8"))
    except OSError as exc:
        # the engine ran: still end in the status block, never a traceback
        result["ok"] = False
        # (the merged report is not on disk, so it is not an artifact)
        return (with_block(result, "partial", [a for a in ARTIFACTS if a != REPORT],
                           f"{REPORT} not written: {exc}"), 1)
    return (with_block(result, "complete" if passed else "partial", ARTIFACTS, reason),
            0 if passed else 1)


# ---------------------------------------------------------------------- cli

class _Parser(argparse.ArgumentParser):
    """A bad invocation is a refusal with a status block, never a usage
    dump alone."""

    def error(self, message: str):  # noqa: D401 - argparse hook
        raise Refusal(f"bad invocation: {message}")


def _emit(result: dict) -> None:
    print(json.dumps(result, indent=2, ensure_ascii=False))


def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = _Parser(description="tk-studio playable — a bounded, seeded playable run")
    sub = parser.add_subparsers(dest="command", required=True, parser_class=_Parser)
    p = sub.add_parser("run", help="run the game under a scenario; frames and a verdict")
    p.add_argument("--directory", required=True, help="the project (or its parent holding one */project.godot)")
    p.add_argument("--scenario", required=True, help="the scenario JSON (schema 1)")
    p.add_argument("--seed", required=True)
    p.add_argument("--ticks", required=True)
    p.add_argument("--out", required=True, help="output folder: report.json, frames/, log.txt")
    p.add_argument("--mode", default=PLAYABLE_PATH, help="display | movie | headless")
    p.add_argument("--wall-clock", default=DEFAULT_WALL_CLOCK_S,
                   help=f"seconds before an overrun is killed (default {DEFAULT_WALL_CLOCK_S})")
    p.add_argument("--godot", help="the engine binary (default: GODOT from the environment)")
    try:
        args = parser.parse_args(argv)
    except Refusal as exc:
        _emit(with_block({"ok": False, "error": str(exc)}, "blocked", [], str(exc)))
        return 2
    result, code = run(directory=args.directory, scenario=args.scenario, seed=args.seed,
                       ticks=args.ticks, out=args.out, mode=args.mode,
                       wall_clock=args.wall_clock, godot=args.godot)
    _emit(result)
    return code


if __name__ == "__main__":
    sys.exit(main())
