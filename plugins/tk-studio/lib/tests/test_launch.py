"""Tests for the launch surface (tk-studio-launch, studio pipeline decision 5).

The core is exercised against a fake substrate: `run_cli` and
`spawn_detached` are injected, so no bmad-loop is needed and nothing is
launched. What must hold: readiness names every gap and launches nothing;
a live engine on the checkout refuses; a launch answers ok only once the
engine acknowledged the pre-minted id; status answers without the CLI on a
project that never ran; the CLI keeps the JSON/exit-code house shape, and
every CLI result ends with the AD-11 block keys (Story 26.1); the policy
limits are compared read-only with the budget bands, and a mismatch refuses
`start` unless acknowledged.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import re
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import launch  # noqa: E402


def _project(tmp: Path, *, spec: bool = True, entries: int = 2,
             ran_before: bool = False) -> tuple[Path, str]:
    root = tmp / "proj"
    folder = root / "_bmad-output" / "specs" / "spec-epic-2"
    folder.mkdir(parents=True)
    if spec:
        (folder / "SPEC.md").write_text("# SPEC\n", encoding="utf-8")
    if entries >= 0:
        lines = []
        for n in range(1, entries + 1):
            lines.append(f'- id: "2-1-{n}"\n  title: t{n}\n  description: d{n}\n')
        (folder / "stories.yaml").write_text("".join(lines) or "# empty\n", encoding="utf-8")
    if ran_before:
        (root / ".bmad-loop" / "runs").mkdir(parents=True)
    return root, "_bmad-output/specs/spec-epic-2"


BLOCK_KEYS = ["status", "intent", "artifacts", "reason"]

BANDS_YAML = """\
bands_version: 1
currency: usd
bands:
  S:
    usd_estimate: 4.5
    weighted_tokens: 2000000
    review_cycles_max: 1
  M:
    usd_estimate: 8.5
    weighted_tokens: 3500000
    review_cycles_max: 2
  L:
    usd_estimate: 13
    weighted_tokens: 5000000
    review_cycles_max: 2
"""


def _budget_files(root: Path, *, max_tokens: int = 2000000, review_cycles: int = 3,
                  bands: str | None = BANDS_YAML, policy: str | None = None) -> Path:
    """Write the engine policy and the budget bands into a fixture project;
    returns the policy path. The real-box numbers are the default: L's
    5,000,000 weighted tokens exceed max_tokens_per_story 2,000,000."""
    policy_path = root / ".bmad-loop" / "policy.toml"
    policy_path.parent.mkdir(parents=True, exist_ok=True)
    if policy is None:
        policy = ("[gates]\nmode = \"per-epic\"\n\n[limits]\n"
                  f"max_review_cycles = {review_cycles}\n"
                  "session_timeout_min = 90\n"
                  f"max_tokens_per_story = {max_tokens}\n"
                  "max_tokens_per_session = 4000000\n")
    policy_path.write_text(policy, encoding="utf-8")
    if bands is not None:
        bands_path = root / ".tk-studio" / "budget-bands.yaml"
        bands_path.parent.mkdir(parents=True, exist_ok=True)
        bands_path.write_text(bands, encoding="utf-8")
    return policy_path


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class _FakeSubstrate:
    """Scripted bmad-loop: list/validate/status/stop answers + a spawner
    that optionally writes the engine's state.json to acknowledge."""

    def __init__(self, *, runs=None, validate_ok=True, acknowledge=True,
                 stop_ok=True):
        self.runs = runs or []
        self.validate_ok = validate_ok
        self.acknowledge = acknowledge
        self.stop_ok = stop_ok
        self.calls: list[list[str]] = []
        self.spawned: list[dict] = []

    def run_cli(self, args, *, cwd=None, timeout=120):
        self.calls.append(list(args))
        verb = args[0]
        if verb == "list":
            return 0, json.dumps({"schema_version": 1, "runs": self.runs}), ""
        if verb == "validate":
            findings = [] if self.validate_ok else [
                {"check": "vcs", "severity": "problem", "message": "git worktree is not clean"}]
            return (0 if self.validate_ok else 1,
                    json.dumps({"ok": self.validate_ok, "findings": findings}), "")
        if verb == "status":
            return 0, json.dumps({"run_id": args[-1], "status": "in-progress",
                                  "paused_stage": None, "tasks": [
                                      {"story_key": "2-1-1", "phase": "dev-running",
                                       "attempt": 1, "review_cycle": 0}]}), ""
        if verb == "stop":
            if self.stop_ok:
                return 0, "stopped", ""
            return 1, "", f"no such run: {args[-1]}"
        return 1, "", f"unknown verb {verb}"

    def spawn_detached(self, args, *, cwd, log_path):
        self.spawned.append({"args": list(args), "cwd": cwd, "log": log_path})
        if self.acknowledge:
            rid = args[args.index("--run-id") + 1]
            state = Path(cwd) / ".bmad-loop" / "runs" / rid / "state.json"
            state.parent.mkdir(parents=True, exist_ok=True)
            state.write_text("{}", encoding="utf-8")
        return 4242


class LaunchTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        os.environ["TK_STUDIO_HOME"] = str(self.tmp / "store")
        self._orig = (launch.run_cli, launch.spawn_detached, launch._bmad_loop_binary)
        launch._bmad_loop_binary = lambda: "bmad-loop"

    def tearDown(self):
        launch.run_cli, launch.spawn_detached, launch._bmad_loop_binary = self._orig
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()

    def _wire(self, fake: _FakeSubstrate) -> _FakeSubstrate:
        launch.run_cli = fake.run_cli
        launch.spawn_detached = fake.spawn_detached
        return fake

    # ---- run id

    def test_minted_run_id_has_the_substrate_shape(self):
        rid = launch.mint_run_id()
        self.assertRegex(rid, r"^\d{8}-\d{6}-[0-9a-f]{4}$")
        self.assertTrue(launch.RUN_ID_RE.match(rid))

    # ---- check

    def test_check_names_every_gap_and_launches_nothing(self):
        root, spec = _project(self.tmp, spec=False, entries=0)
        fake = self._wire(_FakeSubstrate())
        result = launch.check(root, spec)
        self.assertFalse(result["ok"])
        joined = " | ".join(result["gaps"])
        self.assertIn("SPEC.md", joined)
        self.assertIn("bmad-spec", joined)
        self.assertIn("task manifest", joined)
        self.assertEqual(fake.spawned, [])

    def test_check_refuses_a_live_engine_on_the_checkout(self):
        root, spec = _project(self.tmp, ran_before=True)
        self._wire(_FakeSubstrate(runs=[
            {"run_id": "20260902-022928-ef8c", "status": "in-progress", "paused_stage": ""},
            {"run_id": "20260901-140420-dfe6", "status": "finished", "paused_stage": ""}]))
        result = launch.check(root, spec)
        self.assertFalse(result["ok"])
        self.assertTrue(any("live engine" in g and "ef8c" in g for g in result["gaps"]))

    def test_a_paused_engine_still_owns_the_checkout(self):
        root, spec = _project(self.tmp, ran_before=True)
        self._wire(_FakeSubstrate(runs=[
            {"run_id": "20260902-022928-ef8c", "status": "in-progress",
             "paused_stage": "escalation"}]))
        self.assertFalse(launch.check(root, spec)["ok"])

    def test_check_passes_on_a_ready_project_and_reports_validate(self):
        root, spec = _project(self.tmp)
        fake = self._wire(_FakeSubstrate())
        result = launch.check(root, spec)
        self.assertTrue(result["ok"], result["gaps"])
        self.assertIn(["validate", "--json", "--project", str(root.resolve()), "--spec", spec],
                      fake.calls)
        # a project that never ran needs no `list` call
        self.assertFalse(any(c[0] == "list" for c in fake.calls))

    def test_validate_problems_are_gaps(self):
        root, spec = _project(self.tmp)
        self._wire(_FakeSubstrate(validate_ok=False))
        result = launch.check(root, spec)
        self.assertFalse(result["ok"])
        self.assertTrue(any("not clean" in g for g in result["gaps"]))

    def test_missing_bmad_loop_is_a_named_gap(self):
        root, spec = _project(self.tmp)
        self._wire(_FakeSubstrate())
        launch._bmad_loop_binary = lambda: None
        result = launch.check(root, spec)
        self.assertFalse(result["ok"])
        self.assertTrue(any("bmad-loop is not on PATH" in g for g in result["gaps"]))

    # ---- start

    def test_start_spawns_detached_with_a_preminted_id_and_acknowledges(self):
        root, spec = _project(self.tmp)
        fake = self._wire(_FakeSubstrate())
        result = launch.start(root, spec, wait_s=2)
        self.assertTrue(result["ok"], result)
        self.assertTrue(result["state_seen"])
        spawned = fake.spawned[0]
        self.assertEqual(spawned["args"][:2], ["run", "--project"])
        self.assertIn("--spec", spawned["args"])
        self.assertEqual(spawned["args"][spawned["args"].index("--run-id") + 1], result["run_id"])
        # the log lives in the per-user store, never in the project tree
        self.assertTrue(str(spawned["log"]).startswith(str(self.tmp / "store")))
        self.assertIn("launches", str(spawned["log"]))
        self.assertEqual(result["pid"], 4242)

    def test_start_refuses_when_readiness_fails(self):
        root, spec = _project(self.tmp, entries=0)
        fake = self._wire(_FakeSubstrate())
        with self.assertRaises(launch.LaunchError) as ctx:
            launch.start(root, spec)
        self.assertIn("launch refused", str(ctx.exception))
        self.assertEqual(fake.spawned, [])

    def test_unacknowledged_launch_is_not_ok(self):
        root, spec = _project(self.tmp)
        self._wire(_FakeSubstrate(acknowledge=False))
        result = launch.start(root, spec, wait_s=0.6)
        self.assertFalse(result["ok"])
        self.assertFalse(result["state_seen"])
        self.assertIn("did not write", result["error"])
        self.assertEqual(result["pid"], 4242)

    def test_start_rejects_a_malformed_or_existing_run_id(self):
        root, spec = _project(self.tmp)
        self._wire(_FakeSubstrate())
        with self.assertRaises(launch.LaunchError):
            launch.start(root, spec, run_id="not-an-id")
        (root / ".bmad-loop" / "runs" / "20260903-101500-ab12").mkdir(parents=True)
        self._wire(_FakeSubstrate())  # runs dir now exists → list answers empty
        with self.assertRaises(launch.LaunchError) as ctx:
            launch.start(root, spec, run_id="20260903-101500-ab12")
        self.assertIn("already exists", str(ctx.exception))

    # ---- status / stop

    def test_status_without_a_bmad_loop_dir_needs_no_cli(self):
        root, _ = _project(self.tmp)
        fake = self._wire(_FakeSubstrate())
        result = launch.status(root)
        self.assertEqual(result, {"ok": True, "project": str(root.resolve()),
                                  "runs": [], "live": []})
        self.assertEqual(fake.calls, [])

    def test_status_details_the_live_run(self):
        root, _ = _project(self.tmp, ran_before=True)
        self._wire(_FakeSubstrate(runs=[
            {"run_id": "20260902-022928-ef8c", "status": "in-progress", "paused_stage": ""}]))
        result = launch.status(root)
        self.assertEqual(result["run"]["run_id"], "20260902-022928-ef8c")
        self.assertEqual(result["run"]["tasks"][0]["key"], "2-1-1")

    def test_stop_passes_graceful_through(self):
        root, _ = _project(self.tmp, ran_before=True)
        fake = self._wire(_FakeSubstrate())
        result = launch.stop(root, "20260902-022928-ef8c", graceful=True)
        self.assertTrue(result["ok"])
        self.assertIn("--graceful", fake.calls[-1])

    # ---- CLI

    def test_cli_check_and_start_keep_the_house_shape(self):
        root, spec = _project(self.tmp)
        self._wire(_FakeSubstrate())
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = launch.main(["check", "--directory", str(root), "--spec", spec])
        self.assertEqual(code, 0)
        parsed = json.loads(out.getvalue())
        self.assertTrue(parsed["ok"])
        # Story 26.1: the AD-11 block keys end every result, in order
        self.assertEqual(list(parsed)[-4:], BLOCK_KEYS)
        self.assertEqual((parsed["status"], parsed["intent"], parsed["artifacts"],
                          parsed["reason"]), ("complete", "tk-studio-launch", [], None))
        self.assertIn("budget", parsed)

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = launch.main(["start", "--directory", str(root), "--spec", spec, "--wait", "2"])
        self.assertEqual(code, 0)
        parsed = json.loads(out.getvalue())
        self.assertTrue(parsed["ok"])
        self.assertTrue(re.match(r"^\d{8}-\d{6}-[0-9a-f]{4}$", parsed["run_id"]))
        self.assertEqual(list(parsed)[-4:], BLOCK_KEYS)
        self.assertEqual(parsed["status"], "complete")
        self.assertEqual(parsed["intent"], "tk-studio-launch")
        # the project-relative run dir and spec folder — never run_dir_abs or the log
        self.assertEqual(parsed["artifacts"], [parsed["run_dir"], parsed["spec_folder"]])
        self.assertNotIn(parsed["run_dir_abs"], parsed["artifacts"])
        self.assertNotIn(parsed["log"], parsed["artifacts"])
        self.assertIsNone(parsed["reason"])
        self.assertIn("budget", parsed)

    # ---- review-driven pins (PR #58 adversarial pass)

    def test_terminal_statuses_never_own_the_checkout_even_with_a_stale_pause(self):
        root, spec = _project(self.tmp, ran_before=True)
        self._wire(_FakeSubstrate(runs=[
            {"run_id": "20260901-000000-aaaa", "status": "stopped", "paused_stage": "escalation"},
            {"run_id": "20260901-000001-bbbb", "status": "interrupted", "paused_stage": ""},
            {"run_id": "20260901-000002-cccc", "status": "crashed", "paused_stage": "story-gate"},
            {"run_id": "20260901-000003-dddd", "status": "finished", "paused_stage": ""}]))
        self.assertTrue(launch.check(root, spec)["ok"])
        self.assertEqual(launch.live_runs([{"status": s} for s in launch.TERMINAL_STATUSES]), [])

    def test_missing_project_directory_is_a_named_gap_not_a_crash(self):
        result = launch.check(self.tmp / "absent", "x")
        self.assertFalse(result["ok"])
        self.assertTrue(any(g.startswith("project:") for g in result["gaps"]))

    def test_absolute_spec_folder_reaches_validate_and_run_relativized(self):
        root, spec = _project(self.tmp)
        fake = self._wire(_FakeSubstrate())
        absolute = str((root / spec).resolve())
        result = launch.start(root, absolute, wait_s=2)
        self.assertTrue(result["ok"], result)
        validate = next(c for c in fake.calls if c[0] == "validate")
        given = validate[validate.index("--spec") + 1]
        self.assertFalse(Path(given).is_absolute())
        run_args = fake.spawned[0]["args"]
        self.assertEqual(run_args[run_args.index("--spec") + 1], given)
        self.assertEqual(result["spec_folder"], given)

    def test_run_dir_in_the_result_is_project_relative(self):
        root, spec = _project(self.tmp)
        self._wire(_FakeSubstrate())
        result = launch.start(root, spec, wait_s=2)
        self.assertEqual(result["run_dir"], f".bmad-loop/runs/{result['run_id']}")
        self.assertTrue(Path(result["run_dir_abs"]).is_absolute())

    def test_cli_epic_applies_the_default_spec_folder(self):
        root, spec = _project(self.tmp)
        fake = self._wire(_FakeSubstrate())
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = launch.main(["check", "--directory", str(root), "--epic", "2"])
        self.assertEqual(code, 0)
        self.assertTrue(json.loads(out.getvalue())["ok"])
        validate = next(c for c in fake.calls if c[0] == "validate")
        self.assertEqual(validate[validate.index("--spec") + 1], spec)
        self.assertEqual(launch.default_spec_folder(7), "_bmad-output/specs/spec-epic-7")

    def test_cli_without_spec_or_epic_is_a_refusal(self):
        root, _ = _project(self.tmp)
        self._wire(_FakeSubstrate())
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = launch.main(["start", "--directory", str(root)])
        self.assertEqual(code, 2)
        self.assertIn("--spec or --epic", json.loads(out.getvalue())["error"])

    def test_cli_status_and_stop_keep_the_house_shape(self):
        root, _ = _project(self.tmp, ran_before=True)
        self._wire(_FakeSubstrate(runs=[
            {"run_id": "20260902-022928-ef8c", "status": "in-progress", "paused_stage": ""}]))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = launch.main(["status", "--directory", str(root)])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue())["run"]["run_id"], "20260902-022928-ef8c")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = launch.main(["stop", "--directory", str(root),
                                "--run-id", "20260902-022928-ef8c", "--graceful"])
        self.assertEqual(code, 0)
        self.assertTrue(json.loads(out.getvalue())["ok"])

    def test_stop_refusal_from_the_substrate_is_exit_2(self):
        root, _ = _project(self.tmp, ran_before=True)
        self._wire(_FakeSubstrate(stop_ok=False))
        with self.assertRaises(launch.LaunchError):
            launch.stop(root, "20260901-000000-aaaa")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = launch.main(["stop", "--directory", str(root), "--run-id", "20260901-000000-aaaa"])
        self.assertEqual(code, 2)
        parsed = json.loads(out.getvalue())
        self.assertFalse(parsed["ok"])
        self.assertIn("no such run", parsed["error"])

    def test_manifest_count_tolerates_indented_top_level_list(self):
        path = self.tmp / "stories.yaml"
        path.write_text('  - id: "1-1-1"\n    title: a\n  - id: "1-1-2"\n    title: b\n',
                        encoding="utf-8")
        self.assertEqual(launch._manifest_entry_count(path), 2)

    def test_cli_refusal_is_exit_2_with_ok_false(self):
        root, _ = _project(self.tmp)
        self._wire(_FakeSubstrate())
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = launch.main(["start", "--directory", str(root), "--spec", "nope/none"])
        self.assertEqual(code, 2)
        parsed = json.loads(out.getvalue())
        self.assertFalse(parsed["ok"])
        self.assertIn("spec folder", parsed["error"])
        # Story 26.1: the refusal carries the block too, blocked, reason = error
        self.assertEqual(list(parsed), ["ok", "error"] + BLOCK_KEYS)
        self.assertEqual(parsed["status"], "blocked")
        self.assertEqual(parsed["intent"], "tk-studio-launch")
        self.assertEqual(parsed["artifacts"], [])
        self.assertEqual(parsed["reason"], parsed["error"])

    # ---- Story 26.1: the block on every verb and outcome

    def _cli(self, argv: list[str]) -> tuple[int, dict]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = launch.main(argv)
        return code, json.loads(out.getvalue())

    def test_cli_check_with_gaps_ends_blocked_naming_them(self):
        root, spec = _project(self.tmp, spec=False)
        self._wire(_FakeSubstrate())
        code, parsed = self._cli(["check", "--directory", str(root), "--spec", spec])
        self.assertEqual(code, 0)  # a check with gaps is an answer
        self.assertFalse(parsed["ok"])
        self.assertEqual(list(parsed)[-4:], BLOCK_KEYS)
        self.assertEqual(parsed["status"], "blocked")
        self.assertIn("SPEC.md", parsed["reason"])

    def test_cli_status_and_stop_end_with_the_block(self):
        root, _ = _project(self.tmp, ran_before=True)
        self._wire(_FakeSubstrate(runs=[
            {"run_id": "20260902-022928-ef8c", "status": "in-progress", "paused_stage": ""}]))
        code, parsed = self._cli(["status", "--directory", str(root)])
        self.assertEqual(code, 0)
        self.assertEqual(list(parsed)[-4:], BLOCK_KEYS)
        self.assertEqual((parsed["status"], parsed["intent"], parsed["artifacts"], parsed["reason"]),
                         ("complete", "tk-studio-launch", [], None))
        code, parsed = self._cli(["stop", "--directory", str(root),
                                  "--run-id", "20260902-022928-ef8c"])
        self.assertEqual(code, 0)
        self.assertEqual(list(parsed)[-4:], BLOCK_KEYS)
        self.assertEqual(parsed["status"], "complete")

    def test_cli_stop_refusal_ends_blocked(self):
        root, _ = _project(self.tmp, ran_before=True)
        self._wire(_FakeSubstrate(stop_ok=False))
        code, parsed = self._cli(["stop", "--directory", str(root),
                                  "--run-id", "20260901-000000-aaaa"])
        self.assertEqual(code, 2)
        self.assertEqual(list(parsed)[-4:], BLOCK_KEYS)
        self.assertEqual(parsed["status"], "blocked")
        self.assertIn("no such run", parsed["reason"])

    def test_cli_unacknowledged_start_ends_blocked_exit_1(self):
        root, spec = _project(self.tmp)
        self._wire(_FakeSubstrate(acknowledge=False))
        code, parsed = self._cli(["start", "--directory", str(root), "--spec", spec,
                                  "--wait", "0.6"])
        self.assertEqual(code, 1)
        self.assertEqual(list(parsed)[-4:], BLOCK_KEYS)
        self.assertEqual(parsed["status"], "blocked")
        self.assertEqual(parsed["artifacts"], [])
        self.assertIn("did not write", parsed["reason"])

    # ---- Story 26.1: the budget comparison

    def test_check_names_the_mismatch_with_both_numbers_and_ends_partial(self):
        root, spec = _project(self.tmp)
        _budget_files(root)
        self._wire(_FakeSubstrate())
        result = launch.check(root, spec)
        self.assertTrue(result["ok"], result["gaps"])  # a mismatch is never a gap
        self.assertEqual(result["gaps"], [])
        self.assertEqual(result["budget"]["budget_mismatch"], [{
            "limit": "max_tokens_per_story", "policy": 2000000, "band": "L",
            "band_field": "weighted_tokens", "band_value": 5000000}])
        compared = {c["limit"]: c for c in result["budget"]["compared"]}
        self.assertEqual(set(compared), {"max_tokens_per_story", "max_review_cycles"})
        self.assertEqual(compared["max_review_cycles"]["band_value"], 2)
        code, parsed = self._cli(["check", "--directory", str(root), "--spec", spec])
        self.assertEqual(code, 0)
        self.assertEqual(list(parsed)[-4:], BLOCK_KEYS)
        self.assertEqual(parsed["status"], "partial")
        self.assertIn("max_tokens_per_story", parsed["reason"])
        self.assertIn("2000000", parsed["reason"])
        self.assertIn("5000000", parsed["reason"])

    def test_check_within_the_bands_is_complete(self):
        root, spec = _project(self.tmp)
        _budget_files(root, max_tokens=6000000)
        self._wire(_FakeSubstrate())
        code, parsed = self._cli(["check", "--directory", str(root), "--spec", spec])
        self.assertEqual(code, 0)
        self.assertEqual(parsed["budget"]["budget_mismatch"], [])
        self.assertEqual(len(parsed["budget"]["compared"]), 2)
        self.assertEqual(parsed["status"], "complete")

    def test_review_cap_below_the_bands_is_a_mismatch(self):
        root, spec = _project(self.tmp)
        _budget_files(root, max_tokens=6000000, review_cycles=1)
        self._wire(_FakeSubstrate())
        mismatch = launch.check(root, spec)["budget"]["budget_mismatch"]
        self.assertEqual(mismatch, [{"limit": "max_review_cycles", "policy": 1,
                                     "band": "M", "band_field": "review_cycles_max",
                                     "band_value": 2}])

    def test_limits_without_a_band_field_are_not_compared(self):
        root, spec = _project(self.tmp)
        _budget_files(root)
        self._wire(_FakeSubstrate())
        budget = launch.check(root, spec)["budget"]
        not_compared = {n["limit"]: n["reason"] for n in budget["not_compared"]}
        self.assertEqual(not_compared, {"session_timeout_min": "no band field",
                                        "max_tokens_per_session": "no band field",
                                        "max_followup_reviews": "no band field"})
        limits = {m["limit"] for m in budget["budget_mismatch"]}
        self.assertNotIn("session_timeout_min", limits)
        self.assertNotIn("max_tokens_per_session", limits)
        self.assertNotIn("max_followup_reviews", limits)

    def test_missing_or_unparseable_budget_inputs_are_named_never_a_crash(self):
        cases = {
            "policy missing": dict(policy=None, write_policy=False),
            "policy unparseable": dict(policy="[limits\nmax = = 1\n"),
            "bands missing": dict(bands=None),
            "bands unparseable": dict(bands="bands:\n  - [unclosed\n bad: : :\n"),
        }
        for label, kw in cases.items():
            with self.subTest(label):
                tmp = self.tmp / label.replace(" ", "-")
                tmp.mkdir()
                root, spec = _project(tmp)
                write_policy = kw.pop("write_policy", True)
                if write_policy:
                    _budget_files(root, **kw)
                elif kw.get("bands", BANDS_YAML) is not None:
                    bands = root / ".tk-studio" / "budget-bands.yaml"
                    bands.parent.mkdir(parents=True)
                    bands.write_text(BANDS_YAML, encoding="utf-8")
                self._wire(_FakeSubstrate())
                result = launch.check(root, spec)
                self.assertTrue(result["ok"], result["gaps"])
                self.assertEqual(result["budget"]["budget_mismatch"], [])
                entry = next(c for c in result["checks"] if c["check"] == "budget")
                expected = ("policy.toml" if label.startswith("policy")
                            else "budget-bands.yaml")
                self.assertIn(expected, entry["detail"])
                self.assertIn(label.split()[1], entry["detail"])
                self.assertTrue(result["budget"]["not_compared"])

    def test_start_refuses_on_a_mismatch_and_spawns_nothing(self):
        root, spec = _project(self.tmp)
        _budget_files(root)
        fake = self._wire(_FakeSubstrate())
        with self.assertRaises(launch.LaunchError) as ctx:
            launch.start(root, spec, wait_s=2)
        self.assertIn("budget_mismatch", str(ctx.exception))
        self.assertIn("2000000", str(ctx.exception))
        self.assertIn("5000000", str(ctx.exception))
        self.assertEqual(fake.spawned, [])
        code, parsed = self._cli(["start", "--directory", str(root), "--spec", spec,
                                  "--wait", "2"])
        self.assertEqual(code, 2)
        self.assertEqual(list(parsed)[-4:], BLOCK_KEYS)
        self.assertEqual(parsed["status"], "blocked")
        self.assertIn("allow_budget_mismatch", parsed["reason"])
        self.assertEqual(fake.spawned, [])

    def test_cli_mismatch_refusal_carries_the_budget_before_the_block(self):
        root, spec = _project(self.tmp)
        _budget_files(root)
        fake = self._wire(_FakeSubstrate())
        code, parsed = self._cli(["start", "--directory", str(root), "--spec", spec,
                                  "--wait", "2"])
        self.assertEqual(code, 2)
        self.assertEqual(list(parsed), ["ok", "error", "budget"] + BLOCK_KEYS)
        self.assertFalse(parsed["ok"])
        self.assertEqual(parsed["status"], "blocked")
        self.assertEqual(parsed["artifacts"], [])
        self.assertEqual(parsed["reason"], parsed["error"])
        self.assertEqual(parsed["budget"]["budget_mismatch"], [{
            "limit": "max_tokens_per_story", "policy": 2000000, "band": "L",
            "band_field": "weighted_tokens", "band_value": 5000000}])
        self.assertEqual(set(parsed["budget"]), {"compared", "budget_mismatch", "not_compared"})
        self.assertEqual(fake.spawned, [])

    def test_cli_gaps_refusal_with_a_mismatch_still_names_the_budget(self):
        root, spec = _project(self.tmp, spec=False)
        _budget_files(root)
        self._wire(_FakeSubstrate())
        code, parsed = self._cli(["start", "--directory", str(root), "--spec", spec])
        self.assertEqual(code, 2)
        self.assertEqual(list(parsed)[-4:], BLOCK_KEYS)
        self.assertIn("SPEC.md", parsed["reason"])
        self.assertEqual(len(parsed["budget"]["budget_mismatch"]), 1)

    def test_a_non_numeric_band_field_is_not_compared_never_a_crash(self):
        root, spec = _project(self.tmp)
        bands = BANDS_YAML.replace("weighted_tokens: 5000000", 'weighted_tokens: "lots"')
        _budget_files(root, bands=bands)
        self._wire(_FakeSubstrate())
        result = launch.check(root, spec)
        self.assertTrue(result["ok"], result["gaps"])
        budget = result["budget"]
        not_compared = {n["limit"]: n["reason"] for n in budget["not_compared"]}
        self.assertEqual(not_compared["max_tokens_per_story"],
                         "band L weighted_tokens not a number")
        self.assertNotIn("max_tokens_per_story", {c["limit"] for c in budget["compared"]})
        self.assertEqual(budget["budget_mismatch"], [])
        # the other limit is still compared on its numeric bands
        self.assertEqual([c["limit"] for c in budget["compared"]], ["max_review_cycles"])

    def test_a_non_numeric_or_absent_policy_limit_is_not_compared_never_a_crash(self):
        root, spec = _project(self.tmp)
        _budget_files(root, policy=("[limits]\nmax_tokens_per_story = \"2000000\"\n"
                                    "session_timeout_min = 90\n"))
        self._wire(_FakeSubstrate())
        result = launch.check(root, spec)
        self.assertTrue(result["ok"], result["gaps"])
        budget = result["budget"]
        not_compared = {n["limit"]: n["reason"] for n in budget["not_compared"]}
        self.assertEqual(not_compared["max_tokens_per_story"], "not a number in policy")
        self.assertEqual(not_compared["max_review_cycles"], "absent from policy")
        self.assertEqual(budget["compared"], [])
        self.assertEqual(budget["budget_mismatch"], [])

    def test_every_exceeded_limit_is_named_at_once(self):
        root, spec = _project(self.tmp)
        _budget_files(root, review_cycles=1)
        fake = self._wire(_FakeSubstrate())
        mismatch = launch.check(root, spec)["budget"]["budget_mismatch"]
        self.assertEqual({m["limit"]: (m["policy"], m["band_value"]) for m in mismatch},
                         {"max_tokens_per_story": (2000000, 5000000),
                          "max_review_cycles": (1, 2)})
        code, parsed = self._cli(["check", "--directory", str(root), "--spec", spec])
        self.assertEqual(code, 0)
        self.assertEqual(parsed["status"], "partial")
        both = ("max_tokens_per_story 2000000 <", "weighted_tokens 5000000",
                "max_review_cycles 1 <", "review_cycles_max 2")
        for text in both:
            self.assertIn(text, parsed["reason"])
        with self.assertRaises(launch.LaunchError) as ctx:
            launch.start(root, spec, wait_s=2)
        for text in both:
            self.assertIn(text, str(ctx.exception))
        code, parsed = self._cli(["start", "--directory", str(root), "--spec", spec,
                                  "--wait", "2"])
        self.assertEqual(code, 2)
        self.assertEqual(parsed["status"], "blocked")
        self.assertEqual(len(parsed["budget"]["budget_mismatch"]), 2)
        self.assertIn("max_tokens_per_story", parsed["reason"])
        self.assertIn("max_review_cycles", parsed["reason"])
        self.assertEqual(fake.spawned, [])

    def test_start_acknowledged_mismatch_launches(self):
        root, spec = _project(self.tmp)
        _budget_files(root)
        fake = self._wire(_FakeSubstrate())
        code, parsed = self._cli(["start", "--directory", str(root), "--spec", spec,
                                  "--wait", "2", "--allow-budget-mismatch"])
        self.assertEqual(code, 0)
        self.assertEqual(len(fake.spawned), 1)
        self.assertEqual(parsed["status"], "complete")
        self.assertEqual(parsed["artifacts"], [parsed["run_dir"], parsed["spec_folder"]])
        self.assertEqual(len(parsed["budget"]["budget_mismatch"]), 1)

    def test_policy_file_is_byte_identical_after_check_and_start(self):
        root, spec = _project(self.tmp)
        policy = _budget_files(root)
        before = _sha(policy)
        self._wire(_FakeSubstrate())
        self._cli(["check", "--directory", str(root), "--spec", spec])
        self._cli(["start", "--directory", str(root), "--spec", spec, "--wait", "2"])
        self._cli(["start", "--directory", str(root), "--spec", spec, "--wait", "2",
                   "--allow-budget-mismatch"])
        self.assertEqual(_sha(policy), before)


if __name__ == "__main__":
    unittest.main()
