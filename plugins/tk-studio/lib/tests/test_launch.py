"""Tests for the launch surface (tk-studio-launch, studio pipeline decision 5).

The core is exercised against a fake substrate: `run_cli` and
`spawn_detached` are injected, so no bmad-loop is needed and nothing is
launched. What must hold: readiness names every gap and launches nothing;
a live engine on the checkout refuses; a launch answers ok only once the
engine acknowledged the pre-minted id; status answers without the CLI on a
project that never ran; the CLI keeps the JSON/exit-code house shape.
"""
from __future__ import annotations

import contextlib
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
        self.assertTrue(json.loads(out.getvalue())["ok"])

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = launch.main(["start", "--directory", str(root), "--spec", spec, "--wait", "2"])
        self.assertEqual(code, 0)
        parsed = json.loads(out.getvalue())
        self.assertTrue(parsed["ok"])
        self.assertTrue(re.match(r"^\d{8}-\d{6}-[0-9a-f]{4}$", parsed["run_id"]))

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


if __name__ == "__main__":
    unittest.main()
