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
import math
import os
import tempfile
import unittest
from datetime import timedelta, timezone
from pathlib import Path
from unittest import mock
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config as configlib  # noqa: E402
import job as joblib  # noqa: E402
import jobrun  # noqa: E402
import ledger  # noqa: E402
import reconcile as reconcilelib  # noqa: E402


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

    def test_invoke_skill_directive_names_knowledge_paths(self):
        # ST-9.6: the §4 KB-injection directive — spine/seed paths named so
        # any driver can inject them into the segment prompt it executes;
        # absence is a reported flag, never a gate
        self._declare("agentic", self._skill_defn("agentic"))
        submitted = jobrun.submit(self.root, "agentic")
        knowledge = submitted["directive"]["knowledge"]
        self.assertFalse(knowledge["spine"]["present"])
        self.assertFalse(knowledge["seed"]["present"])
        self.assertTrue(
            knowledge["spine"]["path"].endswith("knowledge/spine.md"))
        self.assertTrue(knowledge["seed"]["path"].endswith(
            f"runs/{submitted['run_id']}/seed.md"),
            "the seed path is the run's own workspace — prospective at "
            "mint time (the run authors it), present on later segments")

        spine = reconcilelib.knowledge_dir("proj") / "spine.md"
        spine.parent.mkdir(parents=True, exist_ok=True)
        spine.write_text("provisional stub\n", encoding="utf-8")
        self._declare("looper", self._skill_defn(
            "looper", trigger="loop", cadence={"mode": "self-paced"}))
        woken = jobrun.wake(self.root, "looper")
        self.assertTrue(woken["woken"], woken)
        self.assertTrue(woken["directive"]["knowledge"]["spine"]["present"])

    def test_finish_completes_skill_run_and_emits_once(self):
        self._declare("agentic", self._skill_defn("agentic"))
        run_id = jobrun.submit(self.root, "agentic")["run_id"]
        jobrun.finish(self.root, run_id, "complete", status_block={
            "status": "complete", "intent": "tk-studio-observe",
            "artifacts": [], "reason": None})
        events = [e for e in self._ledger_events() if e["event"] == "job-run"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["payload"]["run_id"], run_id)

    # ------------------------- ST-061 / Story 20.1: finish records the cost

    def _queued_skill_run(self) -> str:
        job_id = f"agentic-{len(getattr(self, '_cost_jobs', []))}"
        self._cost_jobs = getattr(self, "_cost_jobs", []) + [job_id]
        self._declare(job_id, self._skill_defn(job_id))
        return jobrun.submit(self.root, job_id)["run_id"]

    def _job_run_events(self) -> list[dict]:
        return [e for e in self._ledger_events() if e["event"] == "job-run"]

    def test_finish_with_cost_records_it_in_run_and_one_event(self):
        run_id = self._queued_skill_run()
        jobrun.finish(self.root, run_id, "complete", total_cost_usd=1.23)
        self.assertEqual(joblib.read_run("proj", run_id)["total_cost_usd"],
                         1.23)
        events = self._job_run_events()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["payload"]["total_cost_usd"], 1.23)

    def test_finish_zero_cost_is_carried_not_dropped(self):
        run_id = self._queued_skill_run()
        jobrun.finish(self.root, run_id, "complete", total_cost_usd=0)
        self.assertEqual(joblib.read_run("proj", run_id)["total_cost_usd"], 0)
        (event,) = self._job_run_events()
        self.assertIn("total_cost_usd", event["payload"])
        self.assertEqual(event["payload"]["total_cost_usd"], 0)

    def test_finish_negative_zero_cost_is_recorded_as_positive_zero(self):
        run_id = self._queued_skill_run()
        jobrun.finish(self.root, run_id, "complete", total_cost_usd=-0.0)
        recorded = joblib.read_run("proj", run_id)["total_cost_usd"]
        self.assertEqual(recorded, 0)
        self.assertEqual(math.copysign(1, recorded), 1.0)
        (event,) = self._job_run_events()
        emitted = event["payload"]["total_cost_usd"]
        self.assertEqual(emitted, 0)
        self.assertEqual(math.copysign(1, emitted), 1.0)

    def test_cli_finish_with_cost(self):
        run_id = self._queued_skill_run()
        code, out = self._cli("finish", "--directory", str(self.root),
                              "--run-id", run_id, "--state", "complete",
                              "--total-cost-usd", "1.23")
        self.assertEqual(code, 0, out)
        self.assertTrue(out["ok"])
        self.assertEqual(joblib.read_run("proj", run_id)["total_cost_usd"],
                         1.23)
        (event,) = self._job_run_events()
        self.assertEqual(event["payload"]["total_cost_usd"], 1.23)

    def test_finish_without_cost_leaves_field_absent(self):
        run_id = self._queued_skill_run()
        jobrun.finish(self.root, run_id, "partial", reason="guard: max_turns")
        self.assertNotIn("total_cost_usd", joblib.read_run("proj", run_id))
        (event,) = self._job_run_events()
        # the 0.1.17 payload set, nothing zero-filled
        self.assertEqual(set(event["payload"]) - {"elapsed_ms"},
                         {"job_id", "run_id", "state", "reason"})

    def _assert_refused_untouched(self, run_id: str) -> None:
        record = joblib.read_run("proj", run_id)
        self.assertEqual(record["state"], "queued")
        self.assertNotIn("total_cost_usd", record)
        self.assertEqual(self._job_run_events(), [])

    def test_finish_refuses_invalid_cost_and_records_nothing(self):
        for bad in (-0.01, float("nan"), float("inf"), float("-inf"), True,
                    "1.23", "abc", 10**400):
            with self.subTest(cost=bad):
                run_id = self._queued_skill_run()
                with self.assertRaises(jobrun.JobRunError) as ctx:
                    jobrun.finish(self.root, run_id, "complete",
                                  total_cost_usd=bad)
                self.assertIn("total_cost_usd", str(ctx.exception))
                self._assert_refused_untouched(run_id)

    def test_cli_finish_refuses_invalid_cost_with_json(self):
        for bad in ("abc", "-0.01", "nan", "inf", ""):
            with self.subTest(cost=bad):
                run_id = self._queued_skill_run()
                code, out = self._cli("finish", "--directory", str(self.root),
                                      "--run-id", run_id,
                                      "--state", "complete",
                                      f"--total-cost-usd={bad}")
                self.assertEqual(code, 2)
                self.assertFalse(out["ok"])
                self.assertIn("total_cost_usd", out["error"])
                self._assert_refused_untouched(run_id)

    def test_job_run_taxonomy_declares_optional_cost(self):
        base = {"job_id": "a", "run_id": "b", "state": "complete"}
        ledger.validate("job-run", dict(base, total_cost_usd=1.5))
        ledger.validate("job-run", dict(base, total_cost_usd=0))
        with self.assertRaises(ledger.LedgerError):
            ledger.validate("job-run", dict(base, total_cost_usd="1.5"))

    # ------------- Story 34.3: the playable-verify leg's cost, its own line

    def test_finish_with_playable_verify_cost_records_its_own_field(self):
        run_id = self._queued_skill_run()
        jobrun.finish(self.root, run_id, "partial", reason="host verify red",
                      total_cost_usd=1.5, playable_verify_cost_usd=0.25)
        record = joblib.read_run("proj", run_id)
        self.assertEqual(record["playable_verify_cost_usd"], 0.25)
        self.assertEqual(record["total_cost_usd"], 1.5)
        (event,) = self._job_run_events()
        self.assertEqual(event["payload"]["playable_verify_cost_usd"], 0.25)
        self.assertEqual(event["payload"]["total_cost_usd"], 1.5)

    def test_finish_zero_playable_verify_cost_is_carried(self):
        run_id = self._queued_skill_run()
        jobrun.finish(self.root, run_id, "complete", total_cost_usd=0,
                      playable_verify_cost_usd=0)
        (event,) = self._job_run_events()
        self.assertEqual(event["payload"]["playable_verify_cost_usd"], 0)

    def test_finish_without_playable_verify_cost_leaves_field_absent(self):
        run_id = self._queued_skill_run()
        jobrun.finish(self.root, run_id, "complete", total_cost_usd=1.0)
        self.assertNotIn("playable_verify_cost_usd",
                         joblib.read_run("proj", run_id))
        (event,) = self._job_run_events()
        self.assertNotIn("playable_verify_cost_usd", event["payload"])

    def test_cli_finish_with_playable_verify_cost(self):
        run_id = self._queued_skill_run()
        code, out = self._cli("finish", "--directory", str(self.root),
                              "--run-id", run_id, "--state", "complete",
                              "--total-cost-usd", "1.23",
                              "--playable-verify-cost-usd", "0.2")
        self.assertEqual(code, 0, out)
        (event,) = self._job_run_events()
        self.assertEqual(event["payload"]["playable_verify_cost_usd"], 0.2)

    def test_finish_refuses_invalid_playable_verify_cost(self):
        for bad in (-0.01, float("nan"), float("inf"), True, "0.2"):
            with self.subTest(cost=bad):
                run_id = self._queued_skill_run()
                with self.assertRaises(jobrun.JobRunError) as ctx:
                    jobrun.finish(self.root, run_id, "complete",
                                  playable_verify_cost_usd=bad)
                self.assertIn("playable_verify_cost_usd", str(ctx.exception))
                self._assert_refused_untouched(run_id)
        for bad in ("abc", "-1", "nan"):
            with self.subTest(cli=bad):
                run_id = self._queued_skill_run()
                code, out = self._cli("finish", "--directory", str(self.root),
                                      "--run-id", run_id,
                                      "--state", "complete",
                                      f"--playable-verify-cost-usd={bad}")
                self.assertEqual(code, 2)
                self.assertIn("playable_verify_cost_usd", out["error"])
                self._assert_refused_untouched(run_id)

    def test_job_run_taxonomy_declares_optional_playable_verify_cost(self):
        base = {"job_id": "a", "run_id": "b", "state": "complete"}
        ledger.validate("job-run", dict(base, playable_verify_cost_usd=0.4,
                                        total_cost_usd=1.0))
        ledger.validate("job-run", base)
        with self.assertRaises(ledger.LedgerError):
            ledger.validate("job-run", dict(base, playable_verify_cost_usd="x"))

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

    # ---------------------------------------- resolve (ST-052, PROP-008)

    def test_resolve_serves_inherited_trigger_and_cadence(self):
        # The PROP-008 case: the instance omits trigger/cadence, inheriting
        # its shipped type's — the resolved output must carry them so a
        # substrate-side driver classifies the job without merging.
        self._declare("nightly", {
            "job_schema_version": 1,
            "id": "nightly",
            "type": "maintenance-conformance",
            "target": {"payload": {"timeout": 120}},
        })
        result = jobrun.resolve(self.root)
        (entry,) = result["jobs"]
        self.assertEqual(entry["job_id"], "nightly")
        self.assertEqual(entry["source"], "instance")
        self.assertEqual(entry["extends"], "maintenance-conformance")
        self.assertEqual(entry["problems"], [])
        self.assertEqual(entry["resolved"]["trigger"], "cron")
        self.assertEqual(entry["resolved"]["cadence"]["schedule"],
                         "0 6 * * 1-5")
        self.assertEqual(result["problems"], [])

    def test_resolve_single_id_and_unknown_id_refusal(self):
        self._declare("checkup", self._core_defn("checkup"))
        result = jobrun.resolve(self.root, "checkup")
        self.assertEqual(result["job_id"], "checkup")
        self.assertEqual(result["source"], "instance")
        self.assertEqual(result["resolved"]["id"], "checkup")
        with self.assertRaises(jobrun.JobRunError) as ctx:
            jobrun.resolve(self.root, "ghost-job")
        self.assertIn("no definition", str(ctx.exception))

    def test_resolve_names_invalid_definition_problems_in_place(self):
        broken = self._core_defn("broken")
        del broken["guards"]
        self._declare("broken", broken)
        self._declare("checkup", self._core_defn("checkup"))
        result = jobrun.resolve(self.root)
        self.assertEqual([e["job_id"] for e in result["jobs"]],
                         ["broken", "checkup"])  # config order kept
        first, second = result["jobs"]
        self.assertTrue(any("guards" in p for p in first["problems"]))
        self.assertIsNotNone(first["resolved"])  # served, gaps named
        self.assertEqual(second["problems"], [])

    def test_cli_resolve(self):
        self._declare("checkup", self._core_defn("checkup"))
        code, out = self._cli("resolve", "--directory", str(self.root))
        self.assertEqual(code, 0)
        self.assertTrue(out["ok"])
        self.assertEqual(out["jobs"][0]["job_id"], "checkup")
        code, out = self._cli("resolve", "--directory", str(self.root),
                              "--job-id", "ghost-job")
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])
        self.assertIn("no definition", out["error"])

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


class StarterLockTests(JobRunTestCase):
    """Story 28.6: submit/wake honour the supervisor queue's starter lock
    (AC1-AC3) — live by pid or by `since`, stale, forced, malformed,
    foreign, another checkout, the win32 case-fold and pid probe."""

    DEAD_PID = 2 ** 30  # above any pid_max: never a running process

    def setUp(self):
        super().setUp()
        self._old_ignore = os.environ.pop(jobrun.IGNORE_STARTER_LOCK_ENV, None)

    def tearDown(self):
        os.environ.pop(jobrun.IGNORE_STARTER_LOCK_ENV, None)
        if self._old_ignore is not None:
            os.environ[jobrun.IGNORE_STARTER_LOCK_ENV] = self._old_ignore
        super().tearDown()

    # ------------------------------------------------------------- helpers

    def _since(self, seconds_ago: float) -> str:
        return (jobrun._now() - timedelta(seconds=seconds_ago)).isoformat()

    def _lock(self, *, pid=None, since=None, starter=jobrun.QUEUE_STARTER,
              checkout=None, raw: str | None = None, drop: str | None = None):
        if not (self.root / ".tk-studio" / "config.yaml").is_file():
            configlib.standup_project_config(self.root)
        path = jobrun.starter_lock_path(self.root)
        path.parent.mkdir(parents=True, exist_ok=True)
        if raw is not None:
            path.write_text(raw, encoding="utf-8")
            return path
        lock = {"starter": starter,
                "checkout": str(self.root) if checkout is None else checkout,
                "since": self._since(3600) if since is None else since,
                "supervisor_pid": os.getpid() if pid is None else pid}
        if drop:
            lock.pop(drop)
        path.write_text(json.dumps(lock), encoding="utf-8")
        return path

    def _declare_both(self):
        self._declare("checkup", self._core_defn(
            "checkup", stop={"max_runs": 100}))
        self._declare("pulse", self._skill_defn(
            "pulse", trigger="loop", cadence={"mode": "self-paced"},
            stop={"max_runs": 100}))

    def _assert_nothing_minted(self):
        key = joblib.project_key(self.root)
        self.assertEqual(joblib.list_runs(key), [])
        self.assertFalse([e for e in self._ledger_events()
                          if e.get("event") == "job-run"])

    def _assert_refused(self):
        sub = jobrun.submit(self.root, "checkup")
        self.assertEqual(
            {k: sub[k] for k in ("job_id", "run_id", "accepted")},
            {"job_id": "checkup", "run_id": None, "accepted": False})
        self.assertTrue(sub["reason"].startswith("StarterLocked: "))
        self.assertNotIn("directive", sub)
        woke = jobrun.wake(self.root, "pulse")
        self.assertEqual({k: woke[k] for k in ("woken", "run_id")},
                         {"woken": False, "run_id": None})
        self.assertTrue(woke["reason"].startswith("StarterLocked: "))
        self.assertNotIn("directive", woke)
        self._assert_nothing_minted()
        return sub, woke

    # ---------------------------------------------------------- AC1 / AC3

    def test_live_by_pid_refuses_both_verbs_with_the_verbatim_reason(self):
        self._declare_both()
        since = self._since(3600)
        self._lock(pid=os.getpid(), since=since)
        sub, woke = self._assert_refused()
        expected = (
            "StarterLocked: tk-studio-supervisor's queue is the only starter "
            f"on this checkout (since {since}, supervisor pid {os.getpid()}) "
            "— submit the job to the supervisor (POST /jobs or bun "
            "src/cli.ts submit)")
        self.assertEqual(sub["reason"], expected)
        self.assertEqual(woke["reason"], expected)

    def test_live_by_since_refuses(self):
        self._declare_both()
        self._lock(pid=self.DEAD_PID, since=self._since(60))
        self._assert_refused()

    def test_stale_lock_mints_and_says_stale(self):
        self._declare_both()
        self._lock(pid=self.DEAD_PID, since=self._since(901))
        sub = jobrun.submit(self.root, "checkup")
        self.assertTrue(sub["accepted"])
        self.assertIsNotNone(sub["run_id"])
        self.assertEqual(sub["starter_lock"], "stale")
        woke = jobrun.wake(self.root, "pulse")
        self.assertTrue(woke["woken"])
        self.assertEqual(woke["starter_lock"], "stale")
        # forced or not, a stale lock answers stale
        self.assertEqual(jobrun.wake(self.root, "pulse", force=True)
                         ["starter_lock"], "stale")

    # ------------------------------------- the supervisor's exact format

    def _supervisor_since(self, seconds_ago: float) -> str:
        """JavaScript `Date.toISOString()`: millisecond precision, `Z`."""
        at = jobrun._now().astimezone(timezone.utc) - timedelta(
            seconds=seconds_ago)
        return at.strftime("%Y-%m-%dT%H:%M:%S.") + "123Z"

    def _supervisor_checkout(self) -> str:
        """The supervisor's `checkoutKey`: realpath, folded on win32/darwin."""
        key = os.path.realpath(str(self.root))
        return key.lower() if sys.platform in ("win32", "darwin") else key

    def test_supervisor_format_live_lock_refuses(self):
        self._declare_both()
        since = self._supervisor_since(60)
        self.assertRegex(since, r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")
        self._lock(pid=self.DEAD_PID, since=since,
                   starter="tk-studio-supervisor queue",
                   checkout=self._supervisor_checkout())
        sub, woke = self._assert_refused()
        self.assertIn(f"(since {since}, supervisor pid {self.DEAD_PID})",
                      sub["reason"])
        self.assertIn(f"(since {since}, supervisor pid {self.DEAD_PID})",
                      woke["reason"])

    def test_supervisor_format_stale_lock_mints_and_says_stale(self):
        self._declare_both()
        self._lock(pid=self.DEAD_PID, since=self._supervisor_since(901),
                   starter="tk-studio-supervisor queue",
                   checkout=self._supervisor_checkout())
        sub = jobrun.submit(self.root, "checkup")
        self.assertTrue(sub["accepted"])
        self.assertIsNotNone(sub["run_id"])
        self.assertEqual(sub["starter_lock"], "stale")
        woke = jobrun.wake(self.root, "pulse")
        self.assertTrue(woke["woken"])
        self.assertEqual(woke["starter_lock"], "stale")

    def test_no_lock_file_is_unchanged(self):
        self._declare_both()
        sub = jobrun.submit(self.root, "checkup")
        self.assertTrue(sub["accepted"])
        self.assertNotIn("starter_lock", sub)
        self.assertNotIn("starter_lock", jobrun.wake(self.root, "pulse"))

    def test_malformed_locks_are_no_lock(self):
        self._declare_both()
        cases = [{"raw": "{not json"}, {"raw": "[]"}, {"drop": "starter"},
                 {"drop": "checkout"}, {"drop": "supervisor_pid"},
                 {"since": "yesterday-ish"}, {"pid": "123"}, {"pid": 0},
                 {"pid": -4}, {"pid": True}]
        for case in cases:
            with self.subTest(case=case):
                self._lock(**case)
                self.assertEqual(jobrun.starter_lock_state(self.root),
                                 (None, None))
                sub = jobrun.submit(self.root, "checkup")
                self.assertTrue(sub["accepted"], sub)
                self.assertNotIn("starter_lock", sub)
                woke = jobrun.wake(self.root, "pulse")
                self.assertTrue(woke["woken"], woke)
                self.assertNotIn("starter_lock", woke)

    def test_foreign_starter_or_other_checkout_is_no_lock(self):
        self._declare_both()
        other = Path(self._tmp.name) / "other"
        other.mkdir()
        for case in ({"starter": "someone else"}, {"checkout": str(other)}):
            with self.subTest(case=case):
                self._lock(**case)
                sub = jobrun.submit(self.root, "checkup")
                self.assertTrue(sub["accepted"], sub)
                self.assertNotIn("starter_lock", sub)
                self.assertTrue(jobrun.wake(self.root, "pulse")["woken"])

    def test_win32_case_folded_checkout_matches_linux_does_not(self):
        self._lock(pid=self.DEAD_PID, since=self._since(60),
                   checkout=str(self.root).upper())
        self.assertEqual(
            jobrun.starter_lock_state(self.root, platform="win32")[0], "live")
        self.assertEqual(
            jobrun.starter_lock_state(self.root, platform="linux"),
            (None, None))
        self._declare_both()
        with mock.patch.object(jobrun.sys, "platform", "win32"):
            self._assert_refused()

    def test_win32_probe_never_reaches_os_kill(self):
        with mock.patch.object(jobrun.os, "kill",
                               side_effect=AssertionError("os.kill on win32")):
            if sys.platform != "win32":
                self.assertFalse(jobrun._pid_alive(os.getpid(), "win32"))
            self._lock(pid=os.getpid(), since=self._since(3600))
            # never raises, never reaches os.kill
            jobrun.starter_lock_state(self.root, platform="win32")

    @unittest.skipUnless(sys.platform == "win32", "win32 pid probe")
    def test_win32_probing_a_live_pid_terminates_nothing(self):
        import subprocess
        child = subprocess.Popen([sys.executable, "-c",
                                  "import time; time.sleep(60)"])
        try:
            self.assertTrue(jobrun._pid_alive(child.pid))
            self.assertTrue(jobrun._pid_alive(child.pid))
            self.assertIsNone(child.poll())
        finally:
            child.terminate()
            child.wait(timeout=30)

    def test_posix_probe_treats_permission_error_as_alive(self):
        with mock.patch.object(jobrun.os, "kill",
                               side_effect=PermissionError()):
            self.assertTrue(jobrun._pid_alive(1, "linux"))
        with mock.patch.object(jobrun.os, "kill",
                               side_effect=ProcessLookupError()):
            self.assertFalse(jobrun._pid_alive(1, "linux"))

    # ---------------------------------------------------------------- AC2

    def test_forced_by_argument_mints_and_says_forced(self):
        self._declare_both()
        self._lock()
        sub = jobrun.submit(self.root, "checkup", force=True)
        self.assertTrue(sub["accepted"])
        self.assertEqual(sub["starter_lock"], "forced")
        woke = jobrun.wake(self.root, "pulse", force=True)
        self.assertTrue(woke["woken"])
        self.assertEqual(woke["starter_lock"], "forced")

    def test_cli_flag_forces_both_verbs(self):
        self._declare_both()
        self._lock()
        code, out = self._cli("submit", "--directory", str(self.root),
                              "--id", "checkup")
        self.assertEqual(code, 0)
        self.assertFalse(out["accepted"])
        self.assertTrue(out["reason"].startswith("StarterLocked: "))
        code, out = self._cli("submit", "--directory", str(self.root),
                              "--id", "checkup", "--force-starter")
        self.assertEqual(code, 0)
        self.assertTrue(out["accepted"])
        self.assertEqual(out["starter_lock"], "forced")
        code, out = self._cli("wake", "--directory", str(self.root),
                              "--job-id", "pulse")
        self.assertEqual(code, 0)
        self.assertFalse(out["woken"])
        code, out = self._cli("wake", "--directory", str(self.root),
                              "--job-id", "pulse", "--force-starter")
        self.assertEqual(code, 0)
        self.assertTrue(out["woken"])
        self.assertEqual(out["starter_lock"], "forced")

    def test_env_forces_only_when_exactly_1(self):
        self._declare_both()
        self._lock()
        for value in ("0", "true", "yes", " 1"):
            with self.subTest(value=value):
                os.environ[jobrun.IGNORE_STARTER_LOCK_ENV] = value
                self._assert_refused()
        os.environ[jobrun.IGNORE_STARTER_LOCK_ENV] = "1"
        code, out = self._cli("submit", "--directory", str(self.root),
                              "--id", "checkup")
        self.assertTrue(out["accepted"])
        self.assertEqual(out["starter_lock"], "forced")
        code, out = self._cli("wake", "--directory", str(self.root),
                              "--job-id", "pulse")
        self.assertTrue(out["woken"])
        self.assertEqual(out["starter_lock"], "forced")

    # ------------------------------------------- other refusals come first

    def test_other_refusals_answer_as_today_under_a_live_lock(self):
        self._declare("checkup", self._core_defn("checkup"))
        self._declare("done", self._core_defn("done", stop={"max_runs": 1}))
        self._declare("loopdone", self._skill_defn(
            "loopdone", trigger="loop", cadence={"mode": "self-paced"},
            stop={"max_runs": 1}))
        # spend each stop condition before the lock exists
        self.assertTrue(jobrun.submit(self.root, "done")["accepted"])
        self.assertTrue(jobrun.wake(self.root, "loopdone")["woken"])
        self._lock()
        # definition problems
        sub = jobrun.submit(self.root, "ghost-job")
        self.assertFalse(sub["accepted"])
        self.assertIn("no definition", sub["reason"])
        # one-shot wake
        woke = jobrun.wake(self.root, "checkup")
        self.assertIn("wake applies to recurring jobs", woke["reason"])
        # stop condition
        self.assertIn("stop: max_runs",
                      jobrun.submit(self.root, "done")["reason"])
        self.assertIn("stop: max_runs",
                      jobrun.wake(self.root, "loopdone")["reason"])


if __name__ == "__main__":
    unittest.main()
