"""Tests for the role-aware orchestrator core (ST-5.1 acceptance criteria).

The core is stateless (AD-9): role from the per-user store → working_set.<role>
from tracked project config → name-based routes. A missing role or unconfirmed
set is a needs-onboarding outcome naming the gap — never an invented set.
"""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config as configlib  # noqa: E402
import orchestrate  # noqa: E402
import recommend  # noqa: E402
import store as storelib  # noqa: E402

LOCK = """\
lock_version: 1
core:
  package: bmad-method
  version: 6.10.0
modules:
  bmm:
    version: 6.10.0
  tea:
    version: v1.19.1
  cis:
    version: v0.2.1
"""

SKILL_MANIFEST = """\
canonicalId,name,module,description,path
bmad-dev-story,dev-story,bmm,Execute story implementation,_bmad/bmm/skills/dev-story
bmad-create-prd,create-prd,bmm,Create a PRD,_bmad/bmm/skills/create-prd
bmad-testarch-atdd,atdd,tea,Generate acceptance tests,_bmad/tea/skills/atdd
"""

INSTALLED_MANIFEST = """\
version: 6.10.0
modules:
  - name: bmm
    version: 6.10.0
  - name: tea
    version: v1.19.1
"""


def _tree_snapshot(root: Path) -> dict[str, float]:
    return {str(p.relative_to(root)): (p.stat().st_mtime if p.is_file() else 0)
            for p in root.rglob("*")}


class OrchestrateTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        self.store = base / "store"
        os.environ["TK_STUDIO_HOME"] = str(self.store)
        # hermetic: never read the real ~/.claude.json (assistant profile)
        self._old_claude = os.environ.get("CLAUDE_CONFIG_DIR")
        self.claude_dir = base / "claude"
        os.environ["CLAUDE_CONFIG_DIR"] = str(self.claude_dir)
        self.root = base / "proj"
        self.root.mkdir()
        self.lock = base / "bmad.lock"
        self.lock.write_text(LOCK, encoding="utf-8", newline="\n")

    def tearDown(self):
        for key, old in (("TK_STUDIO_HOME", self._old_home),
                         ("CLAUDE_CONFIG_DIR", self._old_claude)):
            if old is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = old
        self._tmp.cleanup()

    def _store_with_role(self, role="developer"):
        self.store.mkdir(parents=True, exist_ok=True)
        (self.store / "config.yaml").write_text(
            f"user_name: tester\nrole: {role}\nmachine_id: box\n",
            encoding="utf-8")

    def _confirmed_set(self, role="developer", resources=("bmm", "tea")):
        configlib.standup_project_config(self.root)
        recommend.record(self.root, role, list(resources))

    def _install_bmad(self):
        conf = self.root / "_bmad" / "_config"
        conf.mkdir(parents=True)
        (conf / "manifest.yaml").write_text(INSTALLED_MANIFEST, encoding="utf-8")
        (conf / "skill-manifest.csv").write_text(SKILL_MANIFEST, encoding="utf-8")

    def _resolve(self, **kwargs):
        kwargs.setdefault("lock_path", self.lock)
        return orchestrate.resolve(self.root, **kwargs)

    # --- AC 1: role → working_set.<role> → name-based routes, statelessly

    def test_ready_resolves_role_set_and_routes(self):
        self._store_with_role("developer")
        self._confirmed_set()
        self._install_bmad()
        result = self._resolve()
        self.assertEqual(result["outcome"], "ready")
        self.assertEqual(result["role"], "developer")
        self.assertEqual(result["role_source"], "user-store")
        self.assertEqual(result["working_set"], ["bmm", "tea"])
        self.assertEqual(result["gaps"], [])
        by_name = {r["name"]: r for r in result["routes"]}
        self.assertEqual(set(by_name), {"bmm", "tea"})
        # a module expands to its installed skills — stock BMad names included
        self.assertEqual(by_name["bmm"]["skills"],
                         ["bmad-create-prd", "bmad-dev-story"])
        self.assertEqual(by_name["tea"]["skills"], ["bmad-testarch-atdd"])

    def test_role_override_beats_store(self):
        self._store_with_role("developer")
        configlib.standup_project_config(self.root)
        recommend.record(self.root, "direction-giver", ["cis"])
        result = self._resolve(role="direction-giver")
        self.assertEqual(result["outcome"], "ready")
        self.assertEqual(result["role_source"], "override")
        self.assertEqual(result["working_set"], ["cis"])

    def test_resolution_is_stateless_and_read_only(self):
        self._store_with_role("developer")
        self._confirmed_set()
        self._install_bmad()
        before_proj = _tree_snapshot(self.root)
        before_store = _tree_snapshot(self.store)
        first = self._resolve()
        second = self._resolve()
        self.assertEqual(first, second)  # byte-identical: no timestamps, no state
        self.assertEqual(before_proj, _tree_snapshot(self.root))
        self.assertEqual(before_store, _tree_snapshot(self.store))

    def test_missing_confirmed_resource_routes_visible_never_dropped(self):
        self._store_with_role("developer")
        self._confirmed_set(resources=("bmm", "vanished-skill"))
        self._install_bmad()
        result = self._resolve()
        self.assertEqual(result["outcome"], "ready")
        ghost = next(r for r in result["routes"] if r["name"] == "vanished-skill")
        self.assertEqual(ghost["status"], "missing")
        self.assertTrue(any("vanished-skill" in n for n in result["notes"]))

    def test_user_authored_resource_routes_by_name(self):
        self._store_with_role("developer")
        d = self.root / ".claude" / "skills" / "my-reviewer"
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text(
            "---\nname: my-reviewer\ndescription: Mine.\n---\n", encoding="utf-8")
        self._confirmed_set(resources=("my-reviewer",))
        result = self._resolve()
        route = result["routes"][0]
        self.assertEqual((route["name"], route["kind"], route["status"]),
                         ("my-reviewer", "skill", "installed"))

    # --- addressing: display_name rides along from the store (never the role)

    def _store_with_display_name(self, role="developer", name="Tim-Senpai"):
        self.store.mkdir(parents=True, exist_ok=True)
        (self.store / "config.yaml").write_text(
            f"user_name: tester\nrole: {role}\nmachine_id: box\n"
            f"display_name: {name}\n", encoding="utf-8")

    def test_display_name_rides_along_from_store(self):
        self._store_with_display_name()
        self._confirmed_set()
        self._install_bmad()
        result = self._resolve()
        self.assertEqual(result["display_name"], "Tim-Senpai")

    def test_display_name_null_when_unset(self):
        self._store_with_role("developer")
        self._confirmed_set()
        result = self._resolve()
        self.assertIsNone(result["display_name"])

    def test_recorded_fallback_choice_surfaces_verbatim(self):
        # "assistant-preference" is a settled choice, not an unset — the
        # attended flow must see the difference to know not to ask again
        self._store_with_display_name(name="assistant-preference")
        self._confirmed_set()
        result = self._resolve()
        self.assertEqual(result["display_name"], "assistant-preference")

    def test_display_name_survives_role_override_and_gaps(self):
        # the address is independent of the role: an override doesn't drop
        # it, and a needs-onboarding outcome still carries it (the greeting
        # happens before the gap is closed)
        self._store_with_display_name(role="developer")
        result = self._resolve(role="direction-giver")
        self.assertEqual(result["outcome"], "needs-onboarding")
        self.assertEqual(result["role_source"], "override")
        self.assertEqual(result["display_name"], "Tim-Senpai")

    # --- address: resolved in the core, not guessed by presentation

    def _claude_profile(self, text):
        self.claude_dir.mkdir(parents=True, exist_ok=True)
        (self.claude_dir / ".claude.json").write_text(text, encoding="utf-8")

    def _profile_name(self, name):
        self._claude_profile(json.dumps(
            {"oauthAccount": {"displayName": name, "emailAddress": "x@y.z"},
             "projects": {}}))

    def test_recorded_name_wins_over_assistant_profile(self):
        self._store_with_display_name(name="Tim")
        self._profile_name("Profile-Name")
        result = self._resolve()
        self.assertEqual((result["address"], result["address_source"]),
                         ("Tim", "display_name"))

    def test_assistant_preference_resolves_to_profile_name(self):
        # the recorded fallback choice must yield the name the Claude app
        # shows, not leave presentation to guess it (the model is never told)
        self._store_with_display_name(name="assistant-preference")
        self._profile_name("Tim-Senpai")
        self._confirmed_set()
        result = self._resolve()
        self.assertEqual(result["display_name"], "assistant-preference")
        self.assertEqual((result["address"], result["address_source"]),
                         ("Tim-Senpai", "assistant-profile"))

    def test_unset_display_name_also_follows_profile(self):
        self._store_with_role("developer")
        self._profile_name("Tim-Senpai")
        result = self._resolve()
        self.assertIsNone(result["display_name"])
        self.assertEqual(result["address"], "Tim-Senpai")

    def test_no_usable_profile_name_addresses_plainly(self):
        self._store_with_display_name(name="assistant-preference")
        self._confirmed_set()
        cases = {
            "no file": None,
            "malformed json": "{not json",
            "not an object": "[1, 2]",
            "no oauthAccount": json.dumps({"projects": {}}),
            "oauthAccount not an object": json.dumps({"oauthAccount": "x"}),
            "no displayName": json.dumps({"oauthAccount": {}}),
            "non-string": json.dumps({"oauthAccount": {"displayName": 7}}),
            "blank": json.dumps({"oauthAccount": {"displayName": "  "}}),
            "multi-line": json.dumps({"oauthAccount": {"displayName": "a\nb"}}),
        }
        for label, text in cases.items():
            with self.subTest(label):
                path = self.claude_dir / ".claude.json"
                if text is None:
                    path.unlink(missing_ok=True)
                else:
                    self._claude_profile(text)
                result = self._resolve()
                self.assertEqual(result["outcome"], "ready")
                self.assertIsNone(result["address"])
                self.assertIsNone(result["address_source"])

    def test_profile_name_is_trimmed(self):
        self._profile_name("  Tim-Senpai ")
        self.assertEqual(orchestrate.assistant_display_name(), "Tim-Senpai")

    def test_claude_config_path_follows_claude_config_dir(self):
        self.assertEqual(orchestrate.claude_global_config_path(),
                         self.claude_dir / ".claude.json")
        os.environ.pop("CLAUDE_CONFIG_DIR")
        self.assertEqual(orchestrate.claude_global_config_path(),
                         Path.home() / ".claude.json")

    # --- AC 1b: role-specific framing from the same door

    def test_developer_gets_execution_framing(self):
        self._store_with_role("developer")
        self._confirmed_set()
        result = self._resolve()
        self.assertEqual(result["framing"]["posture"], "execute")

    def test_direction_giver_gets_delegation_synthesis_framing(self):
        self._store_with_role("direction-giver")
        configlib.standup_project_config(self.root)
        recommend.record(self.root, "direction-giver", ["cis"])
        result = self._resolve()
        self.assertEqual(result["framing"]["posture"], "delegate-and-synthesize")
        self.assertIn("synthesize", result["framing"]["framing"])

    def test_unknown_role_gets_generic_posture_not_an_error(self):
        self._store_with_role("artist")
        configlib.standup_project_config(self.root)
        recommend.record(self.root, "artist", ["bmm"])
        result = self._resolve()
        self.assertEqual(result["outcome"], "ready")
        self.assertEqual(result["framing"]["posture"], "route-only")

    # --- AC 2: missing role / unconfirmed set → onboarding, never invented

    def test_missing_role_is_a_named_gap(self):
        # no store config at all
        configlib.standup_project_config(self.root)
        result = self._resolve()
        self.assertEqual(result["outcome"], "needs-onboarding")
        self.assertEqual(result["gaps"], ["role"])
        self.assertIsNone(result["working_set"])
        self.assertEqual(result["routes"], [])
        self.assertIn("tk-studio-onboard", result["next"]["attended"])
        self.assertIn("blocked", result["next"]["headless"])

    def test_unconfirmed_working_set_is_a_named_gap(self):
        self._store_with_role("developer")
        configlib.standup_project_config(self.root)  # config exists, no set
        result = self._resolve()
        self.assertEqual(result["outcome"], "needs-onboarding")
        self.assertEqual(result["gaps"], ["working_set.developer"])
        self.assertEqual(result["routes"], [])

    def test_other_roles_confirmation_does_not_leak(self):
        self._store_with_role("developer")
        configlib.standup_project_config(self.root)
        recommend.record(self.root, "direction-giver", ["cis"])
        result = self._resolve()
        self.assertEqual(result["outcome"], "needs-onboarding")
        self.assertEqual(result["gaps"], ["working_set.developer"])
        self.assertIsNone(result["working_set"])  # never another role's set

    def test_no_project_config_at_all_is_a_gap_not_a_crash(self):
        self._store_with_role("developer")
        result = self._resolve()
        self.assertEqual(result["outcome"], "needs-onboarding")
        self.assertEqual(result["gaps"], ["working_set.developer"])

    def test_bad_inputs_are_invocation_errors(self):
        with self.assertRaises(orchestrate.OrchestrateError):
            orchestrate.resolve(self.root / "nope")
        with self.assertRaises(orchestrate.OrchestrateError):
            self._resolve(role="Bad Role!")

    # --- CLI: any outcome exits 0; JSON on stdout

    def test_cli_ready_and_needs_onboarding_both_exit_zero(self):
        import contextlib
        import io
        import json as jsonlib
        self._store_with_role("developer")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = orchestrate.main(["resolve", "--directory", str(self.root),
                                     "--lock", str(self.lock)])
        self.assertEqual(code, 0)
        payload = jsonlib.loads(buf.getvalue())
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["outcome"], "needs-onboarding")

        self._confirmed_set()
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = orchestrate.main(["resolve", "--directory", str(self.root),
                                     "--lock", str(self.lock)])
        self.assertEqual(code, 0)
        self.assertEqual(jsonlib.loads(buf.getvalue())["outcome"], "ready")

    def test_cli_bad_invocation_exits_two(self):
        import contextlib
        import io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = orchestrate.main(["resolve", "--directory",
                                     str(self.root / "nope")])
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()
