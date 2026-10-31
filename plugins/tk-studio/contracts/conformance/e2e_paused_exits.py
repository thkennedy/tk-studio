"""The Story 36.3 e2e drive — a paused or resumed run is never parked.

    unblock verb   `track.py unblock` in a throwaway unbound folder refuses by
                   name in JSON (exit 2), no Atlassian call made

then the supervisor half (the tier-routed re-arm with no host injection,
`track-unblock` once per block, the boundary's end, the bounded stop, the WIP
commit) the way the supervisor's own gate runs it: locate the checkout (the
folder holding `apps/supervisor/package.json`) → find `bun` → `bun test
test/closeout.test.ts test/sweep.test.ts -t "Story 36.3"` from `apps/supervisor`
under a fresh temp folder, `TK_SUPERVISOR_*` stripped, bounded at `BOUND_S`. No
checkout or no `bun`: that step is `ok: true` with `not_run` naming which (the
`cli_drives` precedent). Prints one JSON object {ok, steps[]} and exits nonzero
on a red step. Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import contextlib
import io
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
SUITES = ["test/closeout.test.ts", "test/sweep.test.ts"]
FILTER = "Story 36.3"
INSTALL_BOUND_S = 40
BOUND_S = suite_bound("e2e_paused_exits.py", install_s=INSTALL_BOUND_S)
# A multi-file run needs the flag: the preload's `setDefaultTimeout` reaches only the first file (bun 1.4.3).
TEST_TIMEOUT_MS = "30000"
TAIL = 20


def lib_steps() -> list[dict]:
    sys.path.insert(0, str(PLUGIN_ROOT / "lib"))
    import track  # noqa: E402 - the plugin's own module
    base = tempfile.mkdtemp(prefix="tk-paused-exits-")
    try:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = track.main(["unblock", "--directory", base, "--story", "ST-001", "--reason", "resumed"])
        result = json.loads(out.getvalue())
        ok = (code == 2 and result["status"] == "blocked" and result["intent"] == "tk-studio-track"
              and "no Atlassian call made" in (result["reason"] or ""))
        return [{"step": "unblock-verb", "ok": ok, "detail": f"exit {code}: {result['reason']}"}]
    finally:
        shutil.rmtree(base, ignore_errors=True)


def _checkout(start: Path) -> Path | None:
    """The folder above ``start`` holding ``apps/supervisor/package.json``."""
    for folder in (start, *start.parents):
        if (folder / "apps" / "supervisor" / "package.json").is_file():
            return folder
    return None


def suite_steps() -> list[dict]:
    steps: list[dict] = []
    checkout = _checkout(PLUGIN_ROOT)
    if checkout is None:
        return [{"step": "locate", "ok": True, "not_run": "no checkout"}]
    supervisor = checkout / "apps" / "supervisor"
    steps.append({"step": "locate", "ok": True, "detail": str(supervisor)})
    bun = shutil.which("bun")
    if bun is None:
        steps.append({"step": "bun", "ok": True, "not_run": "bun absent"})
        return steps
    steps.append({"step": "bun", "ok": True, "detail": bun})
    temp = tempfile.mkdtemp(prefix="tk-paused-exits-suite-")
    try:
        env = {k: v for k, v in os.environ.items() if not k.startswith("TK_SUPERVISOR_")}
        env.pop("TK_STUDIO_ROOT", None)
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
                return steps
            if inst.returncode != 0:
                steps.append({"step": "install", "ok": False,
                              "detail": f"bun install exit {inst.returncode}: "
                                        f"{(inst.stderr or inst.stdout).strip()[-300:]}"})
                return steps
            steps.append({"step": "install", "ok": True,
                          "detail": "bun install --frozen-lockfile (node_modules was absent)"})
        started = time.monotonic()
        try:
            proc = subprocess.run(
                [bun, "test", "--timeout", TEST_TIMEOUT_MS, *SUITES, "-t", FILTER], cwd=str(supervisor), env=env,
                stdin=subprocess.DEVNULL, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=BOUND_S)
        except subprocess.TimeoutExpired:
            steps.append({"step": "suite", "ok": False,
                          "detail": f"bun test {' '.join(SUITES)} hung past {BOUND_S}s"})
            return steps
        lines = f"{proc.stdout}{proc.stderr}".rstrip().splitlines()
        steps.append({"step": "suite", "ok": proc.returncode == 0,
                      "detail": f"bun test {' '.join(SUITES)} -t \"{FILTER}\" "
                                + ("green" if proc.returncode == 0 else
                                   f"exit {proc.returncode}: " + " | ".join(lines[-TAIL:])),
                      "duration_ms": int((time.monotonic() - started) * 1000)})
        return steps
    finally:
        shutil.rmtree(temp, ignore_errors=True)


def run() -> dict:
    steps = lib_steps()
    if all(s["ok"] for s in steps):
        steps += suite_steps()
    return {"ok": all(s["ok"] for s in steps), "steps": steps}


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    del argv  # no arguments: the drive builds its own fixtures
    try:
        result = run()
    except Exception as exc:  # a drive failure must still be machine-readable
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
