"""Tests for recommend/confirm/record (ST-4.3 acceptance criteria).

Proposals carry evidence per resource and never write; recording lands only
on explicit confirmation under working_set.<role>, idempotently, without
touching any other role's entry.
"""
from __future__ import annotations

import io
import json
import os
import tempfile
from contextlib import redirect_stdout
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config as configlib  # noqa: E402
import recommend  # noqa: E402

LOCK = """\
lock_version: 1
core:
  package: bmad-method
  version: 6.10.0
install:
  flags:
    - --yes
modules:
  bmm:
    version: 6.10.0
  tea:
    version: v1.19.1
  gds:
    version: v0.6.0
  cis:
    version: v0.2.1
"""


def _tree_snapshot(root: Path) -> dict[str, float]:
    return {str(p.relative_to(root)): (p.stat().st_mtime if p.is_file() else 0)
            for p in root.rglob("*")}


class RecommendTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        os.environ["TK_STUDIO_HOME"] = str(base / "store")
        self.root = base / "proj"
        self.root.mkdir()
        self.lock = base / "bmad.lock"
        self.lock.write_text(LOCK, encoding="utf-8", newline="\n")

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()

    def _make_unreal(self):
        (self.root / "MyGame.uproject").write_text("{}", encoding="utf-8")
        (self.root / "Source").mkdir()
        (self.root / "Config").mkdir()

    def _make_user_skill(self):
        d = self.root / ".claude" / "skills" / "my-reviewer"
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text(
            "---\nname: my-reviewer\ndescription: Mine.\n---\n", encoding="utf-8")

    def _make_godot(self, features="4.7", sdk="4.7.2"):
        (self.root / "project.godot").write_text(
            "config_version=5\n\n[application]\n\nconfig/name=\"Fixture\"\n"
            f"config/features=PackedStringArray(\"{features}\", \"C#\", \"Forward Plus\")\n",
            encoding="utf-8")
        if sdk is not None:
            (self.root / "global.json").write_text(
                '{"sdk": {"version": "8.0.100"}, '
                f'"msbuild-sdks": {{"Godot.NET.Sdk": "{sdk}"}}}}', encoding="utf-8")

    def _propose(self, role="developer"):
        return recommend.propose(self.root, role=role, lock_path=self.lock)

    def _standup(self):
        configlib.standup_project_config(self.root)

    # --- AC 1: proposal carries evidence; dry-run writes nothing

    def test_proposal_carries_evidence_per_resource(self):
        self._make_unreal()
        self._make_user_skill()
        result = self._propose()
        names = {e["name"] for e in result["proposal"]}
        self.assertIn("gds", names)          # detection suggests
        self.assertIn("bmm", names)          # role default
        self.assertIn("my-reviewer", names)  # user-authored, first-class
        for entry in result["proposal"]:
            self.assertTrue(entry["evidence"], f"{entry['name']} has no evidence")
        gds = next(e for e in result["proposal"] if e["name"] == "gds")
        self.assertTrue(any("detected game-unreal" in ev for ev in gds["evidence"]))
        mine = next(e for e in result["proposal"] if e["name"] == "my-reviewer")
        self.assertTrue(any("authored in this project" in ev for ev in mine["evidence"]))

    def test_propose_is_read_only(self):
        self._make_unreal()
        self._standup()
        before = _tree_snapshot(self.root)
        self._propose()
        self.assertEqual(before, _tree_snapshot(self.root))

    def test_ask_outcome_adds_no_detection_suggestions(self):
        result = self._propose()  # empty project → unknown — ask
        self.assertEqual(result["detection_outcome"], "unknown — ask")
        names = {e["name"] for e in result["proposal"]}
        self.assertEqual(names, {"bmm", "tea"})  # role base only
        self.assertTrue(any("ask the operator" in n for n in result["notes"]))

    def test_role_changes_the_proposal(self):
        dev = self._propose(role="developer")
        giver = self._propose(role="direction-giver")
        self.assertIn("tea", {e["name"] for e in dev["proposal"]})
        self.assertIn("cis", {e["name"] for e in giver["proposal"]})

    # --- Story 34.4: the plugin-shipped engine skill, pinned per project

    def _engine_entry(self, result):
        return next((e for e in result["proposal"] if e["name"] == "gds-engine-godot-4"), None)

    def test_confident_godot_suggests_the_engine_skill_with_evidence(self):
        self._make_godot()
        result = self._propose()
        self.assertEqual(result["detection_outcome"], "confident")
        entry = self._engine_entry(result)
        self.assertIsNotNone(entry)
        self.assertEqual(entry["kind"], "skill")
        self.assertEqual(entry["status"], "installed")
        self.assertTrue(any(ev.startswith("detection: detected game-godot (score ")
                            for ev in entry["evidence"]))
        self.assertIn("engine-pin: pinned 4.7.2 from global.json; supported 4.7..4.8",
                      entry["evidence"])
        self.assertNotIn("warnings", entry)
        self.assertFalse(any(n.startswith("gds-engine-godot-4: ") for n in result["notes"]))

    def test_ask_outcome_suggests_no_engine_skill(self):
        (self.root / "main.gd").write_text("extends Node\n", encoding="utf-8")
        result = self._propose()
        self.assertNotEqual(result["detection_outcome"], "confident")
        self.assertIsNone(self._engine_entry(result))

    def test_out_of_range_warns_on_the_entry_and_in_notes(self):
        for features, sdk in (("4.8", "4.8.0"), ("4.6", "4.6.1")):
            with self.subTest(sdk=sdk):
                self._make_godot(features=features, sdk=sdk)
                result = self._propose()
                entry = self._engine_entry(result)
                self.assertIsNotNone(entry)  # still proposed: the operator decides
                self.assertEqual(len(entry["warnings"]), 1)
                self.assertIn(sdk, entry["warnings"][0])
                self.assertIn(f"gds-engine-godot-4: {entry['warnings'][0]}", result["notes"])

    def test_non_numeric_sdk_pins_from_project_godot(self):
        self._make_godot(features="4.7", sdk="$(GodotVersion)")
        result = self._propose()
        entry = self._engine_entry(result)
        self.assertIn("engine-pin: pinned 4.7 from project.godot; supported 4.7..4.8",
                      entry["evidence"])
        self.assertTrue(any("$(GodotVersion)" in w for w in entry["warnings"]))

    def test_features_sdk_disagreement_warns(self):
        self._make_godot(features="4.7", sdk="4.8.1")
        entry = self._engine_entry(self._propose())
        self.assertTrue(any("major.minor disagreement" in w for w in entry["warnings"]))

    def test_unreadable_pin_warns(self):
        (self.root / "project.godot").write_text("[application]\n", encoding="utf-8")
        result = self._propose()
        entry = self._engine_entry(result)
        self.assertTrue(any("pinned version unreadable" in w for w in entry["warnings"]))
        self.assertTrue(any(n.startswith("gds-engine-godot-4: pinned version unreadable")
                            for n in result["notes"]))

    def test_pin_refusal_still_proposes_with_a_not_checked_warning(self):
        self._make_godot(sdk=None)
        (self.root / "global.json").write_text("// pin\n{not json", encoding="utf-8")
        self._standup()
        result = self._propose()
        self.assertEqual(result["detection_outcome"], "confident")
        entry = self._engine_entry(result)
        self.assertIsNotNone(entry)  # still proposed: the operator decides
        self.assertTrue(any(ev.startswith("engine-pin: engine pin not checked: "
                                          "malformed global.json")
                            for ev in entry["evidence"]))
        self.assertEqual(len(entry["warnings"]), 1)
        self.assertTrue(entry["warnings"][0].startswith(
            "engine pin not checked: malformed global.json"))
        self.assertIn(f"gds-engine-godot-4: {entry['warnings'][0]}", result["notes"])
        self.assertIsNone(recommend.read_working_set(self.root).get("developer"))

    def test_record_writes_the_engine_skill_only_when_confirmed(self):
        self._make_godot()
        self._standup()
        self.assertIsNotNone(self._engine_entry(self._propose()))
        self.assertIsNone(recommend.read_working_set(self.root).get("developer"))
        recommend.record(self.root, "developer", ["bmm", "tea", "gds"])
        self.assertNotIn("gds-engine-godot-4",
                         recommend.read_working_set(self.root)["developer"])
        recommend.record(self.root, "developer", ["bmm", "tea", "gds", "gds-engine-godot-4"])
        self.assertIn("gds-engine-godot-4", recommend.read_working_set(self.root)["developer"])

    # --- Story 34.5: the engine MCP — proposed on a fixture profile, written only by record --mcp

    MCP = "fixture-engine-mcp"

    def _mcp_profiles(self) -> Path:
        """The shipped profiles with `suggests_mcp` on game-godot only (the
        shipped profile carries no pick until the spike's ruling)."""
        profiles = Path(self._tmp.name) / "profiles"
        profiles.mkdir(exist_ok=True)
        for path in recommend.detectlib.DEFAULT_PROFILES_DIR.glob("*.json"):
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("id") == "game-godot":
                data["suggests_mcp"] = [self.MCP]
            (profiles / path.name).write_text(json.dumps(data), encoding="utf-8")
        return profiles

    def _mcp_entry(self, result):
        return next((e for e in result["proposal"] if e["name"] == self.MCP), None)

    def _propose_mcp(self):
        return recommend.propose(self.root, role="developer", lock_path=self.lock,
                                 profiles_dir=self._mcp_profiles())

    def test_confident_godot_proposes_the_mcp_not_configured_and_writes_nothing(self):
        self._make_godot()
        profiles = self._mcp_profiles()
        before = _tree_snapshot(self.root)
        result = recommend.propose(self.root, role="developer", lock_path=self.lock,
                                   profiles_dir=profiles)
        self.assertEqual(before, _tree_snapshot(self.root))  # propose never writes
        self.assertFalse((self.root / ".mcp.json").exists())
        entry = self._mcp_entry(result)
        self.assertEqual(entry["kind"], "mcp")
        self.assertEqual(entry["status"], "not-configured")
        self.assertTrue(any(ev.startswith("detection: detected game-godot (score ")
                            for ev in entry["evidence"]))
        self.assertIn("kb: kb/engine-mcp-godot.md", entry["evidence"])

    def test_mcp_status_configured_when_mcp_json_has_the_server(self):
        self._make_godot()
        (self.root / ".mcp.json").write_text(
            json.dumps({"mcpServers": {self.MCP: {"type": "http"}}}), encoding="utf-8")
        self.assertEqual(self._mcp_entry(self._propose_mcp())["status"], "configured")

    def test_ask_outcome_proposes_no_mcp(self):
        result = self._propose_mcp()  # empty project → unknown — ask
        self.assertIsNone(self._mcp_entry(result))
        self.assertFalse(any(e["kind"] == "mcp" for e in result["proposal"]))

    def test_shipped_profiles_propose_no_mcp(self):
        self._make_godot()
        self.assertFalse(any(e["kind"] == "mcp" for e in self._propose()["proposal"]))

    def test_record_mcp_writes_only_when_confirmed_merges_and_is_idempotent(self):
        self._make_godot()
        profiles = self._mcp_profiles()
        self._propose_mcp()
        self.assertFalse((self.root / ".mcp.json").exists())  # proposing wrote nothing
        other = {"type": "stdio", "command": "other-server", "args": ["--x"]}
        target = self.root / ".mcp.json"
        target.write_text(json.dumps({"mcpServers": {"other": other}, "keep": 1}), encoding="utf-8")
        result = recommend.record_mcp(self.root, self.MCP, profiles_dir=profiles)
        self.assertTrue(result["changed"])
        data = json.loads(target.read_text(encoding="utf-8"))
        self.assertEqual(data["mcpServers"]["other"], other)  # other servers untouched
        self.assertEqual(data["keep"], 1)
        # The `${VAR:-}` default form: the file still parses where neither is set.
        self.assertEqual(data["mcpServers"][self.MCP], {
            "type": "http", "url": "${TK_ENGINE_MCP_URL:-}",
            "headers": {"Authorization": "Bearer ${TK_ENGINE_MCP_BEARER:-}"}})
        self.assertTrue(target.read_text(encoding="utf-8").endswith("}\n"))
        first = target.read_bytes()
        again = recommend.record_mcp(self.root, self.MCP, profiles_dir=profiles)
        self.assertFalse(again["changed"])
        self.assertEqual(target.read_bytes(), first)
        self.assertEqual(self._mcp_entry(self._propose_mcp())["status"], "configured")
        self.assertEqual(sorted(p.name for p in self.root.iterdir() if p.name.startswith(".mcp")),
                         [".mcp.json"])  # no temp file left behind

    def test_record_mcp_rewrites_an_entry_in_the_earlier_form_without_a_default(self):
        profiles = self._mcp_profiles()
        target = self.root / ".mcp.json"
        old = {"type": "http", "url": "${TK_ENGINE_MCP_URL}",
               "headers": {"Authorization": "Bearer ${TK_ENGINE_MCP_BEARER}"}}
        target.write_text(json.dumps({"mcpServers": {self.MCP: old}}), encoding="utf-8")
        result = recommend.record_mcp(self.root, self.MCP, profiles_dir=profiles)
        self.assertTrue(result["changed"])  # rewritten, not treated as the same entry
        self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["mcpServers"][self.MCP],
                         recommend.MCP_ENTRY)
        self.assertFalse(recommend.record_mcp(self.root, self.MCP, profiles_dir=profiles)["changed"])

    def test_record_with_role_and_a_refused_mcp_writes_neither(self):
        self._standup()
        profiles = str(self._mcp_profiles())
        config = self.root / ".tk-studio" / "config.yaml"
        before = config.read_bytes()
        for mcp, mcp_json in (("not-a-pick", None), (self.MCP, "{not json"),
                              (self.MCP, json.dumps({"mcpServers": []}))):
            if mcp_json is not None:
                (self.root / ".mcp.json").write_text(mcp_json, encoding="utf-8")
            out = io.StringIO()
            with redirect_stdout(out):
                code = recommend.main(["record", "--directory", str(self.root), "--role", "developer",
                                       "--resources", "bmm,tea", "--mcp", mcp, "--profiles-dir", profiles])
            self.assertEqual(code, 2, mcp_json)
            self.assertFalse(json.loads(out.getvalue())["ok"])
            self.assertEqual(config.read_bytes(), before)  # no half write: the working set untouched
        self.assertEqual((self.root / ".mcp.json").read_text(encoding="utf-8"),
                         json.dumps({"mcpServers": []}))
        # Both valid: both land.
        (self.root / ".mcp.json").unlink()
        out = io.StringIO()
        with redirect_stdout(out):
            code = recommend.main(["record", "--directory", str(self.root), "--role", "developer",
                                   "--resources", "bmm,tea", "--mcp", self.MCP, "--profiles-dir", profiles])
        self.assertEqual(code, 0)
        self.assertEqual(recommend.read_working_set(self.root)["developer"], ["bmm", "tea"])
        self.assertIn(self.MCP, json.loads((self.root / ".mcp.json").read_text(encoding="utf-8"))["mcpServers"])

    def test_record_mcp_creates_the_file_and_honours_dry_run(self):
        profiles = self._mcp_profiles()
        dry = recommend.record_mcp(self.root, self.MCP, dry_run=True, profiles_dir=profiles)
        self.assertTrue(dry["changed"])
        self.assertTrue(dry["dry_run"])
        self.assertFalse((self.root / ".mcp.json").exists())
        recommend.record_mcp(self.root, self.MCP, profiles_dir=profiles)
        self.assertIn(self.MCP, json.loads((self.root / ".mcp.json").read_text(encoding="utf-8"))["mcpServers"])

    def test_record_mcp_refuses_unknown_name_and_malformed_json(self):
        profiles = self._mcp_profiles()
        with self.assertRaises(recommend.RecommendError):
            recommend.record_mcp(self.root, "not-a-pick", profiles_dir=profiles)
        with self.assertRaises(recommend.RecommendError):
            recommend.record_mcp(self.root, self.MCP)  # the shipped profiles name no pick
        (self.root / ".mcp.json").write_text("{not json", encoding="utf-8")
        with self.assertRaises(recommend.RecommendError):
            recommend.record_mcp(self.root, self.MCP, profiles_dir=profiles)
        self.assertEqual((self.root / ".mcp.json").read_text(encoding="utf-8"), "{not json")

    def test_record_mcp_cli_exit_codes_and_status_block(self):
        profiles = str(self._mcp_profiles())
        out = io.StringIO()
        with redirect_stdout(out):
            code = recommend.main(["record", "--directory", str(self.root), "--mcp", "nope",
                                   "--profiles-dir", profiles])
        self.assertEqual(code, 2)
        self.assertFalse(json.loads(out.getvalue())["ok"])
        self.assertFalse((self.root / ".mcp.json").exists())
        out = io.StringIO()
        with redirect_stdout(out):
            code = recommend.main(["record", "--directory", str(self.root), "--mcp", self.MCP,
                                   "--profiles-dir", profiles, "--dry-run"])
        self.assertEqual(code, 0)
        self.assertTrue(json.loads(out.getvalue())["ok"])
        self.assertFalse((self.root / ".mcp.json").exists())
        out = io.StringIO()
        with redirect_stdout(out):
            code = recommend.main(["record", "--directory", str(self.root), "--mcp", self.MCP,
                                   "--profiles-dir", profiles])
        self.assertEqual(code, 0)
        self.assertTrue((self.root / ".mcp.json").is_file())
        out = io.StringIO()
        with redirect_stdout(out):
            code = recommend.main(["record", "--directory", str(self.root)])
        self.assertEqual(code, 2)

    # --- AC 2: explicit confirmation → working_set.<role>, idempotent

    def test_record_lands_role_keyed_and_is_idempotent(self):
        self._standup()
        result = recommend.record(self.root, "developer", ["bmm", "tea"])
        self.assertTrue(result["changed"])
        self.assertEqual(recommend.read_working_set(self.root),
                         {"developer": ["bmm", "tea"]})
        tracked = self.root / ".tk-studio" / "config.yaml"
        text_after_first = tracked.read_text(encoding="utf-8")
        again = recommend.record(self.root, "developer", ["bmm", "tea"])
        self.assertFalse(again["changed"])
        self.assertEqual(tracked.read_text(encoding="utf-8"), text_after_first)

    def test_record_preserves_template_comments(self):
        self._standup()
        tracked = self.root / ".tk-studio" / "config.yaml"
        before = tracked.read_text(encoding="utf-8")
        recommend.record(self.root, "developer", ["bmm"])
        after = tracked.read_text(encoding="utf-8")
        for line in before.splitlines():
            if line.lstrip().startswith("#"):
                self.assertIn(line, after.splitlines())

    def test_record_dry_run_writes_nothing(self):
        self._standup()
        tracked = self.root / ".tk-studio" / "config.yaml"
        before = tracked.read_text(encoding="utf-8")
        result = recommend.record(self.root, "developer", ["bmm"], dry_run=True)
        self.assertTrue(result["dry_run"])
        self.assertEqual(tracked.read_text(encoding="utf-8"), before)
        self.assertEqual(result["working_set"]["developer"], ["bmm"])

    def test_record_requires_standup_and_nonempty_set(self):
        with self.assertRaises(recommend.RecommendError):
            recommend.record(self.root, "developer", ["bmm"])  # no config yet
        self._standup()
        with self.assertRaises(recommend.RecommendError):
            recommend.record(self.root, "developer", [])
        with self.assertRaises(recommend.RecommendError):
            recommend.record(self.root, "Bad Role!", ["bmm"])

    # --- AC 3: a second role never touches the first role's entry

    def test_second_role_leaves_first_untouched(self):
        self._standup()
        recommend.record(self.root, "developer", ["bmm", "tea"])
        tracked = self.root / ".tk-studio" / "config.yaml"
        dev_lines = [l for l in tracked.read_text(encoding="utf-8").splitlines()
                     if l.startswith(("  developer:", "    - "))]
        recommend.record(self.root, "direction-giver", ["bmm", "cis"])
        ws = recommend.read_working_set(self.root)
        self.assertEqual(ws["developer"], ["bmm", "tea"])
        self.assertEqual(ws["direction-giver"], ["bmm", "cis"])
        after = tracked.read_text(encoding="utf-8").splitlines()
        for line in dev_lines:
            self.assertIn(line, after)

    def test_reconfirming_one_role_updates_only_that_role(self):
        self._standup()
        recommend.record(self.root, "developer", ["bmm"])
        recommend.record(self.root, "direction-giver", ["cis"])
        recommend.record(self.root, "developer", ["bmm", "tea", "gds"])
        ws = recommend.read_working_set(self.root)
        self.assertEqual(ws["developer"], ["bmm", "tea", "gds"])
        self.assertEqual(ws["direction-giver"], ["cis"])

    def test_recorded_file_still_parses_and_resolves(self):
        self._standup()
        recommend.record(self.root, "developer", ["bmm", "tea"])
        value, scope = configlib.resolve("working_set.developer",
                                         project_root=self.root)
        self.assertEqual(value, ["bmm", "tea"])
        self.assertEqual(scope, "project-tracked")


if __name__ == "__main__":
    unittest.main()
