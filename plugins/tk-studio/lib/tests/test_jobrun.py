"""Tests for the job wrapper — §4 verbs on harness-native primitives
(ST-6.2 acceptance criteria, AD-10, AD-12).

AC 1: one-shot jobs execute immediately (or return their `at` directive);
recurring jobs bind to harness scheduling via a machine-readable directive
with the declared cadence; budget guards and stop conditions terminate runs
partial with the reason named.

AC 2: a durable-recurring job records the requirement and the session-scoped
binding surfaces the constraint instead of silently losing the schedule.
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
import ledger  # noqa: E402


class JobRunTestCase(unittest.TestCase):
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

    # ------------------------------------------------------------- helpers

    def _declare(self, job_id: str, defn: dict) -> None:
        tracked = self.root / ".tk-studio" / "config.yaml"
        if not tracked.is_file():
            configlib.standup_project_config(self.root)
        text = tracked.read_text(encoding="utf-8")
        if "\njobs:\n" not in text:
            text += "\njobs:\n"
        text += f"  - {job_id}\n"
        tracked.write_text(text, encoding="utf-8", newline="\n")
        jobs_dir = self.root / ".tk-studio" / "jobs"
        jobs_dir.mkdir(parents=True, exist_ok=True)
        (jobs_dir / f"{job_id}.json").write_text(
            json.dumps(defn, indent=2), encoding="utf-8", newline="\n")

    def _core_defn(self, job_id: str, **overrides) -> dict:
        base = {
            "job_schema_version": 1,
            "id": job_id,
            "target": {"core": ["lib/store.py", "check"]},
            "trigger": "one-shot",
            "guards": {"max_wall_clock_seconds": 60},
            "stop": {"max_runs": 5},
        }
        base.update(overrides)
        return base

    def _skill_defn(self, job_id: str, **overrides) -> dict:
        base = {
            "job_schema_version": 1,
            "id": job_id,
            "target": {"skill": "tk-studio-observe",
                       "payload": {"source": "other"}},
            "trigger": "one-shot",
            "guards": {"max_turns": 2},
            "stop": {"max_runs": 3},
        }
        base.update(overrides)
        return base

    def _ledger_events(self) -> list[dict]:
        measurements = self.store / "measurements"
        events = []
        if measurements.is_dir():
            for path in measurements.glob("*.jsonl"):
                for line in path.read_text(encoding="utf-8").splitlines():
                    events.append(json.loads(line))
        return events

    def _cli(self, *argv: str) -> tuple[int, dict]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = jobrun.main(list(argv))
        return code, json.loads(out.getvalue())

    # ------------------------------ AC1: one-shot executes, verbs answer

    def test_submit_one_shot_core_executes_immediately(self):
        self._declare("checkup", self._core_defn("checkup"))
        result = jobrun.submit(self.root, "checkup")
        self.assertTrue(result["accepted"])
        self.assertEqual(result["state"], "complete")
        record = joblib.read_run("proj", result["run_id"])
        self.assertEqual(record["state"], "complete")
        self.assertIn("summary", record["status_block"])
        self.assertTrue(record["started"] and record["ended"])
        events = [e for e in self._ledger_events() if e["event"] == "job-run"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["payload"]["state"], "complete")
        self.assertEqual(events[0]["project"], "proj")

    def test_submit_future_at_defers_with_directive(self):
        self._declare("later", self._core_defn(
            "later", at="2999-01-01T00:00:00Z"))
        result = jobrun.submit(self.root, "later")
        self.assertTrue(result["accepted"])
        self.assertEqual(result["state"], "queued")
        self.assertEqual(result["directive"],
                         {"kind": "at", "at": "2999-01-01T00:00:00Z"})

    def test_submit_rejects_missing_or_invalid_definition(self):
        result = jobrun.submit(self.root, "ghost-job")
        self.assertFalse(result["accepted"])
        self.assertIn("no definition", result["reason"])
        bad = self._core_defn("bad")
        del bad["stop"]
        self._declare("bad", bad)
        result = jobrun.submit(self.root, "bad")
        self.assertFalse(result["accepted"])
        self.assertIn("stop", result["reason"])

    def test_recurring_submit_returns_cadence_directive(self):
        self._declare("nightly", self._core_defn(
            "nightly", trigger="cron",
            cadence={"mode": "fixed", "schedule": "0 2 * * *"}))
        result = jobrun.submit(self.root, "nightly")
        self.assertTrue(result["accepted"])
        self.assertIsNone(result["run_id"])
        self.assertEqual(result["substrate"], "harness-native")
        self.assertEqual(result["directive"],
                         {"kind": "cron", "schedule": "0 2 * * *"})
        self._declare("paced", self._core_defn(
            "paced", trigger="loop",
            cadence={"mode": "self-paced", "hint_seconds": 900}))
        result = jobrun.submit(self.root, "paced")
        self.assertEqual(result["directive"],
                         {"kind": "self-paced", "hint_seconds": 900})

    # ----------------------- AC1: guards terminate partial, reason named

    def test_wall_clock_guard_ends_run_partial(self):
        self._declare("slow", self._core_defn(
            "slow", guards={"max_wall_clock_seconds": 0.001}))
        result = jobrun.submit(self.root, "slow")
        self.assertEqual(result["state"], "partial")
        self.assertIn("guard: max_wall_clock_seconds", result["reason"])
        record = joblib.read_run("proj", result["run_id"])
        self.assertEqual(record["state"], "partial")
        events = [e for e in self._ledger_events() if e["event"] == "job-run"]
        self.assertEqual(events[0]["payload"]["state"], "partial")

    def test_account_flags_exceeded_turn_guard(self):
        self._declare("agentic", self._skill_defn("agentic"))
        submitted = jobrun.submit(self.root, "agentic")
        run_id = submitted["run_id"]
        self.assertEqual(submitted["directive"]["kind"], "invoke-skill")
        first = jobrun.account(self.root, run_id, turns=1)
        self.assertTrue(first["within_budget"])
        second = jobrun.account(self.root, run_id, turns=1)
        self.assertFalse(second["within_budget"])
        self.assertEqual(second["exceeded"], ["max_turns"])
        ended = jobrun.finish(self.root, run_id, "partial",
                              reason="guard: max_turns")
        self.assertEqual(ended["state"], "partial")
        with self.assertRaises(jobrun.JobRunError):
            jobrun.account(self.root, run_id, turns=1)

    def test_finish_completes_skill_run_and_emits_once(self):
        self._declare("agentic", self._skill_defn("agentic"))
        run_id = jobrun.submit(self.root, "agentic")["run_id"]
        jobrun.finish(self.root, run_id, "complete", status_block={
            "status": "complete", "intent": "tk-studio-observe",
            "artifacts": [], "reason": None})
        events = [e for e in self._ledger_events() if e["event"] == "job-run"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["payload"]["run_id"], run_id)

    # --------------------------------- AC1: stop conditions gate schedule

    def test_stop_max_runs_refuses_further_wakes(self):
        self._declare("once", self._core_defn(
            "once", trigger="loop",
            cadence={"mode": "self-paced"}, stop={"max_runs": 1}))
        first = jobrun.wake(self.root, "once")
        self.assertTrue(first["woken"])
        self.assertEqual(first["state"], "complete")
        second = jobrun.wake(self.root, "once")
        self.assertFalse(second["woken"])
        self.assertIn("stop: max_runs", second["reason"])

    def test_stop_on_status_and_until(self):
        defn = self._core_defn("gated")
        past_until = dict(defn, stop={"until": "2020-01-01T00:00:00Z"})
        self.assertIn("stop: until", jobrun.evaluate_stop(past_until, []))
        on_status = dict(defn, stop={"on_status": ["blocked"]})
        runs = [{"run_id": "x", "state": "blocked"}]
        self.assertIn("stop: on_status",
                      jobrun.evaluate_stop(on_status, runs))
        self.assertIsNone(jobrun.evaluate_stop(on_status, []))

    def test_wake_refuses_one_shot(self):
        self._declare("checkup", self._core_defn("checkup"))
        result = jobrun.wake(self.root, "checkup")
        self.assertFalse(result["woken"])

    # ------------------------------------------------- AC2: durability

    def test_durable_recurring_surfaces_constraint(self):
        self._declare("durable-nightly", self._core_defn(
            "durable-nightly", trigger="cron", durable=True,
            cadence={"mode": "fixed", "schedule": "0 2 * * *"}))
        result = jobrun.submit(self.root, "durable-nightly")
        self.assertTrue(result["accepted"])
        self.assertIn("session-scoped", result["durability_constraint"])
        # a non-durable one-shot never carries the constraint
        self._declare("checkup", self._core_defn("checkup"))
        self.assertNotIn("durability_constraint",
                         jobrun.submit(self.root, "checkup"))

    # -------------------------------------------------- status & cancel

    def test_status_shape_matches_contract(self):
        self._declare("agentic", self._skill_defn("agentic"))
        run_id = jobrun.submit(self.root, "agentic")["run_id"]
        result = jobrun.status(self.root, "agentic")
        self.assertEqual(result["job_id"], "agentic")
        (run,) = result["runs"]
        self.assertEqual(run["run_id"], run_id)
        self.assertEqual(run["state"], "queued")
        with self.assertRaises(jobrun.JobRunError):
            jobrun.status(self.root, "agentic", run_id="nope")

    def test_cancel_terminates_resumable_runs(self):
        self._declare("agentic", self._skill_defn("agentic"))
        run_id = jobrun.submit(self.root, "agentic")["run_id"]
        result = jobrun.cancel(self.root, "agentic")
        self.assertTrue(result["cancelled"])
        self.assertEqual(result["runs_ended"], [run_id])
        record = joblib.read_run("proj", run_id)
        self.assertEqual(record["state"], "partial")
        self.assertEqual(record["reason"], "cancelled")
        again = jobrun.cancel(self.root, "agentic")
        self.assertTrue(again["cancelled"])
        self.assertEqual(again["runs_ended"], [])

    # ------------------------------------------------- taxonomy & CLI

    def test_job_run_event_type_is_in_the_taxonomy(self):
        ledger.validate("job-run", {"job_id": "a", "run_id": "b",
                                    "state": "complete"})
        with self.assertRaises(ledger.LedgerError):
            ledger.validate("job-run", {"job_id": "a", "run_id": "b",
                                        "state": "queued"})

    def test_cli_submit_and_status(self):
        self._declare("checkup", self._core_defn("checkup"))
        code, out = self._cli("submit", "--directory", str(self.root),
                              "--id", "checkup")
        self.assertEqual(code, 0)
        self.assertTrue(out["accepted"])
        code, out = self._cli("status", "--directory", str(self.root),
                              "--job-id", "checkup")
        self.assertEqual(code, 0)
        self.assertEqual(out["runs"][0]["state"], "complete")

    def test_cli_unknown_job_refuses_cleanly(self):
        configlib.standup_project_config(self.root)
        code, out = self._cli("submit", "--directory", str(self.root),
                              "--id", "ghost-job")
        self.assertEqual(code, 0)
        self.assertFalse(out["accepted"])
        self.assertIn("no definition", out["reason"])
        code, out = self._cli("status", "--directory", str(self.root),
                              "--job-id", "ghost-job")
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])


if __name__ == "__main__":
    unittest.main()
