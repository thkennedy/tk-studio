"""Story 35.8 — every stage leaves a start and a stop.

The I/O matrix of the story's spec: the engine pass's rows from a fixture
run dir (state.json sessions, journal ts, transcripts with usage lines, a
consult subagent), the buffer before the spec exists, duplicate writes, the
operator's --start/--stop, the supervisor's --append, the Jira poster over
an in-process fake (ok, failure then retry, lost state, not bound), the
rollup and the measurepush harvest.
"""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config as configlib  # noqa: E402
import interchange  # noqa: E402
import jirabackend  # noqa: E402
import ledger  # noqa: E402
import measurepush  # noqa: E402
import plansync  # noqa: E402
import report  # noqa: E402

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = PLUGIN_ROOT.parents[1]
METER_HOOK = REPO_ROOT / ".bmad-loop" / "plugins" / "studio-pipeline" / "meter_hook.py"
KEY = "35-8-every-stage-leaves-a-start-and-a-stop"
MODEL = "claude-opus-5-5"
SPEC_TEXT = """---
title: 'Every Stage Leaves a Start and a Stop'
status: 'in-progress'
---

<intent-contract>

## Intent

text

</intent-contract>

## Consult Log

- a consult entry

## Auto Run Result

result
"""


def usage_line(mid, inp=0, out=0, cr=0, cw5=0, ts="2026-10-28T23:41:30.000Z"):
    return {"type": "assistant", "timestamp": ts,
            "message": {"id": mid, "model": MODEL, "usage": {
                "input_tokens": inp, "output_tokens": out,
                "cache_read_input_tokens": cr,
                "cache_creation_input_tokens": cw5,
                "cache_creation": {"ephemeral_5m_input_tokens": cw5,
                                   "ephemeral_1h_input_tokens": 0}}}}


def user_line(text, ts):
    return {"type": "user", "timestamp": ts,
            "message": {"role": "user", "content": [{"type": "text", "text": text}]}}


def epoch(iso: str) -> float:
    return plansync.stage_moment(iso).timestamp()


class StageFixture(unittest.TestCase):
    """A project root with a spec folder and a run dir the engine fills one
    session at a time (`add_pass`), as bmad-loop records it."""

    ENV_KEYS = ("TK_STUDIO_HOME", jirabackend.TOKEN_ENV, jirabackend.EMAIL_ENV,
                *jirabackend.AGENT_ENV_NAMES)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self._saved = {k: os.environ.get(k) for k in self.ENV_KEYS}
        for k in self.ENV_KEYS:
            os.environ.pop(k, None)
        os.environ["TK_STUDIO_HOME"] = str(self.tmp / "store")
        self.root = self.tmp / "proj"
        self.stories = self.root / "_bmad-output" / "specs" / "spec-epic-35" / "stories"
        self.stories.mkdir(parents=True)
        self.spec = self.stories / f"{KEY}-spec.md"
        self.run_dir = self.root / ".bmad-loop" / "runs" / "20261028-234105-ee1e"
        self.run_dir.mkdir(parents=True)
        (self.root / ".bmad-loop" / "routing.current.json").write_text(json.dumps({
            "implementer": {"model": MODEL, "effort": "medium"},
            "reviewers": {"model": MODEL, "effort": "high"},
            "consult": {"model": MODEL, "effort": "low"},
            "planner": {"model": MODEL, "effort": "high"}}), encoding="utf-8")
        self.state = {"run_id": "20261028-234105-ee1e",
                      "spec_folder": "_bmad-output/specs/spec-epic-35",
                      "tasks": {KEY: {"story_key": KEY, "sessions": []}}}
        self._save_state()
        self.claude = self.tmp / "claude"
        self.claude.mkdir()

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self._tmp.cleanup()

    def _save_state(self):
        (self.run_dir / "state.json").write_text(json.dumps(self.state), encoding="utf-8")

    def add_pass(self, label, role, start, end, lines, subagents=None, status="completed",
                 workflow_stage=None):
        sessions = self.state["tasks"][KEY]["sessions"]
        n = 1 + sum(1 for s in sessions if s["task_id"].rsplit("-", 1)[0] == f"{KEY}-{label}")
        task_id = f"{KEY}-{label}-{n}"
        sid = f"sess-{label}-{n}"
        transcript = self.claude / f"{sid}.jsonl"
        transcript.write_text("".join(json.dumps(r) + "\n" for r in lines), encoding="utf-8")
        for name, sub_lines in (subagents or {}).items():
            folder = self.claude / sid / "subagents"
            folder.mkdir(parents=True, exist_ok=True)
            (folder / f"{name}.jsonl").write_text(
                "".join(json.dumps(r) + "\n" for r in sub_lines), encoding="utf-8")
        sessions.append({"task_id": task_id, "role": role, "status": status, "model": MODEL,
                         "session_id": sid, "transcript_path": str(transcript), "usage": None})
        self._save_state()
        with (self.run_dir / "journal.jsonl").open("a", encoding="utf-8") as f:
            if workflow_stage:  # bmad-loop's _run_workflows journals the workflow first
                f.write(json.dumps({"ts": epoch(start), "kind": "workflow-start", "plugin": "studio-pipeline",
                                    "workflow": label, "stage": workflow_stage, "role": role,
                                    "story_key": KEY}) + "\n")
            f.write(json.dumps({"ts": epoch(start), "kind": "session-start", "task_id": task_id,
                                "role": role, "model": MODEL, "story_key": KEY}) + "\n")
            f.write(json.dumps({"ts": epoch(end), "kind": "session-end", "task_id": task_id,
                                "status": status, "tokens": 1}) + "\n")
        return task_id

    def from_pass(self, role="dev", phase="dev-running"):
        return plansync.stage_from_pass(self.root, self.run_dir, KEY, role=role, phase=phase)

    def cli(self, fn, argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = fn(argv)
        return code, json.loads(out.getvalue())

    def table(self):
        return plansync.parse_stage_log(self.spec.read_text(encoding="utf-8"))

    def engine_passes(self):
        """dev, review, review (one consult), gate — the hook after each."""
        self.spec.write_text(SPEC_TEXT, encoding="utf-8", newline="\n")
        self.add_pass("dev", "dev", "2026-10-28T23:41:00Z", "2026-10-28T23:52:10Z", [
            user_line("/bmad-build-auto …", "2026-10-28T23:41:01Z"),
            usage_line("m1", inp=1000, out=10, ts="2026-10-28T23:42:00Z"),  # superseded by its last line
            usage_line("m1", inp=100_000, out=50_000, cr=1_000_000, cw5=200_000),
            usage_line("m2", inp=0, out=0)])  # all-zero: skipped
        self.from_pass("dev", "dev-running")
        self.add_pass("review", "review", "2026-10-28T23:55:00Z", "2026-10-29T00:05:00Z", [
            usage_line("r1", inp=10_000, out=1_000)])
        self.from_pass("review", "review-running")
        consult = [user_line(plansync.CONSULT_MARKER + "\n\nYou are the consult…", "2026-10-29T00:10:00Z"),
                   {**usage_line("c1", inp=5_000, out=500, ts="2026-10-29T00:12:00Z"), "agentId": "a77"}]
        helper = [user_line("Implement the patch", "2026-10-29T00:08:00Z"),
                  usage_line("h1", inp=2_000, out=200, ts="2026-10-29T00:09:00Z")]
        self.add_pass("review", "review", "2026-10-29T00:06:00Z", "2026-10-29T00:20:00Z",
                      [usage_line("r2", inp=20_000, out=2_000)],
                      subagents={"agent-a77": consult, "agent-h1": helper})
        self.from_pass("review", "review-running")
        self.add_pass("studio-pipeline.gate", "review", "2026-10-29T00:21:00Z", "2026-10-29T00:25:00Z",
                      [usage_line("g1", inp=3_000, out=300)])
        self.from_pass("review", "committing")


class EnginePassTests(StageFixture):
    def test_hook_rows_dev_review_review_consult_gate(self):
        self.engine_passes()
        rows = self.table()
        self.assertEqual([(r["stage"], r["pass"]) for r in rows],
                         [("dev", "1"), ("review", "1"), ("review", "2"), ("consult", "1"), ("gate", "1")])
        dev = rows[0]
        self.assertEqual(dev["started"], "2026-10-28T23:41:00Z")
        self.assertEqual(dev["ended"], "2026-10-28T23:52:10Z")
        self.assertEqual(dev["session_id"], "sess-dev-1")
        self.assertEqual(dev["model"], MODEL)
        self.assertEqual(dev["effort"], "medium")
        # input + cache-read + cache-creation; the m1 line deduped (its last kept)
        self.assertEqual(dev["tokens_in"], str(100_000 + 1_000_000 + 200_000))
        self.assertEqual(dev["tokens_out"], "50000")
        self.assertEqual(dev["cost_usd"], "2.6000")  # 0.4 + 1.0 + 1.0 + 0.2 at prices.json
        self.assertEqual(dev["outcome"], "completed")
        # review 2 carries its helper subagent; the consult is its own row
        self.assertEqual(rows[2]["tokens_in"], "22000")
        consult = rows[3]
        self.assertEqual((consult["session_id"], consult["effort"], consult["tokens_in"], consult["tokens_out"]),
                         ("a77", "low", "5000", "500"))
        self.assertEqual((consult["started"], consult["ended"]), ("2026-10-29T00:10:00Z", "2026-10-29T00:12:00Z"))
        self.assertEqual(rows[4]["effort"], "high")
        text = self.spec.read_text(encoding="utf-8")
        self.assertIn(plansync.STAGE_HEADER_LINE, text)
        self.assertNotIn("elapsed", text)
        self.assertNotIn("duration", text)
        # placed after the Consult Log, before the Auto Run Result
        self.assertLess(text.index("## Consult Log"), text.index("## Stage Log"))
        self.assertLess(text.index("## Stage Log"), text.index("## Auto Run Result"))

    def test_a_second_hook_run_for_the_same_pass_appends_nothing(self):
        self.engine_passes()
        before = self.spec.read_bytes()
        result = self.from_pass("review", "committing")
        self.assertEqual(result["appended"], 0)
        self.assertEqual(self.spec.read_bytes(), before)

    def test_spec_not_yet_written_buffers_then_flushes_in_started_order(self):
        self.add_pass("dev", "dev", "2026-10-28T23:41:00Z", "2026-10-28T23:52:10Z",
                      [usage_line("m1", inp=10, out=1)])
        first = self.from_pass()
        self.assertTrue(first["buffered"])
        buffer = self.root / "_bmad-output/specs/spec-epic-35/stages" / f"{KEY}.jsonl"
        self.assertTrue(buffer.is_file())
        self.assertEqual(first["buffer"], buffer.relative_to(self.root).as_posix())
        # the planner's plan row, also before the spec, started earlier
        plansync.stage_start(self.root, "plan", story=KEY, now="2026-10-28T23:30:00Z")
        plansync.stage_stop(self.root, "plan", story=KEY, now="2026-10-28T23:40:00Z")
        self.spec.write_text(SPEC_TEXT, encoding="utf-8", newline="\n")
        self.add_pass("review", "review", "2026-10-28T23:55:00Z", "2026-10-29T00:05:00Z",
                      [usage_line("r1", inp=10, out=1)])
        result = self.from_pass("review", "review-running")
        self.assertEqual(result["flushed"], 2)
        self.assertEqual([(r["stage"], r["started"]) for r in self.table()],
                         [("plan", "2026-10-28T23:30:00Z"), ("dev", "2026-10-28T23:41:00Z"),
                          ("review", "2026-10-28T23:55:00Z")])
        self.assertFalse(buffer.exists())

    def test_a_failure_still_exits_zero_through_the_hook(self):
        env = {**os.environ, "BMAD_LOOP_STAGE": "post_session", "TK_STUDIO_ROOT": str(REPO_ROOT),
               "BMAD_LOOP_RUN_DIR": str(self.tmp / "no-such-run"), "BMAD_LOOP_STORY_KEY": KEY,
               "BMAD_LOOP_WORKTREE": str(self.root), "BMAD_LOOP_ROLE": "dev"}
        proc = subprocess.run([sys.executable, str(METER_HOOK)], env=env, capture_output=True,
                              text=True, encoding="utf-8", timeout=120)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("stage log", proc.stderr)
        self.assertFalse(json.loads(proc.stdout.strip().splitlines()[-1])["stage_log"]["ok"])

    def test_the_hook_writes_the_row_on_post_session(self):
        self.spec.write_text(SPEC_TEXT, encoding="utf-8", newline="\n")
        self.add_pass("dev", "dev", "2026-10-28T23:41:00Z", "2026-10-28T23:52:10Z",
                      [usage_line("m1", inp=10, out=1)])
        env = {**os.environ, "BMAD_LOOP_STAGE": "post_session", "TK_STUDIO_ROOT": str(REPO_ROOT),
               "BMAD_LOOP_RUN_DIR": str(self.run_dir), "BMAD_LOOP_STORY_KEY": KEY,
               "BMAD_LOOP_WORKTREE": str(self.root), "BMAD_LOOP_ROLE": "dev",
               "BMAD_LOOP_PHASE": "dev-running"}
        proc = subprocess.run([sys.executable, str(METER_HOOK)], env=env, capture_output=True,
                              text=True, encoding="utf-8", timeout=120)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual([r["stage"] for r in self.table()], ["dev"])


    def test_a_gate_whose_label_lacks_gate_is_counted_from_the_recorded_evidence(self):
        """Fix 8: earlier sessions are classed like the current one — their Stage Log
        row (by session id), else the journal's pre_commit_gate workflow."""
        self.spec.write_text(SPEC_TEXT, encoding="utf-8", newline="\n")
        self.add_pass("dev", "dev", "2026-10-28T23:41:00Z", "2026-10-28T23:52:10Z", [usage_line("m1", inp=1, out=1)])
        self.from_pass("dev", "dev-running")
        # gate 1: the hook ran (its row is on record)
        self.add_pass("studio-pipeline.check", "review", "2026-10-29T00:21:00Z", "2026-10-29T00:25:00Z",
                      [usage_line("g1", inp=1, out=1)], workflow_stage="pre_commit_gate")
        self.from_pass("review", "pre_commit_gate")
        # gate 2: the hook never ran for it (no row) — only the journal says it was the gate
        self.add_pass("studio-pipeline.check", "review", "2026-10-29T00:30:00Z", "2026-10-29T00:35:00Z",
                      [usage_line("g2", inp=1, out=1)], workflow_stage="pre_commit_gate")
        # gate 3: the hook's current session
        self.add_pass("studio-pipeline.check", "review", "2026-10-29T00:40:00Z", "2026-10-29T00:45:00Z",
                      [usage_line("g3", inp=1, out=1)], workflow_stage="pre_commit_gate")
        self.from_pass("review", "pre_commit_gate")
        self.assertEqual([(r["stage"], r["pass"]) for r in self.table()],
                         [("dev", "1"), ("gate", "1"), ("gate", "3")])
        # a review session after the gates is review 1, not counted with them
        self.add_pass("review", "review", "2026-10-29T00:50:00Z", "2026-10-29T00:55:00Z",
                      [usage_line("r1", inp=1, out=1)])
        self.from_pass("review", "review-running")
        self.assertEqual((self.table()[-1]["stage"], self.table()[-1]["pass"]), ("review", "1"))

    def test_the_planners_buffer_at_the_repo_root_flushes_into_the_worktree_table(self):
        """Fix 6: the plan row was buffered under the project root (the planner ran
        there); the hook's from-pass in a distinct worktree flushes it and removes it."""
        plansync.stage_start(self.root, "plan", story=KEY, now="2026-10-28T23:30:00Z")
        plansync.stage_stop(self.root, "plan", story=KEY, now="2026-10-28T23:40:00Z")
        root_buffer = self.root / "_bmad-output/specs/spec-epic-35/stages" / f"{KEY}.jsonl"
        self.assertTrue(root_buffer.is_file())
        worktree = self.tmp / "worktree"
        wt_stories = worktree / "_bmad-output" / "specs" / "spec-epic-35" / "stories"
        wt_stories.mkdir(parents=True)
        wt_spec = wt_stories / f"{KEY}-spec.md"
        self.add_pass("dev", "dev", "2026-10-28T23:41:00Z", "2026-10-28T23:52:10Z", [usage_line("m1", inp=1, out=1)])
        # the spec not yet in the worktree: the root's buffer moves into the worktree's
        first = plansync.stage_from_pass(worktree, self.run_dir, KEY, role="dev", phase="dev-running",
                                         repo_root=self.root)
        self.assertTrue(first["buffered"], first)
        self.assertFalse(root_buffer.exists())
        wt_buffer = worktree / "_bmad-output/specs/spec-epic-35/stages" / f"{KEY}.jsonl"
        self.assertEqual(len(wt_buffer.read_text(encoding="utf-8").splitlines()), 2)
        wt_spec.write_text(SPEC_TEXT, encoding="utf-8", newline="\n")
        self.add_pass("review", "review", "2026-10-28T23:55:00Z", "2026-10-29T00:05:00Z", [usage_line("r1", inp=1, out=1)])
        plansync.stage_from_pass(worktree, self.run_dir, KEY, role="review", phase="review-running",
                                 repo_root=self.root)
        rows = plansync.parse_stage_log(wt_spec.read_text(encoding="utf-8"))
        self.assertEqual([(r["stage"], r["started"]) for r in rows],
                         [("plan", "2026-10-28T23:30:00Z"), ("dev", "2026-10-28T23:41:00Z"),
                          ("review", "2026-10-28T23:55:00Z")])
        self.assertFalse(wt_buffer.exists())

    def test_the_hook_passes_the_repo_root_when_it_is_not_the_worktree(self):
        plansync.stage_start(self.root, "plan", story=KEY, now="2026-10-28T23:30:00Z")
        plansync.stage_stop(self.root, "plan", story=KEY, now="2026-10-28T23:40:00Z")
        worktree = self.tmp / "worktree"
        wt_stories = worktree / "_bmad-output" / "specs" / "spec-epic-35" / "stories"
        wt_stories.mkdir(parents=True)
        wt_spec = wt_stories / f"{KEY}-spec.md"
        wt_spec.write_text(SPEC_TEXT, encoding="utf-8", newline="\n")
        self.add_pass("dev", "dev", "2026-10-28T23:41:00Z", "2026-10-28T23:52:10Z", [usage_line("m1", inp=1, out=1)])
        env = {**os.environ, "BMAD_LOOP_STAGE": "post_session", "TK_STUDIO_ROOT": str(REPO_ROOT),
               "BMAD_LOOP_RUN_DIR": str(self.run_dir), "BMAD_LOOP_STORY_KEY": KEY,
               "BMAD_LOOP_WORKTREE": str(worktree), "BMAD_LOOP_REPO_ROOT": str(self.root),
               "BMAD_LOOP_ROLE": "dev", "BMAD_LOOP_PHASE": "dev-running"}
        proc = subprocess.run([sys.executable, str(METER_HOOK)], env=env, capture_output=True,
                              text=True, encoding="utf-8", timeout=120)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        rows = plansync.parse_stage_log(wt_spec.read_text(encoding="utf-8"))
        self.assertEqual([r["stage"] for r in rows], ["plan", "dev"])
        self.assertFalse((self.root / "_bmad-output/specs/spec-epic-35/stages" / f"{KEY}.jsonl").exists())


class NestedPipelineCopyTests(unittest.TestCase):
    """Fix 7: the apps/supervisor copy of the plugin writes engine rows too."""

    NESTED = REPO_ROOT / "apps" / "supervisor" / ".bmad-loop" / "plugins" / "studio-pipeline"
    ROOT_COPY = REPO_ROOT / ".bmad-loop" / "plugins" / "studio-pipeline"

    def test_the_nested_hook_is_the_root_hook(self):
        self.assertEqual((self.NESTED / "meter_hook.py").read_bytes(),
                         (self.ROOT_COPY / "meter_hook.py").read_bytes())

    def test_the_nested_manifest_declares_the_same_post_session_hook(self):
        import tomllib
        nested = tomllib.loads((self.NESTED / "plugin.toml").read_text(encoding="utf-8"))
        root = tomllib.loads((self.ROOT_COPY / "plugin.toml").read_text(encoding="utf-8"))
        self.assertEqual(nested["hooks"]["post_session"], root["hooks"]["post_session"])
        self.assertEqual(nested["hooks"]["post_commit"], root["hooks"]["post_commit"])


class OperatorAndSupervisorTests(StageFixture):
    def test_start_then_stop_opens_then_completes_the_row(self):
        self.spec.write_text(SPEC_TEXT, encoding="utf-8", newline="\n")
        code, out = self.cli(plansync.main, ["stage", "--start", "--directory", str(self.root),
                                             "--story", KEY, "--stage", "plan", "--model", MODEL,
                                             "--effort", "high"])
        self.assertEqual(code, 0, out)
        self.assertEqual(list(out)[-4:], ["status", "intent", "artifacts", "reason"])
        row = self.table()[0]
        self.assertEqual((row["stage"], row["ended"], row["outcome"], row["effort"]),
                         ("plan", plansync.NO_VALUE, "running", "high"))
        key = plansync.stage_row_key(KEY, row)
        code, out = self.cli(plansync.main, ["stage", "--stop", "--directory", str(self.root),
                                             "--story", KEY, "--stage", "plan"])
        self.assertEqual(code, 0, out)
        self.assertEqual(out["completed"], key)  # the same row, completed in place
        rows = self.table()
        self.assertEqual(len(rows), 1)
        self.assertNotEqual(rows[0]["ended"], plansync.NO_VALUE)
        self.assertEqual(rows[0]["outcome"], "done")

    def test_stop_with_no_open_row_is_a_named_refusal(self):
        self.spec.write_text(SPEC_TEXT, encoding="utf-8", newline="\n")
        before = self.spec.read_bytes()
        code, out = self.cli(plansync.main, ["stage", "--stop", "--directory", str(self.root),
                                             "--story", KEY, "--stage", "plan"])
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])
        self.assertEqual(out["status"], "blocked")
        self.assertIn("no open plan row", out["reason"])
        self.assertEqual(self.spec.read_bytes(), before)

    def test_supervisor_rows_land_after_the_engine_rows_and_dedupe(self):
        self.engine_passes()
        rows = [{"stage": "host-leg", "pass": 1, "started": "2026-10-29T01:00:00.123Z",
                 "ended": "2026-10-29T01:05:00Z", "outcome": "green"},
                {"stage": "merge", "started": "2026-10-29T02:00:00Z",
                 "ended": "2026-10-29T02:00:00Z", "outcome": "merged"}]
        code, out = self.cli(plansync.main, ["stage", "--append", "--directory", str(self.root),
                                             "--story", f"{KEY}-spec", "--row-json", json.dumps(rows)])
        self.assertEqual((code, out["appended"]), (0, 2), out)
        self.assertEqual([r["stage"] for r in self.table()][-3:], ["gate", "host-leg", "merge"])
        self.assertEqual(self.table()[-2]["model"], plansync.NO_VALUE)
        self.assertEqual(self.table()[-2]["started"], "2026-10-29T01:00:00Z")
        before = self.spec.read_bytes()
        again = plansync.stage_append(self.root, rows, story=KEY)
        self.assertEqual(again["appended"], 0)
        self.assertEqual(self.spec.read_bytes(), before)

    def test_placement_without_consult_log_is_before_auto_run_result_and_fences_are_ignored(self):
        self.spec.write_text("---\ntitle: x\n---\n\n```\n## Stage Log\n```\n\n## Auto Run Result\n\nr\n",
                             encoding="utf-8", newline="\n")
        plansync.stage_append(self.root, [{"stage": "merge", "started": "2026-10-29T02:00:00Z"}], story=KEY)
        text = self.spec.read_text(encoding="utf-8")
        self.assertLess(text.index("\n## Stage Log\n"), text.index("## Auto Run Result"))
        self.assertEqual(len(self.table()), 1)

    def test_an_elapsed_field_is_refused(self):
        self.spec.write_text(SPEC_TEXT, encoding="utf-8", newline="\n")
        with self.assertRaises(plansync.PlanSyncError):
            plansync.stage_append(self.root, [{"stage": "x", "started": "2026-10-29T02:00:00Z",
                                               "elapsed": 5}], story=KEY)

    def test_the_epic_planning_row_lives_on_the_plan_entity_and_survives_normalize(self):
        planning = self.root / "_bmad-output" / "planning-artifacts"
        planning.mkdir(parents=True)
        (planning / "epics.md").write_text("# Epics\n\n## Epic 35: Stages\n\nThe epic.\n\n"
                                           "### Story 35.8: Stage log\n\nA story.\n",
                                           encoding="utf-8", newline="\n")
        plansync.normalize(self.root)
        epic = next(p for p in plansync.plan_dir(self.root).glob("EP-*.md"))
        plansync.stage_start(self.root, "plan", entity=epic.stem, now="2026-10-27T10:00:00Z")
        plansync.stage_stop(self.root, "plan", entity=epic.stem, now="2026-10-27T12:00:00Z")
        plansync.normalize(self.root)
        rows = plansync.parse_stage_log(epic.read_text(encoding="utf-8"))
        self.assertEqual([(r["stage"], r["started"], r["ended"]) for r in rows],
                         [("plan", "2026-10-27T10:00:00Z", "2026-10-27T12:00:00Z")])


class FakeStageJira:
    """Comments and worklogs of one issue behind the transport seam."""

    def __init__(self):
        self.comments: list[dict] = []
        self.worklogs: list[dict] = []
        self.calls: list[tuple[str, str]] = []
        self.fail = False

    def __call__(self, method, url, body):
        path = url.split(jirabackend.API_PREFIX, 1)[1].split("?")[0]
        self.calls.append((method, path))
        if self.fail:
            return 503, {"errorMessages": ["unavailable"]}
        if path == "/issue/TKS-8/comment":
            if method == "GET":
                return 200, {"comments": self.comments, "startAt": 0, "total": len(self.comments)}
            made = {"id": str(100 + len(self.comments)), "body": body["body"],
                    "created": f"2026-10-29T03:00:{len(self.comments):02d}.000+0000"}
            self.comments.append(made)
            return 201, made
        if path == "/issue/TKS-8/worklog":
            if method == "GET":
                return 200, {"worklogs": self.worklogs, "startAt": 0, "total": len(self.worklogs)}
            made = {"id": str(500 + len(self.worklogs)), **body}
            self.worklogs.append(made)
            return 201, made
        return 404, {"errorMessages": ["no"]}


class StagePostTests(StageFixture):
    def bind(self):
        configlib.standup_project_config(self.root, project_id="tk-studio")
        plansync.write_binding(self.root, {"jira": {"site": "example.atlassian.net", "project_key": "TKS"}})
        os.environ.update({jirabackend.AGENT_TOKEN_ENV: "t", jirabackend.AGENT_EMAIL_ENV: "a@example.com",
                           jirabackend.CLOUD_ID_ENV: "cloud", jirabackend.SITE_ENV: "example.atlassian.net"})

    def entity(self, jira_key=True):
        plan = plansync.plan_dir(self.root)
        plan.mkdir(parents=True, exist_ok=True)
        front = {"shape_version": 1, "id": "ST-153", "type": "story", "title": "stage log",
                 "status": "in-progress", "created": "2026-10-28T00:00:00+00:00",
                 "updated": "2026-10-28T00:00:00+00:00", "source": "epics.md#story-35.8",
                 **({"external": {"jira": {"key": "TKS-8"}}} if jira_key else {})}
        (plan / "ST-153.md").write_text(interchange.render_entity(front, "\nbody\n"),
                                        encoding="utf-8", newline="\n")

    def two_rows(self):
        self.spec.write_text(SPEC_TEXT, encoding="utf-8", newline="\n")
        plansync.stage_append(self.root, [
            {"stage": "review", "pass": 2, "started": "2026-10-28T23:41:00Z", "ended": "2026-10-28T23:52:10Z",
             "model": MODEL, "effort": "medium", "tokens_in": 812345, "tokens_out": 10234, "cost_usd": 1.234},
            {"stage": "plan", "started": "2026-10-29T00:00:00Z", "model": MODEL, "effort": "high",
             "outcome": "running"}], story=KEY)

    def test_not_bound_posts_nothing(self):
        self.two_rows()
        result = plansync.stage_post(self.root, "ST-153", story=KEY, transport=FakeStageJira())
        self.assertTrue(result["ok"])
        self.assertEqual(result["posted"], "skipped: not bound")

    def test_comments_and_worklog_shapes_then_a_second_run_posts_nothing(self):
        self.bind()
        self.entity()
        self.two_rows()
        fake = FakeStageJira()
        result = plansync.stage_post(self.root, "ST-153", story=KEY, transport=fake)
        self.assertEqual(result["posted"], {"start": 2, "stop": 1, "worklog": 1, "found": 0})
        review_key = plansync.stage_row_key(KEY, self.table()[0])
        plan_key = plansync.stage_row_key(KEY, self.table()[1])
        # the open plan row awaits its stop: not ok, retryable, one row unposted
        self.assertEqual((result["ok"], result["status"], result["retryable"], result["unposted"]),
                         (False, "partial", True, 1), result)
        self.assertEqual(result["awaiting"], [f"{plan_key} open"])
        bodies = [c["body"] for c in fake.comments]
        self.assertEqual(bodies[0], f"Stage review [pass 2] started — 2026-10-28T23:41:00Z; model: {MODEL}; "
                                    f"effort: medium [stage:{review_key} start]")
        self.assertEqual(bodies[1], f"Stage review [pass 2] finished — 2026-10-28T23:52:10Z; model: {MODEL}; "
                                    f"effort: medium; tokens: 812345/10234; cost: $1.23 [stage:{review_key} stop]")
        # no pass: `[pass n]` omitted; an open row gets its start comment only
        self.assertTrue(bodies[2].startswith(f"Stage plan started — 2026-10-29T00:00:00Z; model: {MODEL}; effort: high [stage:"))
        self.assertEqual(len(bodies), 3)
        self.assertEqual(len(fake.worklogs), 1)
        self.assertEqual(fake.worklogs[0]["timeSpentSeconds"], 670)
        self.assertEqual(fake.worklogs[0]["started"], "2026-10-28T23:41:00.000+0000")
        state = json.loads((self.root / plansync.STAGE_POSTS_REL).read_text(encoding="utf-8"))
        self.assertEqual(set(state[review_key]), {"start", "stop", "worklog"})
        self.assertEqual(state[review_key]["start"]["created"], "2026-10-29T03:00:00.000+0000")
        fake.calls.clear()
        again = plansync.stage_post(self.root, "ST-153", story=KEY, transport=fake)
        self.assertEqual(again["posted"], {"start": 0, "stop": 0, "worklog": 0, "found": 0})
        self.assertEqual(fake.calls, [])
        self.assertEqual((again["ok"], again["unposted"]), (False, 1))
        # the plan row stopped: its finish comment and worklog land, nothing left unposted
        plansync.stage_stop(self.root, "plan", story=KEY, now="2026-10-29T00:30:00Z")
        done = plansync.stage_post(self.root, "ST-153", story=KEY, transport=fake)
        self.assertEqual((done["ok"], done["status"], done["unposted"], done["awaiting"]),
                         (True, "complete", 0, []), done)
        self.assertNotIn("retryable", done)
        self.assertEqual(done["posted"], {"start": 0, "stop": 1, "worklog": 1, "found": 0})

    def test_a_failing_transport_is_ok_false_and_a_later_run_posts(self):
        self.bind()
        self.entity()
        self.two_rows()
        fake = FakeStageJira()
        fake.fail = True
        result = plansync.stage_post(self.root, "ST-153", story=KEY, transport=fake)
        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "blocked")
        self.assertTrue(result["retryable"])  # a failed Jira call: the caller retries
        self.assertEqual(result["unposted"], 2)
        self.assertEqual(len(result["pending"]), 4)
        self.assertFalse((self.root / plansync.STAGE_POSTS_REL).exists())
        fake.fail = False
        later = plansync.stage_post(self.root, "ST-153", story=KEY, transport=fake)
        self.assertEqual(later["pending"], [])
        self.assertEqual(len(fake.comments), 3)
        self.assertEqual((later["ok"], later["unposted"]), (False, 1))  # only the open plan row

    def test_lost_state_finds_the_markers_and_posts_nothing_twice(self):
        self.bind()
        self.entity()
        self.two_rows()
        fake = FakeStageJira()
        plansync.stage_post(self.root, "ST-153", story=KEY, transport=fake)
        (self.root / plansync.STAGE_POSTS_REL).unlink()
        again = plansync.stage_post(self.root, "ST-153", story=KEY, transport=fake)
        self.assertEqual(again["unposted"], 1)  # only the open plan row (awaiting its stop)
        self.assertEqual(again["posted"], {"start": 0, "stop": 0, "worklog": 0, "found": 4})
        self.assertEqual((len(fake.comments), len(fake.worklogs)), (3, 1))

    def test_an_absent_agent_token_is_named_before_any_call(self):
        self.bind()
        self.entity()
        self.two_rows()
        os.environ.pop(jirabackend.AGENT_TOKEN_ENV)
        fake = FakeStageJira()
        result = plansync.stage_post(self.root, "ST-153", story=KEY, transport=fake)
        self.assertFalse(result["ok"])
        self.assertIn(jirabackend.AGENT_TOKEN_ENV, result["reason"])
        self.assertNotIn("retryable", result)  # a refusal: final
        self.assertEqual(fake.calls, [])

    def test_an_entity_without_a_jira_key_is_a_final_refusal(self):
        self.bind()
        self.entity(jira_key=False)
        self.two_rows()
        result = plansync.stage_post(self.root, "ST-153", story=KEY, transport=FakeStageJira())
        self.assertEqual((result["ok"], result["status"]), (False, "blocked"))
        self.assertIn("external.jira.key", result["reason"])
        self.assertNotIn("retryable", result)

    def test_buffered_rows_are_unposted_and_retryable_until_the_spec_holds_them(self):
        self.bind()
        self.entity()
        # no spec yet: the supervisor's rows only buffer
        rows = [{"stage": "host-leg", "pass": 1, "started": "2026-10-29T01:00:00Z",
                 "ended": "2026-10-29T01:05:00Z", "outcome": "green"}]
        appended = plansync.stage_append(self.root, rows, story=KEY)
        self.assertTrue(appended["buffered"])
        fake = FakeStageJira()
        result = plansync.stage_post(self.root, "ST-153", story=KEY, transport=fake)
        key = plansync.stage_row_key(KEY, plansync.stage_row(rows[0]))
        self.assertEqual((result["ok"], result["status"], result["retryable"], result["unposted"]),
                         (False, "partial", True, 1), result)
        self.assertEqual(result["awaiting"], [f"{key} buffered"])
        self.assertEqual(fake.comments, [])
        code, out = self.cli(plansync.main, ["stage-post", "--directory", str(self.root),
                                             "--id", "ST-153", "--story", KEY, "--dry-run"])
        self.assertEqual((code, out["unposted"]), (2, 1))
        # the spec lands; the next append flushes the buffer, then everything posts
        self.spec.write_text(SPEC_TEXT, encoding="utf-8", newline="\n")
        plansync.stage_append(self.root, rows, story=KEY)
        later = plansync.stage_post(self.root, "ST-153", story=KEY, transport=fake)
        self.assertEqual((later["ok"], later["unposted"]), (True, 0), later)
        self.assertEqual(len(fake.comments), 2)

    def test_a_span_under_a_minute_logs_no_worklog_but_its_comments_post(self):
        self.bind()
        self.entity()
        self.spec.write_text(SPEC_TEXT, encoding="utf-8", newline="\n")
        plansync.stage_append(self.root, [
            {"stage": "merge", "started": "2026-10-29T02:00:00Z", "ended": "2026-10-29T02:00:00Z",
             "outcome": "merged"},
            {"stage": "close-out", "pass": 1, "started": "2026-10-29T01:59:01Z",
             "ended": "2026-10-29T02:00:00Z", "outcome": "PR"}], story=KEY)
        fake = FakeStageJira()
        result = plansync.stage_post(self.root, "ST-153", story=KEY, transport=fake)
        self.assertEqual((result["ok"], result["unposted"]), (True, 0), result)
        self.assertEqual(result["posted"], {"start": 2, "stop": 2, "worklog": 0, "found": 0})
        self.assertEqual(fake.worklogs, [])
        self.assertEqual(len(fake.comments), 4)
        state = json.loads((self.root / plansync.STAGE_POSTS_REL).read_text(encoding="utf-8"))
        self.assertEqual({v["worklog"] for v in state.values()}, {"skipped: span <60s"})
        fake.calls.clear()
        again = plansync.stage_post(self.root, "ST-153", story=KEY, transport=fake)
        self.assertEqual((again["ok"], fake.calls), (True, []))


class RollupTests(StageFixture):
    def test_rollup_epic_names_cycle_hands_on_share_rounds_reruns_gaps_tokens_cost_and_skew(self):
        self.engine_passes()
        plansync.stage_append(self.root, [
            {"stage": "plan", "started": "2026-10-28T23:00:00Z", "ended": "2026-10-28T23:30:00Z"},
            {"stage": "host-leg", "pass": 1, "started": "2026-10-29T00:30:00Z", "ended": "2026-10-29T00:35:00Z"},
            {"stage": "re-run", "pass": 1, "started": "2026-10-29T00:40:00Z", "ended": "2026-10-29T00:45:00Z"},
            {"stage": "merge", "started": "2026-10-29T01:00:00Z", "ended": "2026-10-29T01:00:00Z"}], story=KEY)
        rows = self.table()
        dev_key = plansync.stage_row_key(KEY, next(r for r in rows if r["stage"] == "dev"))
        posts = self.root / plansync.STAGE_POSTS_REL
        posts.parent.mkdir(parents=True)
        posts.write_text(json.dumps({dev_key: {
            "start": {"id": "1", "created": "2026-10-28T23:41:04.000+0000"},
            "stop": {"id": "2", "created": "2026-10-28T23:52:40.000+0000"}}}), encoding="utf-8")
        code, out = self.cli(report.main, ["rollup", "--directory", str(self.root), "--epic", "35"])
        self.assertEqual(code, 0, out)
        self.assertEqual(list(out)[-4:], ["status", "intent", "artifacts", "reason"])
        r = out["rollup"]
        self.assertEqual(r["first_start"], "2026-10-28T23:00:00Z")
        self.assertEqual(r["cycle_s"], 2 * 3600)  # 23:00 → the merge at 01:00
        story = r["stories"][KEY]
        self.assertEqual(story["review_rounds"], 2)
        self.assertEqual(story["reruns"], 1)
        self.assertEqual(r["planning_s"], 1800)
        self.assertAlmostEqual(r["planning_share"], round(1800 / r["hands_on_s"], 4))
        self.assertIn("gap 2026-10-28T23:30:00Z..2026-10-28T23:41:00Z", [g["line"] for g in r["gaps"]])
        self.assertEqual(r["by_stage"]["dev"]["tokens_in"], 1_300_000)
        self.assertEqual(r["by_stage"]["dev"]["cost_usd"], 2.6)
        self.assertEqual(r["max_skew"]["skew_s"], 30.0)  # the stop: 23:52:40 − 23:52:10
        self.assertEqual(r["max_skew"]["boundary"], "stop")
        # the consult (00:10–00:12) lies inside review 2 (00:06–00:20): listed with its
        # tokens and seconds, never counted twice in hands-on
        spans = {"plan": 1800, "dev": 670, "review": 600 + 840, "gate": 240,
                 "host-leg": 300, "re-run": 300, "merge": 0}
        self.assertEqual(story["hands_on_s"], sum(spans.values()))
        self.assertEqual((story["nested_s"], story["nested"]),
                         (120, [{"stage": "consult", "pass": "1", "seconds": 120, "within": "review 2"}]))
        self.assertEqual(r["by_stage"]["consult"], {"rows": 1, "seconds": 120, "tokens_in": 5000,
                                                    "tokens_out": 500, "cost_usd": r["by_stage"]["consult"]["cost_usd"]})
        self.assertGreater(r["by_stage"]["consult"]["cost_usd"], 0)
        self.assertEqual(r["hands_on_s"], story["hands_on_s"])

    def _story(self, key, rows):
        (self.stories / f"{key}-spec.md").write_text(SPEC_TEXT, encoding="utf-8", newline="\n")
        plansync.stage_append(self.root, rows, story=key)

    def test_story_36_1_an_inconclusive_leg_counts_as_neither_green_nor_red(self):
        self.engine_passes()
        plansync.stage_append(self.root, [
            {"stage": "host-leg", "pass": 1, "started": "2026-10-29T00:30:00Z", "ended": "2026-10-29T00:35:00Z",
             "outcome": "inconclusive"},
            {"stage": "re-run", "pass": 1, "started": "2026-10-29T00:40:00Z", "ended": "2026-10-29T00:45:00Z",
             "outcome": "inconclusive"}], story=KEY)
        self.assertEqual([r["outcome"] for r in self.table() if r["stage"] in ("host-leg", "re-run")],
                         ["inconclusive", "inconclusive"])
        r = report.rollup_epic(self.root, 35)
        self.assertEqual(r["by_stage"]["host-leg"]["rows"], 1)
        self.assertEqual(r["by_stage"]["re-run"]["rows"], 1)
        self.assertEqual(r["reruns"], 1)
        # no verdict count anywhere in the rollup, at any depth
        def keys(value):
            if isinstance(value, dict):
                for k, v in value.items():
                    yield k
                    yield from keys(v)
            elif isinstance(value, list):
                for v in value:
                    yield from keys(v)
        names = set(keys(r))
        self.assertFalse(names & {"green", "red", "inconclusive"}, names)

    def test_rollup_epic_counts_one_runs_shared_supervisor_rows_once(self):
        # one supervisor run resolved three stories: its host leg, re-run, close-out and
        # merge rows land on each story's spec, the same occurrence three times
        shared = [
            {"stage": "host-leg", "pass": 1, "started": "2026-10-29T10:00:00Z", "ended": "2026-10-29T10:05:00Z"},
            {"stage": "re-run", "pass": 1, "started": "2026-10-29T10:10:00Z", "ended": "2026-10-29T10:20:00Z"},
            {"stage": "close-out", "pass": 1, "started": "2026-10-29T10:20:00Z", "ended": "2026-10-29T10:21:00Z"},
            {"stage": "merge", "started": "2026-10-29T11:00:00Z", "ended": "2026-10-29T11:00:00Z"}]
        for n, key in enumerate(("35-1-one", "35-2-two", "35-3-three")):
            self._story(key, [{"stage": "dev", "pass": 1, "started": f"2026-10-29T0{n}:00:00Z",
                               "ended": f"2026-10-29T0{n}:30:00Z"}, *shared])
        r = report.rollup_epic(self.root, 35)
        self.assertEqual(r["reruns"], 1)
        self.assertEqual([s["reruns"] for s in r["stories"].values()], [1, 1, 1])  # per story unchanged
        self.assertEqual(r["hands_on_s"], 3 * 1800 + 300 + 600 + 60)  # the host leg's 300 s once
        self.assertEqual(r["by_stage"]["host-leg"]["rows"], 1)
        self.assertEqual(r["by_stage"]["host-leg"]["seconds"], 300)
        self.assertEqual(r["by_stage"]["dev"]["rows"], 3)
        self.assertEqual(r["by_stage"]["merge"]["rows"], 1)
        self.assertEqual(r["stories"]["35-2-two"]["hands_on_s"], 1800 + 300 + 600 + 60)

    def test_rollup_epic_nests_a_plan_made_inside_another_storys_gate(self):
        # gate.md Part B: story Y is planned inside story X's gate session
        self._story("35-1-x", [{"stage": "gate", "pass": 1, "started": "2026-10-29T12:00:00Z",
                                "ended": "2026-10-29T13:00:00Z"}])
        self._story("35-2-y", [
            {"stage": "plan", "started": "2026-10-29T12:10:00Z", "ended": "2026-10-29T12:40:00Z"},
            {"stage": "dev", "pass": 1, "started": "2026-10-29T14:00:00Z", "ended": "2026-10-29T14:30:00Z"}])
        r = report.rollup_epic(self.root, 35)
        self.assertEqual(r["nested_s"], 1800)
        self.assertEqual(r["hands_on_s"], 3600 + 1800)
        self.assertEqual(r["planning_s"], 0)
        self.assertEqual(r["planning_share"], 0.0)
        self.assertEqual(r["by_stage"]["plan"]["seconds"], 1800)  # still listed in its stage type
        y = r["stories"]["35-2-y"]  # the story's own numbers unchanged
        self.assertEqual((y["planning_s"], y["nested_s"], y["hands_on_s"]), (1800, 0, 3600))

    def _epic_on_jira(self, bind=True):
        self.engine_passes()
        plan = plansync.plan_dir(self.root)
        plan.mkdir(parents=True, exist_ok=True)
        (plan / "EP-035.md").write_text(interchange.render_entity({
            "shape_version": 1, "id": "EP-035", "type": "epic", "title": "Epic 35",
            "status": "in-progress", "created": "2026-10-28T00:00:00+00:00",
            "updated": "2026-10-28T00:00:00+00:00", "source": "epics.md#epic-35",
            "external": {"jira": {"key": "TKS-8"}}}, "\nbody\n"), encoding="utf-8", newline="\n")
        if bind:
            StagePostTests.bind(self)

    def test_rollup_post_comments_once_by_its_marker(self):
        self._epic_on_jira()
        fake = FakeStageJira()
        first = report.run_rollup(self.root, epic=35, post=True, transport=fake)
        self.assertTrue(first["ok"], first)
        self.assertEqual(first["post"]["posted"], "posted")
        self.assertEqual(first["rollup"]["entity"], "EP-035")
        self.assertEqual(len(fake.comments), 1)
        body = fake.comments[0]["body"]
        self.assertTrue(body.startswith("Epic 35 rollup — cycle: "), body)
        self.assertTrue(body.endswith("[stage-rollup:epic-35]"), body)
        fake.calls.clear()
        second = report.run_rollup(self.root, epic=35, post=True, transport=fake)
        self.assertTrue(second["ok"], second)
        self.assertEqual(second["post"]["posted"], "already")
        self.assertEqual(second["post"]["comment"]["id"], fake.comments[0]["id"])
        self.assertEqual([m for m, _ in fake.calls], ["GET"])  # read, never posted again
        self.assertEqual(len(fake.comments), 1)

    def test_rollup_post_not_bound_is_skipped(self):
        self._epic_on_jira(bind=False)
        fake = FakeStageJira()
        out = report.run_rollup(self.root, epic=35, post=True, entity_id="EP-035", transport=fake)
        self.assertTrue(out["ok"], out)
        self.assertEqual(out["post"], {"posted": "skipped: not bound"})
        self.assertEqual(fake.calls, [])

    def test_rollup_post_a_failing_jira_is_blocked(self):
        self._epic_on_jira()
        fake = FakeStageJira()
        fake.fail = True
        out = report.run_rollup(self.root, epic=35, post=True, transport=fake)
        self.assertEqual((out["ok"], out["status"]), (False, "blocked"))
        self.assertIn("rollup --post failed", out["reason"])
        self.assertEqual(fake.comments, [])

    def test_rollup_post_a_non_jira_transport_fault_is_blocked_with_the_status_block(self):
        self._epic_on_jira()

        def transport(method, url, body):
            raise ConnectionResetError("socket closed")
        out = report.run_rollup(self.root, epic=35, post=True, transport=transport)
        self.assertEqual((out["ok"], out["status"]), (False, "blocked"))
        self.assertIn("ConnectionResetError", out["reason"])
        self.assertEqual(list(out)[-4:], ["status", "intent", "artifacts", "reason"])

    def test_rollup_a_read_fault_ends_in_a_blocked_status_block(self):
        self.engine_passes()
        real = report.rollup_epic

        def boom(*a, **k):
            raise UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid start byte")
        report.rollup_epic = boom
        try:
            code, out = self.cli(report.main, ["rollup", "--directory", str(self.root), "--epic", "35"])
        finally:
            report.rollup_epic = real
        self.assertEqual((code, out["status"]), (2, "blocked"))
        self.assertIn("UnicodeDecodeError", out["reason"])
        self.assertEqual(list(out)[-4:], ["status", "intent", "artifacts", "reason"])

    def test_rollup_needs_rows(self):
        code, out = self.cli(report.main, ["rollup", "--directory", str(self.root), "--epic", "35"])
        self.assertEqual(code, 2)
        self.assertEqual(out["status"], "blocked")


class HarvestTests(StageFixture):
    def test_one_stage_event_per_completed_row_and_a_second_run_adds_none(self):
        self.engine_passes()
        plansync.stage_start(self.root, "plan", story=KEY, pass_=2)  # open: waits for its stop
        first = measurepush.harvest_stages(self.root)
        self.assertEqual(first["emitted"], 5)
        lines = [json.loads(l) for l in ledger.ledger_path().read_text(encoding="utf-8").splitlines() if l]
        events = [e for e in lines if e["event"] == "stage"]
        self.assertEqual(len(events), 5)
        for event in events:
            ledger.validate("stage", event["payload"])
            self.assertFalse(any("token" in k for k in event["payload"]))
        dev = next(e["payload"] for e in events if e["payload"]["stage"] == "dev")
        self.assertEqual(dev["usage"], {"input": 1_300_000, "output": 50_000})
        self.assertEqual(dev["cost_usd"], 2.6)
        self.assertEqual(dev["pass"], 1)
        self.assertEqual(dev["story"], KEY)
        second = measurepush.harvest_stages(self.root)
        self.assertEqual((second["emitted"], second["already"]), (0, 5))

    def test_the_report_script_delegates_rollup(self):
        script = PLUGIN_ROOT / "skills" / "tk-studio-report" / "scripts" / "report.py"
        spec = importlib.util.spec_from_file_location("report_script", script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.engine_passes()
        code, out = self.cli(module.main, ["rollup", "--directory", str(self.root), "--story", KEY])
        self.assertEqual(code, 0, out)
        self.assertEqual(out["intent"], "tk-studio-report")
        self.assertEqual(out["rollup"]["review_rounds"], 2)


if __name__ == "__main__":
    unittest.main()
