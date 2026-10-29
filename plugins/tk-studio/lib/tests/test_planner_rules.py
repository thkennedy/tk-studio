"""Planner rules (Story 26.2): the spec file name and the settled-shape rule.

What must hold: the dispatch note transcribe.py writes names the executor
spec `stories/<id>-spec.md` (the id already carries the title slug), keeps
the glob and pending clauses word for word, and the engine's `<id>-*.md`
glob resolves it while a bare `<id>.md` stays pending; the worst-case spec
path stays under 200 characters; task-planning.md states the settled-shape
rule once, the planner-note fixture follows it, and the shipped consult
scope names schema shape a planner matter (an operator ruling otherwise).
"""
from __future__ import annotations

import importlib.util
import re
import sys
import tempfile
import unittest
from pathlib import Path

LIB = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = PLUGIN_ROOT.parents[1]
PIPELINE_PLUGIN = REPO_ROOT / ".bmad-loop" / "plugins" / "studio-pipeline"
TRANSCRIBE = PIPELINE_PLUGIN / "transcribe.py"
TASK_PLANNING = PIPELINE_PLUGIN / "task-planning.md"
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "planner-note" / "SPEC.md"

sys.path.insert(0, str(LIB))
import pipeline  # noqa: E402

SHAPES = ("optional entry", "deferred entry", "per-platform map", "named placeholder rule")
HEADING_RE = re.compile(r"^## Design notes \(settled shape, planner, \d{4}-\d{2}-\d{2}\)\s*$", re.M)
BULLET_RE = re.compile(r"^- (?P<who>\S+) — (?P<artifact>[^:]+): (?P<shape>.+) — per (?P<doc>\S+)(?: §(?P<anchor>\S.*))?$")
BULLET_TEMPLATE = "- <CAP or story> — <artifact>: <shape> — per <design document path[§]>"


def _transcribe():
    spec = importlib.util.spec_from_file_location("studio_transcribe", TRANSCRIBE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _flat(text: str) -> str:
    return " ".join(text.split())


STORY = {"dotted": "26.2", "num": "2", "title": "The Planner Settles Schema Shape and the Spec File Name",
         "heading": "### Story 26.2: The Planner Settles Schema Shape and the Spec File Name", "want": ""}


@unittest.skipUnless(TRANSCRIBE.is_file(), "studio-pipeline plugin not in this checkout")
class SpecFileNameTest(unittest.TestCase):
    def setUp(self):
        self.mod = _transcribe()
        self.key, self.block = self.mod.entry(26, STORY, {})
        self.dev = _flat(self.block)

    def test_entry_names_the_short_spec_file(self):
        self.assertEqual(self.key, "26-2-the-planner-settles-schema-shape-and-the-spec-file-name")
        self.assertIn(f"`stories/{self.key}-spec.md`", self.dev)
        self.assertIn(f"the glob `{self.key}-*.md`", self.dev)
        self.assertIn(f"a file named `{self.key}.md` is read as pending", self.dev)
        self.assertNotIn("<slug of the title>", self.dev)

    def test_entry_states_the_advisor_routing_and_triggers(self):
        # Story 26.3: model, effort and advisor per launch; the consult
        # triggers as advisor instructions, each call logged
        self.assertIn("pass the model, effort and advisor of implementer and reviewers "
                      "explicitly on every subagent launch", self.dev)
        self.assertIn("Advisor: when routing.current.json gives the session an advisor other "
                      "than `off`, consult the advisor on: verify-red, halt, deviation above 0, "
                      "a high-severity finding, a tripwire, a file outside Files, and before "
                      "declaring the story done; append a `## Consult Log` entry per advisor "
                      "call.", self.dev)

    def test_engine_glob_resolves_spec_and_not_bare_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            stories = Path(tmp) / "stories"
            stories.mkdir()
            (stories / f"{self.key}-spec.md").write_text("x", encoding="utf-8")
            (stories / f"{self.key}.md").write_text("x", encoding="utf-8")
            hits = [p.name for p in stories.glob(f"{self.key}-*.md")]
        self.assertEqual(hits, [f"{self.key}-spec.md"])

    def test_worst_case_path_under_200(self):
        # 5 x 10 + "abcde" joined by hyphens is exactly 60, the slug() cap; "xyz" would overflow it
        title = " ".join(["abcdefghij"] * 5 + ["abcde", "xyz"])
        story = dict(STORY, num="99", title=title)
        key, _ = self.mod.entry(99, story, {})
        self.assertEqual(len(self.mod.slug(title)), 60)
        self.assertEqual(len(key), len("99-99-") + 60)  # 66
        path = REPO_ROOT / "_bmad-output" / "specs" / "spec-epic-99" / "stories" / f"{key}-spec.md"
        self.assertLess(len(str(path)), 200, str(path))


class SettledShapeRuleTest(unittest.TestCase):
    def test_fixture_bullets_follow_the_rule(self):
        text = FIXTURE.read_text(encoding="utf-8")
        m = HEADING_RE.search(text)
        self.assertIsNotNone(m, "fixture lacks the planner design-notes heading")
        section = text[m.end():].split("\n## ", 1)[0]
        bullets = [ln for ln in section.splitlines() if ln.startswith("- ")]
        self.assertTrue(bullets)
        seen = set()
        for b in bullets:
            bm = BULLET_RE.match(b)
            self.assertIsNotNone(bm, b)
            shape = next((s for s in SHAPES if bm.group("shape").startswith(s)), None)
            self.assertIsNotNone(shape, b)
            seen.add(shape)
            self.assertRegex(bm.group("doc"), r"\.(md|toml|yaml|json)$", b)
            with self.subTest(doc=bm.group("doc"), anchor=bm.group("anchor")):
                cited = REPO_ROOT / bm.group("doc")
                top = REPO_ROOT / Path(bm.group("doc")).parts[0]
                if not top.exists():
                    self.skipTest(f"{top.name} not in this checkout")
                self.assertTrue(cited.is_file(), f"cited document missing: {cited}")
                if bm.group("anchor"):
                    self.assertIn(bm.group("anchor"), cited.read_text(encoding="utf-8"), b)
            self.assertNotIn("block if", b.lower())
            self.assertNotIn("open question", b.lower())
        self.assertEqual(seen, set(SHAPES))

    @unittest.skipUnless(TASK_PLANNING.is_file(), "studio-pipeline plugin not in this checkout")
    def test_task_planning_states_the_rule_once(self):
        text = TASK_PLANNING.read_text(encoding="utf-8")
        section3 = text.split("## 3.", 1)[1].split("\n## 4.", 1)[0]
        flat = _flat(section3)
        self.assertEqual(text.count("## Design notes (settled shape, planner, <date>)"), 1)
        self.assertIn("## Design notes (settled shape, planner, <date>)", section3)
        for shape in SHAPES:
            self.assertIn(f"`{shape}`", flat)
        self.assertIn("never a Block If", flat)
        self.assertIn("`open_questions[]`", flat)
        self.assertIn("only when no design document constrains it", flat)
        self.assertIn("settled shapes (the `## Settled shape` section) are not Block Ifs", flat)
        self.assertIn(BULLET_TEMPLATE, section3)
        self.assertIn("\n## Settled shape\n", section3)
        self.assertLess(section3.index("\n## Settled shape\n"), section3.index("\n## Files\n"))
        self.assertIn("there is never a second dated section", flat)

    @unittest.skipUnless(TASK_PLANNING.is_file(), "studio-pipeline plugin not in this checkout")
    def test_task_planning_plans_every_story_and_refuses_open_questions(self):
        # Story 35.2: the bootstrap plans every manifest entry in list order (section 3
        # each, the named story first); an un-noted open question of the story's CAPs is
        # an escalate, never a plan without it; the finish line counts the plans; the
        # Story 35.8 Stage Log bracket stays in section 3
        text = TASK_PLANNING.read_text(encoding="utf-8")
        section1 = _flat(text.split("## 1.", 1)[1].split("\n## 2.", 1)[0])
        section3 = _flat(text.split("## 3.", 1)[1].split("\n## 4.", 1)[0])
        section4 = text.split("\n## 4.", 1)[1]
        self.assertIn("## 1. Bootstrap: transcribe the epic, then plan every story", text)
        self.assertNotIn("plan its first story", text)
        self.assertIn("plan every manifest entry in list order, each through section 3, "
                      "the story the launch named first", section1)
        self.assertIn("with a Code Map and a `band`", section1)
        self.assertNotIn("Then plan the story the launch named in section 3.", section1)
        # an existing manifest (a relaunch after a `blocked` bootstrap) still plans every
        # entry without a plan, never only the named story
        self.assertIn("If `stories.yaml` already has `- id:` entries, skip the transcription "
                      "and plan, through section 3, every entry that has no `plans/<N>-<M>.md` "
                      "yet, in list order, the named story first.", section1)
        self.assertNotIn("skip straight to section 3 for the named story", text)
        self.assertIn("**Open questions (Story 35.2).**", section3)
        self.assertIn("`## Open Questions`", section3)
        # any bullet naming one of the story's CAPs is its open question, the shape
        # `launch.py check` reads (not only a `- CAP-N:` line)
        self.assertIn("`## Open Questions` for a bullet that names one of the story's CAPs",
                      section3)
        self.assertNotIn("for a `- CAP-N:` line", section3)
        # the design note's subject is the shape `launch.py check` reads
        self.assertIn("the note's subject (the bullet's text before the first ` — ` or `:`) is "
                      "the CAP, a CAP list, optionally with `(N.M)`, or the story `N.M`, the "
                      "shape `launch.py check` reads", section3)
        self.assertIn("For the story being started — the story boundary's next story, or the "
                      "bootstrap's named (next) story — an open question of its CAPs that you "
                      "cannot settle into a design note is an `escalate`", section3)
        self.assertIn("never a plan written without it", section3)
        self.assertIn("For a later story planned at bootstrap, an unsettled CAP never blocks the "
                      "launch (earlier stories proceed)", section3)
        self.assertIn("under `## Risks and open decisions` as a Block If naming the CAP", section3)
        self.assertIn("the gap `open questions` once it is next", section3)
        # section 2: the next story is the first entry with no spec file; a bootstrap plan is
        # re-checked and refreshed, never a reason to call the epic complete
        section2 = _flat(text.split("## 2.", 1)[1].split("\n## 3.", 1)[0])
        self.assertIn("It is the first entry in `stories.yaml` with no spec file.", section2)
        self.assertNotIn("no spec file and no plan", section2)
        self.assertIn("Only when no entry lacks a spec file, record `epic complete: no next story`",
                      section2)
        self.assertIn("re-run section 3's open-question rule against it (write the design note, "
                      "or `escalate`) and refresh that plan in place", section2)
        self.assertIn("**Stage Log (Story 35.8).**", section3)
        self.assertLess(section3.index("**Stage Log (Story 35.8).**"),
                        section3.index("**Open questions (Story 35.2).**"))
        self.assertIn("- `transcribed <n> stories, planned <n> plans`", section4)
        self.assertNotIn("`transcribed <n> stories, planned <key>`", section4)


class ConsultScopeTest(unittest.TestCase):
    def test_scope_names_schema_shape_a_planner_matter(self):
        scope = pipeline.resource_defaults()["consult"]["scope"]
        self.assertIn("Never a design number", scope)  # the existing text stays
        self.assertIn("Schema shape for an artifact a later story or an operator produces "
                      "is a planner matter", scope)
        self.assertIn("when the design documents constrain it", scope)
        self.assertIn("an operator ruling (`escalate`) only when they do not", scope)


if __name__ == "__main__":
    unittest.main()
