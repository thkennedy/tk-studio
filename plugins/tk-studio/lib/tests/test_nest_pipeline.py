"""The nested studio-pipeline copy differs only in paths and the project's name (Story 28.2, AC3).

tools/restructure/nest_pipeline.py renders apps/supervisor's copy of
task-planning.md, consult.md, gate.md, reconcile.md and transcribe.py from
the root copy. Pinned here: every differing line is one of the allowed
rewrites (the spine path and the contracts prefix made relative to the nested
root, the project name in three prose lines; in transcribe.py only the two
spec-pointer companion lines); the rendered relative paths resolve from a
fixture nested root two levels down; and once apps/supervisor exists (after
the merge), its five files equal the render.
"""
from __future__ import annotations

import contextlib
import io
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = PLUGIN_ROOT.parents[1]
ROOT_COPY = REPO_ROOT / ".bmad-loop" / "plugins" / "studio-pipeline"
NESTED_COPY = REPO_ROOT / "apps" / "supervisor" / ".bmad-loop" / "plugins" / "studio-pipeline"
sys.path.insert(0, str(REPO_ROOT / "tools" / "restructure"))
import nest_pipeline  # noqa: E402  (repo-side, like rehearse in test_restructure_rehearse)

FILES = ("task-planning.md", "consult.md", "gate.md", "reconcile.md")
TRANSCRIBE = "transcribe.py"
RENDERED = FILES + (TRANSCRIBE,)
SPINE = "_bmad-output/planning-artifacts/architecture/"
CONTRACTS = "plugins/tk-studio/contracts/"
# the lines the render may change (1-based), from the plan's code map
EXPECTED_DIFF = {"task-planning.md": {18}, "consult.md": {3}, "gate.md": {5},
                 "reconcile.md": {3, 46, 47}}


def _undo(line: str, project_name: str) -> str:
    """The root line an allowed rewrite came from."""
    return (line.replace("`../../" + SPINE, "`" + SPINE)
                .replace("`../../" + CONTRACTS, "`" + CONTRACTS)
                .replace(f"for the {project_name} pipeline", "for the tk-studio pipeline")
                .replace(f"**gate session** for {project_name}.", "**gate session** for tk-studio.")
                .replace(f"adapted to {project_name}.", "adapted to tk-studio."))


class NestPipelineTests(unittest.TestCase):
    def setUp(self):
        self.rendered = nest_pipeline.render()

    def test_renders_exactly_the_five_files(self):
        self.assertEqual(tuple(self.rendered), RENDERED)

    def test_every_differing_line_is_an_allowed_rewrite(self):
        for name in FILES:
            root = (ROOT_COPY / name).read_text(encoding="utf-8").splitlines()
            nested = self.rendered[name].splitlines()
            self.assertEqual(len(root), len(nested), name)
            differing = {n for n, (a, b) in enumerate(zip(root, nested), 1) if a != b}
            self.assertEqual(differing, EXPECTED_DIFF[name], name)
            for n in differing:
                self.assertEqual(_undo(nested[n - 1], "supervisor"), root[n - 1],
                                 f"{name}:{n} carries a rewrite outside the allowed three")

    def test_names_the_spine_and_contract_relative_to_the_nested_root(self):
        text = "".join(self.rendered[name] for name in FILES)
        self.assertIn("`../../" + SPINE, text)
        self.assertIn("`../../" + CONTRACTS + "driver-contract.md`", text)
        self.assertNotIn("TK_STUDIO_ROOT", text)
        # every other _bmad-output path stays the nested project's own
        self.assertIn("`_bmad-output/planning-artifacts/epics.md`", text)
        self.assertIn("`.tk-studio/budget-bands.yaml`", text)
        self.assertIn("`tk-studio-launch`", text)

    def test_transcribe_differs_only_in_the_two_companion_lines(self):
        root = (ROOT_COPY / TRANSCRIBE).read_text(encoding="utf-8").splitlines()
        nested = self.rendered[TRANSCRIBE].splitlines()
        self.assertEqual(len(root), len(nested))
        differing = [n for n, (a, b) in enumerate(zip(root, nested), 1) if a != b]
        self.assertEqual(len(differing), 2, differing)
        for n in differing:
            self.assertEqual(root[n - 1].strip()[:5], '"  - ', root[n - 1])
            self.assertEqual(nested[n - 1].replace('"  - ../../', '"  - ', 1), root[n - 1])
        companions = [re.fullmatch(r'\s*"  - (\.\./\.\./\S+)\\n"', nested[n - 1]).group(1)
                      for n in differing]
        self.assertTrue(companions[0].startswith("../../" + SPINE), companions)
        self.assertEqual(companions[1], "../../" + CONTRACTS + "driver-contract.md")
        with tempfile.TemporaryDirectory() as tmp:
            outer = Path(tmp)
            for rel in companions:
                self.assertTrue((REPO_ROOT / rel[len("../../"):]).is_file(), rel)
                target = outer / rel[len("../../"):]
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("x", encoding="utf-8")
            nested_root = outer / "apps" / "supervisor"
            nested_root.mkdir(parents=True)
            for rel in companions:
                self.assertTrue((nested_root / rel).resolve().is_file(), rel)

    def test_a_drifted_transcribe_is_refused(self):
        root = (ROOT_COPY / TRANSCRIBE).read_text(encoding="utf-8")
        drifted = root.replace('"  - plugins/tk-studio/contracts/', '"  - contracts/')
        with self.assertRaises(nest_pipeline.NestError):
            nest_pipeline.render_text(TRANSCRIBE, drifted)

    def test_rendered_relative_paths_resolve_from_a_nested_root(self):
        paths = sorted({p for text in self.rendered.values()
                        for p in re.findall(r"`(\.\./\.\./[^`]+?)`", text)})
        self.assertTrue(paths)
        with tempfile.TemporaryDirectory() as tmp:
            outer = Path(tmp)
            for rel in paths:
                target = outer / rel[len("../../"):]
                # the fixture mirrors files that exist in this checkout
                self.assertTrue((REPO_ROOT / rel[len("../../"):]).is_file(), rel)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("x", encoding="utf-8")
            nested = outer / "apps" / "supervisor"
            nested.mkdir(parents=True)
            for rel in paths:
                self.assertTrue((nested / rel).resolve().is_file(), rel)

    def test_project_name_is_a_parameter(self):
        text = nest_pipeline.render(project_name="other")["gate.md"]
        self.assertIn("**gate session** for other.", text)

    def test_a_drifted_root_copy_is_refused(self):
        with self.assertRaises(nest_pipeline.NestError):
            nest_pipeline.render_text("consult.md", "no anchor here\n")

    def test_cli_writes_the_five_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = nest_pipeline.main(["--out", tmp])
            self.assertEqual(code, 0)
            self.assertTrue(json.loads(out.getvalue())["ok"])
            for name in RENDERED:
                self.assertEqual(Path(tmp, name).read_text(encoding="utf-8"),
                                 self.rendered[name])

    @unittest.skipUnless(NESTED_COPY.is_dir(),
                         "apps/supervisor is not merged yet (ADR section 5 step 3)")
    def test_the_real_nested_copy_equals_the_render(self):
        for name in RENDERED:
            self.assertEqual((NESTED_COPY / name).read_text(encoding="utf-8"),
                             self.rendered[name], name)


if __name__ == "__main__":
    unittest.main()
