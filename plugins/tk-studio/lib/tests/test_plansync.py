"""Tests for the planning adapter: normalize + id authority (ST-3.2) and the
bmad-files fallback sync verb (ST-3.3)."""
from __future__ import annotations

import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import interchange  # noqa: E402
import miniyaml  # noqa: E402
import plansync  # noqa: E402

EPICS_DOC = """---
stepsCompleted: [1, 2]
status: complete
---

# demo - Epic Breakdown

## Overview

Intro text the adapter must never touch.

## Epic List

### Epic 1: First Epic
Summary line (h3 in the list section — not an entity heading).

## Epic 1: First Epic

Epic one intro.

### Story 1.1: Alpha Story

As a user,
I want alpha,
So that value.

**Acceptance Criteria:**

**Given** a thing
**When** it runs
**Then** it works

### Story 1.2: Beta Story

Body beta.

## Epic 2: Second Epic

Epic two intro.

### Story 2.1: Gamma Story

Body gamma.

## Cross-Epic Notes

Tail text.
"""


class PlanSyncTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / "proj"
        self.planning = self.root / "_bmad-output" / "planning-artifacts"
        self.impl = self.root / "_bmad-output" / "implementation-artifacts"
        self.planning.mkdir(parents=True)
        self.epics = self.planning / "epics.md"
        self.epics.write_text(EPICS_DOC, encoding="utf-8", newline="\n")

    def tearDown(self):
        self._tmp.cleanup()

    def _plan_file(self, entity_id: str) -> Path:
        return plansync.plan_dir(self.root) / f"{entity_id}.md"

    def _front(self, entity_id: str) -> dict:
        front, _ = interchange.parse_entity(self._plan_file(entity_id))
        return front


class ParseTests(PlanSyncTestCase):
    def test_sections_in_document_order(self):
        sections = plansync.parse_epics_doc(EPICS_DOC)
        self.assertEqual([s["key"] for s in sections],
                         ["epic-1", "story-1.1", "story-1.2",
                          "epic-2", "story-2.1"])
        self.assertEqual(sections[0]["title"], "First Epic")
        self.assertEqual(sections[0]["body"], "Epic one intro.")
        self.assertIn("**Given** a thing", sections[1]["body"])
        self.assertEqual(sections[3]["body"], "Epic two intro.")


class NormalizeTests(PlanSyncTestCase):
    def test_first_run_derives_canonical_files(self):
        result = plansync.normalize(self.root)
        self.assertTrue(result["ok"])
        self.assertEqual(result["actions"], {"created": 5, "repaired": 0,
                                             "unchanged": 0})
        self.assertEqual(result["minted"],
                         ["EP-001", "ST-001", "ST-002", "EP-002", "ST-003"])
        front = self._front("ST-001")
        self.assertEqual(front["type"], "story")
        self.assertEqual(front["title"], "Alpha Story")
        self.assertEqual(front["status"], "draft")
        self.assertEqual(front["parent"], "EP-001")
        self.assertEqual(front["source"], "epics.md#story-1.1")
        _, body = interchange.parse_entity(self._plan_file("ST-001"))
        self.assertIn("**Given** a thing", body)
        counter = miniyaml.load(plansync.counter_path(self.root))
        self.assertEqual(counter["next"], {"epic": 3, "story": 4, "task": 1})

    def test_epics_md_is_never_touched(self):
        before = self.epics.read_bytes()
        plansync.normalize(self.root)
        self.assertEqual(self.epics.read_bytes(), before)

    def test_second_run_is_idempotent(self):
        plansync.normalize(self.root)
        counter_before = plansync.counter_path(self.root).read_text(encoding="utf-8")
        files_before = {p: p.read_bytes()
                        for p in plansync.plan_dir(self.root).glob("*.md")}
        result = plansync.normalize(self.root)
        self.assertTrue(result["ok"])
        self.assertEqual(result["actions"]["created"], 0)
        self.assertEqual(result["actions"]["repaired"], 0)
        self.assertEqual(result["actions"]["unchanged"], 5)
        self.assertEqual(result["minted"], [])
        self.assertEqual(plansync.counter_path(self.root).read_text(encoding="utf-8"),
                         counter_before)
        for path, content in files_before.items():
            self.assertEqual(path.read_bytes(), content)

    def test_upstream_edit_repairs_but_keeps_id_and_status(self):
        plansync.normalize(self.root)
        path = self._plan_file("ST-001")
        front, body = interchange.parse_entity(path)
        front["status"] = "in-progress"
        path.write_text(interchange.render_entity(front, body),
                        encoding="utf-8", newline="\n")
        self.epics.write_text(
            EPICS_DOC.replace("### Story 1.1: Alpha Story",
                              "### Story 1.1: Alpha Story Renamed"),
            encoding="utf-8", newline="\n")
        result = plansync.normalize(self.root)
        self.assertTrue(result["ok"])
        self.assertEqual(result["minted"], [])
        front = self._front("ST-001")
        self.assertEqual(front["title"], "Alpha Story Renamed")
        self.assertEqual(front["status"], "in-progress")

    def test_new_story_gets_next_id_only(self):
        plansync.normalize(self.root)
        self.epics.write_text(
            EPICS_DOC.replace("## Cross-Epic Notes",
                              "### Story 2.2: Delta Story\n\nBody delta.\n\n"
                              "## Cross-Epic Notes"),
            encoding="utf-8", newline="\n")
        result = plansync.normalize(self.root)
        self.assertTrue(result["ok"])
        self.assertEqual(result["minted"], ["ST-004"])
        self.assertEqual(self._front("ST-004")["parent"], "EP-002")

    def test_counter_behind_skips_taken_ids(self):
        plansync.normalize(self.root)
        counter = miniyaml.load(plansync.counter_path(self.root))
        counter["next"]["story"] = 1
        miniyaml.dump(counter, plansync.counter_path(self.root))
        self.epics.write_text(
            EPICS_DOC.replace("## Cross-Epic Notes",
                              "### Story 2.2: Delta Story\n\nBody delta.\n\n"
                              "## Cross-Epic Notes"),
            encoding="utf-8", newline="\n")
        result = plansync.normalize(self.root)
        self.assertTrue(result["ok"])
        self.assertEqual(result["minted"], ["ST-004"])
        self.assertTrue(any("never reused" in n for n in result["notes"]))

    def test_duplicate_id_blocks_naming_both_paths(self):
        plansync.normalize(self.root)
        source = self._plan_file("ST-001")
        dup = plansync.plan_dir(self.root) / "dup.md"
        shutil.copy(source, dup)
        result = plansync.normalize(self.root)
        self.assertFalse(result["ok"])
        self.assertTrue(result["blocked"])
        joined = " ".join(result["errors"])
        self.assertIn("duplicate id ST-001", joined)
        self.assertIn(str(source), joined)
        self.assertIn(str(dup), joined)

    def test_invalid_present_value_blocks_without_writing(self):
        plansync.normalize(self.root)
        path = self._plan_file("ST-001")
        path.write_text(path.read_text(encoding="utf-8")
                        .replace("status: draft", "status: bogus"),
                        encoding="utf-8", newline="\n")
        self.epics.write_text(
            EPICS_DOC.replace("## Cross-Epic Notes",
                              "### Story 2.2: Delta Story\n\nBody delta.\n\n"
                              "## Cross-Epic Notes"),
            encoding="utf-8", newline="\n")
        result = plansync.normalize(self.root)
        self.assertFalse(result["ok"])
        self.assertTrue(result["blocked"])
        self.assertTrue(any("status" in e for e in result["errors"]))
        self.assertFalse(self._plan_file("ST-004").exists())

    def test_dry_run_writes_nothing(self):
        result = plansync.normalize(self.root, dry_run=True)
        self.assertTrue(result["dry_run"])
        self.assertEqual(result["actions"]["created"], 5)
        self.assertFalse(plansync.plan_dir(self.root).exists())
        self.assertFalse(plansync.counter_path(self.root).exists())


class StoryFileTests(PlanSyncTestCase):
    def test_story_file_stamped_in_place_preserving_bytes(self):
        self.impl.mkdir(parents=True)
        story = self.impl / "story-1.1.md"
        story.write_text("---\nstatus: in-progress\n"
                         "# upstream comment that must survive\n"
                         "epic: 1\n---\n\n# Story 1.1\n\nDev notes.\n",
                         encoding="utf-8", newline="\n")
        result = plansync.normalize(self.root)
        self.assertTrue(result["ok"])
        stamped = story.read_text(encoding="utf-8")
        self.assertIn("canonical_id: ST-001", stamped)
        self.assertIn("# upstream comment that must survive", stamped)
        self.assertIn("status: in-progress", stamped)
        rerun = plansync.normalize(self.root)
        self.assertEqual(rerun["story_file_stamps"][0]["action"], "unchanged")

    def test_unmatched_story_file_is_noted_not_stamped(self):
        self.impl.mkdir(parents=True)
        stray = self.impl / "story-9.9.md"
        stray.write_text("---\nstatus: draft\n---\nbody\n",
                         encoding="utf-8", newline="\n")
        result = plansync.normalize(self.root)
        self.assertTrue(result["ok"])
        self.assertNotIn("canonical_id", stray.read_text(encoding="utf-8"))
        self.assertTrue(any("story-9.9.md" in n for n in result["notes"]))


class WrittenTests(PlanSyncTestCase):
    """EP-017 (PROP-020): the result names every file the run wrote —
    counter included — so commit staging derives from the response alone."""

    def test_mint_run_names_counter_and_created_files(self):
        result = plansync.normalize(self.root)
        self.assertTrue(result["ok"])
        counter = str(plansync.counter_path(self.root))
        self.assertEqual(result["counter"], {"path": counter, "written": True})
        expected = [counter] + [
            str(self._plan_file(i))
            for i in ("EP-001", "ST-001", "ST-002", "EP-002", "ST-003")]
        self.assertEqual(result["written"], expected)

    def test_rerun_reports_nothing_written(self):
        plansync.normalize(self.root)
        result = plansync.normalize(self.root)
        self.assertTrue(result["ok"])
        self.assertFalse(result["counter"]["written"])
        self.assertEqual(result["written"], [])

    def test_dry_run_names_would_writes_without_landing(self):
        result = plansync.normalize(self.root, dry_run=True)
        self.assertTrue(result["dry_run"])
        self.assertTrue(result["counter"]["written"])
        self.assertEqual(len(result["written"]), 6)
        self.assertFalse(plansync.plan_dir(self.root).exists())
        self.assertFalse(plansync.counter_path(self.root).exists())

    def test_stamped_story_file_is_named(self):
        self.impl.mkdir(parents=True)
        story = self.impl / "story-1.1.md"
        story.write_text("---\nstatus: draft\n---\n\nDev notes.\n",
                         encoding="utf-8", newline="\n")
        result = plansync.normalize(self.root)
        self.assertIn(str(story), result["written"])
        rerun = plansync.normalize(self.root)
        self.assertNotIn(str(story), rerun["written"])

    def test_projection_written_collects_adapter_shapes(self):
        # pull-back applied entries carry path (both adapters); backlog-md
        # promote reports written; jira promote entries carry path.
        projection = {
            "pull_back": {"applied": [
                {"id": "ST-001", "fields": ["status"], "path": "plan/ST-001.md"}]},
            "promote": {
                "written": ["backlog/tasks/task-1.md"],
                "created": [{"id": "EP-001", "key": "TK-1",
                             "path": "plan/EP-001.md"}],
                "updated": [{"id": "ST-001", "key": "TK-2"}]},
        }
        self.assertEqual(
            plansync._projection_written(projection),
            ["plan/ST-001.md", "backlog/tasks/task-1.md", "plan/EP-001.md"])
        self.assertEqual(plansync._projection_written({"action": "none"}), [])


class SprintStatusTests(PlanSyncTestCase):
    def test_sprint_status_pulls_mapped_states(self):
        self.impl.mkdir(parents=True)
        (self.impl / "sprint-status.yaml").write_text(
            "development-status:\n  1-1: done\n  1-2: ready-for-dev\n"
            "  2-1: weird-state\n",
            encoding="utf-8", newline="\n")
        result = plansync.normalize(self.root)
        self.assertTrue(result["ok"])
        self.assertEqual(self._front("ST-001")["status"], "done")
        self.assertEqual(self._front("ST-002")["status"], "ready")
        self.assertEqual(self._front("ST-003")["status"], "draft")
        self.assertTrue(any("weird-state" in n for n in result["notes"]))


class SyncTests(PlanSyncTestCase):
    """ST-3.3: bmad-files fallback — no projection, first-class, not an error."""

    def setUp(self):
        super().setUp()
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        os.environ["TK_STUDIO_HOME"] = str(Path(self._tmp.name) / "store")
        conf_dir = self.root / ".tk-studio"
        conf_dir.mkdir(parents=True, exist_ok=True)
        (conf_dir / "config.yaml").write_text(
            "planning:\n  backend: bmad-files\n",
            encoding="utf-8", newline="\n")

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        super().tearDown()

    def _index_text(self) -> str:
        return (plansync.plan_dir(self.root) / "index.md").read_text(encoding="utf-8")

    def test_sync_is_clean_with_no_op_projection(self):
        result = plansync.sync(self.root)
        self.assertTrue(result["ok"])
        self.assertEqual(result["binding"], "bmad-files")
        self.assertEqual(result["binding_scope"], "project-tracked")
        self.assertEqual(result["projection"]["action"], "none")
        self.assertNotIn("blocked", result)
        text = self._index_text()
        self.assertIn(plansync.GENERATED_MARKER, text)
        self.assertIn("[`ST-001`](ST-001.md)", text)
        self.assertIn("## EP-001 — First Epic", text)

    def test_second_sync_is_idempotent(self):
        plansync.sync(self.root)
        result = plansync.sync(self.root)
        self.assertTrue(result["ok"])
        self.assertFalse(result["index"]["changed"])
        self.assertEqual(result["normalize"]["actions"]["unchanged"], 5)
        self.assertEqual(result["written"], [])

    def test_sync_written_rolls_up_normalize_and_index(self):
        # EP-017: the sync-level written[] carries normalize's writes plus
        # the regenerated index; bmad-files projection names no files.
        result = plansync.sync(self.root)
        self.assertTrue(result["ok"])
        self.assertEqual(
            result["written"],
            result["normalize"]["written"] + [result["index"]["index"]])
        self.assertEqual(result["removed"], [])

    def test_backlog_sync_names_snapshot_rewrites(self):
        # EP-017 review chip: promote rewrites each projected entity's
        # canonical file (external snapshot) — written[] must carry both
        # sides or staging misses half the sync.
        runtime = {"planning": {"backend": "backlog-md"}}
        result = plansync.sync(self.root, runtime=runtime)
        self.assertTrue(result["ok"])
        written = result["written"]
        self.assertTrue(any(os.sep + "backlog" + os.sep in p for p in written))
        for entity_id in ("EP-001", "ST-001", "ST-002", "EP-002", "ST-003"):
            self.assertIn(str(self._plan_file(entity_id)), written)
        self.assertEqual(result["removed"], [])
        rerun = plansync.sync(self.root, runtime=runtime)
        self.assertEqual(rerun["written"], [])
        self.assertEqual(rerun["removed"], [])

    def test_projection_rename_names_removed_file(self):
        runtime = {"planning": {"backend": "backlog-md"}}
        plansync.sync(self.root, runtime=runtime)
        self.epics.write_text(
            self.epics.read_text(encoding="utf-8").replace(
                "Story 1.1: Alpha Story", "Story 1.1: Alpha Prime Story"),
            encoding="utf-8", newline="\n")
        result = plansync.sync(self.root, runtime=runtime)
        self.assertTrue(result["ok"])
        self.assertTrue(any("Alpha-Story" in p for p in result["removed"]))
        self.assertTrue(any("Alpha-Prime-Story" in p
                            for p in result["written"]))

    def test_binding_decides_projection_only(self):
        first = plansync.sync(self.root)
        index_after_bmad = self._index_text()
        second = plansync.sync(self.root,
                               runtime={"planning": {"backend": "jira"}})
        self.assertEqual(second["binding"], "jira")
        self.assertTrue(second.get("blocked"))
        self.assertEqual(second["normalize"]["actions"],
                         {"created": 0, "repaired": 0, "unchanged": 5})
        self.assertEqual(self._index_text(), index_after_bmad)
        self.assertEqual(first["normalize"]["validation"],
                         second["normalize"]["validation"])

    def test_studio_default_binding_resolves(self):
        (self.root / ".tk-studio" / "config.yaml").write_text(
            "# no planning key\n", encoding="utf-8", newline="\n")
        result = plansync.sync(self.root)
        self.assertEqual(result["binding"], "backlog-md")
        self.assertEqual(result["binding_scope"], "studio")

    def test_foreign_index_is_refused(self):
        plansync.sync(self.root)
        index = plansync.plan_dir(self.root) / "index.md"
        index.write_text("# hand-authored board\n", encoding="utf-8")
        with self.assertRaises(plansync.PlanSyncError):
            plansync.sync(self.root)
        self.assertEqual(index.read_text(encoding="utf-8"),
                         "# hand-authored board\n")

    def test_normalize_block_propagates_through_sync(self):
        plansync.sync(self.root)
        source = plansync.plan_dir(self.root) / "ST-001.md"
        shutil.copy(source, plansync.plan_dir(self.root) / "dup.md")
        result = plansync.sync(self.root)
        self.assertFalse(result["ok"])
        self.assertTrue(result["blocked"])
        self.assertIn("duplicate", result["reason"])

    def test_sync_cli(self):
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = plansync.main(["sync", "--directory", str(self.root)])
        self.assertEqual(code, 0)
        out = json.loads(buffer.getvalue())
        self.assertTrue(out["ok"])
        self.assertEqual(out["projection"]["action"], "none")


class CliTests(PlanSyncTestCase):
    def _run(self, *argv) -> tuple[int, dict]:
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = plansync.main(list(argv))
        return code, json.loads(buffer.getvalue())

    def test_normalize_and_validate_cli(self):
        code, out = self._run("normalize", "--directory", str(self.root))
        self.assertEqual(code, 0)
        self.assertTrue(out["ok"])
        code, out = self._run("validate", "--directory", str(self.root))
        self.assertEqual(code, 0)
        self.assertEqual(out["entities"], 5)

    def test_blocked_normalize_exits_2(self):
        self._run("normalize", "--directory", str(self.root))
        source = plansync.plan_dir(self.root) / "ST-001.md"
        shutil.copy(source, plansync.plan_dir(self.root) / "dup.md")
        code, out = self._run("normalize", "--directory", str(self.root))
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])


if __name__ == "__main__":
    unittest.main()
