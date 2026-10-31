"""The Story 34.1 e2e drive — the host leg's engine gate, both verdicts.

The supervisor's host leg runs a project's `verify.engine` after a green
`verify.host`, with the folder of `GODOT` first on PATH, and records the
verdict as `engine` on the `host-verify` event (contract 0.1.29). The leg is
supervisor code (`apps/supervisor/src/hostverify.ts`, AD-2), so this drive
proves it the way the supervisor's own gate does: it runs the Story 34.1 cases
of the leg's suite, `bun test test/hostverify.test.ts -t "Story 34.1"` (never
the whole suite: hole 76, its 33 cases take 43 s on the agent PC with real git
worktrees, past this drive's bound), whose cases drive the leg with
a fake `godot` (`fakeBin`: a bun-shebang file on POSIX, an `.exe` on Windows,
never a `.cmd`) found only through the prepended folder, to green and to red.

    locate the checkout (walk up from the plugin root to the folder holding
    `apps/supervisor/package.json`) → find `bun` on PATH → run the suite
    from `apps/supervisor` under a fresh temp folder (`TMPDIR`/`TEMP`/`TMP`,
    removed afterwards: the Story 33.4 rule), `TK_SUPERVISOR_*` stripped,
    bounded at `BOUND_S` (derived from the manifest's `timeout` for this drive
    through `_budget.py`, so a hung suite is killed and its temp folder removed
    here) → judge its exit

No checkout (an extracted plugin archive) or no `bun` on PATH: `ok: true`
with a `not_run` step naming which (the `cli_drives` "not run" precedent).
The drive prints one JSON object {ok, steps[]} and exits nonzero on a red
suite. Stdlib-only (NFR9); never prompts (AD-11).
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

from _budget import suite_bound  # the sibling helper: the suite's bound derives from the manifest entry's timeout

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
SUITE = "test/hostverify.test.ts"
# Hole 76: only the story's own describe block (bun matches `-t` against the full test name).
FILTER = "Story 34.1"
# Hole 80: a fresh worktree has no apps/supervisor/node_modules; the suite cannot load without them, so the
# drive installs from the lockfile first (warm cache on the box: about a second), under its own bound.
INSTALL_BOUND_S = 40
# Derived with the install's bound beside it, below the manifest's `timeout` for this drive (runner.py honours
# it over its DEFAULT_TIMEOUT), so this drive's own timeout fires first: it kills `bun`, removes the temp folder
# in `finally` (the Story 33.4 rule) and reports `ok: false`, never an orphaned suite.
BOUND_S = suite_bound("e2e_engine_gate.py", install_s=INSTALL_BOUND_S)
TAIL = 20


def _checkout(start: Path) -> Path | None:
    """The folder above ``start`` holding ``apps/supervisor/package.json``."""
    for folder in (start, *start.parents):
        if (folder / "apps" / "supervisor" / "package.json").is_file():
            return folder
    return None


def run() -> dict:
    steps: list[dict] = []
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

    temp = tempfile.mkdtemp(prefix="tk-engine-gate-")
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
