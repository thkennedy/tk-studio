"""Drift check plugin plane — harness loadability probe (AD-13).

Catalog lockstep (repo plugin.json vs marketplace.json) proves the repo and
marketplace agree; it says nothing about whether the harness can load the
plugin. The observed false-ok: installed_plugins.json empty, headless
'/tk-studio:<skill>' returning 'Unknown command', drift reporting plugin
plane ok. The probe reads the harness's own install record and drifts when
the plugin is absent, stale, or its cache path is gone.
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
NAME = REPO_PLUGIN["name"]
VERSION = REPO_PLUGIN["version"]


class HarnessLoadabilityTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name)
        (self.home / "plugins").mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def _write_record(self, plugins: dict):
        (self.home / "plugins" / "installed_plugins.json").write_text(
            json.dumps({"version": 2, "plugins": plugins}), encoding="utf-8")

    def _install_entry(self, version: str, install_path: Path | None = None):
        if install_path is None:
            install_path = self.home / "cache" / version
            install_path.mkdir(parents=True, exist_ok=True)
        return {"scope": "user", "installPath": str(install_path),
                "version": version}

    def test_no_install_record_is_drift(self):
        probe = drift_check._harness_loadability(NAME, VERSION, self.home)
        self.assertEqual(probe["status"], "drift")
        self.assertIn("not installed in the harness", probe["detail"])
        self.assertIn("claude plugin install", probe["fix"])

    def test_record_without_the_plugin_is_drift(self):
        # the observed false-ok: record exists but holds no tk-studio entry
        self._write_record({"other@market": [self._install_entry("1.0.0")]})
        probe = drift_check._harness_loadability(NAME, VERSION, self.home)
        self.assertEqual(probe["status"], "drift")
        self.assertIn("Unknown command", probe["detail"])

    def test_installed_at_repo_version_is_ok(self):
        self._write_record({f"{NAME}@{NAME}": [self._install_entry(VERSION)]})
        probe = drift_check._harness_loadability(NAME, VERSION, self.home)
        self.assertEqual(probe["status"], "ok")
        self.assertIn("harness-loadable", probe["detail"])

    def test_stale_harness_version_is_drift(self):
        self._write_record({f"{NAME}@{NAME}": [self._install_entry("0.0.1")]})
        probe = drift_check._harness_loadability(NAME, VERSION, self.home)
        self.assertEqual(probe["status"], "drift")
        self.assertIn("stale harness install", probe["detail"])

    def test_evicted_cache_path_is_drift(self):
        gone = self.home / "cache" / "gone"
        self._write_record({f"{NAME}@{NAME}": [
            self._install_entry(VERSION, install_path=gone)]})
        probe = drift_check._harness_loadability(NAME, VERSION, self.home)
        self.assertEqual(probe["status"], "drift")
        self.assertIn("installPath missing", probe["detail"])

    def test_unreadable_record_is_error(self):
        (self.home / "plugins" / "installed_plugins.json").write_text(
            "{not json", encoding="utf-8")
        probe = drift_check._harness_loadability(NAME, VERSION, self.home)
        self.assertEqual(probe["status"], "error")

    def test_check_plugin_merges_probe_into_the_plane(self):
        # a project without a marketplace catalog still gets the harness
        # probe — its drift elevates the plane and both details survive
        with tempfile.TemporaryDirectory() as project:
            plane = drift_check.check_plugin(Path(project), None, self.home)
        self.assertEqual(plane["plane"], "plugin")
        self.assertEqual(plane["status"], "drift")
        self.assertIn("catalog lockstep not checkable", plane["detail"])
        self.assertIn("not installed in the harness", plane["detail"])
        self.assertIn("claude plugin install", plane["fix"])

    def test_check_plugin_stays_ok_when_harness_loadable(self):
        self._write_record({f"{NAME}@{NAME}": [self._install_entry(VERSION)]})
        plane = drift_check.check_plugin(
            PLUGIN_ROOT.parents[1], None, self.home)
        self.assertEqual(plane["status"], "ok")
        self.assertIn("harness-loadable", plane["detail"])


if __name__ == "__main__":
    unittest.main()
