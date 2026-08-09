"""Release-discipline guard (ST-048): the skill roster must never outrun
the version gate. released-roster.json is the gate's third file — the skill
list delivered at the recorded version, bumped in lockstep with plugin.json
and marketplace.json by the release motion.

The EP-012 gap this guards against: three shipped skills the installed
plugin never delivered because the gate was never pulled — the roster grew,
the version did not, and AD-13's lockstep check passed trivially. The
real-repo test here goes red in exactly that shape.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PLUGIN_ROOT / "lib"))
sys.path.insert(0, str(PLUGIN_ROOT / "skills" / "tk-studio-activate" / "scripts"))

import drift_check  # noqa: E402

REPO_PLUGIN = json.loads(
    (PLUGIN_ROOT / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
REPO_MARKETPLACE = json.loads(
    (PLUGIN_ROOT.parents[1] / ".claude-plugin" / "marketplace.json")
    .read_text(encoding="utf-8"))
ROSTER_RECORD = PLUGIN_ROOT / ".claude-plugin" / "released-roster.json"


def _plugin_fixture(tmp: Path, version: str, roster: list[str],
                    recorded_version: str | None = None,
                    recorded: list[str] | None = None) -> Path:
    root = tmp / "plugin"
    (root / ".claude-plugin").mkdir(parents=True)
    for skill in roster:
        d = root / "skills" / skill
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text("# skill\n", encoding="utf-8")
    if recorded is not None or recorded_version is not None:
        (root / ".claude-plugin" / "released-roster.json").write_text(
            json.dumps({"version": recorded_version or version,
                        "skills": recorded if recorded is not None else roster}),
            encoding="utf-8")
    return root


class RealRepoGateTestCase(unittest.TestCase):
    """The guard itself: these go red the moment skills/ changes without a
    version-gate pull — green again when the release motion bumps the gate
    and roster together."""

    def test_repo_roster_rides_the_version_gate(self):
        check = drift_check._released_roster_check(
            PLUGIN_ROOT, REPO_PLUGIN["version"])
        self.assertEqual(check["status"], "ok", check["detail"])

    def test_gate_files_are_in_three_way_lockstep(self):
        entry = next(p for p in REPO_MARKETPLACE["plugins"]
                     if p["name"] == REPO_PLUGIN["name"])
        record = json.loads(ROSTER_RECORD.read_text(encoding="utf-8"))
        self.assertEqual(
            {REPO_PLUGIN["version"], entry["version"], record["version"]},
            {REPO_PLUGIN["version"]},
            "plugin.json, marketplace.json, and released-roster.json must "
            "bump together (the release motion)")


class RosterGuardShapeTestCase(unittest.TestCase):
    def test_roster_growth_at_unchanged_gate_goes_red(self):
        # the EP-012 gap shape: roster grew, version unchanged
        with tempfile.TemporaryDirectory() as tmp:
            root = _plugin_fixture(Path(tmp), "1.0.0",
                                   ["tk-a", "tk-b", "tk-new"],
                                   recorded=["tk-a", "tk-b"])
            check = drift_check._released_roster_check(root, "1.0.0")
        self.assertEqual(check["status"], "drift")
        self.assertIn("+tk-new", check["detail"])
        self.assertIn("outran the version gate", check["detail"])
        self.assertEqual(check["fix"], drift_check.FIX_RELEASE)
        self.assertIn("release motion", check["fix"])

    def test_shrunk_roster_is_named_too(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _plugin_fixture(Path(tmp), "1.0.0", ["tk-a"],
                                   recorded=["tk-a", "tk-gone"])
            check = drift_check._released_roster_check(root, "1.0.0")
        self.assertEqual(check["status"], "drift")
        self.assertIn("-tk-gone", check["detail"])

    def test_gate_and_roster_bumped_together_is_green(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _plugin_fixture(Path(tmp), "1.1.0",
                                   ["tk-a", "tk-b", "tk-new"],
                                   recorded=["tk-a", "tk-b", "tk-new"])
            check = drift_check._released_roster_check(root, "1.1.0")
        self.assertEqual(check["status"], "ok", check["detail"])

    def test_record_out_of_lockstep_with_the_gate_is_drift(self):
        # the gate bumped but the third file did not ride the motion
        with tempfile.TemporaryDirectory() as tmp:
            root = _plugin_fixture(Path(tmp), "1.1.0", ["tk-a"],
                                   recorded_version="1.0.0",
                                   recorded=["tk-a"])
            check = drift_check._released_roster_check(root, "1.1.0")
        self.assertEqual(check["status"], "drift")
        self.assertIn("out of lockstep", check["detail"])
        self.assertEqual(check["fix"], drift_check.FIX_RELEASE)

    def test_missing_record_is_drift_naming_the_release_motion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _plugin_fixture(Path(tmp), "1.0.0", ["tk-a"])
            check = drift_check._released_roster_check(root, "1.0.0")
        self.assertEqual(check["status"], "drift")
        self.assertIn("released-roster.json missing", check["detail"])
        self.assertEqual(check["fix"], drift_check.FIX_RELEASE)

    def test_unreadable_record_is_error_not_a_crash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _plugin_fixture(Path(tmp), "1.0.0", ["tk-a"])
            (root / ".claude-plugin" / "released-roster.json").write_text(
                "{not json", encoding="utf-8")
            check = drift_check._released_roster_check(root, "1.0.0")
        self.assertEqual(check["status"], "error")
        self.assertIn("unreadable", check["detail"])

    def test_plugin_plane_reports_roster_drift_riding_the_shape(self):
        # AC: the plane reports drift with guidance naming the release
        # motion, riding the existing planes/fixes shape
        with tempfile.TemporaryDirectory() as tmp:
            root = _plugin_fixture(Path(tmp), "1.0.0", ["tk-a", "tk-new"],
                                   recorded=["tk-a"])
            (root / ".claude-plugin" / "plugin.json").write_text(
                json.dumps({"name": "tk-studio", "version": "1.0.0"}),
                encoding="utf-8")
            home = Path(tmp) / "home"
            (home / "plugins").mkdir(parents=True)
            cache = home / "cache" / "1.0.0"
            cache.mkdir(parents=True)
            (home / "plugins" / "installed_plugins.json").write_text(
                json.dumps({"version": 2, "plugins": {"tk-studio@m": [
                    {"scope": "user", "version": "1.0.0",
                     "installPath": str(cache)}]}}), encoding="utf-8")
            old = drift_check.PLUGIN_ROOT
            drift_check.PLUGIN_ROOT = root
            try:
                plane = drift_check.check_plugin(Path(tmp) / "proj", None, home)
            finally:
                drift_check.PLUGIN_ROOT = old
        self.assertEqual(plane["plane"], "plugin")
        self.assertEqual(plane["status"], "drift")
        self.assertIn("outran the version gate", plane["detail"])
        self.assertIn("harness-loadable", plane["detail"])
        self.assertIn("release motion", plane["fix"])


if __name__ == "__main__":
    unittest.main()
