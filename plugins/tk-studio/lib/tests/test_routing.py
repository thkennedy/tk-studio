"""Tests for model/effort routing (ST-6.5 acceptance criteria, AD-14).

AC 1: effective model/effort resolves runtime override > project config >
resource default, and the chosen values are visible in run output (job
runner responses + run.json, orchestrator routes).

AC 2: a span of resources resolves each independently — no silent
inheritance of a more expensive setting.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config as configlib  # noqa: E402
import job as joblib  # noqa: E402
import jobrun  # noqa: E402
import orchestrate  # noqa: E402
import recommend  # noqa: E402
import routing  # noqa: E402

LOCK = """\
lock_version: 1
core:
  package: bmad-method
  version: 6.10.0
modules:
  bmm:
    version: 6.10.0
"""

SKILL_MANIFEST = """\
canonicalId,name,module,description,path
bmad-dev-story,dev-story,bmm,Execute story implementation,_bmad/bmm/skills/dev-story
"""

INSTALLED_MANIFEST = """\
version: 6.10.0
modules:
  - name: bmm
    version: 6.10.0
"""


class RoutingTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        self.store = base / "store"
        os.environ["TK_STUDIO_HOME"] = str(self.store)
        self.root = base / "proj"
        self.root.mkdir()

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()

    def _pin_project(self, scope_file: str, model: str | None = None,
                     effort: str | None = None) -> None:
        conf_dir = self.root / ".tk-studio"
        conf_dir.mkdir(exist_ok=True)
        path = conf_dir / scope_file
        text = path.read_text(encoding="utf-8") if path.is_file() else ""
        text += "\nmodel:\n"
        if model:
            text += f"  default: {model}\n"
        if effort:
            text += f"  effort: {effort}\n"
        path.write_text(text, encoding="utf-8", newline="\n")

    # ----------------------------------------------- AC1: the three tiers

    def test_resource_default_wins_when_nothing_overrides(self):
        routed = routing.resolve_routing("tk-studio-activate", self.root)
        self.assertEqual(routed["model"], "claude-haiku-4-5")
        self.assertEqual(routed["model_source"], "resource-default")
        self.assertEqual(routed["effort"], "low")

    def test_project_config_overrides_resource_default(self):
        self._pin_project("config.yaml", model="claude-opus-5")
        routed = routing.resolve_routing("tk-studio-activate", self.root)
        self.assertEqual(routed["model"], "claude-opus-5")
        self.assertEqual(routed["model_source"], "project-tracked")
        # effort not pinned → still the resource's own
        self.assertEqual(routed["effort_source"], "resource-default")

    def test_local_overrides_tracked_and_runtime_overrides_all(self):
        self._pin_project("config.yaml", model="claude-opus-5", effort="high")
        self._pin_project("config.local.yaml", model="claude-sonnet-5")
        routed = routing.resolve_routing("tk-studio-activate", self.root)
        self.assertEqual((routed["model"], routed["model_source"]),
                         ("claude-sonnet-5", "project-local"))
        self.assertEqual((routed["effort"], routed["effort_source"]),
                         ("high", "project-tracked"))
        runtime = {"model": {"default": "claude-haiku-4-5", "effort": "low"}}
        routed = routing.resolve_routing("tk-studio-activate", self.root,
                                         runtime=runtime)
        self.assertEqual((routed["model"], routed["model_source"]),
                         ("claude-haiku-4-5", "runtime"))
        self.assertEqual((routed["effort"], routed["effort_source"]),
                         ("low", "runtime"))

    def test_undeclared_resource_gets_the_loud_floor(self):
        routed = routing.resolve_routing("bmad-dev-story", self.root)
        self.assertEqual(routed["model"], routing.STUDIO_FLOOR["default"])
        self.assertEqual(routed["model_source"], "studio-floor")
        self.assertEqual(routed["effort_source"], "studio-floor")

    # ------------------------------------- AC2: no silent inheritance

    def test_each_resource_keeps_its_own_values(self):
        routed = routing.resolve_many(
            ["tk-studio-activate", "tk-studio-research"], self.root)
        by_resource = {r["resource"]: r for r in routed}
        self.assertEqual(by_resource["tk-studio-activate"]["model"],
                         "claude-haiku-4-5")
        self.assertEqual(by_resource["tk-studio-research"]["model"],
                         "claude-sonnet-5")
        self.assertEqual(by_resource["tk-studio-research"]["effort"],
                         "medium")
        self.assertEqual(by_resource["tk-studio-activate"]["effort"], "low")

    # --------------------------------- AC1: visible in job-runner output

    def test_job_runner_surfaces_routing_and_persists_it(self):
        configlib.standup_project_config(self.root)
        tracked = self.root / ".tk-studio" / "config.yaml"
        tracked.write_text(tracked.read_text(encoding="utf-8")
                           + "\njobs:\n  - maintenance-conformance\n",
                           encoding="utf-8", newline="\n")
        result = jobrun.submit(self.root, "maintenance-conformance")
        routed = result["routing"]
        # the definition's own effort field is the runtime override (§5)
        self.assertEqual((routed["effort"], routed["effort_source"]),
                         ("low", "runtime"))
        # core target executes as tk-studio-job — that resource's default
        self.assertEqual(routed["resource"], "tk-studio-job")
        self.assertEqual((routed["model"], routed["model_source"]),
                         ("claude-sonnet-5", "resource-default"))
        woken = jobrun.wake(self.root, "maintenance-conformance")
        record = joblib.read_run("proj", woken["run_id"])
        self.assertEqual(record["routing"]["effort"], "low")

    # --------------------------------- AC1: visible in orchestrator output

    def test_orchestrator_routes_carry_per_resource_routing(self):
        self.store.mkdir(parents=True, exist_ok=True)
        (self.store / "config.yaml").write_text(
            "user_name: tester\nrole: developer\nmachine_id: box\n",
            encoding="utf-8")
        configlib.standup_project_config(self.root)
        recommend.record(self.root, "developer", ["bmm", "bmad-dev-story"])
        conf = self.root / "_bmad" / "_config"
        conf.mkdir(parents=True)
        (conf / "manifest.yaml").write_text(INSTALLED_MANIFEST,
                                            encoding="utf-8")
        (conf / "skill-manifest.csv").write_text(SKILL_MANIFEST,
                                                 encoding="utf-8")
        lock = Path(self._tmp.name) / "bmad.lock"
        lock.write_text(LOCK, encoding="utf-8", newline="\n")
        result = orchestrate.resolve(self.root, lock_path=lock)
        by_name = {r["name"]: r for r in result["routes"]}
        self.assertNotIn("routing", by_name["bmm"])  # modules aren't invoked
        routed = by_name["bmad-dev-story"]["routing"]
        self.assertEqual(routed["model_source"], "studio-floor")
        self.assertEqual(routed["model"], routing.STUDIO_FLOOR["default"])

    # ---------------------------------------------------------------- CLI

    def test_cli_resolves_many_with_overrides(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = routing.main([
                "resolve", "--resource", "tk-studio-activate",
                "--resource", "tk-studio-research",
                "--directory", str(self.root),
                "--set", "model.effort=high"])
        self.assertEqual(code, 0)
        payload = json.loads(out.getvalue())
        efforts = {r["resource"]: (r["effort"], r["effort_source"])
                   for r in payload["routing"]}
        self.assertEqual(efforts["tk-studio-activate"], ("high", "runtime"))
        self.assertEqual(efforts["tk-studio-research"], ("high", "runtime"))
        models = {r["resource"]: r["model"] for r in payload["routing"]}
        self.assertEqual(models["tk-studio-activate"], "claude-haiku-4-5")


if __name__ == "__main__":
    unittest.main()
