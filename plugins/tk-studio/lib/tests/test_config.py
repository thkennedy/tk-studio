"""Tests for config scopes + resolution + AD-3 refusal (ST-2.2 acceptance criteria)."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402
import store  # noqa: E402


class ConfigTestCase(unittest.TestCase):
    """Throwaway user store + project root per test."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self.user_root = base / ".tk-studio"
        self.project = base / "proj"
        self.project.mkdir()
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        os.environ["TK_STUDIO_HOME"] = str(self.user_root)

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()

    def _write(self, path: Path, text: str):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")


class ResolutionTests(ConfigTestCase):
    KEY = "planning.backend"

    def _set_all_scopes(self):
        self._write(self.project / ".tk-studio" / "config.local.yaml",
                    "planning:\n  backend: from-local\n")
        self._write(self.project / ".tk-studio" / "config.yaml",
                    "planning:\n  backend: from-tracked\n")
        self._write(self.user_root / "config.yaml",
                    "planning:\n  backend: from-user\n")

    def test_precedence_ladder(self):
        # AC: runtime > project local > project tracked > user > studio default.
        self._set_all_scopes()
        runtime = {"planning": {"backend": "from-runtime"}}

        value, scope = config.resolve(self.KEY, self.project, runtime)
        self.assertEqual((value, scope), ("from-runtime", "runtime"))

        value, scope = config.resolve(self.KEY, self.project)
        self.assertEqual((value, scope), ("from-local", "project-local"))

        (self.project / ".tk-studio" / "config.local.yaml").unlink()
        value, scope = config.resolve(self.KEY, self.project)
        self.assertEqual((value, scope), ("from-tracked", "project-tracked"))

        (self.project / ".tk-studio" / "config.yaml").unlink()
        value, scope = config.resolve(self.KEY, self.project)
        self.assertEqual((value, scope), ("from-user", "user"))

        (self.user_root / "config.yaml").unlink()
        value, scope = config.resolve(self.KEY, self.project)
        self.assertEqual((value, scope), ("backlog-md", "studio"))

    def test_studio_defaults_shipped(self):
        self.assertEqual(config.resolve("vcs")[0], "git")
        self.assertEqual(config.resolve("scheduler.substrate")[0], "harness-native")

    def test_unknown_key_raises(self):
        with self.assertRaises(config.ConfigError):
            config.resolve("no.such.key", self.project)

    def test_scope_owning_key_wins_whole_value(self):
        # No cross-scope merging: local's planning mapping owns 'planning'.
        self._write(self.project / ".tk-studio" / "config.local.yaml",
                    "planning:\n  extra: x\n")
        self._write(self.project / ".tk-studio" / "config.yaml",
                    "planning:\n  backend: from-tracked\n")
        value, scope = config.resolve("planning.backend", self.project)
        self.assertEqual((value, scope), ("from-tracked", "project-tracked"))
        value, scope = config.resolve("planning", self.project)
        self.assertEqual(scope, "project-local")

    def test_runtime_set_parsing(self):
        runtime = config._parse_runtime_sets(
            ["planning.backend=jira", "flag=true", "n=3"])
        self.assertEqual(runtime, {"planning": {"backend": "jira"},
                                   "flag": True, "n": 3})
        with self.assertRaises(config.ConfigError):
            config._parse_runtime_sets(["novalue"])


class ClassificationTests(ConfigTestCase):
    def test_tracked_refuses_machine_path(self):
        with self.assertRaises(config.ClassificationError):
            config.assert_tracked_safe("vault: C:\\Users\\tim\\vault\n", "t")
        with self.assertRaises(config.ClassificationError):
            config.assert_tracked_safe("root: /home/tim/code\n", "t")

    def test_tracked_refuses_credentials(self):
        with self.assertRaises(config.ClassificationError):
            config.assert_tracked_safe("key: ghp_ABCDEFGHIJKLMNOP1234\n", "t")

    def test_tracked_accepts_clean_content(self):
        config.assert_tracked_safe("vcs: git\nplanning:\n  backend: jira\n", "t")

    def test_local_allows_paths_refuses_credentials(self):
        config.assert_local_safe("vault: C:\\Users\\tim\\vault\n", "l")
        with self.assertRaises(config.ClassificationError):
            config.assert_local_safe("t: xoxb-12345678-ABCDEFGH\n", "l")


class StandupTests(ConfigTestCase):
    def test_creates_both_files_and_gitignore(self):
        result = config.standup_project_config(self.project)
        tracked = self.project / ".tk-studio" / "config.yaml"
        local = self.project / ".tk-studio" / "config.local.yaml"
        self.assertTrue(tracked.is_file() and local.is_file())
        self.assertIn("config.yaml", result["created"])
        gitignore = (self.project / ".gitignore").read_text(encoding="utf-8")
        self.assertIn(config.GITIGNORE_LINE, gitignore)
        # Tracked file resolves: vcs concrete, schema keys present as comments.
        self.assertEqual(config.resolve("vcs", self.project)[1], "project-tracked")
        text = tracked.read_text(encoding="utf-8")
        for fragment in ("# project_id:", "working_set", "jobs", "backend"):
            self.assertIn(fragment, text)

    def test_idempotent_never_touches_existing(self):
        config.standup_project_config(self.project)
        tracked = self.project / ".tk-studio" / "config.yaml"
        tracked.write_text("vcs: perforce\n# custom\n", encoding="utf-8")
        before_gitignore = (self.project / ".gitignore").read_bytes()
        result = config.standup_project_config(self.project)
        self.assertEqual(result["created"], [])
        self.assertEqual(tracked.read_text(encoding="utf-8"), "vcs: perforce\n# custom\n")
        self.assertEqual((self.project / ".gitignore").read_bytes(), before_gitignore)

    def test_explicit_project_id_recorded(self):
        config.standup_project_config(self.project, project_id="proj-alpha")
        self.assertEqual(config.resolve("project_id", self.project)[0], "proj-alpha")

    def test_perforce_emits_guidance_no_gitignore(self):
        result = config.standup_project_config(self.project, vcs="perforce")
        self.assertTrue(any("P4IGNORE" in g for g in result["guidance"]))
        self.assertFalse((self.project / ".gitignore").exists())

    def test_gitignore_appended_not_clobbered(self):
        self._write(self.project / ".gitignore", "node_modules/\n")
        config.standup_project_config(self.project)
        lines = (self.project / ".gitignore").read_text(encoding="utf-8").splitlines()
        self.assertEqual(lines, ["node_modules/", config.GITIGNORE_LINE])


if __name__ == "__main__":
    unittest.main()
