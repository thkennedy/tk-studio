"""Tests for the conformance suite (ST-5.4 acceptance criteria).

The suite is manifest-driven over surfaces discovered from the plugin's own
skills tree: every shipped skill is driven headless with status-block,
unrunnable-core, no-prompt, auth-preflight, and blocked-not-hang assertions;
failures emit headless-failure events; unregistered surfaces fail the suite.
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock
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

If the deterministic core is unrunnable, end blocked with the status block
naming the gap (AD-11).
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

    def test_skill_must_document_unrunnable_core_discipline(self):
        # AD-11: a permission-denied core once left a skill asking a question
        # with no terminal status block — every SKILL.md must document that
        # an unrunnable core ends blocked with the block naming the gap
        d = self.skills / "tk-studio-fake"
        d.mkdir()
        # "blocked" is present (as in every real SKILL.md) — only the
        # canonical unrunnable-core paragraph is missing, so this pins that
        # the check discriminates on the paragraph, not the word "blocked"
        (d / "SKILL.md").write_text(
            "---\nname: tk-studio-fake\ndescription: no discipline.\n---\n\n"
            "Ambiguity ends blocked, never a prompt.\n\n"
            'Headless runs end with the status block:\n\n'
            '  {"status": "complete", "intent": "tk-studio-fake", '
            '"artifacts": [], "reason": null}\n',
            encoding="utf-8")
        self._write_manifest({"tk-studio-fake": self._entry()})
        report = self._run()
        failure = next(f for f in report["failures"]
                       if f["assertion"] == "unrunnable-core")
        self.assertIn("unrunnable-core", failure["detail"])

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

    def test_refusal_must_name_its_declared_marker(self):
        # ISS-002 residual: a nonzero exit with an unrelated error is not a
        # clean refusal when the drive declares a marker — the refusal must
        # name its reason or the skill layer has nothing to surface as blocked
        script = Path(self._tmp.name) / "crashy.py"
        script.write_text(
            "import sys; print('unrelated traceback'); sys.exit(1)",
            encoding="utf-8")
        self._make_skill("tk-studio-fake")
        self._write_manifest({"tk-studio-fake": self._entry(drives=[{
            "assertion": "blocked-on-ambiguity",
            "argv": [str(script)], "expect": "refusal",
            "marker": "not the studio repo root"}])})
        report = self._run()
        failure = next(f for f in report["failures"]
                       if f["assertion"] == "blocked-on-ambiguity")
        self.assertIn("declared marker", failure["detail"])

    def test_refusal_naming_its_marker_passes(self):
        script = Path(self._tmp.name) / "refusey.py"
        script.write_text(
            "import json, sys; "
            "print(json.dumps({'ok': False, "
            "'error': 'x is not the studio repo root'})); sys.exit(2)",
            encoding="utf-8")
        self._make_skill("tk-studio-fake")
        self._write_manifest({"tk-studio-fake": self._entry(drives=[{
            "assertion": "blocked-on-ambiguity",
            "argv": [str(script)], "expect": "refusal",
            "marker": "not the studio repo root"}])})
        report = self._run()
        self.assertTrue(report["ok"], report["failures"])

    def test_inband_structured_block_named_by_marker_passes(self):
        # detect/orchestrate/jobrun refuse in-band by design: exit 0, ok=true,
        # the block reported as data — the declared marker is what proves the
        # named block is present
        script = Path(self._tmp.name) / "inband.py"
        script.write_text(
            "import json; "
            "print(json.dumps({'ok': True, 'outcome': 'needs-onboarding', "
            "'gaps': ['working_set.developer']}))",
            encoding="utf-8")
        self._make_skill("tk-studio-fake")
        self._write_manifest({"tk-studio-fake": self._entry(drives=[{
            "assertion": "blocked-on-ambiguity",
            "argv": [str(script)], "expect": "refusal",
            "marker": "needs-onboarding"}])})
        report = self._run()
        self.assertTrue(report["ok"], report["failures"])

    def test_plain_success_without_marker_or_refusal_fails(self):
        # exit 0, ok=true, marker absent: nothing refused and nothing named
        script = Path(self._tmp.name) / "happy2.py"
        script.write_text(
            "import json; print(json.dumps({'ok': True, 'summary': 'done'}))",
            encoding="utf-8")
        self._make_skill("tk-studio-fake")
        self._write_manifest({"tk-studio-fake": self._entry(drives=[{
            "assertion": "blocked-on-ambiguity",
            "argv": [str(script)], "expect": "refusal",
            "marker": "not the studio repo root"}])})
        report = self._run()
        failure = next(f for f in report["failures"]
                       if f["assertion"] == "blocked-on-ambiguity")
        self.assertIn("declared marker", failure["detail"])

    def test_markerless_refusal_still_passes_on_nonzero_exit(self):
        script = Path(self._tmp.name) / "plain.py"
        script.write_text("import sys; print('cannot proceed'); sys.exit(1)",
                          encoding="utf-8")
        self._make_skill("tk-studio-fake")
        self._write_manifest({"tk-studio-fake": self._entry(drives=[{
            "assertion": "blocked-on-ambiguity",
            "argv": [str(script)], "expect": "refusal"}])})
        report = self._run()
        self.assertTrue(report["ok"], report["failures"])

    def test_exit_zero_ok_false_with_marker_passes(self):
        # a core may refuse via JSON ok=false without a nonzero exit
        script = Path(self._tmp.name) / "softref.py"
        script.write_text(
            "import json; print(json.dumps({'ok': False, "
            "'error': 'x is not the studio repo root'}))",
            encoding="utf-8")
        self._make_skill("tk-studio-fake")
        self._write_manifest({"tk-studio-fake": self._entry(drives=[{
            "assertion": "blocked-on-ambiguity",
            "argv": [str(script)], "expect": "refusal",
            "marker": "not the studio repo root"}])})
        report = self._run()
        self.assertTrue(report["ok"], report["failures"])

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

    # --- ST-049: harness drives are opt-in and never silent

    def test_harness_drive_skipped_loud_without_opt_in(self):
        # spend-bearing drives never run in the default pass — but the skip
        # is named in the check detail, never a silent omission
        self._make_skill("tk-studio-fake")
        self._write_manifest({"tk-studio-fake": self._entry(drives=[{
            "assertion": "denied-core-refusal",
            "prompt": "/tk-studio:tk-studio-fake",
            "expect": "harness-blocked"}])})
        report = self._run()  # harness not enabled
        self.assertTrue(report["ok"], report["failures"])
        skip = next(c for c in report["surfaces"]["tk-studio-fake"]
                    if c["assertion"] == "denied-core-refusal")
        self.assertIn("skipped", skip["detail"])
        self.assertIn("--harness", skip["detail"])

    def test_harness_drive_without_cli_fails_loud(self):
        # opt-in on a machine with no claude CLI: a named failure, no spend
        self._make_skill("tk-studio-fake")
        self._write_manifest({"tk-studio-fake": self._entry(drives=[{
            "assertion": "denied-core-refusal",
            "prompt": "/tk-studio:tk-studio-fake",
            "expect": "harness-blocked"}])})
        with mock.patch.object(runner.shutil, "which", return_value=None):
            report = runner.run_suite(skills_dir=self.skills,
                                      manifest_path=self.manifest,
                                      emit=False, harness=True)
        failure = next(f for f in report["failures"]
                       if f["assertion"] == "denied-core-refusal")
        self.assertIn("claude CLI not on PATH", failure["detail"])

    # --- ST-050: the harness pass is named in the report, never silent

    def test_report_names_harness_pass_state(self):
        self._make_skill("tk-studio-fake")
        harness_drive = {"assertion": "denied-core-refusal",
                         "prompt": "/tk-studio:tk-studio-fake",
                         "expect": "harness-blocked"}
        # no harness drives declared at all
        self._write_manifest({"tk-studio-fake": self._entry()})
        report = self._run()
        self.assertEqual(report["harness_pass"],
                         {"declared": 0, "state": "none declared"})
        # declared but not opted in: skipped by flag, named at the top level
        self._write_manifest({"tk-studio-fake":
                              self._entry(drives=[harness_drive])})
        report = self._run()
        self.assertEqual(report["harness_pass"]["declared"], 1)
        self.assertIn("skipped: --harness not given",
                      report["harness_pass"]["state"])
        # opted in: the pass ran (here against a machine with no CLI —
        # the drive fails loud, but the pass itself is named as run)
        with mock.patch.object(runner.shutil, "which", return_value=None):
            report = runner.run_suite(skills_dir=self.skills,
                                      manifest_path=self.manifest,
                                      emit=False, harness=True)
        self.assertEqual(report["harness_pass"]["state"], "ran")

    def test_harness_drive_isolates_store_and_resolves_settings(self):
        # the child env must never point at the real per-user store, and the
        # settings profile resolves relative to the conformance dir
        captured = {}

        def fake_run(argv, **kwargs):
            captured["argv"] = argv
            captured["env"] = kwargs.get("env")
            return subprocess.CompletedProcess(
                argv, 0, stdout=BLOCKED_TRANSCRIPT_BLOCK, stderr="")

        drive = {"assertion": "denied-core-refusal",
                 "prompt": "/tk-studio:tk-studio-detect",
                 "settings": "fixtures/harness-deny-core.settings.json",
                 "expect": "harness-blocked"}
        with mock.patch.object(runner.shutil, "which",
                               return_value="claude-exe"), \
                mock.patch.object(runner.subprocess, "run",
                                  side_effect=fake_run):
            check = runner._run_harness_drive("tk-studio-detect", drive,
                                              runner.HARNESS_TIMEOUT)
        self.assertTrue(check["ok"], check["detail"])
        self.assertEqual(captured["argv"][:3],
                         ["claude-exe", "-p", "/tk-studio:tk-studio-detect"])
        settings_arg = captured["argv"][captured["argv"].index("--settings") + 1]
        self.assertTrue(Path(settings_arg).is_file(),
                        f"settings profile does not resolve: {settings_arg}")
        child_store = captured["env"]["TK_STUDIO_HOME"]
        self.assertNotEqual(child_store, os.environ.get("TK_STUDIO_HOME"))
        self.assertIn("tk-harness-", child_store)


BLOCKED_TRANSCRIPT_BLOCK = (
    '{"status": "blocked", "intent": "tk-studio-detect", "artifacts": [], '
    '"reason": "deterministic core unrunnable: uv run denied by harness '
    'permissions"}')


class HarnessTranscriptTestCase(unittest.TestCase):
    """ST-049: the harness-drive assertion pinned on fake transcripts —
    every outcome class, no live harness invocation, no spend."""

    def test_blocked_with_terminal_block_passes(self):
        transcript = ("The Bash tool call was denied by permissions.\n\n"
                      + BLOCKED_TRANSCRIPT_BLOCK + "\n")
        check = runner.evaluate_harness_transcript(transcript)
        self.assertTrue(check["ok"], check["detail"])

    def test_intent_must_name_the_surface_when_given(self):
        check = runner.evaluate_harness_transcript(
            BLOCKED_TRANSCRIPT_BLOCK, surface="tk-studio-detect")
        self.assertTrue(check["ok"], check["detail"])
        check = runner.evaluate_harness_transcript(
            BLOCKED_TRANSCRIPT_BLOCK, surface="tk-studio-onboard")
        self.assertFalse(check["ok"])
        self.assertIn("does not name the surface", check["detail"])

    def test_question_without_block_fails(self):
        # the PROP-005 live failure shape: a denied core left the skill
        # asking a question with no terminal status block
        transcript = ("I could not run the detect core because the uv tool "
                      "call requires approval. Would you like me to retry "
                      "with permissions granted?\n")
        check = runner.evaluate_harness_transcript(transcript)
        self.assertFalse(check["ok"])
        self.assertIn("without a terminal status block", check["detail"])

    def test_empty_transcript_fails(self):
        check = runner.evaluate_harness_transcript("")
        self.assertFalse(check["ok"])
        self.assertIn("without a terminal status block", check["detail"])

    def test_timeout_fails(self):
        check = runner.evaluate_harness_transcript(
            "", timed_out=True, timeout=180)
        self.assertFalse(check["ok"])
        self.assertIn("hung past 180s", check["detail"])

    def test_complete_under_denial_fails(self):
        # a complete block under a denied core is a lie, not a pass
        transcript = ('{"status": "complete", "intent": "tk-studio-detect", '
                      '"artifacts": [], "reason": null}')
        check = runner.evaluate_harness_transcript(transcript)
        self.assertFalse(check["ok"])
        self.assertIn("expected status 'blocked'", check["detail"])

    def test_blocked_without_reason_fails(self):
        transcript = ('{"status": "blocked", "intent": "tk-studio-detect", '
                      '"artifacts": [], "reason": null}')
        check = runner.evaluate_harness_transcript(transcript)
        self.assertFalse(check["ok"])
        self.assertIn("no reason naming", check["detail"])

    def test_marker_in_reason_passes_and_absent_fails(self):
        check = runner.evaluate_harness_transcript(
            BLOCKED_TRANSCRIPT_BLOCK, marker="denied by harness permissions")
        self.assertTrue(check["ok"], check["detail"])
        check = runner.evaluate_harness_transcript(
            BLOCKED_TRANSCRIPT_BLOCK, marker="a phrase the reason lacks")
        self.assertFalse(check["ok"])
        self.assertIn("declared marker", check["detail"])

    def test_broken_terminal_block_fails(self):
        # a {"status"-shaped line that is not valid JSON is no block at all
        transcript = '{"status": "blocked", "intent": '
        check = runner.evaluate_harness_transcript(transcript)
        self.assertFalse(check["ok"])
        self.assertIn("without a terminal status block", check["detail"])

    def test_off_schema_block_fails(self):
        transcript = ('{"status": "blocked", "intent": "tk-studio-detect", '
                      '"artifacts": [], "reason": "denied", '
                      '"note": "not in the schema"}')
        check = runner.evaluate_harness_transcript(transcript)
        self.assertFalse(check["ok"])
        self.assertIn("vs schema", check["detail"])

    def test_last_block_in_transcript_wins(self):
        # the terminal block is the judged one, not an earlier example the
        # skill may have echoed from its own SKILL.md
        transcript = (
            '{"status": "complete", "intent": "tk-studio-detect", '
            '"artifacts": [], "reason": null}\n'
            "…the run then hit the denied tool call…\n"
            + BLOCKED_TRANSCRIPT_BLOCK + "\n")
        check = runner.evaluate_harness_transcript(transcript)
        self.assertTrue(check["ok"], check["detail"])


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
        # every surface carries the four structural assertions
        for surface, checks in report["surfaces"].items():
            names = [c["assertion"] for c in checks]
            for required in ("registered", "status-block", "unrunnable-core",
                             "auth-preflight"):
                self.assertIn(required, names, f"{surface} missing {required}")

    def test_every_shipped_surface_has_at_least_one_headless_drive(self):
        manifest = runner.load_manifest()
        for surface in runner.discover_surfaces():
            self.assertTrue(manifest["surfaces"][surface]["drives"],
                            f"{surface} is never actually driven headless")

    def test_denied_permissions_case_is_declared(self):
        # ST-050: the PROP-005 enforcement case exists in the shipped
        # manifest — detect carries a harness drive whose settings profile
        # resolves and denies the core's tool calls
        manifest = runner.load_manifest()
        drives = manifest["surfaces"]["tk-studio-detect"]["drives"]
        harness = [d for d in drives if d.get("expect") == "harness-blocked"]
        self.assertTrue(harness, "tk-studio-detect declares no harness drive")
        drive = harness[0]
        self.assertEqual(drive["prompt"], "/tk-studio:tk-studio-detect")
        profile = (Path(runner.__file__).resolve().parent / drive["settings"])
        self.assertTrue(profile.is_file(),
                        f"settings profile missing: {profile}")
        denied = json.loads(profile.read_text(encoding="utf-8"))[
            "permissions"]["deny"]
        self.assertIn("Bash", denied)
        self.assertIn("PowerShell", denied)


if __name__ == "__main__":
    unittest.main()
