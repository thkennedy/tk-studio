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



class RereadFreshDestinationTests(unittest.TestCase):
    """Story 38.2 (CAP-6, hole 114, DW-180): every output is re-read after the
    staging rename lands; on a stat or read failure the generation is removed
    and the outputs are written straight into a fresh destination. Registered
    beside DW-110's patch: no registry entry until an upstream issue exists."""

    MARKER = "tk-studio base patch render-skill-reread-fresh-destination"
    COPIES = StagingRenameRetryTests.COPIES
    _renderer = StagingRenameRetryTests._renderer
    test_both_tracked_copies_carry_it_identically = StagingRenameRetryTests.test_both_tracked_copies_carry_it_identically
    OUTPUTS = {"a.md": b"a", "references/b.md": b"b"}
    MANIFEST = {"outputs": {"a.md": "x", "references/b.md": "y"}}

    def test_no_registry_entry_without_an_upstream_issue(self):
        ids = [p["id"] for p in basepatch.load()]
        self.assertNotIn("render-skill-reread-fresh-destination", ids)

    def _land(self, module, stat=None, rmtree=None):
        """`_publish` into a fresh destination, `os.stat` and `shutil.rmtree`
        optionally replaced; answers the destination's files and the calls."""
        real_stat, real_rmtree = os.stat, module.shutil.rmtree
        removed = []

        def tracked_rmtree(path, *args, **kwargs):
            removed.append(Path(path).name)
            return (rmtree or real_rmtree)(path, *args, **kwargs)

        with tempfile.TemporaryDirectory() as tmp, \
                unittest.mock.patch.object(module.os, "stat", stat or real_stat), \
                unittest.mock.patch.object(module.shutil, "rmtree", tracked_rmtree):
            destination = Path(tmp) / "skill" / "slug" / "generation"
            module._publish(destination, dict(self.OUTPUTS), dict(self.MANIFEST))
            files = {p.relative_to(destination).as_posix(): p.read_bytes()
                     for p in destination.rglob("*") if p.is_file()}
            siblings = sorted(p.name for p in destination.parent.iterdir())
        return files, removed, siblings

    def _expected(self, module):
        return {**self.OUTPUTS, "manifest.json": module._manifest_bytes(self.MANIFEST)}

    def test_a_rename_that_reads_back_is_left_as_it_landed(self):
        module = self._renderer()
        stats = []
        real = os.stat

        def counted(path, *args, **kwargs):
            stats.append(Path(path).name)
            return real(path, *args, **kwargs)

        files, removed, siblings = self._land(module, stat=counted)
        self.assertEqual(files, self._expected(module))
        self.assertNotIn("generation", removed)  # no fallback
        self.assertEqual(siblings, ["generation"])
        for name in ("a.md", "b.md", "manifest.json"):
            self.assertIn(name, stats)

    def test_a_stat_failure_removes_the_generation_and_writes_it_direct(self):
        """The stale view (hole 114): the landed generation's entries fail to
        stat once; the fallback removes it, writes every output straight in
        (the manifest last) and the re-read passes."""
        module = self._renderer()
        real, failed = os.stat, []

        def stale_once(path, *args, **kwargs):
            if Path(path).name == "manifest.json" and not failed:
                failed.append(path)
                raise FileNotFoundError(2, "No such file or directory", str(path))
            return real(path, *args, **kwargs)

        files, removed, siblings = self._land(module, stat=stale_once)
        self.assertEqual(len(failed), 1)
        self.assertIn("generation", removed)
        self.assertEqual(files, self._expected(module))
        self.assertEqual(siblings, ["generation"])

    def test_a_removal_that_fails_renames_the_generation_onto_a_fresh_name(self):
        module = self._renderer()
        real, failed, real_rmtree = os.stat, [], module.shutil.rmtree

        def stale_once(path, *args, **kwargs):
            if Path(path).name == "a.md" and not failed:
                failed.append(path)
                raise PermissionError(13, "Permission denied", str(path))
            return real(path, *args, **kwargs)

        def refuses(path, *args, **kwargs):
            if Path(path).name == "generation":
                raise OSError(16, "Device or resource busy")
            return real_rmtree(path, *args, **kwargs)

        files, _removed, siblings = self._land(module, stat=stale_once, rmtree=refuses)
        self.assertEqual(files, self._expected(module))
        self.assertEqual(siblings, ["generation", f"generation.stale-{os.getpid()}"])

    def test_an_unseen_destination_skips_the_rename_and_writes_it_direct(self):
        """The stale view hides the destination folder itself: the re-read
        fails, the removal answers FileNotFoundError with nothing at the path;
        no rename is tried, the outputs are written straight into a fresh
        destination and every file re-reads."""
        module = self._renderer()
        real_rmtree, renamed, stats = module.shutil.rmtree, [], []
        real_stat, failed = os.stat, []

        def stale_once(path, *args, **kwargs):
            if Path(path).name == "a.md" and not failed:
                failed.append(path)
                raise FileNotFoundError(2, "No such file or directory", str(path))
            stats.append(Path(path).name)
            return real_stat(path, *args, **kwargs)

        def unseen(path, *args, **kwargs):
            if Path(path).name == "generation":
                real_rmtree(path)  # the view shows nothing there
                raise FileNotFoundError(2, "No such file or directory", str(path))
            return real_rmtree(path, *args, **kwargs)

        real_rename = module.os.rename

        def tracked_rename(src, dst, *args, **kwargs):
            renamed.append(Path(dst).name)
            return real_rename(src, dst, *args, **kwargs)

        with unittest.mock.patch.object(module.os, "rename", tracked_rename):
            files, removed, siblings = self._land(module, stat=stale_once, rmtree=unseen)
        self.assertEqual(len(failed), 1)
        self.assertIn("generation", removed)
        self.assertFalse([n for n in renamed if ".stale-" in n])  # no rename-aside
        self.assertEqual(files, self._expected(module))
        self.assertEqual(siblings, ["generation"])
        for name in ("a.md", "b.md", "manifest.json"):
            self.assertIn(name, stats)  # every file re-read after the direct write

    def test_a_second_failure_after_the_direct_write_halts_naming_it(self):
        module = self._renderer()
        real = os.stat

        def always_stale(path, *args, **kwargs):
            if Path(path).name == "b.md":
                raise FileNotFoundError(2, "No such file or directory", str(path))
            return real(path, *args, **kwargs)

        with self.assertRaises(module.RenderError) as caught:
            self._land(module, stat=always_stale)
        self.assertRegex(str(caught.exception), r"^failed to verify .*b\.md after a direct write: ")

    def _stale_a(self):
        real, failed = os.stat, []

        def stale_once(path, *args, **kwargs):
            if Path(path).name == "a.md" and not failed:
                failed.append(path)
                raise FileNotFoundError(2, "No such file or directory", str(path))
            return real(path, *args, **kwargs)

        return stale_once

    def test_a_mkdir_failure_in_the_fallback_is_a_render_error(self):
        """The stale view still shows the removed folder: the fresh
        destination's mkdir answers FileExistsError, surfaced as RenderError."""
        module = self._renderer()
        real_mkdir = Path.mkdir

        def shows_it(path, *args, **kwargs):
            if Path(path).name == "generation" and not kwargs.get("exist_ok"):
                raise FileExistsError(17, "File exists", str(path))
            return real_mkdir(path, *args, **kwargs)

        with unittest.mock.patch.object(module.Path, "mkdir", shows_it), \
                self.assertRaises(module.RenderError) as caught:
            self._land(module, stat=self._stale_a())
        self.assertRegex(str(caught.exception), r"^failed to verify .*generation after a direct write: .*File exists")

    def test_a_write_failure_in_the_fallback_is_a_render_error(self):
        module = self._renderer()
        real_write = Path.write_bytes

        def refuses(path, data):
            if "generation" in Path(path).parts and Path(path).name == "a.md":
                raise PermissionError(13, "Permission denied", str(path))
            return real_write(path, data)

        with unittest.mock.patch.object(module.Path, "write_bytes", refuses), \
                self.assertRaises(module.RenderError) as caught:
            self._land(module, stat=self._stale_a())
        self.assertRegex(str(caught.exception), r"^failed to verify .*generation[\\/]a\.md after a direct write: .*Permission denied")

    def test_an_existing_stale_name_is_never_renamed_onto(self):
        """`.stale-<pid>` already held (an earlier fallback): the rename picks
        `.stale-<pid>-1`, the earlier folder left as it was."""
        module = self._renderer()
        real_rmtree = module.shutil.rmtree

        def refuses(path, *args, **kwargs):
            if Path(path).name == "generation":
                raise OSError(16, "Device or resource busy")
            return real_rmtree(path, *args, **kwargs)

        real_publish = module._publish

        def publish_beside_a_held_name(destination, outputs, manifest):
            held = destination.with_name(f"{destination.name}.stale-{os.getpid()}")
            held.mkdir(parents=True)
            (held / "keep.md").write_bytes(b"earlier")
            return real_publish(destination, outputs, manifest)

        with unittest.mock.patch.object(module, "_publish", publish_beside_a_held_name):
            files, _removed, siblings = self._land(module, stat=self._stale_a(), rmtree=refuses)
        self.assertEqual(files, self._expected(module))
        pid = os.getpid()
        self.assertEqual(siblings, ["generation", f"generation.stale-{pid}", f"generation.stale-{pid}-1"])


if __name__ == "__main__":
    unittest.main()
