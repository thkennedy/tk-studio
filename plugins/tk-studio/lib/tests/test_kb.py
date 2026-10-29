"""Tests for the agent-first knowledge base (ST-2.4 acceptance criteria)."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import kb  # noqa: E402


class KbTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.project = Path(self._tmp.name) / "proj"
        self.project.mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def _write(self, rel: str, text: str):
        path = self.project / "kb" / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")

    def _index(self) -> str:
        return kb.index_path(self.project).read_text(encoding="utf-8")


class StandupTests(KbTestCase):
    def test_creates_kb_with_index(self):
        result = kb.standup_kb(self.project)
        self.assertIn("kb/", result["created"])
        self.assertTrue(kb.index_path(self.project).is_file())
        text = self._index()
        self.assertIn(kb.GENERATED_MARKER, text)
        self.assertIn("No knowledge files yet", text)

    def test_idempotent_and_preserves_content(self):
        kb.standup_kb(self.project)
        self._write("notes.md", "# Notes\n\nBody line.\n")
        kb.generate_index(self.project)
        result = kb.standup_kb(self.project)
        self.assertEqual(result["created"], [])
        self.assertFalse(result["changed"])
        self.assertTrue((self.project / "kb" / "notes.md").is_file())

    def test_foreign_index_refused(self):
        (self.project / "kb").mkdir()
        self._write("index.md", "# Hand-authored index\n")
        with self.assertRaises(kb.KbError):
            kb.standup_kb(self.project)
        self.assertEqual(self._index(), "# Hand-authored index\n")


class IndexTests(KbTestCase):
    def test_reflects_current_files_ranked(self):
        kb.standup_kb(self.project)
        self._write("zeta.md", "---\nrank: 1\ntitle: Zeta First\n---\n# Z\n\nTop doc.\n")
        self._write("alpha.md", "# Alpha\n\nDefault-ranked doc.\n")
        self._write("nested/deep.md", "---\ndescription: from frontmatter\n---\n# Deep\n")
        kb.generate_index(self.project)
        text = self._index()
        lines = [l for l in text.splitlines() if l.startswith("- [")]
        self.assertEqual(lines, [
            "- [Zeta First](zeta.md) — Top doc.",
            "- [Alpha](alpha.md) — Default-ranked doc.",
            "- [Deep](nested/deep.md) — from frontmatter",
        ])

    def test_removal_and_rename_tracked_no_human_reordering(self):
        kb.standup_kb(self.project)
        self._write("old.md", "# Old\n")
        kb.generate_index(self.project)
        self.assertIn("old.md", self._index())
        (self.project / "kb" / "old.md").rename(self.project / "kb" / "new.md")
        result = kb.generate_index(self.project)
        self.assertTrue(result["changed"])
        text = self._index()
        self.assertNotIn("old.md", text)
        self.assertIn("new.md", text)

    def test_deterministic_rerun_no_change(self):
        kb.standup_kb(self.project)
        self._write("a.md", "# A\n\nText.\n")
        kb.generate_index(self.project)
        before = kb.index_path(self.project).read_bytes()
        result = kb.generate_index(self.project)
        self.assertFalse(result["changed"])
        self.assertEqual(kb.index_path(self.project).read_bytes(), before)

    def test_fallbacks_title_and_description(self):
        kb.standup_kb(self.project)
        self._write("bare.md", "just a paragraph, no heading\n")
        self._write("broken.md", "---\na: {broken\n---\n# Broken Front\n\nStill indexed.\n")
        long_desc = "x" * 300
        self._write("long.md", f"# Long\n\n{long_desc}\n")
        kb.generate_index(self.project)
        text = self._index()
        self.assertIn("- [bare](bare.md) — just a paragraph, no heading", text)
        self.assertIn("- [Broken Front](broken.md) — Still indexed.", text)
        self.assertIn("…", text)
        self.assertNotIn(long_desc, text)

    def test_apostrophe_prose_indexes_at_declared_rank_warning_free(self):
        # ST-059 (PROP-022): the envelope-shaped regression — an unquoted
        # description holding a possessive indexes on its own frontmatter,
        # not on silent fallbacks.
        kb.standup_kb(self.project)
        self._write("envelope.md", (
            "---\n"
            "title: The Validator's Envelope\n"
            "description: the validator's accepted shape, pinned live\n"
            "rank: 30\n"
            "---\n"
            "# Body Heading\n\nBody paragraph.\n"
        ))
        self._write("other.md", "---\nrank: 40\ntitle: Other\n---\n# O\n\nText.\n")
        result = kb.generate_index(self.project)
        self.assertEqual(result["warnings"], [])
        lines = [l for l in self._index().splitlines() if l.startswith("- [")]
        self.assertEqual(lines[0], "- [The Validator's Envelope](envelope.md)"
                                   " — the validator's accepted shape, pinned live")

    def test_unclosed_fence_warns_loud(self):
        # ST-059 review chips: a fence that opens and never closes was the
        # surviving silent-mis-index shape — it now names itself.
        kb.standup_kb(self.project)
        self._write("unterm.md", "---\ntitle: Should Be Title\n")
        result = kb.generate_index(self.project)
        self.assertEqual(len(result["warnings"]), 1)
        self.assertIn("unterm.md", result["warnings"][0])
        self.assertIn("never closes", result["warnings"][0])

    def test_broken_frontmatter_warns_loud_and_falls_back(self):
        # ST-059 (PROP-022): the silence is the defect — a parse failure
        # names the file and the error in the result while the entry lands
        # on today's fallbacks.
        kb.standup_kb(self.project)
        self._write("broken.md", "---\na: {broken\n---\n# Broken Front\n\nStill indexed.\n")
        result = kb.generate_index(self.project)
        self.assertEqual(len(result["warnings"]), 1)
        self.assertIn("broken.md", result["warnings"][0])
        self.assertIn("frontmatter ignored", result["warnings"][0])
        self.assertIn("- [Broken Front](broken.md) — Still indexed.", self._index())

    def test_index_requires_kb(self):
        with self.assertRaises(kb.KbError):
            kb.generate_index(self.project)


class IndexTitleTests(KbTestCase):
    """DW-84: the index header names the project, not the checkout folder."""

    def _header(self, root: Path) -> str:
        return kb.index_path(root).read_text(encoding="utf-8").splitlines()[0]

    @staticmethod
    def _git_env() -> dict:
        """Host-independent git env: no inherited repo location, no
        system/global config (gpgsign, hooksPath, templateDir, ...)."""
        env = {k: v for k, v in os.environ.items()
               if k not in ("GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR",
                            "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
                            "GIT_ALTERNATE_OBJECT_DIRECTORIES",
                            "GIT_CEILING_DIRECTORIES", "GIT_CONFIG",
                            "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT",
                            "GIT_TEMPLATE_DIR")
               and not k.startswith(("GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_"))}
        env["GIT_CONFIG_NOSYSTEM"] = "1"
        env["GIT_CONFIG_GLOBAL"] = os.devnull
        return env

    def _git(self, *args, cwd: Path):
        subprocess.run(["git", "-c", "commit.gpgsign=false",
                        "-c", "core.hooksPath=" + os.devnull, *args],
                       cwd=cwd, check=True, env=self._git_env(),
                       capture_output=True, text=True, timeout=30)

    def _generate_isolated(self, root: Path) -> None:
        with mock.patch.dict(os.environ, self._git_env(), clear=True):
            kb.generate_index(root)

    def test_project_id_wins_over_folder_name(self):
        folder = Path(self._tmp.name) / "q-run-x"
        (folder / ".tk-studio").mkdir(parents=True)
        (folder / ".tk-studio" / "config.yaml").write_text(
            "project_id: alpha\n", encoding="utf-8")
        (folder / "kb").mkdir()
        kb.generate_index(folder)
        self.assertEqual(self._header(folder), "# alpha — knowledge base")

    @unittest.skipUnless(shutil.which("git"), "git unavailable")
    def test_linked_worktree_titles_after_main_repo(self):
        main = Path(self._tmp.name) / "tk-main"
        main.mkdir()
        self._git("init", "-q", cwd=main)
        self._git("config", "user.email", "test@example.com", cwd=main)
        self._git("config", "user.name", "Test", cwd=main)
        (main / "README.md").write_text("x\n", encoding="utf-8")
        self._git("add", "README.md", cwd=main)
        self._git("commit", "-q", "-m", "init", cwd=main)
        worktree = Path(self._tmp.name) / "q-run-x"
        self._git("worktree", "add", "-q", str(worktree), cwd=main)
        (worktree / "kb").mkdir()
        self._generate_isolated(worktree)
        self.assertEqual(self._header(worktree), "# tk-main — knowledge base")

    @unittest.skipUnless(shutil.which("git"), "git unavailable")
    def test_main_checkout_titles_after_repo_dir(self):
        self._git("init", "-q", cwd=self.project)
        (self.project / "kb").mkdir()
        self._generate_isolated(self.project)
        self.assertEqual(self._header(self.project), "# proj — knowledge base")

    @unittest.skipUnless(shutil.which("git"), "git unavailable")
    def test_project_nested_in_enclosing_repo_keeps_own_name(self):
        outer = Path(self._tmp.name) / "outer"
        outer.mkdir()
        self._git("init", "-q", cwd=outer)
        nested = outer / "games" / "foo"
        (nested / "kb").mkdir(parents=True)
        self._generate_isolated(nested)
        self.assertEqual(self._header(nested), "# foo — knowledge base")

    def test_non_dotgit_common_dir_falls_back_to_folder_name(self):
        # submodule: common dir is <super>/.git/modules/<name>
        (self.project / "kb").mkdir()
        common = Path(self._tmp.name) / "super" / ".git" / "modules" / "proj"
        out = f"{self.project}\n{common}\n"
        with mock.patch.object(kb.subprocess, "run",
                               return_value=subprocess.CompletedProcess(
                                   [], 0, stdout=out, stderr="")):
            kb.generate_index(self.project)
        self.assertEqual(self._header(self.project), "# proj — knowledge base")

    def test_dotgit_common_dir_names_main_repo(self):
        (self.project / "kb").mkdir()
        common = Path(self._tmp.name) / "tk-main" / ".git"
        out = f"{self.project}\n{common}\n"
        with mock.patch.object(kb.subprocess, "run",
                               return_value=subprocess.CompletedProcess(
                                   [], 0, stdout=out, stderr="")) as run:
            with mock.patch.dict(os.environ, {"GIT_DIR": "/elsewhere/.git",
                                              "GIT_WORK_TREE": "/elsewhere",
                                              "GIT_COMMON_DIR": "/elsewhere/.git"}):
                kb.generate_index(self.project)
        self.assertEqual(self._header(self.project), "# tk-main — knowledge base")
        env = run.call_args.kwargs["env"]
        for var in ("GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"):
            self.assertNotIn(var, env)

    def test_bare_dotgit_common_dir_names_main_repo(self):
        (self.project / "kb").mkdir()
        common = Path(self._tmp.name) / "repos" / "tk-main.git"
        out = f"{self.project}\n{common}\n"
        with mock.patch.object(kb.subprocess, "run",
                               return_value=subprocess.CompletedProcess(
                                   [], 0, stdout=out, stderr="")):
            kb.generate_index(self.project)
        self.assertEqual(self._header(self.project), "# tk-main — knowledge base")

    @unittest.skipUnless(shutil.which("git"), "git unavailable")
    def test_worktree_of_bare_repo_titles_after_repo(self):
        bare = Path(self._tmp.name) / "repos" / "tk-main.git"
        bare.mkdir(parents=True)
        self._git("init", "-q", "--bare", cwd=bare)
        seed = Path(self._tmp.name) / "seed"
        self._git("clone", "-q", str(bare), str(seed), cwd=Path(self._tmp.name))
        self._git("config", "user.email", "test@example.com", cwd=seed)
        self._git("config", "user.name", "Test", cwd=seed)
        (seed / "README.md").write_text("x\n", encoding="utf-8")
        self._git("add", "README.md", cwd=seed)
        self._git("commit", "-q", "-m", "init", cwd=seed)
        self._git("push", "-q", "origin", "HEAD", cwd=seed)
        worktree = Path(self._tmp.name) / "q-run-x"
        self._git("worktree", "add", "-q", str(worktree), "HEAD", cwd=bare)
        (worktree / "kb").mkdir()
        self._generate_isolated(worktree)
        self.assertEqual(self._header(worktree), "# tk-main — knowledge base")

    def test_non_git_folder_falls_back_to_folder_name(self):
        (self.project / "kb").mkdir()
        with mock.patch.object(kb.subprocess, "run",
                               return_value=subprocess.CompletedProcess(
                                   [], 128, stdout="", stderr="not a git repository")):
            kb.generate_index(self.project)
        self.assertEqual(self._header(self.project), "# proj — knowledge base")

    def test_git_missing_or_timeout_falls_back_to_folder_name(self):
        for exc in (FileNotFoundError("git"),
                    subprocess.TimeoutExpired(["git"], 10)):
            with self.subTest(exc=type(exc).__name__):
                (self.project / "kb").mkdir(exist_ok=True)
                with mock.patch.object(kb.subprocess, "run", side_effect=exc):
                    kb.generate_index(self.project)
                self.assertEqual(self._header(self.project),
                                 "# proj — knowledge base")


if __name__ == "__main__":
    unittest.main()
