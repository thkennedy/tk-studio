"""Tests for the conformance suite (ST-5.4 acceptance criteria).

The suite is manifest-driven over surfaces discovered from the plugin's own
skills tree: every shipped skill is driven headless with status-block,
no-prompt, auth-preflight, and blocked-not-hang assertions; failures emit
headless-failure events; unregistered surfaces fail the suite.
"""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
import sys

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PLUGIN_ROOT / "lib"))
sys.path.insert(0, str(PLUGIN_ROOT / "contracts" / "conformance"))

import runner  # noqa: E402

SKILL_TEMPLATE = """\
---
name: {name}
description: Fake surface for conformance tests.
---

Headless runs end with the status block:

  {{"status": "complete", "intent": "{name}", "artifacts": [], "reason": null}}
"""


class ConformanceHarnessTestCase(unittest.TestCase):
    """Fixture surfaces in a temp tree — discovery, registration, emission."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        self.store = base / "store"
        os.environ["TK_STUDIO_HOME"] = str(self.store)
        self.skills = base / "skills"
        self.skills.mkdir()
        self.manifest = base / "manifest.json"

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()

    def _make_skill(self, name: str):
        d = self.skills / name
        d.mkdir()
        (d / "SKILL.md").write_text(SKILL_TEMPLATE.format(name=name),
                                    encoding="utf-8")

    def _write_manifest(self, surfaces: dict):
        self.manifest.write_text(
            json.dumps({"conformance_version": 1, "surfaces": surfaces}),
            encoding="utf-8")

    def _entry(self, **overrides):
        entry = {"external_calls": False,
                 "auth_preflight": "none needed — fixture", "drives": []}
        entry.update(overrides)
        return entry

    def _run(self, emit=False):
        return runner.run_suite(skills_dir=self.skills,
                                manifest_path=self.manifest, emit=emit)

    # --- AC 2: manifest-driven discovery

    def test_registered_surface_with_valid_doc_passes(self):
        self._make_skill("tk-studio-fake")
        self._write_manifest({"tk-studio-fake": self._entry()})
        report = self._run()
        self.assertTrue(report["ok"], report["failures"])
        self.assertEqual(report["surfaces_checked"], 1)

    def test_new_skill_is_discovered_automatically(self):
        self._make_skill("tk-studio-fake")
        self._make_skill("tk-studio-later")  # added later, no manifest entry
        self._write_manifest({"tk-studio-fake": self._entry()})
        report = self._run()
        self.assertFalse(report["ok"])
        failing = {f["surface"] for f in report["failures"]}
        self.assertEqual(failing, {"tk-studio-later"})
        self.assertEqual(report["failures"][0]["assertion"], "registered")

    def test_stale_manifest_entry_fails_too(self):
        self._make_skill("tk-studio-fake")
        self._write_manifest({"tk-studio-fake": self._entry(),
                              "tk-studio-removed": self._entry()})
        report = self._run()
        self.assertFalse(report["ok"])
        self.assertIn("tk-studio-removed",
                      {f["surface"] for f in report["failures"]})

    # --- AC 1: assertions on the surface

    def test_status_block_example_must_name_the_surface(self):
        d = self.skills / "tk-studio-fake"
        d.mkdir()
        (d / "SKILL.md").write_text(
            SKILL_TEMPLATE.format(name="tk-studio-other"), encoding="utf-8")
        os.rename(d / "SKILL.md", d / "SKILL.md")  # keep dir shape explicit
        self._write_manifest({"tk-studio-fake": self._entry()})
        report = self._run()
        self.assertIn("status-block",
                      {f["assertion"] for f in report["failures"]})

    def test_external_surface_may_not_declare_no_preflight(self):
        self._make_skill("tk-studio-fake")
        self._write_manifest({"tk-studio-fake": self._entry(
            external_calls=True, auth_preflight="none needed")})
        report = self._run()
        self.assertIn("auth-preflight",
                      {f["assertion"] for f in report["failures"]})

    def test_refusal_drive_fails_when_core_succeeds(self):
        # a drive expecting a refusal must fail if the core happily exits 0
        script = Path(self._tmp.name) / "happy.py"
        script.write_text("import json; print(json.dumps({'ok': True}))",
                          encoding="utf-8")
        self._make_skill("tk-studio-fake")
        self._write_manifest({"tk-studio-fake": self._entry(drives=[{
            "assertion": "blocked-on-ambiguity",
            "argv": [str(script)], "expect": "refusal"}])})
        report = self._run()
        self.assertIn("blocked-on-ambiguity",
                      {f["assertion"] for f in report["failures"]})

    def test_hanging_drive_fails_no_prompt_assertion(self):
        script = Path(self._tmp.name) / "prompty.py"
        script.write_text("input('never allowed headless: ')",
                          encoding="utf-8")
        self._make_skill("tk-studio-fake")
        self._write_manifest({"tk-studio-fake": self._entry(drives=[{
            "assertion": "no-prompt", "argv": [str(script)],
            "expect": "json"}])})
        report = runner.run_suite(skills_dir=self.skills,
                                  manifest_path=self.manifest, emit=False,
                                  timeout=3)
        failure = next(f for f in report["failures"]
                       if f["assertion"] == "no-prompt")
        # closed stdin makes input() die instantly OR the timeout catches a
        # true hang — either way the drive fails, never blocks the suite
        self.assertTrue(failure["detail"])

    # --- AC 1b: failures emit headless-failure events naming surface+assertion

    def test_failures_emit_headless_failure_events(self):
        self._make_skill("tk-studio-unregistered")
        self._write_manifest({})
        report = self._run(emit=True)
        self.assertFalse(report["ok"])
        ledger_dir = self.store / "measurements"
        files = list(ledger_dir.glob("*.jsonl"))
        self.assertEqual(len(files), 1)
        events = [json.loads(line) for line in
                  files[0].read_text(encoding="utf-8").splitlines()]
        self.assertTrue(events)
        event = events[-1]
        self.assertEqual(event["event"], "headless-failure")
        self.assertEqual(event["payload"]["surface"], "tk-studio-unregistered")
        self.assertEqual(event["payload"]["assertion"], "registered")

    def test_passing_suite_emits_nothing(self):
        self._make_skill("tk-studio-fake")
        self._write_manifest({"tk-studio-fake": self._entry()})
        report = self._run(emit=True)
        self.assertTrue(report["ok"])
        self.assertEqual(list((self.store / "measurements").glob("*.jsonl"))
                         if (self.store / "measurements").is_dir() else [], [])


class ConformanceRealPluginTestCase(unittest.TestCase):
    """The shipped manifest against the shipped plugin — the actual gate."""

    def setUp(self):
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        self._tmp = tempfile.TemporaryDirectory()
        os.environ["TK_STUDIO_HOME"] = str(Path(self._tmp.name) / "store")

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()

    def test_every_shipped_surface_passes_the_suite(self):
        report = runner.run_suite(emit=False)
        self.assertTrue(report["ok"], json.dumps(report["failures"], indent=2))
        shipped = runner.discover_surfaces()
        self.assertEqual(sorted(report["surfaces"]), shipped)
        # every surface carries the three structural assertions
        for surface, checks in report["surfaces"].items():
            names = [c["assertion"] for c in checks]
            for required in ("registered", "status-block", "auth-preflight"):
                self.assertIn(required, names, f"{surface} missing {required}")

    def test_every_shipped_surface_has_at_least_one_headless_drive(self):
        manifest = runner.load_manifest()
        for surface in runner.discover_surfaces():
            self.assertTrue(manifest["surfaces"][surface]["drives"],
                            f"{surface} is never actually driven headless")


if __name__ == "__main__":
    unittest.main()
