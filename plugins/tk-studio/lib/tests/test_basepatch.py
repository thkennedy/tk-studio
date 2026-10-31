"""lib/basepatch.py: studio-managed base patches to installer-owned BMad files.

Load-bearing guarantees:
- A patch lands only on the exact upstream text it was verified against.
- It is idempotent.
- It is never applied blind: a changed upstream text or an unverified core
  version is reported and the file is left alone.
- `tk install` re-applies it, so a reinstall cannot silently revert it.
Also pinned: the shipped registry's render_skill.py patch against the
installed 6.11.0 renderer text.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PLUGIN_ROOT / "lib"))

import basepatch  # noqa: E402

STOCK = (
    "def _resolve_short_config(central, key, project_root):\n"
    "    matches = _find_config_values(central, key)\n"
    "    if not matches:\n"
    "        raise RenderError(f\"missing config value `{key}`\")\n"
    "    if len(matches) > 1:\n"
    "        paths = \", \".join(path for path, _ in matches)\n"
    "        raise RenderError(f\"ambiguous config value `{key}` found at: {paths}\")\n"
)


class BasePatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.target = self.root / "_bmad" / "scripts" / "render_skill.py"
        self.target.parent.mkdir(parents=True)
        self.patches = basepatch.load()
        self.patch = self.patches[0]

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, text: str, crlf: bool = False) -> None:
        data = text.replace("\n", "\r\n") if crlf else text
        self.target.write_bytes(data.encode("utf-8"))

    def test_registry_loads_and_every_patch_carries_its_marker(self):
        for p in self.patches:
            self.assertIn(p["marker"], p["replace"])
            self.assertTrue(p["upstream_issue"].startswith("https://"))

    def test_pending_then_patched_then_idempotent(self):
        self.write(STOCK)
        self.assertEqual(basepatch.check(self.root, "6.11.0", self.patches)[0]["status"], "pending")
        rows = basepatch.apply(self.root, "6.11.0", self.patches)
        self.assertEqual(rows[0]["status"], "patched")
        text = self.target.read_text(encoding="utf-8")
        self.assertIn(self.patch["marker"], text)
        self.assertIn("if len(distinct) > 1:", text)
        self.assertIn("raise RenderError(f\"ambiguous config value", text)
        again = basepatch.apply(self.root, "6.11.0", self.patches)
        self.assertEqual(again[0]["status"], "applied")
        self.assertEqual(self.target.read_text(encoding="utf-8"), text)

    def test_crlf_target_keeps_its_line_endings(self):
        self.write(STOCK, crlf=True)
        self.assertEqual(basepatch.apply(self.root, "6.11.0", self.patches)[0]["status"], "patched")
        raw = self.target.read_bytes()
        self.assertNotIn(b"\n", raw.replace(b"\r\n", b""))

    def test_dry_run_writes_nothing(self):
        self.write(STOCK)
        rows = basepatch.apply(self.root, "6.11.0", self.patches, dry_run=True)
        self.assertEqual(rows[0]["status"], "pending")
        self.assertEqual(self.target.read_text(encoding="utf-8"), STOCK)

    def test_changed_upstream_text_is_stale_and_untouched(self):
        changed = STOCK.replace("if len(matches) > 1:", "if len(set(map(str, matches))) > 1:")
        self.write(changed)
        rows = basepatch.apply(self.root, "6.11.0", self.patches)
        self.assertEqual(rows[0]["status"], "stale")
        self.assertEqual(self.target.read_text(encoding="utf-8"), changed)
        self.assertFalse(basepatch.healthy(rows))

    def test_unverified_core_with_defect_is_reported_not_patched(self):
        self.write(STOCK)
        rows = basepatch.apply(self.root, "9.9.9", self.patches)
        self.assertEqual(rows[0]["status"], "unverified-core")
        self.assertEqual(self.target.read_text(encoding="utf-8"), STOCK)

    def test_missing_target_is_not_applicable(self):
        rows = basepatch.check(self.root, "6.11.0", self.patches)
        self.assertEqual(rows[0]["status"], "not-applicable")
        self.assertTrue(basepatch.healthy(rows))

    def test_duplicate_find_text_is_stale(self):
        self.write(STOCK + STOCK)
        self.assertEqual(basepatch.apply(self.root, "6.11.0", self.patches)[0]["status"], "stale")

    def test_registry_errors_refuse(self):
        bad = self.root / "patches.json"
        bad.write_text(json.dumps({"patches": [{"id": "x", "target": "t"}]}), encoding="utf-8")
        with self.assertRaises(basepatch.PatchError):
            basepatch.load(bad)
        bad.write_text(json.dumps({"patches": [dict(self.patch, marker="absent-marker")]}),
                       encoding="utf-8")
        with self.assertRaises(basepatch.PatchError):
            basepatch.load(bad)

    def test_shipped_patch_matches_the_installed_renderer(self):
        """The registry's find text is the pinned 6.11.0 renderer's own text: the
        committed renderer (patched in this repo) carries the marker, and removing
        the patch restores exactly one find match."""
        repo = PLUGIN_ROOT.parents[1]
        installed = repo / self.patch["target"]
        if not installed.is_file():
            self.skipTest("no installed base in this checkout")
        text = installed.read_text(encoding="utf-8")
        self.assertIn(self.patch["marker"], text)
        restored = text.replace(self.patch["replace"], self.patch["find"], 1)
        self.assertEqual(restored.count(self.patch["find"]), 1)


class StagingRenameRetryTests(unittest.TestCase):
    """Story 36.3 (DW-110, hole 95). The registry entry waits for its upstream
    issue URL, so the pin is on the two tracked copies themselves."""

    MARKER = "tk-studio base patch render-skill-staging-rename-retry"
    COPIES = ("_bmad/scripts/render_skill.py", "apps/supervisor/_bmad/scripts/render_skill.py")

    def _renderer(self):
        repo = PLUGIN_ROOT.parents[1]
        path = repo / self.COPIES[0]
        if not path.is_file():
            self.skipTest("no installed base in this checkout")
        sys.path.insert(0, str(path.parent))
        self.addCleanup(sys.path.remove, str(path.parent))
        spec = importlib.util.spec_from_file_location("render_skill_under_test", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_both_tracked_copies_carry_it_identically(self):
        repo = PLUGIN_ROOT.parents[1]
        texts = [(repo / rel).read_text(encoding="utf-8") for rel in self.COPIES if (repo / rel).is_file()]
        if not texts:
            self.skipTest("no installed base in this checkout")
        for text in texts:
            self.assertEqual(text.count(self.MARKER), 1)
        self.assertEqual(len(set(texts)), 1)

    def test_no_registry_entry_without_an_upstream_issue(self):
        ids = [p["id"] for p in basepatch.load()]
        self.assertNotIn("render-skill-staging-rename-retry", ids)

    def _publish(self, rename, module):
        with tempfile.TemporaryDirectory() as tmp, \
                unittest.mock.patch.object(module.os, "rename", rename), \
                unittest.mock.patch("time.sleep") as sleep:
            destination = Path(tmp) / "skill" / "generation"
            try:
                module._publish(destination, {"a.md": b"a"}, {"outputs": {"a.md": "x"}})
            finally:
                self.sleeps = sleep.call_count

    def test_the_rename_retries_on_permission_error_then_lands(self):
        module = self._renderer()
        real, calls = os.rename, []

        def flaky(src, dst):
            calls.append(src)
            if len(calls) < 3:
                raise PermissionError(13, "Permission denied")
            real(src, dst)

        self._publish(flaky, module)
        self.assertEqual((len(calls), self.sleeps), (3, 2))

    def test_the_retry_goes_on_over_an_empty_destination(self):
        """Story 36.3: the mounted rename left an empty generation folder (hole 95)."""
        module = self._renderer()
        real, calls, landed = os.rename, [], []

        def leaves_it_empty(src, dst):
            calls.append(src)
            if len(calls) == 1:
                Path(dst).mkdir()
                raise PermissionError(13, "Permission denied")
            real(src, dst)
            landed.extend(sorted(os.listdir(dst)))

        self._publish(leaves_it_empty, module)
        self.assertEqual((len(calls), self.sleeps), (2, 1))
        self.assertEqual(landed, ["a.md", "manifest.json"])

    def test_a_non_empty_destination_raises_at_the_first_failure(self):
        """Story 36.3: another writer's generation: no retry over it."""
        module = self._renderer()
        calls = []

        def someone_elses(src, dst):
            calls.append(src)
            Path(dst).mkdir()
            (Path(dst) / "other.md").write_bytes(b"other")
            raise PermissionError(13, "Permission denied")

        with self.assertRaises(Exception):
            self._publish(someone_elses, module)
        self.assertEqual(len(calls), 1)

    def test_the_retry_is_bounded_at_five_tries(self):
        module = self._renderer()
        calls = []

        def refused(src, dst):
            calls.append(src)
            raise PermissionError(13, "Permission denied")

        with self.assertRaises(PermissionError):
            self._publish(refused, module)
        self.assertEqual((len(calls), self.sleeps), (5, 4))

    def test_another_oserror_is_not_retried(self):
        module = self._renderer()
        calls = []

        def broken(src, dst):
            calls.append(src)
            raise OSError(28, "No space left on device")

        with self.assertRaises(OSError):
            self._publish(broken, module)
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
