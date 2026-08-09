"""Drift check plugin plane — harness loadability probe (AD-13).

Catalog lockstep (repo plugin.json vs marketplace.json) proves the repo and
marketplace agree; it says nothing about whether the harness can load the
plugin. The observed false-ok: installed_plugins.json empty, headless
'/tk-studio:<skill>' returning 'Unknown command', drift reporting plugin
plane ok. The probe reads the harness's own install record and drifts when
the plugin is absent, stale, or its cache path is gone.

Fix guidance follows SKILL.md's guided-fix table: FIX_HARNESS (fresh-install
flow) only when no loadable entry exists at all; FIX_PLUGIN (update flow)
when the plugin is installed but stale or its cache is gone (ST-046).
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

    def _write_marketplaces(self, marketplaces: dict):
        (self.home / "plugins" / "known_marketplaces.json").write_text(
            json.dumps(marketplaces), encoding="utf-8")

    def _directory_source_repo(self, version: str = VERSION) -> Path:
        # a studio-repo-shaped marketplace root carrying the plugin at
        # `version` under the catalog's relative source path
        root = self.home / "source-repo"
        (root / ".claude-plugin").mkdir(parents=True, exist_ok=True)
        (root / ".claude-plugin" / "marketplace.json").write_text(json.dumps({
            "name": NAME,
            "plugins": [{"name": NAME, "source": f"./plugins/{NAME}",
                         "version": version}]}), encoding="utf-8")
        manifest_dir = root / "plugins" / NAME / ".claude-plugin"
        manifest_dir.mkdir(parents=True, exist_ok=True)
        (manifest_dir / "plugin.json").write_text(json.dumps(
            {"name": NAME, "version": version}), encoding="utf-8")
        return root

    def test_no_install_record_is_drift(self):
        probe = drift_check._harness_loadability(NAME, VERSION, self.home)
        self.assertEqual(probe["status"], "drift")
        self.assertIn("not installed in the harness", probe["detail"])
        self.assertEqual(probe["fix"], drift_check.FIX_HARNESS)

    def test_record_without_the_plugin_is_drift(self):
        # the observed false-ok: record exists but holds no tk-studio entry
        self._write_record({"other@market": [self._install_entry("1.0.0")]})
        probe = drift_check._harness_loadability(NAME, VERSION, self.home)
        self.assertEqual(probe["status"], "drift")
        self.assertIn("Unknown command", probe["detail"])
        self.assertEqual(probe["fix"], drift_check.FIX_HARNESS)

    def test_installed_at_repo_version_is_ok(self):
        self._write_record({f"{NAME}@{NAME}": [self._install_entry(VERSION)]})
        probe = drift_check._harness_loadability(NAME, VERSION, self.home)
        self.assertEqual(probe["status"], "ok")
        self.assertIn("harness-loadable", probe["detail"])

    def test_stale_harness_version_is_drift_with_the_update_flow(self):
        # installed-but-stale names the update flow, not the fresh-install
        # flow — the case SKILL.md's fix table promises FIX_PLUGIN for
        self._write_record({f"{NAME}@{NAME}": [self._install_entry("0.0.1")]})
        probe = drift_check._harness_loadability(NAME, VERSION, self.home)
        self.assertEqual(probe["status"], "drift")
        self.assertIn("harness and repo out of step", probe["detail"])
        self.assertEqual(probe["fix"], drift_check.FIX_PLUGIN)
        self.assertIn("marketplace update", probe["fix"])

    def test_evicted_cache_path_is_drift(self):
        gone = self.home / "cache" / "gone"
        self._write_record({f"{NAME}@{NAME}": [
            self._install_entry(VERSION, install_path=gone)]})
        probe = drift_check._harness_loadability(NAME, VERSION, self.home)
        self.assertEqual(probe["status"], "drift")
        self.assertIn("installPath missing", probe["detail"])
        # installed at version, payload gone: still the update flow —
        # the harness knows the plugin, only the cache needs repopulating
        self.assertEqual(probe["fix"], drift_check.FIX_PLUGIN)

    def test_dangling_install_path_with_directory_source_is_ok(self):
        # the ST-045 record shape: version-matched project-scope entry, the
        # marketplace-update path's never-materialized cache installPath —
        # while a directory-source marketplace carries the plugin at that
        # same version, so every skill loads and this is not drift
        with tempfile.TemporaryDirectory() as project:
            entry = {"scope": "project", "projectPath": project,
                     "installPath": str(self.home / "cache" / NAME / VERSION),
                     "version": VERSION}
            self._write_record({f"{NAME}@{NAME}": [entry]})
            self._write_marketplaces({NAME: {
                "source": {"source": "directory",
                           "path": str(self._directory_source_repo())},
                "autoUpdate": True}})
            probe = drift_check._harness_loadability(
                NAME, VERSION, self.home, Path(project))
        self.assertEqual(probe["status"], "ok")
        self.assertIn("directory-source", probe["detail"])

    def test_dangling_install_path_with_no_source_dir_is_still_drift(self):
        # a genuinely evicted cache: the marketplace record names a
        # directory that no longer exists on disk
        self._write_record({f"{NAME}@{NAME}": [
            {"scope": "user", "version": VERSION,
             "installPath": str(self.home / "cache" / "gone")}]})
        self._write_marketplaces({NAME: {
            "source": {"source": "directory",
                       "path": str(self.home / "vanished-repo")}}})
        probe = drift_check._harness_loadability(NAME, VERSION, self.home)
        self.assertEqual(probe["status"], "drift")
        self.assertIn("cache evicted", probe["detail"])
        self.assertEqual(probe["fix"], drift_check.FIX_PLUGIN)

    def test_dangling_install_path_with_git_source_is_drift(self):
        # only a directory source can serve without the cache — a github
        # marketplace with an evicted cache is a real eviction
        self._write_record({f"{NAME}@{NAME}": [
            {"scope": "user", "version": VERSION,
             "installPath": str(self.home / "cache" / "gone")}]})
        self._write_marketplaces({NAME: {
            "source": {"source": "github", "repo": "someone/somewhere"}}})
        probe = drift_check._harness_loadability(NAME, VERSION, self.home)
        self.assertEqual(probe["status"], "drift")
        self.assertEqual(probe["fix"], drift_check.FIX_PLUGIN)

    def test_directory_source_at_another_version_is_drift(self):
        # the source dir moved on (or behind) — it does not carry the
        # checked version, so the dangling cache path is real drift
        self._write_record({f"{NAME}@{NAME}": [
            {"scope": "user", "version": VERSION,
             "installPath": str(self.home / "cache" / "gone")}]})
        self._write_marketplaces({NAME: {
            "source": {"source": "directory",
                       "path": str(self._directory_source_repo("0.0.1"))}}})
        probe = drift_check._harness_loadability(NAME, VERSION, self.home)
        self.assertEqual(probe["status"], "drift")
        self.assertIn("cache evicted", probe["detail"])

    def test_unreadable_record_is_error(self):
        (self.home / "plugins" / "installed_plugins.json").write_text(
            "{not json", encoding="utf-8")
        probe = drift_check._harness_loadability(NAME, VERSION, self.home)
        self.assertEqual(probe["status"], "error")

    def test_wrong_shape_record_is_error_not_a_crash(self):
        # the record is externally owned — a legacy/foreign shape (dict
        # entries instead of lists, a top-level list) must degrade to error
        for wrong in ({"version": 1, "plugins": {f"{NAME}@m": {"version": "1"}}},
                      ["not", "a", "dict"],
                      {"plugins": {f"{NAME}@m": ["not-a-dict-entry"]}}):
            (self.home / "plugins" / "installed_plugins.json").write_text(
                json.dumps(wrong), encoding="utf-8")
            probe = drift_check._harness_loadability(NAME, VERSION, self.home)
            self.assertEqual(probe["status"], "error", wrong)
            self.assertIn("shape", probe["detail"])

    def test_missing_install_path_is_drift_not_vacuous_ok(self):
        # Path("") is cwd — an entry without installPath must not pass as
        # loadable
        entry = {"scope": "user", "version": VERSION}
        self._write_record({f"{NAME}@{NAME}": [entry]})
        probe = drift_check._harness_loadability(NAME, VERSION, self.home)
        self.assertEqual(probe["status"], "drift")
        self.assertIn("installPath missing", probe["detail"])
        self.assertEqual(probe["fix"], drift_check.FIX_PLUGIN)

    def test_project_scoped_install_for_another_project_is_drift(self):
        entry = self._install_entry(VERSION)
        entry.update(scope="project", projectPath=str(self.home / "elsewhere"))
        self._write_record({f"{NAME}@{NAME}": [entry]})
        with tempfile.TemporaryDirectory() as project:
            probe = drift_check._harness_loadability(
                NAME, VERSION, self.home, Path(project))
        self.assertEqual(probe["status"], "drift")
        self.assertIn("loadable from this project", probe["detail"])
        self.assertEqual(probe["fix"], drift_check.FIX_HARNESS)

    def test_project_scoped_install_for_this_project_is_ok(self):
        with tempfile.TemporaryDirectory() as project:
            entry = self._install_entry(VERSION)
            entry.update(scope="project", projectPath=project)
            self._write_record({f"{NAME}@{NAME}": [entry]})
            probe = drift_check._harness_loadability(
                NAME, VERSION, self.home, Path(project))
        self.assertEqual(probe["status"], "ok")

    def test_claude_config_dir_env_resolves_the_default_home(self):
        import os
        self._write_record({f"{NAME}@{NAME}": [self._install_entry(VERSION)]})
        old = os.environ.get("CLAUDE_CONFIG_DIR")
        os.environ["CLAUDE_CONFIG_DIR"] = str(self.home)
        try:
            probe = drift_check._harness_loadability(NAME, VERSION, None)
        finally:
            if old is None:
                os.environ.pop("CLAUDE_CONFIG_DIR", None)
            else:
                os.environ["CLAUDE_CONFIG_DIR"] = old
        self.assertEqual(probe["status"], "ok")

    def test_broken_catalog_still_runs_the_probe(self):
        # a broken catalog is an error, but the harness probe still reports —
        # the two concerns are independent
        with tempfile.TemporaryDirectory() as project:
            bad = Path(project) / ".claude-plugin"
            bad.mkdir()
            (bad / "marketplace.json").write_text("{broken", encoding="utf-8")
            plane = drift_check.check_plugin(Path(project), None, self.home)
        self.assertEqual(plane["status"], "error")
        self.assertIn("marketplace catalog unreadable", plane["detail"])
        self.assertIn("not installed in the harness", plane["detail"])
        self.assertIn("claude plugin install", plane["fix"])

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
        # PLUGIN_ROOT.parents[1] is the studio repo root: the lockstep half
        # runs for real against the repo's marketplace.json, so this also
        # holds the repo to its plugin/catalog lockstep invariant
        plane = drift_check.check_plugin(
            PLUGIN_ROOT.parents[1], None, self.home)
        self.assertEqual(plane["status"], "ok")
        self.assertIn("harness-loadable", plane["detail"])


if __name__ == "__main__":
    unittest.main()
