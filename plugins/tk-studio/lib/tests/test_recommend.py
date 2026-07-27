"""Tests for recommend/confirm/record (ST-4.3 acceptance criteria).

Proposals carry evidence per resource and never write; recording lands only
on explicit confirmation under working_set.<role>, idempotently, without
touching any other role's entry.
"""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config as configlib  # noqa: E402
import recommend  # noqa: E402

LOCK = """\
lock_version: 1
core:
  package: bmad-method
  version: 6.10.0
install:
  flags:
    - --yes
modules:
  bmm:
    version: 6.10.0
  tea:
    version: v1.19.1
  gds:
    version: v0.6.0
  cis:
    version: v0.2.1
"""


def _tree_snapshot(root: Path) -> dict[str, float]:
    return {str(p.relative_to(root)): (p.stat().st_mtime if p.is_file() else 0)
            for p in root.rglob("*")}


class RecommendTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        os.environ["TK_STUDIO_HOME"] = str(base / "store")
        self.root = base / "proj"
        self.root.mkdir()
        self.lock = base / "bmad.lock"
        self.lock.write_text(LOCK, encoding="utf-8", newline="\n")

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()

    def _make_unreal(self):
        (self.root / "MyGame.uproject").write_text("{}", encoding="utf-8")
        (self.root / "Source").mkdir()
        (self.root / "Config").mkdir()

    def _make_user_skill(self):
        d = self.root / ".claude" / "skills" / "my-reviewer"
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text(
            "---\nname: my-reviewer\ndescription: Mine.\n---\n", encoding="utf-8")

    def _propose(self, role="developer"):
        return recommend.propose(self.root, role=role, lock_path=self.lock)

    def _standup(self):
        configlib.standup_project_config(self.root)

    # --- AC 1: proposal carries evidence; dry-run writes nothing

    def test_proposal_carries_evidence_per_resource(self):
        self._make_unreal()
        self._make_user_skill()
        result = self._propose()
        names = {e["name"] for e in result["proposal"]}
        self.assertIn("gds", names)          # detection suggests
        self.assertIn("bmm", names)          # role default
        self.assertIn("my-reviewer", names)  # user-authored, first-class
        for entry in result["proposal"]:
            self.assertTrue(entry["evidence"], f"{entry['name']} has no evidence")
        gds = next(e for e in result["proposal"] if e["name"] == "gds")
        self.assertTrue(any("detected game-unreal" in ev for ev in gds["evidence"]))
        mine = next(e for e in result["proposal"] if e["name"] == "my-reviewer")
        self.assertTrue(any("authored in this project" in ev for ev in mine["evidence"]))

    def test_propose_is_read_only(self):
        self._make_unreal()
        self._standup()
        before = _tree_snapshot(self.root)
        self._propose()
        self.assertEqual(before, _tree_snapshot(self.root))

    def test_ask_outcome_adds_no_detection_suggestions(self):
        result = self._propose()  # empty project → unknown — ask
        self.assertEqual(result["detection_outcome"], "unknown — ask")
        names = {e["name"] for e in result["proposal"]}
        self.assertEqual(names, {"bmm", "tea"})  # role base only
        self.assertTrue(any("ask the operator" in n for n in result["notes"]))

    def test_role_changes_the_proposal(self):
        dev = self._propose(role="developer")
        giver = self._propose(role="direction-giver")
        self.assertIn("tea", {e["name"] for e in dev["proposal"]})
        self.assertIn("cis", {e["name"] for e in giver["proposal"]})

    # --- AC 2: explicit confirmation → working_set.<role>, idempotent

    def test_record_lands_role_keyed_and_is_idempotent(self):
        self._standup()
        result = recommend.record(self.root, "developer", ["bmm", "tea"])
        self.assertTrue(result["changed"])
        self.assertEqual(recommend.read_working_set(self.root),
                         {"developer": ["bmm", "tea"]})
        tracked = self.root / ".tk-studio" / "config.yaml"
        text_after_first = tracked.read_text(encoding="utf-8")
        again = recommend.record(self.root, "developer", ["bmm", "tea"])
        self.assertFalse(again["changed"])
        self.assertEqual(tracked.read_text(encoding="utf-8"), text_after_first)

    def test_record_preserves_template_comments(self):
        self._standup()
        tracked = self.root / ".tk-studio" / "config.yaml"
        before = tracked.read_text(encoding="utf-8")
        recommend.record(self.root, "developer", ["bmm"])
        after = tracked.read_text(encoding="utf-8")
        for line in before.splitlines():
            if line.lstrip().startswith("#"):
                self.assertIn(line, after.splitlines())

    def test_record_dry_run_writes_nothing(self):
        self._standup()
        tracked = self.root / ".tk-studio" / "config.yaml"
        before = tracked.read_text(encoding="utf-8")
        result = recommend.record(self.root, "developer", ["bmm"], dry_run=True)
        self.assertTrue(result["dry_run"])
        self.assertEqual(tracked.read_text(encoding="utf-8"), before)
        self.assertEqual(result["working_set"]["developer"], ["bmm"])

    def test_record_requires_standup_and_nonempty_set(self):
        with self.assertRaises(recommend.RecommendError):
            recommend.record(self.root, "developer", ["bmm"])  # no config yet
        self._standup()
        with self.assertRaises(recommend.RecommendError):
            recommend.record(self.root, "developer", [])
        with self.assertRaises(recommend.RecommendError):
            recommend.record(self.root, "Bad Role!", ["bmm"])

    # --- AC 3: a second role never touches the first role's entry

    def test_second_role_leaves_first_untouched(self):
        self._standup()
        recommend.record(self.root, "developer", ["bmm", "tea"])
        tracked = self.root / ".tk-studio" / "config.yaml"
        dev_lines = [l for l in tracked.read_text(encoding="utf-8").splitlines()
                     if l.startswith(("  developer:", "    - "))]
        recommend.record(self.root, "direction-giver", ["bmm", "cis"])
        ws = recommend.read_working_set(self.root)
        self.assertEqual(ws["developer"], ["bmm", "tea"])
        self.assertEqual(ws["direction-giver"], ["bmm", "cis"])
        after = tracked.read_text(encoding="utf-8").splitlines()
        for line in dev_lines:
            self.assertIn(line, after)

    def test_reconfirming_one_role_updates_only_that_role(self):
        self._standup()
        recommend.record(self.root, "developer", ["bmm"])
        recommend.record(self.root, "direction-giver", ["cis"])
        recommend.record(self.root, "developer", ["bmm", "tea", "gds"])
        ws = recommend.read_working_set(self.root)
        self.assertEqual(ws["developer"], ["bmm", "tea", "gds"])
        self.assertEqual(ws["direction-giver"], ["cis"])

    def test_recorded_file_still_parses_and_resolves(self):
        self._standup()
        recommend.record(self.root, "developer", ["bmm", "tea"])
        value, scope = configlib.resolve("working_set.developer",
                                         project_root=self.root)
        self.assertEqual(value, ["bmm", "tea"])
        self.assertEqual(scope, "project-tracked")


if __name__ == "__main__":
    unittest.main()
