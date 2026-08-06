"""The utf-8 stdout guard holds across every shipped CLI (AD-11).

Windows consoles default to cp1252 while the CLIs print unicode payloads
(entity titles, descriptions) with ensure_ascii=False. A print-only crash
after the work has already landed is exactly the silent divergence AD-11
forbids, so every main() reconfigures stdout to utf-8 before printing.

Two layers: a static sweep that keeps future CLIs honest, and a live
subprocess check on observe.py — the CLI that demonstrably crashed —
under a forced-cp1252 stdout.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
LIB = PLUGIN_ROOT / "lib"

GUARD_CALL = 'sys.stdout.reconfigure(encoding="utf-8")'


def _cli_modules() -> list[Path]:
    """Every shipped python entry point: lib/*.py, skills/*/scripts/*.py,
    and the conformance runner. A module counts as a CLI iff it defines
    main()."""
    candidates = sorted(LIB.glob("*.py"))
    candidates += sorted(PLUGIN_ROOT.glob("skills/*/scripts/*.py"))
    candidates.append(PLUGIN_ROOT / "contracts" / "conformance" / "runner.py")
    out = []
    for path in candidates:
        if re.search(r"^def main\(", path.read_text(encoding="utf-8"),
                     re.M):
            out.append(path)
    return out


class StaticGuardSweep(unittest.TestCase):
    def test_every_cli_reconfigures_stdout_inside_main(self):
        missing = []
        for path in _cli_modules():
            src = path.read_text(encoding="utf-8")
            main_at = src.index("def main(")
            if GUARD_CALL not in src[main_at:]:
                missing.append(str(path.relative_to(PLUGIN_ROOT)))
        self.assertEqual(
            missing, [],
            "CLIs missing the utf-8 stdout guard in main() (AD-11): "
            + ", ".join(missing))

    def test_sweep_actually_finds_the_clis(self):
        """Guard the guard: the module scan must keep seeing the known
        surface, or the static sweep silently checks nothing."""
        found = {p.name for p in _cli_modules()}
        for expected in ("plansync.py", "observe.py", "migrate.py",
                         "runner.py", "drift_check.py"):
            self.assertIn(expected, found)
        self.assertGreaterEqual(len(found), 25)


class Cp1252ConsoleRoundTrip(unittest.TestCase):
    def test_observe_record_survives_cp1252_stdout(self):
        """observe.py was the demonstrated crasher: the event landed on the
        ledger but the result print died. Force a cp1252 stdout and require
        the full unicode payload back."""
        description = "renumbering local → Jira ids by hand"
        with tempfile.TemporaryDirectory() as tmp:
            env = dict(os.environ)
            env["TK_STUDIO_HOME"] = str(Path(tmp) / "store")
            env["PYTHONIOENCODING"] = "cp1252"
            proc = subprocess.run(
                [sys.executable, str(LIB / "observe.py"), "record",
                 "--source", "repeated-manual-work",
                 "--description", description],
                capture_output=True, env=env, stdin=subprocess.DEVNULL)
            self.assertEqual(
                proc.returncode, 0,
                f"stderr: {proc.stderr.decode('utf-8', 'replace')}")
            result = json.loads(proc.stdout.decode("utf-8"))
            self.assertTrue(result["ok"])
            self.assertEqual(result["envelope"]["payload"]["description"],
                             description)


if __name__ == "__main__":
    unittest.main()
