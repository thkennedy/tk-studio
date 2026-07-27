"""Tests for evolve observe-and-log (ST-4.4 acceptance criteria).

An observation lands in the measurement ledger with source, project, and a
structured description — and triggers nothing else (v1 boundary, AD-8).
"""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ledger  # noqa: E402
import observe  # noqa: E402


class ObserveTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        self.store = Path(self._tmp.name) / "store"
        os.environ["TK_STUDIO_HOME"] = str(self.store)

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()

    def _ledger_lines(self) -> list[dict]:
        path = ledger.ledger_path()
        if not path.is_file():
            return []
        return [json.loads(line) for line
                in path.read_text(encoding="utf-8").splitlines() if line]

    def test_observation_lands_with_source_project_description(self):
        observe.record_observation(
            "repeated-manual-work",
            "renumbering story ids by hand after every merge",
            evidence="session 2026-07-27, three times this week",
            project="tk-studio")
        lines = self._ledger_lines()
        self.assertEqual(len(lines), 1)
        event = lines[0]
        self.assertEqual(event["event"], "observation")
        self.assertEqual(event["project"], "tk-studio")
        self.assertEqual(event["payload"]["source"], "repeated-manual-work")
        self.assertIn("renumbering story ids", event["payload"]["description"])
        self.assertIn("evidence", event["payload"])

    def test_no_automated_follow_on(self):
        """Recording triggers nothing: the ledger line is the only artifact."""
        observe.record_observation("retrospective", "epic 3 retro: sync verb "
                                   "ordering confused two operators")
        store_files = [p for p in self.store.rglob("*") if p.is_file()]
        self.assertEqual([p.name for p in store_files
                          if p.suffix == ".jsonl"],
                         [ledger.ledger_path().name])
        # nothing project-side, nothing proposal-shaped anywhere in the store
        self.assertFalse([p for p in store_files
                          if "proposal" in p.name or "draft" in p.name])

    def test_invalid_source_and_empty_description_refused(self):
        with self.assertRaises(ledger.LedgerError):
            observe.record_observation("vibes", "something felt slow")
        with self.assertRaises(ledger.LedgerError):
            observe.record_observation("retrospective", "   ")
        self.assertEqual(self._ledger_lines(), [])

    def test_cli_record(self):
        import contextlib
        import io
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = observe.main(["record", "--source", "research-job",
                                 "--description", "Backlog.md 1.49 changes task layout",
                                 "--project", "tk-studio"])
        self.assertEqual(code, 0)
        out = json.loads(stdout.getvalue())
        self.assertTrue(out["ok"])
        self.assertEqual(out["envelope"]["payload"]["source"], "research-job")
        self.assertEqual(len(self._ledger_lines()), 1)

    def test_sanitization_applies_at_emission(self):
        observe.record_observation(
            "other", "token leaked in output: api_key=sk-ant-abcdef0123456789")
        event = self._ledger_lines()[0]
        self.assertNotIn("sk-ant-", json.dumps(event))


if __name__ == "__main__":
    unittest.main()
