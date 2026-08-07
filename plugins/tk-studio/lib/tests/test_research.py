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

    # ------------------------------------- anchors + seed + spine (ST-9.3)

    def _wake(self) -> str:
        self._instantiate()
        return jobrun.wake(self.root, "research-ecosystem")["run_id"]

    def _seed_text(self, run_id: str, inherits: tuple[str, ...] = (),
                   project: str = "proj", run_id_field: str | None = None,
                   anchors: tuple[str, ...] = ("A1",)) -> str:
        lines = [
            "---",
            "tier: seed",
            "status: provisional",
            "authority: mission-scoped-supersedes-canonical",
            f"project: {project}",
            "generated: 2026-08-07",
            f"run_id: {run_id_field if run_id_field is not None else run_id}",
            f"spine_ref: projects/{project}/knowledge/spine.md",
        ]
        if inherits:
            lines.append("inherits: [" + ", ".join(inherits) + "]")
        lines.append("---")
        lines.append("")
        for suffix in anchors:
            lines.append(f"- [SEED-{run_id}-{suffix}] wrapper accounts "
                         "turns per wake. **C**")
        return "\n".join(lines) + "\n"

    def _spine_text(self, project: str = "proj",
                    anchors: tuple[str, ...] = ("A1", "A2")) -> str:
        body = "\n".join(f"- [SPINE-{a}] invariant {a}. **A**"
                         for a in anchors)
        return ("---\n"
                "tier: spine\n"
                "status: provisional\n"
                "authority: mission-scoped-supersedes-canonical\n"
                f"project: {project}\n"
                "generated: 2026-08-07\n"
                "---\n\n" + body + "\n")

    def test_finding_anchor_must_be_a_bare_anchor_id(self):
        run_id = "r-1"
        good = dict(FINDING, anchor=f"SEED-{run_id}-A1")
        research.validate_findings([good])
        for bad in ("", "[SPINE-A1]", "not-an-anchor", 7):
            with self.assertRaises(research.ResearchError):
                research.validate_findings([dict(FINDING, anchor=bad)])

    def test_anchored_finding_without_a_seed_refuses_named(self):
        run_id = self._wake()
        anchored = dict(FINDING, anchor=f"SEED-{run_id}-A1")
        with self.assertRaisesRegex(research.ResearchError,
                                    "no seed.md|dangling"):
            research.record(self.root, run_id, [anchored])
        # aid, not gate: the run is untouched and unanchored findings land
        result = research.record(self.root, run_id, [FINDING])
        self.assertEqual(result["anchored"], 0)
        self.assertFalse(result["spine"]["present"])

    def test_seed_lands_and_anchored_findings_cite_it(self):
        run_id = self._wake()
        landed = research.emit_seed(self.root, run_id,
                                    self._seed_text(run_id))
        self.assertEqual(landed["anchors"], [f"SEED-{run_id}-A1"])
        self.assertFalse(landed["spine"]["present"])
        self.assertFalse(landed["inherits_verified"])
        workspace = joblib.workspace_path("proj", run_id)
        self.assertTrue((workspace / "seed.md").is_file())
        anchored = dict(FINDING, anchor=f"SEED-{run_id}-A1")
        result = research.record(self.root, run_id, [anchored, SPECULATIVE])
        self.assertEqual(result["anchored"], 1)
        self.assertIn(f"`SEED-{run_id}-A1`",
                      (workspace / "findings.md").read_text(encoding="utf-8"))
        dangling = dict(FINDING, anchor=f"SEED-{run_id}-A9")
        with self.assertRaisesRegex(research.ResearchError, "dangling"):
            research.record(self.root, run_id, [dangling])

    def test_seed_cross_checks_refuse_named(self):
        run_id = self._wake()
        cases = (
            self._seed_text(run_id, run_id_field="other-run"),
            self._seed_text(run_id).replace(
                f"[SEED-{run_id}-A1]", "[SEED-foreign-run-A1]"),
            # ownership is an exact match, not a prefix: an id whose middle
            # merely BEGINS with the run id belongs to another namespace
            self._seed_text(run_id).replace(
                f"[SEED-{run_id}-A1]", f"[SEED-{run_id}-A1-bogus-A9]"),
            self._spine_text(),  # tier: spine never lands in a workspace
            "no frontmatter at all",
        )
        for text in cases:
            with self.assertRaises(research.ResearchError):
                research.emit_seed(self.root, run_id, text)
        # the project cross-check, pinned independently of spine_ref
        mismatched = self._seed_text(run_id, project="ghost").replace(
            "projects/ghost/knowledge/spine.md",
            "projects/proj/knowledge/spine.md")
        with self.assertRaisesRegex(research.ResearchError,
                                    "does not match project"):
            research.emit_seed(self.root, run_id, mismatched)
        self.assertFalse(
            (joblib.workspace_path("proj", run_id) / "seed.md").is_file())

    def test_seed_inherits_verified_against_the_spine(self):
        run_id = self._wake()
        research.emit_spine(self.root, run_id, self._spine_text())
        landed = research.emit_seed(
            self.root, run_id, self._seed_text(run_id, inherits=("SPINE-A1",)))
        self.assertTrue(landed["inherits_verified"])
        self.assertTrue(landed["spine"]["present"])
        with self.assertRaisesRegex(research.ResearchError, "SPINE-A9"):
            research.emit_seed(self.root, run_id,
                               self._seed_text(run_id,
                                               inherits=("SPINE-A9",)))
        # an inherited spine anchor is citable by findings
        seeded = dict(FINDING, anchor="SPINE-A1")
        result = research.record(self.root, run_id, [seeded])
        self.assertEqual(result["anchored"], 1)
        self.assertTrue(result["spine"]["present"])

    def test_seed_reemission_is_append_only(self):
        run_id = self._wake()
        research.emit_seed(self.root, run_id, self._seed_text(run_id))
        with self.assertRaisesRegex(research.ResearchError, "append-only"):
            research.emit_seed(self.root, run_id,
                               self._seed_text(run_id, anchors=("A2",)))
        grown = research.emit_seed(
            self.root, run_id, self._seed_text(run_id, anchors=("A1", "A2")))
        self.assertEqual(len(grown["anchors"]), 2)

    def test_spine_lands_at_project_scope_and_is_append_only(self):
        run_id = self._wake()
        landed = research.emit_spine(self.root, run_id, self._spine_text())
        expected = self.store / "projects" / "proj" / "knowledge" / "spine.md"
        self.assertEqual(Path(landed["path"]), expected)
        self.assertTrue(expected.is_file())
        self.assertEqual(landed["appended"], ["SPINE-A1", "SPINE-A2"])
        with self.assertRaisesRegex(research.ResearchError, "append-only"):
            research.emit_spine(self.root, run_id,
                                self._spine_text(anchors=("A1",)))
        grown = research.emit_spine(
            self.root, run_id, self._spine_text(anchors=("A1", "A2", "A3")))
        self.assertEqual(grown["appended"], ["SPINE-A3"])
        self.assertTrue(grown["replaced_existing"])

    def test_spine_frontmatter_mentions_define_nothing(self):
        # A frontmatter note citing [SPINE-A1] is prose, not a definition:
        # it must neither wedge the append-only check on re-emission nor
        # satisfy a seed's inherits.
        run_id = self._wake()
        phantom = self._spine_text(anchors=("A2",)).replace(
            "generated: 2026-08-07",
            "generated: 2026-08-07\n"
            "note: supersedes the old [SPINE-A1] wording")
        first = research.emit_spine(self.root, run_id, phantom)
        self.assertEqual(first["anchors"], ["SPINE-A2"])
        again = research.emit_spine(self.root, run_id, phantom)
        self.assertEqual(again["appended"], [])
        with self.assertRaisesRegex(research.ResearchError, "SPINE-A1"):
            research.emit_seed(self.root, run_id,
                               self._seed_text(run_id,
                                               inherits=("SPINE-A1",)))

    def test_spine_authoring_rides_the_chartered_run_gate(self):
        run_id = self._wake()
        with self.assertRaisesRegex(research.ResearchError, "ghost"):
            research.emit_spine(self.root, run_id,
                                self._spine_text(project="ghost"))
        # a charter-less run never authors the spine (invariant 3: scope
        # approval precedes the spend) — but it may still land a seed
        # (any run's handoff deltas need one)
        defn = joblib.load_types()["maintenance-conformance"]["definition"]
        bare = joblib.create_run(defn, "proj")["run_id"]
        with self.assertRaisesRegex(research.ResearchError, "no charter"):
            research.emit_spine(self.root, bare, self._spine_text())
        research.emit_seed(self.root, bare, self._seed_text(bare))
        jobrun.finish(self.root, run_id, "complete", status_block={
            "status": "complete", "intent": "tk-studio-research",
            "artifacts": [], "reason": None})
        with self.assertRaisesRegex(research.ResearchError, "already ended"):
            research.emit_spine(self.root, run_id, self._spine_text())

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

    def test_cli_seed_and_spine(self):
        run_id = self._wake()
        # the conformance drive: intrinsic invalidity refuses before any
        # run lookup, so a ghost run still yields the named marker
        code, out = self._cli("seed", "--directory", str(self.root),
                              "--run-id", "ghost-run",
                              "--text", "no frontmatter at all")
        self.assertEqual(code, 2)
        self.assertIn("frontmatter", out["error"])
        code, out = self._cli("seed", "--directory", str(self.root),
                              "--run-id", run_id)
        self.assertEqual(code, 2)  # exactly one of --text/--file
        seed_file = Path(self._tmp.name) / "seed-input.md"
        seed_file.write_text(self._seed_text(run_id), encoding="utf-8")
        code, out = self._cli("seed", "--directory", str(self.root),
                              "--run-id", run_id, "--file", str(seed_file))
        self.assertEqual(code, 0)
        self.assertTrue(out["ok"])
        code, out = self._cli("spine", "--directory", str(self.root),
                              "--run-id", run_id, "--text", self._spine_text())
        self.assertEqual(code, 0)
        self.assertEqual(out["anchors"], ["SPINE-A1", "SPINE-A2"])


if __name__ == "__main__":
    unittest.main()
