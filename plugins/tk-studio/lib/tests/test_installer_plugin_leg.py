"""The meta-CLI's plugin leg (Story 25.2, AD-21/O5): the skills-dir folder.

One test per row of the story's I/O matrix plus the committed roster.
Offline by construction: the fetcher serves bytes from memory, ``claude``
is a fake runner, and every path lives under a temp CLAUDE_CONFIG_DIR.
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
import zipfile
import zlib
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = PLUGIN_ROOT.parents[1]
sys.path.insert(0, str(PLUGIN_ROOT / "skills" / "tk-studio-activate" / "scripts"))
import drift_check  # noqa: E402

CLI_ROOT = REPO_ROOT / "tools" / "installer" / "cli"
sys.path.insert(0, str(CLI_ROOT))
from tk_studio_cli import main as cli_main  # noqa: E402  (repo-side)
from tk_studio_cli import plugin_leg  # noqa: E402

ROSTERS = REPO_ROOT / "tools" / "installer" / "rosters"
URL = ("https://github.com/thkennedy/tk-studio/releases/download/"
       "tk-studio--v{v}/tk-studio-{v}.zip")


def plugin_zip(version: str, extra: dict[str, str] | None = None,
               manifest_version: str | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(".claude-plugin/plugin.json", json.dumps(
            {"name": "tk-studio", "version": manifest_version or version}))
        zf.writestr("skills/tk-studio-activate/SKILL.md", f"# v{version}\n")
        for name, body in (extra or {}).items():
            zf.writestr(name, body)
    return buf.getvalue()


def roster_for(version: str, data: bytes, **override) -> dict:
    entry = {"tag": f"tk-studio--v{version}", "url": URL.format(v=version),
             "sha256": hashlib.sha256(data).hexdigest()}
    entry.update(override)
    return {"schema": 1, "channel": "stable",
            "requires": {"claude-code": ">=2.1.224"},
            "components": {"plugin": entry}}


class FakeFetch:
    def __init__(self, blobs: dict[str, bytes]):
        self.blobs = blobs
        self.calls: list[str] = []

    def __call__(self, url: str) -> bytes:
        self.calls.append(url)
        if url not in self.blobs:
            raise OSError(f"404 {url}")
        return self.blobs[url]


class FakeClaude:
    def __init__(self, exit_codes: dict[str, int] | None = None,
                 missing: bool = False):
        self.calls: list[list[str]] = []
        self.exit_codes = exit_codes or {}
        self.missing = missing

    def __call__(self, args):
        if self.missing:
            raise FileNotFoundError(args[0])
        self.calls.append(list(args))
        rc = self.exit_codes.get(" ".join(args), 0)
        return subprocess.CompletedProcess(args, rc, "", "")


class LegCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.config = self.tmp / "config"
        self.config.mkdir()
        self.env = {"CLAUDE_CONFIG_DIR": str(self.config)}
        self.target = self.config / "skills" / "tk-studio"
        self.staging = self.config / "skills" / ".tk-studio.new"
        self.previous = self.config / "skills" / ".tk-studio.previous"
        self.claude = FakeClaude()
        # Belt and braces: no test reaches the real home.
        patcher = mock.patch.object(Path, "home", return_value=self.tmp / "home")
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self._tmp.cleanup()

    def write_roster(self, roster: dict) -> Path:
        self.assertEqual(drift_check.roster_problems(roster), [],
                         "fixture roster must pass the 25.1 guard")
        path = self.tmp / "stable.json"
        path.write_text(json.dumps(roster), encoding="utf-8")
        return path

    def run_cli(self, argv, fetch=None):
        return cli_main.run(argv, fetch=fetch or FakeFetch({}),
                            runner=self.claude, env=self.env)

    def install(self, version: str, verb: str = "install", data=None):
        data = data if data is not None else plugin_zip(version)
        roster = self.write_roster(roster_for(version, data))
        fetch = FakeFetch({URL.format(v=version): data})
        return self.run_cli([verb, "--roster", str(roster)], fetch)

    def folder_version(self, folder: Path) -> str:
        return json.loads((folder / ".claude-plugin" / "plugin.json")
                          .read_text(encoding="utf-8"))["version"]

    def snapshot(self, folder: Path) -> dict:
        return {str(p.relative_to(folder)): p.read_bytes()
                for p in sorted(folder.rglob("*")) if p.is_file()}


class WriteFromZip(LegCase):
    def test_fresh_install_writes_folder_and_names_version(self):
        result, code = self.install("0.2.16")
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["intent"], "tk-studio-cli-install")
        self.assertEqual(result["version_written"], "0.2.16")
        self.assertEqual(result["mode"], "written")
        self.assertEqual(result["artifacts"], [str(self.target)])
        self.assertEqual(self.folder_version(self.target), "0.2.16")
        self.assertFalse(self.staging.exists())
        self.assertIsNone(result["previous"])

    def test_update_over_existing_keeps_previous(self):
        self.install("0.2.15")
        result, code = self.install("0.2.16", verb="update")
        self.assertEqual((code, result["status"]), (0, "complete"))
        self.assertEqual(result["intent"], "tk-studio-cli-update")
        self.assertEqual(self.folder_version(self.target), "0.2.16")
        self.assertEqual(self.folder_version(self.previous), "0.2.15")
        self.assertEqual(result["previous"], str(self.previous))

    def test_next_run_replaces_previous_with_superseded_folder(self):
        self.install("0.2.14")
        self.install("0.2.15")
        self.assertEqual(self.folder_version(self.previous), "0.2.14")
        self.install("0.2.16")
        self.assertEqual(self.folder_version(self.previous), "0.2.15")
        self.assertEqual(self.folder_version(self.target), "0.2.16")

    def test_digest_mismatch_refuses_and_leaves_folder_untouched(self):
        self.install("0.2.15")
        before = self.snapshot(self.target)
        good = plugin_zip("0.2.16")
        roster = self.write_roster(roster_for("0.2.16", good))
        fetch = FakeFetch({URL.format(v="0.2.16"): good + b"tampered"})
        result, code = self.run_cli(["update", "--roster", str(roster)], fetch)
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("DigestMismatch:"))
        self.assertIn("plugin", result["reason"])
        self.assertFalse(self.staging.exists())
        self.assertEqual(self.snapshot(self.target), before)
        self.assertEqual(self.claude.calls, [], "a refusal changes nothing")

    def test_bad_roster_entry_refuses_by_field_before_download(self):
        data = plugin_zip("0.2.16")
        good = roster_for("0.2.16", data)["components"]["plugin"]
        cases = {
            "sha256: missing": {k: v for k, v in good.items() if k != "sha256"},
            "sha256": dict(good, sha256=good["sha256"][:40]),
            "url: does not contain the tag": dict(
                good, url="https://github.com/thkennedy/tk-studio/releases/"
                          "download/other/tk-studio.zip"),
            "tag": dict(good, tag="v0.2.16"),
        }
        for field, entry in cases.items():
            with self.subTest(field=field):
                roster = roster_for("0.2.16", data)
                roster["components"]["plugin"] = entry
                path = self.tmp / "bad.json"
                path.write_text(json.dumps(roster), encoding="utf-8")
                fetch = FakeFetch({URL.format(v="0.2.16"): data})
                result, code = self.run_cli(["install", "--roster", str(path)],
                                            fetch)
                self.assertEqual((code, result["status"]), (1, "blocked"))
                self.assertTrue(result["reason"].startswith(
                    "RosterEntryInvalid:"))
                self.assertIn(f"components.plugin.{field}", result["reason"])
                self.assertEqual(fetch.calls, [], "nothing downloaded")
                self.assertFalse(self.target.exists())

    def test_plugin_absent_in_channel_is_not_shipped(self):
        roster = roster_for("0.2.16", b"x")
        del roster["components"]["plugin"]
        roster["components"]["supervisor"] = {
            "tag": "supervisor--v0.1.0", "source": "thkennedy/tk-studio-supervisor",
            "url": "https://github.com/thkennedy/tk-studio-supervisor/releases/"
                   "download/supervisor--v0.1.0/supervisor-0.1.0.zip",
            "sha256": hashlib.sha256(b"supervisor").hexdigest()}
        path = self.write_roster(roster)
        result, code = self.run_cli(["install", "--roster", str(path)])
        self.assertEqual((code, result["status"]), (0, "complete"))
        self.assertEqual(result["plugin"], "not shipped in this channel")
        self.assertFalse(self.target.exists())

    def test_version_mismatch_refuses_and_removes_staging(self):
        self.install("0.2.15")
        before = self.snapshot(self.target)
        data = plugin_zip("0.2.16", manifest_version="0.2.99")
        result, code = self.install("0.2.16", data=data)
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("PluginVersionMismatch:"))
        self.assertFalse(self.staging.exists())
        self.assertEqual(self.snapshot(self.target), before)

    def test_zip_slip_member_refused(self):
        for member in ("../x", "skills/../../x", "/etc/x", "C:/x"):
            with self.subTest(member=member):
                data = plugin_zip("0.2.16", extra={member: "evil"})
                result, code = self.install("0.2.16", data=data)
                self.assertEqual((code, result["status"]), (1, "blocked"))
                self.assertTrue(result["reason"].startswith("UnsafeZipMember:"))
                self.assertFalse(self.target.exists())
                self.assertFalse((self.config / "x").exists())
                self.assertFalse((self.tmp / "x").exists())

    def test_failed_final_rename_restores_previous(self):
        self.install("0.2.15")
        real = plugin_leg._rename
        calls = []

        def flaky(src, dst):
            calls.append((src, dst))
            if Path(src).name == ".tk-studio.new":
                raise OSError("simulated rename failure")
            real(src, dst)

        with mock.patch.object(plugin_leg, "_rename", flaky):
            result, code = self.install("0.2.16")
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("SwapFailed:"))
        self.assertEqual(self.folder_version(self.target), "0.2.15")
        self.assertFalse(self.staging.exists())


class LinkMode(LegCase):
    def checkout(self, name="checkout", manifest=True) -> Path:
        root = self.tmp / name
        plugin = root / "plugins" / "tk-studio"
        (plugin / ".claude-plugin").mkdir(parents=True)
        (plugin / "skills" / "s").mkdir(parents=True)
        (plugin / "skills" / "s" / "SKILL.md").write_text("live\n",
                                                          encoding="utf-8")
        if manifest:
            (plugin / ".claude-plugin" / "plugin.json").write_text(
                json.dumps({"name": "tk-studio", "version": "0.2.17"}),
                encoding="utf-8")
        return root

    def test_link_points_folder_at_checkout_plugin(self):
        root = self.checkout()
        result, code = self.run_cli(["install", "--link", str(root)])
        self.assertEqual((code, result["status"]), (0, "complete"))
        self.assertEqual(result["mode"], "link")
        expected = (root / "plugins" / "tk-studio").resolve()
        self.assertEqual(result["link_target"], str(expected))
        self.assertTrue(plugin_leg.is_link(self.target))
        self.assertEqual(Path(plugin_leg.link_target(self.target)).resolve(),
                         expected)
        # edits are live
        (expected / "skills" / "s" / "SKILL.md").write_text(
            "edited\n", encoding="utf-8")
        self.assertEqual((self.target / "skills" / "s" / "SKILL.md")
                         .read_text(encoding="utf-8"), "edited\n")

    def test_link_without_manifest_refused(self):
        root = self.checkout(manifest=False)
        result, code = self.run_cli(["install", "--link", str(root)])
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("LinkTargetInvalid:"))
        self.assertFalse(self.target.exists() or self.target.is_symlink())

    def test_link_replaces_folder_and_folder_replaces_link(self):
        self.install("0.2.15")
        root = self.checkout()
        self.run_cli(["install", "--link", str(root)])
        self.assertTrue(plugin_leg.is_link(self.target))
        self.assertEqual(self.folder_version(self.previous), "0.2.15")
        # folder replaces link: the link moves to previous
        self.install("0.2.16")
        self.assertFalse(plugin_leg.is_link(self.target))
        self.assertEqual(self.folder_version(self.target), "0.2.16")
        self.assertTrue(plugin_leg.is_link(self.previous))
        # next run removes the linked previous without recursing into it
        self.install("0.2.17", data=plugin_zip("0.2.17"))
        self.assertFalse(plugin_leg.is_link(self.previous))
        checkout_skill = root / "plugins" / "tk-studio" / "skills" / "s" / "SKILL.md"
        self.assertTrue(checkout_skill.is_file(), "a linked checkout is "
                        "never deleted")
        self.assertTrue((root / "plugins" / "tk-studio" / ".claude-plugin"
                         / "plugin.json").is_file())

    def test_relinking_unlinks_old_link_previous_without_recursing(self):
        root = self.checkout()
        self.run_cli(["install", "--link", str(root)])
        self.run_cli(["install", "--link", str(root)])
        self.run_cli(["install", "--link", str(root)])
        self.assertTrue(plugin_leg.is_link(self.target))
        self.assertTrue((root / "plugins" / "tk-studio" / "skills" / "s"
                         / "SKILL.md").is_file())


class Doctor(LegCase):
    def test_doctor_reports_link_written_and_missing(self):
        result, code = self.run_cli(["doctor"])
        self.assertEqual((code, result["status"], result["mode"]),
                         (0, "complete", "missing"))
        self.assertEqual(result["intent"], "tk-studio-cli-doctor")
        self.install("0.2.16")
        result, _ = self.run_cli(["doctor"])
        self.assertEqual((result["mode"], result["version"]),
                         ("written", "0.2.16"))
        root = LinkMode.checkout(self, "co")
        self.run_cli(["install", "--link", str(root)])
        result, _ = self.run_cli(["doctor"])
        self.assertEqual(result["mode"], "link")
        self.assertEqual(Path(result["link_target"]).resolve(),
                         (root / "plugins" / "tk-studio").resolve())
        self.assertIn("link mode", result["summary"])

    def test_doctor_is_read_only(self):
        self.install("0.2.16")
        before = sorted(str(p) for p in self.config.rglob("*"))
        self.run_cli(["doctor"])
        self.assertEqual(sorted(str(p) for p in self.config.rglob("*")), before)
        self.assertEqual(self.claude.calls, [])

    def test_config_dir_falls_back_to_home_dot_claude(self):
        self.assertEqual(plugin_leg.config_dir({}),
                         self.tmp / "home" / ".claude")
        self.assertEqual(plugin_leg.claude_json_path({}),
                         self.tmp / "home" / ".claude.json")
        self.assertEqual(plugin_leg.config_dir(self.env), self.config)


class Marketplace(LegCase):
    def seed_marketplace(self, project: Path | None = None):
        plugins = self.config / "plugins"
        plugins.mkdir()
        records = [{"scope": "user", "version": "0.2.16"}]
        if project is not None:
            records.append({"scope": "project", "projectPath": str(project),
                            "version": "0.2.14"})
        (plugins / "installed_plugins.json").write_text(json.dumps(
            {"version": 2, "plugins": {"tk-studio@tk-studio": records,
                                        "other@elsewhere": [{"scope": "user"}]}}),
            encoding="utf-8")
        (plugins / "known_marketplaces.json").write_text(json.dumps(
            {"tk-studio": {"source": {"source": "directory"}},
             "claude-plugins-official": {}}), encoding="utf-8")

    UNINSTALL = "claude plugin uninstall tk-studio@tk-studio --scope user"
    REMOVE = "claude plugin marketplace remove tk-studio"

    def test_user_copy_uninstalled_and_marketplace_removed(self):
        self.seed_marketplace()
        result, code = self.install("0.2.16")
        self.assertEqual((code, result["status"]), (0, "complete"))
        self.assertEqual([" ".join(c) for c in self.claude.calls],
                         [self.UNINSTALL, self.REMOVE])
        self.assertEqual(result["marketplace"]["removed"],
                         [self.UNINSTALL, self.REMOVE])

    def test_claude_failure_is_partial_naming_command(self):
        self.seed_marketplace()
        self.claude.exit_codes = {self.REMOVE: 3}
        result, code = self.install("0.2.16")
        self.assertEqual(result["status"], "partial")
        self.assertIn(self.REMOVE, result["reason"])
        self.assertEqual(result["version_written"], "0.2.16")
        self.assertEqual(self.folder_version(self.target), "0.2.16")

    def test_no_claude_on_path_skips_with_reason(self):
        self.seed_marketplace()
        self.claude.missing = True
        result, code = self.install("0.2.16")
        self.assertEqual((code, result["status"]), (0, "complete"))
        self.assertEqual(result["marketplace"]["status"], "skipped")
        self.assertIn("claude not on PATH", result["marketplace"]["reason"])
        self.assertEqual(self.folder_version(self.target), "0.2.16")

    def test_clean_box_calls_no_claude(self):
        result, _ = self.install("0.2.16")
        self.assertEqual(result["marketplace"], {"status": "clean",
                                                 "removed": []})
        self.assertEqual(self.claude.calls, [])

    def test_project_entries_reported_never_edited(self):
        proj_a = self.tmp / "proj-a"
        proj_b = self.tmp / "proj-b"
        proj_c = self.tmp / "proj-c"
        for p in (proj_a, proj_b, proj_c):
            (p / ".claude").mkdir(parents=True)
        (proj_a / ".claude" / "settings.json").write_text(json.dumps(
            {"extraKnownMarketplaces": {"tk-studio": {}},
             "enabledPlugins": {"tk-studio@tk-studio": True, "x@y": True}}),
            encoding="utf-8")
        (proj_b / ".claude" / "settings.local.json").write_text(json.dumps(
            {"enabledPlugins": {"tk-studio@tk-studio": True}}), encoding="utf-8")
        (proj_c / ".claude" / "settings.json").write_text("{not json",
                                                          encoding="utf-8")
        self.seed_marketplace(project=proj_a)
        (self.config / ".claude.json").write_text(json.dumps(
            {"projects": {str(proj_b): {}, str(proj_c): {},
                          str(self.tmp / "gone"): {}}}), encoding="utf-8")
        files = [proj_a / ".claude" / "settings.json",
                 proj_b / ".claude" / "settings.local.json",
                 proj_c / ".claude" / "settings.json"]
        pinned = {f: (f.stat().st_mtime_ns, f.read_bytes()) for f in files}

        result, code = self.install("0.2.16")
        self.assertEqual(code, 0)
        entries = result["project_entries"]
        keys = {(e["project"], Path(e["file"]).name, e.get("key"))
                for e in entries if "error" not in e}
        self.assertIn((str(proj_a), "installed_plugins.json",
                       "tk-studio@tk-studio"), keys)
        self.assertIn((str(proj_a), "settings.json",
                       "extraKnownMarketplaces.tk-studio"), keys)
        self.assertIn((str(proj_a), "settings.json",
                       "enabledPlugins.tk-studio@tk-studio"), keys)
        self.assertIn((str(proj_b), "settings.local.json",
                       "enabledPlugins.tk-studio@tk-studio"), keys)
        self.assertNotIn("enabledPlugins.x@y", {k for _, _, k in keys})
        errors = [e for e in entries if "error" in e]
        self.assertEqual([e["project"] for e in errors], [str(proj_c)])
        for f, (mtime, data) in pinned.items():
            self.assertEqual((f.stat().st_mtime_ns, f.read_bytes()),
                             (mtime, data), f"{f} must never be edited")
        # project-scope records are reported, never uninstalled
        self.assertEqual([" ".join(c) for c in self.claude.calls],
                         [self.UNINSTALL, self.REMOVE])


class FailedRunKeepsPrevious(LegCase):
    """Review patch 1: a failed run never deletes .tk-studio.previous."""

    def setUp(self):
        super().setUp()
        self.install("0.2.14")
        self.install("0.2.15")
        self.assertEqual(self.folder_version(self.previous), "0.2.14")
        self.before = (self.snapshot(self.target), self.snapshot(self.previous))

    def assertUnchanged(self, result, code, reason):
        self.assertEqual((code, result["status"]), (1, "blocked"), result)
        self.assertTrue(result["reason"].startswith(reason + ":"),
                        result["reason"])
        self.assertEqual((self.snapshot(self.target),
                          self.snapshot(self.previous)), self.before)
        self.assertFalse(self.staging.exists() or self.staging.is_symlink())
        self.assertFalse((self.config / "skills" / ".tk-studio.retired")
                         .exists())

    def test_digest_mismatch(self):
        good = plugin_zip("0.2.16")
        roster = self.write_roster(roster_for("0.2.16", good))
        fetch = FakeFetch({URL.format(v="0.2.16"): good + b"x"})
        self.assertUnchanged(*self.run_cli(
            ["update", "--roster", str(roster)], fetch), "DigestMismatch")

    def test_version_mismatch(self):
        data = plugin_zip("0.2.16", manifest_version="0.2.99")
        self.assertUnchanged(*self.install("0.2.16", data=data),
                             "PluginVersionMismatch")

    def test_bad_extract(self):
        with mock.patch.object(zipfile.ZipFile, "extractall",
                               side_effect=OSError("disk full")):
            self.assertUnchanged(*self.install("0.2.16"), "PluginZipInvalid")

    def test_failed_link(self):
        root = LinkMode.checkout(self)
        with mock.patch.object(plugin_leg, "make_link", side_effect=
                               plugin_leg.Refusal("LinkFailed", "simulated")):
            self.assertUnchanged(*self.run_cli(["install", "--link", str(root)]),
                                 "LinkFailed")

    def test_failed_first_rename(self):
        real = plugin_leg._rename

        def flaky(src, dst):
            if Path(src).name == "tk-studio":
                raise OSError("simulated: target locked")
            real(src, dst)

        with mock.patch.object(plugin_leg, "_rename", flaky):
            self.assertUnchanged(*self.install("0.2.16"), "SwapFailed")

    def test_success_still_rotates_previous(self):
        result, code = self.install("0.2.16")
        self.assertEqual(code, 0)
        self.assertEqual(self.folder_version(self.previous), "0.2.15")
        self.assertNotIn("retired_left", result)
        self.assertFalse((self.config / "skills" / ".tk-studio.retired")
                         .exists())


class NotShippedKeepsMarketplace(LegCase):
    """Review patch 2: no folder, no marketplace removal."""

    def not_shipped_roster(self) -> Path:
        roster = roster_for("0.2.16", b"x")
        del roster["components"]["plugin"]
        roster["components"]["supervisor"] = {
            "tag": "supervisor--v0.1.0", "source": "thkennedy/tk-studio-supervisor",
            "url": "https://github.com/thkennedy/tk-studio-supervisor/releases/"
                   "download/supervisor--v0.1.0/supervisor-0.1.0.zip",
            "sha256": hashlib.sha256(b"supervisor").hexdigest()}
        return self.write_roster(roster)

    def test_no_folder_skips_removal(self):
        Marketplace.seed_marketplace(self)
        result, code = self.run_cli(["install", "--roster",
                                     str(self.not_shipped_roster())])
        self.assertEqual((code, result["status"]), (0, "complete"))
        self.assertEqual(self.claude.calls, [])
        self.assertEqual(result["marketplace"]["status"], "skipped")
        self.assertIn("no skills-dir folder", result["marketplace"]["reason"])
        self.assertIn("project_entries", result)

    def test_existing_folder_still_removes(self):
        self.install("0.2.15")
        Marketplace.seed_marketplace(self)
        result, _ = self.run_cli(["install", "--roster",
                                  str(self.not_shipped_roster())])
        self.assertEqual([" ".join(c) for c in self.claude.calls],
                         [Marketplace.UNINSTALL, Marketplace.REMOVE])
        self.assertEqual(result["marketplace"]["status"], "removed")


class SkillsDirKeyNotUninstalled(LegCase):
    """Review patch 5: tk-studio@skills-dir is the folder, not a copy."""

    def test_skills_dir_record_not_uninstalled(self):
        plugins = self.config / "plugins"
        plugins.mkdir()
        (plugins / "installed_plugins.json").write_text(json.dumps(
            {"version": 2, "plugins": {
                "tk-studio@skills-dir": [{"scope": "user"}],
                "tk-studio@tk-studio": [{"scope": "user"}]}}), encoding="utf-8")
        self.install("0.2.16")
        self.assertEqual([" ".join(c) for c in self.claude.calls],
                         [Marketplace.UNINSTALL])


class LastLineJson(LegCase):
    """Review patch 3: every OSError path still ends in one JSON line."""

    def main_json(self, argv, fetch=None):
        out = io.StringIO()
        with redirect_stdout(out):
            code = cli_main.main(argv, fetch=fetch or FakeFetch({}),
                                 runner=self.claude, env=self.env)
        return json.loads(out.getvalue().strip().splitlines()[-1]), code

    def install_argv(self, version="0.2.16"):
        data = plugin_zip(version)
        roster = self.write_roster(roster_for(version, data))
        return (["install", "--roster", str(roster)],
                FakeFetch({URL.format(v=version): data}))

    def assertBlocked(self, result, code, reason):
        self.assertEqual((result["status"], code), ("blocked", 1), result)
        self.assertTrue(result["reason"].startswith(reason + ":"),
                        result["reason"])

    def test_mkdir_failure(self):
        (self.config / "skills").write_text("a file", encoding="utf-8")
        self.assertBlocked(*self.main_json(*self.install_argv()),
                           "FolderUnwritable")

    def test_cleanup_failure(self):
        real = plugin_leg.remove_path

        def locked(path):
            if Path(path).name == ".tk-studio.new":
                raise PermissionError("locked")
            real(path)

        self.staging.parent.mkdir(parents=True)
        self.staging.mkdir()
        with mock.patch.object(plugin_leg, "remove_path", locked):
            self.assertBlocked(*self.main_json(*self.install_argv()),
                               "CleanupFailed")

    def test_previous_cleanup_failure(self):
        self.install("0.2.14")
        self.install("0.2.15")
        real = plugin_leg.remove_path

        def locked(path):
            if Path(path).name == ".tk-studio.retired":
                raise PermissionError("locked")
            real(path)

        (self.config / "skills" / ".tk-studio.retired").mkdir()
        with mock.patch.object(plugin_leg, "remove_path", locked):
            result, code = self.main_json(*self.install_argv())
        self.assertBlocked(result, code, "CleanupFailed")
        self.assertEqual(self.folder_version(self.target), "0.2.15")

    @unittest.skipIf(sys.platform == "win32", "POSIX symlink path")
    def test_symlink_failure(self):
        root = LinkMode.checkout(self)
        with mock.patch.object(plugin_leg.os, "symlink",
                               side_effect=PermissionError("no symlinks")):
            self.assertBlocked(*self.main_json(["install", "--link", str(root)]),
                               "LinkFailed")
        self.assertFalse(self.target.exists() or self.target.is_symlink())

    def test_restore_failure_names_where_previous_is(self):
        self.install("0.2.15")

        def broken(src, dst):
            if Path(src).name in (".tk-studio.new", ".tk-studio.previous"):
                raise OSError("simulated")
            os.rename(src, dst)

        with mock.patch.object(plugin_leg, "_rename", broken):
            result, code = self.main_json(*self.install_argv())
        self.assertBlocked(result, code, "SwapFailed")
        self.assertIn("could not restore", result["reason"])
        self.assertIn(str(self.previous), result["reason"])
        self.assertFalse(self.staging.exists())
        self.assertEqual(self.folder_version(self.previous), "0.2.15")

    def test_runner_oserror_is_partial(self):
        Marketplace.seed_marketplace(self)

        def denied(args):
            raise PermissionError("claude not executable")

        out = io.StringIO()
        argv, fetch = self.install_argv()
        with redirect_stdout(out):
            code = cli_main.main(argv, fetch=fetch, runner=denied, env=self.env)
        result = json.loads(out.getvalue().strip().splitlines()[-1])
        self.assertEqual((result["status"], code), ("partial", 0))
        self.assertTrue(result["reason"].startswith("MarketplaceRemovalFailed:"))
        self.assertIn("PermissionError", result["reason"])
        self.assertEqual(result["version_written"], "0.2.16")

    def test_last_resort_handler(self):
        with mock.patch.object(plugin_leg, "doctor",
                               side_effect=OSError("disk gone")):
            result, code = self.main_json(["doctor"])
        self.assertBlocked(result, code, "UnexpectedOSError")
        self.assertEqual(result["intent"], "tk-studio-cli-doctor")

    def test_usage_error(self):
        for argv in (["bogus"], [], ["install", "--channel", "nightly"],
                     ["update", "--link", "x"]):
            with self.subTest(argv=argv):
                result, code = self.main_json(argv)
                self.assertEqual(result["status"], "blocked")
                self.assertTrue(result["reason"].startswith("UsageError:"))
                self.assertEqual(code, 2)


class PreviousKeptWithoutTarget(LegCase):
    """Follow-up P1: previous is the only fallback when nothing supersedes."""

    def setUp(self):
        super().setUp()
        self.install("0.2.14")
        self.install("0.2.15")
        self.retired = self.config / "skills" / ".tk-studio.retired"

    def test_previous_untouched_when_target_absent(self):
        plugin_leg.remove_path(self.target)
        before = self.snapshot(self.previous)
        result, code = self.install("0.2.16")
        self.assertEqual((code, result["status"]), (0, "complete"))
        self.assertEqual(self.folder_version(self.target), "0.2.16")
        self.assertEqual(self.snapshot(self.previous), before)
        self.assertIsNone(result["previous"])
        self.assertFalse(self.retired.exists())

    def test_lone_retired_restored_as_previous(self):
        # A failed restore left the only previous (0.2.14) at retired.
        os.rename(self.previous, self.retired)
        real = plugin_leg._rename

        def locked(src, dst):
            if Path(src).name == "tk-studio":
                raise OSError("simulated: target locked")
            real(src, dst)

        with mock.patch.object(plugin_leg, "_rename", locked):
            result, code = self.install("0.2.16")
        self.assertEqual((code, result["status"]), (1, "blocked"))
        # retired went back to previous before the swap; the failed swap
        # restored it there, so the folder is not lost
        self.assertEqual(self.folder_version(self.previous), "0.2.14")
        self.assertFalse(self.retired.exists())
        os.rename(self.previous, self.retired)
        result, code = self.install("0.2.16")
        # success: previous = the superseded target, the old one cleaned
        self.assertEqual((code, result["status"]), (0, "complete"))
        self.assertNotIn("retired_left", result)
        self.assertEqual(self.folder_version(self.target), "0.2.16")
        self.assertEqual(self.folder_version(self.previous), "0.2.15")
        self.assertFalse(self.retired.exists())

    def test_lone_retired_restore_failure_is_named(self):
        os.rename(self.previous, self.retired)
        real = plugin_leg._rename

        def broken(src, dst):
            if Path(src).name == ".tk-studio.retired":
                raise OSError("simulated")
            real(src, dst)

        with mock.patch.object(plugin_leg, "_rename", broken):
            result, code = self.install("0.2.16")
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("CleanupFailed:"))
        self.assertEqual(self.folder_version(self.retired), "0.2.14")
        self.assertEqual(self.folder_version(self.target), "0.2.15")


class ExtractErrorsAreNamed(LegCase):
    """Follow-up P2: any extract error is PluginZipInvalid; any exception
    from run() still ends in one blocked JSON line."""

    def test_non_oserror_extract_failures_refused(self):
        self.install("0.2.15")
        before = self.snapshot(self.target)
        for exc in (zlib.error("invalid block type"),
                    NotImplementedError("compression type 99"),
                    RuntimeError("File is encrypted")):
            with self.subTest(exc=type(exc).__name__):
                def half(path, *a, **k):
                    Path(path).mkdir(parents=True)
                    (Path(path) / "partial").write_text("x", encoding="utf-8")
                    raise exc

                with mock.patch.object(zipfile.ZipFile, "extractall",
                                       side_effect=half):
                    result, code = self.install("0.2.16")
                self.assertEqual((code, result["status"]), (1, "blocked"))
                self.assertTrue(result["reason"].startswith(
                    "PluginZipInvalid:"), result["reason"])
                self.assertIn(type(exc).__name__, result["reason"])
                self.assertFalse(self.staging.exists())
                self.assertEqual(self.snapshot(self.target), before)

    def test_main_prints_blocked_line_for_any_exception(self):
        Marketplace.seed_marketplace(self)
        argv, fetch = LastLineJson.install_argv(self)

        def broken(args):
            raise ValueError("bad runner")

        out = io.StringIO()
        with redirect_stdout(out):
            code = cli_main.main(argv, fetch=fetch, runner=broken, env=self.env)
        result = json.loads(out.getvalue().strip().splitlines()[-1])
        self.assertEqual((result["status"], code), ("blocked", 1))
        self.assertTrue(result["reason"].startswith(
            "UnexpectedError: ValueError:"), result["reason"])
        self.assertEqual(result["intent"], "tk-studio-cli-install")


class DanglingJunction(unittest.TestCase):
    """Follow-up P4: Windows before 3.12 — a dangling junction is a link."""

    def test_dangling_junction_detected_without_isjunction(self):
        with tempfile.TemporaryDirectory() as tmp:
            link = Path(tmp) / "tk-studio"
            os.symlink(Path(tmp) / "moved-checkout", link,
                       target_is_directory=True)
            self.assertFalse(link.exists(), "dangling")
            with mock.patch.object(plugin_leg, "sys",
                                   mock.Mock(platform="win32")), \
                    mock.patch.object(os.path, "isjunction", None,
                                      create=True), \
                    mock.patch.object(Path, "is_symlink", return_value=False):
                self.assertTrue(plugin_leg.is_link(link))


class SkillsDirKeyNotReported(LegCase):
    """Follow-up P5: tk-studio@skills-dir is not a project marketplace copy."""

    def test_project_skills_dir_key_not_listed(self):
        proj = self.tmp / "proj"
        (proj / ".claude").mkdir(parents=True)
        settings = proj / ".claude" / "settings.json"
        settings.write_text(json.dumps({"enabledPlugins": {
            "tk-studio@tk-studio": True, "tk-studio@skills-dir": False}}),
            encoding="utf-8")
        plugins = self.config / "plugins"
        plugins.mkdir()
        (plugins / "installed_plugins.json").write_text(json.dumps(
            {"version": 2, "plugins": {"tk-studio@skills-dir": [
                {"scope": "project", "projectPath": str(proj)}]}}),
            encoding="utf-8")
        (self.config / ".claude.json").write_text(json.dumps(
            {"projects": {str(proj): {}}}), encoding="utf-8")
        pinned = (settings.stat().st_mtime_ns, settings.read_bytes())
        result, code = self.install("0.2.16")
        self.assertEqual(code, 0)
        self.assertEqual([e.get("key") for e in result["project_entries"]],
                         ["enabledPlugins.tk-studio@tk-studio"])
        self.assertEqual((settings.stat().st_mtime_ns, settings.read_bytes()),
                         pinned)


class RunnerTimeout(LegCase):
    """Follow-up P6: a stalled claude is a failed command, never a hang."""

    def test_timeout_is_partial_naming_command(self):
        Marketplace.seed_marketplace(self)

        def stalled(args):
            raise subprocess.TimeoutExpired(args, plugin_leg.RUNNER_TIMEOUT)

        argv, fetch = LastLineJson.install_argv(self)
        result, code = cli_main.run(argv, fetch=fetch, runner=stalled,
                                    env=self.env)
        self.assertEqual((code, result["status"]), (0, "partial"))
        self.assertTrue(result["reason"].startswith("MarketplaceRemovalFailed:"))
        self.assertIn(Marketplace.UNINSTALL, result["reason"])
        self.assertIn("TimeoutExpired", result["reason"])
        self.assertIsNone(result["marketplace"]["failed"][0]["exit"])

    def test_default_runner_bounds_and_closes_stdin(self):
        with mock.patch.object(plugin_leg.shutil, "which",
                               return_value="/fake/claude"), \
                mock.patch.object(plugin_leg.subprocess, "run") as run:
            plugin_leg.default_runner(["claude", "plugin", "list"])
        kwargs = run.call_args.kwargs
        self.assertEqual(kwargs["timeout"], plugin_leg.RUNNER_TIMEOUT)
        self.assertIs(kwargs["stdin"], subprocess.DEVNULL)


class UnreadableRecordFiles(LegCase):
    """Follow-up P7: an unreadable record file is partial, never clean."""

    def test_corrupt_installed_plugins_is_partial(self):
        Marketplace.seed_marketplace(self)
        installed = self.config / "plugins" / "installed_plugins.json"
        installed.write_text("{not json", encoding="utf-8")
        result, code = self.install("0.2.16")
        self.assertEqual((code, result["status"]), (0, "partial"))
        self.assertTrue(result["reason"].startswith("MarketplaceRemovalFailed:"))
        self.assertIn(str(installed), result["reason"])
        # the other file is still used
        self.assertEqual([" ".join(c) for c in self.claude.calls],
                         [Marketplace.REMOVE])
        self.assertEqual(self.folder_version(self.target), "0.2.16")
        self.assertIsInstance(result["project_entries"], list)

    def test_corrupt_known_marketplaces_still_uninstalls(self):
        Marketplace.seed_marketplace(self)
        known = self.config / "plugins" / "known_marketplaces.json"
        known.write_text("[]", encoding="utf-8")
        result, code = self.install("0.2.16")
        self.assertEqual((code, result["status"]), (0, "partial"))
        self.assertEqual([" ".join(c) for c in self.claude.calls],
                         [Marketplace.UNINSTALL])
        self.assertIn(Marketplace.UNINSTALL, result["marketplace"]["removed"])
        self.assertIn("known_marketplaces.json", result["reason"])

    def test_no_plugins_object_and_no_claude_still_partial(self):
        plugins = self.config / "plugins"
        plugins.mkdir()
        (plugins / "installed_plugins.json").write_text(
            json.dumps({"plugins": []}), encoding="utf-8")
        (plugins / "known_marketplaces.json").write_text(
            json.dumps({"tk-studio": {}}), encoding="utf-8")
        self.claude.missing = True
        result, code = self.install("0.2.16")
        self.assertEqual((code, result["status"]), (0, "partial"))
        self.assertEqual(result["marketplace"]["status"], "skipped")
        self.assertIn("installed_plugins.json", result["reason"])


class CommittedRoster(unittest.TestCase):
    def test_committed_rosters_plugin_entry_accepted(self):
        for channel in ("stable", "latest"):
            with self.subTest(channel=channel):
                roster = json.loads((ROSTERS / f"{channel}.json")
                                    .read_text(encoding="utf-8"))
                entry = roster["components"]["plugin"]
                self.assertEqual(plugin_leg.plugin_entry_problems(entry), [])
                self.assertEqual(plugin_leg.check_plugin_entry(entry),
                                 entry["tag"].split("--v", 1)[1])

    def test_default_roster_url_names_channel_file_on_main(self):
        self.assertEqual(
            plugin_leg.DEFAULT_ROSTER_URL.format(channel="stable"),
            "https://raw.githubusercontent.com/thkennedy/tk-studio/main/"
            "tools/installer/rosters/stable.json")


class Entrypoint(unittest.TestCase):
    def test_python_m_doctor_prints_one_json_last_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = dict(os.environ, CLAUDE_CONFIG_DIR=tmp,
                       PYTHONPATH=str(CLI_ROOT))
            proc = subprocess.run([sys.executable, "-m", "tk_studio_cli",
                                   "doctor"], capture_output=True, text=True,
                                  encoding="utf-8", env=env, cwd=tmp)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        last = json.loads(proc.stdout.strip().splitlines()[-1])
        self.assertEqual((last["status"], last["mode"]), ("complete", "missing"))

    def test_pyproject_names_project_version_and_script(self):
        text = (CLI_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        self.assertIn('name = "tk-studio-cli"', text)
        self.assertIn('version = "0.1.0"', text)
        self.assertIn('tk-studio = "tk_studio_cli.main:main"', text)


class RepoSettings(unittest.TestCase):
    def test_repo_settings_carry_no_marketplace_entries(self):
        data = json.loads((REPO_ROOT / ".claude" / "settings.json")
                          .read_text(encoding="utf-8"))
        self.assertNotIn("extraKnownMarketplaces", data)
        self.assertNotIn("enabledPlugins", data)
        self.assertIn("hooks", data)
        self.assertIn("permissions", data)


if __name__ == "__main__":
    unittest.main()
