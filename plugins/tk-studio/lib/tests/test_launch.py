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


def _absent_sbx(args, timeout=None):
    raise FileNotFoundError(args[0])


class _FakeSbx:
    """Scripted sbx for the engine-sandbox row: `daemon status` and `ls`
    (the `SANDBOX AGENT STATUS` header and the rows); records every argv."""

    def __init__(self, rows=None, *, daemon_rc=0, ls_rc=0):
        self.rows = rows or {}
        self.daemon_rc = daemon_rc
        self.ls_rc = ls_rc
        self.calls: list[list[str]] = []

    def __call__(self, args, timeout=None):
        import subprocess
        self.calls.append(list(args))
        if args[1:] == ["daemon", "status"]:
            return subprocess.CompletedProcess(args, self.daemon_rc, "running" if not self.daemon_rc else "", "")
        if args[1:] == ["ls"]:
            out = "SANDBOX   AGENT   STATUS\n" + "".join(
                f"{sb}   claude   {status}\n" for sb, status in self.rows.items())
            return subprocess.CompletedProcess(args, self.ls_rc, out if not self.ls_rc else "", "")
        return subprocess.CompletedProcess(args, 2, "", "unsupported")


class LaunchTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        os.environ["TK_STUDIO_HOME"] = str(self.tmp / "store")
        self._orig = (launch.run_cli, launch.spawn_detached, launch._bmad_loop_binary,
                      launch.run_sbx)
        launch._bmad_loop_binary = lambda: "bmad-loop"
        # Story 33.3: never a live sbx — no config named, and sbx absent
        self._old_config = os.environ.pop("TK_SUPERVISOR_CONFIG", None)
        launch.run_sbx = _absent_sbx

    def tearDown(self):
        (launch.run_cli, launch.spawn_detached, launch._bmad_loop_binary,
         launch.run_sbx) = self._orig
        os.environ.pop("TK_SUPERVISOR_CONFIG", None)
        if self._old_config is not None:
            os.environ["TK_SUPERVISOR_CONFIG"] = self._old_config
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

    # ---- the tracked [verify] commands (Story 33.5)

    ROSTER = "uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster"
    PLUGIN_SRC = "plugins/tk-studio/pipeline/verify-commands.toml"
    CONFIG_SRC = ".tk-studio/config.yaml engine.verify_commands"
    LIMITS = "[limits]\nmax_review_cycles = 3\nmax_tokens_per_story = 2000000\n"
    ROUTING = ("# >>> routing (managed by tk-studio lib/pipeline.py) — do not edit inside this block\n"
               "# story: 2-1-1\n[adapter.dev]\nmodel = \"opus\"\n# <<< routing\n")

    def _verify_project(self, policy: str | None, *, plugin: list | str | None = None,
                        config: str | None = None, newline: str = "\n"):
        root, spec = _project(Path(tempfile.mkdtemp(dir=self.tmp)))
        policy_path = root / ".bmad-loop" / "policy.toml"
        if policy is not None:
            policy_path.parent.mkdir(parents=True, exist_ok=True)
            policy_path.write_bytes(policy.replace("\n", newline).encode("utf-8"))
        if plugin is not None:
            path = root / self.PLUGIN_SRC
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(plugin if isinstance(plugin, str)
                            else "commands = " + json.dumps(plugin) + "\n", encoding="utf-8")
        if config is not None:
            (root / ".tk-studio").mkdir(parents=True, exist_ok=True)
            (root / ".tk-studio" / "config.yaml").write_text(config, encoding="utf-8")
        self._wire(_FakeSubstrate())
        return root, spec, policy_path

    def _verify_check(self, root, spec):
        result = launch.check(root, spec)
        row = next(c for c in result["checks"] if c["check"] == "verify commands")
        return result, row, result["verify_commands"]

    def test_verify_adds_the_table_before_the_routing_fence(self):
        policy = "[gates]\nmode = \"per-epic\"\n\n" + self.LIMITS + "\n" + self.ROUTING
        root, spec, path = self._verify_project(policy, plugin=[self.ROSTER])
        result, row, key = self._verify_check(root, spec)
        self.assertTrue(row["ok"])
        self.assertEqual(row["detail"], f"added 1 from {self.PLUGIN_SRC}; kept 0 operator commands")
        self.assertEqual(key, {"source": self.PLUGIN_SRC, "tracked": [self.ROSTER],
                               "added": [self.ROSTER], "kept": [], "policy": "written"})
        text = path.read_text(encoding="utf-8")
        self.assertEqual(text, "[gates]\nmode = \"per-epic\"\n\n" + self.LIMITS + "\n"
                         + "[verify]\ncommands = [" + json.dumps(self.ROSTER) + "]\n\n"
                         + self.ROUTING)
        self.assertTrue(text.endswith(self.ROUTING))  # the managed block stays last
        self.assertIn(self.LIMITS, text)
        self.assertTrue(result["ok"], result["gaps"])
        # a second check: unchanged, byte-identical
        before = _sha(path)
        _, row, key = self._verify_check(root, spec)
        self.assertEqual(row["detail"], "unchanged (1 tracked, 0 operator)")
        self.assertEqual(key["policy"], "unchanged")
        self.assertEqual(_sha(path), before)

    def test_verify_appends_after_an_operator_extra(self):
        policy = self.LIMITS + "\n[verify]\ncommands = [\"make lint\"]  # ops\n\n" + self.ROUTING
        root, spec, path = self._verify_project(policy, plugin=[self.ROSTER])
        _, row, key = self._verify_check(root, spec)
        self.assertEqual(key["added"], [self.ROSTER])
        self.assertEqual(key["kept"], ["make lint"])
        self.assertEqual(row["detail"], f"added 1 from {self.PLUGIN_SRC}; kept 1 operator commands")
        import tomllib
        parsed = tomllib.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(parsed["verify"]["commands"], ["make lint", self.ROSTER])
        self.assertIn("]  # ops\n", path.read_text(encoding="utf-8"))

    def test_verify_already_present_is_unchanged_and_byte_identical(self):
        policy = (self.LIMITS + "\n[verify]\ncommands = [\"x\", " + json.dumps(self.ROSTER)
                  + "]\n\n" + self.ROUTING)
        root, spec, path = self._verify_project(policy, plugin=[self.ROSTER])
        before = _sha(path)
        _, row, key = self._verify_check(root, spec)
        self.assertEqual(row["detail"], "unchanged (1 tracked, 1 operator)")
        self.assertEqual(key, {"source": self.PLUGIN_SRC, "tracked": [self.ROSTER],
                               "added": [], "kept": ["x"], "policy": "unchanged"})
        self.assertEqual(_sha(path), before)

    def test_verify_multi_line_array_is_replaced_by_one_line(self):
        policy = (self.LIMITS + "\n[verify]\ncommands = [\n  \"a ] b\",  # a comment ]\n"
                  "  'lit',\n]\ntimeout_min = 5\n\n" + self.ROUTING)
        root, spec, path = self._verify_project(policy, plugin=[self.ROSTER])
        _, _, key = self._verify_check(root, spec)
        self.assertEqual(key["policy"], "written")
        text = path.read_text(encoding="utf-8")
        self.assertIn("[verify]\ncommands = [\"a ] b\", \"lit\", " + json.dumps(self.ROSTER)
                      + "]\ntimeout_min = 5\n", text)

    def test_verify_table_without_commands_gets_the_line_after_its_header(self):
        policy = self.LIMITS + "\n[verify]\ntimeout_min = 5\n"
        root, spec, path = self._verify_project(policy, plugin=[self.ROSTER])
        self._verify_check(root, spec)
        self.assertEqual(path.read_text(encoding="utf-8"), self.LIMITS
                         + "\n[verify]\ncommands = [" + json.dumps(self.ROSTER) + "]\ntimeout_min = 5\n")

    def test_verify_keeps_crlf(self):
        policy = self.LIMITS + "\n" + self.ROUTING
        root, spec, path = self._verify_project(policy, plugin=[self.ROSTER], newline="\r\n")
        _, _, key = self._verify_check(root, spec)
        self.assertEqual(key["policy"], "written")
        raw = path.read_bytes()
        self.assertEqual(raw.count(b"\n"), raw.count(b"\r\n"))
        self.assertIn(b"[verify]\r\ncommands = [", raw)

    def test_verify_keeps_crlf_with_an_existing_verify_table(self):
        cases = [
            ("with commands", "[verify]\ncommands = [\"make lint\"]\n", ["make lint", self.ROSTER],
             None),
            ("without commands", "[verify]\ntimeout_min = 5\n", [self.ROSTER], "timeout_min = 5"),
            ("commands and an extra key", "[verify]\ncommands = [\"make lint\"]\ntimeout_min = 5\n",
             ["make lint", self.ROSTER], "timeout_min = 5"),
        ]
        import tomllib
        for name, table, commands, extra in cases:
            with self.subTest(name):
                policy = self.LIMITS + "\n" + table + "\n" + self.ROUTING
                root, spec, path = self._verify_project(policy, plugin=[self.ROSTER],
                                                        newline="\r\n")
                _, row, key = self._verify_check(root, spec)
                self.assertEqual(key["policy"], "written", row)
                raw = path.read_bytes()
                self.assertEqual(raw.count(b"\n"), raw.count(b"\r\n"))
                self.assertIn(b"[verify]\r\ncommands = [", raw)
                parsed = tomllib.loads(raw.decode("utf-8"))
                self.assertEqual(parsed["verify"]["commands"], commands)
                if extra is not None:
                    self.assertIn(extra.encode("utf-8") + b"\r\n", raw)
                    self.assertEqual(parsed["verify"]["timeout_min"], 5)

    def test_verify_restores_the_original_when_the_re_read_mismatches(self):
        policy = self.LIMITS + "\n" + self.ROUTING
        root, spec, path = self._verify_project(policy, plugin=[self.ROSTER])
        before = path.read_bytes()
        real = launch._write_atomic
        calls = []

        def corrupting(target, data):
            calls.append(data)
            real(target, data.replace(b"[limits]", b"[limitz]") if len(calls) == 1 else data)

        launch._write_atomic = corrupting
        try:
            result, row, key = self._verify_check(root, spec)
        finally:
            launch._write_atomic = real
        self.assertEqual(len(calls), 2)  # the write, then the restore
        self.assertEqual(path.read_bytes(), before)
        self.assertFalse(row["ok"])
        self.assertIn(".bmad-loop/policy.toml", row["detail"])
        self.assertIn("fix it by hand", row["detail"])
        self.assertEqual(key["policy"], "refused")
        self.assertTrue(any(g.startswith("verify commands: ") for g in result["gaps"]))

    def test_verify_ignores_the_key_in_config_local(self):
        local = "engine:\n  verify_commands:\n    - make local\n"
        for plugin in ([self.ROSTER], None):
            with self.subTest(plugin=plugin):
                root, spec, path = self._verify_project(self.LIMITS, plugin=plugin,
                                                        config="vcs: git\n")
                (root / ".tk-studio" / "config.local.yaml").write_text(local, encoding="utf-8")
                _, _, key = self._verify_check(root, spec)
                self.assertNotIn("make local", path.read_text(encoding="utf-8"))
                if plugin:
                    self.assertEqual(key["source"], self.PLUGIN_SRC)
                    self.assertEqual(key["added"], [self.ROSTER])
                else:
                    self.assertIsNone(key["source"])
                    self.assertEqual(key["policy"], "skipped (no tracked list)")

    def test_verify_config_key_overrides_the_plugin_file(self):
        config = "vcs: git\nengine:\n  verify_commands:\n    - make check\n"
        root, spec, path = self._verify_project(self.LIMITS, plugin=[self.ROSTER], config=config)
        _, row, key = self._verify_check(root, spec)
        self.assertEqual(key["source"], self.CONFIG_SRC)
        self.assertEqual(key["added"], ["make check"])
        self.assertIn(f"from {self.CONFIG_SRC}", row["detail"])
        self.assertNotIn(self.ROSTER, path.read_text(encoding="utf-8"))

    def test_verify_empty_config_list_writes_nothing(self):
        config = "engine:\n  verify_commands:\n"
        root, spec, path = self._verify_project(self.LIMITS, plugin=[self.ROSTER], config=config)
        before = _sha(path)
        _, row, key = self._verify_check(root, spec)
        self.assertEqual(key, {"source": self.CONFIG_SRC, "tracked": [], "added": [],
                               "kept": [], "policy": "unchanged"})
        self.assertEqual(row["detail"], "unchanged (0 tracked, 0 operator)")
        self.assertEqual(_sha(path), before)

    def test_verify_no_source_is_skipped_and_byte_identical(self):
        root, spec, path = self._verify_project(self.LIMITS + "\n" + self.ROUTING,
                                                config="vcs: git\n")
        before = _sha(path)
        result, row, key = self._verify_check(root, spec)
        self.assertEqual(row, {"check": "verify commands", "ok": True,
                               "detail": "skipped (no tracked list)"})
        self.assertEqual(key, {"source": None, "tracked": [], "added": [], "kept": [],
                               "policy": "skipped (no tracked list)"})
        self.assertEqual(_sha(path), before)
        self.assertTrue(result["ok"], result["gaps"])

    def test_verify_no_policy_is_skipped_and_never_created(self):
        root, spec, path = self._verify_project(None, plugin=[self.ROSTER])
        result, row, key = self._verify_check(root, spec)
        skip = "skipped (no .bmad-loop/policy.toml; bmad-loop init creates it)"
        self.assertEqual(row["detail"], skip)
        self.assertTrue(row["ok"])
        self.assertEqual(key["policy"], skip)
        self.assertFalse(path.exists())
        self.assertTrue(result["ok"], result["gaps"])

    def test_verify_refusals_are_named_gaps_and_leave_the_policy_alone(self):
        good = self.LIMITS + "\n" + self.ROUTING
        cases = [
            ("unparseable source", good, "commands = [\n", None, self.PLUGIN_SRC),
            ("non-list source", good, 'commands = "x"\n', None, self.PLUGIN_SRC),
            ("non-string item", good, "commands = [1]\n", None, self.PLUGIN_SRC),
            ("non-string config item", good, None,
             "engine:\n  verify_commands:\n    - 3\n", ".tk-studio/config.yaml"),
            ("unparseable config", good, [self.ROSTER], "engine: [\n", ".tk-studio/config.yaml"),
            ("unparseable policy", "[limits\n", [self.ROSTER], None, ".bmad-loop/policy.toml"),
            ("non-list commands", "[verify]\ncommands = \"x\"\n", [self.ROSTER], None,
             ".bmad-loop/policy.toml"),
            ("non-string command", "[verify]\ncommands = [1]\n", [self.ROSTER], None,
             ".bmad-loop/policy.toml"),
            ("dotted key", "verify.commands = [\"x\"]\n" + good, [self.ROSTER], None,
             ".bmad-loop/policy.toml"),
            ("inline table", "verify = { commands = [\"x\"] }\n" + good, [self.ROSTER], None,
             ".bmad-loop/policy.toml"),
        ]
        for name, policy, plugin, config, named in cases:
            with self.subTest(name):
                root, spec, path = self._verify_project(policy, plugin=plugin, config=config)
                before = _sha(path)
                result, row, key = self._verify_check(root, spec)
                self.assertFalse(row["ok"])
                self.assertIn(named, row["detail"])
                self.assertIn("fix it by hand", row["detail"])
                self.assertEqual(key["policy"], "refused")
                self.assertFalse(result["ok"])
                self.assertTrue(any(g.startswith("verify commands: ") for g in result["gaps"]))
                self.assertEqual(launch.check_block(result)[0], "blocked")
                self.assertEqual(_sha(path), before)

    def test_verify_key_is_on_every_check_result(self):
        result = launch.check(self.tmp / "missing", "_bmad-output/specs/spec-epic-2")
        self.assertIn("verify_commands", result)
        root, spec, _ = self._verify_project(None)
        launch._bmad_loop_binary = lambda: None  # the bmad-loop early return
        self.assertEqual(launch.check(root, spec)["verify_commands"]["source"], None)
        self.assertIn("verify_commands", launch.check(root, "_bmad-output/specs/none"))

    def test_start_reconciles_before_the_spawn(self):
        policy = self.LIMITS + "\n" + self.ROUTING
        root, spec, path = self._verify_project(policy, plugin=[self.ROSTER])
        seen = []
        fake = _FakeSubstrate()

        def spawn(args, *, cwd, log_path):
            seen.append(path.read_text(encoding="utf-8"))
            return fake.spawn_detached(args, cwd=cwd, log_path=log_path)

        launch.spawn_detached = spawn
        result = launch.start(root, spec, wait_s=2)
        self.assertTrue(result["ok"])
        self.assertEqual(len(seen), 1)
        self.assertIn("[verify]\ncommands = [" + json.dumps(self.ROSTER) + "]", seen[0])
        row = next(c for c in result["checks"] if c["check"] == "verify commands")
        self.assertTrue(row["detail"].startswith("added 1 from "))

    # ---- the engine-gate placement clause (Story 34.4)

    GATE = "bash scripts/engine-gate.sh"

    def test_engine_gate_in_the_sandbox_list(self):
        config = (f"verify:\n  engine: {self.GATE}\nengine:\n  verify_commands:\n"
                  f"    - '  {self.GATE}  '\n")
        root, spec, _ = self._verify_project(self.LIMITS, config=config)
        result, row, _ = self._verify_check(root, spec)
        self.assertTrue(row["ok"])
        self.assertTrue(row["detail"].endswith(
            "; engine gate: sandbox and host leg (engine.verify_commands, verify.engine)"),
            row["detail"])

    def test_engine_gate_on_the_host_leg(self):
        for config in (f"verify:\n  engine: {self.GATE}\n",
                       f"verify:\n  engine: {self.GATE}\nengine:\n  verify_commands:\n"
                       "    - make check\n"):
            with self.subTest(config=config):
                root, spec, _ = self._verify_project(self.LIMITS, plugin=[self.ROSTER],
                                                     config=config)
                result, row, _ = self._verify_check(root, spec)
                self.assertTrue(row["ok"])
                self.assertTrue(row["detail"].endswith(
                    "; engine gate: host leg (verify.engine, Story 34.1)"), row["detail"])
                self.assertTrue(result["ok"], result["gaps"])

    def test_engine_gate_none_warns_when_the_skill_is_in_a_working_set(self):
        config = "working_set:\n  developer:\n    - bmm\n    - gds-engine-godot-4\n"
        root, spec, _ = self._verify_project(self.LIMITS, plugin=[self.ROSTER], config=config)
        result, row, _ = self._verify_check(root, spec)
        self.assertTrue(row["ok"])
        self.assertIn("warning: engine gate: none (set verify.engine for the host leg, "
                      "or add the gate to engine.verify_commands only in a WITH_GODOT "
                      "sandbox)", row["detail"])
        self.assertTrue(result["ok"], result["gaps"])

    def test_engine_gate_sandbox_list_only_without_verify_engine(self):
        config = ("engine:\n  verify_commands:\n    - make check\n"
                  "working_set:\n  developer:\n    - gds-engine-godot-4\n")
        root, spec, _ = self._verify_project(self.LIMITS, config=config)
        result, row, _ = self._verify_check(root, spec)
        self.assertTrue(row["ok"])
        self.assertTrue(row["detail"].endswith(
            "; engine gate: sandbox list only (engine.verify_commands; not identified "
            "without verify.engine)"), row["detail"])
        self.assertNotIn("warning", row["detail"])
        self.assertTrue(result["ok"], result["gaps"])
        # an empty list is still the warning
        config = ("engine:\n  verify_commands:\n"
                  "working_set:\n  developer:\n    - gds-engine-godot-4\n")
        root, spec, _ = self._verify_project(self.LIMITS, config=config)
        _, row, _ = self._verify_check(root, spec)
        self.assertIn("warning: engine gate: none (", row["detail"])

    def test_engine_gate_clause_absent_without_gate_or_skill(self):
        root, spec, _ = self._verify_project(
            self.LIMITS, plugin=[self.ROSTER],
            config="working_set:\n  developer:\n    - bmm\n")
        _, row, _ = self._verify_check(root, spec)
        self.assertNotIn("engine gate", row["detail"])

    def test_engine_gate_reads_only_the_tracked_config(self):
        root, spec, _ = self._verify_project(self.LIMITS, plugin=[self.ROSTER],
                                             config="vcs: git\n")
        (root / ".tk-studio" / "config.local.yaml").write_text(
            f"verify:\n  engine: {self.GATE}\n", encoding="utf-8")
        _, row, _ = self._verify_check(root, spec)
        self.assertNotIn("engine gate", row["detail"])

    def test_engine_gate_clause_never_turns_a_refusal_green_or_a_skip_red(self):
        config = f"verify:\n  engine: {self.GATE}\n"
        root, spec, _ = self._verify_project(None, plugin=[self.ROSTER], config=config)
        _, row, _ = self._verify_check(root, spec)
        self.assertTrue(row["ok"])
        self.assertIn("engine gate: host leg", row["detail"])
        root, spec, _ = self._verify_project("[limits\n", plugin=[self.ROSTER], config=config)
        _, row, _ = self._verify_check(root, spec)
        self.assertFalse(row["ok"])  # the policy refusal stays a gap



    # ---- the engine sandbox row (Story 33.3)

    def _engine_row(self, sbx, config: str | None = 'jobs:\n  "p/run-epic":\n    tier: sbx\n    sandbox: claude-p\n'):
        base = Path(tempfile.mkdtemp(dir=self.tmp))  # one project per call
        os.environ.pop("TK_SUPERVISOR_CONFIG", None)
        if config is not None:
            path = base / "supervisor.yaml"
            path.write_text(config, encoding="utf-8")
            os.environ["TK_SUPERVISOR_CONFIG"] = str(path)
        if sbx is not None:
            launch.run_sbx = sbx
        root, spec = _project(base)
        self._wire(_FakeSubstrate())
        result = launch.check(root, spec)
        names = [c["check"] for c in result["checks"]]
        row = next(c for c in result["checks"] if c["check"] == "engine sandbox")
        self.assertEqual(names.index("engine sandbox"), names.index("studio-pipeline plugin") + 1)
        self.assertTrue(row["ok"])
        self.assertTrue(result["ok"], result["gaps"])
        self.assertFalse(any("engine sandbox" in g for g in result["gaps"]))
        return row, result

    def test_engine_sandbox_running_without_a_pin_record_is_a_warning_never_a_gap(self):
        sbx = _FakeSbx({"claude-p": "running"})
        row, result = self._engine_row(sbx)
        self.assertEqual(row["detail"],
                         "warning: claude-p started outside the supervisor; the next pin restarts it")
        self.assertEqual(result["gaps"], [])
        self.assertEqual(sbx.calls, [["sbx", "daemon", "status"], ["sbx", "ls"]])

    def test_engine_sandbox_with_the_supervisors_pin_record_reads_pinned(self):
        record = Path(os.environ["TK_STUDIO_HOME"]) / "sandboxes" / "claude-p.pin"
        record.parent.mkdir(parents=True)
        record.write_text(json.dumps({"sandbox": "claude-p", "since": "2026-10-26T00:00:00Z",
                                      "run_id": "q-1", "supervisor_pid": 1}), encoding="utf-8")
        self.assertEqual(launch.pin_record_path("claude-p"), record)
        row, _ = self._engine_row(_FakeSbx({"claude-p": "running"}))
        self.assertEqual(row["detail"], "pinned by the supervisor")

    def test_engine_sandbox_not_running_stopped_unlisted_or_ls_failing(self):
        for sbx in (_FakeSbx({"claude-p": "stopped"}), _FakeSbx({"claude-p-two": "running"}),
                    _FakeSbx({"claude-p": "running"}, ls_rc=1)):
            with self.subTest(rows=sbx.rows, ls_rc=sbx.ls_rc):
                row, _ = self._engine_row(sbx)
                self.assertEqual(row["detail"], "not running")

    def test_engine_sandbox_none_configured_absent_sbx_or_daemon_down(self):
        row, _ = self._engine_row(None, config=None)
        self.assertEqual(row["detail"], "no engine sandbox configured")
        row, _ = self._engine_row(_absent_sbx)
        self.assertEqual(row["detail"], "sbx absent")
        down = _FakeSbx({"claude-p": "running"}, daemon_rc=1)
        row, _ = self._engine_row(down)
        self.assertEqual(row["detail"], "daemon down")
        self.assertEqual(down.calls, [["sbx", "daemon", "status"]])  # no sbx ls after a down daemon

    def test_engine_sandbox_several_sandboxes_are_named_each(self):
        config = ('jobs:\n  "p/a":\n    sandbox: claude-p\n'
                  '  "p/b":\n    sandbox: claude-q\n')
        row, _ = self._engine_row(_FakeSbx({"claude-p": "running", "claude-q": "stopped"}), config=config)
        self.assertEqual(row["detail"],
                         "warning: claude-p started outside the supervisor; the next pin restarts it; "
                         "claude-q: not running")

    # ---- the playable path row (Story 34.2)

    GAME_CONFIG = "verify:\n  host: bash scripts/verify.sh\n  engine: bash scripts/engine-gate.sh\n"

    def _playable_row(self, *, config: str | None = GAME_CONFIG, godot: str | None = "file",
                      display=lambda env=None: True):
        base = Path(tempfile.mkdtemp(dir=self.tmp))
        root, spec = _project(base)
        if config is not None:
            (root / ".tk-studio").mkdir(parents=True, exist_ok=True)
            (root / ".tk-studio" / "config.yaml").write_text(config, encoding="utf-8")
        old_godot = os.environ.pop("GODOT", None)
        self.addCleanup(lambda: os.environ.__setitem__("GODOT", old_godot)
                        if old_godot is not None else os.environ.pop("GODOT", None))
        if godot == "file":
            exe = base / "Godot_v4.7.2-stable_mono_win64_console.exe"
            exe.write_bytes(b"")
            os.environ["GODOT"] = str(exe)
        elif godot is not None:
            os.environ["GODOT"] = godot
        orig = launch.display_session
        self.addCleanup(setattr, launch, "display_session", orig)
        launch.display_session = display
        self._wire(_FakeSubstrate())
        result = launch.check(root, spec)
        names = [c["check"] for c in result["checks"]]
        row = next(c for c in result["checks"] if c["check"] == "playable path")
        self.assertEqual(names.index("playable path"), names.index("engine sandbox") + 1)
        self.assertTrue(row["ok"])
        self.assertTrue(result["ok"], result["gaps"])
        self.assertFalse(any("playable path" in g for g in result["gaps"]))
        return row

    def test_playable_path_not_a_game_project_without_verify_engine(self):
        self.assertEqual(self._playable_row(config=None)["detail"],
                         "not a game project (no verify.engine)")
        self.assertEqual(self._playable_row(config="verify:\n  host: bash x.sh\n")["detail"],
                         "not a game project (no verify.engine)")

    def test_playable_path_warns_without_godot(self):
        want = "warning: no $env:GODOT (unset or not an absolute file); playable runs refuse"
        for godot in (None, "   ", "godot", str(self.tmp / "missing.exe")):
            with self.subTest(godot=godot):
                self.assertEqual(self._playable_row(godot=godot)["detail"], want)

    def test_playable_path_warns_without_a_display_session(self):
        row = self._playable_row(display=lambda env=None: False)
        self.assertEqual(row["detail"], f"warning: no display session; the "
                                        f"{launch.PLAYABLE_PATH} path needs the logged-in desktop")

    def test_playable_path_display_probe_raising_never_raises_out_of_check(self):
        def boom(env=None):
            raise OSError("user32 unavailable")
        row = self._playable_row(display=boom)
        self.assertEqual(row["detail"], "warning: display session unknown (user32 unavailable)")

    def test_playable_path_ready(self):
        self.assertEqual(self._playable_row()["detail"], f"ready ({launch.PLAYABLE_PATH})")

    def test_display_session_posix_reads_display_or_wayland(self):
        if sys.platform == "win32":
            self.skipTest("POSIX probe")
        self.assertTrue(launch.display_session({"DISPLAY": ":0"}))
        self.assertTrue(launch.display_session({"WAYLAND_DISPLAY": "wayland-0"}))
        self.assertFalse(launch.display_session({}))



if __name__ == "__main__":
    unittest.main()
