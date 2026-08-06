"""Tests for the first research job — ecosystem watch (ST-6.4, AD-8).

AC: the shipped `research-ecosystem` job type carries a scoped charter
(topics, sources, budget); an unattended run produces an evidence-graded
findings artifact in the run workspace and emits `observation` events for
recommendation-worthy findings; a full unsupervised run completing end to
end with at least one actionable observation is success criterion 7's
pathway — simulated here with the agent's reasoning stubbed and every
deterministic seam real.
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
import research  # noqa: E402

FINDING = {
    "title": "Harness X shipped native cron routines",
    "summary": "Scheduled cloud routines now cover durable recurring jobs.",
    "grade": "B",
    "evidence": [
        {"source": "release-notes", "url": "https://example.com/notes",
         "note": "v2.3 changelog"},
        {"source": "community-discussion"},
    ],
    "recommendation": {"action": "evaluate binding durable jobs to cloud "
                                 "routines", "target": "tk-studio-job"},
}

SPECULATIVE = {
    "title": "Backlog tool Y may add dependency graphs",
    "summary": "Roadmap hints only; nothing shipped.",
    "grade": "D",
    "evidence": [],
}


class ResearchTestCase(unittest.TestCase):
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

    def _events(self, event_type: str) -> list[dict]:
        measurements = self.store / "measurements"
        found = []
        if measurements.is_dir():
            for path in measurements.glob("*.jsonl"):
                for line in path.read_text(encoding="utf-8").splitlines():
                    envelope = json.loads(line)
                    if envelope["event"] == event_type:
                        found.append(envelope)
        return found

    def _instantiate(self) -> None:
        configlib.standup_project_config(self.root)
        tracked = self.root / ".tk-studio" / "config.yaml"
        text = tracked.read_text(encoding="utf-8")
        text += "\njobs:\n  - research-ecosystem\n"
        tracked.write_text(text, encoding="utf-8", newline="\n")

    # ----------------------------------------------------------- charter

    def test_shipped_type_carries_a_scoped_charter_and_budget(self):
        entry = joblib.load_types()["research-ecosystem"]
        self.assertEqual(entry["problems"], [])
        defn = entry["definition"]
        charter = defn["target"]["payload"]["charter"]
        self.assertTrue(charter["topics"] and charter["sources"])
        self.assertEqual(defn["target"]["skill"], "tk-studio-research")
        self.assertIn("max_turns", defn["guards"])
        self.assertEqual(defn["cadence"]["mode"], "self-paced")
        self.assertTrue(defn["durable"])

    def test_charter_validation_refuses_unscoped_runs(self):
        normalized = research.validate_charter(
            {"topics": ["agentic dev"], "sources": ["web-search"]})
        self.assertEqual(normalized["max_findings"], 10)
        self.assertIn("must_produce", normalized)
        for bad in ({}, {"topics": [], "sources": ["x"]},
                    {"topics": ["x"]}, {"topics": ["x"], "sources": ["y"],
                                        "surprise": 1}):
            with self.assertRaises(research.ResearchError):
                research.validate_charter(bad)

    # ---------------------------------------------------------- findings

    def test_findings_must_be_graded_with_evidence(self):
        research.validate_findings([FINDING, SPECULATIVE])
        ungraded = dict(FINDING)
        del ungraded["grade"]
        with self.assertRaises(research.ResearchError):
            research.validate_findings([ungraded])
        bare_b = dict(FINDING, evidence=[])
        with self.assertRaises(research.ResearchError):
            research.validate_findings([bare_b])
        with self.assertRaises(research.ResearchError):
            research.validate_findings([dict(FINDING, grade="E")])
        with self.assertRaises(research.ResearchError):
            research.validate_findings([dict(FINDING,
                                             recommendation={"target": "x"})])

    def test_findings_md_renders_grades_and_recommendations(self):
        text = research.render_findings_md([FINDING, SPECULATIVE],
                                           {"topics": ["t"], "sources": ["s"]})
        self.assertIn("## Grade B", text)
        self.assertIn("## Grade D", text)
        self.assertIn("https://example.com/notes", text)
        self.assertIn("**recommendation:**", text)

    # ----------------------------- the unsupervised end-to-end pathway

    def test_full_unsupervised_run_lands_findings_and_observations(self):
        self._instantiate()
        # 1. the wrapper wakes the recurring job → invoke-skill directive
        woken = jobrun.wake(self.root, "research-ecosystem")
        self.assertTrue(woken["woken"])
        self.assertEqual(woken["directive"]["kind"], "invoke-skill")
        self.assertEqual(woken["directive"]["skill"], "tk-studio-research")
        charter = woken["directive"]["payload"]["charter"]
        research.validate_charter(charter)
        run_id = woken["run_id"]
        # 2. the agent researches within budget (stubbed reasoning)
        verdict = jobrun.account(self.root, run_id, turns=3)
        self.assertTrue(verdict["within_budget"])
        # 3. findings land through the core; observations emit
        result = research.record(self.root, run_id, [FINDING, SPECULATIVE])
        self.assertEqual(result["findings"], 2)
        self.assertEqual(result["observations_emitted"], 1)
        workspace = joblib.workspace_path("proj", run_id)
        landed = json.loads((workspace / "findings.json").read_text(
            encoding="utf-8"))
        self.assertEqual(len(landed["findings"]), 2)
        self.assertIn("## Grade B",
                      (workspace / "findings.md").read_text(encoding="utf-8"))
        # 4. the run finishes; wrapper emits its one job-run event
        jobrun.finish(self.root, run_id, "complete", status_block={
            "status": "complete", "intent": "tk-studio-research",
            "artifacts": ["findings.json", "findings.md"], "reason": None})
        (observation,) = self._events("observation")
        self.assertEqual(observation["payload"]["source"], "research-job")
        self.assertIn("cloud routines", observation["payload"]["description"])
        self.assertEqual(observation["project"], "proj")
        (job_event,) = self._events("job-run")
        self.assertEqual(job_event["payload"]["state"], "complete")

    def test_record_refuses_a_finished_run(self):
        self._instantiate()
        run_id = jobrun.wake(self.root, "research-ecosystem")["run_id"]
        jobrun.finish(self.root, run_id, "blocked", reason="test")
        with self.assertRaises(research.ResearchError):
            research.record(self.root, run_id, [FINDING])

    # ---------------------------------------------------------------- CLI

    def _cli(self, *argv: str) -> tuple[int, dict]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = research.main(list(argv))
        return code, json.loads(out.getvalue())

    def test_cli_charter_and_record(self):
        code, out = self._cli("charter", "--charter",
                              '{"topics": ["x"], "sources": ["y"]}')
        self.assertEqual(code, 0)
        self.assertTrue(out["ok"])
        code, out = self._cli("charter", "--charter", "{}")
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])
        self._instantiate()
        run_id = jobrun.wake(self.root, "research-ecosystem")["run_id"]
        findings_path = Path(self._tmp.name) / "findings.json"
        findings_path.write_text(json.dumps([FINDING]), encoding="utf-8")
        code, out = self._cli("record", "--directory", str(self.root),
                              "--run-id", run_id,
                              "--findings-file", str(findings_path))
        self.assertEqual(code, 0)
        self.assertEqual(out["observations_emitted"], 1)


if __name__ == "__main__":
    unittest.main()
