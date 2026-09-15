"""Tests for the execution-pipeline routing core (lib/pipeline.py).

What must hold: the shipped legs are the measured pipeline-v2 defaults and
validate; a project's routing.toml overlays them per leg and field —
story override > first matching rule > project defaults > resource default —
with the winning tier named per field; runtime --set wins over everything;
apply writes only the managed policy block, the profile env line and
routing.current.json, leaves the rest of the policy byte-identical, is
idempotent, and refuses a missing policy rather than inventing one; bad
legs, models and efforts refuse; the CLI keeps the JSON/exit-code shape.
"""
from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pipeline  # noqa: E402

POLICY = """\
# bmad-loop orchestration policy.
[gates]
mode = "per-epic"

[adapter]
name = "claude"
model = ""
"""

PROFILE = """\
name = "claude"
binary = "claude"

[env]
CLAUDE_CODE_SUBAGENT_MODEL = "claude-sonnet-5"
CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN = "1"
"""

ROUTING = """\
[defaults]
review = { model = "claude-sonnet-5", effort = "medium" }

[consult]
triggers = ["verify-red", "halt"]
scope = "project scope"

[[rules]]
match = "9-*"
note = "prose"
implementer = { model = "claude-opus-5" }

[[rules]]
match = "*"
implementer = { model = "claude-sonnet-5" }

[stories."9-30-gated-scene"]
note = "R-tier"
session = { model = "claude-opus-5", effort = "high" }
"""


def _project(tmp: Path, *, routing: str | None = ROUTING, policy: bool = True,
             profile: bool = True) -> Path:
    root = tmp / "proj"
    loop = root / ".bmad-loop"
    (loop / "profiles").mkdir(parents=True)
    if routing is not None:
        (loop / "routing.toml").write_text(routing, encoding="utf-8")
    if policy:
        (loop / "policy.toml").write_text(POLICY, encoding="utf-8")
    if profile:
        (loop / "profiles" / "claude.toml").write_text(PROFILE, encoding="utf-8")
    return root


def _run(argv: list[str]) -> tuple[int, dict]:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = pipeline.main(argv)
    return code, json.loads(out.getvalue())


class ResourceDefaultsTests(unittest.TestCase):
    def test_shipped_legs_are_the_measured_pipeline_v2_shape(self):
        shipped = pipeline.resource_defaults()
        legs = shipped["legs"]
        self.assertEqual(set(legs), set(pipeline.LEGS))
        # the monitor session, implementer and reviewers on the mid tier
        for leg in ("session", "implementer", "reviewers", "supervise"):
            self.assertEqual(legs[leg]["model"], "claude-sonnet-5", leg)
        self.assertEqual(legs["session"]["effort"], "medium")
        self.assertEqual(legs["session"]["skill"], "bmad-build-auto")
        self.assertEqual(legs["supervise"]["effort"], "low")
        # the top execution tier only where judgment is bought deliberately
        for leg in ("consult", "seam", "review", "triage"):
            self.assertEqual(legs[leg]["model"], "claude-opus-5", leg)
        self.assertEqual(legs["seam"]["effort"], "medium")
        self.assertEqual(legs["review"]["effort"], "high")
        self.assertEqual(legs["planner"]["model"], "claude-fable-5-1")
        # subagent legs carry no effort — the harness passes none
        for leg in ("implementer", "reviewers", "consult"):
            self.assertNotIn("effort", legs[leg], leg)
        self.assertEqual(len(shipped["consult"]["triggers"]), 7)
        self.assertIn("verify-red", shipped["consult"]["triggers"])
        self.assertTrue(shipped["consult"]["scope"])

    def test_defaults_verb(self):
        code, out = _run(["defaults"])
        self.assertEqual(code, 0)
        self.assertTrue(out["ok"])
        self.assertEqual(out["resource"], "tk-studio-launch")
        self.assertEqual(out["legs"]["implementer"], {"model": "claude-sonnet-5"})


class ResolveTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = _project(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def test_no_project_routing_is_the_resource_default_everywhere(self):
        root = _project(Path(self._tmp.name) / "bare", routing=None)
        res = pipeline.resolve(root, "1-1-x")
        self.assertTrue(res["ok"])
        self.assertIsNone(res["project_routing"])
        for leg, fields in res["route"].items():
            for field in fields:
                self.assertEqual(res["sources"][leg][field], "resource-default")
        self.assertEqual(res["consult_source"], "resource-default")

    def test_tiers_per_leg_and_field(self):
        res = pipeline.resolve(self.root, "9-30-gated-scene")
        route, src = res["route"], res["sources"]
        # story override beats the 9-* rule for the session
        self.assertEqual(route["session"], {"model": "claude-opus-5", "effort": "high",
                                            "skill": "bmad-build-auto"})
        self.assertEqual(src["session"]["model"], "project-story")
        self.assertEqual(src["session"]["skill"], "resource-default")
        # the first matching rule supplies the implementer
        self.assertEqual(route["implementer"]["model"], "claude-opus-5")
        self.assertEqual(src["implementer"]["model"], "project-rule '9-*'")
        self.assertEqual(res["matched_rule"], "9-*")
        self.assertTrue(res["story_override"])
        self.assertEqual(res["note"], "R-tier")
        # project defaults overlay the shipped review leg
        self.assertEqual(route["review"], {"model": "claude-sonnet-5", "effort": "medium"})
        self.assertEqual(src["review"]["model"], "project-defaults")
        # untouched legs stay shipped
        self.assertEqual(route["seam"], {"model": "claude-opus-5", "effort": "medium"})
        self.assertEqual(src["seam"]["model"], "resource-default")
        # the consult policy resolves as a unit
        self.assertEqual(res["consult_policy"]["triggers"], ["verify-red", "halt"])
        self.assertEqual(res["consult_source"], "project")

    def test_first_rule_wins_and_no_story_skips_rules(self):
        res = pipeline.resolve(self.root, "2-4-thing")
        self.assertEqual(res["matched_rule"], "*")
        self.assertEqual(res["route"]["implementer"]["model"], "claude-sonnet-5")
        self.assertFalse(res["story_override"])
        res = pipeline.resolve(self.root, None)
        self.assertIsNone(res["matched_rule"])
        self.assertEqual(res["sources"]["implementer"]["model"], "resource-default")

    def test_runtime_wins_over_every_tier(self):
        runtime = pipeline.parse_sets(["session.model=claude-sonnet-5", "implementer.model=claude-haiku-4-5-20251001"])
        res = pipeline.resolve(self.root, "9-30-gated-scene", runtime)
        self.assertEqual(res["route"]["session"]["model"], "claude-sonnet-5")
        self.assertEqual(res["sources"]["session"]["model"], "runtime")
        self.assertEqual(res["route"]["session"]["effort"], "high")  # untouched field keeps its tier
        self.assertEqual(res["route"]["implementer"]["model"], "claude-haiku-4-5-20251001")

    def test_bad_sets_refuse(self):
        for pair in ("session.model", "nope.model=claude-opus-5", "session.color=red",
                     "session.model=gpt-9", "seam.effort=max"):
            with self.assertRaises(pipeline.PipelineError, msg=pair):
                pipeline.parse_sets([pair])

    def test_bad_project_routing_refuses_named(self):
        (self.root / ".bmad-loop" / "routing.toml").write_text(
            '[defaults]\nsessoin = { model = "claude-opus-5" }\n'
            'seam = { model = "claude-opus-5", effort = "ultra" }\n', encoding="utf-8")
        with self.assertRaises(pipeline.PipelineError) as ctx:
            pipeline.resolve(self.root, "1-1")
        msg = str(ctx.exception)
        self.assertIn("unknown leg 'sessoin'", msg)
        self.assertIn("effort 'ultra'", msg)
        (self.root / ".bmad-loop" / "routing.toml").write_text("[defaults\n", encoding="utf-8")
        with self.assertRaises(pipeline.PipelineError):
            pipeline.resolve(self.root, "1-1")


class ApplyTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = _project(Path(self._tmp.name))
        self.loop = self.root / ".bmad-loop"

    def tearDown(self):
        self._tmp.cleanup()

    def test_apply_writes_block_profile_and_current_and_is_idempotent(self):
        res = pipeline.apply(self.root, "9-30-gated-scene")
        self.assertEqual(res["writes"], {"policy": "written", "profile": "written", "current": "written"})
        policy = (self.loop / "policy.toml").read_text(encoding="utf-8")
        # everything outside the block is byte-identical
        self.assertTrue(policy.startswith(POLICY.rstrip("\n") + "\n\n" + pipeline.BEGIN))
        self.assertIn("# story: 9-30-gated-scene\n[adapter.dev]\nmodel = \"claude-opus-5\"\n"
                      'extra_args = ["--permission-mode", "bypassPermissions", "--effort", "high"]', policy)
        self.assertIn('[adapter.review]\nmodel = "claude-sonnet-5"\n'
                      'extra_args = ["--permission-mode", "bypassPermissions", "--effort", "medium"]', policy)
        self.assertIn('[adapter.triage]\nmodel = "claude-opus-5"', policy)
        self.assertTrue(policy.endswith(pipeline.END + "\n"))
        profile = (self.loop / "profiles" / "claude.toml").read_text(encoding="utf-8")
        self.assertIn('CLAUDE_CODE_SUBAGENT_MODEL = "claude-opus-5"', profile)
        self.assertIn('CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN = "1"', profile)
        current = json.loads((self.loop / "routing.current.json").read_text(encoding="utf-8"))
        self.assertEqual(current["story"], "9-30-gated-scene")
        self.assertEqual(current["implementer"], {"model": "claude-opus-5"})
        self.assertEqual(current["consult"], {"model": "claude-opus-5"})
        self.assertEqual(current["consult_triggers"], ["verify-red", "halt"])
        self.assertEqual(current["consult_scope"], "project scope")
        self.assertEqual(current["planner"]["model"], "claude-fable-5-1")
        self.assertEqual(current["sources"]["session"]["model"], "project-story")
        # second apply: nothing changes
        again = pipeline.apply(self.root, "9-30-gated-scene")
        self.assertEqual(again["writes"], {"policy": "unchanged", "profile": "unchanged", "current": "unchanged"})
        # a different story replaces the one block in place, once
        other = pipeline.apply(self.root, "2-4-thing")
        self.assertEqual(other["writes"]["policy"], "written")
        policy = (self.loop / "policy.toml").read_text(encoding="utf-8")
        self.assertEqual(policy.count(pipeline.BEGIN), 1)
        self.assertIn("# story: 2-4-thing", policy)
        self.assertNotIn("9-30-gated-scene", policy)

    def test_apply_replaces_a_legacy_applier_block(self):
        text = POLICY + ("\n# >>> routing (managed by scripts/loop/apply-route.py) — do not edit inside this block\n"
                         "# story: old\n[adapter.dev]\nmodel = \"claude-opus-5\"\n\n# <<< routing\n")
        (self.loop / "policy.toml").write_text(text, encoding="utf-8")
        pipeline.apply(self.root, "2-4-thing")
        policy = (self.loop / "policy.toml").read_text(encoding="utf-8")
        self.assertEqual(policy.count("# >>> routing"), 1)
        self.assertNotIn("apply-route.py", policy)
        self.assertIn("# story: 2-4-thing", policy)

    def test_dry_run_writes_nothing(self):
        res = pipeline.apply(self.root, "2-4-thing", dry_run=True)
        self.assertTrue(res["dry_run"])
        self.assertEqual(res["writes"]["policy"], "written")
        self.assertEqual((self.loop / "policy.toml").read_text(encoding="utf-8"), POLICY)
        self.assertFalse((self.loop / "routing.current.json").exists())

    def test_missing_policy_refuses_and_missing_profile_is_skipped(self):
        root = _project(Path(self._tmp.name) / "nopolicy", policy=False)
        with self.assertRaises(pipeline.PipelineError) as ctx:
            pipeline.apply(root, "2-4-thing")
        self.assertIn("policy missing", str(ctx.exception))
        self.assertFalse((root / ".bmad-loop" / "policy.toml").exists())
        root = _project(Path(self._tmp.name) / "noprofile", profile=False)
        res = pipeline.apply(root, "2-4-thing")
        self.assertEqual(res["writes"]["profile"], "skipped (no tracked profile)")
        self.assertFalse((root / ".bmad-loop" / "profiles" / "claude.toml").exists())

    def test_profile_env_line_is_added_when_absent(self):
        (self.loop / "profiles" / "claude.toml").write_text('name = "claude"\n', encoding="utf-8")
        pipeline.apply(self.root, "2-4-thing")
        profile = (self.loop / "profiles" / "claude.toml").read_text(encoding="utf-8")
        self.assertEqual(profile, 'name = "claude"\n\n[env]\nCLAUDE_CODE_SUBAGENT_MODEL = "claude-sonnet-5"\n')


class CliTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = _project(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def test_check_ok_and_problems(self):
        code, out = _run(["check", "--directory", str(self.root)])
        self.assertEqual(code, 0)
        self.assertTrue(out["ok"])
        self.assertTrue(out["present"])
        self.assertEqual(out["rules"], ["9-*", "*"])
        self.assertEqual(out["story_overrides"], ["9-30-gated-scene"])
        (self.root / ".bmad-loop" / "routing.toml").write_text(
            '[defaults]\nsession = { model = "gpt-9" }\n', encoding="utf-8")
        code, out = _run(["check", "--directory", str(self.root)])
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])
        self.assertEqual(len(out["problems"]), 1)
        bare = _project(Path(self._tmp.name) / "bare", routing=None)
        code, out = _run(["check", "--directory", str(bare)])
        self.assertEqual((code, out["ok"], out["present"]), (0, True, False))

    def test_resolve_and_apply_cli(self):
        code, out = _run(["resolve", "--directory", str(self.root), "--story", "2-4-x",
                          "--set", "reviewers.model=claude-opus-5"])
        self.assertEqual(code, 0)
        self.assertEqual(out["route"]["reviewers"]["model"], "claude-opus-5")
        self.assertEqual(out["sources"]["reviewers"]["model"], "runtime")
        code, out = _run(["apply", "--directory", str(self.root), "--story", "2-4-x", "--dry-run"])
        self.assertEqual(code, 0)
        self.assertTrue(out["dry_run"])
        self.assertIsInstance(out["unignored"], list)
        code, out = _run(["resolve", "--directory", str(self.root), "--set", "session.model=gpt-9"])
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])
        self.assertIn("gpt-9", out["error"])


if __name__ == "__main__":
    unittest.main()
