"""DW-20: the launch consult scope reaches the consult prompt.

What must hold: rendering bmad-build-auto through the stock renderer with the
shipped customization yields a workflow.md whose Consult policy line tells the
session to remember `consult_scope`, and whose STUDIO CONSULT prompt recipe
places the scope line after consult.md and before the question (omitted when
empty); and the routing payload pipeline writes carries, as `consult_scope`,
the schema-shape-is-a-planner-matter sentence that line forwards. The render
runs in a temporary project root, never the repository's `_bmad/render/`.
"""
from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

LIB = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(LIB))
sys.path.insert(0, str(REPO_ROOT / "_bmad" / "scripts"))

import pipeline  # noqa: E402
import render_skill  # noqa: E402

SCOPE_LINE = "Consult scope (routing.current.json consult_scope): <consult_scope>"


class ConsultScopeWiringTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "_bmad" / "custom").mkdir(parents=True)
            # The central config is layered (config_utils.load_central_config);
            # user-scoped values such as communication_language live in
            # config.user.toml, so copy every layer the repo carries.
            for rel in ("config.toml", "config.user.toml",
                        "custom/config.toml", "custom/config.user.toml"):
                src = REPO_ROOT / "_bmad" / rel
                if src.is_file():
                    shutil.copyfile(src, root / "_bmad" / rel)
            shutil.copyfile(REPO_ROOT / "_bmad" / "custom" / "bmad-build-auto.toml",
                            root / "_bmad" / "custom" / "bmad-build-auto.toml")
            workflow = render_skill.render(
                root, REPO_ROOT / ".claude" / "skills" / "bmad-build-auto")
            cls.rendered = workflow.read_text(encoding="utf-8")

    def test_consult_policy_line_remembers_consult_scope(self) -> None:
        lines = [ln.strip() for ln in self.rendered.splitlines()
                 if ln.strip().startswith("Consult policy:")]
        self.assertEqual(len(lines), 1, lines)
        self.assertIn("`consult_triggers`", lines[0])
        self.assertIn("`consult_scope` (missing = empty)", lines[0])

    def test_consult_prompt_places_scope_between_consult_md_and_question(self) -> None:
        start = self.rendered.index("STUDIO CONSULT:")
        recipe_at = self.rendered.index("Its prompt is the `Advisor:` line", start)
        recipe = self.rendered[recipe_at:self.rendered.index("\n", recipe_at)]
        consult_md = recipe.index("consult.md")
        scope = recipe.index(SCOPE_LINE)
        question = recipe.index("the question")
        self.assertLess(consult_md, scope)
        self.assertLess(scope, question)
        self.assertIn("omit the scope line", recipe)

    def test_routing_payload_carries_planner_matter_scope(self) -> None:
        payload = pipeline.current_payload(pipeline.resolve(None))
        self.assertIn("planner matter", payload["consult_scope"])


if __name__ == "__main__":
    unittest.main()
