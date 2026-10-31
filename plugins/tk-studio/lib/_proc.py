"""The studio's bounded child process: a tree kill and one logged run
(Story 36.7, DW-85).

A leaf shared by `assets.py` (`run_blender`) and `playable.py` (`run_engine`),
so neither imports the other; `playable.py` re-exports `kill_tree` and
`KILL_TREE_TIMEOUT_S`. Stdlib-only (NFR9).
"""
from __future__ import annotations

import os
import signal
import subprocess
import time
from pathlib import Path

# the bounded wait for `taskkill /T` before the plain kill fallback
KILL_TREE_TIMEOUT_S = 10


def kill_tree(proc: subprocess.Popen) -> bool:
    """Kill ``proc`` and its descendants (on the box ``$GODOT`` is the
    ``*_console.exe`` wrapper that starts the real engine as a child), then
    reap it. Windows: ``taskkill /T /F`` bounded by a timeout; POSIX: the
    process group ``run_logged`` started it in. ``proc.kill()`` is the
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


def run_logged(argv: list[str], *, cwd: Path, log_path: Path, timeout_s: float,
               kill=kill_tree) -> tuple[int | None, bool, int, bool]:
    """Start ``argv`` with stdout and stderr streaming to ``log_path`` and
    stdin closed (on POSIX in a new session, so its group is its tree); kill
    the tree on overrun. Returns ``(exit | None, timed_out, duration_ms,
    tree kill confirmed)``; the last is True when no kill was needed."""
    started = time.monotonic()
    confirmed = True
    extra = {} if os.name == "nt" else {"start_new_session": True}
    with open(log_path, "wb") as log:
        proc = subprocess.Popen(argv, cwd=str(cwd), stdin=subprocess.DEVNULL,
                                stdout=log, stderr=subprocess.STDOUT, **extra)
        try:
            code: int | None = proc.wait(timeout=timeout_s)
            timed_out = False
        except subprocess.TimeoutExpired:
            confirmed = bool(kill(proc))
            code, timed_out = None, True
    return code, timed_out, int((time.monotonic() - started) * 1000), confirmed
