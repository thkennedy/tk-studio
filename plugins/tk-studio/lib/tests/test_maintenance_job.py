"""Tests for the first maintenance job — scheduled conformance (ST-6.3).

AC: with the conformance suite (5.4) and the job model (6.1), instantiating
the shipped `maintenance-conformance` job type on a project runs the suite
on its declared cadence within budget, emits results as measurement events,
and produces a run summary in the run workspace.

The end-to-end case really runs the shipped suite (every surface driven
headless) — slow by nature, and exactly the point: the job proves parity
without an operator remembering to.
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
import job as joblib  # noqa: E402
import jobrun  # noqa: E402


class MaintenanceJobTestCase(unittest.TestCase):
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

    def _instantiate(self) -> None:
        """A project adopts the shipped type with one scalar config ref."""
        configlib.standup_project_config(self.root)
        tracked = self.root / ".tk-studio" / "config.yaml"
        text = tracked.read_text(encoding="utf-8")
        text += "\njobs:\n  - maintenance-conformance\n"
        tracked.write_text(text, encoding="utf-8", newline="\n")

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

    # ---------------------------------------------------------- fast paths

    def test_shipped_type_declares_cadence_budget_and_target(self):
        entry = joblib.load_types()["maintenance-conformance"]
        defn = entry["definition"]
        self.assertEqual(entry["problems"], [])
        self.assertEqual(defn["target"]["core"][0],
                         "contracts/conformance/runner.py")
        self.assertEqual(defn["trigger"], "cron")
        self.assertEqual(defn["cadence"]["mode"], "fixed")
        self.assertIn("max_wall_clock_seconds", defn["guards"])
        self.assertEqual(defn["stop"], {"on_status": ["blocked"]})

    def test_submit_returns_the_declared_cadence_directive(self):
        self._instantiate()
        result = jobrun.submit(self.root, "maintenance-conformance")
        self.assertTrue(result["accepted"])
        self.assertEqual(result["directive"]["kind"], "cron")
        self.assertEqual(result["directive"]["schedule"], "0 6 * * 1-5")
        self.assertIn("session-scoped", result["durability_constraint"])

    def test_summarize_result_extracts_conformance_headline(self):
        summary, headline = jobrun._summarize_result(
            {"ok": True, "surfaces_checked": 11, "checks_run": 50,
             "failures": []}, 0)
        self.assertEqual(summary, {"exit_code": 0, "ok": True,
                                   "surfaces_checked": 11, "checks_run": 50,
                                   "failure_count": 0})
        self.assertIn("ok=True", headline)

    def test_guard_partial_still_lands_a_summary(self):
        self._instantiate()
        jobs_dir = self.root / ".tk-studio" / "jobs"
        jobs_dir.mkdir(parents=True, exist_ok=True)
        (jobs_dir / "maintenance-conformance.json").write_text(json.dumps({
            "job_schema_version": 1,
            "id": "maintenance-conformance",
            "type": "maintenance-conformance",
            "guards": {"max_wall_clock_seconds": 0.001},
        }), encoding="utf-8", newline="\n")
        result = jobrun.wake(self.root, "maintenance-conformance")
        self.assertTrue(result["woken"])
        self.assertEqual(result["state"], "partial")
        workspace = joblib.workspace_path("proj", result["run_id"])
        summary = json.loads((workspace / "summary.json").read_text(
            encoding="utf-8"))
        self.assertEqual(summary["state"], "partial")
        self.assertIn("guard: max_wall_clock_seconds", summary["reason"])

    # ------------------------------------------------------- the real run

    def test_wake_runs_the_suite_within_budget_and_lands_artifacts(self):
        self._instantiate()
        result = jobrun.wake(self.root, "maintenance-conformance")
        self.assertTrue(result["woken"])
        self.assertEqual(result["state"], "complete")

        workspace = joblib.workspace_path("proj", result["run_id"])
        output = json.loads((workspace / "output.json").read_text(
            encoding="utf-8"))
        self.assertTrue(output["ok"], output.get("failures"))
        self.assertGreaterEqual(output["surfaces_checked"], 10)

        summary = json.loads((workspace / "summary.json").read_text(
            encoding="utf-8"))
        self.assertEqual(summary["state"], "complete")
        self.assertTrue(summary["ok"])
        self.assertEqual(summary["failure_count"], 0)
        self.assertEqual(summary["run_id"], result["run_id"])

        # run.json stays compact: the full per-surface report lives in
        # output.json only
        record = joblib.read_run("proj", result["run_id"])
        self.assertEqual(set(record["status_block"]), {"summary"})
        self.assertNotIn("surfaces", record["status_block"]["summary"])

        # results reach the ledger through the wrapper's one job-run event
        (event,) = self._events("job-run")
        self.assertEqual(event["payload"]["state"], "complete")
        self.assertIn("checks_run=", event["payload"]["detail"])
        self.assertIn("ok=True", event["payload"]["detail"])


if __name__ == "__main__":
    unittest.main()
