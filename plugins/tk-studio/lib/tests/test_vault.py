"""Tests for the Obsidian vault window (ST-2.5 acceptance criteria).

Runs real links: directory junctions on Windows (no admin), symlinks elsewhere.
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import registry  # noqa: E402
import vault  # noqa: E402


class VaultTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self.user_root = base / ".tk-studio"
        self.vault = base / "vault"
        self.vault.mkdir()
        self.project = base / "proj"
        (self.project / "kb").mkdir(parents=True)
        (self.project / "backlog").mkdir()
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        os.environ["TK_STUDIO_HOME"] = str(self.user_root)
        registry.register(self.project, writer="onboard")

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()

    def _configure_vault(self, path: Path | None = None):
        target = path if path is not None else self.vault
        config = self.user_root / "config.yaml"
        config.parent.mkdir(parents=True, exist_ok=True)
        config.write_text(
            f"user_name: t\nrole: developer\nmachine_id: m\n"
            f'obsidian_vault: "{target}"\n', encoding="utf-8")


class UnconfiguredTests(VaultTestCase):
    def test_link_skips_cleanly_without_vault(self):
        # AC 3: vault is a view, never a dependency.
        result = vault.link_project("proj")
        self.assertTrue(result["skipped"])
        self.assertEqual(result["state"], "unconfigured")
        self.assertEqual(registry.read_project("proj")["vault_link"], "unconfigured")

    def test_check_reports_unconfigured_as_ok(self):
        result = vault.check_links("proj")
        self.assertEqual(result["state"], "unconfigured")


class LinkTests(VaultTestCase):
    def test_link_creates_kb_and_backlog_links(self):
        self._configure_vault()
        result = vault.link_project("proj")
        self.assertEqual(result["state"], "linked")
        folder = self.vault / "projects" / "proj"
        for name, target_name in (("kb", "kb"), ("backlog", "backlog")):
            link = folder / name
            self.assertTrue(link.is_dir(), name)
            self.assertEqual(link.resolve(), (self.project / target_name).resolve())
        # Content is reachable through the link (it's a real view).
        (self.project / "kb" / "note.md").write_text("hi", encoding="utf-8")
        self.assertEqual((folder / "kb" / "note.md").read_text(encoding="utf-8"), "hi")
        self.assertEqual(registry.read_project("proj")["vault_link"], "linked")

    def test_link_idempotent(self):
        self._configure_vault()
        vault.link_project("proj")
        result = vault.link_project("proj")
        self.assertEqual([a["action"] for a in result["actions"]],
                         ["unchanged", "unchanged"])

    def test_missing_target_skipped_and_reported(self):
        self._configure_vault()
        import shutil
        shutil.rmtree(self.project / "backlog")
        result = vault.link_project("proj")
        actions = {a["name"]: a["action"] for a in result["actions"]}
        self.assertEqual(actions["kb"], "created")
        self.assertEqual(actions["backlog"], "skipped")
        self.assertEqual(result["state"], "broken")
        self.assertEqual(registry.read_project("proj")["vault_link"], "broken")

    def test_real_directory_never_deleted(self):
        self._configure_vault()
        folder = self.vault / "projects" / "proj"
        (folder / "kb").mkdir(parents=True)
        (folder / "kb" / "precious.txt").write_text("keep me", encoding="utf-8")
        result = vault.link_project("proj")
        actions = {a["name"]: a["action"] for a in result["actions"]}
        self.assertEqual(actions["kb"], "refused")
        self.assertEqual((folder / "kb" / "precious.txt").read_text(encoding="utf-8"),
                         "keep me")

    def test_wrong_target_repaired_on_explicit_link(self):
        self._configure_vault()
        other = self.project / "kb2"
        other.mkdir()
        folder = self.vault / "projects" / "proj"
        folder.mkdir(parents=True)
        vault._make_link(other, folder / "kb")
        result = vault.link_project("proj")
        actions = {a["name"]: a["action"] for a in result["actions"]}
        self.assertEqual(actions["kb"], "repaired")
        self.assertEqual((folder / "kb").resolve(), (self.project / "kb").resolve())
        self.assertTrue(other.is_dir())  # the old target itself is untouched

    def test_nonexistent_vault_refused(self):
        self._configure_vault(Path(self._tmp.name) / "no-such-vault")
        with self.assertRaises(vault.VaultError):
            vault.link_project("proj")


class CheckTests(VaultTestCase):
    def test_unlinked_then_broken_reported_never_repaired(self):
        self._configure_vault()
        result = vault.check_links("proj", record=True)
        self.assertEqual(result["state"], "unlinked")
        self.assertIn("vault.py link", result["fix"])
        self.assertEqual(registry.read_project("proj")["vault_link"], "unlinked")

        vault.link_project("proj")
        import shutil
        shutil.rmtree(self.project / "kb")  # break the target
        result = vault.check_links("proj", record=True)
        self.assertEqual(result["state"], "broken")
        entry = registry.read_project("proj")
        self.assertEqual(entry["vault_link"], "broken")
        # AC 2: never auto-recreated silently — the link is still dangling.
        statuses = {l["name"]: l["status"] for l in result["links"]}
        self.assertEqual(statuses["kb"], "dangling")
        self.assertEqual(
            vault.check_links("proj")["state"], "broken")

    def test_check_record_noop_when_state_unchanged(self):
        self._configure_vault()
        vault.link_project("proj")
        before = registry.read_project("proj")["updated_at"]
        result = vault.check_links("proj", record=True)
        self.assertNotIn("recorded", result)
        self.assertEqual(registry.read_project("proj")["updated_at"], before)


if __name__ == "__main__":
    unittest.main()
