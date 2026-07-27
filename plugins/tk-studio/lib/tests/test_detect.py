"""Tests for read-only project detection (ST-4.2 acceptance criteria).

Weighted markers score candidate types; below the confidence floor the result
is an ask ("unknown — ask" / "ambiguous — ask"), never a guess. Detection
performs zero writes and lists the evidence behind every scored marker.
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import detect  # noqa: E402

PROFILES_DIR = detect.DEFAULT_PROFILES_DIR


def _tree_snapshot(root: Path) -> set[str]:
    return {str(p.relative_to(root)) for p in root.rglob("*")}


class DetectTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def _project(self, name: str) -> Path:
        root = self.base / name
        root.mkdir(parents=True, exist_ok=True)
        return root

    def _unreal(self) -> Path:
        root = self._project("ue")
        (root / "MyGame.uproject").write_text("{}", encoding="utf-8")
        (root / "Source").mkdir()
        (root / "Config").mkdir()
        (root / ".git").mkdir()
        return root

    # --- AC: weighted markers score candidate types

    def test_unreal_project_detected_confidently(self):
        result = detect.detect(self._unreal())
        self.assertEqual(result["outcome"], "confident")
        self.assertEqual(result["top_candidate"], "game-unreal")
        top = result["candidates"][0]
        self.assertEqual(top["id"], "game-unreal")
        self.assertGreaterEqual(top["score"], top["confidence_min"])
        self.assertEqual(result["vcs"]["type"], "git")

    def test_evidence_listed_behind_every_scored_marker(self):
        result = detect.detect(self._unreal())
        top = result["candidates"][0]
        self.assertEqual(sum(e["weight"] for e in top["evidence"]), top["score"])
        for entry in top["evidence"]:
            self.assertTrue(entry["evidence"])  # human-readable marker text
            self.assertTrue(entry["match"])     # the concrete thing that matched
        matches = {e["match"] for e in top["evidence"]}
        self.assertIn("MyGame.uproject", matches)

    # --- AC: below the floor → "unknown — ask", never a guess

    def test_empty_project_is_unknown_ask(self):
        result = detect.detect(self._project("empty"))
        self.assertEqual(result["outcome"], "unknown — ask")
        self.assertIsNone(result["top_candidate"])

    def test_below_floor_is_unknown_ask_not_a_guess(self):
        root = self._project("weak")
        (root / "requirements.txt").write_text("requests\n", encoding="utf-8")
        result = detect.detect(root)  # python-app scores 1 < floor 4
        self.assertEqual(result["outcome"], "unknown — ask")
        self.assertEqual(result["top_candidate"], "python-app")  # named, not chosen

    def test_close_scores_are_ambiguous_ask(self):
        root = self._project("both")
        # Unity-ish and Unreal-ish markers together, same score
        (root / "Assets").mkdir()
        (root / "ProjectSettings").mkdir()
        (root / "Source").mkdir()
        (root / "Config").mkdir()
        (root / "MyGame.uproject").write_text("{}", encoding="utf-8")
        (root / "Packages").mkdir()
        (root / "ProjectSettings" / "ProjectVersion.txt").write_text(
            "m_EditorVersion: 6000.0.1\n", encoding="utf-8")
        result = detect.detect(root)
        self.assertEqual(result["outcome"], "ambiguous — ask")

    # --- AC: zero writes

    def test_detection_performs_zero_writes(self):
        root = self._unreal()
        before = _tree_snapshot(root)
        detect.detect(root)
        self.assertEqual(before, _tree_snapshot(root))

    # --- registry + plumbing

    def test_shipped_profiles_are_valid(self):
        profiles = detect.load_profiles(PROFILES_DIR)
        self.assertGreaterEqual(len(profiles), 5)
        for profile in profiles:
            self.assertIn("id", profile)
            det = profile["detection"]
            self.assertGreaterEqual(int(det["confidence_min"]), 1)
            for marker in det["markers"]:
                self.assertIn(marker["kind"],
                              ("file_glob", "dir_exists", "file_content", "vcs"))
                self.assertGreater(int(marker["weight"]), 0)
                self.assertTrue(marker["evidence"])
            # every profile must be reachable: markers can sum past the floor
            self.assertGreaterEqual(
                sum(int(m["weight"]) for m in det["markers"]),
                int(det["confidence_min"]))

    def test_content_probe_and_suggests(self):
        root = self._project("web")
        (root / "package.json").write_text(
            json.dumps({"dependencies": {"react": "^19.0.0"}}), encoding="utf-8")
        (root / "tsconfig.json").write_text("{}", encoding="utf-8")
        result = detect.detect(root)
        self.assertEqual(result["outcome"], "confident")
        self.assertEqual(result["top_candidate"], "web-node")
        self.assertIn("wds", result["candidates"][0]["suggests"])

    def test_perforce_vcs_detected(self):
        root = self._project("p4")
        (root / ".p4config").write_text("P4CLIENT=me\n", encoding="utf-8")
        result = detect.detect(root)
        self.assertEqual(result["vcs"]["type"], "perforce")

    def test_missing_root_raises(self):
        with self.assertRaises(detect.DetectError):
            detect.detect(self.base / "nope")

    def test_pruned_dirs_not_walked(self):
        root = self._project("pruned")
        deep = root / "node_modules" / "somepkg"
        deep.mkdir(parents=True)
        (deep / "project.godot").write_text("", encoding="utf-8")
        result = detect.detect(root)
        godot = next(c for c in result["candidates"] if c["id"] == "game-godot")
        self.assertEqual(godot["score"], 0)


if __name__ == "__main__":
    unittest.main()
