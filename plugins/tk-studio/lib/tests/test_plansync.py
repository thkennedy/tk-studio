"""Tests for the planning adapter: normalize + id authority (ST-3.2) and the
bmad-files fallback sync verb (ST-3.3)."""
from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dwledger  # noqa: E402
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


class StatusTests(PlanSyncTestCase):
    """Story 26.5: the driver's status pull-back verb (AD-5 status-class)."""

    def setUp(self):
        super().setUp()
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        os.environ["TK_STUDIO_HOME"] = str(Path(self._tmp.name) / "store")
        self._bind("bmad-files")
        self.assertTrue(plansync.sync(self.root)["ok"])

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        super().tearDown()

    def _bind(self, backend: str) -> None:
        conf_dir = self.root / ".tk-studio"
        conf_dir.mkdir(parents=True, exist_ok=True)
        (conf_dir / "config.yaml").write_text(
            f"planning:\n  backend: {backend}\n",
            encoding="utf-8", newline="\n")

    def _snapshot_tree(self, root: Path) -> dict:
        return {str(p.relative_to(root)): p.read_bytes()
                for p in sorted(root.rglob("*")) if p.is_file()}

    def _index_text(self) -> str:
        return (plansync.plan_dir(self.root) / "index.md").read_text(encoding="utf-8")

    def _assert_refused(self, message: str, **kwargs) -> None:
        before = self._snapshot_tree(self.root)
        args = {"story_id": "ST-001", "status": "review"}
        args.update(kwargs)
        with self.assertRaises(plansync.PlanSyncError) as ctx:
            plansync.status_pull_back(self.root, **args)
        self.assertIn(message, str(ctx.exception))
        self.assertEqual(self._snapshot_tree(self.root), before)

    def test_happy_path_sets_status_snapshot_and_resyncs(self):
        result = plansync.status_pull_back(self.root, "ST-001", "review",
                                           note="PR #4")
        self.assertTrue(result["ok"])
        self.assertNotIn("blocked", result)
        front = self._front("ST-001")
        self.assertEqual(front["status"], "review")
        snap = front["external"]["driver"]
        self.assertEqual(snap, {
            "key": "tk-studio-plan-sync",
            "synced_at": front["updated"],
            "content_hash": backlogmd_hash("ST-001", "review", "PR #4"),
            "caller": "tk-studio-plan-sync", "status": "review",
            "note": "PR #4", "previous_status": "draft"})
        self.assertEqual(result["previous_status"], "draft")
        self.assertEqual(result["path"], str(self._plan_file("ST-001")))
        self.assertEqual(result["plan_dir"],
                         str(plansync.plan_dir(self.root.resolve())))
        index = str(plansync.plan_dir(self.root.resolve()) / "index.md")
        self.assertEqual(result["written"], [result["path"], index])
        self.assertEqual(result["removed"], [])
        self.assertTrue(result["sync"]["ok"])
        self.assertIn("[`ST-001`](ST-001.md) Alpha Story — `review`",
                      self._index_text())
        self.assertEqual(interchange.validate_directory(
            self.root / "_bmad-output")["ok"], True)

    def test_every_canonical_status_is_accepted(self):
        self.assertEqual(interchange.STATUS_VALUES,
                         ("draft", "ready", "in-progress", "blocked",
                          "review", "done", "dropped"))
        for value in interchange.STATUS_VALUES:
            result = plansync.status_pull_back(self.root, "ST-002", value)
            self.assertTrue(result["ok"], value)
            self.assertEqual(self._front("ST-002")["status"], value)

    def test_unchanged_status_still_writes(self):
        first = plansync.status_pull_back(self.root, "ST-001", "review")
        snap_first = self._front("ST-001")["external"]["driver"]
        second = plansync.status_pull_back(self.root, "ST-001", "review",
                                           caller="supervisor")
        self.assertIn(second["path"], second["written"])
        self.assertEqual(first["status"], second["status"])
        snap = self._front("ST-001")["external"]["driver"]
        self.assertEqual(snap["previous_status"], "review")
        self.assertEqual(snap["key"], "supervisor")
        self.assertEqual(snap["caller"], "supervisor")
        self.assertNotEqual(snap, snap_first)

    def test_no_note_snapshot_note_is_empty(self):
        plansync.status_pull_back(self.root, "ST-001", "ready")
        snap = self._front("ST-001")["external"]["driver"]
        self.assertEqual(snap["note"], "")
        self.assertEqual(snap["content_hash"],
                         backlogmd_hash("ST-001", "ready", ""))

    def test_duplicate_id_refuses_before_any_write(self):
        original = self._plan_file("ST-001")
        dup_dir = self.root / "_bmad-output" / "stray"
        dup_dir.mkdir(parents=True)
        (dup_dir / "ST-001-copy.md").write_bytes(original.read_bytes())
        self._assert_refused(
            "duplicate ids block sync until renumbered (AD-4): ")
        with self.assertRaises(plansync.PlanSyncError) as ctx:
            plansync.status_pull_back(self.root, "ST-001", "review")
        self.assertIn("ST-001", str(ctx.exception))

    def test_outside_enum_refuses_nothing_written(self):
        self._assert_refused(
            "status 'merged' is not in the canonical enum (draft, ready, "
            "in-progress, blocked, review, done, dropped)", status="merged")

    def test_unknown_id_refuses(self):
        plan = plansync.plan_dir(self.root.resolve())
        self._assert_refused(f"unknown id ST-999: no canonical entity in {plan}",
                             story_id="ST-999")

    def test_unknown_id_refuses_when_plan_dir_absent(self):
        empty = Path(self._tmp.name) / "empty"
        empty.mkdir()
        with self.assertRaises(plansync.PlanSyncError) as ctx:
            plansync.status_pull_back(empty, "ST-001", "review")
        self.assertIn("unknown id ST-001: no canonical entity in", str(ctx.exception))
        self.assertEqual(list(empty.rglob("*")), [])

    def test_epic_id_refuses(self):
        self._assert_refused(
            "EP-001 is a epic, not a story — status takes a story id",
            story_id="EP-001")

    def test_blank_caller_refuses(self):
        self._assert_refused("caller must be a non-empty string", caller="  ")

    def test_multi_line_note_refuses(self):
        self._assert_refused("note must be a single line", note="a\nb")
        self._assert_refused("note must be a single line", note="a\rb")

    def test_note_with_any_splitlines_break_refuses(self):
        for char in ("\x0b", "\x0c", "\x1c", "\x85", "\u2028", "\u2029"):
            with self.subTest(char=repr(char)):
                self._assert_refused("note must be a single line",
                                     note=f"a{char}b")
                self._assert_refused("note must be a single line",
                                     note=f"trailing{char}")

    def test_caller_with_line_break_refuses(self):
        for char in ("\n", "\r", "\x0b", "\x0c", "\x1c", "\x85",
                     "\u2028", "\u2029"):
            with self.subTest(char=repr(char)):
                self._assert_refused("caller must be a non-empty string",
                                     caller=f"bot{char}x")

    def test_sprint_status_pin_refuses(self):
        self.impl.mkdir(parents=True)
        sprint = self.impl / "sprint-status.yaml"
        sprint.write_text("development-status:\n  1-1: in-progress\n",
                          encoding="utf-8", newline="\n")
        plansync.sync(self.root)
        self._assert_refused(
            f"status of ST-001 is pinned to 'in-progress' by "
            f"{(self.root / plansync.IMPL_REL).resolve() / 'sprint-status.yaml'}"
            f" — update that file or remove the entry")
        # A request matching the pin is honoured, and other stories are free.
        self.assertTrue(plansync.status_pull_back(
            self.root, "ST-001", "in-progress")["ok"])
        self.assertTrue(plansync.status_pull_back(
            self.root, "ST-002", "review")["ok"])
        self.assertEqual(self._front("ST-002")["status"], "review")

    def test_other_external_snapshots_unchanged(self):
        path = self._plan_file("ST-001")
        front, body = interchange.parse_entity(path)
        jira = {"key": "TK-7", "synced_at": "2026-10-01T00:00:00+00:00",
                "content_hash": "abc123", "status": "In Progress"}
        front["external"] = {"jira": dict(jira),
                             "driver": {"key": "old", "synced_at":
                                        "2026-10-01T00:00:00+00:00",
                                        "content_hash": "x", "stale": "yes"}}
        path.write_text(interchange.render_entity(front, body),
                        encoding="utf-8", newline="\n")
        before_updated = front["updated"]
        result = plansync.status_pull_back(self.root, "ST-001", "done")
        self.assertTrue(result["ok"])
        after = self._front("ST-001")
        self.assertEqual(after["external"]["jira"], jira)
        self.assertNotIn("stale", after["external"]["driver"])
        self.assertEqual(after["external"]["driver"]["key"], "tk-studio-plan-sync")
        self.assertGreaterEqual(after["updated"], before_updated)
        self.assertEqual(after["updated"], after["external"]["driver"]["synced_at"])
        self.assertEqual(after["title"], front["title"])
        self.assertEqual(after["source"], front["source"])

    def test_dry_run_writes_nothing(self):
        before = self._snapshot_tree(self.root)
        result = plansync.status_pull_back(self.root, "ST-001", "review",
                                           dry_run=True)
        self.assertTrue(result["ok"])
        self.assertTrue(result["dry_run"])
        index = str(plansync.plan_dir(self.root.resolve()) / "index.md")
        self.assertEqual(result["written"][:2], [result["path"], index])
        self.assertEqual(result["written"].count(index), 1)
        self.assertEqual(self._snapshot_tree(self.root), before)

    def test_backlog_md_resync_moves_task_status(self):
        self._bind("backlog-md")
        self.assertTrue(plansync.sync(self.root)["ok"])
        result = plansync.status_pull_back(self.root, "ST-001", "done")
        self.assertTrue(result["ok"])
        self.assertEqual(result["sync"]["binding"], "backlog-md")
        tasks = [p for p in (self.root / "backlog").rglob("*.md")
                 if "Alpha-Story" in p.name]
        self.assertEqual(len(tasks), 1)
        self.assertIn("status: Done", tasks[0].read_text(encoding="utf-8"))
        self.assertIn(str(tasks[0].resolve()),
                      [str(Path(p).resolve()) for p in result["written"]])
        front = self._front("ST-001")
        self.assertEqual(front["status"], "done")
        self.assertIn("backlog-md", front["external"])
        self.assertEqual(front["external"]["driver"]["status"], "done")
        self.assertEqual(result["written"].count(result["path"]), 1)

    def test_backlog_md_pull_back_revert_is_blocked(self):
        self._bind("backlog-md")
        self.assertTrue(plansync.sync(self.root)["ok"])
        current = self._front("ST-001")["status"]
        tasks = [p for p in (self.root / "backlog").rglob("*.md")
                 if "Alpha-Story" in p.name]
        self.assertEqual(len(tasks), 1)
        text = tasks[0].read_text(encoding="utf-8")
        lines = [("status: Done" if line.startswith("status:") else line)
                 for line in text.split("\n")]
        self.assertNotEqual(lines, text.split("\n"))
        tasks[0].write_text("\n".join(lines), encoding="utf-8", newline="\n")
        result = plansync.status_pull_back(self.root, "ST-001", current)
        self.assertFalse(result["ok"])
        self.assertTrue(result["blocked"])
        self.assertIn("status of ST-001 was reverted to 'done' by the re-sync "
                      "(backlog-md pull-back)", result["reason"])
        self.assertEqual(result["status"], current)
        self.assertIn(result["path"], result["written"])
        self.assertIsNotNone(result["sync"])
        self.assertEqual(self._front("ST-001")["status"], "done")

    def test_blocked_sync_still_names_entity_write(self):
        self._bind("jira")
        result = plansync.status_pull_back(self.root, "ST-001", "review")
        self.assertFalse(result["ok"])
        self.assertTrue(result["blocked"])
        self.assertIn("planning.jira.site", result["reason"])
        self.assertIn(result["path"], result["written"])
        self.assertEqual(self._front("ST-001")["status"], "review")

    def test_foreign_index_refuses_before_any_write(self):
        index = plansync.plan_dir(self.root) / "index.md"
        index.write_text("# hand-written index\n", encoding="utf-8",
                         newline="\n")
        message = (f"{plansync.plan_dir(self.root.resolve()) / 'index.md'} "
                   f"exists but was not generated by plansync.py — refusing "
                   f"to overwrite; move or delete it and rerun")
        self._assert_refused(message)
        self._assert_refused(message, dry_run=True)
        self.assertEqual(self._front("ST-001")["status"], "draft")
        self.assertEqual(index.read_text(encoding="utf-8"),
                         "# hand-written index\n")
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = plansync.main(["status", "--directory", str(self.root),
                                  "--id", "ST-001", "--status", "done"])
        self.assertEqual(code, 2)
        out = json.loads(buffer.getvalue())
        self.assertFalse(out["ok"])
        self.assertIn("not generated by plansync.py", out["error"])
        self.assertEqual(self._front("ST-001")["status"], "draft")

    def test_foreign_index_refuses_under_backlog_md(self):
        self._bind("backlog-md")
        self.assertTrue(plansync.sync(self.root)["ok"])
        (plansync.plan_dir(self.root) / "index.md").write_text(
            "# hand-written index\n", encoding="utf-8", newline="\n")
        self._assert_refused("not generated by plansync.py")

    def test_dry_run_unchanged_status_does_not_name_index(self):
        plansync.status_pull_back(self.root, "ST-001", "review")
        index = plansync.plan_dir(self.root.resolve()) / "index.md"
        self.assertFalse(plansync.generate_plan_index(
            self.root, dry_run=True)["changed"])
        before = self._snapshot_tree(self.root)
        result = plansync.status_pull_back(self.root, "ST-001", "review",
                                           dry_run=True)
        self.assertTrue(result["ok"])
        self.assertEqual(result["previous_status"], "review")
        self.assertIn(result["path"], result["written"])
        self.assertNotIn(str(index), result["written"])
        self.assertEqual(self._snapshot_tree(self.root), before)
        # The real run agrees: an unchanged status leaves the index alone.
        real = plansync.status_pull_back(self.root, "ST-001", "review")
        self.assertNotIn(str(index), real["written"])

    def test_dry_run_blocked_sync_does_not_name_index(self):
        self._bind("jira")
        before = self._snapshot_tree(self.root)
        result = plansync.status_pull_back(self.root, "ST-001", "review",
                                           dry_run=True)
        self.assertFalse(result["ok"])
        self.assertTrue(result["blocked"])
        self.assertIn("planning.jira.site", result["reason"])
        index = str(plansync.plan_dir(self.root.resolve()) / "index.md")
        self.assertNotIn(index, result["written"])
        self.assertIn(result["path"], result["written"])
        self.assertEqual(self._snapshot_tree(self.root), before)

    def test_any_sync_exception_after_write_reports_entity_written(self):
        def boom(*args, **kwargs):
            raise OSError("disk went away")
        with mock.patch.object(plansync, "sync", boom):
            result = plansync.status_pull_back(self.root, "ST-001", "review")
            buffer = io.StringIO()
            with redirect_stdout(buffer):
                code = plansync.main(["status", "--directory", str(self.root),
                                      "--id", "ST-001", "--status", "done"])
            with self.assertRaises(OSError):
                plansync.status_pull_back(self.root, "ST-001", "review",
                                          dry_run=True)
        self.assertFalse(result["ok"])
        self.assertTrue(result["blocked"])
        self.assertIn("disk went away", result["reason"])
        self.assertEqual(result["written"], [result["path"]])
        self.assertEqual(result["removed"], [])
        self.assertIsNone(result["sync"])
        self.assertEqual(code, 2)
        out = json.loads(buffer.getvalue())
        self.assertTrue(out["blocked"])
        self.assertEqual(out["written"], [out["path"]])
        self.assertEqual(self._front("ST-001")["status"], "done")

    def test_cross_repo_touches_only_the_owning_plan(self):
        other = Path(self._tmp.name) / "other"
        spec_dir = other / "_bmad-output" / "specs" / "spec-epic-1"
        (spec_dir / "stories").mkdir(parents=True)
        (spec_dir / "stories.yaml").write_text(
            "stories:\n  - key: 1-1-alpha-story\n    canonical_id: ST-001\n",
            encoding="utf-8", newline="\n")
        (spec_dir / "stories" / "1-1-alpha-story.md").write_text(
            "---\ntitle: Alpha Story\nstatus: done\n---\n\nLanded here.\n",
            encoding="utf-8", newline="\n")
        before = self._snapshot_tree(other)
        result = plansync.status_pull_back(self.root, "ST-001", "done",
                                           note="landed in other")
        self.assertTrue(result["ok"])
        self.assertEqual(self._snapshot_tree(other), before)
        owning = str(self.root.resolve())
        self.assertTrue(result["plan_dir"].startswith(owning))
        for written in result["written"]:
            self.assertTrue(written.startswith(owning), written)
        self.assertEqual(self._front("ST-001")["status"], "done")

    def test_status_cli_exit_codes(self):
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = plansync.main(["status", "--directory", str(self.root),
                                  "--id", "ST-001", "--status", "review",
                                  "--note", "PR #4: opened"])
        self.assertEqual(code, 0)
        out = json.loads(buffer.getvalue())
        self.assertTrue(out["ok"])
        self.assertEqual(out["note"], "PR #4: opened")
        self.assertEqual(self._front("ST-001")["external"]["driver"]["note"],
                         "PR #4: opened")
        for argv, marker in (
                (["--id", "ST-001", "--status", "merged"], "canonical enum"),
                (["--id", "ST-999", "--status", "review"], "unknown id ST-999"),
                (["--id", "EP-001", "--status", "review"], "not a story")):
            buffer = io.StringIO()
            with redirect_stdout(buffer):
                code = plansync.main(["status", "--directory", str(self.root)]
                                     + argv)
            self.assertEqual(code, 2)
            out = json.loads(buffer.getvalue())
            self.assertFalse(out["ok"])
            self.assertIn(marker, out["error"])


def backlogmd_hash(*parts: str) -> str:
    """sha256 hex over NUL-terminated parts (the backlogmd._content_hash
    construction), computed independently of the module under test."""
    import hashlib
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part.encode("utf-8") + b"\x00")
    return digest.hexdigest()


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



LEDGER_DOC = """# Deferred Work

### DW-1: first
origin: spec-deferred aaa
reason: r
status: done 2026-10-29
resolution: resolved by sweep bundle dw-alpha

### DW-2: second
origin: spec-deferred bbb
status: open

### DW-3: third
status: done 2026-10-28
resolution: already resolved: plugins/tk-studio/lib/x.py:12

## Deferred from: elsewhere

### DW-4: fourth
status: resolved 2026-09-28 by thkennedy/tk-studio#77 (by hand)
"""


class LedgerResolveTests(PlanSyncTestCase):
    """Story 35.7: `plansync.py ledger-resolve` flips the engine's `done`
    entries to `resolved … by #N` after the sweep's PR merged."""

    def _ledger(self, text: str = LEDGER_DOC) -> Path:
        path = self.impl / "deferred-work.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
        return path

    def _cli(self, *args: str) -> tuple[int, dict]:
        out = io.StringIO()
        with redirect_stdout(out):
            code = plansync.main(["ledger-resolve", "--directory", str(self.root), *args])
        return code, json.loads(out.getvalue())

    def test_done_entries_are_resolved_by_the_pr_then_unchanged(self):
        path = self._ledger()
        code, out = self._cli("--pr", "https://github.com/thkennedy/tk-studio/pull/300",
                              "--ids", "DW-1,DW-3,DW-4")
        self.assertEqual(code, 0)
        self.assertTrue(out["ok"])
        self.assertEqual(out["resolved"], ["DW-1", "DW-3"])
        self.assertEqual(out["unchanged"], ["DW-4"])
        self.assertEqual(out["pending"], [])
        self.assertEqual(list(out)[-4:], ["status", "intent", "artifacts", "reason"])
        self.assertEqual(out["status"], "complete")
        text = path.read_text(encoding="utf-8")
        self.assertIn("status: resolved 2026-10-29 by thkennedy/tk-studio#300 "
                      "(sweep bundle dw-alpha)\n"
                      "resolution: resolved by sweep bundle dw-alpha\n", text)
        self.assertIn("status: resolved 2026-10-28 by thkennedy/tk-studio#300 "
                      "(sweep; already resolved: plugins/tk-studio/lib/x.py:12)\n", text)
        self.assertIn("status: resolved 2026-09-28 by thkennedy/tk-studio#77 (by hand)", text)
        before = path.read_bytes()
        code, again = self._cli("--pr", "thkennedy/tk-studio#300", "--ids", "DW-1,DW-3")
        self.assertEqual(code, 0)
        self.assertEqual(again["resolved"], [])
        self.assertEqual(again["unchanged"], ["DW-1", "DW-3"])
        self.assertEqual(again["written"], [])
        self.assertEqual(path.read_bytes(), before)

    def test_an_open_entry_is_pending_and_an_absent_one_refused(self):
        # Story 38.3 (B4): `pending` keeps open entries only; an absent id is `LedgerMissingId`
        path = self._ledger()
        before = path.read_bytes()
        code, out = self._cli("--pr", "thkennedy/tk-studio#300", "--ids", "DW-2",
                              "--date", "2026-10-30")
        self.assertEqual(code, 0)
        self.assertTrue(out["ok"])
        self.assertEqual(out["pending"], ["DW-2"])
        self.assertEqual(out["status"], "partial")
        self.assertEqual(path.read_bytes(), before)
        code, out = self._cli("--pr", "thkennedy/tk-studio#300", "--ids", "DW-2,DW-9",
                              "--date", "2026-10-30")
        self.assertEqual(code, 2)
        self.assertNotIn("pending", out)
        self.assertEqual(out["reason"], "LedgerMissingId: DW-9 not in the ledger (the counter's next id: DW-5)")
        self.assertEqual(path.read_bytes(), before)

    def test_a_missing_id_is_refused_by_name_with_the_counter_and_nothing_written(self):
        # Story 38.3 (B4): a done entry beside the missing ones is not flipped either (the refusal comes first)
        path = self._ledger()
        before = path.read_bytes()
        counter = plansync.counter_path(self.root)
        counter.parent.mkdir(parents=True, exist_ok=True)
        counter.write_text("counter_version: 1\nnext:\n  epic: 38\n  story: 168\n  task: 1\n"
                           "  deferred-work: 166\n", encoding="utf-8", newline="\n")
        code, out = self._cli("--pr", "thkennedy/tk-studio#300", "--ids", "DW-1,DW-9,DW-12")
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])  # the refusal's shape, as LedgerDuplicateId's
        self.assertEqual(out["status"], "blocked")
        msg = "LedgerMissingId: DW-9, DW-12 not in the ledger (the counter's next id: DW-166)"
        self.assertEqual(out["reason"], msg)
        self.assertEqual(out["error"], msg)
        self.assertNotIn("retryable", out)
        self.assertEqual(list(out)[-4:], ["status", "intent", "artifacts", "reason"])
        self.assertEqual(path.read_bytes(), before)

    def test_a_missing_id_refuses_a_dry_run_too_and_names_an_unreadable_counter(self):
        path = self._ledger()
        before = path.read_bytes()
        counter = plansync.counter_path(self.root)
        counter.parent.mkdir(parents=True, exist_ok=True)
        counter.write_text("counter_version: 7\n", encoding="utf-8", newline="\n")
        code, out = self._cli("--pr", "thkennedy/tk-studio#300", "--ids", "DW-1,DW-9", "--dry-run")
        self.assertEqual(code, 2)
        self.assertTrue(out["reason"].startswith("LedgerMissingId: DW-9 not in the ledger (the counter unreadable: "),
                        out["reason"])
        self.assertEqual(path.read_bytes(), before)
        with self.assertRaises(dwledger.LedgerMissingId):
            plansync.ledger_resolve(self.root, "thkennedy/tk-studio#300", ["DW-9"], dry_run=True)

    def test_the_date_flag_wins_and_the_rest_of_the_ledger_is_kept(self):
        path = self._ledger()
        self._cli("--pr", "thkennedy/tk-studio#300", "--ids", "DW-1", "--date", "2026-11-01")
        text = path.read_text(encoding="utf-8")
        self.assertEqual(text, LEDGER_DOC.replace(
            "status: done 2026-10-29",
            "status: resolved 2026-11-01 by thkennedy/tk-studio#300 "
            "(sweep bundle dw-alpha)"))

    def test_the_status_line_names_the_bundle_once(self):
        # Story 36.2: the engine's own `resolved by sweep bundle <key>` adds nothing (the doubled note of #290, #293)
        for resolution in ("resolved by sweep bundle dw-alpha", "resolved by sweep bundle dw2-alpha."):
            status = plansync.resolved_status("2026-10-30", "thkennedy/tk-studio#300", resolution)
            self.assertEqual(status.count("sweep bundle"), 1, status)
            self.assertTrue(status.endswith(")") and ";" not in status, status)
        # a resolution that says more keeps its text, the clause gone wherever it stands
        for resolution in ("fixed the gate; resolved by sweep bundle dw-alpha",
                           "fixed the gate. resolved by sweep bundle dw-alpha.",
                           "resolved by sweep bundle dw-alpha; fixed the gate"):
            self.assertEqual(plansync.resolved_status("2026-10-30", "thkennedy/tk-studio#300", resolution),
                             "resolved 2026-10-30 by thkennedy/tk-studio#300 "
                             "(sweep bundle dw-alpha; fixed the gate)")
        self.assertEqual(plansync.resolved_status("2026-10-30", "thkennedy/tk-studio#300",
                                                  "fixed the gate; resolved by sweep bundle dw-alpha, with a test"),
                         "resolved 2026-10-30 by thkennedy/tk-studio#300 "
                         "(sweep bundle dw-alpha; fixed the gate; with a test)")
        # no clause: the text is untouched, its own full stop kept
        self.assertEqual(plansync.resolved_status("2026-10-30", "thkennedy/tk-studio#300", "fixed in sweep bundle dw-alpha."),
                         "resolved 2026-10-30 by thkennedy/tk-studio#300 "
                         "(sweep bundle dw-alpha; fixed in sweep bundle dw-alpha.)")

    def test_a_long_resolution_keeps_its_bundle_name_past_the_clip(self):
        long = "x" * 200 + " resolved by sweep bundle dw-late-name"
        status = plansync.resolved_status("2026-10-29", "thkennedy/tk-studio#300", long)
        self.assertTrue(status.startswith(
            "resolved 2026-10-29 by thkennedy/tk-studio#300 (sweep bundle dw-late-name; xxx"), status)
        self.assertNotIn("dw-late-name)", status)  # the text itself is still clipped
        self.assertTrue(status.endswith("…)"), status)
        path = self._ledger(LEDGER_DOC.replace("resolution: resolved by sweep bundle dw-alpha",
                                               f"resolution: {long}"))
        code, out = self._cli("--pr", "thkennedy/tk-studio#300", "--ids", "DW-1")
        self.assertEqual(code, 0)
        self.assertEqual(out["resolved"], ["DW-1"])
        self.assertIn("by thkennedy/tk-studio#300 (sweep bundle dw-late-name; ",
                      path.read_text(encoding="utf-8"))

    def test_refusals_end_blocked(self):
        code, out = self._cli("--pr", "thkennedy/tk-studio#300", "--ids", "DW-1")
        self.assertEqual(code, 2)  # no ledger
        self.assertFalse(out["ok"])
        self.assertEqual(out["status"], "blocked")
        self._ledger()
        for args in (("--pr", "300", "--ids", "DW-1"),
                     ("--pr", "a/b#1", "--ids", "DW-1,nope")):
            code, out = self._cli(*args)
            self.assertEqual(code, 2, args)
            self.assertEqual(out["status"], "blocked")

    def test_a_duplicate_heading_is_refused_by_name_and_not_retried(self):
        path = self._ledger("# Deferred Work\n\n### DW-7: one\nstatus: done 2026-10-29\n\n"
                            "### DW-7: two\nstatus: open\n")
        before = path.read_bytes()
        code, out = self._cli("--pr", "thkennedy/tk-studio#300", "--ids", "DW-7")
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])
        self.assertEqual(out["status"], "blocked")
        self.assertEqual(out["reason"], "LedgerDuplicateId: DW-7 at lines 3 and 6")
        self.assertNotIn("retryable", out)
        self.assertEqual(list(out)[-4:], ["status", "intent", "artifacts", "reason"])
        self.assertEqual(path.read_bytes(), before)


class LedgerDecideTests(PlanSyncTestCase):
    """Story 38.4: `plansync.py ledger-decide` writes the owner's decision
    line directly after the entry's `status:` line, idempotently."""

    def _ledger(self, text: str = LEDGER_DOC) -> Path:
        path = self.impl / "deferred-work.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
        return path

    def _cli(self, *args: str) -> tuple[int, dict]:
        out = io.StringIO()
        with redirect_stdout(out):
            code = plansync.main(["ledger-decide", "--directory", str(self.root), *args])
        return code, json.loads(out.getvalue())

    def test_the_line_lands_after_status_once_then_unchanged(self):
        path = self._ledger()
        args = ("--id", "DW-2", "--letter", "B", "--text", "Close  it\n— fine",
                "--issue", "TKSTUDIO-230", "--date", "2026-11-08")
        code, out = self._cli(*args)
        self.assertEqual(code, 0)
        self.assertEqual(list(out)[-4:], ["status", "intent", "artifacts", "reason"])
        self.assertEqual((out["status"], out["decided"], out["unchanged"]), ("complete", True, False))
        line = "decision: B — Close it — fine (TKSTUDIO-230, 2026-11-08)"
        self.assertEqual(out["line"], line)
        self.assertEqual(out["written"], ["_bmad-output/implementation-artifacts/deferred-work.md"])
        text = path.read_text(encoding="utf-8")
        self.assertIn("### DW-2: second\norigin: spec-deferred bbb\nstatus: open\n" + line + "\n\n", text)
        before = path.read_bytes()
        code, again = self._cli(*args)
        self.assertEqual(code, 0)
        self.assertEqual((again["decided"], again["unchanged"], again["written"]), (False, True, []))
        self.assertEqual(path.read_bytes(), before)
        # the same answer re-ingested on another UTC date is the same decision
        code, later = self._cli("--id", "DW-2", "--letter", "B", "--text", "Close  it\n— fine",
                                "--issue", "TKSTUDIO-230", "--date", "2026-11-10")
        self.assertEqual(code, 0)
        self.assertEqual((later["decided"], later["unchanged"], later["written"], later["line"]),
                         (False, True, [], line))
        self.assertEqual(path.read_bytes(), before)
        # a second, different decision line is kept beside the first (the engine's own too)
        code, other = self._cli("--id", "DW-2", "--letter", "A", "--text", "Build",
                                "--issue", "TKSTUDIO-231", "--date", "2026-11-09")
        self.assertEqual(code, 0)
        self.assertEqual(path.read_text(encoding="utf-8").count("decision: "), 2)

    def test_refusals_write_nothing(self):
        path = self._ledger()
        before = path.read_bytes()
        for args, why in (
                (("--id", "DW-x", "--letter", "A", "--text", "t", "--issue", "TKSTUDIO-1"), "--id"),
                (("--id", "DW-2", "--letter", "ab", "--text", "t", "--issue", "TKSTUDIO-1"), "--letter"),
                (("--id", "DW-2", "--letter", "A", "--text", "t", "--issue", "nope"), "--issue"),
                (("--id", "DW-2", "--letter", "A", "--text", "t", "--issue", "TKSTUDIO-1",
                  "--date", "11/08"), "--date"),
                (("--id", "DW-9", "--letter", "A", "--text", "t", "--issue", "TKSTUDIO-1"),
                 "LedgerMissingId: DW-9 not in the ledger")):
            code, out = self._cli(*args)
            self.assertEqual(code, 2, why)
            self.assertEqual(out["status"], "blocked")
            self.assertIn(why, out["reason"])
            self.assertNotIn("retryable", out)
        self.assertEqual(path.read_bytes(), before)
        self._ledger(LEDGER_DOC + "\n### DW-2: again\nstatus: open\n")
        code, out = self._cli("--id", "DW-2", "--letter", "A", "--text", "t", "--issue", "TKSTUDIO-1")
        self.assertEqual(code, 2)
        self.assertIn("LedgerDuplicateId", out["reason"])

    def test_a_dry_run_writes_nothing(self):
        path = self._ledger()
        before = path.read_bytes()
        code, out = self._cli("--id", "DW-1", "--letter", "A", "--text", "t",
                              "--issue", "TKSTUDIO-1", "--dry-run")
        self.assertEqual(code, 0)
        self.assertTrue(out["decided"])
        self.assertEqual(out["written"], [])
        self.assertEqual(path.read_bytes(), before)


class StageFromRunTests(PlanSyncTestCase):
    """Story 38.3 (DW-165): `plansync.py stage --from-run` answers a sweep's
    bundles' engine passes as Stage Log rows, read only."""

    MODEL = "claude-opus-5-5"

    def _run(self) -> Path:
        run_dir = self.root / ".bmad-loop" / "runs" / "E1"
        run_dir.mkdir(parents=True)
        (run_dir / "triage.json").write_text(json.dumps({"bundles": [
            {"name": "a", "dw_ids": ["DW-1"]}, {"name": "b", "dw_ids": ["DW-2"]}]}), encoding="utf-8")
        (self.root / ".bmad-loop" / "routing.current.json").write_text(json.dumps({
            "implementer": {"model": self.MODEL, "effort": "medium"},
            "reviewers": {"model": self.MODEL, "effort": "high"}}), encoding="utf-8")
        usage = {"input_tokens": 1000, "output_tokens": 200, "cache_read_tokens": 0, "cache_creation_tokens": 0}
        tasks, journal = {}, []
        for n, key in enumerate(("dw-a", "dw-b")):
            sessions = []
            for k, label in enumerate(("dev", "review")):
                task_id = f"{key}-{label}-1"
                sessions.append({"task_id": task_id, "role": label, "status": "completed",
                                 "model": self.MODEL, "session_id": f"s-{key}-{label}", "usage": usage})
                t0 = 1793000000 + n * 1000 + k * 100
                journal.append({"ts": t0, "kind": "session-start", "task_id": task_id})
                journal.append({"ts": t0 + 60, "kind": "session-end", "task_id": task_id})
            tasks[key] = {"story_key": key, "sessions": sessions}
        tasks["sweep-triage"] = {"sessions": [{"task_id": "sweep-triage-1", "status": "completed"}]}
        (run_dir / "state.json").write_text(json.dumps({"tasks": tasks}), encoding="utf-8")
        (run_dir / "journal.jsonl").write_text("".join(json.dumps(j) + "\n" for j in journal), encoding="utf-8")
        return run_dir

    def _cli(self, *args: str) -> tuple[int, dict]:
        out = io.StringIO()
        with redirect_stdout(out):
            code = plansync.main(["stage", "--from-run", *args])
        return code, json.loads(out.getvalue())

    def test_each_bundle_answers_one_row_per_session_and_nothing_is_written(self):
        run_dir = self._run()
        before = sorted(p.relative_to(self.root).as_posix() for p in self.root.rglob("*"))
        code, out = self._cli("--run-dir", str(run_dir), "--worktree", str(self.root))
        self.assertEqual(code, 0, out)
        self.assertTrue(out["ok"])
        self.assertEqual(out["columns"], list(plansync.STAGE_COLUMNS))
        self.assertEqual(out["written"], [])
        self.assertEqual(list(out)[-4:], ["status", "intent", "artifacts", "reason"])
        self.assertEqual([b["key"] for b in out["bundles"]], ["dw-a", "dw-b"])  # the triage's sessions get none
        for b in out["bundles"]:
            rows = b["rows"]
            self.assertEqual([(r["stage"], r["pass"], r["session_id"]) for r in rows],
                             [("dev", "1", f"s-{b['key']}-dev"), ("review", "1", f"s-{b['key']}-review")])
            self.assertEqual([r["effort"] for r in rows], ["medium", "high"])
            # no transcript: the state.json `usage` fallback, priced by `meter._session_usd`
            self.assertEqual([(r["tokens_in"], r["tokens_out"]) for r in rows], [("1000", "200")] * 2)
            self.assertTrue(all(r["cost_usd"] != plansync.NO_VALUE for r in rows), rows)
            self.assertEqual({r["outcome"] for r in rows}, {"completed"})
            self.assertTrue(all(r["started"].endswith("Z") and r["ended"].endswith("Z") for r in rows))
        after = sorted(p.relative_to(self.root).as_posix() for p in self.root.rglob("*"))
        self.assertEqual(after, before)

    def test_an_unreadable_state_is_refused(self):
        run_dir = self._run()
        (run_dir / "state.json").write_text("{not json", encoding="utf-8")
        code, out = self._cli("--run-dir", str(run_dir), "--worktree", str(self.root))
        self.assertEqual(code, 2)
        self.assertEqual(out["status"], "blocked")
        self.assertIn("stage --from-run", out["reason"])
        self.assertNotIn("retryable", out)


class StageTargetSplitTests(PlanSyncTestCase):
    """Story 38.5 (DW-177): a split story's spec resolves by its exact
    `<key>-spec.md` first, else by the prefix glob only when one file
    matches, the `-s<n>` and `-r<n>` names excluded."""

    KEY = "38-5-the-pause"

    def _spec(self, name: str, folder: str = "spec-epic-38") -> Path:
        stories = self.root / "_bmad-output" / "specs" / folder / "stories"
        stories.mkdir(parents=True, exist_ok=True)
        path = stories / name
        path.write_text("---\nstatus: done\n---\n", encoding="utf-8")
        return path

    def target(self, story: str):
        return plansync._stage_target(self.root, story, None)

    def test_the_exact_name_wins_over_a_second_half(self):
        first = self._spec(f"{self.KEY}-spec.md")
        self._spec(f"{self.KEY}-s2-spec.md")
        self.assertEqual(self.target(self.KEY), (first, self.KEY))
        # the second half resolves to its own spec
        second = self.root / "_bmad-output" / "specs" / "spec-epic-38" / "stories" / f"{self.KEY}-s2-spec.md"
        self.assertEqual(self.target(f"{self.KEY}-s2"), (second, f"{self.KEY}-s2"))

    def test_the_glob_excludes_s_and_r_names_and_answers_the_one_left(self):
        draft = self._spec(f"{self.KEY}-draft.md")
        self._spec(f"{self.KEY}-s2-spec.md")
        self._spec(f"{self.KEY}-r1.md")
        self.assertEqual(self.target(self.KEY), (draft, self.KEY))

    def test_only_later_halves_present_is_no_spec_yet(self):
        self._spec(f"{self.KEY}-s2-spec.md")
        self.assertEqual(self.target(self.KEY), (None, self.KEY))

    def test_several_left_after_the_exclusion_or_two_exact_names_refuse(self):
        self._spec(f"{self.KEY}-a.md")
        self._spec(f"{self.KEY}-b.md")
        with self.assertRaisesRegex(plansync.PlanSyncError, "several specs match"):
            self.target(self.KEY)
        self._spec(f"{self.KEY}-spec.md")
        self._spec(f"{self.KEY}-spec.md", folder="spec-epic-39")
        with self.assertRaisesRegex(plansync.PlanSyncError, "several specs match"):
            self.target(self.KEY)


class DeferredMintTests(PlanSyncTestCase):
    """Story 37.1: `plansync.py deferred mint`, the ledger's one id source."""

    DOC = "# Deferred Work\n\n### DW-163: a\nstatus: open\n\n### DW-164: b\nstatus: open\n"

    def _ledger(self, text: str = DOC) -> Path:
        path = self.impl / "deferred-work.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
        return path

    def _counter(self, extra: str = "") -> Path:
        path = plansync.counter_path(self.root)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"counter_version: 1\nnext:\n  epic: 38\n  story: 168\n  task: 1\n{extra}",
                        encoding="utf-8", newline="\n")
        return path

    def _cli(self, *args: str) -> tuple[int, dict]:
        out = io.StringIO()
        with redirect_stdout(out):
            code = plansync.main(["deferred", "mint", "--directory", str(self.root), *args])
        return code, json.loads(out.getvalue())

    def test_the_seed_is_the_ledgers_highest_plus_one_and_other_keys_are_kept(self):
        path, counter = self._ledger(), self._counter()
        code, out = self._cli()
        self.assertEqual(code, 0)
        self.assertTrue(out["ok"])
        self.assertEqual(out["ids"], ["DW-165"])
        self.assertEqual(out["next"], 166)
        self.assertEqual(out["written"], [plansync.COUNTER_REL.as_posix(), plansync.LEDGER_REL.as_posix()])
        self.assertEqual(list(out)[-4:], ["status", "intent", "artifacts", "reason"])
        self.assertEqual(plansync.load_counter(self.root)["next"],
                         {"epic": 38, "story": 168, "task": 1, "deferred-work": 166})
        self.assertTrue(counter.is_file())
        text = path.read_text(encoding="utf-8")
        self.assertIn("last minted DW-165;", text)
        self.assertTrue(text.endswith(self.DOC.split("\n\n", 1)[1]), text)

    def test_the_seed_reads_a_dw_id_in_body_text_above_the_highest_heading(self):
        self._ledger(self.DOC + "reason: see DW-200\n")
        self._counter()
        _, out = self._cli()
        self.assertEqual(out["ids"], ["DW-201"])

    def test_a_block_is_consecutive_ids_and_the_marker_moves_on_the_next_mint(self):
        path = self._ledger()
        self._counter()
        _, out = self._cli("--count", "3")
        self.assertEqual(out["ids"], ["DW-165", "DW-166", "DW-167"])
        self.assertEqual(out["next"], 168)
        _, again = self._cli()
        self.assertEqual(again["ids"], ["DW-168"])
        text = path.read_text(encoding="utf-8")
        self.assertEqual(text.count("deferred-work counter:"), 1)
        self.assertIn("last minted DW-168;", text)

    def test_the_counter_mints_above_the_ledger_and_skips_what_the_ledger_holds(self):
        self._ledger()
        self._counter("  deferred-work: 300\n")
        _, out = self._cli()
        self.assertEqual(out["ids"], ["DW-300"])
        self._counter("  deferred-work: 2\n")
        _, behind = self._cli()
        self.assertEqual(behind["ids"], ["DW-301"])

    def test_a_dry_run_answers_and_changes_nothing(self):
        path, counter = self._ledger(), self._counter()
        before = path.read_bytes(), counter.read_bytes()
        code, out = self._cli("--count", "2", "--dry-run")
        self.assertEqual(code, 0)
        self.assertEqual(out["ids"], ["DW-165", "DW-166"])
        self.assertEqual(out["written"], [])
        self.assertEqual((path.read_bytes(), counter.read_bytes()), before)

    def test_refusals_end_blocked_with_nothing_written(self):
        path, counter = self._ledger(), self._counter()
        before = path.read_bytes(), counter.read_bytes()
        for count in ("0", "-1", "many"):
            code, out = self._cli("--count", count)
            self.assertEqual(code, 2, count)
            self.assertEqual(out["status"], "blocked")
            self.assertIn("--count", out["reason"])
        self.assertEqual((path.read_bytes(), counter.read_bytes()), before)
        for bad in ("0", "nope", "true"):
            self._counter(f"  deferred-work: {bad}\n")
            before = path.read_bytes(), counter.read_bytes()
            code, out = self._cli()
            self.assertEqual(code, 2, bad)
            self.assertEqual(out["status"], "blocked")
            self.assertIn("next.deferred-work", out["reason"])
            self.assertEqual((path.read_bytes(), counter.read_bytes()), before)

    def test_a_duplicate_heading_refuses_the_mint(self):
        path = self._ledger("### DW-7: one\nstatus: open\n\n### DW-7: two\nstatus: open\n")
        counter = self._counter()
        before = path.read_bytes(), counter.read_bytes()
        code, out = self._cli()
        self.assertEqual(code, 2)
        self.assertEqual(out["status"], "blocked")
        self.assertEqual(out["reason"], "LedgerDuplicateId: DW-7 at lines 1 and 4")
        self.assertEqual((path.read_bytes(), counter.read_bytes()), before)

    def test_no_ledger_is_refused(self):
        self._counter()
        code, out = self._cli()
        self.assertEqual(code, 2)
        self.assertIn("no ledger", out["reason"])

    def test_a_marker_write_failure_names_the_counter_and_says_the_ids_are_burned(self):
        path, counter = self._ledger(), self._counter()
        before = path.read_bytes()
        real_write = plansync._atomic_write

        def fail_on_ledger(target, content):
            if Path(target) == path:
                raise PermissionError("sharing violation")
            real_write(target, content)

        with mock.patch.object(plansync, "_atomic_write", side_effect=fail_on_ledger):
            code, out = self._cli("--count", "2")
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])
        self.assertEqual(out["status"], "blocked")
        self.assertEqual(out["written"], [plansync.COUNTER_REL.as_posix()])
        self.assertEqual(out["artifacts"], [plansync.COUNTER_REL.as_posix()])
        self.assertIn("burned", out["reason"])
        self.assertIn("DW-165, DW-166", out["reason"])
        self.assertEqual(plansync.load_counter(self.root)["next"]["deferred-work"], 167)
        self.assertTrue(counter.is_file())
        self.assertEqual(path.read_bytes(), before)



# CAP-19 (Story 38.7): the PR rule for `resolved … by Story N.M` closures, factored out of
# RealLedgerContentTests so the branch decision and the scan run on synthetic input too.
# lazy `.*?`: the first `by Story N.M` after `resolved` is the closing story
_STORY_CLOSURE_RE = re.compile(r"^resolved\b.*?\bby Story (\d+)\.\d+\b")
_PR_REF_RE = re.compile(r"\b[\w.-]+/[\w.-]+#\d+\b")
_RUN_BRANCH_RE = re.compile(r"^(supervisor/run-|loop/epic-)")


def _read_branch(repo_root):
    """(branch, None), or (None, reason) when git is unavailable or `rev-parse` fails."""
    try:
        proc = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_root,
                              capture_output=True, text=True, encoding="utf-8", timeout=30)
    except (OSError, subprocess.SubprocessError) as exc:
        return None, f"git unavailable, the branch cannot be read: {type(exc).__name__}: {exc}"
    if proc.returncode != 0:
        return None, f"git rev-parse failed (exit {proc.returncode}): {proc.stderr.strip()}"
    return proc.stdout.strip(), None


def _inloop_form_allowed(branch, story_epic):
    """A PR-less `by Story N.M` is allowed on a run branch for that branch's epic only;
    a run branch naming no `epic-N` allows any story; any other branch (detached `HEAD`) none."""
    if _RUN_BRANCH_RE.match(branch) is None:
        return False
    epic = re.search(r"epic-(\d+)", branch)
    return epic is None or epic.group(1) == story_epic


def _closures_missing_pr(text, branch):
    """Ids of `resolved … by Story N.M` statuses naming no `owner/repo#N` the branch does not excuse."""
    missing = []
    for entry in dwledger.parse_ledger(text):
        m = _STORY_CLOSURE_RE.match(entry.status or "")
        if not m or _PR_REF_RE.search(entry.status):
            continue
        if _inloop_form_allowed(branch, m.group(1)):
            continue  # the in-loop form, filled by the close-out at merge
        missing.append(entry.id)
    return missing


def _missing_pr_message(branch, missing):
    return (f"on {branch!r} these closures name no PR: {', '.join(missing)}; "
            "write `by Story N.M (owner/repo#N)`")


class RealLedgerContentTests(unittest.TestCase):
    """The tracked ledger is whole: the host leg's suite holds this, the engine's gate does not."""

    @classmethod
    def setUpClass(cls):
        repo_root = Path(__file__).resolve().parents[4]
        cls.repo_root = repo_root
        ledger = repo_root / "_bmad-output" / "implementation-artifacts" / "deferred-work.md"
        cls.text = ledger.read_text(encoding="utf-8")

    def test_every_entry_has_a_status_line(self):
        missing = [e.id for e in dwledger.parse_ledger(self.text) if e.status is None]
        self.assertFalse(missing, missing)

    def test_no_placeholder_pr_number_remains(self):
        self.assertNotIn("by this story's PR", self.text,
                         "an entry closed from inside a run has no PR number yet: write `by Story N.M`")

    def test_every_story_closure_names_its_pr_outside_a_run_branch(self):
        """CAP-19 (Story 38.7): a `resolved … by Story N.M` status names its PR (`owner/repo#N`).

        On a run branch (`supervisor/run-…`, `loop/epic-…`) the in-loop form `by Story N.M`
        is allowed for that branch's epic only, until the close-out fills it at merge; any
        other branch, a detached HEAD included, needs every reference.
        """
        branch, skip_reason = _read_branch(self.repo_root)
        if skip_reason is not None:
            self.skipTest(skip_reason)
        missing = _closures_missing_pr(self.text, branch)
        self.assertFalse(missing, _missing_pr_message(branch, missing))


def _ledger(*statuses):
    """A synthetic ledger: one entry per status, DW-1 upward."""
    parts = ["# Deferred work\n"]
    for n, status in enumerate(statuses, start=1):
        parts.append(f"\n### DW-{n}: item {n}\norigin: test\nlocation: x\nreason: y\nstatus: {status}\n")
    return "".join(parts)


class StoryClosurePrRuleTests(unittest.TestCase):
    """CAP-19 (Story 38.7) matrix rows "PR rule on run branch" / "PR rule elsewhere", on synthetic input."""

    PR_LESS_38 = "resolved 2026-11-09 by Story 38.7"
    PR_LESS_37 = "resolved 2026-11-08 by Story 37.4"
    WITH_PR = "resolved 2026-11-08 by Story 37.4 (thkennedy/tk-studio#368)"
    REAL_TEST = "test_every_story_closure_names_its_pr_outside_a_run_branch"

    def test_off_run_branch_a_pr_less_closure_is_missing_and_a_named_pr_passes(self):
        text = _ledger(self.PR_LESS_38, self.WITH_PR, self.PR_LESS_37, "done 2026-08-07", "open")
        for branch in ("main", "docs/x", "HEAD"):
            with self.subTest(branch=branch):
                self.assertEqual(_closures_missing_pr(text, branch), ["DW-1", "DW-3"])
                self.assertEqual(_closures_missing_pr(_ledger(self.WITH_PR), branch), [])

    def test_the_first_by_story_after_resolved_is_the_closing_story(self):
        text = _ledger("resolved 2026-11-09 by Story 38.7 "
                       "(narrows what was resolved by Story 37.4)")
        self.assertEqual(_closures_missing_pr(
            text, "supervisor/run-q-run-epic-38-20261109T142653Z-e4c3e2"), [])
        self.assertEqual(_closures_missing_pr(
            text, "supervisor/run-q-run-epic-37-20261108T090000Z-abc123"), ["DW-1"])

    def test_on_run_branch_its_own_epic_passes_pr_less_and_another_epic_is_missing(self):
        text = _ledger(self.PR_LESS_38, self.PR_LESS_37, self.WITH_PR)
        for branch in ("supervisor/run-q-run-epic-38-20261109T142653Z-e4c3e2", "loop/epic-38"):
            with self.subTest(branch=branch):
                self.assertEqual(_closures_missing_pr(text, branch), ["DW-2"])

    def test_run_branch_naming_no_epic_allows_any_story(self):
        text = _ledger(self.PR_LESS_38, self.PR_LESS_37)
        self.assertEqual(_closures_missing_pr(text, "supervisor/run-q-run-sweep-20261109T095041Z-480ca3"), [])

    def test_failure_message_names_each_id_and_the_pr_form(self):
        msg = _missing_pr_message("main", ["DW-1", "DW-3"])
        self.assertIn("DW-1, DW-3", msg)
        self.assertIn("'main'", msg)
        self.assertIn("by Story N.M (owner/repo#N)", msg)

    def test_git_unavailable_is_a_skip_reason_naming_the_cause(self):
        for exc in (FileNotFoundError(2, "No such file or directory", "git"),
                    subprocess.TimeoutExpired(["git"], 30)):
            with self.subTest(exc=type(exc).__name__), \
                    mock.patch.object(subprocess, "run", side_effect=exc):
                branch, reason = _read_branch(Path("."))
                self.assertIsNone(branch)
                self.assertIn("git unavailable", reason)
                self.assertIn(type(exc).__name__, reason)

    def test_rev_parse_non_zero_is_a_skip_reason_naming_exit_and_stderr(self):
        failed = subprocess.CompletedProcess(["git"], 128, stdout="", stderr="fatal: not a git repository\n")
        with mock.patch.object(subprocess, "run", return_value=failed) as run:
            branch, reason = _read_branch(Path("."))
        self.assertIsNone(branch)
        self.assertIn("exit 128", reason)
        self.assertIn("fatal: not a git repository", reason)
        self.assertEqual(run.call_args.kwargs.get("encoding"), "utf-8")

    def _real_case(self, text):
        case = RealLedgerContentTests(self.REAL_TEST)
        case.repo_root, case.text = Path("."), text
        return getattr(case, self.REAL_TEST)

    def test_real_test_skips_never_passes_when_git_is_unavailable_or_fails(self):
        failed = subprocess.CompletedProcess(["git"], 1, stdout="", stderr="boom")
        for patch, cause in ((dict(side_effect=OSError("no git")), "git unavailable"),
                             (dict(side_effect=subprocess.SubprocessError("x")), "SubprocessError"),
                             (dict(return_value=failed), "exit 1")):
            with self.subTest(cause=cause), mock.patch.object(subprocess, "run", **patch):
                with self.assertRaises(unittest.SkipTest) as cm:
                    self._real_case(_ledger(self.PR_LESS_37))()
                self.assertIn(cause, str(cm.exception))

    def test_real_test_fails_off_run_branch_and_passes_on_its_run_branch(self):
        text = _ledger(self.PR_LESS_38, self.WITH_PR)
        for branch, fails in (("main", True), ("HEAD", True), ("loop/epic-38", False),
                              ("loop/epic-37", True)):
            done = subprocess.CompletedProcess(["git"], 0, stdout=branch + "\n", stderr="")
            with self.subTest(branch=branch), mock.patch.object(subprocess, "run", return_value=done):
                if fails:
                    with self.assertRaises(AssertionError) as cm:
                        self._real_case(text)()
                    self.assertIn("DW-1", str(cm.exception))
                    self.assertIn("by Story N.M (owner/repo#N)", str(cm.exception))
                else:
                    self._real_case(text)()


if __name__ == "__main__":
    unittest.main()
