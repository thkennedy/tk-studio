"""Tests for the Backlog.md projection backend (ST-3.4 acceptance criteria).

Native-format expectations here were captured from the real Backlog.md 1.48.0
CLI (the pinned version): task/milestone file shapes, and the verified fact
that `task edit` drops unknown frontmatter keys (hence native-keys+id-label).
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import backlogmd  # noqa: E402
import interchange  # noqa: E402
import plansync  # noqa: E402

from test_plansync import EPICS_DOC  # noqa: E402

RUNTIME = {"planning": {"backend": "backlog-md"}}


class BacklogTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        os.environ["TK_STUDIO_HOME"] = str(Path(self._tmp.name) / "store")
        self.root = Path(self._tmp.name) / "proj"
        planning = self.root / "_bmad-output" / "planning-artifacts"
        planning.mkdir(parents=True)
        (planning / "epics.md").write_text(EPICS_DOC, encoding="utf-8",
                                           newline="\n")

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()

    def _sync(self) -> dict:
        return plansync.sync(self.root, runtime=RUNTIME)

    def _canonical(self, entity_id: str) -> tuple[Path, dict, str]:
        path = plansync.plan_dir(self.root) / f"{entity_id}.md"
        front, body = interchange.parse_entity(path)
        return path, front, body

    def _set_canonical(self, entity_id: str, **updates):
        path, front, body = self._canonical(entity_id)
        front.update(updates)
        path.write_text(interchange.render_entity(front, body),
                        encoding="utf-8", newline="\n")

    def _task_file(self, entity_id: str) -> Path:
        _, front, _ = self._canonical(entity_id)
        key = front["external"]["backlog-md"]["key"]
        found = backlogmd._find_by_key(backlogmd.backlog_root(self.root),
                                       key, "tasks", "completed")
        assert found is not None, f"no task file for {entity_id} ({key})"
        return found


class PromoteTests(BacklogTestCase):
    def test_promote_projects_native_shapes(self):
        result = self._sync()
        self.assertTrue(result["ok"])
        self.assertEqual(result["projection"]["action"], "projected")
        backlog = backlogmd.backlog_root(self.root)
        self.assertTrue((backlog / "config.yml").is_file())
        milestones = sorted(p.name for p in (backlog / "milestones").glob("*.md"))
        self.assertEqual(milestones,
                         ["m-0 - First-Epic.md", "m-1 - Second-Epic.md"])
        task = self._task_file("ST-001")
        text = task.read_text(encoding="utf-8")
        self.assertIn("id: TASK-", text)
        self.assertIn("status: To Do", text)
        self.assertIn("- ST-001", text)          # canonical id rides as a label
        self.assertIn("milestone: First Epic", text)
        self.assertIn("<!-- SECTION:DESCRIPTION:BEGIN -->", text)
        self.assertIn("**Given** a thing", text)
        _, front, _ = self._canonical("ST-001")
        snapshot = front["external"]["backlog-md"]
        for key in ("key", "synced_at", "content_hash", "status",
                    "canonical_status"):
            self.assertIn(key, snapshot)
        self.assertEqual(snapshot["status"], "To Do")
        self.assertEqual(snapshot["canonical_status"], "draft")

    def test_second_sync_is_idempotent(self):
        self._sync()
        result = self._sync()
        self.assertTrue(result["ok"])
        self.assertEqual(result["projection"]["promote"]["written"], [])
        self.assertEqual(result["projection"]["pull_back"]["applied"], [])

    def test_epic_entities_are_milestones_not_tasks(self):
        self._sync()
        _, front, _ = self._canonical("EP-001")
        self.assertTrue(front["external"]["backlog-md"]["key"].startswith("m-"))
        tasks = list((backlogmd.backlog_root(self.root) / "tasks").glob("*.md"))
        self.assertEqual(len(tasks), 3)  # stories only

    def test_dropped_entity_is_not_projected(self):
        self._sync()
        self._set_canonical("ST-002", status="dropped")
        result = self._sync()
        notes = result["projection"]["promote"]["notes"]
        self.assertTrue(any("ST-002" in n and "dropped" in n for n in notes))

    def test_title_change_renames_projection_file(self):
        self._sync()
        old = self._task_file("ST-001")
        epics = self.root / "_bmad-output" / "planning-artifacts" / "epics.md"
        epics.write_text(EPICS_DOC.replace("### Story 1.1: Alpha Story",
                                           "### Story 1.1: Alpha Prime"),
                         encoding="utf-8", newline="\n")
        result = self._sync()
        self.assertTrue(result["ok"])
        new = self._task_file("ST-001")
        self.assertNotEqual(old.name, new.name)
        self.assertFalse(old.exists())
        self.assertIn("Alpha-Prime", new.name)


class RoundTripTests(BacklogTestCase):
    def test_unrepresentable_status_survives_round_trip(self):
        self._sync()
        self._set_canonical("ST-001", status="review")
        self._sync()
        task_text = self._task_file("ST-001").read_text(encoding="utf-8")
        self.assertIn("status: In Progress", task_text)  # coarse projection
        result = self._sync()  # no external change: the echo must not clobber
        self.assertTrue(result["ok"])
        self.assertEqual(result["projection"]["pull_back"]["applied"], [])
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["status"], "review")


class PullBackTests(BacklogTestCase):
    def _drag(self, entity_id: str, new_status: str):
        task = self._task_file(entity_id)
        text = task.read_text(encoding="utf-8")
        text = text.replace(f"status: {backlogmd.TO_BACKEND_STATUS['draft']}",
                            f"status: {new_status}", 1)
        task.write_text(text, encoding="utf-8", newline="\n")

    def test_kanban_drag_updates_canonical_status_only(self):
        self._sync()
        _, before, body_before = self._canonical("ST-001")
        self._drag("ST-001", "Done")
        result = self._sync()
        applied = result["projection"]["pull_back"]["applied"]
        self.assertEqual([a["id"] for a in applied], ["ST-001"])
        self.assertEqual(applied[0]["fields"], ["status"])
        _, front, body = self._canonical("ST-001")
        self.assertEqual(front["status"], "done")
        self.assertEqual(body, body_before)          # status-class only
        self.assertEqual(front["title"], before["title"])

    def test_assignee_pulls_back(self):
        self._sync()
        task = self._task_file("ST-001")
        text = task.read_text(encoding="utf-8").replace(
            "assignee: []", "assignee:\n  - tim", 1)
        task.write_text(text, encoding="utf-8", newline="\n")
        result = self._sync()
        applied = result["projection"]["pull_back"]["applied"]
        self.assertEqual(applied[0]["fields"], ["assignee"])
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["assignee"], "tim")

    def test_both_changed_is_a_conflict_never_resolved(self):
        self._sync()
        self._set_canonical("ST-001", status="blocked")
        self._drag("ST-001", "Done")
        result = self._sync()
        conflicts = result["projection"]["conflicts"]
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["id"], "ST-001")
        self.assertTrue(any("status" in f for f in conflicts[0]["fields"]))
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["status"], "blocked")  # untouched

    def test_drag_back_to_todo_maps_to_ready(self):
        self._sync()
        self._set_canonical("ST-001", status="in-progress")
        self._sync()
        task = self._task_file("ST-001")
        task.write_text(task.read_text(encoding="utf-8").replace(
            "status: In Progress", "status: To Do", 1),
            encoding="utf-8", newline="\n")
        self._sync()
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["status"], "ready")


if __name__ == "__main__":
    unittest.main()
