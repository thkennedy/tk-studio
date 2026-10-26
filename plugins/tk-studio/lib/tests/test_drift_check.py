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
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
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

    def _write_foreign_catalog(self) -> Path:
        # a project shipping its own marketplace that lists no tk-studio
        meta = self.project / ".claude-plugin"
        meta.mkdir(exist_ok=True)
        catalog = meta / "marketplace.json"
        catalog.write_text(json.dumps({"plugins": [
            {"name": "other", "version": "1.0.0"}]}), encoding="utf-8")
        return catalog

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

    def test_shadowed_with_known_marketplaces_names_the_marketplace_removal(self):
        self._folder("1.0.0")
        self._write_record({f"{NAME}@{NAME}": [
            {"scope": "user", "version": "0.2.0", "installPath": "/x"}]})
        (self.home / "plugins" / "known_marketplaces.json").write_text(
            json.dumps({NAME: {"source": {"source": "github",
                                          "repo": "o/r"}}}),
            encoding="utf-8")
        check = self._check()
        self.assertEqual((check["status"], check["case"]),
                         ("drift", "shadowed"))
        self.assertIn(f"claude plugin uninstall {NAME}@{NAME} --scope user",
                      check["fix"])
        self.assertIn(f"claude plugin marketplace remove {NAME}", check["fix"])

    def test_unreadable_known_marketplaces_is_error_naming_the_file(self):
        self._folder("1.0.0")
        (self.home / "plugins").mkdir()
        known = self.home / "plugins" / "known_marketplaces.json"
        known.write_text("{not json", encoding="utf-8")
        check = self._check()
        self.assertEqual(check["status"], "error")
        self.assertNotIn("case", check)
        self.assertIn(str(known), check["detail"])

    def test_unreadable_settings_is_error_naming_the_file(self):
        self._folder("1.0.0")
        settings = self.home / "settings.json"
        settings.write_text("{not json", encoding="utf-8")
        check = self._check()
        self.assertEqual(check["status"], "error")
        self.assertNotIn("case", check)
        self.assertIn(str(settings), check["detail"])

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

    def test_foreign_catalog_is_not_a_developer_checkout(self):
        catalog = self._write_foreign_catalog()
        self._folder("1.0.0")
        self._write_roster("stable", "1.0.0")
        check = self._check()
        self.assertEqual((check["status"], check["case"]), ("ok", "ok"),
                         check["detail"])
        self.assertIn(f"marketplace catalog {catalog} has no {NAME} entry",
                      check["detail"])
        self.assertIn("catalog comparison skipped", check["detail"])
        self.assertNotIn("fix", check)

    def test_foreign_catalog_without_the_folder_is_missing_not_error(self):
        self._write_foreign_catalog()
        check = self._check()
        self.assertEqual((check["status"], check["case"]),
                         ("missing", "missing"), check["detail"])
        self.assertIn("catalog comparison skipped", check["detail"])
        self.assertIn("tk-studio install", check["fix"])

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
                mock.patch.object(drift_check, "check_tracking",
                                  return_value=dict(quiet, plane="tracking")), \
                mock.patch.object(drift_check, "check_sandbox_login",
                                  return_value=dict(quiet,
                                                    plane="sandbox-login")), \
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

    def test_main_with_a_foreign_catalog_is_not_an_error(self):
        catalog = self._write_foreign_catalog()
        self._folder("1.0.0")
        self._write_roster("stable", "1.0.0")
        quiet = {"plane": "x", "status": "ok", "detail": ""}
        out = io.StringIO()
        with mock.patch.object(drift_check, "check_bmad_base",
                               return_value=dict(quiet, plane="bmad-base")), \
                mock.patch.object(drift_check, "check_store",
                                  return_value=dict(quiet, plane="store")), \
                mock.patch.object(drift_check, "check_vault",
                                  return_value=dict(quiet, plane="vault")), \
                mock.patch.object(drift_check, "check_tracking",
                                  return_value=dict(quiet, plane="tracking")), \
                mock.patch.object(drift_check, "check_sandbox_login",
                                  return_value=dict(quiet,
                                                    plane="sandbox-login")), \
                mock.patch.object(drift_check, "_emit"), \
                redirect_stdout(out):
            code = drift_check.main(["--directory", str(self.project),
                                     "--claude-home", str(self.home),
                                     "--channel", "stable",
                                     "--marketplace", str(catalog)])
        report = json.loads(out.getvalue())
        plugin = next(p for p in report["planes"] if p["plane"] == "plugin")
        self.assertNotEqual(plugin["status"], "error", plugin["detail"])
        self.assertIn("catalog comparison skipped", plugin["detail"])
        self.assertNotEqual(code, 2)


class TrackingPlaneTests(unittest.TestCase):
    """Story 31.4, Settled shape 4: the tracking plane reads
    .tk-studio/config.yaml and _bmad-output/tracking/sync-state.json only —
    never the network — and names one case."""

    NOW = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / "proj"
        (self.root / ".tk-studio").mkdir(parents=True)
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        os.environ["TK_STUDIO_HOME"] = str(Path(self._tmp.name) / "store")

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()

    def _bind(self):
        (self.root / ".tk-studio" / "config.yaml").write_text(
            "planning:\n  jira:\n    project_key: TKS\n", encoding="utf-8",
            newline="\n")

    def _last_run(self, minutes_ago=5, status="complete", case="ok",
                  reason=None):
        at = self.NOW - timedelta(minutes=minutes_ago)
        path = self.root / drift_check.TRACKING_STATE_REL
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"cursor": None, "pages": {}, "last_run": {
            "at": at.isoformat(timespec="seconds"), "status": status,
            "case": case, "counts": {}, "newest_comment": None,
            "reason": reason}}), encoding="utf-8")

    def _plane(self):
        with mock.patch("urllib.request.urlopen",
                        side_effect=AssertionError("network")), \
                mock.patch("socket.create_connection",
                           side_effect=AssertionError("network")):
            return drift_check.check_tracking(self.root, now=self.NOW)

    def test_not_bound_is_ok(self):
        plane = self._plane()
        self.assertEqual((plane["plane"], plane["status"], plane["case"]),
                         ("tracking", "ok", "not-bound"))

    def test_never_run_is_missing_with_the_fix(self):
        self._bind()
        plane = self._plane()
        self.assertEqual((plane["status"], plane["case"]),
                         ("missing", "never-run"))
        self.assertIn("plansync.py sync-back --directory", plane["fix"])
        self.assertIn("atlassian-sync-back", plane["fix"])

    def test_recent_complete_or_partial_is_ok(self):
        self._bind()
        for status in ("complete", "partial"):
            self._last_run(status=status)
            plane = self._plane()
            self.assertEqual((plane["status"], plane["case"]), ("ok", "ok"))
            self.assertEqual(plane["last_run"]["status"], status)
            self.assertIn("min ago", plane["detail"])

    def test_older_than_thirty_minutes_is_stale(self):
        self._bind()
        self._last_run(minutes_ago=31)
        plane = self._plane()
        self.assertEqual((plane["status"], plane["case"]), ("drift", "stale"))

    def test_named_states_are_their_own_cases(self):
        self._bind()
        expectations = {
            "token-missing": ("sync-back partial: owner-page mirror skipped: "
                              "TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN is not set",
                              "TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN"),
            "unreachable": ("GET /myself returned 503", "network path"),
            "deactivated": ("GET /myself returned 410", "owner signs in"),
            "auth": ("Jira returned 401 for GET /myself: check the token",
                     "returned 401"),
        }
        for case, (reason, fix) in expectations.items():
            self._last_run(status="blocked", case=case, reason=reason)
            plane = self._plane()
            self.assertEqual((plane["status"], plane["case"]), ("drift", case))
            self.assertIn(fix, plane["fix"])
            self.assertNotIn("no changes", plane["detail"])

    def test_error_and_rate_limited_are_read_by_age_and_status(self):
        # run cases, never a ninth plane case: ok when a recent tick ended
        # partial, stale when it is old or ended blocked
        self._bind()
        for case in ("error", "rate-limited"):
            self._last_run(status="partial", case=case, reason="r")
            plane = self._plane()
            self.assertEqual((plane["status"], plane["case"]), ("ok", "ok"))
            self._last_run(minutes_ago=31, status="partial", case=case)
            plane = self._plane()
            self.assertEqual((plane["status"], plane["case"]),
                             ("drift", "stale"))
            self._last_run(status="blocked", case=case)
            plane = self._plane()
            self.assertEqual((plane["status"], plane["case"]),
                             ("drift", "stale"))

    def test_unreachable_is_a_plane_case_only_on_a_failed_preflight(self):
        # contract §6: `unreachable` is a connection error or 5xx on
        # preflight; a later 5xx ends the tick partial, read by age and status
        self._bind()
        self._last_run(status="partial", case="unreachable",
                       reason="Jira returned 503 for GET /search page 2")
        plane = self._plane()
        self.assertEqual((plane["status"], plane["case"]), ("ok", "ok"))
        self._last_run(minutes_ago=31, status="partial", case="unreachable")
        plane = self._plane()
        self.assertEqual((plane["status"], plane["case"]), ("drift", "stale"))
        self._last_run(status="blocked", case="unreachable",
                       reason="GET /myself returned 503")
        plane = self._plane()
        self.assertEqual((plane["status"], plane["case"]),
                         ("drift", "unreachable"))
        self.assertIn("network path", plane["fix"])

    def test_a_recent_blocked_tick_names_its_outcome_not_a_missing_tick(self):
        self._bind()
        for case in ("error", "rate-limited"):
            reason = f"Jira returned 400 for GET /myself ({case})"
            self._last_run(status="blocked", case=case, reason=reason)
            plane = self._plane()
            self.assertEqual((plane["status"], plane["case"]),
                             ("drift", "stale"))
            self.assertNotIn("has not ticked", plane["fix"])
            self.assertIn(reason, plane["fix"])
            self.assertIn(reason, plane["detail"])
            self.assertIn("blocked", plane["fix"])
            self.assertIn("rerun", plane["fix"])
        # genuinely old: the job has not ticked
        self._last_run(minutes_ago=31, status="blocked", case="error",
                       reason="r")
        self.assertIn("has not ticked", self._plane()["fix"])

    def test_this_repo_is_not_bound_or_never_run(self):
        plane = drift_check.check_tracking(PLUGIN_ROOT.parents[1])
        self.assertIn(plane["case"], ("not-bound", "never-run"))

    def test_main_reports_six_planes(self):
        # Story 33.2 (ruling C): the sandbox-login plane is appended after
        # the five published planes
        quiet = {"plane": "x", "status": "ok", "detail": ""}
        out = io.StringIO()
        with mock.patch.object(drift_check, "check_bmad_base",
                               return_value=dict(quiet, plane="bmad-base")), \
                mock.patch.object(drift_check, "check_plugin",
                                  return_value=dict(quiet, plane="plugin")), \
                mock.patch.object(drift_check, "check_store",
                                  return_value=dict(quiet, plane="store")), \
                mock.patch.object(drift_check, "check_vault",
                                  return_value=dict(quiet, plane="vault")), \
                mock.patch.object(drift_check, "check_sandbox_login",
                                  return_value=dict(quiet,
                                                    plane="sandbox-login")), \
                mock.patch.object(drift_check, "_emit"), \
                redirect_stdout(out):
            code = drift_check.main(["--directory", str(self.root)])
        report = json.loads(out.getvalue())
        self.assertEqual([p["plane"] for p in report["planes"]],
                         ["bmad-base", "plugin", "store", "vault", "tracking",
                          "sandbox-login"])
        self.assertEqual(code, 0)


class SandboxLoginPlaneTests(unittest.TestCase):
    """Story 33.2 (AC2, operator ruling C): the sixth plane reads the engine
    sandbox's Max login through ``sbx exec`` (never a token) and reuses the
    plane statuses: ok | drift (expiring, 7 days or fewer) | error (expired
    or logged out) | missing (no-sandbox)."""

    NOW = 2_000_000_000.0
    DAY = 86400
    SB = "claude-tk-studio"

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.config = Path(self._tmp.name) / "supervisor.yaml"
        self.config.write_text(
            'jobs:\n  "tk-studio/run-epic":\n    tier: sbx\n'
            f'    sandbox: {self.SB}\n'
            '  "The Universe Awaits/run-epic":\n    tier: sbx\n'
            f"    sandbox: '{self.SB}'  # the same sandbox\n",
            encoding="utf-8")
        self.env = {"TK_SUPERVISOR_CONFIG": str(self.config)}
        self.calls: list[list[str]] = []
        self.daemon_rc = 0
        self.state = "running"
        self.logged_in = True
        self.expiry = str(int((self.NOW + 30 * self.DAY) * 1000))

    def tearDown(self):
        self._tmp.cleanup()

    def run_sbx(self, args):
        self.calls.append(list(args))
        if args[1:] == ["daemon", "status"]:
            return subprocess.CompletedProcess(args, self.daemon_rc,
                                               "running", "")
        if args[1:] == ["ls"]:
            return subprocess.CompletedProcess(
                args, 0, f"SANDBOX  AGENT  STATUS\n{self.SB}  claude  "
                f"{self.state}\n", "")
        if args[1] == "exec" and "auth" in args:
            return subprocess.CompletedProcess(
                args, 0, json.dumps({"loggedIn": self.logged_in}), "")
        if args[1] == "exec" and args[3] == "python3":
            return subprocess.CompletedProcess(args, 0, self.expiry + "\n",
                                               "")
        raise AssertionError(f"unexpected sbx call {args}")

    def plane(self, env=None):
        return drift_check.check_sandbox_login(
            self.env if env is None else env, self.run_sbx, self.NOW)

    def at(self, days: float) -> str:
        return str(int((self.NOW + days * self.DAY) * 1000))

    def test_no_sandbox_configured_is_missing_never_an_error(self):
        plane = self.plane(env={})
        self.assertEqual((plane["plane"], plane["status"], plane["case"]),
                         ("sandbox-login", "missing", "no-sandbox"))
        self.assertIn("TK_SUPERVISOR_CONFIG is not set", plane["detail"])
        self.assertEqual(self.calls, [])
        self.config.write_text("jobs:\n  p/j:\n    tier: host\n",
                               encoding="utf-8")
        plane = self.plane()
        self.assertEqual((plane["status"], plane["case"]),
                         ("missing", "no-sandbox"))
        self.assertEqual(self.calls, [])

    def test_the_daemon_first_and_no_exec_on_a_stopped_sandbox(self):
        self.daemon_rc = 1
        plane = self.plane()
        self.assertEqual((plane["status"], plane["case"]),
                         ("missing", "no-sandbox"))
        self.assertIn("daemon is not running", plane["detail"])
        self.assertEqual(self.calls, [["sbx", "daemon", "status"]])
        self.daemon_rc, self.state, self.calls = 0, "stopped", []
        plane = self.plane()
        self.assertEqual((plane["status"], plane["case"]),
                         ("missing", "no-sandbox"))
        self.assertIn("not running", plane["detail"])
        self.assertEqual(self.calls, [["sbx", "daemon", "status"],
                                      ["sbx", "ls"]])

    def test_the_name_matches_the_sandbox_column_only(self):
        # a sandbox named like another row's AGENT value is not that row
        self.config.write_text("jobs:\n  p/j:\n    tier: sbx\n"
                               "    sandbox: claude\n", encoding="utf-8")
        for own_row in ("", "claude  claude  stopped\n"):
            self.calls = []

            def run(args, own_row=own_row):
                if args[1:] == ["ls"]:
                    self.calls.append(list(args))
                    return subprocess.CompletedProcess(
                        args, 0, "SANDBOX  AGENT  STATUS\nother  claude  "
                        f"running\n{own_row}", "")
                return self.run_sbx(args)
            with self.subTest(own_row=own_row):
                plane = drift_check.check_sandbox_login(self.env, run,
                                                        self.NOW)
                self.assertEqual((plane["status"], plane["case"]),
                                 ("missing", "no-sandbox"))
                self.assertIn("not running", plane["detail"])
                self.assertEqual(self.calls, [["sbx", "daemon", "status"],
                                              ["sbx", "ls"]])

    def test_sbx_absent_is_missing(self):
        def absent(args):
            raise FileNotFoundError(args[0])
        plane = drift_check.check_sandbox_login(self.env, absent, self.NOW)
        self.assertEqual((plane["status"], plane["case"]),
                         ("missing", "no-sandbox"))
        self.assertIn("sbx not on PATH", plane["detail"])

    def test_the_warning_window_and_the_failed_check(self):
        for days, status, case in ((30, "ok", "ok"),
                                   (7.05, "ok", "ok"),
                                   (7, "drift", "expiring"),
                                   (0.5, "drift", "expiring"),
                                   (0, "error", "expired"),
                                   (-2, "error", "expired")):
            with self.subTest(days=days):
                self.expiry, self.calls = self.at(days), []
                plane = self.plane()
                self.assertEqual((plane["status"], plane["case"]),
                                 (status, case), plane)
                if status == "ok":
                    self.assertNotIn("fix", plane)
                else:
                    self.assertIn(f"sbx run --name {self.SB} → /login → "
                                  "/exit", plane["fix"])
                # one sandbox, read once although two jobs name it
                self.assertEqual(
                    [c[:3] for c in self.calls],
                    [["sbx", "daemon", "status"], ["sbx", "ls"],
                     ["sbx", "exec", self.SB], ["sbx", "exec", self.SB]])
        self.expiry = self.at(3)
        expires = datetime.fromtimestamp(self.NOW + 3 * self.DAY,
                                         timezone.utc)
        self.assertIn(expires.strftime("%Y-%m-%dT%H:%M:%SZ"),
                      self.plane()["detail"])

    def test_logged_out_is_the_failed_check(self):
        self.logged_in = False
        plane = self.plane()
        self.assertEqual((plane["status"], plane["case"]),
                         ("error", "expired"))
        self.assertIn("logged out", plane["detail"])

    def test_only_the_expiry_field_leaves_the_sandbox(self):
        self.plane()
        script = next(c for c in self.calls if "python3" in c)[-1]
        self.assertIn("refreshTokenExpiresAt", script)
        self.assertIn("print('' if v is None else v)", script)
        self.assertNotIn("accessToken", script)
        for call in self.calls:   # argv only: no shell in any call
            self.assertNotIn("sh", call)
            self.assertNotIn("bash", call)

    def test_config_sandboxes_reads_flow_style_job_entries(self):
        """The supervisor parses its config with js-yaml: a flow-style job
        entry under ``jobs:`` is valid YAML and names its sandbox too."""
        import sandbox_login
        text = ('jobs:\n  "p/j": {tier: sbx, sandbox: s1}\n'
                '  "p/k": { "sandbox": \'s2\' , tier: sbx }  # c\n'
                '  "p/l": {tier: sbx,\n    sandbox: s3}\n'
                '  "p/m":\n    sandbox: s4\n'
                'other: {sandbox: not-a-job}\n')
        self.assertEqual(sandbox_login.config_sandboxes(text),
                         ["s1", "s2", "s3", "s4"])
        self.assertEqual(sandbox_login.config_sandboxes(
            'jobs: {"p/j": {tier: sbx, sandbox: a}, "p/k": {sandbox: b}}\n'),
            ["a", "b"])
        self.config.write_text('jobs:\n  "tk-studio/run-epic": '
                               f'{{tier: sbx, sandbox: {self.SB}}}\n',
                               encoding="utf-8")
        plane = self.plane()
        self.assertEqual((plane["status"], plane["case"]), ("ok", "ok"))
        self.assertIn(self.SB, plane["detail"])

    def test_the_plane_has_one_total_budget_below_the_runner_bound(self):
        """Every sbx call shares one budget, well below the conformance
        runner's 60 s DEFAULT_TIMEOUT; a spent budget reads missing
        (no-sandbox) like a daemon that is down, naming the timeout."""
        self.assertLess(drift_check.SANDBOX_LOGIN_BUDGET, 60)
        self.assertLessEqual(drift_check.SANDBOX_LOGIN_BUDGET, 30)
        clock = [0.0]

        def slow(args):   # each sbx call takes 12 s of the budget
            clock[0] += 12
            return self.run_sbx(args)

        plane = drift_check.check_sandbox_login(self.env, slow, self.NOW,
                                                clock=lambda: clock[0])
        self.assertEqual((plane["status"], plane["case"]),
                         ("missing", "no-sandbox"))
        self.assertIn("budget", plane["detail"])
        self.assertIn("timed out at `sbx exec", plane["detail"])
        # 20 s: daemon status and ls ran, the budget was spent before exec
        self.assertEqual([c[1] for c in self.calls], ["daemon", "ls"])
        # a call that times out under the budget spends it too
        self.calls.clear()

        def hangs(args):
            self.calls.append(list(args))
            raise subprocess.TimeoutExpired(args, 20)

        plane = drift_check.check_sandbox_login(self.env, hangs, self.NOW)
        self.assertEqual((plane["status"], plane["case"]),
                         ("missing", "no-sandbox"))
        self.assertIn("timed out at `sbx daemon status`", plane["detail"])
        self.assertEqual(len(self.calls), 1)

    def test_a_later_timeout_never_downgrades_an_expired_reading(self):
        """Two sandboxes, the first expired, the second timing out: the
        reading already taken stays, the timed-out sandbox reads
        no-sandbox with the timeout detail, and the worst over both is
        still expired (the plane's error), never missing."""
        import sandbox_login
        second = "claude-other"
        self.config.write_text(
            'jobs:\n  "p/a":\n    tier: sbx\n'
            f'    sandbox: {self.SB}\n'
            '  "p/b":\n    tier: sbx\n'
            f'    sandbox: {second}\n', encoding="utf-8")
        self.expiry = self.at(-1)

        def run(args):
            if args[1] == "ls":
                self.calls.append(list(args))
                return subprocess.CompletedProcess(
                    args, 0, f"SANDBOX  AGENT  STATUS\n{self.SB}  claude  "
                    f"running\n{second}  claude  running\n", "")
            if args[1] == "exec" and args[2] == second:
                self.calls.append(list(args))
                raise subprocess.TimeoutExpired(args, 20)
            return self.run_sbx(args)

        plane = drift_check.check_sandbox_login(self.env, run, self.NOW)
        self.assertEqual((plane["status"], plane["case"]),
                         ("error", "expired"), plane)
        self.assertIn(f"{self.SB}: the Max login expired at",
                      plane["detail"])
        self.assertIn(f"{second}: the sandbox login read ran out",
                      plane["detail"])
        self.assertIn(f"timed out at `sbx exec {second}`", plane["detail"])
        self.assertIn(f"sbx run --name {self.SB} → /login → /exit",
                      plane["fix"])
        # the reading itself: both sandboxes kept, each with its own case
        self.calls.clear()
        reading = sandbox_login.read_logins(
            [self.SB, second, "claude-third"],
            lambda args, _left: run(args), self.NOW,
            deadline=sandbox_login.Deadline(20))
        self.assertEqual(reading["case"], "expired")
        self.assertEqual(
            [(r["sandbox"], r["case"]) for r in reading["sandboxes"]],
            [(self.SB, "expired"), (second, "no-sandbox"),
             ("claude-third", "no-sandbox")])
        self.assertIn("budget", reading["sandboxes"][2]["detail"])
        # nothing is called after the budget ran out
        self.assertEqual([c[2] for c in self.calls if c[1] == "exec"],
                         [self.SB, self.SB, second])

    def test_config_sandboxes_reads_the_jobs_block_only(self):
        import sandbox_login
        text = ("# a comment\njobs:\n  \"a b/j\":\n    sandbox: \"s1\"\n"
                "  c/j:\n    tier: sbx\n    sandbox: s2 # trailing\n"
                "  d/j:\n    sandbox: s1\nother:\n  sandbox: not-a-job\n")
        self.assertEqual(sandbox_login.config_sandboxes(text), ["s1", "s2"])
        self.assertEqual(sandbox_login.config_sandboxes(""), [])
        self.assertEqual(sandbox_login.parse_expiry("1795000000000"),
                         1795000000.0)
        self.assertEqual(sandbox_login.parse_expiry("1795000000"),
                         1795000000.0)
        self.assertIsNone(sandbox_login.parse_expiry("None"))
        self.assertIsNone(sandbox_login.parse_expiry(""))
        for absurd in ("nan", "inf", "-inf", "1e20"):
            self.assertIsNone(sandbox_login.parse_expiry(absurd), absurd)


if __name__ == "__main__":
    unittest.main()
