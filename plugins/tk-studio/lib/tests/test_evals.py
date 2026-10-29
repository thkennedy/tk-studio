"""Story 35.5 (hole 85, CAP-10): `evals.py run`, the `tk-studio-evals` core
the `maintenance-evals` job runs on the sandbox tier — one `claude plugin
eval` argv per case against a fake `claude` (`CLAUDE_BIN`), `scores.json`,
and the status block."""
from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import evals  # noqa: E402

CASES = ["tk-studio-playable-judge-verdict", "asset-ladder-generated-rung"]


def fake_claude(args: list[str]) -> int:
    """The fake `claude` (this file run as a script — the `.py` CLI evals.py
    runs under its own interpreter, portable to Windows; the conformance
    drive uses it too). Records its argv when `FAKE_LOG` is set, answers
    `--version`, and writes a canned `--json` result whose runs pass per
    `FAKE_PASSES` ("<case>=<n>,..."; default all); exits 1 when a case passes
    fewer than all runs (the CLI's below-threshold exit: a score, not a
    refusal)."""
    if os.environ.get("FAKE_LOG"):
        with open(os.environ["FAKE_LOG"], "a", encoding="utf-8") as fh:
            fh.write(json.dumps(args) + "\n")
    if args == ["--version"]:
        print("2.9.9 (Claude Code)")
        return 0
    case = args[args.index("--case") + 1]
    runs = int(args[args.index("--runs") + 1])
    out = args[args.index("--json") + 1]
    passes = dict(p.split("=") for p in os.environ.get("FAKE_PASSES", "").split(",") if p)
    n = int(passes.get(case, runs))
    if os.environ.get("FAKE_NO_JSON") != "1":
        # `FAKE_UNREADABLE` ("<case>,..."): that case's runs carry no recognisable verdict.
        unreadable = case in os.environ.get("FAKE_UNREADABLE", "").split(",")
        doc = {"cases": [{"name": case, "runs": [{"outcome": "?"} if unreadable else {"passed": i < n}
                                                 for i in range(runs)]}]}
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(doc, fh)
    return 0 if n == runs else 1


class EvalsRunTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)
        self.out = self.base / "out"
        self.log = self.base / "calls.jsonl"
        self.log.write_text("", encoding="utf-8")
        self.env = {"CLAUDE_BIN": str(Path(__file__).resolve()), "FAKE_LOG": str(self.log)}

    def tearDown(self):
        self._tmp.cleanup()

    def _main(self, *argv: str, env: dict | None = None) -> tuple[dict, int]:
        buf = io.StringIO()
        with mock.patch.dict(os.environ, {**self.env, **(env or {})}), \
                contextlib.redirect_stdout(buf):
            code = evals.main(list(argv))
        return json.loads(buf.getvalue()), code

    def _calls(self) -> list[list[str]]:
        return [json.loads(line) for line in self.log.read_text(encoding="utf-8").splitlines()]

    def test_one_argv_per_case_and_the_scores(self):
        result, code = self._main("run", "--cases", json.dumps(CASES), "--runs", "3",
                                  "--out", str(self.out),
                                  env={"FAKE_PASSES": "asset-ladder-generated-rung=2"})
        self.assertEqual(code, 0, result)
        calls = self._calls()
        self.assertEqual(calls[0], ["--version"])
        self.assertEqual(len(calls), 3)
        out = self.out.resolve()
        for case, argv in zip(CASES, calls[1:]):
            self.assertEqual(argv, [
                "plugin", "eval", str(evals.PLUGIN_ROOT), "--trust-plugin",
                "--allow-tools", "Bash", "Write", "--no-publish", "--threshold", "0",
                "--case", case, "--runs", "3", "--json", str(out / f"{case}.json")])
            self.assertTrue((out / f"{case}.json").is_file())
        scores = json.loads((out / "scores.json").read_text(encoding="utf-8"))
        self.assertEqual(scores, {
            "cases": {"tk-studio-playable-judge-verdict": {"runs": 3, "passed": 3, "score": 1.0},
                      "asset-ladder-generated-rung": {"runs": 3, "passed": 2, "score": 0.6667}},
            "cli": "2.9.9 (Claude Code)"})
        # the status block: last four keys, scores.json in artifacts, the per-case reason
        self.assertEqual(list(result)[-4:], ["status", "intent", "artifacts", "reason"])
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["intent"], "tk-studio-evals")
        self.assertIn(str(out / "scores.json"), result["artifacts"])
        self.assertEqual(result["reason"],
                         "tk-studio-playable-judge-verdict 3/3; asset-ladder-generated-rung 2/3")

    def test_the_claude_bin_flag_wins_over_the_env(self):
        result, code = self._main("run", "--cases", "asset-ladder-generated-rung", "--out", str(self.out),
                                  "--claude-bin", str(Path(__file__).resolve()),
                                  env={"CLAUDE_BIN": str(self.base / "no-such-claude")})
        self.assertEqual(code, 0, result)

    def test_defaults_are_the_two_sandbox_cases_three_runs(self):
        result, code = self._main("run", "--out", str(self.out))
        self.assertEqual(code, 0, result)
        self.assertEqual([c[c.index("--case") + 1] for c in self._calls()[1:]], CASES)
        self.assertTrue(all(c[c.index("--runs") + 1] == "3" for c in self._calls()[1:]))

    def test_the_run_workspace_is_the_default_output(self):
        store = self.base / "store"
        project = self.base / "proj"
        project.mkdir()
        result, code = self._main("run", "--cases", "asset-ladder-generated-rung",
                                  "--directory", str(project), "--run-id", "maintenance-evals-1",
                                  env={"TK_STUDIO_HOME": str(store)})
        self.assertEqual(code, 0, result)
        scores = Path(result["artifacts"][0])
        self.assertEqual(scores.name, "scores.json")
        self.assertEqual(scores.parent.name, "evals")
        self.assertEqual(scores.parent.parent.name, "maintenance-evals-1")
        self.assertTrue(scores.is_file())

    def test_a_missing_cli_is_a_status_block_failure(self):
        result, code = self._main("run", "--out", str(self.out),
                                  env={"CLAUDE_BIN": str(self.base / "no-such-claude")})
        self.assertEqual(code, 2)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["intent"], "tk-studio-evals")
        self.assertTrue(result["reason"].startswith("claude CLI unavailable"), result)
        self.assertFalse((self.out / "scores.json").exists())

    def test_refusals(self):
        for argv, marker in (
                (["run", "--cases", "no-such-case", "--out", str(self.out)], "unknown case: no-such-case"),
                (["run"], "no output folder"),
                (["run", "--runs", "0", "--out", str(self.out)], "--runs must be > 0"),
                (["walk"], "bad invocation")):
            result, code = self._main(*argv)
            self.assertEqual(code, 2, argv)
            self.assertEqual(result["status"], "blocked", argv)
            self.assertIn(marker, result["reason"], argv)

    def test_no_result_json_is_a_refusal_naming_the_case(self):
        result, code = self._main("run", "--cases", "asset-ladder-generated-rung",
                                  "--out", str(self.out), env={"FAKE_NO_JSON": "1"})
        self.assertEqual(code, 2)
        self.assertIn("case asset-ladder-generated-rung: no result JSON", result["reason"])

    def test_an_unscored_case_is_recorded_and_the_others_kept(self):
        # (35.5 review) the first case's runs are unreadable: the second still runs, scores.json holds
        # both (the failure with its reason), and the status block ends `blocked` naming it.
        result, code = self._main("run", "--cases", json.dumps(CASES), "--out", str(self.out),
                                  env={"FAKE_UNREADABLE": CASES[0]})
        self.assertEqual(code, 2, result)
        self.assertEqual(len(self._calls()), 3)
        out = self.out.resolve()
        scores = json.loads((out / "scores.json").read_text(encoding="utf-8"))
        self.assertEqual(scores["cases"], {
            CASES[0]: {"error": f"case {CASES[0]}: unreadable run verdicts"},
            CASES[1]: {"runs": 3, "passed": 3, "score": 1.0}})
        self.assertEqual(list(result)[-4:], ["status", "intent", "artifacts", "reason"])
        self.assertEqual(result["status"], "blocked")
        self.assertIn(str(out / "scores.json"), result["artifacts"])
        self.assertEqual(result["reason"],
                         f"case {CASES[0]}: unreadable run verdicts; {CASES[1]} 3/3")

    def test_scores_json_is_written_after_each_case(self):
        # the second case fails to run at all (its CLI vanishes): the first case's score is on disk
        real = evals.subprocess.run
        seen: list[str] = []

        def flaky(argv, **kw):
            if "--case" in argv:
                seen.append(argv[argv.index("--case") + 1])
                if len(seen) == 2:
                    on_disk = json.loads((self.out.resolve() / "scores.json").read_text(encoding="utf-8"))
                    self.assertEqual(list(on_disk["cases"]), [CASES[0]])
                    raise OSError("gone")
            return real(argv, **kw)
        with mock.patch.object(evals.subprocess, "run", side_effect=flaky):
            result, code = self._main("run", "--cases", json.dumps(CASES), "--out", str(self.out))
        self.assertEqual(code, 2, result)
        self.assertEqual(seen, CASES)
        scores = json.loads((self.out / "scores.json").read_text(encoding="utf-8"))
        self.assertEqual(scores["cases"][CASES[0]], {"runs": 3, "passed": 3, "score": 1.0})
        self.assertTrue(scores["cases"][CASES[1]]["error"].startswith(
            f"case {CASES[1]}: claude plugin eval failed to run"))

    def test_a_stale_result_is_never_read_as_a_fresh_score(self):
        # a reused --out holds last time's passing result; this time the CLI writes none
        self.out.mkdir()
        stale = self.out / "asset-ladder-generated-rung.json"
        stale.write_text(json.dumps({"runs": 3, "passed": 3}), encoding="utf-8")
        result, code = self._main("run", "--cases", "asset-ladder-generated-rung",
                                  "--out", str(self.out), env={"FAKE_NO_JSON": "1"})
        self.assertEqual(code, 2, result)
        self.assertIn("case asset-ladder-generated-rung: no result JSON", result["reason"])
        self.assertFalse(stale.exists())

    def test_an_unrecognised_verdict_is_a_named_refusal_not_a_failed_run(self):
        for doc in ({"cases": {"c": {"runs": [{"passed": True}, {"weird": 1}]}}},
                    {"cases": {"c": {"results": ["maybe", "maybe"]}}},
                    {"cases": [{"name": "c", "summary": "?"}]}):
            with self.assertRaises(evals.Refusal) as ctx:
                evals.score_case(doc, "c", 3)
            self.assertEqual(str(ctx.exception), "case c: unreadable run verdicts", doc)

    def test_an_error_verdict_string_is_unreadable_a_failed_one_a_fail(self):
        # (35.5 review) "error"/"timeout"/"skipped" are no verdict; only a named fail is a failed run
        for word in ("error", "timeout", "skipped", "aborted"):
            doc = {"cases": {"c": {"runs": [{"verdict": "pass"}, {"verdict": word}]}}}
            with self.assertRaises(evals.Refusal) as ctx:
                evals.score_case(doc, "c", 2)
            self.assertEqual(str(ctx.exception), "case c: unreadable run verdicts", word)
        self.assertEqual(evals.score_case({"cases": {"c": {"runs": [
            {"status": "passed"}, {"status": "failed"}]}}}, "c", 2),
            {"runs": 2, "passed": 1, "score": 0.5})

    def test_an_error_verdict_blocks_the_case_end_to_end(self):
        real = evals.subprocess.run

        def erroring(argv, **kw):
            res = real(argv, **kw)
            if "--case" in argv:
                out = Path(argv[argv.index("--json") + 1])
                out.write_text(json.dumps({"cases": [{"name": "asset-ladder-generated-rung", "runs": [
                    {"verdict": "error"}] * 3}]}), encoding="utf-8")
            return res
        with mock.patch.object(evals.subprocess, "run", side_effect=erroring):
            result, code = self._main("run", "--cases", "asset-ladder-generated-rung",
                                      "--out", str(self.out))
        self.assertEqual(code, 2, result)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["reason"], "case asset-ladder-generated-rung: unreadable run verdicts")

    def test_another_cases_result_is_never_credited(self):
        # (35.5 review) a lone list entry or a bare document naming a different case is not this case's
        for doc in ({"cases": [{"name": "other", "runs": [{"passed": True}]}]},
                    {"cases": [{"id": "other", "passed": 3, "runs": 3}]},
                    {"name": "other", "runs": [{"passed": True}]},
                    {"case": "other", "runs": 3, "passed": 3}):
            with self.assertRaises(evals.Refusal) as ctx:
                evals.score_case(doc, "c", 3)
            self.assertEqual(str(ctx.exception), "case c: not in the result JSON", doc)
        # unnamed, or naming this case: the per-call --case filter makes it this case's
        for doc in ({"cases": [{"runs": [{"passed": True}]}]},
                    {"cases": [{"case": "c", "runs": [{"passed": True}]}]},
                    {"runs": [{"passed": True}]},
                    {"name": "c", "runs": [{"passed": True}]}):
            self.assertEqual(evals.score_case(doc, "c", 1),
                             {"runs": 1, "passed": 1, "score": 1.0}, doc)

    def test_an_unwritable_out_folder_is_a_status_block_not_a_traceback(self):
        not_a_dir = self.base / "a-file"
        not_a_dir.write_text("x", encoding="utf-8")
        result, code = self._main("run", "--cases", "asset-ladder-generated-rung",
                                  "--out", str(not_a_dir))
        self.assertEqual(code, 2, result)
        self.assertEqual(list(result)[-4:], ["status", "intent", "artifacts", "reason"])
        self.assertEqual(result["status"], "blocked")
        self.assertTrue(result["reason"].startswith("output folder not writable"), result)
        self.assertEqual(self._calls(), [["--version"]])

    def test_a_scores_write_failure_is_blocked_and_keeps_the_scores(self):
        with mock.patch.object(evals, "_write_atomic", side_effect=OSError("disk full")):
            result, code = self._main("run", "--cases", "asset-ladder-generated-rung",
                                      "--out", str(self.out))
        self.assertEqual(code, 2, result)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["cases"]["asset-ladder-generated-rung"],
                         {"runs": 3, "passed": 3, "score": 1.0})
        self.assertIn("asset-ladder-generated-rung 3/3; scores.json not writable", result["reason"])
        self.assertNotIn(str(self.out.resolve() / "scores.json"), result["artifacts"])

    def test_undecodable_cli_output_is_still_scored(self):
        real = evals.subprocess.run

        def noisy(argv, **kw):
            if "--case" in argv:
                # the case's CLI output is decoded leniently: undecodable bytes never raise
                self.assertEqual((kw.get("encoding"), kw.get("errors")), ("utf-8", "replace"))
            return real(argv, **kw)
        with mock.patch.object(evals.subprocess, "run", side_effect=noisy):
            result, code = self._main("run", "--cases", "asset-ladder-generated-rung",
                                      "--out", str(self.out))
        self.assertEqual(code, 0, result)

    def test_an_undecodable_result_file_is_no_result_json(self):
        real = evals.subprocess.run

        def garbage(argv, **kw):
            res = real(argv, **kw)
            if "--case" in argv:
                Path(argv[argv.index("--json") + 1]).write_bytes(b"\xff\xfe\x80{")
            return res
        with mock.patch.object(evals.subprocess, "run", side_effect=garbage):
            result, code = self._main("run", "--cases", "asset-ladder-generated-rung",
                                      "--out", str(self.out))
        self.assertEqual(code, 2, result)
        self.assertIn("case asset-ladder-generated-rung: no result JSON", result["reason"])

    def test_the_case_timeout_fits_the_job_guard(self):
        job = json.loads((evals.PLUGIN_ROOT / "jobs" / "maintenance-evals.json").read_text(encoding="utf-8"))
        guard = job["guards"]["max_wall_clock_seconds"]
        self.assertGreaterEqual(guard, 3600)
        cases = len(job["target"]["payload"]["cases"])
        self.assertLessEqual(cases * evals.CASE_TIMEOUT_S + evals.VERSION_TIMEOUT_S, guard - 300)

    def test_score_shapes_read_defensively(self):
        self.assertEqual(evals.score_case({"cases": {"c": {"score": 0.5, "runs": [
            {"verdict": "pass"}, {"verdict": "fail"}]}}}, "c", 2),
            {"runs": 2, "passed": 1, "score": 0.5})
        self.assertEqual(evals.score_case({"runs": 3, "passed": 2}, "c", 3),
                         {"runs": 3, "passed": 2, "score": 0.6667})
        # an integer `passed` with no integer `runs` is read against the requested runs
        self.assertEqual(evals.score_case({"passed": 2}, "c", 3),
                         {"runs": 3, "passed": 2, "score": 0.6667})

    def test_a_run_count_other_than_requested_is_a_named_refusal_not_a_score(self):
        # (35.5 review) --runs 3 but one passing run reported: never 1/1, score 1.0
        for doc, n in (({"cases": {"c": {"runs": [{"passed": True}]}}}, 1),
                       ({"cases": [{"name": "c", "results": [{"passed": True}] * 4}]}, 4),
                       ({"runs": 1, "passed": 1}, 1),
                       ({"cases": {"c": {"runs": 5, "passed": 3, "score": 0.6}}}, 5)):
            with self.assertRaises(evals.Refusal) as ctx:
                evals.score_case(doc, "c", 3)
            self.assertEqual(str(ctx.exception), f"case c: {n} runs reported, 3 requested", doc)

    def test_passed_outside_the_run_count_is_unreadable(self):
        for doc in ({"runs": 3, "passed": 4}, {"passed": 4}, {"runs": 3, "passed": -1},
                    {"cases": {"c": {"passed": 5, "score": 1.0}}}):
            with self.assertRaises(evals.Refusal) as ctx:
                evals.score_case(doc, "c", 3)
            self.assertEqual(str(ctx.exception), "case c: unreadable run verdicts", doc)

    def test_a_short_result_blocks_the_case_end_to_end(self):
        real = evals.subprocess.run

        def short(argv, **kw):
            res = real(argv, **kw)
            if "--case" in argv and argv[argv.index("--case") + 1] == CASES[0]:
                out = Path(argv[argv.index("--json") + 1])
                out.write_text(json.dumps({"cases": [{"name": CASES[0], "runs": [
                    {"passed": True}]}]}), encoding="utf-8")
            return res
        with mock.patch.object(evals.subprocess, "run", side_effect=short):
            result, code = self._main("run", "--cases", json.dumps(CASES), "--runs", "3",
                                      "--out", str(self.out))
        self.assertEqual(code, 2, result)
        self.assertEqual(list(result)[-4:], ["status", "intent", "artifacts", "reason"])
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["cases"], {
            CASES[0]: {"error": f"case {CASES[0]}: 1 runs reported, 3 requested"},
            CASES[1]: {"runs": 3, "passed": 3, "score": 1.0}})
        self.assertEqual(result["reason"],
                         f"case {CASES[0]}: 1 runs reported, 3 requested; {CASES[1]} 3/3")


if __name__ == "__main__":
    if sys.argv[1:2] in (["--version"], ["plugin"]):
        sys.exit(fake_claude(sys.argv[1:]))
    unittest.main()
