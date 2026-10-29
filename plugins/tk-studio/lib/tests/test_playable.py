"""Tests for the playable runner (Story 34.2, AC3).

The engine is a fake: `playable.run_engine` is injected with a callable
that reads `--playable-out=` from the argv it receives and writes a
harness-style `report.json` and frames there, as the `PlayableHarness`
template does, so nothing starts Godot. One test runs the real
`run_engine` against a sleeping Python child to prove the wall clock
kills an overrun. The C# template cannot be compiled here: its test reads
the text for the user args, the report keys and the inertness check.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import re
import sys
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import launch  # noqa: E402
import playable  # noqa: E402

LIB = Path(__file__).resolve().parents[1]
TEMPLATE = LIB / "godot" / "PlayableHarness.cs"
EXAMPLE = LIB / "godot" / "scenario.example.json"
BLOCK_KEYS = ["status", "intent", "artifacts", "reason"]

SCENARIO = {
    "schema": 1,
    "capture_every": 5,
    "inputs": [{"tick": 2, "action": "ui_right"}],
    "invariants": [
        {"name": "player exists", "kind": "node_exists", "path": "/root/Main/Player"},
        {"name": "no errors", "kind": "no_error_log"},
    ],
    "moments": [{"name": "start", "tick": 0}],
}


def _alive(pid: int) -> bool:
    """``pid`` runs (a zombie awaiting a reaper counts as gone)."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    try:
        stat = Path(f"/proc/{pid}/stat").read_text()
        return stat.rsplit(")", 1)[1].split()[0] != "Z"
    except (OSError, IndexError):
        return True


def _arg(argv: list[str], prefix: str) -> str:
    return next(a[len(prefix):] for a in argv if a.startswith(prefix))


class FakeEngine:
    """A harness-style fake: writes report.json (unless told not to) and
    frames into --playable-out, logs `log` then (as a real harness does as
    it detaches its logger) the end marker unless `marker` is False, then
    `after_marker` (shutdown lines), and returns `code`."""

    def __init__(self, *, verdict: str | None = "pass", code: int | None = 0,
                 failed: dict | None = None, log: str = "booted\n", timed_out: bool = False,
                 raw_report: str | None = None, write_frames: bool = True,
                 frames: list | None = None, mode: str = "movie",
                 marker: bool = True, after_marker: str = ""):
        self.verdict, self.code, self.failed = verdict, code, failed
        self.marker, self.after_marker = marker, after_marker
        self.mode = mode
        self.log, self.timed_out, self.raw_report = log, timed_out, raw_report
        self.write_frames, self.frames_override = write_frames, frames
        self.calls: list[dict] = []

    def __call__(self, argv, *, cwd, log_path, timeout_s):
        self.calls.append({"argv": list(argv), "cwd": cwd, "log_path": log_path,
                           "timeout_s": timeout_s,
                           "pngs_at_start": sorted(p.name for p in
                                                   (Path(_arg(argv, playable.ARG_OUT)) / "frames").glob("*.png"))})
        out = Path(_arg(argv, playable.ARG_OUT))
        ticks = int(_arg(argv, playable.ARG_TICKS))
        log = self.log
        if self.marker:
            log += playable.HARNESS_DETACHED + "\n"
        Path(log_path).write_text(log + self.after_marker, encoding="utf-8")
        frames = []
        for tick in range(0, ticks, 5):
            name = f"frames/{tick:06d}.png"
            if self.write_frames:
                (out / name).write_bytes(b"\x89PNG")
            frames.append({"tick": tick, "file": name})
        if self.frames_override is not None:
            frames = self.frames_override
        if self.raw_report is not None:
            (out / "report.json").write_text(self.raw_report, encoding="utf-8")
        elif self.verdict is not None:
            report = {"schema": 1, "verdict": self.verdict, "failed": self.failed,
                      "seed": int(_arg(argv, playable.ARG_SEED)), "ticks": ticks,
                      "ticks_run": ticks, "capture_every": 5, "mode": self.mode,
                      "frames": frames,
                      "moments": [{"name": "start", "tick": 0, "frame": "frames/000000.png"}],
                      "frame_time_ms": {"max": 4.2, "mean": 2.0}}
            (out / "report.json").write_text(json.dumps(report), encoding="utf-8")
        return self.code, self.timed_out, 1234


class PlayableTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.godot = self.tmp / "Godot_v4.7.2-stable_mono_win64_console.exe"
        self.godot.write_bytes(b"")
        self.env = {"GODOT": f"  {self.godot}  "}
        self.project = self.tmp / "tua"
        (self.project / "game").mkdir(parents=True)
        (self.project / "game" / "project.godot").write_text(
            "[application]\n\n[autoload]\n\n" + playable.HARNESS_AUTOLOAD_LINE + "\n",
            encoding="utf-8")
        self.scenario = self.tmp / "scenario.json"
        self.scenario.write_text(json.dumps(SCENARIO), encoding="utf-8")
        self.out = self.tmp / "out"
        self._orig = playable.run_engine

    def tearDown(self):
        playable.run_engine = self._orig
        self._tmp.cleanup()

    def _run(self, fake=None, **kw):
        if fake is not None:
            playable.run_engine = fake
        args = dict(directory=str(self.project), scenario=str(self.scenario), seed="7",
                    ticks="20", out=str(self.out), env=self.env)
        args.update(kw)
        return playable.run(**args)

    def _report(self) -> dict:
        return json.loads((self.out / "report.json").read_text(encoding="utf-8"))

    def _blocked(self, result, code, *needles):
        self.assertEqual(code, 2)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(list(result)[-4:], BLOCK_KEYS)
        self.assertEqual(result["artifacts"], [])
        for needle in needles:
            self.assertIn(needle, result["reason"])
        self.assertFalse((self.out / "log.txt").exists(), "nothing started")

    # ---- argv

    def test_argv_per_mode(self):
        out = self.out.resolve()
        tail = ["--", f"--playable-scenario={self.scenario.resolve()}", "--playable-seed=7",
                "--playable-ticks=20", f"--playable-out={out}"]
        want = {
            "display": ["--windowed", "--fixed-fps", "60"],
            "movie": ["--write-movie", str(out / "frames" / "movie.png"), "--fixed-fps", "60"],
            "headless": ["--headless", "--fixed-fps", "60"],
        }
        for mode, flags in want.items():
            with self.subTest(mode=mode):
                fake = FakeEngine()
                result, code = self._run(fake, mode=mode)
                self.assertEqual(code, 0, result)
                argv = fake.calls[0]["argv"]
                self.assertEqual(argv, [str(self.godot), "--path",
                                        str((self.project / "game").resolve()), *flags, *tail])
                self.assertEqual(fake.calls[0]["cwd"], (self.project / "game").resolve())
                self.assertEqual(fake.calls[0]["timeout_s"], 120.0)
                self.assertEqual(self._report()["run"]["argv"], argv)

    def test_default_mode_is_the_ruled_path_shared_with_launch(self):
        self.assertIn(playable.PLAYABLE_PATH, playable.MODES)
        self.assertEqual(playable.PLAYABLE_PATH, launch.PLAYABLE_PATH)
        fake = FakeEngine()
        result, _ = self._run(fake)
        self.assertEqual(result["mode"], playable.PLAYABLE_PATH)

    def test_godot_flag_wins_over_env_and_project_dir_itself(self):
        other = self.tmp / "other.exe"
        other.write_bytes(b"")
        fake = FakeEngine()
        result, code = self._run(fake, godot=str(other),
                                 directory=str(self.project / "game"), wall_clock="5")
        self.assertEqual(code, 0, result)
        self.assertEqual(fake.calls[0]["argv"][0], str(other))
        self.assertEqual(fake.calls[0]["argv"][2], str((self.project / "game").resolve()))
        self.assertEqual(fake.calls[0]["timeout_s"], 5.0)
        self.assertEqual(self._report()["run"]["godot"], str(other))

    # ---- refusals: nothing starts

    def test_engine_refusals_name_godot(self):
        missing = str(self.tmp / "nope.exe")
        for env, needle in (({}, "GODOT is unset"), ({"GODOT": "  "}, "GODOT is unset"),
                            ({"GODOT": "godot"}, "GODOT godot is not an absolute path"),
                            ({"GODOT": missing}, f"GODOT names {missing}, which does not exist"),
                            ({"GODOT": str(self.tmp)}, "which is not a file")):
            with self.subTest(env=env):
                fake = FakeEngine()
                result, code = self._run(fake, env=env)
                self._blocked(result, code, needle)
                self.assertEqual(fake.calls, [])

    def test_project_refusals(self):
        empty = self.tmp / "empty"
        empty.mkdir()
        result, code = self._run(FakeEngine(), directory=str(empty))
        self._blocked(result, code, "no project.godot")
        two = self.tmp / "two"
        for name in ("a", "b"):
            (two / name).mkdir(parents=True)
            (two / name / "project.godot").write_text("", encoding="utf-8")
        result, code = self._run(FakeEngine(), directory=str(two))
        self._blocked(result, code, "several project.godot candidates", "a", "b")

    def test_project_without_the_harness_autoload_is_refused(self):
        godot_file = self.project / "game" / "project.godot"
        for text in ("[application]\nconfig/name=\"TUA\"\n",
                     "[autoload]\nOther=\"*res://other.gd\"\n\n[application]\n"
                     + playable.HARNESS_AUTOLOAD_LINE + "\n"):
            with self.subTest(text=text):
                godot_file.write_text(text, encoding="utf-8")
                fake = FakeEngine()
                result, code = self._run(fake)
                self._blocked(result, code, "PlayableHarness", "[autoload]",
                              "playable-verify-on-the-box.md", str(godot_file))
                self.assertEqual(fake.calls, [])
                self.assertFalse(self.out.exists(), "--out untouched")

    def test_project_with_an_unreadable_project_godot_is_refused(self):
        # Portable stand-in for an unreadable file (chmod fails on Windows and as root):
        # only project.godot's read raises; every other read goes to the real method.
        godot_file = (self.project / "game" / "project.godot").resolve()
        real_read_text = Path.read_text

        def read_text(path, *args, **kwargs):
            if path.resolve() == godot_file:
                raise PermissionError(13, "Permission denied", str(path))
            return real_read_text(path, *args, **kwargs)

        fake = FakeEngine()
        with mock.patch.object(Path, "read_text", autospec=True, side_effect=read_text):
            result, code = self._run(fake)
        self._blocked(result, code, "project.godot", "unreadable", "Permission denied")
        self.assertEqual(fake.calls, [])
        self.assertFalse(self.out.exists(), "--out untouched")

    def test_project_with_the_harness_autoload_in_a_crlf_file_proceeds(self):
        godot_file = self.project / "game" / "project.godot"
        godot_file.write_bytes(("\ufeff[application]\r\nconfig/name=\"TUA\"\r\n\r\n"
                                "[autoload]\r\n\r\nOther=\"*res://other.gd\"\r\n"
                                + playable.HARNESS_AUTOLOAD_LINE + "\r\n").encode("utf-8"))
        fake = FakeEngine()
        result, code = self._run(fake)
        self.assertEqual(code, 0, result)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(len(fake.calls), 1)

    def test_bad_args(self):
        for kw, needle in (({"seed": "-1"}, "--seed -1 must be >= 0"),
                           ({"seed": "x"}, "--seed 'x' is not an int"),
                           ({"ticks": "0"}, "--ticks 0 must be > 0"),
                           ({"wall_clock": "0"}, "--wall-clock 0 must be a finite number of seconds > 0"),
                           ({"mode": "vr"}, "--mode 'vr'")):
            with self.subTest(kw=kw):
                result, code = self._run(FakeEngine(), **kw)
                self._blocked(result, code, needle)

    def test_bad_scenario_names_the_field(self):
        cases = [
            ({**SCENARIO, "schema": 2}, "schema must be 1"),
            ({k: v for k, v in SCENARIO.items() if k != "inputs"}, "inputs is missing"),
            ({k: v for k, v in SCENARIO.items() if k != "invariants"}, "invariants is missing"),
            ({**SCENARIO, "inputs": [{"action": "a"}]}, "inputs[0].tick"),
            ({**SCENARIO, "inputs": [{"tick": 1}]}, "inputs[0].action"),
            ({**SCENARIO, "inputs": [{"tick": 1, "action": "a", "strength": 2}]}, "inputs[0].strength"),
            ({**SCENARIO, "invariants": [{"name": "n", "kind": "teleports"}]},
             "invariants[0].kind 'teleports'"),
            ({**SCENARIO, "invariants": [{"name": "n", "kind": "node_exists"}]}, "invariants[0].path"),
            ({**SCENARIO, "invariants": [{"kind": "no_error_log"}]}, "invariants[0].name"),
            ({**SCENARIO, "capture_every": 0}, "capture_every"),
            ({**SCENARIO, "scene": "Main.tscn"}, "scene must be a res:// path"),
            ({**SCENARIO, "random_inputs": {"actions": [], "every": 3}}, "random_inputs.actions"),
            ({**SCENARIO, "moments": [{"name": "m"}]}, "moments[0].tick"),
        ]
        for doc, needle in cases:
            with self.subTest(needle=needle):
                self.scenario.write_text(json.dumps(doc), encoding="utf-8")
                result, code = self._run(FakeEngine())
                self._blocked(result, code, needle, "scenario")
        self.scenario.write_text("{not json", encoding="utf-8")
        result, code = self._run(FakeEngine())
        self._blocked(result, code, "unreadable")
        result, code = self._run(FakeEngine(), scenario=str(self.tmp / "absent.json"))
        self._blocked(result, code, "not found")

    def test_example_scenario_validates(self):
        doc = playable.load_scenario(EXAMPLE)
        kinds = {inv["kind"] for inv in doc["invariants"]}
        self.assertEqual(kinds, set(playable.INVARIANT_KINDS))

    # ---- verdicts

    def test_harness_pass_is_complete_with_run_and_log_errors_merged(self):
        result, code = self._run(FakeEngine())
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "complete")
        self.assertIsNone(result["reason"])
        self.assertTrue(result["ok"])
        report = self._report()
        self.assertEqual(report["verdict"], "pass")
        self.assertEqual(report["log_errors"], [])
        self.assertEqual(list(report["run"]), list(playable.RUN_KEYS))
        self.assertEqual(report["run"]["exit"], 0)
        self.assertEqual(report["run"]["duration_ms"], 1234)
        self.assertFalse(report["run"]["timed_out"])
        self.assertEqual(report["run"]["wall_clock_s"], 120.0)
        for key in playable.REPORT_KEYS + playable.RUNNER_KEYS:
            self.assertIn(key, report)
        self.assertEqual(report["frames"][0], {"tick": 0, "file": "frames/000000.png"})
        self.assertTrue((self.out / "frames" / "000000.png").is_file())
        self.assertEqual(list(self.out.glob("*.tmp")), [])

    def test_harness_fail_names_the_invariant_and_tick(self):
        failed = {"tick": 12, "invariant": "player exists", "detail": "no node at /root/Main/Player"}
        result, code = self._run(FakeEngine(verdict="fail", code=1, failed=failed))
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["reason"],
                         "player exists failed at tick 12: no node at /root/Main/Player")
        self.assertEqual(self._report()["failed"], failed)

    def test_no_report_is_a_harness_fail_the_runner_writes(self):
        result, code = self._run(FakeEngine(verdict=None, code=134))
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "partial")
        report = self._report()
        self.assertEqual(report["failed"], {"invariant": "harness", "detail": "no report.json (exit 134)"})
        self.assertEqual(report["verdict"], "fail")
        self.assertEqual(report["seed"], 7)
        self.assertEqual(report["moments"], [{"name": "start", "tick": 0, "frame": None}])
        for key in playable.REPORT_KEYS + playable.RUNNER_KEYS:
            self.assertIn(key, report)
        self.assertIn("harness", result["reason"])

    def test_unreadable_report_is_a_harness_fail(self):
        result, code = self._run(FakeEngine(raw_report="{half", code=0))
        self.assertEqual(code, 1)
        self.assertEqual(self._report()["failed"]["invariant"], "harness")
        self.assertIn("report.json unreadable", result["reason"])

    def test_stale_report_from_an_earlier_run_never_counts(self):
        (self.out / "frames").mkdir(parents=True)
        (self.out / "report.json").write_text(json.dumps({"verdict": "pass"}), encoding="utf-8")
        result, code = self._run(FakeEngine(verdict=None, code=0))
        self.assertEqual(code, 1)
        self.assertEqual(self._report()["failed"]["detail"], "no report.json (exit 0)")

    def test_wall_clock_overrun_is_a_wall_clock_fail(self):
        result, code = self._run(FakeEngine(verdict=None, code=None, timed_out=True), wall_clock="3")
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "partial")
        report = self._report()
        self.assertEqual(report["failed"], {"invariant": "wall-clock", "detail": "3s exceeded"})
        self.assertTrue(report["run"]["timed_out"])
        self.assertIsNone(report["run"]["exit"])
        self.assertEqual(result["reason"], "wall-clock: 3s exceeded")

    def test_exit_and_verdict_mismatches_fail(self):
        result, code = self._run(FakeEngine(verdict="pass", code=1))
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "partial")
        self.assertIn("report verdict pass but exit 1", result["reason"])
        failed = {"tick": 3, "invariant": "no errors", "detail": "x"}
        result, code = self._run(FakeEngine(verdict="fail", code=0, failed=failed))
        self.assertEqual(code, 1)
        self.assertIn("report verdict fail but exit 0", result["reason"])
        self.assertIn("no errors failed at tick 3", result["reason"])

    def test_log_errors_scan_fails_a_pass_with_a_no_error_log_invariant(self):
        log = "boot\n" + "".join(f"ERROR: thing {i}\n" for i in range(25)) + "  SCRIPT ERROR: oops\n"
        result, code = self._run(FakeEngine(log=log))
        self.assertEqual(code, 1)
        report = self._report()
        self.assertEqual(len(report["log_errors"]), 20)
        self.assertEqual(report["log_errors"][0], "ERROR: thing 0")
        self.assertEqual(report["failed"], {"invariant": "no errors",
                                            "detail": "error line in the log: ERROR: thing 0"})
        self.assertIn("no errors", result["reason"])

    def test_log_errors_without_the_invariant_are_reported_not_failed(self):
        doc = {**SCENARIO, "invariants": [SCENARIO["invariants"][0]]}
        self.scenario.write_text(json.dumps(doc), encoding="utf-8")
        result, code = self._run(FakeEngine(log="SCRIPT ERROR: oops\nfine\n"))
        self.assertEqual(code, 0, result)
        self.assertEqual(self._report()["log_errors"], ["SCRIPT ERROR: oops"])

    def test_plain_stderr_line_never_fails_no_error_log(self):
        # what printerr("boom") prints: no ERROR: / SCRIPT ERROR: prefix
        guard = {**SCENARIO, "invariants": [SCENARIO["invariants"][0],
                                            {"name": "no errors", "kind": "no_error_log",
                                             "from_tick": 0}]}
        self.scenario.write_text(json.dumps(guard), encoding="utf-8")
        result, code = self._run(FakeEngine(log="booted\nboom\n"))
        self.assertEqual(code, 0, result)
        self.assertEqual(result["status"], "complete")
        report = self._report()
        self.assertEqual(report["verdict"], "pass")
        self.assertIsNone(report["failed"])
        self.assertEqual(report["log_errors"], [])

    def _guard_from_tick_0(self):
        guard = {**SCENARIO, "invariants": [SCENARIO["invariants"][0],
                                            {"name": "no errors", "kind": "no_error_log",
                                             "from_tick": 0}]}
        self.scenario.write_text(json.dumps(guard), encoding="utf-8")

    def test_error_lines_after_the_end_marker_never_fail_a_pass(self):
        self._guard_from_tick_0()
        shutdown = "ERROR: Resources still in use at exit\n"
        result, code = self._run(FakeEngine(log="booted\n", after_marker=shutdown))
        self.assertEqual(code, 0, result)
        self.assertEqual(result["status"], "complete")
        report = self._report()
        self.assertEqual(report["verdict"], "pass")
        self.assertEqual(report["log_errors"], ["ERROR: Resources still in use at exit"])

    def test_error_lines_before_the_end_marker_fail_and_are_cited(self):
        self._guard_from_tick_0()
        result, code = self._run(FakeEngine(
            log="ERROR: during the run\n",
            after_marker="ERROR: Resources still in use at exit\n"))
        self.assertEqual(code, 1, result)
        report = self._report()
        self.assertEqual(report["failed"], {"invariant": "no errors",
                                            "detail": "error line in the log: ERROR: during the run"})
        self.assertEqual(report["log_errors"], ["ERROR: during the run",
                                                "ERROR: Resources still in use at exit"])
        # the cited line is the pre-marker one even when shutdown lines fill the list
        log = self.tmp / "log.txt"
        log.write_text(playable.HARNESS_DETACHED + "\n"
                       + "".join(f"ERROR: late {i}\n" for i in range(30)), encoding="utf-8")
        errors, guard = playable.scan_log_split(log)
        self.assertEqual(len(errors), playable.MAX_LOG_ERRORS)
        self.assertEqual(guard, [])

    def test_without_the_end_marker_the_whole_log_counts(self):
        self._guard_from_tick_0()
        result, code = self._run(FakeEngine(log="booted\nERROR: Resources still in use at exit\n",
                                            marker=False))
        self.assertEqual(code, 1, result)
        self.assertEqual(self._report()["failed"]["detail"],
                         "error line in the log: ERROR: Resources still in use at exit")

    def test_marker_and_plain_lines_are_not_error_lines(self):
        self.assertIsNone(playable.ERROR_LINE.match(playable.HARNESS_DETACHED))
        self.assertIsNone(playable.ERROR_LINE.match("booted"))
        self.assertIsNone(playable.ERROR_LINE.match("PlayableHarness: report.json not written: x"))

    def test_shader_error_lines_are_collected_and_fail_the_guard(self):
        self._guard_from_tick_0()
        line = "SHADER ERROR: Expected expression, found: ')'."
        result, code = self._run(FakeEngine(log=f"booted\n  {line}\n"))
        self.assertEqual(code, 1, result)
        report = self._report()
        self.assertEqual(report["log_errors"], [line])
        self.assertEqual(report["failed"]["detail"], f"error line in the log: {line}")

    # ---- the status block

    def test_status_block_last_in_order_with_out_relative_artifacts(self):
        for fake in (FakeEngine(), FakeEngine(verdict="fail", code=1,
                                              failed={"invariant": "x", "detail": "y"})):
            result, _ = self._run(fake)
            self.assertEqual(list(result)[-4:], BLOCK_KEYS)
            self.assertEqual(result["intent"], "playable")
            self.assertEqual(result["artifacts"], ["report.json", "log.txt", "frames/"])
            for artifact in result["artifacts"]:
                self.assertFalse(os.path.isabs(artifact))
                self.assertTrue((self.out / artifact).exists())

    def test_cli_refusal_and_bad_invocation_end_blocked_exit_2(self):
        empty = self.tmp / "empty"
        empty.mkdir()
        old = os.environ.get("GODOT")
        os.environ["GODOT"] = str(self.godot)
        try:
            for argv in (["run", "--directory", str(empty), "--scenario", str(EXAMPLE),
                          "--seed", "1", "--ticks", "10", "--out", str(self.out)],
                         ["run", "--directory", str(empty)]):
                with self.subTest(argv=argv):
                    buf = io.StringIO()
                    with contextlib.redirect_stdout(buf):
                        code = playable.main(argv)
                    result = json.loads(buf.getvalue())
                    self.assertEqual(code, 2)
                    self.assertEqual(result["status"], "blocked")
                    self.assertEqual(list(result)[-4:], BLOCK_KEYS)
        finally:
            if old is None:
                os.environ.pop("GODOT", None)
            else:
                os.environ["GODOT"] = old

    # ---- the real wall clock

    def test_run_engine_kills_an_overrun(self):
        self.out.mkdir()
        log = self.out / "log.txt"
        started = time.monotonic()
        code, timed_out, duration_ms = playable.run_engine(
            [sys.executable, "-c", "print('hello', flush=True); import time; time.sleep(30)"],
            cwd=self.tmp, log_path=log, timeout_s=1)
        self.assertLess(time.monotonic() - started, 10)
        self.assertIsNone(code)
        self.assertTrue(timed_out)
        self.assertLess(duration_ms, 10000)
        self.assertIn("hello", log.read_text(encoding="utf-8"))

    def test_run_engine_returns_the_exit_and_streams_stderr(self):
        log = self.tmp / "log.txt"
        code, timed_out, _ = playable.run_engine(
            [sys.executable, "-c", "import sys; sys.stderr.write('ERROR: e\\n'); sys.exit(3)"],
            cwd=self.tmp, log_path=log, timeout_s=30)
        self.assertEqual((code, timed_out), (3, False))
        self.assertEqual(playable.scan_log(log), ["ERROR: e"])

    # ---- review patches

    def test_bounds_past_the_harness_parse_types_are_refused(self):
        for kw, needle in (({"seed": str(2**64)}, f"--seed {2**64} exceeds {2**64 - 1}"),
                           ({"ticks": str(2**31)}, f"--ticks {2**31} exceeds {2**31 - 1}")):
            with self.subTest(kw=kw):
                result, code = self._run(FakeEngine(), **kw)
                self._blocked(result, code, needle)
        fake = FakeEngine()
        result, code = self._run(fake, seed=str(2**64 - 1), ticks="20",
                                 out=str(self.tmp / "max-seed-out"))
        self.assertEqual(code, 0, result)
        self.assertIn(f"--playable-seed={2**64 - 1}", fake.calls[0]["argv"])
        big = 2**31
        cases = [
            ({**SCENARIO, "capture_every": big}, "capture_every"),
            ({**SCENARIO, "inputs": [{"tick": big, "action": "a"}]}, "inputs[0].tick"),
            ({**SCENARIO, "inputs": [{"tick": 1, "action": "a", "hold_ticks": big}]},
             "inputs[0].hold_ticks"),
            ({**SCENARIO, "random_inputs": {"actions": ["a"], "every": big}}, "random_inputs.every"),
            ({**SCENARIO, "invariants": [{"name": "n", "kind": "no_error_log", "from_tick": big}]},
             "invariants[0].from_tick"),
            ({**SCENARIO, "moments": [{"name": "m", "tick": big}]}, "moments[0].tick"),
        ]
        for doc, field in cases:
            with self.subTest(field=field):
                self.scenario.write_text(json.dumps(doc), encoding="utf-8")
                result, code = self._run(FakeEngine())
                self._blocked(result, code, f"{field} {big} exceeds {big - 1}", "int32")
        ok = {**SCENARIO, "inputs": [{"tick": big - 1, "action": "a", "hold_ticks": big - 1}]}
        self.assertEqual(playable.validate_scenario(ok), ok)

    def test_out_inside_the_godot_project_is_refused(self):
        game = self.project / "game"
        for out in (game, game / "playable-out", game / "a" / "b"):
            with self.subTest(out=out):
                fake = FakeEngine()
                result, code = playable.run(directory=str(self.project), scenario=str(self.scenario),
                                            seed="1", ticks="10", out=str(out), env=self.env)
                self.assertEqual(code, 2)
                self.assertEqual(result["status"], "blocked")
                self.assertIn("--out", result["reason"])
                self.assertIn("inside the Godot project", result["reason"])
                self.assertEqual(fake.calls, [])
                self.assertFalse((out / "log.txt").exists())
        # beside the project (its parent's other folder) is fine
        result, code = self._run(FakeEngine(), out=str(self.project / "game-out"))
        self.assertEqual(code, 0, result)

    def test_earlier_frames_are_removed_before_the_run_and_nothing_else(self):
        frames = self.out / "frames"
        (frames / "keep").mkdir(parents=True)
        (frames / "movie00000099.png").write_bytes(b"old")
        (frames / "notes.txt").write_text("keep", encoding="utf-8")
        (frames / "keep" / "deep.png").write_bytes(b"keep")
        (self.out / "beside.png").write_bytes(b"keep")
        fake = FakeEngine()
        result, code = self._run(fake)
        self.assertEqual(code, 0, result)
        self.assertEqual(fake.calls[0]["pngs_at_start"], [])
        self.assertFalse((frames / "movie00000099.png").exists())
        self.assertTrue((frames / "notes.txt").is_file())
        self.assertTrue((frames / "keep" / "deep.png").is_file())
        self.assertTrue((self.out / "beside.png").is_file())

    def test_a_pass_without_frames_fails_in_display_and_movie(self):
        cases = (
            ({"frames": []}, "the report names no frames"),
            ({"write_frames": False}, "frame file frames/000000.png does not exist"),
            ({"frames": [{"tick": 0, "file": "../escape.png"}]}, "frame file ../escape.png"),
        )
        (self.tmp / "escape.png").write_bytes(b"x")
        for mode in ("display", "movie"):
            for kw, needle in cases:
                with self.subTest(mode=mode, kw=kw):
                    result, code = self._run(FakeEngine(**kw), mode=mode)
                    self.assertEqual(code, 1, result)
                    self.assertEqual(result["status"], "partial")
                    failed = self._report()["failed"]
                    self.assertEqual(failed["invariant"], "frames")
                    self.assertIn(needle, failed["detail"])
                    self.assertIn(f"{mode} mode", failed["detail"])
                    self.assertTrue(result["reason"].startswith("frames: "))
        # headless renders nothing by design
        for kw, _ in cases:
            with self.subTest(mode="headless", kw=kw):
                result, code = self._run(FakeEngine(**kw), mode="headless")
                self.assertEqual(code, 0, result)

    def test_a_display_pass_whose_last_capture_was_dropped_fails_frames(self):
        # the harness said pass and quit 0, but the last capture's PNG never landed
        frames = [{"tick": t, "file": f"frames/{t:06d}.png"} for t in (0, 5, 10, 15)]
        frames_dir = self.out / "frames"

        class Dropped(FakeEngine):
            def __call__(self, argv, **kw):
                result = super().__call__(argv, **kw)
                (frames_dir / "000015.png").unlink()
                return result

        fake = Dropped(verdict="pass", code=0, mode="display", frames=frames)
        result, code = self._run(fake, mode="display")
        self.assertEqual(code, 1, result)
        self.assertEqual(result["status"], "partial")
        failed = self._report()["failed"]
        self.assertEqual(failed["invariant"], "frames")
        self.assertIn("frames/000015.png", failed["detail"])
        self.assertTrue((frames_dir / "000010.png").is_file())

    def test_host_log_scan_only_overrides_a_guard_watching_from_tick_0(self):
        log = "ERROR: boot noise before the harness attached\n"
        late = {**SCENARIO, "invariants": [SCENARIO["invariants"][0],
                                           {"name": "no errors later", "kind": "no_error_log",
                                            "from_tick": 10}]}
        self.scenario.write_text(json.dumps(late), encoding="utf-8")
        result, code = self._run(FakeEngine(log=log))
        self.assertEqual(code, 0, result)
        report = self._report()
        self.assertEqual(report["verdict"], "pass")
        self.assertEqual(report["log_errors"], ["ERROR: boot noise before the harness attached"])
        # one guard from tick 0 (explicit) beside the late one: the override applies, naming it
        both = {**late, "invariants": late["invariants"] + [
            {"name": "no errors at all", "kind": "no_error_log", "from_tick": 0}]}
        self.scenario.write_text(json.dumps(both), encoding="utf-8")
        result, code = self._run(FakeEngine(log=log))
        self.assertEqual(code, 1, result)
        self.assertEqual(self._report()["failed"]["invariant"], "no errors at all")

    @unittest.skipIf(os.name == "nt", "the process-group kill is the POSIX path")
    def test_run_engine_kills_the_grandchild_too(self):
        self.out.mkdir()
        log = self.out / "log.txt"
        pid_file = self.tmp / "grandchild.pid"
        child = (
            "import subprocess, sys, time\n"
            "g = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
            f"open({str(pid_file)!r}, 'w').write(str(g.pid))\n"
            "time.sleep(60)\n"
        )
        started = time.monotonic()
        code, timed_out, _ = playable.run_engine([sys.executable, "-c", child], cwd=self.tmp,
                                                 log_path=log, timeout_s=3)
        self.assertLess(time.monotonic() - started, 15)
        self.assertTrue(timed_out)
        self.assertIsNone(code)
        self.assertTrue(pid_file.is_file(), "the child started its grandchild before the kill")
        gpid = int(pid_file.read_text())
        deadline = time.monotonic() + 5
        while _alive(gpid) and time.monotonic() < deadline:
            time.sleep(0.05)
        if _alive(gpid):  # never leave it behind, then fail
            os.kill(gpid, 9)
            self.fail(f"grandchild {gpid} survived the overrun kill")

    @unittest.skipUnless(os.name == "nt", "the taskkill /T /F path is the Windows path (the operator runs it on the host)")
    def test_kill_tree_on_nt_kills_the_child_and_the_grandchild(self):
        # Story 35.3: real processes, the real `taskkill /T /F` — never mocked here.
        pid_file = self.tmp / "grandchild.pid"
        child = (
            "import subprocess, sys, time\n"
            "g = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
            f"open({str(pid_file)!r}, 'w').write(str(g.pid))\n"
            "time.sleep(60)\n"
        )
        proc = subprocess.Popen([sys.executable, "-c", child], stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 15
        while not (pid_file.is_file() and pid_file.read_text().strip()) and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertTrue(pid_file.is_file(), "the child started its grandchild")
        gpid = int(pid_file.read_text())

        def nt_alive(pid: int) -> bool:
            done = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True,
                                  text=True, timeout=10, check=False)
            return str(pid) in done.stdout

        self.assertTrue(playable.kill_tree(proc))
        self.assertIsNotNone(proc.poll(), "the child is gone")
        deadline = time.monotonic() + 10
        while nt_alive(gpid) and time.monotonic() < deadline:
            time.sleep(0.1)
        if nt_alive(gpid):  # never leave it behind, then fail
            subprocess.run(["taskkill", "/F", "/PID", str(gpid)], capture_output=True, check=False)
            self.fail(f"grandchild {gpid} survived kill_tree")

    def test_template_review_patches(self):
        text = TEMPLATE.read_text(encoding="utf-8")
        # 1: warnings never count
        self.assertIn("if (errorType == ErrorTypeWarning)", text)
        self.assertIn("ErrorTypeWarning = 1", text)
        # 2: a random press never shortens a hold
        self.assertIn("if (!_releaseAt.ContainsKey(action))", text)
        # 3: ticks start once the scenario's scene is current, bounded
        self.assertIn("GetTree().CurrentScene?.SceneFilePath != _awaitScene", text)
        self.assertIn("SceneWaitFrames", text)
        self.assertIn('["invariant"] = "scene"', text)
        # 9: the physics-rate precondition
        self.assertIn("physics_ticks_per_second", text)
        kb = (LIB.parents[2] / "kb" / "playable-verify-on-the-box.md").read_text(encoding="utf-8")
        self.assertIn("physics_ticks_per_second", kb)
        # 10: no tick ran, ticks_run 0
        self.assertIn('["ticks_run"] = failed == null ? _tick : _ticking ? _tick + 1 : 0', text)
        # 11: the parse types the runner bounds
        self.assertIn("ulong.TryParse(arg.Substring(ArgSeed.Length)", text)
        self.assertIn("int.TryParse(arg.Substring(ArgTicks.Length)", text)

    # ---- second review pass

    def test_wall_clock_must_be_finite_and_bounded(self):
        over = playable.MAX_WALL_CLOCK_S + 1
        for raw in ("inf", "-inf", "nan", str(over), "1e10"):
            with self.subTest(raw=raw):
                fake = FakeEngine()
                result, code = self._run(fake, wall_clock=raw)
                self._blocked(result, code, "--wall-clock", str(playable.MAX_WALL_CLOCK_S))
                self.assertEqual(fake.calls, [])
        result, code = self._run(FakeEngine(), wall_clock=str(playable.MAX_WALL_CLOCK_S))
        self.assertEqual(code, 0, result)

    def test_schema_must_be_the_int_1(self):
        for raw in ("true", "1.0"):
            with self.subTest(schema=raw):
                text = json.dumps({**SCENARIO, "schema": 0}).replace('"schema": 0',
                                                                     f'"schema": {raw}')
                self.scenario.write_text(text, encoding="utf-8")
                result, code = self._run(FakeEngine())
                self._blocked(result, code, "schema must be 1", "scenario")

    def test_non_finite_json_numbers_are_refused_before_the_start(self):
        base = json.dumps({**SCENARIO, "frame_budget_ms": 33.3})
        for bad in ("NaN", "Infinity", "-Infinity", "1e999"):
            with self.subTest(bad=bad):
                self.scenario.write_text(base.replace("33.3", bad), encoding="utf-8")
                fake = FakeEngine()
                result, code = self._run(fake)
                self._blocked(result, code, "scenario", bad)
                self.assertEqual(fake.calls, [])
        strength = json.dumps({**SCENARIO, "inputs": [{"tick": 1, "action": "a",
                                                       "strength": 0.5}]})
        self.scenario.write_text(strength.replace("0.5", "-1e999"), encoding="utf-8")
        result, code = self._run(FakeEngine())
        self._blocked(result, code, "scenario", "not finite")

    def test_report_write_failure_ends_partial_with_the_block(self):
        def fail(path, data):
            raise OSError("locked")
        with mock.patch.object(playable, "_write_atomic", fail):
            result, code = self._run(FakeEngine())
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "partial")
        self.assertFalse(result["ok"])
        self.assertEqual(list(result)[-4:], BLOCK_KEYS)
        self.assertEqual(result["reason"], "report.json not written: locked")
        self.assertNotIn("report.json", result["artifacts"])

    def test_unconfirmed_tree_kill_is_named_in_the_wall_clock_detail(self):
        class Proc:
            pid = 4242
            killed = waited = False

            def kill(self):
                self.killed = True

            def wait(self, timeout=None):
                self.waited = True
                return -9

        # Windows: taskkill exit non-zero, then the plain kill
        with mock.patch.object(playable.os, "name", "nt"), \
                mock.patch.object(playable.subprocess, "run",
                                  return_value=subprocess.CompletedProcess([], 128)) as run:
            proc = Proc()
            self.assertFalse(playable.kill_tree(proc))
            self.assertTrue(proc.killed and proc.waited)
            self.assertEqual(run.call_args[0][0][:4], ["taskkill", "/T", "/F", "/PID"])
        with mock.patch.object(playable.os, "name", "nt"), \
                mock.patch.object(playable.subprocess, "run",
                                  return_value=subprocess.CompletedProcess([], 0)):
            self.assertTrue(playable.kill_tree(Proc()))
        with mock.patch.object(playable.os, "name", "nt"), \
                mock.patch.object(playable.subprocess, "run",
                                  side_effect=subprocess.TimeoutExpired("taskkill", 10)):
            self.assertFalse(playable.kill_tree(Proc()))
        if os.name != "nt":
            with mock.patch.object(playable.os, "killpg", side_effect=ProcessLookupError):
                self.assertFalse(playable.kill_tree(Proc()))
            with mock.patch.object(playable.os, "killpg"):
                self.assertTrue(playable.kill_tree(Proc()))

        # the flag run_engine leaves reaches the wall-clock detail
        def overrun(argv, *, cwd, log_path, timeout_s):
            Path(log_path).write_text("", encoding="utf-8")
            playable.LAST_TREE_KILL_CONFIRMED = False
            return None, True, 3000
        result, code = self._run(overrun, wall_clock="3")
        self.assertEqual(code, 1)
        self.assertEqual(self._report()["failed"],
                         {"invariant": "wall-clock",
                          "detail": "3s exceeded (process tree kill not confirmed)"})
        self.assertEqual(result["reason"], "wall-clock: 3s exceeded (process tree kill not confirmed)")
        # the next run starts with the flag reset
        result, code = self._run(FakeEngine(verdict=None, code=None, timed_out=True), wall_clock="3")
        self.assertEqual(self._report()["failed"]["detail"], "3s exceeded")

    def test_template_second_review_patches(self):
        text = TEMPLATE.read_text(encoding="utf-8")
        physics = self._method_body(text, "public override void _PhysicsProcess(")
        # 1: the last tick gets one more invariant pass before the finish
        self.assertIn("_finalCheck = true;", physics)
        self.assertNotIn("Finish(null)", physics)
        final = self._method_body(text, "private void FinalCheck(")
        self.assertIn("int last = _ticks - 1;", final)
        self.assertIn("if (inv.FromTick > last)", final)
        self.assertIn('["tick"] = last', final)
        self.assertIn("Finish(null);", final)
        self.assertNotIn("ApplyInputs", final)
        self.assertNotIn("Capture()", final)
        self.assertNotIn("_tick++", final)
        # 2 and 3: quit (and the display report) wait for one more drawn frame
        self.assertIn("RenderingServer.FramePostDraw += OnFramePostDraw;", text)
        finish = self._method_body(text, "private void Finish(")
        self.assertNotIn("GetTree().Quit(", finish)
        self.assertIn("_quitPending = true;", finish)
        self.assertIn("_done = true;", finish)
        self.assertIn("confirm the offset on the box", text)
        capture = self._method_body(text, "private void Capture(")
        self.assertNotIn("GetImage()", capture)
        self.assertIn("_pendingCaptures.Add(_tick);", capture)
        take = self._method_body(text, "private void TakePendingCaptures(")
        self.assertIn("GetViewport().GetTexture()?.GetImage()", take)
        self.assertIn('$"frames/{tick:D6}.png"', take)
        self.assertIn("DrawWaitFrames", physics)
        # a display capture still pending when the draw wait runs out fails `frames`
        wait = self._method_body(physics, "if (_quitPending && ++_drawWait > DrawWaitFrames)")
        pending = self._method_body(
            wait, 'if (_mode == "display" && _pendingCaptures.Count > 0 && _failed == null)')
        self.assertIn('["invariant"] = "frames"', pending)
        self.assertIn("_pendingCaptures[_pendingCaptures.Count - 1]", pending)
        self.assertIn('capture(s) not drawn within {DrawWaitFrames} frames', pending)
        self.assertLess(wait.index("_failed = new"), wait.index("Complete();"))
        complete = self._method_body(text, "private void Complete(")
        self.assertIn("WriteReport();", complete)
        self.assertIn("GetTree().Quit(_failed == null ? 0 : 1);", self._method_body(text, "private void Quit("))
        self.assertIn('["verdict"] = failed == null ? "pass" : "fail"', self._method_body(text, "private void WriteReport("))
        # 4: the physics rate is enforced
        ready = self._method_body(text, "public override void _Ready(")
        branch = self._method_body(ready, "if (Engine.PhysicsTicksPerSecond != RequiredPhysicsTicksPerSecond)")
        self.assertIn('["invariant"] = "scenario"', branch)
        self.assertIn("RequiredPhysicsTicksPerSecond = 60", text)
        self.assertIn("Precondition, enforced", text)
        # 5: the seed's reach is stated, not overclaimed
        self.assertIn("System.Random and RandomNumberGenerator instances the game creates", text)
        kb = (LIB.parents[2] / "kb" / "playable-verify-on-the-box.md").read_text(encoding="utf-8")
        self.assertIn("`System.Random` and `RandomNumberGenerator` instances the game creates", kb)

    # ---- the template

    @staticmethod
    def _method_body(text: str, signature: str) -> str:
        """The brace-matched body of the C# method whose declaration contains `signature`."""
        start = text.index("{", text.index(signature))
        depth = 0
        for i in range(start, len(text)):
            depth += {"{": 1, "}": -1}.get(text[i], 0)
            if depth == 0:
                return text[start:i + 1]
        raise AssertionError(f"unbalanced body for {signature}")

    def test_template_log_message_records_only_prefixed_error_lines(self):
        text = TEMPLATE.read_text(encoding="utf-8")
        body = self._method_body(text, "public override void _LogMessage(")
        self.assertIn("var trimmed = message.TrimStart();", body)
        self.assertIn('if (!error || !(trimmed.StartsWith("ERROR:") || '
                      'trimmed.StartsWith("SCRIPT ERROR:")', body)
        # one definition of an error line: every prefix the runner's ERROR_LINE matches
        for prefix in ("ERROR:", "SCRIPT ERROR:", "SHADER ERROR:"):
            self.assertIn(prefix, playable.ERROR_LINE.pattern)
            self.assertIn(f'trimmed.StartsWith("{prefix}")', body)
        # the early return comes before the record, so a plain `boom` never lands
        self.assertLess(body.index("return;"), body.index("_errors.Add("))

    def test_template_missing_scene_fails_with_invariant_scene(self):
        text = TEMPLATE.read_text(encoding="utf-8")
        body = self._method_body(text, "public override void _Ready(")
        branch = self._method_body(body, "if (!ResourceLoader.Exists(scene))")
        self.assertIn('["invariant"] = "scene"', branch)
        self.assertIn('["detail"] = $"no scene at {scene}"', branch)
        self.assertIn("Finish(", branch)
        self.assertIn("return;", branch)
        # the check guards the swap: it runs before ChangeSceneToFile
        self.assertLess(body.index("ResourceLoader.Exists(scene)"),
                        body.index("ChangeSceneToFile"))

    def test_template_names_the_user_args_report_keys_and_inertness(self):
        text = TEMPLATE.read_text(encoding="utf-8")
        self.assertIn("public partial class PlayableHarness : Node", text)
        for arg in playable.USER_ARGS:
            self.assertIn(f'"{arg}"', text)
        for key in playable.REPORT_KEYS:
            self.assertIn(f'"{key}"', text)
        for kind in playable.INVARIANT_KINDS:
            self.assertIn(f'"{kind}"', text)
        self.assertIn(playable.HARNESS_INERT_CHECK, text)
        self.assertIn("src/Debug/PlayableHarness.cs", text)
        self.assertIn('PlayableHarness="*res://src/Debug/PlayableHarness.cs"', text)
        self.assertIn("GetTree().Quit(", text)

    def test_template_third_review_patches(self):
        text = TEMPLATE.read_text(encoding="utf-8")
        # 1: the autoload line the runner requires is the one the header names
        self.assertIn(f"//        {playable.HARNESS_AUTOLOAD_LINE}", text)
        self.assertTrue(playable.HARNESS_AUTOLOAD_LINE.startswith(playable.HARNESS_AUTOLOAD + "="))
        # 2: the end marker is printed (stderr) right before the logger detaches
        self.assertIn(f'DetachedMarker = "{playable.HARNESS_DETACHED}"', text)
        quit_ = self._method_body(text, "private void Quit(")
        self.assertIn("GD.PrintErr(DetachedMarker);", quit_)
        self.assertLess(quit_.index("GD.PrintErr(DetachedMarker);"),
                        quit_.index("OS.RemoveLogger(_logger);"))
        # 4: a report that cannot be written still quits, exit 1
        for name in ("private void Finish(", "private void Complete("):
            body = self._method_body(text, name)
            self.assertIn("TryWriteReport();", body)
            self.assertNotIn(" WriteReport();", body)
        guard = self._method_body(text, "private void TryWriteReport(")
        self.assertIn("catch (Exception ex)", guard)
        self.assertIn('GD.PrintErr($"PlayableHarness: report.json not written: {ex.Message}");', guard)
        self.assertIn('["invariant"] = "report"', guard)
        self.assertIn("_failed ??=", guard)
        # 5: an absent or relative --playable-out quits 1 before anything is attached or created
        ready = self._method_body(text, "public override void _Ready(")
        check = ready.index("System.IO.Path.IsPathRooted(_out)")
        branch = self._method_body(ready, "if (string.IsNullOrEmpty(_out) || !System.IO.Path.IsPathRooted(_out))")
        self.assertIn('GD.PrintErr("PlayableHarness: --playable-out=<absolute dir> is required");', branch)
        self.assertIn("GetTree().Quit(1);", branch)
        self.assertIn("return;", branch)
        for later in ("OS.AddLogger(_logger);", "RenderingServer.FramePostDraw += OnFramePostDraw;",
                      "Directory.CreateDirectory("):
            self.assertLess(check, ready.index(later), later)

    def test_template_clamps_a_moment_past_the_ticks_to_the_last_tick(self):
        # Story 35.6 (hole 92): a moment at tick >= --ticks is captured on the
        # last tick, and the report looks its frame up there
        text = TEMPLATE.read_text(encoding="utf-8")
        physics = self._method_body(text, "public override void _PhysicsProcess(")
        self.assertIn("|| (m.Tick >= _ticks && _tick == _ticks - 1)", physics)
        self.assertIn("m.Tick == _tick", physics)
        report = self._method_body(text, "private void WriteReport(")
        self.assertIn("_frameAt.TryGetValue(Math.Min(m.Tick, _ticks - 1), out var f)", report)
        self.assertNotIn("_frameAt.TryGetValue(m.Tick,", report)
        self.assertIn("a moment at tick >=", text.split("using ", 1)[0])  # the header names it

    def test_template_depends_on_nothing_in_the_studio(self):
        text = TEMPLATE.read_text(encoding="utf-8")
        usings = re.findall(r"^using\s+([\w.]+);", text, flags=re.M)
        self.assertTrue(usings)
        for name in usings:
            self.assertTrue(name == "Godot" or name == "System" or name.startswith("System."), name)
        self.assertNotRegex(text, r"tk[-_]studio|TkStudio")


def _solid_png(width: int, height: int, rgb: tuple[int, int, int], ctype: int = 2) -> bytes:
    """A solid 8-bit PNG (colour type 2 RGB or 6 RGBA), filter 0."""
    import struct
    import zlib
    px = bytes(rgb) + (b"\xff" if ctype == 6 else b"")
    raw = b"".join(b"\x00" + px * width for _ in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, ctype, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


class ContactSheetTests(unittest.TestCase):
    """Story 34.8: `playable.py sheet` (0 / 5 / 40 frames)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="tk-sheet-"))
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))
        self.frames = self.tmp / "frames"
        self.frames.mkdir()
        self.out = self.tmp / "contact-sheet.png"

    def _frames(self, n: int, ctype: int = 2):
        for i in range(n):
            (self.frames / f"frame_{i:04d}.png").write_bytes(
                _solid_png(8, 6, (i * 5 % 256, 100, 200), ctype))

    def _main(self, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = playable.main(["sheet", *argv])
        return code, json.loads(buf.getvalue())

    def test_no_frame_is_a_refusal_with_the_block(self):
        code, out = self._main("--frames", str(self.frames), "--out", str(self.out))
        self.assertEqual(code, 2)
        self.assertEqual(list(out)[-4:], BLOCK_KEYS)
        self.assertEqual(out["status"], "blocked")
        self.assertEqual(out["intent"], "playable")
        self.assertIn("no *.png", out["reason"])
        self.assertFalse(self.out.exists())

    def test_five_frames_all_kept_in_name_order_rgb(self):
        import assets
        self._frames(5, ctype=6)
        code, out = self._main("--frames", str(self.frames), "--out", str(self.out),
                               "--columns", "4", "--width", "16")
        self.assertEqual(code, 0, out)
        self.assertEqual(list(out)[-4:], BLOCK_KEYS)
        self.assertEqual((out["status"], out["intent"]), ("complete", "playable"))
        self.assertEqual(out["frames"], [f"frame_{i:04d}.png" for i in range(5)])
        self.assertEqual(out["cell"], [16, 12])
        self.assertEqual(out["size"], [64, 24])
        w, h, ch, px = assets.png_pixels(self.out.read_bytes())
        self.assertEqual((w, h, ch), (64, 24, 3))
        # nearest-neighbour: cell 0 is frame 0's colour, cell 4 (row 2) frame 4's
        self.assertEqual(px[0:3], bytes((0, 100, 200)))
        self.assertEqual(px[(12 * 64) * 3:(12 * 64) * 3 + 3], bytes((20, 100, 200)))
        # the rest of the last row is black
        self.assertEqual(px[(12 * 64 + 16) * 3:(12 * 64 + 16) * 3 + 3], b"\x00\x00\x00")

    def test_forty_frames_sample_sixteen_evenly(self):
        self._frames(40)
        code, out = self._main("--frames", str(self.frames), "--out", str(self.out))
        self.assertEqual(code, 0, out)
        self.assertEqual(len(out["frames"]), 16)
        self.assertEqual(out["of"], 40)
        self.assertEqual(out["frames"][0], "frame_0000.png")
        self.assertEqual(out["frames"][-1], "frame_0039.png")
        self.assertEqual(out["frames"], sorted(out["frames"]))
        self.assertEqual(len(set(out["frames"])), 16)
        self.assertEqual(out["size"], [4 * 320, 4 * 240])

    def _report(self, files: list[str]) -> Path:
        path = self.tmp / "report.json"
        path.write_text(json.dumps({"schema": 1, "verdict": "pass", "frames": [
            {"tick": i * 30, "file": f} for i, f in enumerate(files)]}), encoding="utf-8")
        return path

    def test_report_names_three_of_forty_frames_and_only_those_are_sampled(self):
        # Story 35.3: the judge's citable set (the report's frames[]), never every movie frame.
        self._frames(40)
        named = ["frames/frame_0003.png", "frames/frame_0017.png", "frames/frame_0039.png"]
        report = self._report(named)
        code, out = self._main("--report", str(report), "--out", str(self.out))
        self.assertEqual(code, 0, out)
        self.assertEqual(out["frames"], ["frame_0003.png", "frame_0017.png", "frame_0039.png"])
        self.assertEqual(out["of"], 3)
        self.assertEqual(out["size"], [3 * 320, 240])
        self.assertTrue(self.out.is_file())
        # --report wins over --frames (the folder's 40 never counted)
        code, out = self._main("--report", str(report), "--frames", str(self.frames),
                               "--out", str(self.out))
        self.assertEqual((code, out["of"]), (0, 3))

    def test_report_refusals_name_the_frame_or_the_report(self):
        self._frames(2)
        for files, why in ((["frames/frame_0000.png", "frames/missing.png"], "missing.png"),
                           (["../outside.png"], "outside the report's folder"),
                           ([], "names no frames[]")):
            code, out = self._main("--report", str(self._report(files)), "--out", str(self.out))
            self.assertEqual((code, out["status"]), (2, "blocked"), out)
            self.assertIn(why, out["reason"])
        (self.tmp / "report.json").write_text("{not json", encoding="utf-8")
        code, out = self._main("--report", str(self.tmp / "report.json"), "--out", str(self.out))
        self.assertEqual((code, out["status"]), (2, "blocked"))
        code, out = self._main("--out", str(self.out))
        self.assertEqual((code, out["status"]), (2, "blocked"))
        self.assertIn("one of --frames or --report", out["reason"])

    def test_bad_flags_and_unreadable_frames_are_refusals(self):
        self._frames(2)
        code, out = self._main("--frames", str(self.frames), "--out", str(self.out),
                               "--columns", "0")
        self.assertEqual((code, out["status"]), (2, "blocked"))
        (self.frames / "frame_9999.png").write_bytes(b"not a png")
        code, out = self._main("--frames", str(self.frames), "--out", str(self.out))
        self.assertEqual((code, out["status"]), (2, "blocked"))
        self.assertIn("frame_9999.png", out["reason"])


if __name__ == "__main__":
    unittest.main()
