"""The one suite bound the bun-suite drives share (Story 36.4, DW-112, hole 97).

A drive that runs a bun suite answers `ok: false` when its own bound trips, and
it must trip before the runner's: the runner kills the drive at the manifest
entry's `timeout`, leaving an orphaned suite. So the suite's bound derives from
that `timeout`, never a copy of it:

    suite_bound = timeout - install_s - other_s - headroom_s

`install_s` is the drive's `bun install` bound, `other_s` any other bound it
spends before the suite, and `headroom_s` what is left for the drive's own
Python and its temp-folder removal. Stdlib-only; a helper, not a CLI: no main.
"""
from __future__ import annotations

import json
from pathlib import Path

MANIFEST_PATH = Path(__file__).resolve().parent / "manifest.json"
HEADROOM_S = 15


def _manifest_timeout(script: str) -> int:
    """The `timeout` of the manifest drive that runs `script`; the runner's default without one."""
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    target = f"contracts/conformance/{script}"
    for surface in manifest["surfaces"].values():
        for drive in surface.get("drives", []):
            if drive.get("argv", [None])[0] == target and "timeout" in drive:
                return int(drive["timeout"])
    import runner  # the sibling module; only the fallback needs it
    return int(runner.DEFAULT_TIMEOUT)


def suite_bound(script: str, *, install_s: int = 0, other_s: int = 0, headroom_s: int = HEADROOM_S) -> int:
    """How long `script`'s bun suite may run under its manifest `timeout`, in seconds."""
    timeout = _manifest_timeout(script)
    bound = timeout - install_s - other_s - headroom_s
    if bound <= 0:
        raise ValueError(f"{script}: suite bound {bound} s is not positive "
                         f"(timeout {timeout} - install {install_s} - other {other_s} - headroom {headroom_s})")
    return bound
