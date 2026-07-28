"""Tests for the council shell (ST-5.2 acceptance criteria).

The shell is data assets loaded only in attended sessions; the comparison
test proves the attended path (resolve + shell) and the headless path
(resolve alone) make identical routing decisions — presentation is the only
difference (AD-9, AD-11).
"""
from __future__ import annotations

import inspect
import os
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config as configlib  # noqa: E402
import orchestrate  # noqa: E402
import recommend  # noqa: E402

LOCK = """\
lock_version: 1
core:
  package: bmad-method
  version: 6.10.0
modules:
  bmm:
    version: 6.10.0
"""


def _tree_snapshot(root: Path) -> dict[str, float]:
    return {str(p.relative_to(root)): (p.stat().st_mtime if p.is_file() else 0)
            for p in root.rglob("*")}


class CouncilShellTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        self.store = base / "store"
        os.environ["TK_STUDIO_HOME"] = str(self.store)
        self.store.mkdir(parents=True)
        (self.store / "config.yaml").write_text(
            "user_name: tester\nrole: direction-giver\nmachine_id: box\n",
            encoding="utf-8")
        self.root = base / "proj"
        self.root.mkdir()
        self.lock = base / "bmad.lock"
        self.lock.write_text(LOCK, encoding="utf-8", newline="\n")
        configlib.standup_project_config(self.root)
        recommend.record(self.root, "direction-giver", ["bmm"])

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()

    # --- AC 1: persona voice + convene come from data assets, no state

    def test_shell_ships_as_data_assets(self):
        shell = orchestrate.load_shell()
        self.assertEqual(shell["shell_version"], 1)
        self.assertIn("shell", shell["assets"])    # persona voice
        self.assertIn("convene", shell["assets"])  # signature interaction
        self.assertIn("convene the council", shell["assets"]["shell"].lower())
        # deliberation is over installed agents, and only installed ones
        self.assertIn("installed", shell["assets"]["convene"].lower())

    def test_shell_carries_no_identity_state_machinery(self):
        # AD-9: loading the shell touches no file anywhere — no identity
        # store, no council memory, not even inside its own asset directory.
        shell_dir = orchestrate.SHELL_DIR
        before = _tree_snapshot(shell_dir)
        orchestrate.load_shell()
        self.assertEqual(before, _tree_snapshot(shell_dir))

    def test_shell_load_is_pure_presentation_no_store_or_project_writes(self):
        before_store = _tree_snapshot(self.store)
        before_proj = _tree_snapshot(self.root)
        orchestrate.load_shell()
        self.assertEqual(before_store, _tree_snapshot(self.store))
        self.assertEqual(before_proj, _tree_snapshot(self.root))

    def test_missing_assets_fail_loud_not_silent(self):
        with self.assertRaises(orchestrate.OrchestrateError):
            orchestrate.load_shell(shell_dir=self.root / "no-council")

    # --- AC 2: identical routing attended vs headless (the comparison test)

    def test_attended_and_headless_routing_identical(self):
        # Headless path: resolution alone.
        headless = orchestrate.resolve(self.root, lock_path=self.lock)
        # Attended path: the same resolution, then the shell on top.
        attended = orchestrate.resolve(self.root, lock_path=self.lock)
        shell = orchestrate.load_shell()
        # Routing decisions and would-be artifacts are byte-identical.
        self.assertEqual(headless, attended)
        # The shell added presentation only — nothing it returns feeds back:
        # the resolution result contains no shell content and vice versa.
        self.assertNotIn("assets", attended)
        self.assertNotIn("routes", shell)
        self.assertNotIn("working_set", shell)

    def test_core_cannot_even_branch_on_mode(self):
        # The strongest parity proof: resolve() has no mode/attended/headless
        # parameter — the core is structurally incapable of diverging.
        params = set(inspect.signature(orchestrate.resolve).parameters)
        self.assertEqual(params, {"project_root", "role", "lock_path"})

    def test_shell_load_does_not_change_a_subsequent_resolution(self):
        first = orchestrate.resolve(self.root, lock_path=self.lock)
        orchestrate.load_shell()
        second = orchestrate.resolve(self.root, lock_path=self.lock)
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
