"""Tests for session discipline (ST-6.6 acceptance criteria).

AC 1: at a declared boundary (epic/story/phase) or a budget trigger, a
compact handoff artifact lands in the run workspace and the session is
directed to end and resume fresh.

AC 2: a fresh session pointed at a run workspace continues from the handoff
+ workspace state alone (success criterion 8) — verified by an integration
test on a seeded workspace.
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
import session  # noqa: E402


class SessionTestCase(unittest.TestCase):
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

    def _open_run(self) -> str:
        """A running skill-target job run, as session A would hold it."""
        defn = {
            "job_schema_version": 1,
            "id": "long-work",
            "target": {"skill": "tk-studio-research",
                       "payload": {"charter": {"topics": ["t"],
                                               "sources": ["s"]}}},
            "trigger": "one-shot",
            "guards": {"max_turns": 50},
            "stop": {"max_runs": 1},
        }
        record = joblib.create_run(defn, "proj")
        joblib.update_run("proj", record["run_id"], {"state": "running"})
        return record["run_id"]

    def _handoff(self, run_id: str, **overrides) -> dict:
        kwargs = dict(boundary_kind="story", boundary_name="ST-014",
                      done=["implemented the adapter"],
                      next_steps=["wire the projection", "run the suite"],
                      gotchas=["BOM breaks frontmatter"],
                      artifacts=["findings.md"])
        kwargs.update(overrides)
        return session.write_handoff(self.root, run_id, **kwargs)

    # ------------------------------- AC1: boundary lands a compact handoff

    def test_handoff_lands_artifact_and_directs_session_end(self):
        run_id = self._open_run()
        result = self._handoff(run_id)
        self.assertTrue(result["directive"]["end_session"])
        workspace = joblib.workspace_path("proj", run_id)
        handoff = json.loads((workspace / "handoff.json").read_text(
            encoding="utf-8"))
        self.assertEqual(handoff["boundary"],
                         {"kind": "story", "name": "ST-014"})
        self.assertEqual(handoff["next"][0], "wire the projection")
        # the split never ends the run — the workspace stays resumable
        record = joblib.read_run("proj", run_id)
        self.assertIn(record["state"], joblib.RESUMABLE_STATES)
        self.assertEqual(record["checkpoint"]["handoffs"], 1)

    def test_budget_is_a_declared_boundary_too(self):
        run_id = self._open_run()
        result = self._handoff(run_id, boundary_kind="budget",
                               boundary_name="token budget 80%")
        self.assertEqual(result["handoff"]["boundary"]["kind"], "budget")

    def test_each_boundary_overwrites_the_resume_point(self):
        run_id = self._open_run()
        self._handoff(run_id)
        self._handoff(run_id, boundary_kind="phase", boundary_name="verify",
                      next_steps=["only this remains"])
        resumed = session.read_resume(self.root, run_id)
        self.assertEqual(resumed["handoff"]["boundary"]["name"], "verify")
        self.assertEqual(resumed["handoff"]["next"], ["only this remains"])
        record = joblib.read_run("proj", run_id)
        self.assertEqual(record["checkpoint"]["handoffs"], 2)

    def test_compact_is_enforced_not_hoped_for(self):
        run_id = self._open_run()
        with self.assertRaises(session.SessionError):
            self._handoff(run_id, done=["x" * 20000])

    def test_handoff_validation_refuses_empty_boundaries(self):
        run_id = self._open_run()
        with self.assertRaises(session.SessionError):
            self._handoff(run_id, boundary_kind="whim")
        with self.assertRaises(session.SessionError):
            self._handoff(run_id, next_steps=[])
        with self.assertRaises(session.SessionError):
            self._handoff(run_id, done=[])

    def test_terminal_runs_refuse_handoff_and_resume(self):
        run_id = self._open_run()
        self._handoff(run_id)
        jobrun.finish(self.root, run_id, "complete")
        with self.assertRaises(session.SessionError):
            self._handoff(run_id)
        with self.assertRaises(session.SessionError):
            session.read_resume(self.root, run_id)

    def test_resume_without_a_handoff_refuses(self):
        run_id = self._open_run()
        with self.assertRaises(session.SessionError):
            session.read_resume(self.root, run_id)

    # --------------------- AC2: fresh session, workspace alone (SC 8)

    def test_fresh_session_continues_from_workspace_alone(self):
        # --- session A: work, checkpoint, boundary, end
        run_id = self._open_run()
        joblib.update_run("proj", run_id, {
            "checkpoint": {"cursor": "topic-2-of-3"}})
        self._handoff(run_id, next_steps=["survey topic 3", "record findings"])
        # --- session B: nothing in memory but directory + run id
        resumed = session.read_resume(self.root, run_id)
        self.assertEqual(resumed["directive"]["continue_from"], "handoff.next")
        self.assertEqual(resumed["run"]["checkpoint"]["cursor"],
                         "topic-2-of-3")
        self.assertEqual(resumed["run"]["job"]["target"]["skill"],
                         "tk-studio-research")
        self.assertIn("handoff.json", resumed["files"])
        # continue the work the handoff names, then finish — all through
        # the same wrapper verbs, no state from session A required
        verdict = jobrun.account(self.root, run_id, turns=1)
        self.assertTrue(verdict["within_budget"])
        ended = jobrun.finish(self.root, run_id, "complete")
        self.assertEqual(ended["state"], "complete")

    def test_integration_on_a_seeded_workspace(self):
        """A workspace seeded from nothing but files resumes cleanly."""
        configlib.standup_project_config(self.root, project_id="seeded")
        runs = joblib.runs_root("seeded")
        workspace = runs / "long-work-seeded"
        workspace.mkdir(parents=True)
        (workspace / "run.json").write_text(json.dumps({
            "run_schema_version": 1,
            "run_id": "long-work-seeded",
            "job_id": "long-work",
            "project": "seeded",
            "state": "running",
            "created": "2026-08-06T00:00:00.000+00:00",
            "updated": "2026-08-06T00:00:00.000+00:00",
            "started": "2026-08-06T00:00:00.000+00:00",
            "job": {"job_schema_version": 1, "id": "long-work",
                    "target": {"skill": "tk-studio-research"},
                    "trigger": "one-shot", "guards": {"max_turns": 9},
                    "stop": {"max_runs": 1}},
            "checkpoint": {"cursor": "phase-2"},
        }, indent=2), encoding="utf-8", newline="\n")
        (workspace / "handoff.json").write_text(json.dumps({
            "handoff_version": 1,
            "run_id": "long-work-seeded",
            "job_id": "long-work",
            "boundary": {"kind": "phase", "name": "verify"},
            "created": "2026-08-06T00:00:00.000+00:00",
            "done": ["phases 1-2"],
            "next": ["run verification"],
            "gotchas": [],
            "artifacts": [],
        }, indent=2), encoding="utf-8", newline="\n")

        resumed = session.read_resume(self.root, "long-work-seeded")
        self.assertEqual(resumed["handoff"]["next"], ["run verification"])
        self.assertEqual(resumed["run"]["checkpoint"]["cursor"], "phase-2")
        verdict = jobrun.account(self.root, "long-work-seeded", turns=8)
        self.assertTrue(verdict["within_budget"])
        # the seeded guard bites exactly as a live one would
        over = jobrun.account(self.root, "long-work-seeded", turns=1)
        self.assertFalse(over["within_budget"])
        ended = jobrun.finish(self.root, "long-work-seeded", "partial",
                              reason="guard: max_turns")
        self.assertEqual(ended["state"], "partial")

    # ---------------------------------------------------------------- CLI

    def _cli(self, *argv: str) -> tuple[int, dict]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = session.main(list(argv))
        return code, json.loads(out.getvalue())

    def test_cli_handoff_and_resume(self):
        run_id = self._open_run()
        code, out = self._cli(
            "handoff", "--directory", str(self.root), "--run-id", run_id,
            "--boundary", "story", "--name", "ST-014",
            "--done", "adapter built", "--next", "projection next")
        self.assertEqual(code, 0)
        self.assertTrue(out["directive"]["end_session"])
        code, out = self._cli("resume", "--directory", str(self.root),
                              "--run-id", run_id)
        self.assertEqual(code, 0)
        self.assertEqual(out["handoff"]["next"], ["projection next"])
        code, out = self._cli("resume", "--directory", str(self.root),
                              "--run-id", "missing-run")
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])


if __name__ == "__main__":
    unittest.main()
