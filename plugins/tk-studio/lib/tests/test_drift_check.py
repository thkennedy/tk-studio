"""Drift check plugin plane — the skills-dir folder and the roster (AD-13,
AD-21, Story 25.3).

The plugin is the installer-written folder <home>/skills/tk-studio/, loaded
in place as tk-studio@skills-dir. The plane reads the folder's own
plugin.json version, compares it with the configured channel's roster
plugin entry (and with the repo catalog only in a developer checkout), and
names one case: ok, stale (tk-studio update), missing (tk-studio install)
or shadowed (a marketplace copy is installed; the fix names each
uninstall). installed_plugins.json is read only to detect marketplace
copies — never as the source of the version or of loadability.

One test per row of the story's I/O matrix, plus the precedence rule.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PLUGIN_ROOT / "lib"))
sys.path.insert(0, str(PLUGIN_ROOT / "skills" / "tk-studio-activate" / "scripts"))

import drift_check  # noqa: E402

NAME = "tk-studio"


def _digest(seed: str) -> str:
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def _roster(channel: str, version: str | None) -> dict:
    """A roster fixture that passes roster_problems: known names, schema 1,
    channel = stem, a >=X.Y.Z floor, real-shaped non-periodic digests."""
    components: dict = {
        "uv": {"version": "0.13.1",
               "sha256": {"x86_64-pc-windows-msvc": _digest("uv-win")}},
        "bun": {"version": "1.4.3",
                "sha256": {"x86_64-pc-windows-msvc": _digest("bun-win")}},
    }
    if version is not None:
        tag = f"tk-studio--v{version}"
        components["plugin"] = {
            "tag": tag,
            "url": (f"https://github.com/o/r/releases/download/{tag}/"
                    f"tk-studio-{version}.zip"),
            "sha256": _digest(f"plugin-{version}")}
    return {"schema": 1, "channel": channel,
            "requires": {"claude-code": ">=2.1.224"},
            "components": components}


class SkillsDirPlaneTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self.home = base / "home"
        self.skills = self.home / "skills"
        self.skills.mkdir(parents=True)
        self.folder = self.skills / NAME
        self.project = base / "proj"
        self.project.mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    # --- fixtures

    def _folder(self, version: str = "1.0.0", at: Path | None = None) -> Path:
        root = at or self.folder
        (root / ".claude-plugin").mkdir(parents=True)
        (root / ".claude-plugin" / "plugin.json").write_text(
            json.dumps({"name": NAME, "version": version}), encoding="utf-8")
        return root

    def _write_roster(self, channel: str, version: str | None):
        rosters = self.project / "tools" / "installer" / "rosters"
        rosters.mkdir(parents=True, exist_ok=True)
        roster = _roster(channel, version)
        self.assertEqual(drift_check.roster_problems(roster), [])
        (rosters / f"{channel}.json").write_text(json.dumps(roster),
                                                 encoding="utf-8")

    def _write_catalog(self, version: str):
        meta = self.project / ".claude-plugin"
        meta.mkdir(exist_ok=True)
        (meta / "marketplace.json").write_text(json.dumps({
            "name": NAME, "plugins": [{"name": NAME, "source": "./plugins/x",
                                       "version": version}]}),
            encoding="utf-8")

    def _write_record(self, plugins: dict):
        (self.home / "plugins").mkdir(exist_ok=True)
        (self.home / "plugins" / "installed_plugins.json").write_text(
            json.dumps({"version": 2, "plugins": plugins}), encoding="utf-8")

    def _check(self, channel: str = "stable") -> dict:
        return drift_check._skills_dir_check(self.project, None, self.home,
                                             channel)

    # --- the matrix

    def test_ok_folder_at_the_roster_version(self):
        self._folder("1.0.0")
        self._write_roster("stable", "1.0.0")
        check = self._check()
        self.assertEqual((check["status"], check["case"]), ("ok", "ok"))
        self.assertIn(str(self.folder), check["detail"])
        self.assertIn("channel stable", check["detail"])
        self.assertNotIn("fix", check)

    def test_stale_against_the_roster(self):
        self._folder("0.9.0")
        self._write_roster("stable", "1.0.0")
        check = self._check()
        self.assertEqual((check["status"], check["case"]), ("drift", "stale"))
        self.assertIn("v0.9.0", check["detail"])
        self.assertIn("tk-studio--v1.0.0", check["detail"])
        self.assertIn("tk-studio update", check["fix"])
        # the default channel is the installer's default: no flag named
        self.assertNotIn("--channel", check["fix"])

    def test_stale_off_the_default_channel_names_it_in_the_fix(self):
        # tk-studio update defaults to stable: a latest-channel fix that
        # omitted the flag would reinstall stable and stay stale
        self._folder("1.0.0")
        self._write_roster("latest", "1.1.0")
        check = self._check("latest")
        self.assertEqual((check["status"], check["case"]), ("drift", "stale"))
        self.assertIn("tk-studio update --channel latest", check["fix"])

    def test_stale_against_the_developer_catalog(self):
        self._folder("0.9.0")
        self._write_catalog("1.0.0")
        check = self._check()
        self.assertEqual((check["status"], check["case"]), ("drift", "stale"))
        self.assertIn("developer catalog v1.0.0", check["detail"])
        self.assertIn("tk-studio update", check["fix"])

    def test_catalog_is_not_read_outside_a_developer_checkout(self):
        # no .claude-plugin/marketplace.json in the project: nothing to
        # compare, so a folder version alone is never stale
        self._folder("0.9.0")
        check = self._check()
        self.assertEqual(check["case"], "ok")
        self.assertNotIn("catalog", check["detail"])

    def test_missing_folder(self):
        check = self._check()
        self.assertEqual((check["status"], check["case"]),
                         ("missing", "missing"))
        self.assertIn("no skills-dir plugin folder", check["detail"])
        self.assertIn("tk-studio install", check["fix"])

    def test_folder_without_plugin_json_is_missing(self):
        self.folder.mkdir()
        check = self._check()
        self.assertEqual((check["status"], check["case"]),
                         ("missing", "missing"))
        self.assertIn("has no .claude-plugin/plugin.json", check["detail"])
        self.assertIn("tk-studio install", check["fix"])

    def test_missing_names_the_installer_sibling_found(self):
        self._folder("1.0.0", at=self.skills / ".tk-studio.previous")
        check = self._check()
        self.assertEqual(check["case"], "missing")
        self.assertIn(".tk-studio.previous", check["detail"])

    def test_dangling_link_is_missing(self):
        target = self.home / "checkout"
        self._folder("1.0.0", at=target)
        try:
            os.symlink(target, self.folder, target_is_directory=True)
        except (OSError, NotImplementedError) as exc:
            self.skipTest(f"cannot create a symlink here: {exc}")
        self.assertEqual(self._check()["case"], "ok")   # a live link counts
        (target / ".claude-plugin" / "plugin.json").unlink()
        (target / ".claude-plugin").rmdir()
        target.rmdir()
        check = self._check()
        self.assertEqual((check["status"], check["case"]),
                         ("missing", "missing"))
        self.assertIn("dangling link", check["detail"])

    def test_regular_file_at_the_folder_path_is_missing(self):
        self.folder.write_text("not a folder", encoding="utf-8")
        check = self._check()
        self.assertEqual((check["status"], check["case"]),
                         ("missing", "missing"))
        self.assertIn("is not a directory", check["detail"])
        self.assertNotIn("dangling link", check["detail"])
        self.assertIn("tk-studio install", check["fix"])

    def test_shadowed_by_a_user_scope_marketplace_record(self):
        self._folder("1.0.0")
        self._write_roster("stable", "1.0.0")
        self._write_record({f"{NAME}@{NAME}": [
            {"scope": "user", "version": "0.2.0", "installPath": "/x"}]})
        check = self._check()
        self.assertEqual((check["status"], check["case"]),
                         ("drift", "shadowed"))
        self.assertIn(f"claude plugin uninstall {NAME}@{NAME} --scope user",
                      check["fix"])
        self.assertNotIn("marketplace remove", check["fix"])

    def test_shadowed_by_an_enabled_plugins_key_names_the_marketplace_removal(self):
        self._folder("1.0.0")
        (self.home / "settings.json").write_text(json.dumps({
            "enabledPlugins": {f"{NAME}@{NAME}": True,
                               f"{NAME}@skills-dir": True},
            "extraKnownMarketplaces": {NAME: {}}}), encoding="utf-8")
        check = self._check()
        self.assertEqual(check["case"], "shadowed")
        self.assertIn(f"claude plugin uninstall {NAME}@{NAME} --scope user",
                      check["fix"])
        self.assertIn(f"claude plugin marketplace remove {NAME}", check["fix"])
        self.assertNotIn("@skills-dir --scope", check["fix"])

    def test_project_scope_record_does_not_shadow(self):
        # the installer's cleanup only uninstalls user scope — mirrored
        self._folder("1.0.0")
        self._write_record({f"{NAME}@{NAME}": [
            {"scope": "project", "projectPath": "/elsewhere",
             "version": "1.0.0"}]})
        self.assertEqual(self._check()["case"], "ok")

    def test_the_install_record_is_never_the_truth(self):
        # the record names the folder itself at another version: ignored
        self._folder("1.0.0")
        self._write_roster("stable", "1.0.0")
        self._write_record({f"{NAME}@skills-dir": [
            {"scope": "user", "version": "0.0.1", "installPath": "/gone"}]})
        check = self._check()
        self.assertEqual((check["status"], check["case"]), ("ok", "ok"))
        self.assertNotIn("0.0.1", check["detail"])

    def test_channel_selects_its_roster(self):
        self._folder("1.0.0")
        self._write_roster("stable", "1.0.0")
        self._write_roster("latest", "1.1.0")
        self.assertEqual(self._check("stable")["case"], "ok")
        check = self._check("latest")
        self.assertEqual(check["case"], "stale")
        self.assertIn("latest roster tk-studio--v1.1.0", check["detail"])
        self.assertIn("channel latest", check["detail"])

    def test_no_roster_is_not_checkable_and_ok(self):
        self._folder("1.0.0")
        check = self._check()
        self.assertEqual((check["status"], check["case"]), ("ok", "ok"))
        self.assertIn("not checkable from this project", check["detail"])

    def test_no_roster_still_judges_missing_and_shadowed(self):
        self._write_record({f"{NAME}@{NAME}": [{"scope": "user"}]})
        self.assertEqual(self._check()["case"], "missing")
        self._folder("1.0.0")
        self.assertEqual(self._check()["case"], "shadowed")

    def test_roster_without_a_plugin_entry_is_not_stale(self):
        self._folder("1.0.0")
        self._write_roster("stable", None)
        check = self._check()
        self.assertEqual(check["case"], "ok")
        self.assertIn("not shipped in this channel", check["detail"])

    def test_unreadable_folder_plugin_json_is_error_naming_the_file(self):
        manifest = self._folder("1.0.0") / ".claude-plugin" / "plugin.json"
        manifest.write_text("{not json", encoding="utf-8")
        check = self._check()
        self.assertEqual(check["status"], "error")
        self.assertIn(str(manifest), check["detail"])
        self.assertNotIn("case", check)

    def test_unreadable_record_file_is_error_naming_the_file(self):
        self._folder("1.0.0")
        (self.home / "plugins").mkdir()
        record = self.home / "plugins" / "installed_plugins.json"
        record.write_text("{not json", encoding="utf-8")
        check = self._check()
        self.assertEqual(check["status"], "error")
        self.assertIn(str(record), check["detail"])

    def test_unreadable_catalog_is_error_naming_it_folder_present_or_not(self):
        meta = self.project / ".claude-plugin"
        meta.mkdir()
        catalog = meta / "marketplace.json"
        catalog.write_text("{not json", encoding="utf-8")
        # the folder absent: the catalog is still read, and the missing
        # folder is still named in the detail
        check = self._check()
        self.assertEqual(check["status"], "error")
        self.assertNotIn("case", check)
        self.assertIn(str(catalog), check["detail"])
        self.assertIn("no skills-dir plugin folder", check["detail"])
        # the folder present
        self._folder("1.0.0")
        check = self._check()
        self.assertEqual(check["status"], "error")
        self.assertNotIn("case", check)
        self.assertIn(str(catalog), check["detail"])

    def test_catalog_entry_without_a_string_version_is_error(self):
        self._folder("1.0.0")
        meta = self.project / ".claude-plugin"
        meta.mkdir()
        catalog = meta / "marketplace.json"
        for entry in ({"name": NAME, "source": "./plugins/x"},
                      {"name": NAME, "source": "./plugins/x", "version": 1}):
            with self.subTest(entry=entry):
                catalog.write_text(json.dumps({"name": NAME,
                                               "plugins": [entry]}),
                                   encoding="utf-8")
                check = self._check()
                self.assertEqual(check["status"], "error")
                self.assertNotIn("case", check)
                self.assertIn(str(catalog), check["detail"])
                self.assertIn("no string version", check["detail"])
                self.assertNotIn("vNone", check["detail"])

    def test_precedence_missing_over_shadowed_over_stale(self):
        self._write_roster("stable", "1.0.0")
        self._write_record({f"{NAME}@{NAME}": [{"scope": "user"}]})
        check = self._check()
        self.assertEqual((check["status"], check["case"]),
                         ("missing", "missing"))
        # every condition is named, and every fix
        self.assertIn("marketplace copy", check["detail"])
        self.assertIn("tk-studio install", check["fix"])
        self.assertIn("claude plugin uninstall", check["fix"])
        self._folder("0.9.0")
        check = self._check()
        self.assertEqual(check["case"], "shadowed")
        self.assertIn("v0.9.0", check["detail"])
        self.assertIn("tk-studio update", check["fix"])

    def test_claude_config_dir_env_resolves_the_default_home(self):
        self._folder("1.0.0")
        with mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": str(self.home)}):
            check = drift_check._skills_dir_check(self.project, None, None)
        self.assertEqual(check["case"], "ok")

    # --- the plane

    def test_plane_carries_the_case_and_maps_its_status(self):
        for setup, case, status in (
                (lambda: None, "missing", "missing"),
                (lambda: self._folder("1.0.0"), "ok", "ok")):
            setup()
            plane = drift_check.check_plugin(self.project, None, self.home)
            self.assertEqual(plane["plane"], "plugin")
            self.assertEqual((plane["case"], plane["status"]), (case, status),
                             plane["detail"])
        self.assertIn("released roster", plane["detail"])

    def test_plane_with_a_guard_error_carries_no_case(self):
        # case is the folder-and-roster verdict alone; a release guard can
        # raise status past it, and an error plane carries no case (§6)
        self._folder("1.0.0")
        rosters = self.project / "tools" / "installer" / "rosters"
        rosters.mkdir(parents=True)
        (rosters / "latest.json").write_text("{not json", encoding="utf-8")
        plane = drift_check.check_plugin(self.project, None, self.home)
        self.assertEqual(plane["status"], "error", plane["detail"])
        self.assertNotIn("case", plane)
        self.assertIn("latest.json", plane["detail"])
        (rosters / "latest.json").unlink()
        # an unreadable released-roster.json in the plugin root
        root = Path(self._tmp.name) / "plugin"
        (root / ".claude-plugin").mkdir(parents=True)
        (root / ".claude-plugin" / "plugin.json").write_text(
            json.dumps({"name": NAME, "version": "1.0.0"}), encoding="utf-8")
        (root / ".claude-plugin" / "released-roster.json").write_text(
            "{not json", encoding="utf-8")
        with mock.patch.object(drift_check, "PLUGIN_ROOT", root):
            plane = drift_check.check_plugin(self.project, None, self.home)
        self.assertEqual(plane["status"], "error", plane["detail"])
        self.assertNotIn("case", plane)
        self.assertIn("released-roster.json unreadable", plane["detail"])

    def test_plane_stays_ok_on_the_real_repo_with_the_folder_linked(self):
        # PLUGIN_ROOT.parents[1] is the studio repo root: a developer
        # checkout, so the real catalog and the real latest roster are both
        # compared with the folder's plugin.json. Driven on latest, the
        # gate-x4-bound channel: stable.json trails the plugin version by PR
        # after each cut (25-1 ruling), so a stable run would turn main red.
        version = json.loads((PLUGIN_ROOT / ".claude-plugin" / "plugin.json")
                             .read_text(encoding="utf-8"))["version"]
        self._folder(version)
        plane = drift_check.check_plugin(PLUGIN_ROOT.parents[1], None,
                                         self.home, channel="latest")
        self.assertEqual((plane["status"], plane["case"]), ("ok", "ok"),
                         plane["detail"])
        self.assertIn("developer catalog", plane["detail"])
        self.assertIn("latest roster", plane["detail"])

    def test_main_takes_the_channel(self):
        self._folder("1.0.0")
        self._write_roster("latest", "1.1.0")
        quiet = {"plane": "x", "status": "ok", "detail": ""}
        out = io.StringIO()
        with mock.patch.object(drift_check, "check_bmad_base",
                               return_value=dict(quiet, plane="bmad-base")), \
                mock.patch.object(drift_check, "check_store",
                                  return_value=dict(quiet, plane="store")), \
                mock.patch.object(drift_check, "check_vault",
                                  return_value=dict(quiet, plane="vault")), \
                mock.patch.object(drift_check, "_emit"), \
                redirect_stdout(out):
            code = drift_check.main(["--directory", str(self.project),
                                     "--claude-home", str(self.home),
                                     "--channel", "latest"])
        report = json.loads(out.getvalue())
        plugin = next(p for p in report["planes"] if p["plane"] == "plugin")
        self.assertEqual(plugin["case"], "stale")
        self.assertEqual(code, 1)
        self.assertTrue(any("tk-studio update --channel latest" in f
                            for f in report["fixes"]))


if __name__ == "__main__":
    unittest.main()
