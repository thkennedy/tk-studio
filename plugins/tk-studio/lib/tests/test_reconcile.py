"""Tests for reconciliation — capture + queue + routing (ST-9.4 acceptance
criteria, Epic 9).

AC 1: a run finishing with deltas in its handoff appends them to the
per-project reconciliation queue in the per-user store, deduped on
(run_id, anchor, verdict, reality) — riding the executing wrapper's finish
(and every other terminal transition), plus each boundary handoff so an
overwritten handoff never loses corrections.

AC 2: the routing renderer produces the routing doc beside the queue — a
pure render that applies nothing.

AC 3 (e2e — the run the source lifecycle never had): a run emits deltas →
the queue materializes → the routing doc renders, asserted end to end.
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

import job as joblib  # noqa: E402
import jobrun  # noqa: E402
import knowledge  # noqa: E402
import reconcile  # noqa: E402
import research  # noqa: E402
import session  # noqa: E402


class ReconcileTestCase(unittest.TestCase):
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

    def _open_run(self, job_id: str = "long-work") -> str:
        defn = {
            "job_schema_version": 1,
            "id": job_id,
            "target": {"skill": "tk-studio-research",
                       "payload": {"charter": {"topics": ["t"],
                                               "sources": ["s"]}}},
            "trigger": "one-shot",
            "guards": {"max_turns": 50},
            "stop": {"max_runs": 5},
        }
        record = joblib.create_run(defn, "proj")
        joblib.update_run("proj", record["run_id"], {"state": "running"})
        return record["run_id"]

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

    def _write_handoff(self, run_id: str, deltas: list) -> None:
        """A handoff landed directly in the workspace — the wrapper's
        finish must capture regardless of who wrote the handoff."""
        joblib.write_workspace_json("proj", run_id, "handoff.json", {
            "handoff_version": 1,
            "run_id": run_id,
            "job_id": "long-work",
            "boundary": {"kind": "story", "name": "ST-9.4"},
            "created": "2026-08-07T05:00:00.000+00:00",
            "done": ["captured"], "next": ["route"],
            "gotchas": [], "artifacts": [],
            "deltas": deltas,
        })

    def _queue_lines(self) -> list[dict]:
        path = reconcile.queue_path("proj")
        if not path.is_file():
            return []
        return [json.loads(line) for line in
                path.read_text(encoding="utf-8").splitlines() if line.strip()]

    # ------------------------------------ AC1: capture appends, deduped

    def test_capture_appends_queue_lines_in_schema_shape(self):
        run_id = self._open_run()
        self._write_handoff(run_id, [
            self._delta(run_id),
            self._delta(run_id, anchor="SPINE-A1", verdict="STALE",
                        reality="the pin moved", tier="spine")])
        result = reconcile.capture("proj", run_id)
        self.assertEqual(result["captured"], 2)
        self.assertEqual(result["rejected"], [])
        lines = self._queue_lines()
        self.assertEqual(len(lines), 2)
        for line in lines:
            self.assertEqual(knowledge.validate_queue_line(line), [])
            self.assertEqual(line["run_id"], run_id)
        self.assertEqual(lines[1]["tier"], "spine")

    def test_capture_is_idempotent_by_the_dedupe_key(self):
        run_id = self._open_run()
        self._write_handoff(run_id, [self._delta(run_id)])
        self.assertEqual(reconcile.capture("proj", run_id)["captured"], 1)
        again = reconcile.capture("proj", run_id)
        self.assertEqual(again["captured"], 0)
        self.assertEqual(again["duplicates"], 1)
        self.assertEqual(len(self._queue_lines()), 1)

    def test_differing_reality_is_a_different_correction(self):
        run_id = self._open_run()
        self._write_handoff(run_id, [self._delta(run_id)])
        reconcile.capture("proj", run_id)
        self._write_handoff(run_id, [
            self._delta(run_id, reality="it caches the overlay too")])
        result = reconcile.capture("proj", run_id)
        self.assertEqual(result["captured"], 1)
        self.assertEqual(len(self._queue_lines()), 2)

    def test_capture_without_handoff_or_deltas_answers_zero(self):
        run_id = self._open_run()
        result = reconcile.capture("proj", run_id)
        self.assertEqual(result["captured"], 0)
        self.assertIn("no handoff.json", result["note"])
        self._write_handoff(run_id, [])
        result = reconcile.capture("proj", run_id)
        self.assertEqual(result["captured"], 0)
        self.assertIn("no deltas", result["note"])
        self.assertFalse(reconcile.queue_path("proj").is_file())

    def test_capture_names_malformed_deltas_and_lands_the_valid(self):
        run_id = self._open_run()
        self._write_handoff(run_id, [
            self._delta(run_id),
            {"anchor": "not-an-anchor", "verdict": "MAYBE"},
            "not-an-object"])
        result = reconcile.capture("proj", run_id)
        self.assertEqual(result["captured"], 1)
        self.assertEqual([r["delta"] for r in result["rejected"]], [1, 2])
        self.assertEqual(len(self._queue_lines()), 1)

    def test_capture_refuses_unknown_run_and_unreadable_handoff(self):
        with self.assertRaises(joblib.JobError):
            reconcile.capture("proj", "ghost-run")
        run_id = self._open_run()
        workspace = joblib.workspace_path("proj", run_id)
        (workspace / "handoff.json").write_bytes(b"\xff\xfenot json")
        with self.assertRaises(reconcile.ReconcileError) as ctx:
            reconcile.capture("proj", run_id)
        self.assertIn("unreadable", str(ctx.exception))

    def test_queue_is_append_only_around_a_bad_line(self):
        run_id = self._open_run()
        self._write_handoff(run_id, [self._delta(run_id)])
        reconcile.capture("proj", run_id)
        path = reconcile.queue_path("proj")
        with open(path, "a", encoding="utf-8", newline="\n") as handle:
            handle.write("{corrupt line\n")
        before = path.read_text(encoding="utf-8")
        self._write_handoff(run_id, [
            self._delta(run_id, reality="a second correction")])
        result = reconcile.capture("proj", run_id)
        self.assertEqual(result["captured"], 1)
        self.assertEqual([i["line"] for i in result["queue_invalid"]], [2])
        after = path.read_text(encoding="utf-8")
        # the bad line is still there, verbatim — reported, never repaired
        self.assertTrue(after.startswith(before))

    # ------------------------------------------ AC2: routing doc renders

    def test_route_renders_the_doc_beside_the_queue(self):
        run_id = self._open_run()
        self._write_handoff(run_id, [
            self._delta(run_id),
            self._delta(run_id, anchor="SPINE-A1", verdict="STALE",
                        reality="the pin moved", tier="spine")])
        reconcile.capture("proj", run_id)
        result = reconcile.route("proj")
        self.assertTrue(result["rendered"])
        self.assertEqual(result["entries"], 2)
        doc_path = Path(result["path"])
        self.assertEqual(doc_path.parent, reconcile.queue_path("proj").parent)
        doc = doc_path.read_text(encoding="utf-8")
        self.assertIn("applies nothing", doc)
        self.assertIn("[SPINE-A1]", doc)
        self.assertIn(f"[SEED-{run_id}-A1]", doc)

    def test_route_on_an_empty_queue_answers_not_errors(self):
        result = reconcile.route("proj")
        self.assertFalse(result["rendered"])
        self.assertIn("empty", result["reason"])

    def test_route_surfaces_invalid_lines_in_the_doc(self):
        run_id = self._open_run()
        self._write_handoff(run_id, [self._delta(run_id)])
        reconcile.capture("proj", run_id)
        with open(reconcile.queue_path("proj"), "a", encoding="utf-8",
                  newline="\n") as handle:
            handle.write("{corrupt line\n")
        result = reconcile.route("proj")
        self.assertTrue(result["rendered"])
        self.assertEqual([i["line"] for i in result["invalid"]], [2])
        doc = Path(result["path"]).read_text(encoding="utf-8")
        self.assertIn("never silently dropped", doc)

    # ------------------- AC1: the hooks — wrapper finish, cancel, session

    def test_finish_captures_handoff_deltas(self):
        run_id = self._open_run()
        self._write_handoff(run_id, [self._delta(run_id)])
        ended = jobrun.finish(self.root, run_id, "complete")
        self.assertEqual(ended["capture"]["captured"], 1)
        self.assertEqual(len(self._queue_lines()), 1)
        summary = json.loads(
            (joblib.workspace_path("proj", run_id) / "summary.json")
            .read_text(encoding="utf-8"))
        self.assertEqual(summary["capture"]["captured"], 1)

    def test_cancel_captures_too_corrections_outlive_the_run(self):
        run_id = self._open_run()
        self._write_handoff(run_id, [self._delta(run_id)])
        jobrun.cancel(self.root, "long-work", run_id)
        self.assertEqual(len(self._queue_lines()), 1)

    def test_capture_failure_never_masks_finish(self):
        run_id = self._open_run()
        workspace = joblib.workspace_path("proj", run_id)
        (workspace / "handoff.json").write_bytes(b"\xff\xfenot json")
        ended = jobrun.finish(self.root, run_id, "complete")
        self.assertEqual(ended["state"], "complete")
        self.assertIn("errors", ended["capture"])

    def test_boundary_handoff_captures_before_the_next_overwrites_it(self):
        run_id = self._open_run()
        self._write_seed(run_id)
        first = session.write_handoff(
            self.root, run_id, "phase", "survey",
            ["surveyed"], ["verify"], deltas=[self._delta(run_id)])
        self.assertEqual(first["capture"]["captured"], 1)
        # the next boundary overwrites handoff.json with different deltas —
        # the first boundary's correction is already durable
        session.write_handoff(
            self.root, run_id, "phase", "verify", ["verified"], ["finish"],
            deltas=[self._delta(run_id, anchor=f"SEED-{run_id}-A2",
                                reality="it drops unknown keys",
                                evidence="lib/backlogmd.py:1")])
        jobrun.finish(self.root, run_id, "complete")
        anchors = {line["anchor"] for line in self._queue_lines()}
        self.assertEqual(anchors,
                         {f"SEED-{run_id}-A1", f"SEED-{run_id}-A2"})

    def test_handoff_without_deltas_skips_capture(self):
        run_id = self._open_run()
        result = session.write_handoff(
            self.root, run_id, "phase", "quiet", ["done"], ["next"])
        self.assertNotIn("capture", result)
        self.assertFalse(reconcile.queue_path("proj").is_file())

    def test_duplicate_deltas_in_one_handoff_are_a_named_rejection(self):
        # the 9.2 review's deferred dedupe finding, folded in here
        run_id = self._open_run()
        self._write_seed(run_id)
        with self.assertRaises(session.SessionError) as ctx:
            session.write_handoff(
                self.root, run_id, "phase", "dupes", ["d"], ["n"],
                deltas=[self._delta(run_id), self._delta(run_id)])
        self.assertIn("same correction", str(ctx.exception))
        # a same-anchor delta with a different reality is NOT a duplicate
        result = session.write_handoff(
            self.root, run_id, "phase", "ok", ["d"], ["n"],
            deltas=[self._delta(run_id),
                    self._delta(run_id, reality="a distinct claim")])
        self.assertEqual(result["capture"]["captured"], 2)

    # --------------- AC3: e2e — the run the source lifecycle never had

    def test_e2e_run_emits_deltas_queue_materializes_routing_renders(self):
        # a research-flavored run: seed lands, findings cite it, boundaries
        # carry corrections, the wrapper closes the run — then the queue
        # holds the corrections and the routing doc renders them
        run_id = self._open_run()
        research.emit_seed(self.root, run_id,
                           self.SEED.format(run_id=run_id))
        session.write_handoff(
            self.root, run_id, "story", "ST-9.4",
            ["capture built"], ["route the queue"],
            deltas=[self._delta(run_id),
                    self._delta(run_id, anchor="SPINE-A1", verdict="STALE",
                                reality="the pin moved to 6.10.0",
                                evidence="bmad.lock", tier="spine")])
        ended = jobrun.finish(self.root, run_id, "complete")
        self.assertEqual(ended["capture"]["duplicates"], 2)  # boundary won
        lines = self._queue_lines()
        self.assertEqual(len(lines), 2)
        routed = reconcile.route("proj")
        self.assertTrue(routed["rendered"])
        doc = Path(routed["path"]).read_text(encoding="utf-8")
        self.assertIn("[SPINE-A1]", doc)
        self.assertIn(f"[SEED-{run_id}-A1]", doc)
        self.assertLess(doc.index("Spine corrections"),
                        doc.index("Run-local corrections"))

    # ---------------------------------------------------------------- CLI

    def _cli(self, *argv: str) -> tuple[int, dict]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = reconcile.main(list(argv))
        return code, json.loads(out.getvalue())

    def test_cli_capture_and_route(self):
        run_id = self._open_run()
        self._write_handoff(run_id, [self._delta(run_id)])
        code, out = self._cli("capture", "--directory", str(self.root),
                              "--run-id", run_id)
        self.assertEqual(code, 0)
        self.assertEqual(out["captured"], 1)
        code, out = self._cli("route", "--directory", str(self.root))
        self.assertEqual(code, 0)
        self.assertTrue(out["rendered"])

    def test_cli_refusals_are_named(self):
        code, out = self._cli("capture", "--directory", str(self.root),
                              "--run-id", "ghost-run")
        self.assertEqual(code, 2)
        self.assertIn("no workspace", out["error"])


if __name__ == "__main__":
    unittest.main()
