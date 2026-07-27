"""Tests for the resource inventory (ST-4.1 acceptance criteria).

The inventory enumerates installed BMad modules/skills, known-but-uninstalled
official modules from the studio registry (bmad.lock), and user-authored
resources — read-only, JSON, provenance per resource.
"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import inventory  # noqa: E402

MANIFEST = """\
installation:
  version: 6.10.0
modules:
  - name: core
    version: 6.10.0
    installDate: 2026-07-26T23:18:54.924Z
    source: built-in
    npmPackage: null
  - name: bmm
    version: 6.10.0
    source: built-in
    npmPackage: null
  - name: tea
    version: v1.19.1
    source: external
    npmPackage: bmad-method-test-architecture-enterprise
  - name: rogue
    version: v0.0.1
    source: external
"""

SKILL_CSV = """\
canonicalId,name,description,module,path
"bmad-help","bmad-help","Answers BMad questions.","core","_bmad/core/bmad-help/SKILL.md"
"tea-review","tea-review","Reviews tests.","tea","_bmad/tea/tea-review/SKILL.md"
"""

LOCK = """\
lock_version: 1
core:
  package: bmad-method
  version: 6.10.0
install:
  tools:
    - claude-code
  flags:
    - --yes
modules:
  bmm:
    version: 6.10.0
    source: built-in
  tea:
    version: v1.19.1
    source: external
    npmPackage: bmad-method-test-architecture-enterprise
  wds:
    version: v0.4.3
    source: external
    npmPackage: bmad-wds
"""

SKILL_MD = """\
---
name: my-reviewer
description: Reviews things my way.
---

# my-reviewer
"""

AGENT_MD = """\
---
name: shipmate
description: Keeps releases honest.
---

Body.
"""


def _tree_snapshot(root: Path) -> set[str]:
    return {str(p.relative_to(root)) for p in root.rglob("*")}


class InventoryTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self.root = base / "proj"
        cfg = self.root / "_bmad" / "_config"
        cfg.mkdir(parents=True)
        (cfg / "manifest.yaml").write_text(MANIFEST, encoding="utf-8", newline="\n")
        (cfg / "skill-manifest.csv").write_text(SKILL_CSV, encoding="utf-8", newline="\n")

        # BMad-synced skill (name in the manifest) + a user-authored one
        for name, body in (("bmad-help", "---\nname: bmad-help\n---\n"),
                           ("my-reviewer", SKILL_MD)):
            d = self.root / ".claude" / "skills" / name
            d.mkdir(parents=True)
            (d / "SKILL.md").write_text(body, encoding="utf-8", newline="\n")

        agents = self.root / ".claude" / "agents"
        agents.mkdir(parents=True)
        (agents / "shipmate.md").write_text(AGENT_MD, encoding="utf-8", newline="\n")

        custom = self.root / "_bmad" / "custom"
        custom.mkdir(parents=True)
        (custom / "config.toml").write_text("# stock\n", encoding="utf-8")
        (custom / "config.user.toml").write_text("# stock\n", encoding="utf-8")
        (custom / ".gitignore").write_text("config.user.toml\n", encoding="utf-8")
        wf = custom / "my-workflow"
        wf.mkdir()
        (wf / "README.md").write_text("---\nname: my-workflow\ndescription: Custom flow.\n---\n",
                                      encoding="utf-8", newline="\n")

        self.lock = base / "bmad.lock"
        self.lock.write_text(LOCK, encoding="utf-8", newline="\n")

    def tearDown(self):
        self._tmp.cleanup()

    def _scan(self) -> dict:
        return inventory.scan(self.root, lock_path=self.lock)

    def _by_name(self, result: dict, name: str) -> dict:
        matches = [r for r in result["resources"] if r["name"] == name]
        self.assertEqual(len(matches), 1, f"expected exactly one '{name}': {matches}")
        return matches[0]

    # --- AC: installed modules/skills from _bmad/_config manifests

    def test_installed_modules_enumerated_with_provenance(self):
        result = self._scan()
        core = self._by_name(result, "core")
        self.assertEqual(core["kind"], "module")
        self.assertEqual(core["status"], "installed")
        self.assertEqual(core["version"], "6.10.0")
        self.assertEqual(core["provenance"], "_bmad/_config/manifest.yaml")
        tea = self._by_name(result, "tea")
        self.assertEqual(tea["status"], "installed")
        self.assertEqual(tea["version"], "v1.19.1")

    def test_installed_skills_enumerated_from_csv(self):
        result = self._scan()
        skill = self._by_name(result, "bmad-help")
        self.assertEqual(skill["kind"], "skill")
        self.assertEqual(skill["origin"], "bmad-official")
        self.assertEqual(skill["module"], "core")
        self.assertEqual(skill["provenance"], "_bmad/_config/skill-manifest.csv")
        self.assertEqual(skill["description"], "Answers BMad questions.")

    # --- AC: known-but-uninstalled official modules from the registry

    def test_known_uninstalled_module_from_lock(self):
        result = self._scan()
        wds = self._by_name(result, "wds")
        self.assertEqual(wds["status"], "known-uninstalled")
        self.assertEqual(wds["origin"], "bmad-official")
        self.assertEqual(wds["version"], "v0.4.3")
        self.assertEqual(wds["provenance"], "bmad.lock")

    def test_installed_module_outside_registry_is_flagged(self):
        result = self._scan()
        rogue = self._by_name(result, "rogue")
        self.assertEqual(rogue["origin"], "unregistered")
        self.assertTrue(any("rogue" in n for n in result["notes"]))

    # --- AC: user-authored resources, never double-counted

    def test_user_authored_skill_agent_and_custom(self):
        result = self._scan()
        skill = self._by_name(result, "my-reviewer")
        self.assertEqual(skill["origin"], "user-authored")
        self.assertEqual(skill["description"], "Reviews things my way.")
        self.assertEqual(skill["path"], ".claude/skills/my-reviewer")

        agent = self._by_name(result, "shipmate")
        self.assertEqual(agent["kind"], "agent")
        self.assertEqual(agent["origin"], "user-authored")

        custom = self._by_name(result, "my-workflow")
        self.assertEqual(custom["kind"], "custom")
        self.assertEqual(custom["origin"], "user-authored")
        self.assertEqual(custom["description"], "Custom flow.")

    def test_synced_skill_not_double_counted_and_stock_custom_excluded(self):
        result = self._scan()
        helps = [r for r in result["resources"] if r["name"] == "bmad-help"]
        self.assertEqual(len(helps), 1)  # csv row only, not the .claude sync
        self.assertEqual(helps[0]["origin"], "bmad-official")
        names = {r["name"] for r in result["resources"]}
        self.assertNotIn("config", names)
        self.assertFalse(any(r["path"].endswith("config.toml")
                             for r in result["resources"] if r.get("path")))

    # --- AC: structured, data-only artifact

    def test_artifact_shape_and_counts(self):
        result = self._scan()
        self.assertEqual(result["inventory_version"], 1)
        self.assertIn("generated", result)
        self.assertEqual(result["counts"]["modules_installed"], 4)
        self.assertEqual(result["counts"]["modules_known_uninstalled"], 1)
        self.assertEqual(result["counts"]["skills_installed"], 2)
        self.assertEqual(result["counts"]["user_authored"], 3)
        self.assertEqual(result["counts"]["total"], len(result["resources"]))
        for resource in result["resources"]:
            self.assertIn("provenance", resource)
            self.assertIn("origin", resource)
            self.assertIn(resource["kind"], ("module", "skill", "agent", "custom"))

    # --- read-only discipline

    def test_scan_is_a_pure_read(self):
        before = _tree_snapshot(self.root)
        self._scan()
        self.assertEqual(before, _tree_snapshot(self.root))

    def test_project_without_bmad_still_inventories(self):
        bare = Path(self._tmp.name) / "bare"
        (bare / ".claude" / "skills" / "solo").mkdir(parents=True)
        (bare / ".claude" / "skills" / "solo" / "SKILL.md").write_text(
            "---\nname: solo\ndescription: Lone skill.\n---\n", encoding="utf-8")
        result = inventory.scan(bare, lock_path=self.lock)
        self.assertFalse(result["sources"]["installed_manifest"])
        # every registry module is known-uninstalled; user-authored still found
        self.assertEqual(result["counts"]["modules_installed"], 0)
        self.assertEqual(result["counts"]["modules_known_uninstalled"], 4)  # core+bmm+tea+wds
        solo = self._by_name(result, "solo")
        self.assertEqual(solo["origin"], "user-authored")
        self.assertTrue(result["notes"])

    def test_missing_root_raises(self):
        with self.assertRaises(inventory.InventoryError):
            inventory.scan(Path(self._tmp.name) / "nope", lock_path=self.lock)

    def test_cli_out_writes_artifact(self):
        import contextlib
        import io
        import json
        out = Path(self._tmp.name) / "artifacts" / "inventory.json"
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = inventory.main(["scan", "--directory", str(self.root),
                                   "--lock", str(self.lock), "--out", str(out)])
        self.assertEqual(code, 0)
        data = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(data["inventory_version"], 1)
        self.assertEqual(json.loads(stdout.getvalue())["counts"], data["counts"])


if __name__ == "__main__":
    unittest.main()
