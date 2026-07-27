"""Tests for the project registry (ST-2.3 acceptance criteria)."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import miniyaml  # noqa: E402
import registry  # noqa: E402


class RegistryTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self.user_root = base / ".tk-studio"
        self.proj_a = base / "alpha"
        self.proj_a.mkdir()
        self.proj_b = base / "elsewhere" / "alpha"  # same basename, different root
        self.proj_b.mkdir(parents=True)
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        os.environ["TK_STUDIO_HOME"] = str(self.user_root)

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()


class RegisterTests(RegistryTestCase):
    def test_register_writes_valid_atomic_entry(self):
        result = registry.register(self.proj_a, writer="onboard")
        self.assertEqual(result["action"], "registered")
        self.assertEqual(result["project_id"], "alpha")
        entry = registry.read_project("alpha")
        for field in registry.ENTRY_REQUIRED:
            self.assertIn(field, entry)
        self.assertEqual(Path(entry["root"]), self.proj_a.resolve())
        self.assertEqual(entry["working_set_ref"], registry.WORKING_SET_REF)
        self.assertEqual(entry["vault_link"], "unconfigured")
        # File exists, parses, validates.
        data = miniyaml.load(registry.registry_path())
        registry.validate_registry(data)

    def test_entry_reflects_project_config_bindings(self):
        conf = self.proj_a / ".tk-studio"
        conf.mkdir()
        (conf / "config.yaml").write_text(
            "vcs: perforce\nplanning:\n  backend: bmad-files\n", encoding="utf-8")
        registry.register(self.proj_a, writer="onboard")
        entry = registry.read_project("alpha")
        self.assertEqual(entry["vcs"], "perforce")
        self.assertEqual(entry["planning_backend"], "bmad-files")

    def test_reregister_same_root_idempotent(self):
        registry.register(self.proj_a, writer="onboard")
        first = registry.read_project("alpha")
        result = registry.register(self.proj_a, writer="activate")
        self.assertEqual(result["action"], "unchanged")
        self.assertEqual(registry.read_project("alpha"), first)

    def test_basename_collision_demands_explicit_id(self):
        # AC: never a silent second identity.
        registry.register(self.proj_a, writer="onboard")
        with self.assertRaises(registry.RegistryError) as ctx:
            registry.register(self.proj_b, writer="onboard")
        self.assertIn("project-id", str(ctx.exception))
        # Explicit id resolves the collision; both entries coexist.
        result = registry.register(self.proj_b, writer="onboard",
                                   project_id="alpha-2")
        self.assertEqual(result["action"], "registered")
        self.assertEqual(set(registry.list_projects()), {"alpha", "alpha-2"})

    def test_explicit_id_collision_also_fails(self):
        registry.register(self.proj_a, writer="onboard", project_id="shared")
        with self.assertRaises(registry.RegistryError):
            registry.register(self.proj_b, writer="onboard", project_id="shared")


class SingleWriterTests(RegistryTestCase):
    def test_non_writer_surfaces_refused(self):
        # AC: any other surface reads and never writes.
        for surface in ("orchestrator", "job", "measure-push", ""):
            with self.assertRaises(registry.RegistryError, msg=surface):
                registry.register(self.proj_a, writer=surface)
        registry.register(self.proj_a, writer="onboard")
        with self.assertRaises(registry.RegistryError):
            registry.amend("alpha", writer="orchestrator", vault_link="linked")

    def test_read_api_never_creates_file(self):
        self.assertEqual(registry.list_projects(), {})
        self.assertFalse(registry.registry_path().exists())


class AmendTests(RegistryTestCase):
    def test_amend_vault_link_state(self):
        registry.register(self.proj_a, writer="onboard")
        registry.amend("alpha", writer="activate", vault_link="broken",
                       vault_link_detail="target missing")
        entry = registry.read_project("alpha")
        self.assertEqual(entry["vault_link"], "broken")
        self.assertEqual(entry["vault_link_detail"], "target missing")
        registry.amend("alpha", writer="activate", vault_link="linked",
                       vault_link_detail="")
        entry = registry.read_project("alpha")
        self.assertEqual(entry["vault_link"], "linked")
        self.assertNotIn("vault_link_detail", entry)

    def test_amend_unknown_project_or_state_fails(self):
        with self.assertRaises(registry.RegistryError):
            registry.amend("ghost", writer="activate", vault_link="linked")
        registry.register(self.proj_a, writer="onboard")
        with self.assertRaises(registry.RegistryError):
            registry.amend("alpha", writer="activate", vault_link="sideways")

    def test_reregister_preserves_vault_state(self):
        registry.register(self.proj_a, writer="onboard")
        registry.amend("alpha", writer="activate", vault_link="linked")
        registry.register(self.proj_a, writer="activate")
        self.assertEqual(registry.read_project("alpha")["vault_link"], "linked")


class ValidationTests(RegistryTestCase):
    def test_corrupt_registry_loud(self):
        registry.registry_path().parent.mkdir(parents=True)
        registry.registry_path().write_text(
            "registry_version: 1\nprojects:\n  bad:\n    root: x\n",
            encoding="utf-8")
        with self.assertRaises(registry.RegistryError):
            registry.load_registry()

    def test_wrong_version_loud(self):
        with self.assertRaises(registry.RegistryError):
            registry.validate_registry({"registry_version": 2, "projects": {}})


if __name__ == "__main__":
    unittest.main()
