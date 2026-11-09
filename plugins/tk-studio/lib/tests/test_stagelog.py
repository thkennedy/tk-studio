"""DW-87 — the stage log split out of plansync.py into stagelog.py.

The spec's matrix rows the split itself owns: every stagelog name still
resolves as `plansync.<name>` (the PEP 562 lazy re-export, the very same
object), an unknown attribute is a plain AttributeError naming the module
and the name, `_STAGELOG_NAMES` is exactly stagelog's own top-level
definitions, and plansync run as a script aliases itself as `plansync` so a
stagelog refusal stays a refusal (not a retryable `stage: PlanSyncError`).
"""
from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

LIB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(LIB))

import plansync  # noqa: E402
import stagelog  # noqa: E402


def stagelog_top_level_names() -> set[str]:
    """Every name stagelog.py binds at top level by def, class, assignment
    or annotated assignment — imports excluded."""
    tree = ast.parse((LIB / "stagelog.py").read_text(encoding="utf-8"))
    names: set[str] = set()

    def targets(node):
        if isinstance(node, ast.Name):
            names.add(node.id)
        elif isinstance(node, (ast.Tuple, ast.List)):
            for elt in node.elts:
                targets(elt)
        elif isinstance(node, ast.Starred):
            targets(node.value)

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                targets(target)
        elif isinstance(node, ast.AnnAssign):
            targets(node.target)
    return names


def last_json_object(text: str) -> dict:
    """The last top-level JSON object printed on stdout."""
    decoder = json.JSONDecoder()
    found = None
    i = 0
    while True:
        start = text.find("{", i)
        if start < 0:
            break
        try:
            obj, end = decoder.raw_decode(text, start)
        except ValueError:
            i = start + 1
            continue
        if isinstance(obj, dict):
            found = obj
        i = end
    if found is None:
        raise AssertionError(f"no JSON object on stdout: {text!r}")
    return found


class LazyReExportTests(unittest.TestCase):
    def test_stagelog_names_resolve_to_the_same_objects_on_plansync(self):
        for name in ("stage_append", "ledger_resolve", "_stage_target"):
            with self.subTest(name=name):
                self.assertIs(getattr(plansync, name), getattr(stagelog, name))

    def test_an_unknown_attribute_names_the_module_and_the_attribute(self):
        with self.assertRaises(AttributeError) as caught:
            plansync.no_such_name  # noqa: B018
        message = str(caught.exception)
        self.assertIn("'plansync'", message)
        self.assertIn("'no_such_name'", message)

    def test_every_listed_name_resolves(self):
        for name in sorted(plansync._STAGELOG_NAMES):
            with self.subTest(name=name):
                self.assertIs(getattr(plansync, name), getattr(stagelog, name))


class StagelogNamesTests(unittest.TestCase):
    def test_the_re_export_list_is_exactly_stagelogs_own_definitions(self):
        defined = stagelog_top_level_names()
        self.assertTrue(defined, "the AST walk found no definitions")
        self.assertEqual(set(plansync._STAGELOG_NAMES), defined,
                         f"listed, not defined: {sorted(set(plansync._STAGELOG_NAMES) - defined)}; "
                         f"defined, not listed: {sorted(defined - set(plansync._STAGELOG_NAMES))}")


class ScriptAliasTests(unittest.TestCase):
    """plansync.py run as a script is `__main__`; stagelog imports `plansync`
    and, without the alias, would load a second copy whose PlanSyncError the
    script's `except PlanSyncError` does not catch — the refusal would fall to
    the catch-all and come back `retryable: true`, `stage: PlanSyncError: …`."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.root = self.tmp / "proj"
        (self.root / "_bmad-output" / "specs").mkdir(parents=True)

    def test_a_stagelog_refusal_run_as_a_script_stays_a_refusal(self):
        env = dict(os.environ)
        env["TK_STUDIO_HOME"] = str(self.tmp / "store")
        env.pop("TK_STUDIO_ROOT", None)
        # no `<n>-` prefix: no derived spec folder, so no buffer — a
        # PlanSyncError raised inside stagelog (_StageDoc)
        story = "nospec-story"
        proc = subprocess.run(
            [sys.executable, str(LIB / "plansync.py"), "stage", "--start",
             "--directory", str(self.root), "--story", story, "--stage", "plan"],
            capture_output=True, text=True, encoding="utf-8", env=env,
            timeout=120, check=False)
        self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)
        out = last_json_object(proc.stdout)
        self.assertFalse(out["ok"])
        self.assertEqual(out["status"], "blocked")
        self.assertIsNot(out.get("retryable"), True, out)
        self.assertFalse(out["reason"].startswith("stage: PlanSyncError"), out["reason"])
        self.assertIn(f"no spec for story {story}", out["reason"])
        self.assertIn("no spec folder to buffer", out["reason"])


if __name__ == "__main__":
    unittest.main()
