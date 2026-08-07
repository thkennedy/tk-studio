"""Tests for session discipline (ST-6.6 + ST-9.2 acceptance criteria).

AC 1 (ST-6.6): at a declared boundary (epic/story/phase) or a budget
trigger, a compact handoff artifact lands in the run workspace and the
session is directed to end and resume fresh.

AC 2 (ST-6.6): a fresh session pointed at a run workspace continues from
the handoff + workspace state alone (success criterion 8) — verified by an
integration test on a seeded workspace.

ST-9.2 (Epic 9, session surface): handoff.json accepts an optional deltas[]
(the knowledge.schema.json closed shape) validated against the workspace's
seed.md; unanchored/dangling deltas are named rejections; deltas share the
16 KB budget with the list capped; --job-id selects a job's sole resumable
run for drivers that never saw the minted run id.
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

    # ------------------------- ST-9.2: handoffs carry deltas (validated)

    SEED = (
        "---\n"
        "tier: seed\n"
        "status: provisional\n"
        "authority: mission-scoped-supersedes-canonical\n"
        "project: proj\n"
        "generated: 2026-08-07\n"
        "run_id: {run_id}\n"
        "spine_ref: projects/proj/knowledge/spine.md\n"
        "inherits: [SPINE-A1]\n"
        "---\n"
        "\n"
        "- [SEED-{run_id}-A1] the adapter reads tracked config only\n"
        "- [SEED-{run_id}-A2] the backend preserves unknown keys\n")

    def _write_seed(self, run_id: str) -> None:
        workspace = joblib.workspace_path("proj", run_id)
        (workspace / "seed.md").write_text(
            self.SEED.format(run_id=run_id), encoding="utf-8", newline="\n")

    def _delta(self, run_id: str, **overrides) -> dict:
        delta = {"anchor": f"SEED-{run_id}-A1", "verdict": "WRONG",
                 "reality": "it also reads the local overlay",
                 "evidence": "lib/config.py:81", "tier": "run-local"}
        delta.update(overrides)
        return delta

    def test_handoff_carries_validated_deltas(self):
        run_id = self._open_run()
        self._write_seed(run_id)
        deltas = [self._delta(run_id),
                  {"anchor": "SPINE-A1", "verdict": "STALE",
                   "reality": "the pin moved to 6.10.0",
                   "evidence": "bmad.lock", "tier": "spine"}]
        self._handoff(run_id, deltas=deltas)
        workspace = joblib.workspace_path("proj", run_id)
        handoff = json.loads((workspace / "handoff.json").read_text(
            encoding="utf-8"))
        self.assertEqual(handoff["deltas"], deltas)
        # resume surfaces the corrections with everything else
        resumed = session.read_resume(self.root, run_id)
        self.assertEqual(resumed["handoff"]["deltas"][1]["anchor"],
                         "SPINE-A1")

    def test_handoff_without_deltas_never_gated_by_seed_state(self):
        # aid, not gate: no seed.md, no deltas — the handoff still lands
        run_id = self._open_run()
        result = self._handoff(run_id)
        self.assertEqual(result["handoff"]["deltas"], [])

    def test_dangling_delta_is_a_named_rejection(self):
        run_id = self._open_run()
        self._write_seed(run_id)
        self._handoff(run_id)  # a good boundary already landed
        with self.assertRaises(session.SessionError) as ctx:
            self._handoff(run_id,
                          deltas=[self._delta(run_id,
                                              anchor=f"SEED-{run_id}-A9")])
        self.assertIn("dangling", str(ctx.exception))
        # the refusal touched nothing: prior handoff intact, run untouched
        resumed = session.read_resume(self.root, run_id)
        self.assertEqual(resumed["handoff"]["deltas"], [])
        record = joblib.read_run("proj", run_id)
        self.assertEqual(record["checkpoint"]["handoffs"], 1)

    def test_deltas_without_a_seed_all_dangle(self):
        run_id = self._open_run()
        with self.assertRaises(session.SessionError) as ctx:
            self._handoff(run_id, deltas=[self._delta(run_id)])
        self.assertIn("no seed.md", str(ctx.exception))
        self.assertIn("dangling", str(ctx.exception))

    def test_unanchored_and_malformed_deltas_reject(self):
        run_id = self._open_run()
        self._write_seed(run_id)
        unanchored = self._delta(run_id)
        del unanchored["anchor"]
        with self.assertRaises(session.SessionError) as ctx:
            self._handoff(run_id, deltas=[unanchored])
        self.assertIn("unanchored", str(ctx.exception))
        with self.assertRaises(session.SessionError):
            self._handoff(run_id,
                          deltas=[self._delta(run_id, verdict="MAYBE")])
        with self.assertRaises(session.SessionError):
            self._handoff(run_id, deltas=["not-an-object"])

    def test_undecodable_seed_refuses_named_not_traceback(self):
        # a UTF-16/ANSI-re-encoded seed (the PowerShell default trap) must
        # end in a named refusal, never an unhandled UnicodeDecodeError
        run_id = self._open_run()
        workspace = joblib.workspace_path("proj", run_id)
        (workspace / "seed.md").write_bytes(b"\xff\xfe-- not utf-8 --")
        with self.assertRaises(session.SessionError) as ctx:
            self._handoff(run_id, deltas=[self._delta(run_id)])
        self.assertIn("unreadable", str(ctx.exception))

    def test_delta_list_is_capped(self):
        run_id = self._open_run()
        self._write_seed(run_id)
        too_many = [self._delta(run_id) for _ in range(17)]
        with self.assertRaises(session.SessionError) as ctx:
            self._handoff(run_id, deltas=too_many)
        self.assertIn("max 16", str(ctx.exception))

    def test_deltas_share_the_16kb_budget(self):
        run_id = self._open_run()
        self._write_seed(run_id)
        fat = self._delta(run_id, reality="x" * 20000)
        with self.assertRaises(session.SessionError) as ctx:
            self._handoff(run_id, deltas=[fat])
        self.assertIn("compact", str(ctx.exception))

    # --------------------- ST-9.2: --job-id selects the sole resumable run

    def test_job_id_resolves_the_sole_resumable_run(self):
        run_id = self._open_run()
        self.assertEqual(
            session.resolve_run_id(self.root, None, "long-work"), run_id)

    def test_job_id_refuses_zero_and_many(self):
        with self.assertRaises(session.SessionError) as ctx:
            session.resolve_run_id(self.root, None, "long-work")
        self.assertIn("no resumable run", str(ctx.exception))
        self._open_run()
        self._open_run()
        with self.assertRaises(session.SessionError) as ctx:
            session.resolve_run_id(self.root, None, "long-work")
        self.assertIn("2 resumable runs", str(ctx.exception))

    def test_exactly_one_selector(self):
        with self.assertRaises(session.SessionError):
            session.resolve_run_id(self.root, None, None)
        with self.assertRaises(session.SessionError):
            session.resolve_run_id(self.root, "rid", "jid")

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

    def test_cli_deltas_and_job_id_selector(self):
        run_id = self._open_run()
        self._write_seed(run_id)
        code, out = self._cli(
            "handoff", "--directory", str(self.root),
            "--job-id", "long-work",
            "--boundary", "story", "--name", "ST-9.2",
            "--done", "surface built", "--next", "capture story",
            "--delta", json.dumps(self._delta(run_id)))
        self.assertEqual(code, 0)
        self.assertEqual(out["handoff"]["deltas"][0]["verdict"], "WRONG")
        code, out = self._cli("resume", "--directory", str(self.root),
                              "--job-id", "long-work")
        self.assertEqual(code, 0)
        self.assertEqual(len(out["handoff"]["deltas"]), 1)

    def test_cli_refusals_are_named(self):
        run_id = self._open_run()
        # malformed --delta JSON
        code, out = self._cli(
            "handoff", "--directory", str(self.root), "--run-id", run_id,
            "--boundary", "story", "--name", "ST-9.2",
            "--done", "d", "--next", "n", "--delta", "{not json")
        self.assertEqual(code, 2)
        self.assertIn("not valid JSON", out["error"])
        # both selectors / neither selector
        code, out = self._cli("resume", "--directory", str(self.root),
                              "--run-id", run_id, "--job-id", "long-work")
        self.assertEqual(code, 2)
        self.assertIn("exactly one", out["error"])
        code, out = self._cli("resume", "--directory", str(self.root))
        self.assertEqual(code, 2)
        self.assertIn("exactly one", out["error"])


if __name__ == "__main__":
    unittest.main()
