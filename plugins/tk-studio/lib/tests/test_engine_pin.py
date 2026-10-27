"""Tests for the engine pin core (Story 34.4, `gds-engine-godot-4`).

The core reads a Godot project's pinned version (project.godot
`config/features`, global.json `Godot.NET.Sdk` and `sdk.version`), checks it
against the skill's `pin.json` range, warns on every mismatch (never silent)
and refuses, `blocked` exit 2, on a missing project, an unknown skill or a
malformed global.json. The skill's knowledge, its catalogue citation (AC3)
and the eval case (AC2) are pinned here too.
"""
from __future__ import annotations

import contextlib
import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

LIB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(LIB))

import engine_pin  # noqa: E402

PLUGIN = LIB.parent
SKILL_DIR = PLUGIN / "skills" / "gds-engine-godot-4"
EVAL_DIR = PLUGIN / "evals" / "gds-engine-godot-4-pinned-facts"
REPO = PLUGIN.parent.parent
CATALOGUE = REPO / ".claude" / "skills" / "gds-game-architecture" / "engine-mcps.yaml"


def _write_project(root: Path, features: str | None = "4.7", sdk: str | None = "4.7.2",
                   dotnet: str | None = "8.0.100", global_json: str | None = None) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    feature_items = ([f'"{features}"'] if features else []) + ['"C#"', '"Forward Plus"']
    (root / "project.godot").write_text(
        "config_version=5\n\n[application]\n\nconfig/name=\"Fixture\"\n"
        f"config/features=PackedStringArray({', '.join(feature_items)})\n\n"
        "[rendering]\n\nconfig/features=PackedStringArray(\"9.9\")\n",
        encoding="utf-8")
    if global_json is not None:
        (root / "global.json").write_text(global_json, encoding="utf-8")
    elif sdk is not None or dotnet is not None:
        doc: dict = {}
        if dotnet is not None:
            doc["sdk"] = {"version": dotnet}
        if sdk is not None:
            doc["msbuild-sdks"] = {"Godot.NET.Sdk": sdk}
        (root / "global.json").write_text(json.dumps(doc), encoding="utf-8")
    return root


class EnginePinTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def _cli(self, argv: list[str]) -> tuple[dict, int]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = engine_pin.main(argv)
        return json.loads(out.getvalue()), code

    # ---- the reads

    def test_reads_features_sdk_and_dotnet(self):
        root = _write_project(self.base / "p")
        self.assertEqual(engine_pin.read_pin(root), {
            "features_version": "4.7", "godot_net_sdk": "4.7.2", "dotnet_sdk": "8.0.100"})

    def test_features_read_only_under_application(self):
        root = self.base / "p"
        root.mkdir()
        (root / "project.godot").write_text(
            "[rendering]\nconfig/features=PackedStringArray(\"9.9\")\n", encoding="utf-8")
        self.assertIsNone(engine_pin.read_pin(root)["features_version"])

    def test_absent_global_json_is_not_a_refusal(self):
        root = _write_project(self.base / "p", sdk=None, dotnet=None)
        result = engine_pin.check(root)
        self.assertEqual(result["pinned"], "4.7")
        self.assertIsNone(result["godot_net_sdk"])
        self.assertIsNone(result["dotnet_sdk"])
        self.assertTrue(result["in_range"])

    # ---- the range compare and every warning

    def test_in_range(self):
        root = _write_project(self.base / "p")
        result = engine_pin.check(root)
        self.assertEqual(result["pinned"], "4.7.2")
        self.assertEqual(result["engine"], "godot")
        self.assertEqual(result["supported"], {"min": "4.7", "below": "4.8"})
        self.assertTrue(result["in_range"])
        self.assertEqual(result["warnings"], [])

    def test_out_of_range_above_and_below(self):
        for features, sdk in (("4.8", "4.8.0"), ("4.6", "4.6.1")):
            with self.subTest(sdk=sdk):
                root = _write_project(self.base / sdk, features=features, sdk=sdk)
                result = engine_pin.check(root)
                self.assertFalse(result["in_range"])
                self.assertEqual(len(result["warnings"]), 1)
                warning = result["warnings"][0]
                self.assertIn(sdk, warning)
                self.assertIn("4.7..<4.8", warning)
                self.assertIn("global.json", warning)

    def test_numeric_compare_not_lexical(self):
        root = _write_project(self.base / "p", features="4.10", sdk="4.10.0")
        self.assertFalse(engine_pin.check(root)["in_range"])

    def test_non_numeric_sdk_falls_back_to_features_and_warns(self):
        root = _write_project(self.base / "p", features="4.7", sdk="$(GodotVersion)")
        result = engine_pin.check(root)
        self.assertEqual(result["godot_net_sdk"], "$(GodotVersion)")  # reported raw
        self.assertEqual(result["pinned"], "4.7")
        self.assertTrue(result["in_range"])
        self.assertEqual(len(result["warnings"]), 1)
        self.assertIn("$(GodotVersion)", result["warnings"][0])
        self.assertIn("global.json", result["warnings"][0])
        self.assertNotIn("disagreement", result["warnings"][0])

    def test_version_prefix_alone_is_not_a_version(self):
        for sdk in ("4.x", "4abc", "4-latest", "4.7.2 "+"x"):
            with self.subTest(sdk=sdk):
                root = _write_project(self.base / "p", features="4.7", sdk=sdk)
                result = engine_pin.check(root)
                self.assertEqual(result["pinned"], "4.7")
                self.assertTrue(result["in_range"])
                self.assertEqual(len(result["warnings"]), 1)
                self.assertIn("is not a version", result["warnings"][0])
                self.assertIn("pinned from project.godot config/features 4.7",
                              result["warnings"][0])

    def test_semver_suffix_still_parses(self):
        for sdk in ("4.7.0-beta.1", "4.7.0+build.5", "4.7.0-rc-2+abc"):
            with self.subTest(sdk=sdk):
                root = _write_project(self.base / "p", features="4.7", sdk=sdk)
                result = engine_pin.check(root)
                self.assertEqual(result["pinned"], sdk)
                self.assertTrue(result["in_range"])
                self.assertEqual(result["warnings"], [])

    def test_global_json_comments_allowed(self):
        commented = ('// the SDK pin\n{\n  /* block\n     comment */\n'
                     '  "sdk": {"version": "8.0.100"}, // trailing\n'
                     '  "msbuild-sdks": {"Godot.NET.Sdk": "4.7.2"}\n}\n')
        root = _write_project(self.base / "p", global_json=commented)
        result = engine_pin.check(root)
        self.assertEqual(result["godot_net_sdk"], "4.7.2")
        self.assertEqual(result["dotnet_sdk"], "8.0.100")
        self.assertEqual(result["pinned"], "4.7.2")
        self.assertEqual(result["warnings"], [])

    def test_global_json_comment_markers_inside_strings_survive(self):
        text = ('{"note": "see https://godotengine.org /* not a comment */", '
                '"esc": "a \\" // still a string", // real comment\n'
                '"msbuild-sdks": {"Godot.NET.Sdk": "4.7.2"}}')
        root = _write_project(self.base / "p", global_json=text)
        self.assertEqual(engine_pin._strip_comments(text).count("https://godotengine.org /* not a comment */"), 1)
        self.assertIn('"a \\" // still a string"', engine_pin._strip_comments(text))
        self.assertEqual(engine_pin.check(root)["pinned"], "4.7.2")

    def test_global_json_still_malformed_after_stripping_refuses(self):
        for text in ("// comment\n{not json", '{"sdk": {} /* unterminated'):
            with self.subTest(text=text):
                root = _write_project(self.base / "p", global_json=text)
                with self.assertRaises(engine_pin.Refusal) as ctx:
                    engine_pin.check(root)
                self.assertIn("malformed global.json", str(ctx.exception))

    def test_non_numeric_sdk_and_no_features_is_unreadable(self):
        root = _write_project(self.base / "p", features=None, sdk="latest")
        result = engine_pin.check(root)
        self.assertIsNone(result["pinned"])
        self.assertIsNone(result["in_range"])
        self.assertTrue(any("latest" in w and "global.json" in w for w in result["warnings"]))
        self.assertTrue(any("pinned version unreadable" in w for w in result["warnings"]))

    def test_present_sdk_key_with_unusable_value_warns_not_absent(self):
        for i, (raw, shown) in enumerate(((4.7, "4.7"), ("", "''"), ("   ", "'   '"),
                                          (None, "null"), ([4, 7], "[4, 7]"))):
            with self.subTest(raw=raw):
                root = _write_project(self.base / f"p{i}", features="4.7",
                                      global_json=json.dumps(
                                          {"msbuild-sdks": {"Godot.NET.Sdk": raw}}))
                result = engine_pin.check(root)
                self.assertEqual(result["pinned"], "4.7")
                self.assertTrue(result["in_range"])
                self.assertIsNone(result["godot_net_sdk"])
                self.assertIsNone(engine_pin.read_pin(root)["godot_net_sdk"])
                self.assertEqual(len(result["warnings"]), 1)
                self.assertIn(f"Godot.NET.Sdk {shown} is not a version",
                              result["warnings"][0])
                self.assertIn("pinned from project.godot config/features 4.7",
                              result["warnings"][0])

    def test_number_null_empty_sdk_warn_and_pin_from_features(self):
        # A JSON number 4.3 must never pin (the field is never JSON-dumped,
        # so _parse never sees "4.3"); null and "" warn rather than vanish.
        for i, (raw, shown) in enumerate(((4.3, "4.3"), (None, "null"), ("", "''"))):
            with self.subTest(raw=raw):
                root = _write_project(self.base / f"q{i}", features="4.7",
                                      global_json=json.dumps(
                                          {"msbuild-sdks": {"Godot.NET.Sdk": raw}}))
                result = engine_pin.check(root)
                self.assertIsNone(result["godot_net_sdk"])
                self.assertEqual(result["pinned"], "4.7")
                self.assertEqual(len(result["warnings"]), 1)
                self.assertIn(f"Godot.NET.Sdk {shown} is not a version",
                              result["warnings"][0])
                self.assertIn("pinned from project.godot config/features 4.7",
                              result["warnings"][0])

    def test_present_unusable_sdk_and_no_features_names_the_key(self):
        root = _write_project(self.base / "p", features=None, sdk="")
        warnings = engine_pin.check(root)["warnings"]
        self.assertTrue(any("'' is not a version" in w for w in warnings))
        unreadable = [w for w in warnings if "pinned version unreadable" in w]
        self.assertEqual(len(unreadable), 1)
        self.assertIn("no Godot.NET.Sdk version in global.json", unreadable[0])

    def test_absent_sdk_key_has_no_not_a_version_warning(self):
        for sdk, features in ((None, "4.7"), (None, None)):
            with self.subTest(features=features):
                root = _write_project(self.base / f"p{features}", features=features,
                                      sdk=sdk)
                result = engine_pin.check(root)
                self.assertIsNone(result["godot_net_sdk"])
                self.assertFalse(any("is not a version" in w for w in result["warnings"]))
                if features is None:
                    self.assertIn("no Godot.NET.Sdk in global.json",
                                  result["warnings"][0])
                else:
                    self.assertEqual(result["warnings"], [])

    def test_features_and_sdk_disagree(self):
        root = _write_project(self.base / "p", features="4.7", sdk="4.8.1")
        warnings = engine_pin.check(root)["warnings"]
        disagree = [w for w in warnings if "major.minor disagreement" in w]
        self.assertEqual(len(disagree), 1)
        self.assertIn("4.7", disagree[0])
        self.assertIn("4.8.1", disagree[0])
        self.assertIn("project.godot", disagree[0])
        self.assertIn("global.json", disagree[0])

    def test_unreadable(self):
        root = _write_project(self.base / "p", features=None, sdk=None, dotnet=None)
        result = engine_pin.check(root)
        self.assertIsNone(result["pinned"])
        self.assertIsNone(result["in_range"])
        self.assertEqual(len(result["warnings"]), 1)
        self.assertIn("pinned version unreadable", result["warnings"][0])

    # ---- every refusal

    def test_refusals(self):
        empty = self.base / "empty"
        empty.mkdir()
        bad = _write_project(self.base / "bad", global_json="{not json")
        good = _write_project(self.base / "good")
        cases = [("no project.godot", ["check", "--directory", str(empty)]),
                 ("unknown skill", ["check", "--directory", str(good), "--skill", "nope"]),
                 ("malformed global.json", ["check", "--directory", str(bad)]),
                 ("bad invocation", ["check"])]
        for marker, argv in cases:
            with self.subTest(marker):
                result, code = self._cli(argv)
                self.assertEqual(code, 2)
                self.assertEqual(result["status"], "blocked")
                self.assertEqual(result["intent"], "gds-engine-godot-4")
                self.assertIn(marker, result["reason"])

    # ---- the status block

    def test_status_block_last_and_complete_with_warnings(self):
        root = _write_project(self.base / "p", features="4.8", sdk="4.8.0")
        result, code = self._cli(["check", "--directory", str(root)])
        self.assertEqual(code, 0)
        self.assertEqual(list(result)[-4:], ["status", "intent", "artifacts", "reason"])
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["intent"], "gds-engine-godot-4")
        self.assertEqual(result["artifacts"], [])
        self.assertIsNone(result["reason"])
        for key in ("engine", "features_version", "godot_net_sdk", "dotnet_sdk",
                    "pinned", "supported", "in_range", "warnings"):
            self.assertIn(key, result)
        self.assertTrue(result["warnings"])

    def test_cli_runs_as_a_script_with_stdin_closed(self):
        root = _write_project(self.base / "p")
        proc = subprocess.run([sys.executable, str(LIB / "engine_pin.py"), "check",
                               "--directory", str(root)],
                              stdin=subprocess.DEVNULL, capture_output=True, text=True,
                              encoding="utf-8", timeout=30)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["pinned"], "4.7.2")

    # ---- the skill: placement, pin.json, knowledge, catalogue (AC3)

    def test_skill_folder_is_inside_the_plugin_skills(self):
        # the skills mount loads the whole plugin folder: placement is the mount
        self.assertTrue((SKILL_DIR / "SKILL.md").is_file())
        self.assertEqual(SKILL_DIR.parent, PLUGIN / "skills")
        self.assertEqual(json.loads((SKILL_DIR / "pin.json").read_text(encoding="utf-8")),
                         {"engine": "godot", "supported": {"min": "4.7", "below": "4.8"},
                          "tested": "4.7.2"})

    def test_skill_states_the_knowledge(self):
        text = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("name: gds-engine-godot-4", text)
        for needle in ("engine_pin.py", "config/features", "Godot.NET.Sdk", "--headless",
                       "GoDotTest", ".tscn", ".tres", ".godot/", "& $env:GODOT",
                       "WITH_GODOT", "engine.verify_commands", "verify.engine",
                       '"intent": "gds-engine-godot-4"',
                       "If the deterministic core is unrunnable"):
            self.assertIn(needle, text)

    def test_skill_cites_the_catalogue_and_never_forks_it(self):
        text = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("gds-game-architecture/engine-mcps.yaml", text)
        if not CATALOGUE.is_file():
            self.skipTest("the upstream GDS catalogue is not installed here")
        catalogue = CATALOGUE.read_text(encoding="utf-8")
        block = catalogue.split("\n  godot:", 1)[1]
        block = re.split(r"\n  [a-z_]+:\s*\n", block, maxsplit=1)[0]
        repos = re.findall(r'repo:\s*"([^"]+)"', block)
        self.assertTrue(repos)
        for repo in repos:
            self.assertNotIn(repo, text)

    # ---- the eval case (AC2)

    def test_eval_case_names_the_three_pinned_facts(self):
        prompt = EVAL_DIR / "prompt.md"
        case = EVAL_DIR / "case.yaml"
        self.assertTrue(prompt.is_file() or case.is_file())
        text = "\n".join(p.read_text(encoding="utf-8")
                         for p in sorted(EVAL_DIR.rglob("*")) if p.is_file())
        self.assertIn("gds-engine-godot-4", text)
        # a model following the skill runs the core first: the case allows it
        if prompt.is_file():
            head = prompt.read_text(encoding="utf-8").split("---")[1]
            tools = re.search(r"allowed_tools:\s*\[([^\]]*)\]", head).group(1)
            for tool in ("Bash", "Write", "Skill"):
                self.assertIn(tool, tools)
            self.assertIn("engine_pin.py check", prompt.read_text(encoding="utf-8"))
        for fact in ('"4.7"', "config/features", "Godot.NET.Sdk", "4.7.2", "8.0.100",
                     "& $env:GODOT", "bare `godot`"):
            self.assertIn(fact, text)


if __name__ == "__main__":
    unittest.main()
