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
from unittest import mock
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
                      "(sweep bundle dw-alpha; resolved by sweep bundle dw-alpha)\n"
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

    def test_an_open_or_absent_entry_is_pending_and_ok(self):
        path = self._ledger()
        before = path.read_bytes()
        code, out = self._cli("--pr", "thkennedy/tk-studio#300", "--ids", "DW-2,DW-9",
                              "--date", "2026-10-30")
        self.assertEqual(code, 0)
        self.assertTrue(out["ok"])
        self.assertEqual(out["pending"], ["DW-2", "DW-9"])
        self.assertEqual(out["status"], "partial")
        self.assertEqual(path.read_bytes(), before)

    def test_the_date_flag_wins_and_the_rest_of_the_ledger_is_kept(self):
        path = self._ledger()
        self._cli("--pr", "thkennedy/tk-studio#300", "--ids", "DW-1", "--date", "2026-11-01")
        text = path.read_text(encoding="utf-8")
        self.assertEqual(text, LEDGER_DOC.replace(
            "status: done 2026-10-29",
            "status: resolved 2026-11-01 by thkennedy/tk-studio#300 "
            "(sweep bundle dw-alpha; resolved by sweep bundle dw-alpha)"))

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


if __name__ == "__main__":
    unittest.main()
