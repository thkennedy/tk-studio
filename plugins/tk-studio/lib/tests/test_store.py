"""Tests for per-user store standup (ST-2.1 acceptance criteria)."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ledger  # noqa: E402
import store  # noqa: E402


class StoreTestCase(unittest.TestCase):
    """Every test runs against a throwaway TK_STUDIO_HOME."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / ".tk-studio"
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        os.environ["TK_STUDIO_HOME"] = str(self.root)

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()


class FreshStandupTests(StoreTestCase):
    def test_skeleton_created_at_resolved_root(self):
        result = store.ensure_store()
        self.assertTrue(result["complete"])
        for name in store.STORE_DIRS:
            self.assertTrue((self.root / name).is_dir(), name)
        self.assertTrue((self.root / "config.yaml").is_file())

    def test_config_records_identity_with_developer_default(self):
        store.ensure_store()
        config = store.read_config()
        self.assertEqual(config["user_name"], store.safe_name(__import__("getpass").getuser()))
        self.assertEqual(config["role"], "developer")
        self.assertTrue(config["machine_id"])
        self.assertNotIn("obsidian_vault", config)  # optional, commented placeholder only
        text = (self.root / "config.yaml").read_text(encoding="utf-8")
        self.assertIn("# obsidian_vault:", text)

    def test_check_reports_missing_then_complete(self):
        self.assertFalse(store.check_store()["complete"])
        store.ensure_store()
        check = store.check_store()
        self.assertTrue(check["complete"])
        self.assertEqual(check["missing_dirs"], [])
        self.assertEqual(check["missing_config_keys"], [])


class IdempotenceTests(StoreTestCase):
    def test_second_run_touches_nothing(self):
        store.ensure_store()
        before = (self.root / "config.yaml").read_bytes()
        result = store.ensure_store()
        self.assertEqual(result["created"], [])
        self.assertEqual(result["appended_keys"], [])
        self.assertEqual((self.root / "config.yaml").read_bytes(), before)

    def test_existing_measurements_preserved(self):
        # Tim's real-store scenario: measurements/ with a ledger already exists.
        measurements = self.root / "measurements"
        measurements.mkdir(parents=True)
        ledger_file = measurements / "tim-Tim-PC.jsonl"
        ledger_file.write_text('{"event":"observation"}\n', encoding="utf-8")
        result = store.ensure_store()
        self.assertTrue(result["complete"])
        self.assertNotIn("measurements", result["created"])
        self.assertEqual(ledger_file.read_text(encoding="utf-8"),
                         '{"event":"observation"}\n')

    def test_missing_keys_appended_comments_preserved(self):
        self.root.mkdir(parents=True)
        config = self.root / "config.yaml"
        config.write_text("# my precious comment\nuser_name: custom-name\n",
                          encoding="utf-8")
        result = store.ensure_store()
        self.assertEqual(result["appended_keys"], ["role", "machine_id"])
        text = config.read_text(encoding="utf-8")
        self.assertIn("# my precious comment", text)
        parsed = store.read_config()
        self.assertEqual(parsed["user_name"], "custom-name")  # never overwritten
        self.assertEqual(parsed["role"], "developer")
        self.assertTrue(parsed["machine_id"])

    def test_complete_config_with_extras_untouched(self):
        self.root.mkdir(parents=True)
        config = self.root / "config.yaml"
        content = ("user_name: tim\nrole: direction-giver\nmachine_id: box\n"
                   "obsidian_vault: D:/vault\ncustom_key: kept\n")
        config.write_text(content, encoding="utf-8")
        store.ensure_store()
        self.assertEqual(config.read_text(encoding="utf-8"), content)
        self.assertEqual(store.read_config()["role"], "direction-giver")

    def test_unparseable_config_reported_never_rewritten(self):
        self.root.mkdir(parents=True)
        config = self.root / "config.yaml"
        config.write_text("a: {broken flow\n", encoding="utf-8")
        result = store.ensure_store()
        self.assertFalse(result["complete"])
        self.assertEqual(config.read_text(encoding="utf-8"), "a: {broken flow\n")
        self.assertIsNotNone(store.check_store()["config_error"])


class SurfaceWiringTests(StoreTestCase):
    def test_first_ledger_emit_stands_up_store(self):
        # "When any studio surface first needs the store" — the ledger is the
        # shared write path every surface already goes through.
        ledger.emit("observation", {"source": "research-job", "description": "x"})
        self.assertTrue(store.check_store()["complete"])

    def test_store_root_single_authority(self):
        self.assertEqual(ledger.store_root(), store.store_root())


class CliTests(StoreTestCase):
    def test_standup_then_check_exit_codes(self):
        import contextlib
        import io

        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(store.main(["check"]), 1)
            self.assertEqual(store.main(["standup"]), 0)
            self.assertEqual(store.main(["check"]), 0)
            self.assertEqual(store.main(["standup"]), 0)


if __name__ == "__main__":
    unittest.main()
