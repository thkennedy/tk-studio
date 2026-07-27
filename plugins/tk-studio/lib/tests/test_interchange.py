"""Tests for the canonical interchange shape + validator (ST-3.1 acceptance criteria)."""
from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import interchange  # noqa: E402


def entity_front(**overrides) -> dict:
    front = {
        "shape_version": 1,
        "id": "ST-001",
        "type": "story",
        "title": "A story",
        "status": "draft",
        "created": "2026-07-26T00:00:00+00:00",
        "updated": "2026-07-26T00:00:00+00:00",
    }
    front.update(overrides)
    return front


class InterchangeTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def _write(self, rel: str, front: dict, body: str = "\n# Body\n") -> Path:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(interchange.render_entity(front, body),
                        encoding="utf-8", newline="\n")
        return path


class RequiredKeyTests(InterchangeTestCase):
    def test_valid_minimal_entity_passes(self):
        self.assertEqual(interchange.validate_entity(entity_front()), [])

    def test_valid_epic_and_task(self):
        epic = entity_front(id="EP-001", type="epic")
        task = entity_front(id="TA-042", type="task", parent="ST-001")
        self.assertEqual(interchange.validate_entity(epic), [])
        self.assertEqual(interchange.validate_entity(task), [])

    def test_missing_required_keys_named(self):
        errors = interchange.validate_entity({"shape_version": 1})
        self.assertEqual(len(errors), 1)
        for key in ("id", "type", "title", "status", "created", "updated"):
            self.assertIn(key, errors[0])

    def test_wrong_shape_version(self):
        errors = interchange.validate_entity(entity_front(shape_version=2))
        self.assertTrue(any("shape_version" in e for e in errors))

    def test_status_enum_is_closed(self):
        for status in ("draft", "ready", "in-progress", "blocked",
                       "review", "done", "dropped"):
            self.assertEqual(
                interchange.validate_entity(entity_front(status=status)), [])
        errors = interchange.validate_entity(entity_front(status="todo"))
        self.assertTrue(any("closed enum" in e for e in errors))

    def test_id_pattern_and_type_prefix(self):
        errors = interchange.validate_entity(entity_front(id="STORY-1"))
        self.assertTrue(any("EP-/ST-/TA-NNN" in e for e in errors))
        errors = interchange.validate_entity(entity_front(id="EP-001"))
        self.assertTrue(any("does not match type story" in e for e in errors))

    def test_bad_dates(self):
        errors = interchange.validate_entity(entity_front(created="yesterday"))
        self.assertTrue(any("created" in e and "ISO-8601" in e for e in errors))

    def test_empty_title(self):
        errors = interchange.validate_entity(entity_front(title="  "))
        self.assertTrue(any("title" in e for e in errors))

    def test_unknown_keys_preserved_and_ignored(self):
        front = entity_front(epic_number=3, story_key="upstream")
        self.assertEqual(interchange.validate_entity(front), [])


class OptionalKeyTests(InterchangeTestCase):
    def test_parent_rules(self):
        errors = interchange.validate_entity(
            entity_front(id="EP-001", type="epic", parent="EP-000"))
        self.assertTrue(any("epic has no parent" in e for e in errors))
        errors = interchange.validate_entity(entity_front(parent="TA-001"))
        self.assertTrue(any("must be EP-NNN" in e for e in errors))
        errors = interchange.validate_entity(
            entity_front(id="TA-001", type="task", parent="EP-001"))
        self.assertTrue(any("must be ST-NNN" in e for e in errors))

    def test_depends_on_rules(self):
        self.assertEqual(interchange.validate_entity(
            entity_front(depends_on=["ST-002", "EP-001"])), [])
        errors = interchange.validate_entity(entity_front(depends_on="ST-002"))
        self.assertTrue(any("must be a list" in e for e in errors))
        errors = interchange.validate_entity(entity_front(depends_on=["ST-001"]))
        self.assertTrue(any("entity itself" in e for e in errors))
        errors = interchange.validate_entity(
            entity_front(depends_on=["ST-002", "ST-002"]))
        self.assertTrue(any("duplicates" in e for e in errors))

    def test_priority_enum(self):
        self.assertEqual(interchange.validate_entity(entity_front(priority="P2")), [])
        errors = interchange.validate_entity(entity_front(priority="high"))
        self.assertTrue(any("priority" in e for e in errors))

    def test_labels_and_assignee(self):
        self.assertEqual(interchange.validate_entity(
            entity_front(labels=["backend", "epic-3"], assignee="tim")), [])
        errors = interchange.validate_entity(entity_front(labels=["ok", ""]))
        self.assertTrue(any("labels" in e for e in errors))
        errors = interchange.validate_entity(entity_front(assignee=""))
        self.assertTrue(any("assignee" in e for e in errors))

    def test_external_map(self):
        good = entity_front(external={"backlog-md": {
            "key": "task-12", "synced_at": "2026-07-26T01:00:00+00:00",
            "content_hash": "abc123", "original_status": "To Do"}})
        self.assertEqual(interchange.validate_entity(good), [])
        errors = interchange.validate_entity(entity_front(
            external={"backlog-md": {"key": "task-12"}}))
        joined = " ".join(errors)
        self.assertIn("synced_at", joined)
        self.assertIn("content_hash", joined)
        errors = interchange.validate_entity(entity_front(external="backlog-md"))
        self.assertTrue(any("external must be a map" in e for e in errors))


class FileAndSetTests(InterchangeTestCase):
    def test_round_trip_render_parse(self):
        front = entity_front(labels=["a"], external={"backlog-md": {
            "key": "t-1", "synced_at": "2026-07-26T00:00:00+00:00",
            "content_hash": "h"}})
        path = self._write("ST-001.md", front, "\n## Acceptance Criteria\n\n- [ ] one\n")
        parsed, body = interchange.parse_entity(path)
        self.assertEqual(parsed, front)
        self.assertIn("## Acceptance Criteria", body)

    def test_file_without_frontmatter_errors(self):
        path = self.root / "plain.md"
        path.write_text("# Just markdown\n", encoding="utf-8")
        record = interchange.validate_file(path)
        self.assertTrue(any("no YAML frontmatter" in e for e in record["errors"]))

    def test_directory_scan_skips_non_entities(self):
        self._write("EP-001.md", entity_front(id="EP-001", type="epic"))
        (self.root / "notes.md").write_text("# Notes\n", encoding="utf-8")
        (self.root / "fm.md").write_text("---\ntitle: no marker\n---\nbody\n",
                                         encoding="utf-8")
        result = interchange.validate_directory(self.root)
        self.assertTrue(result["ok"])
        self.assertEqual(result["entities"], 1)
        self.assertEqual(result["skipped"], 2)

    def test_duplicate_ids_name_both_paths(self):
        a = self._write("a/ST-001.md", entity_front())
        b = self._write("b/ST-001.md", entity_front(title="Other"))
        result = interchange.validate_directory(self.root)
        self.assertFalse(result["ok"])
        dup = [e for e in result["set_errors"] if "duplicate id ST-001" in e]
        self.assertEqual(len(dup), 1)
        self.assertIn(str(a), dup[0])
        self.assertIn(str(b), dup[0])

    def test_dangling_parent_and_depends_on(self):
        self._write("ST-001.md", entity_front(parent="EP-009",
                                              depends_on=["ST-777"]))
        result = interchange.validate_directory(self.root)
        self.assertFalse(result["ok"])
        joined = " ".join(result["set_errors"])
        self.assertIn("parent EP-009 not found", joined)
        self.assertIn("depends_on ST-777 not found", joined)

    def test_consistent_set_passes(self):
        self._write("EP-001.md", entity_front(id="EP-001", type="epic"))
        self._write("ST-001.md", entity_front(parent="EP-001"))
        self._write("TA-001.md", entity_front(id="TA-001", type="task",
                                              parent="ST-001",
                                              depends_on=["EP-001"]))
        result = interchange.validate_directory(self.root)
        self.assertTrue(result["ok"])
        self.assertEqual(result["entities"], 3)
        self.assertEqual(result["set_errors"], [])


class CliTests(InterchangeTestCase):
    def _run(self, *argv) -> tuple[int, dict]:
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = interchange.main(list(argv))
        return code, json.loads(buffer.getvalue())

    def test_validate_file_ok(self):
        path = self._write("ST-001.md", entity_front())
        code, out = self._run("validate", "--file", str(path))
        self.assertEqual(code, 0)
        self.assertTrue(out["ok"])
        self.assertEqual(out["id"], "ST-001")

    def test_validate_file_errors_exit_2(self):
        path = self._write("ST-001.md", entity_front(status="todo"))
        code, out = self._run("validate", "--file", str(path))
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])
        self.assertTrue(out["errors"])

    def test_validate_directory_json(self):
        self._write("EP-001.md", entity_front(id="EP-001", type="epic"))
        code, out = self._run("validate", "--directory", str(self.root))
        self.assertEqual(code, 0)
        self.assertTrue(out["ok"])
        self.assertEqual(out["entities"], 1)

    def test_missing_directory_refusal(self):
        code, out = self._run("validate", "--directory",
                              str(self.root / "absent"))
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])


if __name__ == "__main__":
    unittest.main()
