"""Tests for the execution-pipeline routing core (lib/pipeline.py).

What must hold: the shipped legs are the measured pipeline-v2 defaults and
validate; a project's routing.toml overlays them per leg and field —
story override > first matching rule > project defaults > resource default —
with the winning tier named per field; runtime --set wins over everything;
apply writes only the managed policy block, the profile env line and
routing.current.json, leaves the rest of the policy byte-identical, is
idempotent, and refuses a missing policy rather than inventing one; bad
legs, models and efforts refuse; the CLI keeps the JSON/exit-code shape.
Story 26.3: every leg carries an `advisor` (opus | fable | off, shipped off)
under the pairing rule, checked per table, on the overlaid route and on the
defaults-only effective route; `--advisor` reaches the policy block only when
the leg's advisor is not off; subagent legs inherit the session's effort.
"""
from __future__ import annotations

import contextlib
import io
import json
import subprocess
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
        self.assertEqual(out["legs"]["implementer"], {"model": "claude-sonnet-5", "advisor": "off"})

    def test_shipped_advisor_is_off_on_every_leg(self):
        legs = pipeline.resource_defaults()["legs"]
        for leg in pipeline.LEGS:
            self.assertEqual(legs[leg]["advisor"], "off", leg)
        # Story 26.3 changes no shipped model or effort value
        shipped = {leg: {f: v for f, v in fields.items() if f in ("model", "effort")}
                   for leg, fields in legs.items()}
        self.assertEqual(shipped, {
            "session": {"model": "claude-sonnet-5", "effort": "medium"},
            "implementer": {"model": "claude-sonnet-5"},
            "reviewers": {"model": "claude-sonnet-5"},
            "consult": {"model": "claude-opus-5"},
            "seam": {"model": "claude-opus-5", "effort": "medium"},
            "review": {"model": "claude-opus-5", "effort": "high"},
            "triage": {"model": "claude-opus-5", "effort": "high"},
            "supervise": {"model": "claude-sonnet-5", "effort": "low"},
            "planner": {"model": "claude-fable-5-1", "effort": "high"},
            # Story 34.3: the host leg's screenshot judge
            "playable-verify": {"model": "claude-sonnet-5", "effort": "medium"},
        })


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
                expected = ("inherited-session"
                            if field == "effort" and leg in pipeline.SUBAGENT_LEGS
                            else "resource-default")
                self.assertEqual(res["sources"][leg][field], expected, (leg, field))
        self.assertEqual(res["consult_source"], "resource-default")

    def test_tiers_per_leg_and_field(self):
        res = pipeline.resolve(self.root, "9-30-gated-scene")
        route, src = res["route"], res["sources"]
        # story override beats the 9-* rule for the session
        self.assertEqual(route["session"], {"model": "claude-opus-5", "effort": "high",
                                            "advisor": "off", "skill": "bmad-build-auto"})
        self.assertEqual(src["session"]["model"], "project-story")
        self.assertEqual(src["session"]["skill"], "resource-default")
        # the first matching rule supplies the implementer
        self.assertEqual(route["implementer"]["model"], "claude-opus-5")
        self.assertEqual(src["implementer"]["model"], "project-rule '9-*'")
        self.assertEqual(res["matched_rule"], "9-*")
        self.assertTrue(res["story_override"])
        self.assertEqual(res["note"], "R-tier")
        # project defaults overlay the shipped review leg
        self.assertEqual(route["review"], {"model": "claude-sonnet-5", "effort": "medium",
                                           "advisor": "off"})
        self.assertEqual(src["review"]["model"], "project-defaults")
        # untouched legs stay shipped
        self.assertEqual(route["seam"], {"model": "claude-opus-5", "effort": "medium",
                                         "advisor": "off"})
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

    def test_opus_5_5_routes_on_every_leg(self):
        # the 2026-09-28 trial routes every leg to Opus 5.5 from the project tier
        legs = "\n".join(f'{leg} = {{ model = "claude-opus-5-5" }}' for leg in pipeline.LEGS)
        (self.root / ".bmad-loop" / "routing.toml").write_text(
            f"[defaults]\n{legs}\n", encoding="utf-8")
        res = pipeline.resolve(self.root, "1-1")
        for leg in pipeline.LEGS:
            self.assertEqual(res["route"][leg]["model"], "claude-opus-5-5", msg=leg)
            self.assertEqual(res["sources"][leg]["model"], "project-defaults", msg=leg)
        runtime = pipeline.parse_sets(["session.model=claude-opus-5-5"])
        self.assertEqual(runtime["session"]["model"], "claude-opus-5-5")

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
        # every leg carries its advisor; subagent legs the session's effort
        self.assertEqual(current["implementer"], {"model": "claude-opus-5", "advisor": "off",
                                                  "effort": "high"})
        self.assertEqual(current["consult"], {"model": "claude-opus-5", "advisor": "off",
                                              "effort": "high"})
        self.assertEqual(current["sources"]["consult"]["effort"], "inherited-session")
        for leg in pipeline.LEGS:
            self.assertEqual(current[leg]["advisor"], "off", leg)
        self.assertNotIn("--advisor", policy)
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


class AdvisorTests(unittest.TestCase):
    """Story 26.3: the advisor field, the pairing rule, `--advisor` and the
    subagent effort inheritance — proven on temp projects and --set only."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = _project(Path(self._tmp.name))
        self.loop = self.root / ".bmad-loop"

    def tearDown(self):
        self._tmp.cleanup()

    def _routing(self, text: str) -> None:
        (self.loop / "routing.toml").write_text(text, encoding="utf-8")

    def test_default_every_leg_off_and_no_advisor_flag(self):
        res = pipeline.resolve(self.root, "2-4-thing")
        for leg in pipeline.LEGS:
            self.assertEqual(res["route"][leg]["advisor"], "off", leg)
        self.assertNotIn("--advisor", pipeline.render_block(res["route"], "2-4-thing"))

    def test_valid_pairing_puts_advisor_on_the_session_command_line(self):
        runtime = pipeline.parse_sets(["session.model=claude-opus-5-5", "session.advisor=fable"])
        res = pipeline.apply(self.root, "2-4-thing", runtime)
        self.assertEqual(res["route"]["session"]["advisor"], "fable")
        policy = (self.loop / "policy.toml").read_text(encoding="utf-8")
        self.assertIn('[adapter.dev]\nmodel = "claude-opus-5-5"\nextra_args = ["--permission-mode", '
                      '"bypassPermissions", "--effort", "medium", "--advisor", "fable"]', policy)
        self.assertEqual(policy.count("--advisor"), 1)
        current = json.loads((self.loop / "routing.current.json").read_text(encoding="utf-8"))
        self.assertEqual(current["session"]["advisor"], "fable")
        self.assertEqual(current["sources"]["session"]["advisor"], "runtime")

    def test_advisor_without_effort_still_emits_extra_args(self):
        route = {"session": {"model": "claude-opus-5", "advisor": "opus"},
                 "review": {"model": "claude-opus-5", "advisor": "off"},
                 "triage": {"model": "claude-opus-5"}}
        block = pipeline.render_block(route, "1-1")
        self.assertIn('[adapter.dev]\nmodel = "claude-opus-5"\nextra_args = ["--permission-mode", '
                      '"bypassPermissions", "--advisor", "opus"]', block)
        self.assertIn('[adapter.review]\nmodel = "claude-opus-5"\n\n', block)
        self.assertEqual(block.count("extra_args"), 1)

    def test_bad_vocabulary_refuses_named(self):
        with self.assertRaises(pipeline.PipelineError) as ctx:
            pipeline.parse_sets(["session.advisor=sonnet"])
        self.assertIn("advisor 'sonnet' not in ['opus', 'fable', 'off']", str(ctx.exception))
        self._routing('[defaults]\nreviewers = { model = "claude-sonnet-5", advisor = "sonnet" }\n')
        code, out = _run(["check", "--directory", str(self.root)])
        self.assertEqual(code, 2)
        self.assertIn("defaults.reviewers: advisor 'sonnet' not in ['opus', 'fable', 'off']",
                      out["problems"])
        code, out = _run(["resolve", "--directory", str(self.root)])
        self.assertEqual(code, 2)
        self.assertIn("advisor 'sonnet'", out["error"])

    def test_non_string_advisor_refuses_named_not_traceback(self):
        self._routing('[defaults]\nreviewers = { model = "claude-opus-5", advisor = ["opus"] }\n')
        code, out = _run(["check", "--directory", str(self.root)])
        self.assertEqual(code, 2)
        self.assertIn("defaults.reviewers: advisor ['opus'] not in ['opus', 'fable', 'off']",
                      out["problems"])
        code, out = _run(["resolve", "--directory", str(self.root)])
        self.assertEqual((code, out["ok"]), (2, False))
        self.assertIn("advisor ['opus'] not in", out["error"])

    def test_pairing_violation_in_one_table(self):
        msg = ("stories.1-1.session: advisor 'opus' ranks below model 'claude-fable-5-1' "
               "(the advisor must rank at or above the leg's model)")
        self._routing('[stories."1-1"]\nsession = { model = "claude-fable-5-1", advisor = "opus" }\n')
        code, out = _run(["check", "--directory", str(self.root)])
        self.assertEqual(code, 2)
        self.assertEqual(out["problems"], [msg])
        code, out = _run(["resolve", "--directory", str(self.root), "--story", "1-1"])
        self.assertEqual((code, out["ok"]), (2, False))
        self.assertIn("ranks below model", out["error"])
        # the rank table: fable outranks opus, opus outranks every other model
        for model, advisor, ok in (("claude-fable-5-1", "fable", True),
                                   ("claude-opus-5-5", "opus", True),
                                   ("claude-opus-5", "opus", True),
                                   ("claude-opus-5-5", "fable", True),
                                   ("claude-sonnet-5", "opus", True),
                                   ("claude-haiku-4-5-20251001", "fable", True),
                                   ("claude-fable-5-1", "off", True),
                                   ("claude-opus-5-5", "off", True)):
            problems = pipeline._validate_legs("t", {"session": {"model": model, "advisor": advisor}})
            self.assertEqual(problems == [], ok, (model, advisor))

    def test_pairing_violation_after_overlay(self):
        # the per-table checks all pass; only the overlaid route violates
        self._routing('[defaults]\nsession = { advisor = "opus" }\n')
        self.assertEqual(pipeline.validate_project(pipeline.load_project_routing(self.root)), [])
        runtime = pipeline.parse_sets(["session.model=claude-fable-5-1"])
        for call in (lambda: pipeline.resolve(self.root, "1-1", runtime),
                     lambda: pipeline.apply(self.root, "1-1", runtime, dry_run=True)):
            with self.assertRaises(pipeline.PipelineError) as ctx:
                call()
            self.assertIn("route.session: advisor 'opus' ranks below model 'claude-fable-5-1'",
                          str(ctx.exception))
        code, out = _run(["apply", "--directory", str(self.root), "--story", "1-1",
                          "--set", "session.model=claude-fable-5-1", "--dry-run"])
        self.assertEqual((code, out["ok"]), (2, False))
        self.assertIn("ranks below model", out["error"])
        self.assertFalse((self.loop / "routing.current.json").exists())

    def test_check_runs_pairing_on_the_effective_defaults(self):
        # planner ships on claude-fable-5-1; a project advisor of opus on it
        # passes its own table but not the effective route
        self._routing('[defaults]\nplanner = { advisor = "opus" }\n')
        code, out = _run(["check", "--directory", str(self.root)])
        self.assertEqual(code, 2)
        self.assertEqual(out["problems"], [
            "effective defaults.planner: advisor 'opus' ranks below model 'claude-fable-5-1' "
            "(the advisor must rank at or above the leg's model)"])

    def test_subagent_legs_inherit_the_session_effort(self):
        self._routing('[defaults]\nsession = { model = "claude-opus-5-5", effort = "medium" }\n'
                      'implementer = { model = "claude-opus-5-5" }\n'
                      'reviewers = { model = "claude-opus-5-5", effort = "low" }\n')
        res = pipeline.resolve(self.root, "1-1")
        for leg in ("implementer", "consult"):
            self.assertEqual(res["route"][leg]["effort"], "medium", leg)
            self.assertEqual(res["sources"][leg]["effort"], "inherited-session", leg)
        # a declared effort is never overwritten
        self.assertEqual(res["route"]["reviewers"]["effort"], "low")
        self.assertEqual(res["sources"]["reviewers"]["effort"], "project-defaults")
        # non-subagent legs never inherit
        self.assertNotIn("inherited-session", res["sources"]["planner"].values())
        # the runtime session effort is what is inherited
        res = pipeline.resolve(self.root, "1-1", pipeline.parse_sets(["session.effort=high"]))
        self.assertEqual(res["route"]["implementer"]["effort"], "high")


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


class PolicyDirtiesTreeTests(unittest.TestCase):
    """Story 36.6 (DW-62): the tracked check beside `unignored_writes`."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        policy = self.root / ".bmad-loop" / "policy.toml"
        policy.parent.mkdir(parents=True)
        policy.write_text("[limits]\n", encoding="utf-8")

    def _git(self, *args):
        subprocess.run(["git", *args], cwd=str(self.root), check=True,
                       capture_output=True, stdin=subprocess.DEVNULL)

    def test_no_repository_is_no_hazard(self):
        self.assertFalse(pipeline.policy_dirties_tree(self.root))

    def test_unignored_and_tracked_are_hazards_ignored_is_not(self):
        self._git("init", "-q")
        self.assertTrue(pipeline.policy_dirties_tree(self.root))
        (self.root / ".gitignore").write_text(".bmad-loop/\n", encoding="utf-8")
        self.assertFalse(pipeline.policy_dirties_tree(self.root))
        self._git("add", "-f", "--", ".bmad-loop/policy.toml")
        self.assertTrue(pipeline.policy_dirties_tree(self.root))


if __name__ == "__main__":
    unittest.main()
