"""Tests for the agent-first knowledge base (ST-2.4 acceptance criteria)."""
from __future__ import annotations

import sys
import tempfile
import unittest
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

    def test_index_requires_kb(self):
        with self.assertRaises(kb.KbError):
            kb.generate_index(self.project)


if __name__ == "__main__":
    unittest.main()
