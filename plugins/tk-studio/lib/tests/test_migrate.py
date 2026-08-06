"""Tests for the designed migration local -> Jira (ST-8.2 acceptance
criteria, AD-16): closed inventory first, export -> transform -> import ->
verification, copy-then-verify-then-flag with the flag last, source retained
read-only until explicit operator clearance, and any mismatch halting
blocked with the discrepancy listed."""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import config as configlib  # noqa: E402
import jirabackend  # noqa: E402
import migrate  # noqa: E402
import plansync  # noqa: E402

from test_jirabackend import FakeJira  # noqa: E402
from test_plansync import EPICS_DOC  # noqa: E402

CONFIG = """\
# team config — this comment must survive the cutover surgery
vcs: git
planning:
  backend: backlog-md
  jira:
    site: example.atlassian.net
    project_key: TKS
"""


class LabelDroppingJira(FakeJira):
    """Sabotaged backend: silently loses labels on create — the spot
    round-trip verification must catch it."""

    def __call__(self, method, url, body):
        if method == "POST" and re.search(r"/issue$", url):
            body = {"fields": {**body["fields"], "labels": []}}
        return super().__call__(method, url, body)


class MigrateTestCase(unittest.TestCase):
    ENV_KEYS = ("TK_STUDIO_HOME", jirabackend.TOKEN_ENV, jirabackend.EMAIL_ENV)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._saved_env = {k: os.environ.get(k) for k in self.ENV_KEYS}
        os.environ["TK_STUDIO_HOME"] = str(Path(self._tmp.name) / "store")
        os.environ[jirabackend.TOKEN_ENV] = "fake-token"
        os.environ[jirabackend.EMAIL_ENV] = "tim@example.com"
        self.root = Path(self._tmp.name) / "proj"
        planning = self.root / "_bmad-output" / "planning-artifacts"
        planning.mkdir(parents=True)
        (planning / "epics.md").write_text(EPICS_DOC, encoding="utf-8",
                                           newline="\n")
        conf_dir = self.root / ".tk-studio"
        conf_dir.mkdir()
        (conf_dir / "config.yaml").write_text(CONFIG, encoding="utf-8",
                                              newline="\n")
        # a real backlog-md projection is the migration's source
        plansync.sync(self.root)
        self.fake = FakeJira()
        self.client = jirabackend.JiraClient(
            "example.atlassian.net", "tim@example.com", "fake-token",
            transport=self.fake)

    def tearDown(self):
        for key, value in self._saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self._tmp.cleanup()

    def _binding(self) -> str:
        value, _ = configlib.resolve("planning.backend",
                                     project_root=self.root)
        return value

    def _backlog_files(self) -> list[Path]:
        backlog = self.root / "backlog"
        return [p for p in backlog.rglob("*") if p.is_file()] \
            if backlog.is_dir() else []


class DryRunTests(MigrateTestCase):
    def test_dry_run_plans_without_backend_or_writes(self):
        result = migrate.run(self.root, dry_run=True, client=self.client)
        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "plan")
        self.assertEqual(len(result["import_plan"]["created"]), 5)
        self.assertEqual(result["inventory"]["canonical"], 5)
        self.assertGreater(result["inventory"]["source_files"], 0)
        self.assertEqual(self.fake.calls, [])
        self.assertFalse(migrate.record_path(self.root).exists())
        self.assertEqual(self._binding(), "backlog-md")


class RunTests(MigrateTestCase):
    def test_run_migrates_end_to_end_and_flags_last(self):
        result = migrate.run(self.root, client=self.client)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["action"], "migrated")
        self.assertEqual(result["counts"], {"expected": 5, "mapped": 5})
        self.assertEqual(sorted(result["id_map"]),
                         ["EP-001", "EP-002", "ST-001", "ST-002", "ST-003"])
        self.assertTrue(result["round_trip_sampled"])
        # the flag landed and the human-authored config bytes survived
        self.assertEqual(self._binding(), "jira")
        config_text = (self.root / ".tk-studio" / "config.yaml").read_text(
            encoding="utf-8")
        self.assertIn("# team config", config_text)
        self.assertIn("backend: jira", config_text)
        self.assertIn("project_key: TKS", config_text)
        # source retained read-only, never deleted at cutover
        files = self._backlog_files()
        self.assertTrue(files)
        self.assertTrue(all(not os.access(p, os.W_OK) for p in files))
        record = json.loads(migrate.record_path(self.root).read_text(
            encoding="utf-8"))
        self.assertEqual(record["status"], "migrated")
        self.assertEqual(record["source_binding"], "backlog-md")
        self.assertTrue(record["inventory"]["source_files"])

    def test_rerun_after_migration_is_a_clean_report(self):
        migrate.run(self.root, client=self.client)
        result = migrate.run(self.root, client=self.client)
        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "already-migrated")

    def test_verification_mismatch_halts_blocked_with_discrepancies(self):
        sabotaged = LabelDroppingJira()
        client = jirabackend.JiraClient(
            "example.atlassian.net", "tim@example.com", "fake-token",
            transport=sabotaged)
        result = migrate.run(self.root, client=client)
        self.assertTrue(result.get("blocked"))
        self.assertIn("verification failed", result["reason"])
        self.assertTrue(any("missing from labels" in d
                            for d in result["discrepancies"]))
        # no partial state reads as migrated: flag not written, source
        # untouched, record says blocked
        self.assertEqual(self._binding(), "backlog-md")
        self.assertTrue(all(os.access(p, os.W_OK)
                            for p in self._backlog_files()))
        record = json.loads(migrate.record_path(self.root).read_text(
            encoding="utf-8"))
        self.assertEqual(record["status"], "blocked")

    def test_empty_project_has_nothing_to_migrate(self):
        empty = Path(self._tmp.name) / "empty"
        empty.mkdir()
        result = migrate.run(empty, dry_run=True)
        self.assertTrue(result.get("blocked"))
        self.assertIn("nothing to migrate", result["reason"])


class ClearTests(MigrateTestCase):
    def test_clear_requires_explicit_operator_confirmation(self):
        migrate.run(self.root, client=self.client)
        result = migrate.clear(self.root, confirm=False)
        self.assertTrue(result.get("blocked"))
        self.assertIn("clearance", result["reason"])
        self.assertTrue(self._backlog_files())  # nothing deleted

    def test_clear_before_migration_is_blocked(self):
        result = migrate.clear(self.root, confirm=True)
        self.assertTrue(result.get("blocked"))
        self.assertIn("no migration record", result["reason"])

    def test_clear_deletes_only_the_closed_inventory(self):
        migrate.run(self.root, client=self.client)
        extra = self.root / "backlog" / "drafts" / "not-inventoried.md"
        extra.parent.mkdir(parents=True, exist_ok=True)
        extra.write_text("added after inventory\n", encoding="utf-8")
        result = migrate.clear(self.root, confirm=True)
        self.assertTrue(result["ok"], result)
        self.assertTrue(result["deleted"])
        self.assertTrue(extra.exists())  # not on the inventory: never deleted
        self.assertIn("backlog/drafts/not-inventoried.md",
                      result["leftovers"])
        record = json.loads(migrate.record_path(self.root).read_text(
            encoding="utf-8"))
        self.assertTrue(record["source"]["cleared"])

    def test_clear_twice_reports_already_cleared(self):
        migrate.run(self.root, client=self.client)
        migrate.clear(self.root, confirm=True)
        result = migrate.clear(self.root, confirm=True)
        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "already-cleared")


class StatusTests(MigrateTestCase):
    def test_status_before_and_after(self):
        before = migrate.status(self.root)
        self.assertTrue(before["ok"])
        self.assertFalse(before["migrated"])
        self.assertIsNone(before["record"])
        migrate.run(self.root, client=self.client)
        after = migrate.status(self.root)
        self.assertTrue(after["migrated"])
        self.assertEqual(after["counts"], {"expected": 5, "mapped": 5})
        self.assertFalse(after["source_cleared"])


if __name__ == "__main__":
    unittest.main()
