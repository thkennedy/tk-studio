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
from unittest import mock

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
    """Every bun-suite drive's bound derives from its manifest entry's `timeout` through
    `_budget.py` (Story 36.4, DW-112, hole 97), so the drive's own timeouts always fire
    before the runner's, and no drive carries a copy of the timeout."""

    BUN_DRIVES = ("e2e_engine_gate", "e2e_vertical_slice", "e2e_run_sweep", "e2e_paused_exits", "e2e_playable_verify")

    def _conformance(self, module: str):
        conformance = Path(__file__).resolve().parents[2] / "contracts" / "conformance"
        sys.path.insert(0, str(conformance))
        try:
            return __import__(module), conformance
        finally:
            sys.path.remove(str(conformance))

    def test_worst_case_below_the_runner_and_manifest_timeouts(self):
        drive, conformance = self._conformance("e2e_playable_verify")
        runner, _ = self._conformance("runner")
        budget, _ = self._conformance("_budget")
        worst = drive.CORE_CALLS * drive.CORE_BOUND_S + drive.INSTALL_BOUND_S + drive.BOUND_S
        manifest = json.loads((conformance / "manifest.json").read_text(encoding="utf-8"))
        entry = next(d for d in manifest["surfaces"]["tk-studio-playable-judge"]["drives"]
                     if d["argv"] == ["contracts/conformance/e2e_playable_verify.py"])
        # hole 97: runner.py honours the manifest timeout over DEFAULT_TIMEOUT, and the worst case
        # sits under it by the helper's headroom
        self.assertGreater(entry["timeout"], runner.DEFAULT_TIMEOUT)
        self.assertEqual(worst + budget.HEADROOM_S, entry["timeout"])
        # The core makes exactly CORE_CALLS judge calls, each under CORE_BOUND_S.
        real, calls = drive._core, []
        drive._core = lambda *argv: (calls.append(argv), real(*argv))[1]
        try:
            steps = drive.core_steps()
        finally:
            drive._core = real
        self.assertTrue(all(step["ok"] for step in steps), steps)
        self.assertEqual(len(calls), drive.CORE_CALLS)

    def test_every_bun_suite_drive_bound_derives_from_its_manifest_timeout(self):
        budget, conformance = self._conformance("_budget")
        runner, _ = self._conformance("runner")
        found = {path.stem for path in conformance.glob("e2e_*.py")
                 if 'shutil.which("bun")' in path.read_text(encoding="utf-8")}
        self.assertEqual(found, set(self.BUN_DRIVES))  # a new bun drive joins this list and the helper
        manifest = json.loads((conformance / "manifest.json").read_text(encoding="utf-8"))
        for module in self.BUN_DRIVES:
            with self.subTest(drive=module):
                drive, _ = self._conformance(module)
                self.assertIn("from _budget import suite_bound", (conformance / f"{module}.py").read_text(encoding="utf-8"))
                entries = [d for surface in manifest["surfaces"].values() for d in surface.get("drives", [])
                           if d.get("argv", [None])[0] == f"contracts/conformance/{module}.py"]
                self.assertEqual(len(entries), 1)
                other = getattr(drive, "CORE_CALLS", 0) * getattr(drive, "CORE_BOUND_S", 0) + getattr(drive, "TRIAGE_WAIT_S", 0)
                self.assertEqual(drive.BOUND_S, entries[0]["timeout"] - drive.INSTALL_BOUND_S - other - budget.HEADROOM_S)
                self.assertGreater(entries[0]["timeout"], runner.DEFAULT_TIMEOUT)  # so the manifest raises the cap

    def test_a_multi_file_suite_raises_bun_s_per_test_timeout_by_the_flag(self):
        # on bun 1.4.3 the preload default reaches only a run's first file, so a later file's tests
        # get above bun's 5 s only through the flag
        _, conformance = self._conformance("_budget")
        multi_file = []
        for module in self.BUN_DRIVES:
            drive, _ = self._conformance(module)
            if len(getattr(drive, "SUITES", [])) > 1:
                multi_file.append(module)
                with self.subTest(drive=module):
                    self.assertGreater(int(drive.TEST_TIMEOUT_MS), 5000)
                    self.assertIn('"--timeout", TEST_TIMEOUT_MS', (conformance / f"{module}.py").read_text(encoding="utf-8"))
        # guard the guard: the walk must keep reading the real multi-file drives
        self.assertLessEqual({"e2e_paused_exits", "e2e_vertical_slice"}, set(multi_file))

    def _budget_over(self, manifest: dict):
        budget, _ = self._conformance("_budget")
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "manifest.json"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        patcher = mock.patch.object(budget, "MANIFEST_PATH", path)
        patcher.start()
        self.addCleanup(patcher.stop)
        return budget

    def test_budget_reads_the_manifest_entry_with_headroom(self):
        budget = self._budget_over({"surfaces": {"s": {"drives": [
            {"assertion": "a"}, {"argv": ["contracts/conformance/e2e_x.py"], "timeout": 300}]}}})
        self.assertEqual(budget.HEADROOM_S, 15)
        self.assertEqual(budget.suite_bound("e2e_x.py", install_s=40), 245)
        self.assertEqual(budget.suite_bound("e2e_x.py", install_s=12, other_s=16), 257)
        self.assertEqual(budget.suite_bound("e2e_x.py", install_s=40, headroom_s=0), 260)

    def test_run_sweep_bound_counts_its_triage_wait(self):
        budget, conformance = self._conformance("_budget")
        drive, _ = self._conformance("e2e_run_sweep")
        manifest = json.loads((conformance / "manifest.json").read_text(encoding="utf-8"))
        entries = [d for surface in manifest["surfaces"].values() for d in surface.get("drives", [])
                   if d.get("argv", [None])[0] == "contracts/conformance/e2e_run_sweep.py"]
        self.assertEqual(len(entries), 1)
        self.assertEqual(drive.TRIAGE_WAIT_S, 5)
        self.assertEqual(drive.BOUND_S, entries[0]["timeout"] - drive.INSTALL_BOUND_S - drive.TRIAGE_WAIT_S - budget.HEADROOM_S)

    def test_budget_refuses_a_bound_that_is_not_positive(self):
        budget = self._budget_over({"surfaces": {"s": {"drives": [
            {"argv": ["contracts/conformance/e2e_x.py"], "timeout": 60}]}}})
        self.assertEqual(budget.suite_bound("e2e_x.py", install_s=44), 1)
        for install_s in (45, 100):  # exactly zero, then below it
            with self.subTest(install_s=install_s), self.assertRaisesRegex(ValueError, "e2e_x.py"):
                budget.suite_bound("e2e_x.py", install_s=install_s)

    def test_budget_falls_back_to_the_runner_default(self):
        runner, _ = self._conformance("runner")
        budget = self._budget_over({"surfaces": {"s": {"drives": [
            {"argv": ["contracts/conformance/e2e_no_timeout.py"]}]}}})
        for script in ("e2e_absent.py", "e2e_no_timeout.py"):
            with self.subTest(script=script):
                self.assertEqual(budget.suite_bound(script, install_s=10), runner.DEFAULT_TIMEOUT - 10 - budget.HEADROOM_S)

    def test_budget_has_no_main(self):
        # test_utf8_guard demands the stdout guard of any conformance module with a main()
        budget, _ = self._conformance("_budget")
        self.assertFalse(hasattr(budget, "main"))


if __name__ == "__main__":
    unittest.main()
