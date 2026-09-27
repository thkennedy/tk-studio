"""base_update.py's unit suite — the lock-editing helpers and the step-4
install invocation. The EP-011 churn normalizer (step 4.5) lives in
lib/bmadchurn.py and is covered by test_bmadchurn.py.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PLUGIN_ROOT / "lib"))
sys.path.insert(0, str(PLUGIN_ROOT / "skills" / "tk-studio-base-update" / "scripts"))

import base_update  # noqa: E402


class LockEditingTestCase(unittest.TestCase):
    LOCK = ("lock_version: 1\n"
            "core:\n  package: bmad-method\n  version: 6.10.0\n"
            "modules:\n"
            "  tea:\n    version: v1.19.1\n    sha: aaa\n"
            "  bmad-loop:\n    version: v0.9.0\n    sha: bbb\n")

    def test_bump_core_and_module(self):
        out = base_update.bump_lock_text(self.LOCK, "6.11.0", {"tea": "v1.21.7"})
        self.assertIn("version: 6.11.0", out)
        self.assertIn("version: v1.21.7", out)
        self.assertIn("version: v0.9.0", out)  # untouched module

    def test_unknown_module_raises(self):
        with self.assertRaises(ValueError):
            base_update.bump_lock_text(self.LOCK, None, {"nope": "v1"})

    def test_sync_shas(self):
        out = base_update.sync_shas_text(self.LOCK, {"tea": "ccc"})
        self.assertIn("sha: ccc", out)
        self.assertIn("sha: bbb", out)


class InstallArgvTestCase(unittest.TestCase):
    def test_step4_install_leaves_normalization_to_step_4_5(self):
        # install_base normalizes by default; the motion must opt out so its
        # own step 4.5 keeps the restore-on-crash posture and the per-class
        # counts in the result JSON (a pre-normalized tree would report 0)
        argv = base_update.install_argv(Path("/repo"), 900)
        self.assertEqual(argv[1], str(base_update.INSTALL_SCRIPT))
        self.assertIn("--no-normalize", argv)
        self.assertEqual(argv[argv.index("--timeout") + 1], "900")


if __name__ == "__main__":
    unittest.main()
