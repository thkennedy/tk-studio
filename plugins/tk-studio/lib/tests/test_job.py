"""Tests for the declarative job model (ST-6.1 acceptance criteria, AD-10).

AC 1: generic job types load from the plugin, per-project instances from
project config jobs[] (scalar refs — the miniyaml subset holds), and
validation rejects a job missing guards or stop conditions.

AC 2: run state persists in ~/.tk-studio/projects/<key>/runs/<run-id>/,
resumable after interruption.
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


class JobTestCase(unittest.TestCase):
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

    def _defn(self, **overrides) -> dict:
        base = {
            "job_schema_version": 1,
            "id": "probe",
            "target": {"skill": "tk-studio-observe",
                       "payload": {"source": "other"}},
            "trigger": "one-shot",
            "guards": {"max_turns": 5},
            "stop": {"max_runs": 1},
        }
        base.update(overrides)
        return base

    def _declare_jobs(self, *ids: str) -> None:
        configlib.standup_project_config(self.root)
        tracked = self.root / ".tk-studio" / "config.yaml"
        text = tracked.read_text(encoding="utf-8")
        text += "\njobs:\n" + "".join(f"  - {job_id}\n" for job_id in ids)
        tracked.write_text(text, encoding="utf-8", newline="\n")

    def _write_instance(self, job_id: str, defn: dict) -> Path:
        jobs_dir = self.root / ".tk-studio" / "jobs"
        jobs_dir.mkdir(parents=True, exist_ok=True)
        path = jobs_dir / f"{job_id}.json"
        path.write_text(json.dumps(defn, indent=2), encoding="utf-8",
                        newline="\n")
        return path

    def _cli(self, *argv: str) -> tuple[int, dict]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = joblib.main(list(argv))
        return code, json.loads(out.getvalue())

    # ------------------------------------- schema is the source, not a copy

    def test_schema_requires_guards_and_stop(self):
        self.assertIn("guards", joblib.REQUIRED_FIELDS)
        self.assertIn("stop", joblib.REQUIRED_FIELDS)

    def test_run_states_match_driver_contract_verb_surface(self):
        self.assertEqual(
            joblib.RUN_STATES,
            ("queued", "running", "complete", "partial", "blocked",
             "cancelled"))
        self.assertEqual(joblib.TERMINAL_STATES,
                         ("complete", "partial", "blocked", "cancelled"))

    # ------------------------------------------------------ AC1: validation

    def test_valid_one_shot_passes(self):
        self.assertEqual(joblib.validate_definition(self._defn()), [])

    def test_valid_cron_and_loop_pass(self):
        cron = self._defn(trigger="cron",
                          cadence={"mode": "fixed", "schedule": "0 6 * * 1"})
        loop_fixed = self._defn(trigger="loop",
                                cadence={"mode": "fixed",
                                         "interval_seconds": 300})
        loop_paced = self._defn(trigger="loop",
                                cadence={"mode": "self-paced",
                                         "hint_seconds": 1200})
        for defn in (cron, loop_fixed, loop_paced):
            self.assertEqual(joblib.validate_definition(defn), [])

    def test_missing_guards_rejected(self):
        defn = self._defn()
        del defn["guards"]
        problems = joblib.validate_definition(defn)
        self.assertTrue(any("guards" in p for p in problems))

    def test_empty_guards_rejected(self):
        problems = joblib.validate_definition(self._defn(guards={}))
        self.assertTrue(any("at least one" in p for p in problems))

    def test_missing_stop_rejected(self):
        defn = self._defn()
        del defn["stop"]
        problems = joblib.validate_definition(defn)
        self.assertTrue(any("stop" in p for p in problems))

    def test_empty_stop_rejected(self):
        problems = joblib.validate_definition(self._defn(stop={}))
        self.assertTrue(any("at least one" in p for p in problems))

    def test_unknown_fields_rejected(self):
        problems = joblib.validate_definition(self._defn(surprise=1))
        self.assertTrue(any("unknown field" in p for p in problems))
        problems = joblib.validate_definition(
            self._defn(guards={"max_turns": 5, "max_cost": 1}))
        self.assertTrue(any("guards has unknown" in p for p in problems))

    def test_guard_and_stop_value_shapes(self):
        bad = [
            self._defn(guards={"max_turns": 0}),
            self._defn(guards={"max_turns": True}),
            self._defn(stop={"max_runs": 0}),
            self._defn(stop={"until": "not-a-time"}),
            self._defn(stop={"on_status": ["complete"]}),
            self._defn(stop={"on_status": []}),
        ]
        for defn in bad:
            self.assertNotEqual(joblib.validate_definition(defn), [], defn)

    def test_cadence_rules(self):
        bad = [
            self._defn(cadence={"mode": "fixed"}),  # one-shot takes no cadence
            self._defn(trigger="cron"),  # recurring requires cadence
            self._defn(trigger="cron", cadence={"mode": "self-paced",
                                                "schedule": "0 6 * * 1"}),
            self._defn(trigger="cron", cadence={"mode": "fixed",
                                                "schedule": "hourly"}),
            self._defn(trigger="loop", cadence={"mode": "fixed"}),
            self._defn(trigger="loop", cadence={"mode": "fixed",
                                                "interval_seconds": 60,
                                                "schedule": "0 6 * * 1"}),
            self._defn(trigger="loop", cadence={"mode": "self-paced",
                                                "interval_seconds": 60}),
        ]
        for defn in bad:
            self.assertNotEqual(joblib.validate_definition(defn), [], defn)

    def test_at_is_one_shot_only(self):
        good = self._defn(at="2026-08-06T12:00:00Z")
        self.assertEqual(joblib.validate_definition(good), [])
        bad = self._defn(trigger="loop",
                         cadence={"mode": "self-paced"},
                         at="2026-08-06T12:00:00Z")
        self.assertTrue(any("'at'" in p
                            for p in joblib.validate_definition(bad)))

    def test_target_rules(self):
        bad = [
            self._defn(target={}),
            self._defn(target={"payload": {"a": 1}}),
            self._defn(target={"core": []}),
            self._defn(target={"core": ["C:/abs/path.py", "run"]}),
            self._defn(target={"core": ["../outside.py"]}),
            self._defn(target={"skill": "x", "extra": 1}),
        ]
        for defn in bad:
            self.assertNotEqual(joblib.validate_definition(defn), [], defn)
        core_ok = self._defn(
            target={"core": ["contracts/conformance/runner.py", "run"]})
        self.assertEqual(joblib.validate_definition(core_ok), [])

    def test_model_effort_shapes(self):
        good = self._defn(model="claude-haiku-4-5", effort="low")
        self.assertEqual(joblib.validate_definition(good), [])
        bad = self._defn(effort="extreme")
        self.assertTrue(any("effort" in p
                            for p in joblib.validate_definition(bad)))

    # ------------------------------------- AC1: types load from the plugin

    def test_shipped_types_load_and_validate(self):
        types = joblib.load_types()
        self.assertIn("maintenance-conformance", types)
        entry = types["maintenance-conformance"]
        self.assertEqual(entry["problems"], [])
        self.assertEqual(entry["definition"]["trigger"], "cron")
        self.assertTrue(entry["definition"]["durable"])

    # ------------------------- AC1: instances from project config jobs[]

    def test_config_jobs_are_scalar_refs(self):
        self._declare_jobs("probe")
        self._write_instance("probe", self._defn())
        loaded = joblib.load_instances(self.root)
        self.assertEqual(loaded["problems"], [])
        (entry,) = loaded["jobs"]
        self.assertEqual(entry["source"], "instance")
        self.assertEqual(entry["problems"], [])
        self.assertEqual(entry["definition"]["id"], "probe")

    def test_bare_type_ref_uses_shipped_type_directly(self):
        self._declare_jobs("maintenance-conformance")
        (entry,) = joblib.load_instances(self.root)["jobs"]
        self.assertEqual(entry["source"], "type")
        self.assertEqual(entry["problems"], [])
        self.assertEqual(entry["definition"]["id"], "maintenance-conformance")

    def test_undeclared_project_has_no_jobs(self):
        self.assertEqual(joblib.load_instances(self.root)["jobs"], [])

    def test_missing_definition_is_a_problem_not_a_guess(self):
        self._declare_jobs("ghost")
        (entry,) = joblib.load_instances(self.root)["jobs"]
        self.assertTrue(entry["problems"])
        self.assertIn("no definition", entry["problems"][0])

    def test_duplicate_ids_flagged(self):
        self._declare_jobs("probe", "probe")
        self._write_instance("probe", self._defn())
        loaded = joblib.load_instances(self.root)
        self.assertTrue(any("duplicate" in p for p in loaded["problems"]))
        self.assertEqual(len(loaded["jobs"]), 1)

    def test_inline_job_mappings_refused(self):
        configlib.standup_project_config(self.root)
        tracked = self.root / ".tk-studio" / "config.yaml"
        text = tracked.read_text(encoding="utf-8") + "\njobs: probe\n"
        tracked.write_text(text, encoding="utf-8", newline="\n")
        with self.assertRaises(joblib.JobError):
            joblib.project_job_ids(self.root)

    def test_id_must_match_file_stem(self):
        self._declare_jobs("probe")
        self._write_instance("probe", self._defn(id="other"))
        (entry,) = joblib.load_instances(self.root)["jobs"]
        self.assertTrue(any("file stem" in p for p in entry["problems"]))

    def test_instance_extends_type_with_overrides(self):
        self._declare_jobs("nightly")
        self._write_instance("nightly", {
            "job_schema_version": 1,
            "id": "nightly",
            "type": "maintenance-conformance",
            "cadence": {"mode": "fixed", "schedule": "0 2 * * *"},
            "target": {"payload": {"timeout": 120}},
        })
        (entry,) = joblib.load_instances(self.root)["jobs"]
        self.assertEqual(entry["problems"], [])
        self.assertEqual(entry["extends"], "maintenance-conformance")
        defn = entry["definition"]
        self.assertEqual(defn["id"], "nightly")
        self.assertEqual(defn["cadence"]["schedule"], "0 2 * * *")
        # target overlays: core kept from the type, payload merged in
        self.assertEqual(defn["target"]["core"][0],
                         "contracts/conformance/runner.py")
        self.assertEqual(defn["target"]["payload"], {"timeout": 120})
        # the type's own guards/stop still satisfy validation
        self.assertIn("max_wall_clock_seconds", defn["guards"])

    def test_unknown_type_ref_is_a_problem(self):
        self._declare_jobs("probe")
        self._write_instance("probe", self._defn(type="no-such-type"))
        (entry,) = joblib.load_instances(self.root)["jobs"]
        self.assertTrue(any("unknown job type" in p for p in entry["problems"]))

    def test_tracked_instance_files_are_classified(self):
        self._declare_jobs("probe")
        leaky = self._defn()
        leaky["target"]["payload"] = {
            "auth": "ghp_0123456789abcdef0123456789abcdef",
            "path": "C:/Users/someone/notes.md",
        }
        self._write_instance("probe", leaky)
        (entry,) = joblib.load_instances(self.root)["jobs"]
        text = " ".join(entry["problems"])
        self.assertIn("credential-shaped", text)
        self.assertIn("machine path", text)

    # ----------------------------------------- AC2: resumable run state

    def test_create_run_persists_under_project_key(self):
        record = joblib.create_run(self._defn(), "proj")
        workspace = joblib.runs_root("proj") / record["run_id"]
        self.assertTrue((workspace / "run.json").is_file())
        self.assertTrue(str(workspace).startswith(str(self.store)))
        self.assertEqual(record["state"], "queued")
        self.assertEqual(record["job"]["id"], "probe")

    def test_create_run_refuses_invalid_definition(self):
        with self.assertRaises(joblib.JobError):
            joblib.create_run(self._defn(guards={}), "proj")

    def test_run_ids_never_collide(self):
        first = joblib.create_run(self._defn(), "proj")
        second = joblib.create_run(self._defn(), "proj")
        self.assertNotEqual(first["run_id"], second["run_id"])

    def test_run_resumes_from_workspace_alone(self):
        record = joblib.create_run(self._defn(), "proj")
        run_id = record["run_id"]
        joblib.update_run("proj", run_id, {
            "state": "running",
            "checkpoint": {"step": 2, "cursor": "ST-014"},
        })
        # interruption = nothing in memory; a fresh reader gets everything
        resumed = joblib.read_run("proj", run_id)
        self.assertEqual(resumed["state"], "running")
        self.assertIn(resumed["state"], joblib.RESUMABLE_STATES)
        self.assertEqual(resumed["checkpoint"], {"step": 2, "cursor": "ST-014"})
        self.assertEqual(resumed["job"]["target"]["skill"], "tk-studio-observe")
        self.assertTrue(resumed["started"])

    def test_partial_requires_reason_and_terminal_is_immutable(self):
        record = joblib.create_run(self._defn(), "proj")
        run_id = record["run_id"]
        with self.assertRaises(joblib.JobError):
            joblib.update_run("proj", run_id, {"state": "partial"})
        ended = joblib.update_run("proj", run_id, {
            "state": "partial", "reason": "guard: max_turns"})
        self.assertTrue(ended["ended"])
        with self.assertRaises(joblib.JobError):
            joblib.update_run("proj", run_id, {"state": "running"})

    def test_run_identity_fields_are_immutable(self):
        record = joblib.create_run(self._defn(), "proj")
        with self.assertRaises(joblib.JobError):
            joblib.update_run("proj", record["run_id"], {"job_id": "other"})

    def test_list_runs_filters_and_surfaces_corruption(self):
        one = joblib.create_run(self._defn(), "proj")
        joblib.create_run(self._defn(id="second"), "proj")
        runs = joblib.list_runs("proj")
        self.assertEqual(len(runs), 2)
        only = joblib.list_runs("proj", job_id="probe")
        self.assertEqual([r["run_id"] for r in only], [one["run_id"]])
        # corrupt state is an error entry, never silently skipped
        broken = joblib.runs_root("proj") / "broken-run"
        broken.mkdir()
        (broken / "run.json").write_text("{not json", encoding="utf-8")
        entries = joblib.list_runs("proj")
        self.assertTrue(any("error" in r for r in entries))

    def test_project_key_prefers_explicit_project_id(self):
        self.assertEqual(joblib.project_key(self.root), "proj")
        configlib.standup_project_config(self.root, project_id="my-studio")
        self.assertEqual(joblib.project_key(self.root), "my-studio")

    # ---------------------------------------------------------------- CLI

    def test_cli_validate_file(self):
        path = self._write_instance("probe", self._defn())
        code, out = self._cli("validate", "--file", str(path))
        self.assertEqual(code, 0)
        self.assertTrue(out["ok"])
        code, out = self._cli("validate", "--file",
                              str(self._write_instance("bad",
                                                       self._defn(id="bad",
                                                                  guards={}))))
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])

    def test_cli_validate_id_and_list(self):
        self._declare_jobs("probe")
        self._write_instance("probe", self._defn())
        code, out = self._cli("validate", "--id", "probe",
                              "--directory", str(self.root))
        self.assertEqual(code, 0)
        self.assertEqual(out["job"]["id"], "probe")
        code, out = self._cli("list", "--directory", str(self.root))
        self.assertEqual(code, 0)
        self.assertTrue(out["valid"])
        self.assertIn("maintenance-conformance",
                      [t["id"] for t in out["types"]])

    def test_cli_run_init_runs_and_show(self):
        self._declare_jobs("probe")
        self._write_instance("probe", self._defn())
        code, out = self._cli("run-init", "--directory", str(self.root),
                              "--id", "probe")
        self.assertEqual(code, 0)
        run_id = out["run"]["run_id"]
        code, out = self._cli("runs", "--directory", str(self.root))
        self.assertEqual(code, 0)
        self.assertEqual([r["run_id"] for r in out["runs"]], [run_id])
        code, out = self._cli("run-show", "--directory", str(self.root),
                              "--run-id", run_id)
        self.assertEqual(code, 0)
        self.assertEqual(out["run"]["state"], "queued")

    def test_cli_refuses_unknown_id(self):
        configlib.standup_project_config(self.root)
        code, out = self._cli("run-init", "--directory", str(self.root),
                              "--id", "ghost")
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])


if __name__ == "__main__":
    unittest.main()
