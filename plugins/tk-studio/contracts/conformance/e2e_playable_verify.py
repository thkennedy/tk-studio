"""The Story 34.3 e2e drive — the playable-verify leg over a fake judge.

After a green engine gate the supervisor's host leg runs `playable.py run`,
copies the media into the worktree's `.bmad-loop/runs/<engine>/playable/`
and drives the `tk-studio-playable-judge` session on the sandbox tier; the
verdict rides `host-verify` as `playable` (contract 0.1.29). This drive
proves both halves without a model, Godot or a sandbox:

    core   a fresh media folder (report.json, two frames) → `playable_judge.py
           prepare` answers the rubric → a scripted `pass` answer (the fake
           judge) through `verdict` writes judge.json → a scripted `fail`
           answer writes its findings → a folder without frames refuses
           `no frames`, blocked, exit 2
    suite  locate the checkout (walk up from the plugin root to the folder
           holding `apps/supervisor/package.json`) → find `bun` on PATH →
           `bun test test/hostverify.test.ts -t "Story 34.3"` from
           `apps/supervisor` under a fresh temp folder (removed afterwards:
           the Story 33.4 rule), `TK_SUPERVISOR_*` stripped, bounded at
           `BOUND_S` (the whole drive's worst case below the runner's 60 s)
           → judge its exit; its cases drive the leg with a fake
           `playable.py` runner and a fake judge to pass, fail and skipped

No checkout (an extracted plugin archive) or no `bun` on PATH: the suite step
is `ok: true` with `not_run` naming which (the `cli_drives` "not run"
precedent); the core step always runs. The drive prints one JSON object
{ok, steps[]} and exits nonzero on a red step. Stdlib-only (NFR9); never
prompts (AD-11).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
SUITE = "test/hostverify.test.ts"
# Hole 76: only the story's own describe block (bun matches `-t` against the full test name).
FILTER = "Story 34.3"
# The drive's own worst case, every bound spent in turn (the core's `CORE_CALLS` calls
# at `CORE_BOUND_S`, then `INSTALL_BOUND_S`, then `BOUND_S`), sits below `RUNNER_BOUND_S`:
# runner.py's 60 s drive timeout (DEFAULT_TIMEOUT; a headless drive runs under it whatever
# its manifest entry says, and the entry says the same 60). So this drive's own timeouts
# fire first: it kills the hung child, removes the temp folder in `finally` (the Story
# 33.4 rule) and reports `ok: false`, never an orphaned suite. The story's own cases
# (`-t "Story 34.3"`, hole 76) run in a few seconds.
RUNNER_BOUND_S = 60
BOUND_S = 30
# Hole 80: a fresh worktree has no apps/supervisor/node_modules; the suite cannot load
# without them, so the drive installs from the lockfile first (warm cache on the box:
# about a second), under its own bound.
INSTALL_BOUND_S = 12
TAIL = 20


def _checkout(start: Path) -> Path | None:
    """The folder above ``start`` holding ``apps/supervisor/package.json``."""
    for folder in (start, *start.parents):
        if (folder / "apps" / "supervisor" / "package.json").is_file():
            return folder
    return None


JUDGE_CORE = PLUGIN_ROOT / "lib" / "playable_judge.py"
# Each `playable_judge.py` call (stdlib, local files only): prepare, two verdicts, the refusal.
CORE_BOUND_S = 4
CORE_CALLS = 4
assert CORE_CALLS * CORE_BOUND_S + INSTALL_BOUND_S + BOUND_S < RUNNER_BOUND_S
REPORT = {
    "schema": 1, "verdict": "pass", "failed": None, "seed": 1, "ticks": 60,
    "ticks_run": 60, "capture_every": 30, "mode": "movie",
    "frames": [{"tick": 0, "file": "frames/tick-000000.png"},
               {"tick": 30, "file": "frames/tick-000030.png"}],
    "moments": [{"name": "spawn", "tick": 0, "frame": "frames/tick-000000.png"}],
    "frame_time_ms": {"max": 18.0, "mean": 16.7}, "log_errors": [], "run": {"exit": 0},
}


def _core(*argv: str) -> tuple[int, dict | None]:
    proc = subprocess.run(
        [sys.executable, str(JUDGE_CORE), *argv], stdin=subprocess.DEVNULL,
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=CORE_BOUND_S)
    try:
        return proc.returncode, json.loads(proc.stdout)
    except json.JSONDecodeError:
        return proc.returncode, None


def core_steps() -> list[dict]:
    """The judge's core over a fake judge: prepare, a pass answer, a fail
    answer, and the no-frames refusal, each judged by its status block."""
    steps: list[dict] = []
    temp = tempfile.mkdtemp(prefix="tk-playable-judge-")
    try:
        media = Path(temp) / "playable"
        (media / "frames").mkdir(parents=True)
        for item in REPORT["frames"]:
            (media / item["file"]).write_bytes(b"\x89PNG\r\n")
        (media / "report.json").write_text(json.dumps(REPORT), encoding="utf-8")
        code, out = _core("prepare", "--media", str(media))
        ok = (code == 0 and isinstance(out, dict) and out.get("status") == "complete"
              and out.get("intent") == "tk-studio-playable-judge"
              and len(out.get("rubric") or []) == 5)
        steps.append({"step": "prepare", "ok": ok, "detail": f"exit {code}"})
        for verdict, findings in (
                ("pass", []),
                ("fail", [{"frame": "frames/tick-000030.png", "rubric": "hud-reads",
                           "note": "the HUD is off screen"}])):
            answer = Path(temp) / f"answer-{verdict}.json"
            answer.write_text(json.dumps({"verdict": verdict, "findings": findings}),
                              encoding="utf-8")
            code, out = _core("verdict", "--media", str(media), "--answer", str(answer))
            try:
                judged = json.loads((media / "judge.json").read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                judged = {}
            ok = (code == 0 and isinstance(out, dict) and out.get("status") == "complete"
                  and judged.get("verdict") == verdict and judged.get("findings") == findings)
            steps.append({"step": f"verdict {verdict}", "ok": ok, "detail": f"exit {code}"})
        bare = Path(temp) / "bare"
        bare.mkdir()
        (bare / "report.json").write_text(json.dumps(dict(REPORT, frames=[])), encoding="utf-8")
        code, out = _core("prepare", "--media", str(bare))
        ok = (code == 2 and isinstance(out, dict) and out.get("status") == "blocked"
              and out.get("reason") == "no frames")
        steps.append({"step": "refusal no frames", "ok": ok, "detail": f"exit {code}"})
    except (OSError, subprocess.TimeoutExpired) as exc:
        steps.append({"step": "core", "ok": False, "detail": str(exc)})
    finally:
        shutil.rmtree(temp, ignore_errors=True)
    return steps


def run() -> dict:
    steps: list[dict] = core_steps()
    if not all(s["ok"] for s in steps):
        return {"ok": False, "steps": steps}
    checkout = _checkout(PLUGIN_ROOT)
    if checkout is None:
        steps.append({"step": "locate", "ok": True, "not_run": "no checkout"})
        return {"ok": True, "steps": steps}
    supervisor = checkout / "apps" / "supervisor"
    steps.append({"step": "locate", "ok": True, "detail": str(supervisor)})
    bun = shutil.which("bun")
    if bun is None:
        steps.append({"step": "bun", "ok": True, "not_run": "bun absent"})
        return {"ok": True, "steps": steps}
    steps.append({"step": "bun", "ok": True, "detail": bun})

    temp = tempfile.mkdtemp(prefix="tk-playable-verify-")
    try:
        env = {k: v for k, v in os.environ.items()
               if not k.startswith("TK_SUPERVISOR_")}
        env.update(TMPDIR=temp, TEMP=temp, TMP=temp)
        if not (supervisor / "node_modules").is_dir():
            try:
                inst = subprocess.run(
                    [bun, "install", "--frozen-lockfile"], cwd=str(supervisor), env=env,
                    stdin=subprocess.DEVNULL, capture_output=True, text=True,
                    encoding="utf-8", errors="replace", timeout=INSTALL_BOUND_S)
            except subprocess.TimeoutExpired:
                steps.append({"step": "install", "ok": False,
                              "detail": f"bun install hung past {INSTALL_BOUND_S}s"})
                return {"ok": False, "steps": steps}
            if inst.returncode != 0:
                steps.append({"step": "install", "ok": False,
                              "detail": f"bun install exit {inst.returncode}: "
                                        f"{(inst.stderr or inst.stdout).strip()[-300:]}"})
                return {"ok": False, "steps": steps}
            steps.append({"step": "install", "ok": True,
                          "detail": "bun install --frozen-lockfile (node_modules was absent)"})
        started = time.monotonic()
        try:
            proc = subprocess.run(
                [bun, "test", SUITE, "-t", FILTER], cwd=str(supervisor), env=env,
                stdin=subprocess.DEVNULL, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=BOUND_S)
        except subprocess.TimeoutExpired:
            steps.append({"step": "suite", "ok": False,
                          "detail": f"bun test {SUITE} hung past {BOUND_S}s"})
            return {"ok": False, "steps": steps}
        duration_ms = int((time.monotonic() - started) * 1000)
        lines = f"{proc.stdout}{proc.stderr}".rstrip().splitlines()
        if proc.returncode == 0:
            steps.append({"step": "suite", "ok": True,
                          "detail": f"bun test {SUITE} green",
                          "duration_ms": duration_ms})
            return {"ok": True, "steps": steps}
        steps.append({"step": "suite", "ok": False,
                      "detail": f"bun test {SUITE} exit {proc.returncode}: "
                                + " | ".join(lines[-TAIL:]),
                      "duration_ms": duration_ms})
        return {"ok": False, "steps": steps}
    finally:
        shutil.rmtree(temp, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    del argv  # no arguments: the drive locates its own checkout
    try:
        result = run()
    except Exception as exc:  # a drive failure must still be machine-readable
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
