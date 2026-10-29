"""Tests for the playable judge's deterministic core (Story 34.3, AC3).

The model is never run: the answer the judge session would write is a JSON
file these tests author. They cover the rubric parsing, `judge.json`, and
every named refusal (no report.json, a malformed report, no frames, an
unknown rubric id, a frame not in frames[], a fail with no findings, a
malformed answer), each ending `blocked` with exit 2 and the AD-11 block.
"""
from __future__ import annotations

import contextlib
import io
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import playable_judge  # noqa: E402

BLOCK_KEYS = ["status", "intent", "artifacts", "reason"]


def _report(**over) -> dict:
    report = {
        "schema": 1, "verdict": "pass", "failed": None, "seed": 7, "ticks": 60,
        "ticks_run": 60, "capture_every": 30, "mode": "movie",
        "frames": [{"tick": 0, "file": "frames/tick-000000.png"},
                   {"tick": 30, "file": "frames/tick-000030.png"}],
        "moments": [{"name": "jump", "tick": 30, "frame": "frames/tick-000030.png"}],
        "frame_time_ms": {"max": 20.0, "mean": 16.6},
        "log_errors": [], "run": {"exit": 0},
    }
    report.update(over)
    return report


class JudgeCoreTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.media = Path(self._tmp.name) / "playable"
        (self.media / "frames").mkdir(parents=True)

    def tearDown(self):
        self._tmp.cleanup()

    def _media(self, report: dict | str | None = None, frames=("tick-000000.png", "tick-000030.png")):
        for name in frames:
            (self.media / "frames" / name).write_bytes(b"\x89PNG\r\n")
        if report is not None:
            text = report if isinstance(report, str) else json.dumps(report)
            (self.media / "report.json").write_text(text, encoding="utf-8")

    def _answer(self, answer) -> str:
        path = Path(self._tmp.name) / "answer.json"
        path.write_text(answer if isinstance(answer, str) else json.dumps(answer), encoding="utf-8")
        return str(path)

    def _cli(self, *argv: str) -> tuple[int, dict]:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = playable_judge.main(list(argv))
        return code, json.loads(buf.getvalue())

    def _assert_refused(self, code: int, out: dict, reason: str) -> None:
        self.assertEqual(code, 2, out)
        self.assertEqual(list(out)[-4:], BLOCK_KEYS)
        self.assertEqual(out["status"], "blocked")
        self.assertEqual(out["intent"], "tk-studio-playable-judge")
        self.assertFalse(out["ok"])
        self.assertIn(reason, out["reason"])
        self.assertFalse((self.media / "judge.json").exists())

    # ---------------------------------------------------------------- rubric

    def test_rubric_ids_are_the_story_five(self):
        self.assertEqual(playable_judge.RUBRIC_IDS, (
            "scene-loaded", "player-visible", "no-magenta-or-error-overlay",
            "hud-reads", "moments-shown"))

    def test_rubric_verb_prints_the_ids_and_lines_in_a_complete_block(self):
        # Story 35.3: the one home of the ids, read by the host leg.
        code, out = self._cli("rubric")
        self.assertEqual(code, 0, out)
        self.assertEqual(list(out)[-4:], BLOCK_KEYS)
        self.assertEqual((out["status"], out["intent"], out["artifacts"], out["reason"]),
                         ("complete", "tk-studio-playable-judge", [], None))
        self.assertTrue(out["ok"])
        self.assertEqual(out["ids"], list(playable_judge.RUBRIC_IDS))
        self.assertEqual(out["rubric"], [{"id": rid, "line": line}
                                         for rid, line in playable_judge.RUBRIC])

    def test_rubric_ids_are_pinned_to_the_skill_table_and_the_contract(self):
        # Story 35.3: the skill's table (parsed) and the contract's 34.3 sentence name the core's ids, in order.
        plugin = Path(__file__).resolve().parents[2]
        skill = (plugin / "skills" / "tk-studio-playable-judge" / "SKILL.md").read_text(encoding="utf-8")
        table = skill[skill.index("| id | rubric line |"):]
        rows = []
        for line in table.splitlines()[2:]:
            m = re.match(r"\s*\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|\s*$", line)
            if not m:
                break
            rows.append((m.group(1), m.group(2)))
        self.assertEqual(tuple(rid for rid, _ in rows), playable_judge.RUBRIC_IDS)
        self.assertEqual(tuple(rows), playable_judge.RUBRIC)
        contract = (plugin / "contracts" / "driver-contract.md").read_text(encoding="utf-8")
        start = contract.index("answers the fixed rubric (") + len("answers the fixed rubric (")
        named = re.findall(r"`([^`]+)`", contract[start:contract.index(")", start)])
        self.assertEqual(tuple(named), playable_judge.RUBRIC_IDS)

    def test_prepare_prints_frames_moments_and_rubric(self):
        self._media(_report())
        code, out = self._cli("prepare", "--media", str(self.media))
        self.assertEqual(code, 0, out)
        self.assertEqual(list(out)[-4:], BLOCK_KEYS)
        self.assertEqual(out["status"], "complete")
        self.assertEqual(out["intent"], "tk-studio-playable-judge")
        self.assertIsNone(out["reason"])
        self.assertEqual([f["file"] for f in out["frames"]],
                         ["frames/tick-000000.png", "frames/tick-000030.png"])
        self.assertEqual(out["moments"][0]["name"], "jump")
        self.assertEqual([r["id"] for r in out["rubric"]], list(playable_judge.RUBRIC_IDS))
        self.assertTrue(all(r["line"] for r in out["rubric"]))

    def test_verdict_pass_writes_judge_json(self):
        self._media(_report())
        code, out = self._cli("verdict", "--media", str(self.media),
                              "--answer", self._answer({"verdict": "pass", "findings": []}))
        self.assertEqual(code, 0, out)
        self.assertEqual(out["status"], "complete")
        self.assertEqual(out["artifacts"], ["judge.json"])
        judged = json.loads((self.media / "judge.json").read_text(encoding="utf-8"))
        self.assertEqual(judged["verdict"], "pass")
        self.assertEqual(judged["findings"], [])
        self.assertEqual(judged["rubric"], list(playable_judge.RUBRIC_IDS))
        self.assertEqual(judged["frames"], ["frames/tick-000000.png", "frames/tick-000030.png"])
        self.assertEqual(judged["report_verdict"], "pass")
        self.assertEqual(list(self.media.glob("*.tmp")), [])  # atomic: no temp left

    def test_verdict_fail_parses_findings_each_naming_frame_and_rubric(self):
        self._media(_report())
        answer = {"verdict": "fail", "findings": [
            {"frame": "frames/tick-000030.png", "rubric": "no-magenta-or-error-overlay",
             "note": "magenta  quad\non the floor"},
            {"frame": "frames/tick-000000.png", "rubric": "hud-reads"},
        ]}
        code, out = self._cli("verdict", "--media", str(self.media), "--answer", self._answer(answer))
        self.assertEqual(code, 0, out)
        self.assertEqual(out["verdict"], "fail")
        judged = json.loads((self.media / "judge.json").read_text(encoding="utf-8"))
        self.assertEqual(judged["findings"], [
            {"frame": "frames/tick-000030.png", "rubric": "no-magenta-or-error-overlay",
             "note": "magenta quad on the floor"},
            {"frame": "frames/tick-000000.png", "rubric": "hud-reads"},
        ])

    def test_answer_findings_default_to_empty_on_pass(self):
        self._media(_report())
        code, out = self._cli("verdict", "--media", str(self.media),
                              "--answer", self._answer({"verdict": "pass"}))
        self.assertEqual(code, 0, out)
        self.assertEqual(out["findings"], [])

    # ------------------------------------------------------------- refusals

    def test_refuses_no_report_json(self):
        self._media(None)
        for argv in (("prepare", "--media", str(self.media)),
                     ("verdict", "--media", str(self.media), "--answer", self._answer({"verdict": "pass"}))):
            code, out = self._cli(*argv)
            self._assert_refused(code, out, "no report.json")

    def test_refuses_a_malformed_report(self):
        cases = [
            ("{not json", "malformed report: report.json is not JSON"),
            ("[1, 2]", "malformed report: report.json is not a JSON object"),
            (_report(verdict="maybe"), "malformed report: verdict"),
            (_report(frames="frames/"), "malformed report: frames"),
            (_report(frames=[{"tick": 0}]), "malformed report: frames[0].file"),
            (_report(moments=[{"tick": 3}]), "malformed report: moments[0]"),
        ]
        for key in playable_judge.REPORT_KEYS:
            r = _report()
            del r[key]
            cases.append((r, f"malformed report: {key}"))
        for report, reason in cases:
            with self.subTest(reason=reason):
                self._media(report)
                code, out = self._cli("prepare", "--media", str(self.media))
                self._assert_refused(code, out, reason)

    def test_refuses_no_frames(self):
        self._media(_report(frames=[]), frames=())
        code, out = self._cli("prepare", "--media", str(self.media))
        self._assert_refused(code, out, "no frames")
        # a frame the report names but the folder lacks
        self._media(_report(frames=[{"tick": 0, "file": "frames/gone.png"}]), frames=())
        code, out = self._cli("prepare", "--media", str(self.media))
        self._assert_refused(code, out, "no frames: frames/gone.png")
        # a frame outside the media folder never counts
        self._media(_report(frames=[{"tick": 0, "file": "../answer.json"}]), frames=())
        self._answer({"verdict": "pass"})
        code, out = self._cli("prepare", "--media", str(self.media))
        self._assert_refused(code, out, "no frames")

    def test_verdict_refusals(self):
        self._media(_report())
        cases = [
            ({"verdict": "fail", "findings": [{"frame": "frames/tick-000000.png", "rubric": "looks-fun"}]},
             "unknown rubric id: looks-fun"),
            ({"verdict": "fail", "findings": [{"frame": "frames/tick-999999.png", "rubric": "hud-reads"}]},
             "frame not in frames[]: frames/tick-999999.png"),
            ({"verdict": "fail", "findings": []}, "fail with no findings"),
            ({"verdict": "fail"}, "fail with no findings"),
            ("not json at all", "malformed answer"),
            (["pass"], "malformed answer: not a JSON object"),
            ({"verdict": "ok"}, "malformed answer: verdict"),
            ({"verdict": "pass", "findings": {}}, "malformed answer: findings"),
            ({"verdict": "fail", "findings": ["x"]}, "malformed answer: findings[0]"),
            ({"verdict": "fail", "findings": [{"rubric": "hud-reads"}]}, "malformed answer: findings[0].frame"),
            ({"verdict": "fail", "findings": [{"frame": "frames/tick-000000.png"}]}, "malformed answer: findings[0].rubric"),
            ({"verdict": "fail", "findings": [{"frame": "frames/tick-000000.png", "rubric": "hud-reads", "note": 3}]},
             "malformed answer: findings[0].note"),
        ]
        for answer, reason in cases:
            with self.subTest(reason=reason):
                code, out = self._cli("verdict", "--media", str(self.media), "--answer", self._answer(answer))
                self._assert_refused(code, out, reason)

    def test_missing_answer_file_is_malformed_answer(self):
        self._media(_report())
        code, out = self._cli("verdict", "--media", str(self.media),
                              "--answer", str(Path(self._tmp.name) / "none.json"))
        self._assert_refused(code, out, "malformed answer")

    def test_bad_invocation_is_a_blocked_block(self):
        code, out = self._cli("verdict", "--media", str(self.media))
        self._assert_refused(code, out, "bad invocation")



class DriveBoundsTests(unittest.TestCase):
    """The e2e drive's own worst case (every core call, the install and the
    suite each spent to its bound) sits below the runner's drive timeout and
    its manifest entry's, so the drive's own timeouts always fire first."""

    def test_worst_case_below_the_runner_and_manifest_timeouts(self):
        conformance = Path(__file__).resolve().parents[2] / "contracts" / "conformance"
        sys.path.insert(0, str(conformance))
        try:
            import e2e_playable_verify as drive  # noqa: E402
            import runner  # noqa: E402
        finally:
            sys.path.remove(str(conformance))
        worst = drive.CORE_CALLS * drive.CORE_BOUND_S + drive.INSTALL_BOUND_S + drive.BOUND_S
        self.assertEqual(drive.RUNNER_BOUND_S, runner.DEFAULT_TIMEOUT)
        self.assertLess(worst, runner.DEFAULT_TIMEOUT)
        manifest = json.loads((conformance / "manifest.json").read_text(encoding="utf-8"))
        entry = next(d for d in manifest["surfaces"]["tk-studio-playable-judge"]["drives"]
                     if d["argv"] == ["contracts/conformance/e2e_playable_verify.py"])
        self.assertLess(worst, entry.get("timeout", runner.DEFAULT_TIMEOUT))
        # The core makes exactly CORE_CALLS judge calls, each under CORE_BOUND_S.
        real, calls = drive._core, []
        drive._core = lambda *argv: (calls.append(argv), real(*argv))[1]
        try:
            steps = drive.core_steps()
        finally:
            drive._core = real
        self.assertTrue(all(step["ok"] for step in steps), steps)
        self.assertEqual(len(calls), drive.CORE_CALLS)

    def _supervisor_drive(self, module: str):
        conformance = Path(__file__).resolve().parents[2] / "contracts" / "conformance"
        sys.path.insert(0, str(conformance))
        try:
            drive = __import__(module)
            import runner  # noqa: E402
        finally:
            sys.path.remove(str(conformance))
        manifest = json.loads((conformance / "manifest.json").read_text(encoding="utf-8"))
        entries = [d for surface in manifest["surfaces"].values() for d in surface.get("drives", [])
                   if d.get("argv", [None])[0] == f"contracts/conformance/{module}.py"]
        self.assertEqual(len(entries), 1, module)
        return drive, entries[0].get("timeout", runner.DEFAULT_TIMEOUT), runner

    def test_story_35_3_engine_gate_and_vertical_slice_bounds_below_their_manifest_timeouts(self):
        # Story 35.3 (DW-70): both bun-suite drives' worst case (the install and the suite each spent to its bound)
        # sits below the manifest entry's `timeout`, read from manifest.json (never a copy), which raises the
        # runner's 60 s cap; each drive's own copy of that timeout matches it.
        for module in ("e2e_engine_gate", "e2e_vertical_slice"):
            with self.subTest(drive=module):
                drive, timeout, runner = self._supervisor_drive(module)
                worst = drive.BOUND_S + drive.INSTALL_BOUND_S
                self.assertGreater(worst, runner.DEFAULT_TIMEOUT)  # so the manifest raises the cap
                self.assertLess(worst, timeout)
                self.assertEqual(drive.MANIFEST_TIMEOUT_S, timeout)


if __name__ == "__main__":
    unittest.main()
